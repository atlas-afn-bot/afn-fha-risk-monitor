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
  | { triggered: true; month: string; aaWorkItemId?: string; message: string }
  | { triggered: false; disabled: true }
  | { triggered: false; missing: string[]; month?: string }
  | { triggered: false; alreadyTriggered: true; month: string }
  | { triggered: false; error: string; correlationId?: string };

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
export async function triggerNwCheck(month: string): Promise<{
  ok: boolean;
  status: number;
  body: NwTriggerCheckResponse | null;
}> {
  const res = await fetch('/api/nw-trigger-check', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month }),
  });
  let body: NwTriggerCheckResponse | null = null;
  try {
    body = (await res.json()) as NwTriggerCheckResponse;
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}
