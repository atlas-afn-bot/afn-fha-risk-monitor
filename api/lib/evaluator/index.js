/**
 * Scenario evaluator — the load-bearing library from PR-A.
 *
 * evaluate({ snapshot, predicates, composition_op }) → response body per
 *   docs/scenario-builder-design.md §3.2.
 *
 * Compositional double-count guard: `n_removed` = |unique loan_id union|,
 * NOT the sum of per-predicate hit counts. See §7 of the design doc.
 */
const { applyPredicate, loadRegistry } = require('../predicates');

/**
 * Combine a list of Sets according to composition_op.
 *   'OR'  → union
 *   'AND' → intersection (starts from the first predicate's set)
 */
function combineSets(sets, compositionOp) {
  if (!sets.length) return new Set();
  if (compositionOp === 'AND') {
    // Intersection: start with the smallest set for efficiency.
    let acc = new Set(sets[0]);
    for (let i = 1; i < sets.length; i++) {
      const next = sets[i];
      const kept = new Set();
      for (const id of acc) if (next.has(id)) kept.add(id);
      acc = kept;
    }
    return acc;
  }
  // Default: OR / union.
  const acc = new Set();
  for (const s of sets) for (const id of s) acc.add(id);
  return acc;
}

/**
 * Resolve a single predicate node OR a nested composition node into a
 * Set<loan_id>. Also records per-predicate hit-sets into `perPredicateSets`
 * for driver_breakdown reporting.
 *
 * Leaf node shape:   { predicate_id: '…', params?: {…} }
 * Nested node shape: { op: 'AND'|'OR', predicates: […] }
 *
 * The nested form is what the design doc §5.z (ATLAS escape hatch) posts;
 * the flat top-level UI v1 posts an array of leaves + a top-level
 * composition_op.
 */
function resolveNode(loans, node, registry, perPredicateSets) {
  if (!node || typeof node !== 'object') return new Set();
  if (node.op && Array.isArray(node.predicates)) {
    const subSets = node.predicates.map((child) =>
      resolveNode(loans, child, registry, perPredicateSets),
    );
    return combineSets(subSets, node.op === 'AND' ? 'AND' : 'OR');
  }
  if (node.predicate_id) {
    const { set } = applyPredicate(loans, node.predicate_id, node.params || {}, registry);
    // For driver_breakdown, we record the *leaf-most* predicate id. Repeat
    // occurrences of the same leaf in a tree collapse to the same set.
    perPredicateSets[node.predicate_id] = set;
    return set;
  }
  return new Set();
}

/**
 * Group loans by office and compute per-office CR + driver breakdown.
 *
 * The current CR (`hud_cr`) comes from the snapshot's
 * `compare_ratios_hud_office[].compare_ratio` when available; otherwise it's
 * left as null (the front-end can substitute).
 *
 * The revised CR is computed as:
 *   revised_denominator = office_loans - office_removed
 *   revised_numerator   = office_delinquent - office_removed_delinquent
 *   revised_cr          = round((revised_num / revised_den) / benchmark * 100)
 *
 * When the office has no benchmark available we fall back to the same
 * scaling factor the snapshot uses: `hud_cr / (office_dq_pct / benchmark_pct)`
 * derives the benchmark on the fly. If the office has < N loans or the
 * denominator collapses to zero, `revised_cr = null` and the caller can
 * render "n/a".
 */
function computePerOffice(loans, removedSet, perPredicateSets, snapshot) {
  const officeIndex = new Map();
  for (const l of loans) {
    const key = l.hud_office || 'UNKNOWN';
    if (!officeIndex.has(key)) {
      officeIndex.set(key, {
        office_id: key,
        loans: [],
      });
    }
    officeIndex.get(key).loans.push(l);
  }

  // Look up HUD-office CR from the snapshot when we have it.
  const hudCrByOffice = new Map();
  for (const row of snapshot.compare_ratios_hud_office || []) {
    if (row.hud_office) hudCrByOffice.set(row.hud_office, row);
  }

  const out = [];
  for (const [office_id, group] of officeIndex.entries()) {
    const n_loans = group.loans.length;
    const officeDelinquent = group.loans.filter((l) => l.is_delinquent === true).length;
    const removedInOffice = group.loans.filter((l) => removedSet.has(l.loan_id));
    const n_removed = removedInOffice.length;
    const removedDelinq = removedInOffice.filter((l) => l.is_delinquent === true).length;

    const revisedDen = n_loans - n_removed;
    const revisedNum = officeDelinquent - removedDelinq;

    const hudRow = hudCrByOffice.get(office_id);
    const hud_cr = hudRow ? hudRow.compare_ratio : null;

    let revised_cr = null;
    if (hud_cr !== null && revisedDen > 0 && n_loans > 0 && officeDelinquent > 0) {
      // Derive per-office benchmark from published CR + published DQ share:
      //   CR = (office_dq / office_loans) / benchmark  ×  100
      //   → benchmark = (office_dq / office_loans) × 100 / CR
      const currentDqShare = officeDelinquent / n_loans;
      const benchmark = (currentDqShare * 100) / hud_cr;
      if (benchmark > 0) {
        const newDqShare = revisedNum / revisedDen;
        revised_cr = Math.round((newDqShare / benchmark) * 100);
      }
    }

    // driver_breakdown: per-predicate hit count restricted to loans in this office.
    const driver_breakdown = {};
    for (const [pid, pset] of Object.entries(perPredicateSets)) {
      let count = 0;
      for (const l of group.loans) if (pset.has(l.loan_id)) count++;
      driver_breakdown[pid] = count;
    }

    out.push({
      office_id,
      hud_cr,
      revised_cr,
      n_loans,
      n_removed,
      driver_breakdown,
    });
  }

  return out;
}

