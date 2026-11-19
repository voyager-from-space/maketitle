// node scripts/features.mjs <siteUrl-with-base> <arxivId> [--local <distDir> <port>]
// Phase A (desktop, online): modes, timing panel, autosave + reload, /pdf view. Phase B: same browser profile restarted with no network.
// Phase M: phone-sized viewport. Uses a throwaway Chrome profile, never a real one.
import { chromium } from '../node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const site = process.argv[2].replace(/\/$/, '') + '/'; const ID = process.argv[3];
const li = process.argv.indexOf('--local'); const local = li > 0 ? { dir: process.argv[li + 1], port: process.argv[li + 2] } : null;
const exe = process.env.CHROME || '/usr/bin/google-chrome';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-prof-'));
const out = { site, id: ID, startedAt: new Date().toString() }; const errs = [];
let srv = null; if (local) srv = spawn('node', ['app/serve.mjs', local.dir, local.port, '/'], { stdio: 'ignore' });
const launch = (extra = [], opts = {}) => chromium.launchPersistentContext(prof, { executablePath: exe, args: ['--no-sandbox', ...extra], viewport: { width: 1280, height: 720 }, acceptDownloads: true, ...opts });
const waitDone = (page, ms = 600000) => page.waitForFunction(() => { const m = window.__mt; return m && m.last && !m.busy && m.last.shown; }, null, { timeout: ms });
const idb = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('maketitle'); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains('projects')) return res([]); const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => res(q.result.map((x) => ({ key: x.key, edited: x.edited, files: x.files.length, savedAt: x.savedAt, title: (x.files.find(([p]) => p === x.main) || [0, ''])[1].match(/\\title\{([^}]*)/)?.[1] }))); }; r.onerror = () => res([]); }));
const gate = async (page) => { const g = await page.$('#gate-ok'); if (g && await g.isVisible()) await g.click(); };
const snap = (page, n) => page.screenshot({ path: `test/out/f-${n}.png` });
const hook = (page, tag) => { page.on('pageerror', (e) => errs.push(tag + ' pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(tag + ' console ' + m.text().slice(0, 200)); }); };

// ---------- A ----------
let ctx = await launch(); let page = await ctx.newPage(); hook(page, 'A');
await page.goto(site + 'abs/' + ID); await waitDone(page); await gate(page);
const a = out.A = {};
Object.assign(a, await page.evaluate(() => ({ ok: window.__mt.last.ok, totalMs: window.__mt.last.totalMs, pages: window.__mt.last.numPages, netMB: +(window.__mt.compiler.netBytes / 1048576).toFixed(1) })));
await page.evaluate(() => navigator.serviceWorker.ready);
for (let i = 0; i < 240; i++) { if ((await page.evaluate(async () => (await (await caches.open('mt-core-v2')).keys()).length)) >= 10) break; await page.waitForTimeout(500); }
a.sw = await page.evaluate(async () => ({ controlled: !!navigator.serviceWorker.controller, caches: await caches.keys(), core: (await (await caches.open('mt-core-v2')).keys()).length, assets: (await (await caches.open('mt-assets-v1')).keys()).length }));
a.idbAfterLoad = await idb(page);
// timing panel
await page.click('#timing'); await page.waitForSelector('.tp-passes tr');
a.timing = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.tp-passes tr')].map((r) => r.innerText.replace(/\s+/g, ' ')), kv: document.querySelector('.tp-kv').innerText.replace(/\n/g, ' | '), finds: [...document.querySelectorAll('.tp-find li')].length, text: document.querySelector('.tp-sec h3') ? [...document.querySelectorAll('.tp-sec h3')].map((x) => x.textContent) : [] }));
await snap(page, 'desktop-timing'); await page.click('#timing .close, .timingp .close');
// preview build (1 pass)
await page.selectOption('#mode', 'quick'); await page.click('#run'); await page.waitForTimeout(300); await waitDone(page);
a.preview = await page.evaluate(() => ({ ok: window.__mt.last.ok, mode: window.__mt.last.mode, passes: window.__mt.last.passes, totalMs: window.__mt.last.totalMs, pages: window.__mt.last.numPages }));
// full again for the baseline of a warm full build
await page.selectOption('#mode', 'full'); await page.click('#run'); await page.waitForTimeout(300); await waitDone(page);
a.fullWarm = await page.evaluate(() => ({ ok: window.__mt.last.ok, totalMs: window.__mt.last.totalMs, passes: window.__mt.last.passes, pages: window.__mt.last.numPages }));
// one chapter
const files = await page.evaluate(() => [...window.__mt.project.files.keys()].filter((p) => /\.tex$/.test(p) && p !== window.__mt.project.main));
a.texFiles = files; const ch = process.env.CHAPTER || files.find((f) => /background|related|intro/i.test(f)) || files[0];
if (ch) {
  await page.click(`#files button[title="${ch}"]`); await page.selectOption('#mode', 'chapter'); await page.click('#run'); await page.waitForTimeout(300); await waitDone(page);
  a.chapter = await page.evaluate(() => ({ file: window.__mt.last.chapter, ok: window.__mt.last.ok, totalMs: window.__mt.last.totalMs, passes: window.__mt.last.passes, pages: window.__mt.last.numPages, status: document.querySelector('#status').textContent, meter: document.querySelector('#meter').innerText.replace(/\n/g, ' | ') }));
  await snap(page, 'desktop-chapter');
}
// edit + autosave + reload
await page.selectOption('#mode', 'full'); await page.click('#files button[title="' + (await page.evaluate(() => window.__mt.project.main)) + '"]');
await page.evaluate(() => { const v = window.__mt.editor.view; const t = v.state.doc.toString(); const i = t.indexOf('Attention Is All You Need'); if (i >= 0) v.dispatch({ changes: { from: i, to: i + 25, insert: 'Attention Is Saved Offline' } }); });
for (let k = 0; k < 40; k++) { if ((await idb(page)).some((x) => x.edited)) break; await page.waitForTimeout(250); }
a.savedAfterEdit = await idb(page);
await page.reload(); await waitDone(page); await gate(page);
a.reloadAfterMs = 0;
a.reload = await page.evaluate(() => ({ title: window.__mt.project.title(), fromSaved: window.__mt.fromSaved, notice: document.querySelector('#notice').innerText.replace(/\n/g, ' '), ok: window.__mt.last.ok, totalMs: window.__mt.last.totalMs, netMB: +(window.__mt.compiler.netBytes / 1048576).toFixed(1) }));
await snap(page, 'desktop-restored');
// /pdf view
await page.goto(site + 'pdf/' + ID); await waitDone(page);
a.pdfView = await page.evaluate(() => ({ cls: document.body.className, sourceVisible: !!document.querySelector('.source').offsetParent, treeVisible: !!document.querySelector('.tree').offsetParent, pdfWidth: document.querySelector('#pdf').clientWidth, pages: window.__mt.last.numPages, fromSaved: window.__mt.fromSaved }));
await snap(page, 'desktop-pdfview');
await page.evaluate(() => { window.__mt.same = 1; }); await page.click('#v-abs'); await page.waitForTimeout(400);
a.pdfToEdit = await page.evaluate(() => ({ url: location.pathname, cls: document.body.className, sourceVisible: !!document.querySelector('.source').offsetParent, sameDoc: window.__mt.same === 1 }));
a.pdfDownload = await (async () => { const [d] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('#more summary'); await page.click('#dlpdf'); })()]); return d.suggestedFilename(); })();
await ctx.close();

