import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Info, ExternalLink } from 'lucide-react';
import type { Snapshot, SnapshotProjections } from '@/types/snapshot';
import MethodologyContent from './MethodologyContent';

interface Props {
  snapshot: Snapshot | null;
  projections?: SnapshotProjections;
}

/**
 * Collapsed-by-default inline methodology explainer. Visible affordance at
 * the top of the Projections tab so Stefanie / any reviewer can pop it open
 * without leaving the tab. Links to the full standalone page for print /
 * share.
 */
export default function MethodologyInline({ snapshot, projections }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="text-sm font-semibold">How is this calculated?</span>
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            Formula · loan-level math · scenario semantics · assumptions
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/methodology/projections"
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] text-primary hover:underline flex items-center gap-1"
          >
            Full page <ExternalLink className="w-3 h-3" />
          </Link>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1">
          <MethodologyContent snapshot={snapshot} projections={projections} />
        </div>
      )}
    </div>
  );
}
