import { useMemo, useState, useCallback } from 'react';
import {
  ArrowUpDown, Building2, Search, ChevronDown, ChevronRight,
  Trophy, AlertTriangle, TrendingUp, TrendingDown, BarChart3,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from 'recharts';
import type { Snapshot, Loan, CompareRatioBranch } from '@/types/snapshot';
import SliderWithInput from '@/components/SliderWithInput';

/* ═══════════════════════════════════════════════════════════════════════════
   Types & state
   ═══════════════════════════════════════════════════════════════════════════ */

interface Props {
  snapshot: Snapshot;
  state: BranchTabState;
  onState: (s: BranchTabState) => void;
}

export interface BranchTabState {
  minLoans: number;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
}

export const defaultBranchTabState: BranchTabState = {
  minLoans: 25,
  sortKey: 'compare_ratio',
  sortDir: 'desc',
};

type SortKey = 'nmls_id' | 'loans_underwritten' | 'delinquency_rate' | 'compare_ratio';

/* ═══════════════════════════════════════════════════════════════════════════
   Derived data types
   ═══════════════════════════════════════════════════════════════════════════ */

interface AFNBranchRow {
  branchId: string;
  branchName: string;
  loanCount: number;
  dqCount: number;
  dqRate: number;
  sdqCount: number;
  avgFICO: number;
  dpaPct: number;
  dpaCount: number;
  avgRiskIndicators: number;
  avgLTV: number;
  avgDTI: number;
  channelLabel: 'Retail' | 'Wholesale' | 'Mixed';
  retailCount: number;
  wholesaleCount: number;
  claimsCount: number;
  loNames: string[];
}

type AFNSortKey =
  | 'branchId' | 'loanCount' | 'dqRate' | 'sdqCount' | 'avgFICO'
  | 'dpaPct' | 'avgRiskIndicators' | 'avgLTV' | 'avgDTI' | 'claimsCount';

/* ═══════════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function badgeClass(val: number | null): string {
  if (val === null) return 'risk-badge-blue';
  if (val > 200) return 'risk-badge-red';
  if (val >= 150) return 'risk-badge-yellow';
  return 'risk-badge-green';
}

function riskBg(level: 'red' | 'yellow' | 'green' | 'neutral'): string {
  switch (level) {
    case 'red': return 'bg-risk-red-bg border-risk-red/20';
    case 'yellow': return 'bg-risk-yellow-bg border-risk-yellow/20';
    case 'green': return 'bg-risk-green-bg border-risk-green/20';
    default: return 'bg-muted/50 border-border';
  }
}

function riskText(level: 'red' | 'yellow' | 'green' | 'neutral'): string {
  switch (level) {
    case 'red': return 'text-risk-red';
    case 'yellow': return 'text-risk-yellow';
    case 'green': return 'text-risk-green';
    default: return 'text-foreground';
  }
}

function dqRiskLevel(rate: number): 'red' | 'yellow' | 'green' {
  if (rate > 10) return 'red';
  if (rate > 5) return 'yellow';
  return 'green';
}

function dpaRiskLevel(pct: number): 'red' | 'yellow' | 'green' {
  if (pct > 60) return 'red';
  if (pct > 40) return 'yellow';
  return 'green';
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Data hooks
   ═══════════════════════════════════════════════════════════════════════════ */

function useAFNBranches(loans: Loan[]): AFNBranchRow[] {
  return useMemo(() => {
    const map = new Map<string, Loan[]>();
    for (const l of loans) {
      const bid = l.branch_nmls_id;
      if (!bid) continue;
      if (!map.has(bid)) map.set(bid, []);
      map.get(bid)!.push(l);
    }

    const rows: AFNBranchRow[] = [];
    for (const [branchId, bLoans] of map) {
      const loanCount = bLoans.length;
      const dqCount = bLoans.filter(l => l.is_delinquent).length;
      const sdqCount = bLoans.filter(l => l.is_seriously_delinquent).length;
      const dpaCount = bLoans.filter(l => l.has_dpa).length;
      const claimsCount = bLoans.filter(l => l.is_claim).length;

      const ficos = bLoans.map(l => l.fico_score).filter((v): v is number => v != null);
      const ltvs = bLoans.map(l => l.ltv).filter((v): v is number => v != null);
      const dtis = bLoans.map(l => l.back_dti).filter((v): v is number => v != null);
      const risks = bLoans.map(l => l.risk_indicator_count);

      const retailCount = bLoans.filter(l => l.channel === 'Retail').length;
      const wholesaleCount = bLoans.filter(l => l.channel === 'Wholesale').length;
      const channelLabel: 'Retail' | 'Wholesale' | 'Mixed' =
        retailCount > 0 && wholesaleCount > 0 ? 'Mixed' :
        retailCount > 0 ? 'Retail' : 'Wholesale';

      const loNames = [...new Set(bLoans.map(l => l.loan_officer).filter((v): v is string => !!v))];

      // Get the most common branch name for this Org ID
      const nameCount = new Map<string, number>();
      for (const l of bLoans) {
        const n = l.branch_name;
        if (n) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
      }
      let branchName = branchId;
      let maxCount = 0;
      for (const [n, c] of nameCount) {
        if (c > maxCount) { branchName = n; maxCount = c; }
      }

      rows.push({
        branchId,
        branchName,
        loanCount,
        dqCount,
        dqRate: loanCount > 0 ? (dqCount / loanCount) * 100 : 0,
        sdqCount,
        avgFICO: avg(ficos),
        dpaPct: loanCount > 0 ? (dpaCount / loanCount) * 100 : 0,
        dpaCount,
        avgRiskIndicators: avg(risks),
        avgLTV: avg(ltvs),
        avgDTI: avg(dtis),
        channelLabel,
        retailCount,
        wholesaleCount,
        claimsCount,
        loNames,
      });
    }

    return rows;
  }, [loans]);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════════════════════ */

/** ── Section 1: Executive KPIs ─────────────────────────────────────────── */
function BranchKPIs({ afnBranches, hudBranches }: { afnBranches: AFNBranchRow[]; hudBranches: CompareRatioBranch[] }) {
  const stats = useMemo(() => {
    const totalBranches = afnBranches.length;
    const avgDQ = totalBranches > 0
      ? afnBranches.reduce((s, b) => s + b.dqRate, 0) / totalBranches
      : 0;

    const significantBranches = afnBranches.filter(b => b.loanCount >= 50);
    const worstBranch = significantBranches.length > 0
      ? significantBranches.reduce((a, b) => a.dqRate > b.dqRate ? a : b)
      : null;

    const totalLoans = afnBranches.reduce((s, b) => s + b.loanCount, 0);
    const totalDPA = afnBranches.reduce((s, b) => s + b.dpaCount, 0);
    const overallDPA = totalLoans > 0 ? (totalDPA / totalLoans) * 100 : 0;

    const hudAbove200 = hudBranches.filter(b => (b.compare_ratio ?? 0) > 200).length;
    const hudAbove150 = hudBranches.filter(b => (b.compare_ratio ?? 0) > 150).length;

    return { totalBranches, avgDQ, worstBranch, overallDPA, hudAbove200, hudAbove150 };
  }, [afnBranches, hudBranches]);

  const kpis = [
    {
      label: 'AFN Branches',
      value: String(stats.totalBranches),
      sub: `${stats.totalBranches} from Encompass data`,
      level: 'neutral' as const,
    },
    {
      label: 'Avg DQ Rate',
      value: `${stats.avgDQ.toFixed(1)}%`,
      sub: 'across all branches',
      level: dqRiskLevel(stats.avgDQ),
    },
    {
      label: 'Highest-Risk Branch',
      value: stats.worstBranch ? `${stats.worstBranch.dqRate.toFixed(1)}%` : 'N/A',
      sub: stats.worstBranch ? `${stats.worstBranch.branchName} (${stats.worstBranch.loanCount} loans)` : '50+ loan threshold',
      level: stats.worstBranch ? dqRiskLevel(stats.worstBranch.dqRate) : 'neutral' as const,
    },
    {
      label: 'DPA Concentration',
      value: `${stats.overallDPA.toFixed(1)}%`,
      sub: `${stats.hudAbove200} HUD branches > 200% CR`,
      level: dpaRiskLevel(stats.overallDPA),
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {kpis.map((kpi, i) => (
        <div key={i} className={`rounded-lg border px-4 py-3 ${riskBg(kpi.level)}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
          <p className={`text-xl font-bold ${riskText(kpi.level)}`}>{kpi.value}</p>
          {kpi.sub && <p className="text-[10px] text-muted-foreground truncate">{kpi.sub}</p>}
        </div>
      ))}
    </div>
  );
}

/** ── Section 2: AFN Branch Scorecard ───────────────────────────────────── */
function AFNBranchScorecard({ branches }: { branches: AFNBranchRow[] }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<AFNSortKey>('dqRate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [minLoans, setMinLoans] = useState(10);

  const filtered = useMemo(() => {
    let rows = branches.filter(b => b.loanCount >= minLoans);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(b =>
        b.branchName.toLowerCase().includes(q) ||
        b.branchId.toLowerCase().includes(q) ||
        b.loNames.some(n => n.toLowerCase().includes(q))
      );
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return rows;
  }, [branches, search, sortKey, sortDir, minLoans]);

  const toggleSort = useCallback((k: AFNSortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  }, [sortKey]);

  const maxLoans = Math.max(50, ...branches.map(b => b.loanCount));

  const SortHeader = ({ k, label, right }: { k: AFNSortKey; label: string; right?: boolean }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-2 py-2 font-medium cursor-pointer hover:text-foreground whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${sortKey === k ? 'text-foreground' : 'text-muted-foreground/50'}`} />
      </span>
    </th>
  );

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="w-4 h-4 text-risk-blue" />
        <h3 className="text-sm font-semibold">AFN Branch Scorecard</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Aggregated from {branches.reduce((s, b) => s + b.loanCount, 0).toLocaleString()} Encompass loans across {branches.length} branches.
        {' '}{filtered.length} branches shown after filters.
      </p>

      <div className="flex items-end gap-4 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search branch name, ID, or LO name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="w-48">
          <SliderWithInput
            label="Min loans"
            value={minLoans}
            onChange={setMinLoans}
            min={0}
            max={Math.min(maxLoans, 500)}
            step={5}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <SortHeader k="branchId" label="Branch" />
              <SortHeader k="loanCount" label="Loans" right />
              <SortHeader k="dqRate" label="DQ Rate" right />
              <th className="px-2 py-2 text-right font-medium">DQ #</th>
              <SortHeader k="sdqCount" label="SDQ" right />
              <SortHeader k="avgFICO" label="Avg FICO" right />
              <SortHeader k="dpaPct" label="DPA %" right />
              <SortHeader k="avgRiskIndicators" label="Risk Ind." right />
              <SortHeader k="avgLTV" label="Avg LTV" right />
              <SortHeader k="avgDTI" label="Avg DTI" right />
              <th className="px-2 py-2 text-center font-medium">Channel</th>
              <SortHeader k="claimsCount" label="Claims" right />
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => {
              const dqLevel = dqRiskLevel(b.dqRate);
              const dpaLevel = dpaRiskLevel(b.dpaPct);
              return (
                <tr key={b.branchId} className="border-t border-border hover:bg-muted/20">
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{b.branchName}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">Org {b.branchId}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right">{b.loanCount.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      dqLevel === 'red' ? 'bg-risk-red/10 text-risk-red' :
                      dqLevel === 'yellow' ? 'bg-risk-yellow/10 text-risk-yellow' :
                      'bg-risk-green/10 text-risk-green'
                    }`}>
                      {b.dqRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">{b.dqCount}</td>
                  <td className="px-2 py-1.5 text-right">{b.sdqCount}</td>
                  <td className="px-2 py-1.5 text-right">{b.avgFICO > 0 ? Math.round(b.avgFICO) : '—'}</td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      dpaLevel === 'red' ? 'bg-risk-red/10 text-risk-red' :
                      dpaLevel === 'yellow' ? 'bg-risk-yellow/10 text-risk-yellow' :
                      'bg-risk-green/10 text-risk-green'
                    }`}>
                      {b.dpaPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">{b.avgRiskIndicators.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right">{b.avgLTV > 0 ? b.avgLTV.toFixed(1) : '—'}</td>
                  <td className="px-2 py-1.5 text-right">{b.avgDTI > 0 ? b.avgDTI.toFixed(1) : '—'}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      b.channelLabel === 'Retail' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                      b.channelLabel === 'Wholesale' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400' :
                      'bg-gray-500/10 text-gray-600 dark:text-gray-400'
                    }`}>
                      {b.channelLabel}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">{b.claimsCount}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-muted-foreground italic">
                  No branches match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** ── Section 3: HUD Branch Mapping ─────────────────────────────────────── */
function HUDBranchMapping({ snapshot, state, onState }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const branches = snapshot.compare_ratios_branch ?? [];

  // Build a mapping from HUD nmls_id → loan data (via case number bridge)
  // Since HUD branch NMLS IDs (10-digit) don't match Encompass branch_nmls_id (4-digit),
  // we show the HUD data as-is with expandable detail.
  const filtered = useMemo(() => {
    const rows = branches.filter(b => (b.loans_underwritten ?? 0) >= state.minLoans);
    const dir = state.sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = (a[state.sortKey] ?? '') as number | string;
      const bv = (b[state.sortKey] ?? '') as number | string;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return rows;
  }, [branches, state]);

  function toggleSort(k: SortKey) {
    if (state.sortKey === k) {
      onState({ ...state, sortDir: state.sortDir === 'asc' ? 'desc' : 'asc' });
    } else {
      onState({ ...state, sortKey: k, sortDir: 'desc' });
    }
  }

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const maxLoans = Math.max(50, ...branches.map(b => b.loans_underwritten ?? 0));

  // Distribution summary
  const crDistribution = useMemo(() => {
    const active = branches.filter(b => (b.loans_underwritten ?? 0) > 0 && b.compare_ratio != null);
    return {
      total: branches.length,
      active: active.length,
      above200: active.filter(b => (b.compare_ratio ?? 0) > 200).length,
      above150: active.filter(b => (b.compare_ratio ?? 0) > 150 && (b.compare_ratio ?? 0) <= 200).length,
      below100: active.filter(b => (b.compare_ratio ?? 0) <= 100).length,
      approved: branches.filter(b => b.approval_status === 'A').length,
      terminated: branches.filter(b => b.approval_status === 'T').length,
    };
  }, [branches]);

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="w-4 h-4 text-risk-blue" />
        <h3 className="text-sm font-semibold">HUD Branch Mapping ({branches.length} FHA-Registered Branches)</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Per-branch compare ratios from HUD Neighborhood Watch. {crDistribution.approved} approved, {crDistribution.terminated} terminated.
        {' '}{filtered.length} of {branches.length} branches shown.
      </p>

      {/* CR Distribution mini-bar */}
      <div className="flex gap-2 mb-4 text-[10px]">
        <span className="px-2 py-1 rounded bg-risk-red/10 text-risk-red font-semibold">
          {crDistribution.above200} &gt; 200%
        </span>
        <span className="px-2 py-1 rounded bg-risk-yellow/10 text-risk-yellow font-semibold">
          {crDistribution.above150} 150–200%
        </span>
        <span className="px-2 py-1 rounded bg-risk-green/10 text-risk-green font-semibold">
          {crDistribution.below100} ≤ 100%
        </span>
      </div>

      <div className="mb-4 max-w-sm">
        <SliderWithInput
          label="Minimum loans underwritten"
          value={state.minLoans}
          onChange={v => onState({ ...state, minLoans: v })}
          min={0}
          max={maxLoans}
          step={5}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th
                onClick={() => toggleSort('nmls_id')}
                className="text-left px-3 py-2 font-medium cursor-pointer hover:text-foreground"
              >
                <span className="inline-flex items-center gap-1">NMLS ID <ArrowUpDown className="w-3 h-3" /></span>
              </th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th
                onClick={() => toggleSort('loans_underwritten')}
                className="text-right px-3 py-2 font-medium cursor-pointer hover:text-foreground"
              >
                <span className="inline-flex items-center gap-1">Loans UW <ArrowUpDown className="w-3 h-3" /></span>
              </th>
              <th
                onClick={() => toggleSort('delinquency_rate')}
                className="text-right px-3 py-2 font-medium cursor-pointer hover:text-foreground"
              >
                <span className="inline-flex items-center gap-1">DQ Rate <ArrowUpDown className="w-3 h-3" /></span>
              </th>
              <th
                onClick={() => toggleSort('compare_ratio')}
                className="text-right px-3 py-2 font-medium cursor-pointer hover:text-foreground"
              >
                <span className="inline-flex items-center gap-1">Compare Ratio <ArrowUpDown className="w-3 h-3" /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => {
              const isExpanded = expanded.has(b.nmls_id);
              return (
                <ExpandableHUDBranchRow
                  key={b.nmls_id}
                  branch={b}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpand(b.nmls_id)}
                />
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground italic">
                  No branches match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpandableHUDBranchRow({
  branch: b,
  isExpanded,
  onToggle,
}: {
  branch: CompareRatioBranch;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const crLevel = (b.compare_ratio ?? 0) > 200 ? 'red' :
    (b.compare_ratio ?? 0) > 150 ? 'yellow' : 'green';

  return (
    <>
      <tr className="border-t border-border hover:bg-muted/20 cursor-pointer" onClick={onToggle}>
        <td className="px-2 py-2">
          {isExpanded
            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          }
        </td>
        <td className="px-3 py-2 font-mono text-[11px]">{b.nmls_id}</td>
        <td className="px-3 py-2">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            b.approval_status === 'A'
              ? 'bg-risk-green/10 text-risk-green'
              : b.approval_status === 'T'
              ? 'bg-risk-red/10 text-risk-red'
              : 'bg-muted text-muted-foreground'
          }`}>
            {b.approval_status === 'A' ? 'Approved' : b.approval_status === 'T' ? 'Terminated' : '—'}
          </span>
        </td>
        <td className="px-3 py-2 text-right">{(b.loans_underwritten ?? 0).toLocaleString()}</td>
        <td className="px-3 py-2 text-right">
          {b.delinquency_rate != null ? `${b.delinquency_rate.toFixed(2)}%` : '—'}
        </td>
        <td className="px-3 py-2 text-right">
          <span className={badgeClass(b.compare_ratio)}>
            {b.compare_ratio != null ? `${Math.round(b.compare_ratio)}%` : '—'}
          </span>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-muted/10">
          <td colSpan={6} className="px-6 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
              <div>
                <span className="text-muted-foreground">Branch Name:</span>{' '}
                <span className="font-medium">{b.branch_name ?? 'Not reported'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">HUD Office:</span>{' '}
                <span className="font-medium">{b.hud_office ?? 'Not mapped'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Loans:</span>{' '}
                <span className="font-medium">{(b.loans_underwritten ?? 0).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Risk Level:</span>{' '}
                <span className={`font-semibold ${riskText(crLevel)}`}>
                  {crLevel === 'red' ? 'Termination Risk' : crLevel === 'yellow' ? 'Elevated' : 'Normal'}
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** ── Section 4: Top/Bottom Performers ──────────────────────────────────── */
function TopBottomPerformers({ branches }: { branches: AFNBranchRow[] }) {
  const MIN_LOANS = 50;

  const { best, worst, highDPA } = useMemo(() => {
    const eligible = branches.filter(b => b.loanCount >= MIN_LOANS);
    const sortedByDQ = [...eligible].sort((a, b) => a.dqRate - b.dqRate);

    return {
      best: sortedByDQ.slice(0, 5),
      worst: sortedByDQ.slice(-5).reverse(),
      highDPA: [...eligible].sort((a, b) => b.dpaPct - a.dpaPct).slice(0, 5),
    };
  }, [branches]);

  const PerformerCard = ({
    title,
    icon,
    items,
    metric,
    metricLabel,
    riskFn,
  }: {
    title: string;
    icon: React.ReactNode;
    items: AFNBranchRow[];
    metric: (b: AFNBranchRow) => number;
    metricLabel: string;
    riskFn: (val: number) => 'red' | 'yellow' | 'green';
  }) => (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h4 className="text-xs font-semibold">{title}</h4>
      </div>
      <div className="space-y-2">
        {items.map((b, i) => {
          const val = metric(b);
          const level = riskFn(val);
          return (
            <div key={b.branchId} className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-muted-foreground w-4 text-right">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium truncate">{b.branchName}</span>
                  <span className={`text-[11px] font-bold ${riskText(level)}`}>
                    {val.toFixed(1)}% {metricLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{b.loanCount} loans</span>
                  <span>·</span>
                  <span>{b.channelLabel}</span>
                  <span>·</span>
                  <span>FICO {Math.round(b.avgFICO)}</span>
                </div>
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">No branches with {MIN_LOANS}+ loans</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <PerformerCard
        title="Top 5 — Lowest DQ Rate"
        icon={<Trophy className="w-4 h-4 text-risk-green" />}
        items={best}
        metric={b => b.dqRate}
        metricLabel="DQ"
        riskFn={dqRiskLevel}
      />
      <PerformerCard
        title="Bottom 5 — Highest DQ Rate"
        icon={<AlertTriangle className="w-4 h-4 text-risk-red" />}
        items={worst}
        metric={b => b.dqRate}
        metricLabel="DQ"
        riskFn={dqRiskLevel}
      />
      <PerformerCard
        title="Top 5 — Highest DPA %"
        icon={<TrendingUp className="w-4 h-4 text-risk-yellow" />}
        items={highDPA}
        metric={b => b.dpaPct}
        metricLabel="DPA"
        riskFn={dpaRiskLevel}
      />
    </div>
  );
}

/** ── Section 5: Channel Distribution by Branch ─────────────────────────── */
function ChannelDistributionChart({ branches }: { branches: AFNBranchRow[] }) {
  const [sortBy, setSortBy] = useState<'volume' | 'wholesale'>('volume');

  const chartData = useMemo(() => {
    // Only show top 30 branches by volume for readability
    const eligible = branches.filter(b => b.loanCount >= 20);
    const sorted = [...eligible].sort((a, b) => {
      if (sortBy === 'wholesale') {
        const aPct = a.loanCount > 0 ? a.wholesaleCount / a.loanCount : 0;
        const bPct = b.loanCount > 0 ? b.wholesaleCount / b.loanCount : 0;
        return bPct - aPct;
      }
      return b.loanCount - a.loanCount;
    });

    return sorted.slice(0, 30).map(b => ({
      branch: b.branchName,
      Retail: b.retailCount,
      Wholesale: b.wholesaleCount,
      total: b.loanCount,
      wholesalePct: b.loanCount > 0 ? (b.wholesaleCount / b.loanCount * 100) : 0,
    }));
  }, [branches, sortBy]);

  // Identify all-wholesale / all-retail branches
  const pureWholesale = branches.filter(b => b.loanCount >= 20 && b.retailCount === 0);
  const pureRetail = branches.filter(b => b.loanCount >= 20 && b.wholesaleCount === 0);

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Channel Distribution by Branch</h3>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setSortBy('volume')}
            className={`text-[10px] px-2 py-1 rounded ${sortBy === 'volume' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
          >
            By Volume
          </button>
          <button
            onClick={() => setSortBy('wholesale')}
            className={`text-[10px] px-2 py-1 rounded ${sortBy === 'wholesale' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
          >
            By Wholesale %
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Top 30 branches (20+ loans). {pureWholesale.length} pure-wholesale, {pureRetail.length} pure-retail branches.
      </p>

      <div className="h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 15, left: 10, bottom: 80 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="branch"
              tick={{ fontSize: 9, fill: 'currentColor' }}
              angle={-45}
              textAnchor="end"
              height={80}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'currentColor' }}
              className="text-muted-foreground"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0.5rem',
                fontSize: '11px',
              }}
              labelStyle={{ fontWeight: 600 }}
              formatter={(value: number, name: string) => [value.toLocaleString(), name]}
            />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            <Bar dataKey="Retail" stackId="a" fill="hsl(210, 80%, 55%)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Wholesale" stackId="a" fill="hsl(270, 60%, 55%)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Pure-channel callout */}
      {(pureWholesale.length > 0 || pureRetail.length > 0) && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {pureWholesale.length > 0 && (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-3 py-2">
              <p className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 mb-1">
                100% Wholesale Branches ({pureWholesale.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {pureWholesale.slice(0, 10).map(b => (
                  <span key={b.branchId} className="text-[10px] bg-purple-500/10 px-1.5 py-0.5 rounded">
                    {b.branchName} ({b.loanCount})
                  </span>
                ))}
                {pureWholesale.length > 10 && (
                  <span className="text-[10px] text-muted-foreground">+{pureWholesale.length - 10} more</span>
                )}
              </div>
            </div>
          )}
          {pureRetail.length > 0 && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
              <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 mb-1">
                100% Retail Branches ({pureRetail.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {pureRetail.slice(0, 10).map(b => (
                  <span key={b.branchId} className="text-[10px] bg-blue-500/10 px-1.5 py-0.5 rounded">
                    {b.branchName} ({b.loanCount})
                  </span>
                ))}
                {pureRetail.length > 10 && (
                  <span className="text-[10px] text-muted-foreground">+{pureRetail.length - 10} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════════════════════════════════════ */

export default function BranchCompareRatios({ snapshot, state, onState }: Props) {
  const afnBranches = useAFNBranches(snapshot.loans);
  const hudBranches = snapshot.compare_ratios_branch ?? [];

  return (
    <div className="space-y-6">
      {/* 1. Executive KPIs */}
      <BranchKPIs afnBranches={afnBranches} hudBranches={hudBranches} />

      {/* 2. AFN Branch Scorecard */}
      <AFNBranchScorecard branches={afnBranches} />

      {/* 3. Top/Bottom Performers */}
      <TopBottomPerformers branches={afnBranches} />

      {/* 4. Channel Distribution */}
      <ChannelDistributionChart branches={afnBranches} />

      {/* 5. HUD Branch Mapping */}
      <HUDBranchMapping snapshot={snapshot} state={state} onState={onState} />
    </div>
  );
}
