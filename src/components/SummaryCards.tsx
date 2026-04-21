import type { DashboardData } from '@/lib/types';
import type { Snapshot } from '@/types/snapshot';
import { FileWarning, TrendingDown, PieChart, AlertTriangle } from 'lucide-react';
import CompareRatioCard from './CompareRatioCard';

interface Props {
  data: DashboardData;
  snapshot: Snapshot;
}

export default function SummaryCards({ data, snapshot }: Props) {
  const dqColor = data.overallDQRate > 7 ? 'risk-badge-red' : data.overallDQRate >= 5 ? 'risk-badge-yellow' : 'risk-badge-green';
  const dpaColor = data.dpaPortfolioConc > 50 ? 'risk-badge-red' : data.dpaPortfolioConc > 40 ? 'risk-badge-yellow' : 'risk-badge-green';

  const cards = [
    { label: 'Total Loans', value: data.totalLoans.toLocaleString(), icon: FileWarning, badge: 'risk-badge-blue' },
    { label: 'Overall DQ Rate', value: `${data.overallDQRate.toFixed(1)}%`, icon: TrendingDown, badge: dqColor },
    { label: 'Termination Risk Offices', value: String(data.terminationRiskCount), icon: AlertTriangle, badge: data.terminationRiskCount > 0 ? 'risk-badge-red' : 'risk-badge-green' },
    { label: 'DPA Portfolio Concentration', value: `${data.dpaPortfolioConc.toFixed(1)}%`, icon: PieChart, badge: dpaColor },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      <CompareRatioCard snapshot={snapshot} />
      {cards.map(c => (
        <div key={c.label} className="bg-card rounded-lg border border-border p-5 flex items-start gap-4">
          <div className={`p-2.5 rounded-lg ${c.badge === 'risk-badge-red' ? 'bg-risk-red-bg' : c.badge === 'risk-badge-yellow' ? 'bg-risk-yellow-bg' : c.badge === 'risk-badge-green' ? 'bg-risk-green-bg' : 'bg-risk-blue-bg'}`}>
            <c.icon className={`w-5 h-5 ${c.badge === 'risk-badge-red' ? 'text-risk-red' : c.badge === 'risk-badge-yellow' ? 'text-risk-yellow' : c.badge === 'risk-badge-green' ? 'text-risk-green' : 'text-risk-blue'}`} />
          </div>
          <div>
            <p className="card-label">{c.label}</p>
            <p className="card-metric mt-1">{c.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
