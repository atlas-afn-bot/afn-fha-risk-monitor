# FHA Risk Monitor — Snapshot JSON Schema

One JSON document per monthly performance period. The dashboard fetches this
from `public/data/snapshots/{period}.json` on cold load.

The schema mirrors the SQL DDL at `db/migrations/001_initial_schema.sql`
one-to-one: every fact table becomes a top-level section, and every SQL row
maps to one JSON object. Because the whole document _is_ the snapshot,
`snapshot_id` is implicit and not repeated on every row.

> **Canonical TypeScript type:** [`src/types/snapshot.ts`](../src/types/snapshot.ts)

## Top-level layout

```jsonc
{
  "snapshot_meta":              { ... },
  "compare_ratios_total":       [ ... ],    // fha.compare_ratios_total
  "compare_ratios_hoc":         [ ... ],    // fha.compare_ratios_hoc
  "compare_ratios_hud_office":  [ ... ],    // fha.compare_ratios_hud_office
  "compare_ratios_branch":      [ ... ],    // fha.compare_ratios_branch
  "portfolio_slices":           [ ... ],    // fha.portfolio_slices
  "loan_officer_performance":   [ ... ],    // fha.loan_officer_performance
  "risk_indicator_distribution":[ ... ],    // fha.risk_indicator_distribution
  "loans":                      [ ... ]     // fha.loans (pre-joined Encompass + NW Data 2)
}
```

## `snapshot_meta`

| Field | Type | Description |
| --- | --- | --- |
| `period` | string | `YYYY-MM`, matches the filename. |
| `label` | string | Human display — `"February 2026"`. |
| `performance_period` | string | HUD as-of date, `YYYY-MM-DD`. |
| `performance_period_label` | string | Source window — `"March 1, 2024 — February 28, 2026"`. |
| `generated_at` | string | ISO 8601 — when `build-snapshot.py` ran. |
| `generated_by` | string | e.g. `"scripts/build-snapshot.py v1"`. |
| `source_files` | string[] | Basenames of the Excel files consumed. |
| `schema_version` | number | `1` today. |
| `notes` | string? | Optional — row counts, column counts, warnings. |

## `compare_ratios_total`

One row per scope (`total` | `retail` | `sponsor`). Read straight off
`HUD Total Compare Ratios 2.28.26.xlsx` row 9 (the single summary row).

Fields mirror `fha.compare_ratios_total`:
`scope`, `compare_ratio`, `mix_adjusted_sdq`, `fha_benchmark_sdq`,
`supplemental_metric`, `loans_count`, `delinquent_count`.

## `compare_ratios_hoc`

One row per HUD Homeownership Center (4 total). Read from
`HOC Compare Ratios - 2.28.26.xlsx`.

Fields: `hoc_name` (Atlanta/Denver/Philadelphia/Santa Ana), `compare_ratio`,
`retail_ratio`, `sponsor_ratio`, `mix_adjusted_sdq`, `fha_benchmark_sdq`,
`supplemental_metric`, `loans_count`, `delinquent_count`.

## `compare_ratios_hud_office`

One row per HUD Field Office (~77 rows). Read from
`HUD Field Offices - 2.28.26.xlsx`. Extends the SQL shape with the
area-level DQ percentages the UI uses for revised compare-ratio math:

- `hud_office`, `hoc` (looked up from canonical mapping)
- `retail_branches_count`, `sponsored_branches_count`
- `compare_ratio`, `retail_ratio`, `sponsor_ratio`
- `loans_count`, `delinquent_count`
- `retail_loans`, `retail_delinquent`, `sponsored_loans`, `sponsored_delinquent`
- `hud_office_dq_pct`, `area_retail_dq_pct`, `area_sponsored_dq_pct`
- `mix_adjusted_sdq`, `fha_benchmark_sdq`, `supplemental_metric`

## `compare_ratios_branch`

One row per Retail Branch NMLS ID. Read from `HUD Branches - 2.28.26.xlsx`.

Fields: `nmls_id`, `branch_name`, `hud_office`, `approval_status` (`A`/`T`),
`loans_underwritten`, `delinquency_rate`, `compare_ratio`.

## `portfolio_slices`

Flat dimensional table — one row per `(dimension, bucket)` pair. The RPA /
`build-snapshot.py` emits every slice the dashboard could want; adding a new
dimension does **not** require a schema change.

Dimensions emitted today:
`dpa_program`, `dpa_investor`, `channel`, `fico`, `front_dti`, `back_dti`,
`ltv`, `investor`, `hud_office`, `source_of_funds`, `employment`, `aus`,
`loan_purpose`, `units`, `risk_indicator_count`.

Each row carries populations (combined / retail / wholesale), delinquent
counts, delinquency percentages, and baseline comparisons, matching
`fha.portfolio_slices` exactly.

## `loan_officer_performance`

One row per LO NMLS ID. Includes a 13-count risk-factor panel per LO, mirroring
`fha.loan_officer_performance`.

## `risk_indicator_distribution`

One row per indicator count (0..13). `loans_count`, `delinquent_count`,
`delinquency_pct`, `baseline_comparison`.

## `loans`

Pre-joined loan-level grain — Encompass row left-joined onto NW Data 2 on
`Case #`. One row per loan.

The fields mirror `fha.loans` plus a handful of **supplemental fields** that
the current UI consumes directly (raw Encompass labels for the Risk Factor
charts, the pre-computed Pay-Shock flag, the Enhanced Guidelines filter
result, etc.). Every derived field is stamped by `build-snapshot.py` so the
frontend never has to re-parse Excel values.

### Risk indicator flags

Bit flags populated by the RPA / build script:

| Flag | Trigger |
| --- | --- |
| `has_sub_620` | FICO < 620 |
| `has_super_29_dti` | Front DTI > 29% |
| `has_super_50_dti` | Back DTI > 50% |
| `has_super_90_ltv` | LTV > 90% |
| `has_super_95_ltv` | LTV > 95% |
| `has_dpa` | Loan program contains "DPA" |
| `has_manufactured` | Property type / manufactured flag |
| `has_variable_income` | Variable income (Y/N) = Y |
| `has_super_variable_income` | Variable income share > 25% |
| `has_non_owner_occupied` | Non-owner occupied borrower flag |
| `has_manual_uw` | AUS = Manual Underwriting |
| `has_hud_deficiency` | HUD / VA condition cited |
| `has_gift_grant` | Any gift / grant funds present |

### Performance flags

- `is_delinquent` — mirrors Encompass `DQ = "Yes"`
- `is_seriously_delinquent` — months delinquent ≥ 3 or HUD SDQ flag
- `is_claim` — HUD status indicates a claim

### Supplemental fields

Kept out of the SQL DDL (calculated client-side today) but baked into the
snapshot so the frontend stays simple:

`loan_program_raw`, `ltv_group`, `fthb`, `dti_back_end_group`,
`payment_shock_group`, `source_of_funds_group`, `reserves_group`,
`gift_grant_group`, `reserves_months`, `gift_fund_amount`, `payment_shock`,
`pay_shock_over_100`, `is_boost`, `fails_enhanced_guidelines`,
`hud_office_compare_ratio`, `program_type`.

## Index document

`public/data/snapshots/index.json` lists all available periods for the month
selector.

```json
{
  "schema_version": 1,
  "updated_at": "2026-04-21T20:30:00Z",
  "periods": [
    {
      "period": "2026-02",
      "label": "February 2026",
      "performance_period": "2026-02-28",
      "generated_at": "2026-04-21T20:29:00Z",
      "file": "2026-02.json"
    }
  ]
}
```

Periods are sorted latest-first. The dashboard defaults to the first entry.
