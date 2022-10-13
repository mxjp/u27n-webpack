import { LocaleData } from "@u27n/core/runtime";
import { Env } from "@u27n/webpack/runtime/env";

declare const __webpack_public_path__: string;

export const env: Env = {
	async fetchLocaleChunk(name: string): Promise<LocaleData> {
		const response = await fetch(__webpack_public_path__ + name);
		if (response.ok) {
			return response.json() as Promise<LocaleData>;
		}
		throw new Error(`failed to fetch locale chunk: ${JSON.stringify(name)}`);
	},
};
