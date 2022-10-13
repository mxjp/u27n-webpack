import { readFile, writeFile } from "node:fs/promises";

export async function touchSource(filename: string): Promise<void> {
	let content = await readFile(filename, "utf-8");
	const match = /\/\/ UPDATE (\d+)\n/.exec(content);
	if (match) {
		content = `${content.slice(0, match.index)}// UPDATE ${parseInt(match[1] + 1)}\n${content.slice(match.index + match[0].length)}`;
	} else {
		content += `\n// UPDATE 0\n`;
	}
	await writeFile(filename, content);
}
