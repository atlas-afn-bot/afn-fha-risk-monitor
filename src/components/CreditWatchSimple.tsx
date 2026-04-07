import { useState, useMemo } from 'react';
import { ArrowUpDown, Download } from 'lucide-react';
import type { OfficeSummary } from '@/lib/types';

interface Props {
  offices: OfficeSummary[];
}

export default function CreditWatchSimple({ offices }: Props) {
  const filtered = useMemo(() => {
    return offices.filter(o =>
      (o.totalCR > 150 && o.totalLoans < 100) ||
      (o.totalCR >= 150 && o.totalCR <= 200)
    ).sort((a, b) => b.totalCR - a.totalCR);
  }, [offices]);

  if (filtered.length === 0) return null;

  const exportCSV = () => {
    const headers = ['Office','Total CR','Retail CR','WS CR','Total Loans','Total DLQ','DQ Rate','DPA Conc'];
    const rows = filtered.map(o => [o.name,o.totalCR,o.retailCR??'',o.wsCR??'',o.totalLoans,o.totalDLQ,o.dqRate.toFixed(1),o.totalDPAConc.toFixed(1)].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'credit_watch_remaining.csv';
    a.click();
  };

  function crBadge(val: number | null) {
    if (val === null) return <span className="text-muted-foreground text-xs">N/A</span>;
    const cls = val > 200 ? 'risk-badge-red' : val >= 150 ? 'risk-badge-yellow' : 'risk-badge-green';
    return <span className={cls}>{val}%</span>;
  }

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Remaining Credit Watch Offices</h3>
        <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="matrix-header text-left">Office</th>
              <th className="matrix-header">Total CR</th>
              <th className="matrix-header">Retail CR</th>
              <th className="matrix-header">WS CR</th>
              <th className="matrix-header">Total Loans</th>
              <th className="matrix-header">Total DLQ</th>
              <th className="matrix-header">DQ Rate</th>
              <th className="matrix-header">DPA Conc.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(o => (
              <tr key={o.name} className="border-b border-border/50 hover:bg-muted/50">
                <td className="px-2 py-1.5 text-sm font-medium text-left">{o.name}</td>
                <td className="matrix-cell">{crBadge(o.totalCR)}</td>
                <td className="matrix-cell">{crBadge(o.retailCR)}</td>
                <td className="matrix-cell">{crBadge(o.wsCR)}</td>
                <td className="matrix-cell">{o.totalLoans}</td>
                <td className="matrix-cell">{o.totalDLQ}</td>
                <td className="matrix-cell">{o.dqRate.toFixed(1)}%</td>
                <td className="matrix-cell">{o.totalDPAConc.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
