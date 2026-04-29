import { useMemo, useState } from 'react';
import { Users, GraduationCap, Handshake, Building, ChevronUp, ChevronDown } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Snapshot, Loan } from '@/types/snapshot';
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
  { id: 'tpo', label: 'TPO / Broker', icon: Handshake },
  { id: 'branch', label: 'Branches (AFN)', icon: Building },
];

// ─── Shared helpers ──────────────────────────────────────────────────────────

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 10000) / 100 : null;
}

function fmt(v: number | null | undefined, suffix = '%'): string {
  if (v == null) return '—';
  return `${v.toFixed(2)}${suffix}`;
}

function avg(nums: (number | null | undefined)[]): number | null {
  const valid = nums.filter((n): n is number => n != null && n !== 0);
  return valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
}

type SortDir = 'asc' | 'desc';

function useSortable<T>(data: T[], defaultKey: keyof T, defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? (av as string).localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const toggle = (key: keyof T) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ col }: { col: keyof T }) => {
    if (col !== sortKey) return null;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />;
  };

  return { sorted, toggle, sortKey, sortDir, SortIcon };
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KPI({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="bg-muted/30 rounded-lg px-4 py-3 border border-border">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value ?? '—'}</div>
    </div>
  );
}

// ─── Risk row coloring ───────────────────────────────────────────────────────

function riskRowClass(dqPct: number | null, avgDq: number): string {
  if (dqPct == null) return '';
  if (dqPct > avgDq * 2) return 'bg-red-500/10';
  if (dqPct > avgDq * 1.5) return 'bg-yellow-500/10';
  if (dqPct < avgDq) return 'bg-green-500/5';
  return '';
}

// ═════════════════════════════════════════════════════════════════════════════
// ROOT
// ═════════════════════════════════════════════════════════════════════════════

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
        {subTab === 'lo' && <LoanOfficerPanel loans={snapshot.loans} />}
      </TabsContent>
      <TabsContent value="uw">
        {subTab === 'uw' && <UnderwriterPanel loans={snapshot.loans} />}
      </TabsContent>
      <TabsContent value="tpo">
        {subTab === 'tpo' && <TPOPanel loans={snapshot.loans} />}
      </TabsContent>
      <TabsContent value="branch">
        {subTab === 'branch' && <BranchPanel loans={snapshot.loans} />}
      </TabsContent>
    </Tabs>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// LOAN OFFICERS (Enc Data only)
// ═════════════════════════════════════════════════════════════════════════════

interface LORow {
  lo_name: string;
  lo_employee_id: string;
  branch_name: string;
  loan_count: number;
  dq_count: number;
  dq_pct: number | null;
  avg_fico: number | null;
  avg_ltv: number | null;
  dpa_pct: number | null;
}

