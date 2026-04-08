/**
 * Shared IndexedDB opener for risk-radar.
 * All stores are created/upgraded here so version stays in sync.
 */

const DB_NAME = 'risk-radar';
const DB_VERSION = 2;

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('hud-history')) {
        db.createObjectStore('hud-history', { keyPath: 'monthKey' });
      }
      if (!db.objectStoreNames.contains('action-items')) {
        db.createObjectStore('action-items', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('ai-dismissed')) {
        db.createObjectStore('ai-dismissed', { keyPath: 'hash' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
