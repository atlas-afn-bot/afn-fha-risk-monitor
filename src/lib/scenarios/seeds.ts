/**
 * S1–S4 seed scenarios per design doc §5.5.
 *
 * These are read-only defaults surfaced to the library when the local store
 * is empty. The flat v1 UI cannot express the nested `is_boost AND (X OR Y OR Z)`
 * structure the design doc §5.5 shows in nested form — instead we encode
 * S2/S3/S4 as flat AND-of-all-predicates with a top-level `composition_op: 'AND'`.
 *
 * That flat approximation only matches the v16 oracle exactly for S1. S2, S3,
 * and S4 require the ATLAS escape hatch (§5.z) to POST the nested tree
 * directly. Until we ship server-side persistence and the nested UI, these
 * seeds serve as **starting points for committee users** — click "Duplicate"
 * (future) or "Edit" to tweak. The description on each seed makes the
 * design-doc source explicit.
 *
 * The oracle `n_removed` values (2268 / 1158 / 1567 / 1983) are still the
 * target — they come out of `POST /api/evaluate` when the correct nested
 * tree is posted server-side, not from this file. This file is UI seed
 * data; the numbers are informational only.
 */
import type { Scenario } from './types';

const NOW = '2026-08-13T00:00:00Z';

function seed(
  id: string,
  name: string,
  description: string,
  predicates: Scenario['predicates'],
  composition_op: Scenario['composition_op'] = 'AND',
): Scenario {
  return {
    schema_version: 1,
    id,
    name,
    description,
    predicates,
    composition_op,
    evaluations: {},
    visible: true,
    readonly: true,
    created_by: { email: 'system@afncorp.com', name: 'v16 workbook (seed)' },
    created_at: NOW,
    updated_at: NOW,
  };
}

export const SEED_SCENARIOS: Scenario[] = [
  seed(
    's1-boost-full-removal',
    'S1 — Boost fully removed',
    'v16 R002 scenario 1: remove Boost product completely. Oracle: n_removed = 2268 against 2026-06.',
    [{ predicate_id: 'boost_membership', params: {} }],
    'AND',
  ),
  seed(
    's2-boost-fico-eg',
    'S2 — Boost with FICO < 660 OR EG-fail',
    'v16 R002 scenario 2: Boost loans with FICO<660 OR fails Enhanced Guidelines. Flat v1 UI shows the leaves; nested tree (Boost AND (fico<660 OR EG-fail)) requires the ATLAS escape hatch (design doc §5.z). Oracle: n_removed = 1158 against 2026-06.',
    [
      { predicate_id: 'boost_membership', params: {} },
      { predicate_id: 'fico_lt_660', params: { threshold: 660 } },
      { predicate_id: 'fails_enhanced_guidelines', params: {} },
    ],
    'AND',
  ),
  seed(
    's3-boost-guidelines-tighten',
    'S3 — Boost Guidelines Tightening + EG',
    'v16 R002 scenario 3: is_boost AND (boost_dti_tiered_v16 OR manual_uw OR fails_enhanced_guidelines). Rules (1)+(2)+(3) encapsulated in boost_dti_tiered_v16. Oracle: n_removed = 1567 against 2026-06.',
    [
      { predicate_id: 'boost_membership', params: {} },
      { predicate_id: 'boost_dti_tiered_v16', params: {} },
      { predicate_id: 'manual_uw', params: {} },
      { predicate_id: 'fails_enhanced_guidelines', params: {} },
    ],
    'AND',
  ),
  seed(
    's4-proprietary-dpa-guidelines-tighten',
    'S4 — All AFN-proprietary DPA with S3 rule set',
    'v16 R002 scenario 4: proprietary_dpa AND (boost_dti_tiered_v16 OR manual_uw OR fails_enhanced_guidelines). Same rules as S3, applied to Boost + Arrive/Aurora + Elevate FHA. Oracle: n_removed = 1983 against 2026-06.',
    [
      { predicate_id: 'proprietary_dpa_membership', params: {} },
      { predicate_id: 'boost_dti_tiered_v16', params: {} },
      { predicate_id: 'manual_uw', params: {} },
      { predicate_id: 'fails_enhanced_guidelines', params: {} },
    ],
    'AND',
  ),
];
