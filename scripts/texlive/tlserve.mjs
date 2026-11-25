// static server with CORS for local tests of the lazy tree; optional per-request delay (ms) to mimic network latency
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [dir, port, delay = 0] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4] || 0)];
let n = 0, bytes = 0;
http.createServer((req, res) => {
  const f = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  setTimeout(() => {
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'access-control-allow-origin': '*' }); return res.end(); }
    const st = fs.statSync(f); n++; bytes += st.size;
    if (req.url === '/__stats') return;
    res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream', 'content-length': st.size }); fs.createReadStream(f).pipe(res);
  }, delay);
}).listen(port, () => console.log('tl serving', dir, port));
process.on('SIGUSR2', () => console.log('requests', n, 'bytes', bytes));
