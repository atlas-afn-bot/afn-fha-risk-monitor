/**
 * FileUploads tab — six-slot upload of monthly committee files to Azure
 * Blob Storage, scoped to an allowlisted set of AFN users.
 *
 * Previous design (PR #20, June 2026): single drop zone, files landed in a
 * flat `/uploads/{yyyy-MM}/` layout. The committee asked us to carve those
 * into six explicit, labelled slot cards — one card per Excel input the
 * Python snapshot pipeline consumes — so the slot folder identifies each
 * input by its role rather than by filename parsing. Filenames stay
 * preserved for audit.
 *
 * Auth model:
 *   - The SWA (staticwebapp.config.json) gates the entire site behind
 *     Entra/AAD. The `/api/upload-sas` and `/api/list-recent-uploads`
 *     functions enforce a secondary allowlist (defense-in-depth).
 *   - This component asks `/.auth/me` for the current principal; if the
 *     caller isn't in the allowlist we show a friendly "no access" panel
 *     and skip the upload affordances entirely.
 *
 * Upload model:
 *   - User picks a month (default = latest available month = prior UTC
 *     month; the current month is excluded because its FHA snapshot does
 *     not exist yet). That month applies to every slot they touch on the
 *     page.
 *   - User drops or picks one file per slot. The slot ↔ category slug
 *     mapping is locked in `SLOT_DEFS` and matches the backend's
 *     `CATEGORY_SLUGS` exactly.
 *   - Component asks `/api/upload-sas { filename, category, month }` for a
 *     narrowly-scoped SAS URL, then PUTs the file body straight to blob
 *     storage with `x-ms-blob-type: BlockBlob`.
 *   - Replacing a slot's file uploads the new one (Azure overwrites the
 *     existing blob path since SAS has `create+write`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Upload as UploadIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  RefreshCw,
  LogIn,
  ShieldAlert,
  X,
  Play,
} from 'lucide-react';
import {
  triggerNwCheck,
  getNwTriggerStatus,
  type NwTriggerStatus,
} from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Month-name lookup used only for the NW auto-trigger success toast.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthDisplay(monthFolder: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthFolder);
  if (!m) return monthFolder;
  const idx = parseInt(m[2], 10) - 1;
  if (idx < 0 || idx > 11) return monthFolder;
  return `${MONTH_NAMES[idx]} ${m[1]}`;
}

// Guard so the NW trigger success toast for a given month fires at most
// once per browser session. The server-side marker blob still enforces
// true idempotency; this just prevents duplicate toasts when the same
// user re-uploads a slot after all 5 were already complete.
const nwToastShownForMonth = new Set<string>();

const ALLOWED_EMAILS = new Set<string>([
  'jdewindt@afncorp.com',
  'juliandomingo@afncorp.com',
  'mkunisaki@afncorp.com',
  'sbarkey@afncorp.com',
  'stallman@afncorp.com',
]);

const FILENAME_RE = /^[A-Za-z0-9._-]+$/;
const MAX_FILENAME_LEN = 200;

/**
 * The six canonical slot definitions. `slug` MUST match the backend's
 * `CATEGORY_SLUGS` set in `api/upload-sas/index.js` — the upload-sas smoke
 * test asserts the slug list there is exactly these six values.
 *
 * Ordering reflects the committee's mental model:
 *   1. HUD Branches            (per-branch NMLS performance)
 *   2. HOC Compare Ratios      (4-row regional roll-up)
 *   3. NW Data                 (HUD's seriously-delinquent list)
 *   4. HUD Total Compare Ratios (1-row nationwide + national totals)
 *   5. HUD Field Office        (~77-92 office-level rows)
 */
interface SlotDef {
  slug: string;
  title: string;
  description: string;
}

