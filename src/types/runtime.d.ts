type ChunkId = import("./webpack.js").ChunkId;

declare type U27nRuntimeManifest = [
	/** Array of chunk ids that must be loaded initially. */
	entryChunkIds: ChunkId[],
	/** Sparse array that maps request ids (as index) to chunk ids. */
	requests: Partial<ChunkId[][]>,
	/** Map from chunk ids to locales to locale data filenames. */
	localeChunks: Record<ChunkId, Record<string, string | undefined>>,
];

declare type U27nImportHookCallback<T extends object = object> = (requestId: number, importPromise: Promise<T>) => Promise<T>;

/**
 * The global import hook callback.
 *
 * This is initialized when the u27n runtime library is loaded and is required
 * before any dynamic imports are invoked.
 */
// eslint-disable-next-line no-var
declare var _u27nw_i: U27nImportHookCallback;

/**
 * The global runtime manifest.
 *
 * This is initialized when an entry chunk is loaded.
 */
// eslint-disable-next-line no-var
declare var _u27nw_m: U27nRuntimeManifest;
