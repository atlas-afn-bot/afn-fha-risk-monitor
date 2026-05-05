import type { DashboardData } from '@/lib/types';
import { computeRiskFactors, SEVERITY_COLORS } from '@/lib/riskFactors';

interface Props {
  data: DashboardData;
}

/**
 * Portfolio Risk Factors panel.
 *
 * Severity-classified card list (CRITICAL / ELEVATED / MODERATE / LOW) that
 * replaces the old flat-bullet "Portfolio Risk Factors" sub-section. Each
 * card carries a headline metric, a descriptive sentence, and an optional
 * action item.
 *
 * Computation lives in `lib/riskFactors.ts` so the PDF export and the
 * dashboard render the same factor list with identical thresholds. Twyla's
 * feedback (PR-2 #11/#12/#13/#17) is encoded in the underlying compute
 * function:
 *   - Payment Shock replaces the "Most FHA loans are FTHB" factor (#11).
 *   - DPA Defaults vs Standard FHA shows the live multiplier (#12).
 *   - DTI compares the ≥55% tail against the ≥50% FHA baseline (#13).
 *   - Severities, descriptions, and actions follow the dashboard panel
 *     pattern Michael clarified Twyla was referring to (#17).
 */
export default function RiskFactors({ data }: Props) {
  const factors = computeRiskFactors(data);

  if (factors.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="section-title mb-2">Portfolio Risk Factors</h2>
        <p className="text-xs text-muted-foreground">No risk factors triggered for this snapshot.</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-6" id="section-riskfactors-panel">
      <h2 className="section-title mb-1">Portfolio Risk Factors</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Severity-classified portfolio risk signals — sorted by criticality.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {factors.map(f => {
          const sev = SEVERITY_COLORS[f.severity];
          return (
            <div
              key={f.id}
              className={`rounded-lg border ${sev.border} ${sev.bg} p-4 flex flex-col gap-2`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground truncate" title={f.title}>
                    {f.title}
                  </h3>
                </div>
                <span
                  className={`text-[10px] font-bold tracking-wider ${sev.text} flex-shrink-0`}
                >
                  {sev.label}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold tabular-nums ${sev.text}`}>{f.metric}</span>
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed">{f.description}</p>
              {f.action && (
                <p className="text-[11px] text-muted-foreground border-t border-border/50 pt-2 mt-1">
                  <span className="font-semibold text-foreground/80">Action:</span> {f.action}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
