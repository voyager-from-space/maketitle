// maketitle worker shim. Same-origin entry point for the BusyTeX worker.
// The big engine/data files are not next to the app: they live in the assets repo as gzip streams cut into
// parts (see maketitle-assets/manifest.json). This shim answers fetch() for those names by downloading the parts in
// order and gunzipping them with DecompressionStream, so the stock BusyTeX code never knows the difference.
const nativeFetch = self.fetch.bind(self);
// Offline: the manifest and the small engine files (busytex.wasm, biber) are kept in Cache Storage. The big TeX Live data
// packages are kept by the engine itself in IndexedDB, so an engine that loaded once starts again with no connection.
const CACHE = 'mt-assets-v1';
async function cached(url, { fresh }) {
  let c = null; try { c = await caches.open(CACHE); } catch {}
  if (c && !fresh) { const hit = await c.match(url); if (hit) return { res: hit, hit: true }; }
  try { const res = await nativeFetch(url); if (res.ok && c) c.put(url, res.clone()).catch(() => {}); return { res, hit: false }; }
  catch (e) { const hit = c && (await c.match(url)); if (hit) return { res: hit, hit: true }; throw e; }
}
const cfgPromise = (async () => {
  const here = new URL('.', self.location.href);
  const cfg = await (await nativeFetch(new URL('../mt-config.json', here))).json();
  const manifest = await (await (await cached(cfg.assets + 'manifest.json', { fresh: true })).res).json();
  return { assets: cfg.assets, manifest };
})();
let netBytes = 0;
const notify = () => self.postMessage({ mt_net: netBytes });
let lastNote = 0;
let flush = null;
const count = (n) => { netBytes += n; const t = Date.now(); if (t - lastNote > 250) { lastNote = t; notify(); } else if (!flush) flush = setTimeout(() => { flush = null; lastNote = Date.now(); notify(); }, 300); };

function gunzipParts(urls, keep) {
  let i = 0, reader = null, next = null;
  const open = (k) => (keep ? cached(urls[k], { fresh: false }).then((o) => { o.res.mtHit = o.hit; return o.res; }) : nativeFetch(urls[k])).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + urls[k]); return r; });
  const src = new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        if (!reader) {
          if (i >= urls.length) { notify(); ctrl.close(); return; }
          const res = await (next || open(i));
          i++; next = i < urls.length ? open(i) : null;
          reader = res.body.getReader(); reader.mtHit = res.mtHit;
        }
        const { done, value } = await reader.read();
        if (done) { reader = null; continue; }
        if (!reader.mtHit) count(value.length);
        ctrl.enqueue(value);
        return;
      }
    },
  });
  return src.pipeThrough(new DecompressionStream('gzip'));
}

self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const name = new URL(url, self.location.href).pathname.split('/').pop();
  if (/\.(data|wasm)$/.test(name)) {
    const { assets, manifest } = await cfgPromise;
    const ent = manifest[name];
    if (ent) {
      const headers = { 'Content-Length': String(ent.size), 'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' };
      return new Response(gunzipParts(ent.parts.map((p) => assets + 'parts/' + p), (ent.gz || 0) < 20e6), { status: 200, headers });
    }
  }
  return nativeFetch(input, init);
};
importScripts('busytex_worker_real.js');
