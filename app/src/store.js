// Saved projects in IndexedDB: edits survive a reload and a saved paper opens with no network.
const DB = 'maketitle', S = 'projects';
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(S, { keyPath: 'key' });
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const run = async (mode, fn) => { const db = await open(); try { return await new Promise((res, rej) => { const tx = db.transaction(S, mode); const out = fn(tx.objectStore(S)); tx.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); } finally { db.close(); } };
export const put = (rec) => run('readwrite', (s) => s.put(rec));
export const get = (key) => run('readonly', (s) => s.get(key));
export const del = (key) => run('readwrite', (s) => s.delete(key));
export async function list() {
  const db = await open();
  try {
    return await new Promise((res, rej) => {
      const out = []; const c = db.transaction(S, 'readonly').objectStore(S).openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) return res(out.sort((a, b) => b.savedAt - a.savedAt)); const { key, label, savedAt, edited, from } = cur.value; out.push({ key, label, savedAt, edited, from }); cur.continue(); };
      c.onerror = () => rej(c.error);
    });
  } finally { db.close(); }
}
export const supported = () => typeof indexedDB !== 'undefined';
