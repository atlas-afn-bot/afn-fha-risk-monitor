/**
 * Predicate registry — client-side mirror of `api/lib/predicates/registry.v1.json`.
 *
 * ## Why this exists (v1 shortcut)
 *
 * PR-C's Scenario Builder needs the predicate list to render the left-rail
 * picker (§5.4 in `docs/scenario-builder-design.md`). The design doc §6.2
 * calls out `GET /api/predicates` as the registry-fetch endpoint. That
 * endpoint does not exist in the repo yet (PR-A shipped `POST /api/evaluate`
 * and the JSON registry file, not the HTTP surface for reading it).
 *
 * Rather than introduce a new API route in this PR, PR-C hardcodes the
 * registry client-side, keyed by predicate `id`. Shape mirrors
 * `api/lib/predicates/registry.v1.json` verbatim (schema version 1).
 *
 * **Open dependency:** ship `GET /api/predicates` in a follow-up PR and
 * switch this module to fetch from it. Filed under "open dependencies" on
 * the PR body.
 *
 * Changes here MUST stay in lockstep with the JSON registry — the same
 * predicate ids exist server-side or `POST /api/evaluate` returns 400.
 */

export type PredicateParamType = 'int' | 'float' | 'enum' | 'bool';

export interface PredicateParamSpec {
  name: string;
  type: PredicateParamType;
  default: number | string | boolean;
  options?: string[]; // for `enum`
}

export interface PredicateSpec {
  id: string;
  label: string;
  family: string;
  description: string;
  params: PredicateParamSpec[];
  loan_fields: string[];
}

export const PREDICATE_FAMILIES: Record<string, string> = {
  product_channel_membership: 'Product & Channel',
  credit_score_threshold: 'Credit Score',
  dti_threshold: 'Debt-to-Income',
  ltv_threshold: 'Loan-to-Value',
  reserves_threshold: 'Reserves',
  gift_fund_presence: 'Gift Funds',
  composite_eg: 'Enhanced Guidelines',
  underwriting: 'Underwriting',
  composite_v16_boost_guidelines: 'v16 Compound Rules',
};

