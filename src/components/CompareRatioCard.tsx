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
 * HUD Compare Ratio KPI tile. Sits in the top KPI row alongside the other
 * summary tiles (Total Loans, DQ Rate, etc.) with identical outer styling.
 * Body is a compact tabular list of Total / Retail / Wholesale ratios.
 *
 * Snapshot exposes the wholesale scope as `sponsor`; we relabel to
 * "Wholesale" for display.
 */
export default function CompareRatioCard({ snapshot }: Props) {
  const rows = snapshot.compare_ratios_total ?? [];
  const total = rows.find(r => r.scope === 'total');
  const retail = rows.find(r => r.scope === 'retail');
  const sponsor = rows.find(r => r.scope === 'sponsor');

  const items = [
    { label: 'Total', value: formatRatio(total?.compare_ratio) },
    { label: 'Retail', value: formatRatio(retail?.compare_ratio) },
    { label: 'Wholesale', value: formatRatio(sponsor?.compare_ratio) },
  ];

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <p className="card-label">HUD Compare Ratio</p>
      <div className="mt-2 space-y-1">
        {items.map(item => (
          <div key={item.label} className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">{item.label}</span>
            <span className="text-base font-semibold tabular-nums">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
