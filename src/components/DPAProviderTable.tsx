import { useState, useMemo } from 'react';
import { ArrowUpDown, Download, ChevronDown, ChevronUp, Search, AlertTriangle, Eye, CheckCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import type { DPAProviderSummary } from '@/lib/types';

interface Props {
  providers: DPAProviderSummary[];
  overallDQRate?: number;
}

type SortKey = keyof DPAProviderSummary;

interface TierConfig {
  label: string;
  icon: typeof AlertTriangle;
  color: string;
  bgColor: string;
  borderColor: string;
  badgeColor: string;
  filter: (p: DPAProviderSummary) => boolean;
  defaultOpen: boolean;
}

const TIERS: TierConfig[] = [
  {
    label: 'High Risk',
    icon: AlertTriangle,
    color: 'text-risk-red',
    bgColor: 'bg-risk-red-bg',
    borderColor: 'border-risk-red/20',
    badgeColor: 'bg-risk-red/15 text-risk-red',
    filter: p => p.dqRate > 8 && p.totalLoans >= 10,
    defaultOpen: true,
  },
  {
    label: 'Watch',
    icon: Eye,
    color: 'text-risk-yellow',
    bgColor: 'bg-risk-yellow-bg',
    borderColor: 'border-risk-yellow/20',
    badgeColor: 'bg-risk-yellow/15 text-risk-yellow',
    filter: p => p.dqRate >= 4 && p.dqRate <= 8 && p.totalLoans >= 10,
    defaultOpen: true,
  },
  {
    label: 'Performing',
    icon: CheckCircle,
    color: 'text-risk-green',
    bgColor: 'bg-risk-green-bg',
    borderColor: 'border-risk-green/20',
    badgeColor: 'bg-risk-green/15 text-risk-green',
    filter: p => p.dqRate < 4 || p.totalLoans < 10,
    defaultOpen: false,
  },
];

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

export default function DPAProviderTable({ providers, overallDQRate = 0 }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('delinquent');
  const [sortDesc, setSortDesc] = useState(true);
  const [search, setSearch] = useState('');
  const [openTiers, setOpenTiers] = useState<Set<string>>(new Set(TIERS.filter(t => t.defaultOpen).map(t => t.label)));

  const maxDQRate = useMemo(() => Math.max(...providers.map(p => p.dqRate), 1), [providers]);
  const maxLoans = useMemo(() => Math.max(...providers.map(p => p.totalLoans), 1), [providers]);

  const filtered = useMemo(() => {
    let arr = providers;
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(p => p.name.toLowerCase().includes(q));
    }
    return [...arr].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (typeof av === 'string') return sortDesc ? (bv as string).localeCompare(av) : (av as string).localeCompare(bv as string);
      return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
  }, [providers, sortKey, sortDesc, search]);

  const toggle = (k: SortKey) => {
    if (sortKey === k) setSortDesc(!sortDesc);
    else { setSortKey(k); setSortDesc(true); }
  };

  const toggleTier = (label: string) => {
    setOpenTiers(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

  // Chart data: top 10 by DLQ count, showing DQ rate
  const top10 = useMemo(() =>
    [...providers].sort((a, b) => b.delinquent - a.delinquent).slice(0, 10),
  [providers]);

  // Summary stats
  const totalDPALoans = providers.reduce((s, p) => s + p.totalLoans, 0);
  const totalDPADLQ = providers.reduce((s, p) => s + p.delinquent, 0);
  const weightedDQRate = totalDPALoans > 0 ? (totalDPADLQ / totalDPALoans) * 100 : 0;
  const highRiskCount = providers.filter(p => p.dqRate > 8 && p.totalLoans >= 10).length;
  const topOffender = providers.reduce((max, p) => p.delinquent > (max?.delinquent ?? 0) ? p : max, providers[0]);

  const SH = ({ label, sk, className = '' }: { label: string; sk: SortKey; className?: string }) => (
    <th className={`matrix-header cursor-pointer hover:text-foreground whitespace-nowrap ${className}`} onClick={() => toggle(sk)}>
      {label} <ArrowUpDown className="inline w-3 h-3" />
    </th>
  );

  const exportCSV = () => {
    const headers = ['Provider', 'Total Loans', 'Delinquent', 'DQ Rate', '% of DPA Volume', 'Retail', 'Wholesale'];
    const rows = filtered.map(p => [p.name, p.totalLoans, p.delinquent, p.dqRate.toFixed(1) + '%', p.pctOfDPAVolume.toFixed(1) + '%', p.retailLoans, p.wsLoans].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dpa_providers.csv';
    a.click();
  };

  const renderProviderRow = (p: DPAProviderSummary) => (
    <tr key={p.name} className="border-b border-border/50 hover:bg-muted/50">
      <td className="px-2 py-1.5 text-xs text-left font-medium whitespace-nowrap max-w-[200px] truncate" title={p.name}>{p.name}</td>
      <td className="matrix-cell">{p.totalLoans.toLocaleString()}</td>
      <td className="matrix-cell font-medium">{p.delinquent}</td>
      <td className="px-2 py-1.5">
        <InlineBar
          value={p.dqRate}
          max={maxDQRate}
          color={p.dqRate > 8 ? 'bg-risk-red' : p.dqRate >= 4 ? 'bg-risk-yellow' : 'bg-risk-green'}
        />
      </td>
      <td className="matrix-cell text-muted-foreground">{p.pctOfDPAVolume.toFixed(1)}%</td>
      <td className="matrix-cell">{p.retailLoans}</td>
      <td className="matrix-cell">{p.wsLoans}</td>
    </tr>
  );

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">DPA Provider Performance Analysis</h2>
        <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-muted/50 rounded-lg px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Providers</p>
          <p className="text-lg font-bold mt-0.5">{providers.length}</p>
        </div>
        <div className="bg-muted/50 rounded-lg px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Weighted DQ Rate</p>
          <p className="text-lg font-bold mt-0.5">{weightedDQRate.toFixed(1)}%</p>
        </div>
        <div className="bg-risk-red-bg rounded-lg px-4 py-3">
          <p className="text-[10px] text-risk-red uppercase tracking-wider">High Risk (&gt;8%)</p>
          <p className="text-lg font-bold text-risk-red mt-0.5">{highRiskCount}</p>
        </div>
        <div className="bg-muted/50 rounded-lg px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Top Contributor</p>
          <p className="text-xs font-bold mt-0.5 truncate" title={topOffender?.name}>{topOffender?.name?.split(' ').slice(0, 2).join(' ')}</p>
          <p className="text-[10px] text-muted-foreground">{topOffender?.delinquent} DLQ ({topOffender?.pctOfDPAVolume.toFixed(0)}% vol)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Tiered table */}
        <div>
          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search providers..."
              className="w-full text-xs bg-muted/50 border border-border rounded-md pl-8 pr-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          {search ? (
            /* Flat filtered table when searching */
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <SH label="Provider" sk="name" className="text-left" />
                    <SH label="Loans" sk="totalLoans" />
                    <SH label="DLQ" sk="delinquent" />
                    <th className="matrix-header cursor-pointer hover:text-foreground whitespace-nowrap" onClick={() => toggle('dqRate')}>
                      DQ Rate <ArrowUpDown className="inline w-3 h-3" />
                    </th>
                    <SH label="% Vol" sk="pctOfDPAVolume" />
                    <SH label="R" sk="retailLoans" />
                    <SH label="WS" sk="wsLoans" />
                  </tr>
                </thead>
                <tbody>{filtered.map(renderProviderRow)}</tbody>
              </table>
            </div>
          ) : (
            /* Tiered view */
            <div className="space-y-2">
              {TIERS.map(tier => {
                const tierProviders = filtered.filter(tier.filter);
                if (tierProviders.length === 0) return null;
                const isOpen = openTiers.has(tier.label);
                const Icon = tier.icon;

                return (
                  <div key={tier.label} className={`rounded-lg border ${tier.borderColor}`}>
                    <button
                      onClick={() => toggleTier(tier.label)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left rounded-t-lg ${tier.bgColor}`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`w-3.5 h-3.5 ${tier.color}`} />
                        <span className={`text-xs font-semibold ${tier.color}`}>{tier.label}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${tier.badgeColor}`}>
                          {tierProviders.length}
                        </span>
                      </div>
                      {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    </button>
                    {isOpen && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="matrix-header text-left">Provider</th>
                              <th className="matrix-header">Loans</th>
                              <th className="matrix-header">DLQ</th>
                              <th className="matrix-header" style={{ minWidth: 130 }}>DQ Rate</th>
                              <th className="matrix-header">% Vol</th>
                              <th className="matrix-header">R</th>
                              <th className="matrix-header">WS</th>
                            </tr>
                          </thead>
                          <tbody>{tierProviders.map(renderProviderRow)}</tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Chart */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Top 10 by Delinquency Count</h3>
          <div className="h-80">
            <ResponsiveContainer>
              <BarChart data={top10} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 9 }}
                  width={110}
                  tickFormatter={(v: string) => v.length > 18 ? v.substring(0, 18) + '…' : v}
                />
                <Tooltip
                  formatter={(v: number, name: string, props: any) => [
                    `${v} (${props.payload.dqRate.toFixed(1)}% DQ rate)`,
                    'Delinquent'
                  ]}
                />
                {overallDQRate > 0 && (
                  <ReferenceLine x={Math.round(overallDQRate)} stroke="#999" strokeDasharray="4 3" />
                )}
                <Bar dataKey="delinquent" name="Delinquent">
                  {top10.map((p, i) => (
                    <Cell key={i} fill={p.dqRate > 8 ? 'hsl(354, 70%, 54%)' : p.dqRate >= 4 ? 'hsl(40, 90%, 50%)' : 'hsl(213, 80%, 50%)'} />
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
