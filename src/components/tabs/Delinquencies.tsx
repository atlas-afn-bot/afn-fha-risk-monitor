import { useMemo, useState } from 'react';
import { AlertTriangle, ShieldAlert, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { Snapshot } from '@/types/snapshot';
import type { DashboardData } from '@/lib/types';

interface Props {
  snapshot: Snapshot;
  data: DashboardData;
}

export default function Delinquencies({ snapshot, data }: Props) {
  const reasonRollup = data.delinquencyReasonRollup ?? snapshot.delinquency_reason_rollup ?? [];
  const indemnified = data.indemnificationLoans ?? snapshot.indemnification_loans ?? [];

  const sdqLoans = useMemo(
    () => snapshot.loans.filter(l => l.is_seriously_delinquent),
    [snapshot],
  );

  const [showAll, setShowAll] = useState(false);
  const visibleLoans = showAll ? sdqLoans : sdqLoans.slice(0, 25);

  const chartData = reasonRollup.map(r => ({
    label: r.reason_description.length > 28
      ? r.reason_description.slice(0, 26) + '…'
      : r.reason_description,
    fullLabel: r.reason_description,
    code: r.reason_code,
    count: r.loan_count,
    pct: r.pct_of_sdq,
  }));

  return (
    <div className="space-y-6">
      {/* Reason code distribution */}
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Delinquency Reason Distribution</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          HUD-reported reason codes for the {sdqLoans.length} seriously-delinquent loans in this period.
        </p>

        {chartData.length > 0 ? (
          <div className="w-full h-72">
            <ResponsiveContainer>
              <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 24, left: 8, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={170} />
                <Tooltip
                  contentStyle={{ fontSize: '11px', borderRadius: 6 }}
                  formatter={(v: unknown, _n, p) => [
                    `${v} loans (${(p.payload as { pct: number }).pct.toFixed(1)}%)`,
                    (p.payload as { fullLabel: string }).fullLabel,
                  ]}
                />
                <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.pct >= 20 ? 'hsl(var(--risk-red))' : d.pct >= 10 ? 'hsl(var(--risk-yellow))' : 'hsl(var(--risk-blue))'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No reason-code data in this snapshot.</p>
        )}
      </div>

      {/* Indemnified loans */}
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-4 h-4 text-risk-yellow" />
          <h3 className="text-sm font-semibold">Indemnified Loans ({indemnified.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Loans flagged with an HUD indemnification agreement on the NW Data 2 export.
        </p>

        {indemnified.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Loan #</th>
                  <th className="text-left px-3 py-2 font-medium">FHA Case</th>
                  <th className="text-left px-3 py-2 font-medium">LO</th>
                  <th className="text-left px-3 py-2 font-medium">Channel</th>
                  <th className="text-left px-3 py-2 font-medium">HUD Office</th>
                  <th className="text-left px-3 py-2 font-medium">Indem Type</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Months DQ</th>
                </tr>
              </thead>
              <tbody>
                {indemnified.map(l => (
                  <tr key={l.loan_id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-[11px]">{l.loan_id}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{l.fha_case_number ?? '—'}</td>
                    <td className="px-3 py-2">{l.lo_name ?? '—'}</td>
                    <td className="px-3 py-2">{l.channel ?? '—'}</td>
                    <td className="px-3 py-2">{l.hud_office ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className="risk-badge-yellow">{l.indemnification_type}</span>
                    </td>
                    <td className="px-3 py-2">
                      {l.sdq_status === 'SDQ' ? (
                        <span className="risk-badge-red">SDQ</span>
                      ) : (
                        <span className="risk-badge-green">Current</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{l.months_delinquent ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No indemnified loans in this snapshot.</p>
        )}
      </div>

      {/* SDQ Loan list */}
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-4 h-4 text-risk-red" />
          <h3 className="text-sm font-semibold">Seriously Delinquent Loans ({sdqLoans.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Loan-level SDQ list from NW Data 2.{sdqLoans.length > 25 && !showAll && ' Showing first 25.'}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Loan #</th>
                <th className="text-left px-3 py-2 font-medium">FHA Case</th>
                <th className="text-left px-3 py-2 font-medium">LO</th>
                <th className="text-left px-3 py-2 font-medium">Channel</th>
                <th className="text-left px-3 py-2 font-medium">HUD Office</th>
                <th className="text-right px-3 py-2 font-medium">Months DQ</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {visibleLoans.map(l => (
                <tr key={l.loan_id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-[11px]">{l.loan_id}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{l.fha_case_number ?? '—'}</td>
                  <td className="px-3 py-2">{l.loan_officer ?? '—'}</td>
                  <td className="px-3 py-2">{l.channel ?? '—'}</td>
                  <td className="px-3 py-2">{l.hud_office ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{l.months_delinquent ?? '—'}</td>
                  <td className="px-3 py-2">{l.delinquent_status_code ?? '—'}</td>
                  <td className="px-3 py-2">{l.delinquent_reason_code ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sdqLoans.length > 25 && (
          <button
            onClick={() => setShowAll(s => !s)}
            className="mt-4 text-xs text-primary hover:underline"
          >
            {showAll ? 'Show first 25' : `Show all ${sdqLoans.length}`}
          </button>
        )}
      </div>
    </div>
  );
}
