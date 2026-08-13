/**
 * `/scenarios/new` and `/scenarios/:id/edit` — Scenario Builder page.
 *
 * Wraps `<ScenarioBuilder />` with the localStorage store persistence and
 * snapshot period resolution. On save, redirects to `/scenarios/:id`.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ScenarioBuilder } from '@/components/scenarios/ScenarioBuilder';
import * as store from '@/lib/scenarios/store';
import { loadSnapshotIndex } from '@/lib/snapshotLoader';
import type { Scenario } from '@/lib/scenarios/types';
import { ArrowLeft, Loader2 } from 'lucide-react';

export interface ScenarioBuilderPageProps {
  mode: 'new' | 'edit';
  /** Test hook — inject an owner id / snapshot period / preview debounce. */
  ownerId?: string;
  snapshotMonth?: string;
  previewDebounceMs?: number;
}

export default function ScenarioBuilderPage(props: ScenarioBuilderPageProps): JSX.Element {
  const { mode, ownerId: ownerIdProp, snapshotMonth: monthProp, previewDebounceMs } = props;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [ownerId, setOwnerId] = useState<string | null>(ownerIdProp ?? null);
  const [snapshotMonth, setSnapshotMonth] = useState<string | null>(monthProp ?? null);
  const [initial, setInitial] = useState<Scenario | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(!ownerIdProp || !monthProp);

  // Resolve owner id.
  useEffect(() => {
    if (ownerId) return;
    let cancelled = false;
    (async () => {
      const oid = await store.resolveOwnerId();
      if (!cancelled) setOwnerId(oid);
    })();
    return () => { cancelled = true; };
  }, [ownerId]);

  // Resolve snapshot period.
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

  // Load target scenario in edit mode.
  useEffect(() => {
    if (mode !== 'edit' || !ownerId || !id) return;
    const found = store.get(ownerId, id);
    if (!found) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    if (found.readonly) {
      // Seed scenarios are read-only; bounce back to detail.
      toast.info('Seed scenarios cannot be edited. Create a copy to customize.');
      navigate(`/scenarios/${found.id}`, { replace: true });
      return;
    }
    setInitial(found);
    setLoading(false);
  }, [mode, ownerId, id, navigate]);

  useEffect(() => {
    if (ownerId && snapshotMonth) setLoading(false);
  }, [ownerId, snapshotMonth]);

  if (notFound) {
    return (
      <PageShell title="Scenario not found">
        <p className="text-sm text-muted-foreground">
          We couldn't find a scenario with id "{id}". <Link className="underline" to="/scenarios">Back to library</Link>.
        </p>
      </PageShell>
    );
  }

  if (loading || !ownerId || !snapshotMonth) {
    return (
      <PageShell title={mode === 'new' ? 'New scenario' : 'Edit scenario'}>
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Loading…
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title={mode === 'new' ? 'New scenario' : `Edit — ${initial?.name ?? ''}`} snapshotMonth={snapshotMonth}>
      <ScenarioBuilder
        snapshotMonth={snapshotMonth}
        initial={
          initial
            ? {
                name: initial.name,
                description: initial.description,
                predicates: initial.predicates,
                composition_op: initial.composition_op,
              }
            : undefined
        }
        submitLabel={mode === 'edit' ? 'Save changes' : 'Save scenario'}
        onSave={(input) => {
          if (mode === 'new') {
            const created = store.create(ownerId, input);
            toast.success(`Created "${created.name}"`);
            navigate(`/scenarios/${created.id}`, { replace: true });
          } else if (initial) {
            const updated = store.update(ownerId, initial.id, input);
            if (!updated) {
              toast.error('Save failed — scenario may be read-only.');
              return;
            }
            toast.success('Scenario updated.');
            navigate(`/scenarios/${initial.id}`, { replace: true });
          }
        }}
        onCancel={() => navigate(-1)}
        previewDebounceMs={previewDebounceMs}
      />
    </PageShell>
  );
}

function PageShell({ title, snapshotMonth, children }: { title: string; snapshotMonth?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1600px] mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <Link to="/scenarios" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> Back to library
            </Link>
            <h1 className="text-lg font-bold mt-1">{title}</h1>
          </div>
          {snapshotMonth && (
            <div className="text-[11px] text-muted-foreground">
              Evaluating against snapshot <code className="px-1 bg-muted rounded">{snapshotMonth}</code>
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
