/**
 * Shape of a single point on the Compare Ratio trend chart.
 *
 * History was previously persisted to IndexedDB (populated incrementally as
 * users uploaded new HUD files). With the move to JSON snapshots, the trend
 * is composed at runtime from hardcoded historical data in
 * {@link ./historicalData} plus the current snapshot's top-line compare
 * ratios — see `buildTrendHistory` in `pages/Index.tsx`.
 *
 * The type is preserved so existing chart components work unchanged.
 */
export interface HUDMonthlySnapshot {
  /** YYYY-MM format, e.g. "2026-02" */
  monthKey: string;
  /** Display label, e.g. "Feb 2026" */
  label: string;
  /** Performance period end date as string */
  performancePeriodEnd: string;
  /** Company-level overall compare ratio */
  overallCR: number;
  /** Company-level retail compare ratio */
  retailCR: number;
  /** Company-level wholesale compare ratio */
  wholesaleCR: number;
  /** Total loans underwritten */
  totalLoans: number;
  /** Total delinquent */
  totalDLQ: number;
  /** Overall DQ rate % */
  dqRate: number;
  /** When this snapshot was generated */
  storedAt: string;
}
