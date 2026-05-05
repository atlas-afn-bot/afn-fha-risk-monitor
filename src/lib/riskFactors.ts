import type { DashboardData, TrendAnalysis } from './types';
import { isCreditWatchOffice, isTerminationRiskOffice } from './computeData';

/**
 * Portfolio Risk Factors — single source of truth for the severity-classified
 * risk panel that appears on the dashboard (RiskFactors.tsx) and in the PDF
 * (Portfolio Risk Factors section). Twyla flagged the previous bullet list
 * as a flat sentence stack with no triage; Michael's directive (PR-2 #17)
 * was to migrate to a CRITICAL / ELEVATED / MODERATE / LOW severity panel
 * with descriptions and action items.
 *
 * Returns a list of `RiskFactor` objects derived from the live snapshot data.
 * Each factor carries:
 *   - `id`        : stable identifier (used for keys, sort tweaks)
 *   - `title`     : short headline shown on the badge row
 *   - `severity`  : critical / elevated / moderate / low — drives color + sort
 *   - `metric`    : large headline number (e.g. "31.6%", "5.0x")
 *   - `description`: narrative sentence shown below the headline
 *   - `action`    : optional action item (if present, rendered as a sub-row)
 *
 * The list is the union of all factors that compute cleanly from the data.
 * Factors whose underlying signal is missing or zero are omitted rather
 * than rendered with placeholder values.
 */
export type RiskSeverity = 'critical' | 'elevated' | 'moderate' | 'low';

export interface RiskFactor {
  id: string;
  title: string;
  severity: RiskSeverity;
  metric: string;
  description: string;
  action?: string;
}

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  critical: 0,
  elevated: 1,
  moderate: 2,
  low: 3,
};

/**
 * Compute the dashboard-side / PDF-side Portfolio Risk Factors list from
 * the DashboardData snapshot.
 */
