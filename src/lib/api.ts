/**
 * Thin API wrappers for the SWA-hosted Functions.
 *
 * The FileUploads component historically called `fetch('/api/…')` inline.
 * As the API surface has grown we started collecting the client-side
 * bindings here so component code isn't juggling headers, JSON parsing,
 * and error shapes. Only new call-sites need to live here — existing
 * inline fetches will migrate opportunistically.
 */

/**
 * Successful response shapes from `POST /api/nw-trigger-check`.
 *
 * The endpoint always returns HTTP 200 for the "happy" cases (triggered,
 * missing, alreadyTriggered, disabled) and only maps to a non-2xx status
 * when the AA call actually blew up.
 */
export type NwTriggerCheckResponse =
  | { triggered: true; month: string; aaWorkItemId?: string; message: string; forced?: boolean }
  | { triggered: false; disabled: true }
  | { triggered: false; missing: string[]; month?: string }
  | { triggered: false; alreadyTriggered: true; month: string }
  | { triggered: false; error: string; correlationId?: string };

/**
 * Response shape for `GET /api/nw-trigger-check?month=YYYY-MM`. This is a
 * lightweight status probe the FileUploads tab uses to decide whether to
 * enable the "Manually trigger Neighborhood Watch report" button and
 * whether to warn about clobbering an existing `enc-data` blob.
 */
export interface NwTriggerStatus {
  month: string;
  allSlotsComplete: boolean;
  missing: string[];
  encDataExists: boolean;
}

/**
 * POST `/api/nw-trigger-check` with the given `YYYY-MM` month.
 *
 * Behaviour matches the spec in the RPA auto-trigger design doc:
 *   - 2xx → parse and return the JSON payload as-is.
 *   - 5xx → parse the body if possible (server includes `error` +
 *     `correlationId`) and return it so the UI can surface a subtle
 *     error toast. The server has already sent the failure email at
 *     this point; the UI does not need to escalate further.
 *   - Network error → throw. Callers decide how to surface.
 */
export async function triggerNwCheck(
  month: string,
  options: { force?: boolean } = {},
): Promise<{
  ok: boolean;
  status: number;
  body: NwTriggerCheckResponse | null;
}> {
  const payload: { month: string; force?: boolean } = { month };
  if (options.force === true) payload.force = true;
  const res = await fetch('/api/nw-trigger-check', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body: NwTriggerCheckResponse | null = null;
  try {
    body = (await res.json()) as NwTriggerCheckResponse;
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * GET `/api/nw-trigger-check?month=YYYY-MM` — status probe.
 *
 * Never invokes Automation Anywhere. Returns whether all 5 HUD slots are
 * present and whether an `enc-data` blob already exists for that month
 * (used by the manual re-generate confirmation dialog).
 *
 * On any HTTP or JSON error, throws so the caller can decide how to
 * degrade the button state.
 */
export async function getNwTriggerStatus(month: string): Promise<NwTriggerStatus> {
  const res = await fetch(
    `/api/nw-trigger-check?month=${encodeURIComponent(month)}`,
    { method: 'GET', credentials: 'include' },
  );
  if (!res.ok) {
    throw new Error(`nw-trigger-check status probe failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as NwTriggerStatus;
  if (
    !body ||
    typeof body.month !== 'string' ||
    typeof body.allSlotsComplete !== 'boolean' ||
    !Array.isArray(body.missing) ||
    typeof body.encDataExists !== 'boolean'
  ) {
    throw new Error('nw-trigger-check status probe returned malformed body');
  }
  return body;
}
