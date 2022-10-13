import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { LocaleData } from "@u27n/core/runtime";
import type { Env } from "@u27n/webpack/runtime/env";

export const env: Env = {
	async fetchLocaleChunk(name: string): Promise<LocaleData> {
		return JSON.parse(await readFile(join(__dirname, name), "utf-8")) as LocaleData;
	},
};
