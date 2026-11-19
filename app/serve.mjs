// local static server with the same fallback GitHub Pages gives (unknown path -> 404.html)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [dir, port, base = '/'] = [process.argv[2], Number(process.argv[3]), process.argv[4]];
const types = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', woff2: 'font/woff2' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith(base)) p = '/' + p.slice(base.length); 
  let f = path.join(dir, p); if (f.endsWith('/')) f += 'index.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(path.join(dir, '404.html'))); }
  res.writeHead(200, { 'content-type': types[path.extname(f).slice(1)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('serving', dir, port));
