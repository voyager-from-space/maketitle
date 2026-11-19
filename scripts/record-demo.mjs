// node scripts/record-demo.mjs <siteUrl> <outDir>
// Clean headless Chrome (throwaway user-data-dir, no real profile). Phase 1 warms the TeX Live cache with no recording,
// phase 2 records the demo at 1280x720 with Playwright recordVideo.
import { chromium } from '../node_modules/playwright/index.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const site = process.argv[2].replace(/\/$/, '') + '/'; const out = process.argv[3]; fs.mkdirSync(out, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-demo-'));
const opts = { executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: true, viewport: { width: 1280, height: 720 } };
const done = (page) => page.waitForFunction(() => window.__mt && window.__mt.last && !window.__mt.busy && window.__mt.last.shown, null, { timeout: 600000 });
{ // warm-up
  const ctx = await chromium.launchPersistentContext(dir, opts); const p = await ctx.newPage();
  await p.goto(site + 'abs/1706.03762'); await done(p); await ctx.close();
}
const ctx = await chromium.launchPersistentContext(dir, { ...opts, recordVideo: { dir: path.join(dir, 'vid'), size: { width: 1280, height: 720 } } });
const page = await ctx.newPage(); const t0 = Date.now(); const stamp = {};
const still = async (name) => { stamp[name] = Date.now() - t0; await page.screenshot({ path: path.join(out, `maketitle-launch-${name}.png`) }); };
await page.goto(site); await page.waitForTimeout(2500); await still('1-home');
await page.click('#q'); await page.keyboard.type('https://arxiv.org/abs/1706.03762', { delay: 45 }); await page.waitForTimeout(500);
await page.keyboard.press('Enter');
await page.waitForSelector('#gate-ok', { timeout: 60000 }); await page.waitForTimeout(2200); await still('2-warning');
await page.click('#gate-ok'); await page.waitForTimeout(300);
await done(page); await page.waitForTimeout(1200); await still('3-compiled');
// put the cursor before "All" in \title{Attention Is All You Need} and type
await page.evaluate(() => { const v = window.__mt.editor.view; const t = v.state.doc.toString(); const i = t.indexOf('Attention Is All You Need') + 'Attention Is '.length; v.dispatch({ selection: { anchor: i }, scrollIntoView: true }); v.focus(); window.__mt.last = null; });
await page.waitForTimeout(900); await page.keyboard.type('Not ', { delay: 140 }); await page.waitForTimeout(700); await still('4-edited');
await page.keyboard.press('Control+Enter');
await done(page); await page.waitForTimeout(2800); await still('5-recompiled');
const total = Date.now() - t0;
const rec = await page.evaluate(async () => { const l = window.__mt.last; const pg = await window.__mt.preview.doc.getPage(1); const tc = await pg.getTextContent(); return { totalMs: l.totalMs, newTitle: tc.items.map((i) => i.str).join('').replace(/\s+/g, '').includes('AttentionIsNotAllYouNeed') }; });
const video = page.video(); await ctx.close(); const webm = await video.path(); fs.copyFileSync(webm, path.join(out, 'maketitle-launch-demo.webm'));
console.log(JSON.stringify({ stamp, totalMs: total, rec }));
