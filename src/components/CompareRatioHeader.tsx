import type { Snapshot } from '@/types/snapshot';

interface Props {
  snapshot: Snapshot;
}

/**
 * Format a compare_ratio number as a whole-percent string.
 * Snapshot values are already in percent units (e.g. 145.0 → "145%").
 */
function formatRatio(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '—';
  return `${Math.round(val)}%`;
}

/**
 * Format a `YYYY-MM-DD` performance_period as a short "as of M/D" label.
 * Falls back to the raw string if parsing fails.
 */
function formatAsOf(performancePeriod: string | undefined): string {
  if (!performancePeriod) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(performancePeriod);
  if (!m) return performancePeriod;
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  return `${month}/${day}`;
}

export default function CompareRatioHeader({ snapshot }: Props) {
  const rows = snapshot.compare_ratios_total ?? [];
  const total = rows.find(r => r.scope === 'total');
  const retail = rows.find(r => r.scope === 'retail');
  // Snapshot uses `sponsor`; UI relabels to `Wholesale`.
  const sponsor = rows.find(r => r.scope === 'sponsor');

  const asOf = formatAsOf(snapshot.snapshot_meta?.performance_period);

  const columns = [
    { label: 'Total', value: formatRatio(total?.compare_ratio) },
    { label: 'Retail', value: formatRatio(retail?.compare_ratio) },
    { label: 'Wholesale', value: formatRatio(sponsor?.compare_ratio) },
  ];

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h2 className="text-base font-bold tracking-tight">HUD Compare Ratio</h2>
        {asOf && (
          <p className="text-xs text-muted-foreground font-medium">as of {asOf}</p>
        )}
      </div>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        {columns.map(col => (
          <div key={col.label} className="flex flex-col items-center sm:items-start">
            <p className="card-label">{col.label}</p>
            <p className="text-4xl font-extrabold tracking-tight mt-1">{col.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
