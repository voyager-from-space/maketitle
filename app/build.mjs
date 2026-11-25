// node build.mjs [--base /maketitle/] [--out dist]
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', '/'); const out = arg('out', 'dist');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'esm', outfile: out + '/app.js', target: 'es2022', legalComments: 'none',
  define: { 'window.__MT_BASE__': JSON.stringify(base) } });
cpSync('public', out, { recursive: true });
await build({ entryPoints: ['src/worker/lazy.js'], bundle: true, minify: true, format: 'iife', globalName: 'MtLazy', outfile: out + '/core/mt-lazy.js', target: 'es2022', legalComments: 'none' });
cpSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', out + '/pdf.worker.min.mjs');
const html = readFileSync('index.template.html', 'utf8').replaceAll('%BASE%', base);
writeFileSync(out + '/index.html', html); writeFileSync(out + '/404.html', html);
const version = createHash('sha1').update(readFileSync(out + '/app.js')).update(readFileSync(out + '/app.css')).digest('hex').slice(0, 10);
const walk = (d, pre = '') => readdirSync(d).flatMap((f) => (statSync(d + '/' + f).isDirectory() ? walk(d + '/' + f, pre + f + '/') : [pre + f]));
const precache = walk(out).filter((f) => !/^(sw\.js|404\.html|vercel\.json|mt-first-load\.json|og\.png|.*OFL\.txt|core\/biber\.js|core\/busytex_biber\.js)$/.test(f)); // biber (1 MB) only for biblatex papers: cached when first used
writeFileSync(out + '/sw.js', readFileSync('sw.template.js', 'utf8').replaceAll('%PRECACHE%', JSON.stringify(precache)).replaceAll('%BASE%', base).replaceAll('%VERSION%', version));
if (base === '/') cpSync('vercel.json', out + '/vercel.json'); // Vercel mirror: rewrites for /abs/<id> and /pdf/<id>
if (existsSync('first-load.json')) cpSync('first-load.json', out + '/mt-first-load.json');
console.log('built', out, 'base', base);
