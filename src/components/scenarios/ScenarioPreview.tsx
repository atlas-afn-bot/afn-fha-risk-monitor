/**
 * Live preview for the Scenario Builder + Detail views.
 *
 * Design doc §5.4: "Live n_removed counter. On edit, debounce ~500 ms and
 * hit `POST /api/evaluate` for preview." Mirrors PR-B's Performance Matrix
 * subtotal shape (Retail / Wholesale / Total) — we render subtotal-style
 * KPIs plus a per-office mini-table with driver-breakdown expand rows.
 *
 * The evaluator is server-authoritative for CR math (design §3). The
 * component only formats. Retail/Wholesale subtotal split is done in the
 * component by grouping `per_office` by `office_id` naming convention —
 * the evaluator does not distinguish channel today, so we compute the
 * two subtotals off the same per-office array using the office metadata
 * passed by the parent. If we don't have that metadata (which is common
 * for the client-only v1), we fall back to a single **Total** subtotal.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluate } from '@/lib/evaluateApi';
import type { EvaluateResponse, EvaluatePredicateSpec, CompositionOp } from '@/lib/evaluateApi';
import { predicateLabel } from '@/lib/scenarios/registry';
import { ChevronRight, ChevronDown, Loader2, AlertTriangle } from 'lucide-react';

export interface ScenarioPreviewProps {
  snapshotMonth: string;
  predicates: EvaluatePredicateSpec[];
  compositionOp: CompositionOp;
  /**
   * Debounce delay for the evaluate call. Default 500ms per design §5.4.
   * Tests override to 0.
   */
  debounceMs?: number;
  /**
   * Optional office-channel classifier so we can split subtotals into
   * Retail vs Wholesale. Returns 'retail' | 'wholesale' | 'both' per
   * office_id. When absent, only a Total subtotal renders.
   */
  channelFor?: (officeId: string) => 'retail' | 'wholesale' | 'both';
}

function fmtCR(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1) : '—';
}
function fmtDelta(bps: number): string {
  if (!Number.isFinite(bps)) return '—';
  const sign = bps > 0 ? '+' : '';
  return `${sign}${bps}`;
}

function crBadgeClass(cr: number): string {
  if (cr >= 200) return 'text-risk-red font-bold';
  if (cr >= 150) return 'text-risk-yellow font-semibold';
  return 'text-risk-green';
}

function subtotalNRemoved(perOffice: EvaluateResponse['per_office']): number {
  return perOffice.reduce((a, po) => a + po.n_removed, 0);
}

