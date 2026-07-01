/**
 * Shared local types + helpers for the Projections tab.
 *
 * The heavy schema shapes live in `@/types/snapshot.ts` (SnapshotProjections
 * and friends). Here we just define the small state shapes and constants
 * used across the projections components.
 */

import type {
  ProjectionScenario,
  ProjectionStatus,
} from '@/types/snapshot';

/** Horizons the backend emits — 1 / 3 / 6 months. */
export type HorizonMonths = 1 | 3 | 6;
export const HORIZONS: HorizonMonths[] = [1, 3, 6];

/** Scenario order that matches the toggle order in the UI. */
export const SCENARIOS: ProjectionScenario[] = ['best', 'base', 'worst'];

/** Convert a horizon-in-months number to the JSON key ('1mo' | '3mo' | '6mo'). */
export function horizonKey(h: HorizonMonths): '1mo' | '3mo' | '6mo' {
  return `${h}mo` as '1mo' | '3mo' | '6mo';
}

/** Ratio-zone → color token mapping (matches existing dashboard convention). */
export type Zone = 'safe' | 'watch' | 'breach';
export function zoneFromRatio(ratio: number | null | undefined): Zone {
  if (ratio == null || Number.isNaN(ratio)) return 'safe';
  if (ratio > 200) return 'breach';
  if (ratio >= 150) return 'watch';
  return 'safe';
}

export function statusZone(status: ProjectionStatus | null | undefined): Zone {
  if (status === 'breach') return 'breach';
  if (status === 'watch') return 'watch';
  return 'safe';
}

/** Class map for the three zones — dot / text / border / bg. */
export const zoneClasses: Record<Zone, {
  text: string;
  border: string;
  bg: string;
  bgSoft: string;
  strokeHex: string;
}> = {
  safe: {
    text: 'text-risk-green',
    border: 'border-risk-green/40',
    bg: 'bg-risk-green',
    bgSoft: 'bg-risk-green-bg',
    strokeHex: '#16a34a', // emerald-600
  },
  watch: {
    text: 'text-risk-yellow',
    border: 'border-risk-yellow/40',
    bg: 'bg-risk-yellow',
    bgSoft: 'bg-risk-yellow-bg',
    strokeHex: '#d97706', // amber-600
  },
  breach: {
    text: 'text-risk-red',
    border: 'border-risk-red/40',
    bg: 'bg-risk-red',
    bgSoft: 'bg-risk-red-bg',
    strokeHex: '#dc2626', // red-600
  },
};

export function formatRatio(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toFixed(digits);
}

export function formatSigned(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}`;
}

/** "All" scope sentinel. */
export const ALL_SCOPE = 'all';

export type ScopeKind = 'all' | 'hoc' | 'office';
export interface ScopeSelection {
  kind: ScopeKind;
  /** For 'hoc' → hoc_name; for 'office' → office_id. Ignored for 'all'. */
  id?: string;
}

export const SCENARIO_LABELS: Record<ProjectionScenario, string> = {
  best: 'Best',
  base: 'Base',
  worst: 'Worst',
};

export const SCENARIO_HINTS: Record<ProjectionScenario, string> = {
  best: '−10% delinquency (currently-delinquent loans cure)',
  base: 'No delinquency change (24-mo window rolls forward)',
  worst: '+10% delinquency (currently-current loans go delinquent)',
};
