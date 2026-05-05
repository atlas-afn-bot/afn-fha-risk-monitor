import type { ParsedLoan, DashboardData, OfficeSummary, DPAProgramSummary, DPAInvestorSummary, ChannelSummary, FICOBucket, HUDOfficeCR, TrendAnalysis, TrendDimension } from './types';
import type { Snapshot, Loan as SnapshotLoan, CompareRatioHudOffice } from '@/types/snapshot';

/**
 * Primary entry point for the dashboard — takes a parsed monthly snapshot
 * (as loaded by `snapshotLoader.ts`) and returns the same `DashboardData`
 * shape the existing components consume.
 *
 * Under the hood this maps the snapshot's `loans[]` + HUD office rows into
 * the legacy `ParsedLoan[]` / `HUDOfficeCR[]` structures and runs the same
 * aggregation pipeline the old Excel-upload flow used. Keeping the
 * downstream shape stable means every chart / table component works
 * without modification.
 */
export function buildDashboardFromSnapshot(snapshot: Snapshot): DashboardData {
  const loans = snapshot.loans.map(snapshotLoanToParsed);
  const hudData = snapshot.compare_ratios_hud_office.map(hudOfficeToCR);
  const dashboard = computeDashboard(loans, hudData);
  // Forward NW Data extension rollups straight through. They're optional
  // so older snapshots without these arrays still produce a valid
  // DashboardData (the new tabs just render an empty state).
  dashboard.underwriterRollup = snapshot.underwriter_rollup;
  dashboard.delinquencyReasonRollup = snapshot.delinquency_reason_rollup;
  dashboard.indemnificationLoans = snapshot.indemnification_loans;
  dashboard.sponsorTPODetail = snapshot.sponsor_tpo_detail;
  return dashboard;
}

/**
 * Adapt a snapshot-shaped {@link SnapshotLoan} into the legacy
 * {@link ParsedLoan} shape consumed by every computation below. The snapshot
 * already carries all derived fields (risk flags, enhanced-guidelines check,
 * etc.) — this function is a straight field-by-field rename / defaulting.
 */
function snapshotLoanToParsed(l: SnapshotLoan): ParsedLoan {
  const channel: ParsedLoan['channelType'] =
    l.channel === 'Retail' ? 'Retail'
    : l.channel === 'Wholesale' ? 'Wholesale'
    : 'Unknown';
  return {
    DQ: l.is_delinquent ? 'Yes' : 'No',
    HUDOffice: l.hud_office ?? '',
    HUDOfficeCR: l.hud_office_compare_ratio ?? 0,
    Channel: l.channel ?? '',
    LoanProgram: l.loan_program_raw ?? '',
    DPAName: l.dpa_name ?? '',
    DPAProgram: l.dpa_program ?? '',
    DPAInvestor: l.dpa_investor ?? '',
    FICO: l.fico_score ?? 0,
    Units: l.units != null ? String(l.units) : '',
    AUSType: l.aus ?? '',
    ReserveMonths: l.reserves_months ?? 0,
    GiftFunds: l.gift_fund_amount != null ? String(l.gift_fund_amount) : '0',
    PaymentShock: l.payment_shock ?? 0,
    LTVGroup: l.ltv_group ?? 'Unknown',
    FTHB: l.fthb ?? 'Unknown',
    DTIBackEndGroup: l.dti_back_end_group ?? 'Unknown',
    PaymentShockGroup: l.payment_shock_group ?? 'Unknown',
    SourceOfFundsGroup: l.source_of_funds_group ?? 'Unknown',
    ReservesGroup: l.reserves_group ?? 'Unknown',
    RiskIndicatorCount: l.risk_indicator_count,
    GiftGrantGroup: l.gift_grant_group ?? 'Unknown',

    isDelinquent: l.is_delinquent,
    programType: l.program_type,
    channelType: channel,
    isDPA: l.has_dpa,
    isBoost: l.is_boost,
    failsEnhancedGuidelines: l.fails_enhanced_guidelines,
  };
}

