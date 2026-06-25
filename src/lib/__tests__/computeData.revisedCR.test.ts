/**
 * Revised Compare Ratio recompute — regression tests for the HUD-aggregate
 * universe fix (June 2026, reported by Stefanie Allman).
 *
 * Bug: in the HUD-data branch of `computeOffices`, the recompute previously
 * used Encompass-derived counts in the num/denom but HUD's `hud_office_dq_pct`
 * as the area divisor. When Encompass and HUD disagreed on loan counts
 * (a late-closing loan outside HUD's window, for example), the Revised CR
 * drifted from the Original CR even when zero loans were removed
 * ("phantom drift").
 *
 * Fix: use HUD's aggregate counts as the universe for the Revised CR
 * recompute. With totalRemoved=0 and HUD data present, Revised CR must
 * equal the Original CR (modulo a 1pt rounding artifact).
 *
 * Concrete fixture: Dallas, May 2026.
 * - Encompass: 106 loans (34 Retail + 72 Sponsored), 4 DLQ
 * - HUD: 105 loans (33 Retail + 72 Sponsored), 4 DLQ
 * - Delta: 1 extra Retail loan in Encompass (late-closing)
 * - totalRemoved: 0 (no delinquent Boost+EG loans)
 * - Original CR: 247
 * - Before fix: Revised CR = 245 (bug)
 * - After fix: Revised CR = 247
 */
import { describe, it, expect } from 'vitest';
import { computeDashboard } from '../computeData';
import type { ParsedLoan, HUDOfficeCR } from '../types';

/** Minimal loan factory — only sets the fields computeOffices reads. */
function loan(overrides: Partial<ParsedLoan>): ParsedLoan {
  return {
    DQ: 'No',
    HUDOffice: 'Dallas',
    HUDOfficeCR: 247,
    Channel: 'Retail',
    LoanProgram: '',
    DPAName: '',
    DPAProgram: '',
    DPAInvestor: '',
    FICO: 700,
    Units: '1',
    AUSType: 'DU',
    ReserveMonths: 0,
    GiftFunds: '0',
    PaymentShock: 0,
    LTVGroup: 'Unknown',
    FTHB: 'Unknown',
    DTIBackEndGroup: 'Unknown',
    PaymentShockGroup: 'Unknown',
    SourceOfFundsGroup: 'Unknown',
    ReservesGroup: 'Unknown',
    RiskIndicatorCount: 0,
    GiftGrantGroup: 'Unknown',
    isDelinquent: false,
    programType: 'Standard',
    channelType: 'Retail',
    isDPA: false,
    isBoost: false,
    failsEnhancedGuidelines: false,
    firstPaymentDate: null,
    ...overrides,
  };
}

