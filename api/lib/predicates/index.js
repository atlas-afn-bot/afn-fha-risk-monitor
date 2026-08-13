/**
 * Predicate registry loader + individual predicate functions.
 *
 * V1 registry is a repo-tracked JSON module at ./registry.v1.json.
 * See docs/scenario-builder-design.md §3.3 + §9 Q6.
 *
 * Every predicate has a `js-fn-ref` template that maps to a function in
 * PREDICATE_FNS below. Each function returns a Set<loan_id> of loans that
 * match the predicate against `snapshot.loans`.
 *
 * Params come from the scenario's predicates[].params (client-supplied),
 * falling back to the registry entry's default when a param is omitted.
 */
const fs = require('fs');
const path = require('path');

let CACHED_REGISTRY = null;

function loadRegistry() {
  if (CACHED_REGISTRY) return CACHED_REGISTRY;
  const registryPath = path.join(__dirname, 'registry.v1.json');
  const text = fs.readFileSync(registryPath, 'utf8');
  CACHED_REGISTRY = JSON.parse(text);
  return CACHED_REGISTRY;
}

function findPredicate(registry, predicateId) {
  return (registry.predicates || []).find((p) => p.id === predicateId);
}

/**
 * Resolve params for a predicate: merge caller params over registry defaults.
 */
function resolveParams(registryEntry, callerParams) {
  const out = {};
  for (const p of registryEntry.params || []) {
    out[p.name] = p.default;
  }
  if (callerParams && typeof callerParams === 'object') {
    for (const [k, v] of Object.entries(callerParams)) {
      if (v !== undefined && v !== null) out[k] = v;
    }
  }
  return out;
}

// ── Predicate functions ──────────────────────────────────────────────────
// Each returns a Set of matching loan_ids.

