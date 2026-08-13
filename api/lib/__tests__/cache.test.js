/**
 * Cache-key canonicalization tests + read/write round-trip via mock blob.
 */
// Vitest globals (describe/it/expect) are exposed via test.globals: true.
const { cacheKey, canonicalizeInput } = require('../evaluator/cache');

describe('evaluator cache key', () => {
  it('cache_key is deterministic across predicate ordering + param key ordering', () => {
    const a = cacheKey({
      snapshot_month: '2026-06',
      predicates: [
        { predicate_id: 'fico_lt_620', params: { threshold: 620 } },
        { predicate_id: 'boost_membership', params: {} },
      ],
      composition_op: 'OR',
    });
    const b = cacheKey({
      snapshot_month: '2026-06',
      predicates: [
        { predicate_id: 'boost_membership', params: {} },
        { predicate_id: 'fico_lt_620', params: { threshold: 620 } },
      ],
      composition_op: 'OR',
    });
    expect(a).toBe(b);
  });

  it('cache_key differs when composition_op differs', () => {
    const a = cacheKey({
      snapshot_month: '2026-06',
      predicates: [{ predicate_id: 'boost_membership' }],
      composition_op: 'AND',
    });
    const b = cacheKey({
      snapshot_month: '2026-06',
      predicates: [{ predicate_id: 'boost_membership' }],
      composition_op: 'OR',
    });
    expect(a).not.toBe(b);
  });

  it('cache_key differs when snapshot_month differs', () => {
    const a = cacheKey({
      snapshot_month: '2026-05',
      predicates: [{ predicate_id: 'boost_membership' }],
      composition_op: 'OR',
    });
    const b = cacheKey({
      snapshot_month: '2026-06',
      predicates: [{ predicate_id: 'boost_membership' }],
      composition_op: 'OR',
    });
    expect(a).not.toBe(b);
  });

  it('canonical params sort arrays for stable key', () => {
    const canonA = canonicalizeInput({
      snapshot_month: '2026-06',
      predicates: [{ predicate_id: 'gift_no_reserves', params: { gift_grant_groups: ['b', 'a'] } }],
      composition_op: 'OR',
    });
    const canonB = canonicalizeInput({
      snapshot_month: '2026-06',
      predicates: [{ predicate_id: 'gift_no_reserves', params: { gift_grant_groups: ['a', 'b'] } }],
      composition_op: 'OR',
    });
    expect(canonA).toBe(canonB);
  });
});
