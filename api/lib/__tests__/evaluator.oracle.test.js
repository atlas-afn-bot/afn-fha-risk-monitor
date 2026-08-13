/**
 * Evaluator oracle tests — S1/S2/S3/S4 n_removed against v16 workbook.
 *
 * Oracle: v16 workbook per-scenario "Loan Audit" tabs, confirmed by ATLAS
 * against the workbook file
 *   ~/.openclaw/workspace/tmp/fha-whatif-june-2026/FHA-WhatIf-June-2026-v16-backup.xlsx
 * (sha256 870f23ad… — Michael's Aug-12 22:45 UTC re-build; numbers match
 * memory/projects/afn-fha-risk-monitor/v16-buildlog.md.)
 *
 *   S1 = 2268 (194 Retail + 2074 Wholesale)
 *   S2 = 1158 (89 + 1069)
 *   S3 = 1567 (122 + 1445)
 *   S4 = 1983 (144 + 1839)
 *
 * v16 rule sets — SOURCED FROM v16 workbook R002 verbatim (Committee sheets):
 *
 *   S2 R002 (verbatim, "S2 Committee — FICO 660"): "Remove all Boost loans
 *     with FICO < 660 UNION all Boost loans that fail Enhanced Guidelines
 *     (persistent carve-out; EG has been AFN's underwriting standard for
 *     ~2 years). No delinquency qualifier anywhere."
 *     → S2 = is_boost AND (fico<660 OR fails_enhanced_guidelines)
 *
 *   S3 R002 (verbatim, "S3 Committee — Boost Guidelines"): "Boost Guidelines
 *     Tightening + persistent EG carve-out. Remove Boost loans that fail ANY
 *     of: (1) FICO<660 or None; (2) FICO 660-699 with front-end DTI >35.0%;
 *     (3) FICO 700+ with front-end DTI >42.0%; (4) uses manual underwriting;
 *     (5) fails Enhanced Guidelines (persistent carve-out, no delinquency
 *     qualifier). Non-Boost loans unaffected."
 *     → S3 = is_boost AND (boost_dti_tiered_v16 OR has_manual_uw
 *                          OR fails_enhanced_guidelines)
 *     Branches (1)+(2)+(3) are encapsulated in the single compound predicate
 *     `boost_dti_tiered_v16` because R002 groups them as one rule.
 *
 *   S4 R002 (verbatim, "S4 Committee — Proprietary DPA"): "same rule set as
 *     S3 — (1) FICO<660 or None; (2) FICO 660-699 with front-end DTI >35.0%;
 *     (3) FICO 700+ with front-end DTI >42.0%; (4) uses manual underwriting;
 *     (5) fails Enhanced Guidelines (persistent carve-out) — applied to all
 *     AFN-proprietary DPA: Boost (2,268) + Arrive/Aurora (320) + Elevate FHA
 *     (279) = 2,867 loans in scope. HFA/municipal DPA (FL Housing, CalHFA,
 *     MSHDA, county programs, etc.) are OUT of scope."
 *     → S4 = proprietary_dpa AND (same OR-block as S3)
 *
 * Baked-boolean delegation (Option A, per PR-A design decision):
 *   is_boost                    → boost_membership
 *   has_manual_uw               → manual_uw
 *   fails_enhanced_guidelines   → fails_enhanced_guidelines
 * The FICO-tiered ladder has no single baked boolean, so
 * `boost_dti_tiered_v16` derives from raw fico_score + front_dti and
 * explicitly matches FICO=None per v16 R002 rule (1) "FICO<660 or None".
 */
const path = require('path');
const fs = require('fs');
const { evaluate } = require('../evaluator');

const FIXTURE_PATH = path.join(__dirname, '..', '..', '..', 'public', 'data', 'snapshots', '2026-06.json');
const snapshot = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

function run(predicates, composition_op = 'AND') {
  return evaluate({
    snapshot,
    predicates,
    composition_op,
    snapshot_month: '2026-06',
  });
}

const S3_OR_BLOCK = {
  op: 'OR',
  predicates: [
    { predicate_id: 'boost_dti_tiered_v16' },
    { predicate_id: 'manual_uw' },
    { predicate_id: 'fails_enhanced_guidelines' },
  ],
};

describe('evaluator oracle — v16 S1/S2/S3/S4 n_removed (exact)', () => {
  it('S1 (all Boost removed) → 2268', () => {
    const res = run([{ predicate_id: 'boost_membership' }], 'OR');
    expect(res.n_removed).toBe(2268);
  });

  it('S2 (is_boost AND (fico<660 OR EG)) → 1158', () => {
    const res = run(
      [
        { predicate_id: 'boost_membership' },
        {
          op: 'OR',
          predicates: [
            { predicate_id: 'fico_lt_660' },
            { predicate_id: 'fails_enhanced_guidelines' },
          ],
        },
      ],
      'AND',
    );
    expect(res.n_removed).toBe(1158);
  });

  it('S3 (is_boost AND (boost_dti_tiered_v16 OR manual_uw OR EG)) → 1567', () => {
    const res = run(
      [{ predicate_id: 'boost_membership' }, S3_OR_BLOCK],
      'AND',
    );
    expect(res.n_removed).toBe(1567);
  });

  it('S4 (proprietary_dpa AND same OR-block as S3) → 1983', () => {
    const res = run(
      [{ predicate_id: 'proprietary_dpa_membership' }, S3_OR_BLOCK],
      'AND',
    );
    expect(res.n_removed).toBe(1983);
  });

  it('Originals baseline: fails_enhanced_guidelines → 857 (Boost-only EG-fail carve-out)', () => {
    // v16 Originals sheet R006 "Removed" count = 857 (68 Retail + 789 Wholesale).
    // This is the delinquent-Boost-EG-fail predicate the app already applies.
    const res = run([{ predicate_id: 'fails_enhanced_guidelines' }], 'OR');
    expect(res.n_removed).toBe(857);
  });
});

describe('evaluator — double-count guard', () => {
  it('fico<580 AND dti>50 uses set-intersection, not sum-of-counts (double-count guard)', () => {
    const loans = snapshot.loans;
    let bothHits = 0;
    for (const l of loans) {
      const fico = Number(l.fico_score);
      const dti = Number(l.back_dti);
      if (Number.isFinite(fico) && fico < 580 && Number.isFinite(dti) && dti > 50) bothHits++;
    }
    const res = run(
      [{ predicate_id: 'fico_lt_580' }, { predicate_id: 'dti_gt_50' }],
      'AND',
    );
    expect(res.n_removed).toBe(bothHits);
    const resOr = run(
      [{ predicate_id: 'fico_lt_580' }, { predicate_id: 'dti_gt_50' }],
      'OR',
    );
    expect(resOr.n_removed).toBeGreaterThanOrEqual(res.n_removed);
  });

  it('per_office driver_breakdown counts do NOT get summed into n_removed', () => {
    const res = run(
      [
        { predicate_id: 'boost_membership' },
        { predicate_id: 'gift_no_reserves' },
      ],
      'OR',
    );
    for (const o of res.per_office) {
      const sumOfBreakdown = Object.values(o.driver_breakdown).reduce((a, b) => a + b, 0);
      expect(o.n_removed).toBeLessThanOrEqual(sumOfBreakdown);
    }
  });
});
