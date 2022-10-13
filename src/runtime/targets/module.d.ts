
declare module "@u27n/webpack/runtime/target" {
	import { LocaleData } from "@u27n/core/runtime";

	export function fetchLocaleChunk(name: string): Promise<LocaleData>;
}
