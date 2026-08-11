/**
 * ExecutiveSummary — behavior tests for the PR B baked-vs-regenerate wiring.
 *
 * Covers:
 *   1. Baked `snapshot.risk_factor_bullets` renders immediately without any
 *      network call.
 *   2. Missing/empty baked field → empty-state prompt + no auto-fire of the
 *      on-demand LLM path.
 *   3. Clicking "Regenerate" POSTs to `/api/regenerate-risk-factor-bullets`
 *      and re-renders with the returned bullets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ExecutiveSummary from '../ExecutiveSummary';
import type { DashboardData } from '@/lib/types';
import type { Snapshot } from '@/types/snapshot';

// ── Minimal DashboardData stub covering only the fields ExecutiveSummary
// actually reads. Cast through `unknown` so we don't have to fabricate 40
// unrelated properties.
function makeData(): DashboardData {
  // Include every field `buildDataSummary` iterates over (dpaPrograms,
  // ficoBuckets, trendAnalysis.*) so the regenerate path can assemble
  // its user prompt without a null-deref.
  return {
    loans: [],
    totalLoans: 12345,
    overallDQRate: 4.2,
    dpaPortfolioConc: 35,
    offices: [],
    dpaPrograms: [],
    dpaMatrix: [],
    retailSummary: {
      totalLoans: 8000,
      dpaConc: 30,
      overallDQRate: 3.5,
      dpaDQRate: 5.1,
    },
    wsSummary: {
      totalLoans: 4000,
      dpaConc: 60,
      overallDQRate: 5.2,
      dpaDQRate: 7.9,
    },
    ficoBuckets: [],
    programComposition: { standard: 100, dpa: 20, standardDQ: 3.0, dpaDQ: 6.0 },
    hasHUDData: true,
    trendAnalysis: {
      ausTypes: [],
      manualUWRate: 5.0,
      manualUWDQRate: 12.0,
      autoUWDQRate: 3.5,
      ltvGroups: [],
      fthb: [],
      dtiGroups: [],
      paymentShockGroups: [],
      sourceOfFunds: [],
      reservesGroups: [],
      riskIndicatorCount: [],
      giftGrantGroups: [],
    },
  } as unknown as DashboardData;
}

function makeSnapshot(rfb: Snapshot['risk_factor_bullets']): Snapshot {
  return {
    snapshot_meta: {
      period: '2026-06',
      label: 'June 2026',
      generated_at: '2026-08-11T20:00:00Z',
    },
    offices: [],
    loans: [],
    risk_factor_bullets: rfb,
  } as unknown as Snapshot;
}

describe('ExecutiveSummary — PR B baked/regenerate wiring', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as unknown as { fetch: typeof originalFetch }).fetch = originalFetch;
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders baked risk_factor_bullets immediately, no fetch call', async () => {
    const snapshot = makeSnapshot({
      bullets: [
        { text: 'Manual UW DQ 12% vs Auto 3% — real driver.', severity: 'red' },
        { text: 'FTHB=Y at 8.1% DQ — watch closely.', severity: 'yellow' },
      ],
      generated_at: '2026-08-01T00:00:00Z',
      generated_by: 'scripts/build-snapshot.py v1.0',
      regenerated_at: null,
      regenerated_by: null,
      schema_version: 1,
    });

    render(<ExecutiveSummary data={makeData()} period="2026-06" snapshot={snapshot} />);

    expect(screen.getByText(/Manual UW DQ 12% vs Auto 3%/)).toBeInTheDocument();
    expect(screen.getByText(/FTHB=Y at 8.1%/)).toBeInTheDocument();
    // No LLM call on mount.
    expect(fetchMock).not.toHaveBeenCalled();
    // Provenance caption should read "generated …".
    expect(screen.getByText(/^generated /)).toBeInTheDocument();
  });

  it('shows empty state and does NOT auto-call LLM when baked field is missing', async () => {
    const snapshot = makeSnapshot(undefined as unknown as Snapshot['risk_factor_bullets']);
    render(<ExecutiveSummary data={makeData()} period="2026-05" snapshot={snapshot} />);
    expect(
      screen.getByText(/Click "Enhance with AI" to generate risk factor analysis/i),
    ).toBeInTheDocument();
    // Give the effect queue a tick — nothing should fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('regenerate button POSTs to /api/regenerate-risk-factor-bullets and re-renders', async () => {
    const snapshot = makeSnapshot({
      bullets: [{ text: 'stale baked bullet', severity: 'neutral' }],
      generated_at: '2026-08-01T00:00:00Z',
      generated_by: 'scripts/build-snapshot.py v1.0',
      regenerated_at: null,
      regenerated_by: null,
      schema_version: 1,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          bullets: [
            { text: 'FRESH bullet from regenerate', severity: 'red' },
          ],
          regenerated_at: '2026-08-11T21:00:00Z',
          regenerated_by: 'entra-oid-xyz',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<ExecutiveSummary data={makeData()} period="2026-06" snapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: /Regenerate/i }));

    await waitFor(() =>
      expect(screen.getByText(/FRESH bullet from regenerate/)).toBeInTheDocument(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/\/api\/regenerate-risk-factor-bullets$/);
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('POST');
    const parsedBody = JSON.parse(String(opts.body));
    expect(parsedBody.period).toBe('2026-06');
    expect(typeof parsedBody.facts).toBe('string');
    expect(parsedBody.facts.length).toBeGreaterThan(50);
    // Provenance flipped to regenerated.
    expect(screen.getByText(/^regenerated /)).toBeInTheDocument();
  });
});
