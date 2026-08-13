/**
 * Client wrapper for the PR-A `POST /api/evaluate` endpoint.
 *
 * Contract per docs/scenario-builder-design.md §3.2. The Matrix (PR-B) and
 * Scenario Builder (PR-C) both call this endpoint — CR math and driver
 * breakdowns are computed server-side by the evaluator and cached per
 * (snapshot_month, canonical(predicates + composition_op)).
 *
 * PR-B two-tier fetch strategy (docs §4.4 + PR-B spec):
 *   • On Matrix mount: single evaluate call with just
 *     [fails_enhanced_guidelines] → fast top-level table (EG-fail
 *     Removed + Revised CR columns).
 *   • On row expand: lazy evaluate call with the full registry predicate
 *     list, cached client-side by office name so re-expand does not
 *     re-fetch.
 *
 * The evaluator is server-authoritative for CR math; the client never
 * re-implements the formula. Formatting-only concerns (Δ bps coloring,
 * sort direction) stay in the component.
 */

export interface EvaluatePredicateSpec {
  predicate_id: string;
  params?: Record<string, unknown>;
}

export type CompositionOp = 'AND' | 'OR';

export interface EvaluateRequest {
  snapshot_month: string;
  predicates: EvaluatePredicateSpec[];
  composition_op: CompositionOp;
}

/**
 * Per-office slice of the evaluate response.
 *
 * `driver_breakdown` is one entry per requested predicate (non-exclusive:
 * a loan may fire multiple predicates); `n_removed` at office level is the
 * unique-loan-id set-union, not the sum of the breakdown values (docs §7
 * double-count guard).
 */
export interface PerOfficeEvaluation {
  office_id: string;
  hud_cr: number;
  revised_cr: number;
  n_loans: number;
  n_removed: number;
  driver_breakdown: Record<string, number>;
}

export interface EvaluateResponse {
  cache_key: string;
  snapshot_month: string;
  cr_current: number;
  cr_revised: number;
  delta_bps: number;
  n_removed: number;
  offices_over_150_current: number;
  offices_over_150_revised: number;
  per_office: PerOfficeEvaluation[];
}

export class EvaluateError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EvaluateError';
  }
}

/**
 * POST /api/evaluate.
 *
 * SSO is handled by SWA (302 redirect). `credentials: 'include'` keeps the
 * auth cookie; the SPA loader treats 302 as a redirect it must not
 * follow, matching the existing snapshot loader pattern.
 */
export async function evaluate(req: EvaluateRequest): Promise<EvaluateResponse> {
  let res: Response;
  try {
    res = await fetch('/api/evaluate', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (e) {
    throw new EvaluateError('Network error calling /api/evaluate', null, e);
  }
  if (!res.ok) {
    let body: string | null = null;
    try {
      body = await res.text();
    } catch {
      body = null;
    }
    throw new EvaluateError(
      `POST /api/evaluate failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  try {
    return (await res.json()) as EvaluateResponse;
  } catch (e) {
    throw new EvaluateError('POST /api/evaluate returned invalid JSON', res.status, e);
  }
}

/**
 * The single predicate the top-level Matrix fetches on mount.
 *
 * v16 workbook cols S–U ("Revised CR") = HUD CR after removing
 * Enhanced-Guidelines-fail loans. That is the "EG-fail Removed" +
 * "Revised CR" columns of the reformatted matrix. Other predicates only
 * matter inside the per-office expand row, so we defer them.
 */
export const TOP_LEVEL_PREDICATES: EvaluatePredicateSpec[] = [
  { predicate_id: 'fails_enhanced_guidelines', params: {} },
];

/**
 * Full whole-portfolio driver-breakdown predicate set — pulled lazily on
 * row expand. Mirrors the registry predicates that answer "what caused
 * this office to fail" (docs §4.4). The evaluator is authoritative for
 * this list; we only send predicate_ids and default params.
 *
 * Order here is *not* significant — the expand row sorts the returned
 * driver_breakdown by removal count descending.
 */
export const DRIVER_BREAKDOWN_PREDICATES: EvaluatePredicateSpec[] = [
  { predicate_id: 'fails_enhanced_guidelines', params: {} },
  { predicate_id: 'boost_membership', params: {} },
  { predicate_id: 'arrive_aurora_membership', params: {} },
  { predicate_id: 'elevate_membership', params: {} },
  { predicate_id: 'proprietary_dpa_membership', params: {} },
  { predicate_id: 'fico_lt_580', params: {} },
  { predicate_id: 'fico_lt_620', params: {} },
  { predicate_id: 'fico_lt_660', params: {} },
  { predicate_id: 'dti_gt_50', params: {} },
  { predicate_id: 'ltv_gt_95', params: {} },
  { predicate_id: 'reserves_lt_1_mo', params: {} },
  { predicate_id: 'gift_no_reserves', params: {} },
  { predicate_id: 'manual_uw', params: {} },
];

/**
 * Human-readable labels for driver predicates. Falls back to the raw
 * predicate_id if unknown. Kept co-located with the predicate list so
 * changes stay in one file.
 */
export const DRIVER_LABELS: Record<string, string> = {
  fails_enhanced_guidelines: 'Fails Enhanced Guidelines',
  boost_membership: 'Boost membership',
  arrive_aurora_membership: 'Arrive/Aurora membership',
  elevate_membership: 'Elevate FHA membership',
  proprietary_dpa_membership: 'Proprietary DPA (union)',
  fico_lt_580: 'FICO < 580',
  fico_lt_620: 'FICO < 620',
  fico_lt_660: 'FICO < 660',
  dti_gt_50: 'DTI back-end > 50%',
  ltv_gt_95: 'LTV > 95%',
  reserves_lt_1_mo: 'Reserves < 1 month',
  gift_no_reserves: 'Gift ≥ 50% & no reserves',
  manual_uw: 'Manual underwriting',
};
