import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, Legend } from 'recharts';
import type { DashboardData } from '@/lib/types';

interface Props { data: DashboardData }

const COLORS = ['hsl(213, 80%, 50%)', 'hsl(354, 70%, 54%)'];

export default function PortfolioComposition({ data }: Props) {
  const { programComposition: pc, totalLoans } = data;
  const pieData = [
    { name: 'Standard FHA', value: pc.standard, pct: ((pc.standard / totalLoans) * 100).toFixed(1) },
    { name: 'DPA Third-Party', value: pc.dpa, pct: ((pc.dpa / totalLoans) * 100).toFixed(1) },
  ];

  const barData = [
    { name: 'Standard FHA', rate: pc.standardDQ, fill: COLORS[0] },
    { name: 'DPA', rate: pc.dpaDQ, fill: COLORS[1] },
  ];

  const multiplier = pc.standardDQ > 0 ? (pc.dpaDQ / pc.standardDQ).toFixed(1) : 'N/A';
  const overallRate = data.overallDQRate;

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h2 className="section-title mb-4">Portfolio Composition by Program Type</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Loan Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" label={({ name, payload }: any) => `${name} (${payload?.pct ?? ''}%)`} labelLine={false}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={(val: number) => val.toLocaleString()} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-2">
            {pieData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i] }} />
                <span>{d.name}: {d.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Delinquency Rate by Program</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={barData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                <ReferenceLine y={overallRate} stroke="#999" strokeDasharray="4 3" label={{ value: `Portfolio: ${overallRate.toFixed(1)}%`, fontSize: 10, position: 'right' }} />
                <Bar dataKey="rate" name="DQ Rate">
                  {barData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-center text-xs mt-2 text-muted-foreground">
            DPA loans default at <span className="font-bold text-risk-red">{multiplier}x</span> the rate of standard FHA
          </p>
        </div>
      </div>
    </div>
  );
}
