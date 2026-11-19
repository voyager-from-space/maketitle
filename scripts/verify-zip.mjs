// node scripts/verify-zip.mjs <siteUrl> a.zip,b.zip   (drop-zone path: file chooser -> editor -> compile)
import { chromium } from '../node_modules/playwright/index.mjs';
const site = process.argv[2].replace(/\/$/, '') + '/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
for (const z of process.argv[3].split(',')) {
  const page = await ctx.newPage(); await page.goto(site);
  await page.setInputFiles('#zip', z);
  const t0 = Date.now();
  await page.waitForFunction(() => window.__mt && window.__mt.last && !window.__mt.busy && window.__mt.last.shown, null, { timeout: 600000 });
  const r = await page.evaluate(() => { const l = window.__mt.last; return { ok: l.ok, pages: l.numPages, engine: l.engine, plan: l.plan && l.plan.why, totalMs: l.totalMs, passes: l.passes.length, usedExtra: l.usedExtra, undefinedRefs: l.undefinedRefs, errors: (l.errors || []).slice(0, 2), main: window.__mt.project.main, netMB: +(window.__mt.compiler.netBytes / 1048576).toFixed(1) }; });
  console.log(z.split('/').pop(), JSON.stringify(r), 'wallMs', Date.now() - t0); await page.close();
}
await browser.close();
