/**
 * Shared IndexedDB opener for risk-radar. Used today for action-item
 * persistence only — trend history now lives inside the monthly JSON
 * snapshot, so the legacy `hud-history` store has been retired.
 */

const DB_NAME = 'risk-radar';
const DB_VERSION = 2;

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('action-items')) {
        db.createObjectStore('action-items', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('ai-dismissed')) {
        db.createObjectStore('ai-dismissed', { keyPath: 'hash' });
      }
      // Legacy `hud-history` store may exist from older versions; leave it
      // in place if found, but don't create it anymore.
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
