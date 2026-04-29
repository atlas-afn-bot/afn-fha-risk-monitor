import { useMemo, useState, useCallback } from 'react';
import { Users, GraduationCap, Handshake, Building, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
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
  { id: 'tpo', label: 'TPO / Sponsor', icon: Handshake },
  { id: 'branch', label: 'Branches (AFN)', icon: Building },
];

// ─── Shared utilities ────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return n.toFixed(decimals);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(2)}%`;
}

function fmtInt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

function riskRowClass(dqPct: number, baseline: number): string {
  if (dqPct > baseline * 2) return 'bg-red-500/8';
  if (dqPct > baseline * 1.5) return 'bg-yellow-500/8';
  return '';
}

function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function mode(arr: string[]): string | null {
  if (arr.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = arr[0], bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) { best = k; bestCount = c; }
  }
  return best;
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-muted/30 rounded-lg border border-border px-4 py-3 min-w-[140px]">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Sortable Table Hook ─────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

function useSortableTable<T>(data: T[], defaultKey: keyof T & string, defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState<keyof T & string>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggle = useCallback((key: keyof T & string) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggle };
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30 inline" />;
  return dir === 'asc'
    ? <ArrowUp className="w-3 h-3 ml-1 inline text-foreground" />
    : <ArrowDown className="w-3 h-3 ml-1 inline text-foreground" />;
}

