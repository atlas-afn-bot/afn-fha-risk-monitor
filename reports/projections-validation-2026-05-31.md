# FHA Risk Monitor — Projections Validation Report

**Snapshot period:** May 2026 (2026-05)
**Performance-period end:** 2026-05-31
**Report generated:** 2026-07-01T17:50:45Z
**Prepared for:** Stefanie Allman, Compliance
**Requester:** Michael Kunisaki (mkunisaki@afncorp.com)
**Source:** `scripts/build_projections.py` v1.0

This report validates the loan-level → office → HOC → national projections shipped in the `projections` block of the monthly snapshot JSON. It is intended to be auditable end-to-end: every office-level number can be traced to the underlying loan set and reproduced by hand using the recipe in the Methodology appendix.

---

## Executive Summary

* **Total offices evaluated:** 79
* **Current threshold cohort:** 42 safe / 19 watch / 18 breach
* **Projected 3mo (base) cohort:** 69 safe / 5 watch / 5 breach
* **Projected 3mo (worst) cohort:** 5 safe / 3 watch / 71 breach
* **National 3mo base:** 4.868% dq rate on 8,710 loans (dropoffs: 776)

### Top 5 offices in projected watch/breach at 3-month base scenario

| # | Office | HOC | Loans | Current CR | Projected 3mo CR (base) | Projected Status |
|---|--------|-----|-------|-----------|------------------------|------------------|
| 1 | **Charleston** | Philadelphia | 17 | 388 | 273.9 | BREACH |
| 2 | **Lubbock** | Denver | 27 | 588 | 267.9 | BREACH |
| 3 | **Shreveport** | Denver | 30 | 246 | 228.2 | BREACH |
| 4 | **Oklahoma City** | Denver | 19 | 400 | 228.2 | BREACH |
| 5 | **Atlanta** | Atlanta | 505 | 213 | 203.2 | BREACH |

### Threshold crossings — offices that escalate under any horizon/scenario

_166 crossing events total (across 1/3/6mo × best/base/worst)._ Highest-priority (safe→breach) shown first, capped at 15 rows.

| Office | HOC | Loans | Horizon | Scenario | Current CR | Projected CR | Transition |
|--------|-----|-------|---------|----------|-----------|-------------|-----------|
| **Wilmington** | — | 20 | 6mo | worst | 127 | 382.5 | SAFE → BREACH |
| **Detroit** | Philadelphia | 414 | 6mo | worst | 99 | 356.9 | SAFE → BREACH |
| **Springfield** | Denver | 16 | 1mo | worst | 136 | 352.9 | SAFE → BREACH |
| **Jackson** | Atlanta | 35 | 6mo | worst | 149 | 346.1 | SAFE → BREACH |
| **Spokane** | Santa Ana | 10 | 6mo | worst | 0 | 346.1 | SAFE → BREACH |
| **Sacramento** | Santa Ana | 105 | 6mo | worst | 126 | 335.0 | SAFE → BREACH |
| **Jacksonville** | Atlanta | 364 | 6mo | worst | 125 | 326.3 | SAFE → BREACH |
| **Cincinnati** | Philadelphia | 53 | 6mo | worst | 103 | 323.0 | SAFE → BREACH |
| **Memphis** | Atlanta | 39 | 6mo | worst | 64 | 323.0 | SAFE → BREACH |
| **Grand Rapids** | Philadelphia | 77 | 6mo | worst | 127 | 320.6 | SAFE → BREACH |
| **New York** | Philadelphia | 136 | 6mo | worst | 131 | 318.8 | SAFE → BREACH |
| **Orlando** | Atlanta | 217 | 6mo | worst | 146 | 308.6 | SAFE → BREACH |
| **Washington** | — | 180 | 6mo | worst | 58 | 308.6 | SAFE → BREACH |
| **Wilmington** | — | 20 | 3mo | worst | 127 | 308.1 | SAFE → BREACH |
| **Nashville** | Atlanta | 108 | 6mo | worst | 115 | 306.6 | SAFE → BREACH |

## Per-Office Projected Compare Ratios

Every HUD office in the current window, sorted by projected 3mo/base CR (highest first). Columns:

* **Cur** — Compare Ratio as of the snapshot's performance period.
* **1mo / 3mo / 6mo** — projected Compare Ratio at that horizon.
  Each cell shows `best / base / worst`.
