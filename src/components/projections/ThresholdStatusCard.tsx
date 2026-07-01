import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { ProjectionScenario } from '@/types/snapshot';
import type { ThresholdRollup } from './selectors';
import { ProjBadge } from './ProjBadge';
import type { HorizonMonths } from './types';

interface Props {
  rollup: ThresholdRollup;
  timeframe: HorizonMonths;
  scenario: ProjectionScenario;
  scopeLabel: string;
}

/**
 * Rollup table + mini stacked bar showing office counts by zone, current
 * vs projected. The delta arrows are colored by direction:
 *   - safe growing / breach shrinking → green
 *   - safe shrinking / breach growing → red
 */
export default function ThresholdStatusCard({ rollup, timeframe, scenario, scopeLabel }: Props) {
  const rows: Array<{
    key: 'safe' | 'watch' | 'breach';
    label: string;
    hint: string;
    currentBad: boolean;
  }> = [
    { key: 'safe', label: 'Safe', hint: '<150', currentBad: false },
    { key: 'watch', label: 'Watch', hint: '150–199', currentBad: true },
    { key: 'breach', label: 'Breach', hint: '≥200', currentBad: true },
  ];

  return (
    <div className="rounded-2xl border bg-card shadow-sm p-6">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Threshold Status</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {rollup.total} office{rollup.total === 1 ? '' : 's'} in {scopeLabel} · {timeframe}-mo view
          </p>
        </div>
        <ProjBadge scenario={scenario} />
      </div>

      <table className="w-full mt-4 text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="text-left font-medium py-1.5">Zone</th>
            <th className="text-right font-medium py-1.5">Current</th>
            <th className="text-right font-medium py-1.5">Projected</th>
            <th className="text-right font-medium py-1.5 w-12">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const cur = rollup[r.key].current;
            const proj = rollup[r.key].projected;
            const delta = proj - cur;
            const badWhenGrowing = r.currentBad;
            const isBadDelta =
              (badWhenGrowing && delta > 0) || (!badWhenGrowing && delta < 0);
            const DeltaIcon = delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
            const zoneDot =
              r.key === 'safe' ? 'bg-risk-green' :
              r.key === 'watch' ? 'bg-risk-yellow' : 'bg-risk-red';

            return (
              <tr key={r.key} className="border-t border-border/60">
                <td className="py-2 flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${zoneDot}`}></span>
                  <span className="font-medium">{r.label}</span>
                  <span className="text-[10px] text-muted-foreground">{r.hint}</span>
                </td>
                <td className="text-right tabular-nums text-muted-foreground">{cur}</td>
                <td className="text-right tabular-nums font-semibold">{proj}</td>
                <td className={`text-right tabular-nums flex items-center justify-end gap-0.5 py-2 ${
                  delta === 0 ? 'text-muted-foreground' :
                  isBadDelta ? 'text-risk-red' : 'text-risk-green'
                }`}>
                  <DeltaIcon className="w-3 h-3" />
                  <span>{delta > 0 ? '+' : ''}{delta}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Mini stacked bar */}
      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex justify-between">
          <span>Distribution (projected)</span>
          <span>{rollup.total} offices</span>
        </div>
        <div className="flex w-full h-3 rounded-full overflow-hidden border border-border">
          <StackSlice count={rollup.safe.projected} total={rollup.total} colorClass="bg-risk-green" />
          <StackSlice count={rollup.watch.projected} total={rollup.total} colorClass="bg-risk-yellow" />
          <StackSlice count={rollup.breach.projected} total={rollup.total} colorClass="bg-risk-red" />
        </div>
      </div>
    </div>
  );
}

function StackSlice({ count, total, colorClass }: { count: number; total: number; colorClass: string }) {
  if (total <= 0 || count <= 0) return null;
  const pct = (count / total) * 100;
  return (
    <div
      className={colorClass}
      style={{ width: `${pct}%`, transition: 'width 400ms ease' }}
      title={`${count} offices (${pct.toFixed(1)}%)`}
    />
  );
}
