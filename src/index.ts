import { Config, Diagnostic, getDiagnosticLocations, getDiagnosticMessage, getDiagnosticSeverity, NodeFileSystem, Project, Source } from "@u27n/core";
import { LocaleData } from "@u27n/core/runtime";
import { createHash } from "crypto";
import { ImportExpression } from "estree";
import { walk } from "estree-walker";
import { join, relative } from "path";
import { minify } from "terser";
import type { Chunk, Compilation, Compiler, javascript, NormalModule } from "webpack";

type ChunkGroup = Compilation["chunkGroups"] extends (infer G)[] ? G : never;

const NAME = "u27n";

export class U27nPlugin {
	readonly #configPath: string;
	readonly #modify: boolean | undefined;
	readonly #delay: number;
	readonly #output: string | undefined;

	public constructor(options: U27nPlugin.Options = {}) {
		this.#configPath = options.config ?? "./u27n.json";
		this.#modify = options.modify;
		this.#delay = options.delay ?? 100;

		this.#output = options.output;
	}

	public apply(compiler: Compiler): void {
		const { webpack } = compiler;

		let didProcessAssets = false;

		let project: Project;
		let projectPromise: Promise<void> | null = null;
		let projectWatcher: (() => Promise<void>) | null = null;

		const logger = compiler.getInfrastructureLogger(NAME);

		compiler.getInfrastructureLogger(NAME);

		const output = this.#output ?? (compiler.options.mode === "production" ? "locale/[hash].json" : "locale/[locale]-[chunk].json");
		if (output === null || !(output.includes("[hash]") || (output.includes("[chunk]") && output.includes("[locale]")))) {
			throw new TypeError(`u27n output filename must contain either "[hash]" or "[chunk]" and "[locale]"`);
		}

		const ensureProject = () => {
			if (projectPromise === null) {
				projectPromise = (async () => {
					const configFilename = join(compiler.context, this.#configPath);
					logger.info("Loading project:", relative(process.cwd(), configFilename));

					const config = await Config.read(configFilename);
					project = await Project.create({
						config,
						fileSystem: new NodeFileSystem(),
					});
				})();
			}
			return projectPromise;
		};

		const emitDiagnostics = (diagnostics: Diagnostic[]) => {
			for (const diagnostic of diagnostics) {
				const severity = getDiagnosticSeverity(project.config.diagnostics, diagnostic.type);
				if (severity !== "ignore") {
					const locations = getDiagnosticLocations(project.config.context, project.dataProcessor, diagnostic);
					const message = getDiagnosticMessage(diagnostic);

					let text = `[${severity}]: ${message}`;
					for (const location of locations) {
						switch (location.type) {
							case "file":
								text += `\n  in ${relative(process.cwd(), location.filename)}`;
								break;

							case "fragment":
								text += `\n  in ${relative(process.cwd(), location.filename)}`;
								if (location.source) {
									const position = location.source.lineMap.getPosition(location.start);
									if (position !== null) {
										text += `:${position.line + 1}:${position.character + 1}`;
									}
								}
								break;
						}
					}

					switch (severity) {
						case "error":
							logger.error(text);
							break;

						case "warning":
							logger.warn(text);
							break;

						default:
							logger.info(text);
							break;
					}
				}
			}
		};

		compiler.hooks.run.tapPromise(NAME, async () => {
			await ensureProject();
			const result = await project.run({
				fragmentDiagnostics: true,
				modify: this.#modify ?? false,
				output: false,
			});
			emitDiagnostics(result.diagnostics);
		});

		compiler.hooks.watchRun.tapPromise(NAME, async () => {
			await ensureProject();
			if (projectWatcher === null) {
				projectWatcher = project.watch({
					fragmentDiagnostics: true,
					modify: this.#modify ?? true,
					output: false,
					delay: this.#delay,
					onFinish: async ({ diagnostics, translationDataChanged }) => {
						emitDiagnostics(diagnostics);
						if (translationDataChanged && didProcessAssets) {
							compiler.watching?.invalidate();
						}
					},
					onError: error => {
						logger.error(error);
					},
				});
			}
		});

		// const globalChunkIds = new WeakIdAllocator<Chunk>();

		const chunkGroups = new Set<ChunkGroup>();
		const moduleChunks = new Map<NormalModule, Chunk[]>();
		const requests: [NormalModule, string][] = [];

		compiler.hooks.compile.tap(NAME, () => {
			chunkGroups.clear();
			moduleChunks.clear();
			requests.length = 0;
		});

		compiler.hooks.compilation.tap(NAME, (compilation, { normalModuleFactory }) => {
			for (const type of [
				"javascript/auto",
				"javascript/dynamic",
				"javascript/esm",
			]) {
				normalModuleFactory.hooks.parser.for(type).tap(NAME, (parser: javascript.JavascriptParser) => {
					parser.hooks.program.tap(NAME, ast => {
						const { module } = parser.state;
						if (module instanceof webpack.NormalModule) {
							walk(ast, {
								enter: node => {
									if (node.type === "ImportExpression") {
										const expr = node as ImportExpression;
										if (expr.source.type === "Literal" && typeof expr.source.value === "string") {
											const index = requests.length;
											requests.push([module, expr.source.value]);
											module.addDependency(new webpack.dependencies.ConstDependency(`__u27n_i__(${index},`, expr.range![0]));
											module.addDependency(new webpack.dependencies.ConstDependency(")", expr.range![1]));
										}
									}
								},
							});
						}
					});
				});
			}

			compilation.hooks.afterOptimizeTree.tap(NAME, (_chunks, modules) => {
				for (const module of modules) {
					if (module instanceof webpack.NormalModule) {
						moduleChunks.set(module, compilation.chunkGraph.getModuleChunks(module));
					}
				}
				for (const chunkGroup of compilation.chunkGroups) {
					chunkGroups.add(chunkGroup);
				}
			});
		});

		compiler.hooks.thisCompilation.tap(NAME, compilation => {
			compilation.hooks.processAssets.tapPromise({ name: NAME, stage: webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE }, async () => {
				/** Map of chunk id => locale code => locale data */
				const data = new Map<string | number, Map<string, LocaleData>>();

				didProcessAssets = true;

				const { config } = project;
				const projectData = project.dataProcessor.generateLocaleData({
					includeOutdated: config.output.includeOutdated,
					namespace: config.namespace,
					sourceLocale: config.sourceLocale,
					translatedLocales: config.translatedLocales,
				});

				moduleChunks.forEach((chunks, module) => {
					const sourceId = Source.filenameToSourceId(project.config.context, module.resource);
					const source = project.dataProcessor.getSource(sourceId);
					if (source) {
						const fragmentIds: string[] = [];
						for (const fragment of source.fragments) {
							if (fragment.fragmentId !== undefined) {
								fragmentIds.push(fragment.fragmentId);
							}
						}
						projectData.forEach((localeData, locale) => {
							const namespace = localeData[config.namespace];
							if (namespace) {
								let targetNamespaces: LocaleData.Namespace[] | null = null;
								fragmentIds.forEach(fragmentId => {
									const value = namespace[fragmentId];
									if (value !== undefined) {
										if (targetNamespaces === null) {
											targetNamespaces = [];

											chunks.forEach(chunk => {
												const chunkData = data.get(chunk.id!);
												if (chunkData === undefined) {
													const targetNamespace: LocaleData.Namespace = {};
													data.set(chunk.id!, new Map([[locale, { [config.namespace]: targetNamespace }]]));
													targetNamespaces!.push(targetNamespace);
												} else {
													const localeData = chunkData.get(locale);
													if (localeData === undefined) {
														const targetNamespace: LocaleData.Namespace = {};
														chunkData.set(locale, { [config.namespace]: targetNamespace });
														targetNamespaces!.push(targetNamespace);
													} else {
														targetNamespaces!.push(localeData[config.namespace] ?? (localeData[config.namespace] = {}));
													}
												}
											});
										}
										targetNamespaces.forEach(targetNamespace => targetNamespace[fragmentId] = value);
									}
								});
							}
						});
					} else {
						// TODO: Resolve locale data using manifests.
					}
				});

				const localeChunks: Record<string | number, Record<string, string>> = {};
				const localeChunkIds = new Set<string | number>();

				data.forEach((chunkData, chunkId) => {
					chunkData.forEach((localeData, locale) => {
						const content = JSON.stringify(localeData);

						const name = output
							.replace(/\[chunk\]/g, String(chunkId))
							.replace(/\[locale\]/g, locale)
							.replace(/\[hash\]/g, createHash("sha256").update(content).digest().slice(0, 16).toString("base64url"));

						compilation.emitAsset(name, new webpack.sources.OriginalSource(content, name));

						const localeChunk = localeChunks[chunkId];
						if (localeChunk === undefined) {
							localeChunks[chunkId] = {
								[locale]: name,
							};
						} else {
							localeChunk[locale] = name;
						}

						localeChunkIds.add(chunkId);
					});
				});

				const entryChunkGroups = new Set<ChunkGroup>(chunkGroups);

				const requestChunkIds: (string | number)[][] = requests.map(([module, request]) => {
					const chunkIds = new Set<string | number>();
					for (const chunkGroup of chunkGroups) {
						if (chunkGroup.origins.some(o => o.module === module && o.request === request)) {
							entryChunkGroups.delete(chunkGroup);
							for (const chunk of chunkGroup.chunks) {
								// const chunkId = globalChunkIds.alloc(chunk);
								if (localeChunkIds.has(chunk.id!)) {
									chunkIds.add(chunk.id!);
								}
							}
						}
					}
					return Array.from(chunkIds);
				});

				const entryChunkIds = new Set<string | number>();
				for (const chunkGroup of entryChunkGroups) {
					for (const chunk of chunkGroup.chunks) {
						// const chunkId = globalChunkIds.alloc(chunk);
						if (localeChunkIds.has(chunk.id!)) {
							entryChunkIds.add(chunk.id!);
						}
					}
				}

				const manifest: U27nRuntimeManifest = [
					Array.from(entryChunkIds),
					requestChunkIds,
					localeChunks,
				];

				const manifestJs = (await minify(`
					window.__u27n_m__ = ${JSON.stringify(manifest)};
				`)).code!;

				for (const chunk of compilation.chunks) {
					if (chunk.canBeInitial()) {
						for (const file of chunk.files) {
							if (/\.js$/.test(file)) {
								compilation.updateAsset(file, source => {
									return new webpack.sources.ConcatSource(
										new webpack.sources.OriginalSource(manifestJs, file),
										source,
									);
								});
								break;
							}
						}
					}
				}
			});
		});
	}
}

export declare namespace U27nPlugin {
	export interface Options {
		config?: string;
		modify?: boolean;
		delay?: number;
		output?: string;
	}
}