function hudOfficeToCR(h: CompareRatioHudOffice): HUDOfficeCR {
  const name = (h.hud_office ?? '').toUpperCase();
  return {
    name,
    totalCR: h.compare_ratio ?? 0,
    retailCR: h.retail_ratio ?? 0,
    wsCR: h.sponsor_ratio ?? 0,
    totalLoansUW: h.loans_count ?? 0,
    totalDLQ: h.delinquent_count ?? 0,
    retailLoans: h.retail_loans ?? 0,
    retailDLQ: h.retail_delinquent ?? 0,
    sponsoredLoans: h.sponsored_loans ?? 0,
    sponsoredDLQ: h.sponsored_delinquent ?? 0,
    areaRetailDQPct: h.area_retail_dq_pct ?? 0,
    areaSponsoredDQPct: h.area_sponsored_dq_pct ?? 0,
    hudOfficeDQPct: h.hud_office_dq_pct ?? 0,
  };
}

export function computeDashboard(loans: ParsedLoan[], hudData?: HUDOfficeCR[]): DashboardData {
  const totalLoans = loans.length;
  const totalDLQ = loans.filter(l => l.isDelinquent).length;
  const overallDQRate = totalLoans > 0 ? (totalDLQ / totalLoans) * 100 : 0;
  const totalDPA = loans.filter(l => l.isDPA).length;
  const dpaPortfolioConc = totalLoans > 0 ? (totalDPA / totalLoans) * 100 : 0;

  const offices = computeOffices(loans, overallDQRate, hudData);
  const terminationRiskCount = offices.filter(o => o.totalCR > 200 && o.totalLoans > 100).length;

  return {
    loans,
    totalLoans,
    overallDQRate,
    terminationRiskCount,
    dpaPortfolioConc,
    offices,
    dpaPrograms: computeDPAPrograms(loans),
    dpaMatrix: computeDPAMatrix(loans),
    retailSummary: computeChannelSummary(loans, 'Retail'),
    wsSummary: computeChannelSummary(loans, 'Wholesale'),
    ficoBuckets: computeFICO(loans),
    programComposition: computeProgramComposition(loans),
    hasHUDData: !!hudData && hudData.length > 0,
    trendAnalysis: computeTrends(loans),
  };
}

