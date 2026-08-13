export interface LoanRecord {
  /** Encompass loan number, e.g. "91240030846" — 11 digits. */
  LoanNumber: string;
  /** HUD-assigned FHA case number, e.g. "013-0390395". Nullable — not every loan has one assigned yet. */
  FHACaseNumber: string | null;
  DQ: string;
  HUDOffice: string;
  HUDOfficeCR: number;
  Channel: string;
  LoanProgram: string;
  /**
   * Raw DPA Name from Neighborhood Watch export.
   *
   * NOTE: Kept for raw storage / debugging only. DPA Name is too granular to
   * drive analytics (e.g. "Boost FHA Loan Program", "Boost 3.5% Repayable DPA
   * Program", and "AFN Boost 3.5% Repayable" all describe the same program).
   * All aggregations and displays must key on {@link DPAProgram} and
   * {@link DPAInvestor} instead.
   */
  DPAName: string;
  /** High-level DPA program bucket ("Boost", "Arrive/Aurora", "Non-DPA"). */
  DPAProgram: string;
  /**
   * End-investor / funding source — sourced from the loan's `investor_name`
   * field (e.g. "GNMA", "Lakeview/Bayview"). Previously this was sourced
   * from `dpa_investor`, but that column carries internal codes ("AFN" for
   * Boost loans whose true investor is GNMA) and is blank for the majority
   * of loans. `investor_name` is what the committee uses; downstream
   * displays fall back to "Unassigned" when this is blank.
   */
  DPAInvestor: string;
  FICO: number;
  Units: string;
  AUSType: string;
  ReserveMonths: number;
  GiftFunds: string;
  PaymentShock: number;
  // Trend analysis fields
  LTVGroup: string;
  FTHB: string;
  DTIBackEndGroup: string;
  PaymentShockGroup: string;
  SourceOfFundsGroup: string;
  ReservesGroup: string;
  RiskIndicatorCount: number;
  GiftGrantGroup: string;
  /** Loan was underwritten manually (baked from snapshot's has_manual_uw flag). */
  HasManualUW: boolean;
  /** Loan used gift or grant funds (baked from snapshot's has_gift_grant flag). */
  HasGiftGrant: boolean;
}

export type ProgramType = 'DPA' | 'Standard';
export type ChannelType = 'Retail' | 'Wholesale' | 'Unknown';

export interface ParsedLoan extends LoanRecord {
  isDelinquent: boolean;
  programType: ProgramType;
  channelType: ChannelType;
  isDPA: boolean;
  isBoost: boolean;
  /** Would this loan have been filtered out by Enhanced Guidelines? */
  failsEnhancedGuidelines: boolean;
  /**
   * ISO `YYYY-MM-DD` First Payment Date from Encompass Data Tab column BB.
   * `null` when missing or unparseable. Drives the Proposed Drop-Off (Next
   * 3 Mo) column on the Term + Credit Watch tables: loans whose first
   * payment is older than the rolled-forward HUD 24-month window are
   * projected to drop off the office's underwriting denominator.
   */
  firstPaymentDate: string | null;
}

export interface OfficeSummary {
  name: string;
  totalCR: number;
  retailCR: number | null;
  wsCR: number | null;
  totalLoans: number;
  retailLoans: number;
  wsLoans: number;
  totalDLQ: number;
  retailDLQ: number;
  wsDLQ: number;
  retailNonDPADLQ: number;
  retailBoostDLQ: number;
  retailOtherDPADLQ: number;
  wsNonDPADLQ: number;
  wsBoostDLQ: number;
  wsOtherDPADLQ: number;
  retailRemoved: number;
  wsRemoved: number;
  // Original SDQ% (numerator of original CR formula).
  // Surfaced for committee audit alongside revised values so reviewers can
  // validate the delta ("we removed N loans, SDQ% moved from X to Y").
  totalDQPct: number;
  retailDQPct: number | null;
  wsDQPct: number | null;
  // Revised SDQ% (numerator of Revised CR formula)
  // Surfaced for committee audit — they validate against this before the final CR.
  revisedTotalDQPct: number;
  revisedRetailDQPct: number | null;
  revisedWSDQPct: number | null;
  revisedTotalCR: number;
  revisedRetailCR: number | null;
  revisedWSCR: number | null;
  retailDPAConc: number;
  wsDPAConc: number;
  dqRate: number;
  totalDPAConc: number;
  isImproved: boolean;
  /**
   * Projected compare ratio for this office after the HUD 24-month
   * "beginning amortization date" window rolls forward 3 months.
   *
   * Math: count loans whose First Payment Date predates
   * (current period end - 21 months + 1 day) — those are the loans that
   * will fall out of HUD's window in 3 months. Remove them from BOTH the
   * numerator (if delinquent) and the denominator, then re-derive the
   * office's compare ratio using the same formula as `totalCR` (loans-vs-
   * benchmark scaling).
   *
   * `null` when the snapshot lacks First Payment Date data on enough loans
   * for the office to produce a meaningful projection.
   */
  proposedDropOffCR: number | null;
  /** Number of loans projected to drop off the office's denominator. */
  proposedDropOffCount: number;
  /**
   * The cutoff date used when computing `proposedDropOffCR`, exposed for the
   * tooltip copy. ISO `YYYY-MM-DD`. `null` mirrors `proposedDropOffCR`.
   */
  proposedDropOffWindowStart: string | null;
}

