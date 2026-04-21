import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import type { DashboardData } from '@/lib/types';
import SliderWithInput from './SliderWithInput';

interface Props { data: DashboardData }

export default function HUDConcentration({ data }: Props) {
  const [minLoans, setMinLoans] = useState(50);

  const chartData = useMemo(() => {
    return data.offices
      .filter(o => o.totalLoans >= minLoans)
      .sort((a, b) => b.totalDPAConc - a.totalDPAConc)
      .map(o => ({
        name: o.name,
        Standard: o.totalLoans - data.loans.filter(l => l.HUDOffice === o.name && l.isDPA).length,
        DPA: data.loans.filter(l => l.HUDOffice === o.name && l.isDPA).length,
        dpaConc: o.totalDPAConc,
      }));
  }, [data, minLoans]);

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">DPA Concentration by HUD Office</h2>
        <SliderWithInput
          label="Min loans:"
          min={10}
          max={200}
          value={minLoans}
          onChange={setMinLoans}
        />
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
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