const SLOT_DEFS: ReadonlyArray<SlotDef> = [
  {
    slug: 'hud-branches',
    title: 'HUD Branches',
    description: 'Per-branch NMLS performance file (~85-99 rows).',
  },
  {
    slug: 'hoc-compare-ratios',
    title: 'HOC Compare Ratios',
    description: '4 regional Homeownership Centers (Atlanta, Denver, Philadelphia, Santa Ana).',
  },
  {
    slug: 'nw-data',
    title: 'NW Data',
    description: 'HUD seriously-delinquent loan list (~620 rows). Joined to Encompass by Case #.',
  },
  {
    slug: 'hud-total-compare-ratios',
    title: 'HUD Total Compare Ratios',
    description: 'Single nationwide row: Total / Retail / Sponsor ratios + Mix-Adj SDQ.',
  },
  {
    slug: 'hud-field-office',
    title: 'HUD Field Office',
    description: 'Office-level compare ratios (~77-92 offices).',
  },
];

/**
 * Subset of `SLOT_DEFS` that actually renders as tiles in the uploader UI.
 * `SLOT_DEFS` stays as the full backend-aligned 6-slot source of truth so
 * state shape, type derivations, and any future per-slot lookups still
 * cover every backend category.
 */
const VISIBLE_SLOT_DEFS: ReadonlyArray<SlotDef> = SLOT_DEFS;

type UploadStatus =
  | { kind: 'idle' }
  | { kind: 'uploading'; progress: number; file: File; displayName: string }
  | { kind: 'done'; blobPath: string; displayName: string; size: number }
  | { kind: 'error'; message: string; displayName?: string };

interface RecentItem {
  name: string;
  size: number;
  uploadedAt: string;
  contentType: string;
}

type AuthState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'unauthorized'; email: string }
  | { kind: 'authorized'; email: string };

/**
 * Latest month the FHA data supports = the calendar month *before* the current
 * UTC month. FHA snapshots for a month only become available after that month
 * closes, so the current month is never a valid choice.
 */
