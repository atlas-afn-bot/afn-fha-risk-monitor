/**
 * AFN FHA Risk Monitor — Snapshot schema
 * -----------------------------------------------------------------------------
 * One JSON document per monthly performance period. Mirrors the SQL schema at
 * `db/migrations/001_initial_schema.sql`: every fact table becomes a
 * top-level section keyed to the same snapshot, and each row carries the
 * fields the SQL column definitions specify (minus `snapshot_id`, which is
 * implicit — the whole document IS the snapshot).
 *
 * Phase 1 of the Excel → JSON migration: the dashboard reads these files
 * directly (from `public/data/snapshots/…`). Phase 2 will replace the static
 * fetch with Azure Blob Storage, and Phase 3 (future) will stream from the
 * SQL DB above. The on-disk shape stays identical across all phases.
 *
 * See `data/schema.md` for a human-readable field-by-field description.
 */

// ─── Meta ────────────────────────────────────────────────────────────────────

export interface SnapshotMeta {
  /** "YYYY-MM" period identifier, e.g. "2026-02". */
  period: string;
  /** Display label for the period, e.g. "February 2026". */
  label: string;
  /** The HUD "as-of" date (`YYYY-MM-DD`). Mirrors `snapshots.performance_period`. */
  performance_period: string;
  /** Human-readable HUD performance window (e.g. "March 1, 2024 — February 28, 2026"). */
  performance_period_label: string;
  /** ISO timestamp of when `build-snapshot.py` produced this document. */
  generated_at: string;
  /** The script / RPA that produced this snapshot. */
  generated_by: string;
  /** Source Excel files consumed. */
  source_files: string[];
  /** Schema version for forward-compat. */
  schema_version: number;
  /** Free-form notes (may include column counts, warnings, etc.). */
  notes?: string;
}

// ─── Compare Ratios ──────────────────────────────────────────────────────────

export type CompareRatioScope = 'total' | 'retail' | 'sponsor';

export interface CompareRatioTotal {
  scope: CompareRatioScope;
  compare_ratio: number | null;
  mix_adjusted_sdq: number | null;
  fha_benchmark_sdq: number | null;
  supplemental_metric: number | null;
  loans_count: number | null;
  delinquent_count: number | null;
}

export type HocName = 'Atlanta' | 'Denver' | 'Philadelphia' | 'Santa Ana';

export interface CompareRatioHOC {
  hoc_name: HocName;
  compare_ratio: number | null;
  retail_ratio: number | null;
  sponsor_ratio: number | null;
  mix_adjusted_sdq: number | null;
  fha_benchmark_sdq: number | null;
  supplemental_metric: number | null;
  loans_count: number | null;
  delinquent_count: number | null;
}

/**
 * One row per HUD Field Office — covers everything the parser needs to
 * compute office-level compare ratios and Credit Watch / Termination Risk
 * panels. Fields mirror `fha.compare_ratios_hud_office` plus the extra
 * percentages pulled from the "HUD Field Offices" Excel that the existing
 * UI already consumes.
 */
export interface CompareRatioHudOffice {
  hud_office: string;
  hoc: HocName | null;
  retail_branches_count: number | null;
  sponsored_branches_count: number | null;
  compare_ratio: number | null;
  retail_ratio: number | null;
  sponsor_ratio: number | null;
  loans_count: number | null;
  delinquent_count: number | null;
  retail_loans: number | null;
  retail_delinquent: number | null;
  sponsored_loans: number | null;
  sponsored_delinquent: number | null;
  hud_office_dq_pct: number | null;
  area_retail_dq_pct: number | null;
  area_sponsored_dq_pct: number | null;
  mix_adjusted_sdq: number | null;
  fha_benchmark_sdq: number | null;
  supplemental_metric: number | null;
}

export interface CompareRatioBranch {
  nmls_id: string;
  branch_name: string | null;
  hud_office: string | null;
  afn_branch_names: string[] | null;
  hud_offices: string[] | null;
  afn_org_ids: string[] | null;
  approval_status: 'A' | 'T' | null;
  loans_underwritten: number | null;
  delinquency_rate: number | null;
  compare_ratio: number | null;
}

// ─── Portfolio slices ────────────────────────────────────────────────────────

