import { useState, useMemo } from 'react';
import type { Snapshot, CompareRatioHudOffice } from '@/types/snapshot';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ArrowUpDown, Building2 } from 'lucide-react';

interface Props {
  snapshot: Snapshot;
}

type SortKey = 'hud_office' | 'hoc' | 'compare_ratio' | 'loans_count' | 'delinquent_count' | 'retail_loans' | 'sponsored_loans' | 'dq_rate';
type SortDir = 'asc' | 'desc';

const HOC_ORDER = ['Denver', 'Philadelphia', 'Santa Ana', 'Atlanta'] as const;

function getDQRate(o: CompareRatioHudOffice): number {
  return (o.loans_count ?? 0) > 0 ? ((o.delinquent_count ?? 0) / (o.loans_count ?? 1)) * 100 : 0;
}

function crColor(cr: number | null): string {
  if (cr == null) return '';
  if (cr > 200) return 'text-risk-red font-semibold';
  if (cr >= 150) return 'text-yellow-600 dark:text-yellow-400 font-semibold';
  return 'text-emerald-600 dark:text-emerald-400';
}

export default function HOCFieldOfficeDrillDown({ snapshot }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('compare_ratio');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterHOC, setFilterHOC] = useState<string>('all');

  const offices = snapshot.compare_ratios_hud_office ?? [];

  const sorted = useMemo(() => {
    let filtered = filterHOC === 'all' ? [...offices] : offices.filter(o => o.hoc === filterHOC);

    filtered.sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      switch (sortKey) {
        case 'hud_office': va = a.hud_office; vb = b.hud_office; break;
        case 'hoc': va = a.hoc ?? ''; vb = b.hoc ?? ''; break;
        case 'compare_ratio': va = a.compare_ratio ?? 0; vb = b.compare_ratio ?? 0; break;
        case 'loans_count': va = a.loans_count ?? 0; vb = b.loans_count ?? 0; break;
        case 'delinquent_count': va = a.delinquent_count ?? 0; vb = b.delinquent_count ?? 0; break;
        case 'retail_loans': va = a.retail_loans ?? 0; vb = b.retail_loans ?? 0; break;
        case 'sponsored_loans': va = a.sponsored_loans ?? 0; vb = b.sponsored_loans ?? 0; break;
        case 'dq_rate': va = getDQRate(a); vb = getDQRate(b); break;
      }
      if (typeof va === 'string') {
        const cmp = va.localeCompare(vb as string);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });

    return filtered;
  }, [offices, sortKey, sortDir, filterHOC]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortHeader = ({ label, colKey, className }: { label: string; colKey: SortKey; className?: string }) => (
    <TableHead className={`text-xs cursor-pointer select-none hover:text-foreground ${className ?? ''}`} onClick={() => toggleSort(colKey)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${sortKey === colKey ? 'opacity-100' : 'opacity-30'}`} />
      </span>
    </TableHead>
  );

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="w-4 h-4 text-risk-blue" />
            <h3 className="text-sm font-semibold">HOC Field Office Drill-Down</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Sortable table of all field offices grouped by HOC. Click column headers to sort.
          </p>
        </div>
        <select
          value={filterHOC}
          onChange={e => setFilterHOC(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md border border-border bg-background"
        >
          <option value="all">All HOCs</option>
          {HOC_ORDER.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      <div className="max-h-[500px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader label="Office" colKey="hud_office" className="sticky left-0 bg-card z-10" />
              <SortHeader label="HOC" colKey="hoc" />
              <SortHeader label="CR" colKey="compare_ratio" />
              <SortHeader label="Loans" colKey="loans_count" />
              <SortHeader label="SDQ" colKey="delinquent_count" />
              <SortHeader label="Retail" colKey="retail_loans" />
              <SortHeader label="Sponsor" colKey="sponsored_loans" />
              <SortHeader label="DQ Rate" colKey="dq_rate" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(o => {
              const dqRate = getDQRate(o);
              return (
                <TableRow key={o.hud_office}>
                  <TableCell className="text-xs font-medium sticky left-0 bg-card z-10">{o.hud_office}</TableCell>
                  <TableCell className="text-xs">{o.hoc ?? '—'}</TableCell>
                  <TableCell className={`text-xs ${crColor(o.compare_ratio)}`}>
                    {o.compare_ratio != null ? `${Math.round(o.compare_ratio)}%` : '—'}
                  </TableCell>
                  <TableCell className="text-xs">{(o.loans_count ?? 0).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{(o.delinquent_count ?? 0).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{(o.retail_loans ?? 0).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{(o.sponsored_loans ?? 0).toLocaleString()}</TableCell>
                  <TableCell className={`text-xs ${dqRate > 8 ? 'text-risk-red font-semibold' : dqRate > 5 ? 'text-yellow-600 dark:text-yellow-400' : ''}`}>
                    {dqRate.toFixed(2)}%
                  </TableCell>
                </TableRow>
              );
            })}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-xs text-muted-foreground text-center italic py-4">
                  No offices found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-[10px] text-muted-foreground mt-2">
        {sorted.length} offices shown · sorted by {sortKey.replace(/_/g, ' ')} ({sortDir})
      </p>
    </div>
  );
}
