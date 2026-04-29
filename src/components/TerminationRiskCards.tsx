import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { OfficeSummary } from '@/lib/types';

interface Props {
  offices: OfficeSummary[];
}

function officeStatus(o: OfficeSummary): { label: string; color: string; bg: string; border: string } {
  if (o.revisedTotalCR < 150) return { label: 'Safe', color: 'text-risk-green', bg: 'bg-risk-green-bg', border: 'border-risk-green/30' };
  if (o.revisedTotalCR <= 200) return { label: 'Credit Watch', color: 'text-risk-yellow', bg: 'bg-risk-yellow-bg', border: 'border-risk-yellow/30' };
  return { label: 'At Risk', color: 'text-risk-red', bg: 'bg-risk-red-bg', border: 'border-risk-red/30' };
}

export default function TerminationRiskCards({ offices }: Props) {
  const termOffices = useMemo(() =>
    offices.filter(o => o.totalCR > 200 && o.totalLoans > 100).sort((a, b) => b.totalCR - a.totalCR),
  [offices]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-risk-red" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-risk-red">
          Termination Risk — {termOffices.length} Office{termOffices.length !== 1 ? 's' : ''}
        </h3>
        <span className="text-[10px] text-muted-foreground">&gt;200% CR + &gt;100 loans</span>
      </div>
      {termOffices.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
          {termOffices.map(o => {
            const status = officeStatus(o);
            const delta = o.totalCR - o.revisedTotalCR;
            return (
              <div key={o.name} className={`rounded-lg border ${status.border} ${status.bg} px-3 py-2.5`}>
                <p className="text-xs font-bold text-foreground truncate" title={o.name}>{o.name}</p>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-lg font-bold text-risk-red">{o.totalCR}%</span>
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <span className={`text-lg font-bold ${status.color}`}>{o.revisedTotalCR}%</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${status.bg} ${status.color}`}>
                    {status.label}
                  </span>
                  <span className="text-[9px] text-muted-foreground">-{delta}pts</span>
                </div>
                <div className="text-[9px] text-muted-foreground mt-1">
                  R:{o.retailDPAConc.toFixed(0)}% / WS:{o.wsDPAConc.toFixed(0)}% DPA
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-risk-green font-medium">No offices at termination risk</p>
      )}
    </div>
  );
}
