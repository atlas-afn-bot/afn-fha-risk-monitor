/**
 * Scenario store — unit tests for the localStorage-backed v1 shelf.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as store from '@/lib/scenarios/store';
import { SEED_SCENARIOS } from '@/lib/scenarios/seeds';

const OWNER = 'unit-test-owner';

describe('scenarios store — v1 localStorage shelf', () => {
  beforeEach(() => store._resetForTests(OWNER));
  afterEach(() => store._resetForTests(OWNER));

  it('list() returns the S1–S4 seeds when the shelf is empty', () => {
    const list = store.list(OWNER);
    expect(list.map((s) => s.id).sort()).toEqual(SEED_SCENARIOS.map((s) => s.id).sort());
  });

  it('create() hydrates seeds and appends a user scenario', () => {
    const created = store.create(OWNER, {
      name: 'My Scenario',
      description: 'anything',
      predicates: [{ predicate_id: 'boost_membership', params: {} }],
      composition_op: 'AND',
    });
    const list = store.list(OWNER);
    expect(list.some((s) => s.id === created.id)).toBe(true);
    // Seeds still present after hydration.
    expect(list.some((s) => s.id === 's1-boost-full-removal')).toBe(true);
    expect(list.length).toBe(SEED_SCENARIOS.length + 1);
    expect(created.id).toBe('my-scenario');
  });

  it('create() dedupes slugs on collision', () => {
    store.create(OWNER, { name: 'Same name', description: '', predicates: [{ predicate_id: 'boost_membership', params: {} }], composition_op: 'AND' });
    const second = store.create(OWNER, { name: 'Same name', description: '', predicates: [{ predicate_id: 'boost_membership', params: {} }], composition_op: 'AND' });
    expect(second.id).toBe('same-name-2');
  });

  it('update() refuses to modify a read-only seed', () => {
    const result = store.update(OWNER, 's1-boost-full-removal', { name: 'try to rename' });
    expect(result).toBeUndefined();
  });

  it('update() modifies a user-created scenario', () => {
    const created = store.create(OWNER, { name: 'Editable', description: '', predicates: [{ predicate_id: 'boost_membership', params: {} }], composition_op: 'AND' });
    const updated = store.update(OWNER, created.id, { name: 'Renamed' });
    expect(updated?.name).toBe('Renamed');
    expect(store.get(OWNER, created.id)?.name).toBe('Renamed');
  });

  it('setVisible() can hide a seed', () => {
    const hidden = store.setVisible(OWNER, 's2-boost-fico-eg', false);
    expect(hidden?.visible).toBe(false);
    expect(store.get(OWNER, 's2-boost-fico-eg')?.visible).toBe(false);
  });

  it('setVisible() persists across list() reads', () => {
    store.setVisible(OWNER, 's4-proprietary-dpa-guidelines-tighten', false);
    const list = store.list(OWNER);
    const s4 = list.find((s) => s.id === 's4-proprietary-dpa-guidelines-tighten');
    expect(s4?.visible).toBe(false);
  });
});
