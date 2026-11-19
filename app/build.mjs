// node build.mjs [--base /maketitle/] [--out dist]
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', '/'); const out = arg('out', 'dist');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'esm', outfile: out + '/app.js', target: 'es2022', legalComments: 'none',
  define: { 'window.__MT_BASE__': JSON.stringify(base) } });
cpSync('public', out, { recursive: true });
cpSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', out + '/pdf.worker.min.mjs');
const html = readFileSync('index.template.html', 'utf8').replaceAll('%BASE%', base);
writeFileSync(out + '/index.html', html); writeFileSync(out + '/404.html', html);
if (existsSync('first-load.json')) cpSync('first-load.json', out + '/mt-first-load.json');
console.log('built', out, 'base', base);
