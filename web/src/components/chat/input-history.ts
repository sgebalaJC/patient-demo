const MAX = 50;
const STORAGE_PREFIX = 'chat-input-history:';

export class InputHistory {
  private items: string[] = [];
  private cursor = -1;
  private storageKey: string | null;

  constructor(storageKey?: string) {
    this.storageKey = storageKey ? STORAGE_PREFIX + storageKey : null;
    this.load();
  }

  private load(): void {
    if (!this.storageKey || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed.filter((x): x is string => typeof x === 'string').slice(-MAX);
        }
      }
    } catch {
      // ignore corrupt storage
    }
  }

  private save(): void {
    if (!this.storageKey || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.items));
    } catch {
      // ignore quota errors
    }
  }

  push(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.items[this.items.length - 1] === trimmed) return;
    this.items.push(trimmed);
    if (this.items.length > MAX) this.items.shift();
    this.cursor = -1;
    this.save();
  }

  up(): string | null {
    if (this.items.length === 0) return null;
    if (this.cursor < 0) {
      this.cursor = this.items.length - 1;
    } else if (this.cursor > 0) {
      this.cursor--;
    }
    return this.items[this.cursor] ?? null;
  }

  down(): string | null {
    if (this.cursor < 0) return null;
    this.cursor++;
    if (this.cursor >= this.items.length) {
      this.cursor = -1;
      return null;
    }
    return this.items[this.cursor] ?? null;
  }

  reset(): void {
    this.cursor = -1;
  }

  /** Replace history with a chronological list of past messages (oldest first). */
  replace(items: string[]): void {
    const cleaned: string[] = [];
    for (const it of items) {
      const trimmed = it.trim();
      if (!trimmed) continue;
      if (cleaned[cleaned.length - 1] === trimmed) continue;
      cleaned.push(trimmed);
    }
    this.items = cleaned.slice(-MAX);
    this.cursor = -1;
    this.save();
  }
}

const cache = new Map<string, InputHistory>();

export function getInputHistory(key: string): InputHistory {
  let h = cache.get(key);
  if (!h) {
    h = new InputHistory(key);
    cache.set(key, h);
  }
  return h;
}
