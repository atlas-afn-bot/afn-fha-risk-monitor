/**
 * @deprecated Superseded by `PerformanceMatrixV16` (PR-D). Michael rejected
 * this PR-B layout in review; the unified v16-shaped matrix replaces both
 * this component and `CreditWatchSimple`. Left in place so the PR-D diff
 * is a strict addition and rollback is a two-line revert in Index.tsx.
 * Do not import or extend this component going forward.
 *
 * PerformanceMatrix — reformatted per PR-B (docs/scenario-builder-design.md §4).
 *
 * Ships against the PR-A `POST /api/evaluate` contract. The matrix is one
 * specific caller with a fixed predicate set:
 *   • On mount: single evaluate call with just
 *     [fails_enhanced_guidelines] → drives the "EG-fail Removed" +
 *     "Revised CR" + "Δ bps" columns.
 *   • On row expand: lazy evaluate call with the full driver-breakdown
 *     predicate list, cached client-side by office name so re-expand
 *     doesn't re-fetch.
 *
 * Column set matches the v16 workbook's Retail/Wholesale/Combined block
 * that John Sherman is fluent in:
 *
 *   Office | Channel | Loans | 60+DQ | HUD CR | EG-fail Removed | Revised CR | Δ bps
 *
 * Every office is always visible (no top-N cap); sticky header;
 * client-side sortable columns; default sort = HUD CR desc. Subtotal rows
 * for Retail / Wholesale / Total. The DLQ Breakdown by Channel 6-column
 * block from v16 (R Non-DPA / R Boost / R Other DPA / WS Non-DPA / WS
 * Boost / WS Other DPA) lives inside the expand row along with the
 * driver breakdown for that office.
 *
 * See TerminationRiskCards.tsx for the tile above the matrix — that's a
 * *count* view (offices > 200 CR); this is the *table* view (all offices
 * in the caller's filter).
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Download, ChevronRight, ChevronDown, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import type { OfficeSummary } from '@/lib/types';
import {
  evaluate,
  TOP_LEVEL_PREDICATES,
  DRIVER_BREAKDOWN_PREDICATES,
  DRIVER_LABELS,
  type EvaluateResponse,
  type PerOfficeEvaluation,
} from '@/lib/evaluateApi';

interface Props {
  offices: OfficeSummary[];
  title: string;
  emoji: string;
  filterFn: (o: OfficeSummary) => boolean;
  /**
   * Snapshot month (YYYY-MM). Passed to `/api/evaluate` so both the
   * top-level EG-fail Removed columns and the lazy driver breakdown
   * evaluate against the currently selected snapshot.
   */
  snapshotMonth: string;
}

type Channel = 'All' | 'Retail' | 'Wholesale';

type SortDir = 'asc' | 'desc';
type SortKey =
  | 'name'
  | 'channel'
  | 'loans'
  | 'dlq'
  | 'hudCR'
  | 'egRemoved'
  | 'revisedCR'
  | 'deltaBps';

interface Row {
  key: string;
  name: string;
  channel: 'Retail' | 'Wholesale' | 'Combined';
  loans: number;
  dlq: number;
  hudCR: number | null;
  egRemoved: number | null;
  revisedCR: number | null;
  deltaBps: number | null;
  /** Anchor back to the OfficeSummary — carries the v16 DLQ breakdown block. */
  office: OfficeSummary;
}

function crBadge(val: number | null) {
  if (val === null || Number.isNaN(val)) return <span className="text-muted-foreground text-xs">N/A</span>;
  const cls = val > 200 ? 'risk-badge-red' : val >= 150 ? 'risk-badge-yellow' : 'risk-badge-green';
  return <span className={cls}>{Math.round(val)}%</span>;
}

function deltaBadge(delta: number | null) {
  if (delta === null || Number.isNaN(delta)) return <span className="text-muted-foreground">—</span>;
  const sign = delta < 0 ? '' : '+';
  const cls = delta < 0 ? 'text-risk-green font-semibold' : delta > 0 ? 'text-risk-red font-semibold' : 'text-muted-foreground';
  return <span className={cls}>{sign}{delta} bps</span>;
}

