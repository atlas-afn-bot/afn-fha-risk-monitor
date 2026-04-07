import * as XLSX from 'xlsx';

export interface HUDOfficeData {
  name: string;
  totalCR: number;
  retailCR: number;
  wsCR: number;
  totalLoansUW: number;
  totalDLQ: number;
  dqPct: number;
  retailBranches: number;
  retailLoans: number;
  retailLoansPct: number;
  retailDLQ: number;
  retailDLQPct: number;
  sponsoredBranches: number;
  sponsoredLoans: number;
  sponsoredLoansPct: number;
  sponsoredDLQ: number;
  sponsoredDLQPct: number;
  hudOfficeTotalLoans: number;
  hudOfficeTotalDLQ: number;
  hudOfficeDQPct: number;
  areaRetailDQPct: number;
  areaSponsoredDQPct: number;
  supplementalMetric: number;
  mixAdjustedSDQRate: number;
  fhaPortfolioSPM: number;
  fhaPortfolioBenchmarkSDQ: number;
}

export interface HUDParseResult {
  offices: HUDOfficeData[];
  performancePeriod: string;
}

export function parseHUDFile(buffer: ArrayBuffer): HUDParseResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { header: 1, defval: '' });

  // Find header row — look for the row where column 0 is "HUD Office" AND
  // column 1 contains "Compare Ratio" (to distinguish from title rows that
  // also mention "HUD Office")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i] as any[];
    if (row &&
      String(row[0]).trim().toUpperCase().includes('HUD OFFICE') &&
      String(row[1] ?? '').trim().toUpperCase().includes('COMPARE RATIO')
    ) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    throw new Error('Could not find HUD Office header row in the uploaded file');
  }

  // Extract performance period from the rows before the header
  // Look for "Data shown includes all insured single family loans with beginning amortization date between..."
  let performancePeriod = '';
  for (let i = 0; i < headerIdx; i++) {
    const row = rows[i] as any[];
    const text = String(row?.[0] ?? '').trim();
    if (text.toLowerCase().includes('amortization date between')) {
      // Extract the date range: "between March 1, 2024 and February 28, 2026"
      const match = text.match(/between\s+(.+?)\s+and\s+(.+?)$/i);
      if (match) {
        performancePeriod = `${match[1].trim()} — ${match[2].trim()}`;
      } else {
        performancePeriod = text;
      }
      break;
    }
    // Also check for "Performance Period" row (e.g. "Performance Period - 02/28/2026")
    if (!performancePeriod && text.toLowerCase().includes('performance period')) {
      const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (dateMatch) {
        // Parse MM/DD/YYYY to readable format
        const [mm, dd, yyyy] = dateMatch[1].split('/');
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const monthName = months[parseInt(mm, 10) - 1] || mm;
        performancePeriod = `Through ${monthName} ${parseInt(dd, 10)}, ${yyyy}`;
      } else {
        performancePeriod = text.replace(/performance period\s*[-:]?\s*/i, '').trim();
      }
    }
  }

  const results: HUDOfficeData[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as any[];
    if (!row || !row[0]) continue;

    const name = String(row[0]).trim().toUpperCase();
    // Skip summary/footer rows
    if (!name || name.startsWith('REPORT') || name.startsWith('OUTPUT') || name.startsWith('LOAN TYPE') || name.startsWith('DATA SHOWN')) continue;

    const num = (val: any): number => {
      const n = Number(val);
      return isNaN(n) ? 0 : n;
    };

    results.push({
      name,
      totalCR: num(row[1]),
      retailCR: num(row[2]),
      wsCR: num(row[3]),
      totalLoansUW: num(row[4]),
      totalDLQ: num(row[5]),
      dqPct: num(row[6]),
      retailBranches: num(row[7]),
      retailLoans: num(row[8]),
      retailLoansPct: num(row[9]),
      retailDLQ: num(row[10]),
      retailDLQPct: num(row[11]),
      sponsoredBranches: num(row[12]),
      sponsoredLoans: num(row[13]),
      sponsoredLoansPct: num(row[14]),
      sponsoredDLQ: num(row[15]),
      sponsoredDLQPct: num(row[16]),
      hudOfficeTotalLoans: num(row[17]),
      hudOfficeTotalDLQ: num(row[18]),
      hudOfficeDQPct: num(row[19]),
      areaRetailDQPct: num(row[22]),
      areaSponsoredDQPct: num(row[25]),
      supplementalMetric: num(row[26]),
      mixAdjustedSDQRate: num(row[27]),
      fhaPortfolioSPM: num(row[28]),
      fhaPortfolioBenchmarkSDQ: num(row[29]),
    });
  }

  return { offices: results, performancePeriod };
}
