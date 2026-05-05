export interface Cache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class MemoryCache<V> implements Cache<V> {
  private readonly store = new Map<string, Entry<V>>();

  constructor(private readonly ttlMs: number) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('MemoryCache ttlMs must be a positive number');
    }
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
