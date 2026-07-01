import { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { Snapshot, SnapshotProjections, ProjectionScenario } from '@/types/snapshot';
import { ProjBadge } from './ProjBadge';
import { horizonKey, HORIZONS, type HorizonMonths, type ScopeSelection } from './types';
import { filterOfficesByScope } from './selectors';

interface Props {
  snapshot: Snapshot;
  projections: SnapshotProjections;
  timeframe: HorizonMonths;
  scenario: ProjectionScenario;
  scope: ScopeSelection;
}

/**
 * Outflow (fall-offs from the 24-mo window) vs Inflow (new loans entering
 * the window) — historical months solid, projected months dashed. A vertical
 * "today" divider anchors the transition.
 *
 * Historical inflow / outflow are approximated by month-bucketing loans'
 * `first_payment_date`:
 *   - Inflow at month M   = loans whose FPD == M     (they enter the window)
 *   - Outflow at month M  = loans whose FPD was 24 months before M
 *
 * Projected outflow at horizon H = `projected_dropoffs` from the horizon
 * block, allocated linearly across the H months for smoothness. Projected
 * inflow is set flat at the trailing-3-month avg (we don't project new
 * volume in v1 — noted in the methodology panel).
 */
export default function OutflowInflowChart({
  snapshot, projections, timeframe, scenario, scope,
}: Props) {
  const data = useMemo(() => buildSeries(snapshot, projections, timeframe, scope), [
    snapshot, projections, timeframe, scope,
  ]);

  return (
    <div className="rounded-2xl border bg-card shadow-sm p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Outflow vs Inflow — Loans in 24-Month Window
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Historical (solid) vs projected (dashed). Vertical divider = today.
            Outflow = loans falling off the HUD window by first-payment-date.
          </p>
        </div>
        <ProjBadge scenario={scenario} />
      </div>

      <div className="h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data.rows}
            margin={{ top: 8, right: 24, left: 0, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="label"
              fontSize={10}
              tickLine={false}
              interval={0}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--background))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ fontWeight: 600 }}
              formatter={(v: any, name: string) => [Math.round(Number(v)), name]}
            />
            <Legend
              iconType="line"
              wrapperStyle={{ fontSize: 11 }}
            />

            {/* Net delta area — inflow minus outflow, colored green when + */}
            <Area
              type="monotone"
              dataKey="netDelta"
              name="Net Δ (Inflow − Outflow)"
              stroke="none"
              fill="hsl(var(--risk-green))"
              fillOpacity={0.15}
              isAnimationActive
            />

            {/* Historical solid + projected dashed via two separate series */}
            <Line
              type="monotone"
              dataKey="outflowPast"
              name="Fall-offs (past)"
              stroke="#dc2626"
              strokeWidth={2}
              dot={{ r: 3, fill: '#dc2626', stroke: '#dc2626' }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive
            />
            <Line
              type="monotone"
              dataKey="outflowProj"
              name="Fall-offs (projected)"
              stroke="#dc2626"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 3, fill: 'white', stroke: '#dc2626', strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive
            />
            <Line
              type="monotone"
              dataKey="inflowPast"
              name="New originations (past)"
              stroke="#2563eb"
              strokeWidth={2}
              dot={{ r: 3, fill: '#2563eb', stroke: '#2563eb' }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive
            />
            <Line
              type="monotone"
              dataKey="inflowProj"
              name="New originations (projected)"
              stroke="#2563eb"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 3, fill: 'white', stroke: '#2563eb', strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive
            />

            <ReferenceLine
              x={data.todayLabel}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              label={{ value: 'today', position: 'top', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 text-[11px] text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
        <span><span className="inline-block w-3 border-t-2 border-red-600 align-middle mr-1"></span>Outflow (fall-offs) — solid past, dashed projected</span>
        <span><span className="inline-block w-3 border-t-2 border-blue-600 align-middle mr-1"></span>Inflow (originations) — solid past, dashed projected</span>
        <span>Projected inflow held flat at trailing-3-mo average (see Methodology).</span>
      </div>
    </div>
  );
}

interface Row {
  label: string;
  ym: string;
  outflowPast: number | null;
  outflowProj: number | null;
  inflowPast: number | null;
  inflowProj: number | null;
  netDelta: number;
}

function buildSeries(
  snapshot: Snapshot,
  projections: SnapshotProjections,
  timeframe: HorizonMonths,
  scope: ScopeSelection,
): { rows: Row[]; todayLabel: string } {
  const perfPeriod = snapshot.snapshot_meta.performance_period; // YYYY-MM-DD
  const [py, pm] = perfPeriod.split('-').map(Number);

  // Build (past 3mo, current, projected up to timeframe)
  const monthsBack = 3;
  const monthsForward = timeframe;

  const rowMap: Record<string, Row> = {};

  const monthLabel = (y: number, m: number) => {
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${names[m - 1]} ${String(y).slice(2)}`;
  };
  const ymKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

  // Seed month buckets
  for (let i = -monthsBack; i <= monthsForward; i++) {
    let y = py, m = pm + i;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    const k = ymKey(y, m);
    rowMap[k] = {
      label: monthLabel(y, m),
      ym: k,
      outflowPast: null,
      outflowProj: null,
      inflowPast: null,
      inflowProj: null,
      netDelta: 0,
    };
  }

  const todayLabel = monthLabel(py, pm);

  // Scoped loan filter
  const projLoans = projections.loans;
  const inScope = (loan_office_id: string | null | undefined, loan_hoc: string | null | undefined) => {
    if (scope.kind === 'all') return true;
    if (scope.kind === 'hoc') return loan_hoc === scope.id;
    if (scope.kind === 'office') return loan_office_id === scope.id;
    return true;
  };
  const scopedLoans = projLoans.filter(l => inScope(l.office_id, l.hoc));

  // Historical outflow: loans whose first_payment_date is exactly (M − 24 months)
  // → they fell off in month M. Historical inflow: loans whose FPD == M → they
  // entered the window in month M.
  for (const l of scopedLoans) {
    const fpd = l.first_payment_due_date;
    if (!fpd) continue;
    const [yy, mm] = fpd.split('-').map(Number);
    // Inflow bucket = FPD month
    const inflowKey = ymKey(yy, mm);
    if (rowMap[inflowKey] && rowMap[inflowKey].inflowPast != null || !rowMap[inflowKey]) {
      // handled below
    }
    // Outflow bucket = FPD + 24 months
    let oy = yy, om = mm + 24;
    while (om > 12) { om -= 12; oy += 1; }
    const outflowKey = ymKey(oy, om);
    if (rowMap[outflowKey]) {
      rowMap[outflowKey].outflowPast = (rowMap[outflowKey].outflowPast ?? 0) + 1;
    }
    if (rowMap[inflowKey]) {
      rowMap[inflowKey].inflowPast = (rowMap[inflowKey].inflowPast ?? 0) + 1;
    }
  }

  // Now split past vs projected. Anything strictly AFTER perfPeriod (yy-mm)
  // becomes the "projected" series; anything at-or-before is "past".
  // Also, the point AT perfPeriod should exist in BOTH series so lines connect.
  const perfKey = ymKey(py, pm);

  for (const key of Object.keys(rowMap)) {
    const r = rowMap[key];
    if (key > perfKey) {
      // future — move to projected
      r.outflowProj = r.outflowPast;
      r.inflowProj = r.inflowPast;
      r.outflowPast = null;
      r.inflowPast = null;
    }
  }

  // For projected series specifically we need to use the projections block
  // (not the historically-derived numbers). Allocate horizon dropoffs evenly.
  const key1 = horizonKey(1);
  const key3 = horizonKey(3);
  const key6 = horizonKey(6);

  // Aggregate horizon dropoffs across scoped offices
  const scopedOffices = filterOfficesByScope(projections, scope);
  const sumOff = (k: '1mo' | '3mo' | '6mo') =>
    scopedOffices.reduce((acc, o) => acc + (o.horizons[k]?.projected_dropoffs ?? 0), 0);
  const drop1 = sumOff(key1);
  const drop3 = sumOff(key3);
  const drop6 = sumOff(key6);

  // per-month projected drop-offs: month-1 = drop1, month-3 total = drop3, month-6 total = drop6
  const perMonth: Record<number, number> = {
    1: drop1,
    2: Math.max(0, drop3 - drop1) / 2,
    3: Math.max(0, drop3 - drop1) / 2,
    4: Math.max(0, drop6 - drop3) / 3,
    5: Math.max(0, drop6 - drop3) / 3,
    6: Math.max(0, drop6 - drop3) / 3,
  };
  // Prefer whole-loan cumulative shape: use per-horizon exact numbers at H=1,3,6.
  perMonth[2] = Math.round(drop1 + (drop3 - drop1) / 3);
  perMonth[3] = drop3;
  perMonth[4] = Math.round(drop3 + (drop6 - drop3) / 3);
  perMonth[5] = Math.round(drop3 + 2 * (drop6 - drop3) / 3);
  perMonth[6] = drop6;

  // Anchor projected outflow points at the actual horizon end. In between
  // months are interpolated so the line still draws.
  for (let i = 1; i <= monthsForward; i++) {
    let y = py, m = pm + i;
    while (m > 12) { m -= 12; y += 1; }
    const k = ymKey(y, m);
    if (!rowMap[k]) continue;
    rowMap[k].outflowProj = perMonth[i] ?? null;
  }

  // Projected inflow: trailing 3-month avg (from the historically-derived
  // inflow numbers before we cleared them out — recompute here to be safe).
  const trailInflow: number[] = [];
  for (let i = 1; i <= monthsBack; i++) {
    let y = py, m = pm - i;
    while (m < 1) { m += 12; y -= 1; }
    const k = ymKey(y, m);
    if (rowMap[k]?.inflowPast != null) trailInflow.push(rowMap[k].inflowPast as number);
  }
  const avgInflow = trailInflow.length
    ? Math.round(trailInflow.reduce((a, b) => a + b, 0) / trailInflow.length)
    : 0;
  for (let i = 1; i <= monthsForward; i++) {
    let y = py, m = pm + i;
    while (m > 12) { m -= 12; y += 1; }
    const k = ymKey(y, m);
    if (rowMap[k]) rowMap[k].inflowProj = avgInflow;
  }

  // Bridge past → projected: duplicate perfPeriod point into projected series.
  if (rowMap[perfKey]) {
    rowMap[perfKey].outflowProj = rowMap[perfKey].outflowPast ?? null;
    rowMap[perfKey].inflowProj = rowMap[perfKey].inflowPast ?? null;
  }

  // Compute net delta at each point (use whichever line is present)
  const rows = Object.values(rowMap)
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .map(r => {
      const out = r.outflowPast ?? r.outflowProj ?? 0;
      const inn = r.inflowPast ?? r.inflowProj ?? 0;
      r.netDelta = inn - out;
      return r;
    });

  return { rows, todayLabel };
}