export function computeRiskFactors(data: DashboardData): RiskFactor[] {
  const factors: RiskFactor[] = [];
  const t = data.trendAnalysis;

  // ── Termination Risk Offices ─────────────────────────────────────────────
  const termCount = data.offices.filter(isTerminationRiskOffice).length;
  if (termCount > 0) {
    factors.push({
      id: 'termination-risk',
      title: 'Termination Risk Offices',
      severity: 'critical',
      metric: String(termCount),
      description: `${termCount} office${termCount !== 1 ? 's' : ''} above 200% compare ratio with > 100 loans. HUD can independently suspend underwriting authority at any individual office.`,
      action: 'Immediate intervention; review per-office Boost DPA exposure and channel mix.',
    });
  }

  // ── Credit Watch Offices ────────────────────────────────────────────────
  const cwCount = data.offices.filter(isCreditWatchOffice).length;
  if (cwCount > 0) {
    factors.push({
      id: 'credit-watch',
      title: 'Credit Watch Offices',
      severity: cwCount >= 10 ? 'elevated' : 'moderate',
      metric: String(cwCount),
      description: `${cwCount} office${cwCount !== 1 ? 's' : ''} on early-warning monitoring (CR 150-200% with ≥100 loans, or CR > 150% with < 100 loans).`,
      action: 'Monthly trend review; flag any office crossing 200% within the next two cycles.',
    });
  }

  // ── DPA Concentration ───────────────────────────────────────────────────
  const dpaConc = data.dpaPortfolioConc;
  if (dpaConc > 0) {
    const dpaSeverity: RiskSeverity =
      dpaConc > 50 ? 'critical' :
      dpaConc > 40 ? 'elevated' :
      dpaConc > 30 ? 'moderate' : 'low';
    factors.push({
      id: 'dpa-concentration',
      title: 'DPA Portfolio Concentration',
      severity: dpaSeverity,
      metric: `${dpaConc.toFixed(1)}%`,
      description: `DPA loans make up ${dpaConc.toFixed(1)}% of the originated book (target: ≤40%). Heavy DPA concentration is the dominant driver of elevated compare ratios.`,
      action: dpaConc > 40 ? 'Tighten DPA underwriting overlays; reduce concentration toward 40%.' : undefined,
    });
  }

  // ── DPA Defaults vs Standard FHA ────────────────────────────────────────
  // Surface the DPA-vs-Standard delinquency multiplier as a discrete risk
  // factor (Twyla PR-2 #12). The 2.6x figure she cited is computed live
  // from `programComposition` rather than hardcoded; the description copy
  // uses whatever the actual data yields.
  const { standardDQ, dpaDQ } = data.programComposition;
  if (standardDQ > 0 && dpaDQ > 0) {
    const mult = dpaDQ / standardDQ;
    const multSeverity: RiskSeverity =
      mult >= 3 ? 'critical' :
      mult >= 2 ? 'elevated' :
      mult >= 1.5 ? 'moderate' : 'low';
    factors.push({
      id: 'dpa-default-multiplier',
      title: 'DPA Defaults vs Standard FHA',
      severity: multSeverity,
      metric: `${mult.toFixed(1)}x`,
      description: `DPA loans are delinquent at ${mult.toFixed(1)}x the rate of Standard FHA (${dpaDQ.toFixed(1)}% vs ${standardDQ.toFixed(1)}%). Absolute DPA DQ rate sits well above the FHA national benchmark.`,
      action: 'Tighten Boost / Arrive guidelines; tighten reserves and DTI overlays for DPA originations.',
    });
  }

  // ── Channel Gap (Wholesale DPA concentration multiple of Retail) ────────
  const wsConc = data.wsSummary.dpaConc;
  const rConc = data.retailSummary.dpaConc;
  if (rConc > 0 && wsConc > 0) {
    const gap = wsConc / rConc;
    const gapSeverity: RiskSeverity =
      gap >= 5 ? 'critical' :
      gap >= 3 ? 'elevated' :
      gap >= 1.5 ? 'moderate' : 'low';
    factors.push({
      id: 'channel-gap',
      title: 'Channel Gap (WS vs Retail DPA)',
      severity: gapSeverity,
      metric: `${gap.toFixed(1)}x`,
      description: `Wholesale DPA concentration is ${wsConc.toFixed(0)}% versus Retail at ${rConc.toFixed(0)}% — a ${gap.toFixed(1)}x multiple. The wholesale channel is the primary driver of elevated compare ratios at the portfolio level.`,
      action: 'Review wholesale DPA take-up and Boost partner mix; consider tighter wholesale overlays.',
    });
  }

  // ── Payment Shock ───────────────────────────────────────────────────────
  // Replaces the "Most FHA loans are FTHB" factor (Twyla PR-2 #11). FTHB
  // share is a portfolio-composition fact rather than a risk signal;
  // Payment Shock is a real risk dimension and is already computed in
  // `paymentShockGroups`. We surface the elevated tail (>50%) and the
  // delinquency multiple it carries.
  const ps = surfacePaymentShock(t);
  if (ps) factors.push(ps);

  // ── DTI Back-End: 55%+ vs 50%+ ──────────────────────────────────────────
  // Twyla's note: "50%+ backend DTI is normal on FHA. Comparing it to <30%
  // makes the delta look misleadingly bad." Compare 55%+ vs 50%+ instead
  // (the truly problematic tail vs the FHA-typical baseline). PR-2 #13.
  const dti = surfaceDtiTail(t);
  if (dti) factors.push(dti);

  // ── Manual UW Risk ──────────────────────────────────────────────────────
  if (t.manualUWDQRate > 0 && t.autoUWDQRate > 0) {
    const mult = t.manualUWDQRate / t.autoUWDQRate;
    const sev: RiskSeverity = mult >= 2 ? 'elevated' : 'moderate';
    factors.push({
      id: 'manual-uw',
      title: 'Manual Underwriting',
      severity: sev,
      metric: `${mult.toFixed(1)}x`,
      description: `Manual UW loans default at ${t.manualUWDQRate.toFixed(1)}% vs ${t.autoUWDQRate.toFixed(1)}% for auto-approved (${mult.toFixed(1)}x). Manual UW is ${t.manualUWRate.toFixed(1)}% of the book.`,
    });
  }

  // ── Risk Layering (≥5 indicators) ───────────────────────────────────────
  const riskLow = t.riskIndicatorCount.find(d => d.label === '1' || d.label === '2');
  const riskHigh = t.riskIndicatorCount.find(d => d.label === '5+');
  if (riskLow && riskHigh && riskLow.dqRate > 0) {
    const mult = riskHigh.dqRate / riskLow.dqRate;
    const sev: RiskSeverity = mult >= 3 ? 'elevated' : 'moderate';
    factors.push({
      id: 'risk-layering',
      title: 'Risk Layering (5+ indicators)',
      severity: sev,
      metric: `${riskHigh.dqRate.toFixed(1)}%`,
      description: `${riskHigh.total.toLocaleString()} loans carry 5+ stacked risk indicators with a ${riskHigh.dqRate.toFixed(1)}% delinquency rate (${mult.toFixed(1)}x the rate at 1-2 indicators).`,
    });
  }

  // ── Source of Funds (Secured Borrowed) ──────────────────────────────────
  const secured = t.sourceOfFunds.find(d => d.label.toLowerCase().includes('secured'));
  const borrower = t.sourceOfFunds.find(d => d.label.toLowerCase().includes('borrower'));
  if (secured && borrower && borrower.dqRate > 0) {
    const mult = secured.dqRate / borrower.dqRate;
    if (mult >= 1.5) {
      factors.push({
        id: 'source-of-funds',
        title: 'Source of Funds: Secured Borrowed',
        severity: mult >= 3 ? 'elevated' : 'moderate',
        metric: `${secured.dqRate.toFixed(1)}%`,
        description: `Loans funded via Secured Borrowed default at ${secured.dqRate.toFixed(1)}% — ${mult.toFixed(1)}x the rate of Borrower-funded (${borrower.dqRate.toFixed(1)}%).`,
      });
    }
  }

  return factors.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/**
 * Pick the elevated-payment-shock tail to surface as a risk factor. We look
 * for a >50% bucket if the data carries that label; otherwise we fall back
 * to the highest-rate bucket meeting a minimum population threshold.
 */
function surfacePaymentShock(t: TrendAnalysis): RiskFactor | null {
  const psGroups = t.paymentShockGroups;
  if (psGroups.length === 0) return null;

  // Find the most-elevated payment-shock bucket.
  // Heuristic: prefer a bucket whose label mentions ">50" or "50+";
  // otherwise pick the bucket with the highest dqRate among those with ≥20
  // loans so we don't surface noise.
  const tail =
    psGroups.find(d => /(>\s*50|50\+|>=\s*50|\u2265\s*50)/.test(d.label))
    ?? psGroups.find(d => /(>\s*40|40\+|>=\s*40)/.test(d.label))
    ?? [...psGroups].filter(d => d.total >= 20).sort((a, b) => b.dqRate - a.dqRate)[0];

  if (!tail || tail.dqRate === 0) return null;

  // Compute portfolio share of this bucket vs total covered loans.
  const totalCovered = psGroups.reduce((s, d) => s + d.total, 0);
  const sharePct = totalCovered > 0 ? (tail.total / totalCovered) * 100 : 0;

  const sev: RiskSeverity =
    tail.dqRate >= 12 ? 'elevated' :
    tail.dqRate >= 8 ? 'moderate' : 'low';

  return {
    id: 'payment-shock',
    title: 'Payment Shock',
    severity: sev,
    metric: `${tail.dqRate.toFixed(1)}%`,
    description: `${tail.total.toLocaleString()} loans (${sharePct.toFixed(0)}% of population with payment-shock data) sit in the ${tail.label} payment-shock bucket with a ${tail.dqRate.toFixed(1)}% delinquency rate.`,
  };
}

/**
 * Compare 55%+ DTI vs 50%+ DTI rather than 50%+ vs <30%.
 *
 * Twyla's argument: 50% backend DTI is normal on FHA, so comparing it to
 * <30% makes the gap look misleadingly large. The signal that actually
 * matters is the truly stressed tail (55%+) versus the FHA-typical
 * baseline (50%+). We aggregate from the available DTI buckets — labels
 * vary across snapshots, so we use threshold-aware accumulators instead
 * of label-matching.
 */
function surfaceDtiTail(t: TrendAnalysis): RiskFactor | null {
  if (t.dtiGroups.length === 0) return null;

  // Sum loans/dlq for buckets crossing each threshold.
  let loansAt50 = 0, dlqAt50 = 0;
  let loansAt55 = 0, dlqAt55 = 0;
  for (const d of t.dtiGroups) {
    const lower = parseFloat(d.label);
    if (Number.isNaN(lower)) {
      // Heuristic label parse for ranges like ">50%", "50+", "50-55"
      const m = d.label.match(/(\d+)/);
      if (!m) continue;
      const v = parseFloat(m[1]);
      if (v >= 50) { loansAt50 += d.total; dlqAt50 += d.dlq; }
      if (v >= 55) { loansAt55 += d.total; dlqAt55 += d.dlq; }
    } else {
      if (lower >= 50) { loansAt50 += d.total; dlqAt50 += d.dlq; }
      if (lower >= 55) { loansAt55 += d.total; dlqAt55 += d.dlq; }
    }
  }

  if (loansAt50 === 0 || loansAt55 === 0) return null;

  const dq50 = (dlqAt50 / loansAt50) * 100;
  const dq55 = (dlqAt55 / loansAt55) * 100;

  // Don't surface a factor if the 55%+ tail isn't materially worse than
  // the 50%+ baseline — that means DTI doesn't separate risk in this
  // snapshot and the factor would just be noise.
  if (dq55 <= dq50 * 1.05) return null;

  const mult = dq55 / dq50;
  const sev: RiskSeverity = mult >= 1.5 ? 'elevated' : 'moderate';

  return {
    id: 'dti-tail',
    title: 'DTI Back-End ≥55% Tail',
    severity: sev,
    metric: `${dq55.toFixed(1)}%`,
    description: `Loans with DTI ≥55% default at ${dq55.toFixed(1)}% (${loansAt55.toLocaleString()} loans) versus ${dq50.toFixed(1)}% for the FHA-typical ≥50% baseline (${loansAt50.toLocaleString()} loans) — ${mult.toFixed(1)}x. Compares the stressed tail against the standard FHA baseline rather than against <30%.`,
  };
}

/**
 * Color tokens for each severity level. Centralized here so the dashboard
 * (Tailwind classes) and the PDF (RGB tuples) can share semantics.
 */
export const SEVERITY_COLORS: Record<RiskSeverity, {
  /** Tailwind text color class. */
  text: string;
  /** Tailwind background tint class. */
  bg: string;
  /** Tailwind border class. */
  border: string;
  /** Display label. */
  label: string;
  /** PDF RGB tuple for badge fill. */
  rgb: [number, number, number];
}> = {
  critical: {
    text: 'text-risk-red',
    bg: 'bg-risk-red-bg',
    border: 'border-risk-red/30',
    label: 'CRITICAL',
    rgb: [220, 38, 38],
  },
  elevated: {
    text: 'text-risk-yellow',
    bg: 'bg-risk-yellow-bg',
    border: 'border-risk-yellow/30',
    label: 'ELEVATED',
    rgb: [234, 88, 12], // orange
  },
  moderate: {
    text: 'text-risk-yellow',
    bg: 'bg-risk-yellow-bg',
    border: 'border-risk-yellow/30',
    label: 'MODERATE',
    rgb: [202, 138, 4], // yellow
  },
  low: {
    text: 'text-risk-blue',
    bg: 'bg-muted/50',
    border: 'border-border',
    label: 'LOW',
    rgb: [37, 99, 235],
  },
};
