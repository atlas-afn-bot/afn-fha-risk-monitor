import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, Legend, ComposedChart, Line
} from 'recharts';
import type { TrendAnalysis, TrendDimension } from '@/lib/types';

interface Props {
  trends: TrendAnalysis;
  overallDQRate: number;
}

const COLORS = {
  high: 'hsl(354, 70%, 54%)',    // red
  medium: 'hsl(38, 92%, 50%)',   // amber
  low: 'hsl(213, 80%, 50%)',     // blue
  green: 'hsl(142, 60%, 40%)',   // green
  standard: 'hsl(213, 80%, 50%)',
  dpa: 'hsl(354, 70%, 54%)',
};

function barColor(dqRate: number, avg: number): string {
  if (dqRate > avg * 1.5) return COLORS.high;
  if (dqRate > avg * 1.1) return COLORS.medium;
  return COLORS.green;
}

function DQTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? `${p.value.toFixed(2)}%` : p.value}
        </p>
      ))}
    </div>
  );
}

/* ─── 1. Risk Indicator Stacking ─── */
function RiskLayeringChart({ data, avg }: { data: TrendDimension[]; avg: number }) {
  const sorted = useMemo(() => {
    return [...data]
      .sort((a, b) => {
        const numA = a.label === '5+' ? 5 : parseInt(a.label);
        const numB = b.label === '5+' ? 5 : parseInt(b.label);
        return numA - numB;
      })
      .map(d => ({
        name: `${d.label} risk factors`,
        dqRate: d.dqRate,
        loans: d.total,
      }));
  }, [data]);

  return (
    <div>
      <h3 className="text-sm font-semibold mb-1 text-foreground">Risk Factor Layering</h3>
      <p className="text-[10px] text-muted-foreground mb-3">DQ rate escalation as risk indicators compound</p>
      <div className="h-56">
        <ResponsiveContainer>
          <ComposedChart data={sorted} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
            <Tooltip content={<DQTooltip />} />
            <ReferenceLine y={avg} stroke="#999" strokeDasharray="4 3" label={{ value: `Avg: ${avg.toFixed(1)}%`, fontSize: 9, position: 'right' }} />
            <Bar dataKey="dqRate" name="DQ Rate" radius={[3, 3, 0, 0]}>
              {sorted.map((d, i) => <Cell key={i} fill={barColor(d.dqRate, avg)} />)}
            </Bar>
            <Line type="monotone" dataKey="dqRate" stroke="#000" strokeWidth={1.5} dot={false} name="Trend" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── 2. Source of Funds ─── */
function SourceOfFundsChart({ data, avg }: { data: TrendDimension[]; avg: number }) {
  const sorted = useMemo(() =>
    [...data]
      .filter(d => d.total >= 10)
      .sort((a, b) => b.dqRate - a.dqRate)
      .map(d => ({ name: d.label || 'Unknown', dqRate: d.dqRate, loans: d.total })),
    [data]
  );

  return (
    <div>
      <h3 className="text-sm font-semibold mb-1 text-foreground">Source of Funds</h3>
      <p className="text-[10px] text-muted-foreground mb-3">DQ rate by borrower funding source (≥10 loans)</p>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={sorted} layout="vertical" margin={{ left: 100, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={95} />
            <Tooltip content={<DQTooltip />} />
            <ReferenceLine x={avg} stroke="#999" strokeDasharray="4 3" />
            <Bar dataKey="dqRate" name="DQ Rate" radius={[0, 3, 3, 0]}>
              {sorted.map((d, i) => <Cell key={i} fill={barColor(d.dqRate, avg)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── 3. LTV Group ─── */
function LTVChart({ data, avg }: { data: TrendDimension[]; avg: number }) {
  const sorted = useMemo(() =>
    [...data]
      .sort((a, b) => {
        const numA = parseFloat(a.label) || 0;
        const numB = parseFloat(b.label) || 0;
        return numA - numB;
      })
      .map(d => ({ name: d.label || 'Unknown', dqRate: d.dqRate, loans: d.total })),
    [data]
  );

  return (
    <div>
      <h3 className="text-sm font-semibold mb-1 text-foreground">LTV Group</h3>
      <p className="text-[10px] text-muted-foreground mb-3">Delinquency rate by loan-to-value ratio band</p>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={sorted} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
            <Tooltip content={<DQTooltip />} />
            <ReferenceLine y={avg} stroke="#999" strokeDasharray="4 3" label={{ value: `Avg: ${avg.toFixed(1)}%`, fontSize: 9, position: 'right' }} />
            <Bar dataKey="dqRate" name="DQ Rate" radius={[3, 3, 0, 0]}>
              {sorted.map((d, i) => <Cell key={i} fill={barColor(d.dqRate, avg)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── 4. Manual vs Auto UW ─── */
function UWComparisonChart({ trends }: { trends: TrendAnalysis }) {
  const data = [
    { name: 'Auto UW', dqRate: trends.autoUWDQRate, fill: COLORS.green },
    { name: 'Manual UW', dqRate: trends.manualUWDQRate, fill: COLORS.high },
  ];

  const diff = trends.manualUWDQRate - trends.autoUWDQRate;
  const multiplier = trends.autoUWDQRate > 0 ? (trends.manualUWDQRate / trends.autoUWDQRate).toFixed(1) : 'N/A';

  return (
    <div>
      <h3 className="text-sm font-semibold mb-1 text-foreground">Underwriting Method</h3>
      <p className="text-[10px] text-muted-foreground mb-3">
        Manual UW = {trends.manualUWRate.toFixed(1)}% of portfolio · DQ rate {multiplier}x auto
      </p>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
            <Tooltip content={<DQTooltip />} />
            <Bar dataKey="dqRate" name="DQ Rate" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {diff > 0 && (
        <p className="text-center text-[10px] mt-1 text-muted-foreground">
          Manual UW defaults <span className="font-bold text-risk-red">+{diff.toFixed(2)}pp</span> higher than auto
        </p>
      )}
    </div>
  );
}

/* ─── 5. DTI Back-End ─── */
function DTIChart({ data, avg }: { data: TrendDimension[]; avg: number }) {
  const sorted = useMemo(() =>
    [...data]
      .sort((a, b) => {
        const numA = parseFloat(a.label) || 0;
        const numB = parseFloat(b.label) || 0;
        return numA - numB;
      })
      .map(d => ({ name: d.label || 'Unknown', dqRate: d.dqRate, loans: d.total })),
    [data]
  );

  return (
    <div>
      <h3 className="text-sm font-semibold mb-1 text-foreground">DTI Back-End</h3>
      <p className="text-[10px] text-muted-foreground mb-3">Delinquency rate by debt-to-income ratio band</p>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={sorted} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
            <Tooltip content={<DQTooltip />} />
            <ReferenceLine y={avg} stroke="#999" strokeDasharray="4 3" label={{ value: `Avg: ${avg.toFixed(1)}%`, fontSize: 9, position: 'right' }} />
            <Bar dataKey="dqRate" name="DQ Rate" radius={[3, 3, 0, 0]}>
              {sorted.map((d, i) => <Cell key={i} fill={barColor(d.dqRate, avg)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── 6. Reserves ─── */
function ReservesChart({ data, avg }: { data: TrendDimension[]; avg: number }) {
  const sorted = useMemo(() =>
    [...data]
      .sort((a, b) => {
        const numA = parseFloat(a.label) || 0;
        const numB = parseFloat(b.label) || 0;
        return numA - numB;
      })
      .map(d => ({ name: `${d.label} mo`, dqRate: d.dqRate, loans: d.total })),
    [data]
  );

  return (
    <div>
      <h3 className="text-sm font-semibold mb-1 text-foreground">Reserves (Months)</h3>
      <p className="text-[10px] text-muted-foreground mb-3">Delinquency rate by reserve adequacy</p>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={sorted} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
            <Tooltip content={<DQTooltip />} />
            <ReferenceLine y={avg} stroke="#999" strokeDasharray="4 3" label={{ value: `Avg: ${avg.toFixed(1)}%`, fontSize: 9, position: 'right' }} />
            <Bar dataKey="dqRate" name="DQ Rate" radius={[3, 3, 0, 0]}>
              {sorted.map((d, i) => <Cell key={i} fill={barColor(d.dqRate, avg)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── Main Component ─── */
export default function RiskFactorCharts({ trends, overallDQRate }: Props) {
  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h2 className="section-title mb-1">Risk Factor Deep Dive</h2>
      <p className="text-xs text-muted-foreground mb-6">
        Delinquency rates broken down by underwriting risk dimensions · Portfolio avg: {overallDQRate.toFixed(2)}%
        <span className="ml-2 inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: COLORS.high }} /> &gt;1.5x avg
          <span className="w-2 h-2 rounded-full inline-block ml-2" style={{ background: COLORS.medium }} /> &gt;1.1x avg
          <span className="w-2 h-2 rounded-full inline-block ml-2" style={{ background: COLORS.green }} /> ≤avg
        </span>
      </p>

      {/* Row 1: Risk Layering + Source of Funds — the two most impactful */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <RiskLayeringChart data={trends.riskIndicatorCount} avg={overallDQRate} />
        <SourceOfFundsChart data={trends.sourceOfFunds} avg={overallDQRate} />
      </div>

      {/* Row 2: LTV + Manual vs Auto UW */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <LTVChart data={trends.ltvGroups} avg={overallDQRate} />
        <UWComparisonChart trends={trends} />
      </div>

      {/* Row 3: DTI + Reserves */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DTIChart data={trends.dtiGroups} avg={overallDQRate} />
        <ReservesChart data={trends.reservesGroups} avg={overallDQRate} />
      </div>
    </div>
  );
}
