
declare module "@u27n/webpack/runtime/env" {
	import type { LocaleData } from "@u27n/core/runtime";

	export interface Env {
		/**
		 * Called to load a locale chunk.
		 *
		 * @param name The locale chunk name that is derived from the output template specified in the plugin configuration. E.g. `"locale/main-de.json"`
		 */
		fetchLocaleChunk(name: string): Promise<LocaleData>;
	}

	export const env: Env;
}
