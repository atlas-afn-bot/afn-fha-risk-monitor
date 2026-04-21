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
  loans: Loan[];
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