/**
 * Build a stable row from an OfficeSummary + optional per-office evaluate
 * result. Falls back to `null` for EG-fail Removed columns when the
 * evaluator hasn't returned yet — the loading state is visible in the UI.
 */
function makeRow(
  o: OfficeSummary,
  channel: Row['channel'],
  perOffice: PerOfficeEvaluation | undefined,
): Row {
  const isRetail = channel === 'Retail';
  const isWS = channel === 'Wholesale';
  const loans = channel === 'Combined' ? o.totalLoans : isRetail ? o.retailLoans : o.wsLoans;
  const dlq = channel === 'Combined' ? o.totalDLQ : isRetail ? o.retailDLQ : o.wsDLQ;
  const hudCR = channel === 'Combined' ? o.totalCR : isRetail ? o.retailCR : o.wsCR;
  // The evaluator returns portfolio-level (combined) HUD/Revised CR per
  // office. Retail/Wholesale rows show the office's channel-scoped
  // published CR + counts, but EG-fail Removed / Revised CR columns
  // reflect the whole-office evaluator response — labeled as such in the
  // expand row.
  const egRemoved = perOffice ? perOffice.n_removed : null;
  const revisedCR = perOffice ? perOffice.revised_cr : null;
  const deltaBps =
    hudCR !== null && revisedCR !== null
      ? Math.round((revisedCR - hudCR) * 100) / 100 * 100 // (Δ CR × 100) → bps
      : null;
  return {
    key: `${o.name}::${channel}`,
    name: o.name,
    channel,
    loans,
    dlq,
    hudCR,
    egRemoved,
    revisedCR,
    deltaBps: deltaBps === null ? null : Math.round(deltaBps),
    office: o,
  };
}

/**
 * Subtotal row builder. Loans + DLQ are additive across offices. Rates
 * (HUD CR, Revised CR, Δ bps) are omitted at subtotal level — v16 doesn't
 * roll them up either; the interpretation is "look at the individual
 * offices."
 */
function subtotal(rows: Row[], label: string, channel: Row['channel']): Row | null {
  const filtered = rows.filter(r => r.channel === channel);
  if (filtered.length === 0) return null;
  const loans = filtered.reduce((a, r) => a + (r.loans ?? 0), 0);
  const dlq = filtered.reduce((a, r) => a + (r.dlq ?? 0), 0);
  const egRemoved = filtered.every(r => r.egRemoved === null)
    ? null
    : filtered.reduce((a, r) => a + (r.egRemoved ?? 0), 0);
  return {
    key: `__subtotal::${label}`,
    name: label,
    channel,
    loans,
    dlq,
    hudCR: null,
    egRemoved,
    revisedCR: null,
    deltaBps: null,
    office: filtered[0].office, // never used; subtotal rows can't expand
  };
}

const SORT_KEY_ACCESSORS: Record<SortKey, (r: Row) => number | string | null> = {
  name: r => r.name,
  channel: r => r.channel,
  loans: r => r.loans,
  dlq: r => r.dlq,
  hudCR: r => r.hudCR,
  egRemoved: r => r.egRemoved,
  revisedCR: r => r.revisedCR,
  deltaBps: r => r.deltaBps,
};

function compareRows(a: Row, b: Row, key: SortKey, dir: SortDir): number {
  const av = SORT_KEY_ACCESSORS[key](a);
  const bv = SORT_KEY_ACCESSORS[key](b);
  // Nulls always sort last regardless of direction (they are worse
  // information, not worse values).
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  let cmp: number;
  if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return dir === 'asc' ? cmp : -cmp;
}

/**
 * Column-header cell with click-to-sort. Currently-sorted column shows an
 * arrow; click toggles asc/desc; click a different column resets to
 * "desc" for numeric columns and "asc" for name/channel.
 */
