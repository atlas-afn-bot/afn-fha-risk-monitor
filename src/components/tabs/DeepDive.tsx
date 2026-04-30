import { useMemo, useState, useCallback } from 'react';
import { Users, GraduationCap, Handshake, Building, ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, AlertTriangle, BarChart3, Activity, Filter } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import SliderWithInput from '@/components/SliderWithInput';
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
  { id: 'branch', label: 'Branches', icon: Building },
];

// ─── Shared utilities ────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

function useSortableTable<T>(defaultKey: keyof T & string, defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState<string>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggle = useCallback((key: string) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  const sorted = useCallback((rows: T[]): T[] => {
    return [...rows].sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [sortKey, sortDir]);

  return { sortKey, sortDir, toggle, sorted };
}

function SortHeader({ label, colKey, sortKey, sortDir, onToggle, align = 'left' }: {
  label: string; colKey: string; sortKey: string; sortDir: SortDir;
  onToggle: (k: string) => void; align?: 'left' | 'right';
}) {
  const active = colKey === sortKey;
  return (
    <th
      className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => onToggle(colKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </th>
  );
}

function KPICard({ label, value, sub, icon: Icon, color = 'text-risk-blue' }: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ className?: string }>; color?: string;
}) {
  return (
    <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-3">
      <div className={`p-2 rounded-md bg-muted/60 ${color}`}><Icon className="w-4 h-4" /></div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function dqPct(dq: number, total: number): number {
  return total > 0 ? (dq / total) * 100 : 0;
}

function dpaPct(dpaCount: number, total: number): number {
  return total > 0 ? (dpaCount / total) * 100 : 0;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toFixed(2)}%`;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  return Math.round(v).toLocaleString();
}

function riskColor(dqRate: number): string {
  if (dqRate >= 10) return 'bg-red-500/10 text-red-700 dark:text-red-400';
  if (dqRate >= 5) return 'bg-orange-500/10 text-orange-700 dark:text-orange-400';
  if (dqRate >= 2) return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
  return '';
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function DeepDive({ snapshot, data, subTab, onSubTabChange }: Props) {
  const [minLoans, setMinLoans] = useState(1);

  // Compute max loan count across all groupings for the slider range
  const maxLoans = useMemo(() => {
    const loans = snapshot.loans;
    const counts: number[] = [];
    // LO max
    const loMap = groupBy(loans, l => l.loan_officer || l.lo_employee_id || 'Unknown');
    for (const group of loMap.values()) counts.push(group.length);
    // UW max
    const uwMap = groupBy(loans, l => l.underwriter_enc || 'Unknown');
    for (const group of uwMap.values()) counts.push(group.length);
    // Broker max
    const brokerLoans = loans.filter(l => l.broker);
    const brokerMap = groupBy(brokerLoans, l => l.broker!);
    for (const group of brokerMap.values()) counts.push(group.length);
    // Branch max
    const branchMap = groupBy(loans, l => l.branch_name || l.org_id || 'Unknown');
    for (const group of branchMap.values()) counts.push(group.length);
    return Math.max(...counts, 1);
  }, [snapshot]);

  return (
    <Tabs value={subTab} onValueChange={v => onSubTabChange(v as DeepDiveSubTab)}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <TabsList className="h-auto flex-wrap gap-1">
          {SUB_TABS.map(s => (
            <TabsTrigger key={s.id} value={s.id} className="gap-1.5">
              <s.icon className="w-3.5 h-3.5" />
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <SliderWithInput
            value={minLoans}
            onChange={setMinLoans}
            min={1}
            max={Math.min(maxLoans, 500)}
            step={1}
            label="Min Loans:"
            sliderClassName="w-32"
          />
        </div>
      </div>

      <TabsContent value="lo">
        {subTab === 'lo' && <LoanOfficerPanel snapshot={snapshot} minLoans={minLoans} />}
      </TabsContent>
      <TabsContent value="uw">
        {subTab === 'uw' && <UnderwriterPanel snapshot={snapshot} minLoans={minLoans} />}
      </TabsContent>
      <TabsContent value="tpo">
        {subTab === 'tpo' && <TPOPanel snapshot={snapshot} minLoans={minLoans} />}
      </TabsContent>
      <TabsContent value="branch">
        {subTab === 'branch' && <BranchPanel snapshot={snapshot} minLoans={minLoans} />}
      </TabsContent>
    </Tabs>
  );
}

// ─── Aggregation types ───────────────────────────────────────────────────────

interface LORow {
  lo_name: string;
  lo_employee_id: string;
  branch_name: string;
  loan_count: number;
  dq_count: number;
  dq_pct: number;
  avg_fico: number | null;
  avg_ltv: number | null;
  dpa_pct: number;
}

interface UWRow {
  underwriter: string;
  loan_count: number;
  dq_count: number;
  dq_pct: number;
  avg_fico: number | null;
  avg_ltv: number | null;
}

interface BrokerRow {
  broker: string;
  loan_count: number;
  dq_count: number;
  dq_pct: number;
  avg_fico: number | null;
  avg_ltv: number | null;
  dpa_pct: number;
}

interface BranchRow {
  branch_name: string;
  org_id: string;
  loan_count: number;
  dq_count: number;
  dq_pct: number;
  avg_fico: number | null;
  avg_ltv: number | null;
  dpa_pct: number;
  channel: string;
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

function avgField(loans: Loan[], field: 'fico_score' | 'ltv'): number | null {
  const vals = loans.map(l => l[field]).filter((v): v is number => v != null && v > 0);
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key);
    if (arr) arr.push(item); else map.set(key, [item]);
  }
  return map;
}

// ─── 1. Loan Officers (Enc Data only) ────────────────────────────────────────

function LoanOfficerPanel({ snapshot, minLoans }: { snapshot: Snapshot; minLoans: number }) {
  const allRows = useMemo<LORow[]>(() => {
    const loans = snapshot.loans;
    const byLO = groupBy(loans, l => l.loan_officer || l.lo_employee_id || 'Unknown');
    const result: LORow[] = [];
    for (const [key, group] of byLO) {
      const sample = group[0];
      const dqCount = group.filter(l => l.is_delinquent).length;
      result.push({
        lo_name: sample.loan_officer || key,
        lo_employee_id: sample.lo_employee_id || sample.lo_nmls_id || '—',
        branch_name: sample.branch_name || '—',
        loan_count: group.length,
        dq_count: dqCount,
        dq_pct: dqPct(dqCount, group.length),
        avg_fico: avgField(group, 'fico_score'),
        avg_ltv: avgField(group, 'ltv'),
        dpa_pct: dpaPct(group.filter(l => l.has_dpa).length, group.length),
      });
    }
    return result;
  }, [snapshot]);

  const rows = useMemo(() => allRows.filter(r => r.loan_count >= minLoans), [allRows, minLoans]);
  const totalLoans = rows.reduce((s, r) => s + r.loan_count, 0);
  const totalDQ = rows.reduce((s, r) => s + r.dq_count, 0);
  const avgDQ = dqPct(totalDQ, totalLoans);

  const { sortKey, sortDir, toggle, sorted } = useSortableTable<LORow>('dq_pct');
  const sortedRows = useMemo(() => sorted(rows), [sorted, rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={Users} label="Loan Officers" value={rows.length} sub={`${totalLoans.toLocaleString()} loans (${allRows.length} total, ${allRows.length - rows.length} filtered)`} />
        <KPICard icon={AlertTriangle} label="Total DQ" value={totalDQ} sub={fmtPct(avgDQ)} color="text-risk-red" />
        <KPICard icon={BarChart3} label="Avg FICO" value={fmtNum(avgField(snapshot.loans, 'fico_score'))} />
        <KPICard icon={Activity} label="Avg LTV" value={fmtPct(avgField(snapshot.loans, 'ltv'))} />
      </div>
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Loan Officer Performance</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          All {rows.length} loan officers from Enc Data. Click headers to sort.
        </p>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
              <tr>
                <SortHeader label="LO Name" colKey="lo_name" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortHeader label="Employee ID" colKey="lo_employee_id" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortHeader label="Branch" colKey="branch_name" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortHeader label="Loans" colKey="loan_count" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="DQ" colKey="dq_count" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="DQ %" colKey="dq_pct" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="Avg FICO" colKey="avg_fico" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="Avg LTV" colKey="avg_ltv" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="DPA %" colKey="dpa_pct" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => (
                <tr key={`${r.lo_employee_id}-${i}`} className={`border-t border-border ${riskColor(r.dq_pct)}`}>
                  <td className="px-3 py-2">{r.lo_name}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.lo_employee_id}</td>
                  <td className="px-3 py-2">{r.branch_name}</td>
                  <td className="px-3 py-2 text-right">{r.loan_count}</td>
                  <td className="px-3 py-2 text-right">{r.dq_count}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtPct(r.dq_pct)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(r.avg_fico)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.avg_ltv)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.dpa_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── 2. Underwriters (Enc Data only — underwriter_enc) ───────────────────────

function UnderwriterPanel({ snapshot, minLoans }: { snapshot: Snapshot; minLoans: number }) {
  const allRows = useMemo<UWRow[]>(() => {
    const loans = snapshot.loans;
    const byUW = groupBy(loans, l => l.underwriter_enc || 'Unknown');
    const result: UWRow[] = [];
    for (const [name, group] of byUW) {
      const dqCount = group.filter(l => l.is_delinquent).length;
      result.push({
        underwriter: name,
        loan_count: group.length,
        dq_count: dqCount,
        dq_pct: dqPct(dqCount, group.length),
        avg_fico: avgField(group, 'fico_score'),
        avg_ltv: avgField(group, 'ltv'),
      });
    }
    return result;
  }, [snapshot]);

  const rows = useMemo(() => allRows.filter(r => r.loan_count >= minLoans), [allRows, minLoans]);
  const totalLoans = rows.reduce((s, r) => s + r.loan_count, 0);
  const totalDQ = rows.reduce((s, r) => s + r.dq_count, 0);

  const { sortKey, sortDir, toggle, sorted } = useSortableTable<UWRow>('dq_pct');
  const sortedRows = useMemo(() => sorted(rows), [sorted, rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={GraduationCap} label="Underwriters" value={rows.length} sub={`${totalLoans.toLocaleString()} loans (${allRows.length} total, ${allRows.length - rows.length} filtered)`} />
        <KPICard icon={AlertTriangle} label="Total DQ" value={totalDQ} sub={fmtPct(dqPct(totalDQ, totalLoans))} color="text-risk-red" />
        <KPICard icon={BarChart3} label="Avg FICO" value={fmtNum(avgField(snapshot.loans, 'fico_score'))} />
        <KPICard icon={Activity} label="Avg LTV" value={fmtPct(avgField(snapshot.loans, 'ltv'))} />
      </div>
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Underwriter Performance — Enc Data ({rows.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          All underwriters from Encompass data (column "Underwriter"). NOT from NW Data.
        </p>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
              <tr>
                <SortHeader label="Underwriter" colKey="underwriter" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortHeader label="Loans" colKey="loan_count" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="DQ" colKey="dq_count" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="DQ %" colKey="dq_pct" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="Avg FICO" colKey="avg_fico" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="Avg LTV" colKey="avg_ltv" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => (
                <tr key={`${r.underwriter}-${i}`} className={`border-t border-border ${riskColor(r.dq_pct)}`}>
                  <td className="px-3 py-2">{r.underwriter}</td>
                  <td className="px-3 py-2 text-right">{r.loan_count}</td>
                  <td className="px-3 py-2 text-right">{r.dq_count}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtPct(r.dq_pct)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(r.avg_fico)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.avg_ltv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── 3. TPO / Broker (Enc Data only — broker field) ──────────────────────────

function TPOPanel({ snapshot, minLoans }: { snapshot: Snapshot; minLoans: number }) {
  const allRows = useMemo<BrokerRow[]>(() => {
    // Only include loans that have a broker value (TPO/wholesale channel)
    const loans = snapshot.loans.filter(l => l.broker);
    const byBroker = groupBy(loans, l => l.broker!);
    const result: BrokerRow[] = [];
    for (const [name, group] of byBroker) {
      const dqCount = group.filter(l => l.is_delinquent).length;
      result.push({
        broker: name,
        loan_count: group.length,
        dq_count: dqCount,
        dq_pct: dqPct(dqCount, group.length),
        avg_fico: avgField(group, 'fico_score'),
        avg_ltv: avgField(group, 'ltv'),
        dpa_pct: dpaPct(group.filter(l => l.has_dpa).length, group.length),
      });
    }
    return result;
  }, [snapshot]);

  const rows = useMemo(() => allRows.filter(r => r.loan_count >= minLoans), [allRows, minLoans]);
  const totalLoans = rows.reduce((s, r) => s + r.loan_count, 0);
  const totalDQ = rows.reduce((s, r) => s + r.dq_count, 0);

  const { sortKey, sortDir, toggle, sorted } = useSortableTable<BrokerRow>('dq_pct');
  const sortedRows = useMemo(() => sorted(rows), [sorted, rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={Handshake} label="Brokers" value={rows.length} sub={`${totalLoans.toLocaleString()} TPO loans (${allRows.length} total, ${allRows.length - rows.length} filtered)`} />
        <KPICard icon={AlertTriangle} label="TPO DQ" value={totalDQ} sub={fmtPct(dqPct(totalDQ, totalLoans))} color="text-risk-red" />
        <KPICard icon={BarChart3} label="Avg FICO" value={fmtNum(avgField(snapshot.loans.filter(l => l.broker), 'fico_score'))} />
        <KPICard icon={Activity} label="Avg LTV" value={fmtPct(avgField(snapshot.loans.filter(l => l.broker), 'ltv'))} />
      </div>
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <Handshake className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">TPO / Broker Performance — Enc Data ({rows.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Broker companies from Encompass "Broker" field. Only loans with a broker value shown.
        </p>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
              <tr>
                <SortHeader label="Broker" colKey="broker" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortHeader label="Loans" colKey="loan_count" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="DQ" colKey="dq_count" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="DQ %" colKey="dq_pct" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="Avg FICO" colKey="avg_fico" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="Avg LTV" colKey="avg_ltv" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="DPA %" colKey="dpa_pct" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => (
                <tr key={`${r.broker}-${i}`} className={`border-t border-border ${riskColor(r.dq_pct)}`}>
                  <td className="px-3 py-2">{r.broker}</td>
                  <td className="px-3 py-2 text-right">{r.loan_count}</td>
                  <td className="px-3 py-2 text-right">{r.dq_count}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtPct(r.dq_pct)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(r.avg_fico)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.avg_ltv)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.dpa_pct)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground italic">
                    No broker data in this snapshot.
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

// ─── 4. Branches (Enc Data only — branch_name + org_id) ──────────────────────

function BranchPanel({ snapshot, minLoans }: { snapshot: Snapshot; minLoans: number }) {
  const allRows = useMemo<BranchRow[]>(() => {
    const loans = snapshot.loans;
    // Group by branch_name (fall back to org_id)
    const byBranch = groupBy(loans, l => l.branch_name || l.org_id || 'Unknown');
    const result: BranchRow[] = [];
    for (const [key, group] of byBranch) {
      const sample = group[0];
      const dqCount = group.filter(l => l.is_delinquent).length;
      // Determine dominant channel
      const retailCount = group.filter(l => l.channel === 'Retail').length;
      const wsCount = group.filter(l => l.channel === 'Wholesale').length;
      const channel = retailCount >= wsCount ? (retailCount > 0 ? 'Retail' : 'Unknown') : 'Wholesale';

      result.push({
        branch_name: sample.branch_name || key,
        org_id: sample.org_id || sample.branch_nmls_id || '—',
        loan_count: group.length,
        dq_count: dqCount,
        dq_pct: dqPct(dqCount, group.length),
        avg_fico: avgField(group, 'fico_score'),
        avg_ltv: avgField(group, 'ltv'),
        dpa_pct: dpaPct(group.filter(l => l.has_dpa).length, group.length),
        channel,
      });
    }
    return result;
  }, [snapshot]);

  const rows = useMemo(() => allRows.filter(r => r.loan_count >= minLoans), [allRows, minLoans]);
  const totalLoans = rows.reduce((s, r) => s + r.loan_count, 0);
  const totalDQ = rows.reduce((s, r) => s + r.dq_count, 0);
  const avgDQ = dqPct(totalDQ, totalLoans);

  const { sortKey, sortDir, toggle, sorted } = useSortableTable<BranchRow>('dq_pct');
  const sortedRows = useMemo(() => sorted(rows), [sorted, rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={Building} label="Branches" value={rows.length} sub={`${totalLoans.toLocaleString()} loans (${allRows.length} total, ${allRows.length - rows.length} filtered)`} />
        <KPICard icon={AlertTriangle} label="Total DQ" value={totalDQ} sub={fmtPct(avgDQ)} color="text-risk-red" />
        <KPICard icon={BarChart3} label="Avg FICO" value={fmtNum(avgField(snapshot.loans, 'fico_score'))} />
        <KPICard icon={TrendingUp} label="Avg DPA %" value={fmtPct(dpaPct(snapshot.loans.filter(l => l.has_dpa).length, snapshot.loans.length))} />
      </div>
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <Building className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Branch Performance — Enc Data ({rows.length})</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          All branches from Encompass "Branch Name" / "Org ID". Color-coded by DQ risk level.
          Firm baseline DQ: <span className="font-medium">{fmtPct(avgDQ)}</span>.
        </p>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
              <tr>
                <SortHeader label="Branch" colKey="branch_name" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortHeader label="Org ID" colKey="org_id" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortHeader label="Channel" colKey="channel" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortHeader label="Loans" colKey="loan_count" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="DQ" colKey="dq_count" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="DQ %" colKey="dq_pct" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="Avg FICO" colKey="avg_fico" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="Avg LTV" colKey="avg_ltv" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
                <SortHeader label="DPA %" colKey="dpa_pct" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => (
                <tr key={`${r.org_id}-${i}`} className={`border-t border-border ${riskColor(r.dq_pct)}`}>
                  <td className="px-3 py-2">{r.branch_name}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.org_id}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      r.channel === 'Retail' ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400' :
                      r.channel === 'Wholesale' ? 'bg-purple-500/10 text-purple-700 dark:text-purple-400' :
                      'bg-gray-500/10 text-gray-500'
                    }`}>{r.channel}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{r.loan_count}</td>
                  <td className="px-3 py-2 text-right">{r.dq_count}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtPct(r.dq_pct)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(r.avg_fico)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.avg_ltv)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.dpa_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
