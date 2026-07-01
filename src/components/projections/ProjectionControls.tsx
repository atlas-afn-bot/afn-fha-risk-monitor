import { Sliders } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SnapshotProjections, ProjectionScenario } from '@/types/snapshot';
import {
  HORIZONS,
  SCENARIOS,
  SCENARIO_LABELS,
  SCENARIO_HINTS,
  ALL_SCOPE,
  type HorizonMonths,
  type ScopeSelection,
} from './types';

interface Props {
  timeframe: HorizonMonths;
  onTimeframeChange: (h: HorizonMonths) => void;
  scenario: ProjectionScenario;
  onScenarioChange: (s: ProjectionScenario) => void;
  scope: ScopeSelection;
  onScopeChange: (s: ScopeSelection) => void;
  projections: SnapshotProjections;
}

/**
 * Sticky hero control bar — Timeframe (1/3/6 mo) · Scenario (Best/Base/Worst)
 * · Scope (All / by-HOC / by-Office). Every widget below reacts to state
 * changes; see `ProjectionsTab.tsx` for the wiring.
 */
export default function ProjectionControls({
  timeframe, onTimeframeChange,
  scenario, onScenarioChange,
  scope, onScopeChange,
  projections,
}: Props) {
  const hocNames = Object.keys(projections.hocs).sort();
  const offices = projections.offices
    .slice()
    .sort((a, b) => (b.current_compare_ratio ?? 0) - (a.current_compare_ratio ?? 0));

  const handleScopeChange = (value: string) => {
    if (value === ALL_SCOPE) {
      onScopeChange({ kind: 'all' });
    } else if (value.startsWith('hoc:')) {
      onScopeChange({ kind: 'hoc', id: value.slice(4) });
    } else if (value.startsWith('office:')) {
      onScopeChange({ kind: 'office', id: value.slice(7) });
    }
  };

  const scopeValue =
    scope.kind === 'all' ? ALL_SCOPE :
    scope.kind === 'hoc' ? `hoc:${scope.id}` :
    `office:${scope.id}`;

  return (
    <div className="sticky top-[52px] z-10 -mx-6 px-6 py-3 bg-muted/40 backdrop-blur border-b border-border">
      <div className="flex items-start gap-6 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Sliders className="w-3.5 h-3.5" />
          Projection Controls
        </div>

        {/* Timeframe */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Timeframe
          </span>
          <div className="inline-flex rounded-md border border-border bg-background p-0.5">
            {HORIZONS.map(h => (
              <button
                key={h}
                onClick={() => onTimeframeChange(h)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-sm transition-colors tabular-nums min-w-[52px]',
                  timeframe === h
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={timeframe === h}
              >
                {h} mo
              </button>
            ))}
          </div>
        </div>

        {/* Scenario */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Scenario
          </span>
          <div className="inline-flex rounded-md border border-border bg-background p-0.5">
            {SCENARIOS.map(s => (
              <button
                key={s}
                onClick={() => onScenarioChange(s)}
                title={SCENARIO_HINTS[s]}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-sm transition-colors min-w-[60px]',
                  scenario === s
                    ? s === 'worst'
                      ? 'bg-risk-red text-white shadow-sm'
                      : s === 'best'
                      ? 'bg-risk-green text-white shadow-sm'
                      : 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={scenario === s}
              >
                {SCENARIO_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Scope */}
        <div className="flex flex-col gap-1 min-w-[220px]">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Scope
          </span>
          <select
            value={scopeValue}
            onChange={(e) => handleScopeChange(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value={ALL_SCOPE}>All AFN — National view</option>
            <optgroup label="By HOC">
              {hocNames.map(n => (
                <option key={n} value={`hoc:${n}`}>
                  {n} HOC
                </option>
              ))}
            </optgroup>
            <optgroup label="By HUD Office (top by current CR)">
              {offices.map(o => (
                <option key={o.office_id} value={`office:${o.office_id}`}>
                  {o.office_name}
                  {o.current_compare_ratio != null ? ` · CR ${Math.round(o.current_compare_ratio)}` : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Live hint */}
        <div className="flex-1 min-w-[200px] text-[11px] text-muted-foreground italic self-end pb-0.5">
          {SCENARIO_HINTS[scenario]}
        </div>
      </div>
    </div>
  );
}
