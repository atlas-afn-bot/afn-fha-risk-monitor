# PR-2: PDF Cleanup — Twyla's Feedback Pass

## Context

Twyla reviewed the FHA Risk Monitor PDF export and provided 18 distinct feedback items in a Word document (see `projects/afn-fha-risk-monitor/data/committee-review/2026-03-stefanie/Meeting-Notes-5.docx`). Michael (mkunisaki@afncorp.com) triaged these into Tiers 1-4 and provided decisions on each. This PR addresses all in-scope items in a single comprehensive pass.

**Repo:** `/home/atlas/.openclaw/workspace/projects/afn-fha-risk-monitor`
**Base branch:** `main`
**Feature branch:** `feature/pdf-cleanup-twyla`

## Out of scope

- AI Insights panel on PDF (placeholder text — wait until real analysis is wired up)
- PDF chart interactivity (impossible — see #15 for compromise)

---

## Items in scope (18 total)

### 🟢 Tier 1 — Quick fixes (10 items)

**1. Fix blank Total CR slot in PDF header.**
The PDF header currently has a slot intended to display the overall portfolio Total Compare Ratio that's rendering blank. Locate the header rendering in `src/lib/exportPDF.ts` and ensure the Total CR populates from `data.kpis.totalCompareRatio` (or equivalent). Color-code per `crColor()` helper.

**2. Replace top-right "AFN / NMLS #237341" header with "Compare Ratios" label.**
Currently the upper-right corner of the PDF cover/header shows AFN branding text + NMLS number. Twyla wants the simpler context label "Compare Ratios" instead. Find and update.

**3. Remove combined Retail+WS summary tiles from top of PDF.**
Four top-row summary tiles need to be removed:
- Total Loans (combined)
- Overall DQ Rate (combined)
- Termination Risk Offices count
- DPA Portfolio Concentration (combined)

Twyla's reasoning: combining Retail+WS in these tiles hides that the WS channel is the actual problem driver. Per-channel data is shown elsewhere; the combined view is misleading.

**4. Remove the "Credit Watch (19 offices) / DPA Concentration 31.6% / Channel Gap 5.0x" row.**
This horizontal row appears below the top tiles and should be removed entirely. The substantive items (DPA Concentration, Channel Gap) are now part of the upgraded Portfolio Risk Factors section (item #14) — they're not lost, just relocated.

**5. Remove the "HUD Enforcement…" caption above the trend chart.**
Currently `exportPDF.ts:842` (approx) has a hardcoded caption mentioning HUD enforcement thresholds above the trend chart. Remove it. The chart's legend and reference lines are sufficient.

**6. Change "26-MONTH COMPARE RATIO TREND" to "24-MONTH" in the section header.**
The label is hardcoded in `exportPDF.ts` around line 846. Update string only — actual chart data is data-driven and unchanged.

**7. Match PDF trend-chart colors to the dashboard.**
The dashboard `TrendChart.tsx` uses: **Blue=WS, Green=Retail, Black=Overall**. The PDF currently uses: **Red=WS, Green=Retail, Blue=Overall**. Update the PDF to match the dashboard exactly. Find the chart series colors in `exportPDF.ts` (look for the section that draws the trend chart lines/legend).

**8. Add "Total" combined column to Retail vs Wholesale comparison table.**
The table currently shows Retail and WS columns side-by-side. Add a third "Total" column that combines both channels. This applies to the **PDF only** — the dashboard's `ChannelAnalysis.tsx` already has appropriate totals shown elsewhere. Compute totals from existing data fields.

**9. Remove duplicate "Standard FHA DQ Rate" row from Retail vs Wholesale table.**
The table currently has both "Non-DPA DQ Rate" and "Standard FHA DQ Rate" — these are identical metrics with different labels. Remove the "Standard FHA DQ Rate" row (keep "Non-DPA DQ Rate"). **Apply the same fix to the dashboard component `src/components/ChannelAnalysis.tsx`.**

**10. Add "Wholesale has 5.0x the DPA concentration of Retail" callout to the PDF.**
This callout is already present on the dashboard. Add to the PDF in the Retail vs Wholesale comparison area (or wherever the channel gap is most relevant). Use the existing dashboard wording.

---

### 🟡 Tier 2 — Decisions applied (6 items)

**11. Replace "Most FHA loans are FTHB" risk factor with Payment Shock metric.**
The current PDF Portfolio Risk Factors section (and possibly dashboard) lists "Most FHA loans are first-time homebuyers" — Twyla considers this a portfolio-composition fact, not a risk signal.

Replace with a **Payment Shock** risk factor. The data is already computed (`paymentShockGroups` in `computeData.ts`). Surface a metric like "X% of loans show payment shock >50%" or whichever framing matches the existing data structure best. Look at `src/components/RiskFactors.tsx` for how payment shock is computed/displayed on the dashboard side and mirror that.

**12. Add "DPA Defaults at 2.6x standard FHA" Portfolio Risk Factor.**
Add a new risk factor with this exact framing. Compute the multiplier from `dpaPerformance` data — divide the DPA delinquency rate by the non-DPA delinquency rate. If the current data yields a different multiplier (not exactly 2.6x), use the actual computed value (don't hardcode 2.6x).

**13. DTI Backend threshold: change to "55%+ vs 50%+".**
The current DTI Backend comparison uses "50%+ vs <30%" (or similar). Twyla's point: 50% backend is normal on FHA, comparing it to <30% is misleading. Change to comparing **55%+ vs 50%+** to surface the truly problematic tail. Update both PDF and dashboard wherever this comparison appears.

Locate by searching for "DTI" or "Backend" in `RiskFactors.tsx` and `exportPDF.ts`.

**14. Drop the "DPA Program × Investor" entire section from the PDF.**
Twyla considers this section too detailed for a committee-facing PDF. Remove the entire section from the PDF only. **Keep the dashboard's `DPAProgramAnalysis.tsx` component intact and rendering on the web view.**

**15. Rename "DPA Third Party" → "DPA" in Portfolio Composition.**
This appears in `LoanComposition.tsx` (dashboard) and the PDF Portfolio Composition section. Update the label string in both places.

**16. Reconcile watch counts — PDF mirrors the dashboard exactly.**
The overview dashboard shows "19 credit watch" but the PDF shows "8 termination + 10 credit watch" using a stricter filter (>150% AND >100 loans). Michael's directive: **dashboard is law — the PDF must reflect whatever the dashboard is filtering.**

Locate the credit-watch count logic in both `exportPDF.ts` and the dashboard component (likely `ExecutiveSummary.tsx` or similar). Determine which filter the dashboard is using (`offices.filter(...)` predicate) and apply the **identical** predicate in the PDF rendering. Remove any divergent filter logic from the PDF.

---

### 🟠 Tier 3 — Decisions applied (2 items)

**17. Replace existing PDF "Portfolio Risk Factors" section with the dashboard's RiskFactors panel content.**
Twyla referred generically to "Portfolio Risk Factors" — Michael clarified she means the **dashboard's `RiskFactors.tsx` panel** (the live calculated one with CRITICAL / ELEVATED / MODERATE / LOW severity badges, descriptions, and action items). NOT the placeholder `AIInsights.tsx`.

Migrate the dashboard's RiskFactors content into the PDF:
- Same severity classifications (CRITICAL/ELEVATED/MODERATE/LOW)
- Same color coding (red/orange/yellow/blue per severity)
- Each factor: title, severity badge, descriptive sentence, optional action item
- Apply Tier 2 changes #11, #12, #13 (Payment Shock replaces FTHB; DPA 2.6x added; DTI 55% vs 50%) as part of this rebuild

The existing PDF Portfolio Risk Factors section (whatever bullets it currently has) gets replaced wholesale with this dashboard-parity content.

**18. Add data labels to trend chart at key inflection points.**
PDFs cannot be interactive, but we can add static data-value labels at meaningful points on the trend chart:
- The maximum value of each series (peak compare ratio over the period)
- The starting value (left edge)
- The ending value (right edge — most recent month)
- Optional: any month where the WS line crosses 200% or where Retail crosses 150%

Use small text near each point with the numeric value. Keep them readable without crowding the chart. If a particular crossing isn't present in the actual data, skip that label rather than fabricate.

---

### 🔵 Tier 4 — Data quality (1 item)

**19. Use `investor_name` everywhere instead of `dpa_investor`.**
Source data has two investor fields. The current code groups by `dpa_investor`, which is sometimes blank (showing "Unassigned") and sometimes shows internal codes like "AFN" when the actual end-investor is GNMA. Twyla's findings:
- Boost loans show as "AFN" but should be "GNMA" (`dpa_investor='AFN'`, `investor_name='GNMA'`)
- 11 of 20 Texas State Affordable Housing loans show "Unassigned" (`dpa_investor` blank, `investor_name='Lakeview/Bayview'`)
- 2 unassigned at Miami-Dade, 2 at Tennessee Housing — same root cause

**Fix:** Globally swap `dpa_investor` → `investor_name` in:
- `src/lib/computeData.ts` (look for `loan.dpa_investor` references)
- `src/lib/types.ts` (rename the field if exposed in `OfficeSummary` or related types)
- `src/components/DPAProgramAnalysis.tsx` (display labels)
- `src/lib/exportPDF.ts` (any PDF rendering that references investor)
- Any other component that displays investor

If `investor_name` is itself blank for some rows, fall back to a literal "Unassigned" label (don't fall back to `dpa_investor`).

This single change resolves the Boost-as-AFN issue + ~15 unassigned loans across three programs simultaneously.

---

## Validation requirements

- **Build clean:** `npm run build` and `npx tsc --noEmit` both pass
- **PDF generates:** trigger a PDF export from the dashboard (or via a unit/manual test) and verify it produces a non-empty file without runtime errors
- **Dashboard parity items confirmed:**
  - "Standard FHA DQ Rate" duplicate row gone from `ChannelAnalysis.tsx`
  - "DPA Third Party" → "DPA" everywhere
  - DTI threshold updated in both places
  - `investor_name` used everywhere in dashboard components
- **Visual capture:** generate a fresh PDF post-changes and capture the first 2-3 pages as PNG (or attach the PDF) for review in the PR description
- **Screenshot the dashboard side** of the items that changed (Channel Analysis duplicate row, RiskFactors with new payment shock + DPA 2.6x cards, Loan Composition rename)

## Worked example data

For validating math, use the March 2026 snapshot (`public/data/snapshot.json` or wherever the active snapshot lives in this repo). Pick Atlanta as the verification office:
- Should have data for all metrics
- Has both Boost loans (testing investor_name fix) and DPA loans (testing DPA Defaults 2.6x)

## Submission

- Branch: `feature/pdf-cleanup-twyla`
- PR title: "PDF cleanup pass — Twyla's committee feedback"
- PR description must:
  - List the 18 items addressed (use the numbered list above)
  - Note items intentionally NOT done (AI Insights — placeholder; PDF interactivity — impossible)
  - Quote Twyla's email/Word-doc snippets for the relevant decisions where useful
  - Attach before/after screenshots or PDF excerpts
  - Confirm clean build and TypeScript checks
