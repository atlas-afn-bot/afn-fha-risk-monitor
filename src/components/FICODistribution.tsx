import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { FICOBucket } from '@/lib/types';

interface Props { buckets: FICOBucket[] }

export default function FICODistribution({ buckets }: Props) {
  const allDPAHigher = buckets.every(b => b.dpaTotal > 0 && b.standardTotal > 0 && b.dpaDQ > b.standardDQ);

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h2 className="section-title mb-4">Delinquency by FICO Score Band</h2>
      <div className="h-80">
        <ResponsiveContainer>
          <BarChart data={buckets} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
            <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
            <Legend />
            <Bar dataKey="standardDQ" name="Standard FHA" fill="hsl(213, 80%, 50%)" />
            <Bar dataKey="dpaDQ" name="DPA" fill="hsl(354, 70%, 54%)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {allDPAHigher && (
        <div className="mt-4 p-3 bg-risk-red-bg rounded-lg">
          <p className="text-xs font-medium text-center text-risk-red">
            ⚠️ DPA loans have elevated delinquency at every FICO level, including 740+, indicating program-level rather than borrower-level risk.
          </p>
        </div>
      )}
    </div>
  );
}
