import type { NormalModule } from "webpack";

interface ModuleRequestEntry {
	module: NormalModule;
	requestIds: Map<string, number>;
}

export class ModuleRequestMap {
	#entries = new Map<string, ModuleRequestEntry>();
	#nextId = 0;

	alloc(module: NormalModule, request: string): number {
		const resource = module.resource;
		const entry = this.#entries.get(resource);
		if (entry === undefined) {
			const newId = this.#nextId++;
			this.#entries.set(resource, {
				module,
				requestIds: new Map([[request, newId]]),
			});
			return newId;
		}
		const id = entry.requestIds.get(request);
		if (id === undefined) {
			const newId = this.#nextId++;
			entry.module = module;
			entry.requestIds.set(request, newId);
			return newId;
		}
		return id;
	}

	getRequestId(module: NormalModule, request: string): number | undefined {
		const entry = this.#entries.get(module.resource);
		if (entry !== undefined) {
			return entry.requestIds.get(request);
		}
		return undefined;
	}
}
