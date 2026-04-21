import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { buildDashboardFromSnapshot } from '@/lib/computeData';
import type { DashboardData } from '@/lib/types';
import type { Snapshot, SnapshotIndex } from '@/types/snapshot';
import { loadSnapshotIndex, loadSnapshot } from '@/lib/snapshotLoader';
import { historicalTrend } from '@/lib/historicalData';
import type { HUDMonthlySnapshot } from '@/lib/hudHistory';
import SummaryCards from '@/components/SummaryCards';
import TrendChart from '@/components/TrendChart';
import HUDConcentration from '@/components/HUDConcentration';
import ExecutiveSummary from '@/components/ExecutiveSummary';
import AIInsights from '@/components/AIInsights';
import MonthSelector from '@/components/MonthSelector';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import HOCAnalysis from '@/components/tabs/HOCAnalysis';
import BranchCompareRatios, {
  defaultBranchTabState,
  type BranchTabState,
} from '@/components/tabs/BranchCompareRatios';
import DeepDive, { type DeepDiveSubTab } from '@/components/tabs/DeepDive';
import Delinquencies from '@/components/tabs/Delinquencies';
import { exportDashboardPDF } from '@/lib/exportPDF';
import {
  Moon, Sun, FileDown, Loader2, AlertTriangle,
} from 'lucide-react';

type TabId = 'overview' | 'hud-offices' | 'hoc' | 'branches-hud' | 'deep-dive' | 'delinquencies';

const TAB_DEFS: Array<{ id: TabId; emoji: string; label: string }> = [
  { id: 'overview',     emoji: '📊', label: 'Overview' },
  { id: 'hud-offices',  emoji: '🏢', label: 'HUD Field Offices' },
  { id: 'hoc',          emoji: '🌎', label: 'HOC Analysis' },
  { id: 'branches-hud', emoji: '🏬', label: 'Branch Compare Ratios' },
  { id: 'deep-dive',    emoji: '👥', label: 'Loan Data Deep Dive' },
  { id: 'delinquencies', emoji: '⚠️', label: 'Delinquencies' },
];

const VALID_TABS = new Set<TabId>(TAB_DEFS.map(t => t.id));
const VALID_SUBS = new Set<DeepDiveSubTab>(['lo', 'uw', 'tpo', 'branch']);

