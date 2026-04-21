import { Gauge } from 'lucide-react';
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
 * summary tiles (Total Loans, DQ Rate, etc.) with identical outer styling:
 * colored icon box on the left, hero Total number, Retail/Wholesale subtext.
 *
 * Snapshot exposes the wholesale scope as `sponsor`; we relabel to
 * "Wholesale" for display.
 */
export default function CompareRatioCard({ snapshot }: Props) {
  const rows = snapshot.compare_ratios_total ?? [];
  const total = rows.find(r => r.scope === 'total');
  const retail = rows.find(r => r.scope === 'retail');
  const sponsor = rows.find(r => r.scope === 'sponsor');

  const totalRatio = formatRatio(total?.compare_ratio);
  const retailRatio = formatRatio(retail?.compare_ratio);
  const wholesaleRatio = formatRatio(sponsor?.compare_ratio);

  return (
    <div className="bg-card rounded-lg p-5 shadow-sm border border-border hover-lift">
      <div className="flex items-start gap-4">
        <div className="p-2.5 rounded-lg bg-risk-blue-bg">
          <Gauge className="h-5 w-5 text-risk-blue" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground">HUD Compare Ratio</p>
          <p className="text-2xl font-bold text-foreground mt-1">{totalRatio}</p>
          <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
            <span>Retail <span className="font-medium text-foreground">{retailRatio}</span></span>
            <span>Wholesale <span className="font-medium text-foreground">{wholesaleRatio}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}
