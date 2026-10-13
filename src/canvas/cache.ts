type Entry<T> = { value: T; expires: number };

/** Short in-memory cache so live Canvas tools stay fresh without hammering the API. */
export class TtlCache {
  private readonly map = new Map<string, Entry<unknown>>();

  constructor(private readonly ttlMs: number = 30_000) {}

  get<T>(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) {
      return undefined;
    }
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set<T>(key: string, value: T): T {
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    return value;
  }

  async getOrSet<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) {
      return hit;
    }
    const value = await load();
    return this.set(key, value);
  }
}
