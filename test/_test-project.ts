import { join, relative } from "node:path";

import { packageRoot, testSrcRoot } from "./_utility/paths.js";
import { createFsLayout } from "./_utility/temp-dir.js";

function unixPath(value: string) {
	return value.replace(/\\/g, "/");
}

export async function createTestProject(options: {
	cwd: string;
	banner?: boolean;
}): Promise<{ expectedStdout: string }> {
	const str = (value: string) => JSON.stringify(value);
	const rootToCwd = relative(packageRoot, options.cwd);
	const cwdToSrc = relative(options.cwd, testSrcRoot);

	await createFsLayout(options.cwd, {
		"webpack.config.js": `
			const webpack = require("webpack");
			const { join } = require("path");
			const { U27nPlugin } = require(${str(cwdToSrc)});

			module.exports = (env = {}) => {
				const prod = env.prod ?? false;
				return {
					target: "node",
					devtool: prod ? false : "inline-source-map",
					context: ${str(packageRoot)},
					mode: prod ? "production" : "development",
					entry: ${str("./" + join(rootToCwd, "src"))},
					plugins: [
						compiler => compiler.hooks.done.tap("events", () => {
							process.send({ type: "done" });
						}),
						new U27nPlugin({
							config: ${str(join(rootToCwd, "u27n.json"))},
							env: U27nPlugin.ENV_NODE,
						}),
						${options.banner ? `new webpack.BannerPlugin({
							banner: "/* u27n-test-banner */",
							raw: true,
						}),` : ""}
					],
					resolve: {
						extensions: [".ts", ".tsx", ".mjs", ".js", ".cjs", ".json"],
					},
					output: {
						path: join(__dirname, "dist"),
						filename: "index.js",
						chunkFilename: "[name].js",
					},
					experiments: {
						topLevelAwait: true,
					},
					stats: "errors-only",
					infrastructureLogging: {
						level: "verbose",
					},
				};
			};
		`,
		"u27n.json": `
			{
				"namespace": "webpack-test",
				"locales": ["en", "de"],
				"plugins": ["@u27n/typescript"]
			}
		`,
		"tsconfig.json": `
			{
				"compilerOptions": {
					"target": "ESNext",
					"module": "ESNext",
					"moduleResolution": "Node",
					"sourceMap": true
				},
				"include": [
					"./src"
				]
			}
		`,
		"src": {
			"u27n.ts": `
				import { U27N, Context, defaultLocaleFactory } from "@u27n/core/runtime";
				import { registerController } from ${str(unixPath(join("..", cwdToSrc, "runtime")))};

				export const u27n = new U27N({
					localeFactory: defaultLocaleFactory,
				});

				registerController(u27n);

				const context = new Context(u27n, "webpack-test", "en");

				export const t = context.t;
			`,
			"index.ts": `
				import assert from "node:assert/strict";
				import { u27n, t } from "./u27n";

				await u27n.setLocale("en");
				console.log((await import("./module-a")).run());
				console.log((await import("./module-b")).run());

				assert.equal(u27n.getLocale("de"), undefined);
				await u27n.setLocale("de");

				const deLocale = u27n.getLocale("de");
				assert.equal(deLocale.data["webpack-test"].c, undefined);

				console.log(t("Hello World!", "0"));
				console.log((await import("./module-a")).run());
				console.log((await import("./module-b")).run());

				assert.equal(deLocale.data["webpack-test"].c, undefined);
				console.log(await (await import("./module-c")).run());
				assert.equal(deLocale.data["webpack-test"].c, "Z");

				await u27n.setLocale("en");
				console.log(await (await import("./module-c")).run());
			`,
			"module-a.ts": `
				import { t } from "./u27n";

				export function run() {
					return t("A", "a");
				}
			`,
			"module-b.ts": `
				import { t } from "./u27n";
				import * as moduleA from "./module-a";

				export function run() {
					return moduleA.run() + t("B", "b");
				}
			`,
			"module-c.ts": `
				import { t } from "./u27n";

				export async function run() {
					return (await import("./module-b")).run() + t("C", "c");
				}
			`,
		},
	});

	return {
		expectedStdout: [
			"A",
			"AB",
			"Hallo Welt!",
			"X",
			"XY",
			"XYZ",
			"ABC",
		].map(l => l + "\n").join(""),
	};
}
