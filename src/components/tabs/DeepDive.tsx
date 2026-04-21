import { useMemo } from 'react';
import { Users, GraduationCap, Handshake, Building } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Snapshot } from '@/types/snapshot';
import type { DashboardData } from '@/lib/types';

export type DeepDiveSubTab = 'lo' | 'uw' | 'tpo' | 'branch';

interface Props {
  snapshot: Snapshot;
  data: DashboardData;
  subTab: DeepDiveSubTab;
  onSubTabChange: (sub: DeepDiveSubTab) => void;
}

const SUB_TABS: Array<{ id: DeepDiveSubTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'lo', label: 'Loan Officers', icon: Users },
  { id: 'uw', label: 'Underwriters', icon: GraduationCap },
  { id: 'tpo', label: 'TPO / Sponsor', icon: Handshake },
  { id: 'branch', label: 'Branches (AFN)', icon: Building },
];

function badgeClass(val: number | null | undefined): string {
  if (val === null || val === undefined) return 'risk-badge-blue';
  if (val > 200) return 'risk-badge-red';
  if (val >= 150) return 'risk-badge-yellow';
  return 'risk-badge-green';
}

export default function DeepDive({ snapshot, data, subTab, onSubTabChange }: Props) {
  return (
    <Tabs value={subTab} onValueChange={v => onSubTabChange(v as DeepDiveSubTab)}>
      <TabsList className="h-auto flex-wrap gap-1">
        {SUB_TABS.map(s => (
          <TabsTrigger key={s.id} value={s.id} className="gap-1.5">
            <s.icon className="w-3.5 h-3.5" />
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="lo">
        {subTab === 'lo' && <LoanOfficerPanel snapshot={snapshot} />}
      </TabsContent>
      <TabsContent value="uw">
        {subTab === 'uw' && <UnderwriterPanel snapshot={snapshot} data={data} />}
      </TabsContent>
      <TabsContent value="tpo">
        {subTab === 'tpo' && <TPOPanel snapshot={snapshot} data={data} />}
      </TabsContent>
      <TabsContent value="branch">
        {subTab === 'branch' && <BranchInternalPanel snapshot={snapshot} />}
      </TabsContent>
    </Tabs>
  );
}

// ─── LO Risk Panel (top performers + bottom performers from snapshot LOs) ────

function LoanOfficerPanel({ snapshot }: { snapshot: Snapshot }) {
  const los = snapshot.loan_officer_performance ?? [];
  const sized = los.filter(l => (l.funded_count ?? 0) >= 5);

  const worst = useMemo(
    () => [...sized].sort((a, b) => (b.delinquency_pct ?? 0) - (a.delinquency_pct ?? 0)).slice(0, 25),
    [sized],
  );

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Loan Officer Risk Panel</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Top 25 LOs by DQ rate ({sized.length} LOs with ≥5 funded loans).
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">LO</th>
                <th className="text-left px-3 py-2 font-medium">NMLS</th>
                <th className="text-right px-3 py-2 font-medium">Funded</th>
                <th className="text-right px-3 py-2 font-medium">DQ</th>
                <th className="text-right px-3 py-2 font-medium">DQ %</th>
                <th className="text-right px-3 py-2 font-medium">vs Baseline</th>
              </tr>
            </thead>
            <tbody>
              {worst.map(l => (
                <tr key={l.lo_nmls_id} className="border-t border-border">
                  <td className="px-3 py-2">{l.lo_name ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{l.lo_nmls_id}</td>
                  <td className="px-3 py-2 text-right">{l.funded_count}</td>
                  <td className="px-3 py-2 text-right">{l.delinquent_count}</td>
                  <td className="px-3 py-2 text-right">
                    {l.delinquency_pct != null ? `${l.delinquency_pct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {l.baseline_comparison != null ? (
                      <span className={l.baseline_comparison > 0 ? 'text-risk-red' : 'text-risk-green'}>
                        {l.baseline_comparison > 0 ? '+' : ''}{l.baseline_comparison.toFixed(2)} pp
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Underwriter Panel ───────────────────────────────────────────────────────

function UnderwriterPanel({ snapshot, data }: { snapshot: Snapshot; data: DashboardData }) {
  const rows = data.underwriterRollup ?? snapshot.underwriter_rollup ?? [];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Underwriter Performance ({rows.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          From HUD Neighborhood Watch (NW Data 2). Limited to underwriters with at least one
          SDQ-reported loan. Compare ratio is relative to the firm-wide SDQ rate.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Underwriter</th>
                <th className="text-left px-3 py-2 font-medium">UW ID</th>
                <th className="text-right px-3 py-2 font-medium">Loans</th>
                <th className="text-right px-3 py-2 font-medium">SDQ</th>
                <th className="text-right px-3 py-2 font-medium">SDQ %</th>
                <th className="text-right px-3 py-2 font-medium">Compare Ratio</th>
                <th className="text-left px-3 py-2 font-medium">Credit Rating Mix</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.underwriter_name}-${r.underwriter_id}`} className="border-t border-border">
                  <td className="px-3 py-2">{r.underwriter_name}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.underwriter_id || '—'}</td>
                  <td className="px-3 py-2 text-right">{r.loan_count}</td>
                  <td className="px-3 py-2 text-right">{r.sdq_count}</td>
                  <td className="px-3 py-2 text-right">
                    {r.sdq_pct != null ? `${r.sdq_pct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={badgeClass(r.compare_ratio)}>
                      {r.compare_ratio != null ? `${Math.round(r.compare_ratio)}%` : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    {r.mortgage_credit_rating_breakdown
                      .map(b => `${b.rating}: ${b.count}`)
                      .join(' · ') || '—'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground italic">
                    No underwriter data in this snapshot.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── TPO / Sponsor Panel ─────────────────────────────────────────────────────

function TPOPanel({ snapshot, data }: { snapshot: Snapshot; data: DashboardData }) {
  const rows = data.sponsorTPODetail ?? snapshot.sponsor_tpo_detail ?? [];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <Handshake className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Sponsored Originator (TPO) Detail ({rows.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Per-TPO SDQ counts from NW Data 2 sponsor columns. Sorted by loan count.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Sponsored Originator</th>
                <th className="text-left px-3 py-2 font-medium">NMLS</th>
                <th className="text-left px-3 py-2 font-medium">EIN ★4</th>
                <th className="text-right px-3 py-2 font-medium">Loans</th>
                <th className="text-right px-3 py-2 font-medium">SDQ</th>
                <th className="text-right px-3 py-2 font-medium">SDQ %</th>
                <th className="text-right px-3 py-2 font-medium">Compare Ratio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.sponsor_originator_name}-${r.sponsor_originator_nmls_id}`} className="border-t border-border">
                  <td className="px-3 py-2">{r.sponsor_originator_name}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.sponsor_originator_nmls_id ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.sponsor_originator_ein_last4 ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{r.loan_count}</td>
                  <td className="px-3 py-2 text-right">{r.sdq_count}</td>
                  <td className="px-3 py-2 text-right">
                    {r.sdq_pct != null ? `${r.sdq_pct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={badgeClass(r.compare_ratio)}>
                      {r.compare_ratio != null ? `${Math.round(r.compare_ratio)}%` : '—'}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground italic">
                    No TPO data in this snapshot.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Branch Internal (AFN-internal analytics from the loan list) ─────────────

function BranchInternalPanel({ snapshot }: { snapshot: Snapshot }) {
  // Aggregate AFN-internal branch performance from the loan list.
  // Branch is approximated by `branch_nmls_id`.
  const rows = useMemo(() => {
    const by = new Map<string, { name: string; total: number; dlq: number }>();
    for (const l of snapshot.loans) {
      const key = l.branch_nmls_id || 'Unassigned';
      const cur = by.get(key) ?? { name: key, total: 0, dlq: 0 };
      cur.total += 1;
      if (l.is_delinquent) cur.dlq += 1;
      by.set(key, cur);
    }
    return Array.from(by.values())
      .filter(b => b.total >= 5)
      .map(b => ({
        ...b,
        dqPct: b.total > 0 ? (b.dlq / b.total) * 100 : 0,
      }))
      .sort((a, b) => b.dqPct - a.dqPct);
  }, [snapshot]);

  const baseline = useMemo(() => {
    const total = snapshot.loans.length;
    const dlq = snapshot.loans.filter(l => l.is_delinquent).length;
    return total > 0 ? (dlq / total) * 100 : 0;
  }, [snapshot]);

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <Building className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Branch Internal DQ Analytics</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          AFN-internal DQ rate by branch (NMLS ID), computed from the full loan list.
          Firm baseline DQ rate: <span className="font-medium">{baseline.toFixed(2)}%</span>.
          Branches with ≥5 loans shown ({rows.length}).
        </p>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Branch NMLS</th>
                <th className="text-right px-3 py-2 font-medium">Loans</th>
                <th className="text-right px-3 py-2 font-medium">DQ</th>
                <th className="text-right px-3 py-2 font-medium">DQ %</th>
                <th className="text-right px-3 py-2 font-medium">vs Baseline</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(b => (
                <tr key={b.name} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-[11px]">{b.name}</td>
                  <td className="px-3 py-2 text-right">{b.total}</td>
                  <td className="px-3 py-2 text-right">{b.dlq}</td>
                  <td className="px-3 py-2 text-right">{b.dqPct.toFixed(2)}%</td>
                  <td className="px-3 py-2 text-right">
                    {(() => {
                      const diff = b.dqPct - baseline;
                      return (
                        <span className={diff > 0 ? 'text-risk-red' : 'text-risk-green'}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(2)} pp
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
