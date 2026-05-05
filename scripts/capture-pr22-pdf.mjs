// PR-2.2 PDF capture script.
// Spins up a Chromium tab against the running dev server, seeds an AI bullet
// cache so the Risk Factors panel renders narrative content, triggers the
// Export PDF button, saves the resulting PDF, and emits the first page as
// a PNG for the PR description.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'tmp', 'pr-2.2-capture');
fs.mkdirSync(OUT_DIR, { recursive: true });

const APP_URL = process.env.APP_URL || 'http://localhost:8080/';

const STUB_BULLETS = [
  { text: 'Termination Risk: 3 offices breach the 200% HUD compare-ratio threshold with >100 loans (Sacramento 247%, Anaheim 235%, Riverside 223%).', severity: 'red' },
  { text: 'Wholesale channel runs DPA concentration at ~58% versus retail at ~24% — primary driver of the elevated portfolio compare ratio.', severity: 'yellow' },
  { text: 'DPA loans deliquent at ~2.4x the rate of Standard FHA (8.2% vs 3.4%); concentration risk compounds underperformance.', severity: 'red' },
  { text: 'Boost program removals reduce 6 of 8 termination-risk offices below the 200% threshold; remaining 2 still exceed after EG adjustments.', severity: 'green' },
  { text: 'LTV >95% bucket carries the highest delinquency rate (9.1%); reserves <3 months also show elevated DQ vs portfolio average.', severity: 'yellow' },
  { text: 'Honolulu and Buffalo register extreme compare ratios on small samples (<25 loans) — visible in Low-Volume Watch, not the headline matrix.', severity: 'neutral' },
  { text: 'Manual underwriting represents ~12% of portfolio but contributes disproportionately to the seriously-delinquent population.', severity: 'yellow' },
  { text: 'Individual HUD field offices retain authority to suspend underwriting at >200% — committee should pre-empt with corrective action plans.', severity: 'neutral' },
];

async function captureFirstPagePng(pdfPath, pngPath) {
  // Use poppler's pdftoppm if available; fall back silently if not installed.
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('pdftoppm', [
    '-r', '120', '-png', '-f', '1', '-l', '1', pdfPath, pngPath.replace(/\.png$/, ''),
  ]);
  if (r.status !== 0) {
    console.warn('[capture] pdftoppm failed or not installed; skipping PNG conversion');
    return false;
  }
  // pdftoppm names output as `<prefix>-1.png` for single page.
  const candidate = pngPath.replace(/\.png$/, '-1.png');
  if (fs.existsSync(candidate)) {
    fs.renameSync(candidate, pngPath);
    return true;
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();

  // Capture console errors for diagnostics.
  page.on('pageerror', err => console.error('[browser pageerror]', err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('[browser console error]', msg.text());
  });

  // Hit the page once to establish origin so localStorage is writable.
  console.log('[capture] navigating', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

  // Discover the active period — read it after the dashboard mounts. The
  // app uses ?period=YYYY-MM in the URL after first selection; otherwise
  // defaults to the most recent snapshot index entry.
  // Wait for the Export PDF button to render so we know data has loaded.
  await page.getByRole('button', { name: /Export PDF/i }).waitFor({ timeout: 30000 });

  // Read the current period from the URL query string or fall back to
  // localStorage hints. We seed bullets for ALL plausible keys: the visible
  // selectedPeriod, the snapshot-index latest, and the human-format
  // performancePeriod label that older callers may use as fallback.
  const periodHints = await page.evaluate(async () => {
    const search = new URLSearchParams(window.location.search);
    const selected = search.get('period');
    return { selected };
  });
  console.log('[capture] period hints', periodHints);

  // Seed AI cache for likely keys: explicit period, current month, and a
  // generic fallback. ExportPDF tries cachePeriod first then performancePeriod.
  const stubJSON = JSON.stringify(STUB_BULLETS);
  await page.evaluate((bullets) => {
    // Discover all snapshot periods present in the loaded index by inspecting
    // any select option text or fallback keys. To be robust, just seed a
    // broad set of candidate keys and let the export pick the first match.
    const keys = [];
    // Scrape select dropdown options if present (MonthSelector renders periods).
    document.querySelectorAll('option').forEach(o => {
      if (o.value && /^\d{4}-\d{2}$/.test(o.value)) keys.push(o.value);
    });
    // Common fallbacks
    const now = new Date();
    keys.push(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    keys.push('2026-03');
    keys.push('2026-04');
    keys.push('2026-02');
    // De-dupe + write
    [...new Set(keys)].forEach(k => {
      localStorage.setItem(`fha-ai-summary-${k}`, bullets);
    });
  }, stubJSON);

  // Trigger PDF export. jsPDF's `doc.save()` triggers a browser download.
  console.log('[capture] clicking Export PDF');
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: /Export PDF/i }).click();
  const download = await downloadPromise;
  const pdfPath = path.join(OUT_DIR, 'FHA_Risk_Report_PR-2.2.pdf');
  await download.saveAs(pdfPath);
  console.log('[capture] saved PDF', pdfPath);

  // Convert first page of the PDF to PNG for the PR description.
  const pngPath = path.join(OUT_DIR, 'pr-2.2-page1.png');
  const ok = await captureFirstPagePng(pdfPath, pngPath);
  console.log('[capture] page1 png', ok ? pngPath : 'NOT GENERATED');

  await browser.close();
  console.log('[capture] done');
  console.log('PDF:', pdfPath);
  if (ok) console.log('PNG:', pngPath);
})().catch(err => {
  console.error('[capture] FAILED:', err);
  process.exit(1);
});
