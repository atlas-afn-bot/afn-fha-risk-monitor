import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Snapshot, ProjectionScenario } from '@/types/snapshot';
import ProjectionControls from '@/components/projections/ProjectionControls';
import ProjectionRatioCard from '@/components/projections/ProjectionRatioCard';
import ThresholdStatusCard from '@/components/projections/ThresholdStatusCard';
import OutflowInflowChart from '@/components/projections/OutflowInflowChart';
import ProjectedWatchlist from '@/components/projections/ProjectedWatchlist';
import LoanLevelAccordion from '@/components/projections/LoanLevelAccordion';
import MethodologyInline from '@/components/projections/MethodologyInline';
import {
  type HorizonMonths,
  type ScopeSelection,
} from '@/components/projections/types';
import {
  selectScope,
  thresholdRollup,
} from '@/components/projections/selectors';

interface Props {
  snapshot: Snapshot;
}

/**
 * Projections tab — forward-looking risk cockpit built on top of the
 * `projections` block emitted by `scripts/build_projections.py` (backend
 * PR #29, merged 2026-07-01).
 *
 * Layout follows ATHENA's Design v1 spec:
 *   1. Methodology explainer (collapsed inline + full standalone page)
 *   2. Sticky control bar — Timeframe / Scenario / Scope
 *   3. Two-up: Projected Compare Ratio card + Threshold Status card
 *   4. Full-width Outflow-vs-Inflow chart
 *   5. AI Projected Watchlist card grid
 *   6. Loan-level drill-down accordion
 *
 * Every widget subscribes to (timeframe, scenario, scope) and re-derives
 * from the snapshot's projections block. No mock data — if a snapshot
 * pre-dates PR #29 we show a graceful empty state.
 */
export default function Projections({ snapshot }: Props) {
  const projections = snapshot.projections;
  const [timeframe, setTimeframe] = useState<HorizonMonths>(3);
  const [scenario, setScenario] = useState<ProjectionScenario>('base');
  const [scope, setScope] = useState<ScopeSelection>({ kind: 'all' });

  // Every widget below reads from these derived views so it stays in sync
  // with the control bar.
  const view = useMemo(
    () => projections ? selectScope(projections, scope, timeframe, scenario) : null,
    [projections, scope, timeframe, scenario],
  );
  const rollup = useMemo(
    () => projections ? thresholdRollup(projections, timeframe, scenario, scope) : null,
    [projections, timeframe, scenario, scope],
  );

  if (!projections) {
    return (
      <div className="space-y-6">
        <MethodologyInline snapshot={snapshot} />
        <div className="rounded-2xl border border-risk-yellow/40 bg-risk-yellow-bg p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-risk-yellow flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-risk-yellow mb-1">
                Projections not available for this snapshot
              </h3>
              <p className="text-xs text-foreground/80">
                This snapshot ({snapshot.snapshot_meta.label}) was produced before the
                projections feature shipped ({/* backend PR #29 */}
                <code className="text-[11px] bg-muted px-1 rounded">projections</code> block missing).
                Load a more recent snapshot or run{' '}
                <code className="text-[11px] bg-muted px-1 rounded">
                  python3 scripts/build_projections.py {snapshot.snapshot_meta.period}
                </code>{' '}
                to backfill it in place.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1 — Methodology inline (collapsed by default). This is Michael's
          explicit ask: Stefanie must be able to audit every number without
          reading Python. */}
      <MethodologyInline snapshot={snapshot} projections={projections} />

      {/* 2 — Sticky control bar */}
      <ProjectionControls
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        scenario={scenario}
        onScenarioChange={setScenario}
        scope={scope}
        onScopeChange={setScope}
        projections={projections}
      />

      {/* 3 — Top row: Ratio gauge + Threshold status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5">
          {view && (
            <ProjectionRatioCard view={view} timeframe={timeframe} scenario={scenario} />
          )}
        </div>
        <div className="lg:col-span-7">
          {rollup && view && (
            <ThresholdStatusCard
              rollup={rollup}
              timeframe={timeframe}
              scenario={scenario}
              scopeLabel={view.label}
            />
          )}
        </div>
      </div>

      {/* 4 — Full-width chart */}
      <OutflowInflowChart
        snapshot={snapshot}
        projections={projections}
        timeframe={timeframe}
        scenario={scenario}
        scope={scope}
      />

      {/* 5 — AI Projected Watchlist */}
      <ProjectedWatchlist
        insights={snapshot.ai_insights}
        timeframe={timeframe}
        scenario={scenario}
        hasProjections={true}
        hasAnyInsights={(snapshot.ai_insights?.length ?? 0) > 0}
        projections={projections}
      />

      {/* 6 — Loan-level drill-down (Stefanie's audit surface) */}
      <LoanLevelAccordion
        projections={projections}
        timeframe={timeframe}
        scenario={scenario}
        scope={scope}
      />

      {/* Footer disclaimer */}
      <div className="text-[10px] text-muted-foreground italic border-t border-border pt-3">
        Projections based on First Payment Due Date roll-off + ±10% scenario stress applied
        office-side only (national reference held flat). Not a guarantee.
        Snapshot: {snapshot.snapshot_meta.label} · generated{' '}
        {new Date(snapshot.snapshot_meta.generated_at).toLocaleString()}.
      </div>
    </div>
  );
}
