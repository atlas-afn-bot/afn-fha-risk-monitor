import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Users,
  Layers,
  MapPin,
  Building2,
  DollarSign,
  ShieldAlert,
  Activity,
  BarChart3,
  Target,
  Flame,
  type LucideIcon,
} from 'lucide-react';
import type { AIInsight, Snapshot } from '@/types/snapshot';

/**
 * AI Insights — narrative finding feed driven by `snapshot.ai_insights`.
 *
 * The backing data is produced by `scripts/build-snapshot.py`, which calls
 * the AFN LiteLLM proxy to summarise the trailing month's compare-ratio,
 * delinquency, DPA-concentration, and channel-mix signals into 4 short
 * insights. This component is purely a renderer: it does no API calls,
 * does no business logic — it just maps the `icon` string to a Lucide
 * component and styles each card according to `tone`.
 */

interface AIInsightsProps {
  /** Active snapshot. May be null while the dashboard is bootstrapping. */
  snapshot: Snapshot | null;
}

/**
 * String → Lucide component map. Must stay in sync with the allow-list
 * in `scripts/build-snapshot.py` (`_AI_INSIGHT_ICONS`). Unknown names
 * fall back to `Sparkles` so we never render a blank icon.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Users,
  Layers,
  MapPin,
  Building2,
  DollarSign,
  ShieldAlert,
  Activity,
  BarChart3,
  Target,
  Flame,
};

const toneStyles: Record<
  AIInsight['tone'],
  { icon: string; bg: string; border: string; dot: string }
> = {
  red: {
    icon: 'text-risk-red',
    bg: 'bg-risk-red-bg',
    border: 'border-risk-red/20',
    dot: 'bg-risk-red',
  },
  yellow: {
    icon: 'text-risk-yellow',
    bg: 'bg-risk-yellow-bg',
    border: 'border-risk-yellow/20',
    dot: 'bg-risk-yellow',
  },
  blue: {
    icon: 'text-risk-blue',
    bg: 'bg-muted/40',
    border: 'border-border',
    dot: 'bg-risk-blue',
  },
  green: {
    icon: 'text-risk-green',
    bg: 'bg-risk-green-bg',
    border: 'border-risk-green/20',
    dot: 'bg-risk-green',
  },
};

export default function AIInsights({ snapshot }: AIInsightsProps) {
  const insights: AIInsight[] = snapshot?.ai_insights ?? [];

  return (
    <div className="bg-card rounded-lg border border-border">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="font-semibold text-sm text-foreground">AI Insights</span>
        </div>
        {snapshot && (
          <span className="text-[10px] text-muted-foreground">
            {snapshot.snapshot_meta.label}
          </span>
        )}
      </div>

      {/* Insight grid */}
      {insights.length > 0 ? (
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {insights.map((ins, i) => {
            const tone = toneStyles[ins.tone] ?? toneStyles.blue;
            const Icon = ICON_MAP[ins.icon] ?? Sparkles;
            return (
              <div
                key={i}
                className={`rounded-lg border ${tone.border} ${tone.bg} px-4 py-3 flex items-start gap-3`}
              >
                <Icon className={`w-4 h-4 ${tone.icon} flex-shrink-0 mt-0.5`} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground leading-snug">
                    {ins.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                    {ins.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-5 py-8 text-center">
          <p className="text-xs text-muted-foreground">
            No AI insights available for this snapshot.
          </p>
        </div>
      )}
    </div>
  );
}
