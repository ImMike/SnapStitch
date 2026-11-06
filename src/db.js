// IndexedDB store for captured screenshots. Shared by the service worker
// (writes) and the preview page (reads). Blobs are stored directly, so large
// full-page captures never pass through extension messaging.

const DB_NAME = 'snapstitch';
const STORE = 'shots';
const KEEP = { image: 20, video: 5 }; // recordings are large

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req instanceof IDBRequest ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export function putShot(shot) {
  return tx('readwrite', (store) => store.put(shot));
}

export function getShot(id) {
  return tx('readonly', (store) => store.get(id));
}

// Delete everything except the newest KEEP shots of each kind.
export function pruneShots() {
  return tx('readwrite', (store) => {
    const seen = { image: 0, video: 0 };
    store.index('createdAt').openCursor(null, 'prev').onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      const kind = cursor.value.kind === 'video' ? 'video' : 'image';
      if (++seen[kind] > KEEP[kind]) cursor.delete();
      cursor.continue();
    };
  });
}
