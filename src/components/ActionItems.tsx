import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, ChevronDown, ChevronUp, Plus, X, Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import { generateAIAnalysis, type AIActionItem } from '@/lib/aiAnalysis';

export const STAFF_ITEMS = [
  'Wholesale to respond to San Antonio QC Findings',
  'QC Team to review the responses from Wholesale for Birmingham and San Antonio',
  'Wholesale to provide Underwriting org. chart to Andy/Twyla for Birmingham response preparation.',
  'Wholesale to provide list of Underwriters who left or were terminated in the past 2 years. List reason for termination.',
  'Andy to prepare response for Birmingham.',
  'Wholesale and HUD Compare Ratio Committee to review San Antonio DLQ loan details to find common factors after Boost DPA loans removed. We need recommendations to bring this number below 150.',
];

// Keep for PDF export compatibility
export const AI_ITEMS: string[] = [];

interface DisplayItem {
  text: string;
  isAI: boolean;
  category?: 'immediate' | 'monitoring' | 'strategic';
  assignee?: string;
}

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
  const [items, setItems] = useState<DisplayItem[]>(
    STAFF_ITEMS.map(text => ({ text, isAI: false }))
  );
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [newItem, setNewItem] = useState('');
  const [aiItems, setAiItems] = useState<AIActionItem[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const runAI = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await generateAIAnalysis(data);
      setAiItems(result.actionItems);
    } catch (e: any) {
      console.error('AI action items failed:', e);
      setAiError(e.message || 'Failed');
    } finally {
      setAiLoading(false);
    }
  }, [data]);

  // Auto-generate AI when data loads or changes
  useEffect(() => {
    setAiItems(null);
    setAiError(null);
  }, [data]);

  // Auto-run AI when we don't have results yet
  useEffect(() => {
    if (!aiItems && !aiLoading && !aiError) {
      runAI();
    }
  }, [aiItems, aiLoading, aiError, runAI]);

  // Push all items (staff + AI) to parent for PDF export
  useEffect(() => {
    if (onItemsChanged) {
      const staffTexts = items.map(i => i.text);
      const aiTexts = (aiItems ?? []).map(i => `[AI] ${i.text}`);
      onItemsChanged([...staffTexts, ...aiTexts]);
    }
  }, [items, aiItems, onItemsChanged]);

  const allItems = [
    ...items,
    ...(aiItems ?? []).map(ai => ({
      text: ai.text,
      isAI: true,
      category: ai.category,
      assignee: ai.assignee,
    })),
  ];

  const addItem = () => {
    const trimmed = newItem.trim();
    if (!trimmed || trimmed.length > 500) return;
    setItems(prev => [...prev, { text: trimmed, isAI: false }]);
    setNewItem('');
  };

  const removeItem = (idx: number) => {
    const staffCount = items.length;
    if (idx < staffCount) {
      setItems(prev => prev.filter((_, i) => i !== idx));
      setChecked(prev => {
        const next = new Set<number>();
        prev.forEach(i => {
          if (i < idx) next.add(i);
          else if (i > idx) next.add(i - 1);
        });
        return next;
      });
    } else {
      const aiIdx = idx - staffCount;
      setAiItems(prev => prev ? prev.filter((_, i) => i !== aiIdx) : prev);
    }
  };

  const toggleCheck = (idx: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const openCount = allItems.length - checked.size;
  const staffDisplayItems = allItems.map((item, i) => ({ ...item, idx: i })).filter(item => !item.isAI);
  const aiDisplayItems = allItems.map((item, i) => ({ ...item, idx: i })).filter(item => item.isAI);

  const renderItem = (item: DisplayItem & { idx: number }) => (
    <li key={item.idx} className="flex items-start gap-2.5 group">
      <input
        type="checkbox"
        checked={checked.has(item.idx)}
        onChange={() => toggleCheck(item.idx)}
        className="mt-1 h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <span
          className={`text-xs leading-relaxed block ${
            checked.has(item.idx) ? 'line-through text-muted-foreground' : 'text-foreground'
          }`}
        >
          {item.text}
        </span>
        {(item.category || item.assignee) && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {item.category && (
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${categoryBadge[item.category]}`}>
                {categoryLabel[item.category]}
              </span>
            )}
            {item.assignee && (
              <span className="text-[9px] text-muted-foreground">→ {item.assignee}</span>
            )}
          </div>
        )}
      </div>
      <button
        onClick={() => removeItem(item.idx)}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-risk-red flex-shrink-0 mt-0.5"
        aria-label="Remove item"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </li>
  );

  return (
    <div className="bg-card rounded-lg border border-border">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-muted/40 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2.5">
          <ClipboardList className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="font-semibold text-sm text-foreground">Action Items</span>
          {aiItems && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">AI</span>
          )}
          <span className="text-muted-foreground text-xs">·</span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/15 text-primary">
            {openCount} open
          </span>
          {checked.size > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-risk-green/15 text-risk-green">
              {checked.size} done
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
          {/* Staff action items */}
          <ul className="space-y-2 mt-3">
            {staffDisplayItems.map(renderItem)}
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
                  {aiItems ? 'Regenerate' : 'Generate'}
                </button>
              </div>
            </div>
            {aiDisplayItems.length > 0 ? (
              <ul className="space-y-2">
                {aiDisplayItems.map(renderItem)}
              </ul>
            ) : !aiLoading && !aiItems && (
              <p className="text-[10px] text-muted-foreground text-center py-3">
                Click "Generate" to create AI-powered action items from your data
              </p>
            )}
          </div>

          {/* Add new item */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
            <input
              type="text"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addItem()}
              placeholder="Add an action item…"
              maxLength={500}
              className="flex-1 text-xs bg-muted/50 border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button
              onClick={addItem}
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