function SortableHead<T>({
  label,
  field,
  sortKey,
  sortDir,
  toggle,
  className = '',
}: {
  label: string;
  field: keyof T & string;
  sortKey: string;
  sortDir: SortDir;
  toggle: (k: keyof T & string) => void;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground whitespace-nowrap ${className}`}
      onClick={() => toggle(field)}
    >
      {label}
      <SortIcon active={sortKey === field} dir={sortDir} />
    </th>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

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

// ─── LO Panel ────────────────────────────────────────────────────────────────

interface LORow {
  lo_name: string;
  lo_nmls_id: string;
  funded_count: number;
  delinquent_count: number;
  dq_pct: number;
  avg_fico: number | null;
  avg_ltv: number | null;
  dpa_pct: number | null;
  channel: string;
  branch_name: string;
  baseline_comparison: number | null;
}

function LoanOfficerPanel({ snapshot }: { snapshot: Snapshot }) {
  const { rows, totalLOs, avgLoansPerLO, avgFICO, worstLO } = useMemo(() => {
    // Group loans by lo_nmls_id, skip employee ID "0"
    const byLO = new Map<string, Loan[]>();
    for (const l of snapshot.loans) {
      const id = l.lo_nmls_id;
      if (!id || id === '0') continue;
      const arr = byLO.get(id) ?? [];
      arr.push(l);
      byLO.set(id, arr);
    }

    const totalDlq = snapshot.loans.filter(l => l.is_delinquent).length;
    const baseline = snapshot.loans.length > 0 ? (totalDlq / snapshot.loans.length) * 100 : 0;

    const allRows: LORow[] = [];
    for (const [id, loans] of byLO) {
      const funded = loans.length;
      const dlq = loans.filter(l => l.is_delinquent).length;
      const dqPct = funded > 0 ? (dlq / funded) * 100 : 0;
      const ficos = loans.map(l => l.fico_score).filter((f): f is number => f != null && f > 0);
      const ltvs = loans.map(l => l.ltv).filter((v): v is number => v != null);
      const dpaCount = loans.filter(l => l.has_dpa).length;
      const channels = loans.map(l => l.channel).filter((c): c is string => c != null);
      const branches = loans.map(l => l.branch_name).filter((b): b is string => b != null && b !== '');

      allRows.push({
        lo_name: loans[0].loan_officer ?? '—',
        lo_nmls_id: id,
        funded_count: funded,
        delinquent_count: dlq,
        dq_pct: dqPct,
        avg_fico: avg(ficos),
        avg_ltv: avg(ltvs),
        dpa_pct: funded > 0 ? (dpaCount / funded) * 100 : null,
        channel: mode(channels) ?? '—',
        branch_name: mode(branches) ?? '—',
        baseline_comparison: dqPct - baseline,
      });
    }

    // Filter to min 5 loans, sort by DQ rate desc, top 25
    const qualified = allRows.filter(r => r.funded_count >= 5);
    qualified.sort((a, b) => b.dq_pct - a.dq_pct);
    const top25 = qualified.slice(0, 25);

    const allFicos = snapshot.loans.map(l => l.fico_score).filter((f): f is number => f != null && f > 0);

    return {
      rows: top25,
      totalLOs: byLO.size,
      avgLoansPerLO: byLO.size > 0 ? (snapshot.loans.length / byLO.size) : 0,
      avgFICO: avg(allFicos),
      worstLO: qualified[0] ?? null,
    };
  }, [snapshot]);

  const { sorted, sortKey, sortDir, toggle } = useSortableTable(rows, 'dq_pct');

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="flex flex-wrap gap-3">
        <KPICard label="Total LOs" value={fmtInt(totalLOs)} />
        <KPICard label="Avg Loans / LO" value={fmt(avgLoansPerLO, 1)} />
        <KPICard label="Highest DQ Rate" value={worstLO ? fmtPct(worstLO.dq_pct) : '—'} sub={worstLO?.lo_name ?? undefined} />
        <KPICard label="Avg FICO (All)" value={avgFICO != null ? fmt(avgFICO, 0) : '—'} />
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Top 25 Highest-Risk Loan Officers</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          LOs with ≥5 funded loans, ranked by delinquency rate. Computed from loan-level data.
        </p>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
              <tr>
                <SortableHead<LORow> label="LO Name" field="lo_name" {...{ sortKey, sortDir, toggle }} className="text-left" />
                <SortableHead<LORow> label="Employee ID" field="lo_nmls_id" {...{ sortKey, sortDir, toggle }} className="text-left" />
                <SortableHead<LORow> label="Funded" field="funded_count" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<LORow> label="DQ" field="delinquent_count" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<LORow> label="DQ %" field="dq_pct" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<LORow> label="Avg FICO" field="avg_fico" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<LORow> label="Avg LTV" field="avg_ltv" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<LORow> label="DPA %" field="dpa_pct" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <th className="text-left px-3 py-2 font-medium">Channel</th>
                <SortableHead<LORow> label="Branch" field="branch_name" {...{ sortKey, sortDir, toggle }} className="text-left" />
                <SortableHead<LORow> label="vs Baseline" field="baseline_comparison" {...{ sortKey, sortDir, toggle }} className="text-right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.lo_nmls_id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{r.lo_name}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.lo_nmls_id}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.funded_count)}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.delinquent_count)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtPct(r.dq_pct)}</td>
                  <td className="px-3 py-2 text-right">{r.avg_fico != null ? fmt(r.avg_fico, 0) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.avg_ltv != null ? fmtPct(r.avg_ltv) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.dpa_pct != null ? fmtPct(r.dpa_pct) : '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded ${r.channel === 'Retail' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
                      {r.channel}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-[180px] truncate" title={r.branch_name}>{r.branch_name}</td>
                  <td className="px-3 py-2 text-right">
                    {r.baseline_comparison != null ? (
                      <span className={r.baseline_comparison > 0 ? 'text-risk-red' : 'text-risk-green'}>
                        {r.baseline_comparison > 0 ? '+' : ''}{fmt(r.baseline_comparison)} pp
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground italic">No LOs with ≥5 funded loans.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Underwriter Panel ───────────────────────────────────────────────────────

function UnderwriterPanel({ snapshot, data }: { snapshot: Snapshot; data: DashboardData }) {
  const rows = useMemo(() => data.underwriterRollup ?? snapshot.underwriter_rollup ?? [], [data, snapshot]);

  const { totalUWs, avgLoansPerUW, worstUW } = useMemo(() => {
    const total = rows.length;
    const avgLoans = total > 0 ? rows.reduce((s, r) => s + r.loan_count, 0) / total : 0;
    const worst = [...rows].sort((a, b) => (b.sdq_pct ?? 0) - (a.sdq_pct ?? 0))[0] ?? null;
    return { totalUWs: total, avgLoansPerUW: avgLoans, worstUW: worst };
  }, [rows]);

  const { sorted, sortKey, sortDir, toggle } = useSortableTable(rows, 'sdq_pct');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <KPICard label="Total Underwriters" value={fmtInt(totalUWs)} />
        <KPICard label="Avg Loans / UW" value={fmt(avgLoansPerUW, 1)} />
        <KPICard label="Highest SDQ Rate" value={worstUW ? fmtPct(worstUW.sdq_pct) : '—'} sub={worstUW?.underwriter_name ?? undefined} />
      </div>

      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Underwriter Performance ({rows.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          From HUD Neighborhood Watch (NW Data). SDQ-reported underwriters only. Compare ratio is relative to firm-wide SDQ rate.
        </p>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
              <tr>
                <SortableHead label="Underwriter" field="underwriter_name" {...{ sortKey, sortDir, toggle }} className="text-left" />
                <SortableHead label="UW ID" field="underwriter_id" {...{ sortKey, sortDir, toggle }} className="text-left" />
                <SortableHead label="Loans" field="loan_count" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead label="SDQ" field="sdq_count" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead label="SDQ %" field="sdq_pct" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead label="Compare Ratio" field="compare_ratio" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <th className="text-left px-3 py-2 font-medium">Credit Rating Mix</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={`${r.underwriter_name}-${r.underwriter_id}`} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{r.underwriter_name}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.underwriter_id || '—'}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.loan_count)}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.sdq_count)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.sdq_pct)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      r.compare_ratio == null ? 'bg-blue-500/10 text-blue-400' :
                      r.compare_ratio > 200 ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30' :
                      r.compare_ratio >= 150 ? 'bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/30' :
                      'bg-green-500/15 text-green-400 ring-1 ring-green-500/30'
                    }`}>
                      {r.compare_ratio != null ? `${Math.round(r.compare_ratio)}%` : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    {r.mortgage_credit_rating_breakdown.length > 0
                      ? r.mortgage_credit_rating_breakdown.map(b => `${b.rating}: ${b.count}`).join(' · ')
                      : '—'}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground italic">No underwriter data in this snapshot.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── TPO / Sponsor Panel ─────────────────────────────────────────────────────

interface BrokerRow {
  broker: string;
  loan_count: number;
  dq_count: number;
  dq_pct: number;
  avg_fico: number | null;
  avg_ltv: number | null;
  dpa_pct: number | null;
}

function TPOPanel({ snapshot, data }: { snapshot: Snapshot; data: DashboardData }) {
  const sponsorRows = useMemo(() => data.sponsorTPODetail ?? snapshot.sponsor_tpo_detail ?? [], [data, snapshot]);

  const brokerRows = useMemo(() => {
    const byBroker = new Map<string, Loan[]>();
    for (const l of snapshot.loans) {
      const broker = l.broker;
      if (!broker) continue;
      const arr = byBroker.get(broker) ?? [];
      arr.push(l);
      byBroker.set(broker, arr);
    }

    const rows: BrokerRow[] = [];
    for (const [broker, loans] of byBroker) {
      const count = loans.length;
      const dlq = loans.filter(l => l.is_delinquent).length;
      const ficos = loans.map(l => l.fico_score).filter((f): f is number => f != null && f > 0);
      const ltvs = loans.map(l => l.ltv).filter((v): v is number => v != null);
      const dpaCount = loans.filter(l => l.has_dpa).length;
      rows.push({
        broker,
        loan_count: count,
        dq_count: dlq,
        dq_pct: count > 0 ? (dlq / count) * 100 : 0,
        avg_fico: avg(ficos),
        avg_ltv: avg(ltvs),
        dpa_pct: count > 0 ? (dpaCount / count) * 100 : null,
      });
    }
    return rows;
  }, [snapshot]);

  const { totalBrokers, totalSponsors, worstBroker } = useMemo(() => {
    const qualified = brokerRows.filter(r => r.loan_count >= 3);
    const worst = [...qualified].sort((a, b) => b.dq_pct - a.dq_pct)[0] ?? null;
    return {
      totalBrokers: brokerRows.length,
      totalSponsors: sponsorRows.length,
      worstBroker: worst,
    };
  }, [brokerRows, sponsorRows]);

  const brokerSort = useSortableTable(brokerRows, 'loan_count');
  const sponsorSort = useSortableTable(sponsorRows, 'loan_count');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <KPICard label="Wholesale Brokers" value={fmtInt(totalBrokers)} sub="From Enc Data" />
        <KPICard label="Sponsored Originators" value={fmtInt(totalSponsors)} sub="From NW Data" />
        <KPICard label="Highest-Risk Broker" value={worstBroker ? fmtPct(worstBroker.dq_pct) : '—'} sub={worstBroker?.broker ?? undefined} />
      </div>

      {/* Broker Performance (Enc Data) */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-1">
          <Handshake className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Broker Performance — Full Portfolio</h3>
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">Enc Data</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Wholesale broker companies aggregated from Encompass loan data ({brokerRows.length} brokers, {brokerRows.reduce((s, r) => s + r.loan_count, 0).toLocaleString()} loans).
        </p>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
              <tr>
                <SortableHead<BrokerRow> label="Broker" field="broker" sortKey={brokerSort.sortKey} sortDir={brokerSort.sortDir} toggle={brokerSort.toggle} className="text-left" />
                <SortableHead<BrokerRow> label="Loans" field="loan_count" sortKey={brokerSort.sortKey} sortDir={brokerSort.sortDir} toggle={brokerSort.toggle} className="text-right" />
                <SortableHead<BrokerRow> label="DQ" field="dq_count" sortKey={brokerSort.sortKey} sortDir={brokerSort.sortDir} toggle={brokerSort.toggle} className="text-right" />
                <SortableHead<BrokerRow> label="DQ %" field="dq_pct" sortKey={brokerSort.sortKey} sortDir={brokerSort.sortDir} toggle={brokerSort.toggle} className="text-right" />
                <SortableHead<BrokerRow> label="Avg FICO" field="avg_fico" sortKey={brokerSort.sortKey} sortDir={brokerSort.sortDir} toggle={brokerSort.toggle} className="text-right" />
                <SortableHead<BrokerRow> label="Avg LTV" field="avg_ltv" sortKey={brokerSort.sortKey} sortDir={brokerSort.sortDir} toggle={brokerSort.toggle} className="text-right" />
                <SortableHead<BrokerRow> label="DPA %" field="dpa_pct" sortKey={brokerSort.sortKey} sortDir={brokerSort.sortDir} toggle={brokerSort.toggle} className="text-right" />
              </tr>
            </thead>
            <tbody>
              {brokerSort.sorted.map(r => (
                <tr key={r.broker} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium max-w-[260px] truncate" title={r.broker}>{r.broker}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.loan_count)}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.dq_count)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtPct(r.dq_pct)}</td>
                  <td className="px-3 py-2 text-right">{r.avg_fico != null ? fmt(r.avg_fico, 0) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.avg_ltv != null ? fmtPct(r.avg_ltv) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.dpa_pct != null ? fmtPct(r.dpa_pct) : '—'}</td>
                </tr>
              ))}
              {brokerSort.sorted.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground italic">No broker data available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sponsored Originator Detail (NW Data) */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-1">
          <Handshake className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Sponsored Originator Detail</h3>
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded">NW Data</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Per-TPO SDQ counts from HUD Neighborhood Watch sponsor columns ({sponsorRows.length} originators). SDQ-reported population only.
        </p>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
              <tr>
                <SortableHead label="Sponsored Originator" field="sponsor_originator_name" sortKey={sponsorSort.sortKey} sortDir={sponsorSort.sortDir} toggle={sponsorSort.toggle} className="text-left" />
                <SortableHead label="NMLS" field="sponsor_originator_nmls_id" sortKey={sponsorSort.sortKey} sortDir={sponsorSort.sortDir} toggle={sponsorSort.toggle} className="text-left" />
                <SortableHead label="EIN ★4" field="sponsor_originator_ein_last4" sortKey={sponsorSort.sortKey} sortDir={sponsorSort.sortDir} toggle={sponsorSort.toggle} className="text-left" />
                <SortableHead label="Loans" field="loan_count" sortKey={sponsorSort.sortKey} sortDir={sponsorSort.sortDir} toggle={sponsorSort.toggle} className="text-right" />
                <SortableHead label="SDQ" field="sdq_count" sortKey={sponsorSort.sortKey} sortDir={sponsorSort.sortDir} toggle={sponsorSort.toggle} className="text-right" />
                <SortableHead label="SDQ %" field="sdq_pct" sortKey={sponsorSort.sortKey} sortDir={sponsorSort.sortDir} toggle={sponsorSort.toggle} className="text-right" />
                <SortableHead label="Compare Ratio" field="compare_ratio" sortKey={sponsorSort.sortKey} sortDir={sponsorSort.sortDir} toggle={sponsorSort.toggle} className="text-right" />
              </tr>
            </thead>
            <tbody>
              {sponsorSort.sorted.map(r => (
                <tr key={`${r.sponsor_originator_name}-${r.sponsor_originator_nmls_id}`} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium max-w-[220px] truncate" title={r.sponsor_originator_name}>{r.sponsor_originator_name}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.sponsor_originator_nmls_id ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.sponsor_originator_ein_last4 ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.loan_count)}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.sdq_count)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.sdq_pct)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      r.compare_ratio == null ? 'bg-blue-500/10 text-blue-400' :
                      r.compare_ratio > 200 ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30' :
                      r.compare_ratio >= 150 ? 'bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/30' :
                      'bg-green-500/15 text-green-400 ring-1 ring-green-500/30'
                    }`}>
                      {r.compare_ratio != null ? `${Math.round(r.compare_ratio)}%` : '—'}
                    </span>
                  </td>
                </tr>
              ))}
              {sponsorSort.sorted.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground italic">No TPO data in this snapshot.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Branch Panel ────────────────────────────────────────────────────────────

interface BranchRow {
  branch_name: string;
  org_id: string;
  loan_count: number;
  dq_count: number;
  dq_pct: number;
  avg_fico: number | null;
  avg_ltv: number | null;
  avg_dti: number | null;
  dpa_pct: number | null;
  retail_count: number;
  wholesale_count: number;
  baseline_diff: number;
}

function BranchInternalPanel({ snapshot }: { snapshot: Snapshot }) {
  const { rows, baseline, totalBranches, worstBranch, avgDQ } = useMemo(() => {
    const totalDlq = snapshot.loans.filter(l => l.is_delinquent).length;
    const bl = snapshot.loans.length > 0 ? (totalDlq / snapshot.loans.length) * 100 : 0;

    const byBranch = new Map<string, { orgId: string; loans: Loan[] }>();
    for (const l of snapshot.loans) {
      const name = l.branch_name;
      if (!name) continue;
      const existing = byBranch.get(name);
      if (existing) {
        existing.loans.push(l);
      } else {
        byBranch.set(name, { orgId: l.branch_nmls_id ?? '—', loans: [l] });
      }
    }

    const allRows: BranchRow[] = [];
    for (const [name, { orgId, loans }] of byBranch) {
      const count = loans.length;
      const dlq = loans.filter(l => l.is_delinquent).length;
      const dqPct = count > 0 ? (dlq / count) * 100 : 0;
      const ficos = loans.map(l => l.fico_score).filter((f): f is number => f != null && f > 0);
      const ltvs = loans.map(l => l.ltv).filter((v): v is number => v != null);
      const dtis = loans.map(l => l.back_dti).filter((v): v is number => v != null);
      const dpaCount = loans.filter(l => l.has_dpa).length;
      const retail = loans.filter(l => l.channel === 'Retail').length;
      const wholesale = loans.filter(l => l.channel === 'Wholesale').length;

      // Use the most common branch_nmls_id for this branch name
      const orgIds = loans.map(l => l.branch_nmls_id).filter((v): v is string => v != null);
      const bestOrgId = mode(orgIds) ?? orgId;

      allRows.push({
        branch_name: name,
        org_id: bestOrgId,
        loan_count: count,
        dq_count: dlq,
        dq_pct: dqPct,
        avg_fico: avg(ficos),
        avg_ltv: avg(ltvs),
        avg_dti: avg(dtis),
        dpa_pct: count > 0 ? (dpaCount / count) * 100 : null,
        retail_count: retail,
        wholesale_count: wholesale,
        baseline_diff: dqPct - bl,
      });
    }

    // Filter to branches with ≥5 loans
    const qualified = allRows.filter(r => r.loan_count >= 5);
    const worst = [...qualified].sort((a, b) => b.dq_pct - a.dq_pct)[0] ?? null;
    const avgDQRate = qualified.length > 0 ? qualified.reduce((s, r) => s + r.dq_pct, 0) / qualified.length : 0;

    return {
      rows: qualified,
      baseline: bl,
      totalBranches: qualified.length,
      worstBranch: worst,
      avgDQ: avgDQRate,
    };
  }, [snapshot]);

  const { sorted, sortKey, sortDir, toggle } = useSortableTable(rows, 'dq_pct');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <KPICard label="Total Branches" value={fmtInt(totalBranches)} sub="≥5 loans" />
        <KPICard label="Highest-Risk Branch" value={worstBranch ? fmtPct(worstBranch.dq_pct) : '—'} sub={worstBranch?.branch_name ?? undefined} />
        <KPICard label="Avg DQ Rate" value={fmtPct(avgDQ)} />
        <KPICard label="Firm Baseline" value={fmtPct(baseline)} />
      </div>

      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-1">
          <Building className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Branch Performance Analytics</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          DQ rates by branch name from Encompass data. Baseline: {fmtPct(baseline)}.
          <span className="ml-2 inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500/20 inline-block" /> &gt;2× baseline
            <span className="w-2.5 h-2.5 rounded-sm bg-yellow-500/20 inline-block ml-1" /> &gt;1.5× baseline
          </span>
        </p>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
              <tr>
                <SortableHead<BranchRow> label="Branch" field="branch_name" {...{ sortKey, sortDir, toggle }} className="text-left" />
                <SortableHead<BranchRow> label="Org ID" field="org_id" {...{ sortKey, sortDir, toggle }} className="text-left" />
                <SortableHead<BranchRow> label="Loans" field="loan_count" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<BranchRow> label="DQ" field="dq_count" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<BranchRow> label="DQ %" field="dq_pct" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<BranchRow> label="Avg FICO" field="avg_fico" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<BranchRow> label="Avg LTV" field="avg_ltv" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<BranchRow> label="Avg DTI" field="avg_dti" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<BranchRow> label="DPA %" field="dpa_pct" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<BranchRow> label="Retail" field="retail_count" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<BranchRow> label="Wholesale" field="wholesale_count" {...{ sortKey, sortDir, toggle }} className="text-right" />
                <SortableHead<BranchRow> label="vs Baseline" field="baseline_diff" {...{ sortKey, sortDir, toggle }} className="text-right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.branch_name} className={`border-t border-border hover:bg-muted/30 ${riskRowClass(r.dq_pct, baseline)}`}>
                  <td className="px-3 py-2 font-medium max-w-[200px] truncate" title={r.branch_name}>{r.branch_name}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.org_id}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.loan_count)}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.dq_count)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtPct(r.dq_pct)}</td>
                  <td className="px-3 py-2 text-right">{r.avg_fico != null ? fmt(r.avg_fico, 0) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.avg_ltv != null ? fmtPct(r.avg_ltv) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.avg_dti != null ? fmtPct(r.avg_dti) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.dpa_pct != null ? fmtPct(r.dpa_pct) : '—'}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.retail_count)}</td>
                  <td className="px-3 py-2 text-right">{fmtInt(r.wholesale_count)}</td>
                  <td className="px-3 py-2 text-right">
                    {(() => {
                      const diff = r.baseline_diff;
                      return (
                        <span className={diff > 0 ? 'text-risk-red' : 'text-risk-green'}>
                          {diff > 0 ? '+' : ''}{fmt(diff)} pp
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground italic">No branch data available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
