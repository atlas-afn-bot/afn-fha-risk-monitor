import { useMemo, useState, useEffect, useCallback } from 'react';
import { Sparkles, ChevronDown, ChevronUp, RefreshCw, Loader2, Shield, TrendingDown, BarChart3 } from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import type { Snapshot, RiskFactorBullet } from '@/types/snapshot';
import {
  generateAIAnalysis,
  regenerateRiskFactorBullets,
  type AIBullet,
} from '@/lib/aiAnalysis';
import TerminationRiskCards from './TerminationRiskCards';

interface Props {
  data: DashboardData;
  period: string;
  /**
   * Full snapshot for the selected period. Optional so historical callers
   * that only pass `data` still compile — but the baked
   * `risk_factor_bullets` write-back path (PR B) only lights up when the
   * snapshot is provided.
   */
  snapshot?: Snapshot | null;
}

const severityDot: Record<string, string> = {
  red: 'bg-risk-red',
  yellow: 'bg-risk-yellow',
  green: 'bg-risk-green',
  neutral: 'bg-muted-foreground',
};

// `RiskFactorBullet` from the snapshot and `AIBullet` from the legacy
// on-demand path are shape-compatible (same fields, same severity enum).
// This adapter is a compile-time-safe identity cast at the boundary — no
// third type gets introduced.
function bakedToAIBullets(bullets: RiskFactorBullet[]): AIBullet[] {
  return bullets as AIBullet[];
}

/**
 * Render a short relative-time caption like "generated 3 hours ago" or
 * "regenerated 4 days ago". Falls back to the ISO date if the timestamp
 * can't be parsed. Zero external deps.
 */
function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (deltaSec < 60) return `${deltaSec} seconds ago`;
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin} minute${deltaMin === 1 ? '' : 's'} ago`;
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr} hour${deltaHr === 1 ? '' : 's'} ago`;
  const deltaDay = Math.round(deltaHr / 24);
  if (deltaDay < 30) return `${deltaDay} day${deltaDay === 1 ? '' : 's'} ago`;
  const deltaMon = Math.round(deltaDay / 30);
  if (deltaMon < 12) return `${deltaMon} month${deltaMon === 1 ? '' : 's'} ago`;
  const deltaYr = Math.round(deltaMon / 12);
  return `${deltaYr} year${deltaYr === 1 ? '' : 's'} ago`;
}

