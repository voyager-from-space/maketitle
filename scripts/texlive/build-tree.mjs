// Builds the lazily loaded TeX Live tree for maketitle from a dumped BusyTeX file system (extract.cjs output).
// Small config files go into one core blob that is mounted at start. Everything else (tex/, fonts/, bibtex/, formats,
// font maps, ICU data) is cut into gzip "packs" of at most ~512 KB of files from one directory; the worker creates every
// one of those files as a lazy node and fetches its pack only when TeX first reads it.
// usage: node build-tree.mjs <fsdump> <outdir>
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
const [src, out] = process.argv.slice(2);
rmSync(join(out, 'p'), { recursive: true, force: true }); mkdirSync(join(out, 'p'), { recursive: true });
const all = [];
const walk = (d) => { for (const e of readdirSync(join(src, d)).sort()) { const p = d + '/' + e; const st = statSync(join(src, p)); if (st.isDirectory()) walk(p); else all.push({ path: p, size: st.size }); } };
walk('');
const LAZY_ROOTS = ['/texlive/texmf-dist/tex/', '/texlive/texmf-dist/fonts/', '/texlive/texmf-dist/bibtex/', '/texlive/texmf-dist/metapost/', '/texlive/texmf-dist/makeindex/',
  '/texlive/texmf-dist/dvips/', '/texlive/texmf-dist/dvipdfmx/', '/texlive/texmf-dist/texmf-var/fonts/map/', '/texlive/texmf-dist/texmf-var/web2c/', '/texlive/texmf-dist/texmf-var/luatex-cache/',
  '/texlive/texmf-dist/metafont/', '/texlive/texmf-dist/mft/', '/texlive/texmf-dist/psutils/', '/texlive/texmf-dist/ttf2pk/', '/texlive/texmf-dist/xdvi/'];
const isLazy = (f) => !f.path.endsWith('/ls-R') && (LAZY_ROOTS.some((r) => f.path.startsWith(r)) || f.size > 256 * 1024);
const drop = (f) => /\/texmf-var\/web2c\/.*\.log$/.test(f.path) || f.path.endsWith('/updmap.log');
const core = [], lazy = [];
for (const f of all) { if (drop(f)) continue; (isLazy(f) ? lazy : core).push(f); }
const h = (b) => createHash('sha256').update(b).digest('hex');
// core blob: concatenated files + JSON list
let off = 0; const coreList = []; const coreBufs = [];
// XeTeX looks fonts up by name through fontconfig, which reads every font in the listed directories. Type 1 fonts (96 MB) are
// for pdfTeX; leaving them out of fontconfig's list keeps a XeLaTeX first compile to the OpenType/TrueType set.
const patch = (p, b) => (/\/fonts\.conf$/.test(p) ? Buffer.from(b.toString('utf8').replace('<dir>/texlive/texmf-dist/fonts/type1</dir>', '')) : b);
for (const f of core) { const b = patch(f.path, readFileSync(join(src, f.path))); coreList.push([f.path, off, b.length]); coreBufs.push(b); off += b.length; }
const coreRaw = Buffer.concat(coreBufs); const coreGz = gzipSync(coreRaw, { level: 9 });
const coreName = 'core-' + h(coreGz).slice(0, 12) + '.bin';
writeFileSync(join(out, coreName), coreGz);
// packs
const MAX = 512 * 1024, FONT_MAX = 128 * 1024;
const maxFor = (d) => (/\/fonts\/(type1|opentype|truetype)\//.test(d + '/') ? FONT_MAX : MAX);
const dirs = [], dirIdx = new Map(); const files = []; const packs = [];
let cur = null;
const flush = () => { if (!cur || !cur.bufs.length) return; const raw = Buffer.concat(cur.bufs); const gz = gzipSync(raw, { level: 9 }); const name = h(gz).slice(0, 16); mkdirSync(join(out, 'p', name.slice(0, 2)), { recursive: true }); writeFileSync(join(out, 'p', name.slice(0, 2), name + '.bin'), gz); packs.push([name, gz.length, raw.length]); for (const fi of cur.files) fi[3] = packs.length - 1; cur = null; };
let lastDir = null;
for (const f of lazy) {
  const d = dirname(f.path);
  if (!dirIdx.has(d)) { dirIdx.set(d, dirs.length); dirs.push(d); }
  const b = readFileSync(join(src, f.path));
  if (d !== lastDir || !cur || cur.size + b.length > maxFor(d)) { flush(); cur = { bufs: [], files: [], size: 0 }; }
  const fi = [dirIdx.get(d), basename(f.path), b.length, -1, cur.size];
  cur.bufs.push(b); cur.files.push(fi); cur.size += b.length; files.push(fi); lastDir = d;
  if (b.length >= maxFor(d)) flush();
}
flush();
// static package dependencies (RequirePackage / LoadClass / usepackage inside .sty/.cls), used to prefetch packs in parallel
const byName = new Map(); files.forEach((fi, i) => { if (!byName.has(fi[1])) byName.set(fi[1], i); });
const deps = {};
for (const [i, fi] of files.entries()) {
  if (!/\.(sty|cls)$/.test(fi[1])) continue;
  const t = readFileSync(join(src, dirs[fi[0]], fi[1]), 'latin1');
  const names = new Set();
  for (const m of t.matchAll(/\\(?:RequirePackage|RequirePackageWithOptions|usepackage)\s*(?:\[[^\]]*\])?\s*\{([^}#\\]*)\}/g)) for (const n of m[1].split(',')) { const k = n.trim(); if (k && byName.has(k + '.sty')) names.add(byName.get(k + '.sty')); }
  for (const m of t.matchAll(/\\(?:LoadClass|LoadClassWithOptions)\s*(?:\[[^\]]*\])?\s*\{([^}#\\]*)\}/g)) { const k = m[1].trim(); if (byName.has(k + '.cls')) names.add(byName.get(k + '.cls')); }
  names.delete(i); if (names.size) deps[i] = [...names];
}
// ICU data (22 MB) is only read by XeTeX; the worker creates it when a XeLaTeX compile asks for it
const defer = files.map((fi, i) => (fi[1] === 'icudt78l.dat' ? i : -1)).filter((i) => i >= 0);
// base: packs a common preamble needs (measured with base-trace.txt from a traced compile), prefetched in parallel
let base = [];
try { const names = new Set(readFileSync(new URL('./base-trace.txt', import.meta.url), 'utf8').split(/\s+/).filter(Boolean)); base = files.map((fi, i) => (names.has(dirs[fi[0]] + '/' + fi[1]) ? fi[3] : -1)).filter((x) => x >= 0); base = [...new Set(base)]; } catch {}
const index = { v: 1, core: coreName, coreList, dirs, files, packs, deps, defer, base };
const ij = Buffer.from(JSON.stringify(index)); const igz = gzipSync(ij, { level: 9 });
const indexName = 'index-' + h(igz).slice(0, 12) + '.json.gz';
writeFileSync(join(out, indexName), igz);
writeFileSync(join(out, 'latest.json'), JSON.stringify({ index: indexName }) + '\n');
const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
console.log(JSON.stringify({ core: core.length, coreRaw: coreRaw.length, coreGz: coreGz.length, lazy: lazy.length, lazyRaw: sum(lazy, 'size'), packs: packs.length, packsGz: packs.reduce((s, p) => s + p[1], 0), indexRaw: ij.length, indexGz: igz.length, coreName, indexName }));
