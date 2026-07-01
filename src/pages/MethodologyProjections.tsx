import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import type { Snapshot } from '@/types/snapshot';
import { loadSnapshotIndex, loadSnapshot } from '@/lib/snapshotLoader';
import MethodologyContent from '@/components/projections/MethodologyContent';

/**
 * Full-page methodology explainer at `/methodology/projections`.
 *
 * Same content as the inline panel, but with more whitespace and a
 * print/share-friendly layout. Linked from the inline "How is this
 * calculated?" section on the Projections tab.
 */
export default function MethodologyProjections() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idx = await loadSnapshotIndex();
        const target = idx.periods[0].period;
        const snap = await loadSnapshot(target);
        if (!cancelled) setSnapshot(snap);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load snapshot');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6 print:hidden">
          <Link
            to="/?tab=projections"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Projections
          </Link>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border hover:bg-muted"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / Save PDF
          </button>
        </div>

        <div className="mb-6">
          <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
            American Financial Network — FHA Risk Monitor
          </p>
          <h1 className="text-2xl font-bold mt-1">Projections Methodology</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            How the forward-looking Compare Ratio, scenario stress, and loan-level roll-off
            projections are computed. Reference document for reviewers and validators.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-risk-red/30 bg-risk-red-bg p-4 mb-6 text-xs text-risk-red">
            {error}
          </div>
        )}

        <MethodologyContent
          snapshot={snapshot}
          projections={snapshot?.projections}
          full
        />

        <footer className="mt-10 pt-4 border-t border-border text-[10px] text-muted-foreground print:mt-6">
          <p>
            <strong>Confidential:</strong> This document contains proprietary methodology
            for American Financial Network's HUD Compare Ratio Committee analytics.
            Distribution restricted to authorized personnel.
          </p>
          <p className="mt-1">
            Engine: <code>scripts/build_projections.py</code> · Backend PR #29 · Frontend
            initial ship: FHA Risk Monitor Projections tab v1.
          </p>
        </footer>
      </div>
    </div>
  );
}
