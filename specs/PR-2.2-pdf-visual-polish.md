# PR-2.2 — PDF Visual Polish (Tier A + B)

**Branch:** `feature/pdf-visual-polish`
**Source PR:** Follow-up to PR-2.1 (`#16`)
**File scope:** primarily `src/lib/exportPDF.ts`. No dashboard changes unless explicitly noted.

## Context

Michael reviewed the actual rendered PDF (`FHA_Risk_Report_2026-05-05 (4).pdf`) emailed from production output. Two clusters of issues — **Tier A (urgent visual breakage)** and **Tier B (polish)** — to be shipped as a single coherent cleanup PR. Tier C items (revert bullets→cards) explicitly **out of scope** per Michael's prior decisions.

This is a **PDF-only** PR. Do not touch `RiskFactors.tsx`, `AIInsights.tsx`, or `ExecutiveSummary.tsx`. Do not touch the dashboard's `CompareRatioCard.tsx` — we're using it as a reference, not modifying it.

---

## TIER A — Urgent Visual Fixes

### A1. Rebuild HUD Compare Ratio card (CRITICAL — visually broken)

**Current bug** (`exportPDF.ts:819-839`):
- Each segment renders the label at `sx + 0` and the value with `align: 'right'` at `sx + 50`. The value's right edge is pinned at `sx + 50`, so the value occupies positions `~30-50pt` of a `~232pt` segment. The other 180pt is empty whitespace.
- Vertically: label at `y + 26`, value at `y + 32` → only **6pt apart**, but value is 15pt font → label/value overlap vertically.
- "Wholesale" gets truncated to "Whole" because the segment's effective container is too narrow.

**Visual symptom in PDF:** `Total147%   Retail94%   Whole179%` jammed into the leftmost portion of each segment, with vertical overlap between labels and values.

**Required fix — mirror the dashboard's `CompareRatioCard.tsx`:**

The dashboard treats this as a **single icon-tile layout**:
- Hero **Total CR** number (large, bold, color-coded by `crColor()`)
- Smaller "Retail X%" and "Wholesale Y%" subtext beneath
- An icon (gauge) on the left
- Single header label "HUD Compare Ratio"

