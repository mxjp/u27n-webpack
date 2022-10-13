import escape from "js-string-escape";

import type { ChunkId } from "./types/webpack.js";

const SAFE_PROPERTY = /^([a-zA-Z_$][a-zA-Z0-9_$]*|0|[1-9][0-9]*)$/;

function formatProperty(value: unknown): string {
	const raw = String(value);
	if (SAFE_PROPERTY.test(raw)) {
		return raw;
	}
	return `"${escape(raw)}"`;
}

function formatChunkId(value: ChunkId): string {
	return typeof value === "number"
		? String(value)
		: `"${escape(value)}"`;
}

export class RuntimeManifestCompiler {
	#entryChunkIds = new Set<ChunkId>();
	#requests: Partial<Set<ChunkId>[]> = [];
	#localeChunks = new Map<ChunkId, Map<string, string>>();

	clearEntryChunkIds(): void {
		this.#entryChunkIds.clear();
	}

	addEntryChunkId(chunkId: ChunkId): void {
		this.#entryChunkIds.add(chunkId);
	}

	addRequestChunkIds(requestId: number, chunkIds: ChunkId[]): void {
		const set = this.#requests[requestId];
		if (set === undefined) {
			this.#requests[requestId] = new Set(chunkIds);
		} else {
			for (let i = 0; i < chunkIds.length; i++) {
				set.add(chunkIds[i]);
			}
		}
	}

	clearLocaleChunks(): void {
		this.#localeChunks.clear();
	}

	addLocaleChunkAsset(chunkId: ChunkId, locale: string, name: string): void {
		let localeChunk = this.#localeChunks.get(chunkId);
		if (!localeChunk) {
			localeChunk = new Map();
			this.#localeChunks.set(chunkId, localeChunk);
		}
		localeChunk.set(locale, name);
	}

	compile(): string {
		return `;globalThis._u27nw_m=[[${
			Array
				.from(this.#entryChunkIds)
				.map(formatChunkId)
				.join(",")
		}],[${
			Array.from(this.#requests)
				.map(chunkIds => {
					if (chunkIds === undefined || chunkIds.size === 0) {
						return "";
					}
					const nonEntryChunkIds: string[] = [];
					for (const chunkId of chunkIds) {
						if (!this.#entryChunkIds.has(chunkId)) {
							nonEntryChunkIds.push(formatChunkId(chunkId));
						}
					}
					return `[${nonEntryChunkIds.join(",")}]`;
				})
				.join(",")
		}],{${
			Array
				.from(this.#localeChunks)
				.map(([chunkId, localeChunk]) => {
					return `${formatProperty(chunkId)}:{${
						Array
							.from(localeChunk)
							.map(([locale, name]) => {
								return `${formatProperty(locale)}:"${escape(name)}"`;
							})
							.join(",")
					}}`;
				})
				.join(",")
		}}];`;
	}
}
