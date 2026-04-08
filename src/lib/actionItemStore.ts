/**
 * Persistent action-item storage using IndexedDB.
 * - Manual items: full CRUD, survive across sessions
 * - AI dismissals: content hashes stored so dismissed items aren't regenerated
 * - Completion state: tracked per item
 */

import { openDB } from './db';

const MANUAL_STORE = 'action-items';
const DISMISSED_STORE = 'ai-dismissed';

export interface PersistedActionItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

function hashText(text: string): string {
  // Simple stable hash — normalize whitespace + lowercase
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return 'h_' + Math.abs(hash).toString(36);
}

// ── Manual Action Items ──

export async function getManualItems(): Promise<PersistedActionItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MANUAL_STORE, 'readonly');
    const store = tx.objectStore(MANUAL_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as PersistedActionItem[])
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addManualItem(text: string): Promise<PersistedActionItem> {
  const item: PersistedActionItem = {
    id: crypto.randomUUID(),
    text: text.trim(),
    completed: false,
    createdAt: new Date().toISOString(),
  };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MANUAL_STORE, 'readwrite');
    tx.objectStore(MANUAL_STORE).put(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateManualItem(id: string, updates: Partial<Pick<PersistedActionItem, 'text' | 'completed'>>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MANUAL_STORE, 'readwrite');
    const store = tx.objectStore(MANUAL_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      if (req.result) {
        store.put({ ...req.result, ...updates });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteManualItem(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MANUAL_STORE, 'readwrite');
    tx.objectStore(MANUAL_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── AI Dismissed Items ──

export async function dismissAIItem(text: string): Promise<void> {
  const hash = hashText(text);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DISMISSED_STORE, 'readwrite');
    tx.objectStore(DISMISSED_STORE).put({ hash, text: text.trim(), dismissedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDismissedHashes(): Promise<Set<string>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DISMISSED_STORE, 'readonly');
    const req = tx.objectStore(DISMISSED_STORE).getAll();
    req.onsuccess = () => {
      const hashes = new Set((req.result as any[]).map(r => r.hash));
      resolve(hashes);
    };
    req.onerror = () => reject(req.error);
  });
}

export function isAIDismissed(text: string, dismissedHashes: Set<string>): boolean {
  return dismissedHashes.has(hashText(text));
}

export async function clearDismissals(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DISMISSED_STORE, 'readwrite');
    tx.objectStore(DISMISSED_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
