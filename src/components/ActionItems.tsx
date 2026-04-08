import { useState, useEffect, useCallback, useRef } from 'react';
import { ClipboardList, ChevronDown, ChevronUp, Plus, X, Check, Sparkles, RefreshCw, Loader2, ArrowUp } from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import { generateAIAnalysis, type AIActionItem } from '@/lib/aiAnalysis';
import {
  getManualItems, addManualItem, updateManualItem, deleteManualItem,
  dismissAIItem, getDismissedHashes, isAIDismissed,
  type PersistedActionItem,
} from '@/lib/actionItemStore';

// Seed items — written to IndexedDB on first load if the store is empty
const SEED_ITEMS = [
  'Wholesale to respond to San Antonio QC Findings',
  'QC Team to review the responses from Wholesale for Birmingham and San Antonio',
  'Wholesale to provide Underwriting org. chart to Andy/Twyla for Birmingham response preparation.',
  'Wholesale to provide list of Underwriters who left or were terminated in the past 2 years. List reason for termination.',
  'Andy to prepare response for Birmingham.',
  'Wholesale and HUD Compare Ratio Committee to review San Antonio DLQ loan details to find common factors after Boost DPA loans removed. We need recommendations to bring this number below 150.',
];

interface Props {
  data: DashboardData;
  onItemsChanged?: (items: string[]) => void;
}

const categoryBadge: Record<string, string> = {
  immediate: 'bg-risk-red/15 text-risk-red',
  monitoring: 'bg-risk-yellow/15 text-risk-yellow',
  strategic: 'bg-risk-blue-bg text-risk-blue',
};

const categoryLabel: Record<string, string> = {
  immediate: 'Immediate',
  monitoring: 'Monitor',
  strategic: 'Strategic',
};

