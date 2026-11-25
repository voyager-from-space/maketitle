// maketitle worker entry (same origin). TeX Live is loaded lazily, file by file, by mt-lazy.js (see src/worker/lazy.js):
// mt-texlive.js is the only "data package" the engine mounts, and it creates every TeX Live file as a lazy node.
// The engine .wasm and biber files come from the same mirrors (jsDelivr first, GitHub Pages second), gunzipped here and
// kept in Cache Storage, so an engine that loaded once starts again with no connection.
importScripts('mt-lazy.js');
const nativeFetch = self.fetch.bind(self);
let lastNote = 0, flush = null, lastNet = 0;
const notify = () => self.postMessage({ mt_net: lastNet });
const onNet = (n) => { lastNet = n; const t = Date.now(); if (t - lastNote > 250) { lastNote = t; notify(); } else if (!flush) flush = setTimeout(() => { flush = null; lastNote = Date.now(); notify(); }, 300); };
const cfgPromise = nativeFetch(new URL('../mt-config.json', self.location.href)).then((r) => r.json());
self.__mtReady = cfgPromise.then((cfg) => MtLazy.start(cfg.tl, onNet));
self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const name = new URL(url, self.location.href).pathname.split('/').pop();
  const cfg = await cfgPromise;
  const rel = cfg.tl.files && cfg.tl.files[name];
  if (rel) {
    const body = await MtLazy.blob(rel);
    return new Response(body, { status: 200, headers: { 'Content-Length': String(body.length), 'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } });
  }
  return nativeFetch(input, init);
};
// a compile result goes out with the lazy-loading numbers posted just before it, so the page reads current stats
const realPost = self.postMessage.bind(self);
self.postMessage = (m, t) => { if (m && typeof m === 'object' && 'exit_code' in m && 'log' in m) realPost({ mt_lazy: MtLazy.stats() }); return realPost(m, t); };
importScripts('busytex_worker_real.js');
const realOnMessage = self.onmessage;
self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.files) {
    const t0 = Date.now();
    let planned = 0;
    try {
      await self.__mtReady; planned = await MtLazy.prefetch(d.files, d.driver);
      if (/xetex/.test(d.driver || '') && self.pipeline && self.pipeline.Module) MtLazy.enableDeferred(await self.pipeline.Module);
    } catch (err) { self.postMessage({ print: 'maketitle: prefetch failed: ' + err }); }
    self.postMessage({ mt_prefetch: { packs: planned, ms: Date.now() - t0 } });
    await realOnMessage(e);
    notify();
    return;
  }
  return realOnMessage(e);
};