export function ScenarioPreview(props: ScenarioPreviewProps): JSX.Element {
  const { snapshotMonth, predicates, compositionOp, debounceMs = 500, channelFor } = props;
  const [data, setData] = useState<EvaluateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedOffice, setExpandedOffice] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    // No predicates → clear preview.
    if (predicates.length === 0) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const res = await evaluate({
          snapshot_month: snapshotMonth,
          predicates,
          composition_op: compositionOp === 'WEIGHTED' ? 'OR' : compositionOp,
        });
        if (mine !== seq.current) return;
        setData(res);
      } catch (e) {
        if (mine !== seq.current) return;
        setError(e instanceof Error ? e.message : 'evaluate failed');
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [snapshotMonth, JSON.stringify(predicates), compositionOp, debounceMs]);

  const subtotals = useMemo(() => {
    if (!data) return null;
    const total = { n_offices: data.per_office.length, n_removed: subtotalNRemoved(data.per_office) };
    if (!channelFor) return { total, retail: null as null | typeof total, wholesale: null as null | typeof total };
    const retail: typeof total = { n_offices: 0, n_removed: 0 };
    const wholesale: typeof total = { n_offices: 0, n_removed: 0 };
    for (const po of data.per_office) {
      const ch = channelFor(po.office_id);
      if (ch === 'retail' || ch === 'both') {
        retail.n_offices += 1;
        retail.n_removed += po.n_removed;
      }
      if (ch === 'wholesale' || ch === 'both') {
        wholesale.n_offices += 1;
        wholesale.n_removed += po.n_removed;
      }
    }
    return { total, retail, wholesale };
  }, [data, channelFor]);

  if (predicates.length === 0) {
    return (
      <div
        data-testid="scenario-preview-empty"
        className="rounded-lg border border-dashed border-border p-6 text-xs text-muted-foreground"
      >
        Add a predicate from the left rail to see the live preview.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="scenario-preview">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold">Live preview</h3>
        {loading && (
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
            <span>Evaluating…</span>
          </div>
        )}
      </div>

      {error && (
        <div
          data-testid="scenario-preview-error"
          className="rounded-md border border-risk-red/40 bg-risk-red-bg p-3 text-xs text-risk-red inline-flex items-start gap-2"
        >
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden />
          <span>Couldn't evaluate scenario: {error}</span>
        </div>
      )}

      {data && (
        <>
          {/* Top-line KPIs (Current CR, Revised CR, Δbps, n_removed, offices over 150). */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI label="Current CR" value={fmtCR(data.cr_current)} valueClass={crBadgeClass(data.cr_current)} testid="kpi-cr-current" />
            <KPI label="Revised CR" value={fmtCR(data.cr_revised)} valueClass={crBadgeClass(data.cr_revised)} testid="kpi-cr-revised" />
            <KPI label="Δ bps" value={fmtDelta(data.delta_bps)} testid="kpi-delta-bps" />
            <KPI label="Loans removed" value={data.n_removed.toLocaleString()} testid="kpi-n-removed" />
            <KPI
              label="Offices ≥150 (rev)"
              value={`${data.offices_over_150_revised} / ${data.offices_over_150_current}`}
              testid="kpi-offices-over-150"
            />
          </div>

          {/* Subtotal row — mirrors PR-B Retail/Wholesale/Total shape. */}
          <div
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
            data-testid="scenario-preview-subtotals"
          >
            {subtotals?.retail && (
              <SubtotalCard label="Retail" data-testid="subtotal-retail" n={subtotals.retail.n_removed} offices={subtotals.retail.n_offices} />
            )}
            {subtotals?.wholesale && (
              <SubtotalCard label="Wholesale" data-testid="subtotal-wholesale" n={subtotals.wholesale.n_removed} offices={subtotals.wholesale.n_offices} />
            )}
            <SubtotalCard label="Total" data-testid="subtotal-total" n={subtotals?.total.n_removed ?? 0} offices={subtotals?.total.n_offices ?? 0} />
          </div>

          {/* Per-office mini-table. Design §5.4 "per-office panel is a filtered Phase-2 matrix". */}
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-2 py-1.5 font-semibold w-8" aria-hidden />
                  <th className="text-left px-2 py-1.5 font-semibold">Office</th>
                  <th className="text-right px-2 py-1.5 font-semibold">HUD CR</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Revised CR</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Loans</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Removed</th>
                </tr>
              </thead>
              <tbody>
                {data.per_office
                  .slice()
                  .sort((a, b) => b.hud_cr - a.hud_cr)
                  .map((po) => (
                    <PreviewRow
                      key={po.office_id}
                      row={po}
                      expanded={expandedOffice === po.office_id}
                      onToggle={() =>
                        setExpandedOffice((cur) => (cur === po.office_id ? null : po.office_id))
                      }
                    />
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function KPI({ label, value, valueClass, testid }: { label: string; value: string; valueClass?: string; testid?: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${valueClass ?? ''}`}>{value}</div>
    </div>
  );
}

function SubtotalCard(props: { label: string; n: number; offices: number; 'data-testid'?: string }) {
  return (
    <div
      className="rounded-md border border-border px-3 py-2 bg-muted/10"
      data-testid={props['data-testid']}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{props.label} subtotal</div>
      <div className="text-sm font-semibold">
        {props.n.toLocaleString()} <span className="text-muted-foreground font-normal">loans removed · {props.offices} office{props.offices === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}

function PreviewRow({
  row,
  expanded,
  onToggle,
}: {
  row: EvaluateResponse['per_office'][number];
  expanded: boolean;
  onToggle: () => void;
}) {
  const drivers = Object.entries(row.driver_breakdown ?? {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  return (
    <>
      <tr className="border-t border-border" data-testid={`preview-row-${row.office_id}`}>
        <td className="px-2 py-1.5">
          <button
            type="button"
            className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-muted"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse driver breakdown' : 'Expand driver breakdown'}
            data-testid={`preview-expand-${row.office_id}`}
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        </td>
        <td className="px-2 py-1.5 font-medium">{row.office_id}</td>
        <td className={`px-2 py-1.5 text-right ${crBadgeClass(row.hud_cr)}`}>{fmtCR(row.hud_cr)}</td>
        <td className={`px-2 py-1.5 text-right ${crBadgeClass(row.revised_cr)}`}>{fmtCR(row.revised_cr)}</td>
        <td className="px-2 py-1.5 text-right">{row.n_loans.toLocaleString()}</td>
        <td className="px-2 py-1.5 text-right font-semibold">{row.n_removed.toLocaleString()}</td>
      </tr>
      {expanded && (
        <tr className="bg-muted/20" data-testid={`preview-expand-row-${row.office_id}`}>
          <td colSpan={6} className="px-2 py-2">
            <div className="text-[11px] text-muted-foreground mb-1">
              Driver breakdown ({drivers.length} predicates fired). Loans may appear in multiple categories.
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
              {drivers.length === 0 ? (
                <div className="col-span-full italic text-muted-foreground">No drivers fired.</div>
              ) : (
                drivers.map(([id, n]) => (
                  <div key={id} className="flex items-center justify-between rounded bg-background px-2 py-1">
                    <span>{predicateLabel(id)}</span>
                    <span className="font-semibold tabular-nums">{n.toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
