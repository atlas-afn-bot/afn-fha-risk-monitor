import { useMemo } from 'react';
import type { Snapshot } from '@/types/snapshot';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Activity } from 'lucide-react';

interface Props {
  snapshot: Snapshot;
}

const HOC_ORDER = ['Denver', 'Philadelphia', 'Santa Ana', 'Atlanta'] as const;

const COLORS: Record<string, string> = {
  Denver: 'hsl(210, 60%, 50%)',
  Philadelphia: 'hsl(150, 50%, 45%)',
  'Santa Ana': 'hsl(30, 70%, 50%)',
  Atlanta: 'hsl(0, 60%, 50%)',
};

export default function HOCRiskIndicatorDensity({ snapshot }: Props) {
  const chartData = useMemo(() => {
    const byHoc = new Map<string, { totalIndicators: number; loanCount: number }>();
    for (const name of HOC_ORDER) byHoc.set(name, { totalIndicators: 0, loanCount: 0 });

    for (const loan of snapshot.loans) {
      if (!loan.hoc || !byHoc.has(loan.hoc)) continue;
      const entry = byHoc.get(loan.hoc)!;
      entry.totalIndicators += loan.risk_indicator_count ?? 0;
      entry.loanCount++;
    }

    return HOC_ORDER.map(name => {
      const d = byHoc.get(name)!;
      return {
        hoc: name,
        avgIndicators: d.loanCount > 0 ? d.totalIndicators / d.loanCount : 0,
        loanCount: d.loanCount,
        totalIndicators: d.totalIndicators,
      };
    });
  }, [snapshot]);

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="w-4 h-4 text-purple-500" />
        <h3 className="text-sm font-semibold">Risk Indicator Density by HOC</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Average number of risk indicators per loan across HOC regions.
        Higher density signals portfolios with more layered risk.
      </p>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="hoc" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} domain={[0, 'auto']} />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(value: number, _name: string, entry: any) => [
                `${value.toFixed(2)} avg (${entry.payload.totalIndicators.toLocaleString()} total across ${entry.payload.loanCount.toLocaleString()} loans)`,
                'Avg Indicators',
              ]}
            />
            <Bar dataKey="avgIndicators" name="Avg Risk Indicators" radius={[4, 4, 0, 0]}>
              {chartData.map(entry => (
                <Cell key={entry.hoc} fill={COLORS[entry.hoc] ?? 'hsl(210, 50%, 50%)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
