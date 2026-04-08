/**
 * Persistent storage for historical HUD data using IndexedDB.
 * Each HUD file upload stores a monthly snapshot that builds the trend chart.
 */

import { openDB } from './db';

const STORE_NAME = 'hud-history';

export interface HUDMonthlySnapshot {
  /** YYYY-MM format, e.g. "2026-02" */
  monthKey: string;
  /** Display label, e.g. "Feb 2026" */
  label: string;
  /** Performance period end date as string */
  performancePeriodEnd: string;
  /** Company-level overall compare ratio */
  overallCR: number;
  /** Company-level retail compare ratio */
  retailCR: number;
  /** Company-level wholesale compare ratio */
  wholesaleCR: number;
  /** Total loans underwritten */
  totalLoans: number;
  /** Total delinquent */
  totalDLQ: number;
  /** Overall DQ rate % */
  dqRate: number;
  /** When this snapshot was stored */
  storedAt: string;
}

// openDB imported from shared db.ts

export async function saveHUDSnapshot(snapshot: HUDMonthlySnapshot): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(snapshot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllSnapshots(): Promise<HUDMonthlySnapshot[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const results = (request.result as HUDMonthlySnapshot[])
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteSnapshot(monthKey: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(monthKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllSnapshots(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Extract company-level compare ratios from the HUD office data.
 * The company's overall CR is computed from the sum of all office data.
 */
export function extractSnapshotFromHUD(
  offices: { totalCR: number; retailCR: number; wsCR: number; totalLoansUW: number; totalDLQ: number; retailLoans: number; retailDLQ: number; sponsoredLoans: number; sponsoredDLQ: number; hudOfficeDQPct: number; areaRetailDQPct: number; areaSponsoredDQPct: number }[],
  performancePeriod: string,
): HUDMonthlySnapshot | null {
  // Parse the performance period to get the end date and month key
  // Format: "March 1, 2024 — February 28, 2026" or "Through February 28, 2026"
  let endDate = '';
  let monthKey = '';
  let label = '';

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Try to parse "Month Day, Year" from the end of the period string
  const dateMatch = performancePeriod.match(/(\w+)\s+(\d+),?\s+(\d{4})\s*$/);
  if (dateMatch) {
    const monthIdx = monthNames.findIndex(m => m.toLowerCase() === dateMatch[1].toLowerCase());
    if (monthIdx >= 0) {
      const year = dateMatch[3];
      const mm = String(monthIdx + 1).padStart(2, '0');
      monthKey = `${year}-${mm}`;
      label = `${monthAbbr[monthIdx]} ${year}`;
      endDate = `${dateMatch[1]} ${dateMatch[2]}, ${year}`;
    }
  }

  // Also try MM/DD/YYYY format
  if (!monthKey) {
    const dateMatch2 = performancePeriod.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateMatch2) {
      const monthIdx = parseInt(dateMatch2[1], 10) - 1;
      monthKey = `${dateMatch2[3]}-${dateMatch2[1]}`;
      label = `${monthAbbr[monthIdx]} ${dateMatch2[3]}`;
      endDate = `${monthNames[monthIdx]} ${parseInt(dateMatch2[2], 10)}, ${dateMatch2[3]}`;
    }
  }

  if (!monthKey) return null;

  // Sum across all offices to get company-level metrics
  const totalLoans = offices.reduce((s, o) => s + o.totalLoansUW, 0);
  const totalDLQ = offices.reduce((s, o) => s + o.totalDLQ, 0);
  const retailLoans = offices.reduce((s, o) => s + o.retailLoans, 0);
  const retailDLQ = offices.reduce((s, o) => s + o.retailDLQ, 0);
  const wsLoans = offices.reduce((s, o) => s + o.sponsoredLoans, 0);
  const wsDLQ = offices.reduce((s, o) => s + o.sponsoredDLQ, 0);

  // Company-level DQ rates
  const totalDQRate = totalLoans > 0 ? (totalDLQ / totalLoans) * 100 : 0;
  const retailDQRate = retailLoans > 0 ? (retailDLQ / retailLoans) * 100 : 0;
  const wsDQRate = wsLoans > 0 ? (wsDLQ / wsLoans) * 100 : 0;

  // Weighted average area DQ rates (using loans as weights)
  let weightedAreaDQ = 0, weightedAreaRetailDQ = 0, weightedAreaWSDQ = 0;
  let totalWeight = 0, retailWeight = 0, wsWeight = 0;
  for (const o of offices) {
    if (o.totalLoansUW > 0 && o.hudOfficeDQPct > 0) {
      weightedAreaDQ += o.hudOfficeDQPct * o.totalLoansUW;
      totalWeight += o.totalLoansUW;
    }
    if (o.retailLoans > 0 && o.areaRetailDQPct > 0) {
      weightedAreaRetailDQ += o.areaRetailDQPct * o.retailLoans;
      retailWeight += o.retailLoans;
    }
    if (o.sponsoredLoans > 0 && o.areaSponsoredDQPct > 0) {
      weightedAreaWSDQ += o.areaSponsoredDQPct * o.sponsoredLoans;
      wsWeight += o.sponsoredLoans;
    }
  }

  const areaOverallDQ = totalWeight > 0 ? weightedAreaDQ / totalWeight : 1;
  const areaRetailDQ = retailWeight > 0 ? weightedAreaRetailDQ / retailWeight : 1;
  const areaWSDQ = wsWeight > 0 ? weightedAreaWSDQ / wsWeight : 1;

  // Company-level compare ratios
  const overallCR = Math.round((totalDQRate / areaOverallDQ) * 100);
  const retailCR = Math.round((retailDQRate / areaRetailDQ) * 100);
  const wholesaleCR = Math.round((wsDQRate / areaWSDQ) * 100);

  return {
    monthKey,
    label,
    performancePeriodEnd: endDate,
    overallCR,
    retailCR,
    wholesaleCR,
    totalLoans,
    totalDLQ,
    dqRate: totalDQRate,
    storedAt: new Date().toISOString(),
  };
}
