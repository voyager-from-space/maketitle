// node scripts/first-minute.mjs <site> <id> <outPrefix>: screenshots of the preview pane over the first minute, and when it stops being blank
import { chromium } from '../node_modules/playwright/index.mjs';
const [site, id, out] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const t0 = Date.now(); await p.goto(site.replace(/\/$/, '') + '/' + (id.startsWith('zip') ? '' : 'abs/' + id));
const res = {};
await p.waitForFunction(() => document.querySelector('#pdf canvas'), null, { timeout: 120000 }).then(() => { res.firstPdfMs = Date.now() - t0; }).catch(() => {});
res.note = await p.$eval('#pdfnote', (n) => (n.hidden ? '' : n.textContent)).catch(() => null);
await p.waitForTimeout(600); await p.screenshot({ path: out + '-1-first.png' });
await p.waitForFunction(() => window.__mt && window.__mt.last && window.__mt.last.shown, null, { timeout: 600000 }).catch(() => {});
res.buildMs = Date.now() - t0; res.ok = await p.evaluate(() => window.__mt.last && window.__mt.last.ok);
res.noteAfter = await p.$eval('#pdfnote', (n) => (n.hidden ? '' : n.textContent)).catch(() => null);
res.canvasAfter = await p.$$eval('#pdf canvas', (c) => c.length);
res.sheetAfter = await p.$eval('#pdf', (e) => e.innerText.slice(0, 200)).catch(() => null);
await p.waitForTimeout(800); await p.screenshot({ path: out + '-2-after.png' });
console.log(JSON.stringify(res)); await b.close();
