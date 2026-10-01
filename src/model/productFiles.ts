/**
 * Bytes of files attached to product requests (#34), kept in this browser's IndexedDB. The
 * library document in localStorage holds each attachment's name, kind and extracted page
 * text; the file itself is too large for localStorage, so it lives here under the same id.
 * Nothing leaves the browser.
 */

export interface FileStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
  remove(id: string): Promise<void>;
}

const DB_NAME = "alza.products.files";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB is not available."));
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      // a full disk surfaces as a QuotaExceededError on the transaction, not the request
      tx.onabort = tx.onerror = () => reject(tx.error ?? req.error ?? new Error("Browser storage refused the file."));
    });
  } finally {
    db.close();
  }
}

export const indexedDbFiles: FileStore = {
  async put(id, blob) { await run("readwrite", (s) => s.put(blob, id)); },
  async get(id) { return ((await run("readonly", (s) => s.get(id))) as Blob | undefined) ?? null; },
  async remove(id) { await run("readwrite", (s) => s.delete(id)); },
};

/** For tests and browsers without IndexedDB: kept in memory, gone on reload. */
export function memoryFiles(): FileStore {
  const m = new Map<string, Blob>();
  return {
    async put(id, blob) { m.set(id, blob); },
    async get(id) { return m.get(id) ?? null; },
    async remove(id) { m.delete(id); },
  };
}
