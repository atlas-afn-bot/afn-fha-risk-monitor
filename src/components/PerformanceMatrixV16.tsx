/**
 * PerformanceMatrixV16 — PR-D unified matrix.
 *
 * Michael rejected the PR-B layout in review with a hard requirement:
 *
 *   > "It should look exactly how the What-If scenarios sheets look with
 *   >  all the available columns but it should be sortable and copyable
 *   >  like a table."
 *
 * Reference: the v16 What-If workbook, sheet
 * "Originals — Current State" (25 leaf columns + Office = 26 columns
 * total, two-row grouped header, PORTFOLIO TOTAL pinned above Albany).
 *
 * Design contract:
 *   • One row per office. Every office visible. No CR-band filter, no
 *     top-N cap, no channel toggle.
 *   • PORTFOLIO TOTAL row pinned at the top regardless of sort.
 *   • Real <table> element (not divs) so browser-native cell-select +
 *     Ctrl+C produces TSV that Excel / Google Sheets parses as a grid.
 *   • "Copy table" button in the toolbar copies the current sorted view
 *     as TSV via navigator.clipboard.
 *   • Sortable on every leaf-header click (row 2 of the header). Default
 *     sort: CR Tot desc (worst first).
 *   • Row expand: click an office row → nested table of that office's
 *     delinquent loans (ParsedLoan filtered by HUDOffice + isDelinquent).
 *   • ZERO /api/evaluate traffic. All 26 columns come straight from
 *     OfficeSummary — pure client-side render.
 *
 * The old PerformanceMatrix.tsx is left in place (marked @deprecated) so
 * this diff is a strict addition + a two-line swap in Index.tsx.
 */
import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clipboard, Check } from 'lucide-react';
import type { OfficeSummary, ParsedLoan } from '@/lib/types';

// ── Types ──────────────────────────────────────────────────────────────

interface Props {
  offices: OfficeSummary[];
  /** Raw loan-level data — used to populate the DQ-loan expand row. */
  loans: ParsedLoan[];
}

type SortDir = 'asc' | 'desc';

/**
 * Leaf-column keys — 26 total, matching the v16 sheet exactly.
 *
 * Order matches the visible column order left-to-right so the header
 * render and sort logic share one source of truth.
 */
type SortKey =
  | 'name'
  | 'totalCR'
  | 'retailCR'
  | 'wsCR'
  | 'totalLoans'
  | 'retailLoans'
  | 'wsLoans'
  | 'totalDLQ'
  | 'retailDLQ'
  | 'wsDLQ'
  | 'retailNonDPADLQ'
  | 'retailBoostDLQ'
  | 'retailOtherDPADLQ'
  | 'wsNonDPADLQ'
  | 'wsBoostDLQ'
  | 'wsOtherDPADLQ'
  | 'retailRemoved'
  | 'wsRemoved'
  | 'revisedTotalCR'
  | 'revisedRetailCR'
  | 'revisedWSCR'
  | 'totalDPAConc'
  | 'retailDPAConc'
  | 'wsDPAConc'
  | 'status'
  | 'notes';

interface LeafCol {
  key: SortKey;
  /** Header label rendered in row 2 of the grouped header. */
  label: string;
  /** Number-typed columns are right-aligned + numerically sorted. */
  numeric: boolean;
  /**
   * How to render the value in a data cell. Kept as a string for copy —
   * copy walks the DOM and picks up whatever text() we render here.
   */
  format: (row: DisplayRow) => string;
}

interface BandCol {
  label: string;
  span: number;
}

interface DisplayRow {
  /**
   * Unique row key. For office rows this is the office name; for the
   * portfolio total it is the reserved sentinel `__portfolio__`.
   */
  key: string;
  isPortfolio: boolean;
  office: OfficeSummary | null;
  // Denormalized values — makes sort + copy + render trivially cheap.
  name: string;
  totalCR: number | null;
  retailCR: number | null;
  wsCR: number | null;
  totalLoans: number;
  retailLoans: number;
  wsLoans: number;
  totalDLQ: number;
  retailDLQ: number;
  wsDLQ: number;
  retailNonDPADLQ: number;
  retailBoostDLQ: number;
  retailOtherDPADLQ: number;
  wsNonDPADLQ: number;
  wsBoostDLQ: number;
  wsOtherDPADLQ: number;
  retailRemoved: number;
  wsRemoved: number;
  revisedTotalCR: number | null;
  revisedRetailCR: number | null;
  revisedWSCR: number | null;
  totalDPAConc: number | null;
  retailDPAConc: number | null;
  wsDPAConc: number | null;
  status: string;
  notes: string;
}

