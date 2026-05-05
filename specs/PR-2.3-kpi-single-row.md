# PR-2.3 — Fit all 5 top-of-page KPIs into a single row

## Context

Currently `exportPDF.ts` renders the top of page 1 as **two rows**:

- Row 1: a full-width `HUD COMPARE RATIO` hero card (cardH = 60pt, contentW = 720pt) with icon gutter, hero Total CR number, and Retail/Wholesale subtext beside each other.
- Row 2: 4 KPI tiles side-by-side (Total Loans, Overall DQ Rate, Termination Risk Offices, DPA Portfolio Conc), kpiH = 44pt.

Michael wants all 5 in **a single row** so the page header is one compact strip — matching the dashboard's `SummaryCards.tsx` which uses `lg:grid-cols-5`.

## Page math

- Letter landscape, `pageW = 792pt`, `margin = 36pt`, **`contentW = 720pt`**
- 5 cards + 4 gaps of 8pt → each card width = `(720 - 32) / 5 = 137.6pt` (call it ~137pt)
- Existing HUD CR card has icon gutter (50pt) + hero number + side-by-side Retail/Wholesale subtext — too wide for 137pt as-is. **Must be redesigned for the narrower footprint.**

## Goals

1. Single row, 5 equal-width cards, total width = `contentW`, gap = 8pt
2. HUD CR card visually distinct (it is the hero metric) but **same height** as the 4 KPI tiles
3. All cards consistent height, label position, value position, padding — no visual stair-stepping
4. No truncation of any value or label

## Implementation requirements

### Card height

Pick a single `cardH` that comfortably fits the HUD CR card's hero + dual-subtext content within 137pt-wide columns. Recommend **`cardH = 56pt`** (between current 44 and 60). DAEDALUS may pick a slightly different value if needed but all 5 cards must share it.

### HUD CR card (now 137pt wide)

Drop the icon gutter to save horizontal real-estate. Layout inside the 137pt card:

- Top: small bold label `HUD COMPARE RATIO` (font 6.5pt, gray, top-left at `+8pt, +12pt` from card origin)
- Middle: hero Total CR value, color-coded (font 18pt bold, left-aligned at `+8pt, +30pt`)
- Bottom: `Retail XX%   Wholesale YY%` on a single line (font 7pt, label gray + value bold/colored). If 7pt is too cramped to fit both pairs in 137pt, **stack them vertically**: Retail line then Wholesale line at 7pt each.
  - First check fit: `Retail 100% Wholesale 100%` at 7pt is ~70pt wide → fits comfortably horizontally on a 137pt card, **prefer the inline single-line layout**.
- Drop the icon box and the `%` glyph. The label `HUD COMPARE RATIO` already conveys what the card is.
- All color logic (`crColor()`) preserved.

### 4 KPI tiles (each 137pt wide)

Existing layout works at this width (label at top, value at +20pt, font 16pt) — no changes needed except aligning padding/font sizes with the new HUD CR card so the row feels uniform. Specifically:

- Same label font size (6.5pt) and position (top-left at `+8pt, +12pt`)
- Same value font size (16pt — keep as-is so the KPIs read as KPIs, not heroes)
- Same `cardH`, same fill color (`LIGHT_GRAY`), same corner radius (3pt)

### HUD CR card must remain visually identifiable as the hero

Even though it's now narrower, it should still feel like the "primary" KPI. Achieve this via:
- **Larger value font** than the others (18pt vs 16pt)
- **Two lines of subtext** (Retail + Wholesale) under the hero, while the KPIs have only their value
- Same fill, no border highlight (avoid making it look outlined). If DAEDALUS judges that 18pt vs 16pt is not enough hierarchy, bump HUD CR to 20pt — but **never make any other card change height**.

## Files to change

- `src/lib/exportPDF.ts` — only this file, only the section starting around line 1018 (HUD CR card) through line 1118 (end of KPI row).

## Out of scope

- Dashboard changes (none — `SummaryCards.tsx` already uses `lg:grid-cols-5`)
- Header above the 5 cards (`HUD FHA NEIGHBORHOOD WATCH ...`) — leave alone
- Anything below the KPI row

## Verification

After build:
1. `npm run build` clean
2. Generate PDF via the existing Playwright capture script (`scripts/capture-pdf.mjs` if it exists, otherwise add equivalent)
3. Visually verify:
   - All 5 cards share a single row
   - HUD CR card on the left, then 4 KPIs in the same order as `SummaryCards.tsx`: Total Loans, Overall DQ Rate, Termination Risk Offices, DPA Portfolio Conc.
   - No truncation of any value or label
   - No vertical misalignment between cards
   - HUD CR card still visually distinct as the hero (larger value, dual-line subtext)

## PR

- Branch: `feature/kpi-single-row`
- Title: `PR-2.3: Fit all 5 top KPIs into a single row`
- Description: Brief summary + before/after screenshot of the new top header.

## Stop and report if you hit

- Total card width pushes 137pt below visual usability — pick a smaller font for HUD CR Retail/Wholesale subtext but **don't crop** any value
- Any need to break the 5-equal-width rule
- Anything that would require dashboard changes
