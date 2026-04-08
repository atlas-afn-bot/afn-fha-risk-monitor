# FHA Risk Monitor

Loan-level analytics dashboard for the HUD Compare Ratio Committee at American Financial Network (AFN).

Parses Encompass Neighborhood Watch and HUD Field Offices Excel data to surface termination risk, delinquency trends, and portfolio risk factors — all client-side, no backend required.

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
- **Portfolio Composition** — Standard FHA / DPA / FUEL breakdown with DQ rate comparison
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

## Data Sources

### Required Uploads
1. **Encompass Neighborhood Watch Excel** (~9,400 rows, 167 columns) — Loan-level data
2. **HUD Field Offices Excel** — Office-level compare ratios and area delinquency rates

### Key Encompass Columns Used
| Column | Field | Purpose |
|--------|-------|---------|
| A | DQ | Delinquency flag |
| G | HUD Office | Office grouping |
| J | Loan Info Channel | Retail vs Wholesale |
| R | Loan Program | DPA/FUEL/Standard classification |
| V | Subject Property # Units | Enhanced Guidelines (3-4 unit filter) |
| AF | Gift Fund Amount | Enhanced Guidelines (gift fund restriction) |
| AJ | Payment Shock | Enhanced Guidelines (shock limit) |
| AN | Underwriting Risk Assess Type | Enhanced Guidelines (Manual vs DU/LP) |
| AU | Reserves | Enhanced Guidelines (reserve requirements) |
| AW | DPA Name | DPA provider identification |
| BF | FICO | Credit score analysis |

### Historical Data
Monthly HUD compare ratios are stored in IndexedDB. Each HUD file upload automatically saves a snapshot. Pre-seeded with Jan 2024 — Feb 2026 data.

## Tech Stack

- **React 18** + TypeScript
- **Vite** build system
- **Tailwind CSS** + shadcn/ui components
- **Recharts** for charts
- **SheetJS (xlsx)** for Excel parsing
- **jsPDF** + jspdf-autotable for PDF export
- **IndexedDB** for historical data persistence
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
│   ├── computeData.ts           # All dashboard computations
│   ├── exportPDF.ts             # PDF report generation
│   ├── fakeData.ts              # Synthetic data generator for dev
│   ├── historicalData.ts        # Seed data for trend chart
│   ├── hudHistory.ts            # IndexedDB persistence layer
│   ├── parseExcel.ts            # Encompass Excel parser + Enhanced Guidelines
│   ├── parseHUD.ts              # HUD Field Offices parser
│   └── types.ts                 # TypeScript interfaces
└── pages/
    └── Index.tsx                # Main dashboard page
```

## Roadmap

- [ ] Microsoft SSO (Azure AD) — restrict access to AFN employees
- [ ] Deploy to Azure Static Web Apps or similar
- [ ] Automated monthly data pipeline

---

**Confidential** — Internal use only. Contains proprietary risk analysis methodology.
