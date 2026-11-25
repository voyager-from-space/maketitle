// Adds CTAN packages that the BusyTeX TeX Live set lacks, without rebuilding the main tree (its pack names stay the same).
// usage: node build-overlay.mjs <outdir> <unzipped .tds.zip dir>...
// Each package becomes one gzip pack x/<hash>.bin; overlay-<hash>.json.gz lists its files (TDS path under texmf-dist),
// the lines to append to ls-R and pdftex.map, and aliases: METAFONT-only fonts (no Type 1 exists, and METAFONT cannot run
// in the page) are served as their regular-weight sibling, so a paper still builds; the app reports the substitution.
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
const [out, ...pkgDirs] = process.argv.slice(2);
const ROOT = '/texlive/texmf-dist/';
const h = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
mkdirSync(join(out, 'x'), { recursive: true });
const ov = { v: 1, packs: [], files: [], lsr: '', map: '', aliases: [] };
const byDir = new Map();
const MAX = 512 * 1024;
for (const dir of pkgDirs) {
  const files = [];
  const walk = (d) => { for (const e of readdirSync(join(dir, d)).sort()) { const p = d ? d + '/' + e : e; statSync(join(dir, p)).isDirectory() ? walk(p) : files.push(p); } };
  walk('');
  const keep = files.filter((p) => /^(tex|fonts|bibtex)\//.test(p) && !/^fonts\/afm\//.test(p));
  // packs of at most 512 KB from one directory, as in the main tree, so a read fetches only its neighbours
  const groups = []; let cur = null;
  for (const p of keep) {
    const d = p.slice(0, p.lastIndexOf('/')); const size = statSync(join(dir, p)).size;
    if (!cur || cur.d !== d || (cur.size + size > MAX && cur.list.length)) groups.push(cur = { d, size: 0, list: [] });
    cur.list.push(p); cur.size += size;
  }
  let raw = 0, gzt = 0;
  for (const g of groups) {
    const bufs = []; let off = 0; const pi = ov.packs.length;
    for (const p of g.list) {
      const b = readFileSync(join(dir, p)); bufs.push(b);
      ov.files.push([ROOT + p, b.length, pi, off]); off += b.length;
      (byDir.get(g.d) || byDir.set(g.d, []).get(g.d)).push(basename(p));
      if (/^fonts\/map\/(dvips|pdftex)\/.*\.map$/.test(p)) ov.map += '\n' + b.toString('latin1').trim() + '\n';
    }
    const gz = gzipSync(Buffer.concat(bufs), { level: 9 }); const name = h(gz);
    writeFileSync(join(out, 'x', name + '.bin'), gz); ov.packs.push([name, gz.length, off, basename(dir)]); raw += off; gzt += gz.length;
  }
  console.log(basename(dir), keep.length, 'files', groups.length, 'packs', raw, 'bytes ->', gzt, 'gz');
}
// bold typewriter from bold-extra: cmttb10 exists only as METAFONT source in TeX Live
const ALIASES = [['fonts/tfm/public/cm/cmttb10.tfm', 'fonts/tfm/public/cm/cmtt10.tfm', 'cmttb10 CMTT10 <cmtt10.pfb']];
for (const [a, src, mapLine] of ALIASES) {
  ov.aliases.push([ROOT + a, ROOT + src]); ov.map += mapLine + '\n';
  const d = a.slice(0, a.lastIndexOf('/')); (byDir.get(d) || byDir.set(d, []).get(d)).push(basename(a));
}
// bbm (blackboard bold) is METAFONT-only too: keep its real metrics, draw it with doublestroke's Type 1 outlines
ov.subst = ALIASES.map(([a]) => basename(a));
for (const f of ov.files) {
  const m = /\/fonts\/tfm\/public\/bbm\/(bbm([a-z]*?)(\d+))\.tfm$/.exec(f[0]); if (!m) continue;
  const ss = /^ss/.test(m[2]), size = Number(m[3]);
  const ds = (ss ? 'dsss' : 'dsrom') + (size <= 8 ? 8 : size >= 12 ? 12 : 10);
  ov.map += `${m[1]} ${ds} <${ds}.pfb\n`; ov.subst.push(m[1] + '.tfm');
}
for (const [d, names] of byDir) ov.lsr += '\n./' + d + ':\n' + names.join('\n') + '\n';
const j = gzipSync(Buffer.from(JSON.stringify(ov)), { level: 9 }); const jn = 'overlay-' + h(j) + '.json.gz';
writeFileSync(join(out, jn), j); console.log('wrote', jn);
