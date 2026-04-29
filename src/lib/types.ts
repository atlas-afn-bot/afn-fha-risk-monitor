export interface LoanRecord {
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
  /** DPA investor / funding source ("AFN", "Orion Lending", "United Security Financial Corp", …). */
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
  revisedTotalCR: number;
  revisedRetailCR: number | null;
  revisedWSCR: number | null;
  retailDPAConc: number;
  wsDPAConc: number;
  dqRate: number;
  totalDPAConc: number;
  isImproved: boolean;
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
  dpaPortfolioConc: number;
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
