/**
 * ScenarioBuilderPage — PR-C tests.
 *
 * Covers acceptance criteria from the PR-C spec:
 *   1. Predicate add appends to the working scenario and fires /api/evaluate.
 *   2. Predicate remove drops it (and re-fires evaluate).
 *   3. composition_op toggle re-issues the evaluate call with the new op.
 *   4. Save persists to the store and navigates to /scenarios/:id.
 *   5. Preview KPI + subtotal rows render from the mocked evaluate response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ScenarioBuilderPage from '../ScenarioBuilderPage';
import * as store from '@/lib/scenarios/store';

const TEST_OWNER = 'test-owner-builder';

function makeEvaluateResponse(overrides: Partial<{
  n_removed: number;
  per_office: Array<{ office_id: string; hud_cr: number; revised_cr: number; n_loans: number; n_removed: number; driver_breakdown: Record<string, number> }>;
}> = {}) {
  const per_office = overrides.per_office ?? [
    { office_id: 'Charleston', hud_cr: 386, revised_cr: 300, n_loans: 400, n_removed: 40, driver_breakdown: { boost_membership: 40 } },
    { office_id: 'Newark',     hud_cr: 289, revised_cr: 260, n_loans: 800, n_removed: 25, driver_breakdown: { boost_membership: 25 } },
  ];
  return {
    cache_key: 'sha256:test',
    snapshot_month: '2026-06',
    cr_current: 158.0,
    cr_revised: 141.0,
    delta_bps: -170,
    n_removed: overrides.n_removed ?? per_office.reduce((a, po) => a + po.n_removed, 0),
    offices_over_150_current: 2,
    offices_over_150_revised: 1,
    per_office,
  };
}

function renderPage(initialPath = '/scenarios/new') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/scenarios/new"
          element={<ScenarioBuilderPage mode="new" ownerId={TEST_OWNER} snapshotMonth="2026-06" previewDebounceMs={0} />}
        />
        <Route
          path="/scenarios/:id/edit"
          element={<ScenarioBuilderPage mode="edit" ownerId={TEST_OWNER} snapshotMonth="2026-06" previewDebounceMs={0} />}
        />
        <Route path="/scenarios/:id" element={<div data-testid="detail-route">detail</div>} />
        <Route path="/scenarios" element={<div data-testid="library-route">library</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ScenarioBuilderPage — new', () => {
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

  it('empty state — no predicates selected shows the empty placeholder', async () => {
    renderPage();
    expect(await screen.findByTestId('selected-predicates-empty')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-preview-empty')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-save-button')).toBeDisabled();
  });

  it('adding a predicate fires POST /api/evaluate and renders the preview', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('predicate-add-boost_membership'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.snapshot_month).toBe('2026-06');
    expect(body.composition_op).toBe('AND');
    expect(body.predicates).toEqual([{ predicate_id: 'boost_membership', params: {} }]);
    await waitFor(() => expect(screen.getByTestId('kpi-n-removed')).toBeInTheDocument());
    expect(screen.getByTestId('subtotal-total')).toBeInTheDocument();
    expect(screen.getByTestId('preview-row-Charleston')).toBeInTheDocument();
  });

  it('composition_op toggle re-issues the evaluate call with the new op', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('predicate-add-boost_membership'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('composition-op-OR'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body2 = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body2.composition_op).toBe('OR');
  });

  it('removing a predicate re-issues the evaluate call with the reduced set', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('predicate-add-boost_membership'));
    fireEvent.click(await screen.findByTestId('predicate-add-fico_lt_620'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const initialCalls = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByTestId('remove-predicate-boost_membership'));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls));
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    const ids = body.predicates.map((p: { predicate_id: string }) => p.predicate_id);
    expect(ids).toEqual(['fico_lt_620']);
  });

  it('save persists to the store and navigates to the detail route', async () => {
    renderPage();
    fireEvent.change(await screen.findByTestId('scenario-name-input'), {
      target: { value: 'My tight Boost slice' },
    });
    fireEvent.click(screen.getByTestId('predicate-add-boost_membership'));
    fireEvent.click(screen.getByTestId('scenario-save-button'));
    await waitFor(() => expect(screen.getByTestId('detail-route')).toBeInTheDocument());
    const list = store.list(TEST_OWNER);
    const created = list.find((s) => s.name === 'My tight Boost slice');
    expect(created).toBeTruthy();
    expect(created!.predicates.map((p) => p.predicate_id)).toEqual(['boost_membership']);
    expect(created!.composition_op).toBe('AND');
  });

  it('WEIGHTED composition still calls evaluate (preview coerces to OR)', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('predicate-add-boost_membership'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('composition-op-WEIGHTED'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.composition_op).toBe('OR');
  });
});
