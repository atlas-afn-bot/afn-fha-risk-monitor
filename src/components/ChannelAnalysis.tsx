import type { ChannelSummary } from '@/lib/types';

interface Props {
  retail: ChannelSummary;
  wholesale: ChannelSummary;
}

export default function ChannelAnalysis({ retail, wholesale }: Props) {
  const concMultiplier = retail.dpaConc > 0 ? (wholesale.dpaConc / retail.dpaConc).toFixed(1) : 'N/A';

  // Combined Total = Retail + Wholesale, weighted where appropriate. We
  // recompute concentration / DQ rates from the underlying counts rather
  // than averaging the two channel summaries to avoid double-weighting.
  const totalLoans = retail.totalLoans + wholesale.totalLoans;
  const weight = (rVal: number, wVal: number): number => {
    if (totalLoans === 0) return 0;
    return ((rVal * retail.totalLoans) + (wVal * wholesale.totalLoans)) / totalLoans;
  };
  const totalDpaConc = weight(retail.dpaConc, wholesale.dpaConc);
  const totalOverallDQ = weight(retail.overallDQRate, wholesale.overallDQRate);
  const totalDpaDQ = weight(retail.dpaDQRate, wholesale.dpaDQRate);
  const totalNonDpaDQ = weight(retail.nonDPADQRate, wholesale.nonDPADQRate);

  // "Standard FHA DQ Rate" was a duplicate of Non-DPA DQ Rate (same
  // numerator/denominator with a different label). Removed per Twyla
  // (PR-2 #9). Non-DPA DQ Rate is the kept label since it's the term used
  // throughout the rest of the dashboard.
  const metrics = [
    { label: 'Total Loans', r: retail.totalLoans.toLocaleString(), w: wholesale.totalLoans.toLocaleString(), t: totalLoans.toLocaleString() },
    { label: 'DPA Concentration', r: `${retail.dpaConc.toFixed(1)}%`, w: `${wholesale.dpaConc.toFixed(1)}%`, t: `${totalDpaConc.toFixed(1)}%` },
    { label: 'Overall DQ Rate', r: `${retail.overallDQRate.toFixed(2)}%`, w: `${wholesale.overallDQRate.toFixed(2)}%`, t: `${totalOverallDQ.toFixed(2)}%` },
    { label: 'DPA DQ Rate', r: `${retail.dpaDQRate.toFixed(2)}%`, w: `${wholesale.dpaDQRate.toFixed(2)}%`, t: `${totalDpaDQ.toFixed(2)}%` },
    { label: 'Non-DPA DQ Rate', r: `${retail.nonDPADQRate.toFixed(2)}%`, w: `${wholesale.nonDPADQRate.toFixed(2)}%`, t: `${totalNonDpaDQ.toFixed(2)}%` },
  ];

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h2 className="section-title mb-4">Retail vs Wholesale Risk Comparison</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="matrix-header text-left">Metric</th>
              <th className="matrix-header">
                <span className="text-risk-green">Retail</span>
              </th>
              <th className="matrix-header">
                <span className="text-risk-blue">Wholesale</span>
              </th>
              <th className="matrix-header">
                <span className="text-foreground">Total</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(m => (
              <tr key={m.label} className="border-b border-border/50">
                <td className="px-2 py-2 text-sm font-medium text-left">{m.label}</td>
                <td className="matrix-cell font-medium">{m.r}</td>
                <td className="matrix-cell font-medium">{m.w}</td>
                <td className="matrix-cell font-semibold">{m.t}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 p-3 bg-risk-yellow-bg rounded-lg">
        <p className="text-xs font-medium text-center">
          Wholesale has <span className="font-bold text-risk-red">{concMultiplier}x</span> the DPA concentration of Retail
        </p>
      </div>
    </div>
  );
}
