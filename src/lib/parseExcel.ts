import * as XLSX from 'xlsx';
import type { LoanRecord, ParsedLoan } from './types';

/**
 * Determine if a Boost DPA loan would have been filtered out
 * by the Enhanced Boost DPA Guidelines:
 *
 * a. Min FICO 640 regardless of AUS type
 * b. FHA auto-approved (DU/LP):
 *    i.  FICO < 680 → 2 months PITIA reserves (gift funds NOT allowed for reserves)
 *    ii. FICO ≥ 680 → 1 month PITIA reserves (gift funds OK)
 * c. FHA manual UW:
 *    i.   FICO ≥ 680 → 1 month PITIA reserves (gift funds NOT allowed)
 *    ii.  FICO < 680 → 3 months PITIA reserves (gift funds NOT allowed)
 *    iii. FICO < 680 → payment shock ≤ 100%
 *    iv.  (Housing history — not in data, skipped)
 * d. 3-4 units NOT allowed
 */
function checkEnhancedGuidelines(loan: {
  FICO: number;
  Units: string;
  AUSType: string;
  ReserveMonths: number;
  GiftFunds: string; // dollar amount as string
  PaymentShock: number;
  PaymentShockOver100: string; // "Yes"/"No" flag — more reliable than raw shock value
  isBoost: boolean;
}): boolean {
  if (!loan.isBoost) return false;

  const fico = loan.FICO;
  const units = Number(loan.Units) || 0;
  const aus = loan.AUSType.toUpperCase().trim();
  const reserves = loan.ReserveMonths;
  const giftAmount = Number(loan.GiftFunds) || 0;
  const hasGiftFunds = giftAmount > 0;
  const shockOver100 = loan.PaymentShockOver100.toUpperCase().trim() === 'YES';

  // a. Min FICO 640
  if (fico > 0 && fico < 640) return true;

  // d. 3-4 units not allowed
  if (units >= 3) return true;

  // Determine if manual or auto-approved
  // AUS values in data: "Manual Underwriting", "DU", "LP"
  const isManual = aus.includes('MANUAL');
  // DU and LP are auto-approved AUS systems
  const isAutoApproved = aus === 'DU' || aus === 'LP' || (!isManual && aus !== '');

  if (isAutoApproved) {
    if (fico < 680) {
      // b.i. Need 2 months reserves, gift funds NOT allowed for reserves
      if (reserves < 2) return true;
      if (hasGiftFunds) return true;
    } else {
      // b.ii. FICO ≥ 680 → need 1 month reserves (gift OK)
      if (reserves < 1) return true;
    }
  }

  if (isManual) {
    if (fico >= 680) {
      // c.i. Need 1 month reserves, gift funds NOT allowed
      if (reserves < 1) return true;
      if (hasGiftFunds) return true;
    } else {
      // c.ii-iii. FICO < 680
      if (reserves < 3) return true;
      if (hasGiftFunds) return true;
      // Payment shock must be ≤ 100%
      if (shockOver100) return true;
    }
  }

  return false;
}

export function parseExcelFile(buffer: ArrayBuffer): ParsedLoan[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

  if (rows.length > 0) {
    console.log(`[parseExcel] Found ${Object.keys(rows[0]).length} columns, ${rows.length} rows`);
  }

  return rows.map(row => {
    const raw: LoanRecord = {
      DQ: String(row['DQ'] ?? ''),
      HUDOffice: String(row['HUD Office'] ?? ''),
      HUDOfficeCR: Number(row['HUD Office Compare Ratio'] ?? 0),
      Channel: String(row['Loan Info Channel'] ?? ''),
      LoanProgram: String(row['Loan Program'] ?? ''),
      DPAName: String(row['DPA Name'] ?? ''),
      DPAProgram: String(row['DPA Program'] ?? ''),
      DPAInvestor: String(row['DPA Investor'] ?? ''),
      FICO: Number(row['FICO'] ?? 0),
      // Enhanced Guidelines fields — exact Encompass column headers
      Units: String(row['Subject Property # Units'] ?? ''),
      AUSType: String(row['Underwriting Risk Assess Type'] ?? ''),
      ReserveMonths: Number(row['Reserves'] ?? 0),
      GiftFunds: String(row['Gift Fund Amount'] ?? '0'),
      PaymentShock: Number(row['Payment Shock'] ?? 0),
      // Trend analysis fields
      LTVGroup: String(row['LTV Group'] ?? 'Unknown'),
      FTHB: String(row['FTHB'] ?? 'Unknown'),
      DTIBackEndGroup: String(row['DTI Back End Group'] ?? 'Unknown'),
      PaymentShockGroup: String(row['Payment Shock Group'] ?? 'Unknown'),
      SourceOfFundsGroup: String(row['Source of Funds Group'] ?? 'Unknown'),
      ReservesGroup: String(row['Reserves Group'] ?? 'Unknown'),
      RiskIndicatorCount: Number(row['Risk Indicator Count'] ?? 0),
      GiftGrantGroup: String(row['% Funds from Gift or Grant Group'] ?? 'Unknown'),
    };

    const prog = raw.LoanProgram.toUpperCase();
    const isDPA = prog.includes('DPA');
    // NOTE: "FUEL" is not a distinct loan program — it is the Standard FHA
    // program run through the Wholesale channel. We retain backward-compatible
    // parsing (Excel files may still contain "FUEL" in the loan-program text)
    // but classify those loans as Standard. The Retail/Wholesale Channel
    // field is the actual discriminator.
    const isDelinquent = raw.DQ.trim().toLowerCase() === 'yes';
    const channelLower = raw.Channel.toLowerCase();
    // Classify Boost off the high-level DPA Program bucket rather than the
    // granular DPA Name, so all flavors of Boost (AFN Boost, Orion Boost, …)
    // get the Enhanced Guidelines treatment consistently.
    const isBoost = isDPA && raw.DPAProgram.toLowerCase().includes('boost');

    // Use the pre-computed "Pay Shock > 100" flag from the data
    // This is more reliable than the raw Payment Shock value (which can be
    // nonsensical when Current Housing = 0)
    const payShockOver100Flag = String(row['Pay Shock > 100'] ?? '');

    const failsEnhancedGuidelines = checkEnhancedGuidelines({
      FICO: raw.FICO,
      Units: raw.Units,
      AUSType: raw.AUSType,
      ReserveMonths: raw.ReserveMonths,
      GiftFunds: raw.GiftFunds,
      PaymentShock: raw.PaymentShock,
      PaymentShockOver100: payShockOver100Flag,
      isBoost,
    });

    return {
      ...raw,
      isDelinquent,
      programType: isDPA ? 'DPA' : 'Standard',
      channelType: channelLower.includes('retail') ? 'Retail' : channelLower.includes('wholesale') ? 'Wholesale' : 'Unknown',
      isDPA,
      isBoost,
      failsEnhancedGuidelines,
    };
  });
}
