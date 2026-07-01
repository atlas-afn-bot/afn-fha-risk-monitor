import { Info, Calculator, TrendingUp, Sigma, Database, ShieldAlert } from 'lucide-react';
import type { Snapshot, SnapshotProjections } from '@/types/snapshot';

interface Props {
  snapshot: Snapshot | null;
  projections?: SnapshotProjections;
  /** When true, renders a print-friendly version with bigger type. */
  full?: boolean;
}

/**
 * Methodology explainer — shared by the inline panel on the Projections tab
 * and the standalone `/methodology/projections` page. This is Michael's
 * explicit ask: Stefanie (3rd uploader / validator) must be able to
 * understand every number without opening the Python code.
 *
 * Content sources:
 *   - Formula / semantics come from Michael's decisions locked in
 *     during the backend design review (Compare Ratio only, ±10% lever,
 *     national held flat, drill-down mandatory).
 *   - Assumption bullets are pulled live from `projections.assumptions`
 *     so this stays in sync with `scripts/build_projections.py`.
 */
export default function MethodologyContent({ snapshot, projections, full = false }: Props) {
  const perfPeriod = snapshot?.snapshot_meta.performance_period_label
    ?? snapshot?.snapshot_meta.label
    ?? '(no snapshot loaded)';
  const generated = snapshot?.snapshot_meta.generated_at;
  const projGen = projections?.generated_at;
  const a = projections?.assumptions;

  return (
    <div className={`space-y-6 ${full ? 'max-w-3xl mx-auto' : ''}`}>
      {/* Data source & recency */}
      <Section
        icon={<Database className="w-4 h-4" />}
        title="Data source & recency"
        full={full}
      >
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex justify-between sm:block">
            <dt className="text-muted-foreground">Snapshot period</dt>
            <dd className="font-medium">{perfPeriod}</dd>
          </div>
          <div className="flex justify-between sm:block">
            <dt className="text-muted-foreground">Snapshot generated</dt>
            <dd className="font-medium">{generated ? new Date(generated).toLocaleString() : '—'}</dd>
          </div>
          <div className="flex justify-between sm:block">
            <dt className="text-muted-foreground">Projections generated</dt>
            <dd className="font-medium">{projGen ? new Date(projGen).toLocaleString() : '—'}</dd>
          </div>
          <div className="flex justify-between sm:block">
            <dt className="text-muted-foreground">Engine</dt>
            <dd className="font-medium font-mono text-[11px]">{projections?.generated_by ?? 'scripts/build_projections.py'}</dd>
          </div>
        </dl>
      </Section>

      {/* Formula */}
      <Section
        icon={<Calculator className="w-4 h-4" />}
        title="Compare Ratio — projected formula"
        full={full}
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          The projected office Compare Ratio uses the same shape HUD uses today, just with
          projected numerator/denominator:
        </p>
        <pre className="mt-2 text-[11px] font-mono bg-muted/40 border border-border rounded-md p-3 whitespace-pre-wrap">
{`Projected Compare Ratio = (office projected_delinquency_rate)
                        / (national projected_delinquency_rate)
                        × 100`}
        </pre>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">National reference is held flat per horizon</strong>{' '}
          — the ±10% delinquency lever is applied <em>only</em> to the office numerator, not
          to the national reference. This preserves the interpretation that "worst" is a
          genuine worst-case <em>for that office</em> against a stable peer benchmark, rather
          than a portfolio-wide macro shock (which would move national in lockstep and
          artificially suppress office CRs).
        </p>
      </Section>

      {/* Loan-level math */}
      <Section
        icon={<Sigma className="w-4 h-4" />}
        title="Loan-level math"
        full={full}
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          For every loan, the engine computes a per-horizon <code className="text-[11px] bg-muted px-1 rounded">will_fall_off_by_horizon</code>{' '}
          flag based on the loan's First Payment Due Date and HUD's rolling 24-month window:
        </p>
        <pre className="mt-2 text-[11px] font-mono bg-muted/40 border border-border rounded-md p-3 whitespace-pre-wrap">
{`cutoff_H = (performance_period + 1 day) − (24 − H) months
loan_falls_off_at_H ⟺ first_payment_due_date < cutoff_H`}
        </pre>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Loans still in the window at horizon <em>H</em> contribute to that office's
          denominator. Loans that are currently delinquent AND still in-window contribute to
          the base numerator. Loans without a parseable First Payment Due Date are assumed to
          stay in-window (conservative — never shrinks the denominator on missing data).
        </p>
      </Section>

      {/* Scenarios */}
      <Section
        icon={<TrendingUp className="w-4 h-4" />}
        title="Scenario semantics — the ±10% lever"
        full={full}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-1">
          <ScenarioBox
            label="Best"
            color="green"
            body={
              a?.scenario_semantics.best
                ?? '−10% of currently-delinquent, still-in-window loans cure at the horizon. Applied office-side only.'
            }
          />
          <ScenarioBox
            label="Base"
            color="blue"
            body={
              a?.scenario_semantics.base
                ?? 'No delinquency change; only the 24-month window rolls forward. Loans that fall off leave the denominator; nothing else moves.'
            }
          />
          <ScenarioBox
            label="Worst"
            color="red"
            body={
              a?.scenario_semantics.worst
                ?? '+10% of currently-non-delinquent, still-in-window loans become delinquent at the horizon. Applied office-side only.'
            }
          />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Because the ±10% adjustment is applied as an aggregate delinquency rate at the
          office level (not by picking specific loans to flip), the loan-level drill-down
          shows only the <em>base</em> per-loan delinquency projection. The best/worst
          scenarios are reconstructed by adjusting the numerator by ±10% × (in-window
          non-delinquent-or-delinquent) count. Every office-level number in the UI is the
          sum of that office's loans plus the scenario overlay — reproducible by hand from
          the underlying loan table.
        </p>
      </Section>

      {/* Aggregation */}
      <Section
        icon={<Sigma className="w-4 h-4" />}
        title="Aggregation — loan → office → HOC → national"
        full={full}
      >
        <ul className="text-xs leading-relaxed text-muted-foreground list-disc list-inside space-y-1.5">
          <li>
            <strong className="text-foreground">Office numerator</strong> = # loans classified
            delinquent at horizon under the scenario.
          </li>
          <li>
            <strong className="text-foreground">Office denominator</strong> = # loans still in
            the rolled-forward 24-month window at horizon.
          </li>
          <li>
            <strong className="text-foreground">HOC numerator/denominator</strong> = sum across
            all offices belonging to that HOC.
          </li>
          <li>
            <strong className="text-foreground">National numerator/denominator</strong> = sum
            of every loan's base-scenario projection across the whole portfolio. National is
            the fixed reference for all three scenarios (best/base/worst) at every horizon.
          </li>
          <li>
            The loan-level accordion on this tab lets you verify each office aggregate by hand
            against Encompass. That's Stefanie's audit surface — every projected number
            drills down to the loan set that produced it.
          </li>
        </ul>
      </Section>

      {/* Assumptions & caveats */}
      <Section
        icon={<ShieldAlert className="w-4 h-4" />}
        title="Assumptions & caveats"
        full={full}
      >
        <ul className="text-xs leading-relaxed text-muted-foreground list-disc list-inside space-y-1.5">
          <li>
            HUD rolling window is <strong className="text-foreground">
              {a?.hud_window_months ?? 24} months
            </strong> — locked at HUD's official window length.
          </li>
          <li>
            Threshold bands: <strong className="text-risk-yellow">Watch ≥ {a?.threshold_watch ?? 150}</strong>{' '}
            · <strong className="text-risk-red">Breach ≥ {a?.threshold_breach ?? 200}</strong>.
          </li>
          <li>
            Scenario stress magnitude:{' '}
            <strong className="text-foreground">±{a ? (a.scenario_stress_pct * 100).toFixed(0) : 10}%</strong>{' '}
            (v1 — office-side only, symmetric).
          </li>
          <li>
            <strong className="text-foreground">National reference policy:</strong>{' '}
            {a?.national_reference_policy
              ?? 'National delinquency rate is fixed at the base-scenario projection for each horizon across all three scenarios.'}
          </li>
          <li>
            <strong className="text-foreground">Missing First Payment Due Date policy:</strong>{' '}
            {a?.missing_first_payment_date_policy
              ?? 'Loans without a parseable first_payment_date are assumed to stay in-window.'}
          </li>
          <li>
            <strong className="text-foreground">Not projected in v1:</strong> DPA concentration,
            new-loan origination volume (held flat at trailing-3-mo average on the Outflow/Inflow
            chart), and horizons past 6 months (confidence degrades too quickly).
          </li>
          <li>
            Projections are not a guarantee. They assume the current loan set continues to
            perform as observed today; a macro shock or covenant change is out of scope.
          </li>
        </ul>
      </Section>

      {/* Formula reference (verbatim from JSON) */}
      {a?.compare_ratio_formula && (
        <div className="text-[10px] text-muted-foreground italic">
          Engine reference: <code className="bg-muted px-1 rounded">{a.compare_ratio_formula}</code>
        </div>
      )}
    </div>
  );
}

function Section({
  icon, title, children, full,
}: { icon: React.ReactNode; title: string; children: React.ReactNode; full?: boolean }) {
  return (
    <section className={`rounded-lg border border-border ${full ? 'p-6' : 'p-4'} bg-background`}>
      <h4 className={`font-semibold flex items-center gap-2 mb-2 ${full ? 'text-base' : 'text-sm'}`}>
        <span className="text-primary">{icon}</span>
        {title}
      </h4>
      {children}
    </section>
  );
}

function ScenarioBox({ label, color, body }: { label: string; color: 'green' | 'blue' | 'red'; body: string }) {
  const tone =
    color === 'green' ? 'border-risk-green/40 bg-risk-green-bg text-risk-green' :
    color === 'red'   ? 'border-risk-red/40 bg-risk-red-bg text-risk-red' :
                        'border-border bg-muted/40 text-foreground';
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold">{label}</p>
      <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">{body}</p>
    </div>
  );
}
