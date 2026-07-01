import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { ProjectionScenario } from '@/types/snapshot';
import { ProjBadge } from './ProjBadge';
import { formatRatio, zoneClasses, zoneFromRatio, type HorizonMonths } from './types';
import type { ScopedHorizonView } from './selectors';

interface Props {
  view: ScopedHorizonView;
  timeframe: HorizonMonths;
  scenario: ProjectionScenario;
}

/**
 * Big projected Compare Ratio card with gauge ring + threshold headroom.
 *
 * Following ATHENA's Design v1 §5, the projected zone drives the color.
 * The current ratio stays neutral so the eye is drawn to the future state.
 */
export default function ProjectionRatioCard({ view, timeframe, scenario }: Props) {
  const current = view.currentCompareRatio;
  const projected = view.scenario.projected_compare_ratio;
  const delta = current != null && projected != null ? projected - current : null;
  const zone = zoneFromRatio(projected);
  const z = zoneClasses[zone];

  // Gauge ring: 0 → 300 CR maps to full arc.
  const gaugeMax = 300;
  const clamped = projected == null ? 0 : Math.min(Math.max(projected, 0), gaugeMax);
  const pct = clamped / gaugeMax;
  const size = 156;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * pct;

  const DeltaIcon =
    delta == null || delta === 0 ? Minus :
    delta < 0 ? TrendingDown : TrendingUp;

  return (
    <div className="rounded-2xl border bg-card shadow-sm p-6">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">
            Projected Compare Ratio
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {view.label} · {timeframe}-month horizon
          </p>
        </div>
        <ProjBadge scenario={scenario} tone={zone === 'safe' ? 'neutral' : zone} />
      </div>

      <div className="flex items-center gap-6 mt-4">
        {/* Left: numbers */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current</div>
              <div className="text-2xl font-semibold text-muted-foreground tabular-nums">
                {formatRatio(current)}
              </div>
            </div>
            <div className="text-2xl text-muted-foreground/50">→</div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Projected</div>
              <div className={`text-5xl font-bold tabular-nums ${z.text}`}>
                {formatRatio(projected)}
              </div>
            </div>
          </div>

          {delta != null && (
            <div className="mt-2 flex items-center gap-1.5 text-sm">
              <DeltaIcon className={`w-4 h-4 ${
                delta === 0 ? 'text-muted-foreground' :
                delta < 0 ? 'text-risk-green' : 'text-risk-red'
              }`} />
              <span className={`font-semibold tabular-nums ${
                delta === 0 ? 'text-muted-foreground' :
                delta < 0 ? 'text-risk-green' : 'text-risk-red'
              }`}>
                {delta > 0 ? '+' : ''}{delta.toFixed(1)} pts
              </span>
              <span className="text-muted-foreground text-xs">vs current</span>
            </div>
          )}

          {/* Threshold headroom */}
          <div className="mt-4 space-y-1 text-[11px]">
            <HeadroomRow label="vs 150 threshold" projected={projected} threshold={150} />
            <HeadroomRow label="vs 200 threshold" projected={projected} threshold={200} />
          </div>
        </div>

        {/* Right: gauge ring */}
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg
            viewBox={`0 0 ${size} ${size}`}
            width={size}
            height={size}
            className="-rotate-90"
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke="currentColor"
              className="text-muted opacity-30"
              strokeWidth={stroke}
              fill="none"
            />
            {projected != null && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={z.strokeHex}
                strokeWidth={stroke}
                fill="none"
                strokeDasharray={`${dash} ${c - dash}`}
                strokeLinecap="round"
                strokeDashoffset={0}
                style={{ transition: 'stroke-dasharray 400ms ease, stroke 400ms ease' }}
              />
            )}
            {/* Threshold ticks at 150 and 200 (as fraction of gaugeMax) */}
            <ThresholdTick angle={150 / gaugeMax} size={size} r={r} stroke={stroke} color="var(--risk-yellow)" />
            <ThresholdTick angle={200 / gaugeMax} size={size} r={r} stroke={stroke} color="var(--risk-red)" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">CR</span>
            <span className={`text-2xl font-bold tabular-nums ${z.text}`}>
              {formatRatio(projected)}
            </span>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">
              {zone}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeadroomRow({ label, projected, threshold }: { label: string; projected: number | null; threshold: number }) {
  if (projected == null) {
    return (
      <div className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">—</span>
      </div>
    );
  }
  const diff = projected - threshold;
  const color = diff < 0 ? 'text-risk-green' : 'text-risk-red';
  const label2 = diff < 0 ? `${Math.abs(diff).toFixed(0)} pts headroom` : `${diff.toFixed(0)} pts OVER`;
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${color}`}>{label2}</span>
    </div>
  );
}

function ThresholdTick({ angle, size, r, stroke, color }: {
  angle: number; size: number; r: number; stroke: number; color: string;
}) {
  // angle is 0..1 fraction of the circle (post-rotate origin at top).
  const theta = angle * 2 * Math.PI;
  const cx = size / 2 + r * Math.cos(theta);
  const cy = size / 2 + r * Math.sin(theta);
  return (
    <circle
      cx={cx}
      cy={cy}
      r={stroke * 0.35}
      fill={`hsl(${color})`}
      opacity={0.9}
    />
  );
}