/**
 * Flat dimensional analysis table — one row per (dimension, bucket).
 *
 * Dimensions include (not exhaustive — new ones can be added without schema
 * changes): dpa_program, dpa_investor, fico, front_dti, back_dti, ltv,
 * investor, hud_office, source_of_funds, employment, aus, loan_purpose,
 * units, risk_indicator_count, channel.
 */
export interface PortfolioSlice {
  dimension: string;
  bucket: string;
  bucket_order: number;

  combined_population: number | null;
  retail_population: number | null;
  wholesale_population: number | null;

  combined_delinquent: number | null;
  retail_delinquent: number | null;
  wholesale_delinquent: number | null;

  combined_pct: number | null;
  retail_pct: number | null;
  wholesale_pct: number | null;

  baseline_combined: number | null;
  baseline_retail: number | null;
  baseline_wholesale: number | null;

  baseline_comparison_combined: number | null;
  baseline_comparison_retail: number | null;
  baseline_comparison_wholesale: number | null;
}

// ─── Loan Officer performance ────────────────────────────────────────────────

export interface LoanOfficerPerformance {
  lo_nmls_id: string;
  lo_name: string | null;
  approval_status: 'A' | 'T' | null;
  channel: 'Retail' | 'Wholesale' | null;

  funded_count: number | null;
  delinquent_count: number | null;
  delinquency_pct: number | null;
  baseline_comparison: number | null;

  sub_620_count: number | null;
  super_29_dti_count: number | null;
  super_50_dti_count: number | null;
  super_90_ltv_count: number | null;
  super_95_ltv_count: number | null;
  dpa_count: number | null;
  manufactured_count: number | null;
  variable_income_count: number | null;
  super_variable_income_count: number | null;
  non_owner_occupied_count: number | null;
  manual_uw_count: number | null;
  hud_deficiency_count: number | null;
  gift_grant_count: number | null;
}

// ─── Risk indicator distribution ─────────────────────────────────────────────

export interface RiskIndicatorBucket {
  indicator_count: number; // 0..13
  loans_count: number | null;
  delinquent_count: number | null;
  delinquency_pct: number | null;
  baseline_comparison: number | null;
}

// ─── Loan-level detail (pre-joined Encompass + NW Data 2) ────────────────────

export interface Loan {
  loan_id: string;
  fha_case_number: string | null;

  loan_officer: string | null;
  lo_nmls_id: string | null;
  branch_nmls_id: string | null;
  hud_office: string | null;
  hoc: string | null;
  channel: 'Retail' | 'Wholesale' | null;

  dpa_program: 'Boost' | 'Arrive/Aurora' | 'Non-DPA' | string | null;
  dpa_name: string | null;
  dpa_investor: string | null;
  investor_name: string | null;
  loan_purpose: string | null;

  fico_score: number | null;
  front_dti: number | null;
  back_dti: number | null;
  ltv: number | null;
  loan_amount: number | null;
  source_of_funds: string | null;
  employment_type: string | null;
  aus: string | null;
  units: number | null;
  property_type: string | null;
  occupancy: string | null;

  delinquent_status_code: string | null;
  delinquent_status: string | null;
  months_delinquent: number | null;
  oldest_unpaid_installment: string | null; // ISO date
  fha_ins_stat: string | null;

  has_sub_620: boolean;
  has_super_29_dti: boolean;
  has_super_50_dti: boolean;
  has_super_90_ltv: boolean;
  has_super_95_ltv: boolean;
  has_dpa: boolean;
  has_manufactured: boolean;
  has_variable_income: boolean;
  has_super_variable_income: boolean;
  has_non_owner_occupied: boolean;
  has_manual_uw: boolean;
  has_hud_deficiency: boolean;
  has_gift_grant: boolean;
  risk_indicator_count: number;

  is_delinquent: boolean;
  is_seriously_delinquent: boolean;
  is_claim: boolean;

  // ── Supplemental fields preserved from Encompass for downstream analytics ──