/**
 * Top-level CR from the snapshot (raw HUD published) — Q2 says the headline
 * stays HUD published. Falls back to computed value when the snapshot's
 * `compare_ratios_total` is missing.
 */
function getTopLevelCr(snapshot, loans) {
  const totalRow = (snapshot.compare_ratios_total || []).find((r) => r.scope === 'total');
  if (totalRow && Number.isFinite(totalRow.compare_ratio)) {
    return {
      cr: totalRow.compare_ratio,
      totalDelinquent: totalRow.delinquent_count,
      totalLoans: totalRow.loans_count,
      benchmark:
        totalRow.loans_count && totalRow.delinquent_count && totalRow.compare_ratio
          ? (totalRow.delinquent_count / totalRow.loans_count) * 100 / totalRow.compare_ratio
          : null,
    };
  }
  // Fallback: derive from loans array alone.
  const totalDelinquent = loans.filter((l) => l.is_delinquent === true).length;
  const totalLoans = loans.length;
  return {
    cr: null,
    totalDelinquent,
    totalLoans,
    benchmark: null,
  };
}

/**
 * Main entry point.
 *
 * @param {object} args
 * @param {object} args.snapshot - full snapshot JSON (has `.loans`, `.compare_ratios_total`, etc.)
 * @param {Array<{predicate_id: string, params?: object}>} args.predicates
 * @param {'AND'|'OR'} args.composition_op
 * @param {string} [args.snapshot_month] - echoed into response
 * @param {object} [args.registry] - optional registry override (defaults to loaded v1 registry)
 * @returns {object} evaluator response (see design doc §3.2)
 */
function evaluate({ snapshot, predicates, composition_op, snapshot_month, registry }) {
  if (!snapshot || !Array.isArray(snapshot.loans)) {
    const err = new Error('invalid_snapshot: missing loans[]');
    err.code = 'invalid_snapshot';
    throw err;
  }
  const registryRef = registry || loadRegistry();
  const compositionOp = composition_op === 'AND' ? 'AND' : 'OR';
  const loans = snapshot.loans;

  // Apply each predicate → per-predicate Set of loan_ids. Predicates can be
  // leaf nodes (v1 UI flat form) or nested composition nodes (§5.z tree form).
  const perPredicateSets = {};
  const predicateSets = [];
  for (const pspec of predicates || []) {
    if (!pspec || typeof pspec !== 'object') continue;
    if (pspec.op && Array.isArray(pspec.predicates)) {
      predicateSets.push(resolveNode(loans, pspec, registryRef, perPredicateSets));
      continue;
    }
    if (!pspec.predicate_id) continue;
    const { set } = applyPredicate(loans, pspec.predicate_id, pspec.params || {}, registryRef);
    perPredicateSets[pspec.predicate_id] = set;
    predicateSets.push(set);
  }

  const removedSet = combineSets(predicateSets, compositionOp);
  const n_removed = removedSet.size;

  const { cr: cr_current, totalDelinquent, totalLoans, benchmark } = getTopLevelCr(snapshot, loans);

  // Revised CR at top level: (delinq - removed_delinq) / (loans - n_removed) → CR
  let cr_revised = null;
  if (
    benchmark &&
    Number.isFinite(benchmark) &&
    benchmark > 0 &&
    Number.isFinite(totalLoans) &&
    Number.isFinite(totalDelinquent)
  ) {
    let removedDelinq = 0;
    for (const l of loans) {
      if (removedSet.has(l.loan_id) && l.is_delinquent === true) removedDelinq++;
    }
    const revisedDen = totalLoans - n_removed;
    const revisedNum = totalDelinquent - removedDelinq;
    if (revisedDen > 0) {
      const newShare = revisedNum / revisedDen;
      cr_revised = Math.round((newShare / benchmark) * 100);
    }
  }

  const delta_bps =
    Number.isFinite(cr_current) && Number.isFinite(cr_revised)
      ? Math.round((cr_revised - cr_current) * 10) // CR is already in "percent × 100" → 1 CR pt = 100 bps? v16 uses "bps" for CR delta directly.
      : null;

  const per_office = computePerOffice(loans, removedSet, perPredicateSets, snapshot);

  const offices_over_150_current = per_office.filter(
    (o) => Number.isFinite(o.hud_cr) && o.hud_cr > 150,
  ).length;
  const offices_over_150_revised = per_office.filter(
    (o) => Number.isFinite(o.revised_cr) && o.revised_cr > 150,
  ).length;

  return {
    snapshot_month: snapshot_month || (snapshot.snapshot_meta && snapshot.snapshot_meta.period),
    composition_op: compositionOp,
    cr_current,
    cr_revised,
    delta_bps,
    n_removed,
    offices_over_150_current,
    offices_over_150_revised,
    per_office,
  };
}

module.exports = {
  evaluate,
  combineSets,
  resolveNode,
  computePerOffice,
  getTopLevelCr,
};