describe('Revised CR — HUD-aggregate universe (phantom-drift fix)', () => {
  it('Dallas May 2026: totalRemoved=0 + count mismatch → Revised CR == Original CR (247)', () => {
    // Build an Encompass roster that matches Dallas May 2026:
    //   34 Retail (4 DLQ), 72 Sponsored (0 DLQ) = 106 total, 4 DLQ
    // No Boost+EG-failing loans, so totalRemoved = 0.
    const loans: ParsedLoan[] = [];
    for (let i = 0; i < 4; i++) {
      loans.push(loan({ channelType: 'Retail', isDelinquent: true, DQ: 'Yes' }));
    }
    for (let i = 0; i < 30; i++) {
      loans.push(loan({ channelType: 'Retail' }));
    }
    for (let i = 0; i < 72; i++) {
      loans.push(loan({ channelType: 'Wholesale', Channel: 'Wholesale' }));
    }

    // HUD says only 105 loans (33 Retail + 72 Sponsored) — one fewer Retail
    // than Encompass (the late-closing loan outside HUD's window).
    const hud: HUDOfficeCR = {
      name: 'DALLAS',
      totalCR: 247,
      retailCR: 290,
      wsCR: 0,
      totalLoansUW: 105,
      totalDLQ: 4,
      retailLoans: 33,
      retailDLQ: 4,
      sponsoredLoans: 72,
      sponsoredDLQ: 0,
      areaRetailDQPct: 4.21,
      areaSponsoredDQPct: 3.99,
      hudOfficeDQPct: 1.5419,
    };

    const dashboard = computeDashboard(loans, [hud]);
    const dallas = dashboard.offices.find(o => o.name === 'Dallas');
    expect(dallas).toBeDefined();
    expect(dallas!.totalCR).toBe(247);
    // Core assertion: phantom drift is gone.
    expect(dallas!.revisedTotalCR).toBe(247);
    expect(dallas!.totalDLQ).toBe(4);
    // Removed count is zero — nothing qualifies for Boost+EG+DLQ filter.
    expect(dallas!.retailRemoved).toBe(0);
    expect(dallas!.wsRemoved).toBe(0);
  });

  it('Zero removals + counts agree → Revised CR == Original CR (no drift)', () => {
    // Build a clean office where Encompass and HUD agree on everything.
    const loans: ParsedLoan[] = [];
    for (let i = 0; i < 3; i++) {
      loans.push(loan({ HUDOffice: 'Phoenix', channelType: 'Retail', isDelinquent: true, DQ: 'Yes' }));
    }
    for (let i = 0; i < 47; i++) {
      loans.push(loan({ HUDOffice: 'Phoenix', channelType: 'Retail' }));
    }
    for (let i = 0; i < 50; i++) {
      loans.push(loan({ HUDOffice: 'Phoenix', channelType: 'Wholesale', Channel: 'Wholesale' }));
    }

    const hud: HUDOfficeCR = {
      name: 'PHOENIX',
      totalCR: 150,
      retailCR: 200,
      wsCR: 0,
      totalLoansUW: 100,
      totalDLQ: 3,
      retailLoans: 50,
      retailDLQ: 3,
      sponsoredLoans: 50,
      sponsoredDLQ: 0,
      areaRetailDQPct: 3.0,
      areaSponsoredDQPct: 3.0,
      hudOfficeDQPct: 2.0,
    };

    const dashboard = computeDashboard(loans, [hud]);
    const phx = dashboard.offices.find(o => o.name === 'Phoenix');
    expect(phx).toBeDefined();
    // 3 DLQ / 100 loans = 3% / area 2% = 150% revised CR.
    expect(phx!.revisedTotalCR).toBe(150);
    expect(phx!.totalCR).toBe(150);
  });

  it('Removals shift Revised CR using HUD universe in num & denom', () => {
    // 5 Retail DLQ, all Boost+EG-failing → all 5 are removed.
    const loans: ParsedLoan[] = [];
    for (let i = 0; i < 5; i++) {
      loans.push(loan({
        HUDOffice: 'Atlanta',
        channelType: 'Retail',
        isDelinquent: true,
        DQ: 'Yes',
        isBoost: true,
        isDPA: true,
        programType: 'DPA',
        failsEnhancedGuidelines: true,
      }));
    }
    for (let i = 0; i < 95; i++) {
      loans.push(loan({ HUDOffice: 'Atlanta', channelType: 'Retail' }));
    }

    const hud: HUDOfficeCR = {
      name: 'ATLANTA',
      totalCR: 250,
      retailCR: 250,
      wsCR: 0,
      totalLoansUW: 100,
      totalDLQ: 5,
      retailLoans: 100,
      retailDLQ: 5,
      sponsoredLoans: 0,
      sponsoredDLQ: 0,
      areaRetailDQPct: 2.0,
      areaSponsoredDQPct: 0,
      hudOfficeDQPct: 2.0,
    };

    const dashboard = computeDashboard(loans, [hud]);
    const atl = dashboard.offices.find(o => o.name === 'Atlanta');
    expect(atl).toBeDefined();
    // Removed 5 → revisedTotalLoans = 100 - 5 = 95, revisedTotalDLQ = 0
    // → 0/95 = 0% / area 2% = 0 revised CR
    expect(atl!.retailRemoved).toBe(5);
    expect(atl!.revisedTotalCR).toBe(0);
  });

  it('Missing HUD office DQ% → falls back to legacy Encompass-based recompute', () => {
    // hudOfficeDQPct = 0 should trigger the fallback path so we don't crash
    // or return NaN. Behavior in the fallback path matches the pre-fix code.
    const loans: ParsedLoan[] = [];
    for (let i = 0; i < 2; i++) {
      loans.push(loan({ HUDOffice: 'Tulsa', channelType: 'Retail', isDelinquent: true, DQ: 'Yes' }));
    }
    for (let i = 0; i < 48; i++) {
      loans.push(loan({ HUDOffice: 'Tulsa', channelType: 'Retail' }));
    }

    const hud: HUDOfficeCR = {
      name: 'TULSA',
      totalCR: 180,
      retailCR: 180,
      wsCR: 0,
      totalLoansUW: 0, // missing
      totalDLQ: 0,
      retailLoans: 0,
      retailDLQ: 0,
      sponsoredLoans: 0,
      sponsoredDLQ: 0,
      areaRetailDQPct: 0,
      areaSponsoredDQPct: 0,
      hudOfficeDQPct: 0, // missing
    };

    const dashboard = computeDashboard(loans, [hud]);
    const tulsa = dashboard.offices.find(o => o.name === 'Tulsa');
    expect(tulsa).toBeDefined();
    // Did not crash, did not produce NaN.
    expect(tulsa!.totalCR).toBe(180);
    expect(Number.isFinite(tulsa!.revisedTotalCR)).toBe(true);
  });

  it('Guardrail: caps retailRemoved at HUD retail_loans universe', () => {
    // Synthetic edge case: Encompass says 10 removable loans, HUD only counts 5.
    // The fix should clamp removals to the HUD universe size to keep the
    // denominator non-negative.
    const loans: ParsedLoan[] = [];
    for (let i = 0; i < 10; i++) {
      loans.push(loan({
        HUDOffice: 'EdgeCase',
        channelType: 'Retail',
        isDelinquent: true,
        DQ: 'Yes',
        isBoost: true,
        isDPA: true,
        programType: 'DPA',
        failsEnhancedGuidelines: true,
      }));
    }

    const hud: HUDOfficeCR = {
      name: 'EDGECASE',
      totalCR: 300,
      retailCR: 300,
      wsCR: 0,
      totalLoansUW: 5,
      totalDLQ: 5,
      retailLoans: 5,
      retailDLQ: 5,
      sponsoredLoans: 0,
      sponsoredDLQ: 0,
      areaRetailDQPct: 2.0,
      areaSponsoredDQPct: 0,
      hudOfficeDQPct: 2.0,
    };

    const dashboard = computeDashboard(loans, [hud]);
    const edge = dashboard.offices.find(o => o.name === 'EdgeCase');
    expect(edge).toBeDefined();
    // Clamped: capRetailRemoved = 5, revisedTotalLoans = 5 - 5 = 0 →
    // degenerate denominator path → revisedTotalCR = 0 (Guardrail 2).
    expect(edge!.revisedTotalCR).toBe(0);
    expect(Number.isFinite(edge!.revisedTotalCR)).toBe(true);
  });
});