function computeOffices(loans: ParsedLoan[], overallDQRate: number, hudData?: HUDOfficeCR[]): OfficeSummary[] {
  // Build lookup map for HUD compare ratio data
  const hudMap = new Map<string, HUDOfficeCR>();
  if (hudData) {
    for (const h of hudData) {
      hudMap.set(h.name.toUpperCase().trim(), h);
    }
  }

  const byOffice = new Map<string, ParsedLoan[]>();
  for (const l of loans) {
    const arr = byOffice.get(l.HUDOffice) || [];
    arr.push(l);
    byOffice.set(l.HUDOffice, arr);
  }

  const overallRate = overallDQRate / 100;
  const retailLoansAll = loans.filter(l => l.channelType === 'Retail');
  const wsLoansAll = loans.filter(l => l.channelType === 'Wholesale');
  const retailDQRateAll = retailLoansAll.length > 0 ? retailLoansAll.filter(l => l.isDelinquent).length / retailLoansAll.length : 0;
  const wsDQRateAll = wsLoansAll.length > 0 ? wsLoansAll.filter(l => l.isDelinquent).length / wsLoansAll.length : 0;

  const results: OfficeSummary[] = [];

  for (const [name, officeLoans] of byOffice) {
    const total = officeLoans.length;
    const retail = officeLoans.filter(l => l.channelType === 'Retail');
    const ws = officeLoans.filter(l => l.channelType === 'Wholesale');
    const totalDLQ = officeLoans.filter(l => l.isDelinquent).length;
    const retailDLQ = retail.filter(l => l.isDelinquent).length;
    const wsDLQ = ws.filter(l => l.isDelinquent).length;

    // Use HUD data for compare ratios if available, else fall back to Excel column / estimate
    const hudEntry = hudMap.get(name.toUpperCase().trim());
    let totalCR: number;
    let retailCR: number | null;
    let wsCR: number | null;
    let areaRetailDQRate: number | null = null;
    let areaSponsoredDQRate: number | null = null;

    if (hudEntry) {
      totalCR = hudEntry.totalCR;
      retailCR = hudEntry.retailCR;
      wsCR = hudEntry.wsCR;
      areaRetailDQRate = hudEntry.areaRetailDQPct / 100;
      areaSponsoredDQRate = hudEntry.areaSponsoredDQPct / 100;
    } else {
      totalCR = officeLoans[0]?.HUDOfficeCR ?? 0;
      const retailRate = retail.length > 0 ? retailDLQ / retail.length : 0;
      const wsRate = ws.length > 0 ? wsDLQ / ws.length : 0;
      retailCR = retailDQRateAll > 0 && retail.length > 0 ? Math.round((retailRate / retailDQRateAll) * 100) : null;
      wsCR = wsDQRateAll > 0 && ws.length > 0 ? Math.round((wsRate / wsDQRateAll) * 100) : null;
    }

    const retailNonDPADLQ = retail.filter(l => l.isDelinquent && !l.isDPA).length;
    const retailBoostDLQ = retail.filter(l => l.isDelinquent && l.isBoost).length;
    const retailOtherDPADLQ = retail.filter(l => l.isDelinquent && l.isDPA && !l.isBoost).length;
    const wsNonDPADLQ = ws.filter(l => l.isDelinquent && !l.isDPA).length;
    const wsBoostDLQ = ws.filter(l => l.isDelinquent && l.isBoost).length;
    const wsOtherDPADLQ = ws.filter(l => l.isDelinquent && l.isDPA && !l.isBoost).length;

    // Enhanced Guidelines: count delinquent Boost DPA loans that would NOT have
    // been originated under the new guidelines (failsEnhancedGuidelines=true)
    const retailRemoved = retail.filter(l => l.isDelinquent && l.isBoost && l.failsEnhancedGuidelines).length;
    const wsRemoved = ws.filter(l => l.isDelinquent && l.isBoost && l.failsEnhancedGuidelines).length;

    const revisedTotalDLQ = totalDLQ - retailRemoved - wsRemoved;

    // Compute revised CRs by recomputing from scratch:
    // Revised CR = (Revised Lender DQ% / Area DQ%) × 100
    // Where Revised Lender DQ% = (DLQ - Removed) / Loans UW
    // Area DQ% comes from HUD data and does NOT change
    let revisedTotalCR: number;
    let revisedRetailCR: number | null;
    let revisedWSCR: number | null;
    // Revised SDQ% (numerator of Revised CR) — surfaced on OfficeSummary for
    // committee audit. Computed in both branches below so the column always
    // populates whether or not HUD data is available.
    let revisedTotalDQPct: number;
    let revisedRetailDQPct: number | null;
    let revisedWSDQPct: number | null;

    if (hudEntry) {
      // Committee methodology: remove Enhanced Guidelines loans from BOTH
      // numerator (DLQ) AND denominator (total loans UW)
      // Use Encompass-derived counts for accuracy (matches committee data source)
      const hudAreaDQPct = hudEntry.hudOfficeDQPct; // already in %
      const areaRetailDQ = hudEntry.areaRetailDQPct; // already in %
      const areaWSDQ = hudEntry.areaSponsoredDQPct; // already in %

      // Use Encompass counts (total/retail.length/ws.length) for denominators
      // These match the committee's data source
      const totalRemoved = retailRemoved + wsRemoved;
      const revisedTotalLoans = total - totalRemoved;
      const revisedTotalDLQCount = totalDLQ - totalRemoved;
      revisedTotalDQPct = revisedTotalLoans > 0 ? (revisedTotalDLQCount / revisedTotalLoans) * 100 : 0;
      revisedTotalCR = hudAreaDQPct > 0 ? Math.round(revisedTotalDQPct / hudAreaDQPct * 100) : totalCR;

      // Revised retail: remove retail removed from both num & denom
      const revisedRetailLoans = retail.length - retailRemoved;
      const revisedRetailDLQCount = retailDLQ - retailRemoved;
      const retailDQPct = revisedRetailLoans > 0 ? (revisedRetailDLQCount / revisedRetailLoans) * 100 : 0;
      revisedRetailDQPct = revisedRetailLoans > 0 ? retailDQPct : null;
      revisedRetailCR = areaRetailDQ > 0 && revisedRetailLoans > 0 ? Math.round(retailDQPct / areaRetailDQ * 100) : retailCR;

      // Revised WS: remove ws removed from both num & denom
      const revisedWSLoans = ws.length - wsRemoved;
      const revisedWSDLQCount = wsDLQ - wsRemoved;
      const wsDQPct = revisedWSLoans > 0 ? (revisedWSDLQCount / revisedWSLoans) * 100 : 0;
      revisedWSDQPct = revisedWSLoans > 0 ? wsDQPct : null;
      revisedWSCR = areaWSDQ > 0 && revisedWSLoans > 0 ? Math.round(wsDQPct / areaWSDQ * 100) : wsCR;
    } else {
      // No HUD data — fall back to proportional scaling for the CR, but still
      // compute the SDQ% from the same removed-loan math so the audit column
      // populates consistently with the HUD-data branch.
      const totalRemoved = retailRemoved + wsRemoved;
      const revisedTotalLoans = total - totalRemoved;
      const revisedTotalDLQCount = totalDLQ - totalRemoved;
      revisedTotalDQPct = revisedTotalLoans > 0 ? (revisedTotalDLQCount / revisedTotalLoans) * 100 : 0;
      const revisedRetailLoans = retail.length - retailRemoved;
      revisedRetailDQPct = revisedRetailLoans > 0 ? ((retailDLQ - retailRemoved) / revisedRetailLoans) * 100 : null;
      const revisedWSLoans = ws.length - wsRemoved;
      revisedWSDQPct = revisedWSLoans > 0 ? ((wsDLQ - wsRemoved) / revisedWSLoans) * 100 : null;

      revisedTotalCR = totalDLQ > 0 ? Math.round(totalCR * (revisedTotalDLQ / totalDLQ)) : totalCR;
      revisedRetailCR = retailCR !== null && retailDLQ > 0 ? Math.round(retailCR * ((retailDLQ - retailRemoved) / retailDLQ)) : retailCR;
      revisedWSCR = wsCR !== null && wsDLQ > 0 ? Math.round(wsCR * ((wsDLQ - wsRemoved) / wsDLQ)) : wsCR;
    }

    const retailDPALoans = retail.filter(l => l.isDPA).length;
    const wsDPALoans = ws.filter(l => l.isDPA).length;
    const retailDPAConc = retail.length > 0 ? (retailDPALoans / retail.length) * 100 : 0;
    const wsDPAConc = ws.length > 0 ? (wsDPALoans / ws.length) * 100 : 0;
    const totalDPAConc = total > 0 ? (officeLoans.filter(l => l.isDPA).length / total) * 100 : 0;

    const isImproved = totalCR > 200 && revisedTotalCR < 150;

    results.push({
      name, totalCR, retailCR, wsCR,
      totalLoans: total, retailLoans: retail.length, wsLoans: ws.length,
      totalDLQ, retailDLQ, wsDLQ,
      retailNonDPADLQ, retailBoostDLQ, retailOtherDPADLQ,
      wsNonDPADLQ, wsBoostDLQ, wsOtherDPADLQ,
      retailRemoved, wsRemoved,
      revisedTotalDQPct, revisedRetailDQPct, revisedWSDQPct,
      revisedTotalCR, revisedRetailCR, revisedWSCR,
      retailDPAConc, wsDPAConc,
      dqRate: total > 0 ? (totalDLQ / total) * 100 : 0,
      totalDPAConc,
      isImproved,
    });
  }

  return results.sort((a, b) => b.totalCR - a.totalCR);
}

