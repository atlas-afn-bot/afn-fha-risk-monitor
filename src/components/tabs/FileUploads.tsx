/**
 * FileUploads tab — drag-and-drop upload of monthly committee files to
 * Azure Blob Storage, scoped to an allowlisted set of AFN users.
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
 *   - User drops files → component asks `/api/upload-sas { filename }`
 *     for a narrowly-scoped SAS URL.
 *   - Component PUTs the file body straight to blob storage with the
 *     `x-ms-blob-type: BlockBlob` header.
 *   - The month folder is server-stamped (UTC) at SAS-issuance time, so
 *     the UI displays it for informational purposes only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload as UploadIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  RefreshCw,
  LogIn,
  ShieldAlert,
} from 'lucide-react';

const ALLOWED_EMAILS = new Set<string>([
  'jdewindt@afncorp.com',
  'juliandomingo@afncorp.com',
  'mkunisaki@afncorp.com',
  'stallman@afncorp.com',
]);

const FILENAME_RE = /^[A-Za-z0-9._-]+$/;
const MAX_FILENAME_LEN = 200;

type UploadStatus =
  | { kind: 'pending' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'done'; blobPath: string }
  | { kind: 'error'; message: string };

interface QueuedUpload {
  id: string;
  file: File;
  displayName: string;
  status: UploadStatus;
}

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

function currentMonthFolderUtc(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
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

export default function FileUploads() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [recent, setRecent] = useState<RecentItem[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queueIdSeq = useRef(0);

  const monthFolder = useMemo(() => currentMonthFolderUtc(), []);

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

  // ── Upload one file ───────────────────────────────────────────────────────
  const uploadOne = useCallback(async (item: QueuedUpload) => {
    const updateStatus = (status: UploadStatus) =>
      setQueue(prev => prev.map(q => (q.id === item.id ? { ...q, status } : q)));

    // 1) Get the SAS
    let sasBody: { uploadUrl: string; blobPath: string; expiresAt: string };
    try {
      const sasRes = await fetch('/api/upload-sas', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: item.displayName }),
      });
      if (!sasRes.ok) {
        const text = await sasRes.text().catch(() => '');
        throw new Error(`SAS request failed (HTTP ${sasRes.status})${text ? `: ${text}` : ''}`);
      }
      sasBody = await sasRes.json();
    } catch (e) {
      updateStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      return;
    }

    // 2) PUT the blob using XHR so we get progress events
    updateStatus({ kind: 'uploading', progress: 0 });
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', sasBody.uploadUrl, true);
      xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
      xhr.setRequestHeader(
        'x-ms-blob-content-type',
        item.file.type || 'application/octet-stream',
      );
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          updateStatus({ kind: 'uploading', progress: pct });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          updateStatus({ kind: 'done', blobPath: sasBody.blobPath });
        } else {
          updateStatus({
            kind: 'error',
            message: `Blob PUT failed (HTTP ${xhr.status}) ${xhr.responseText?.slice(0, 200) ?? ''}`,
          });
        }
        resolve();
      };
      xhr.onerror = () => {
        updateStatus({ kind: 'error', message: 'Network error during upload.' });
        resolve();
      };
      xhr.send(item.file);
    });
  }, []);

  // ── Enqueue files (from drop or picker) ───────────────────────────────────
  const enqueueFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      const next: QueuedUpload[] = arr.map((file) => {
        const displayName = sanitizeForDisplay(file.name);
        const id = `q${++queueIdSeq.current}`;
        if (!isValidFilename(displayName)) {
          return {
            id,
            file,
            displayName: file.name,
            status: {
              kind: 'error',
              message:
                'Filename could not be sanitized to safe characters. Rename and retry.',
            },
          };
        }
        return { id, file, displayName, status: { kind: 'pending' } };
      });
      setQueue((prev) => [...next, ...prev]);

      // Kick off uploads sequentially for the ones we accepted. Sequential
      // keeps the UI cleaner; the API and blob endpoint both happily handle
      // parallel, but sequential makes the progress story obvious.
      (async () => {
        for (const item of next) {
          if (item.status.kind !== 'error') {
            await uploadOne(item);
          }
        }
        // Refresh recent list after the batch.
        loadRecent();
      })();
    },
    [uploadOne, loadRecent],
  );

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files?.length) {
        enqueueFiles(e.dataTransfer.files);
      }
    },
    [enqueueFiles],
  );

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
          Contact Jacob, Michael, or Stefanie if you believe you should have access.
        </p>
      </div>
    );
  }

  // Authorized path
  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-5 space-y-1">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <UploadIcon className="w-4 h-4" />
          File Uploads
        </h3>
        <p className="text-xs text-muted-foreground">
          Drop committee files below. They land in Azure Blob Storage under a
          month folder stamped server-side at upload time. No parsing happens
          yet — this is a drop zone only.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Signed in as <span className="font-mono">{auth.email}</span>. Uploading to month
          folder: <span className="font-mono font-semibold">{monthFolder}</span> (UTC).
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
          dragActive
            ? 'border-primary bg-primary/5'
            : 'border-border bg-muted/30 hover:bg-muted/50'
        }`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
        }}
      >
        <UploadIcon className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm font-medium">Drop files here or click to choose</p>
        <p className="text-xs text-muted-foreground mt-1">
          Any file type accepted. Filename must use letters, digits, dot, dash, or
          underscore — invalid characters will be auto-sanitized to underscores.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) enqueueFiles(e.target.files);
            // reset so picking the same file twice re-triggers
            e.target.value = '';
          }}
        />
      </div>

      {/* Active queue */}
      {queue.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-5 space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            This session
          </h4>
          <ul className="space-y-2">
            {queue.map((q) => (
              <li
                key={q.id}
                className="flex items-center gap-3 text-xs border border-border rounded-md p-3 bg-background"
              >
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <span className="font-mono truncate">{q.displayName}</span>
                    <span className="text-muted-foreground flex-shrink-0">
                      {humanSize(q.file.size)}
                    </span>
                  </div>
                  {q.status.kind === 'uploading' && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-muted rounded overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${q.status.progress}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Uploading… {q.status.progress}%
                      </p>
                    </div>
                  )}
                  {q.status.kind === 'pending' && (
                    <p className="text-[10px] text-muted-foreground mt-1">Queued</p>
                  )}
                  {q.status.kind === 'done' && (
                    <p className="text-[10px] text-risk-green mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Uploaded to <span className="font-mono">{q.status.blobPath}</span>
                    </p>
                  )}
                  {q.status.kind === 'error' && (
                    <p className="text-[10px] text-risk-red mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {q.status.message}
                    </p>
                  )}
                </div>
                {q.status.kind === 'uploading' && (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
