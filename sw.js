// maketitle service worker: keeps the app and the TeX engine files so a paper you already opened works with no connection.
const BASE = '/maketitle/';
const PRECACHE = ["app.css","app.js","core/biber.js","core/busytex.js","core/busytex_biber.js","core/busytex_pipeline.js","core/busytex_worker.js","core/busytex_worker_real.js","core/texlive-basic.js","core/texlive-basic.js.providespackage.txt","core/texlive-extra.js","core/texlive-extra.js.providespackage.txt","core/texlive-recommended.js","core/texlive-recommended.js.providespackage.txt","core/texmf.cnf","favicon.svg","fonts/EBGaramond-Italic-Latin.woff2","fonts/EBGaramond-Latin.woff2","fonts/IBMPlexMono-Regular-Latin1.woff2","fonts/IBMPlexSans-Regular-Latin1.woff2","fonts/IBMPlexSans-SemiBold-Latin1.woff2","index.html","mt-config.json","pdf.worker.min.mjs"]; // every file the app and the engine load from this origin
const VERSION = '16dc5fbaaf';
const SHELL = 'mt-shell-' + VERSION;
const CORE = 'mt-core-v2'; // engine files: large and rarely changing, kept across app updates
const scope = self.registration.scope;
const heavy = (url) => /\/core\/(texlive-[a-z]+\.js(\.providespackage\.txt)?|busytex\.js|texmf\.cnf)$/.test(url.pathname) || /\/fonts\//.test(url.pathname);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL), core = await caches.open(CORE);
    for (const f of ['', ...PRECACHE]) {
      const u = new URL(f, scope); const c = heavy(u) ? core : shell;
      if (heavy(u) && (await core.match(u.href))) continue;
      try { await c.add(u.href); } catch {}
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => { for (const k of await caches.keys()) if ((k.startsWith('mt-shell-') && k !== SHELL) || (k.startsWith('mt-core-') && k !== CORE)) await caches.delete(k); await self.clients.claim(); })());
});
async function networkFirst(req, cacheName, fallbackUrl) {
  const c = await caches.open(cacheName);
  try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }
  catch (err) { return (await c.match(req)) || (fallbackUrl && (await c.match(fallbackUrl))) || Response.error(); }
}
async function cacheFirst(req) {
  const c = await caches.open(CORE); const hit = await c.match(req); if (hit) return hit;
  const res = await fetch(req); if (res.ok && res.status === 200) c.put(req, res.clone()); return res;
}
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin || !url.href.startsWith(scope)) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, SHELL, new URL('index.html', scope).href)); return; }
  if (heavy(url)) { e.respondWith(cacheFirst(req)); return; }
  e.respondWith(networkFirst(req, SHELL));
});
