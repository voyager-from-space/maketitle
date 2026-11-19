// node scripts/verify.mjs <siteUrl-with-base> <id>[,<id>...] [--demo]  (uses a clean headless Chrome, nothing from a real profile)
import { chromium } from '../node_modules/playwright/index.mjs';
import fs from 'node:fs';
const site = process.argv[2].replace(/\/$/, '') + '/';
const ids = process.argv[3].split(',');
const demo = process.argv.includes('--demo');
const exe = process.env.CHROME || '/usr/bin/google-chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--enable-unsafe-webgpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const results = [];
const waitDone = (page, ms) => page.waitForFunction(() => { const m = window.__mt; return m && m.last && !m.busy && m.last.shown; }, null, { timeout: ms });
for (const id of ids) {
  const page = await ctx.newPage(); const logs = []; page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
  const t0 = Date.now();
  await page.goto(site + 'abs/' + id);
  const row = { id };
  try {
    await waitDone(page, 600000);
    row.wallMs = Date.now() - t0;
    Object.assign(row, await page.evaluate(() => { const l = window.__mt.last; return { ok: l.ok, pages: l.numPages, totalMs: l.totalMs, passes: l.passes, undefinedRefs: l.undefinedRefs, warnings: l.warnings, errors: (l.errors || []).slice(0, 3), engine: l.engine, usedExtra: l.usedExtra, firstTry: l.firstTry && l.firstTry.errors && l.firstTry.errors.slice(0,2), plan: l.plan && l.plan.why, firstLoadMB: window.__mt.firstLoadBytes ? +(window.__mt.firstLoadBytes / 1048576).toFixed(1) : null, initMs: window.__mt.initMs, fetchMs: window.__mt.fetchMs, main: window.__mt.project.main, files: window.__mt.project.files.size, leaks: window.__mt.leaks.length, err: l.error || null }; }));
    if (demo && id === '1706.03762') {
      const gate = await page.$('#gate-ok'); if (gate && await gate.isVisible()) await gate.click();
      row.titleBefore = await page.evaluate(() => window.__mt.project.title());
      await page.screenshot({ path: `test/out/${id}-1-compiled.png` });
      // edit \title in the editor and press Ctrl+Enter
      await page.evaluate(() => { const v = window.__mt.editor.view; const t = v.state.doc.toString(); const i = t.indexOf('Attention Is All You Need'); v.dispatch({ changes: { from: i, to: i + 'Attention Is All You Need'.length, insert: 'Attention Is Not All You Need' }, selection: { anchor: i } }); window.__mt.last = null; });
      await page.keyboard.press('Control+Enter');
      const t1 = Date.now();
      await waitDone(page, 300000);
      row.recompileMs = Date.now() - t1;
      row.recompile = await page.evaluate(() => ({ totalMs: window.__mt.last.totalMs, passes: window.__mt.last.passes, ok: window.__mt.last.ok }));
      row.pdfHasNewTitle = await page.evaluate(async () => { const d = window.__mt.preview.doc; const p = await d.getPage(1); const tc = await p.getTextContent(); return tc.items.map((i) => i.str).join('').replace(/\s+/g, '').includes('AttentionIsNotAllYouNeed'); });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `test/out/${id}-2-edited.png` });
    }
  } catch (e) { row.fail = String(e.message).slice(0, 300); await page.screenshot({ path: `test/out/${id}-fail.png` }).catch(() => {}); }
  row.consoleErrors = logs;
  results.push(row); console.log(JSON.stringify(row)); await page.close();
}
await browser.close();
fs.writeFileSync('test/out/results.json', JSON.stringify(results, null, 1));
