import { useMemo } from 'react';
import type { Snapshot } from '@/types/snapshot';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { GitBranch } from 'lucide-react';

interface Props {
  snapshot: Snapshot;
}

const HOC_ORDER = ['Denver', 'Philadelphia', 'Santa Ana', 'Atlanta'] as const;

export default function HOCChannelMix({ snapshot }: Props) {
  const chartData = useMemo(() => {
    const byHoc = new Map<string, { retail: number; sponsored: number }>();
    for (const name of HOC_ORDER) byHoc.set(name, { retail: 0, sponsored: 0 });

    for (const o of snapshot.compare_ratios_hud_office ?? []) {
      if (!o.hoc || !byHoc.has(o.hoc)) continue;
      const entry = byHoc.get(o.hoc)!;
      entry.retail += o.retail_loans ?? 0;
      entry.sponsored += o.sponsored_loans ?? 0;
    }

    return HOC_ORDER.map(name => {
      const d = byHoc.get(name)!;
      const total = d.retail + d.sponsored;
      return {
        hoc: name,
        Retail: d.retail,
        Sponsored: d.sponsored,
        retailPct: total > 0 ? ((d.retail / total) * 100).toFixed(1) : '0',
        sponsoredPct: total > 0 ? ((d.sponsored / total) * 100).toFixed(1) : '0',
      };
    });
  }, [snapshot]);

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="w-4 h-4 text-risk-blue" />
        <h3 className="text-sm font-semibold">Channel Mix Breakdown by HOC</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Retail vs Sponsored Originator loan volume split per HOC region.
      </p>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="hoc" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(value: number, name: string, entry: any) => {
                const pct = name === 'Retail' ? entry.payload.retailPct : entry.payload.sponsoredPct;
                return [`${value.toLocaleString()} (${pct}%)`, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Retail" stackId="a" fill="hsl(210, 70%, 55%)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Sponsored" stackId="a" fill="hsl(30, 80%, 55%)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