// ---------- B: no network at all (DNS refuses every host, local server stopped) ----------
if (srv) { srv.kill(); await new Promise((r) => setTimeout(r, 400)); }
ctx = await launch(['--host-resolver-rules=MAP * ~NOTFOUND']); page = await ctx.newPage(); hook(page, 'B');
const b = out.B = {};
const t0 = Date.now();
await page.goto(site, { waitUntil: 'load' }).catch((e) => { b.homeError = e.message.slice(0, 120); });
await page.waitForSelector('#savedl li', { timeout: 10000 }).catch(() => {});
b.home = await page.evaluate(() => ({ saved: [...document.querySelectorAll('#savedl li')].map((l) => l.innerText.replace(/\s+/g, ' ')), title: document.title })).catch(() => null);
await page.goto(site + 'abs/' + ID); await waitDone(page, 300000); await gate(page);
b.abs = await page.evaluate(() => ({ ok: window.__mt.last.ok, fromSaved: window.__mt.fromSaved, title: window.__mt.project.title(), totalMs: window.__mt.last.totalMs, pages: window.__mt.last.numPages, netMB: +(window.__mt.compiler.netBytes / 1048576).toFixed(2), online: navigator.onLine, controlled: !!navigator.serviceWorker.controller }));
b.wallMs = Date.now() - t0; await snap(page, 'desktop-offline');
await page.goto(site + 'pdf/' + ID); await waitDone(page, 300000);
b.pdf = await page.evaluate(() => ({ cls: document.body.className, ok: window.__mt.last.ok, pages: window.__mt.last.numPages }));
await ctx.close();
if (local) srv = spawn('node', ['app/serve.mjs', local.dir, local.port, '/'], { stdio: 'ignore' });

