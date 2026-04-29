import type { Snapshot } from '@/types/snapshot';
import { Globe } from 'lucide-react';
import HOCRiskHeatmap from '@/components/hoc/HOCRiskHeatmap';
import TopRiskOfficesByHOC from '@/components/hoc/TopRiskOfficesByHOC';
import HOCChannelMix from '@/components/hoc/HOCChannelMix';
import HOCDPAConcentration from '@/components/hoc/HOCDPAConcentration';
import HOCRiskIndicatorDensity from '@/components/hoc/HOCRiskIndicatorDensity';
import HOCFieldOfficeDrillDown from '@/components/hoc/HOCFieldOfficeDrillDown';

interface Props {
  snapshot: Snapshot;
}

const HOC_ORDER: Array<Snapshot['compare_ratios_hoc'][number]['hoc_name']> = [
  'Denver',
  'Philadelphia',
  'Santa Ana',
  'Atlanta',
];

function formatRatio(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '—';
  return `${Math.round(val)}%`;
}

function badgeClass(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'risk-badge-blue';
  if (val > 200) return 'risk-badge-red';
  if (val >= 150) return 'risk-badge-yellow';
  return 'risk-badge-green';
}

/**
 * Per-HOC compare-ratio cards + detailed analysis sections.
 * Reads `compare_ratios_hoc`, `compare_ratios_hud_office`, and `loans[]`
 * straight from the snapshot.
 */
export default function HOCAnalysis({ snapshot }: Props) {
  const rows = snapshot.compare_ratios_hoc ?? [];
  const byName = new Map(rows.map(r => [r.hoc_name, r]));

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-4 h-4 text-risk-blue" />
          <h3 className="text-sm font-semibold">Homeownership Center (HOC) Compare Ratios</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          HUD divides the country into four HOC regions. Each card shows the firm's compare
          ratio against the HOC area's serious-delinquency rate.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {HOC_ORDER.map(name => {
            const r = byName.get(name);
            const cr = r?.compare_ratio ?? null;
            return (
              <div key={name} className="rounded-lg border border-border p-4 bg-background">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{name}</p>
                    <p className="text-2xl font-bold mt-1">{formatRatio(cr)}</p>
                  </div>
                  <span className={badgeClass(cr)}>{cr === null ? 'N/A' : cr > 200 ? 'High' : cr >= 150 ? 'Watch' : 'OK'}</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Retail CR</span>
                    <span className="font-medium">{formatRatio(r?.retail_ratio)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sponsor CR</span>
                    <span className="font-medium">{formatRatio(r?.sponsor_ratio)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
                    <span className="text-muted-foreground">Loans / SDQ</span>
                    <span className="font-medium">
                      {(r?.loans_count ?? 0).toLocaleString()} / {(r?.delinquent_count ?? 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {rows.length === 0 && (
          <div className="text-xs text-muted-foreground italic mt-4">
            No HOC compare ratio data in this snapshot.
          </div>
        )}
      </div>

      {/* New analysis sections */}
      <HOCRiskHeatmap snapshot={snapshot} />
      <TopRiskOfficesByHOC snapshot={snapshot} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HOCChannelMix snapshot={snapshot} />
        <HOCDPAConcentration snapshot={snapshot} />
      </div>
      <HOCRiskIndicatorDensity snapshot={snapshot} />
      <HOCFieldOfficeDrillDown snapshot={snapshot} />
    </div>
  );
}
