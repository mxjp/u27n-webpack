/* eslint-disable camelcase */
import { FetchClient, Locale, LocaleData, U27N } from "@u27n/core/runtime";

let currentController: U27N | null = null;

declare const __webpack_public_path__: string;

const cache = new Set<string>();
const pending = new Map<string, Promise<void>>();
const requested = new Set<number>();
const moduleRequestMap = new WeakMap<object, Set<number>>();

function fetchChunk(tasks: Promise<unknown>[], chunkId: number, locale: Locale): void {
	const key = JSON.stringify([chunkId, locale.code]);
	if (cache.has(key)) {
		return;
	}

	const file = __u27n_m__[2][chunkId]?.[locale.code];
	if (file === undefined) {
		return;
	}

	let task = pending.get(key);
	if (!task) {
		task = (async () => {
			try {
				const response = await fetch(__webpack_public_path__ + file);
				if (response.ok) {
					locale.addData(await response.json() as LocaleData);
					cache.add(key);
				} else {
					throw new FetchClient.RequestError(response);
				}
			} finally {
				pending.delete(key);
			}
		})();
		pending.set(key, task);
	}
	tasks.push(task);
}

async function wait(tasks: Promise<unknown>[]) {
	const results = await Promise.allSettled(tasks);
	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		if (result.status === "rejected") {
			throw result.reason;
		}
	}
	return results;
}

const client: U27N.Client = {
	async fetchResources(controller: U27N, locale: Locale) {
		if (controller !== currentController) {
			throw new Error("wrong controller instance");
		}

		const tasks: Promise<void>[] = [];

		__u27n_m__[0].forEach(chunkId => fetchChunk(tasks, chunkId, locale));
		requested.forEach(request => {
			__u27n_m__[1][request].forEach(chunkId => fetchChunk(tasks, chunkId, locale));
		});

		await wait(tasks);
	},
};

window.__u27n_i__ = async (requestIndex, importPromise) => {
	type T = typeof importPromise extends Promise<infer T> ? T : never;

	requested.add(requestIndex);

	const tasks: Promise<unknown>[] = [importPromise];

	const locale = currentController?.locale;
	if (locale) {
		__u27n_m__[1][requestIndex]?.forEach(chunkId => fetchChunk(tasks, chunkId, locale));
	}

	const results = await wait(tasks);
	const module = (results[0] as PromiseFulfilledResult<T>).value;

	const moduleRequests = moduleRequestMap.get(module);
	if (moduleRequests === undefined) {
		moduleRequestMap.set(module, new Set([requestIndex]));
	} else {
		moduleRequests.add(requestIndex);
	}

	return module;
};

/**
 * Set the U27N controller to use.
 *
 * This will attach a client to the controller and use that
 * controller when loading locale data for dynamic imports.
 */
export function setController(controller: U27N): void {
	currentController?.clients.delete(client);
	currentController = controller;
	currentController.clients.add(client);
}

/**
 * After a dynamic import, the U27N controller will automatically
 * load locale data for all imported modules when the locale changes.
 *
 * This function can be called to disable automatic locale data loading
 * for this specific import.
 *
 * @example
 * ```ts
 * const myModule = await import("./some-module");
 *
 * // When myModule is no longer needed later:
 * forgetImport(myModule);
 * ```
 */
export function forgetImport<T extends object>(exports: T): T {
	moduleRequestMap.get(exports)?.forEach(requestIndex => requested.delete(requestIndex));
	return exports;
}