// ---------- M: phone ----------
ctx = await launch([], { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); page = await ctx.newPage(); hook(page, 'M');
const m = out.M = {};
const overflow = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bodySw: document.body.scrollWidth }));
await page.goto(site); m.homeOverflow = await overflow(); await snap(page, 'mobile-home');
await page.goto(site + 'abs/' + ID); await waitDone(page); await gate(page);
m.afterCompileTab = await page.evaluate(() => document.querySelector('#panes').dataset.tab);
m.pdfOverflow = await overflow(); await page.tap('#tabs [data-tab=pdf]'); await page.waitForTimeout(800); m.pdfPageWidth0 = await page.evaluate(() => document.querySelector('.pdfpage')?.clientWidth); await snap(page, 'mobile-pdf');
await page.tap('#tabs [data-tab=source]'); m.sourceOverflow = await overflow(); await snap(page, 'mobile-source');
await page.tap('#tabs [data-tab=files]'); m.filesOverflow = await overflow(); await snap(page, 'mobile-files');
await page.tap('#tabs [data-tab=pdf]'); await page.waitForTimeout(500);
m.targets = await page.evaluate(() => Object.fromEntries(['#mode', '#run', '#timing', '#more summary', '#tabs [data-tab=files]', '#tabs [data-tab=source]', '#tabs [data-tab=pdf]'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, `${Math.round(r.width)}x${Math.round(r.height)}`]; })));
m.cmFont = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-content')).fontSize);
m.pdfPageWidth = await page.evaluate(() => document.querySelector('.pdfpage')?.clientWidth);
m.compile = await page.evaluate(() => ({ ok: window.__mt.last.ok, usedExtra: window.__mt.last.usedExtra, first: window.__mt.last.firstTry && window.__mt.last.firstTry.error, err: window.__mt.last.errors && window.__mt.last.errors[0] && window.__mt.last.errors[0].msg, ms: window.__mt.last.totalMs, fromSaved: window.__mt.fromSaved, net: window.__mt.compiler.netBytes }));
await page.tap('#timing'); await page.waitForSelector('.tp-passes tr'); m.timingOverflow = await overflow(); await snap(page, 'mobile-timing'); await page.tap('.timingp .close');
await page.tap('#more summary'); await snap(page, 'mobile-export'); await page.tap('#more summary');
await page.goto(site + 'pdf/' + ID); await waitDone(page); m.pdfViewTab = await page.evaluate(() => ({ tab: document.querySelector('#panes').dataset.tab, tabsVisible: !!document.querySelector('#tabs').offsetParent })); m.pdfViewOverflow = await overflow(); await snap(page, 'mobile-pdfview');
await ctx.close();
out.consoleErrors = errs; out.finishedAt = new Date().toString();
if (srv) srv.kill();
fs.writeFileSync('test/out/features.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
fs.rmSync(prof, { recursive: true, force: true });
