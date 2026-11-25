// maketitle lazy TeX Live (runs inside the BusyTeX worker; bundled to core/mt-lazy.js).
// The TeX Live tree (24k files, 520 MB) is never downloaded whole. index-*.json.gz lists every file with its size and the
// gzip "pack" (<= 512 KB of files from one directory) that holds it. At engine start every file is created as a lazy node:
// stat() answers from the index, and the first read of a file fetches its pack synchronously (allowed in a worker), so TeX
// only pulls what a paper really opens. Before each compile the packs the source obviously needs (its class, packages and
// their \RequirePackage closure, plus a measured base set) are fetched in parallel, so few reads have to wait on the network.
// Every pack is kept in Cache Storage: a second visit downloads 0 bytes.
import { gunzipSync } from 'fflate';

const CACHE = 'mt-tl-v1';
const state = { cfg: null, index: null, core: null, mem: new Map(), lru: new Map(), net: 0, syncFetches: 0, asyncFetches: 0, cacheHits: 0, onNet: () => {} };
const nativeFetch = self.fetch.bind(self);
let cachePromise = null;
const openCache = () => (cachePromise ||= caches.open(CACHE).catch(() => null));

function addNet(n) { state.net += n; state.onNet(state.net); }
// mirrors in order of preference; one that fails twice in this session moves to the back (jsDelivr sometimes answers 403
// for a file it has not stored yet, GitHub Pages is the fallback)
const fails = new Map();
const mirrors = () => state.order || (state.order = state.cfg.mirrors.slice());
function failed(m) { const n = (fails.get(m) || 0) + 1; fails.set(m, n); if (n === 2) { const o = mirrors(); o.splice(o.indexOf(m), 1); o.push(m); } }
// a mirror may hold half the tree: '{s}' in its URL becomes 'a' or 'b' (jsDelivr serves a GitHub repo up to 150 MB,
// so the tree is split over two repos; the TeX engine and packs 80-ff are in b, the rest, biber included, in a)
const shard = (rel) => (/^e\/busytex/.test(rel) || /^p\/[89a-f]/.test(rel) ? 'b' : 'a');
const at = (m, rel) => m.replace('{s}', shard(rel)) + rel;
const packPath = (name) => 'p/' + name.slice(0, 2) + '/' + name + '.bin';

