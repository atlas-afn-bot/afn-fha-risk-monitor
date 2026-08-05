/**
 * DevEnvironmentBanner
 * --------------------
 * Renders a sticky yellow banner at the top of the dashboard when we're on
 * the dev SWA. Suppressed on prod (fha-monitor.afnai.com) so the committee
 * never sees a banner in the live app.
 *
 * Environment detection order:
 *   1. `VITE_ENV` — set explicitly on the dev SWA app settings (VITE_ENV=dev).
 *   2. `import.meta.env.MODE` — Vite's own dev/production build flag.
 *
 * Dismiss state persists per browser session via sessionStorage so a page
 * refresh keeps it dismissed but a new session starts fresh.
 */
import { useState, useEffect } from 'react';

const DEV_HOSTNAMES = ['fha-monitor-dev.afnai.com'];

function isDevEnvironment(): boolean {
  const explicit = (import.meta.env.VITE_ENV as string | undefined)?.toLowerCase();
  if (explicit === 'dev' || explicit === 'development') return true;

  // Fallback: hostname match (works even if VITE_ENV is missing on the dev SWA
  // because Vite bakes env at build time and we might inject it late).
  if (typeof window !== 'undefined') {
    if (DEV_HOSTNAMES.includes(window.location.hostname)) return true;
    // Local vite dev server also shows the banner so developers see it early
    if (import.meta.env.MODE === 'development') return true;
  }

  return false;
}

const STORAGE_KEY = 'fha-monitor-dev-banner-dismissed';

export default function DevEnvironmentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isDevEnvironment()) return;
    const dismissed = sessionStorage.getItem(STORAGE_KEY) === '1';
    setVisible(!dismissed);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  return (
    <div
      role="alert"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: '#fef08a', // amber-200
        borderBottom: '2px solid #ca8a04', // amber-600
        color: '#713f12', // amber-900
        padding: '8px 16px',
        fontSize: 14,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}
      data-testid="dev-environment-banner"
    >
      <span>
        ⚠️ <strong>DEV ENVIRONMENT</strong> — Not for committee use. Live dashboard is at{' '}
        <a
          href="https://fha-monitor.afnai.com/"
          style={{ color: '#713f12', textDecoration: 'underline' }}
        >
          fha-monitor.afnai.com
        </a>
        .
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss dev environment banner"
        style={{
          background: 'transparent',
          border: '1px solid #713f12',
          color: '#713f12',
          borderRadius: 4,
          padding: '2px 10px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