/**
 * Normalize a raw DPA Program string into a stable bucket label.
 *
 * Neighborhood Watch exports surface a few variants per program family
 * ("Boost", "Boost DPA", "AFN Boost", …) — normalize them into the three
 * canonical buckets the committee cares about.
 */
function normalizeProgramLabel(raw: string): string {
  const s = raw.trim();
  if (!s) return 'Non-DPA';
  const lower = s.toLowerCase();
  if (lower.includes('boost')) return 'Boost';
  if (lower.includes('arrive') || lower.includes('aurora')) return 'Arrive/Aurora';
  return s;
}

function normalizeInvestorLabel(raw: string): string {
  const s = raw.trim();
  return s || 'Unassigned';
}

/**
 * Primary DPA analytics — rolled up by DPA Program with investor drill-down.
 *
 * Note: we intentionally key off {@link ParsedLoan.DPAProgram} (and its
 * high-level {@link normalizeProgramLabel} bucket) rather than DPA Name,
 * because DPA Name is too granular ("Boost FHA Loan Program",
 * "Boost 3.5% Repayable DPA Program", … all mean "Boost").
 */
function computeDPAPrograms(loans: ParsedLoan[]): DPAProgramSummary[] {
  const dpaLoans = loans.filter(l => l.isDPA);
  const totalDPA = dpaLoans.length;

  const byProgram = new Map<string, ParsedLoan[]>();
  for (const l of dpaLoans) {
    const prog = normalizeProgramLabel(l.DPAProgram);
    const arr = byProgram.get(prog) || [];
    arr.push(l);
    byProgram.set(prog, arr);
  }

  const programs: DPAProgramSummary[] = [];
  for (const [program, pLoans] of byProgram) {
    const delinquent = pLoans.filter(l => l.isDelinquent).length;
    const programTotal = pLoans.length;

    // Investor drill-down within this program
    const byInvestor = new Map<string, ParsedLoan[]>();
    for (const l of pLoans) {
      const inv = normalizeInvestorLabel(l.DPAInvestor);
      const arr = byInvestor.get(inv) || [];
      arr.push(l);
      byInvestor.set(inv, arr);
    }

    const investors: DPAInvestorSummary[] = Array.from(byInvestor.entries())
      .map(([investor, iLoans]) => {
        const iDLQ = iLoans.filter(l => l.isDelinquent).length;
        return {
          investor,
          program,
          totalLoans: iLoans.length,
          delinquent: iDLQ,
          dqRate: iLoans.length > 0 ? (iDLQ / iLoans.length) * 100 : 0,
          pctOfProgramVolume: programTotal > 0 ? (iLoans.length / programTotal) * 100 : 0,
          pctOfDPAVolume: totalDPA > 0 ? (iLoans.length / totalDPA) * 100 : 0,
          retailLoans: iLoans.filter(l => l.channelType === 'Retail').length,
          wsLoans: iLoans.filter(l => l.channelType === 'Wholesale').length,
        };
      })
      .sort((a, b) => b.delinquent - a.delinquent);

    programs.push({
      program,
      totalLoans: programTotal,
      delinquent,
      dqRate: programTotal > 0 ? (delinquent / programTotal) * 100 : 0,
      pctOfDPAVolume: totalDPA > 0 ? (programTotal / totalDPA) * 100 : 0,
      retailLoans: pLoans.filter(l => l.channelType === 'Retail').length,
      wsLoans: pLoans.filter(l => l.channelType === 'Wholesale').length,
      investors,
    });
  }

  return programs.sort((a, b) => b.delinquent - a.delinquent);
}