  /** Raw Encompass loan-program string, e.g. "FF30 DPA". */
  loan_program_raw: string | null;
  /** Raw pre-grouped labels from Encompass (used by Risk Factor charts). */
  ltv_group: string | null;
  fthb: string | null;
  dti_back_end_group: string | null;
  payment_shock_group: string | null;
  source_of_funds_group: string | null;
  reserves_group: string | null;
  gift_grant_group: string | null;
  /** Reserve months from Encompass (for Enhanced Guidelines calculation). */
  reserves_months: number | null;
  /** Gift Fund Amount from Encompass. */
  gift_fund_amount: number | null;
  /** Payment Shock %. */
  payment_shock: number | null;
  /** Pre-computed "Pay Shock > 100" flag from Encompass ("Yes"/"No"). */
  pay_shock_over_100: string | null;
  /** Is this loan a Boost DPA (bucketed from dpa_program)? */
  is_boost: boolean;
  /** Would this loan have been filtered by Enhanced Boost DPA Guidelines? */
  fails_enhanced_guidelines: boolean;
  /** HUD-reported Office Compare Ratio for the loan's originating office. */
  hud_office_compare_ratio: number | null;
  /** Convenience: loan_program_type bucket ("DPA" | "Standard"). */
  program_type: 'DPA' | 'Standard';

  // ─── NW Data extension fields (additive; populated only for the SDQ
  //     population that NW Data 2 reports on; absent on Encompass-only loans)

  /** HUD Underwriter Name from NW Data 2. */
  underwriter_name?: string | null;
  /** HUD Underwriter ID from NW Data 2. */
  underwriter_id?: string | null;
  /** HUD Underwriter Review Approval indicator (raw). */
  underwriter_review_approval?: string | null;
  /** HUD Underwriter Mortgage Credit Rating (raw). */
  underwriter_mortgage_credit_rating?: string | null;
  /** Sponsor ID column from NW Data 2 (10-digit numeric). */
  sponsor_id?: string | null;
  /** Sponsored Originator (TPO) name. */
  sponsor_originator_name?: string | null;
  /** Sponsored Originator EIN, last 4 digits. */
  sponsor_originator_ein_last4?: string | null;
  /** Sponsored Originator NMLS ID. */
  sponsor_originator_nmls_id?: string | null;
  /** Gift Letter dollar amount from NW Data 2. */
  gift_letter_amount?: number | null;
  /** Gift Letter source. */
  gift_letter_source?: string | null;
  /** Census Tract code (string — may have leading zeros). */
  census_tract?: string | null;
  /** Underserved-area indicator (Y/N). */
  underserved_indicator?: string | null;
  /** HUD Delinquent Reason code (raw, e.g. "6", "16"). */
  delinquent_reason_code?: string | null;
  /** Payments made before first 90-day delinquency reported. */
  payments_before_first_90_day_delinquent?: number | null;
  /** Indemnification flag from NW Data 2 (Y, P, etc.). */
  indemnification_flag?: string | null;

  // ── Enc Data broker / branch fields ──
  /** TPO Broker from Enc Data (mostly null). */
  tpo_broker?: string | null;
  /** Broker company name from Enc Data (wholesale channel). */
  broker?: string | null;
  /** Branch Name from Enc Data. */
  branch_name?: string | null;
  /** Branch Name - Retail from Enc Data. */
  branch_name_retail?: string | null;

  // ─── Additional Enc Data fields for Deep Dive ───────────────────────
  /** Encompass Underwriter name (col 67). */
  underwriter_enc?: string | null;
  /** Encompass LO Employee ID (col 64). */
  lo_employee_id?: string | null;
  /** Encompass DQ flag (col 0, raw string e.g. "Yes"/"No"). */
  dq_status_enc?: string | null;
  /** Encompass HUD Reason Code (col 3). */
  hud_reason_code_enc?: string | null;
  /** AE (Account Executive) name from Encompass (col 63). */
  ae_name?: string | null;
  /** Subservicer name from Encompass (col 55). */
  subservicer?: string | null;
  /** Org ID from Encompass (col 10) — branch NMLS. */
  org_id?: string | null;
  /** TPO Broker flag from Encompass (col 151). */
  tpo_broker_flag?: string | null;
  /** Fund date from Encompass. */
  funded_date?: string | null;
  /** Closed date from Encompass. */
  closed_date?: string | null;
  /**
   * First Payment Date from Encompass Data Tab column BB (also known as
   * "First Pymt Date"). ISO `YYYY-MM-DD` when present.
   *
   * Drives the "Proposed Drop-Off (Next 3 Mo)" column on the Term and
   * Credit Watch tables — used as a proxy for HUD's "beginning amortization
   * date" rolling 24-month window.
   */
  first_payment_date?: string | null;
  /** Lien position from Encompass. */
  lien_position?: string | null;
  /** Borrower count from Encompass. */
  borrower_count?: number | null;
  /** Total income from Encompass. */
  total_income?: number | null;
  /** Is FTHB from Encompass. */
  is_fthb?: boolean;
  /** CLTV from Encompass. */
  cltv?: number | null;
  /** Interest rate from Encompass/NW. */
  interest_rate?: number | null;
  /** Insuring HOC Center from Encompass. */
  insuring_hoc?: string | null;
}

