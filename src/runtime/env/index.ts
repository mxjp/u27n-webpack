import type { Env } from "@u27n/webpack/runtime/env";

export const env: Env = {
	fetchLocaleChunk() {
		throw new Error("U27n webpack runtime environment is not available");
	},
};
