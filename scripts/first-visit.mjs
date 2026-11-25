// node scripts/first-visit.mjs <site> <id>: bytes on the wire per host for a first visit (fresh profile) until the paper is compiled
import { chromium } from '../node_modules/playwright/index.mjs';
const [site, id] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p); await cdp.send('Network.enable');
const urls = new Map(), hosts = {}; let n = 0;
const add = (u, bytes) => { const h = new URL(u).host; hosts[h] = (hosts[h] || 0) + bytes; n++; };
cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
cdp.on('Network.loadingFinished', (e) => { const u = urls.get(e.requestId); if (u && /^https?:/.test(u)) add(u, e.encodedDataLength); });
// worker requests (TeX Live packs) are not on the page's session: count them from the service worker / dedicated worker targets
// Playwright also reports the dedicated worker's requests (TeX Live packs, engine) on the context
const pw = {}; let pn = 0, pending = [];
ctx.on('requestfinished', (r) => pending.push(r.sizes().then((z) => { const h = new URL(r.url()).host; pw[h] = (pw[h] || 0) + z.responseBodySize + z.responseHeadersSize; pn++; }).catch(() => {})));
const t0 = Date.now(); await p.goto(site.replace(/\/$/, '') + '/abs/' + id);
await p.waitForFunction(() => window.__mt && window.__mt.last && !window.__mt.busy && window.__mt.last.shown, null, { timeout: 600000 });
const ms = Date.now() - t0; await p.waitForTimeout(1500); await Promise.all(pending);
const app = await p.evaluate(() => ({ ok: window.__mt.last.ok, lazyNet: window.__mt.last.lazy && window.__mt.last.lazy.net, firstLoadBytes: window.__mt.firstLoadBytes }));
// resource timing from the page covers the app shell; the worker's TeX Live traffic is reported by the lazy loader itself
const MB = (x) => +(x / 1e6).toFixed(2);
console.log(JSON.stringify({ id, ms, ok: app.ok, pageHosts: Object.fromEntries(Object.entries(hosts).map(([h, v]) => [h, MB(v)])), allHosts: Object.fromEntries(Object.entries(pw).map(([h, v]) => [h, MB(v)])), allRequests: pn, totalMB: MB(Object.values(pw).reduce((a, b) => a + b, 0)), texLiveMB: MB(app.lazyNet || 0), requests: n }));
await b.close();