function latestAvailableMonthFolderUtc(): string {
  const d = new Date();
  d.setUTCDate(1); // avoid month-end rollover surprises
  d.setUTCMonth(d.getUTCMonth() - 1);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * Generate the last N months as YYYY-MM strings, newest first, starting from
 * the latest *available* month (= prior UTC month). The current UTC month is
 * intentionally excluded because its FHA snapshot does not exist yet.
 */
function recentMonths(count: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1); // start at prior month, not current
  for (let i = 0; i < count; i++) {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    out.push(`${yyyy}-${mm}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function sanitizeForDisplay(name: string): string {
  // Strip directory portion; collapse whitespace and disallowed characters
  // into underscores so the user has a chance to retry.
  const base = name.split(/[/\\]/).pop() ?? name;
  return base.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, MAX_FILENAME_LEN);
}

function isValidFilename(name: string): boolean {
  if (!name || name.length > MAX_FILENAME_LEN) return false;
  if (name === '.' || name === '..' || name.startsWith('.')) return false;
  return FILENAME_RE.test(name);
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * Ask the backend whether we just completed the 5th HUD slot for `month`.
 * Handles each branch of the NwTriggerCheckResponse union:
 *   - triggered:true     → success toast (once per month per session)
 *   - alreadyTriggered   → silent (marker already exists server-side)
 *   - missing            → silent (still short some slots)
 *   - disabled           → silent (feature flag off in this env)
 *   - error (HTTP 500)   → subtle error toast (server already emailed)
 */
async function checkNwTrigger(monthFolder: string): Promise<void> {
  try {
    const { ok, status, body } = await triggerNwCheck(monthFolder);
    if (!body) {
      if (!ok) {
        toast.error(
          `Auto-trigger check failed (HTTP ${status}). RPA Support has been notified.`,
        );
      }
      return;
    }
    if ('triggered' in body && body.triggered === true) {
      if (nwToastShownForMonth.has(monthFolder)) return;
      nwToastShownForMonth.add(monthFolder);
      toast.success(
        `✅ ${monthDisplay(monthFolder)} HUD inputs are complete. ` +
          `Neighborhood Watch is now generating the report — we'll email you when it's live on this dashboard.`,
      );
      return;
    }
    if ('error' in body) {
      toast.error(
        `Neighborhood Watch auto-trigger failed for ${monthDisplay(monthFolder)}. ` +
          `RPA Support has been notified (ref: ${body.correlationId ?? 'n/a'}).`,
      );
      return;
    }
    // silent for alreadyTriggered / missing / disabled
  } catch (_e) {
    // Network errors on the trigger check are non-fatal for the upload
    // itself; keep quiet so the user's upload-success UI stays clean.
  }
}

// ─── Manual-trigger button hook ────────────────────────────────────────
//
// Polls the GET status probe on mount and whenever the selected month
// changes. `refreshKey` gives the parent a manual re-fetch hook so we
// can update after a successful upload without forcing a full remount.

type NwButtonState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; status: NwTriggerStatus };

function useNwTriggerStatus(month: string, refreshKey: number): {
  state: NwButtonState;
  reload: () => void;
} {
  const [state, setState] = useState<NwButtonState>({ kind: 'loading' });
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const status = await getNwTriggerStatus(month);
        if (!cancelled) setState({ kind: 'ready', status });
      } catch (e) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month, refreshKey, tick]);

  return { state, reload };
}

function extractEmail(principal: any): string | null {
  if (!principal) return null;
  const candidates: string[] = [];
  if (typeof principal.userDetails === 'string') candidates.push(principal.userDetails);
  for (const c of principal.claims ?? []) {
    const t = String(c?.typ ?? '').toLowerCase();
    if (
      t === 'preferred_username' ||
      t === 'email' ||
      t.endsWith('/emailaddress') ||
      t === 'upn' ||
      t.endsWith('/upn')
    ) {
      if (typeof c.val === 'string') candidates.push(c.val);
    }
  }
  for (const c of candidates) {
    if (c.includes('@')) return c.trim().toLowerCase();
  }
  return null;
}

// ─── Slot card ──────────────────────────────────────────────────────────────

interface SlotCardProps {
  def: SlotDef;
  status: UploadStatus;
  monthFolder: string;
  onFile: (file: File) => void;
  onClear: () => void;
}

function SlotCard({ def, status, monthFolder, onFile, onClear }: SlotCardProps) {
  const [dragActive, setDragActive] = useState(false);
  const inputId = `slot-input-${def.slug}`;

  const busy = status.kind === 'uploading';
  const filled = status.kind === 'done';
  const errored = status.kind === 'error';

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (busy) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  const borderColor = errored
    ? 'border-risk-red/40'
    : filled
      ? 'border-risk-green/40'
      : dragActive
        ? 'border-primary'
        : 'border-border';

  const bgColor = errored
    ? 'bg-risk-red-bg/40'
    : filled
      ? 'bg-risk-green-bg/40'
      : dragActive
        ? 'bg-primary/5'
        : 'bg-muted/30';

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`relative rounded-lg border-2 border-dashed ${borderColor} ${bgColor} p-4 transition-colors min-h-[200px] flex flex-col`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold leading-tight">{def.title}</h4>
          <p className="text-[10px] text-muted-foreground mt-0.5">{def.description}</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            <span className="font-mono">{monthFolder}/{def.slug}/</span>
          </p>
        </div>
        {(filled || errored) && !busy && (
          <button
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 -m-1"
            aria-label={`Clear ${def.title}`}
            title="Clear slot"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 mt-3 flex flex-col items-center justify-center text-center">
        {status.kind === 'idle' && (
          <>
            <label
              htmlFor={inputId}
              className="cursor-pointer flex flex-col items-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <UploadIcon className="w-5 h-5 mb-1" />
              <span className="text-[11px] font-medium">Drop or click to choose</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">One file</span>
            </label>
          </>
        )}

        {status.kind === 'uploading' && (
          <>
            <FileText className="w-5 h-5 text-muted-foreground mb-1" />
            <span className="text-[11px] font-mono truncate max-w-full" title={status.displayName}>
              {status.displayName}
            </span>
            <span className="text-[10px] text-muted-foreground mt-0.5">
              {humanSize(status.file.size)}
            </span>
            <div className="w-full mt-2 h-1.5 bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${status.progress}%` }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Uploading… {status.progress}%
            </div>
          </>
        )}

        {status.kind === 'done' && (
          <>
            <CheckCircle2 className="w-5 h-5 text-risk-green mb-1" />
            <span className="text-[11px] font-mono truncate max-w-full" title={status.displayName}>
              {status.displayName}
            </span>
            <span className="text-[10px] text-muted-foreground mt-0.5">
              {humanSize(status.size)} · Complete
            </span>
            <label
              htmlFor={inputId}
              className="cursor-pointer mt-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Drop a new file to replace
            </label>
          </>
        )}

        {status.kind === 'error' && (
          <>
            <AlertCircle className="w-5 h-5 text-risk-red mb-1" />
            {status.displayName && (
              <span className="text-[11px] font-mono truncate max-w-full" title={status.displayName}>
                {status.displayName}
              </span>
            )}
            <span className="text-[10px] text-risk-red mt-0.5 break-words">
              {status.message}
            </span>
            <label
              htmlFor={inputId}
              className="cursor-pointer mt-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Try again
            </label>
          </>
        )}
      </div>

      {/* Hidden input */}
      <input
        id={inputId}
        type="file"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ─── Manual NW trigger button + dialog ─────────────────────────────