* **N** — loan count in the current 24-month window.
* **Drop 3mo** — loans projected to fall off the office denominator by month 3.
* **Status** — current → projected 3mo/base threshold status.

| Office | HOC | N | Cur | 1mo (best/base/worst) | 3mo (best/base/worst) | 6mo (best/base/worst) | Drop 3mo | Status |
|--------|-----|---|-----|-----------------------|-----------------------|-----------------------|----------|--------|
| Charleston | Philadelphia | 17 | 388 | 221.4 / 221.4 / 442.9 | 273.9 / 273.9 / 410.8 | 346.1 / 346.1 / 519.1 | 2 | BREACH → BREACH |
| Lubbock | Denver | 27 | 588 | 278.8 / 278.8 / 418.3 | 267.9 / 267.9 / 446.6 | 323.0 / 323.0 / 484.5 | 4 | BREACH → BREACH |
| Shreveport | Denver | 30 | 246 | 188.2 / 188.2 / 376.4 | 228.2 / 228.2 / 380.4 | 279.5 / 279.5 / 465.9 | 3 | BREACH → BREACH |
| Oklahoma City | Denver | 19 | 400 | 198.1 / 198.1 / 396.2 | 228.2 / 228.2 / 456.5 | 173.0 / 173.0 / 346.1 | 1 | BREACH → BREACH |
| Atlanta | Atlanta | 505 | 213 | 156.5 / 175.2 / 346.6 | 181.1 / 203.2 / 388.8 | 182.6 / 200.9 / 420.0 | 40 | BREACH → BREACH |
| New Orleans | Denver | 112 | 214 | 168.0 / 184.9 / 352.9 | 174.4 / 193.8 / 387.6 | 188.4 / 215.3 / 430.7 | 6 | BREACH → WATCH |
| Honolulu | Santa Ana | 12 | 423 | 156.8 / 156.8 / 313.7 | 186.7 / 186.7 / 373.5 | 242.3 / 242.3 / 484.5 | 1 | BREACH → WATCH |
| Baltimore | Philadelphia | 193 | 243 | 185.3 / 204.8 / 370.6 | 159.8 / 182.6 / 365.2 | 184.0 / 199.3 / 414.0 | 13 | BREACH → WATCH |
| Birmingham | Atlanta | 132 | 232 | 142.6 / 156.8 / 327.9 | 140.5 / 158.0 / 351.2 | 95.0 / 95.0 / 332.5 | 15 | BREACH → WATCH |
| Tampa | Atlanta | 396 | 190 | 128.3 / 142.6 / 318.4 | 141.1 / 158.0 / 349.9 | 162.5 / 177.3 / 398.8 | 32 | WATCH → WATCH |
| Seattle | Santa Ana | 81 | 211 | 116.2 / 116.2 / 302.1 | 146.7 / 146.7 / 322.8 | 125.3 / 125.3 / 375.9 | 11 | BREACH → SAFE |
| Miami | Atlanta | 265 | 178 | 120.7 / 134.9 / 312.5 | 127.9 / 144.9 / 332.4 | 139.8 / 151.4 / 384.3 | 24 | WATCH → SAFE |
| Fresno | Santa Ana | 124 | 265 | 106.2 / 121.4 / 303.6 | 124.0 / 141.7 / 336.5 | 126.2 / 151.4 / 378.5 | 8 | BREACH → SAFE |
| Philadelphia | Philadelphia | 182 | 188 | 124.1 / 134.4 / 310.2 | 126.8 / 139.5 / 329.7 | 139.4 / 156.9 / 383.4 | 20 | WATCH → SAFE |
| Chicago | Philadelphia | 189 | 159 | 129.5 / 149.4 / 318.7 | 126.0 / 138.6 / 327.7 | 146.8 / 165.2 / 385.4 | 26 | WATCH → SAFE |
| Springfield | Denver | 16 | 136 | 117.6 / 117.6 / 352.9 | 136.9 / 136.9 / 273.9 | 0.0 / 0.0 / 201.9 | 1 | SAFE → SAFE |
| Santa Ana | Santa Ana | 454 | 224 | 120.2 / 132.7 / 306.8 | 116.1 / 131.2 / 323.0 | 116.4 / 130.9 / 363.7 | 47 | BREACH → SAFE |
| Boise | Santa Ana | 18 | 259 | 104.6 / 104.6 / 313.7 | 128.4 / 128.4 / 385.2 | 0.0 / 0.0 / 220.2 | 2 | BREACH → SAFE |
| Buffalo | Philadelphia | 136 | 188 | 96.9 / 110.7 / 290.6 | 110.6 / 126.4 / 316.0 | 90.6 / 90.6 / 317.0 | 6 | WATCH → SAFE |
| Camden | — | 137 | 160 | 109.9 / 123.6 / 302.2 | 97.8 / 114.1 / 309.8 | 114.3 / 114.3 / 342.8 | 11 | WATCH → SAFE |
| Dallas | Denver | 106 | 247 | 124.3 / 142.0 / 319.6 | 114.1 / 114.1 / 296.7 | 61.3 / 61.3 / 306.6 | 16 | BREACH → SAFE |
| Salt Lake City | Denver | 96 | 153 | 98.0 / 98.0 / 274.5 | 112.9 / 112.9 / 316.0 | 125.8 / 125.8 / 346.1 | 5 | WATCH → SAFE |
| Greensboro | Atlanta | 171 | 167 | 88.1 / 99.1 / 275.2 | 97.2 / 111.0 / 305.4 | 99.3 / 99.3 / 337.6 | 23 | WATCH → SAFE |
| Louisville | Atlanta | 65 | 196 | 115.8 / 115.8 / 289.6 | 110.0 / 110.0 / 293.5 | 142.5 / 142.5 / 380.0 | 9 | WATCH → SAFE |
| Minneapolis | Denver | 61 | 175 | 123.4 / 123.4 / 308.5 | 110.0 / 110.0 / 293.5 | 151.4 / 151.4 / 353.3 | 5 | WATCH → SAFE |
| Detroit | Philadelphia | 414 | 99 | 90.9 / 100.0 / 277.3 | 97.1 / 107.8 / 301.9 | 113.9 / 129.1 / 356.9 | 33 | SAFE → SAFE |
| Topeka | — | 86 | 179 | 109.4 / 109.4 / 284.5 | 106.7 / 106.7 / 293.5 | 144.6 / 144.6 / 361.6 | 9 | WATCH → SAFE |
| Orlando | Atlanta | 217 | 146 | 95.4 / 104.1 / 277.6 | 95.3 / 105.9 / 296.5 | 77.1 / 77.1 / 308.6 | 23 | SAFE → SAFE |
| San Antonio | Denver | 104 | 225 | 90.5 / 108.6 / 289.6 | 105.9 / 105.9 / 296.5 | 88.6 / 88.6 / 325.0 | 7 | BREACH → SAFE |
| Wilmington | — | 20 | 127 | 94.1 / 94.1 / 282.3 | 102.7 / 102.7 / 308.1 | 127.5 / 127.5 / 382.5 | 0 | SAFE → SAFE |
| Fort Worth | Denver | 94 | 190 | 100.1 / 100.1 / 280.3 | 99.0 / 99.0 / 297.0 | 35.1 / 35.1 / 280.9 | 11 | WATCH → SAFE |
| New York | Philadelphia | 136 | 131 | 83.0 / 96.9 / 276.8 | 80.9 / 97.1 / 291.2 | 85.0 / 85.0 / 318.8 | 9 | SAFE → SAFE |
| Columbia | Atlanta | 308 | 173 | 97.8 / 110.0 / 287.2 | 87.7 / 95.0 / 292.4 | 66.0 / 75.4 / 311.1 | 27 | WATCH → SAFE |
| Omaha | Denver | 24 | 249 | 156.8 / 156.8 / 313.7 | 93.4 / 93.4 / 280.1 | 115.4 / 115.4 / 346.1 | 2 | BREACH → SAFE |
| Los Angeles | Santa Ana | 248 | 151 | 75.9 / 83.5 / 265.6 | 82.9 / 92.1 / 285.6 | 76.1 / 88.8 / 317.1 | 25 | WATCH → SAFE |
| Pittsburgh | Philadelphia | 50 | 188 | 112.9 / 112.9 / 301.1 | 89.3 / 89.3 / 267.9 | 112.7 / 112.7 / 338.0 | 4 | WATCH → SAFE |
| Cleveland | Philadelphia | 126 | 154 | 89.6 / 104.6 / 283.8 | 88.5 / 88.5 / 283.3 | 96.9 / 96.9 / 339.2 | 10 | WATCH → SAFE |
| Denver | Denver | 81 | 152 | 92.9 / 92.9 / 278.8 | 88.0 / 88.0 / 293.5 | 115.4 / 115.4 / 346.1 | 11 | WATCH → SAFE |
| Phoenix | Santa Ana | 510 | 157 | 81.2 / 88.6 / 269.4 | 77.0 / 85.6 / 282.5 | 78.3 / 89.5 / 324.5 | 30 | WATCH → SAFE |
| Nashville | Atlanta | 108 | 115 | 69.7 / 69.7 / 244.0 | 83.0 / 83.0 / 290.5 | 61.3 / 61.3 / 306.6 | 9 | SAFE → SAFE |
| Sacramento | Santa Ana | 105 | 126 | 71.7 / 71.7 / 251.0 | 81.4 / 81.4 / 284.7 | 103.1 / 103.1 / 335.0 | 4 | SAFE → SAFE |
| Jacksonville | Atlanta | 364 | 125 | 67.2 / 72.4 / 253.4 | 74.5 / 80.7 / 279.3 | 81.6 / 89.7 / 326.3 | 33 | SAFE → SAFE |
| Cincinnati | Philadelphia | 53 | 103 | 71.0 / 71.0 / 248.6 | 80.6 / 80.6 / 282.0 | 107.7 / 107.7 / 323.0 | 2 | SAFE → SAFE |
| San Diego | Santa Ana | 34 | 275 | 110.7 / 110.7 / 276.8 | 76.1 / 76.1 / 304.3 | 105.3 / 105.3 / 316.0 | 7 | BREACH → SAFE |
| Flint | Philadelphia | 34 | 67 | 55.4 / 55.4 / 221.4 | 73.4 / 73.4 / 293.5 | 100.9 / 100.9 / 302.8 | 6 | SAFE → SAFE |
| Las Vegas | Santa Ana | 209 | 116 | 63.0 / 72.0 / 252.2 | 61.0 / 71.2 / 274.6 | 68.8 / 68.8 / 302.8 | 7 | SAFE → SAFE |
| Providence | Philadelphia | 29 | 92 | 64.9 / 64.9 / 259.6 | 70.8 / 70.8 / 283.3 | 0.0 / 0.0 / 230.7 | 0 | SAFE → SAFE |
| Albany | Philadelphia | 64 | 90 | 58.8 / 58.8 / 235.3 | 67.4 / 67.4 / 269.4 | 0.0 / 0.0 / 237.5 | 3 | SAFE → SAFE |
| Boston | Philadelphia | 108 | 117 | 69.7 / 69.7 / 244.0 | 66.3 / 66.3 / 265.1 | 30.7 / 30.7 / 276.0 | 15 | SAFE → SAFE |
| Richmond | Philadelphia | 433 | 96 | 56.5 / 60.9 / 243.4 | 60.3 / 65.3 / 266.2 | 47.5 / 54.3 / 291.8 | 24 | SAFE → SAFE |
| Jackson | Atlanta | 35 | 149 | 107.6 / 107.6 / 268.9 | 64.2 / 64.2 / 256.8 | 86.5 / 86.5 / 346.1 | 3 | SAFE → SAFE |
| Washington | — | 180 | 58 | 52.3 / 52.3 / 240.5 | 58.7 / 58.7 / 258.2 | 77.1 / 77.1 / 308.6 | 5 | SAFE → SAFE |
| Memphis | Atlanta | 39 | 64 | 48.3 / 48.3 / 241.3 | 57.1 / 57.1 / 285.3 | 80.8 / 80.8 / 323.0 | 3 | SAFE → SAFE |
| Tucson | Santa Ana | 40 | 167 | 94.1 / 94.1 / 282.3 | 55.5 / 55.5 / 277.6 | 83.5 / 83.5 / 334.1 | 3 | WATCH → SAFE |
| Grand Rapids | Philadelphia | 77 | 127 | 97.8 / 97.8 / 268.9 | 55.5 / 55.5 / 249.8 | 71.3 / 71.3 / 320.6 | 3 | SAFE → SAFE |
| Hartford | Philadelphia | 40 | 64 | 47.1 / 47.1 / 235.3 | 52.7 / 52.7 / 263.4 | 73.4 / 73.4 / 293.6 | 1 | SAFE → SAFE |
| Portland | Santa Ana | 135 | 215 | 83.7 / 97.6 / 278.8 | 49.7 / 49.7 / 248.5 | 44.9 / 44.9 / 291.6 | 11 | BREACH → SAFE |
| Indianapolis | Philadelphia | 292 | 84 | 51.6 / 58.0 / 238.5 | 37.8 / 45.3 / 249.2 | 41.6 / 41.6 / 280.7 | 20 | SAFE → SAFE |
| Milwaukee | Philadelphia | 103 | 90 | 54.8 / 54.8 / 237.6 | 43.7 / 43.7 / 240.4 | 66.4 / 66.4 / 298.7 | 9 | SAFE → SAFE |
| St Louis | — | 54 | 51 | 34.9 / 34.9 / 209.1 | 39.5 / 39.5 / 237.0 | 50.5 / 50.5 / 302.8 | 2 | SAFE → SAFE |
| Houston | Denver | 228 | 83 | 41.3 / 49.5 / 231.1 | 38.4 / 38.4 / 240.0 | 37.5 / 37.5 / 274.7 | 14 | SAFE → SAFE |
| Kansas City | Denver | 70 | 86 | 53.8 / 53.8 / 242.0 | 33.1 / 33.1 / 231.9 | 41.8 / 41.8 / 292.4 | 8 | SAFE → SAFE |
| Tulsa | Denver | 99 | 62 | 38.0 / 38.0 / 228.1 | 22.3 / 22.3 / 223.3 | 0.0 / 0.0 / 230.7 | 7 | SAFE → SAFE |
| Knoxville | Atlanta | 158 | 23 | 11.9 / 11.9 / 202.5 | 14.2 / 14.2 / 212.5 | 19.5 / 19.5 / 254.0 | 13 | SAFE → SAFE |
| Little Rock | Denver | 42 | 74 | 44.8 / 44.8 / 224.1 | 0.0 / 0.0 / 205.4 | 0.0 / 0.0 / 261.9 | 2 | SAFE → SAFE |
| Anchorage | Santa Ana | 2 | 0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0 | SAFE → SAFE |
| Des Moines | Denver | 10 | 0 | 0.0 / 0.0 / 188.2 | 0.0 / 0.0 / 228.2 | 0.0 / 0.0 / 269.2 | 1 | SAFE → SAFE |
| San Francisco | Santa Ana | 45 | 0 | 0.0 / 0.0 / 167.3 | 0.0 / 0.0 / 186.7 | 0.0 / 0.0 / 255.0 | 1 | SAFE → SAFE |
| Bangor | Philadelphia | 7 | 0 | 0.0 / 0.0 / 268.9 | 0.0 / 0.0 / 293.5 | 0.0 / 0.0 / 0.0 | 0 | SAFE → SAFE |
| Helena | Denver | 2 | 0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0 | SAFE → SAFE |
| Reno | Santa Ana | 46 | 0 | 0.0 / 0.0 / 204.6 | 0.0 / 0.0 / 191.1 | 0.0 / 0.0 / 248.5 | 3 | SAFE → SAFE |
| Manchester | Philadelphia | 1 | 0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0 | SAFE → SAFE |
| Newark | Philadelphia | 143 | 21 | 13.2 / 13.2 / 197.4 | 0.0 / 0.0 / 207.0 | 0.0 / 0.0 / 235.8 | 14 | SAFE → SAFE |
| Albuquerque | Denver | 49 | 0 | 0.0 / 0.0 / 192.1 | 0.0 / 0.0 / 182.6 | 0.0 / 0.0 / 269.2 | 4 | SAFE → SAFE |
| Fargo | Denver | 2 | 0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0 | SAFE → SAFE |
| Columbus | Philadelphia | 65 | 0 | 0.0 / 0.0 / 173.7 | 0.0 / 0.0 / 205.4 | 0.0 / 0.0 / 264.3 | 5 | SAFE → SAFE |
| Sioux Falls | Denver | 2 | 0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0.0 / 0.0 / 0.0 | 0 | SAFE → SAFE |
| Spokane | Santa Ana | 10 | 0 | 0.0 / 0.0 / 188.2 | 0.0 / 0.0 / 256.8 | 0.0 / 0.0 / 346.1 | 2 | SAFE → SAFE |
| Casper | Denver | 7 | 0 | 0.0 / 0.0 / 268.9 | 0.0 / 0.0 / 293.5 | 0.0 / 0.0 / 0.0 | 0 | SAFE → SAFE |

