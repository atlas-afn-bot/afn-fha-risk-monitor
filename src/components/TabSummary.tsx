import { useMemo } from 'react';
import type { DashboardData } from '@/lib/types';
import type { Snapshot } from '@/types/snapshot';
import {
  AlertTriangle, Building2, Globe, GitBranch, Users, TrendingDown,
} from 'lucide-react';

type TabId = 'hud-offices' | 'hoc' | 'branches-hud' | 'deep-dive' | 'delinquencies';

interface Props {
  tabId: TabId;
  snapshot: Snapshot;
  data: DashboardData;
}

interface KPI {
  label: string;
  value: string;
  sub?: string;
  color: 'red' | 'yellow' | 'blue' | 'green' | 'neutral';
}

interface TabSummaryResult {
  kpis: KPI[];
  insight: string;
}

const colorMap = {
  red: { bg: 'bg-risk-red-bg', border: 'border-risk-red/20', text: 'text-risk-red' },
  yellow: { bg: 'bg-risk-yellow-bg', border: 'border-risk-yellow/20', text: 'text-risk-yellow' },
  blue: { bg: 'bg-risk-blue-bg', border: 'border-risk-blue/20', text: 'text-risk-blue' },
  green: { bg: 'bg-risk-green-bg', border: 'border-risk-green/20', text: 'text-risk-green' },
  neutral: { bg: 'bg-muted/50', border: 'border-border', text: 'text-foreground' },
};

const tabIcons: Record<TabId, typeof AlertTriangle> = {
  'hud-offices': Building2,
  'hoc': Globe,
  'branches-hud': GitBranch,
  'deep-dive': Users,
  'delinquencies': TrendingDown,
};

function computeHudOffices(data: DashboardData, snapshot: Snapshot): TabSummaryResult {
  const offices = data.offices;
  const termRisk = offices.filter(o => o.totalCR > 200 && o.totalLoans > 100);
  const creditWatch = offices.filter(o =>
    (o.totalCR > 150 && o.totalCR <= 200 && o.totalLoans >= 100) ||
    (o.totalCR > 200 && o.totalLoans < 100) ||
    (o.totalCR > 150 && o.totalLoans < 100)
  );
  const aboveThreshold = offices.filter(o => o.totalCR > 150);

  const worstOffice = offices.length > 0
    ? offices.reduce((a, b) => a.totalCR > b.totalCR ? a : b)
    : null;

  return {
    kpis: [
      {
        label: 'Termination Risk',
        value: String(termRisk.length),
        sub: `office${termRisk.length !== 1 ? 's' : ''} > 200% CR`,
        color: termRisk.length > 0 ? 'red' : 'green',
      },
      {
        label: 'Credit Watch',
        value: String(creditWatch.length),
        sub: 'offices on monitoring',
        color: creditWatch.length > 3 ? 'yellow' : 'neutral',
      },
      {
        label: 'Highest CR',
        value: worstOffice ? `${worstOffice.totalCR.toFixed(0)}%` : 'N/A',
        sub: worstOffice ? worstOffice.name : '',
        color: worstOffice && worstOffice.totalCR > 200 ? 'red' : worstOffice && worstOffice.totalCR > 150 ? 'yellow' : 'neutral',
      },
    ],
    insight: `${aboveThreshold.length} of ${offices.length} HUD offices exceed the 150% compare ratio threshold.${
      termRisk.length > 0
        ? ` ${termRisk.map(o => o.name).slice(0, 3).join(', ')}${termRisk.length > 3 ? ` (+${termRisk.length - 3} more)` : ''} face potential enforcement action.`
        : ' No offices currently at termination risk.'
    }`,
  };
}

