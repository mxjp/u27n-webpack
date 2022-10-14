import { on } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TranslationData } from "@u27n/core";
import test from "ava";

import { createTestProject } from "./_test-project.js";
import { exec, execPipeline } from "./_utility/exec.js";
import { nodeBin, u27nCli, webpackCli } from "./_utility/paths.js";
import { createTempDir } from "./_utility/temp-dir.js";
import { touchSource } from "./_utility/touch-source.js";

function translation(value: TranslationData.Value): TranslationData.Translation {
	return {
		value,
		modified: new Date().toISOString(),
	};
}

test("watch mode", async t => {
	const cwd = await createTempDir(__filename, t);

	const testProject = await createTestProject({
		cwd,
		banner: true,
	});

	await exec({
		t,
		cwd,
		command: [nodeBin, u27nCli, "--modify", "--no-output"],
		silent: true,
		ignoreStatus: true,
	});

	const dataFilename = join(cwd, "u27n-data.json");
	const data = TranslationData.parseJson(await readFile(dataFilename, "utf-8"));
	data.fragments["0"].translations["de"] = translation("Hallo Welt!");
	data.fragments["a"].translations["de"] = translation("X");
	data.fragments["b"].translations["de"] = translation("Y");
	data.fragments["c"].translations["de"] = translation("Z");
	await writeFile(dataFilename, TranslationData.formatJson(data, true));

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

	t.is(stdout, testProject.expectedStdout);
	t.is(stderr, "");
});
