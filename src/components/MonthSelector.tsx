import { useMemo } from 'react';
import { Calendar } from 'lucide-react';
import type { SnapshotIndexEntry } from '@/types/snapshot';

interface Props {
  periods: SnapshotIndexEntry[];
  selectedPeriod: string;
  onChange: (period: string) => void;
  disabled?: boolean;
}

/**
 * Dropdown for choosing a monthly snapshot from the list of available
 * periods. Renders a `<select>` styled to match the rest of the dashboard
 * header.
 */
export default function MonthSelector({ periods, selectedPeriod, onChange, disabled }: Props) {
  const selected = useMemo(
    () => periods.find(p => p.period === selectedPeriod) ?? periods[0],
    [periods, selectedPeriod],
  );

  if (periods.length === 0) return null;

  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <Calendar className="w-3.5 h-3.5" />
      <span className="sr-only">Performance period</span>
      <select
        value={selected?.period}
        onChange={e => onChange(e.target.value)}
        disabled={disabled || periods.length <= 1}
        className="bg-muted/40 border border-border rounded-md px-2 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
        aria-label="Performance period"
      >
        {periods.map(p => (
          <option key={p.period} value={p.period}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
