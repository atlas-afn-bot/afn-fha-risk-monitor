/**
 * Pure selectors that translate (scope, timeframe, scenario) into the
 * horizon-block the widgets render. Kept away from the components so they
 * stay dumb + easy to test / reason about.
 */

import type {
  ProjectionHorizonBlock,
  ProjectionScenarioResult,
  ProjectionScenario,
  ProjectionStatus,
  SnapshotProjections,
} from '@/types/snapshot';
import { horizonKey, type HorizonMonths, type ScopeSelection } from './types';

/** Result of selecting a horizon block + scenario for the current scope. */
export interface ScopedHorizonView {
  label: string;                             // "All AFN" | "Denver HOC" | "Charleston"
  currentCompareRatio: number | null;        // ratio today (not scenario-adjusted)
  currentStatus: ProjectionStatus;
  currentLoans: number;
  currentDelinquent: number;
  horizon: ProjectionHorizonBlock;
  scenario: ProjectionScenarioResult;
  scenarioName: ProjectionScenario;
}

/**
 * Given the whole projections block + the UI state, return the horizon-block
 * for the selected scope, plus a display label. Falls back to national when
 * a scope's projections are missing.
 */
export function selectScope(
  projections: SnapshotProjections,
  scope: ScopeSelection,
  timeframe: HorizonMonths,
  scenario: ProjectionScenario,
): ScopedHorizonView {
  const key = horizonKey(timeframe);

  if (scope.kind === 'hoc' && scope.id && projections.hocs[scope.id]) {
    const h = projections.hocs[scope.id];
    return {
      label: `${scope.id} HOC`,
      currentCompareRatio: h.current_compare_ratio,
      currentStatus: h.current_threshold_status,
      currentLoans: h.horizons[key].current_loans_in_window,
      currentDelinquent: h.horizons[key].current_delinquent,
      horizon: h.horizons[key],
      scenario: h.horizons[key].scenarios[scenario],
      scenarioName: scenario,
    };
  }

  if (scope.kind === 'office' && scope.id) {
    const o = projections.offices.find(x => x.office_id === scope.id);
    if (o) {
      return {
        label: o.office_name,
        currentCompareRatio: o.current_compare_ratio,
        currentStatus: o.current_threshold_status,
        currentLoans: o.horizons[key].current_loans_in_window,
        currentDelinquent: o.horizons[key].current_delinquent,
        horizon: o.horizons[key],
        scenario: o.horizons[key].scenarios[scenario],
        scenarioName: scenario,
      };
    }
  }

  // Default → national
  const nat = projections.national[key];
  const natSc = nat.scenarios[scenario];
  const currentStatus: ProjectionStatus =
    projections.current_compare_ratio_total == null ? 'unknown'
      : projections.current_compare_ratio_total > 200 ? 'breach'
      : projections.current_compare_ratio_total >= 150 ? 'watch'
      : 'safe';
  return {
    label: 'All AFN (National)',
    currentCompareRatio: projections.current_compare_ratio_total,
    currentStatus,
    currentLoans: nat.current_loans_in_window,
    currentDelinquent: nat.current_delinquent,
    horizon: nat,
    scenario: natSc,
    scenarioName: scenario,
  };
}

/** Rollup of Safe / Watch / Breach counts across offices, current vs projected. */
export interface ThresholdRollup {
  safe: { current: number; projected: number };
  watch: { current: number; projected: number };
  breach: { current: number; projected: number };
  total: number;
}

export function thresholdRollup(
  projections: SnapshotProjections,
  timeframe: HorizonMonths,
  scenario: ProjectionScenario,
  scope: ScopeSelection,
): ThresholdRollup {
  const key = horizonKey(timeframe);
  const offices = filterOfficesByScope(projections, scope);

  const rollup: ThresholdRollup = {
    safe: { current: 0, projected: 0 },
    watch: { current: 0, projected: 0 },
    breach: { current: 0, projected: 0 },
    total: offices.length,
  };

  for (const o of offices) {
    // current
    const cur = o.current_threshold_status;
    if (cur === 'breach') rollup.breach.current++;
    else if (cur === 'watch') rollup.watch.current++;
    else rollup.safe.current++;

    // projected
    const proj = o.horizons[key].scenarios[scenario].projected_threshold_status;
    if (proj === 'breach') rollup.breach.projected++;
    else if (proj === 'watch') rollup.watch.projected++;
    else rollup.safe.projected++;
  }
  return rollup;
}

export function filterOfficesByScope(
  projections: SnapshotProjections,
  scope: ScopeSelection,
) {
  if (scope.kind === 'hoc' && scope.id) {
    return projections.offices.filter(o => o.hoc === scope.id);
  }
  if (scope.kind === 'office' && scope.id) {
    return projections.offices.filter(o => o.office_id === scope.id);
  }
  return projections.offices;
}
