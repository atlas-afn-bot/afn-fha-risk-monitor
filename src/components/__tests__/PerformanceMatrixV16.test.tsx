/**
 * PerformanceMatrixV16 — behavior tests for PR-D + PR-D.1 polish.
 *
 * Covers the acceptance criteria from the PR-D and PR-D.1 briefs:
 *   1. Renders the two-row grouped header with 26 leaf columns matching
 *      the v16 sheet spec (Office | CR ×3 | Loans ×3 | DQ ×3 |
 *      DLQ Breakdown ×6 | Removed ×2 | Revised CR ×3 | DPA Conc% ×3 |
 *      Status | Notes).
 *   2. Renders every office as a row (no cap, no CR-band filter).
 *   3. PORTFOLIO TOTAL row pinned at the top with correct summed
 *      values.
 *   4. Default sort is the two-key canonical bucket (Term Risk →
 *      Credit Watch → Safe) then CR Tot desc within each bucket.
 *   5. Clicking a leaf header REPLACES the two-key default; cycling
 *      through direction → clear returns to the default. PORTFOLIO
 *      TOTAL stays pinned at the top regardless.
 *   6. Copy button writes TSV to navigator.clipboard.
 *   7. Native <table> structure (root grid is `<table>`, not divs).
 *   8. Null OfficeSummary fields render as em-dash (—), not 0.
 *   9. Row expand: clicking an office renders the DQ-loan table
 *      filtered to that office's delinquent loans; header column is
 *      "Row" (not "Loan #") since ParsedLoan has no true loan-number.
 *  10. Collapse + re-expand keeps the "was expanded" cache marker
 *      (proxy for the no-remount contract).
 *  11. PR-D.1: risk color coding on Status pill, CR Tot, Revised CR
 *      Tot, and R/WS Boost DLQ cells.
 *  12. PR-D.1: sticky thead + Maximize portal + Esc closes + sort
 *      state persists across maximize toggle.
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
  // Charleston: totalCR 386, 400 loans → Term Risk. Boost columns > 0
  // to exercise the color-coded R/WS Boost DLQ cells.
  makeOffice('Charleston', { totalCR: 386, retailCR: 342, wsCR: 447, totalLoans: 400, retailLoans: 250, wsLoans: 150, totalDLQ: 20, retailBoostDLQ: 5, wsBoostDLQ: 3, revisedTotalCR: 180 }),
  // Newark: totalCR 289, 800 loans → Term Risk. Boost columns 0/0 to
  // exercise the "no color when 0" branch.
  makeOffice('Newark', { totalCR: 289, retailCR: 270, wsCR: 310, totalLoans: 800, retailLoans: 450, wsLoans: 350, totalDLQ: 40, retailBoostDLQ: 0, wsBoostDLQ: 0, revisedTotalCR: 210 }),
  // Denver: totalCR 205, 600 loans → Term Risk. Revised CR 160 →
  // yellow (150 < 160 ≤ 200).
  makeOffice('Denver', { totalCR: 205, retailCR: 190, wsCR: 220, totalLoans: 600, retailLoans: 350, wsLoans: 250, totalDLQ: 25, retailBoostDLQ: 0, wsBoostDLQ: 0, revisedTotalCR: 160 }),
  // Boston: totalCR 175, 300 loans → Credit Watch bucket. Sanity-
  // check for the two-key default sort ordering.
  makeOffice('Boston', { totalCR: 175, retailCR: 160, wsCR: 195, totalLoans: 300, retailLoans: 200, wsLoans: 100, totalDLQ: 15, revisedTotalCR: 130 }),
  // Small office with null wsCR and total book size well below Credit
  // Watch loan-count clause when combined with low CR — verifies em-
  // dash rendering and the Safe bucket.
  makeOffice('Anchorage', { totalCR: 0, retailCR: null, wsCR: null, totalLoans: 2, retailLoans: 0, wsLoans: 2, totalDLQ: 0, revisedTotalCR: null, revisedRetailCR: null, revisedWSCR: null, retailDPAConc: 0, wsDPAConc: 100, totalDPAConc: 100 }),
];

function makeLoan(office: string, dq: boolean, extra: Partial<ParsedLoan> = {}): ParsedLoan {
  return {
    LoanNumber: '',
    FHACaseNumber: null,
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
    HasManualUW: false,
    HasGiftGrant: false,
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
  makeLoan('Charleston', true, {
    LoanNumber: '91240030846',
    FHACaseNumber: '013-0390395',
    DPAProgram: 'Boost',
    isBoost: true,
    isDPA: true,
    FICO: 590,
    channelType: 'Wholesale',
    LTVGroup: '95-97',
    ReserveMonths: 0,
    HasManualUW: true,
  }),
  makeLoan('Charleston', true, {
    LoanNumber: '90550022649',
    FHACaseNumber: '013-0487430',
    DPAProgram: 'Non-DPA',
    FICO: 650,
    channelType: 'Wholesale',
    LTVGroup: '95-97',
    ReserveMonths: 0,
    HasGiftGrant: true,
  }),
  makeLoan('Charleston', false),
  makeLoan('Newark', true, {
    LoanNumber: '77123456789',
    FHACaseNumber: null,
    DPAProgram: 'Boost',
    isBoost: true,
    isDPA: true,
    FICO: 620,
  }),
  makeLoan('Denver', false),
];

// ── Suite ──────────────────────────────────────────────────────────────

describe('PerformanceMatrixV16 — PR-D + PR-D.1 unified matrix', () => {
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
    // Total loans: 400 + 800 + 600 + 300 + 2 = 2102.
    // Column index for totalLoans is 4 (0-indexed).
    expect(cells[4].textContent?.trim()).toBe('2102');
    // Total DLQ: 20 + 40 + 25 + 15 + 0 = 100.
    expect(cells[7].textContent?.trim()).toBe('100');
    // Notes column carries 'Portfolio-wide'.
    expect(cells[25].textContent?.trim()).toBe('Portfolio-wide');
  });

  it('portfolio row stays pinned above sorted rows regardless of sort order', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Grab every row in DOM order and confirm portfolio is first.
    const rows = screen.getAllByRole('row');
    // rows[0] and [1] are the two thead rows; portfolio is [2].
    expect(rows[2].getAttribute('data-testid')).toBe('portfolio-row');

    // Toggle sort by clicking the CR Tot header — that overrides the
    // two-key default with a column-only sort. Portfolio still pinned.
    fireEvent.click(screen.getByTestId('leaf-header-totalCR'));
    const rowsAfter = screen.getAllByRole('row');
    expect(rowsAfter[2].getAttribute('data-testid')).toBe('portfolio-row');
  });

  it('default sort is two-key: Term Risk bucket first, then CR Tot desc within bucket', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    const rows = screen.getAllByRole('row');
    // rows: [thead1, thead2, portfolio, sorted...]
    // Term Risk offices (Charleston 386, Newark 289, Denver 205) come
    // before the Credit Watch office (Boston 175) which comes before
    // the Safe office (Anchorage 0).
    expect(rows[3].getAttribute('data-testid')).toBe('office-row-Charleston');
    expect(rows[4].getAttribute('data-testid')).toBe('office-row-Newark');
    expect(rows[5].getAttribute('data-testid')).toBe('office-row-Denver');
    expect(rows[6].getAttribute('data-testid')).toBe('office-row-Boston');
    expect(rows[7].getAttribute('data-testid')).toBe('office-row-Anchorage');
  });

  it('default sort: no leaf header is marked active until user clicks', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // With the two-key canonical default, no column header owns the
    // sort — the caret should be absent.
    expect(screen.getByTestId('leaf-header-totalCR').textContent).not.toMatch(/[▲▼]/);
    expect(screen.getByTestId('leaf-header-name').textContent).not.toMatch(/[▲▼]/);
  });

  it('clicking a leaf header REPLACES the two-key default and reorders rows', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // First click on Office name column → asc alphabetical, ignoring
    // the two-key bucket.
    fireEvent.click(screen.getByTestId('leaf-header-name'));
    const rows = screen.getAllByRole('row');
    // Asc alpha: Anchorage → Boston → Charleston → Denver → Newark.
    expect(rows[3].getAttribute('data-testid')).toBe('office-row-Anchorage');
    expect(rows[4].getAttribute('data-testid')).toBe('office-row-Boston');
    expect(rows[5].getAttribute('data-testid')).toBe('office-row-Charleston');
    expect(rows[6].getAttribute('data-testid')).toBe('office-row-Denver');
    expect(rows[7].getAttribute('data-testid')).toBe('office-row-Newark');
    // Caret should now show on name.
    expect(screen.getByTestId('leaf-header-name').textContent).toMatch(/[▲▼]/);
  });

  it('cycling a column header (asc → desc → clear) returns to two-key default', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Click totalCR — first click sets desc (numeric default direction).
    fireEvent.click(screen.getByTestId('leaf-header-totalCR'));
    expect(screen.getByTestId('leaf-header-totalCR').textContent).toMatch(/▼/);
    // Second click flips to asc.
    fireEvent.click(screen.getByTestId('leaf-header-totalCR'));
    expect(screen.getByTestId('leaf-header-totalCR').textContent).toMatch(/▲/);
    // Third click clears → two-key default restored.
    fireEvent.click(screen.getByTestId('leaf-header-totalCR'));
    expect(screen.getByTestId('leaf-header-totalCR').textContent).not.toMatch(/[▲▼]/);
    const rows = screen.getAllByRole('row');
    // Bucket-ordered again.
    expect(rows[3].getAttribute('data-testid')).toBe('office-row-Charleston');
    expect(rows[7].getAttribute('data-testid')).toBe('office-row-Anchorage');
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

  // ── PR-D.2 issue 2 — real loan numbers + FHA case tooltip ────────

  it('DQ expand header is "Loan #" (issue 2)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    const header = screen.getByTestId('dq-loan-loannumber-header');
    expect(header.textContent?.trim()).toBe('Loan #');
    // Old "Row" header should be gone — both the testid and the label.
    expect(screen.queryByTestId('dq-loan-row-header')).toBeNull();
  });

  it('DQ expand table renders real Encompass loan numbers (issue 2)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    const dqTable = screen.getByTestId('dq-loan-table');
    // Both Charleston DQ loans have LoanNumber populated in the fixture.
    expect(within(dqTable).getByText('91240030846')).toBeTruthy();
    expect(within(dqTable).getByText('90550022649')).toBeTruthy();
    // Loan-number cell is font-mono.
    const cell = screen.getByTestId('dq-loan-loannumber-cell-0');
    expect(cell.className).toMatch(/font-mono/);
  });

  it('DQ expand table renders em-dash when LoanNumber is missing (issue 2)', () => {
    // Ad-hoc fixture with a loan missing LoanNumber.
    const officesLocal = [makeOffice('TinyOffice', { totalCR: 250, totalLoans: 5, totalDLQ: 1 })];
    const loansLocal = [
      makeLoan('TinyOffice', true, { LoanNumber: '' }),
    ];
    render(<PerformanceMatrixV16 offices={officesLocal} loans={loansLocal} />);
    fireEvent.click(screen.getByTestId('office-row-TinyOffice'));
    const cell = screen.getByTestId('dq-loan-loannumber-cell-0');
    expect(cell.textContent?.trim()).toBe('\u2014');
  });

  it('DQ expand loan-number cell carries a title tooltip with the FHA case number (issue 2)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    const cell = screen.getByTestId('dq-loan-loannumber-cell-0');
    // First DQ loan: FHACaseNumber = '013-0390395'.
    expect(cell.getAttribute('title')).toBe('FHA case 013-0390395');
  });

  it('DQ expand loan-number cell omits title when FHA case number is null (issue 2)', () => {
    // Newark's DQ loan has FHACaseNumber: null.
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Newark'));
    const cell = screen.getByTestId('dq-loan-loannumber-cell-0');
    expect(cell.getAttribute('title')).toBeNull();
  });

  it('DQ expand aria-label includes the real loan number (issue 2)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    const cell = screen.getByTestId('dq-loan-loannumber-cell-0');
    const label = cell.getAttribute('aria-label') || '';
    expect(label).toContain('Loan 91240030846');
    expect(label).toContain('Wholesale');
    expect(label).toContain('FICO 590');
  });

  // ── PR-D.2 issue 3 — Status column dropped from DQ table ────────

  it('DQ expand table no longer renders a Status column (issue 3)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    const dqTable = screen.getByTestId('dq-loan-table');
    const headerRow = within(dqTable).getAllByRole('row')[0];
    const headerCells = within(headerRow).getAllByRole('columnheader');
    // 7 columns: Loan# | Channel | DPA | FICO | DTI | LTV | Reserves.
    expect(headerCells).toHaveLength(7);
    const headers = headerCells.map(h => h.textContent?.trim());
    expect(headers).not.toContain('Status');
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

  it('sort caret only appears on the active column when the user has overridden the default', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Default (two-key) has no active column.
    expect(screen.getByTestId('leaf-header-totalCR').textContent).not.toMatch(/[▲▼]/);
    // Click name column → caret moves there.
    fireEvent.click(screen.getByTestId('leaf-header-name'));
    expect(screen.getByTestId('leaf-header-name').textContent).toMatch(/[▲▼]/);
    expect(screen.getByTestId('leaf-header-totalCR').textContent).not.toMatch(/[▲▼]/);
  });

  // ── PR-D.1 colour coding ────────────────────────────────────────────

  it('Status pill uses risk-red for Term Risk offices', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    const pill = screen.getByTestId('status-pill-Charleston');
    expect(pill.textContent?.trim()).toBe('Term Risk');
    expect(pill.className).toMatch(/text-risk-red/);
    expect(pill.className).toMatch(/bg-risk-red-bg/);
  });

  it('Status pill uses risk-yellow for Credit Watch offices', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    const pill = screen.getByTestId('status-pill-Boston');
    expect(pill.textContent?.trim()).toBe('Credit Watch');
    expect(pill.className).toMatch(/text-risk-yellow/);
    expect(pill.className).toMatch(/bg-risk-yellow-bg/);
  });

  it('Status pill uses risk-green for Safe offices', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    const pill = screen.getByTestId('status-pill-Anchorage');
    expect(pill.textContent?.trim()).toBe('Safe');
    expect(pill.className).toMatch(/text-risk-green/);
    expect(pill.className).toMatch(/bg-risk-green-bg/);
  });

  it('CR Tot cell is red+bold when > 200, yellow when 150–200, plain otherwise', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Charleston 386 → red bold.
    const chr = screen.getByTestId('cell-totalCR-Charleston');
    expect(chr.className).toMatch(/text-risk-red/);
    expect(chr.className).toMatch(/font-semibold/);
    // Boston 175 → yellow.
    const bos = screen.getByTestId('cell-totalCR-Boston');
    expect(bos.className).toMatch(/text-risk-yellow/);
    // Anchorage 0 → no risk class.
    const anc = screen.getByTestId('cell-totalCR-Anchorage');
    expect(anc.className).not.toMatch(/text-risk-red|text-risk-yellow/);
  });

  it('Revised CR Tot cell uses the same threshold color logic (carve-out signal)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Newark revised 210 → red (>200).
    const newark = screen.getByTestId('cell-revisedTotalCR-Newark');
    expect(newark.className).toMatch(/text-risk-red/);
    // Denver revised 160 → yellow.
    const denver = screen.getByTestId('cell-revisedTotalCR-Denver');
    expect(denver.className).toMatch(/text-risk-yellow/);
    // Charleston revised 180 → yellow.
    const chr = screen.getByTestId('cell-revisedTotalCR-Charleston');
    expect(chr.className).toMatch(/text-risk-yellow/);
  });

  it('R Boost / WS Boost DLQ cells go red when count > 0, plain when 0', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Charleston has retailBoostDLQ=5, wsBoostDLQ=3 → both red.
    const cr = screen.getByTestId('cell-retailBoostDLQ-Charleston');
    expect(cr.className).toMatch(/text-risk-red/);
    const cw = screen.getByTestId('cell-wsBoostDLQ-Charleston');
    expect(cw.className).toMatch(/text-risk-red/);
    // Newark has both boost columns at 0 → no red.
    const nr = screen.getByTestId('cell-retailBoostDLQ-Newark');
    expect(nr.className).not.toMatch(/text-risk-red/);
    const nw = screen.getByTestId('cell-wsBoostDLQ-Newark');
    expect(nw.className).not.toMatch(/text-risk-red/);
  });

  // ── PR-D.1 sticky header + Maximize modal ───────────────────────────

  it('thead has sticky positioning classes', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    const thead = screen.getByTestId('matrix-thead');
    expect(thead.className).toMatch(/sticky/);
    expect(thead.className).toMatch(/top-0/);
  });

  it('Maximize button opens a full-viewport modal via portal', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // No modal initially.
    expect(screen.queryByTestId('matrix-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('maximize-table-btn'));
    const modal = screen.getByTestId('matrix-modal');
    expect(modal).toBeTruthy();
    // Portal target = document.body.
    expect(modal.parentElement).toBe(document.body);
    // Modal contains the matrix (same testid still present, since we
    // re-parent the same instance).
    expect(within(modal).getByTestId('matrix-table')).toBeTruthy();
    // Maximize button is now labeled "Close" / has minimize testid.
    expect(within(modal).getByTestId('minimize-table-btn')).toBeTruthy();
  });

  it('Esc key closes the maximize modal', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('maximize-table-btn'));
    expect(screen.getByTestId('matrix-modal')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('matrix-modal')).toBeNull();
    // Inline render restored.
    expect(screen.getByTestId('maximize-table-btn')).toBeTruthy();
  });

  it('Minimize button (inside modal) closes the modal', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('maximize-table-btn'));
    fireEvent.click(screen.getByTestId('minimize-table-btn'));
    expect(screen.queryByTestId('matrix-modal')).toBeNull();
  });

  it('sort state persists across maximize toggle', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Switch to name asc.
    fireEvent.click(screen.getByTestId('leaf-header-name'));
    expect(screen.getByTestId('leaf-header-name').textContent).toMatch(/▲/);
    // Maximize.
    fireEvent.click(screen.getByTestId('maximize-table-btn'));
    // Inside the modal, the same active header carries the caret.
    const modal = screen.getByTestId('matrix-modal');
    const modalHeader = within(modal).getByTestId('leaf-header-name');
    expect(modalHeader.textContent).toMatch(/▲/);
    // First data row after portfolio = Anchorage (alpha asc).
    const rows = within(modal).getAllByRole('row');
    expect(rows[3].getAttribute('data-testid')).toBe('office-row-Anchorage');
    // Close.
    fireEvent.keyDown(window, { key: 'Escape' });
    // Sort still active.
    expect(screen.getByTestId('leaf-header-name').textContent).toMatch(/▲/);
  });

  // ── PR-D.2 issue 1 — alternating row shading ──────────────────

  it('office rows carry alternating shading (bg-muted/20 on odd office indices)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    // Default sort order: Charleston (0), Newark (1), Denver (2),
    // Boston (3), Anchorage (4). Odd indices should be shaded.
    const secondOfficeRow = screen.getByTestId('office-row-Newark');
    expect(secondOfficeRow.className).toMatch(/bg-muted\/20/);
    // The Tailwind `even:` selector class is present on every office
    // row too (see comment in renderRow — kept for future-proofing).
    expect(secondOfficeRow.className).toMatch(/even:/);
    // First office row (0) should NOT carry the shade class directly
    // (it still has `even:bg-muted/20` in the class string, but no
    // resolved bg on its own).
    const firstOfficeRow = screen.getByTestId('office-row-Charleston');
    // Split-and-check to ensure the shade token isn't present as a
    // stand-alone (only as part of the `even:` prefix).
    const tokens = firstOfficeRow.className.split(/\s+/);
    expect(tokens).not.toContain('bg-muted/20');
    // Portfolio row keeps its distinct bold-header background, not
    // the alternating shade.
    const portfolio = screen.getByTestId('portfolio-row');
    expect(portfolio.className).toMatch(/bg-muted\/70/);
    expect(portfolio.className).not.toMatch(/even:/);
  });

  // ── PR-D.2 issue 4 — trends summary section above DQ table ──────

  it('trends summary renders above the delinquent loans table (issue 4)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    const summary = screen.getByTestId('trends-summary-Charleston');
    const table = screen.getByTestId('dq-loan-table');
    // Summary should appear before the DQ loan table in the DOM.
    const rel = summary.compareDocumentPosition(table);
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('risk-factor concentration list surfaces top items by pct desc (issue 4)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    // Charleston fixture: 2 DQ loans, both Wholesale (100%), both
    // LTV 95-97 (100%), both Reserves 0 (100%), one Boost DPA (50%),
    // one Non-DPA (50%), one FICO<620 (50%), etc. Top 3 by pct desc
    // will all be 100% concentrations.
    const list = screen.getByTestId('trends-factors-Charleston');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // The first item should carry the risk-red class (>= 60%).
    expect(items[0].className).toMatch(/text-risk-red/);
    // All three items should show a 100% concentration in this fixture.
    for (const item of items) {
      expect(item.textContent).toMatch(/2\/2 \(100%\)/);
    }
  });

  it('risk-factor concentration list excludes items below 30% (issue 4)', () => {
    // Craft a fixture where the only above-threshold factors are two.
    // 10 DQ loans, all Retail (100%), 2 Boost (20%), 3 FICO<620 (30%).
    const officesLocal = [makeOffice('X', { totalCR: 250, totalLoans: 50, totalDLQ: 10 })];
    const loansLocal: ParsedLoan[] = [];
    for (let i = 0; i < 10; i++) {
      const boost = i < 2;
      const lowFico = i < 3;
      loansLocal.push(
        makeLoan('X', true, {
          LoanNumber: `L${i}`,
          channelType: 'Retail',
          FICO: lowFico ? 610 : 700,
          isBoost: boost,
          isDPA: boost,
          DPAProgram: boost ? 'Boost' : 'Non-DPA',
          LTVGroup: '85-95',
          ReserveMonths: 2,
        }),
      );
    }
    render(<PerformanceMatrixV16 offices={officesLocal} loans={loansLocal} />);
    fireEvent.click(screen.getByTestId('office-row-X'));
    const list = screen.getByTestId('trends-factors-X');
    const items = within(list).getAllByRole('listitem');
    // Retail (100%) and FICO<620 (30%) qualify; Boost (20%) does not.
    // Non-DPA is 80% too. Top 3 desc: Retail 100%, Non-DPA 80%, FICO<620 30% —
    // Boost 20% must not appear.
    const labels = items.map(i => i.textContent);
    expect(labels.some(l => l?.includes('Retail'))).toBe(true);
    expect(labels.some(l => l?.includes('Boost DPA'))).toBe(false);
  });

  it('DPA program mix bar renders segments with widths matching data (issue 4)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    // Charleston: 2 DQ loans = 1 Boost (50%), 1 Non-DPA (50%).
    const boost = screen.getByTestId('trends-dpa-boost-Charleston');
    expect(boost.style.width).toBe('50%');
    const nondpa = screen.getByTestId('trends-dpa-nondpa-Charleston');
    expect(nondpa.style.width).toBe('50%');
    // No Other DPA loans — segment should not render.
    expect(screen.queryByTestId('trends-dpa-other-Charleston')).toBeNull();
  });

  it('channel mix bar renders two segments for mixed channels (issue 4)', () => {
    // Ad-hoc: 4 DQ loans, 3 Retail + 1 Wholesale.
    const officesLocal = [makeOffice('MixCity', { totalCR: 220, totalLoans: 20, totalDLQ: 4 })];
    const loansLocal = [
      makeLoan('MixCity', true, { LoanNumber: '1', channelType: 'Retail' }),
      makeLoan('MixCity', true, { LoanNumber: '2', channelType: 'Retail' }),
      makeLoan('MixCity', true, { LoanNumber: '3', channelType: 'Retail' }),
      makeLoan('MixCity', true, { LoanNumber: '4', channelType: 'Wholesale' }),
    ];
    render(<PerformanceMatrixV16 offices={officesLocal} loans={loansLocal} />);
    fireEvent.click(screen.getByTestId('office-row-MixCity'));
    const retail = screen.getByTestId('trends-channel-retail-MixCity');
    expect(retail.style.width).toBe('75%');
    const wholesale = screen.getByTestId('trends-channel-wholesale-MixCity');
    expect(wholesale.style.width).toBe('25%');
  });

  it('MoM CR delta block is not rendered (per-office history unavailable) (issue 4)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Charleston'));
    // We omit the MoM CR block entirely per the brief; assert no
    // element carries the reserved testid.
    expect(screen.queryByTestId('trends-mom-cr-Charleston')).toBeNull();
  });

  it('trends summary is not rendered when the office has zero DQ loans (issue 4)', () => {
    render(<PerformanceMatrixV16 offices={offices} loans={loans} />);
    fireEvent.click(screen.getByTestId('office-row-Anchorage'));
    expect(screen.queryByTestId('trends-summary-Anchorage')).toBeNull();
    // Empty-state string still surfaces.
    const expand = screen.getByTestId('expand-row-Anchorage');
    expect(expand.textContent).toContain('No delinquent loans');
  });
});
