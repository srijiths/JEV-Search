/**
 * A tiny insertion-ordered LRU.
 *
 * Relies on `Map` preserving insertion order: a `get` that hits re-inserts the entry
 * to move it to the back, so the oldest key is always the first one `keys()` yields.
 * That is the whole implementation, and at the cache sizes here (hundreds of entries)
 * it is faster than anything with a linked list.
 *
 * Why a cache at all: typing "3 bedroom house" and then deleting back to "3 bedroom"
 * re-asks a question that was already answered. Backspacing is the single most common
 * editing move, so it is also the highest-value thing to cache.
 */
export class LRU<V> {
  #map = new Map<string, V>();

  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.#map.get(key);
    if (value === undefined) return undefined;
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.#map.has(key)) this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.max) {
      const oldest = this.#map.keys().next().value;
      if (oldest !== undefined) this.#map.delete(oldest);
    }
  }

  get size(): number {
    return this.#map.size;
  }

  clear(): void {
    this.#map.clear();
  }
}

/**
 * Cache key for a query. Case and surrounding whitespace never change the answer, so
 * "3 BED" and "3 bed " share an entry. Internal spacing is collapsed for the same
 * reason. Nothing else is normalised — punctuation carries meaning here ("2br/2ba").
 */
export const normalizeKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