// ─── NW Data extension rollups ────────────────────────────────────────

/** Single underwriter's rollup with SDQ counts + credit-rating breakdown. */
export interface UnderwriterRating {
  rating: string;
  count: number;
}

export interface UnderwriterRollupRow {
  underwriter_name: string;
  underwriter_id: string;
  loan_count: number;
  sdq_count: number;
  sdq_pct: number | null;
  compare_ratio: number | null;
  mortgage_credit_rating_breakdown: UnderwriterRating[];
}

/** Distribution of SDQ loans across HUD's official Delinquent Reason codes. */
export interface DelinquencyReasonRollupRow {
  reason_code: string;
  reason_description: string;
  loan_count: number;
  pct_of_sdq: number;
}

/** A single loan flagged with an indemnification on the NW Data 2 export. */
export interface IndemnificationLoan {
  loan_id: string;
  fha_case_number: string | null;
  lo_name: string | null;
  indemnification_type: string;
  sdq_status: 'SDQ' | 'Current';
  delinquent_status_code: string | null;
  months_delinquent: number | null;
  hud_office: string | null;
  channel: 'Retail' | 'Wholesale' | null;
}

/**
 * One LLM-generated insight surfaced in the AI Insights panel above the
 * portfolio-composition tables. Produced by `scripts/build-snapshot.py` via
 * the AFN LiteLLM proxy; rendered by `src/components/AIInsights.tsx`.
 *
 * Projection-based insights carry the extended `projected_ratio` /
 * `horizon_months` / `scenario` / `crosses_threshold` / `confidence` fields
 * so the UI can render them with the Projections tab treatment. Legacy
 * insights (pre-projections) omit these and should render as-before.
 */
export interface AIInsight {
  /** Lucide-react icon name (must match a key in the component's ICON_MAP). */
  icon: string;
  /** Visual tone — maps to the red/yellow/blue/green color treatments. */
  tone: 'red' | 'yellow' | 'blue' | 'green';
  /** Short headline (≤ 80 chars). */
  title: string;
  /** 1–2 sentence supporting detail (≤ 280 chars). */
  body: string;

  // ── Projection extension (all optional; present only on projection-based insights) ──
  /** Projected office Compare Ratio the insight cites (e.g. 163). */
  projected_ratio?: number | null;
  /** Horizon (months) the projection references — 1, 3, or 6. */
  horizon_months?: 1 | 3 | 6 | null;
  /** Scenario the projection references — 'best' / 'base' / 'worst'. */
  scenario?: 'best' | 'base' | 'worst' | null;
  /** Threshold this insight highlights an office crossing — 150 or 200. */
  crosses_threshold?: 150 | 200 | null;
  /** LLM's stated confidence in the projection ('low' / 'medium' / 'high'). */
  confidence?: 'low' | 'medium' | 'high' | null;
}

/**
 * One Portfolio Risk Factor bullet baked into the snapshot at pipeline build
 * time (see `scripts/build-snapshot.py :: build_risk_factor_bullets()`).
 * Rendered by the Executive Summary card. Produced from the same LLM prompt
 * as the on-demand `/api/ai-analysis` regenerate endpoint (PR B), so the
 * shape here is intentionally identical to `AIBullet` in
 * `src/lib/aiAnalysis.ts`.
 */
