/**
 * `/scenarios/:id` — Scenario Detail page (design §5.4).
 *
 * Shows the full scenario read-view: name, description, predicates,
 * composition op, live evaluate preview against the latest snapshot, and
 * the XLSX export button (wired to a TODO handler since the backend
 * `POST /api/scenarios/:id/xlsx` endpoint does not exist yet — see PR body
 * open dependencies + design doc §5.6, §5.x, §9 Q13).
 *
 * Deep-link cold load is supported: the page pulls its own snapshot
 * period + owner id + scenario from the URL param, so pasting
 * `/scenarios/:id` into a fresh tab renders correctly.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ScenarioPreview } from '@/components/scenarios/ScenarioPreview';
import * as store from '@/lib/scenarios/store';
import { loadSnapshotIndex } from '@/lib/snapshotLoader';
import type { Scenario } from '@/lib/scenarios/types';
import { getPredicate, predicateLabel } from '@/lib/scenarios/registry';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download, EyeOff, Eye, Pencil, Loader2 } from 'lucide-react';

export interface ScenarioDetailPageProps {
  /** Test hook — inject an owner id / snapshot period. Also lets tests
   *  render the page with an explicit `id` when they don't wrap in Router. */
  ownerId?: string;
  snapshotMonth?: string;
  id?: string;
  previewDebounceMs?: number;
}

export default function ScenarioDetailPage(props: ScenarioDetailPageProps = {}): JSX.Element {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const id = props.id ?? params.id ?? '';

  const [ownerId, setOwnerId] = useState<string | null>(props.ownerId ?? null);
  const [snapshotMonth, setSnapshotMonth] = useState<string | null>(props.snapshotMonth ?? null);
  const [scenario, setScenario] = useState<Scenario | null | undefined>(undefined);
  const [xlsxLoading, setXlsxLoading] = useState(false);

  useEffect(() => {
    if (ownerId) return;
    let cancelled = false;
    (async () => {
      const oid = await store.resolveOwnerId();
      if (!cancelled) setOwnerId(oid);
    })();
    return () => { cancelled = true; };
  }, [ownerId]);

  useEffect(() => {
    if (snapshotMonth) return;
    let cancelled = false;
    (async () => {
      try {
        const idx = await loadSnapshotIndex();
        if (!cancelled) setSnapshotMonth(idx.periods[0].period);
      } catch {
        if (!cancelled) setSnapshotMonth('2026-06');
      }
    })();
    return () => { cancelled = true; };
  }, [snapshotMonth]);

  const reload = useCallback(() => {
    if (!ownerId) return;
    const found = store.get(ownerId, id);
    setScenario(found ?? null);
  }, [ownerId, id]);

  useEffect(() => {
    if (!ownerId) return;
    reload();
  }, [ownerId, reload]);

  // XLSX export button — design §5.6, §6.8. Backend endpoint is not yet
  // implemented; wire to a TODO handler that shows a toast. Filed under
  // "open dependencies" on the PR body.
  const handleXlsxExport = useCallback(async () => {
    if (!scenario) return;
    setXlsxLoading(true);
    try {
      // TODO(post-PR-C, Q13): once `POST /api/scenarios/:id/xlsx` ships on
      // a Container App-hosted Python runtime (recommended per design §5.x),
      // swap this to a real fetch and stream the workbook download.
      toast.warning('XLSX export pending backend endpoint', {
        description: 'The `POST /api/scenarios/:id/xlsx` route is planned for a follow-up PR (see design §5.6, §5.x, Q13).',
      });
    } finally {
      setXlsxLoading(false);
    }
  }, [scenario]);

  function handleToggleVisible() {
    if (!ownerId || !scenario) return;
    store.setVisible(ownerId, scenario.id, !scenario.visible);
    reload();
    toast.success(scenario.visible ? 'Scenario hidden' : 'Scenario shown');
  }

  if (scenario === undefined || !ownerId || !snapshotMonth) {
    return (
      <PageShell title="Loading scenario…">
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Loading…
        </div>
      </PageShell>
    );
  }

  if (scenario === null) {
    return (
      <PageShell title="Scenario not found">
        <p className="text-sm text-muted-foreground">
          We couldn't find a scenario with id "{id}". <Link className="underline" to="/scenarios">Back to library</Link>.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell title={scenario.name} snapshotMonth={snapshotMonth} scenario={scenario}>
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          size="sm"
          onClick={handleXlsxExport}
          disabled={xlsxLoading}
          data-testid="xlsx-export-button"
        >
          <Download className="w-3.5 h-3.5 mr-1" /> Export XLSX
        </Button>
        {!scenario.readonly && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => navigate(`/scenarios/${scenario.id}/edit`)}
            data-testid="edit-scenario-button"
          >
            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleToggleVisible}
          data-testid="toggle-visible-button"
        >
          {scenario.visible ? (
            <>
              <EyeOff className="w-3.5 h-3.5 mr-1" /> Hide
            </>
          ) : (
            <>
              <Eye className="w-3.5 h-3.5 mr-1" /> Show
            </>
          )}
        </Button>
      </div>

      {scenario.description && (
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-foreground/80" data-testid="scenario-description">
          {scenario.description}
        </div>
      )}

      {/* Predicate summary. */}
      <div className="space-y-1" data-testid="scenario-predicate-summary">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Predicates ({scenario.predicates.length}) — combined with{' '}
          <span className="text-foreground">{scenario.composition_op}</span>
        </div>
        <ul className="space-y-1">
          {scenario.predicates.map((p) => {
            const spec = getPredicate(p.predicate_id);
            return (
              <li key={p.predicate_id} className="text-xs border border-border rounded px-2 py-1 flex items-center gap-2 flex-wrap">
                <span className="font-medium">{predicateLabel(p.predicate_id)}</span>
                {spec && spec.params.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    ({spec.params.map((param) => `${param.name}=${String(p.params[param.name] ?? param.default)}`).join(', ')})
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">{spec?.family ?? ''}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <ScenarioPreview
        snapshotMonth={snapshotMonth}
        predicates={scenario.predicates.map(({ predicate_id, params }) => ({ predicate_id, params }))}
        compositionOp={scenario.composition_op === 'WEIGHTED' ? 'OR' : scenario.composition_op}
        debounceMs={props.previewDebounceMs}
      />
    </PageShell>
  );
}

function PageShell({
  title,
  snapshotMonth,
  scenario,
  children,
}: {
  title: string;
  snapshotMonth?: string;
  scenario?: Scenario;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Link to="/scenarios" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> Back to library
            </Link>
            <h1 className="text-lg font-bold mt-1" data-testid="scenario-detail-title">{title}</h1>
            {scenario && (
              <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                <span>id: <code className="px-1 bg-muted rounded">{scenario.id}</code></span>
                {scenario.readonly && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted">v16 seed (read-only)</span>
                )}
                {!scenario.visible && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted">hidden</span>
                )}
              </div>
            )}
          </div>
          {snapshotMonth && (
            <div className="text-[11px] text-muted-foreground">
              Evaluated against snapshot <code className="px-1 bg-muted rounded">{snapshotMonth}</code>
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