export default function ActionItems({ data, onItemsChanged }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [manualItems, setManualItems] = useState<PersistedActionItem[]>([]);
  const [newItem, setNewItem] = useState('');

  // AI state
  const [aiItems, setAiItems] = useState<AIActionItem[]>([]);
  const [aiChecked, setAiChecked] = useState<Set<number>>(new Set());
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [dismissedHashes, setDismissedHashes] = useState<Set<string>>(new Set());
  const seeded = useRef(false);

  // Load manual items + dismissed hashes from IndexedDB on mount
  useEffect(() => {
    (async () => {
      const [items, hashes] = await Promise.all([getManualItems(), getDismissedHashes()]);
      if (items.length === 0 && !seeded.current) {
        // Seed with initial items
        seeded.current = true;
        const seededItems: PersistedActionItem[] = [];
        for (const text of SEED_ITEMS) {
          const item = await addManualItem(text);
          seededItems.push(item);
        }
        setManualItems(seededItems);
      } else {
        setManualItems(items);
      }
      setDismissedHashes(hashes);
    })();
  }, []);

  // AI generation
  const runAI = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await generateAIAnalysis(data);
      // Refresh dismissed hashes in case they changed
      const hashes = await getDismissedHashes();
      setDismissedHashes(hashes);
      // Filter out dismissed items
      const filtered = result.actionItems.filter(ai => !isAIDismissed(ai.text, hashes));
      setAiItems(filtered);
      setAiChecked(new Set());
    } catch (e: any) {
      console.error('AI action items failed:', e);
      setAiError(e.message || 'Failed');
    } finally {
      setAiLoading(false);
    }
  }, [data]);

  // Auto-generate AI on data load
  useEffect(() => {
    setAiItems([]);
    setAiError(null);
    setAiChecked(new Set());
  }, [data]);

  useEffect(() => {
    if (aiItems.length === 0 && !aiLoading && !aiError) {
      runAI();
    }
  }, [aiItems.length, aiLoading, aiError, runAI]);

  // Push all items to parent for PDF export
  useEffect(() => {
    if (onItemsChanged) {
      const manual = manualItems.filter(i => !i.completed).map(i => i.text);
      const ai = aiItems.map(i => `[AI] ${i.text}`);
      onItemsChanged([...manual, ...ai]);
    }
  }, [manualItems, aiItems, onItemsChanged]);

  // ── Manual item actions ──
  const handleAdd = async () => {
    const trimmed = newItem.trim();
    if (!trimmed || trimmed.length > 500) return;
    const item = await addManualItem(trimmed);
    setManualItems(prev => [...prev, item]);
    setNewItem('');
  };

  const handleToggleManual = async (item: PersistedActionItem) => {
    const updated = !item.completed;
    await updateManualItem(item.id, { completed: updated });
    setManualItems(prev => prev.map(i => i.id === item.id ? { ...i, completed: updated } : i));
  };

  const handleDeleteManual = async (id: string) => {
    await deleteManualItem(id);
    setManualItems(prev => prev.filter(i => i.id !== id));
  };

  // ── AI item actions ──
  const handlePromoteAI = async (idx: number) => {
    const aiItem = aiItems[idx];
    if (!aiItem) return;
    // Add to manual items
    const newManualItem = await addManualItem(aiItem.text);
    setManualItems(prev => [...prev, newManualItem]);
    // Dismiss from AI (so it won't regenerate)
    await dismissAIItem(aiItem.text);
    const hashes = await getDismissedHashes();
    setDismissedHashes(hashes);
    // Remove from current AI list
    setAiItems(prev => prev.filter((_, i) => i !== idx));
    setAiChecked(prev => {
      const next = new Set<number>();
      prev.forEach(i => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
  };

  const handleDismissAI = async (idx: number) => {
    const item = aiItems[idx];
    if (!item) return;
    await dismissAIItem(item.text);
    const hashes = await getDismissedHashes();
    setDismissedHashes(hashes);
    setAiItems(prev => prev.filter((_, i) => i !== idx));
    setAiChecked(prev => {
      const next = new Set<number>();
      prev.forEach(i => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
  };

  const handleToggleAI = (idx: number) => {
    setAiChecked(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  // Counts
  const openManual = manualItems.filter(i => !i.completed).length;
  const completedManual = manualItems.filter(i => i.completed).length;
  const openAI = aiItems.length - aiChecked.size;
  const totalOpen = openManual + openAI;
  const totalDone = completedManual + aiChecked.size;

  return (
    <div className="bg-card rounded-lg border border-border">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-muted/40 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2.5">
          <ClipboardList className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="font-semibold text-sm text-foreground">Action Items</span>
          {aiItems.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">AI</span>
          )}
          <span className="text-muted-foreground text-xs">·</span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/15 text-primary">
            {totalOpen} open
          </span>
          {totalDone > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-risk-green/15 text-risk-green">
              {totalDone} done
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-5 pb-4 pt-1 border-t border-border">
          {/* Manual action items */}
          <ul className="space-y-2 mt-3">
            {manualItems.map(item => (
              <li key={item.id} className="flex items-start gap-2.5 group">
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={() => handleToggleManual(item)}
                  className="mt-1 h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer flex-shrink-0"
                />
                <span
                  className={`flex-1 text-xs leading-relaxed ${
                    item.completed ? 'line-through text-muted-foreground' : 'text-foreground'
                  }`}
                >
                  {item.text}
                </span>
                <button
                  onClick={() => handleDeleteManual(item.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-risk-red flex-shrink-0 mt-0.5"
                  aria-label="Delete item"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>

          {/* AI-generated items */}
          <div className="mt-4 pt-3 border-t border-border/50">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">AI-Generated Recommendations</span>
              </div>
              <div className="flex items-center gap-2">
                {aiLoading && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" /> Analyzing...
                  </span>
                )}
                {aiError && (
                  <span className="text-[10px] text-risk-red">Failed</span>
                )}
                <button
                  onClick={runAI}
                  disabled={aiLoading}
                  className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${aiLoading ? 'animate-spin' : ''}`} />
                  Regenerate
                </button>
              </div>
            </div>
            {aiItems.length > 0 ? (
              <ul className="space-y-2">
                {aiItems.map((ai, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 group">
                    <input
                      type="checkbox"
                      checked={aiChecked.has(idx)}
                      onChange={() => handleToggleAI(idx)}
                      className="mt-1 h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <span
                        className={`text-xs leading-relaxed block ${
                          aiChecked.has(idx) ? 'line-through text-muted-foreground' : 'text-foreground'
                        }`}
                      >
                        {ai.text}
                      </span>
                      {(ai.category || ai.assignee) && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {ai.category && (
                            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${categoryBadge[ai.category]}`}>
                              {categoryLabel[ai.category]}
                            </span>
                          )}
                          {ai.assignee && (
                            <span className="text-[9px] text-muted-foreground">→ {ai.assignee}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 flex-shrink-0 mt-0.5">
                      <button
                        onClick={() => handlePromoteAI(idx)}
                        className="text-muted-foreground hover:text-primary"
                        aria-label="Promote to action items"
                        title="Add to official action items list"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDismissAI(idx)}
                        className="text-muted-foreground hover:text-risk-red"
                        aria-label="Dismiss (won't regenerate)"
                        title="Dismiss — this item won't come back on regenerate"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : !aiLoading && (
              <p className="text-[10px] text-muted-foreground text-center py-3">
                {dismissedHashes.size > 0
                  ? `All AI items addressed (${dismissedHashes.size} dismissed). Click Regenerate for fresh analysis.`
                  : 'Click "Regenerate" to create AI-powered action items from your data'}
              </p>
            )}
          </div>

          {/* Add new item */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
            <input
              type="text"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Add an action item…"
              maxLength={500}
              className="flex-1 text-xs bg-muted/50 border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button
              onClick={handleAdd}
              disabled={!newItem.trim()}
              className="inline-flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
