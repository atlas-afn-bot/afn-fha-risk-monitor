import { useState } from 'react';
import type { Snapshot, CompareRatioHudOffice } from '@/types/snapshot';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

interface Props {
  snapshot: Snapshot;
}

const HOC_ORDER = ['Denver', 'Philadelphia', 'Santa Ana', 'Atlanta'] as const;

function badgeClass(cr: number | null): string {
  if (cr == null) return 'risk-badge-blue';
  if (cr > 200) return 'risk-badge-red';
  if (cr >= 150) return 'risk-badge-yellow';
  return 'risk-badge-green';
}

export default function TopRiskOfficesByHOC({ snapshot }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const offices = snapshot.compare_ratios_hud_office ?? [];

  // Group by HOC, sort by CR desc, take top 5
  const grouped = new Map<string, CompareRatioHudOffice[]>();
  for (const name of HOC_ORDER) grouped.set(name, []);
  for (const o of offices) {
    if (o.hoc && grouped.has(o.hoc)) {
      grouped.get(o.hoc)!.push(o);
    }
  }
  for (const [, list] of grouped) {
    list.sort((a, b) => (b.compare_ratio ?? 0) - (a.compare_ratio ?? 0));
  }

  const toggle = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="w-4 h-4 text-yellow-500" />
        <h3 className="text-sm font-semibold">Top Risk Offices by HOC</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Top 5 highest compare-ratio field offices within each HOC region.
        Click to expand/collapse.
      </p>

      <div className="space-y-2">
        {HOC_ORDER.map(name => {
          const list = grouped.get(name) ?? [];
          const top5 = list.slice(0, 5);
          const isOpen = expanded.has(name);
          const maxCR = top5[0]?.compare_ratio ?? 0;

          return (
            <div key={name} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => toggle(name)}
                className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="text-sm font-semibold">{name}</span>
                  <span className="text-xs text-muted-foreground">{list.length} offices</span>
                </div>
                {maxCR > 0 && (
                  <span className={badgeClass(maxCR)}>
                    Top CR: {Math.round(maxCR)}%
                  </span>
                )}
              </button>

              {isOpen && (
                <div className="px-4 pb-3 pt-2">
                  {top5.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No offices in this HOC.</p>
                  ) : (
                    <div className="space-y-2">
                      {top5.map((o, idx) => (
                        <div key={o.hud_office} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-muted-foreground w-4">{idx + 1}.</span>
                            <span className="text-xs font-medium">{o.hud_office}</span>
                          </div>
                          <div className="flex items-center gap-4 text-xs">
                            <span className="text-muted-foreground">
                              {(o.loans_count ?? 0).toLocaleString()} loans
                            </span>
                            <span className="text-muted-foreground">
                              {(o.delinquent_count ?? 0)} SDQ
                            </span>
                            <span className={`font-semibold ${(o.compare_ratio ?? 0) > 200 ? 'text-risk-red' : (o.compare_ratio ?? 0) >= 150 ? 'text-yellow-600 dark:text-yellow-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                              CR: {o.compare_ratio != null ? `${Math.round(o.compare_ratio)}%` : '—'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