export interface RiskFactorBullet {
  /** Free-form 1–2 sentence bullet body. */
  text: string;
  /** Visual severity — maps to the red/yellow/green/neutral treatments. */
  severity: 'red' | 'yellow' | 'green' | 'neutral';
}

/**
 * Container for the Portfolio Risk Factor bullets baked into each snapshot,
 * with provenance for the future on-demand regenerate write-back path
 * (PR B introduces `/api/ai-analysis` regenerate that mutates the
 * `regenerated_*` fields; PR A leaves them `null`).
 *
 * Optional on `Snapshot` — historical snapshots produced before this
 * feature landed (Feb–May 2026) don't carry the field; the frontend must
 * feature-detect and fall back to the existing on-demand fetch path.
 */
export interface RiskFactorBullets {
  /** 6±2 bullets summarizing risk-factor trends for the period. */
  bullets: RiskFactorBullet[];
  /** ISO timestamp of the original bake. */
  generated_at: string;
  /** The script / RPA that produced the initial bake (e.g. `scripts/build-snapshot.py v1.0`). */
  generated_by: string;
  /** ISO timestamp of the most recent on-demand regenerate. `null` if never regenerated. */
  regenerated_at: string | null;
  /** Identity of the caller who last regenerated (e.g. Entra `oid`). `null` if never regenerated. */
  regenerated_by: string | null;
  /** Schema version for forward-compat. */
  schema_version: number;
}

/** Per-sponsored-originator (TPO) rollup from NW Data 2 sponsor columns. */
export interface SponsorTPODetailRow {
  sponsor_originator_name: string;
  sponsor_originator_nmls_id: string | null;
  sponsor_originator_ein_last4: string | null;
  sponsor_id: string | null;
  loan_count: number;
  sdq_count: number;
  sdq_pct: number | null;
  compare_ratio: number | null;
}

// ─── Root document ───────────────────────────────────────────────────────────

export interface Snapshot {
  snapshot_meta: SnapshotMeta;
  compare_ratios_total: CompareRatioTotal[];
  compare_ratios_hoc: CompareRatioHOC[];
  compare_ratios_hud_office: CompareRatioHudOffice[];
  compare_ratios_branch: CompareRatioBranch[];
  portfolio_slices: PortfolioSlice[];
  loan_officer_performance: LoanOfficerPerformance[];
  risk_indicator_distribution: RiskIndicatorBucket[];
  /** NW Data extension — underwriter-level SDQ + credit-rating rollup. */
  underwriter_rollup?: UnderwriterRollupRow[];
  /** NW Data extension — SDQ distribution by HUD Delinquent Reason code. */
  delinquency_reason_rollup?: DelinquencyReasonRollupRow[];
  /** NW Data extension — loans carrying an Indemnification flag. */
  indemnification_loans?: IndemnificationLoan[];
  /** NW Data extension — per-sponsored-originator (TPO) detail rollup. */
  sponsor_tpo_detail?: SponsorTPODetailRow[];
  /**
   * AI-generated narrative findings rendered by the AI Insights panel.
   * Optional for forward-compat: snapshots produced before the AI feature
   * shipped (or builds where the LLM proxy was unreachable) may omit it.
   */
  ai_insights?: AIInsight[];
  /**
   * Portfolio Risk Factor bullets baked at pipeline build time (PR A of 2).
   * Optional for forward-compat: snapshots produced before this feature
   * shipped (Feb–May 2026) omit it — the frontend falls back to the legacy
   * on-demand `/api/ai-analysis` fetch path when absent.
   */
  risk_factor_bullets?: RiskFactorBullets;
  /**
   * Forward-looking Compare Ratio projections at 1/3/6-month horizons
   * under best/base/worst scenarios. Computed loan-level and aggregated up.
   * Optional for forward-compat with snapshots produced before the
   * projections feature shipped.
   */
  projections?: SnapshotProjections;
  loans: Loan[];
}

// ─── Projections ─────────────────────────────────────────────────────────
// Produced by `scripts/build_projections.py` (invoked from `build-snapshot.py`).
// Keep in sync with the Python module's output shape.

export type ProjectionHorizon = '1mo' | '3mo' | '6mo';
export type ProjectionScenario = 'best' | 'base' | 'worst';
export type ProjectionStatus = 'safe' | 'watch' | 'breach' | 'unknown';

