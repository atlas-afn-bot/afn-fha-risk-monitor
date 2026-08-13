/**
 * Client-side scenario store — localStorage-backed, keyed by user OID.
 *
 * ## Why localStorage (v1)
 *
 * The design doc §5.3 defines server-side blob persistence (one JSON blob
 * per scenario under `stafnfhauploads/snapshots/scenarios/`), but the API
 * endpoints (§6.3–§6.7) are not implemented yet. Rather than block PR-C on
 * a fresh server-side write surface, the browser owns scenario state for
 * v1. When the server persistence lands, this module swaps to hitting the
 * `/api/scenarios/*` endpoints with the same signatures.
 *
 * **Open dependency:** server-side `/api/scenarios/*` CRUD (design §6.3–§6.7)
 * plus schema migration from browser-local storage → blob store.
 *
 * ## Key layout
 *
 * `afn-fha:scenarios:v1:{ownerId}` → JSON `Scenario[]`
 *
 * `ownerId` is best-effort — resolved from `x-ms-client-principal` decoded
 * against `document.cookie` if available, else `"anonymous"`. Every user
 * gets their own local scenario shelf; there is no cross-user visibility
 * until server persistence lands.
 *
 * ## Read-only seeds
 *
 * When the store is empty, `list()` returns SEED_SCENARIOS (frozen). Once
 * the user creates a scenario, we hydrate a copy of the seeds into their
 * store so they persist across sessions and the user can hide/tweak. This
 * mirrors the design doc §5.5 "S1–S4 seeds ship as pre-populated visible
 * scenarios on initial deploy."
 */
import type { Scenario, ScenarioPredicate } from './types';
import { SEED_SCENARIOS } from './seeds';

/**
 * localStorage key prefix. Bumped when we make a schema-breaking change
 * (e.g. add nested predicate trees).
 */
const KEY_PREFIX = 'afn-fha:scenarios:v1:';

/** Escape hatch for tests that want to isolate the store. */
export function storageKey(ownerId: string): string {
  return `${KEY_PREFIX}${ownerId || 'anonymous'}`;
}

/**
 * Resolve the owner id from the SWA-injected `x-ms-client-principal`
 * cookie when present, else fall back to `"anonymous"`.
 *
 * SWA sets a cookie called `StaticWebAppsAuthCookie` for authenticated
 * users and exposes principal metadata at `/.auth/me`. For the client-only
 * v1 we do a best-effort principal lookup — we do NOT block scenario CRUD
 * on it. If we can't identify the user, the store keys itself under
 * `anonymous` (fine for local dev where SSO is not wired up).
 */
export async function resolveOwnerId(): Promise<string> {
  if (typeof window === 'undefined') return 'anonymous';
  try {
    const res = await fetch('/.auth/me', { credentials: 'include' });
    if (!res.ok) return 'anonymous';
    const body = (await res.json()) as { clientPrincipal?: { userId?: string; userDetails?: string } };
    return body?.clientPrincipal?.userId || body?.clientPrincipal?.userDetails || 'anonymous';
  } catch {
    return 'anonymous';
  }
}

function readRaw(ownerId: string): Scenario[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(ownerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as Scenario[];
  } catch {
    return [];
  }
}

function writeRaw(ownerId: string, scenarios: Scenario[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(ownerId), JSON.stringify(scenarios));
  } catch (e) {
    // Storage quota, private mode, etc. — surface via console; the caller's
    // in-memory result is still correct for this session.
    console.warn('[scenarios] localStorage write failed', e);
  }
}

/**
 * Deep clone the seed scenarios so callers can mutate their copies safely.
 * `structuredClone` is available in every browser we target.
 */
function seedsCopy(): Scenario[] {
  return SEED_SCENARIOS.map((s) => ({ ...s, predicates: s.predicates.map((p) => ({ ...p, params: { ...p.params } })) }));
}

/**
 * List scenarios for this owner. If the store is empty, returns the
 * frozen seed scenarios directly (no write).
 */
export function list(ownerId: string): Scenario[] {
  const stored = readRaw(ownerId);
  if (stored.length === 0) return seedsCopy();
  return stored;
}

/** Fetch a single scenario by id. Falls back to seeds when store is empty. */
export function get(ownerId: string, id: string): Scenario | undefined {
  const all = list(ownerId);
  return all.find((s) => s.id === id);
}

function slugify(name: string, existing: Set<string>): string {
  const base = (name || 'scenario')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'scenario';
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export interface CreateScenarioInput {
  name: string;
  description: string;
  predicates: ScenarioPredicate[];
  composition_op: Scenario['composition_op'];
}

/**
 * Create a scenario. Hydrates the seeds into the store the first time
 * anything is written so subsequent hides/edits persist.
 */
export function create(ownerId: string, input: CreateScenarioInput): Scenario {
  const existing = readRaw(ownerId);
  const hydrated = existing.length === 0 ? seedsCopy() : existing;
  const now = new Date().toISOString();
  const id = slugify(input.name, new Set(hydrated.map((s) => s.id)));
  const scenario: Scenario = {
    schema_version: 1,
    id,
    name: input.name.trim() || 'Untitled scenario',
    description: input.description ?? '',
    predicates: input.predicates,
    composition_op: input.composition_op,
    evaluations: {},
    visible: true,
    created_by: null,
    created_at: now,
    updated_at: now,
  };
  writeRaw(ownerId, [...hydrated, scenario]);
  return scenario;
}

export interface UpdateScenarioInput {
  name?: string;
  description?: string;
  predicates?: ScenarioPredicate[];
  composition_op?: Scenario['composition_op'];
  visible?: boolean;
}

/**
 * Update a mutable scenario. Refuses to update read-only seeds (returns
 * `undefined`).
 */
export function update(ownerId: string, id: string, patch: UpdateScenarioInput): Scenario | undefined {
  const existing = readRaw(ownerId);
  const hydrated = existing.length === 0 ? seedsCopy() : existing;
  const idx = hydrated.findIndex((s) => s.id === id);
  if (idx === -1) return undefined;
  const target = hydrated[idx];
  if (target.readonly) return undefined;
  const now = new Date().toISOString();
  const next: Scenario = {
    ...target,
    ...patch,
    updated_at: now,
  };
  hydrated[idx] = next;
  writeRaw(ownerId, hydrated);
  return next;
}

/**
 * Toggle visibility (hide ≠ delete per §5.1). Works on user-created and
 * seed scenarios both — a user is allowed to hide the seeds from their
 * personal library.
 */
export function setVisible(ownerId: string, id: string, visible: boolean): Scenario | undefined {
  const existing = readRaw(ownerId);
  const hydrated = existing.length === 0 ? seedsCopy() : existing;
  const idx = hydrated.findIndex((s) => s.id === id);
  if (idx === -1) return undefined;
  const now = new Date().toISOString();
  hydrated[idx] = { ...hydrated[idx], visible, updated_at: now };
  writeRaw(ownerId, hydrated);
  return hydrated[idx];
}

/**
 * Wipe the store. Test-only affordance.
 */
export function _resetForTests(ownerId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey(ownerId));
}
