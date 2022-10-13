import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { ExecutionContext } from "ava";

import { testDataRoot, testRoot } from "./paths.js";
import { unindent } from "./unindent.js";

export async function createTempDir(moduleFilename: string, t: ExecutionContext): Promise<string> {
	moduleFilename = relative(testRoot, moduleFilename)
		.replace(/\.js$/g, "")
		.replace(/[^a-z0-9]+/ig, "-");

	const title = t.title
		.replace(/[^a-z0-9]+/ig, "-")
		.replace(/^-+|-+$/g, "");

	const name = `${moduleFilename}.${title}`;
	const dirname = join(testDataRoot, name);
	await rm(dirname, { recursive: true, force: true });
	await mkdir(dirname, { recursive: true });
	return dirname;
}

export async function createFsLayout(dirname: string, content: FsLayout): Promise<void> {
	await (async function write(filename: string, content: string | FsLayout) {
		if (typeof content === "string") {
			await writeFile(filename, unindent(content));
		} else {
			await mkdir(filename, { recursive: true });
			for (const name in content) {
				await write(join(filename, name), content[name]);
			}
		}
	})(dirname, content);
}

export interface FsLayout {
	[key: string]: string | FsLayout;
}
