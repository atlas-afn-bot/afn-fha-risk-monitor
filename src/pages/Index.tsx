import { useState, useEffect, useCallback, useMemo } from 'react';
import { buildDashboardFromSnapshot } from '@/lib/computeData';
import type { DashboardData } from '@/lib/types';
import type { Snapshot, SnapshotIndex } from '@/types/snapshot';
import { loadSnapshotIndex, loadSnapshot } from '@/lib/snapshotLoader';
import { historicalTrend } from '@/lib/historicalData';
import type { HUDMonthlySnapshot } from '@/lib/hudHistory';
import SummaryCards from '@/components/SummaryCards';
import TrendChart from '@/components/TrendChart';
import PerformanceMatrix from '@/components/PerformanceMatrix';
import CreditWatchSimple from '@/components/CreditWatchSimple';
import PortfolioComposition from '@/components/PortfolioComposition';
import DPAProviderTable from '@/components/DPAProviderTable';
import ChannelAnalysis from '@/components/ChannelAnalysis';
import FICODistribution from '@/components/FICODistribution';
import RiskFactorCharts from '@/components/RiskFactorCharts';
import HUDConcentration from '@/components/HUDConcentration';
import ExecutiveSummary from '@/components/ExecutiveSummary';
import ActionItems from '@/components/ActionItems';
import MonthSelector from '@/components/MonthSelector';
import CompareRatioHeader from '@/components/CompareRatioHeader';
import { exportDashboardPDF } from '@/lib/exportPDF';
import {
  LayoutDashboard, TrendingUp, AlertTriangle, Shield, PieChart,
  Users, GitCompare, BarChart3, MapPin, Moon, Sun, FileDown, Activity, Loader2,
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'summary', label: 'Summary', icon: LayoutDashboard },
  { id: 'trend', label: 'CR Trend', icon: TrendingUp },
  { id: 'termination', label: 'Termination Risk', icon: AlertTriangle },
  { id: 'creditwatch', label: 'Credit Watch', icon: Shield },
  { id: 'portfolio', label: 'Portfolio', icon: PieChart },
  { id: 'dpa', label: 'DPA Providers', icon: Users },
  { id: 'channel', label: 'Channel', icon: GitCompare },
  { id: 'riskfactors', label: 'Risk Factors', icon: Activity },
  { id: 'fico', label: 'FICO', icon: BarChart3 },
  { id: 'hud', label: 'HUD Offices', icon: MapPin },
];

/**
 * Build the trend chart series from hardcoded history + the currently loaded
 * snapshot. Previously this came from IndexedDB (populated by the old HUD
 * file upload flow); with JSON snapshots we overlay the active snapshot's
 * top-line compare ratios on top of the long-running hardcoded series.
 */
function buildTrendHistory(snapshot: Snapshot | null): HUDMonthlySnapshot[] {
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const seeded: HUDMonthlySnapshot[] = historicalTrend.map(h => {
    const [mon, year] = h.month.split(' ');
    const monthIdx = monthNames.indexOf(mon);
    const mm = String(monthIdx + 1).padStart(2, '0');
    return {
      monthKey: `${year}-${mm}`,
      label: h.month,
      performancePeriodEnd: `${mon} ${year}`,
      overallCR: h.overall,
      retailCR: h.retail,
      wholesaleCR: h.wholesale,
      totalLoans: 0,
      totalDLQ: 0,
      dqRate: 0,
      storedAt: '',
    };
  });

  if (!snapshot) return seeded;

  const total = snapshot.compare_ratios_total.find(r => r.scope === 'total');
  const retail = snapshot.compare_ratios_total.find(r => r.scope === 'retail');
  const sponsor = snapshot.compare_ratios_total.find(r => r.scope === 'sponsor');
  if (!total) return seeded;

  const [y, m] = snapshot.snapshot_meta.period.split('-');
  const monthLabel = `${monthNames[parseInt(m, 10) - 1]} ${y}`;

  const snapshotEntry: HUDMonthlySnapshot = {
    monthKey: snapshot.snapshot_meta.period,
    label: monthLabel,
    performancePeriodEnd: snapshot.snapshot_meta.performance_period,
    overallCR: total.compare_ratio ?? 0,
    retailCR: retail?.compare_ratio ?? 0,
    wholesaleCR: sponsor?.compare_ratio ?? 0,
    totalLoans: total.loans_count ?? 0,
    totalDLQ: total.delinquent_count ?? 0,
    dqRate: (total.loans_count ?? 0) > 0
      ? ((total.delinquent_count ?? 0) / (total.loans_count ?? 1)) * 100
      : 0,
    storedAt: snapshot.snapshot_meta.generated_at,
  };

  const merged = seeded.filter(s => s.monthKey !== snapshotEntry.monthKey);
  merged.push(snapshotEntry);
  merged.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  return merged;
}