export const PREDICATE_REGISTRY: PredicateSpec[] = [
  {
    id: 'boost_membership',
    label: 'Boost membership',
    family: 'product_channel_membership',
    description: 'Loans in the AFN Boost DPA program.',
    params: [],
    loan_fields: ['is_boost'],
  },
  {
    id: 'arrive_aurora_membership',
    label: 'Arrive/Aurora membership',
    family: 'product_channel_membership',
    description: 'Loans in the Arrive/Aurora DPA program.',
    params: [],
    loan_fields: ['dpa_program'],
  },
  {
    id: 'elevate_membership',
    label: 'Elevate FHA membership',
    family: 'product_channel_membership',
    description: 'Loans in the Elevate FHA Loan Program.',
    params: [],
    loan_fields: ['dpa_name'],
  },
  {
    id: 'proprietary_dpa_membership',
    label: 'All AFN-proprietary DPA (Boost + Arrive/Aurora + Elevate)',
    family: 'product_channel_membership',
    description:
      'S4-scope union: Boost OR Arrive/Aurora OR Elevate FHA. v16 assertion: pairwise overlap == 0 on 2026-06.',
    params: [],
    loan_fields: ['is_boost', 'dpa_program', 'dpa_name'],
  },
  {
    id: 'fico_lt_580',
    label: 'FICO < 580',
    family: 'credit_score_threshold',
    description: 'Origination-time FICO below configured threshold (default 580).',
    params: [{ name: 'threshold', type: 'int', default: 580 }],
    loan_fields: ['fico_score'],
  },
  {
    id: 'fico_lt_620',
    label: 'FICO < 620',
    family: 'credit_score_threshold',
    description: 'Origination-time FICO below configured threshold (default 620).',
    params: [{ name: 'threshold', type: 'int', default: 620 }],
    loan_fields: ['fico_score'],
  },
  {
    id: 'fico_lt_660',
    label: 'FICO < 660',
    family: 'credit_score_threshold',
    description: 'Origination-time FICO below configured threshold (default 660).',
    params: [{ name: 'threshold', type: 'int', default: 660 }],
    loan_fields: ['fico_score'],
  },
  {
    id: 'dti_gt_50',
    label: 'DTI back-end > 50%',
    family: 'dti_threshold',
    description: 'Back-end DTI ratio above configured threshold (default 50%).',
    params: [{ name: 'threshold', type: 'float', default: 50 }],
    loan_fields: ['back_dti'],
  },
  {
    id: 'ltv_gt_95',
    label: 'LTV > 95%',
    family: 'ltv_threshold',
    description: 'Loan-to-value above configured threshold (default 95%).',
    params: [{ name: 'threshold', type: 'float', default: 95 }],
    loan_fields: ['ltv'],
  },
  {
    id: 'reserves_lt_1_mo',
    label: 'Reserves < 1 month',
    family: 'reserves_threshold',
    description: 'Reserves group falls below 1 month (default).',
    params: [],
    loan_fields: ['reserves_group'],
  },
  {
    id: 'gift_no_reserves',
    label: 'Gift fund ≥ 50% source-of-funds AND no reserves',
    family: 'gift_fund_presence',
    description: 'Composite predicate: gift-fund heavy AND reserves-thin.',
    params: [],
    loan_fields: ['has_gift_grant', 'source_of_funds_group', 'reserves_group'],
  },
  {
    id: 'fails_enhanced_guidelines',
    label: 'Fails Enhanced Guidelines (Boost only)',
    family: 'composite_eg',
    description:
      'Persistent EG carve-out. Baked snapshot-side; Boost-only per Q3. Delegates to loan.fails_enhanced_guidelines.',
    params: [],
    loan_fields: ['fails_enhanced_guidelines'],
  },
  {
    id: 'manual_uw',
    label: 'Manual underwriting',
    family: 'underwriting',
    description: 'Loan flagged has_manual_uw (baked snapshot-side).',
    params: [],
    loan_fields: ['has_manual_uw'],
  },
  {
    id: 'front_dti_tiered_cap',
    label: 'Front-end DTI over FICO-tiered cap (35% if 660-699, 42% if 700+)',
    family: 'dti_threshold',
    description:
      'Matrix expand-row extra — same DTI-tier logic as v16 R002, without the FICO<660/None branch.',
    params: [],
    loan_fields: ['fico_score', 'front_dti'],
  },
  {
    id: 'boost_dti_tiered_v16',
    label: 'v16 Boost Guidelines Tightening — FICO/front-DTI ladder (rule 1+2+3)',
    family: 'composite_v16_boost_guidelines',
    description:
      'Compound predicate encoding v16 R002 rules (1)+(2)+(3): FICO<660 or None, or 660-699 with front-DTI >35%, or 700+ with front-DTI >42%.',
    params: [],
    loan_fields: ['fico_score', 'front_dti'],
  },
];

/** Fast lookup by predicate id. */
export const PREDICATE_MAP: Record<string, PredicateSpec> = Object.fromEntries(
  PREDICATE_REGISTRY.map((p) => [p.id, p]),
);

/** Group predicates by family for the left-rail picker (§5.4). */
export function groupPredicatesByFamily(): Array<{ family: string; label: string; predicates: PredicateSpec[] }> {
  const byFamily = new Map<string, PredicateSpec[]>();
  for (const p of PREDICATE_REGISTRY) {
    const arr = byFamily.get(p.family) ?? [];
    arr.push(p);
    byFamily.set(p.family, arr);
  }
  return Array.from(byFamily.entries()).map(([family, predicates]) => ({
    family,
    label: PREDICATE_FAMILIES[family] ?? family,
    predicates,
  }));
}

/** Look up a predicate spec by id; undefined if missing. */
export function getPredicate(id: string): PredicateSpec | undefined {
  return PREDICATE_MAP[id];
}

/** Human label with fallback. */
export function predicateLabel(id: string): string {
  return PREDICATE_MAP[id]?.label ?? id;
}
