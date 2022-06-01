
export class WeakIdAllocator<T extends object> {
	#next = 0;
	readonly #map = new WeakMap<T, number>();

	public alloc(value: T): number {
		let id = this.#map.get(value);
		if (id === undefined) {
			id = this.#next++;
			this.#map.set(value, id);
		}
		return id;
	}
}
