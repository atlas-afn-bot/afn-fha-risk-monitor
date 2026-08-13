/**
 * `/scenarios` — Scenario Library page (design §5.4).
 *
 * Renders the list of scenarios from the client-side store. Seeds S1–S4
 * appear on empty stores. Sort, hide/show toggle, link into detail view,
 * and a "Create new" action.
 *
 * Persistence backend for scenarios is client-only in v1 (localStorage,
 * keyed by user OID); see `src/lib/scenarios/store.ts`.
 */
import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as store from '@/lib/scenarios/store';
import type { Scenario } from '@/lib/scenarios/types';
import { predicateLabel } from '@/lib/scenarios/registry';
import { Button } from '@/components/ui/button';
import { Plus, EyeOff, Eye, ArrowLeft } from 'lucide-react';

interface ScenarioLibraryPageProps {
  /** Test hook — inject an owner id to skip async `resolveOwnerId`. */
  ownerId?: string;
}

type SortKey = 'name' | 'created_at' | 'n_removed';

export default function ScenarioLibraryPage({ ownerId: ownerIdProp }: ScenarioLibraryPageProps = {}): JSX.Element {
  const [ownerId, setOwnerId] = useState<string | null>(ownerIdProp ?? null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const navigate = useNavigate();

  useEffect(() => {
    if (ownerId) return;
    let cancelled = false;
    (async () => {
      const id = await store.resolveOwnerId();
      if (!cancelled) setOwnerId(id);
    })();
    return () => { cancelled = true; };
  }, [ownerId]);

  const refresh = useCallback((oid: string) => {
    setScenarios(store.list(oid));
  }, []);

  useEffect(() => {
    if (ownerId) refresh(ownerId);
  }, [ownerId, refresh]);

  function handleToggleVisible(s: Scenario) {
    if (!ownerId) return;
    store.setVisible(ownerId, s.id, !s.visible);
    refresh(ownerId);
  }

  const visibleScenarios = scenarios
    .filter((s) => (includeHidden ? true : s.visible))
    .slice()
    .sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'created_at') return b.created_at.localeCompare(a.created_at);
      // n_removed uses the latest evaluation across all periods; fall back to 0.
      const nA = latestNRemoved(a);
      const nB = latestNRemoved(b);
      return nB - nA;
    });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> Back to dashboard
            </Link>
            <h1 className="text-lg font-bold mt-1">Scenario Library</h1>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Saved what-if scenarios. Click a scenario to view the full impact analysis, or create a
              new one to explore how origination guideline changes shift the HUD compare ratio.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={includeHidden}
                onChange={(e) => setIncludeHidden(e.target.checked)}
                data-testid="include-hidden-toggle"
              />
              Show hidden
            </label>
            <label className="text-xs inline-flex items-center gap-1.5">
              Sort:
              <select
                className="text-xs px-1.5 py-0.5 border border-border rounded bg-background"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                data-testid="sort-select"
              >
                <option value="created_at">Newest first</option>
                <option value="name">Name</option>
                <option value="n_removed">Impact (loans removed)</option>
              </select>
            </label>
            <Button
              onClick={() => navigate('/scenarios/new')}
              size="sm"
              data-testid="new-scenario-button"
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> New scenario
            </Button>
          </div>
        </div>

        {visibleScenarios.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground text-center" data-testid="scenarios-empty">
            No scenarios yet. Create one to get started.
          </div>
        ) : (
          <ul className="space-y-2" data-testid="scenarios-list">
            {visibleScenarios.map((s) => (
              <li key={s.id} data-testid={`scenario-row-${s.id}`} className="border border-border rounded-md hover:border-primary/40 transition-colors">
                <div className="flex items-start gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/scenarios/${s.id}`} className="text-sm font-semibold hover:underline">
                        {s.name}
                      </Link>
                      {s.readonly && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">v16 seed</span>
                      )}
                      {!s.visible && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">hidden</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">op: {s.composition_op}</span>
                    </div>
                    {s.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.description}</p>
                    )}
                    <div className="text-[11px] text-muted-foreground mt-1.5 flex flex-wrap gap-1">
                      {s.predicates.slice(0, 4).map((p) => (
                        <span key={p.predicate_id} className="px-1.5 py-0.5 rounded bg-muted/60">
                          {predicateLabel(p.predicate_id)}
                        </span>
                      ))}
                      {s.predicates.length > 4 && (
                        <span className="px-1.5 py-0.5 text-muted-foreground">+{s.predicates.length - 4} more</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleVisible(s)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-muted text-muted-foreground"
                      aria-label={s.visible ? 'Hide scenario' : 'Show scenario'}
                      data-testid={`toggle-visible-${s.id}`}
                    >
                      {s.visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function latestNRemoved(s: Scenario): number {
  const periods = Object.keys(s.evaluations);
  if (periods.length === 0) return 0;
  const latest = periods.sort().at(-1)!;
  return s.evaluations[latest].n_removed;
}