## Methodology Appendix

Every number in this report is computed at the individual loan level, then aggregated up to office, HOC, and national roll-ups. There are no office-level estimates that a hand-check against Encompass could not reproduce.

### 1. HUD 24-month window

HUD reports each month with a rolling 24-month window of "beginning amortization dates" (first-payment dates) ending at `performance_period` = **2026-05-31**.

For a projection **H** months forward, the new window-start is:

```
cutoff_H = (performance_period + 1 day) - (24 - H) months
```

A loan is projected to fall off the denominator at horizon H iff its `first_payment_date` is strictly less than `cutoff_H`. Loans without a parseable `first_payment_date` are assumed to remain in-window — this matches the current UI (`rollforwardWindowStart` in `src/lib/computeData.ts`) and is deliberately conservative: missing data never shrinks a denominator.

### 2. Scenarios — ±10% office-side delinquency lever

The stress factor is **10%** (Michael Kunisaki's decision, task-spec §Michael's Decisions #3). It is an **office-side stress**: national delinquency rate stays at the base-scenario projection at each horizon and serves as the fixed reference denominator for the Compare Ratio.

| Scenario | Office numerator | Denominator | Semantics |
|----------|------------------|-------------|-----------|
| `base`  | Loans in-window that are currently delinquent | Loans still in-window at horizon | No delinquency change; only window rolls forward. |
| `worst` | base numerator + round(0.10 × in-window non-DQ) | Same as base | +10% of the office's still-in-window, currently-non-DQ loans become DQ. |
| `best`  | base numerator − round(0.10 × in-window DQ), floored at 0 | Same as base | −10% of the office's currently-DQ, still-in-window loans cure. |

**National reference policy:** national delinquency rate is fixed at the BASE-scenario projection for each horizon across all three scenarios (best/base/worst). The ±10% lever is applied office-side only, so 'worst' reflects a genuine worst-case for that office against a stable peer.

### 3. Compare Ratio formula

```
office_projected_delinquency_rate    = office_num_at_horizon / office_den_at_horizon
national_projected_delinquency_rate  = national_base_num_at_horizon / national_base_den_at_horizon
projected_compare_ratio              = (office_dq_rate / national_dq_rate) * 100
```

Numerator and denominator both use the same rolled-forward loan population — no mismatched windows. Ratios are rounded to one decimal place at the report boundary; internal math stays in double precision.

### 4. Threshold classification

* `safe`   → CR < 150
* `watch`  → 150 ≤ CR < 200
* `breach` → CR ≥ 200

A **threshold crossing** is any transition where the current status is strictly less severe than the projected status under some horizon/scenario. Specifically: safe→watch, safe→breach, or watch→breach. Watch→watch or breach→breach at a lower projected CR are still worth noting but are reported in the Per-Office table rather than the crossings summary.

### 5. Reproducibility recipe (hand-checkable, one office)

For any office in the Per-Office table, follow these steps against the Encompass source data used by `build-snapshot.py`:

1. Filter loans to that HUD office.
2. Split into (a) still-in-window at horizon H (first_payment_date ≥ cutoff_H) and (b) dropping off.
3. Under **base**: numerator = count of still-in-window loans where `is_delinquent = true`; denominator = |(a)|.
4. Under **worst**: numerator = base numerator + round(0.10 × |non-DQ in (a)|); denominator unchanged.
5. Under **best**: numerator = base numerator − round(0.10 × |DQ in (a)|), floored at 0.
6. Compare Ratio = office_dq_rate / national_base_dq_rate × 100 (national values in the report tables).

## Sample Loan-Level Detail — Top Flagged Offices

Every loan underlying the highest-projected offices, so a Compliance review can spot-check against Encompass. Loans are grouped by office and sorted by `months_until_falls_off` (ascending — loans closest to dropping off the window first).

### Charleston (HOC Philadelphia)

* Current loans in window: **17** — currently delinquent: 2
* Current Compare Ratio: **388**  → 3mo/base: **273.9**
* Projected drop-offs by 3mo: **2** (15 still in window)

| Loan ID | FHA Case # | FPDD | Mo. until off-window | Currently DQ | Falls off 1mo | Falls off 3mo | Falls off 6mo | DQ status |
|---------|-----------|------|---------------------|--------------|---------------|---------------|---------------|-----------|
| `26100015661` | 571-1881111 | 2024-07-01 | 2 | — | — | ✓ | ✓ | — |
| `90580016009` | 571-1886125 | 2024-08-01 | 3 | — | — | ✓ | ✓ | — |
| `26000015634` | 571-1883027 | 2024-11-01 | 6 | — | — | — | ✓ | — |
| `88590044754` | 571-1911446 | 2024-12-01 | 7 | ✓ | — | — | — | Chapter 13 Bankruptcy |
| `26100044313` | 571-1911895 | 2024-12-01 | 7 | ✓ | — | — | — | — |
| `90070039362` | 571-1911498 | 2025-02-01 | 9 | — | — | — | — | — |
| `26100063553` | 571-1932388 | 2025-03-01 | 10 | — | — | — | — | — |
| `91530072225` | 571-1943846 | 2025-06-01 | 13 | — | — | — | — | — |
| `87150093850` | 571-1957999 | 2025-09-01 | 16 | — | — | — | — | — |
| `91040099580` | 571-1971672 | 2025-10-01 | 17 | — | — | — | — | — |
| `91530104206` | 571-1974259 | 2025-11-01 | 18 | — | — | — | — | — |
| `26100118561` | 571-1992223 | 2026-01-01 | 20 | — | — | — | — | — |
| `26000126951` | 571-2000970 | 2026-03-01 | 22 | — | — | — | — | — |
| `55210128953` | 571-2001555 | 2026-03-01 | 22 | — | — | — | — | — |
| `26300113407` | 571-2014332 | 2026-06-01 | 25 | — | — | — | — | — |
| `26100138920` | 571-2015596 | 2026-06-01 | 25 | — | — | — | — | — |
| `95150142653` | 571-2020648 | 2026-06-01 | 25 | — | — | — | — | — |

### Lubbock (HOC Denver)

* Current loans in window: **27** — currently delinquent: 4
* Current Compare Ratio: **588**  → 3mo/base: **267.9**
* Projected drop-offs by 3mo: **4** (23 still in window)

| Loan ID | FHA Case # | FPDD | Mo. until off-window | Currently DQ | Falls off 1mo | Falls off 3mo | Falls off 6mo | DQ status |
|---------|-----------|------|---------------------|--------------|---------------|---------------|---------------|-----------|
| `90960021950` | 494-5414194 | 2024-07-01 | 2 | ✓ | — | ✓ | ✓ | Loss Mitigation Option Failure |
| `90960011816` | 494-5413097 | 2024-08-01 | 3 | — | — | ✓ | ✓ | — |
| `26100026794` | 494-5426236 | 2024-08-01 | 3 | — | — | ✓ | ✓ | — |
| `90960023438` | 494-5427940 | 2024-08-01 | 3 | — | — | ✓ | ✓ | — |
| `26100028238` | 494-5428482 | 2024-09-01 | 4 | — | — | — | ✓ | — |
| `90960016418` | 494-5429068 | 2024-09-01 | 4 | — | — | — | ✓ | — |
| `26100032403` | 494-5436466 | 2024-09-01 | 4 | — | — | — | ✓ | — |
| `90960032148` | 494-5436495 | 2024-09-01 | 4 | — | — | — | ✓ | — |
| `86220034390` | 494-5440136 | 2024-09-01 | 4 | — | — | — | ✓ | — |
| `26000035003` | 494-5443966 | 2024-11-01 | 6 | — | — | — | ✓ | — |
| `26100041127` | 494-5452309 | 2024-11-01 | 6 | — | — | — | ✓ | — |
| `26100042727` | 494-5456336 | 2024-11-01 | 6 | ✓ | — | — | ✓ | — |
| `26000051474` | 494-5469855 | 2025-02-01 | 9 | — | — | — | — | — |
| `26100062234` | 494-5493746 | 2025-03-01 | 10 | ✓ | — | — | — | — |
| `26100068102` | 494-5506016 | 2025-05-01 | 12 | — | — | — | — | — |
| `26000068264` | 494-5508929 | 2025-05-01 | 12 | — | — | — | — | — |
| `26000073451` | 494-5519872 | 2025-06-01 | 13 | ✓ | — | — | — | — |
| `26100076941` | 494-5525096 | 2025-06-01 | 13 | — | — | — | — | — |
| `26200058099` | 494-5529046 | 2025-06-01 | 13 | — | — | — | — | — |
| `26000078653` | 494-5532249 | 2025-06-01 | 13 | — | — | — | — | — |
| `26100082096` | 494-5537824 | 2025-07-01 | 14 | — | — | — | — | — |
| `26000084918` | 494-5544037 | 2025-07-01 | 14 | — | — | — | — | — |
| `26100101792` | 494-5575431 | 2025-10-01 | 17 | — | — | — | — | — |
| `26100102042` | 494-5576210 | 2025-10-01 | 17 | — | — | — | — | — |
| `26000095010` | 494-5564406 | 2025-11-01 | 18 | — | — | — | — | — |
| `26000104400` | 494-5581994 | 2025-11-01 | 18 | — | — | — | — | — |
| `26200102313` | 494-5585950 | 2025-11-01 | 18 | — | — | — | — | — |

### Shreveport (HOC Denver)

* Current loans in window: **30** — currently delinquent: 3
* Current Compare Ratio: **246**  → 3mo/base: **228.2**
* Projected drop-offs by 3mo: **3** (27 still in window)

| Loan ID | FHA Case # | FPDD | Mo. until off-window | Currently DQ | Falls off 1mo | Falls off 3mo | Falls off 6mo | DQ status |
|---------|-----------|------|---------------------|--------------|---------------|---------------|---------------|-----------|
| `8859966531` | 222-2551157 | 2024-07-01 | 2 | — | — | ✓ | ✓ | — |
| `26200005353` | 222-2557347 | 2024-08-01 | 3 | — | — | ✓ | ✓ | — |
| `26200004909` | 222-2557484 | 2024-08-01 | 3 | — | — | ✓ | ✓ | — |
| `26200010805` | 222-2561154 | 2024-09-01 | 4 | — | — | — | ✓ | — |
| `10010047216` | 222-2569809 | 2024-12-01 | 7 | — | — | — | — | — |
| `26200038246` | 222-2567380 | 2025-01-01 | 8 | — | — | — | — | — |
| `26200045375` | 222-2578070 | 2025-02-01 | 9 | — | — | — | — | — |
| `91370063989` | 222-2582653 | 2025-04-01 | 11 | — | — | — | — | — |
| `26000062435` | 222-2583490 | 2025-05-01 | 12 | — | — | — | — | — |
| `26000072989` | 222-2583613 | 2025-05-01 | 12 | ✓ | — | — | — | — |
| `26200070501` | 222-2590252 | 2025-06-01 | 13 | ✓ | — | — | — | — |
| `80110084789` | 222-2577676 | 2025-07-01 | 14 | — | — | — | — | — |
| `26100080388` | 222-2592700 | 2025-07-01 | 14 | — | — | — | — | — |
| `26100082102` | 222-2594441 | 2025-08-01 | 15 | ✓ | — | — | — | — |
| `26200080416` | 222-2594429 | 2025-09-01 | 16 | — | — | — | — | — |
| `26200086104` | 222-2598387 | 2025-09-01 | 16 | — | — | — | — | — |
| `26200090219` | 222-2603073 | 2025-09-01 | 16 | — | — | — | — | — |
| `26200090222` | 222-2603082 | 2025-09-01 | 16 | — | — | — | — | — |
| `26200090446` | 222-2603890 | 2025-09-01 | 16 | — | — | — | — | — |
| `26000109519` | 222-2609733 | 2025-12-01 | 19 | — | — | — | — | — |
| `26000114152` | 222-2615614 | 2025-12-01 | 19 | — | — | — | — | — |
| `26000115002` | 222-2616372 | 2025-12-01 | 19 | — | — | — | — | — |
| `26300112961` | 222-2620395 | 2026-01-01 | 20 | — | — | — | — | — |
| `26000109292` | 222-2612886 | 2026-02-01 | 21 | — | — | — | — | — |
| `26300112985` | 222-2623294 | 2026-02-01 | 21 | — | — | — | — | — |
| `26200114220` | 222-2619803 | 2026-04-01 | 23 | — | — | — | — | — |
| `26300113157` | 222-2628017 | 2026-04-01 | 23 | — | — | — | — | — |
| `88590140530` | 222-2631425 | 2026-05-01 | 24 | — | — | — | — | — |
| `26300113255` | 222-2630266 | 2026-06-01 | 25 | — | — | — | — | — |
| `26300118581` | 222-2638180 | 2026-06-01 | 25 | — | — | — | — | — |
