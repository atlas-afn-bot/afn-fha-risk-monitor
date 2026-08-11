/**
 * snapshotLoader — URL-shape regression tests.
 *
 * Phase-2 cutover: the loader now fetches from the SWA function routes
 * (`/api/snapshot/index`, `/api/snapshot/{period}`) instead of the
 * repo-bundled `public/data/snapshots/*.json` static files.
 *
 * These tests guard against silent drift back to the static paths by
 * asserting the exact URL passed to `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSnapshot, loadSnapshotIndex } from '../snapshotLoader';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, init: Partial<ResponseInit> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('snapshotLoader — API-backed URL shape', () => {
  let fetchMock: FetchMock;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    (globalThis as unknown as { fetch: FetchMock }).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as unknown as { fetch: typeof originalFetch }).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loadSnapshotIndex fetches /api/snapshot/index (not data/snapshots/index.json)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        periods: [
          { period: '2026-06', label: 'June 2026' },
          { period: '2026-05', label: 'May 2026' },
        ],
      }),
    );

    const idx = await loadSnapshotIndex();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/\/api\/snapshot\/index$/);
    expect(url).not.toContain('data/snapshots');
    expect(idx.periods[0].period).toBe('2026-06');
  });

  it('loadSnapshot fetches /api/snapshot/{period} (not data/snapshots/{period}.json)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        snapshot_meta: { period: '2026-06', label: 'June 2026' },
        offices: [],
      }),
    );

    const snap = await loadSnapshot('2026-06');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/\/api\/snapshot\/2026-06$/);
    expect(url).not.toContain('data/snapshots');
    expect(url).not.toMatch(/\.json$/);
    expect(snap.snapshot_meta.period).toBe('2026-06');
  });

  it('loadSnapshot rejects malformed period without hitting fetch', async () => {
    await expect(loadSnapshot('2026/06')).rejects.toThrow(/Invalid period format/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loadSnapshot surfaces snapshot_meta.period mismatch', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        snapshot_meta: { period: '2026-05', label: 'May 2026' },
        offices: [],
      }),
    );

    await expect(loadSnapshot('2026-06')).rejects.toThrow(/period mismatch/);
  });
});
