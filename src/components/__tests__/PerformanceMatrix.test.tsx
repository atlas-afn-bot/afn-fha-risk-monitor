/**
 * PerformanceMatrix — behavior tests for the PR-B reformat.
 *
 * Covers the acceptance criteria from the PR-B spec:
 *   1. Renders all offices from a fixture (no top-N cap).
 *   2. Default sort is HUD CR desc.
 *   3. Sort works on every column click (toggles asc/desc).
 *   4. Channel filter (All/Retail/Wholesale) narrows visible rows.
 *   5. Subtotal rows render for Retail / Wholesale / Total.
 *   6. Row expand triggers a second /api/evaluate call with the full
 *      predicate list.
 *   7. Expand row renders driver breakdown, DLQ Breakdown by Channel,
 *      top 3 drivers.
 *   8. Sticky header attribute set (structural check — Vitest jsdom has
 *      no viewport, so we assert on the CSS class rather than a
 *      screenshot).
 *   9. Loading, empty, error states.
 *
 * All /api/evaluate traffic is mocked — this test does not depend on
 * PR #77 landing. Once PR #77 merges the same tests exercise the live
 * contract through the SWA rewrite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import PerformanceMatrix from '../PerformanceMatrix';
import type { OfficeSummary } from '@/lib/types';

// ── Fixture — three offices spanning termination-risk band so the
// filter fn (>200 CR + >100 loans) keeps them all.
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

const fixtureOffices: OfficeSummary[] = [
  makeOffice('Charleston', { totalCR: 386, retailCR: 342, wsCR: 447, totalLoans: 400, retailLoans: 250, wsLoans: 150, totalDLQ: 20, retailDLQ: 10, wsDLQ: 10 }),
  makeOffice('Newark', { totalCR: 289, retailCR: 270, wsCR: 310, totalLoans: 800, retailLoans: 450, wsLoans: 350, totalDLQ: 40, retailDLQ: 22, wsDLQ: 18 }),
  makeOffice('Denver', { totalCR: 205, retailCR: 190, wsCR: 220, totalLoans: 600, retailLoans: 350, wsLoans: 250, totalDLQ: 25, retailDLQ: 14, wsDLQ: 11 }),
];

function makeEvaluateResponse(overrides: Partial<{
  per_office: Array<{
    office_id: string;
    hud_cr: number;
    revised_cr: number;
    n_loans: number;
    n_removed: number;
    driver_breakdown: Record<string, number>;
  }>;
}> = {}) {
  const per_office = overrides.per_office ?? [
    { office_id: 'Charleston', hud_cr: 386, revised_cr: 340, n_loans: 400, n_removed: 25, driver_breakdown: { fails_enhanced_guidelines: 25 } },
    { office_id: 'Newark', hud_cr: 289, revised_cr: 260, n_loans: 800, n_removed: 41, driver_breakdown: { fails_enhanced_guidelines: 41 } },
    { office_id: 'Denver', hud_cr: 205, revised_cr: 190, n_loans: 600, n_removed: 15, driver_breakdown: { fails_enhanced_guidelines: 15 } },
  ];
  return {
    cache_key: 'sha256:test',
    snapshot_month: '2026-06',
    cr_current: 158.0,
    cr_revised: 141.0,
    delta_bps: -170,
    n_removed: per_office.reduce((a, po) => a + po.n_removed, 0),
    offices_over_150_current: per_office.filter(po => po.hud_cr >= 150).length,
    offices_over_150_revised: per_office.filter(po => po.revised_cr >= 150).length,
    per_office,
  };
}

// Full-registry response for the row-expand path.
function makeExpandResponse() {
  return makeEvaluateResponse({
    per_office: [
      {
        office_id: 'Charleston',
        hud_cr: 386,
        revised_cr: 300,
        n_loans: 400,
        n_removed: 116,
        driver_breakdown: {
          fails_enhanced_guidelines: 41,
          boost_membership: 63,
          fico_lt_580: 12,
          dti_gt_50: 8,
        },
      },
      { office_id: 'Newark', hud_cr: 289, revised_cr: 260, n_loans: 800, n_removed: 41, driver_breakdown: { fails_enhanced_guidelines: 41 } },
      { office_id: 'Denver', hud_cr: 205, revised_cr: 190, n_loans: 600, n_removed: 15, driver_breakdown: { fails_enhanced_guidelines: 15 } },
    ],
  });
}

const alwaysTrue = () => true;

describe('PerformanceMatrix — PR-B reformat', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeEvaluateResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as unknown as { fetch: typeof originalFetch }).fetch = originalFetch;
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders every office from the fixture (no top-N cap)', async () => {
    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Test"
        emoji="🚨"
        filterFn={alwaysTrue}
        snapshotMonth="2026-06"
      />,
    );

    // Wait for top-level evaluate to resolve so skeletons disappear.
    await waitFor(() => expect(screen.getByTestId('office-row-Charleston')).toBeInTheDocument());
    expect(screen.getByTestId('office-row-Newark')).toBeInTheDocument();
    expect(screen.getByTestId('office-row-Denver')).toBeInTheDocument();
  });

  it('defaults to sorting by HUD CR descending', async () => {
    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Test"
        emoji="🚨"
        filterFn={alwaysTrue}
        snapshotMonth="2026-06"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('office-row-Charleston')).toBeInTheDocument());

    const rows = screen.getAllByTestId(/^office-row-/);
    // Charleston (386) should be first, then Newark (289), then Denver (205).
    expect(rows[0]).toHaveAttribute('data-testid', 'office-row-Charleston');
    expect(rows[1]).toHaveAttribute('data-testid', 'office-row-Newark');
    expect(rows[2]).toHaveAttribute('data-testid', 'office-row-Denver');

    // Sort header should reflect the initial state.
    expect(screen.getByTestId('sort-header-hudCR')).toHaveAttribute('aria-sort', 'descending');
  });

  it('sort toggles asc/desc when the same header is clicked', async () => {
    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Test"
        emoji="🚨"
        filterFn={alwaysTrue}
        snapshotMonth="2026-06"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('office-row-Charleston')).toBeInTheDocument());

    // Click Loans header — first click on numeric col = desc.
    fireEvent.click(screen.getByTestId('sort-header-loans'));
    let rows = screen.getAllByTestId(/^office-row-/);
    // Newark (800) > Denver (600) > Charleston (400).
    expect(rows[0]).toHaveAttribute('data-testid', 'office-row-Newark');
    expect(rows[1]).toHaveAttribute('data-testid', 'office-row-Denver');
    expect(rows[2]).toHaveAttribute('data-testid', 'office-row-Charleston');

    // Click again to flip to asc.
    fireEvent.click(screen.getByTestId('sort-header-loans'));
    rows = screen.getAllByTestId(/^office-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'office-row-Charleston');
    expect(rows[2]).toHaveAttribute('data-testid', 'office-row-Newark');

    // Click name — text col defaults to asc.
    fireEvent.click(screen.getByTestId('sort-header-name'));
    rows = screen.getAllByTestId(/^office-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'office-row-Charleston');
    expect(rows[1]).toHaveAttribute('data-testid', 'office-row-Denver');
    expect(rows[2]).toHaveAttribute('data-testid', 'office-row-Newark');
  });

  it('channel filter chips narrow visible rows', async () => {
    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Test"
        emoji="🚨"
        filterFn={alwaysTrue}
        snapshotMonth="2026-06"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('office-row-Charleston')).toBeInTheDocument());

    // Default is All — check chip pressed state.
    expect(screen.getByTestId('channel-filter-All')).toHaveAttribute('aria-pressed', 'true');

    // Switch to Retail — every row should still be present, but the
    // channel cell in each row should read "Retail" (mirrors v16
    // per-channel tabs).
    fireEvent.click(screen.getByTestId('channel-filter-Retail'));
    expect(screen.getByTestId('channel-filter-Retail')).toHaveAttribute('aria-pressed', 'true');
    // Every office row still visible (channel filter doesn't remove
    // offices, it just changes the row's channel scope).
    expect(screen.getByTestId('office-row-Charleston')).toBeInTheDocument();
    expect(screen.getByTestId('office-row-Newark')).toBeInTheDocument();

    // Subtotals: Retail chip → only Retail subtotal + no Wholesale, no Total.
    expect(screen.getByTestId('subtotal-retail')).toBeInTheDocument();
    expect(screen.queryByTestId('subtotal-wholesale')).not.toBeInTheDocument();
    expect(screen.queryByTestId('subtotal-total')).not.toBeInTheDocument();

    // Flip to Wholesale.
    fireEvent.click(screen.getByTestId('channel-filter-Wholesale'));
    expect(screen.queryByTestId('subtotal-retail')).not.toBeInTheDocument();
    expect(screen.getByTestId('subtotal-wholesale')).toBeInTheDocument();
  });

  it('renders Retail, Wholesale, and Total subtotal rows on the default view', async () => {
    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Test"
        emoji="🚨"
        filterFn={alwaysTrue}
        snapshotMonth="2026-06"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('office-row-Charleston')).toBeInTheDocument());

    expect(screen.getByTestId('subtotal-retail')).toBeInTheDocument();
    expect(screen.getByTestId('subtotal-wholesale')).toBeInTheDocument();
    expect(screen.getByTestId('subtotal-total')).toBeInTheDocument();

    // Total portfolio loans = sum of fixture totals: 400+800+600 = 1800.
    const totalRow = screen.getByTestId('subtotal-total');
    expect(within(totalRow).getByText('1800')).toBeInTheDocument();
  });

  it('row expand triggers a second /api/evaluate call with the full registry', async () => {
    // First call = top-level EG-only. Second call (on expand) = full registry.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeEvaluateResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeExpandResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Test"
        emoji="🚨"
        filterFn={alwaysTrue}
        snapshotMonth="2026-06"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('office-row-Charleston')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCallBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(firstCallBody.predicates).toEqual([{ predicate_id: 'fails_enhanced_guidelines', params: {} }]);
    expect(firstCallBody.snapshot_month).toBe('2026-06');

    // Expand Charleston.
    fireEvent.click(screen.getByTestId('expand-toggle-Charleston'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    // Second call should include the full driver-breakdown predicate list
    // (at least the ones the spec calls out).
    const ids = secondCallBody.predicates.map((p: { predicate_id: string }) => p.predicate_id);
    expect(ids).toContain('boost_membership');
    expect(ids).toContain('fico_lt_580');
    expect(ids).toContain('manual_uw');
    expect(secondCallBody.predicates.length).toBeGreaterThan(1);
  });

  it('expand row renders driver breakdown, DLQ block, top 3 drivers', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeEvaluateResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeExpandResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Test"
        emoji="🚨"
        filterFn={alwaysTrue}
        snapshotMonth="2026-06"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('office-row-Charleston')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('expand-toggle-Charleston'));

    // Expand row appears after the full-registry fetch resolves.
    await waitFor(() =>
      expect(screen.getByTestId('expand-row-Charleston')).toBeInTheDocument(),
    );

    const expand = screen.getByTestId('expand-row-Charleston');

    // Driver breakdown — each driver label appears (may show twice:
    // once in the driver list, once in the top-3 block).
    expect(within(expand).getAllByText(/Boost membership/).length).toBeGreaterThan(0);
    expect(within(expand).getAllByText(/FICO < 580/).length).toBeGreaterThan(0);
    expect(within(expand).getAllByText(/Fails Enhanced Guidelines/).length).toBeGreaterThan(0);

    // DLQ Breakdown by Channel block.
    expect(within(expand).getByText(/DLQ Breakdown by Channel/)).toBeInTheDocument();
    // The fixture had retailNonDPADLQ=5, retailBoostDLQ=7, wsBoostDLQ=8.
    // Cell counts appear inside the 6-column DLQ block.
    expect(within(expand).getAllByText('5').length).toBeGreaterThan(0);
    expect(within(expand).getAllByText('7').length).toBeGreaterThan(0);
    expect(within(expand).getAllByText('8').length).toBeGreaterThan(0);

    // Top 3 drivers — sorted by removal count desc.
    // Charleston expand: boost=63, fails_eg=41, fico<580=12, dti>50=8.
    // Top 3: boost, EG, fico_lt_580.
    expect(within(expand).getByTestId('top-driver-boost_membership')).toBeInTheDocument();
    expect(within(expand).getByTestId('top-driver-fails_enhanced_guidelines')).toBeInTheDocument();
    expect(within(expand).getByTestId('top-driver-fico_lt_580')).toBeInTheDocument();
    // dti_gt_50 should NOT be top 3 (it's 4th).
    expect(within(expand).queryByTestId('top-driver-dti_gt_50')).not.toBeInTheDocument();
  });

  it('caches driver breakdown per office (no refetch on re-expand)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(makeEvaluateResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeExpandResponse()), { status: 200 }));

    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Test"
        emoji="🚨"
        filterFn={alwaysTrue}
        snapshotMonth="2026-06"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('office-row-Charleston')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('expand-toggle-Charleston'));
    await waitFor(() => expect(screen.getByTestId('expand-row-Charleston')).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Collapse.
    fireEvent.click(screen.getByTestId('expand-toggle-Charleston'));
    // Re-expand.
    fireEvent.click(screen.getByTestId('expand-toggle-Charleston'));
    await waitFor(() => expect(screen.getByTestId('expand-row-Charleston')).toBeInTheDocument());

    // Still only 2 calls total — cached.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sticky header uses position:sticky class', async () => {
    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Test"
        emoji="🚨"
        filterFn={alwaysTrue}
        snapshotMonth="2026-06"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('office-row-Charleston')).toBeInTheDocument());
    const header = screen.getByTestId('matrix-header');
    // Tailwind class assertion — we can't screenshot in jsdom, so we
    // verify the sticky primitive is present. Real visual regression
    // waits on browser smoke (deferred per PR spec until PR #77 merges).
    expect(header.className).toContain('sticky');
    expect(header.className).toContain('top-0');
  });

  it('shows a loading skeleton on first mount', () => {
    // Make fetch hang so we stay in loading state.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Test"
        emoji="🚨"
        filterFn={alwaysTrue}
        snapshotMonth="2026-06"
      />,
    );

    const skeletons = screen.getAllByTestId('matrix-skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders empty state when the filter matches zero offices', () => {
    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Empty test"
        emoji="🚨"
        filterFn={() => false}
        snapshotMonth="2026-06"
      />,
    );

    expect(screen.getByTestId('matrix-empty')).toBeInTheDocument();
    expect(screen.getByText(/No offices in this band/i)).toBeInTheDocument();
  });

  it('shows an error banner when /api/evaluate fails', async () => {
    fetchMock.mockResolvedValue(
      new Response('server exploded', { status: 500, statusText: 'Internal Server Error' }),
    );

    render(
      <PerformanceMatrix
        offices={fixtureOffices}
        title="Test"
        emoji="🚨"
        filterFn={alwaysTrue}
        snapshotMonth="2026-06"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('matrix-error')).toBeInTheDocument());
    expect(screen.getByText(/Couldn't load Enhanced Guidelines carve-out data/)).toBeInTheDocument();
    // Table still renders (fallback to snapshot-only view).
    expect(screen.getByTestId('office-row-Charleston')).toBeInTheDocument();
  });
});