The PDF version should mirror that same hierarchy in landscape page width. Recommended layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  [Gauge icon]  HUD COMPARE RATIO                                │
│                                                                 │
│                147%                                             │
│                Retail 94%   Wholesale 179%                      │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation requirements:**
- Single horizontal card, full `contentW` width (same as today).
- Inner left gutter ~50pt for the icon area (use a colored square with the gauge symbol, OR drop the icon if jsPDF doesn't have a clean way — fine either way).
- "HUD COMPARE RATIO" label at top in 7pt gray, same as today.
- **Hero Total value** (the Total CR): large (24pt), bold, color-coded via `crColor(totalCRVal)`. Position with proper vertical separation from the label (label at `y+14`, hero value at `y+34` minimum — at least 14pt apart so 24pt value doesn't overlap 7pt label).
- **Beneath the hero**, a single line of subtext: `Retail XX%   Wholesale YY%` in 9pt, with the percentage values bolded and color-coded individually via `crColor()`. Use a non-breaking spacer between the two pairs (e.g. 24pt gap).
- Card height grows to ~58-62pt (vs current 42pt) — that's fine; it's the dominant visual element on page 1.
- "Wholesale" label must NOT be truncated. Use `doc.getTextWidth()` to verify if you're worried; the new layout doesn't constrain it anyway.

**Verification:** capture a PDF screenshot at the end and confirm Total/Retail/Wholesale values render with clean vertical hierarchy and no truncation.

---

### A2. Reduce trend chart data labels to peak + end only (per series)

**Current behavior** (`exportPDF.ts:262-322`): each of 3 series labels start, end, peak, **and** threshold crossings (Wholesale crossing 200%, Retail crossing 150%). With 27 months of data and bouncing across thresholds, this produces ~13 labels stacked into the dense areas of the chart, overlapping each other.

**Required fix:**
- Per series, label ONLY:
  - The **end value** (rightmost / most recent month) — keep current behavior, right of dot
  - The **peak value** of that series — keep current behavior, above the point
- **Remove start labels.** They cluster at the left edge with the y-axis tick labels.
- **Remove threshold-crossing labels for Wholesale and Retail series.** They cluster in the middle of the chart and are the source of most overlap noise.
- **Keep the Overall (black) series threshold-crossing labels?** No — remove these too. Just peak + end per series, no threshold labels at all. If Twyla wants threshold callouts back later, we'll add them differently (e.g., a horizontal dashed line at 150% / 200% with a single label on the right edge).

**Net result:** 6 labels instead of 13 (peak + end × 3 series). Chart should read cleanly.

**Implementation hint:** in the existing loop in `exportPDF.ts:262-322`, change `labelIdxs` initialization to `new Set<number>([n - 1, peakIdx])` (drop the `0`), and remove the entire threshold-crossing block (lines ~268-289).

---

### A3. DTI Back-End sort order

**Current** (`exportPDF.ts:693-695`):
```ts
const dtiGroups = [...trends.dtiGroups]
    .sort((a, b) => (parseFloat(a.label) || 0) - (parseFloat(b.label) || 0))
```

The sort uses `parseFloat(label)`. Labels in the data look like `<30%`, `30.01-40%`, `40.01-45%`, `45.01-50%`, `>50%`. `parseFloat('<30%')` returns `NaN` (the `<` prefix kills the parse), so it sorts to `0`. `parseFloat('>50%')` also returns `NaN`. That's why the rendered PDF shows `>50% / <30% / 30.01-40 / 40.01-45 / 45.01-50` — both NaN buckets land first, in their original order.

**Required fix:** sort with a custom comparator that handles `<` and `>` prefixes:
```ts
function dtiSortKey(label: string): number {
  if (label.startsWith('<')) return -1;        // <30 sorts first
  if (label.startsWith('>')) return 999;       // >50 sorts last
  return parseFloat(label) || 0;               // mid-buckets by their lower bound
}
const dtiGroups = [...trends.dtiGroups]
    .sort((a, b) => dtiSortKey(a.label) - dtiSortKey(b.label))
```

**Apply the same fix to LTV groups** (`exportPDF.ts:678-680`). LTV labels likely have the same prefix structure (`<75%`, `95.01-100%`, etc.) and the same NaN bug.

**Apply the same fix to reservesGroups** (`exportPDF.ts:697-699`) — only after applying the bucketing fix in A4 below; if you bucket into named ranges like `0-3 mo`, the sort becomes a manual array order anyway.

---

### A4. Reserves bucket consolidation (10 → 4)

**Current PDF** shows 10 reserves buckets: `0 mo / 1 mo / 2 mo / 3 mo / 4 mo / 5 mo / 6 mo / 7 mo / 8 mo / 9+ mo`. The DQ rate pattern (6.0/6.6/6.2/6.7/5.2/4.6/4.4/5.3/2.6/3.4) is noisy at the per-month level.

**Required fix:** Consolidate into 4 named bands:
- `0-3 mo` — combine months 0, 1, 2, 3
- `4-6 mo` — combine months 4, 5, 6
- `7-9 mo` — combine months 7, 8, 9 (note: includes `9+` from the data; merge it in here)
- `9+ mo` — wait — the data already has a `9+` bucket. So:
  - `0-3 mo` → months 0, 1, 2, 3
  - `4-6 mo` → months 4, 5, 6
  - `7-9 mo` → months 7, 8, 9
  - `9+ mo` → existing `9+` bucket

Actually re-reading: existing data has `0 / 1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9+`. So the merge is:
- `0-3 mo` → 0, 1, 2, 3
- `4-6 mo` → 4, 5, 6
- `7-8 mo` → 7, 8
- `9+ mo` → 9+

(Or: keep just three: `0-3`, `4-7`, `8+` — your call, but 4 buckets is the cleanest committee read.)

**Aggregation requires summing total + dlq across the source buckets, then recomputing dq rate:**
```ts
function bucketReserves(groups: typeof trends.reservesGroups): Array<{ label: string; dqRate: number }> {
  const buckets: Record<string, { total: number; dlq: number }> = {
    '0-3 mo': { total: 0, dlq: 0 },
    '4-6 mo': { total: 0, dlq: 0 },
    '7-8 mo': { total: 0, dlq: 0 },
    '9+ mo':  { total: 0, dlq: 0 },
  };
  for (const g of groups) {
    const n = parseInt(g.label, 10);
    let key: string;
    if (g.label === '9+' || g.label.startsWith('9+')) key = '9+ mo';
    else if (n <= 3) key = '0-3 mo';
    else if (n <= 6) key = '4-6 mo';
    else key = '7-8 mo';
    buckets[key].total += g.total;
    buckets[key].dlq += g.dlq;
  }
  return Object.entries(buckets).map(([label, b]) => ({
    label,
    dqRate: b.total > 0 ? (b.dlq / b.total) * 100 : 0,
  }));
}

const reservesGroups = bucketReserves(trends.reservesGroups);
```

Verify the field names on `reservesGroups` in `types.ts` — if the source uses `loanCount`/`dqCount` instead of `total`/`dlq`, adapt accordingly.

---

### A5. LTV chart x-axis label truncation

**Current PDF:** LTV labels show as `95.01 - ..` (truncated mid-label).

**Required fix:**
- Find the bar-chart label-rendering helper (`drawPDFBarChart` likely).
- For long labels, either:
  - Reduce font size by 1pt when label length > 8 chars
  - Use shorter abbreviations: `95-100%` instead of `95.01-100.00%`, `75-80%` instead of `75.01-80.00%`, etc.

The cleanest option is to **rewrite labels at the data-prep stage**, not in the chart helper. Add a small helper:
```ts
function shortenLTVLabel(label: string): string {
  // "95.01-100.00%" → "95-100%"
  // "75.01-80.00%" → "75-80%"
  return label.replace(/(\d+)\.\d+-(\d+)\.\d+%/, '$1-$2%').replace(/(\d+)\.\d+%/, '$1%');
}
```

Apply at line 679-680:
```ts
const ltvGroups = [...trends.ltvGroups]
    .sort((a, b) => ltvSortKey(a.label) - ltvSortKey(b.label))
    .map(d => ({ label: shortenLTVLabel(d.label || 'Unknown'), value: d.dqRate }));
```

---

### A6. Remove duplicate confidentiality banner

**Current behavior:** `exportPDF.ts:760` renders a `CONF_TEXT` banner at the top of page 1, AND `exportPDF.ts:738-749` renders `FOOTER_CONF` at the bottom. Both contain the full "CONFIDENTIAL - This document contains proprietary information..." paragraph. Duplicated content adds visual noise.

**Required fix:**
- **Keep the footer** (`exportPDF.ts:738-749`) — it's the standard committee-doc location for confidentiality.
- **Remove the top banner** (`exportPDF.ts:786-799` — the red rounded rect with the inline `CONF_TEXT`). Adjust the `y` cursor accordingly so the HUD CR card slides up where the banner used to be (y was 66 pre-banner, becomes 66 — i.e. delete the `y += 28` increment after the removed banner).

Optional minor: if Michael wants a small "CONFIDENTIAL" pill in the top-right corner instead of the full banner, add a 4-letter red badge of width ~50pt. But default to removing entirely.

---

## TIER B — Polish

### B7. Source of Funds → vertical bars (consistency)

**Current** (`exportPDF.ts:672-676`): `drawPDFBarChart(... sourceOfFunds, ..., true)` — the trailing `true` is a `horizontal` flag.

**Required fix:** Change the trailing flag from `true` to `false` (or just omit it). Source of Funds should render as vertical bars to match all other Risk Factor Deep Dive charts. If horizontal was intended because labels are long ("Secured Borrowed", "Borrower Funds", "Gift/Grant"), shorten labels at data-prep:
```ts
const sourceLabels: Record<string, string> = {
  'Secured Borrowed': 'Sec. Borrowed',
  'Borrower Funds': 'Borrower',
  'Gift / Grant': 'Gift/Grant',
};
const sourceOfFunds = [...trends.sourceOfFunds]
    .filter(d => d.total >= 10)
    .sort((a, b) => b.dqRate - a.dqRate)
    .slice(0, 8)
    .map(d => ({ label: sourceLabels[d.label || ''] || d.label || 'Unknown', value: d.dqRate }));
```

---

### B8. Birmingham/Honolulu "0% after removal" footnote treatment

**Current behavior:** When all DLQ loans in a sub-channel get removed by the EG removal logic (e.g. Birmingham retail: 1 DLQ, 1 Removed → 0% revised), the matrix renders a bare `0%` cell. Reads as a possible data bug.

**Required fix:** Add a footnote indicator. Two options — pick one:

**Option B8.a — Asterisk + footnote line:**
- When `revisedRetailDQPct === 0` AND `retailDLQ > 0` (i.e. removal logic zeroed it out), render the cell as `0%*` in italics or with an asterisk superscript.
- Add a single footnote line below the matrix: `* Revised value of 0% indicates all delinquent loans in this sub-channel were removed by EG-eligible adjustments.`

**Option B8.b — Gray-out the value:**
- When the same condition applies, render the value in `GRAY` instead of black/colored.
- No footnote needed if the gray treatment is paired with a small marker.

Default to **Option B8.a** (asterisk). It's more explicit and committee-readable.

**Apply same logic to ALL revised-after-removal cells**, not just retail — Total, Retail, Wholesale all need this treatment. The condition is: revised value is zero AND original DLQ count was nonzero.

**Same logic for "Honolulu 0% Total CR":** check if it's the same removal-zeroed-it-out pattern, or if it's a low-volume (9 loans) noise issue. Look at the data:
```ts
// honolulu: totalLoans=9, totalDLQ=2 (22.22% raw), totalCR=0 (??)
```
Honolulu's Total CR is 0% but SDQ is 22.22%. That's NOT the removal-zeroed-out pattern — that's a CR formula edge case (likely no HUD area peer comparison available for Honolulu). Different bug. Mark it for separate investigation in a comment in the code, but apply the asterisk treatment broadly enough that it covers both cases:
- `if (rev === 0 && origDLQ > 0)` → asterisk for "removal zeroed"
- `if (cr === 0 && sdq > 0)` → asterisk for "no peer comparison"

Or, simpler: **show `0%*` whenever the cell is exactly 0% AND any other adjacent metric in the same row is nonzero**. Catches both cases.

---

### B9. Footer date format alignment

**Current:**
- Header (line 775): `Generated May 5, 2026` (long format)
- Footer (line 754): `Generated 5/5/2026, 3:20:11 PM` (short format with time)

**Required fix:** Make both consistent. Use the **long format with time** in both places:
```ts
const generatedAt = new Date().toLocaleString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});
// Header subParts[0]: `Generated ${generatedAt}`
// Footer right-side: `Generated ${generatedAt} | American Financial Network, Inc. | NMLS #237341`
```

Result: `Generated May 5, 2026, 3:20 PM` in both places.

---

### B10. Low-volume office handling

**Current:** Honolulu (9 loans, 938% CR) and Buffalo (6 retail loans, 520% retail CR) sit alongside 100+ loan offices in the Performance Matrix. Tiny sample sizes produce extreme CRs that distort the visual.

**Required fix:** Add a **low-volume threshold filter** — offices with `totalLoans < 25` get split into a separate "Low-Volume Watch" mini-table below the main Performance Matrix.

Specifically:
1. In the Performance Matrix data prep, partition `data.offices` into:
   - `mainOffices` — `totalLoans >= 25`
   - `lowVolumeOffices` — `totalLoans < 25`
2. Render the main matrix with `mainOffices` only (existing logic, unchanged columns).
3. After the main matrix, if `lowVolumeOffices.length > 0`, render a small section:
   ```
   LOW-VOLUME OFFICES (< 25 loans — sample sizes too small for headline CR comparison)

   ┌─────────────┬─────────┬────────┬─────────┬──────────┐
   │ Office      │ Loans   │ DLQ    │ Total CR│ Note     │
   ├─────────────┼─────────┼────────┼─────────┼──────────┤
   │ Honolulu    │   9     │   2    │  938%   │ Sample   │
   │ Buffalo     │  29     │   3    │  189%   │ Borderline│
   │ ...         │ ...     │ ...    │ ...     │ ...      │
   └─────────────┴─────────┴────────┴─────────┴──────────┘
   ```
4. Section header style: same as other section headers in the PDF (`sectionHeader` helper).

Threshold of `< 25 loans` is a reasonable cutoff for "too small to draw conclusions from." If Michael wants a different threshold (e.g. < 50), make it a single constant at the top of the function so it's easy to tune.

---

### B11. Performance Matrix tightening

**Current:** 27 columns crammed across the page with ~5pt font. Header abbreviations (`R Boost`, `Rev Tot SDQ%`, `Rev Ret CR`) need a legend.

**Required fix:** Add a one-line legend below the Performance Matrix:
```
Legend: SDQ% = Seriously Delinquent %, CR = Compare Ratio, Rev = Revised (post-EG removal),
        R = Retail, WS = Wholesale, Tot = Total. Boost columns show DPA-Boost loans removed by EG logic.
```

Render in 6pt italic gray. Place it directly below the matrix, before the `Low-Volume Watch` section (B10).

Do NOT attempt to reduce column count in this PR. That's a separate PR-3 if Michael wants it. Adding a legend is sufficient for now.

---

## Out of scope for PR-2.2

Explicitly defer these — do NOT touch:
- Reverting bullets→cards for Risk Factors. Michael wants the bullets.
- Dashboard layout changes. PR-2.1 cleaned that up; this is PDF-only.
- Snapshot date footnote (header says Apr 2024 – Mar 2026, trend ends Feb 2026). Defer to a separate clarification with Michael — could be intentional.
- Performance Matrix column reduction. Defer to PR-3 if requested.

---

## Verification checklist

Before opening the PR, run through this:

- [ ] Build passes clean (`npm run build`)
- [ ] Capture a fresh PDF screenshot via the dev server (`npm run dev`, navigate to dashboard, click PDF export).
  - Use Playwright/headless Chrome to load `localhost:5173`, wait for AI cache to populate (or seed `localStorage` directly with a stub), trigger the export button, save the resulting PDF.
  - Convert to image and embed in the PR description.
- [ ] In the captured PDF, verify each Tier A item visually:
  - HUD CR card shows hero Total + Retail/Wholesale subtext, no truncation
  - Trend chart has only ~6 data labels (peak + end × 3 series)
  - DTI Back-End is sorted ascending
  - Reserves shows 4 buckets, not 10
  - LTV labels render fully (no `95.01-..` truncation)
  - Top confidentiality banner is gone, footer banner remains
- [ ] In the captured PDF, verify each Tier B item visually:
  - Source of Funds renders as vertical bars
  - Birmingham/Honolulu zero-rev-after-removal cells show asterisk
  - Header and footer show identical "Generated" dates with time
  - Low-Volume Watch table renders with Honolulu, Buffalo, etc.
  - Performance Matrix has a legend line below it
- [ ] No new TypeScript errors
- [ ] PR description includes before/after screenshots for the HUD CR card specifically (most visible change)

## PR description template

```
PR-2.2: PDF visual polish — Tier A (urgent) + Tier B (polish)

Addresses 11 visual issues found in Michael's review of the rendered PDF
(`FHA_Risk