function SortHeader({
  label,
  colKey,
  currentKey,
  dir,
  onSort,
  align = 'right',
  className = '',
}: {
  label: string;
  colKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const isActive = colKey === currentKey;
  const arrow = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
  const alignCls = align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right';
  return (
    <th
      className={`matrix-header ${alignCls} cursor-pointer select-none whitespace-nowrap ${className}`}
      onClick={() => onSort(colKey)}
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      role="columnheader"
      data-testid={`sort-header-${colKey}`}
    >
      {label}
      <span className="text-muted-foreground">{arrow}</span>
    </th>
  );
}

/**
 * Row expand — the DQ-prevention answer. Shows:
 *   (a) driver breakdown by predicate from the evaluator's
 *       driver_breakdown field, sorted removal-count desc.
 *   (b) DLQ Breakdown by Channel 6-column block from v16
 *       (R Non-DPA / R Boost / R Other DPA / WS Non-DPA / WS Boost /
 *       WS Other DPA) — already on the OfficeSummary, no fetch needed.
 *   (c) Top 3 driver predicates by removal count.
 *
 * Loading + error states covered inline.
 */
function ExpandRow({
  office,
  perOffice,
  loading,
  error,
  onRetry,
  colSpan,
}: {
  office: OfficeSummary;
  perOffice: PerOfficeEvaluation | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  colSpan: number;
}) {
  const drivers = useMemo(() => {
    if (!perOffice) return [] as Array<{ key: string; count: number; label: string }>;
    return Object.entries(perOffice.driver_breakdown)
      .map(([k, v]) => ({ key: k, count: v as number, label: DRIVER_LABELS[k] ?? k }))
      .filter(d => (d.count ?? 0) > 0)
      .sort((a, b) => b.count - a.count);
  }, [perOffice]);

  const top3 = drivers.slice(0, 3);

  return (
    <tr data-testid={`expand-row-${office.name}`} className="bg-muted/30 border-b border-border">
      <td colSpan={colSpan} className="px-6 py-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="expand-loading">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading driver breakdown…
          </div>
        )}
        {error && !loading && (
          <div className="flex items-center gap-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-risk-red" />
            <span className="text-risk-red" data-testid="expand-error">Failed to load driver breakdown: {error}</span>
            <button
              onClick={onRetry}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        )}
        {!loading && !error && perOffice && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* (a) Driver breakdown */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-2">
                Driver breakdown
              </h4>
              <p className="text-[10px] text-muted-foreground mb-2">
                Loans this office lost to each registry predicate. Loans may appear in multiple categories.
              </p>
              {drivers.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No predicates fired at this office.</p>
              ) : (
                <ul className="text-xs space-y-1">
                  {drivers.map(d => (
                    <li key={d.key} className="flex justify-between gap-3">
                      <span className="text-foreground">{d.label}</span>
                      <span className="font-mono text-muted-foreground">{d.count} loans</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* (b) DLQ Breakdown by Channel — v16 6-column block */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-2">
                DLQ Breakdown by Channel
              </h4>
              <p className="text-[10px] text-muted-foreground mb-2">v16 workbook format.</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left font-normal text-muted-foreground py-1">Channel</th>
                    <th className="text-right font-normal text-muted-foreground">Non-DPA</th>
                    <th className="text-right font-normal text-muted-foreground">Boost</th>
                    <th className="text-right font-normal text-muted-foreground">Other DPA</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1 font-medium">Retail</td>
                    <td className="text-right font-mono">{office.retailNonDPADLQ}</td>
                    <td className="text-right font-mono text-risk-red">{office.retailBoostDLQ}</td>
                    <td className="text-right font-mono">{office.retailOtherDPADLQ}</td>
                  </tr>
                  <tr>
                    <td className="py-1 font-medium">Wholesale</td>
                    <td className="text-right font-mono">{office.wsNonDPADLQ}</td>
                    <td className="text-right font-mono text-risk-red">{office.wsBoostDLQ}</td>
                    <td className="text-right font-mono">{office.wsOtherDPADLQ}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* (c) Top 3 drivers */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-2">
                Top 3 drivers for this office
              </h4>
              <p className="text-[10px] text-muted-foreground mb-2">
                Ranked by removed-loan count.
              </p>
              {top3.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nothing fired.</p>
              ) : (
                <ol className="text-xs space-y-1 list-decimal list-inside">
                  {top3.map(d => (
                    <li key={d.key} data-testid={`top-driver-${d.key}`}>
                      <span className="text-foreground font-medium">{d.label}</span>
                      <span className="text-muted-foreground"> — {d.count} removed</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function PerformanceMatrix({ offices, title, emoji, filterFn, snapshotMonth }: Props) {
  // ── Filter + input transformation.
  const filteredOffices = useMemo(() => offices.filter(filterFn), [offices, filterFn]);

  // ── Channel filter (top of the table). "All" is the default; "Retail" or
  // "Wholesale" narrows to per-channel rows generated from the same
  // OfficeSummary set (each office splits into one Retail + one Wholesale
  // row when the channel filter is set — mirrors v16 workbook tabs).
  const [channelFilter, setChannelFilter] = useState<Channel>('All');

  // ── Sort.
  const [sortKey, setSortKey] = useState<SortKey>('hudCR');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // ── Expand state.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Client-side cache: driver-breakdown per_office keyed by office name.
  // Prevents refetch on collapse+re-expand.
  const [driverCache, setDriverCache] = useState<Map<string, PerOfficeEvaluation>>(new Map());
  const [expandLoading, setExpandLoading] = useState<Set<string>>(new Set());
  const [expandError, setExpandError] = useState<Map<string, string>>(new Map());

  // ── Top-level evaluate fetch (EG-fail Removed + Revised CR).
  const [topLevelResp, setTopLevelResp] = useState<EvaluateResponse | null>(null);
  const [topLevelLoading, setTopLevelLoading] = useState(true);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);

  const fetchTopLevel = useCallback(async () => {
    if (!snapshotMonth) return;
    setTopLevelLoading(true);
    setTopLevelError(null);
    try {
      const resp = await evaluate({
        snapshot_month: snapshotMonth,
        predicates: TOP_LEVEL_PREDICATES,
        composition_op: 'OR',
      });
      setTopLevelResp(resp);
    } catch (e) {
      setTopLevelError(e instanceof Error ? e.message : String(e));
    } finally {
      setTopLevelLoading(false);
    }
  }, [snapshotMonth]);

  useEffect(() => {
    void fetchTopLevel();
  }, [fetchTopLevel]);

  const perOfficeByName = useMemo(() => {
    const m = new Map<string, PerOfficeEvaluation>();
    if (!topLevelResp) return m;
    for (const po of topLevelResp.per_office) m.set(po.office_id, po);
    return m;
  }, [topLevelResp]);

  // ── Row model.
  const rows: Row[] = useMemo(() => {
    if (channelFilter === 'All') {
      return filteredOffices.map(o => makeRow(o, 'Combined', perOfficeByName.get(o.name)));
    }
    // Per-channel view mirrors v16 workbook Retail / Wholesale tabs.
    return filteredOffices.map(o =>
      makeRow(o, channelFilter as 'Retail' | 'Wholesale', perOfficeByName.get(o.name)),
    );
  }, [filteredOffices, channelFilter, perOfficeByName]);

  // ── Sorted office rows.
  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    return arr;
  }, [rows, sortKey, sortDir]);

  // ── Subtotals — computed from OfficeSummary (channel-scoped) so
  // Retail/Wholesale/Total each get their own row. Rendered under the
  // office rows, mirroring v16's Combined block footer.
  const subtotals = useMemo(() => {
    const retailRows: Row[] = filteredOffices.map(o => makeRow(o, 'Retail', undefined));
    const wsRows: Row[] = filteredOffices.map(o => makeRow(o, 'Wholesale', undefined));
    const combinedRows: Row[] = filteredOffices.map(o => makeRow(o, 'Combined', perOfficeByName.get(o.name)));
    return {
      retail: subtotal(retailRows, 'Retail subtotal', 'Retail'),
      wholesale: subtotal(wsRows, 'Wholesale subtotal', 'Wholesale'),
      total: subtotal(combinedRows, 'Total portfolio', 'Combined'),
    };
  }, [filteredOffices, perOfficeByName]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev !== key) {
        // First click on a numeric column → desc; on a text column → asc.
        setSortDir(key === 'name' || key === 'channel' ? 'asc' : 'desc');
        return key;
      }
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      return prev;
    });
  }, []);

  const toggleExpand = useCallback(
    async (officeName: string) => {
      const next = new Set(expanded);
      if (next.has(officeName)) {
        next.delete(officeName);
        setExpanded(next);
        return;
      }
      next.add(officeName);
      setExpanded(next);

      // Already cached → no fetch.
      if (driverCache.has(officeName)) return;

      // Lazy full-registry evaluate for this office's driver breakdown.
      const nextLoading = new Set(expandLoading);
      nextLoading.add(officeName);
      setExpandLoading(nextLoading);
      const nextErr = new Map(expandError);
      nextErr.delete(officeName);
      setExpandError(nextErr);
      try {
        const resp = await evaluate({
          snapshot_month: snapshotMonth,
          predicates: DRIVER_BREAKDOWN_PREDICATES,
          composition_op: 'OR',
        });
        const po = resp.per_office.find(p => p.office_id === officeName);
        if (po) {
          const cacheNext = new Map(driverCache);
          cacheNext.set(officeName, po);
          setDriverCache(cacheNext);
        } else {
          const errNext = new Map(expandError);
          errNext.set(officeName, 'Office not present in evaluator response.');
          setExpandError(errNext);
        }
      } catch (e) {
        const errNext = new Map(expandError);
        errNext.set(officeName, e instanceof Error ? e.message : String(e));
        setExpandError(errNext);
      } finally {
        setExpandLoading(prev => {
          const s = new Set(prev);
          s.delete(officeName);
          return s;
        });
      }
    },
    [expanded, driverCache, expandLoading, expandError, snapshotMonth],
  );

  const retryExpand = useCallback(
    (officeName: string) => {
      // Force a fresh fetch by removing the cache entry then re-toggling
      // (safe because we only call retryExpand from an expanded row).
      const cacheNext = new Map(driverCache);
      cacheNext.delete(officeName);
      setDriverCache(cacheNext);
      const s = new Set(expanded);
      s.delete(officeName);
      setExpanded(s);
      void toggleExpand(officeName);
    },
    [driverCache, expanded, toggleExpand],
  );

  const exportCSV = () => {
    const headers = ['Office', 'Channel', 'Loans', '60+DQ', 'HUD CR', 'EG-fail Removed', 'Revised CR', 'Δ bps'];
    const csvRows = sortedRows.map(r =>
      [r.name, r.channel, r.loans, r.dlq, r.hudCR ?? '', r.egRemoved ?? '', r.revisedCR ?? '', r.deltaBps ?? ''].join(','),
    );
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^a-zA-Z]/g, '_')}.csv`;
    a.click();
  };

  // 9 columns including the expand chevron col.
  const colSpan = 9;

  const renderRowCells = (r: Row, isSubtotal: boolean, isExpanded: boolean) => (
    <>
      <td className="matrix-cell text-center w-8">
        {!isSubtotal && (
          <button
            onClick={() => toggleExpand(r.name)}
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
            aria-label={isExpanded ? `Collapse ${r.name}` : `Expand ${r.name}`}
            data-testid={`expand-toggle-${r.name}`}
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}
      </td>
      <td className={`px-2 py-1.5 text-sm text-left whitespace-nowrap ${isSubtotal ? 'font-bold' : 'font-medium'}`}>
        {r.name}
      </td>
      <td className="matrix-cell text-center text-xs text-muted-foreground">{r.channel}</td>
      <td className="matrix-cell text-right font-medium">{r.loans}</td>
      <td className="matrix-cell text-right">{r.dlq}</td>
      <td className="matrix-cell text-right">{crBadge(r.hudCR)}</td>
      <td className="matrix-cell text-right text-risk-red">
        {r.egRemoved === null ? (
          topLevelLoading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : '—'
        ) : (
          r.egRemoved
        )}
      </td>
      <td className="matrix-cell text-right">{crBadge(r.revisedCR)}</td>
      <td className="matrix-cell text-right">{deltaBadge(r.deltaBps)}</td>
    </>
  );

  // ── Render.
  if (filteredOffices.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-6" data-testid="matrix-empty">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title">{emoji} {title}</h2>
        </div>
        <p className="text-sm text-muted-foreground italic">No offices in this band.</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-6" data-testid="performance-matrix">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">{emoji} {title}</h2>
        <div className="flex items-center gap-3">
          {/* Channel filter chips */}
          <div className="flex items-center gap-1 text-xs" role="group" aria-label="Channel filter">
            {(['All', 'Retail', 'Wholesale'] as Channel[]).map(c => (
              <button
                key={c}
                onClick={() => setChannelFilter(c)}
                className={`px-2 py-1 rounded border transition-colors ${
                  channelFilter === c
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
                data-testid={`channel-filter-${c}`}
                aria-pressed={channelFilter === c}
              >
                {c}
              </button>
            ))}
          </div>
          <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* Top-level error banner — evaluator down. Fall back to snapshot-only view. */}
      {topLevelError && (
        <div
          className="flex items-center gap-3 mb-3 px-3 py-2 border border-risk-red/30 bg-risk-red-bg rounded text-sm"
          data-testid="matrix-error"
        >
          <AlertTriangle className="w-4 h-4 text-risk-red" />
          <span className="text-risk-red flex-1">
            Couldn't load Enhanced Guidelines carve-out data: {topLevelError}
          </span>
          <button
            onClick={fetchTopLevel}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      <div className="overflow-x-auto max-h-[70vh] overflow-y-auto" data-testid="matrix-scroll">
        <table className="w-full text-sm">
          {/* Sticky header — position: sticky requires a scroll parent
              (the div above with overflow-y). Applied via CSS class. */}
          <thead className="sticky top-0 bg-card z-10 shadow-[0_1px_0_0_var(--border,#e2e8f0)]" data-testid="matrix-header">
            <tr className="border-b border-border">
              <th className="matrix-header w-8"></th>
              <SortHeader label="Office" colKey="name" currentKey={sortKey} dir={sortDir} onSort={handleSort} align="left" />
              <SortHeader label="Channel" colKey="channel" currentKey={sortKey} dir={sortDir} onSort={handleSort} align="center" />
              <SortHeader label="Loans" colKey="loans" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader label="60+DQ" colKey="dlq" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader label="HUD CR" colKey="hudCR" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader label="EG-fail Removed" colKey="egRemoved" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Revised CR" colKey="revisedCR" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Δ bps" colKey="deltaBps" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {topLevelLoading && !topLevelResp && (
              // Skeleton rows on first load. Same row structure so the
              // layout doesn't shift when data arrives.
              Array.from({ length: Math.min(5, filteredOffices.length) }).map((_, i) => (
                <tr key={`skeleton-${i}`} data-testid="matrix-skeleton" className="border-b border-border/50">
                  {Array.from({ length: colSpan }).map((__, j) => (
                    <td key={j} className="matrix-cell">
                      <div className="h-3 bg-muted rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            )}

            {(!topLevelLoading || topLevelResp) && sortedRows.flatMap(r => {
              const isExpanded = expanded.has(r.name);
              const nodes = [
                <tr
                  key={r.key}
                  className={`border-b border-border/50 hover:bg-muted/50 ${
                    r.office.isImproved ? 'row-highlight-green' : ''
                  }`}
                  data-testid={`office-row-${r.name}`}
                >
                  {renderRowCells(r, false, isExpanded)}
                </tr>,
              ];
              if (isExpanded) {
                nodes.push(
                  <ExpandRow
                    key={`${r.key}::expand`}
                    office={r.office}
                    perOffice={driverCache.get(r.name)}
                    loading={expandLoading.has(r.name)}
                    error={expandError.get(r.name) ?? null}
                    onRetry={() => retryExpand(r.name)}
                    colSpan={colSpan}
                  />,
                );
              }
              return nodes;
            })}

            {/* Subtotal rows — always at the bottom, distinct styling. */}
            {(!topLevelLoading || topLevelResp) && subtotals.retail && channelFilter !== 'Wholesale' && (
              <tr className="border-t-2 border-border bg-muted/40 font-semibold" data-testid="subtotal-retail">
                {renderRowCells(subtotals.retail, true, false)}
              </tr>
            )}
            {(!topLevelLoading || topLevelResp) && subtotals.wholesale && channelFilter !== 'Retail' && (
              <tr className="border-b border-border bg-muted/40 font-semibold" data-testid="subtotal-wholesale">
                {renderRowCells(subtotals.wholesale, true, false)}
              </tr>
            )}
            {(!topLevelLoading || topLevelResp) && subtotals.total && channelFilter === 'All' && (
              <tr className="border-t border-border bg-muted/60 font-bold" data-testid="subtotal-total">
                {renderRowCells(subtotals.total, true, false)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