function computeHOC(data: DashboardData, snapshot: Snapshot): TabSummaryResult {
  const hocs = snapshot.compare_ratios_hoc;
  const worstHOC = hocs.length > 0
    ? hocs.reduce((a, b) => (a.compare_ratio ?? 0) > (b.compare_ratio ?? 0) ? a : b)
    : null;
  const bestHOC = hocs.length > 0
    ? hocs.reduce((a, b) => (a.compare_ratio ?? Infinity) < (b.compare_ratio ?? Infinity) ? a : b)
    : null;

  const avgCR = hocs.length > 0
    ? hocs.reduce((s, h) => s + (h.compare_ratio ?? 0), 0) / hocs.length
    : 0;

  return {
    kpis: [
      {
        label: 'Highest HOC CR',
        value: worstHOC ? `${(worstHOC.compare_ratio ?? 0).toFixed(0)}%` : 'N/A',
        sub: worstHOC?.hoc_name ?? '',
        color: (worstHOC?.compare_ratio ?? 0) > 150 ? 'red' : (worstHOC?.compare_ratio ?? 0) > 100 ? 'yellow' : 'neutral',
      },
      {
        label: 'Lowest HOC CR',
        value: bestHOC ? `${(bestHOC.compare_ratio ?? 0).toFixed(0)}%` : 'N/A',
        sub: bestHOC?.hoc_name ?? '',
        color: (bestHOC?.compare_ratio ?? 0) <= 100 ? 'green' : 'neutral',
      },
      {
        label: 'Avg HOC CR',
        value: `${avgCR.toFixed(0)}%`,
        sub: `across ${hocs.length} regions`,
        color: avgCR > 150 ? 'red' : avgCR > 100 ? 'yellow' : 'green',
      },
    ],
    insight: `${worstHOC?.hoc_name ?? 'Unknown'} leads with a ${(worstHOC?.compare_ratio ?? 0).toFixed(0)}% compare ratio.${
      hocs.filter(h => (h.compare_ratio ?? 0) > 150).length > 0
        ? ` ${hocs.filter(h => (h.compare_ratio ?? 0) > 150).length} of ${hocs.length} HOC regions exceed 150%.`
        : ' All HOC regions are below the 150% threshold.'
    }`,
  };
}

function computeBranches(data: DashboardData, snapshot: Snapshot): TabSummaryResult {
  const branches = snapshot.compare_ratios_branch;
  const withCR = branches.filter(b => b.compare_ratio != null && (b.loans_underwritten ?? 0) > 0);
  const above200 = withCR.filter(b => (b.compare_ratio ?? 0) > 200);
  const above150 = withCR.filter(b => (b.compare_ratio ?? 0) > 150);

  const sorted = [...withCR].sort((a, b) => (b.compare_ratio ?? 0) - (a.compare_ratio ?? 0));
  const worst = sorted[0] ?? null;

  // Encompass branch-level DQ rate
  const branchMap = new Map<string, { total: number; dq: number; dpa: number }>();
  for (const l of snapshot.loans) {
    const bid = l.branch_nmls_id;
    if (!bid) continue;
    if (!branchMap.has(bid)) branchMap.set(bid, { total: 0, dq: 0, dpa: 0 });
    const e = branchMap.get(bid)!;
    e.total++;
    if (l.is_delinquent) e.dq++;
    if (l.has_dpa) e.dpa++;
  }
  const totalLoans = snapshot.loans.length;
  const totalDPA = [...branchMap.values()].reduce((s, b) => s + b.dpa, 0);
  const overallDPA = totalLoans > 0 ? (totalDPA / totalLoans * 100) : 0;

  return {
    kpis: [
      {
        label: 'HUD Branches > 200%',
        value: String(above200.length),
        sub: `of ${withCR.length} active · ${branchMap.size} AFN branches`,
        color: above200.length > 0 ? 'red' : 'green',
      },
      {
        label: 'HUD Branches > 150%',
        value: String(above150.length),
        sub: `elevated risk · DPA at ${overallDPA.toFixed(0)}%`,
        color: above150.length > 5 ? 'yellow' : 'neutral',
      },
      {
        label: 'Highest Branch CR',
        value: worst ? `${(worst.compare_ratio ?? 0).toFixed(0)}%` : 'N/A',
        sub: worst?.branch_name ?? worst?.nmls_id ?? '',
        color: (worst?.compare_ratio ?? 0) > 200 ? 'red' : (worst?.compare_ratio ?? 0) > 150 ? 'yellow' : 'neutral',
      },
    ],
    insight: `${above200.length} HUD branch${above200.length !== 1 ? 'es' : ''} exceed 200% compare ratio and ${above150.length} exceed 150%. ${branchMap.size} AFN branches in Encompass data with ${overallDPA.toFixed(1)}% DPA concentration.${worst ? ` Worst HUD branch: ${worst.branch_name ?? worst.nmls_id} at ${(worst.compare_ratio ?? 0).toFixed(0)}%.` : ''}`,
  };
}

