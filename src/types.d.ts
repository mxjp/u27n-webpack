/* eslint-disable camelcase */
/* eslint-disable no-var */

declare type U27nRuntimeManifest = [
	/** Array of chunk ids that are never requested. */
	entryChunkIds: (string | number)[],
	/** Array of chunk ids by request index. */
	requests: (string | number)[][],
	/** Map chunk ids to locales to locale data resources. */
	localeChunks: Record<string | number, Record<string, string>>,
];

declare var __u27n_i__: <T extends object>(requestIndex: number, importPromise: Promise<T>) => Promise<T>;

declare const __u27n_m__: U27nRuntimeManifest;
