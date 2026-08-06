/**
 * RPA failure email sender.
 *
 * Design constraints (per Aug 2026 kick-off with Michael K.):
 *   - The api/ folder has no existing email transport. Adding nodemailer as
 *     a hard dependency + a required SMTP env var was out of scope for this
 *     PR ("ASK ATLAS before adding a new required env var"). Instead:
 *
 *       - If nodemailer is installed AND the SMTP_* env vars are set, we
 *         send a real email.
 *       - Otherwise we degrade gracefully: we log the fully-rendered email
 *         at `context.log.error` and return `{ sent:false, reason:"…" }`.
 *         Michael + RPASupport still see the failure via Function App logs
 *         while a follow-up PR wires the transport in properly.
 *
 * Env vars (all optional — email is best-effort):
 *   RPA_SUPPORT_EMAIL   — required to attempt any email at all
 *   RPA_SUPPORT_CC      — optional CC address
 *   SMTP_HOST           — enables real SMTP send when set
 *   SMTP_PORT           — default 587
 *   SMTP_SECURE         — "true"|"false" (default false for STARTTLS on 587)
 *   SMTP_USER           — optional auth user
 *   SMTP_PASS           — optional auth pass
 *   SMTP_FROM           — envelope + header From; default no-reply@afncorp.com
 */

const REDACTABLE = /("(?:token|apiKey|password|X-Authorization|authorization)"\s*:\s*")([^"]*)(")/gi;
const BEARER = /Bearer\s+[A-Za-z0-9\-_\.=]+/gi;

/**
 * Render the plain-text body per the failure-email template in the spec.
 */
function renderBody({
  month,
  monthName,
  aaQueueId,
  timestamp,
  correlationId,
  phase,
  httpStatus,
  responseBody,
  slotSummary,
  environmentLabel,
}) {
  const clean = (s) => {
    if (s == null) return '';
    let out = String(s);
    out = out.replace(BEARER, 'Bearer [REDACTED]');
    out = out.replace(REDACTABLE, '$1[REDACTED]$3');
    if (out.length > 2000) out = out.slice(0, 2000) + '…[truncated]';
    return out;
  };
  const lines = [
    `The FHA Risk Monitor detected all HUD files for ${monthName} but`,
    `failed to enqueue the Neighborhood Watch bot.`,
    ``,
    `Environment:   ${environmentLabel}`,
    `Period:        ${month}`,
    `Queue:         NWReportQueue (${aaQueueId})`,
    `Timestamp:     ${timestamp}`,
    `Correlation:   ${correlationId}`,
    ``,
    `Failure phase: ${phase}`,
    `HTTP status:   ${httpStatus == null ? 'n/a' : httpStatus}`,
    `Response body: ${clean(responseBody)}`,
    ``,
    `Files detected (all 5 HUD slots):`,
  ];
  const slotLabels = [
    'hud-branches',
    'hoc-compare-ratios',
    'nw-data',
    'hud-total-compare-ratios',
    'hud-field-office',
  ];
  const namePad = Math.max(...slotLabels.map((s) => s.length));
  for (const slot of slotLabels) {
    const info = (slotSummary && slotSummary[slot]) || null;
    if (info) {
      lines.push(
        `  ${slot.padEnd(namePad)} : ${info.count} file(s), latest: ${info.latestName || '?'}, ${info.latestSize ?? '?'} bytes, ${info.latestUploadedAt || '?'}`,
      );
    } else {
      lines.push(`  ${slot.padEnd(namePad)} : (no data)`);
    }
  }
  lines.push(
    ``,
    `To retrigger manually:`,
    `  1. Log into Automation Anywhere Control Room dev`,
    `  2. Navigate to Queues → NWReportQueue`,
    `  3. Add a work item with Date = ${month}-01`,
    ``,
    `The uploader UI showed a subtle error toast to the user.`,
  );
  return lines.join('\n');
}

function renderSubject(month) {
  return `[FHA Risk Monitor] NW trigger failed for ${month}`;
}

/**
 * Send (or attempt to send) the RPA failure email.
 * Never throws — email is best-effort, we return status.
 */
async function sendFailureEmail(context, params) {
  const {
    month,
    monthName,
    aaQueueId,
    timestamp,
    correlationId,
    phase,
    httpStatus,
    responseBody,
    slotSummary,
    environmentLabel = 'dev (fha-monitor-dev.afnai.com)',
    supportEmail = process.env.RPA_SUPPORT_EMAIL,
    supportCc = process.env.RPA_SUPPORT_CC,
    transportOverride, // for tests
  } = params;

  const subject = renderSubject(month);
  const text = renderBody({
    month,
    monthName,
    aaQueueId,
    timestamp,
    correlationId,
    phase,
    httpStatus,
    responseBody,
    slotSummary,
    environmentLabel,
  });

  if (!supportEmail) {
    context.log.warn?.(
      `rpa-failure-email: RPA_SUPPORT_EMAIL not set — logging only. corr=${correlationId}`,
    );
    context.log.error?.(
      `[RPA_FAILURE_EMAIL_NOT_SENT] subject=${subject}\n${text}`,
    );
    return { sent: false, reason: 'no-recipient', subject, text };
  }

  // Test hook + graceful degradation when no transport is configured.
  const transport = transportOverride || getSmtpTransport(context);
  if (!transport) {
    context.log.error?.(
      `[RPA_FAILURE_EMAIL_LOGGED_ONLY] to=${supportEmail} cc=${supportCc || ''} subject=${subject}\n${text}`,
    );
    return { sent: false, reason: 'no-transport', subject, text };
  }

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || 'no-reply@afncorp.com',
      to: supportEmail,
      cc: supportCc || undefined,
      subject,
      text,
    });
    return { sent: true, subject, text };
  } catch (err) {
    context.log.error?.(
      `rpa-failure-email: transport.sendMail failed: ${err.message}. Falling back to log-only. corr=${correlationId}`,
    );
    context.log.error?.(
      `[RPA_FAILURE_EMAIL_SEND_FAILED] to=${supportEmail} cc=${supportCc || ''} subject=${subject}\n${text}`,
    );
    return { sent: false, reason: 'send-failed', error: err.message, subject, text };
  }
}

/**
 * Attempt to build a nodemailer SMTP transport. Returns null if either
 * nodemailer is not installed or SMTP_HOST is not set. We never throw.
 */
function getSmtpTransport(context) {
  if (!process.env.SMTP_HOST) return null;
  let nodemailer;
  try {
    // eslint-disable-next-line global-require
    nodemailer = require('nodemailer');
  } catch (_e) {
    context.log.warn?.(
      'rpa-failure-email: SMTP_HOST is set but nodemailer is not installed; falling back to log-only.',
    );
    return null;
  }
  try {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
  } catch (err) {
    context.log.warn?.(
      `rpa-failure-email: failed to build SMTP transport: ${err.message}. Falling back to log-only.`,
    );
    return null;
  }
}

module.exports = {
  sendFailureEmail,
  // exported for tests
  _renderBody: renderBody,
  _renderSubject: renderSubject,
};
