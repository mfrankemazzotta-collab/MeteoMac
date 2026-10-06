// Caché de respuestas en IndexedDB (sin dependencias).
// Si el navegador no lo permite (modo privado, almacenamiento bloqueado), todo sigue
// funcionando sin caché: cada error se traga y se consulta la API normalmente.

const DB_NAME = "meteomac";
const STORE = "responses";

interface Entry<T> {
  savedAt: number;
  value: T;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Devuelve el valor guardado si tiene menos de `maxAgeMs`; si no, null. */
export async function cacheGet<T>(key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const entry = await run<Entry<T> | undefined>("readonly", (s) => s.get(key));
    if (entry && Date.now() - entry.savedAt < maxAgeMs) return entry.value;
  } catch {
    // sin caché disponible
  }
  return null;
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  try {
    await run("readwrite", (s) => s.put({ savedAt: Date.now(), value } satisfies Entry<T>, key));
  } catch {
    // sin caché disponible
  }
}