export default function ExecutiveSummary({ data, period, snapshot }: Props) {
  const [expanded, setExpanded] = useState(true);

  // ── Baked-vs-on-demand state ────────────────────────────────────────────
  // Baked bullets from `snapshot.risk_factor_bullets` are the preferred
  // source. If they're missing (historical snapshots Feb–May 2026) the
  // component falls back to the legacy `runAI()` on-demand path so the
  // user still has an escape hatch to fill the empty state manually.
  const bakedFromSnapshot = useMemo<AIBullet[] | null>(() => {
    const rfb = snapshot?.risk_factor_bullets;
    if (!rfb || !Array.isArray(rfb.bullets) || rfb.bullets.length === 0) {
      return null;
    }
    return bakedToAIBullets(rfb.bullets);
  }, [snapshot]);

  const [aiBullets, setAiBullets] = useState<AIBullet[] | null>(bakedFromSnapshot);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // `isRegenerating` is a NARROWER loading flag than `aiLoading` — true only
  // while the write-back regenerate call is in flight (i.e. the snapshot bake
  // is being replaced). Drives the body-level overlay + success toast, which
  // must NOT fire on the on-demand `runAI()` path.
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Ephemeral "just regenerated" toast — populated for ~5s after a successful
  // write-back so the user sees the model name and timestamp change. Cleared
  // by a useEffect timer below.
  const [regenerateToast, setRegenerateToast] = useState<{ deployment?: string; at: string } | null>(null);

  // Provenance for the caption (baked or regenerated), driven by whichever
  // is more recent in the snapshot. Updated locally after a successful
  // regenerate so the UI reflects the fresh timestamp without a full
  // snapshot reload.
  const [caption, setCaption] = useState<{ label: 'generated' | 'regenerated'; at: string } | null>(() => {
    const rfb = snapshot?.risk_factor_bullets;
    if (!rfb) return null;
    if (rfb.regenerated_at) return { label: 'regenerated', at: rfb.regenerated_at };
    if (rfb.generated_at) return { label: 'generated', at: rfb.generated_at };
    return null;
  });

  const termOffices = useMemo(() =>
    data.offices.filter(o => o.totalCR > 200 && o.totalLoans > 100).sort((a, b) => b.totalCR - a.totalCR),
  [data]);

  const creditWatchCount = useMemo(() =>
    data.offices.filter(o =>
      (o.totalCR > 150 && o.totalCR <= 200 && o.totalLoans >= 100) ||
      (o.totalCR > 200 && o.totalLoans < 100) ||
      (o.totalCR > 150 && o.totalLoans < 100)
    ).length,
  [data]);

  const displayBullets = aiBullets ?? [];

  // Manual escape hatch for historical snapshots that don't carry the
  // baked field — same generic /api/ai-analysis call as before.
  const runAI = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await generateAIAnalysis(data);
      setAiBullets(result.executiveSummary);
      // On-demand generation is transient — do NOT persist. The caption
      // stays cleared so we don't imply the bullets came from the snapshot.
      setCaption(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'AI analysis failed';
      console.error('AI analysis failed:', e);
      setAiError(msg);
    } finally {
      setAiLoading(false);
    }
  }, [data]);

  // Regenerate = write-back path. Only meaningful when a snapshot is
  // present — falls back to the on-demand runAI() otherwise so
  // historical periods still have a "Regenerate" affordance that works.
  const regenerate = useCallback(async () => {
    if (!snapshot) {
      // No snapshot → no blob to write back to → generic proxy path.
      await runAI();
      return;
    }
    setAiLoading(true);
    setIsRegenerating(true);
    setAiError(null);
    try {
      const resp = await regenerateRiskFactorBullets(period, data);
      setAiBullets(resp.bullets);
      setCaption({ label: 'regenerated', at: resp.regenerated_at });
      setRegenerateToast({ deployment: resp.deployment, at: resp.regenerated_at });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'AI regenerate failed';
      console.error('Regenerate failed:', e);
      setAiError(msg);
      // Preserve the previously-rendered bullets on failure so the user
      // doesn't lose what they were looking at.
    } finally {
      setAiLoading(false);
      setIsRegenerating(false);
    }
  }, [snapshot, period, data, runAI]);

  // When the period or snapshot changes, resync from the baked field.
  //
  // Historical snapshots (pre-bake era, e.g. 2026-02 through 2026-04) don't
  // carry `risk_factor_bullets` at all. Before the bake existed, the card
  // auto-fetched on mount so committee readers saw AI narrative on every
  // month. Preserve that behavior for pre-bake months by auto-firing
  // `runAI()` when the baked field is absent — the on-demand fetch is
  // transient (not written back) so it just visually restores the old UX.
  useEffect(() => {
    setAiBullets(bakedFromSnapshot);
    setAiError(null);
    setAiLoading(false);
    setIsRegenerating(false);
    setRegenerateToast(null);
    const rfb = snapshot?.risk_factor_bullets;
    if (rfb?.regenerated_at) {
      setCaption({ label: 'regenerated', at: rfb.regenerated_at });
    } else if (rfb?.generated_at) {
      setCaption({ label: 'generated', at: rfb.generated_at });
    } else {
      setCaption(null);
    }
  }, [bakedFromSnapshot, snapshot, period]);

  // Historical auto-fetch: when a snapshot is loaded but has no baked
  // bullets, kick off `/api/ai-analysis` in the background so pre-bake
  // periods (Feb–Apr 2026) render committee-visible AI narrative without
  // the user having to click "Enhance with AI". Deliberately guarded so it
  // fires exactly once per (period, snapshot) tuple. Does NOT run when the
  // baked field is present, an error has already been recorded, a regenerate
  // is in flight, or a fetch is already loading.
  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.risk_factor_bullets?.bullets?.length) return;
    if (aiBullets && aiBullets.length > 0) return;
    if (aiLoading || isRegenerating) return;
    if (aiError) return;
    void runAI();
    // Intentionally omit runAI from deps — runAI's identity changes only
    // with `data`, and `data` change already triggers the resync effect
    // above which clears aiBullets and lets this effect re-fire cleanly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, period]);

  // Auto-clear the "just regenerated" toast after ~5s so it doesn't stick
  // forever. The persistent caption below the bullets already carries the
  // regenerated_at timestamp long-term.
  useEffect(() => {
    if (!regenerateToast) return;
    const t = setTimeout(() => setRegenerateToast(null), 5000);
    return () => clearTimeout(t);
  }, [regenerateToast]);

  const dpaConc = data.dpaPortfolioConc;
  const { standardDQ, dpaDQ } = data.programComposition;
  const dpaMultiplier = standardDQ > 0 ? (dpaDQ / standardDQ).toFixed(1) : 'N/A';
  const wsConc = data.wsSummary.dpaConc;
  const rConc = data.retailSummary.dpaConc;
  const concMultiplier = rConc > 0 ? (wsConc / rConc).toFixed(1) : 'N/A';

  const hasBullets = displayBullets.length > 0;

  return (
    <div className="bg-card rounded-lg border border-border">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-muted/40 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-risk-yellow flex-shrink-0" />
          <span className="font-semibold text-sm text-foreground">Executive Summary for Committee Review</span>
          {hasBullets && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">AI</span>}
          {aiLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-1 border-t border-border space-y-5">

          {/* ── Section 1: Termination Risk Offices ── */}
          <TerminationRiskCards offices={data.offices} />

          {/* ── Section 2: Credit Watch + DPA Summary ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex items-start gap-3 bg-risk-yellow-bg rounded-lg px-4 py-3 border border-risk-yellow/20">
              <Shield className="w-5 h-5 text-risk-yellow flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-foreground">Credit Watch</p>
                <p className="text-2xl font-bold text-risk-yellow">{creditWatchCount}</p>
                <p className="text-[10px] text-muted-foreground">offices on monitoring</p>
              </div>
            </div>
            <div className={`flex items-start gap-3 rounded-lg px-4 py-3 border ${dpaConc > 40 ? 'bg-risk-red-bg border-risk-red/20' : 'bg-muted/50 border-border'}`}>
              <BarChart3 className={`w-5 h-5 flex-shrink-0 mt-0.5 ${dpaConc > 40 ? 'text-risk-red' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-xs font-bold text-foreground">DPA Concentration</p>
                <p className={`text-2xl font-bold ${dpaConc > 50 ? 'text-risk-red' : dpaConc > 40 ? 'text-risk-yellow' : 'text-foreground'}`}>{dpaConc.toFixed(1)}%</p>
                <p className="text-[10px] text-muted-foreground">target: ≤40% · DPA defaults at {dpaMultiplier}x standard</p>
              </div>
            </div>
            <div className="flex items-start gap-3 bg-muted/50 rounded-lg px-4 py-3 border border-border">
              <TrendingDown className="w-5 h-5 text-risk-blue flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-foreground">Channel Gap</p>
                <p className="text-2xl font-bold text-foreground">{concMultiplier}x</p>
                <p className="text-[10px] text-muted-foreground">WS DPA conc ({wsConc.toFixed(0)}%) vs Retail ({rConc.toFixed(0)}%)</p>
              </div>
            </div>
          </div>

          {/* ── Section 3: Risk Factor Trends (baked → regenerate → empty) ── */}
          <div
            className="cursor-pointer rounded-lg transition-colors hover:bg-muted/40 -mx-2 px-2 py-1 group"
            onClick={(e) => {
              // Don't navigate if clicking the AI buttons
              if ((e.target as HTMLElement).closest('button')) return;
              const el = document.getElementById('section-riskfactors');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            title="Click to jump to Risk Factor charts"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <BarChart3 className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  Portfolio Risk Factors
                </h3>
                {hasBullets && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">AI</span>}
                {hasBullets && caption && (
                  <span
                    className="text-[10px] text-muted-foreground"
                    title={caption.at}
                  >
                    {caption.label} {formatRelative(caption.at)}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">↓ Jump to charts</span>
              </div>
              <div className="flex items-center gap-2">
                {aiError && <span className="text-[10px] text-risk-red">AI unavailable</span>}
                <button
                  onClick={hasBullets ? regenerate : runAI}
                  disabled={aiLoading}
                  className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${aiLoading ? 'animate-spin' : ''}`} />
                  {aiLoading ? 'Analyzing...' : hasBullets ? 'Regenerate' : 'Enhance with AI'}
                </button>
              </div>
            </div>

            {aiLoading && !hasBullets ? (
              <div className="flex items-center justify-center py-6 gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Analyzing portfolio risk factors...</span>
              </div>
            ) : !hasBullets ? (
              <div className="flex items-center justify-center py-6">
                <span className="text-xs text-muted-foreground">Click "Enhance with AI" to generate risk factor analysis</span>
              </div>
            ) : (
              <div className="relative">
                <div className={`grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 transition-opacity ${isRegenerating ? 'opacity-40' : ''}`}>
                  {displayBullets.map((b, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-1">
                      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${severityDot[b.severity]}`} />
                      <span className="text-xs leading-relaxed text-foreground">{b.text}</span>
                    </div>
                  ))}
                </div>
                {isRegenerating && (
                  <div className="absolute inset-0 flex items-center justify-center bg-card/60 backdrop-blur-[1px] rounded-md pointer-events-none">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-border shadow-sm">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      <span className="text-[11px] font-medium text-foreground">Regenerating with shared model…</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {regenerateToast && (
              <div
                role="status"
                aria-live="polite"
                className="mt-2 flex items-center gap-2 text-[11px] text-primary"
              >
                <Sparkles className="w-3 h-3" />
                <span>
                  Bullets regenerated{regenerateToast.deployment ? ` with ${regenerateToast.deployment}` : ''} just now.
                </span>
              </div>
            )}
          </div>

          {/* ── Footer: HUD enforcement note ── */}
          <div className="bg-muted/30 rounded-lg px-4 py-2.5 border border-border">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              <span className="font-semibold">HUD Enforcement:</span> Each HUD field office can independently suspend lender underwriting authority when the compare ratio exceeds 200%. Offices are evaluated individually — a single office at termination risk can trigger enforcement action regardless of overall company performance.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
