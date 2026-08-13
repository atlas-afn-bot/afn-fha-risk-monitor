/**
 * PerformanceMatrixV16 — behavior tests for PR-D.
 *
 * Covers the acceptance criteria from the PR-D brief:
 *   1. Renders the two-row grouped header with 26 leaf columns matching
 *      the v16 sheet spec (Office | CR ×3 | Loans ×3 | DQ ×3 |
 *      DLQ Breakdown ×6 | Removed ×2 | Revised CR ×3 | DPA Conc% ×3 |
 *      Status | Notes).
 *   2. Renders every office as a row (no cap, no CR-band filter).
 *   3. PORTFOLIO TOTAL row pinned at the top with correct summed
 *      values.
 *   4. Default sort is CR Tot desc.
 *   5. Clicking a leaf header toggles sort direction; PORTFOLIO TOTAL
 *      stays pinned at the top regardless.
 *   6. Copy button writes TSV to navigator.clipboard.
 *   7. Native <table> structure (root grid is `<table>`, not divs).
 *   8. Null OfficeSummary fields render as em-dash (—), not 0.
 *   9. Row expand: clicking an office renders the DQ-loan table
 *      filtered to that office's delinquent loans.
 *  10. Collapse + re-expand keeps the "was expanded" cache marker
 *      (proxy for the no-remount contract — see JSDoc in the
 *      component for why we test via cache marker instead of ref
 *      identity).
 *
 * Pure client-side — no /api/evaluate mock needed (unlike PR-B).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import PerformanceMatrixV16 from '../PerformanceMatrixV16';
import type { OfficeSummary, ParsedLoan } from '@/lib/types';

// ── Fixtures ───────────────────────────────────────────────────────────

function makeOffice(name: string, o: Partial<OfficeSummary> = {}): OfficeSummary {
  return {
    name,
    totalCR: 220,
    retailCR: 210,
    wsCR: 240,
    totalLoans: 500,
    retailLoans: 300,
    wsLoans: 200,
    totalDLQ: 30,
    retailDLQ: 15,
    wsDLQ: 15,
    retailNonDPADLQ: 5,
    retailBoostDLQ: 7,
    retailOtherDPADLQ: 3,
    wsNonDPADLQ: 4,
    wsBoostDLQ: 8,
    wsOtherDPADLQ: 3,
    retailRemoved: 12,
    wsRemoved: 8,
    totalDQPct: 6.0,
    retailDQPct: 5.0,
    wsDQPct: 7.5,
    revisedTotalDQPct: 4.8,
    revisedRetailDQPct: 4.0,
    revisedWSDQPct: 6.0,
    revisedTotalCR: 180,
    revisedRetailCR: 170,
    revisedWSCR: 200,
    retailDPAConc: 40,
    wsDPAConc: 55,
    dqRate: 6.0,
    totalDPAConc: 45,
    isImproved: false,
    proposedDropOffCR: 210,
    proposedDropOffCount: 5,
    proposedDropOffWindowStart: '2024-10-01',
    ...o,
  } as OfficeSummary;
}

const offices: OfficeSummary[] = [
  makeOffice('Charleston', { totalCR: 386, retailCR: 342, wsCR: 447, totalLoans: 400, retailLoans: 250, wsLoans: 150, totalDLQ: 20 }),
  makeOffice('Newark', { totalCR: 289, retailCR: 270, wsCR: 310, totalLoans: 800, retailLoans: 450, wsLoans: 350, totalDLQ: 40 }),
  makeOffice('Denver', { totalCR: 205, retailCR: 190, wsCR: 220, totalLoans: 600, retailLoans: 350, wsLoans: 250, totalDLQ: 25 }),
  // Small office with null wsCR — verifies em-dash rendering.
  makeOffice('Anchorage', { totalCR: 0, retailCR: null, wsCR: null, totalLoans: 2, retailLoans: 0, wsLoans: 2, totalDLQ: 0, revisedTotalCR: null, revisedRetailCR: null, revisedWSCR: null, retailDPAConc: 0, wsDPAConc: 100, totalDPAConc: 100 }),
];

function makeLoan(office: string, dq: boolean, extra: Partial<ParsedLoan> = {}): ParsedLoan {
  return {
    DQ: dq ? '60' : '0',
    HUDOffice: office,
    HUDOfficeCR: 100,
    Channel: 'Retail',
    LoanProgram: 'FHA',
    DPAName: '',
    DPAProgram: 'Non-DPA',
    DPAInvestor: 'GNMA',
    FICO: 680,
    Units: '1',
    AUSType: 'DU',
    ReserveMonths: 2,
    GiftFunds: 'N',
    PaymentShock: 0,
    LTVGroup: '95-97',
    FTHB: 'Y',
    DTIBackEndGroup: '40-45',
    PaymentShockGroup: '',
    SourceOfFundsGroup: '',
    ReservesGroup: '',
    RiskIndicatorCount: 0,
    GiftGrantGroup: '',
    isDelinquent: dq,
    programType: 'Standard',
    channelType: 'Retail',
    isDPA: false,
    isBoost: false,
    failsEnhancedGuidelines: false,
    firstPaymentDate: null,
    ...extra,
  };
}

const loans: ParsedLoan[] = [
  makeLoan('Charleston', true, { DPAProgram: 'Boost', isBoost: true, isDPA: true, FICO: 590 }),
  makeLoan('Charleston', true, { DPAProgram: 'Non-DPA', FICO: 650 }),
  makeLoan('Charleston', false),
  makeLoan('Newark', true, { DPAProgram: 'Boost', isBoost: true, isDPA: true, FICO: 620 }),
  makeLoan('Denver', false),
];

// ── Suite ──────────────────────────────────────────────────────────────

describe('PerformanceMatrixV16 — PR-D unified matrix', () => {
  // Silence noisy React `console.error` from any prop warnings so the
  // Vitest output stays readable. Individual tests still assert on real
  // DOM state, not on console output.
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    cleanup();
  });

  it('renders exactly 26 leaf columns in the v16 order', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    const expected = [
      'name',
      'totalCR', 'retailCR', 'wsCR',
      'totalLoans', 'retailLoans', 'wsLoans',
      'totalDLQ', 'retailDLQ', 'wsDLQ',
      'retailNonDPADLQ', 'retailBoostDLQ', 'retailOtherDPADLQ',
      'wsNonDPADLQ', 'wsBoostDLQ', 'wsOtherDPADLQ',
      'retailRemoved', 'wsRemoved',
      'revisedTotalCR', 'revisedRetailCR', 'revisedWSCR',
      'totalDPAConc', 'retailDPAConc', 'wsDPAConc',
      'status', 'notes',
    ];
    expect(expected).toHaveLength(26);
    for (const k of expected) {
      expect(screen.getByTestId(`leaf-header-${k}`)).toBeTruthy();
    }
  });

  it('renders the 10 band headers with the correct colspan pattern', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Expected labels and spans (see brief).
    const expected: Array<[string, number]> = [
      ['Office', 1],
      ['CR', 3],
      ['Loans', 3],
      ['DQ', 3],
      ['DLQ Breakdown by Channel', 6],
      ['Removed', 2],
      ['Revised CR', 3],
      ['DPA Conc%', 3],
      ['Status', 1],
      ['Notes', 1],
    ];
    expected.forEach(([label, span], i) => {
      const th = screen.getByTestId(`band-header-${i}`) as HTMLTableCellElement;
      expect(th.textContent?.trim()).toBe(label);
      expect(th.colSpan).toBe(span);
    });
    // Sanity — spans sum to 26.
    expect(expected.reduce((a, [, s]) => a + s, 0)).toBe(26);
  });

  it('renders every office row (no top-N cap)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    for (const o of offices) {
      expect(screen.getByTestId(`office-row-${o.name}`)).toBeTruthy();
    }
  });

  it('renders a PORTFOLIO TOTAL row pinned at the top with summed values', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    const portfolio = screen.getByTestId('portfolio-row');
    const cells = within(portfolio).getAllByRole('cell');
    // First cell = name column with chevron placeholder — the portfolio
    // row skips the chevron, so text is just the name.
    expect(cells[0].textContent).toContain('PORTFOLIO TOTAL');
    // Total loans: 400 + 800 + 600 + 2 = 1802.
    // Column index for totalLoans is 4 (0-indexed).
    expect(cells[4].textContent?.trim()).toBe('1802');
    // Total DLQ: 20 + 40 + 25 + 0 = 85.
    expect(cells[7].textContent?.trim()).toBe('85');
    // Notes column carries 'Portfolio-wide'.
    expect(cells[25].textContent?.trim()).toBe('Portfolio-wide');
  });

  it('portfolio row stays pinned above sorted rows regardless of sort order', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Grab every row in DOM order and confirm portfolio is first.
    const rows = screen.getAllByRole('row');
    // rows[0] and [1] are the two thead rows; portfolio is [2].
    expect(rows[2].getAttribute('data-testid')).toBe('portfolio-row');

    // Toggle sort by clicking the CR Tot header (default is desc → asc).
    fireEvent.click(screen.getByTestId('leaf-header-totalCR'));
    const rowsAfter = screen.getAllByRole('row');
    expect(rowsAfter[2].getAttribute('data-testid')).toBe('portfolio-row');
  });

  it('defaults to CR Tot desc (worst office first below portfolio)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    const rows = screen.getAllByRole('row');
    // rows: [thead1, thead2, portfolio, sorted...]
    // Charleston (386) > Newark (289) > Denver (205) > Anchorage (0).
    expect(rows[3].getAttribute('data-testid')).toBe('office-row-Charleston');
    expect(rows[4].getAttribute('data-testid')).toBe('office-row-Newark');
    expect(rows[5].getAttribute('data-testid')).toBe('office-row-Denver');
    expect(rows[6].getAttribute('data-testid')).toBe('office-row-Anchorage');
  });

  it('clicking a leaf header changes sort direction and reorders rows', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // One click on the already-active CR Tot column → flip to asc.
    fireEvent.click(screen.getByTestId('leaf-header-totalCR'));
    const rows = screen.getAllByRole('row');
    // Asc: Anchorage (0) → Denver (205) → Newark (289) → Charleston (386).
    expect(rows[3].getAttribute('data-testid')).toBe('office-row-Anchorage');
    expect(rows[6].getAttribute('data-testid')).toBe('office-row-Charleston');
  });

  it('root grid is a real <table> element (browser-native TSV copy works)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    const table = screen.getByTestId('matrix-table');
    expect(table.tagName).toBe('TABLE');
  });

  it('renders null OfficeSummary fields as em-dash, not 0', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    const anchor = screen.getByTestId('office-row-Anchorage');
    const cells = within(anchor).getAllByRole('cell');
    // retailCR is null on the fixture → column index 2.
    expect(cells[2].textContent?.trim()).toBe('—');
    // wsCR is null → column index 3.
    expect(cells[3].textContent?.trim()).toBe('—');
    // revisedTotalCR is null → column index 18.
    expect(cells[18].textContent?.trim()).toBe('—');
    // But totalLoans is 2, not null → column index 4.
    expect(cells[4].textContent?.trim()).toBe('2');
  });

  it('Copy button writes TSV to navigator.clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('copy-table-btn'));
    // Microtask flush.
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);
    const tsv = writeText.mock.calls[0][0] as string;
    // Header row 2 should start with '\t' (empty office column) and
    // contain the leaf labels we care about.
    expect(tsv).toContain('Tot\tRet\tWS');
    expect(tsv).toContain('R Non-DPA\tR Boost\tR Other DPA');
    // Portfolio row present.
    expect(tsv).toContain('PORTFOLIO TOTAL');
    // Every office name is present.
    for (const o of offices) expect(tsv).toContain(o.name);
    // Row separator is newline.
    expect(tsv.split('\n').length).toBeGreaterThanOrEqual(2 + 1 + offices.length);
  });

  it('row expand renders the DQ-loan breakdown for that office', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Charleston has 2 DQ loans in the fixture.
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    const expand = screen.getByTestId('expand-row-Charleston');
    expect(expand).toBeTruthy();
    const dqTable = within(expand).getByTestId('dq-loan-table');
    // 1 thead row + 2 loan rows.
    const bodyRows = within(dqTable).getAllByRole('row');
    expect(bodyRows).toHaveLength(1 + 2);
    // Boost + Non-DPA labels visible in the DPA Program column.
    expect(within(dqTable).getByText('Boost')).toBeTruthy();
    expect(within(dqTable).getByText('Non-DPA')).toBeTruthy();
  });

  it('shows "no delinquent loans" empty state when an office has none', () => {
    // Anchorage has no DQ loans in the fixture.
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Anchorage'));
    const expand = screen.getByTestId('expand-row-Anchorage');
    expect(expand.textContent).toContain('No delinquent loans');
  });

  it('collapse + re-expand keeps the "was expanded" cache marker', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Expand.
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    expect(screen.getByTestId('expand-row-Charleston')).toBeTruthy();
    // Collapse.
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    expect(screen.queryByTestId('expand-row-Charleston')).toBeNull();
    // Re-expand.
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    // Cache marker present — proves the office is in `expandedCache`
    // (which never sheds entries after first expand).
    expect(screen.getByTestId('cache-marker-Charleston')).toBeTruthy();
  });

  it('sort caret only appears on the active column', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Default active column is totalCR.
    expect(screen.getByTestId('leaf-header-totalCR').textContent).toMatch(/[▲▼]/);
    expect(screen.getByTestId('leaf-header-name').textContent).not.toMatch(/[▲▼]/);
    // Switch to name column.
    fireEvent.click(screen.getByTestId('leaf-header-name'));
    expect(screen.getByTestId('leaf-header-name').textContent).toMatch(/[▲▼]/);
    expect(screen.getByTestId('leaf-header-totalCR').textContent).not.toMatch(/[▲▼]/);
  });
});
