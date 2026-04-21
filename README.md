# FHA Risk Monitor

Loan-level analytics dashboard for the HUD Compare Ratio Committee at American Financial Network (AFN).

Consumes pre-built monthly JSON snapshots (committed under `public/data/snapshots/`) to surface termination risk, delinquency trends, and portfolio risk factors. Snapshots are synthesized from six source Excel files by `scripts/build-snapshot.py` and served as static assets — no backend required at runtime.

## Features

### Core Analytics
- **Termination Risk Performance Matrix** — Full committee-format table with compare ratios, DLQ breakdown by channel × program type, Enhanced Guidelines removals, revised ratios, and DPA concentration
- **Credit Watch Matrix** — Top priority offices (≥100 loans) + remaining credit watch with simplified view
- **Executive Summary** — Structured three-section layout: office risk cards, key metric cards, AI-generated portfolio risk factor analysis
- **Action Items** — Staff items + AI-generated recommendations with category tags (Immediate/Monitor/Strategic)

### Enhanced Guidelines Engine
Automatically identifies delinquent Boost DPA loans that would not have been originated under enhanced underwriting guidelines:
- Min FICO 640
- 3-4 unit properties excluded
- Reserve requirements by AUS type and FICO band
- Gift fund restrictions
- Payment shock limits for manual UW

### Charts & Analysis
- **26-Month Compare Ratio Trend** — Historical Overall/Retail/Wholesale CRs with persistence (IndexedDB)
- **Portfolio Composition** — Standard FHA / DPA breakdown with DQ rate comparison (Retail vs Wholesale shown in Channel Analysis)
- **DPA Provider Performance** — Tiered risk view (High Risk / Watch / Performing) with search and inline DQ bars
- **Channel Analysis** — Retail vs Wholesale side-by-side risk comparison
- **FICO Distribution** — DQ rates by FICO band across program types
- **HUD Office Concentration** — Stacked bar chart with adjustable loan count threshold

### AI Integration
- Azure OpenAI (GPT-4) generates executive summary insights and action items from portfolio data
- Analyzes 10+ risk dimensions: Source of Funds, Manual UW, FTHB, risk layering, reserves, DTI, LTV, payment shock, FICO, gift/grant funding
- Auto-generates on data load — no manual trigger needed

### Export
- **PDF Export** — Full committee-format report with trend chart, performance matrices, executive summary, channel comparison, DPA providers, portfolio composition, and action items
- **CSV Export** — Per-table CSV downloads

## Data Pipeline

### Architecture
The dashboard does **not** parse Excel at runtime. Each month, the RPA process writes six HUD / Encompass `.xlsx` files into `data/source/{YYYY-MM}/`; the Python build script consumes them and emits a single JSON snapshot under `public/data/snapshots/{YYYY-MM}.json` (plus an updated `index.json`). The dashboard fetches that JSON on page load.

Snapshots are committed to the repo today. A follow-up PR will move them to Azure Blob Storage.

### Source files (per period)
1. `HUD Total Compare Ratios *.xlsx` — nationwide Total / Retail / Sponsor KPIs
2. `HOC Compare Ratios - *.xlsx` — the 4 HUD Homeownership Centers
3. `HUD Field Offices - *.xlsx` — ~80 HUD offices with compare ratios + area DQ
4. `HUD Branches - *.xlsx` — ~90 NMLS-level branches with approval status
5. `NW Data *.xlsx` — HUD's seriously-delinquent list (joinable by Case Number)
6. `Neighborhood Watch Report <period> Feb Enc Data.xlsx` — full Encompass export (~9,400 loans × 168 columns)

Raw source files are **gitignored** (customer data). Do not commit them.

### Target JSON shape
One file per period under `public/data/snapshots/`, matching
[`src/types/snapshot.ts`](./src/types/snapshot.ts) and validated by
[`data/snapshot.schema.json`](./data/snapshot.schema.json). The shape mirrors
the SQL DDL at [`db/migrations/001_initial_schema.sql`](./db/migrations/001_initial_schema.sql)
one-to-one (8 fact collections + meta).

### How to build a new snapshot

