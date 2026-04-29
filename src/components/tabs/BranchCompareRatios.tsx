import { useMemo, useState } from 'react';
import { ArrowUpDown, Building2 } from 'lucide-react';
import type { Snapshot } from '@/types/snapshot';
import SliderWithInput from '@/components/SliderWithInput';

interface Props {
  snapshot: Snapshot;
  /** Optional persisted state for filter/sort. Lifted from parent so it
   *  survives a tab switch. */
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

function badgeClass(val: number | null): string {
  if (val === null) return 'risk-badge-blue';
  if (val > 200) return 'risk-badge-red';
  if (val >= 150) return 'risk-badge-yellow';
  return 'risk-badge-green';
}

export default function BranchCompareRatios({ snapshot, state, onState }: Props) {
  const branches = snapshot.compare_ratios_branch ?? [];

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

  const maxLoans = Math.max(50, ...branches.map(b => b.loans_underwritten ?? 0));

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Branch Compare Ratios (HUD)</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Per-branch compare ratios from HUD's Neighborhood Watch Branch sheet.
          {' '}{filtered.length} of {branches.length} branches shown.
        </p>

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
                <th
                  onClick={() => toggleSort('nmls_id')}
                  className="text-left px-3 py-2 font-medium cursor-pointer hover:text-foreground"
                >
                  <span className="inline-flex items-center gap-1">NMLS <ArrowUpDown className="w-3 h-3" /></span>
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
              {filtered.map(b => (
                <tr key={b.nmls_id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-[11px]">{b.nmls_id}</td>
                  <td className="px-3 py-2">{b.approval_status ?? '—'}</td>
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
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground italic">
                    No branches match the current filter.
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
