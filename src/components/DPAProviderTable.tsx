import { useMemo, useState } from 'react';
import { Download, ChevronDown, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import type { DPAProgramSummary } from '@/lib/types';

interface Props {
  programs: DPAProgramSummary[];
  overallDQRate?: number;
}

function riskBarColor(dqRate: number): string {
  if (dqRate > 8) return 'bg-risk-red';
  if (dqRate >= 4) return 'bg-risk-yellow';
  return 'bg-risk-green';
}

function InlineBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums w-12 text-right">{value.toFixed(1)}%</span>
    </div>
  );
}

/**
 * DPA Program Performance — primary analytics grouped by DPA Program
 * (Boost, Arrive/Aurora, …), with per-investor drill-down.
 *
 * Replaces the earlier per-DPA-Name view, which was too granular (multiple
 * rows representing the same underlying program).
 */
export default function DPAProviderTable({ programs, overallDQRate = 0 }: Props) {
  // Start with all programs expanded so the investor detail is visible immediately.
  const [openPrograms, setOpenPrograms] = useState<Set<string>>(
    () => new Set(programs.map(p => p.program)),
  );

  const maxDQRate = useMemo(
    () => Math.max(...programs.flatMap(p => [p.dqRate, ...p.investors.map(i => i.dqRate)]), 1),
    [programs],
  );

  const toggleProgram = (program: string) => {
    setOpenPrograms(prev => {
      const next = new Set(prev);
      if (next.has(program)) next.delete(program);
      else next.add(program);
      return next;
    });
  };

  // Chart data: top 10 (program, investor) pairs by delinquency count
  const topMatrixRows = useMemo(() => {
    const rows = programs.flatMap(p =>
      p.investors.map(i => ({
        label: `${p.program} · ${i.investor}`,
        program: p.program,
        investor: i.investor,
        totalLoans: i.totalLoans,
        delinquent: i.delinquent,
        dqRate: i.dqRate,
      })),
    );
    return rows.sort((a, b) => b.delinquent - a.delinquent).slice(0, 10);
  }, [programs]);

  // Summary stats
  const totalDPALoans = programs.reduce((s, p) => s + p.totalLoans, 0);
  const totalDPADLQ = programs.reduce((s, p) => s + p.delinquent, 0);
  const weightedDQRate = totalDPALoans > 0 ? (totalDPADLQ / totalDPALoans) * 100 : 0;
  const totalInvestors = programs.reduce((s, p) => s + p.investors.length, 0);
  const topProgram = programs.reduce<DPAProgramSummary | undefined>(
    (max, p) => (p.delinquent > (max?.delinquent ?? 0) ? p : max),
    undefined,
  );

  const exportCSV = () => {
    const headers = ['Program', 'Investor', 'Total Loans', 'Delinquent', 'DQ Rate', '% of Program', '% of DPA Volume', 'Retail', 'Wholesale'];
    const rows: string[] = [];
    for (const p of programs) {
      // Program-level total
      rows.push([p.program, '— All —', p.totalLoans, p.delinquent, `${p.dqRate.toFixed(1)}%`, '100.0%', `${p.pctOfDPAVolume.toFixed(1)}%`, p.retailLoans, p.wsLoans].join(','));
      for (const inv of p.investors) {
        rows.push([p.program, inv.investor, inv.totalLoans, inv.delinquent, `${inv.dqRate.toFixed(1)}%`, `${inv.pctOfProgramVolume.toFixed(1)}%`, `${inv.pctOfDPAVolume.toFixed(1)}%`, inv.retailLoans, inv.wsLoans].join(','));
      }
    }
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dpa_programs_investors.csv';
    a.click();
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">DPA Program &amp; Investor Performance</h2>
        <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-muted/50 rounded-lg px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Programs</p>
          <p className="text-lg font-bold mt-0.5">{programs.length}</p>
          <p className="text-[10px] text-muted-foreground">{totalInvestors} investors</p>
        </div>
        <div className="bg-muted/50 rounded-lg px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Weighted DQ Rate</p>
          <p className="text-lg font-bold mt-0.5">{weightedDQRate.toFixed(1)}%</p>
        </div>
        <div className="bg-muted/50 rounded-lg px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total DPA Loans</p>
          <p className="text-lg font-bold mt-0.5">{totalDPALoans.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">{totalDPADLQ} DLQ</p>
        </div>
        <div className="bg-muted/50 rounded-lg px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Top Program</p>
          <p className="text-xs font-bold mt-0.5 truncate" title={topProgram?.program}>{topProgram?.program ?? '—'}</p>
          <p className="text-[10px] text-muted-foreground">{topProgram?.delinquent ?? 0} DLQ ({(topProgram?.pctOfDPAVolume ?? 0).toFixed(0)}% vol)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Program × Investor hierarchy */}
        <div className="space-y-2">
          {programs.map(p => {
            const isOpen = openPrograms.has(p.program);
            const barColor = riskBarColor(p.dqRate);
            return (
              <div key={p.program} className="rounded-lg border border-border">
                <button
                  onClick={() => toggleProgram(p.program)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left bg-muted/40 rounded-t-lg hover:bg-muted/60"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                    <span className="text-sm font-semibold truncate">{p.program}</span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">
                      {p.investors.length} investor{p.investors.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
                    <span>{p.totalLoans.toLocaleString()} loans</span>
                    <span>{p.delinquent} DLQ</span>
                    <span className={`font-semibold ${p.dqRate > 8 ? 'text-risk-red' : p.dqRate >= 4 ? 'text-risk-yellow' : 'text-risk-green'}`}>
                      {p.dqRate.toFixed(1)}%
                    </span>
                  </div>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="matrix-header text-left">Investor</th>
                          <th className="matrix-header">Loans</th>
                          <th className="matrix-header">DLQ</th>
                          <th className="matrix-header" style={{ minWidth: 130 }}>DQ Rate</th>
                          <th className="matrix-header">% of Prog</th>
                          <th className="matrix-header">R</th>
                          <th className="matrix-header">WS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.investors.map(inv => (
                          <tr key={`${p.program}::${inv.investor}`} className="border-b border-border/50 hover:bg-muted/50">
                            <td className="px-2 py-1.5 text-xs text-left font-medium whitespace-nowrap max-w-[220px] truncate" title={inv.investor}>{inv.investor}</td>
                            <td className="matrix-cell">{inv.totalLoans.toLocaleString()}</td>
                            <td className="matrix-cell font-medium">{inv.delinquent}</td>
                            <td className="px-2 py-1.5">
                              <InlineBar value={inv.dqRate} max={maxDQRate} color={riskBarColor(inv.dqRate)} />
                            </td>
                            <td className="matrix-cell text-muted-foreground">{inv.pctOfProgramVolume.toFixed(1)}%</td>
                            <td className="matrix-cell">{inv.retailLoans}</td>
                            <td className="matrix-cell">{inv.wsLoans}</td>
                          </tr>
                        ))}
                        {/* Program total row */}
                        <tr className="border-t-2 border-border bg-muted/30">
                          <td className="px-2 py-1.5 text-xs text-left font-semibold">Program Total</td>
                          <td className="matrix-cell font-semibold">{p.totalLoans.toLocaleString()}</td>
                          <td className="matrix-cell font-semibold">{p.delinquent}</td>
                          <td className="px-2 py-1.5">
                            <InlineBar value={p.dqRate} max={maxDQRate} color={barColor} />
                          </td>
                          <td className="matrix-cell text-muted-foreground">100.0%</td>
                          <td className="matrix-cell font-semibold">{p.retailLoans}</td>
                          <td className="matrix-cell font-semibold">{p.wsLoans}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right: Chart — top Program × Investor pairs by DLQ count */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
            Top 10 Program · Investor by Delinquency Count
          </h3>
          <div className="h-80">
            <ResponsiveContainer>
              <BarChart data={topMatrixRows} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 9 }}
                  width={150}
                  tickFormatter={(v: string) => v.length > 26 ? v.substring(0, 26) + '…' : v}
                />
                <Tooltip
                  formatter={(v: number, _name: string, props: { payload?: { dqRate?: number } }) => [
                    `${v} (${(props.payload?.dqRate ?? 0).toFixed(1)}% DQ rate)`,
                    'Delinquent',
                  ]}
                />
                {overallDQRate > 0 && (
                  <ReferenceLine x={Math.round(overallDQRate)} stroke="#999" strokeDasharray="4 3" />
                )}
                <Bar dataKey="delinquent" name="Delinquent">
                  {topMatrixRows.map((r, i) => (
                    <Cell key={i} fill={r.dqRate > 8 ? 'hsl(354, 70%, 54%)' : r.dqRate >= 4 ? 'hsl(40, 90%, 50%)' : 'hsl(213, 80%, 50%)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
