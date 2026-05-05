import { useMemo } from 'react';
import { Download } from 'lucide-react';
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

/**
 * Stacked SDQ% cell: shows original (top, gray, small), revised (middle, bold,
 * color-coded by direction), and the absolute delta in percentage points
 * (bottom, italic). Provides the audit chain Stefanie asked for — reviewers
 * can see at a glance "removed N loans, SDQ% moved from X to Y, delta -Zpp."
 */
function StackedSDQCell({ original, revised, isFirst = false }: {
  original: number | null;
  revised: number | null;
  isFirst?: boolean;
}) {
  const borderCls = isFirst ? 'border-l border-border' : '';
  if (original === null || revised === null) {
    return <td className={`matrix-cell ${borderCls}`}>-</td>;
  }
  const delta = revised - original;
  const deltaAbs = Math.abs(delta);
  const direction = deltaAbs < 0.01 ? 'flat' : delta < 0 ? 'down' : 'up';
  const arrow = direction === 'down' ? '▼' : direction === 'up' ? '▲' : '—';
  const revColor = direction === 'down' ? 'text-risk-green' : direction === 'up' ? 'text-risk-red' : 'text-foreground';
  const deltaText = direction === 'flat'
    ? '0.00pp'
    : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}pp`;
  return (
    <td className={`matrix-cell ${borderCls}`}>
      <div className="flex flex-col items-center leading-tight">
        <span className="text-xs text-muted-foreground">{original.toFixed(2)}%</span>
        <span className={`font-semibold ${revColor}`}>{revised.toFixed(2)}% {arrow}</span>
        <span className="text-[10px] italic text-muted-foreground">{deltaText}</span>
      </div>
    </td>
  );
}

export default function PerformanceMatrix({ offices, title, emoji, filterFn, maxRows }: Props) {
  const filtered = useMemo(() => {
    let arr = offices.filter(filterFn);
    arr.sort((a, b) => (b.totalCR ?? -1) - (a.totalCR ?? -1));
    if (maxRows) arr = arr.slice(0, maxRows);
    return arr;
  }, [offices, filterFn, maxRows]);

  const exportCSV = () => {
    const headers = ['Office','Total CR','Retail CR','WS CR','Total Loans','Retail','WS','Total DLQ','Retail DLQ','WS DLQ','R Non-DPA','R Boost','R Other DPA','WS Non-DPA','WS Boost','WS Other DPA','R Removed','WS Removed','Total SDQ%','Retail SDQ%','WS SDQ%','Rev Total SDQ%','Rev Retail SDQ%','Rev WS SDQ%','Rev Total CR','Rev Retail CR','Rev WS CR'];
    const rows = filtered.map(o => [
      o.name,o.totalCR,o.retailCR??'',o.wsCR??'',
      o.totalLoans,o.retailLoans,o.wsLoans,
      o.totalDLQ,o.retailDLQ,o.wsDLQ,
      o.retailNonDPADLQ,o.retailBoostDLQ,o.retailOtherDPADLQ,
      o.wsNonDPADLQ,o.wsBoostDLQ,o.wsOtherDPADLQ,
      o.retailRemoved,o.wsRemoved,
      o.totalDQPct.toFixed(2),
      o.retailDQPct !== null ? o.retailDQPct.toFixed(2) : '',
      o.wsDQPct !== null ? o.wsDQPct.toFixed(2) : '',
      o.revisedTotalDQPct.toFixed(2),
      o.revisedRetailDQPct !== null ? o.revisedRetailDQPct.toFixed(2) : '',
      o.revisedWSDQPct !== null ? o.revisedWSDQPct.toFixed(2) : '',
      o.revisedTotalCR,o.revisedRetailCR??'',o.revisedWSCR??'',
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^a-zA-Z]/g, '_')}.csv`;
    a.click();
  };

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
              <th className="matrix-header text-center border-l border-border" colSpan={6}>Revised Ratios</th>
            </tr>
            <tr className="border-b border-border">
              <th className="matrix-header whitespace-nowrap text-left">Office</th>
              <th className="matrix-header whitespace-nowrap border-l border-border">Total</th>
              <th className="matrix-header whitespace-nowrap">Retail</th>
              <th className="matrix-header whitespace-nowrap">WS</th>
              <th className="matrix-header whitespace-nowrap border-l border-border">Total</th>
              <th className="matrix-header">Retail</th>
              <th className="matrix-header">WS</th>
              <th className="matrix-header whitespace-nowrap border-l border-border">Total</th>
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
              <th className="matrix-header border-l border-border">Total<br/>SDQ%</th>
              <th className="matrix-header">Retail<br/>SDQ%</th>
              <th className="matrix-header">WS<br/>SDQ%</th>
              <th className="matrix-header whitespace-nowrap border-l border-border">Total CR</th>
              <th className="matrix-header">Retail CR</th>
              <th className="matrix-header">WS CR</th>
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
                <StackedSDQCell original={o.totalDQPct} revised={o.revisedTotalDQPct} isFirst />
                <StackedSDQCell original={o.retailDQPct} revised={o.revisedRetailDQPct} />
                <StackedSDQCell original={o.wsDQPct} revised={o.revisedWSDQPct} />
                <td className="matrix-cell border-l border-border">{crBadge(o.revisedTotalCR)}</td>
                <td className="matrix-cell">{crBadge(o.revisedRetailCR)}</td>
                <td className="matrix-cell">{crBadge(o.revisedWSCR)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
