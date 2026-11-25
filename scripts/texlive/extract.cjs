// Mounts the stock BusyTeX TeX Live data packages in Node and dumps every file, so the lazy tree can be built from them.
// usage: node extract.cjs <rawdir> <outdir> pkg1 [pkg2...]
const fs = require('fs'), path = require('path'), vm = require('vm');
const [raw, out, ...pkgs] = process.argv.slice(2);
globalThis.self = globalThis; globalThis.require = require; globalThis.__dirname = raw; globalThis.__filename = raw + '/busytex.js';
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => { const p = String(u); if (fs.existsSync(p)) return new Response(fs.readFileSync(p), { headers: { 'content-type': 'application/wasm' } }); return realFetch(u); };
const load = (f) => vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
load(path.join(raw, 'busytex_pipeline.js'));
const loader = (src) => Promise.resolve(load(src));
(async () => {
  const P = vm.runInThisContext('BusytexPipeline');
  const js = pkgs.map((p) => path.join(raw, p + '.js'));
  const pl = new P(path.join(raw, 'busytex.js'), path.join(raw, 'busytex.wasm'), js, js, [], () => {}, () => {}, true, loader);
  const M = await pl.Module; const FS = M.FS;
  let n = 0, bytes = 0;
  const walk = (d) => { for (const e of FS.readdir(d)) { if (e === '.' || e === '..') continue; const p = d === '/' ? '/' + e : d + '/' + e; const st = FS.stat(p); if (FS.isDir(st.mode)) { if (['/proc', '/dev', '/tmp', '/home'].includes(p)) continue; walk(p); } else if (FS.isFile(st.mode)) { const b = FS.readFile(p); const o = path.join(out, p); fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, b); n++; bytes += b.length; } } };
  walk('/');
  console.log('files', n, 'bytes', bytes);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