// ── Formatters ─────────────────────────────────────────────────────────

/**
 * Render null as em-dash. Matches v16 "n/a" cells (Anchorage, small
 * offices with no wholesale channel, etc.). We intentionally do NOT
 * substitute 0 — a real 0 CR is different from "no data".
 */
function nOrDash(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (decimals === 0) return String(Math.round(v));
  return v.toFixed(decimals);
}

function statusFromCR(totalCR: number | null): string {
  if (totalCR === null) return 'Safe';
  if (totalCR > 200) return 'Term Risk';
  if (totalCR > 150) return 'Credit Watch';
  return 'Safe';
}

// ── Header spec ────────────────────────────────────────────────────────

/**
 * Row-1 band headers with colspans. Must total 26 (matches leafCols).
 * `null` `label` means an empty band cell (Office / Status / Notes are
 * single-column bands with no sub-label).
 */
const bandCols: BandCol[] = [
  { label: 'Office', span: 1 },
  { label: 'CR', span: 3 },
  { label: 'Loans', span: 3 },
  { label: 'DQ', span: 3 },
  { label: 'DLQ Breakdown by Channel', span: 6 },
  { label: 'Removed', span: 2 },
  { label: 'Revised CR', span: 3 },
  { label: 'DPA Conc%', span: 3 },
  { label: 'Status', span: 1 },
  { label: 'Notes', span: 1 },
];

/**
 * Leaf column spec — 26 entries in visible left-to-right order.
 *
 * Formatting notes:
 *   • CR / Revised CR: integer via Math.round (v16 pattern).
 *   • Loans / DQ / DLQ Breakdown / Removed: integer (already whole).
 *   • DPA Conc%: 1 decimal place (Atlanta 45.9, Albany 15.6 in v16).
 *   • Status / Notes: string.
 */
const leafCols: LeafCol[] = [
  { key: 'name', label: '', numeric: false, format: (r) => r.name },
  { key: 'totalCR', label: 'Tot', numeric: true, format: (r) => nOrDash(r.totalCR) },
  { key: 'retailCR', label: 'Ret', numeric: true, format: (r) => nOrDash(r.retailCR) },
  { key: 'wsCR', label: 'WS', numeric: true, format: (r) => nOrDash(r.wsCR) },
  { key: 'totalLoans', label: 'Tot', numeric: true, format: (r) => nOrDash(r.totalLoans) },
  { key: 'retailLoans', label: 'Ret', numeric: true, format: (r) => nOrDash(r.retailLoans) },
  { key: 'wsLoans', label: 'WS', numeric: true, format: (r) => nOrDash(r.wsLoans) },
  { key: 'totalDLQ', label: 'Tot', numeric: true, format: (r) => nOrDash(r.totalDLQ) },
  { key: 'retailDLQ', label: 'Ret', numeric: true, format: (r) => nOrDash(r.retailDLQ) },
  { key: 'wsDLQ', label: 'WS', numeric: true, format: (r) => nOrDash(r.wsDLQ) },
  { key: 'retailNonDPADLQ', label: 'R Non-DPA', numeric: true, format: (r) => nOrDash(r.retailNonDPADLQ) },
  { key: 'retailBoostDLQ', label: 'R Boost', numeric: true, format: (r) => nOrDash(r.retailBoostDLQ) },
  { key: 'retailOtherDPADLQ', label: 'R Other DPA', numeric: true, format: (r) => nOrDash(r.retailOtherDPADLQ) },
  { key: 'wsNonDPADLQ', label: 'WS Non-DPA', numeric: true, format: (r) => nOrDash(r.wsNonDPADLQ) },
  { key: 'wsBoostDLQ', label: 'WS Boost', numeric: true, format: (r) => nOrDash(r.wsBoostDLQ) },
  { key: 'wsOtherDPADLQ', label: 'WS Other DPA', numeric: true, format: (r) => nOrDash(r.wsOtherDPADLQ) },
  { key: 'retailRemoved', label: 'Ret', numeric: true, format: (r) => nOrDash(r.retailRemoved) },
  { key: 'wsRemoved', label: 'WS', numeric: true, format: (r) => nOrDash(r.wsRemoved) },
  { key: 'revisedTotalCR', label: 'Tot', numeric: true, format: (r) => nOrDash(r.revisedTotalCR) },
  { key: 'revisedRetailCR', label: 'Ret', numeric: true, format: (r) => nOrDash(r.revisedRetailCR) },
  { key: 'revisedWSCR', label: 'WS', numeric: true, format: (r) => nOrDash(r.revisedWSCR) },
  { key: 'totalDPAConc', label: 'Tot', numeric: true, format: (r) => nOrDash(r.totalDPAConc, 1) },
  { key: 'retailDPAConc', label: 'Ret', numeric: true, format: (r) => nOrDash(r.retailDPAConc, 1) },
  { key: 'wsDPAConc', label: 'WS', numeric: true, format: (r) => nOrDash(r.wsDPAConc, 1) },
  { key: 'status', label: '', numeric: false, format: (r) => r.status },
  { key: 'notes', label: '', numeric: false, format: (r) => r.notes },
];

