import { on } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DataAdapter } from "@u27n/core";
import { DataJson } from "@u27n/core/default-data-adapter";
import test, { ExecutionContext } from "ava";

import { createTestProject } from "./_test-project.js";
import { exec, execPipeline } from "./_utility/exec.js";
import { nodeBin, u27nCli, webpackCli } from "./_utility/paths.js";
import { createTempDir } from "./_utility/temp-dir.js";
import { touchSource } from "./_utility/touch-source.js";

async function createTranslationData(t: ExecutionContext, cwd: string, fragments: Record<string, DataAdapter.Value>) {
	await exec({
		t,
		cwd,
		command: [nodeBin, u27nCli, "--modify", "--no-output"],
		silent: true,
		ignoreStatus: true,
	});

	const dataFilename = join(cwd, "u27n-data.json");

	const data = JSON.parse(await readFile(dataFilename, "utf-8")) as DataJson;
	for (const id in fragments) {
		data.fragments[id].translations["de"] = {
			value: fragments[id],
			modified: new Date().toISOString(),
		};
	}
	await writeFile(dataFilename, JSON.stringify(data, null, "\t") + "\n");
}

test.serial("watch mode", async t => {
	const cwd = await createTempDir(__filename, t);

	await createTestProject({
		cwd,
		banner: true,
		src: {
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

	await createTranslationData(t, cwd, {
		0: "Hallo Welt!",
		a: "X",
		b: "Y",
		c: "Z",
	});

	await execPipeline({
		t,
		cwd,
		command: [nodeBin, webpackCli, "--watch"],
		ignoreStatus: true,
	}, async events => {
		async function checkBanner() {
			const mainChunk = await readFile(join(cwd, "dist/index.js"), "utf-8");
			const testBannerIndex = mainChunk.indexOf(`/* u27n-test-banner */`);
			t.true(testBannerIndex >= 0, "test banner is not present in main chunk");
			const manifestIndex = mainChunk.indexOf(`_u27nw_m=`);
			t.true(manifestIndex >= 0, "mainfest is not present in main chunk");
			t.true(manifestIndex > testBannerIndex, "manifest was injected before banner plugin");
		}

		await on(events, "done").next();
		await checkBanner();

		await touchSource(join(cwd, "src/module-c.ts"));
		await on(events, "done").next();
		await checkBanner();

		await touchSource(join(cwd, "src/index.ts"));
		await on(events, "done").next();
		await checkBanner();
	});

	const { stdout, stderr } = await exec({
		t,
		cwd,
		silent: true,
		command: [nodeBin, "dist"],
	});

	t.is(stdout, [
		"A",
		"AB",
		"Hallo Welt!",
		"X",
		"XY",
		"XYZ",
		"ABC",
	].map(l => l + "\n").join(""));
	t.is(stderr, "");
});

test.serial("concurrent set locale / dynamic import edge case", async t => {
	const cwd = await createTempDir(__filename, t);

	await createTestProject({
		cwd,
		banner: true,
		src: {
			"index.ts": `
				import assert from "node:assert/strict";
				import { u27n, t } from "./u27n";

				await u27n.setLocale("en");

				function foo() {
					console.log(t("A", "a"));
				}

				const setLocalePromise = u27n.setLocale("de");
				foo();

				const module = await import("./module");

				await setLocalePromise;
				foo();
				module.bar();
			`,
			"module.ts": `
				import { t } from "./u27n";

				export function bar() {
					console.log(t("B", "b"));
				}
			`,
		},
	});

	await createTranslationData(t, cwd, {
		a: "X",
		b: "Y",
	});

	await exec({
		t,
		cwd,
		command: [nodeBin, webpackCli],
	});

	const { stdout, stderr } = await exec({
		t,
		cwd,
		silent: true,
		command: [nodeBin, "dist"],
	});

	t.is(stdout, [
		"A",
		"X",
		"Y",
	].map(l => l + "\n").join(""));
	t.is(stderr, "");
});
