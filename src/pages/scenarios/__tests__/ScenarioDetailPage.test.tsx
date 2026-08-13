/**
 * ScenarioDetailPage — PR-C tests.
 *
 * Covers acceptance criteria from the PR-C spec:
 *   1. Renders a seed scenario deep-linked at /scenarios/:id.
 *   2. XLSX export button fires the TODO handler (backend endpoint not
 *      yet implemented — see design §5.6, §6.8).
 *   3. Deep-link cold load — pasting /scenarios/:id into a fresh session
 *      still renders correctly (rendered with an `id` prop for a Router-
 *      independent smoke).
 *   4. Renders the predicate list from the store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ScenarioDetailPage from '../ScenarioDetailPage';
import * as store from '@/lib/scenarios/store';

const TEST_OWNER = 'test-owner-detail';

function makeEvaluateResponse() {
  return {
    cache_key: 'sha256:test',
    snapshot_month: '2026-06',
    cr_current: 158.0,
    cr_revised: 141.0,
    delta_bps: -170,
    n_removed: 65,
    offices_over_150_current: 2,
    offices_over_150_revised: 1,
    per_office: [
      { office_id: 'Charleston', hud_cr: 386, revised_cr: 300, n_loans: 400, n_removed: 40, driver_breakdown: { boost_membership: 40 } },
      { office_id: 'Newark',     hud_cr: 289, revised_cr: 260, n_loans: 800, n_removed: 25, driver_breakdown: { boost_membership: 25 } },
    ],
  };
}

function renderDeepLink(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/scenarios/${id}`]}>
      <Routes>
        <Route
          path="/scenarios/:id"
          element={
            <ScenarioDetailPage
              ownerId={TEST_OWNER}
              snapshotMonth="2026-06"
              previewDebounceMs={0}
            />
          }
        />
        <Route path="/scenarios/:id/edit" element={<div data-testid="edit-route">edit</div>} />
        <Route path="/scenarios" element={<div data-testid="library-route">library</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ScenarioDetailPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    store._resetForTests(TEST_OWNER);
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
    store._resetForTests(TEST_OWNER);
  });

  it('deep-link cold load — /scenarios/s1-boost-full-removal renders the seed', async () => {
    renderDeepLink('s1-boost-full-removal');
    expect(await screen.findByTestId('scenario-detail-title')).toHaveTextContent(/S1 — Boost fully removed/);
    const summary = await screen.findByTestId('scenario-predicate-summary');
    expect(summary).toHaveTextContent(/Boost membership/i);
    expect(summary).toHaveTextContent(/AND/);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('subtotal-total')).toBeInTheDocument());
  });

  it('XLSX export button fires the TODO handler when clicked', async () => {
    renderDeepLink('s2-boost-fico-eg');
    const btn = await screen.findByTestId('xlsx-export-button');
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    expect(screen.getByTestId('xlsx-export-button')).toBeInTheDocument();
    // No /api/scenarios/*/xlsx call went out — only preview evaluate calls.
    for (const call of fetchMock.mock.calls) {
      const url = call[0] as string;
      expect(url).not.toContain('/xlsx');
    }
  });

  it('renders "Scenario not found" for an unknown id', async () => {
    renderDeepLink('not-a-real-scenario-xyz');
    expect(await screen.findByText(/Scenario not found/i)).toBeInTheDocument();
  });

  it('Router-independent smoke — page renders when handed an explicit id prop', async () => {
    render(
      <MemoryRouter>
        <ScenarioDetailPage
          id="s3-boost-guidelines-tighten"
          ownerId={TEST_OWNER}
          snapshotMonth="2026-06"
          previewDebounceMs={0}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('scenario-detail-title')).toHaveTextContent(/S3/);
  });

  it('seed scenarios do not show the Edit button; user scenarios do', async () => {
    renderDeepLink('s1-boost-full-removal');
    await screen.findByTestId('scenario-detail-title');
    expect(screen.queryByTestId('edit-scenario-button')).not.toBeInTheDocument();

    cleanup();

    const created = store.create(TEST_OWNER, {
      name: 'User custom',
      description: '',
      predicates: [{ predicate_id: 'boost_membership', params: {} }],
      composition_op: 'AND',
    });
    renderDeepLink(created.id);
    expect(await screen.findByTestId('edit-scenario-button')).toBeInTheDocument();
  });
});