function computeDeepDive(data: DashboardData, snapshot: Snapshot): TabSummaryResult {
  const totalLoans = data.totalLoans;

  // FICO distribution summary
  const ficoBelow620 = data.ficoBuckets.find(b => b.max <= 620);
  const lowFicoCount = ficoBelow620 ? (ficoBelow620.standardTotal + ficoBelow620.dpaTotal) : 0;
  const lowFicoPct = totalLoans > 0 ? (lowFicoCount / totalLoans * 100) : 0;

  // DPA concentration
  const dpaConc = data.dpaPortfolioConc;

  // Channel mix
  const retailPct = totalLoans > 0 ? (data.retailSummary.totalLoans / totalLoans * 100) : 0;

  return {
    kpis: [
      {
        label: 'Total Loans',
        value: totalLoans.toLocaleString(),
        sub: `${retailPct.toFixed(0)}% retail / ${(100 - retailPct).toFixed(0)}% wholesale`,
        color: 'blue',
      },
      {
        label: 'DPA Concentration',
        value: `${dpaConc.toFixed(1)}%`,
        sub: 'target ≤ 40%',
        color: dpaConc > 50 ? 'red' : dpaConc > 40 ? 'yellow' : 'green',
      },
      {
        label: 'FICO < 620',
        value: lowFicoPct > 0 ? `${lowFicoPct.toFixed(1)}%` : `${lowFicoCount}`,
        sub: `${lowFicoCount.toLocaleString()} loans`,
        color: lowFicoPct > 10 ? 'red' : lowFicoPct > 5 ? 'yellow' : 'neutral',
      },
    ],
    insight: `Portfolio of ${totalLoans.toLocaleString()} loans with ${dpaConc.toFixed(1)}% DPA concentration. Channel split: ${retailPct.toFixed(0)}% retail, ${(100 - retailPct).toFixed(0)}% wholesale.`,
  };
}

function computeDelinquencies(data: DashboardData, snapshot: Snapshot): TabSummaryResult {
  const dqRate = data.overallDQRate;
  const reasons = snapshot.delinquency_reason_rollup ?? [];
  const worstReason = reasons.length > 0
    ? reasons.reduce((a, b) => a.loan_count > b.loan_count ? a : b)
    : null;

  const totalDQ = data.offices.reduce((s, o) => s + o.totalDLQ, 0);

  return {
    kpis: [
      {
        label: 'Overall DQ Rate',
        value: `${dqRate.toFixed(1)}%`,
        sub: `${totalDQ.toLocaleString()} delinquent loans`,
        color: dqRate > 7 ? 'red' : dqRate >= 5 ? 'yellow' : 'green',
      },
      {
        label: 'Top DQ Reason',
        value: worstReason ? `${worstReason.pct_of_sdq.toFixed(0)}%` : 'N/A',
        sub: worstReason?.reason_description ?? 'no data',
        color: worstReason && worstReason.pct_of_sdq > 30 ? 'red' : 'neutral',
      },
      {
        label: 'DQ Reasons Tracked',
        value: String(reasons.length),
        sub: `${reasons.reduce((s, r) => s + r.loan_count, 0).toLocaleString()} SDQ loans`,
        color: 'neutral',
      },
    ],
    insight: `Overall delinquency rate is ${dqRate.toFixed(1)}% across ${totalDQ.toLocaleString()} loans.${
      worstReason
        ? ` Leading cause: "${worstReason.reason_description}" at ${worstReason.pct_of_sdq.toFixed(1)}% of SDQ volume.`
        : ''
    }`,
  };
}

const computeFns: Record<TabId, (data: DashboardData, snapshot: Snapshot) => TabSummaryResult> = {
  'hud-offices': computeHudOffices,
  'hoc': computeHOC,
  'branches-hud': computeBranches,
  'deep-dive': computeDeepDive,
  'delinquencies': computeDelinquencies,
};

export default function TabSummary({ tabId, snapshot, data }: Props) {
  const result = useMemo(() => computeFns[tabId](data, snapshot), [tabId, data, snapshot]);
  const Icon = tabIcons[tabId];

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        {result.kpis.map((kpi, i) => {
          const c = colorMap[kpi.color];
          return (
            <div key={i} className={`flex items-start gap-3 rounded-lg px-4 py-3 border ${c.bg} ${c.border}`}>
              {i === 0 && <Icon className={`w-4 h-4 flex-shrink-0 mt-1 ${c.text}`} />}
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
                <p className={`text-xl font-bold ${c.text}`}>{kpi.value}</p>
                {kpi.sub && <p className="text-[10px] text-muted-foreground truncate">{kpi.sub}</p>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed pl-1">{result.insight}</p>
    </div>
  );
}
