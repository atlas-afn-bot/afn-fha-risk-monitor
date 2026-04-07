

## Executive Summary — Compact Collapsible Display

### Problem
The executive summary takes up too much vertical space, pushing the rest of the dashboard content down.

### Solution
Make it a **collapsible card** that shows a compact 1-line overview when collapsed and expands to show all bullets. Additionally, use a **2-column layout** for the bullets when expanded to halve vertical height.

### Changes — `src/components/ExecutiveSummary.tsx`

1. **Add collapsible state** — default to collapsed, with a toggle button (chevron icon).
2. **Collapsed view** — Show only a single-line summary: e.g., "6 offices at termination risk · 28 on credit watch · DPA concentration 48.2%" — the key numbers extracted from the bullets, displayed inline as colored badges.
3. **Expanded view** — Render bullets in a **2-column grid** (`grid-cols-2`) instead of a single list, cutting vertical space in half.
4. **Smooth transition** — Use CSS `max-height` transition or a simple conditional render with an animated chevron.

### Technical Details
- Use `useState<boolean>(false)` for expand/collapse (default collapsed).
- Extract the top 3 key metrics (termination count, credit watch count, DPA concentration) for the collapsed summary line.
- Use `ChevronDown`/`ChevronUp` from lucide-react for the toggle.
- Two-column grid: `grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3`.