export interface ProjectionScenarioResult {
  projected_numerator: number;
  projected_denominator: number;
  projected_delinquency_rate: number | null;
  projected_compare_ratio: number | null;
  projected_threshold_status: ProjectionStatus;
}

export interface ProjectionHorizonBlock {
  current_loans_in_window: number;
  current_delinquent: number;
  projected_dropoffs: number;
  projected_loans_in_window: number;
  projected_delinquent_base: number;
  scenarios: Record<ProjectionScenario, ProjectionScenarioResult>;
}

export interface ProjectionThresholdCrossing {
  horizon_months: 1 | 3 | 6;
  scenario: ProjectionScenario;
  from_status: ProjectionStatus;
  to_status: ProjectionStatus;
  current_compare_ratio: number | null;
  projected_compare_ratio: number | null;
}

export interface ProjectionOffice {
  office_id: string;
  office_name: string;
  hoc: string | null;
  loan_count_current: number;
  delinquent_count_current: number;
  current_compare_ratio: number | null;
  current_threshold_status: ProjectionStatus;
  horizons: Record<ProjectionHorizon, ProjectionHorizonBlock>;
  threshold_crossings: ProjectionThresholdCrossing[];
}

export interface ProjectionHocBlock {
  hoc_name: string;
  current_compare_ratio: number | null;
  current_threshold_status: ProjectionStatus;
  horizons: Record<ProjectionHorizon, ProjectionHorizonBlock>;
}

export interface ProjectionLoan {
  loan_id: string;
  fha_case_number: string | null;
  office_id: string | null;
  office_name: string | null;
  hoc: string | null;
  channel: 'Retail' | 'Wholesale' | null;
  first_payment_due_date: string | null;
  months_until_falls_off: number | null;
  current_delinquency_status: {
    is_delinquent: boolean;
    is_seriously_delinquent: boolean;
    months_delinquent: number | null;
    delinquent_status: string | null;
  };
  will_fall_off_by_horizon: Record<ProjectionHorizon, boolean>;
  projected_in_window_by_horizon: Record<ProjectionHorizon, boolean>;
  projected_delinquent_at_horizon_base: Record<ProjectionHorizon, boolean>;
}

export interface SnapshotProjections {
  generated_at: string;
  generated_by: string;
  performance_period: string;
  horizons: number[];
  scenarios: ProjectionScenario[];
  assumptions: {
    hud_window_months: number;
    scenario_stress_pct: number;
    scenario_semantics: Record<ProjectionScenario, string>;
    national_reference_policy: string;
    /** HUD's national delinquency rate (fraction, e.g. 0.0341) used as the
     * denominator for national- and HOC-scope projected Compare Ratios.
     * Reverse-engineered from `compare_ratios_total[scope=total]`; held
     * constant across scenarios and horizons. */
    hud_national_dq_rate: number | null;
    /** Same as `hud_national_dq_rate`, expressed as a percentage. */
    hud_national_dq_rate_pct: number | null;
    hud_national_dq_rate_source: string;
    threshold_watch: number;
    threshold_breach: number;
    compare_ratio_formula: string;
    missing_first_payment_date_policy: string;
  };
  current_compare_ratio_total: number | null;
  national: Record<ProjectionHorizon, ProjectionHorizonBlock>;
  hocs: Record<string, ProjectionHocBlock>;
  offices: ProjectionOffice[];
  loans: ProjectionLoan[];
}

// ─── Index document (public/data/snapshots/index.json) ───────────────────────

export interface SnapshotIndexEntry {
  /** "YYYY-MM" key matching `{period}.json`. */
  period: string;
  /** Display label for the month selector. */
  label: string;
  /** HUD performance as-of date (ISO `YYYY-MM-DD`). */
  performance_period: string;
  /** ISO timestamp from the snapshot's `generated_at`. */
  generated_at: string;
  /** Relative path from `public/data/snapshots/` (just the filename). */
  file: string;
}

export interface SnapshotIndex {
  /** Latest-first array of available periods. */
  periods: SnapshotIndexEntry[];
  /** ISO timestamp of when the index was last updated. */
  updated_at: string;
  /** Schema version for forward-compat. */
  schema_version: number;
}
