# PR #1 Code Review — THEMIS

**PR:** https://github.com/afncorp/afn-fha-risk-monitor/pull/1
**Branch:** `feat/json-snapshot-data-layer`
**Reviewer:** THEMIS (divine-law code review, spawned by ATLAS)
**Date:** 2026-04-21
**Scope reviewed:** `main..HEAD` (6 commits, +622,890 / −1,027)

---

## Verdict

**REQUEST CHANGES** — do **not** merge as-is.

The architectural cutover itself is sound: the UI, adapter, schema, and pipeline fit together cleanly, the Excel flow is ripped out without orphans, commits tell a coherent story, and the derived-metric parity with the old pipeline looks good. However, two classes of issue block merge on their own merits:

1. **Security / PII.** The committed `public/data/snapshots/2026-02.json` (19 MB, served as a public static asset from the deployed Static Web App) contains 487 unique Loan Officer full names, 9,400 unique FHA case numbers, and borrower-level loan attributes (FICO, DTI, LTV, occupancy, investor, delinquency status, loan amount, gift amounts, payment shock). Even if the SWA has auth enforced today, **the file is bundled into `/data/snapshots/2026-02.json` at the site origin** — once the URL is known, any path-level auth gap or policy misconfiguration exfiltrates the entire FHA book.
2. **Silent data-quality bugs in the snapshot writer** that corrupt user-visible metrics:
   - `oldest_unpaid_installment` is the literal string `"NaT"` on 8,910 of 9,400 loans.
   - `fails_enhanced_guidelines` is computed with `fico = _clean_num(...) or 0`, which coerces missing FICO scores to 0 and then evaluates `0 < 680` → **False positive Enhanced-Guidelines failures for every loan with a missing FICO**. This number feeds directly into the revised Compare Ratio the Termination Risk panel displays.
   - One loan has `reserves_group = "1900-01-03 00:00:00"` (Excel serial-date coercion); noted in `NOTES.md` but not guarded against.

These are all fixable inside an afternoon. The architecture is good. The data-discipline gaps need to close before this becomes the foundation the whole dashboard runs on.

---

## Critical Issues (must-fix before merge)

