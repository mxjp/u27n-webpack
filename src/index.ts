import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";

import { Config, Diagnostic, getDiagnosticLocations, getDiagnosticMessage, getDiagnosticSeverity, NodeFileSystem, Project, Source, TranslationData, TranslationDataView } from "@u27n/core";
import { LocaleData } from "@u27n/core/runtime";
import { ImportExpression } from "estree";
import { walk } from "estree-walker";
import { Chunk, Compiler, javascript, NormalModule } from "webpack";

import { ModuleRequestMap } from "./module-request-map.js";
import { RuntimeManifestCompiler } from "./runtime-manifest-compiler.js";
import type { ChunkGroup, ChunkId } from "./types/webpack.js";

const envRoot = join(__dirname, "runtime/env");

export class U27nPlugin {
	/**
	 * Uses `fetch` to request locale chunks relative to webpack's public path.
	 */
	static ENV_FETCH = join(envRoot, "fetch.js");

	/**
	 * Uses `node:fs/promises` to read locale chunks from disk.
	 */
	static ENV_NODE = join(envRoot, "node.js");

	#options: U27nPlugin.Options;

	constructor(options: U27nPlugin.Options = {}) {
		this.#options = options;
	}

	apply(compiler: Compiler): void {
		const options = this.#options;
		const { webpack } = compiler;

		const env = options.env ?? U27nPlugin.ENV_FETCH;
		if (typeof env !== "string" || !isAbsolute(env)) {
			throw new Error(`options.env must be an absolute path.`);
		}

		new webpack.NormalModuleReplacementPlugin(/^@u27n\/webpack\/runtime\/env$/, env).apply(compiler);

		const logger = compiler.getInfrastructureLogger(U27nPlugin.name);
		const logFile = (filename: string) => relative(process.cwd(), filename);

		const outputTemplate = this.#options.output ?? (compiler.options.mode === "production" ? "locale/[hash].json" : "locale/[chunk]-[locale].json");
		if (typeof outputTemplate !== "string" || !(outputTemplate.includes("[hash]") || (outputTemplate.includes("[chunk]") && outputTemplate.includes("[locale]")))) {
			throw new TypeError(`options.output must include either "[hash]" or both "[chunk]" ans "[locale]".`);
		}

		const projects: Project[] = [];

		let projectsPromise: Promise<void> | null = null;
		const ensureProjects = () => projectsPromise ??= (async () => {
			const fileSystem = new NodeFileSystem();
			for (const path of typeof options.config === "string" ? [options.config] : (options.config ?? ["./u27n.json"])) {
				const configFilename = resolve(compiler.context, path);
				logger.log("Loading project:", logFile(configFilename));
				const config = await Config.read(configFilename);
				projects.push(await Project.create({ config, fileSystem }));
			}
		})();

		const emitDiagnostics = (project: Project, diagnostics: Diagnostic[]) => {
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

		compiler.hooks.run.tapPromise(U27nPlugin.name, async () => {
			await ensureProjects();
			logger.log("Running projects");
			for (const project of projects) {
				const result = await project.run({
					fragmentDiagnostics: true,
					modify: options.modify ?? false,
					output: false,
				});
				emitDiagnostics(project, result.diagnostics);
			}
		});

		let watching = false;
		const watcherCloseFns: (() => Promise<void>)[] = [];
		compiler.hooks.watchRun.tapPromise(U27nPlugin.name, async () => {
			await ensureProjects();
			if (!watching) {
				watching = true;
				logger.log("Watching projects");
				const initialRuns: Promise<void>[] = [];
				let isInitial = true;
				for (const project of projects) {
					initialRuns.push(new Promise(finish => {
						watcherCloseFns.push(project.watch({
							fragmentDiagnostics: true,
							modify: options.modify ?? true,
							output: false,
							delay: options.delay ?? 100,
							onFinish: async ({ diagnostics, translationDataChanged }) => {
								emitDiagnostics(project, diagnostics);
								if (translationDataChanged && !isInitial) {
									logger.log("Translation data changed:", logFile(project.config.translationData.filename));
									compiler.watching?.invalidate();
								}
								finish();
							},
							onError: error => {
								logger.error(error);
								finish();
							},
						}));
					}));
				}
				await Promise.all(initialRuns);
				isInitial = false;
			}
		});

		compiler.hooks.watchClose.tap(U27nPlugin.name, () => {
			logger.log("Closing projects");
			for (const close of watcherCloseFns) {
				close().catch(error => {
					logger.error(error);
				});
			}
			watcherCloseFns.length = 0;
			watching = false;
		});

		const moduleRequests = new ModuleRequestMap();
		const manifestCompiler = new RuntimeManifestCompiler();

		const currentModules = new Map<NormalModule, Chunk[]>();
		const currentChunkGroups = new Set<ChunkGroup>();

		/** Map: chunk id => locale => locale data */
		const output = new Map<ChunkId, Map<string, LocaleData>>();

		compiler.hooks.compile.tap(U27nPlugin.name, _compilation => {
			logger.log("Clearing cache");
			currentModules.clear();
			currentChunkGroups.clear();
		});

		compiler.hooks.compilation.tap(U27nPlugin.name, (compilation, { normalModuleFactory }) => {
			for (const type of [
				"javascript/auto",
				"javascript/dynamic",
				"javascript/esm",
			]) {
				normalModuleFactory.hooks.parser.for(type).tap(U27nPlugin.name, (parser: javascript.JavascriptParser) => {
					parser.hooks.program.tap(U27nPlugin.name, ast => {
						const { module } = parser.state;
						if (module instanceof webpack.NormalModule) {
							walk(ast, {
								enter(node) {
									if (node.type === "ImportExpression") {
										const expression = node as ImportExpression;
										if (expression.source.type === "Literal" && typeof expression.source.value === "string") {
											const moduleRequestId = moduleRequests.alloc(module, expression.source.value);
											module.addDependency(new webpack.dependencies.ConstDependency(`_u27nw_i(${moduleRequestId},`, expression.range![0]));
											module.addDependency(new webpack.dependencies.ConstDependency(`)`, expression.range![1]));
										}
									}
								},
							});
						}
					});
				});
			}

			compilation.hooks.afterOptimizeTree.tap(U27nPlugin.name, (_chunks, modules) => {
				logger.log("Capturing tree");
				for (const module of modules) {
					if (module instanceof webpack.NormalModule) {
						currentModules.set(module, compilation.chunkGraph.getModuleChunks(module));
					}
				}
				for (const chunkGroup of compilation.chunkGroups) {
					currentChunkGroups.add(chunkGroup);
				}
			});
		});

		compiler.hooks.thisCompilation.tap(U27nPlugin.name, compilation => {
			compilation.hooks.processAssets.tapPromise({ name: U27nPlugin.name, stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS, before: "BannerPlugin" }, async () => {
				logger.log("Compiling locales");

				modules: for (const [module, chunks] of currentModules) {
					const chunkIds = getChunkIds(chunks);
					const filename = module.resource;
					for (const project of projects) {
						const includeOutdated = project.config.output.includeOutdated;
						const data = project.dataProcessor.translationData;

						const sourceId = Source.filenameToSourceId(project.config.context, filename);
						const source = project.dataProcessor.getSource(sourceId);
						if (source) {
							for (const fragment of source.fragments) {
								if (fragment.fragmentId !== undefined) {
									const fragmentData = data.fragments[fragment.fragmentId];
									if (fragmentData) {
										const fragmentModified = TranslationDataView.parseTimestamp(fragmentData.modified);
										for (const locale in fragmentData.translations) {
											const translation = fragmentData.translations[locale];
											if (
												TranslationDataView.valueTypeEquals(fragmentData.value, translation.value)
												&& (includeOutdated || !TranslationDataView.isOutdated(fragmentModified, translation))
											) {
												// TODO: Optimize this with caches:
												for (const chunkId of chunkIds) {
													let chunkOutput = output.get(chunkId);
													if (chunkOutput === undefined) {
														chunkOutput = new Map();
														output.set(chunkId, chunkOutput);
													}
													let localeOutput = chunkOutput.get(locale);
													if (localeOutput === undefined) {
														localeOutput = Object.create(null) as {};
														chunkOutput.set(locale, localeOutput);
													}
													let namespaceOutput = localeOutput[project.config.namespace];
													if (namespaceOutput === undefined) {
														namespaceOutput = Object.create(null) as {};
														localeOutput[project.config.namespace] = namespaceOutput;
													}
													namespaceOutput[fragment.fragmentId] = TranslationData.toRawValue(translation.value);
												}
											}
										}
									}
								}
							}
							continue modules;
						}
					}

					// TODO: Resolve manifest by dirname.
					// TODO: If resolved, add data from manifest to output.
				}

				manifestCompiler.clearLocaleChunks();
				for (const [chunkId, chunkOutput] of output) {
					for (const [locale, localeOutput] of chunkOutput) {
						const content = JSON.stringify(localeOutput);
						const name = outputTemplate
							.replace("[chunk]", String(chunkId))
							.replace("[locale]", locale)
							.replace("[hash]", () => createHash("sha256").update(content).digest().subarray(0, 16).toString("base64url"));

						compilation.emitAsset(name, new webpack.sources.OriginalSource(content, name));
						manifestCompiler.addLocaleChunkAsset(chunkId, locale, name);
					}
				}

				manifestCompiler.clearEntryChunkIds();
				for (const chunkGroup of currentChunkGroups) {
					let isEntry = false;
					for (const origin of chunkGroup.origins) {
						if (origin.module instanceof NormalModule) {
							const requestId = moduleRequests.getRequestId(origin.module, origin.request);
							if (requestId !== undefined) {
								manifestCompiler.addRequestChunkIds(requestId, getChunkIds(chunkGroup.chunks));
							}
						} else if (!origin.module && !isEntry) {
							isEntry = true;
							for (const chunk of chunkGroup.chunks) {
								if (chunk.id !== null) {
									manifestCompiler.addEntryChunkId(chunk.id);
								}
							}
						}
					}
				}

				// TODO: Also inject manifest into HMR chunks.
				const manifestJs = manifestCompiler.compile();
				for (const chunk of compilation.chunks) {
					if (chunk.canBeInitial()) {
						for (const file of chunk.files) {
							if (/\.[cm]?js$/.test(file)) {
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
		/**
		 * Filename of one or more u27n configs.
		 *
		 * This can be relative to the webpack context.
		 *
		 * @default "./u27n.json"
		 */
		config?: string | string[];

		/**
		 * Absolute path to the environment implementation module.
		 *
		 * @default {@link U27nPlugin.ENV_FETCH}
		 */
		env?: string;

		/**
		 * Enable or disable updating source files.
		 *
		 * This copies the behavior of the CLI `--modify` argument.
		 */
		modify?: boolean;

		/**
		 * Time to wait in milliseconds after changes on disk are detected.
		 *
		 * This copies the behavior of the CLI `--delay` argument.
		 */
		delay?: number;

		/**
		 * The filename template to output compiled locale data.
		 *
		 * The following placeholders are supported:
		 * + `[hash]` - The content hash.
		 * + `[chunk]` - The chunk id.
		 * + `[locale]` - The locale code.
		 *
		 * @default webpack.mode === "production" ? "locale/[hash].json" : "locale/[chunk]-[locale].json"
		 */
		output?: string;
	}
}

function getChunkIds(chunks: Chunk[]): ChunkId[] {
	return chunks.map(chunk => chunk.id).filter(id => id !== null) as ChunkId[];
}
