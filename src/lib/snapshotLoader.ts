/**
 * Snapshot loader — fetches the monthly JSON snapshot that replaces the old
 * Excel upload flow.
 *
 * Layout (served from `public/data/snapshots/…`):
 *   - `index.json`        — listing of available periods (latest-first)
 *   - `{period}.json`     — one file per period, matching {@link Snapshot}
 *
 * Usage:
 *   const index = await loadSnapshotIndex();
 *   const snap  = await loadSnapshot(index.periods[0].period);
 *
 * Both helpers resolve against `import.meta.env.BASE_URL` so the app still
 * works when deployed under a sub-path.
 */

import type { Snapshot, SnapshotIndex } from '@/types/snapshot';

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '') + '/';

function joinBase(path: string): string {
  return BASE + path.replace(/^\/+/, '');
}

export class SnapshotLoadError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SnapshotLoadError';
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = joinBase(path);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    throw new SnapshotLoadError(
      `Failed to load ${url}: ${res.status} ${res.statusText}`,
    );
  }
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new SnapshotLoadError(`Failed to parse ${url} as JSON`, e);
  }
}

/** Load the snapshot index (`public/data/snapshots/index.json`). */
export async function loadSnapshotIndex(): Promise<SnapshotIndex> {
  const idx = await fetchJson<SnapshotIndex>('data/snapshots/index.json');
  if (!idx.periods || idx.periods.length === 0) {
    throw new SnapshotLoadError(
      'Snapshot index is empty — no periods available.',
    );
  }
  // Defensive: sort latest-first in case the writer forgot.
  idx.periods = [...idx.periods].sort((a, b) => (a.period < b.period ? 1 : -1));
  return idx;
}

/** Load a single period snapshot (`public/data/snapshots/{period}.json`). */
export async function loadSnapshot(period: string): Promise<Snapshot> {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new SnapshotLoadError(`Invalid period format: ${period}`);
  }
  const snap = await fetchJson<Snapshot>(`data/snapshots/${period}.json`);
  if (!snap.snapshot_meta || snap.snapshot_meta.period !== period) {
    throw new SnapshotLoadError(
      `Snapshot period mismatch: file reports ${snap.snapshot_meta?.period ?? '∅'}, expected ${period}`,
    );
  }
  return snap;
}

/** Load the index and immediately fetch the latest (or specified) snapshot. */
export async function loadLatestSnapshot(preferPeriod?: string): Promise<{
  index: SnapshotIndex;
  snapshot: Snapshot;
}> {
  const index = await loadSnapshotIndex();
  const target =
    (preferPeriod && index.periods.find(p => p.period === preferPeriod)?.period) ||
    index.periods[0].period;
  const snapshot = await loadSnapshot(target);
  return { index, snapshot };
}