interface ManualNwTriggerButtonProps {
  monthFolder: string;
  state: NwButtonState;
  onClick: () => void;
  onRefresh: () => void;
}

function ManualNwTriggerButton({
  monthFolder,
  state,
  onClick,
  onRefresh,
}: ManualNwTriggerButtonProps) {
  // Derived state from the status probe.
  const loading = state.kind === 'loading';
  const errored = state.kind === 'error';
  const status = state.kind === 'ready' ? state.status : null;
  const complete = status ? status.allSlotsComplete : false;
  const missing = status ? status.missing : [];
  const encExists = status ? status.encDataExists : false;

  // Button is disabled while probing, on probe error, or when the
  // completeness check hasn't been satisfied yet.
  const disabled = loading || errored || !complete;

  // Variant + tooltip depend on the three ready-state branches.
  let variant: 'default' | 'destructive' | 'secondary' | 'outline' = 'default';
  let tooltip = `Trigger Neighborhood Watch for ${monthDisplay(monthFolder)}`;
  if (loading) {
    tooltip = 'Checking upload status…';
  } else if (errored) {
    tooltip = 'Could not reach the trigger status probe. Click refresh to retry.';
  } else if (!complete) {
    tooltip = 'Upload all 5 HUD files first';
  } else if (encExists) {
    variant = 'destructive';
    tooltip = 'Enc_Data already exists — clicking will regenerate';
  }

  const missingLabel =
    missing.length > 0
      ? ` (missing ${missing.length}/5: ${missing.join(', ')})`
      : '';

  return (
    <div
      className="bg-card rounded-lg border border-border p-5 flex items-center justify-between gap-4 flex-wrap"
      data-testid="nw-manual-trigger-panel"
    >
      <div className="flex-1 min-w-0">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Neighborhood Watch report
        </h4>
        <p className="text-[11px] text-muted-foreground mt-1">
          {loading && 'Checking upload status…'}
          {errored &&
            'Could not reach the trigger status probe. Try refreshing.'}
          {!loading && !errored && complete && !encExists && (
            <>
              All 5 HUD files are in place for{' '}
              <span className="font-mono">{monthFolder}</span>. Click to
              enqueue the Neighborhood Watch bot.
            </>
          )}
          {!loading && !errored && complete && encExists && (
            <>
              An <span className="font-mono">Enc_Data</span> file already
              exists for <span className="font-mono">{monthFolder}</span>.
              Clicking will regenerate and overwrite it.
            </>
          )}
          {!loading && !errored && !complete && (
            <>
              Waiting on{' '}
              <span className="font-mono">{monthFolder}</span> HUD files{missingLabel}.
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Refresh trigger status"
          title="Refresh trigger status"
          type="button"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <Button
          onClick={onClick}
          disabled={disabled}
          variant={variant}
          size="sm"
          title={tooltip}
          data-testid="nw-manual-trigger-button"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Checking…
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              Manually trigger Neighborhood Watch report
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

interface ManualNwTriggerDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  monthFolder: string;
  encDataExists: boolean;
  pending: boolean;
  onConfirm: () => void;
}

function ManualNwTriggerDialog({
  open,
  onOpenChange,
  monthFolder,
  encDataExists,
  pending,
  onConfirm,
}: ManualNwTriggerDialogProps) {
  const monthName = monthDisplay(monthFolder);

  const title = encDataExists
    ? `Re-generate Neighborhood Watch report for ${monthName}?`
    : `Trigger Neighborhood Watch report for ${monthName}?`;

  const body = encDataExists
    ? `An Enc_Data file already exists for ${monthName}. Clicking Yes will queue the NW bot to regenerate and overwrite it. This action cannot be undone.`
    : `This will queue the NW bot to generate the report for ${monthName}. You'll be emailed when it's ready.`;

  const confirmLabel = encDataExists ? 'Yes, regenerate' : 'Yes, trigger';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (pending) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant={encDataExists ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={pending}
            data-testid="nw-manual-trigger-confirm"
          >
            {pending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Working…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export default function FileUploads() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });
  const [slotStatus, setSlotStatus] = useState<Record<string, UploadStatus>>(() =>
    Object.fromEntries(SLOT_DEFS.map((s) => [s.slug, { kind: 'idle' as const }])),
  );
  const [recent, setRecent] = useState<RecentItem[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);

  // Month selector — default to current UTC month, allow user to pick last 12.
  const months = useMemo(() => recentMonths(12), []);
  const [monthFolder, setMonthFolder] = useState<string>(latestAvailableMonthFolderUtc());

  // Manual-trigger button state.
  const [nwStatusRefreshKey, setNwStatusRefreshKey] = useState(0);
  const { state: nwButtonState, reload: reloadNwStatus } = useNwTriggerStatus(
    monthFolder,
    nwStatusRefreshKey,
  );
  const [manualConfirmOpen, setManualConfirmOpen] = useState(false);
  const [manualTriggering, setManualTriggering] = useState(false);

  // ── Auth bootstrap ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.auth/me', { credentials: 'include' });
        if (!res.ok) {
          if (!cancelled) setAuth({ kind: 'anonymous' });
          return;
        }
        const body = await res.json().catch(() => null);
        const principal = body?.clientPrincipal ?? null;
        if (!principal) {
          if (!cancelled) setAuth({ kind: 'anonymous' });
          return;
        }
        const email = extractEmail(principal);
        if (!email) {
          if (!cancelled) setAuth({ kind: 'anonymous' });
          return;
        }
        if (cancelled) return;
        if (ALLOWED_EMAILS.has(email)) {
          setAuth({ kind: 'authorized', email });
        } else {
          setAuth({ kind: 'unauthorized', email });
        }
      } catch {
        if (!cancelled) setAuth({ kind: 'anonymous' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Recent uploads ────────────────────────────────────────────────────────
  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    setRecentError(null);
    try {
      const res = await fetch('/api/list-recent-uploads', { credentials: 'include' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
      }
      const body = await res.json();
      setRecent(Array.isArray(body.items) ? body.items : []);
    } catch (e) {
      setRecentError(e instanceof Error ? e.message : String(e));
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auth.kind === 'authorized') {
      loadRecent();
    }
  }, [auth.kind, loadRecent]);

  // ── Upload one file to one slot ──────────────────────────────────────────
  const uploadToSlot = useCallback(
    async (slug: string, file: File) => {
      const displayName = sanitizeForDisplay(file.name);

      if (!isValidFilename(displayName)) {
        setSlotStatus((prev) => ({
          ...prev,
          [slug]: {
            kind: 'error',
            message:
              'Filename could not be sanitized to safe characters. Rename and retry.',
            displayName: file.name,
          },
        }));
        return;
      }

      setSlotStatus((prev) => ({
        ...prev,
        [slug]: { kind: 'uploading', progress: 0, file, displayName },
      }));

      // 1) Get the SAS for {category=slug, month=monthFolder}
      let sasBody: { uploadUrl: string; blobPath: string; expiresAt: string; category: string; month: string };
      try {
        const sasRes = await fetch('/api/upload-sas', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: displayName, category: slug, month: monthFolder }),
        });
        if (!sasRes.ok) {
          const text = await sasRes.text().catch(() => '');
          throw new Error(`SAS request failed (HTTP ${sasRes.status})${text ? `: ${text}` : ''}`);
        }
        sasBody = await sasRes.json();
      } catch (e) {
        setSlotStatus((prev) => ({
          ...prev,
          [slug]: {
            kind: 'error',
            message: e instanceof Error ? e.message : String(e),
            displayName,
          },
        }));
        return;
      }

      // 2) PUT the blob with progress
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sasBody.uploadUrl, true);
        xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
        xhr.setRequestHeader(
          'x-ms-blob-content-type',
          file.type || 'application/octet-stream',
        );
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const pct = Math.round((evt.loaded / evt.total) * 100);
            setSlotStatus((prev) => {
              const cur = prev[slug];
              if (cur.kind !== 'uploading') return prev;
              return { ...prev, [slug]: { ...cur, progress: pct } };
            });
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setSlotStatus((prev) => ({
              ...prev,
              [slug]: {
                kind: 'done',
                blobPath: sasBody.blobPath,
                displayName,
                size: file.size,
              },
            }));
            // Fire-and-forget NW auto-trigger check. Runs off the SAS
            // upload path so latency stays off the visible upload.
            void checkNwTrigger(monthFolder);
          } else {
            setSlotStatus((prev) => ({
              ...prev,
              [slug]: {
                kind: 'error',
                message: `Blob PUT failed (HTTP ${xhr.status}) ${xhr.responseText?.slice(0, 200) ?? ''}`,
                displayName,
              },
            }));
          }
          resolve();
        };
        xhr.onerror = () => {
          setSlotStatus((prev) => ({
            ...prev,
            [slug]: {
              kind: 'error',
              message: 'Network error during upload.',
              displayName,
            },
          }));
          resolve();
        };
        xhr.send(file);
      });

      // Refresh recent list after a successful PUT.
      loadRecent();
      // The new upload may have completed the 5-slot set; refresh the
      // manual-trigger button's status probe so it enables/disables
      // without waiting for a tab remount.
      setNwStatusRefreshKey((k) => k + 1);
    },
    [loadRecent, monthFolder],
  );

  // Manual-trigger POST handler. Called when the user confirms in the dialog.
  const runManualTrigger = useCallback(async () => {
    setManualTriggering(true);
    const encDataWasPresent =
      nwButtonState.kind === 'ready' &&
      nwButtonState.status.encDataExists === true;
    try {
      const { ok, status, body } = await triggerNwCheck(monthFolder, { force: true });
      if (body && 'triggered' in body && body.triggered === true) {
        if (encDataWasPresent) {
          toast.success(
            `✅ Neighborhood Watch report for ${monthDisplay(monthFolder)} is regenerating — ` +
              `we'll email you when the updated version is live on this dashboard.`,
          );
        } else {
          toast.success(
            `✅ ${monthDisplay(monthFolder)} HUD inputs are complete. ` +
              `Neighborhood Watch is now generating the report — we'll email you when it's live on this dashboard.`,
          );
        }
        // Belt-and-suspenders: mark this month's toast as "already shown"
        // so the auto-trigger doesn't fire a duplicate toast on the
        // next upload.
        nwToastShownForMonth.add(monthFolder);
      } else if (body && 'missing' in body && Array.isArray(body.missing) && body.missing.length > 0) {
        // Should not happen (button disabled when incomplete), but guard anyway.
        toast.error(
          `Can't trigger Neighborhood Watch — still missing ${body.missing.length} HUD file(s).`,
        );
      } else if (body && 'error' in body) {
        toast.error(
          `Neighborhood Watch trigger failed for ${monthDisplay(monthFolder)}. ` +
            `RPA Support has been notified (ref: ${body.correlationId ?? 'n/a'}).`,
        );
      } else if (!ok) {
        toast.error(`Neighborhood Watch trigger failed (HTTP ${status}).`);
      }
    } catch (e) {
      toast.error(
        `Neighborhood Watch trigger failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setManualTriggering(false);
      setManualConfirmOpen(false);
      // Re-probe status — after a successful force, the enc-data blob
      // will get rewritten by the bot, so encDataExists will flip true
      // once the bot finishes. Refresh now so the button reflects the
      // marker-rewritten state; the enc-data check just polls the
      // current blob state.
      setNwStatusRefreshKey((k) => k + 1);
    }
  }, [monthFolder, nwButtonState]);

  const clearSlot = useCallback((slug: string) => {
    setSlotStatus((prev) => ({ ...prev, [slug]: { kind: 'idle' } }));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  if (auth.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-12 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking sign-in…
      </div>
    );
  }

  if (auth.kind === 'anonymous') {
    return (
      <div className="max-w-xl mx-auto mt-12 bg-card border border-border rounded-lg p-6 text-center space-y-4">
        <LogIn className="w-8 h-8 mx-auto text-muted-foreground" />
        <h3 className="text-sm font-semibold">Sign in to upload files</h3>
        <p className="text-xs text-muted-foreground">
          You need to sign in with your AFN account to access the upload area.
        </p>
        <a
          href="/.auth/login/aad?post_login_redirect_uri=/?tab=uploads"
          className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <LogIn className="w-3.5 h-3.5" />
          Sign in with AFN account
        </a>
      </div>
    );
  }

  if (auth.kind === 'unauthorized') {
    return (
      <div className="max-w-xl mx-auto mt-12 bg-card border border-risk-red/30 rounded-lg p-6 text-center space-y-3">
        <ShieldAlert className="w-8 h-8 mx-auto text-risk-red" />
        <h3 className="text-sm font-semibold">No upload access</h3>
        <p className="text-xs text-muted-foreground">
          You're signed in as <span className="font-mono">{auth.email}</span>, but your account
          isn't on the upload allowlist for the FHA Risk Monitor.
        </p>
        <p className="text-xs text-muted-foreground">
          Contact Jacob, Julian, Michael, or Stefanie if you believe you should have access.
        </p>
      </div>
    );
  }

  // Authorized path
  return (
    <div className="space-y-6">
      {/* Header + month selector */}
      <div className="bg-card rounded-lg border border-border p-5 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <UploadIcon className="w-4 h-4" />
              File Uploads
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Drop committee files into the labelled slots below. Each slot
              accepts a single file and lands in its own folder under the
              selected month: <span className="font-mono">uploads/{monthFolder}/{'{'}slug{'}'}/</span>.
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Signed in as <span className="font-mono">{auth.email}</span>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="upload-month" className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Month
            </label>
            <select
              id="upload-month"
              value={monthFolder}
              onChange={(e) => setMonthFolder(e.target.value)}
              className="text-xs border border-border rounded-md bg-background px-2 py-1.5 font-mono"
            >
              {months.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Slot cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {VISIBLE_SLOT_DEFS.map((def) => (
          <SlotCard
            key={def.slug}
            def={def}
            status={slotStatus[def.slug]}
            monthFolder={monthFolder}
            onFile={(file) => uploadToSlot(def.slug, file)}
            onClear={() => clearSlot(def.slug)}
          />
        ))}
      </div>

      {/* Manual Neighborhood Watch trigger button */}
      <ManualNwTriggerButton
        monthFolder={monthFolder}
        state={nwButtonState}
        onClick={() => setManualConfirmOpen(true)}
        onRefresh={reloadNwStatus}
      />

      {/* Confirmation dialog */}
      <ManualNwTriggerDialog
        open={manualConfirmOpen}
        onOpenChange={(v) => {
          if (!manualTriggering) setManualConfirmOpen(v);
        }}
        monthFolder={monthFolder}
        encDataExists={
          nwButtonState.kind === 'ready' && nwButtonState.status.encDataExists === true
        }
        pending={manualTriggering}
        onConfirm={runManualTrigger}
      />

      {/* Recent uploads */}
      <div className="bg-card rounded-lg border border-border p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Recent uploads (last 20)
          </h4>
          <button
            onClick={loadRecent}
            disabled={recentLoading}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${recentLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        {recentError && (
          <p className="text-[11px] text-risk-red flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {recentError}
          </p>
        )}
        {recentLoading && !recent && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading…
          </p>
        )}
        {recent && recent.length === 0 && !recentLoading && !recentError && (
          <p className="text-[11px] text-muted-foreground">No uploads yet.</p>
        )}
        {recent && recent.length > 0 && (
          <ul className="divide-y divide-border text-xs">
            {recent.map((item) => (
              <li key={item.name} className="py-2 flex items-center gap-3">
                <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="font-mono truncate flex-1">{item.name}</span>
                <span className="text-muted-foreground tabular-nums flex-shrink-0">
                  {humanSize(item.size)}
                </span>
                <span className="text-muted-foreground flex-shrink-0">
                  {new Date(item.uploadedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
