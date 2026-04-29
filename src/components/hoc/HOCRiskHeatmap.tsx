import type { Snapshot, CompareRatioHOC } from '@/types/snapshot';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Flame } from 'lucide-react';

interface Props {
  snapshot: Snapshot;
}

const HOC_ORDER = ['Denver', 'Philadelphia', 'Santa Ana', 'Atlanta'] as const;

interface MetricDef {
  label: string;
  key: string;
  extract: (r: CompareRatioHOC) => number | null;
  format: (v: number | null) => string;
  thresholds: { red: number; yellow: number };
  higherIsWorse?: boolean;
}

const METRICS: MetricDef[] = [
  {
    label: 'Total CR',
    key: 'total_cr',
    extract: r => r.compare_ratio,
    format: v => v == null ? '—' : `${Math.round(v)}%`,
    thresholds: { red: 200, yellow: 150 },
    higherIsWorse: true,
  },
  {
    label: 'Retail CR',
    key: 'retail_cr',
    extract: r => r.retail_ratio,
    format: v => v == null ? '—' : `${Math.round(v)}%`,
    thresholds: { red: 200, yellow: 150 },
    higherIsWorse: true,
  },
  {
    label: 'Sponsor CR',
    key: 'sponsor_cr',
    extract: r => r.sponsor_ratio,
    format: v => v == null ? '—' : `${Math.round(v)}%`,
    thresholds: { red: 200, yellow: 150 },
    higherIsWorse: true,
  },
  {
    label: 'SDQ Rate',
    key: 'sdq_rate',
    extract: r => (r.loans_count && r.loans_count > 0) ? ((r.delinquent_count ?? 0) / r.loans_count) * 100 : null,
    format: v => v == null ? '—' : `${v.toFixed(2)}%`,
    thresholds: { red: 8, yellow: 5 },
    higherIsWorse: true,
  },
  {
    label: 'DPA %',
    key: 'dpa_pct',
    extract: () => null, // computed from loans
    format: v => v == null ? '—' : `${v.toFixed(1)}%`,
    thresholds: { red: 50, yellow: 30 },
    higherIsWorse: true,
  },
];

function cellColor(value: number | null, metric: MetricDef): string {
  if (value == null) return '';
  if (metric.higherIsWorse) {
    if (value >= metric.thresholds.red) return 'bg-risk-red/15 text-risk-red font-semibold';
    if (value >= metric.thresholds.yellow) return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 font-semibold';
    return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
  }
  return '';
}

export default function HOCRiskHeatmap({ snapshot }: Props) {
  const rows = snapshot.compare_ratios_hoc ?? [];
  const byName = new Map(rows.map(r => [r.hoc_name, r]));

  // Compute DPA % per HOC from loan data
  const dpaPctByHoc = new Map<string, number>();
  const loansByHoc = new Map<string, { total: number; dpa: number }>();
  for (const loan of snapshot.loans) {
    if (!loan.hoc) continue;
    const entry = loansByHoc.get(loan.hoc) ?? { total: 0, dpa: 0 };
    entry.total++;
    if (loan.has_dpa) entry.dpa++;
    loansByHoc.set(loan.hoc, entry);
  }
  for (const [hoc, counts] of loansByHoc) {
    dpaPctByHoc.set(hoc, counts.total > 0 ? (counts.dpa / counts.total) * 100 : 0);
  }

  // Override DPA metric extractor with computed data
  const metricsWithDPA = METRICS.map(m => {
    if (m.key === 'dpa_pct') {
      return { ...m, extract: (r: CompareRatioHOC) => dpaPctByHoc.get(r.hoc_name) ?? null };
    }
    return m;
  });

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Flame className="w-4 h-4 text-risk-red" />
        <h3 className="text-sm font-semibold">HOC Risk Heatmap</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Side-by-side comparison of key risk metrics across all four HOC regions.
        Red = high risk, yellow = watch, green = acceptable.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-28">Metric</TableHead>
            {HOC_ORDER.map(name => (
              <TableHead key={name} className="text-xs text-center">{name}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {metricsWithDPA.map(metric => (
            <TableRow key={metric.key}>
              <TableCell className="text-xs font-medium">{metric.label}</TableCell>
              {HOC_ORDER.map(name => {
                const r = byName.get(name);
                const val = r ? metric.extract(r) : null;
                return (
                  <TableCell key={name} className={`text-xs text-center ${cellColor(val, metric)}`}>
                    {metric.format(val)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
