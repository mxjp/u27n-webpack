/* eslint-disable camelcase */
import { Locale, LocaleData, U27N } from "@u27n/core/runtime";
import { env } from "@u27n/webpack/runtime/env";

import type { ChunkId } from "../types/webpack";

/** Set of current registered controllers. */
const controllers = new Set<U27N>();
/** Set of entry chunk ids and chunk ids that have been imported via dynamic import hooks. */
const activeChunkIds = new Set<ChunkId>(_u27nw_m[0]);
/** Set of callbacks to invoke when new active chunks have been added. */
const addActiveChunkIdHooks = new Set<(chunkId: ChunkId) => void>();
/** Map of module objects to sets of request ids that the module has been requested by. */
const moduleRequestIds = new WeakMap<object, Set<number>>();
/** Map of locale chunk names to fetched locale data. */
const localeChunkCache = new Map<string, Promise<LocaleData>>();
/** Map of locale objects to sets of locale chunk names that have been added. */
const addedLocaleChunkCache = new WeakMap<Locale, Set<string>>();

/**
 * Fetch a locale chunk with caching.
 *
 * Failed requests are automatically removed from the cache.
 */
function fetchLocaleChunk(name: string): Promise<LocaleData> {
	let promise = localeChunkCache.get(name);
	if (promise === undefined) {
		promise = env.fetchLocaleChunk(name).catch(error => {
			localeChunkCache.delete(name);
			throw error;
		});
		localeChunkCache.set(name, promise);
	}
	return promise;
}

/**
 * Load and add locale chunks to the specified locale object.
 */
function addLocaleChunks(locale: Locale, chunkIds: Iterable<ChunkId>): Promise<unknown> {
	const tasks: Promise<void>[] = [];
	for (const chunkId of chunkIds) {
		const name = _u27nw_m[2][chunkId]?.[locale.code];
		if (name !== undefined) {
			const addedChunkNames = addedLocaleChunkCache.get(locale);
			if (addedChunkNames === undefined) {
				addedLocaleChunkCache.set(locale, new Set([name]));
			} else if (addedChunkNames.has(name)) {
				continue;
			} else {
				addedChunkNames.add(name);
			}
			tasks.push(fetchLocaleChunk(name).then(localeData => locale.addData(localeData)));
		}
	}
	return tasks.length === 1
		? tasks[0]
		: Promise.all(tasks);
}

/**
 * The global client that is attached to registered controllers.
 */
const client: U27N.Client = {
	async fetchResources(controller: U27N, locale: Locale) {
		let additionalChunkIdQueue: ChunkId[] = [];
		const onAddActiveChunkId = (chunkId: ChunkId) => additionalChunkIdQueue.push(chunkId);
		addActiveChunkIdHooks.add(onAddActiveChunkId);
		try {
			await addLocaleChunks(locale, activeChunkIds);
			while (additionalChunkIdQueue.length > 0) {
				const chunkIds = additionalChunkIdQueue;
				additionalChunkIdQueue = [];
				await addLocaleChunks(locale, chunkIds);
			}
		} finally {
			addActiveChunkIdHooks.delete(onAddActiveChunkId);
		}
	},
};

globalThis._u27nw_i = <T extends object>(requestId: number, importPromise: Promise<T>): Promise<T> => {
	const chunkIds = _u27nw_m[1][requestId];
	if (chunkIds !== undefined) {
		const tasks: Promise<unknown>[] = [importPromise];
		for (const chunkId of chunkIds) {
			const activeChunkCount = activeChunkIds.size;
			activeChunkIds.add(chunkId);
			if (activeChunkIds.size > activeChunkCount) {
				addActiveChunkIdHooks.forEach(hook => hook(chunkId));
			}
		}
		for (const controller of controllers) {
			const locale = controller.locale;
			if (locale !== null) {
				tasks.push(addLocaleChunks(locale, chunkIds));
			}
		}
		return Promise.allSettled(tasks).then(results => {
			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				if (result.status === "rejected") {
					throw result.reason;
				}
			}
			const module = (results[0] as PromiseFulfilledResult<T>).value;
			const requestIds = moduleRequestIds.get(module);
			if (requestIds === undefined) {
				moduleRequestIds.set(module, new Set([requestId]));
			} else {
				requestIds.add(requestId);
			}
			return module;
		});
	}
	return importPromise;
};

/**
 * Register a controller for automatically loading locale data when needed.
 *
 * When a dynamic import is invoked, locale data that is needed for the imported modules
 * is loaded automatically before the import promise resolves.
 */
export function registerController(controller: U27N): void {
	controllers.add(controller);
	controller.clients.add(client);
}

/**
 * Unregister a controller.
 */
export function unregisterController(controller: U27N): void {
	controllers.delete(controller);
	controller.clients.delete(client);
}

/**
 * Forget a dynamically imported module.
 *
 * When the locale is changed, locale data for imported modules is loaded automaitcally.
 *
 * This function can be used to stop loading locale data for a module when it is sure that the
 * module is not needed until the dynamic import is invoked again.
 */
export function forgetModule<T extends object>(module: T): T {
	const requestIds = moduleRequestIds.get(module);
	if (requestIds !== undefined) {
		moduleRequestIds.delete(module);
		for (const requestId of requestIds) {
			const chunkIds = _u27nw_m[1][requestId];
			if (chunkIds !== undefined) {
				for (const chunkId of chunkIds) {
					activeChunkIds.delete(chunkId);
				}
			}
		}
	}
	return module;
}

/**
 * Clear the locale data cache.
 */
export function clearCache(): void {
	localeChunkCache.clear();
}
