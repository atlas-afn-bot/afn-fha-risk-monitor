import { Clock, Sparkles } from 'lucide-react';
import type { AIInsight, SnapshotProjections, ProjectionScenario } from '@/types/snapshot';
import { ProjBadge } from './ProjBadge';
import { zoneClasses, zoneFromRatio, type HorizonMonths } from './types';

interface Props {
  insights: AIInsight[] | undefined;
  timeframe: HorizonMonths;
  scenario: ProjectionScenario;
  /** Whether the loaded snapshot even has a `projections` block. */
  hasProjections: boolean;
  /** Whether the loaded snapshot has any ai_insights entries. */
  hasAnyInsights: boolean;
  /** Full projections block — used to synthesize rule-based flags as a fallback. */
  projections: SnapshotProjections | undefined;
}

/**
 * AI Projected Watchlist — pulls from `ai_insights[]` where
 * `horizon_months` is set (extended schema shipped with backend PR #29).
 *
 * When the LLM had no projections to comment on (or the snapshot pre-dates
 * PR #29), we synthesize a rule-based fallback list from the projections
 * block itself: any office that crosses a threshold for the selected
 * horizon+scenario. This keeps the panel useful even without LLM output.
 */
export default function ProjectedWatchlist({
  insights, timeframe, scenario, hasProjections, hasAnyInsights, projections,
}: Props) {
  // Filter LLM-emitted projection insights that match the current view.
  const llmProjectionInsights = (insights ?? []).filter(
    i => i.horizon_months != null && i.projected_ratio != null,
  );

  const matching = llmProjectionInsights.filter(
    i => i.horizon_months === timeframe && (i.scenario === scenario || i.scenario == null),
  );

  // Sort by confidence desc (high > medium > low), then magnitude desc.
  const confidenceRank = { high: 3, medium: 2, low: 1 } as const;
  matching.sort((a, b) => {
    const ca = confidenceRank[(a.confidence ?? 'medium') as keyof typeof confidenceRank] ?? 2;
    const cb = confidenceRank[(b.confidence ?? 'medium') as keyof typeof confidenceRank] ?? 2;
    if (cb !== ca) return cb - ca;
    return (b.projected_ratio ?? 0) - (a.projected_ratio ?? 0);
  });

  // Fallback: rule-based crossings if no LLM projected insights available.
  const usingFallback = matching.length === 0 && projections != null;
  const fallbackCards = usingFallback ? buildFallback(projections, timeframe, scenario) : [];

  return (
    <div className="rounded-2xl border bg-card shadow-sm p-6">
      <div className="flex items-start justify-between mb-1 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Projected Watchlist
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl">
            Offices projected to cross the 150 or 200 threshold in the selected timeframe
            &amp; scenario. Solid-border = current-state risk (AI Insights tab); dashed = projected.
          </p>
        </div>
        <ProjBadge scenario={scenario} suffix={`${timeframe}mo`} />
      </div>

      {/* Missing schema / no-insight guards */}
      {!hasProjections && (
        <div className="mt-6 rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-xs text-muted-foreground">
            This snapshot pre-dates the projections feature. Load a more recent
            snapshot to see the Projected Watchlist.
          </p>
        </div>
      )}

      {hasProjections && matching.length === 0 && fallbackCards.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium text-foreground">No projected threshold crossings</p>
          <p className="text-xs text-muted-foreground mt-1">
            No offices are projected to cross the 150 or 200 threshold at{' '}
            <span className="font-medium">{timeframe} mo &middot; {scenario}</span>.
            Try a longer horizon or a stress scenario to surface offices at risk.
          </p>
        </div>
      )}

      {hasProjections && matching.length > 0 && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {matching.map((ins, i) => (
            <AIWatchCard key={i} insight={ins} />
          ))}
        </div>
      )}

      {hasProjections && usingFallback && fallbackCards.length > 0 && (
        <>
          <p className="mt-4 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Rule-based crossings</span>{' '}
            &mdash; offices whose projected Compare Ratio crosses the 150 or 200 threshold
            at this horizon/scenario. Shown when the snapshot's AI insights don't include
            projection commentary.
          </p>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {fallbackCards.map((c, i) => (
              <FallbackCard key={i} {...c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AIWatchCard({ insight }: { insight: AIInsight }) {
  const zone = zoneFromRatio(insight.projected_ratio ?? undefined);
  const z = zoneClasses[zone];
  const conf = insight.confidence ?? 'medium';
  const confDots = conf === 'high' ? 3 : conf === 'medium' ? 2 : 1;

  return (
    <div
      className={`rounded-2xl border-2 border-dashed bg-card p-4 flex flex-col gap-2 ${z.border}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Clock className={`w-3.5 h-3.5 ${z.text} shrink-0`} />
          <Sparkles className={`w-3.5 h-3.5 ${z.text} shrink-0`} />
          <p className="text-xs font-semibold truncate">{insight.title}</p>
        </div>
        {insight.crosses_threshold != null && (
          <ProjBadge
            scenario={insight.scenario ?? undefined}
            tone={insight.crosses_threshold >= 200 ? 'breach' : 'watch'}
            suffix={`${insight.crosses_threshold}↑`}
          />
        )}
      </div>

      {insight.projected_ratio != null && (
        <div className="flex items-baseline gap-2">
          <span className={`text-2xl font-bold tabular-nums ${z.text}`}>
            {Math.round(insight.projected_ratio)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            projected CR
          </span>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {insight.body}
      </p>

      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {insight.horizon_months}-mo · {insight.scenario ?? 'base'}
        </span>
        <span className="flex items-center gap-0.5" title={`Confidence: ${conf}`}>
          Confidence
          {[1, 2, 3].map(n => (
            <span
              key={n}
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                n <= confDots ? z.bg : 'bg-muted'
              }`}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

interface FallbackCardData {
  officeName: string;
  hoc: string | null;
  currentRatio: number | null;
  projectedRatio: number | null;
  threshold: 150 | 200;
  fromStatus: string;
  toStatus: string;
}

function FallbackCard(c: FallbackCardData) {
  const zone = zoneFromRatio(c.projectedRatio);
  const z = zoneClasses[zone];
  return (
    <div className={`rounded-2xl border-2 border-dashed bg-card p-4 flex flex-col gap-2 ${z.border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Clock className={`w-3.5 h-3.5 ${z.text} shrink-0`} />
          <p className="text-xs font-semibold truncate">
            {c.officeName}
            {c.hoc && <span className="text-muted-foreground font-normal"> · {c.hoc}</span>}
          </p>
        </div>
        <ProjBadge
          tone={c.threshold === 200 ? 'breach' : 'watch'}
          suffix={`${c.threshold}↑`}
        />
      </div>
      <div className="flex items-baseline gap-2 tabular-nums">
        <span className="text-lg text-muted-foreground">
          {c.currentRatio != null ? Math.round(c.currentRatio) : '—'}
        </span>
        <span className="text-muted-foreground">→</span>
        <span className={`text-2xl font-bold ${z.text}`}>
          {c.projectedRatio != null ? Math.round(c.projectedRatio) : '—'}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Crosses <span className="font-medium">{c.threshold}</span> in the selected horizon/scenario
        ({c.fromStatus} → <span className="font-medium">{c.toStatus}</span>).
      </p>
    </div>
  );
}

function buildFallback(
  projections: SnapshotProjections,
  timeframe: HorizonMonths,
  scenario: ProjectionScenario,
): FallbackCardData[] {
  const key = `${timeframe}mo` as '1mo' | '3mo' | '6mo';
  const results: FallbackCardData[] = [];
  for (const o of projections.offices) {
    const cross = o.threshold_crossings.find(
      c => c.horizon_months === timeframe && c.scenario === scenario,
    );
    if (!cross) continue;
    // We want crossings going in the wrong direction (safe→watch, watch→breach, safe→breach)
    const rankOf: Record<string, number> = { safe: 0, watch: 1, breach: 2, unknown: 0 };
    if ((rankOf[cross.to_status] ?? 0) <= (rankOf[cross.from_status] ?? 0)) continue;
    const threshold: 150 | 200 = cross.to_status === 'breach' ? 200 : 150;
    results.push({
      officeName: o.office_name,
      hoc: o.hoc,
      currentRatio: cross.current_compare_ratio,
      projectedRatio: cross.projected_compare_ratio,
      threshold,
      fromStatus: cross.from_status,
      toStatus: cross.to_status,
    });
    // reference key to silence unused var
    void o.horizons[key];
  }
  results.sort((a, b) => (b.projectedRatio ?? 0) - (a.projectedRatio ?? 0));
  return results.slice(0, 9);
}