/**
 * Flat Program × Investor matrix — one row per (program, investor) pair.
 * Useful for PDF export and CSV downloads.
 */
function computeDPAMatrix(loans: ParsedLoan[]): DPAInvestorSummary[] {
  const programs = computeDPAPrograms(loans);
  const rows: DPAInvestorSummary[] = [];
  for (const p of programs) {
    for (const inv of p.investors) rows.push(inv);
  }
  return rows.sort((a, b) => b.delinquent - a.delinquent);
}

function computeChannelSummary(loans: ParsedLoan[], channel: 'Retail' | 'Wholesale'): ChannelSummary {
  const ch = loans.filter(l => l.channelType === channel);
  const total = ch.length;
  const dpa = ch.filter(l => l.isDPA);
  const nonDPA = ch.filter(l => !l.isDPA);
  const standard = ch.filter(l => l.programType === 'Standard');
  const dlq = ch.filter(l => l.isDelinquent).length;

  return {
    totalLoans: total,
    dpaConc: total > 0 ? (dpa.length / total) * 100 : 0,
    overallDQRate: total > 0 ? (dlq / total) * 100 : 0,
    dpaDQRate: dpa.length > 0 ? (dpa.filter(l => l.isDelinquent).length / dpa.length) * 100 : 0,
    nonDPADQRate: nonDPA.length > 0 ? (nonDPA.filter(l => l.isDelinquent).length / nonDPA.length) * 100 : 0,
    standardDQRate: standard.length > 0 ? (standard.filter(l => l.isDelinquent).length / standard.length) * 100 : 0,
  };
}