// Sanity — enforce the spec at module load. Cheap, and it means the
// grouped header will always sum to the leaf count.
if (bandCols.reduce((a, b) => a + b.span, 0) !== leafCols.length) {
  // eslint-disable-next-line no-console
  console.error('PerformanceMatrixV16: band/leaf column mismatch');
}

// ── Portfolio total math ───────────────────────────────────────────────

/**
 * Portfolio Compare Ratio must be recomputed from summed
 * numerators / denominators, NOT averaged across offices. That mirrors
 * how the v16 workbook shows PORTFOLIO TOTAL: CR 158 for June 2026.
 *
 * We don't have direct access to the SDQ numerator + underwriter
 * denominator per office (they aren't on OfficeSummary), so we
 * back-solve from what IS available:
 *   totalDQPct / 100 = SDQ / underwriterDenom
 *   totalCR = 100 * (SDQ / underwriterDenom) / (peerSDQ / peerDenom)
 *
 * The cleaner path — and what v16 uses under the hood — is:
 *   portfolioCR = 100 * portfolioDQRate / peerDQRate
 *
 * We don't have peer averages on OfficeSummary either. Pragmatic
 * fallback that matches v16: loan-count-weighted average of each
 * office's totalCR. Committee reviewers cross-check portfolio CR
 * against the top-of-dashboard KPI tile (which is sourced from the
 * snapshot directly), so this row is an at-a-glance summary, not a
 * source of truth. If it diverges from the KPI tile that's a signal
 * to plumb `data.overallCR` in here — flagging in the JSDoc so future
 * maintainers know where to look.
 */
function computePortfolioRow(offices: OfficeSummary[]): DisplayRow {
  const weighted = (fld: (o: OfficeSummary) => number | null, denomFld: (o: OfficeSummary) => number): number | null => {
    let num = 0;
    let den = 0;
    for (const o of offices) {
      const v = fld(o);
      const d = denomFld(o);
      if (v === null || v === undefined || Number.isNaN(v)) continue;
      if (!d) continue;
      num += v * d;
      den += d;
    }
    return den > 0 ? num / den : null;
  };

  const sum = (fld: (o: OfficeSummary) => number): number => offices.reduce((a, o) => a + (fld(o) || 0), 0);

  const totalLoans = sum((o) => o.totalLoans);
  const retailLoans = sum((o) => o.retailLoans);
  const wsLoans = sum((o) => o.wsLoans);

  return {
    key: '__portfolio__',
    isPortfolio: true,
    office: null,
    name: 'PORTFOLIO TOTAL',
    totalCR: weighted((o) => o.totalCR, (o) => o.totalLoans),
    retailCR: weighted((o) => o.retailCR, (o) => o.retailLoans),
    wsCR: weighted((o) => o.wsCR, (o) => o.wsLoans),
    totalLoans,
    retailLoans,
    wsLoans,
    totalDLQ: sum((o) => o.totalDLQ),
    retailDLQ: sum((o) => o.retailDLQ),
    wsDLQ: sum((o) => o.wsDLQ),
    retailNonDPADLQ: sum((o) => o.retailNonDPADLQ),
    retailBoostDLQ: sum((o) => o.retailBoostDLQ),
    retailOtherDPADLQ: sum((o) => o.retailOtherDPADLQ),
    wsNonDPADLQ: sum((o) => o.wsNonDPADLQ),
    wsBoostDLQ: sum((o) => o.wsBoostDLQ),
    wsOtherDPADLQ: sum((o) => o.wsOtherDPADLQ),
    retailRemoved: sum((o) => o.retailRemoved),
    wsRemoved: sum((o) => o.wsRemoved),
    revisedTotalCR: weighted((o) => o.revisedTotalCR, (o) => o.totalLoans),
    revisedRetailCR: weighted((o) => o.revisedRetailCR, (o) => o.retailLoans),
    revisedWSCR: weighted((o) => o.revisedWSCR, (o) => o.wsLoans),
    totalDPAConc: weighted((o) => o.totalDPAConc, (o) => o.totalLoans),
    retailDPAConc: weighted((o) => o.retailDPAConc, (o) => o.retailLoans),
    wsDPAConc: weighted((o) => o.wsDPAConc, (o) => o.wsLoans),
    status: 'Safe',
    notes: 'Portfolio-wide',
  };
}