### 1. PII exposure — public/data/snapshots/2026-02.json served as a public static asset
- **File:** `public/data/snapshots/2026-02.json` (+ `scripts/build-snapshot.py:build_loans` populating PII fields into the output)
- **Severity:** CRITICAL (security / regulatory)
- **Explanation:** 487 LO names + 9,400 FHA case numbers + loan-level financials are now addressable at `https://<swa>/data/snapshots/2026-02.json`. FHA case numbers are tied to borrowers and are considered NPI (nonpublic personal information) under GLBA; LO names combined with performance/DQ attribution create a defamation/HR risk if leaked. The `Confidential` banner inside the UI is irrelevant — the raw JSON sits beside `index.html` in the built bundle. A typo in an Azure Front Door rule, a careless `allowAnonymous: true`, a preview slot, a crawler, a shared URL — any of these leaks the whole book.
- **Proposed fix (pick one, in order of preference):**
  1. **(Preferred, short-term)** Move snapshots out of `public/` immediately. Serve them from an authenticated endpoint (Azure Function / SWA API route) that checks a session/bearer token before streaming the JSON. The URL under `public/` should 404 for unauthenticated users.
  2. **(Interim hardening if #1 is not feasible before ship)** Strip or hash the identifying fields before they're written to the public snapshot: drop `fha_case_number`, replace `loan_officer` with `lo_nmls_id` only (or a short hash), drop raw `loan_id`. Keep the full PII snapshot in `data/private/` (gitignored or in a private blob). The dashboard does not display raw FHA case numbers or loan IDs today — verify with the components and strip what isn't needed.
  3. **(Belt-and-suspenders)** Turn on Azure SWA route-level auth for `/data/*` even if #1 is done. Configure `staticwebapp.config.json` with `allowedRoles: ["authenticated"]` on that path. Add a test that an unauthenticated GET returns 401.
- **Acceptance:** An unauthenticated `curl https://<deployed-url>/data/snapshots/2026-02.json` must not return the payload.

### 2. `oldest_unpaid_installment` stored as literal `"NaT"` string on 8,910/9,400 loans
- **File:** `scripts/build-snapshot.py:_iso_date` (and the caller at `build_loans`)
- **Severity:** CRITICAL (data correctness)
- **Explanation:** `_iso_date` returns `str(v).strip()` for anything that isn't a `datetime`/`date`. Pandas encodes missing dates as `NaT`, which stringifies to `"NaT"`. Every non-delinquent loan gets `"oldest_unpaid_installment": "NaT"` — this is not a valid ISO date, does not round-trip through `Date.parse()`, and will break any future UI, export, or schema-validation step that expects `null`. The JSON Schema at `data/snapshot.schema.json` accepts it today only because the type is `["string","null"]` with no format constraint — a latent schema-contract break.
- **Proposed fix:**
  ```python
  def _iso_date(v):
      if v is None: return None
      if isinstance(v, pd.Timestamp) and pd.isna(v): return None
      if isinstance(v, float) and math.isnan(v): return None
      if isinstance(v, dt.datetime): return v.date().isoformat()
      if isinstance(v, dt.date): return v.isoformat()
      s = str(v).strip()
      if not s or s.lower() in {"nan","nat","none"}: return None
      return s
  ```
  Then tighten the schema:
  ```json
  "oldest_unpaid_installment": { "type": ["string","null"], "format": "date" }
  ```
- **Acceptance:** `jq '[.loans[] | .oldest_unpaid_installment] | map(select(. == "NaT")) | length' 2026-02.json` == 0.

### 3. `fails_enhanced_guidelines` false-positives on missing-FICO loans
- **File:** `scripts/build-snapshot.py:build_loans` + `_fails_enhanced_guidelines`
- **Severity:** CRITICAL (data correctness — affects visible Revised Compare Ratio)
- **Explanation:** Upstream coercion `fico = _clean_num(row.get("FICO")) or 0` turns a missing FICO into 0. `_fails_enhanced_guidelines` then evaluates `fico < 680` as `0 < 680` → True, and the gift/reserves sub-clauses may trigger. The first safety check (`if fico and fico < 640: return True`) short-circuits only because `0 and …` is falsy — but every subsequent branch treats 0 as "sub-680" and can return True. 40 loans in the Feb 2026 snapshot have FICO null; 3 of them are flagged `fails_enhanced_guidelines=True`. Those false positives feed into `retailRemoved` / `wsRemoved` in `computeData.ts:computeOffices`, which drives the Revised Total CR shown to the committee.
- **Proposed fix:** Distinguish "no FICO" from "FICO = 0" at the top of the function and exit early:
  ```python
  def _fails_enhanced_guidelines(fico, units, aus, reserves, gift_amount, pay_shock_over_100, is_boost):
      if not is_boost: return False
      if fico is None or fico <= 0:
          return False   # cannot apply guideline without FICO
      ...
  ```
  and change the caller to pass `None` instead of `or 0`:
  ```python
  fico = _clean_num(row.get("FICO"))
  ```
  then audit every other `or 0` coercion in `build_loans` for the same class of bug (I counted: `units_val`, `reserves_months`, `gift_amount`, `variable_pct` all do the same thing; `reserves` feeding `_fails_enhanced_guidelines` is the worst because `< 1` / `< 2` / `< 3` branches all fire on missing data).
- **Acceptance:** `jq '[.loans[] | select(.fico_score == null and .fails_enhanced_guidelines)] | length' 2026-02.json` == 0 *or* a documented policy for the missing-FICO case.

---

## Major Issues (strongly recommended before merge)

### 4. `lo_nmls_id` is populated from Encompass `LO Employee ID`, not NMLS ID — field name is misleading
- **File:** `scripts/build-snapshot.py:build_loans` (sampled values like `"A5K1"`, `"47"`, `"AA3B"`), `src/types/snapshot.ts:Loan.lo_nmls_id`, `LoanOfficerPerformance.lo_nmls_id`
- **Severity:** MAJOR (data contract)
- **Explanation:** The fix in commit d605693 is correct in outcome (use the field that's populated on every loan), but the result is that a field named `lo_nmls_id` contains zero real NMLS IDs — every value is a 2-4 char AFN internal employee ID. This is a landmine: the SQL migration (`db/migrations/001_initial_schema.sql`) likely has a column `lo_nmls_id CHAR(7..10)` or similar, any future downstream consumer (RPA, compliance report, NMLS lookup tooling) will query this field expecting NMLS IDs, and Phase 3's DB migration will either blow up on type constraints or silently load garbage.
- **Proposed fix:** Rename the field to `lo_id` (generic) or `lo_employee_id` in `snapshot.ts`, `snapshot.schema.json`, `schema.md`, and `build-snapshot.py`. Add a separate `lo_nmls_id: string | null` that is null today and populated later when the Encompass export includes it. Preserve the current behavior for the dashboard by keying rollups on `lo_id`. This is a single-PR rename with no runtime behavior change; do it before the schema is treated as stable.
- NOTES.md §"Loan Officer identity" already acknowledges this limitation — the fix is to align the field name with reality.

### 5. `reserves_group` can contain an Excel-serial date string
- **File:** `scripts/build-snapshot.py:build_loans` (via `_clean_str(row.get("Reserves Group"))`)
- **Severity:** MAJOR (data correctness, low blast radius)
- **Explanation:** One Feb 2026 loan has `reserves_group: "1900-01-03 00:00:00"` — openpyxl/pandas interpreted a numeric string as a date. `NOTES.md` acknowledges this. The current code passes it through to the frontend, where the RiskFactor charts will render a phantom "1900-01-03" bucket (small, but visible).
- **Proposed fix:** Normalize suspicious `reserves_group` strings: if the value parses as a datetime or starts with `"1900-"`, either convert back to the numeric reserves months (`reserves_months`) or set to `"Unknown"`. Apply a generic sanity filter for every `*_group` string field.
- **Acceptance:** No snapshot row has a `reserves_group` value matching `^\d{4}-\d{2}-\d{2}`.

### 6. `snapshotLoader.ts` does not validate the snapshot against the JSON Schema
- **File:** `src/lib/snapshotLoader.ts:loadSnapshot`
- **Severity:** MAJOR (defense in depth)
- **Explanation:** The loader validates only two things: period format (regex) and `snapshot_meta.period` equality. Anything else — wrong types on numeric fields, missing required arrays, renamed enum values, a truncated upload — will reach `buildDashboardFromSnapshot`, fail at the first property access, and surface as a generic `TypeError: Cannot read properties of undefined` in the error banner. That's a poor diagnostic experience for Matt or anyone else re-running the script.
- **Proposed fix:** Add a lightweight runtime check (or AJV-based validation against `data/snapshot.schema.json`) behind a feature flag; at minimum verify top-level array presence + non-empty `loans` + `schema_version` match. The schema file already exists; wire it in.
  ```ts
  if (snap.snapshot_meta.schema_version !== EXPECTED_SCHEMA_VERSION) {
    throw new SnapshotLoadError(`Schema version mismatch: got ${snap.snapshot_meta.schema_version}, expected ${EXPECTED_SCHEMA_VERSION}`);
  }
  for (const k of REQUIRED_KEYS) {
    if (!Array.isArray(snap[k])) throw new SnapshotLoadError(`Missing/invalid ${k}`);
  }
  ```
- **Acceptance:** Pointing the loader at a malformed snapshot (delete a top-level key) surfaces a named error, not a raw TypeError.

### 7. `compare_ratios_total.loans_count` (9,389) ≠ `loans[].length` (9,400) — silent mismatch
- **File:** `scripts/build-snapshot.py:build_loans` + `read_compare_ratios_total`
- **Severity:** MAJOR (auditability)
- **Explanation:** The HUD top-line says 9,389 loans; Encompass contributes 9,400 loans. `NOTES.md` explains this is expected (HUD excludes streamline refi), but nothing in the snapshot records the delta or reconciliation. A future reader computing `sum(compare_ratios_hud_office.loans_count)` vs `len(loans)` will find an 11-row discrepancy with no audit trail. Same for delinquent counts.
- **Proposed fix:** Add to `snapshot_meta` (or a new `reconciliation` section):
  ```json
  "reconciliation": {
    "encompass_loan_count": 9400,
    "hud_top_line_loan_count": 9389,
    "excluded_streamline_refi": 11,
    "encompass_dq_count": 490,
    "hud_top_line_dq_count": 490
  }
  ```
  And print the delta to stderr if it exceeds a configurable threshold (e.g. 5%).

### 8. `snapshot_meta.generated_at` uses naïve `datetime.utcnow()`; schema requires `format: date-time`
- **File:** `scripts/build-snapshot.py:main` (`dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"`)
- **Severity:** MAJOR (deprecation + reproducibility)
- **Explanation:** `datetime.utcnow()` is deprecated as of Python 3.12. More importantly, "Reproducibility: can someone re-run the script and get byte-identical output?" — no, because `generated_at` is wall-clock. That's fine for provenance but it means diffs between runs of the same input will be non-trivial. Worth documenting.
- **Proposed fix:**
  ```python
  "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z"),
  ```
  Also expose a `--deterministic` / `SOURCE_DATE_EPOCH` switch that freezes the timestamp to the latest source-file mtime, so CI can byte-compare snapshot regenerations.

### 9. Tests: none added for a refactor this large
- **File:** (absence of `**/*.test.ts`, `**/*.spec.ts`, `tests/test_build_snapshot.py`)
- **Severity:** MAJOR (regression risk)
- **Explanation:** The whole data layer was rewritten with zero automated tests. `buildDashboardFromSnapshot`, `_fails_enhanced_guidelines`, `build_portfolio_slices`, and `snapshotLoader` are all untested. Issues #2 and #3 above are exactly the kind of regression a 10-line unit test catches.
- **Proposed fix:** At minimum, before merging:
  1. A Python test for `_fails_enhanced_guidelines` with explicit cases for missing FICO, missing reserves, Boost vs non-Boost, Manual vs DU.
  2. A tiny fixture snapshot (50 loans, hand-crafted) + a Vitest test that loads it through `snapshotLoader` + `buildDashboardFromSnapshot` and asserts top-line numbers.
  3. A JSON Schema validation step in CI (`ajv validate -s data/snapshot.schema.json -d public/data/snapshots/2026-02.json`).
- Deferring is acceptable only if a test-adding follow-up PR is scheduled before the next snapshot drop.

---

## Minor Issues / Nits

### 10. `src/pages/Index.tsx:124,143` — `catch (e: any)`
Small, but worth tightening. Use `unknown` + type guard; you already have `SnapshotLoadError`, so:
```ts
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : 'Failed to load snapshot';
  setError(msg);
}
```

### 11. `MonthSelector.tsx:21` — `<select>` value binds to `selected?.period` (optional chain)
Since `periods.length === 0` is guarded two lines up, `selected` is always defined, but the optional chain hides that. Either assert (`selected!.period`) or, better, drop the fallback `?? periods[0]` in the useMemo and assume caller guarantees a valid `selectedPeriod` — same defensive posture, fewer footguns.

### 12. `MonthSelector.tsx:31` — `disabled={disabled || periods.length <= 1}`
Auto-disabling the dropdown when there's only one period is surprising UX. A user who sees a dropdown expects it to open. Prefer showing it as a static label when `periods.length === 1`:
```tsx
if (periods.length === 1) return <span>{periods[0].label}</span>;
```

### 13. `computeData.ts` — legacy `ParsedLoan` shape round-trip has field mismatches
The adapter in `snapshotLoanToParsed` stringifies numbers (`Units: l.units != null ? String(l.units) : ''`, `GiftFunds: l.gift_fund_amount != null ? String(l.gift_fund_amount) : '0'`) to match the old Excel-parsed shape. That's fine for compat but the eventual cleanup is to push the snapshot-native types all the way into the compute layer; the adapter is temporary scaffolding and should carry a TODO to that effect. Currently no TODO exists.

### 14. `computeData.ts:computeOffices` fallback CR scaling is proportional, not HUD-derived
When there is no `hudEntry`, revised CR is scaled proportionally (`revisedTotalCR = Math.round(totalCR * (revisedTotalDLQ / totalDLQ))`). That's mathematically wrong — it ignores the denominator shift. Preserved from the old code, but worth noting. In practice HUD data is always present for the offices the committee looks at, so this only bites for very small / unseen offices.

### 15. `scripts/build-snapshot.py` — no `__main__` guard around `openpyxl` warnings; Py 3.12 warnings noise
Not blocking. Add `warnings.filterwarnings("ignore", module="openpyxl")` or run with `-W ignore::UserWarning` for cleaner CI logs.

### 16. `scripts/requirements.txt` lacks pins
```
openpyxl
pandas
```
Pin to known-good versions (`openpyxl==3.1.2`, `pandas==2.2.x`) to prevent "works on my machine" when the next LO runs the script in 6 months.

### 17. JSON Schema location mismatch with task doc
Task brief references `public/data/schemas/snapshot.schema.json`; actual file is at `data/snapshot.schema.json` (not served). The current location is correct (the schema is a contract, not a served resource). Just update any README/docs that point to the wrong path.

### 18. `_parse_performance_period` uses `import re` inside the function body
Minor style — hoist to the module header.

### 19. `db/migrations/001_initial_schema.sql` (+612 lines) committed but no consumer references it
The DB migration is referenced in comments but nothing in this PR reads from or writes to a database. Either label it as "Phase 3 preview, not active" in the commit/README, or split it into its own PR. Dropping 612 lines of DDL into a PR that's ostensibly a UI refactor muddies the diff.

### 20. `public/data/snapshots/index.json` has no `updated_at` / `schema_version` validation in the loader
Minor robustness — the types declare those fields required, but `snapshotLoader` doesn't check them. The `sort latest-first` defensive clause is nice; extending the same defensiveness to the top-level index wouldn't cost much.

---

## Positive Observations

- **Clean separation of concerns.** `snapshotLoader.ts` (I/O), `computeData.ts` (pure compute + legacy-shape adapter), `MonthSelector.tsx` (thin UI) — each does one thing. The adapter boundary (`snapshotLoanToParsed`) is exactly the right pattern for this kind of mid-migration refactor: no downstream component had to change.
- **The Excel rip-out is complete.** `parseExcel.ts`, `parseHUD.ts`, `fakeData.ts`, `FileUpload.tsx` are all gone; the `xlsx` runtime dep is removed from `package.json`; `rg parseExcel|parseHUD|FileUpload|fakeData|xlsx src/` returns nothing. The legacy IndexedDB `hud-history` store is retired with a clear comment explaining why. This is a textbook-quality cleanup.
- **Loading + error UX.** `Index.tsx` has a real spinner on cold start, a real error panel with actionable copy ("Check that `public/data/snapshots/index.json` exists…"), and a secondary inline spinner for period switches. Race-safe via the `cancelled` flag. Better than most dashboards ship with.
- **`snapshotLoader.ts` defensive polish.** Handles 404, malformed JSON (separate error), period mismatch, empty index, and BASE_URL subpath deployment. `SnapshotLoadError` is a named class, not a raw `Error`. The period-format regex stops path-injection before fetch. Good instinct; only missing shape validation (Major #6).
- **Pipeline hygiene.** `NOTES.md` is genuinely useful — it documents source-file quirks, the Encompass↔HUD join correctness (100% match on the 490 DQ rows), and known gaps. The RPA-supplied `Risk Indicator Count` is trusted when present and recomputed as a fallback — both paths agree on the 13-flag definition. `_title_case_office` centralizes HUD-office canonicalization. The HOC lookup table is sourced from the SQL DDL, not duplicated ad-hoc.
- **Commit history tells the story.** `feat(data): introduce JSON snapshot data layer` → `fix(snapshot): use LO Employee ID as canonical lo_nmls_id` → `feat(ui): remove Excel upload flow + fake data generator` → `feat(ui): replace Excel upload with snapshot loader + MonthSelector` → `docs(schema): add JSON Schema, pipeline NOTES, and README refresh` → `chore(deps): drop xlsx runtime dependency`. Co-authored by DAEDALUS throughout, which makes attribution clean. Each commit message explains *why*, not just what. A future archaeologist will thank this team.
- **Revised Compare Ratio math is rigorous.** `computeData.ts:computeOffices` correctly removes Enhanced-Guidelines-failing loans from **both** numerator and denominator for the HUD-entry path (the comment "Committee methodology: remove Enhanced Guidelines loans from BOTH numerator (DLQ) AND denominator (total loans UW)" is the right call and matches what the committee spreadsheet does). This is the kind of detail that's easy to get wrong; this code gets it right.
- **Gzipped snapshot is reasonable.** The 19 MB JSON compresses to ~937 KB with gzip (and will do comparably well under brotli). First paint impact is bounded. Azure SWA serves content-encoding by default. The stakeholder call to eat the size until blob storage lands is defensible.
- **`risk_indicator_distribution` sums reconcile.** Sum of `loans_count` across the 14 buckets = 9,400 exactly; sum of `delinquent_count` = 490, matching HUD top-line. Arithmetic integrity throughout.
- **`buildDashboardFromSnapshot` is O(n) over loans.** Quick audit: `computeOffices`, `computeDPAPrograms`, `computeChannelSummary`, `computeFICO`, `computeTrends`, `groupByField` — all single-pass or grouped-then-single-pass. No nested iteration over 9,400 × 512 LOs. Performance is fine.

---

## Risk Register

Things this PR explicitly does not handle and which will need attention before they bite:

1. **Blob storage migration.** The stakeholder-approved plan is to move snapshots to Azure Blob; that PR must also carry the auth story (signed URLs or proxy endpoint). Don't let the "temporary" in-git commit become permanent.
2. **Historical snapshots.** Only Feb 2026 exists. The `buildTrendHistory` function in `Index.tsx` tops up a hardcoded historical seed with the current snapshot — when snapshots accumulate (March, April, …), the overlay logic will start double-counting or drifting against the hardcoded seed. Decide whether the seed shrinks as snapshots land, or whether historical trend comes from a separate endpoint entirely.
3. **LO Employee ID ≠ NMLS ID (see Major #4).** Any compliance / NMLS Consumer Access integration will require a real NMLS lookup. Plan this before someone hands `lo_nmls_id` to an external system.
4. **Portfolio-slices baseline is the snapshot's own overall DQ rate.** That's fine for "how does this bucket compare to company average *this* month" but it is self-referential — it's not a benchmark against FHA market or a time-smoothed AFN average. If the committee asks "how does our 620–659 FICO bucket look vs FHA market?", that's a different baseline you don't have yet.
5. **`reserves_group` Excel-date coercion (Major #5) is a canary.** Excel-column coercion bugs will reappear every month the Encompass export changes. Add a defensive normalization pass + print warnings for any `*_group` column whose value parses as a date.
6. **No CI.** No GitHub Actions workflow exists in this diff (I scanned `.github/` — nothing added). Add lint + typecheck + schema-validation + (eventually) the tests from Major #9 before this repo grows another contributor.
7. **19 MB JSON first-paint cost will degrade on mobile.** ~937 KB gzipped is fine on WiFi; on a 3G committee member phone it's 5–10s. Consider a light `index.json` + lazy-load of `loans[]` when/if blob storage lands.
8. **Single-period UI tested.** `handlePeriodChange` has never run in production — it's dead-code-equivalent until a second snapshot exists. Worth a manual test with two fixture periods before cutover.
9. **Indexed DB `hud-history` legacy store** still exists on users' browsers from old versions. Benign, but document the cleanup path if storage pressure ever matters.
10. **`Loan Officer - Retail` field name is used for both channels.** In `build_loans`, `_clean_str(row.get("Loan Officer - Retail"))` pulls the name regardless of whether the channel is Retail or Wholesale. Verify this is actually populated for wholesale loans; if not, some LO names are null on Wholesale rows.

---

## Merge Recommendation

**Do not merge today.** Before this can be the foundation of the dashboard going forward, Critical #1 (PII exposure on a public URL), Critical #2 (`"NaT"` strings), and Critical #3 (Enhanced-Guidelines false positives on missing FICO) must be resolved. Critical #1 is the real blocker — the other two are small code changes once somebody with Python and test fixtures spends an afternoon on them.

The architectural decision (JSON snapshot layer, committed-to-git temporarily, clean separation between loader / adapter / UI) is correct, the commit history is exemplary, and the Excel rip-out is surgical. Nothing structural needs to change. The gap is between "it works for Matt looking at it locally" and "it's safe to serve to the company Static Web App and hand to the committee." Close that gap — fix the three Critical items, land the Major items #4 (rename `lo_nmls_id`) and #6 (loader schema check), add the two or three tests from #9, regenerate the Feb 2026 snapshot under the fixed pipeline — and this PR becomes a confident approve.

Recommended sequence:
1. Spawn a follow-up sub-task to fix Criticals #1–#3 and Major #4 (`lo_nmls_id` rename is cheap and urgent before anything downstream calcifies).
2. Regenerate `2026-02.json` with the pipeline fixes; verify `NaT` count is 0 and no null-FICO loan is flagged `fails_enhanced_guidelines`.
3. Add the smallest meaningful test set (Major #9).
4. Re-review.

ETA for a clean merge: half a day of focused work.

---

## Review Channels Used

- **Review file:** written to `/home/atlas/.openclaw/workspace/projects/afn-fha-risk-monitor/reviews/PR-1-themis-review.md` ✅
- **GitHub PR review comment:** not posted. `gh` CLI is authenticated as `atlas-clawbot[bot]` with an invalid token; the PAT embedded in `origin` belongs to `atlas-afn-bot` and *could* be used via REST, but per task constraints ATLAS can surface this review to Matt directly. If a PR-native comment is desired, ATLAS can re-dispatch with explicit instruction.
- **No code modified. No merge performed. No history rewritten.**

— THEMIS ⚖️
