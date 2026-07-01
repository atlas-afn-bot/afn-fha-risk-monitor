import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Table as TableIcon, ArrowUpDown, Search } from 'lucide-react';
import type {
  SnapshotProjections,
  ProjectionLoan,
  ProjectionOffice,
  ProjectionScenario,
} from '@/types/snapshot';
import { ProjBadge } from './ProjBadge';
import { HORIZONS, horizonKey, type HorizonMonths, type ScopeSelection, formatRatio, zoneClasses, statusZone } from './types';
import { filterOfficesByScope } from './selectors';

interface Props {
  projections: SnapshotProjections;
  timeframe: HorizonMonths;
  scenario: ProjectionScenario;
  scope: ScopeSelection;
}

/**
 * Loan-level drill-down accordion. Each office row expands to a table of
 * every loan feeding that office's projection — this is Stefanie's audit
 * surface and must reconcile hand-computed against the aggregate projections.
 *
 * Columns match the task brief:
 *   loan_id · first_payment_due_date · months_until_falls_off ·
 *   current_delinquency_status · will_fall_off_by_horizon (1/3/6) ·
 *   projected_delinquent_at_horizon (1/3/6 × scenario base)
 *
 * (Best/worst are ±10% office-side stochastic adjustments applied at
 * aggregation time — they don't map to per-loan flips, so per-loan flags
 * are shown for the **base** scenario only. The methodology panel calls
 * this out explicitly so reviewers know why.)
 */