const PREDICATE_FNS = {
  boost_membership(loans, _params) {
    const s = new Set();
    for (const l of loans) if (l.is_boost === true) s.add(l.loan_id);
    return s;
  },

  arrive_aurora_membership(loans, _params) {
    const s = new Set();
    for (const l of loans) if (l.dpa_program === 'Arrive/Aurora') s.add(l.loan_id);
    return s;
  },

  elevate_membership(loans, _params) {
    const s = new Set();
    for (const l of loans) if (l.dpa_name === 'Elevate FHA Loan Program') s.add(l.loan_id);
    return s;
  },

  proprietary_dpa_membership(loans, _params) {
    // v16 S4 scope: Boost OR Arrive/Aurora OR Elevate FHA. Assertion: disjoint on 2026-06.
    const s = new Set();
    for (const l of loans) {
      if (
        l.is_boost === true ||
        l.dpa_program === 'Arrive/Aurora' ||
        l.dpa_name === 'Elevate FHA Loan Program'
      ) {
        s.add(l.loan_id);
      }
    }
    return s;
  },

  fico_lt(loans, params) {
    const threshold = Number(params.threshold);
    const s = new Set();
    for (const l of loans) {
      const fico = Number(l.fico_score);
      if (Number.isFinite(fico) && fico < threshold) s.add(l.loan_id);
    }
    return s;
  },

  dti_gt(loans, params) {
    const threshold = Number(params.threshold);
    const s = new Set();
    for (const l of loans) {
      const dti = Number(l.back_dti);
      if (Number.isFinite(dti) && dti > threshold) s.add(l.loan_id);
    }
    return s;
  },

  ltv_gt(loans, params) {
    const threshold = Number(params.threshold);
    const s = new Set();
    for (const l of loans) {
      const ltv = Number(l.ltv);
      if (Number.isFinite(ltv) && ltv > threshold) s.add(l.loan_id);
    }
    return s;
  },

  reserves_lt(loans, params) {
    // Snapshot exposes reserves_group as string buckets: "0", "1-2 months", "3+ months", etc.
    // Threshold 1 → reserves_group == "0" (< 1 mo). Threshold 2 → "0" OR "1-2 months" (< 2 mo).
    // Fall back to numeric reserves_months when reserves_group is unrecognized.
    const threshold = Number(params.threshold);
    const s = new Set();
    for (const l of loans) {
      const rg = l.reserves_group;
      const rm = Number(l.reserves_months);
      let match = false;
      if (typeof rg === 'string') {
        if (threshold >= 1 && rg === '0') match = true;
        if (threshold >= 2 && (rg === '0' || /^1[\s-]?2\s*mo/i.test(rg))) match = true;
      }
      if (!match && Number.isFinite(rm)) {
        if (rm < threshold) match = true;
      }
      if (match) s.add(l.loan_id);
    }
    return s;
  },

  gift_no_reserves(loans, params) {
    // Composite: gift_grant_group ∈ giftGroups AND reserves_group === zeroGroup.
    // Default per v16 Enhanced Guidelines carve-out.
    const giftGroups = params.gift_grant_groups || [];
    const zero = params.reserves_group_zero || '0';
    const giftSet = new Set(giftGroups);
    const s = new Set();
    for (const l of loans) {
      const gg = l.gift_grant_group;
      const rg = l.reserves_group;
      if (giftSet.has(gg) && rg === zero) s.add(l.loan_id);
    }
    return s;
  },

  fails_enhanced_guidelines(loans, _params) {
    // v16 snapshot-side EG flag — Boost-only (Q3 constraint).
    const s = new Set();
    for (const l of loans) {
      if (l.fails_enhanced_guidelines === true) s.add(l.loan_id);
    }
    return s;
  },

  manual_uw(loans, _params) {
    const s = new Set();
    for (const l of loans) if (l.has_manual_uw === true) s.add(l.loan_id);
    return s;
  },

  front_dti_tiered_cap(loans, params) {
    // v16 S3/S4 tiered front-end DTI cap:
    //   FICO 660–699 must have front-end DTI ≤ 35%
    //   FICO ≥ 700    must have front-end DTI ≤ 42%
    // Loans with FICO < 660 are excluded here (caught by fico_lt_*).
    const lowMin = Number(params.low_tier_min_fico);
    const lowMax = Number(params.low_tier_max_fico);
    const lowCap = Number(params.low_tier_front_dti_cap);
    const highMin = Number(params.high_tier_min_fico);
    const highCap = Number(params.high_tier_front_dti_cap);
    const s = new Set();
    for (const l of loans) {
      const fico = Number(l.fico_score);
      const frontDti = Number(l.front_dti);
      if (!Number.isFinite(fico) || !Number.isFinite(frontDti)) continue;
      if (fico >= lowMin && fico <= lowMax && frontDti > lowCap) s.add(l.loan_id);
      else if (fico >= highMin && frontDti > highCap) s.add(l.loan_id);
    }
    return s;
  },

  boost_dti_tiered_v16(loans, params) {
    // v16 R002 (S3/S4) rule (1)+(2)+(3) encoded as ONE compound predicate.
    // Verbatim from workbook "S3 Committee — Boost Guidelines" R002:
    //   (1) FICO<660 or None
    //   (2) FICO 660-699 with front-end DTI >35.0%
    //   (3) FICO 700+ with front-end DTI >42.0%
    // Branch (1) explicitly covers null/None FICO (per v16 language
    // "FICO<660 or None"). Branches (2)/(3) require finite FICO+front_dti.
    // Fires membership-agnostic; scenario composes with is_boost / proprietary_dpa.
    const lowFico = Number(params.low_fico_threshold);
    const midMin = Number(params.mid_tier_min_fico);
    const midMax = Number(params.mid_tier_max_fico);
    const midCap = Number(params.mid_tier_front_dti_cap);
    const highMin = Number(params.high_tier_min_fico);
    const highCap = Number(params.high_tier_front_dti_cap);
    const s = new Set();
    for (const l of loans) {
      const ficoRaw = l.fico_score;
      // Branch (1): FICO<lowFico OR None. "None" == null/undefined/non-numeric.
      const ficoIsNull =
        ficoRaw === null ||
        ficoRaw === undefined ||
        (typeof ficoRaw === 'number' && !Number.isFinite(ficoRaw));
      const ficoNum = Number(ficoRaw);
      if (ficoIsNull) {
        s.add(l.loan_id);
        continue;
      }
      if (Number.isFinite(ficoNum) && ficoNum < lowFico) {
        s.add(l.loan_id);
        continue;
      }
      // Branches (2) and (3) require finite front_dti.
      const frontDti = Number(l.front_dti);
      if (!Number.isFinite(frontDti)) continue;
      if (ficoNum >= midMin && ficoNum <= midMax && frontDti > midCap) {
        s.add(l.loan_id);
      } else if (ficoNum >= highMin && frontDti > highCap) {
        s.add(l.loan_id);
      }
    }
    return s;
  },
};

/**
 * Apply a single predicate against a loan set.
 * Returns { set: Set<loan_id>, predicate_id, resolved_params }.
 * Throws if the predicate_id is not in the registry or the js-fn is unknown.
 */
function applyPredicate(loans, predicateId, callerParams, registry) {
  const reg = registry || loadRegistry();
  const entry = findPredicate(reg, predicateId);
  if (!entry) {
    const err = new Error(`unknown_predicate: ${predicateId}`);
    err.code = 'unknown_predicate';
    throw err;
  }
  const fn = PREDICATE_FNS[entry.template];
  if (!fn) {
    const err = new Error(
      `unimplemented_predicate_template: ${entry.template} (predicate ${predicateId})`,
    );
    err.code = 'unimplemented_predicate_template';
    throw err;
  }
  const resolved = resolveParams(entry, callerParams);
  const set = fn(loans, resolved);
  return { set, predicate_id: predicateId, resolved_params: resolved };
}

module.exports = {
  loadRegistry,
  findPredicate,
  resolveParams,
  applyPredicate,
  PREDICATE_FNS,
  // For test overrides:
  _resetRegistryCache() {
    CACHED_REGISTRY = null;
  },
};
