import { Config, NodeFileSystem, Project, Source } from "@u27n/core";
import { LocaleData } from "@u27n/core/runtime";
import { createHash } from "crypto";
import { ImportExpression } from "estree";
import { walk } from "estree-walker";
import { join } from "path";
import { minify } from "terser";
import { Chunk, Compilation, Compiler, dependencies, javascript, NormalModule, sources } from "webpack";

import { WeakIdAllocator } from "./weak-id-allocator.js";

type ChunkGroup = Compilation["chunkGroups"] extends (infer G)[] ? G : never;

const NAME = "U27N";

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
		let project: Project;
		let projectPromise: Promise<void> | null = null;
		let projectWatcher: (() => Promise<void>) | null = null;

		const output = this.#output ?? (compiler.options.mode === "production" ? "locale/[hash].json" : "locale/[locale]-[chunk].json");
		if (output === null || !(output.includes("[hash]") || (output.includes("[chunk]") && output.includes("[locale]")))) {
			throw new TypeError(`u27n output filename must contain either "[hash]" or "[chunk]" and "[locale]"`);
		}

		const ensureProject = () => {
			if (projectPromise === null) {
				projectPromise = (async () => {
					const configFilename = join(compiler.context, this.#configPath);
					const config = await Config.read(configFilename);

					project = await Project.create({
						config,
						fileSystem: new NodeFileSystem(),
					});
				})();
			}
			return projectPromise;
		};

		compiler.hooks.run.tapPromise(NAME, async () => {
			await ensureProject();
			const result = await project.run({
				fragmentDiagnostics: true,
				modify: this.#modify ?? false,
				output: false,
			});
			// TODO: Log in a webpack agnostic way:
			console.log("Run result:", result);
		});

		compiler.hooks.watchRun.tapPromise(NAME, async () => {
			await ensureProject();
			if (projectWatcher === null) {
				projectWatcher = project.watch({
					fragmentDiagnostics: true,
					modify: this.#modify ?? true,
					output: false,
					delay: this.#delay,
					onDiagnostics: async diagnostics => {
						// TODO: Log in a webpack agnostic way:
						console.log("Diagnostics:", diagnostics);
					},
					onError: error => {
						// TODO: Log in a webpack agnostic way:
						console.error("Error:", error);
					},
				});
			}
		});

		const globalChunkIds = new WeakIdAllocator<Chunk>();

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
						if (module instanceof NormalModule) {
							walk(ast, {
								enter: node => {
									if (node.type === "ImportExpression") {
										const expr = node as ImportExpression;
										if (expr.source.type === "Literal" && typeof expr.source.value === "string") {
											const index = requests.length;
											requests.push([module, expr.source.value]);
											module.addDependency(new dependencies.ConstDependency(`__u27n_i__(${index},`, expr.range![0]));
											module.addDependency(new dependencies.ConstDependency(")", expr.range![1]));
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
					if (module instanceof NormalModule) {
						moduleChunks.set(module, compilation.chunkGraph.getModuleChunks(module));
					}
				}
				for (const chunkGroup of compilation.chunkGroups) {
					chunkGroups.add(chunkGroup);
				}
			});
		});

		compiler.hooks.thisCompilation.tap(NAME, compilation => {
			compilation.hooks.processAssets.tapPromise({ name: NAME, stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE }, async () => {
				/** Map of chunk id => locale code => locale data */
				const data = new Map<number, Map<string, LocaleData>>();

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
												const chunkId = globalChunkIds.alloc(chunk);

												const chunkData = data.get(chunkId);
												if (chunkData === undefined) {
													const targetNamespace: LocaleData.Namespace = {};
													data.set(chunkId, new Map([[locale, { [config.namespace]: targetNamespace }]]));
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

				const localeChunks: Record<number, Record<string, string>> = {};
				const localeChunkIds = new Set<number>();

				data.forEach((chunkData, chunkId) => {
					chunkData.forEach((localeData, locale) => {
						const content = JSON.stringify(localeData);

						const name = output
							.replace(/\[chunk\]/g, String(chunkId))
							.replace(/\[locale\]/g, locale)
							.replace(/\[hash\]/g, createHash("sha256").update(content).digest().slice(0, 16).toString("base64url"));

						compilation.emitAsset(name, new sources.OriginalSource(content, name));

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

				const requestChunkIds: number[][] = requests.map(([module, request]) => {
					const chunkIds = new Set<number>();
					for (const chunkGroup of chunkGroups) {
						if (chunkGroup.origins.some(o => o.module === module && o.request === request)) {
							entryChunkGroups.delete(chunkGroup);
							for (const chunk of chunkGroup.chunks) {
								const chunkId = globalChunkIds.alloc(chunk);
								if (localeChunkIds.has(chunkId)) {
									chunkIds.add(chunkId);
								}
							}
						}
					}
					return Array.from(chunkIds);
				});

				const entryChunkIds = new Set<number>();
				for (const chunkGroup of entryChunkGroups) {
					for (const chunk of chunkGroup.chunks) {
						const chunkId = globalChunkIds.alloc(chunk);
						if (localeChunkIds.has(chunkId)) {
							entryChunkIds.add(chunkId);
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
							compilation.updateAsset(file, source => {
								return new sources.ConcatSource(
									new sources.OriginalSource(manifestJs, file),
									source,
								);
							});
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