export default function Index() {
  const [index, setIndex] = useState<SnapshotIndex | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [activeSection, setActiveSection] = useState('summary');
  const [allActionItems, setAllActionItems] = useState<string[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');

  // Bootstrap: load the index + latest snapshot on cold start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const idx = await loadSnapshotIndex();
        if (cancelled) return;
        setIndex(idx);
        const target = idx.periods[0].period;
        setSelectedPeriod(target);
        const snap = await loadSnapshot(target);
        if (cancelled) return;
        setSnapshot(snap);
        setData(buildDashboardFromSnapshot(snap));
      } catch (e: any) {
        console.error('Failed to load snapshot', e);
        if (!cancelled) setError(e?.message || 'Failed to load snapshot');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePeriodChange = useCallback(async (period: string) => {
    if (!index || period === selectedPeriod) return;
    setSelectedPeriod(period);
    setLoading(true);
    setError(null);
    try {
      const snap = await loadSnapshot(period);
      setSnapshot(snap);
      setData(buildDashboardFromSnapshot(snap));
    } catch (e: any) {
      console.error('Failed to switch period', e);
      setError(e?.message || 'Failed to load snapshot');
    } finally {
      setLoading(false);
    }
  }, [index, selectedPeriod]);

  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      document.documentElement.classList.toggle('dark', !prev);
      return !prev;
    });
  }, []);

  const scrollTo = (id: string) => {
    setActiveSection(id);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  const hudHistory = useMemo(() => buildTrendHistory(snapshot), [snapshot]);
  const performancePeriod = snapshot?.snapshot_meta.performance_period_label
    ?? snapshot?.snapshot_meta.label
    ?? '';

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-nav text-nav-foreground flex-shrink-0 sticky top-0 h-screen overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-sidebar-border">
          <p className="text-[10px] font-semibold tracking-widest text-nav-foreground/50 uppercase">American Financial Network</p>
          <h1 className="text-sm font-bold tracking-tight text-sidebar-primary">FHA Risk Monitor</h1>
          <p className="text-[10px] text-nav-foreground/60 mt-0.5">Loan-Level Analytics</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => scrollTo(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                activeSection === item.id
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-nav-foreground/70 hover:text-nav-foreground hover:bg-sidebar-accent/50'
              }`}
            >
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <button onClick={toggleTheme} className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-nav-foreground/70 hover:text-nav-foreground hover:bg-sidebar-accent/50">
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            {isDark ? 'Light Mode' : 'Dark Mode'}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto p-6 space-y-6">
          {loading && !data && (
            <div className="flex items-center justify-center gap-3 py-24 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading monthly snapshot…</span>
            </div>
          )}

          {error && !loading && (
            <div className="max-w-2xl mx-auto mt-16 bg-risk-red-bg border border-risk-red/30 rounded-lg p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-risk-red flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-risk-red mb-1">Snapshot load failed</h3>
                  <p className="text-xs text-foreground/80">{error}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Check that <code className="text-[11px] bg-muted px-1 rounded">public/data/snapshots/index.json</code> exists and contains at least one period.
                  </p>
                </div>
              </div>
            </div>
          )}

          {data && snapshot && index && (
            <>
              {/* Confidentiality Notice */}
              <div className="bg-risk-red-bg border border-risk-red/30 rounded-lg px-4 py-3">
                <p className="text-[10px] leading-relaxed text-risk-red font-medium">
                  <span className="font-bold uppercase">Confidential:</span> This dashboard contains proprietary information, quality control findings, borrower-related nonpublic personal information, and internal risk assessments of American Financial Network, Inc. Access is restricted to authorized committee members and personnel with a legitimate business need to know. Unauthorized access, use, disclosure, distribution, or copying is strictly prohibited.
                </p>
              </div>

              {/* Header */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">American Financial Network, Inc.</p>
                  <h2 className="text-lg font-bold">FHA Risk Monitor · HUD Compare Ratio Analytics</h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs text-muted-foreground">{data.totalLoans.toLocaleString()} loans analyzed</p>
                    {performancePeriod && (
                      <>
                        <span className="text-xs text-muted-foreground">·</span>
                        <p className="text-xs text-muted-foreground font-medium">{performancePeriod}</p>
                      </>
                    )}
                    <span className="text-xs text-muted-foreground">·</span>
                    <p className="text-[10px] text-muted-foreground">
                      Snapshot generated {new Date(snapshot.snapshot_meta.generated_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <MonthSelector
                    periods={index.periods}
                    selectedPeriod={selectedPeriod}
                    onChange={handlePeriodChange}
                    disabled={loading}
                  />
                  <button
                    onClick={() => exportDashboardPDF(data, allActionItems, performancePeriod)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    Export PDF
                  </button>
                </div>
              </div>

              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading {selectedPeriod}…
                </div>
              )}

              <CompareRatioHeader snapshot={snapshot} />

              <div id="section-summary" className="space-y-4">
                <SummaryCards data={data} />
                <ExecutiveSummary data={data} />
                <ActionItems data={data} onItemsChanged={setAllActionItems} />
              </div>

              <div id="section-trend">
                <TrendChart history={hudHistory} />
              </div>

              <div id="section-termination">
                <PerformanceMatrix
                  offices={data.offices}
                  title="Termination Risk Offices — Performance Matrix"
                  emoji="🚨"
                  filterFn={o => o.totalCR > 200 && o.totalLoans > 100}
                />
              </div>

              <div id="section-creditwatch" className="space-y-4">
                <PerformanceMatrix
                  offices={data.offices}
                  title="Credit Watch — Top 5 Priority"
                  emoji="⚠️"
                  filterFn={o => o.totalCR >= 150 && o.totalCR <= 200 && o.totalLoans >= 100}
                  maxRows={5}
                />
                <CreditWatchSimple offices={data.offices} />
              </div>

              <div id="section-portfolio">
                <PortfolioComposition data={data} />
              </div>

              <div id="section-dpa">
                <DPAProviderTable programs={data.dpaPrograms} overallDQRate={data.overallDQRate} />
              </div>

              <div id="section-channel">
                <ChannelAnalysis retail={data.retailSummary} wholesale={data.wsSummary} />
              </div>

              <div id="section-riskfactors">
                <RiskFactorCharts trends={data.trendAnalysis} overallDQRate={data.overallDQRate} />
              </div>

              <div id="section-fico">
                <FICODistribution buckets={data.ficoBuckets} />
              </div>

              <div id="section-hud">
                <HUDConcentration data={data} />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
