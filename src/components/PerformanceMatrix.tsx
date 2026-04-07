import { useState, useMemo } from 'react';
import { ArrowUpDown, Download } from 'lucide-react';
import type { OfficeSummary } from '@/lib/types';

interface Props {
  offices: OfficeSummary[];
  title: string;
  emoji: string;
  filterFn: (o: OfficeSummary) => boolean;
  maxRows?: number;
}

function crBadge(val: number | null) {
  if (val === null) return <span className="text-muted-foreground text-xs">N/A</span>;
  const cls = val > 200 ? 'risk-badge-red' : val >= 150 ? 'risk-badge-yellow' : 'risk-badge-green';
  return <span className={cls}>{val}%</span>;
}

function dpaConBadge(val: number) {
  const cls = val > 50 ? 'risk-badge-red' : val > 40 ? 'risk-badge-yellow' : 'risk-badge-green';
  return <span className={cls}>{val.toFixed(0)}%</span>;
}

type SortKey = 'name' | 'totalCR' | 'retailCR' | 'wsCR' | 'totalLoans' | 'totalDLQ' | 'retailDPAConc' | 'wsDPAConc' | 'revisedTotalCR';

export default function PerformanceMatrix({ offices, title, emoji, filterFn, maxRows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('totalCR');
  const [sortDesc, setSortDesc] = useState(true);

  const filtered = useMemo(() => {
    let arr = offices.filter(filterFn);
    arr.sort((a, b) => {
      const av = a[sortKey] ?? -1;
      const bv = b[sortKey] ?? -1;
      if (typeof av === 'string') return sortDesc ? (bv as string).localeCompare(av) : av.localeCompare(bv as string);
      return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
    if (maxRows) arr = arr.slice(0, maxRows);
    return arr;
  }, [offices, filterFn, sortKey, sortDesc, maxRows]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else { setSortKey(key); setSortDesc(true); }
  };

  const exportCSV = () => {
    const headers = ['Office','Total CR','Retail CR','WS CR','Total Loans','Retail','WS','Total DLQ','Retail DLQ','WS DLQ','R Non-DPA','R Boost','R Other DPA','WS Non-DPA','WS Boost','WS Other DPA','R Removed','WS Removed','Rev Total','Rev Retail','Rev WS','R DPA%','WS DPA%'];
    const rows = filtered.map(o => [o.name,o.totalCR,o.retailCR??'',o.wsCR??'',o.totalLoans,o.retailLoans,o.wsLoans,o.totalDLQ,o.retailDLQ,o.wsDLQ,o.retailNonDPADLQ,o.retailBoostDLQ,o.retailOtherDPADLQ,o.wsNonDPADLQ,o.wsBoostDLQ,o.wsOtherDPADLQ,o.retailRemoved,o.wsRemoved,o.revisedTotalCR,o.revisedRetailCR??'',o.revisedWSCR??'',o.retailDPAConc.toFixed(1),o.wsDPAConc.toFixed(1)].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^a-zA-Z]/g, '_')}.csv`;
    a.click();
  };

  const SortHeader = ({ label, sk, className = '' }: { label: string; sk: SortKey; className?: string }) => (
    <th className={`matrix-header cursor-pointer hover:text-foreground whitespace-nowrap ${className}`} onClick={() => toggleSort(sk)}>
      {label} <ArrowUpDown className="inline w-3 h-3 ml-0.5" />
    </th>
  );

  if (filtered.length === 0) return null;

  return (
    <div className="bg-card rounded-lg border border-border p-6 overflow-x-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">{emoji} {title}</h2>
        <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="matrix-header text-left" colSpan={1}></th>
              <th className="matrix-header text-center border-l border-border" colSpan={3}>Compare Ratios</th>
              <th className="matrix-header text-center border-l border-border" colSpan={3}>Total Loans UW</th>
              <th className="matrix-header text-center border-l border-border" colSpan={3}>Total DLQ</th>
              <th className="matrix-header text-center border-l border-border" colSpan={3}>Retail DLQ Breakdown</th>
              <th className="matrix-header text-center border-l border-border" colSpan={3}>WS DLQ Breakdown</th>
              <th className="matrix-header text-center border-l border-border" colSpan={2}>Enhanced Guidelines</th>
              <th className="matrix-header text-center border-l border-border" colSpan={3}>Revised Ratios</th>
              <th className="matrix-header text-center border-l border-border" colSpan={2}>DPA Conc.</th>
            </tr>
            <tr className="border-b border-border">
              <SortHeader label="Office" sk="name" className="text-left" />
              <SortHeader label="Total" sk="totalCR" className="border-l border-border" />
              <SortHeader label="Retail" sk="retailCR" />
              <SortHeader label="WS" sk="wsCR" />
              <SortHeader label="Total" sk="totalLoans" className="border-l border-border" />
              <th className="matrix-header">Retail</th>
              <th className="matrix-header">WS</th>
              <SortHeader label="Total" sk="totalDLQ" className="border-l border-border" />
              <th className="matrix-header">Retail</th>
              <th className="matrix-header">WS</th>
              <th className="matrix-header border-l border-border">Non-DPA</th>
              <th className="matrix-header">Boost</th>
              <th className="matrix-header">Other</th>
              <th className="matrix-header border-l border-border">Non-DPA</th>
              <th className="matrix-header">Boost</th>
              <th className="matrix-header">Other</th>
              <th className="matrix-header border-l border-border">R Rmvd</th>
              <th className="matrix-header">WS Rmvd</th>
              <SortHeader label="Total" sk="revisedTotalCR" className="border-l border-border" />
              <th className="matrix-header">Retail</th>
              <th className="matrix-header">WS</th>
              <SortHeader label="Retail" sk="retailDPAConc" className="border-l border-border" />
              <SortHeader label="WS" sk="wsDPAConc" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(o => (
              <tr key={o.name} className={`border-b border-border/50 hover:bg-muted/50 ${o.isImproved ? 'row-highlight-green' : ''}`}>
                <td className="px-2 py-1.5 text-sm font-medium text-left whitespace-nowrap">{o.name}</td>
                <td className="matrix-cell border-l border-border">{crBadge(o.totalCR)}</td>
                <td className="matrix-cell">{crBadge(o.retailCR)}</td>
                <td className="matrix-cell">{crBadge(o.wsCR)}</td>
                <td className="matrix-cell border-l border-border font-medium">{o.totalLoans}</td>
                <td className="matrix-cell">{o.retailLoans}</td>
                <td className="matrix-cell">{o.wsLoans}</td>
                <td className="matrix-cell border-l border-border font-medium">{o.totalDLQ}</td>
                <td className="matrix-cell">{o.retailDLQ}</td>
                <td className="matrix-cell">{o.wsDLQ}</td>
                <td className="matrix-cell border-l border-border">{o.retailNonDPADLQ}</td>
                <td className="matrix-cell text-risk-red font-medium">{o.retailBoostDLQ}</td>
                <td className="matrix-cell">{o.retailOtherDPADLQ}</td>
                <td className="matrix-cell border-l border-border">{o.wsNonDPADLQ}</td>
                <td className="matrix-cell text-risk-red font-medium">{o.wsBoostDLQ}</td>
                <td className="matrix-cell">{o.wsOtherDPADLQ}</td>
                <td className="matrix-cell border-l border-border text-risk-red">{o.retailRemoved}</td>
                <td className="matrix-cell text-risk-red">{o.wsRemoved}</td>
                <td className="matrix-cell border-l border-border">{crBadge(o.revisedTotalCR)}</td>
                <td className="matrix-cell">{crBadge(o.revisedRetailCR)}</td>
                <td className="matrix-cell">{crBadge(o.revisedWSCR)}</td>
                <td className="matrix-cell border-l border-border">{dpaConBadge(o.retailDPAConc)}</td>
                <td className="matrix-cell">{dpaConBadge(o.wsDPAConc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