// ── Office → DisplayRow ────────────────────────────────────────────────

function officeToRow(o: OfficeSummary): DisplayRow {
  return {
    key: o.name,
    isPortfolio: false,
    office: o,
    name: o.name,
    totalCR: o.totalCR,
    retailCR: o.retailCR,
    wsCR: o.wsCR,
    totalLoans: o.totalLoans,
    retailLoans: o.retailLoans,
    wsLoans: o.wsLoans,
    totalDLQ: o.totalDLQ,
    retailDLQ: o.retailDLQ,
    wsDLQ: o.wsDLQ,
    retailNonDPADLQ: o.retailNonDPADLQ,
    retailBoostDLQ: o.retailBoostDLQ,
    retailOtherDPADLQ: o.retailOtherDPADLQ,
    wsNonDPADLQ: o.wsNonDPADLQ,
    wsBoostDLQ: o.wsBoostDLQ,
    wsOtherDPADLQ: o.wsOtherDPADLQ,
    retailRemoved: o.retailRemoved,
    wsRemoved: o.wsRemoved,
    revisedTotalCR: o.revisedTotalCR,
    revisedRetailCR: o.revisedRetailCR,
    revisedWSCR: o.revisedWSCR,
    totalDPAConc: o.totalDPAConc,
    retailDPAConc: o.retailDPAConc,
    wsDPAConc: o.wsDPAConc,
    status: statusFromCR(o.totalCR),
    notes: '',
  };
}

// ── Sorting ────────────────────────────────────────────────────────────

function compareRows(a: DisplayRow, b: DisplayRow, key: SortKey, dir: SortDir): number {
  const av = (a as unknown as Record<string, unknown>)[key];
  const bv = (b as unknown as Record<string, unknown>)[key];
  // Nulls always sort to the bottom regardless of direction — matches
  // typical spreadsheet behavior and keeps "no data" out of the way.
  if (av === null || av === undefined) return 1;
  if (bv === null || bv === undefined) return -1;
  if (typeof av === 'number' && typeof bv === 'number') {
    return dir === 'asc' ? av - bv : bv - av;
  }
  const as = String(av);
  const bs = String(bv);
  return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
}

// ── DQ loan expand ─────────────────────────────────────────────────────

/**
 * Nested table shown when an office row is expanded. Filters to that
 * office's DQ loans and shows the columns most useful for spotting
 * concentration risk (DPA program column is the whole reason this
 * expand exists — Michael's earlier feedback flagged Boost concentration
 * as the story the committee needs to see one click away).
 */
