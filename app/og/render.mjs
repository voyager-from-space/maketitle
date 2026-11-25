// renders og/card.html to public/og.png at 1200x630 (headless Chrome)
import { chromium } from '../../node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file://' + new URL('./card.html', import.meta.url).pathname); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
await p.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname });
await b.close();