export default function LoanLevelAccordion({ projections, timeframe, scenario, scope }: Props) {
  const offices = useMemo(() => {
    const filtered = filterOfficesByScope(projections, scope);
    // Sort by projected CR for the current horizon+scenario desc, breachers first
    const key = horizonKey(timeframe);
    return filtered.slice().sort((a, b) => {
      const ar = a.horizons[key]?.scenarios[scenario]?.projected_compare_ratio ?? 0;
      const br = b.horizons[key]?.scenarios[scenario]?.projected_compare_ratio ?? 0;
      return (br ?? 0) - (ar ?? 0);
    });
  }, [projections, timeframe, scenario, scope]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const filtered = filter
    ? offices.filter(o => o.office_name.toLowerCase().includes(filter.toLowerCase()))
    : offices;

  return (
    <div className="rounded-2xl border bg-card shadow-sm p-6">
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <TableIcon className="w-4 h-4 text-primary" />
            Loan-Level Detail — Audit Drill-Down
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl">
            Every projected office number is the sum of its underlying loans. Expand any
            office row to spot-check the projection against Encompass. Per-loan flags
            reflect the <span className="italic">base</span> scenario; best/worst are ±10%
            aggregate stress overlays (see Methodology).
          </p>
        </div>
        <ProjBadge scenario={scenario} suffix={`${timeframe}mo`} />
      </div>

      <div className="relative mt-2 mb-3">
        <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter offices by name (try Charleston, Lubbock, Shreveport)…"
          className="w-full h-8 rounded-md border border-border bg-background pl-8 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[24px_1.5fr_0.8fr_0.7fr_0.7fr_0.7fr_0.7fr] gap-2 px-3 py-2 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          <span></span>
          <span>Office</span>
          <span>HOC</span>
          <span className="text-right">Loans</span>
          <span className="text-right">Current CR</span>
          <span className="text-right">Projected CR</span>
          <span className="text-right">Δ</span>
        </div>
        <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
          {filtered.map(o => (
            <OfficeRow
              key={o.office_id}
              office={o}
              open={openId === o.office_id}
              onToggle={() => setOpenId(openId === o.office_id ? null : o.office_id)}
              timeframe={timeframe}
              scenario={scenario}
              loans={projections.loans}
            />
          ))}
          {filtered.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No offices match this filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface OfficeRowProps {
  office: ProjectionOffice;
  open: boolean;
  onToggle: () => void;
  timeframe: HorizonMonths;
  scenario: ProjectionScenario;
  loans: ProjectionLoan[];
}

function OfficeRow({ office, open, onToggle, timeframe, scenario, loans }: OfficeRowProps) {
  const key = horizonKey(timeframe);
  const sc = office.horizons[key]?.scenarios[scenario];
  const cr = sc?.projected_compare_ratio ?? null;
  const delta = cr != null && office.current_compare_ratio != null
    ? cr - office.current_compare_ratio
    : null;
  const zone = statusZone(sc?.projected_threshold_status);
  const z = zoneClasses[zone];

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full grid grid-cols-[24px_1.5fr_0.8fr_0.7fr_0.7fr_0.7fr_0.7fr] gap-2 px-3 py-2.5 text-xs hover:bg-muted/40 transition-colors text-left items-center"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span className="font-medium truncate">{office.office_name}</span>
        <span className="text-muted-foreground truncate">{office.hoc ?? '—'}</span>
        <span className="text-right tabular-nums">{office.loan_count_current.toLocaleString()}</span>
        <span className="text-right tabular-nums text-muted-foreground">
          {formatRatio(office.current_compare_ratio)}
        </span>
        <span className={`text-right tabular-nums font-semibold ${z.text}`}>
          {formatRatio(cr)}
        </span>
        <span className={`text-right tabular-nums ${
          delta == null ? 'text-muted-foreground' :
          delta > 0 ? 'text-risk-red' : delta < 0 ? 'text-risk-green' : 'text-muted-foreground'
        }`}>
          {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}`}
        </span>
      </button>

      {open && (
        <div className="bg-muted/20 border-t border-border px-4 py-3">
          <OfficeLoans officeId={office.office_id} loans={loans} scenario={scenario} timeframe={timeframe} />
        </div>
      )}
    </div>
  );
}

interface OfficeLoansProps {
  officeId: string;
  loans: ProjectionLoan[];
  scenario: ProjectionScenario;
  timeframe: HorizonMonths;
}

type LoanSortKey = 'loan_id' | 'first_payment_due_date' | 'months_until_falls_off' | 'delinquency';
type SortDir = 'asc' | 'desc';

function OfficeLoans({ officeId, loans, scenario, timeframe }: OfficeLoansProps) {
  const officeLoans = useMemo(
    () => loans.filter(l => l.office_id === officeId),
    [officeId, loans],
  );

  const [sortKey, setSortKey] = useState<LoanSortKey>('months_until_falls_off');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [dqOnly, setDqOnly] = useState(false);
  const [fallsOffOnly, setFallsOffOnly] = useState(false);

  const sorted = useMemo(() => {
    const rows = officeLoans.slice();
    if (dqOnly) {
      const only = rows.filter(l => l.current_delinquency_status.is_delinquent);
      rows.length = 0; rows.push(...only);
    }
    if (fallsOffOnly) {
      const key = horizonKey(timeframe);
      const only = rows.filter(l => l.will_fall_off_by_horizon[key]);
      rows.length = 0; rows.push(...only);
    }
    rows.sort((a, b) => {
      let av: string | number = 0, bv: string | number = 0;
      if (sortKey === 'loan_id') { av = a.loan_id; bv = b.loan_id; }
      else if (sortKey === 'first_payment_due_date') {
        av = a.first_payment_due_date ?? ''; bv = b.first_payment_due_date ?? '';
      }
      else if (sortKey === 'months_until_falls_off') {
        av = a.months_until_falls_off ?? 999; bv = b.months_until_falls_off ?? 999;
      }
      else {
        av = a.current_delinquency_status.is_delinquent ? 1 : 0;
        bv = b.current_delinquency_status.is_delinquent ? 1 : 0;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }, [officeLoans, sortKey, sortDir, dqOnly, fallsOffOnly, timeframe]);

  const toggleSort = (k: LoanSortKey) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  // Show at most 500 loans in the DOM — office loan counts are usually small
  // but Birmingham etc. can have hundreds. Anything larger than 500 is a
  // reason to open the CSV / DB directly.
  const CAP = 500;
  const capped = sorted.slice(0, CAP);
  const isCapped = sorted.length > CAP;

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{officeLoans.length} loans in office · showing {capped.length}</span>
        <label className="flex items-center gap-1 cursor-pointer normal-case tracking-normal text-xs text-foreground">
          <input type="checkbox" checked={dqOnly} onChange={(e) => setDqOnly(e.target.checked)} />
          Delinquent only
        </label>
        <label className="flex items-center gap-1 cursor-pointer normal-case tracking-normal text-xs text-foreground">
          <input type="checkbox" checked={fallsOffOnly} onChange={(e) => setFallsOffOnly(e.target.checked)} />
          Falls off ≤ {timeframe}mo
        </label>
      </div>

      <div className="overflow-x-auto border border-border rounded-md bg-background">
        <table className="w-full text-[11px]">
          <thead className="bg-muted/40 text-[9px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <SortHead active={sortKey === 'loan_id'} dir={sortDir} onClick={() => toggleSort('loan_id')}>
                Loan ID
              </SortHead>
              <SortHead active={sortKey === 'first_payment_due_date'} dir={sortDir} onClick={() => toggleSort('first_payment_due_date')}>
                First Payment
              </SortHead>
              <SortHead active={sortKey === 'months_until_falls_off'} dir={sortDir} onClick={() => toggleSort('months_until_falls_off')} align="right">
                Mo. to Fall-Off
              </SortHead>
              <SortHead active={sortKey === 'delinquency'} dir={sortDir} onClick={() => toggleSort('delinquency')} align="right">
                Current DQ
              </SortHead>
              {HORIZONS.map(h => (
                <th key={`fo-${h}`} className="px-2 py-1.5 text-center font-medium">Fall-off {h}mo</th>
              ))}
              {HORIZONS.map(h => (
                <th key={`pd-${h}`} className="px-2 py-1.5 text-center font-medium">Δq {h}mo (base)</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {capped.map(l => (
              <LoanRow key={l.loan_id} loan={l} />
            ))}
          </tbody>
        </table>
      </div>
      {isCapped && (
        <p className="mt-2 text-[10px] text-muted-foreground italic">
          Display capped at {CAP} loans. Filter or open the snapshot JSON directly to audit the full set.
        </p>
      )}
    </div>
  );
}

function SortHead({
  active, dir, onClick, children, align = 'left',
}: {
  active: boolean; dir: SortDir; onClick: () => void; children: React.ReactNode; align?: 'left' | 'right';
}) {
  return (
    <th
      className={`px-2 py-1.5 font-medium cursor-pointer select-none text-${align} hover:text-foreground`}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        <ArrowUpDown className={`w-2.5 h-2.5 ${active ? 'opacity-100' : 'opacity-30'}`} />
        {active && <span className="text-[8px]">{dir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  );
}

function LoanRow({ loan }: { loan: ProjectionLoan }) {
  const isDq = loan.current_delinquency_status.is_delinquent;
  const isSdq = loan.current_delinquency_status.is_seriously_delinquent;
  return (
    <tr className="border-t border-border/60 hover:bg-muted/20">
      <td className="px-2 py-1 font-mono">{loan.loan_id}</td>
      <td className="px-2 py-1 tabular-nums text-muted-foreground">
        {loan.first_payment_due_date ?? '—'}
      </td>
      <td className="px-2 py-1 text-right tabular-nums">
        {loan.months_until_falls_off ?? '—'}
      </td>
      <td className="px-2 py-1 text-right">
        {isSdq ? (
          <span className="inline-block px-1.5 py-0 rounded-full bg-risk-red-bg text-risk-red text-[9px] font-semibold uppercase">SDQ</span>
        ) : isDq ? (
          <span className="inline-block px-1.5 py-0 rounded-full bg-risk-yellow-bg text-risk-yellow text-[9px] font-semibold uppercase">DQ</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      {HORIZONS.map(h => {
        const k = horizonKey(h);
        const fallsOff = loan.will_fall_off_by_horizon[k];
        return (
          <td key={`fo-${h}`} className="px-2 py-1 text-center">
            {fallsOff ? (
              <span className="text-risk-red text-[10px]">●</span>
            ) : (
              <span className="text-muted-foreground text-[10px]">·</span>
            )}
          </td>
        );
      })}
      {HORIZONS.map(h => {
        const k = horizonKey(h);
        const inWindow = loan.projected_in_window_by_horizon[k];
        const dq = loan.projected_delinquent_at_horizon_base[k];
        return (
          <td key={`pd-${h}`} className="px-2 py-1 text-center align-middle">
            {!inWindow ? (
              <span className="inline-block text-muted-foreground text-[9px] italic leading-none" title="Loan fell out of the 24-month window before this horizon — not counted in projection">off</span>
            ) : dq ? (
              <span className="inline-block text-risk-red text-[10px] leading-none" title="Projected delinquent at horizon (base scenario)">●</span>
            ) : (
              <span className="inline-block text-muted-foreground text-[10px] leading-none">·</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
