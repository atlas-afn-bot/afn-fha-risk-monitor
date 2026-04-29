import { useMemo, useState, useEffect, useCallback } from 'react';
import { Sparkles, ChevronDown, ChevronUp, RefreshCw, Loader2, Shield, TrendingDown, BarChart3 } from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import { generateAIAnalysis, type AIBullet } from '@/lib/aiAnalysis';
import TerminationRiskCards from './TerminationRiskCards';

interface Props {
  data: DashboardData;
  period: string;
}

const severityDot: Record<string, string> = {
  red: 'bg-risk-red',
  yellow: 'bg-risk-yellow',
  green: 'bg-risk-green',
  neutral: 'bg-muted-foreground',
};

const AI_CACHE_PREFIX = 'fha-ai-summary-';

function getCachedBullets(period: string): AIBullet[] | null {
  try {
    const raw = localStorage.getItem(`${AI_CACHE_PREFIX}${period}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* corrupted cache — ignore */ }
  return null;
}

function setCachedBullets(period: string, bullets: AIBullet[]): void {
  try {
    localStorage.setItem(`${AI_CACHE_PREFIX}${period}`, JSON.stringify(bullets));
  } catch { /* storage full — ignore */ }
}

export default function ExecutiveSummary({ data, period }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [aiBullets, setAiBullets] = useState<AIBullet[] | null>(() => getCachedBullets(period));
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

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

  const runAI = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await generateAIAnalysis(data);
      setAiBullets(result.executiveSummary);
      setCachedBullets(period, result.executiveSummary);
    } catch (e: any) {
      console.error('AI analysis failed:', e);
      setAiError(e.message || 'AI analysis failed');
    } finally {
      setAiLoading(false);
    }
  }, [data, period]);

  // When the period/data changes, try to load from cache first
  useEffect(() => {
    const cached = getCachedBullets(period);
    if (cached) {
      setAiBullets(cached);
      setAiError(null);
    } else {
      setAiBullets(null);
      setAiError(null);
    }
  }, [data, period]);

  useEffect(() => {
    if (!aiBullets && !aiLoading && !aiError) {
      runAI();
    }
  }, [aiBullets, aiLoading, aiError, runAI]);

  const dpaConc = data.dpaPortfolioConc;
  const { standardDQ, dpaDQ } = data.programComposition;
  const dpaMultiplier = standardDQ > 0 ? (dpaDQ / standardDQ).toFixed(1) : 'N/A';
  const wsConc = data.wsSummary.dpaConc;
  const rConc = data.retailSummary.dpaConc;
  const concMultiplier = rConc > 0 ? (wsConc / rConc).toFixed(1) : 'N/A';

  return (
    <div className="bg-card rounded-lg border border-border">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-muted/40 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-risk-yellow flex-shrink-0" />
          <span className="font-semibold text-sm text-foreground">Executive Summary for Committee Review</span>
          {aiBullets && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">AI</span>}
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

          {/* ── Section 3: Risk Factor Trends (AI or fallback) ── */}
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
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  Portfolio Risk Factors
                </h3>
                {aiBullets && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">AI</span>}
                <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">↓ Jump to charts</span>
              </div>
              <div className="flex items-center gap-2">
                {aiError && <span className="text-[10px] text-risk-red">AI unavailable</span>}
                {aiBullets && (
                  <button onClick={() => { setAiBullets(null); }} className="text-[10px] text-muted-foreground hover:text-foreground">
                    Show template
                  </button>
                )}
                <button
                  onClick={runAI}
                  disabled={aiLoading}
                  className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${aiLoading ? 'animate-spin' : ''}`} />
                  {aiBullets ? 'Regenerate' : aiLoading ? 'Analyzing...' : 'Enhance with AI'}
                </button>
              </div>
            </div>

            {aiLoading && displayBullets.length === 0 ? (
              <div className="flex items-center justify-center py-6 gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Analyzing portfolio risk factors...</span>
              </div>
            ) : displayBullets.length === 0 && !aiLoading ? (
              <div className="flex items-center justify-center py-6">
                <span className="text-xs text-muted-foreground">Click "Enhance with AI" to generate risk factor analysis</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                {displayBullets.map((b, i) => (
                  <div key={i} className="flex items-start gap-2.5 py-1">
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${severityDot[b.severity]}`} />
                    <span className="text-xs leading-relaxed text-foreground">{b.text}</span>
                  </div>
                ))}
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
