import { useMemo } from 'react';
import type { Snapshot } from '@/types/snapshot';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { Shield } from 'lucide-react';

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

export default function HOCDPAConcentration({ snapshot }: Props) {
  const { chartData, overallDPA } = useMemo(() => {
    const byHoc = new Map<string, { total: number; dpa: number }>();
    for (const name of HOC_ORDER) byHoc.set(name, { total: 0, dpa: 0 });

    let totalAll = 0;
    let dpaAll = 0;
    for (const loan of snapshot.loans) {
      if (!loan.hoc || !byHoc.has(loan.hoc)) continue;
      const entry = byHoc.get(loan.hoc)!;
      entry.total++;
      totalAll++;
      if (loan.has_dpa) {
        entry.dpa++;
        dpaAll++;
      }
    }

    const data = HOC_ORDER.map(name => {
      const d = byHoc.get(name)!;
      return {
        hoc: name,
        dpaPct: d.total > 0 ? (d.dpa / d.total) * 100 : 0,
        dpaCount: d.dpa,
        totalCount: d.total,
      };
    });

    return {
      chartData: data,
      overallDPA: totalAll > 0 ? (dpaAll / totalAll) * 100 : 0,
    };
  }, [snapshot]);

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Shield className="w-4 h-4 text-yellow-500" />
        <h3 className="text-sm font-semibold">DPA Concentration by HOC</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Percentage of loans with Down Payment Assistance per HOC region.
        Dashed line shows the firm-wide average ({overallDPA.toFixed(1)}%).
      </p>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="hoc" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(value: number, _name: string, entry: any) => [
                `${value.toFixed(1)}% (${entry.payload.dpaCount.toLocaleString()} / ${entry.payload.totalCount.toLocaleString()})`,
                'DPA %',
              ]}
            />
            <ReferenceLine y={overallDPA} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" strokeWidth={1.5} />
            <Bar dataKey="dpaPct" name="DPA %" radius={[4, 4, 0, 0]}>
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