```bash
# 1. Drop the month's 6 .xlsx files into data/source/<YYYY-MM>/
#    (mkdir -p data/source/2026-03)

# 2. Install Python deps (one-time)
pip install -r scripts/requirements.txt
# → pandas, openpyxl

# 3. Build the snapshot JSON
python3 scripts/build-snapshot.py 2026-03

# This produces:
#   public/data/snapshots/2026-03.json       (one per period, ~14 MB)
#   public/data/snapshots/index.json         (updated — lists all periods)

# 4. Commit the new JSON + updated index; DO NOT commit data/source/*.xlsx
git add public/data/snapshots/2026-03.json public/data/snapshots/index.json
git commit -m "data: add 2026-03 snapshot"

# 5. Verify locally
npm run dev
# The month selector in the dashboard header should show the new period.
```

The script is **idempotent** — rerunning overwrites the snapshot cleanly.
If field mappings or bucket boundaries need to change, edit
`scripts/build-snapshot.py` and rerun.

### Historical trend data
Hardcoded values for Jan 2024 through the previous month live in
`src/lib/historicalData.ts`. They're overlaid on the current snapshot's
top-line compare ratios to render the 26-month trend chart.

## Tech Stack

- **React 18** + TypeScript
- **Vite** build system
- **Tailwind CSS** + shadcn/ui components
- **Recharts** for charts
- **JSON snapshots** served as static assets (`public/data/snapshots/`)
- **Python + pandas + openpyxl** for the offline synthesis pipeline
- **jsPDF** + jspdf-autotable for PDF export
- **IndexedDB** for action-item persistence
- **Azure OpenAI** for AI analysis

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Configuration

### Azure OpenAI
The AI analysis endpoint is configured in `src/lib/aiAnalysis.ts`. Update the endpoint, deployment name, and API key for your Azure OpenAI instance.

### Historical Data
Pre-seeded data lives in `src/lib/historicalData.ts`. On first load, it populates IndexedDB. Subsequent HUD uploads add/update monthly snapshots automatically.

## Project Structure

```
src/
├── components/
│   ├── ActionItems.tsx          # Staff + AI action items with categories
│   ├── ChannelAnalysis.tsx      # Retail vs Wholesale comparison
│   ├── CreditWatchSimple.tsx    # Credit watch office tables
│   ├── DPAProviderTable.tsx     # Tiered DPA provider analysis
│   ├── ExecutiveSummary.tsx     # Three-section executive summary
│   ├── FICODistribution.tsx     # FICO band DQ analysis
│   ├── FileUpload.tsx           # Drag-and-drop file upload
│   ├── HUDConcentration.tsx     # Office DPA concentration chart
│   ├── PerformanceMatrix.tsx    # Termination risk matrix
│   ├── PortfolioComposition.tsx # Program type breakdown
│   ├── SummaryCards.tsx         # Top-level KPI cards
│   └── TrendChart.tsx           # Historical CR trend line
├── lib/
│   ├── aiAnalysis.ts            # Azure OpenAI integration
│   ├── computeData.ts           # Snapshot → dashboard data adapter
│   ├── exportPDF.ts             # PDF report generation
│   ├── historicalData.ts        # Seed data for trend chart
│   ├── hudHistory.ts            # HUD snapshot type for trend chart
│   ├── snapshotLoader.ts        # Fetch + validate monthly JSON snapshots
│   └── types.ts                 # Legacy dashboard view-model types
├── pages/
│   └── Index.tsx                # Main dashboard page
└── types/
    └── snapshot.ts              # Snapshot contract (mirrors SQL + JSON Schema)

scripts/
└── build-snapshot.py            # Python synthesis: 6 .xlsx → 1 snapshot JSON

data/
├── schema.md                    # Human-readable snapshot schema docs
├── snapshot.schema.json         # JSON Schema for validation
└── source/<YYYY-MM>/            # Raw monthly .xlsx inputs (gitignored)

db/migrations/
└── 001_initial_schema.sql       # SQL DDL (future state — blob → SQL)

public/data/snapshots/
├── index.json                   # List of available periods
└── <YYYY-MM>.json               # One per period — ~14 MB each
```

## Roadmap

- [ ] Move snapshots to Azure Blob Storage (currently committed to repo)
- [ ] Automate monthly snapshot build via GitHub Action when RPA drops files
- [ ] Loan Officer Leaderboard view wired to `loan_officer_performance`
- [ ] Microsoft SSO (Azure AD) — restrict access to AFN employees

---

**Confidential** — Internal use only. Contains proprietary risk analysis methodology.
