/**
 * Scenario domain types.
 *
 * Mirrors the server-side storage schema in `docs/scenario-builder-design.md`
 * §5.3 as closely as makes sense for a client-only v1. The flat `predicates`
 * array is the v1 UI shape; the design doc notes it is tree-capable for
 * API-authored scenarios (ATLAS escape hatch, §5.z) — we ignore that here
 * and store flat arrays only.
 *
 * **Open dependency:** server-side persistence (blob at
 * `stafnfhauploads/snapshots/scenarios/{id}.json`) is TBD; PR-C uses a
 * client-only localStorage store scoped by user OID.
 */

export type CompositionOp = 'AND' | 'OR' | 'WEIGHTED';

export interface ScenarioPredicate {
  predicate_id: string;
  params: Record<string, number | string | boolean>;
  /** Optional per-predicate weight when composition_op = 'WEIGHTED'. Default 1. */
  weight?: number;
}

export interface ScenarioEvaluationSummary {
  cr_current: number;
  cr_revised: number;
  delta_bps: number;
  offices_over_150_current: number;
  offices_over_150_revised: number;
  n_removed: number;
  evaluated_at: string;
}

export interface Scenario {
  schema_version: 1;
  id: string;
  name: string;
  description: string;
  predicates: ScenarioPredicate[];
  composition_op: CompositionOp;
  /** Evaluations keyed by snapshot period (e.g. "2026-06"). */
  evaluations: Record<string, ScenarioEvaluationSummary>;
  visible: boolean;
  /** True for the S1-S4 read-only seed scenarios. UI hides edit/delete for these. */
  readonly?: boolean;
  created_by: { email: string; name: string } | null;
  created_at: string;
  updated_at: string;
  last_evaluated_at?: string;
}
