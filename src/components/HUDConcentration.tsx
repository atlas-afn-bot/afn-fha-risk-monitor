import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import type { DashboardData } from '@/lib/types';

interface Props { data: DashboardData }

export default function HUDConcentration({ data }: Props) {
  const [minLoans, setMinLoans] = useState(50);

  const chartData = useMemo(() => {
    return data.offices
      .filter(o => o.totalLoans >= minLoans)
      .sort((a, b) => b.totalDPAConc - a.totalDPAConc)
      .map(o => ({
        name: o.name,
        Standard: o.totalLoans - data.loans.filter(l => l.HUDOffice === o.name && l.isDPA).length - data.loans.filter(l => l.HUDOffice === o.name && l.isFUEL).length,
        DPA: data.loans.filter(l => l.HUDOffice === o.name && l.isDPA).length,
        FUEL: data.loans.filter(l => l.HUDOffice === o.name && l.isFUEL).length,
        dpaConc: o.totalDPAConc,
      }));
  }, [data, minLoans]);

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">DPA Concentration by HUD Office</h2>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Min loans:</label>
          <input
            type="range"
            min={10}
            max={200}
            value={minLoans}
            onChange={e => setMinLoans(Number(e.target.value))}
            className="w-24"
          />
          <span className="text-xs font-medium w-8">{minLoans}</span>
        </div>
      </div>
      <div style={{ height: Math.max(400, chartData.length * 28) }}>
        <ResponsiveContainer>
          <BarChart data={chartData} layout="vertical" margin={{ left: 90, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={85} />
            <Tooltip />
            <Legend />
            <Bar dataKey="Standard" stackId="a" fill="hsl(213, 80%, 50%)" />
            <Bar dataKey="DPA" stackId="a" fill="hsl(354, 70%, 54%)" />
            <Bar dataKey="FUEL" stackId="a" fill="hsl(142, 60%, 40%)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
