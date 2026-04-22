/**
 * Shared test helpers for the sim module suite.
 *
 * The sim modules only touch `getDb()` from `../lib/firebase.js`. We stub
 * that out with an in-memory Firestore-shaped object and install it via
 * `mock.module()` before any sim module is imported.
 *
 * The fake supports exactly the subset of the Firestore Admin API the
 * sim modules actually call — don't over-build it.
 */
import { mock } from "bun:test";

/** A single stored document row — a plain object, cloned on read. */
type StoredDoc = Record<string, unknown>;

/** docs keyed by absolute path, e.g. "simulation/drchrono/patients/42". */
const store = new Map<string, StoredDoc>();

/** Deep clone via JSON; Timestamp has a valueOf so it survives fine for our
 *  shallow-equality assertions, but we keep the instance by using a
 *  structuredClone-compatible approach.
 */
function clone<T>(v: T): T {
  // structuredClone handles Timestamp objects (they're plain classes with
  // _seconds/_nanoseconds fields) well enough for read/write identity.
  return structuredClone(v);
}

interface WhereClause {
  field: string;
  op: FirebaseFirestore.WhereFilterOp;
  value: unknown;
}

interface OrderClause {
  field: string;
  dir: "asc" | "desc";
}

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  // Timestamp has seconds + nanoseconds; compare via seconds if present.
  const aTs = (a as any)?._seconds;
  const bTs = (b as any)?._seconds;
  if (typeof aTs === "number" && typeof bTs === "number") {
    if (aTs !== bTs) return aTs - bTs;
    return ((a as any)._nanoseconds ?? 0) - ((b as any)._nanoseconds ?? 0);
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Minimal collection/doc query ref. Not bound to a specific parent path to
 * keep the mental model flat — `_prefix` is the collection path.
 */
class FakeQuery {
  constructor(
    private prefix: string,
    private wheres: WhereClause[] = [],
    private orders: OrderClause[] = [],
    private _limit: number | null = null,
  ) {}

  where(field: string, op: FirebaseFirestore.WhereFilterOp, value: unknown): FakeQuery {
    return new FakeQuery(this.prefix, [...this.wheres, { field, op, value }], this.orders, this._limit);
  }

  orderBy(field: string, dir: "asc" | "desc" = "asc"): FakeQuery {
    return new FakeQuery(this.prefix, this.wheres, [...this.orders, { field, dir }], this._limit);
  }

  limit(n: number): FakeQuery {
    return new FakeQuery(this.prefix, this.wheres, this.orders, n);
  }

  async get(): Promise<{ docs: Array<{ id: string; data(): StoredDoc }> }> {
    const all: Array<{ id: string; data: StoredDoc }> = [];
    const matchPrefix = this.prefix.replace(/\/$/, "") + "/";
    for (const [path, data] of store.entries()) {
      if (!path.startsWith(matchPrefix)) continue;
      // Only direct children — no further slashes after the prefix.
      const tail = path.slice(matchPrefix.length);
      if (tail.includes("/")) continue;
      all.push({ id: tail, data });
    }
    const filtered = all.filter(({ data }) => {
      for (const w of this.wheres) {
        const v = (data as any)[w.field];
        if (w.op === "==") {
          if (v !== w.value) return false;
        } else {
          throw new Error(`FakeQuery: unsupported where op ${w.op}`);
        }
      }
      return true;
    });
    if (this.orders.length) {
      filtered.sort((a, b) => {
        for (const o of this.orders) {
          const r = cmp((a.data as any)[o.field], (b.data as any)[o.field]);
          if (r !== 0) return o.dir === "desc" ? -r : r;
        }
        return 0;
      });
    }
    const sliced = this._limit != null ? filtered.slice(0, this._limit) : filtered;
    return {
      docs: sliced.map(({ id, data }) => ({ id, data: () => clone(data) })),
    };
  }

  count(): { get(): Promise<{ data(): { count: number } }> } {
    const parent = this;
    return {
      async get() {
        // count() ignores limit but respects where.
        const q = new FakeQuery(parent.prefix, parent.wheres, [], null);
        const snap = await q.get();
        return { data: () => ({ count: snap.docs.length }) };
      },
    };
  }

  async add(data: StoredDoc): Promise<{ id: string }> {
    const id = `auto-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
    store.set(`${this.prefix}/${id}`, clone(data));
    return { id };
  }
}

function doc(path: string) {
  return {
    async get() {
      const data = store.get(path);
      return {
        exists: data !== undefined,
        data: () => (data === undefined ? undefined : clone(data)),
      };
    },
    async set(data: StoredDoc) {
      store.set(path, clone(data));
    },
    async update(partial: StoredDoc) {
      const existing = store.get(path);
      if (!existing) throw new Error(`update on missing doc: ${path}`);
      store.set(path, { ...existing, ...clone(partial) });
    },
  };
}

function collection(name: string): FakeQuery & {
  doc(id: string): ReturnType<typeof doc>;
  add(data: StoredDoc): Promise<{ id: string }>;
} {
  const q = new FakeQuery(name);
  return Object.assign(q, {
    doc: (id: string) => doc(`${name}/${id}`),
  }) as any;
}

/** The fake Firestore handle returned by getDb(). */
export const fakeDb = {
  collection,
  doc,
};

/** Reset the in-memory store between tests. */
export function resetStore(): void {
  store.clear();
}

/** Seed a document at an absolute path. */
export function seedDoc(path: string, data: StoredDoc): void {
  store.set(path, clone(data));
}

/** Raw access — useful when a test wants to assert what was written. */
export function readDoc(path: string): StoredDoc | undefined {
  const v = store.get(path);
  return v === undefined ? undefined : clone(v);
}

/** Install the fake getDb() globally. Call once at the top of every test file
 *  BEFORE importing any sim module. */
export function installFakeFirebase(): void {
  mock.module("../../lib/firebase.js", () => ({
    getDb: () => fakeDb,
  }));
}

/** Helper: make a Request with a JSON body (sim modules call request.clone().json()). */
export function jsonRequest(body: unknown, method = "POST"): Request {
  return new Request("http://test.local/", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A canonical patient fixture used by the EHR shim suite. */
export function seedDrchronoPatient(id: number, overrides: Partial<Record<string, unknown>> = {}): void {
  seedDoc(`simulation/drchrono/patients/${id}`, {
    id,
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    cell_phone: "+14155550100",
    date_of_birth: "1815-12-10",
    gender: "female",
    is_active: true,
    ...overrides,
  });
}