/**
 * Performance summary for one DPA Investor within a given DPA Program.
 *
 * Investors are the secondary grouping dimension — e.g. within the "Boost"
 * program we roll up performance by "AFN", "Orion Lending", etc.
 */
export interface DPAInvestorSummary {
  investor: string;
  program: string;
  totalLoans: number;
  delinquent: number;
  dqRate: number;
  /** Share of parent program's volume (0-100). */
  pctOfProgramVolume: number;
  /** Share of total DPA volume (0-100). */
  pctOfDPAVolume: number;
  retailLoans: number;
  wsLoans: number;
}

/**
 * Performance summary rolled up to a DPA Program (Boost, Arrive/Aurora, …).
 *
 * Each program carries its per-investor breakdown under {@link investors} for
 * drill-down; callers that only need the top-level view can ignore it.
 */
export interface DPAProgramSummary {
  program: string;
  totalLoans: number;
  delinquent: number;
  dqRate: number;
  /** Share of total DPA volume (0-100). */
  pctOfDPAVolume: number;
  retailLoans: number;
  wsLoans: number;
  investors: DPAInvestorSummary[];
}

export interface ChannelSummary {
  totalLoans: number;
  dpaConc: number;
  overallDQRate: number;
  dpaDQRate: number;
  nonDPADQRate: number;
  standardDQRate: number;
}

export interface FICOBucket {
  label: string;
  min: number;
  max: number;
  standardDQ: number;
  dpaDQ: number;
  standardTotal: number;
  dpaTotal: number;
}

export interface HUDOfficeCR {
  name: string;
  totalCR: number;
  retailCR: number;
  wsCR: number;
  totalLoansUW: number;
  totalDLQ: number;
  retailLoans: number;
  retailDLQ: number;
  sponsoredLoans: number;
  sponsoredDLQ: number;
  areaRetailDQPct: number;
  areaSponsoredDQPct: number;
  hudOfficeDQPct: number;
}

export interface DashboardData {
  loans: ParsedLoan[];
  totalLoans: number;
  overallDQRate: number;
  terminationRiskCount: number;
  /** Number of offices on Credit Watch — the canonical Stefanie
   *  methodology bucket (150% < CR <= 200% AND loans_count >= 100). Surfaced
   *  on the top-row KPI tile beside Termination Risk. */
  creditWatchCount: number;
  dpaPortfolioConc: number;
  /** Portfolio-level HUD Compare Ratio — Total scope (sourced from
   *  snapshot.compare_ratios_total[scope=='total']). */
  overallCR: number | null;
  /** Portfolio-level HUD Compare Ratio — Retail scope. */
  retailCR: number | null;
  /** Portfolio-level HUD Compare Ratio — Wholesale (sponsor) scope. */
  wholesaleCR: number | null;
  offices: OfficeSummary[];
  /** Primary DPA analytics — grouped by DPA Program with investor drill-down. */
  dpaPrograms: DPAProgramSummary[];
  /** Flat Program × Investor matrix for export / detail views. */
  dpaMatrix: DPAInvestorSummary[];
  retailSummary: ChannelSummary;
  wsSummary: ChannelSummary;
  ficoBuckets: FICOBucket[];
  programComposition: { standard: number; dpa: number; standardDQ: number; dpaDQ: number };
  hasHUDData: boolean;
  trendAnalysis: TrendAnalysis;
  /** NW Data extension — forwarded straight from the snapshot for the
   *  Deep Dive / Delinquencies tabs. Optional so older snapshots still
   *  load cleanly. */
  underwriterRollup?: import('@/types/snapshot').UnderwriterRollupRow[];
  delinquencyReasonRollup?: import('@/types/snapshot').DelinquencyReasonRollupRow[];
  indemnificationLoans?: import('@/types/snapshot').IndemnificationLoan[];
  sponsorTPODetail?: import('@/types/snapshot').SponsorTPODetailRow[];
  /**
   * Forward-looking Compare Ratio projections at 1/3/6-month horizons under
   * best/base/worst scenarios (from `snapshot.projections`, backend PR #29).
   *
   * Optional so snapshots produced before that ship still build a valid
   * DashboardData. PDF export and any future dashboard surfaces that need
   * this data should feature-detect it and degrade gracefully when absent.
   */
  projections?: import('@/types/snapshot').SnapshotProjections;
}


export interface TrendDimension {
  label: string;
  total: number;
  dlq: number;
  dqRate: number;
}

export interface TrendAnalysis {
  ltvGroups: TrendDimension[];
  fthb: TrendDimension[];
  dtiGroups: TrendDimension[];
  paymentShockGroups: TrendDimension[];
  sourceOfFunds: TrendDimension[];
  reservesGroups: TrendDimension[];
  riskIndicatorCount: TrendDimension[];
  giftGrantGroups: TrendDimension[];
  ausTypes: TrendDimension[];
  manualUWRate: number;
  manualUWDQRate: number;
  autoUWDQRate: number;
}
