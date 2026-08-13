/**
 * Unit tests for individual predicate functions against a fixture snapshot.
 * See docs/scenario-builder-design.md §3.3 + §3.5.
 */
const path = require('path');
const fs = require('fs');
// Vitest globals (describe/it/expect) are exposed via test.globals: true.
const { applyPredicate, loadRegistry } = require('../predicates');

const FIXTURE_PATH = path.join(__dirname, '..', '..', '..', 'public', 'data', 'snapshots', '2026-06.json');
const snapshot = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
const loans = snapshot.loans;
const registry = loadRegistry();

describe('predicates.v1', () => {
  it('boost_membership matches 2268 loans (matches v16 workbook)', () => {
    const { set } = applyPredicate(loans, 'boost_membership', {}, registry);
    expect(set.size).toBe(2268);
  });

  it('arrive_aurora_membership matches 320 loans', () => {
    const { set } = applyPredicate(loans, 'arrive_aurora_membership', {}, registry);
    expect(set.size).toBe(320);
  });

  it('elevate_membership matches 279 loans', () => {
    const { set } = applyPredicate(loans, 'elevate_membership', {}, registry);
    expect(set.size).toBe(279);
  });

  it('proprietary_dpa_membership matches 2867 loans (S4 scope, v16 assertion)', () => {
    const { set } = applyPredicate(loans, 'proprietary_dpa_membership', {}, registry);
    expect(set.size).toBe(2867);
  });

  it('proprietary_dpa_membership subsets are pairwise disjoint on 2026-06 (v16 assertion)', () => {
    const boost = applyPredicate(loans, 'boost_membership', {}, registry).set;
    const aa = applyPredicate(loans, 'arrive_aurora_membership', {}, registry).set;
    const elevate = applyPredicate(loans, 'elevate_membership', {}, registry).set;
    let boostAa = 0;
    for (const id of boost) if (aa.has(id)) boostAa++;
    let boostEl = 0;
    for (const id of boost) if (elevate.has(id)) boostEl++;
    let aaEl = 0;
    for (const id of aa) if (elevate.has(id)) aaEl++;
    expect(boostAa).toBe(0);
    expect(boostEl).toBe(0);
    expect(aaEl).toBe(0);
    expect(boost.size + aa.size + elevate.size).toBe(2867);
  });

  it('fails_enhanced_guidelines matches 857 loans (Boost-only, per v16 baseline EG)', () => {
    const { set } = applyPredicate(loans, 'fails_enhanced_guidelines', {}, registry);
    expect(set.size).toBe(857);
  });

  it('fico_lt with threshold 620 fires on loans with fico_score < 620', () => {
    const { set } = applyPredicate(loans, 'fico_lt_620', {}, registry);
    // Cross-check: no loan in the set has fico >= 620.
    for (const l of loans) {
      if (set.has(l.loan_id)) {
        expect(Number(l.fico_score)).toBeLessThan(620);
      }
    }
    expect(set.size).toBeGreaterThan(0);
  });

  it('fico_lt honors override params', () => {
    const { set: at580 } = applyPredicate(loans, 'fico_lt_580', {}, registry);
    const { set: forced580 } = applyPredicate(loans, 'fico_lt_620', { threshold: 580 }, registry);
    expect(at580.size).toBe(forced580.size);
  });

  it('dti_gt fires when back_dti > threshold', () => {
    const { set } = applyPredicate(loans, 'dti_gt_50', {}, registry);
    for (const l of loans) {
      if (set.has(l.loan_id)) expect(Number(l.back_dti)).toBeGreaterThan(50);
    }
  });

  it('ltv_gt fires when ltv > threshold', () => {
    const { set } = applyPredicate(loans, 'ltv_gt_95', {}, registry);
    for (const l of loans) {
      if (set.has(l.loan_id)) expect(Number(l.ltv)).toBeGreaterThan(95);
    }
  });

  it('unknown predicate throws unknown_predicate', () => {
    expect(() => applyPredicate(loans, 'not_a_real_predicate', {}, registry)).toThrow(/unknown_predicate/);
  });

  it('manual_uw delegates to baked has_manual_uw boolean', () => {
    const { set } = applyPredicate(loans, 'manual_uw', {}, registry);
    let expected = 0;
    for (const l of loans) if (l.has_manual_uw === true) expected++;
    expect(set.size).toBe(expected);
  });

  it('boost_dti_tiered_v16 encapsulates v16 R002 rules (1)+(2)+(3), including FICO=None', () => {
    // v16 R002 (S3 Committee) branches (1)+(2)+(3):
    //   (1) FICO<660 or None
    //   (2) FICO 660-699 with front-end DTI >35.0%
    //   (3) FICO 700+ with front-end DTI >42.0%
    const { set } = applyPredicate(loans, 'boost_dti_tiered_v16', {}, registry);
    // Reference implementation directly on the fixture.
    let expected = 0;
    for (const l of loans) {
      const raw = l.fico_score;
      const isNull = raw === null || raw === undefined;
      const fico = Number(raw);
      const front = Number(l.front_dti);
      if (isNull) { expected++; continue; }
      if (Number.isFinite(fico) && fico < 660) { expected++; continue; }
      if (!Number.isFinite(front)) continue;
      if (fico >= 660 && fico <= 699 && front > 35.0) { expected++; continue; }
      if (fico >= 700 && front > 42.0) { expected++; continue; }
    }
    expect(set.size).toBe(expected);
    // Sanity: the compound predicate composed with is_boost matches the
    // three per-scenario removal-reason counts from v16 S3 Loan Audit:
    //   907 (fico<660) + 514 (front-DTI tier) + 1 (FICO None) = 1422.
    const { set: boost } = applyPredicate(loans, 'boost_membership', {}, registry);
    let intersect = 0;
    for (const id of set) if (boost.has(id)) intersect++;
    expect(intersect).toBe(907 + 514 + 1);
  });

  it('boost_dti_tiered_v16 matches the single Boost loan with FICO=None', () => {
    const { set } = applyPredicate(loans, 'boost_dti_tiered_v16', {}, registry);
    const nullFicoBoost = loans.filter(
      (l) => l.is_boost === true && (l.fico_score === null || l.fico_score === undefined),
    );
    expect(nullFicoBoost.length).toBe(1);
    for (const l of nullFicoBoost) {
      expect(set.has(l.loan_id)).toBe(true);
    }
  });
});