function LoanOfficerPanel({ loans }: { loans: Loan[] }) {
  const { rows, totalLOs, avgLoansPerLO, highestDqLO, avgFico } = useMemo(() => {
    // Filter out LO Employee ID = 0 (wholesale loans, no LO assigned)
    const eligible = loans.filter(l => l.lo_nmls_id && l.lo_nmls_id !== '0' && l.lo_nmls_id !== '0.0');

    const byLO = new Map<string, Loan[]>();
    for (const l of eligible) {
      const key = l.lo_nmls_id!;
      const arr = byLO.get(key) ?? [];
      arr.push(l);
      byLO.set(key, arr);
    }

    const rows: LORow[] = [];
    for (const [id, group] of byLO) {
      const dqCount = group.filter(l => l.is_delinquent).length;
      const dpaCount = group.filter(l => l.has_dpa).length;
      rows.push({
        lo_name: group[0].loan_officer ?? '—',
        lo_employee_id: id,
        branch_name: group[0].branch_name_retail ?? group[0].branch_name ?? '—',
        loan_count: group.length,
        dq_count: dqCount,
        dq_pct: pct(dqCount, group.length),
        avg_fico: avg(group.map(l => l.fico_score)),
        avg_ltv: avg(group.map(l => l.ltv)),
        dpa_pct: pct(dpaCount, group.length),
      });
    }

    const totalLOs = rows.length;
    const avgLoansPerLO = totalLOs > 0 ? Math.round(eligible.length / totalLOs * 10) / 10 : 0;
    const highestDqLO = rows.reduce<LORow | null>((best, r) =>
      (r.loan_count >= 3 && (best == null || (r.dq_pct ?? 0) > (best.dq_pct ?? 0))) ? r : best, null);
    const avgFico = avg(eligible.map(l => l.fico_score));

    return { rows, totalLOs, avgLoansPerLO, highestDqLO, avgFico };
  }, [loans]);

  const { sorted, toggle, SortIcon } = useSortable(rows, 'dq_pct', 'desc');

  const th = (label: string, key: keyof LORow, align = 'text-right') => (
    <th className={`${align} px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground`} onClick={() => toggle(key)}>
      {label} <SortIcon col={key} />
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total LOs" value={totalLOs} />
        <KPI label="Avg Loans / LO" value={avgLoansPerLO} />
        <KPI label="Highest DQ LO" value={highestDqLO ? `${highestDqLO.lo_name} (${fmt(highestDqLO.dq_pct)})` : '—'} />
        <KPI label="Avg FICO (Portfolio)" value={avgFico} />
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Loan Officers — Enc Data ({rows.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          All retail LOs (Employee ID ≠ 0). Click headers to sort.
        </p>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0">
              <tr>
                {th('LO Name', 'lo_name', 'text-left')}
                {th('Employee ID', 'lo_employee_id', 'text-left')}
                {th('Branch', 'branch_name', 'text-left')}
                {th('Loans', 'loan_count')}
                {th('DQ', 'dq_count')}
                {th('DQ %', 'dq_pct')}
                {th('Avg FICO', 'avg_fico')}
                {th('Avg LTV', 'avg_ltv')}
                {th('DPA %', 'dpa_pct')}
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.lo_employee_id} className="border-t border-border">
                  <td className="px-3 py-2">{r.lo_name}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.lo_employee_id}</td>
                  <td className="px-3 py-2 max-w-[180px] truncate">{r.branch_name}</td>
                  <td className="px-3 py-2 text-right">{r.loan_count}</td>
                  <td className="px-3 py-2 text-right">{r.dq_count}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.dq_pct)}</td>
                  <td className="px-3 py-2 text-right">{r.avg_fico ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{r.avg_ltv != null ? r.avg_ltv.toFixed(1) : '—'}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.dpa_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// UNDERWRITERS (Enc Data col 67 — covers ALL loans)
// ═════════════════════════════════════════════════════════════════════════════

interface UWRow {
  underwriter: string;
  loan_count: number;
  dq_count: number;
  dq_pct: number | null;
  avg_fico: number | null;
  avg_ltv: number | null;
  uw_type_breakdown: string;
}

function UnderwriterPanel({ loans }: { loans: Loan[] }) {
  const { rows, totalUWs, avgLoansPerUW, highestDqUW } = useMemo(() => {
    const byUW = new Map<string, Loan[]>();
    for (const l of loans) {
      const uw = l.underwriter;
      if (!uw) continue;
      const arr = byUW.get(uw) ?? [];
      arr.push(l);
      byUW.set(uw, arr);
    }

    const rows: UWRow[] = [];
    for (const [name, group] of byUW) {
      const dqCount = group.filter(l => l.is_delinquent).length;
      // Underwriting type breakdown
      const typeCounts = new Map<string, number>();
      for (const l of group) {
        const t = l.underwriting_type ?? l.aus ?? 'Unknown';
        typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
      }
      const breakdown = [...typeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `${t}: ${c}`)
        .join(' · ');

      rows.push({
        underwriter: name,
        loan_count: group.length,
        dq_count: dqCount,
        dq_pct: pct(dqCount, group.length),
        avg_fico: avg(group.map(l => l.fico_score)),
        avg_ltv: avg(group.map(l => l.ltv)),
        uw_type_breakdown: breakdown,
      });
    }

    const totalUWs = rows.length;
    const totalLoansWithUW = rows.reduce((s, r) => s + r.loan_count, 0);
    const avgLoansPerUW = totalUWs > 0 ? Math.round(totalLoansWithUW / totalUWs * 10) / 10 : 0;
    const highestDqUW = rows.reduce<UWRow | null>((best, r) =>
      (r.loan_count >= 3 && (best == null || (r.dq_pct ?? 0) > (best.dq_pct ?? 0))) ? r : best, null);

    return { rows, totalUWs, avgLoansPerUW, highestDqUW };
  }, [loans]);

  const { sorted, toggle, SortIcon } = useSortable(rows, 'dq_pct', 'desc');

  const th = (label: string, key: keyof UWRow, align = 'text-right') => (
    <th className={`${align} px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground`} onClick={() => toggle(key)}>
      {label} <SortIcon col={key} />
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPI label="Total Underwriters" value={totalUWs} />
        <KPI label="Avg Loans / UW" value={avgLoansPerUW} />
        <KPI label="Highest DQ UW" value={highestDqUW ? `${highestDqUW.underwriter} (${fmt(highestDqUW.dq_pct)})` : '—'} />
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Underwriters — Enc Data ({rows.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          All loans with an underwriter (Enc Data col 67). Covers the full portfolio, not just SDQ.
        </p>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0">
              <tr>
                {th('Underwriter', 'underwriter', 'text-left')}
                {th('Loans', 'loan_count')}
                {th('DQ', 'dq_count')}
                {th('DQ %', 'dq_pct')}
                {th('Avg FICO', 'avg_fico')}
                {th('Avg LTV', 'avg_ltv')}
                <th className="text-left px-3 py-2 font-medium">UW Type Breakdown</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.underwriter} className="border-t border-border">
                  <td className="px-3 py-2">{r.underwriter}</td>
                  <td className="px-3 py-2 text-right">{r.loan_count}</td>
                  <td className="px-3 py-2 text-right">{r.dq_count}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.dq_pct)}</td>
                  <td className="px-3 py-2 text-right">{r.avg_fico ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{r.avg_ltv != null ? r.avg_ltv.toFixed(1) : '—'}</td>
                  <td className="px-3 py-2 text-[11px] max-w-[250px] truncate">{r.uw_type_breakdown || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground italic">No underwriter data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TPO / BROKER (Enc Data only — col 62 Broker, col 63 AE Name)
// ═════════════════════════════════════════════════════════════════════════════

interface TPORow {
  broker: string;
  loan_count: number;
  dq_count: number;
  dq_pct: number | null;
  avg_fico: number | null;
  avg_ltv: number | null;
  dpa_pct: number | null;
  states: string;
  ae_names: string;
}

function TPOPanel({ loans }: { loans: Loan[] }) {
  const { rows, totalBrokers, totalWholesale, wholesaleDqRate } = useMemo(() => {
    // Wholesale loans = those with a Broker field populated (Enc Data col 62)
    const wholesale = loans.filter(l => l.broker);
    const totalWholesale = wholesale.length;
    const wholesaleDq = wholesale.filter(l => l.is_delinquent).length;
    const wholesaleDqRate = pct(wholesaleDq, totalWholesale);

    const byBroker = new Map<string, Loan[]>();
    for (const l of wholesale) {
      const key = l.broker!;
      const arr = byBroker.get(key) ?? [];
      arr.push(l);
      byBroker.set(key, arr);
    }

    const rows: TPORow[] = [];
    for (const [name, group] of byBroker) {
      const dqCount = group.filter(l => l.is_delinquent).length;
      const dpaCount = group.filter(l => l.has_dpa).length;
      const stateSet = new Set(group.map(l => l.property_state).filter(Boolean));
      const aeSet = new Set(group.map(l => l.ae_name).filter(Boolean));

      rows.push({
        broker: name,
        loan_count: group.length,
        dq_count: dqCount,
        dq_pct: pct(dqCount, group.length),
        avg_fico: avg(group.map(l => l.fico_score)),
        avg_ltv: avg(group.map(l => l.ltv)),
        dpa_pct: pct(dpaCount, group.length),
        states: [...stateSet].sort().join(', '),
        ae_names: [...aeSet].sort().slice(0, 3).join(', ') + (aeSet.size > 3 ? ` +${aeSet.size - 3}` : ''),
      });
    }

    return { rows, totalBrokers: rows.length, totalWholesale, wholesaleDqRate };
  }, [loans]);

  const { sorted, toggle, SortIcon } = useSortable(rows, 'dq_pct', 'desc');

  const th = (label: string, key: keyof TPORow, align = 'text-right') => (
    <th className={`${align} px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground`} onClick={() => toggle(key)}>
      {label} <SortIcon col={key} />
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPI label="Total Brokers" value={totalBrokers} />
        <KPI label="Total Wholesale Loans" value={totalWholesale.toLocaleString()} />
        <KPI label="Wholesale DQ Rate" value={fmt(wholesaleDqRate)} />
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <Handshake className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">TPO / Broker — Enc Data ({rows.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Wholesale brokers from Enc Data (col 62). Covers all wholesale loans, not just SDQ.
        </p>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0">
              <tr>
                {th('Broker', 'broker', 'text-left')}
                {th('Loans', 'loan_count')}
                {th('DQ', 'dq_count')}
                {th('DQ %', 'dq_pct')}
                {th('Avg FICO', 'avg_fico')}
                {th('Avg LTV', 'avg_ltv')}
                {th('DPA %', 'dpa_pct')}
                <th className="text-left px-3 py-2 font-medium">States</th>
                <th className="text-left px-3 py-2 font-medium">AE Name(s)</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.broker} className="border-t border-border">
                  <td className="px-3 py-2 max-w-[200px] truncate">{r.broker}</td>
                  <td className="px-3 py-2 text-right">{r.loan_count}</td>
                  <td className="px-3 py-2 text-right">{r.dq_count}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.dq_pct)}</td>
                  <td className="px-3 py-2 text-right">{r.avg_fico ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{r.avg_ltv != null ? r.avg_ltv.toFixed(1) : '—'}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.dpa_pct)}</td>
                  <td className="px-3 py-2 text-[11px] max-w-[120px] truncate">{r.states || '—'}</td>
                  <td className="px-3 py-2 text-[11px] max-w-[180px] truncate">{r.ae_names || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground italic">No broker data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// BRANCHES (AFN) — Enc Data col 11 Branch Name + col 10 Org ID
// ═════════════════════════════════════════════════════════════════════════════

interface BranchRow {
  branch_name: string;
  org_id: string;
  loan_count: number;
  dq_count: number;
  dq_pct: number | null;
  avg_fico: number | null;
  avg_ltv: number | null;
  dpa_pct: number | null;
  channel_mix: string;
  top_los: string;
}

function BranchPanel({ loans }: { loans: Loan[] }) {
  const { rows, totalBranches, highestRiskBranch, avgDqRate } = useMemo(() => {
    const byBranch = new Map<string, { name: string; orgId: string; loans: Loan[] }>();
    for (const l of loans) {
      const key = l.branch_nmls_id ?? l.branch_name ?? 'Unassigned';
      const cur = byBranch.get(key) ?? { name: l.branch_name ?? key, orgId: l.branch_nmls_id ?? '—', loans: [] };
      cur.loans.push(l);
      byBranch.set(key, cur);
    }

    const totalDq = loans.filter(l => l.is_delinquent).length;
    const avgDqRate = pct(totalDq, loans.length);

    const rows: BranchRow[] = [];
    for (const [, { name, orgId, loans: group }] of byBranch) {
      const dqCount = group.filter(l => l.is_delinquent).length;
      const dpaCount = group.filter(l => l.has_dpa).length;
      const retail = group.filter(l => l.channel === 'Retail').length;
      const wholesale = group.filter(l => l.channel === 'Wholesale').length;
      const channelMix = [
        retail > 0 ? `R:${retail}` : null,
        wholesale > 0 ? `W:${wholesale}` : null,
      ].filter(Boolean).join(' / ') || '—';

      // Top LOs by loan count
      const loMap = new Map<string, { name: string; count: number }>();
      for (const l of group) {
        if (!l.lo_nmls_id || l.lo_nmls_id === '0' || l.lo_nmls_id === '0.0') continue;
        const cur = loMap.get(l.lo_nmls_id) ?? { name: l.loan_officer ?? l.lo_nmls_id, count: 0 };
        cur.count++;
        loMap.set(l.lo_nmls_id, cur);
      }
      const topLOs = [...loMap.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(lo => `${lo.name} (${lo.count})`)
        .join(', ');

      rows.push({
        branch_name: name,
        org_id: orgId,
        loan_count: group.length,
        dq_count: dqCount,
        dq_pct: pct(dqCount, group.length),
        avg_fico: avg(group.map(l => l.fico_score)),
        avg_ltv: avg(group.map(l => l.ltv)),
        dpa_pct: pct(dpaCount, group.length),
        channel_mix: channelMix,
        top_los: topLOs || '—',
      });
    }

    const highestRiskBranch = rows.reduce<BranchRow | null>((best, r) =>
      (r.loan_count >= 5 && (best == null || (r.dq_pct ?? 0) > (best.dq_pct ?? 0))) ? r : best, null);

    return { rows, totalBranches: rows.length, highestRiskBranch, avgDqRate };
  }, [loans]);

  const { sorted, toggle, SortIcon } = useSortable(rows, 'dq_pct', 'desc');

  const th = (label: string, key: keyof BranchRow, align = 'text-right') => (
    <th className={`${align} px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground`} onClick={() => toggle(key)}>
      {label} <SortIcon col={key} />
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPI label="Total Branches" value={totalBranches} />
        <KPI label="Highest Risk Branch" value={highestRiskBranch ? `${highestRiskBranch.branch_name} (${fmt(highestRiskBranch.dq_pct)})` : '—'} />
        <KPI label="Avg DQ Rate" value={fmt(avgDqRate)} />
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <Building className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Branches — Enc Data ({rows.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          All branches by Org ID (col 10) / Branch Name (col 11). Color-coded: 🔴 &gt;2× avg DQ, 🟡 &gt;1.5×, 🟢 below avg.
        </p>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0">
              <tr>
                {th('Branch Name', 'branch_name', 'text-left')}
                {th('Org ID', 'org_id', 'text-left')}
                {th('Loans', 'loan_count')}
                {th('DQ', 'dq_count')}
                {th('DQ %', 'dq_pct')}
                {th('Avg FICO', 'avg_fico')}
                {th('Avg LTV', 'avg_ltv')}
                {th('DPA %', 'dpa_pct')}
                <th className="text-left px-3 py-2 font-medium">Channel Mix</th>
                <th className="text-left px-3 py-2 font-medium">Top LOs</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={`${r.org_id}-${r.branch_name}`} className={`border-t border-border ${riskRowClass(r.dq_pct, avgDqRate ?? 0)}`}>
                  <td className="px-3 py-2 max-w-[200px] truncate">{r.branch_name}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.org_id}</td>
                  <td className="px-3 py-2 text-right">{r.loan_count}</td>
                  <td className="px-3 py-2 text-right">{r.dq_count}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.dq_pct)}</td>
                  <td className="px-3 py-2 text-right">{r.avg_fico ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{r.avg_ltv != null ? r.avg_ltv.toFixed(1) : '—'}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.dpa_pct)}</td>
                  <td className="px-3 py-2 text-[11px]">{r.channel_mix}</td>
                  <td className="px-3 py-2 text-[11px] max-w-[220px] truncate">{r.top_los}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
