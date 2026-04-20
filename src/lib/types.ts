export interface LoanRecord {
  DQ: string;
  HUDOffice: string;
  HUDOfficeCR: number;
  Channel: string;
  LoanProgram: string;
  DPAName: string;
  DPAProgram: string;
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

export interface DPAProviderSummary {
  name: string;
  totalLoans: number;
  delinquent: number;
  dqRate: number;
  pctOfDPAVolume: number;
  retailLoans: number;
  wsLoans: number;
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
  dpaProviders: DPAProviderSummary[];
  retailSummary: ChannelSummary;
  wsSummary: ChannelSummary;
  ficoBuckets: FICOBucket[];
  programComposition: { standard: number; dpa: number; standardDQ: number; dpaDQ: number };
  hasHUDData: boolean;
  trendAnalysis: TrendAnalysis;
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