function isTabId(v: string | null): v is TabId {
  return !!v && VALID_TABS.has(v as TabId);
}
function isSubTab(v: string | null): v is DeepDiveSubTab {
  return !!v && VALID_SUBS.has(v as DeepDiveSubTab);
}

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
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');

  // ── Tab state synced to URL ────────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = isTabId(searchParams.get('tab')) ? (searchParams.get('tab') as TabId) : 'overview';
  const initialSub = isSubTab(searchParams.get('sub')) ? (searchParams.get('sub') as DeepDiveSubTab) : 'lo';
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [deepDiveSub, setDeepDiveSub] = useState<DeepDiveSubTab>(initialSub);
  // Track which tabs have been visited so far so we can lazy-mount expensive
  // panels (LO Risk, HUD Concentration, etc.) only after first visit.
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([initialTab]));

  // Tab-level state that should persist across switches
  const [branchTabState, setBranchTabState] = useState<BranchTabState>(defaultBranchTabState);

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

  // React to back/forward / paste-with-tab. We watch searchParams (not just
  // the initial mount) so deep links and history navigation both land on the
  // right tab.
  useEffect(() => {
    const t = searchParams.get('tab');
    if (isTabId(t) && t !== activeTab) {
      setActiveTab(t);
      setVisited(prev => prev.has(t) ? prev : new Set(prev).add(t));
    }
    const s = searchParams.get('sub');
    if (isSubTab(s) && s !== deepDiveSub) {
      setDeepDiveSub(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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

  const handleTabChange = useCallback((next: string) => {
    if (!isTabId(next)) return;
    setActiveTab(next);
    setVisited(prev => prev.has(next) ? prev : new Set(prev).add(next));
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    if (next !== 'deep-dive') params.delete('sub');
    else if (!params.get('sub')) params.set('sub', deepDiveSub);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams, deepDiveSub]);

  const handleSubChange = useCallback((next: DeepDiveSubTab) => {
    setDeepDiveSub(next);
    const params = new URLSearchParams(searchParams);
    params.set('tab', 'deep-dive');
    params.set('sub', next);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  // Container ref so the sticky tab bar measures correctly.
  const mainScrollRef = useRef<HTMLElement | null>(null);

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
          {TAB_DEFS.map(item => (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors text-left ${
                activeTab === item.id
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-nav-foreground/70 hover:text-nav-foreground hover:bg-sidebar-accent/50'
              }`}
            >
              <span className="w-4 inline-block text-center">{item.emoji}</span>
              <span className="truncate">{item.label}</span>
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
      <main ref={mainScrollRef} className="flex-1 overflow-y-auto">
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

              {/* Header (always visible across tabs) */}
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
                    onClick={() => exportDashboardPDF(data, performancePeriod)}
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

              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={handleTabChange}>
                <div className="sticky top-0 z-20 -mx-6 px-6 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 border-b border-border">
                  <TabsList className="h-auto flex-wrap gap-1 bg-transparent p-0">
                    {TAB_DEFS.map(t => (
                      <TabsTrigger
                        key={t.id}
                        value={t.id}
                        className="gap-1.5 data-[state=active]:bg-muted"
                      >
                        <span aria-hidden>{t.emoji}</span>
                        <span className="hidden sm:inline">{t.label}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                {/* Overview */}
                <TabsContent value="overview" className="space-y-6">
                  {visited.has('overview') && (
                    <>
                      <SummaryCards data={data} snapshot={snapshot} />
                      <ExecutiveSummary data={data} />
                      <TrendChart history={hudHistory} />
                      <AIInsights />
                      <SnapshotMetadataCard snapshot={snapshot} data={data} />
                    </>
                  )}
                </TabsContent>

                {/* HUD Field Offices */}
                <TabsContent value="hud-offices">
                  {visited.has('hud-offices') && <HUDConcentration data={data} />}
                </TabsContent>

                {/* HOC Analysis */}
                <TabsContent value="hoc">
                  {visited.has('hoc') && <HOCAnalysis snapshot={snapshot} />}
                </TabsContent>

                {/* Branch Compare Ratios */}
                <TabsContent value="branches-hud">
                  {visited.has('branches-hud') && (
                    <BranchCompareRatios
                      snapshot={snapshot}
                      state={branchTabState}
                      onState={setBranchTabState}
                    />
                  )}
                </TabsContent>

                {/* Deep Dive */}
                <TabsContent value="deep-dive">
                  {visited.has('deep-dive') && (
                    <DeepDive
                      snapshot={snapshot}
                      data={data}
                      subTab={deepDiveSub}
                      onSubTabChange={handleSubChange}
                    />
                  )}
                </TabsContent>

                {/* Delinquencies */}
                <TabsContent value="delinquencies">
                  {visited.has('delinquencies') && (
                    <Delinquencies snapshot={snapshot} data={data} />
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * Snapshot metadata block for the Overview tab — surfaces the bookkeeping
 * info we already carry in `snapshot_meta` so reviewers can see the source
 * trail at a glance.
 */
function SnapshotMetadataCard({ snapshot, data }: { snapshot: Snapshot; data: DashboardData }) {
  const m = snapshot.snapshot_meta;
  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h3 className="text-sm font-semibold mb-3">Snapshot Metadata</h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <div className="flex justify-between sm:block">
          <dt className="text-muted-foreground">Period</dt>
          <dd className="font-medium">{m.label} ({m.period})</dd>
        </div>
        <div className="flex justify-between sm:block">
          <dt className="text-muted-foreground">Performance Period</dt>
          <dd className="font-medium">{m.performance_period_label}</dd>
        </div>
        <div className="flex justify-between sm:block">
          <dt className="text-muted-foreground">As-of Date</dt>
          <dd className="font-medium">{m.performance_period}</dd>
        </div>
        <div className="flex justify-between sm:block">
          <dt className="text-muted-foreground">Generated</dt>
          <dd className="font-medium">{new Date(m.generated_at).toLocaleString()}</dd>
        </div>
        <div className="flex justify-between sm:block">
          <dt className="text-muted-foreground">Generated By</dt>
          <dd className="font-mono text-[11px]">{m.generated_by}</dd>
        </div>
        <div className="flex justify-between sm:block">
          <dt className="text-muted-foreground">Schema Version</dt>
          <dd className="font-medium">v{m.schema_version}</dd>
        </div>
        <div className="flex justify-between sm:block sm:col-span-2">
          <dt className="text-muted-foreground">Record Counts</dt>
          <dd className="font-medium">
            {data.totalLoans.toLocaleString()} loans · {snapshot.compare_ratios_hud_office.length} HUD offices ·{' '}
            {snapshot.compare_ratios_branch.length} branches · {snapshot.loan_officer_performance.length} LOs ·{' '}
            {(snapshot.underwriter_rollup ?? []).length} underwriters ·{' '}
            {(snapshot.sponsor_tpo_detail ?? []).length} TPOs
          </dd>
        </div>
        {m.source_files && m.source_files.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground mb-1">Source Files</dt>
            <dd>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] font-mono">
                {m.source_files.map(f => <li key={f}>{f}</li>)}
              </ul>
            </dd>
          </div>
        )}
        {m.notes && (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground mb-1">Notes</dt>
            <dd className="text-[11px]">{m.notes}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
