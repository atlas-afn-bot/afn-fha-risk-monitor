import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { generateFakeData } from '@/lib/fakeData';
import { parseExcelFile } from '@/lib/parseExcel';
import { parseHUDFile } from '@/lib/parseHUD';
import { saveHUDSnapshot, getAllSnapshots, extractSnapshotFromHUD, type HUDMonthlySnapshot } from '@/lib/hudHistory';
import { historicalTrend } from '@/lib/historicalData';
import { computeDashboard } from '@/lib/computeData';
import type { DashboardData, ParsedLoan, HUDOfficeCR } from '@/lib/types';
import FileUpload from '@/components/FileUpload';
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
import { exportDashboardPDF } from '@/lib/exportPDF';
import {
  LayoutDashboard, TrendingUp, AlertTriangle, Shield, PieChart,
  Users, GitCompare, BarChart3, MapPin, Upload, Moon, Sun, Database, FileDown, Activity
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

export default function Index() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [activeSection, setActiveSection] = useState('summary');
  const mainRef = useRef<HTMLDivElement>(null);
  const [loans, setLoans] = useState<ParsedLoan[] | null>(null);
  const [hudData, setHudData] = useState<HUDOfficeCR[] | null>(null);
  const [encompassFileName, setEncompassFileName] = useState<string | null>(null);
  const [hudFileName, setHudFileName] = useState<string | null>(null);
  const [allActionItems, setAllActionItems] = useState<string[]>([]);
  const [performancePeriod, setPerformancePeriod] = useState<string>('');
  const [hudHistory, setHudHistory] = useState<HUDMonthlySnapshot[]>([]);

  // Load historical HUD data on mount, seed with hardcoded data if empty
  useEffect(() => {
    getAllSnapshots().then(async (existing) => {
      if (existing.length === 0 && historicalTrend.length > 0) {
        // Seed with hardcoded historical data
        for (const h of historicalTrend) {
          const parts = h.month.split(' ');
          const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const monthIdx = monthNames.indexOf(parts[0]);
          if (monthIdx >= 0) {
            const mm = String(monthIdx + 1).padStart(2, '0');
            await saveHUDSnapshot({
              monthKey: `${parts[1]}-${mm}`,
              label: h.month,
              performancePeriodEnd: `${parts[0]} ${parts[1]}`,
              overallCR: h.overall,
              retailCR: h.retail,
              wholesaleCR: h.wholesale,
              totalLoans: 0,
              totalDLQ: 0,
              dqRate: 0,
              storedAt: new Date().toISOString(),
            });
          }
        }
        const seeded = await getAllSnapshots();
        setHudHistory(seeded);
      } else {
        setHudHistory(existing);
      }
    }).catch(console.error);
  }, []);

  const recompute = useCallback((l: ParsedLoan[], h: HUDOfficeCR[] | null) => {
    setData(computeDashboard(l, h ?? undefined));
  }, []);

  // Auto-compute when both files are loaded
  useEffect(() => {
    if (loans && hudData && !data) {
      recompute(loans, hudData);
    }
  }, [loans, hudData, data, recompute]);

  const handleEncompassLoaded = useCallback((parsedLoans: ParsedLoan[]) => {
    setLoans(parsedLoans);
    if (hudData) recompute(parsedLoans, hudData);
  }, [hudData, recompute]);

  const handleHUDLoaded = useCallback((file: File) => {
    setHudFileName(file.name);
    file.arrayBuffer().then(buf => {
      const result = parseHUDFile(buf);
      if (result.performancePeriod) setPerformancePeriod(result.performancePeriod);
      const mapped: HUDOfficeCR[] = result.offices.map(o => ({
        name: o.name,
        totalCR: o.totalCR,
        retailCR: o.retailCR,
        wsCR: o.wsCR,
        totalLoansUW: o.totalLoansUW,
        totalDLQ: o.totalDLQ,
        retailLoans: o.retailLoans,
        retailDLQ: o.retailDLQ,
        sponsoredLoans: o.sponsoredLoans,
        sponsoredDLQ: o.sponsoredDLQ,
        areaRetailDQPct: o.areaRetailDQPct,
        areaSponsoredDQPct: o.areaSponsoredDQPct,
        hudOfficeDQPct: o.hudOfficeDQPct,
      }));
      setHudData(mapped);
      if (loans) recompute(loans, mapped);

      // Store snapshot in IndexedDB for trend history
      if (result.performancePeriod) {
        const snapshot = extractSnapshotFromHUD(result.offices, result.performancePeriod);
        if (snapshot) {
          saveHUDSnapshot(snapshot).then(() => {
            getAllSnapshots().then(setHudHistory);
          }).catch(console.error);
        }
      }
    });
  }, [loans, recompute]);

  const loadDemo = useCallback(() => {
    const demoLoans = generateFakeData();
    setLoans(demoLoans);
    recompute(demoLoans, hudData);
  }, [hudData, recompute]);

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
      <main ref={mainRef} className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto p-6 space-y-6">
          {/* Upload area */}
          {(!loans || !hudData) && (
            <div className="max-w-2xl mx-auto mt-16 space-y-6">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold">Upload Data Files</h2>
                <p className="text-sm text-muted-foreground mt-1">Both files are required to begin analysis</p>
              </div>

              {/* Encompass Upload */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${loans ? 'bg-green-500 text-white' : 'bg-primary text-primary-foreground'}`}>{loans ? '✓' : '1'}</span>
                  <h3 className="text-sm font-semibold">Encompass Neighborhood Watch Data</h3>
                  <span className="text-xs text-risk-red font-medium">(Required)</span>
                </div>
                {loans ? (
                  <div className="border-2 border-green-500/30 bg-green-50 dark:bg-green-950/20 rounded-lg p-4 text-center">
                    <p className="text-sm text-green-600 dark:text-green-400 font-medium">✓ {loans.length.toLocaleString()} loans loaded</p>
                  </div>
                ) : (
                  <FileUpload onDataLoaded={(parsedLoans) => {
                    setLoans(parsedLoans);
                  }} />
                )}
              </div>

              {/* HUD Upload */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${hudData ? 'bg-green-500 text-white' : 'bg-primary text-primary-foreground'}`}>{hudData ? '✓' : '2'}</span>
                  <h3 className="text-sm font-semibold">HUD Field Offices Report</h3>
                  <span className="text-xs text-risk-red font-medium">(Required)</span>
                </div>
                {hudData ? (
                  <div className="border-2 border-green-500/30 bg-green-50 dark:bg-green-950/20 rounded-lg p-4 text-center">
                    <p className="text-sm text-green-600 dark:text-green-400 font-medium">✓ {hudFileName} — {hudData.length} offices loaded</p>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
                    <input type="file" accept=".xlsx,.xls" className="hidden" id="hud-upload"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleHUDLoaded(f); }} />
                    <label htmlFor="hud-upload" className="cursor-pointer flex flex-col items-center gap-2">
                      <Upload className="w-8 h-8 text-muted-foreground" />
                      <p className="text-sm font-medium">Upload HUD Field Offices Excel</p>
                      <p className="text-xs text-muted-foreground">HUD Neighborhood Watch — Field Offices report (.xlsx)</p>
                    </label>
                  </div>
                )}
              </div>

              <div className="text-center pt-2">
                <button
                  onClick={loadDemo}
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Database className="w-4 h-4" />
                  Load demo data (9,400 synthetic loans)
                </button>
              </div>
            </div>
          )}

          {data && (
            <>
              {/* Confidentiality Notice */}
              <div className="bg-risk-red-bg border border-risk-red/30 rounded-lg px-4 py-3">
                <p className="text-[10px] leading-relaxed text-risk-red font-medium">
                  <span className="font-bold uppercase">Confidential:</span> This dashboard contains proprietary information, quality control findings, borrower-related nonpublic personal information, and internal risk assessments of American Financial Network, Inc. Access is restricted to authorized committee members and personnel with a legitimate business need to know. Unauthorized access, use, disclosure, distribution, or copying is strictly prohibited.
                </p>
              </div>
              {/* Upload replacement */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">American Financial Network, Inc.</p>
                  <h2 className="text-lg font-bold">FHA Risk Monitor · HUD Compare Ratio Analytics</h2>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">{data.totalLoans.toLocaleString()} loans analyzed</p>
                    {performancePeriod && (
                      <>
                        <span className="text-xs text-muted-foreground">·</span>
                        <p className="text-xs text-muted-foreground font-medium">{performancePeriod}</p>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => exportDashboardPDF(data, allActionItems, performancePeriod)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    Export PDF
                  </button>
                  <label htmlFor="file-replace" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5" /> Replace Encompass
                  </label>
                  <input id="file-replace" type="file" accept=".xlsx,.xls" className="hidden" onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) file.arrayBuffer().then(buf => handleEncompassLoaded(parseExcelFile(buf)));
                  }} />
                  <label htmlFor="hud-replace" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5" /> {data.hasHUDData ? 'Replace HUD' : 'Add HUD Data'}
                  </label>
                  <input id="hud-replace" type="file" accept=".xlsx,.xls" className="hidden" onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleHUDLoaded(file);
                  }} />
                </div>
              </div>

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
                <DPAProviderTable providers={data.dpaProviders} overallDQRate={data.overallDQRate} />
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