function computeFICO(loans: ParsedLoan[]): FICOBucket[] {
  const buckets = [
    { label: '<580', min: 0, max: 579 },
    { label: '580-619', min: 580, max: 619 },
    { label: '620-659', min: 620, max: 659 },
    { label: '660-679', min: 660, max: 679 },
    { label: '680-699', min: 680, max: 699 },
    { label: '700-739', min: 700, max: 739 },
    { label: '740+', min: 740, max: 999 },
  ];

  return buckets.map(b => {
    const inBucket = loans.filter(l => l.FICO >= b.min && l.FICO <= b.max);
    const standard = inBucket.filter(l => l.programType === 'Standard');
    const dpa = inBucket.filter(l => l.programType === 'DPA');
    return {
      ...b,
      standardDQ: standard.length > 0 ? (standard.filter(l => l.isDelinquent).length / standard.length) * 100 : 0,
      dpaDQ: dpa.length > 0 ? (dpa.filter(l => l.isDelinquent).length / dpa.length) * 100 : 0,
      standardTotal: standard.length,
      dpaTotal: dpa.length,
    };
  });
}

function computeProgramComposition(loans: ParsedLoan[]) {
  const standard = loans.filter(l => l.programType === 'Standard');
  const dpa = loans.filter(l => l.programType === 'DPA');
  return {
    standard: standard.length, dpa: dpa.length,
    standardDQ: standard.length > 0 ? (standard.filter(l => l.isDelinquent).length / standard.length) * 100 : 0,
    dpaDQ: dpa.length > 0 ? (dpa.filter(l => l.isDelinquent).length / dpa.length) * 100 : 0,
  };
}

function groupByField(loans: ParsedLoan[], getter: (l: ParsedLoan) => string, minCount = 20): TrendDimension[] {
  const groups = new Map<string, { total: number; dlq: number }>();
  for (const l of loans) {
    const key = getter(l) || 'Unknown';
    const g = groups.get(key) || { total: 0, dlq: 0 };
    g.total++;
    if (l.isDelinquent) g.dlq++;
    groups.set(key, g);
  }
  return Array.from(groups.entries())
    .filter(([, v]) => v.total >= minCount)
    .map(([label, v]) => ({
      label,
      total: v.total,
      dlq: v.dlq,
      dqRate: v.total > 0 ? (v.dlq / v.total) * 100 : 0,
    }))
    .sort((a, b) => b.dqRate - a.dqRate);
}

function computeTrends(loans: ParsedLoan[]): TrendAnalysis {
  const manual = loans.filter(l => l.AUSType.toUpperCase().includes('MANUAL'));
  const auto = loans.filter(l => !l.AUSType.toUpperCase().includes('MANUAL') && l.AUSType !== '');

  return {
    ltvGroups: groupByField(loans, l => l.LTVGroup),
    fthb: groupByField(loans, l => l.FTHB, 10),
    dtiGroups: groupByField(loans, l => l.DTIBackEndGroup),
    paymentShockGroups: groupByField(loans, l => l.PaymentShockGroup),
    sourceOfFunds: groupByField(loans, l => l.SourceOfFundsGroup),
    reservesGroups: groupByField(loans, l => l.ReservesGroup),
    riskIndicatorCount: groupByField(loans, l => {
      const cnt = l.RiskIndicatorCount;
      return cnt >= 5 ? '5+' : String(cnt);
    }, 10),
    giftGrantGroups: groupByField(loans, l => l.GiftGrantGroup),
    ausTypes: groupByField(loans, l => l.AUSType, 10),
    manualUWRate: loans.length > 0 ? (manual.length / loans.length) * 100 : 0,
    manualUWDQRate: manual.length > 0 ? (manual.filter(l => l.isDelinquent).length / manual.length) * 100 : 0,
    autoUWDQRate: auto.length > 0 ? (auto.filter(l => l.isDelinquent).length / auto.length) * 100 : 0,
  };
}
