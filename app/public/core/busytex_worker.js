// maketitle worker shim. Same-origin entry point for the BusyTeX worker.
// The big engine/data files are not next to the app: they live in the assets repo as gzip streams cut into
// parts (see maketitle-assets/manifest.json). This shim answers fetch() for those names by downloading the parts in
// order and gunzipping them with DecompressionStream, so the stock BusyTeX code never knows the difference.
const cfgPromise = (async () => {
  const here = new URL('.', self.location.href);
  const cfg = await (await fetch(new URL('../mt-config.json', here))).json();
  const manifest = await (await fetch(cfg.assets + 'manifest.json')).json();
  return { assets: cfg.assets, manifest };
})();
const nativeFetch = self.fetch.bind(self);
let netBytes = 0;
const notify = () => self.postMessage({ mt_net: netBytes });
let lastNote = 0;
const count = (n) => { netBytes += n; const t = Date.now(); if (t - lastNote > 250) { lastNote = t; notify(); } };

function gunzipParts(urls) {
  let i = 0, reader = null, next = null;
  const open = (k) => nativeFetch(urls[k]).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + urls[k]); return r; });
  const src = new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        if (!reader) {
          if (i >= urls.length) { notify(); ctrl.close(); return; }
          const res = await (next || open(i));
          i++; next = i < urls.length ? open(i) : null;
          reader = res.body.getReader();
        }
        const { done, value } = await reader.read();
        if (done) { reader = null; continue; }
        count(value.length);
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
      return new Response(gunzipParts(ent.parts.map((p) => assets + 'parts/' + p)), { status: 200, headers });
    }
  }
  return nativeFetch(input, init);
};
importScripts('busytex_worker_real.js');
