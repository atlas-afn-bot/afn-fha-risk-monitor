#!/usr/bin/env node
/**
 * Capture screenshots of the new Projections tab for the PR description.
 *
 * Renders base / worst / best scenarios at the 3-mo horizon, the
 * methodology inline panel expanded, and the loan-level drill-down open
 * on Charleston / Lubbock / Shreveport.
 *
 * Uses playwright core (system browser). Assumes the preview server is
 * running at http://127.0.0.1:4173.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = path.resolve(process.cwd(), 'tmp/projections-screenshots');
const BASE = 'http://127.0.0.1:4173';

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 2100 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const nav = async (url) => {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
  };

  const clickScenario = async (label) => {
    // The scenario toggle buttons are plain <button>s with the label text.
    const btn = page.getByRole('button', { name: label, exact: true }).first();
    await btn.click();
    await page.waitForTimeout(400);
  };

  const shoot = async (name) => {
    const p = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: p, fullPage: true });
    console.log('wrote', p);
  };

  // --- Base scenario, 3mo, All AFN ---
  await nav(`${BASE}/?tab=projections`);
  await shoot('01-projections-base-3mo');

  // Ensure controls are the 3-mo default; then switch scenario for worst/best
  await clickScenario('Worst');
  await shoot('02-projections-worst-3mo');

  await clickScenario('Best');
  await shoot('03-projections-best-3mo');

  // Back to base + expand methodology
  await clickScenario('Base');
  const methBtn = page.getByRole('button', { name: /How is this calculated/i }).first();
  await methBtn.click();
  await page.waitForTimeout(600);
  await shoot('04-projections-methodology-open');

  // Full-page methodology
  await nav(`${BASE}/methodology/projections`);
  await shoot('05-methodology-page');

  // Loan-level drill-down for Charleston / Lubbock / Shreveport
  await nav(`${BASE}/?tab=projections`);
  await page.getByPlaceholder(/Filter offices by name/i).fill('charleston');
  await page.waitForTimeout(400);
  // Click the Charleston row
  const charleston = page.getByRole('button', { name: /^Charleston/ }).first();
  await charleston.click();
  await page.waitForTimeout(600);
  await shoot('06-drilldown-charleston');

  await page.getByPlaceholder(/Filter offices by name/i).fill('lubbock');
  await page.waitForTimeout(400);
  const lubbock = page.getByRole('button', { name: /^Lubbock/ }).first();
  await lubbock.click();
  await page.waitForTimeout(600);
  await shoot('07-drilldown-lubbock');

  await page.getByPlaceholder(/Filter offices by name/i).fill('shreveport');
  await page.waitForTimeout(400);
  const shreveport = page.getByRole('button', { name: /^Shreveport/ }).first();
  await shreveport.click();
  await page.waitForTimeout(600);
  await shoot('08-drilldown-shreveport');

  await browser.close();
  console.log('done');
}

main().catch(e => { console.error(e); process.exit(1); });
