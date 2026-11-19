// Unpack what arXiv and Overleaf-style exports hand out: tar.gz, a lone gzipped .tex, or a zip.
import { gunzipSync, unzipSync } from 'fflate';

const td = new TextDecoder();
const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5);
const isPdf = (b) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isTar = (b) => b.length > 512 && td.decode(b.subarray(257, 262)) === 'ustar';

const cstr = (b) => { const z = b.indexOf(0); return td.decode(z < 0 ? b : b.subarray(0, z)); };

export function untar(buf) {
  const files = [];
  let off = 0, longName = null, pax = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    let name = cstr(h.subarray(0, 100));
    const size = parseInt(cstr(h.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = cstr(h.subarray(345, 500));
    if (prefix) name = prefix + '/' + name;
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = cstr(body); continue; }
    if (type === 'x') { const m = /\d+ path=([^\n]*)\n/.exec(td.decode(body)); pax = m ? m[1] : null; continue; }
    if (type === 'g') continue;
    if (longName) { name = longName; longName = null; }
    if (pax) { name = pax; pax = null; }
    if (type === '0' || type === '\0') files.push({ path: name.replace(/^\.\//, ''), bytes: body.slice() });
  }
  return files;
}

// returns { kind: 'files', files } | { kind: 'pdf' }; throws on anything else
export function unpack(bytes, nameHint = '') {
  if (isPdf(bytes)) return { kind: 'pdf' };
  if (isZip(bytes)) {
    const z = unzipSync(bytes);
    const files = Object.entries(z).filter(([p]) => !p.endsWith('/')).map(([path, b]) => ({ path, bytes: b }));
    return { kind: 'files', files };
  }
  if (isGzip(bytes)) {
    const raw = gunzipSync(bytes);
    if (isTar(raw)) return { kind: 'files', files: untar(raw) };
    return { kind: 'files', files: [{ path: /\.tex$/i.test(nameHint) ? nameHint : 'main.tex', bytes: raw }] };
  }
  if (isTar(bytes)) return { kind: 'files', files: untar(bytes) };
  throw new Error('That file is not a tar.gz, zip or gzipped .tex.');
}
