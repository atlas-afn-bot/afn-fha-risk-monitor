import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend } from 'recharts';
import { TrendingDown, Target, Database } from 'lucide-react';
import type { HUDMonthlySnapshot } from '@/lib/hudHistory';

interface Props {
  history: HUDMonthlySnapshot[];
}

export default function TrendChart({ history }: Props) {
  const chartData = useMemo(() =>
    history.map(h => ({
      month: h.label,
      overall: h.overallCR,
      retail: h.retailCR,
      wholesale: h.wholesaleCR,
    })),
  [history]);

  if (chartData.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="section-title mb-1">Compare Ratio Trend</h2>
        <p className="text-sm text-muted-foreground mb-4">Historical compare ratio performance by channel</p>
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
          <Database className="w-8 h-8" />
          <p className="text-sm font-medium">No historical data yet</p>
          <p className="text-xs text-center max-w-md">
            Each time you upload a HUD Field Offices file, that month's compare ratios are saved automatically.
            Upload prior months' reports to build your trend line.
          </p>
        </div>
      </div>
    );
  }

  // Compute dynamic callouts
  const latest = chartData[chartData.length - 1];
  const first = chartData[0];
  const overallTrend = latest && first ? latest.overall - first.overall : 0;
  const retailTrend = latest && first ? latest.retail - first.retail : 0;

  // Find min values
  const minOverall = Math.min(...chartData.map(d => d.overall));
  const isOverallAtLow = latest && latest.overall <= minOverall;
  const minRetail = Math.min(...chartData.map(d => d.retail));
  const isRetailAtLow = latest && latest.retail <= minRetail;

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="section-title">{chartData.length}-Month Compare Ratio Trend</h2>
        <span className="text-[10px] text-muted-foreground">{chartData.length} months stored</span>
      </div>
      <p className="text-sm text-muted-foreground mb-4">Historical compare ratio performance by channel</p>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} interval={Math.max(0, Math.floor(chartData.length / 8))} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend />
            <ReferenceLine y={150} stroke="hsl(30, 90%, 50%)" strokeDasharray="6 3" label={{ value: '150% Goal', position: 'right', fontSize: 11 }} />
            <ReferenceLine y={200} stroke="hsl(354, 70%, 54%)" strokeDasharray="6 3" label={{ value: '200% Termination', position: 'right', fontSize: 11 }} />
            <Line type="monotone" dataKey="overall" stroke="#000" strokeWidth={2.5} name="Overall" dot={chartData.length <= 12} />
            <Line type="monotone" dataKey="retail" stroke="hsl(142, 60%, 40%)" strokeWidth={1.5} name="Retail" dot={chartData.length <= 12} />
            <Line type="monotone" dataKey="wholesale" stroke="hsl(213, 80%, 50%)" strokeWidth={1.5} name="Wholesale" dot={chartData.length <= 12} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        {isOverallAtLow && isRetailAtLow && (
          <div className="flex items-center gap-2 text-xs">
            <TrendingDown className="w-3.5 h-3.5 text-risk-green" />
            <span className="text-risk-green">Overall and Retail at {chartData.length}-month low</span>
          </div>
        )}
        {overallTrend < 0 && (
          <div className="flex items-center gap-2 text-xs">
            <TrendingDown className="w-3.5 h-3.5 text-risk-green" />
            <span className="text-risk-green">Overall trending down {Math.abs(overallTrend)}pts over period</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs">
          <Target className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Goal: 150% or below</span>
        </div>
      </div>
    </div>
  );
}
