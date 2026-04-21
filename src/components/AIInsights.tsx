import { Sparkles, TrendingUp, AlertTriangle, Users, Layers } from 'lucide-react';

/**
 * AI Insights — UI scaffold.
 *
 * Visual shell for an upcoming AI-generated insight feed surfacing
 * cross-cut risk findings (channel concentration, LO outliers, DPA
 * behavior, geo/seasonality). No API calls yet; content is static
 * placeholder copy marked clearly with a "Preview" badge.
 *
 * Sits between the main compare-ratio trend chart and the detail
 * tables so committee readers see the narrative before diving into
 * the office/LO drilldowns.
 */

interface Insight {
  icon: typeof Sparkles;
  tone: 'red' | 'yellow' | 'blue' | 'green';
  title: string;
  body: string;
}

const INSIGHTS: Insight[] = [
  {
    icon: TrendingUp,
    tone: 'red',
    title: 'Retail compare ratio trending above benchmark',
    body: 'Retail CR is running ~14% above the HUD peer benchmark over the trailing 6 months. 60% of the gap is attributable to the top 10 contributing loan officers.',
  },
  {
    icon: Users,
    tone: 'yellow',
    title: 'Wholesale TPO concentration risk',
    body: '3 TPO partners account for 42% of wholesale early-payment delinquencies while representing only 19% of wholesale volume. Consider enhanced post-close QC sampling.',
  },
  {
    icon: Layers,
    tone: 'yellow',
    title: 'DPA program drift',
    body: 'Two DPA programs have seen default-rate multipliers move from 1.6x to 2.3x standard FHA over the last 4 months. Driven primarily by sub-640 FICO originations in Q1.',
  },
  {
    icon: AlertTriangle,
    tone: 'blue',
    title: 'HUD office concentration',
    body: '78% of termination-risk loans sit in 4 HUD field offices. Office-level enforcement exposure remains elevated even though the company-wide CR is stable.',
  },
];

const toneStyles: Record<Insight['tone'], { icon: string; bg: string; border: string; dot: string }> = {
  red: { icon: 'text-risk-red', bg: 'bg-risk-red-bg', border: 'border-risk-red/20', dot: 'bg-risk-red' },
  yellow: { icon: 'text-risk-yellow', bg: 'bg-risk-yellow-bg', border: 'border-risk-yellow/20', dot: 'bg-risk-yellow' },
  blue: { icon: 'text-risk-blue', bg: 'bg-muted/40', border: 'border-border', dot: 'bg-risk-blue' },
  green: { icon: 'text-risk-green', bg: 'bg-risk-green-bg', border: 'border-risk-green/20', dot: 'bg-risk-green' },
};

export default function AIInsights() {
  return (
    <div className="bg-card rounded-lg border border-border">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="font-semibold text-sm text-foreground">AI Insights</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary uppercase tracking-wider">
            Preview
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground italic">
          AI insights coming soon · sample copy shown
        </span>
      </div>

      {/* Insight grid */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        {INSIGHTS.map((ins, i) => {
          const tone = toneStyles[ins.tone];
          const Icon = ins.icon;
          return (
            <div
              key={i}
              className={`rounded-lg border ${tone.border} ${tone.bg} px-4 py-3 flex items-start gap-3`}
            >
              <Icon className={`w-4 h-4 ${tone.icon} flex-shrink-0 mt-0.5`} />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground leading-snug">{ins.title}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">{ins.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <div className="px-5 pb-4">
        <p className="text-[10px] text-muted-foreground leading-relaxed italic">
          This panel is a visual scaffold. Live AI analysis will generate insights from the active snapshot and trailing history once enabled.
        </p>
      </div>
    </div>
  );
}
