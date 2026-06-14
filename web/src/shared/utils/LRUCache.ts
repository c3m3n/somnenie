export class LRUCache<K, V> {
  private readonly values = new Map<K, V>();

  constructor(private readonly limit: number) {
    if (!Number.isFinite(limit) || limit < 1) throw new Error("LRUCache limit must be positive");
  }

  get(key: K): V | undefined {
    if (!this.values.has(key)) return undefined;
    const value = this.values.get(key) as V;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  has(key: K): boolean {
    return this.values.has(key);
  }

  set(key: K, value: V): void {
    if (this.values.has(key)) this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.limit) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }

  clear(): void {
    this.values.clear();
  }
}
