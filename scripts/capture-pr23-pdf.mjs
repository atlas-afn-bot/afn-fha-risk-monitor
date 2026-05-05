// PR-2.3 PDF capture script. Mirrors capture-pr22-pdf.mjs but writes the
// output PDF to verification/PR-2.3-output.pdf for visual review.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'verification');
fs.mkdirSync(OUT_DIR, { recursive: true });

const APP_URL = process.env.APP_URL || 'http://localhost:8080/';

const STUB_BULLETS = [
  { text: 'Termination Risk: 3 offices breach the 200% HUD compare-ratio threshold with >100 loans.', severity: 'red' },
  { text: 'Wholesale channel runs DPA concentration much higher than retail — primary CR driver.', severity: 'yellow' },
  { text: 'DPA loans deliquent at ~2.4x the rate of Standard FHA.', severity: 'red' },
  { text: 'Boost program removals reduce 6 of 8 termination-risk offices below 200%.', severity: 'green' },
  { text: 'LTV >95% bucket carries the highest delinquency rate.', severity: 'yellow' },
  { text: 'Honolulu and Buffalo register extreme CRs on small samples.', severity: 'neutral' },
  { text: 'Manual underwriting contributes disproportionately to seriously-delinquent loans.', severity: 'yellow' },
  { text: 'HUD field offices retain authority to suspend underwriting at >200%.', severity: 'neutral' },
];

async function captureFirstPagePng(pdfPath, pngPath) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('pdftoppm', ['-r', '120', '-png', '-f', '1', '-l', '1', pdfPath, pngPath.replace(/\.png$/, '')]);
  if (r.status !== 0) return false;
  const candidate = pngPath.replace(/\.png$/, '-1.png');
  if (fs.existsSync(candidate)) {
    fs.renameSync(candidate, pngPath);
    return true;
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', err => console.error('[browser pageerror]', err.message));
  page.on('console', msg => { if (msg.type() === 'error') console.error('[browser console error]', msg.text()); });

  console.log('[capture] navigating', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Export PDF/i }).waitFor({ timeout: 30000 });

  const stubJSON = JSON.stringify(STUB_BULLETS);
  await page.evaluate((bullets) => {
    const keys = [];
    document.querySelectorAll('option').forEach(o => { if (o.value && /^\d{4}-\d{2}$/.test(o.value)) keys.push(o.value); });
    const now = new Date();
    keys.push(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    keys.push('2026-03', '2026-04', '2026-02');
    [...new Set(keys)].forEach(k => { localStorage.setItem(`fha-ai-summary-${k}`, bullets); });
  }, stubJSON);

  console.log('[capture] clicking Export PDF');
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: /Export PDF/i }).click();
  const download = await downloadPromise;
  const pdfPath = path.join(OUT_DIR, 'PR-2.3-output.pdf');
  await download.saveAs(pdfPath);
  console.log('[capture] saved PDF', pdfPath);

  const pngPath = path.join(OUT_DIR, 'PR-2.3-page1.png');
  const ok = await captureFirstPagePng(pdfPath, pngPath);
  console.log('[capture] page1 png', ok ? pngPath : 'NOT GENERATED');

  await browser.close();
  console.log('PDF:', pdfPath);
  if (ok) console.log('PNG:', pngPath);
})().catch(err => { console.error('[capture] FAILED:', err); process.exit(1); });