// async GET with mirror fallback; Cache Storage first (immutable, content-hashed names)
async function getAsync(rel, { keep = true } = {}) {
  const c = await openCache();
  const key = state.cfg.mirrors[state.cfg.mirrors.length - 1] + rel; // stable cache key, whichever mirror answered
  if (c) { const hit = await c.match(key); if (hit) { state.cacheHits++; return new Uint8Array(await hit.arrayBuffer()); } }
  let err = null;
  for (const m of mirrors().slice()) {
    try {
      const r = await nativeFetch(at(m, rel));
      if (!r.ok) { failed(m); throw new Error(r.status + ' ' + at(m, rel)); }
      const b = new Uint8Array(await r.arrayBuffer());
      addNet(b.length); if (self.__mtDebug) console.log('mtfetch async', rel, b.length);
      if (c && keep) c.put(key, new Response(b, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
      return b;
    } catch (e) { err = e; }
  }
  throw err;
}
function getSync(rel) {
  for (const m of mirrors().slice()) {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', at(m, rel), false); x.responseType = 'arraybuffer'; x.send(null);
      if (x.status === 200 && x.response) { const b = new Uint8Array(x.response); addNet(b.length); if (self.__mtDebug) console.log('mtfetch sync', rel, b.length); return b; }
      failed(m);
    } catch { failed(m); }
  }
  return null;
}
function persist(rel, b) {
  openCache().then((c) => c && c.put(state.cfg.mirrors[state.cfg.mirrors.length - 1] + rel, new Response(b))).catch(() => {});
}

// raw bytes of one pack (decompressed), fetched synchronously if no prefetch brought it in
function packRaw(pi) {
  let raw = state.lru.get(pi);
  if (raw) { state.lru.delete(pi); state.lru.set(pi, raw); return raw; }
  let gz = state.mem.get(pi);
  if (!gz) {
    const rel = packPath(state.index.packs[pi][0]);
    gz = getSync(rel);
    if (!gz) throw new Error('could not download TeX Live pack ' + rel);
    state.syncFetches++; state.mem.set(pi, gz); persist(rel, gz);
  }
  raw = gunzipSync(gz);
  state.lru.set(pi, raw);
  if (state.lru.size > 48) state.lru.delete(state.lru.keys().next().value);
  return raw;
}

export async function start(cfg, onNet) {
  state.cfg = cfg; if (onNet) state.onNet = onNet; self.__mtDebug = !!cfg.debug;
  const igz = await getAsync(cfg.index);
  state.index = JSON.parse(new TextDecoder().decode(gunzipSync(igz)));
  state.byName = new Map();
  state.index.files.forEach((f, i) => { if (!state.byName.has(f[1])) state.byName.set(f[1], i); });
  state.core = gunzipSync(await getAsync(state.index.core));
  // CTAN packages the main tree lacks, and aliases for METAFONT-only fonts (see scripts/texlive/build-overlay.mjs)
  state.ov = cfg.overlay ? JSON.parse(new TextDecoder().decode(gunzipSync(await getAsync(cfg.overlay)))) : null;
  state.ovRaw = new Map(); state.aliasUsed = [];
  // packs kept from earlier visits
  const c = await openCache();
  if (c) {
    const want = new Map(state.index.packs.map((p, i) => [cfg.mirrors[cfg.mirrors.length - 1] + packPath(p[0]), i]));
    for (const req of await c.keys()) { const i = want.get(req.url); if (i != null && !state.mem.has(i)) state.mem.set(i, new Uint8Array(await (await c.match(req)).arrayBuffer())); }
  }
  return state;
}

// called from the data-package preRun hook: core files for real, everything else as lazy nodes
export function mount(Module) {
  const FS = Module.FS;
  const made = new Set(['/']);
  const mkdirp = (d) => { if (made.has(d)) return; const p = d.slice(0, d.lastIndexOf('/')) || '/'; mkdirp(p); try { FS.mkdir(d); } catch {} made.add(d); };
  const ov = state.ov;
  for (const [path, off, len] of state.index.coreList) {
    const d = path.slice(0, path.lastIndexOf('/')) || '/'; mkdirp(d);
    let b = state.core.subarray(off, off + len);
    if (ov && path === '/texlive/texmf-dist/ls-R') b = concat(b, new TextEncoder().encode(ov.lsr)); // kpathsea finds !! trees only through ls-R
    FS.writeFile(path, b);
  }
  const { dirs, files } = state.index;
  for (const d of dirs) mkdirp(d);
  const deferred = new Set(state.index.defer || []);
  files.forEach((f, i) => { if (!deferred.has(i) || state.deferOn) lazyNode(FS, f); });
  if (!ov) return;
  const subst = new Set(ov.subst || []);
  const used = (n) => { if (subst.has(n) && !state.aliasUsed.includes(n)) state.aliasUsed.push(n); };
  for (const [path, size, pi, off] of ov.files) { const d = path.slice(0, path.lastIndexOf('/')), n = path.slice(d.length + 1); mkdirp(d); defineLazy(FS, d, n, size, () => { used(n); return ovPack(pi).slice(off, off + size); }); }
  for (const [path, src] of ov.aliases) {
    const sd = src.slice(0, src.lastIndexOf('/')), sn = src.slice(sd.length + 1);
    const f = files.find((x) => x[1] === sn && dirs[x[0]] === sd); if (!f) continue;
    const d = path.slice(0, path.lastIndexOf('/')), n = path.slice(d.length + 1);
    defineLazy(FS, d, n, f[2], () => { used(n); return packRaw(f[3]).slice(f[4], f[4] + f[2]); });
  }
}
function concat(a, b) { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; }
function ovPack(pi) {
  let raw = state.ovRaw.get(pi);
  if (!raw) { const rel = 'x/' + state.ov.packs[pi][0] + '.bin'; const gz = getSync(rel); if (!gz) throw new Error('could not download TeX Live pack ' + rel); persist(rel, gz); raw = gunzipSync(gz); state.ovRaw.set(pi, raw); }
  return raw;
}
function defineLazy(FS, dir, name, size, get) {
  let node; try { node = FS.createFile(dir, name, {}, true, false); } catch { return; }
  let data = null;
  Object.defineProperty(node, 'contents', { configurable: true, get() { return data || (data = get()); }, set(v) { data = v; } });
  Object.defineProperty(node, 'usedBytes', { configurable: true, get() { return data ? data.length : size; }, set(v) {} });
}
function lazyNode(FS, f) {
  const [di, name, size, pi, off] = f;
  const dir = state.index.dirs[di];
  let node;
  try { node = FS.createFile(dir, name, {}, true, false); } catch { return; } // already there
  let data = null;
  const extra = state.ov && state.ov.map && name === 'pdftex.map' ? new TextEncoder().encode(state.ov.map) : null; // overlay fonts' map lines
  const load = () => { if (!data) { data = packRaw(pi).slice(off, off + size); if (extra) data = concat(data, extra); if (self.__mtDebug) console.log('mtread ' + dir + '/' + name); } return data; };
  Object.defineProperty(node, 'contents', { configurable: true, get: load, set(v) { data = v; } });
  Object.defineProperty(node, 'usedBytes', { configurable: true, get() { return data ? data.length : size + (extra ? extra.length : 0); }, set(v) {} });
}
// XeTeX needs the ICU data file: create it (and the other deferred files) in a running module, and in every later mount
export function enableDeferred(Module) {
  state.deferOn = true;
  for (const i of state.index.defer || []) lazyNode(Module.FS, state.index.files[i]);
}

// packs a project obviously needs: base set, driver format, class/packages/bst and their static dependency closure
export function plan(files, driver) {
  const { index, byName } = state;
  const want = new Set();
  const addFile = (name) => { const i = byName.get(name); if (i != null) want.add(i); return i; };
  const fmt = /xetex/.test(driver) ? 'xelatex.fmt' : /luahbtex/.test(driver) ? 'luahblatex.fmt' : /luatex/.test(driver) ? 'luahblatex.fmt' : 'pdflatex.fmt';
  addFile(fmt);
  if (/xetex/.test(driver)) for (const i of index.defer || []) want.add(i);
  const stack = [];
  const push = (n) => { const i = addFile(n); if (i != null) stack.push(i); };
  const local = new Set(files.map((f) => f.path.split('/').pop()));
  for (const f of files) {
    if (typeof f.contents !== 'string' || !/\.(tex|sty|cls|ltx)$/i.test(f.path)) continue;
    const t = f.contents.replace(/(^|[^\\])%.*$/gm, '$1');
    for (const m of t.matchAll(/\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) if (!local.has(m[1].trim() + '.cls')) push(m[1].trim() + '.cls');
    for (const m of t.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) for (const n of m[1].split(',')) { const k = n.trim(); if (k && !local.has(k + '.sty')) push(k + '.sty'); }
    for (const m of t.matchAll(/\\bibliographystyle\s*\{([^}]+)\}/g)) if (!local.has(m[1].trim() + '.bst')) push(m[1].trim() + '.bst');
  }
  const seen = new Set();
  while (stack.length) { const i = stack.pop(); if (seen.has(i)) continue; seen.add(i); want.add(i); for (const d of index.deps[i] || []) stack.push(d); }
  const packs = new Set((index.base || []).concat([...want].map((i) => index.files[i][3])));
  return [...packs];
}

export async function prefetch(files, driver) {
  const need = plan(files, driver).filter((pi) => !state.mem.has(pi));
  let k = 0;
  const worker = async () => { while (k < need.length) { const pi = need[k++]; try { state.mem.set(pi, await getAsync(packPath(state.index.packs[pi][0]))); state.asyncFetches++; } catch {} } };
  await Promise.all(Array.from({ length: 8 }, worker));
  return need.length;
}

// whole files (engine .wasm, biber data) from the same mirrors, gunzipped, kept in Cache Storage
export async function blob(rel) { return gunzipSync(await getAsync(rel)); }
export const stats = () => ({ net: state.net, syncFetches: state.syncFetches, asyncFetches: state.asyncFetches, cachedPacks: state.mem.size, cacheHits: state.cacheHits, aliasUsed: (state.aliasUsed || []).slice() });
