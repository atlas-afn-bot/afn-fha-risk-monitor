# Snapshot Pipeline — Engineering Notes

Work-in-progress notes captured while building the first Feb 2026 snapshot.
These document decisions, ambiguities, and known gaps — expected to be
reviewed and filed into the main docs after the PR lands.

## Source file quirks

### Header rows
Every HUD-export .xlsx has **7 header rows** (titles / "Performance Period"
/ "Data shown includes…") before the actual column header. `build-snapshot.py`
reads all of them with `header=7`, so if HUD ever changes the header layout,
the script will need to re-probe.

### NW Data 2
The `NW Data` export (HUD's seriously-delinquent list) uses `header=8` —
one extra summary row at the top.

The column name is **`Case Number`** (not `Case #`) — Encompass uses `Case #`.
The join maps `Case Number → Case #` before merging.

### Footers
HUD sheets carry a `Report Summary:` / `Report Run: <date>` /
`Output Options: …` tail of ~4 rows. The parser filters them by requiring
the first column to be a real office/branch/HOC name (non-numeric, not
starting with `Report `, `Output `, `Loan Type`).

## Encompass ↔ HUD NW join

- **100% clean join** on February 2026: every Encompass DQ=Yes row (490) is
  present in NW Data 2 (490). The Encompass export's `DQ` column is already
  aligned to HUD's SDQ list — we do not recompute delinquency.
- HUD Total reports 9,389 loans and 490 SDQ; Encompass exports 9,400 loans
  (HUD excludes streamline refinances, Encompass does not). We preserve all
  9,400 Encompass rows in `loans[]` and use the HUD counts verbatim in
  `compare_ratios_total`.

## Risk-indicator flag rules

Per task-spec defaults, applied per Encompass row:

| Flag | Rule | Source |
| --- | --- | --- |
| `has_sub_620` | `fico < 620` | FICO |
| `has_super_29_dti` | `front_dti > 29` | Top Ratio |
| `has_super_50_dti` | `back_dti > 50` | Bottom Ratio |
| `has_super_90_ltv` | `ltv > 90` | LTV |
| `has_super_95_ltv` | `ltv > 95` | LTV |
| `has_dpa` | `DPA Program != "Non-DPA"` (non-blank) | DPA Program |
| `has_manual_uw` | `AUS == "Manual"` | Underwriting Risk Assess Type |
| `has_manufactured` | `Manufactured == "X"` | Manufactured col |
| `has_variable_income` | `Variable Income (Y/N) == "Y"` | Variable Income (Y/N) |
| `has_super_variable_income` | `Super Variable Income (>25%) == "Y"` | Super Variable Income |
| `has_non_owner_occupied` | `Non-Owner Occupied Borrower == "X"` | Non-Owner Occupied col |
| `has_hud_deficiency` | `Indemnification == "X"` | Indemnification col |
| `has_gift_grant` | `Gift or Grant (Y/N) == "Y"` **OR** `Gift Fund Amount > 0` | Combined |

`risk_indicator_count` prefers Encompass's pre-computed
`Risk Indicator Count` column when present; falls back to summing the above
flags.

## Loan Officer identity

Encompass does **not** carry a per-LO NMLS ID column. The closest fields are:
- `Loan Officer - Retail` (name string)
- `LO Employee ID` (internal AFN employee ID, not NMLS)

`loan_officer_performance.lo_nmls_id` is populated from `LO Employee ID` —
this is what's available. When that's blank, we fall back to a synthetic
key of `"name:<lowercased name>"` so the row still appears in aggregates.
Switching to real NMLS IDs requires either:
1. Enriching Encompass export with `Loan Officer NMLS ID` column, **or**
2. Looking up LOs via NMLS Consumer Access (out of scope)

## Branch identity

`HUD Branches` reports branches by 10-digit NMLS ID only — no name, no
HUD office association. `build-snapshot.py` enriches these by looking up
`Org ID → Branch Name` and `Org ID → HUD Office` from the Encompass export
(both fields are present there). This works because Encompass's `Org ID`
field is the same NMLS ID HUD uses.

## "Employment type" proxy

Encompass has no clean employment-type field that matches the SQL
`dimensions.employment` seed. The script currently uses
`Source of Funds Group` as a proxy (it contains values like "Borrower Funds"
/ "Secured Borrowed Funds" / "Gift"). A dedicated field would be better —
probably constructed from `Borr Self Employed` + `Self Employed (Y/N)` +
`Total Variable Income` — tracked as a follow-up.

## Reserves column weirdness

A single row in the Feb 2026 Encompass export carries
`Reserves Group = "1900-01-03 00:00:00"` — pandas misinterpreted a string
value as a date. The numeric `Reserves` column is null for that row. We
preserve the raw group string in the loan but downstream aggregates treat
the bucket as "Unknown".

## Compare Ratio values

**Never recomputed.** All four `compare_ratios_*` arrays come verbatim
from the HUD NW files. Only the portfolio_slices / loan-level flags are
derived.

## Follow-ups (post-PR)

1. Swap `source_of_funds_group` proxy for real employment field
2. Add "channel" dimension to `dimensions` seed (already emitted in slices
   but not in SQL seed)
3. Azure Blob Storage delivery (replace committed snapshot JSON)
4. Loan Officer Leaderboard component wired to `loan_officer_performance`
5. Diff tooling for month-over-month snapshot comparisons