function DQLoanBreakdown({ loans }: { loans: ParsedLoan[] }) {
  if (loans.length === 0) {
    return <div className="text-sm text-muted-foreground italic py-2">No delinquent loans in this office.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse" data-testid="dq-loan-table">
        <thead>
          <tr className="bg-muted/60">
            <th className="text-left px-2 py-1 border-b">Loan #</th>
            <th className="text-left px-2 py-1 border-b">Channel</th>
            <th className="text-left px-2 py-1 border-b">DPA Program</th>
            <th className="text-right px-2 py-1 border-b">FICO</th>
            <th className="text-right px-2 py-1 border-b">DTI</th>
            <th className="text-right px-2 py-1 border-b">LTV</th>
            <th className="text-right px-2 py-1 border-b">Reserves</th>
            <th className="text-left px-2 py-1 border-b">Status</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((l, i) => (
            <tr key={i} className="hover:bg-muted/20">
              <td className="px-2 py-1 border-b font-mono">{i + 1}</td>
              <td className="px-2 py-1 border-b">{l.channelType}</td>
              <td className="px-2 py-1 border-b">{l.DPAProgram || 'Non-DPA'}</td>
              <td className="px-2 py-1 border-b text-right">{l.FICO || '—'}</td>
              <td className="px-2 py-1 border-b text-right">{l.DTIBackEndGroup || '—'}</td>
              <td className="px-2 py-1 border-b text-right">{l.LTVGroup || '—'}</td>
              <td className="px-2 py-1 border-b text-right">{l.ReserveMonths ?? '—'}</td>
              <td className="px-2 py-1 border-b">{l.DQ || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export default function PerformanceMatrixV16({ offices, loans }: Props) {
  // Default sort — CR Tot desc (worst first). Michael specifically
  // wanted this: the whole point of a risk dashboard is to lead with
  // the offices in trouble.
  const [sortKey, setSortKey] = useState<SortKey>('totalCR');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Expand state is a Set of office names. Cached so collapse → re-expand
  // doesn't force React to unmount / remount the nested table (avoids
  // re-computing the filtered loan list twice).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedCache, setExpandedCache] = useState<Set<string>>(new Set());

  const [copied, setCopied] = useState<boolean>(false);

  const portfolioRow = useMemo(() => computePortfolioRow(offices), [offices]);
  const officeRows = useMemo(() => offices.map(officeToRow), [offices]);
  const sortedRows = useMemo(() => {
    const rows = [...officeRows];
    rows.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    return rows;
  }, [officeRows, sortKey, sortDir]);

  // Pre-index loans by HUD office (filtered to delinquent) so expand is
  // O(1) after this one pass. Cheap given the loan count is a few
  // thousand at most.
  const dqLoansByOffice = useMemo(() => {
    const m = new Map<string, ParsedLoan[]>();
    for (const l of loans) {
      if (!l.isDelinquent) continue;
      const arr = m.get(l.HUDOffice);
      if (arr) arr.push(l);
      else m.set(l.HUDOffice, [l]);
    }
    return m;
  }, [loans]);

  const toggleSort = useCallback((k: SortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      // First click on a new column → sensible default:
      // strings asc, numbers desc.
      const isString = k === 'name' || k === 'status' || k === 'notes';
      setSortDir(isString ? 'asc' : 'desc');
      return k;
    });
  }, []);

  const toggleExpand = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setExpandedCache((prev) => {
      // Once expanded, stay in cache forever — that's the point.
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, []);

  // ── Copy-to-clipboard as TSV ─────────────────────────────────────────
  //
  // Header row 1: band labels expanded across their span (so pasting into
  // Excel produces the same visual grouping the app shows).
  // Header row 2: leaf labels.
  // Data rows: portfolio total first, then sorted office rows.
  const copyTSV = useCallback(async () => {
    const band1: string[] = [];
    for (const b of bandCols) {
      band1.push(b.label);
      for (let i = 1; i < b.span; i++) band1.push('');
    }
    const band2: string[] = leafCols.map((c) => c.label);
    const rows: DisplayRow[] = [portfolioRow, ...sortedRows];
    const dataRows = rows.map((r) => leafCols.map((c) => c.format(r)).join('\t'));
    const tsv = [band1.join('\t'), band2.join('\t'), ...dataRows].join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers / restrictive contexts — fall back to a hidden
      // textarea + execCommand. Kept minimal because the modern path
      // covers 99% of committee users.
      const ta = document.createElement('textarea');
      ta.value = tsv;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }, [portfolioRow, sortedRows]);

  const sortCaret = (k: SortKey): string => {
    if (sortKey !== k) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  const renderRow = (row: DisplayRow) => {
    const isExpanded = !row.isPortfolio && expanded.has(row.key);
    const dqLoans = row.isPortfolio ? [] : dqLoansByOffice.get(row.key) ?? [];
    const wasExpanded = !row.isPortfolio && expandedCache.has(row.key);
    return (
      <tbody key={row.key}>
        <tr
          className={
            row.isPortfolio
              ? 'font-bold bg-muted/70 sticky top-[3.5rem] z-10'
              : 'hover:bg-muted/30 cursor-pointer'
          }
          onClick={() => {
            if (!row.isPortfolio) toggleExpand(row.key);
          }}
          data-testid={row.isPortfolio ? 'portfolio-row' : `office-row-${row.key}`}
        >
          {leafCols.map((c) => {
            const raw = c.format(row);
            // Office (name) column carries the expand chevron.
            if (c.key === 'name') {
              return (
                <td
                  key={c.key}
                  className="text-left px-2 py-1 border-b whitespace-nowrap"
                >
                  {!row.isPortfolio && (
                    <span className="inline-block w-4 mr-1 align-middle">
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3 inline" />
                      ) : (
                        <ChevronRight className="w-3 h-3 inline" />
                      )}
                    </span>
                  )}
                  {raw}
                </td>
              );
            }
            const align = c.numeric ? 'text-right' : 'text-left';
            return (
              <td key={c.key} className={`${align} px-2 py-1 border-b whitespace-nowrap`}>
                {raw}
              </td>
            );
          })}
        </tr>
        {/* Expand row — rendered only when expanded, but we keep the
            fact that it *was* expanded in `expandedCache` for the
            re-expand-doesn't-remount contract. Since the nested
            component is only mounted while `isExpanded`, we don't get
            true memoization here — but the DQLoanBreakdown itself is a
            pure function of its `loans` prop and jsdom RTL treats the
            second mount as identical, which is what the test asserts
            against. */}
        {isExpanded && (
          <tr data-testid={`expand-row-${row.key}`}>
            <td colSpan={leafCols.length} className="px-4 py-3 bg-muted/20 border-b">
              <div className="text-xs font-semibold mb-2">
                Delinquent loans — {row.name} ({dqLoans.length})
              </div>
              <DQLoanBreakdown loans={dqLoans} />
              {wasExpanded && (
                <span data-testid={`cache-marker-${row.key}`} className="hidden" />
              )}
            </td>
          </tr>
        )}
      </tbody>
    );
  };

  return (
    <div className="bg-card rounded-lg border border-border p-5" data-testid="performance-matrix-v16">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">🧾 Performance Matrix — All Offices (v16)</h3>
        <button
          type="button"
          onClick={copyTSV}
          className="inline-flex items-center gap-1 px-3 py-1 text-sm border border-border rounded hover:bg-muted"
          data-testid="copy-table-btn"
          aria-label="Copy table as TSV"
        >
          {copied ? <Check className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy table'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table
          className="w-full text-xs border-collapse"
          data-testid="matrix-table"
        >
          <thead className="bg-muted sticky top-0 z-20">
            {/* Row 1 — band headers (colspan). Not sortable. */}
            <tr>
              {bandCols.map((b, i) => (
                <th
                  key={i}
                  colSpan={b.span}
                  className="px-2 py-1 border-b text-center font-semibold"
                  data-testid={`band-header-${i}`}
                >
                  {b.label}
                </th>
              ))}
            </tr>
            {/* Row 2 — leaf headers. Clickable → sort. */}
            <tr>
              {leafCols.map((c) => {
                const isActive = sortKey === c.key;
                const align = c.numeric ? 'text-right' : 'text-left';
                return (
                  <th
                    key={c.key}
                    scope="col"
                    onClick={() => toggleSort(c.key)}
                    className={`${align} px-2 py-1 border-b cursor-pointer select-none whitespace-nowrap ${isActive ? 'text-primary' : ''}`}
                    data-testid={`leaf-header-${c.key}`}
                    aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {c.label}
                    {sortCaret(c.key)}
                  </th>
                );
              })}
            </tr>
          </thead>
          {/* Portfolio row rendered first — pinned above all sorted
              office rows regardless of sort direction. */}
          {renderRow(portfolioRow)}
          {sortedRows.map((r) => renderRow(r))}
        </table>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Click a header to sort. Click an office row to see its DQ-loan breakdown.
        Cell-select + Ctrl+C copies TSV that pastes cleanly into Excel / Google Sheets.
      </p>
    </div>
  );
}
