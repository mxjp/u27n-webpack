import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { LocaleData } from "@u27n/core/runtime";

export async function fetchLocaleChunk(name: string): Promise<LocaleData> {
	return JSON.parse(await readFile(join(__dirname, name), "utf-8")) as LocaleData;
}
