import type { DashboardData } from './types';

const AZURE_ENDPOINT = 'https://brady-wu-ai.cognitiveservices.azure.com/';
const DEPLOYMENT = 'gpt-4-brady';
const API_VERSION = '2025-01-01-preview';
const API_KEY = 'REMOVED_SECRET';

interface AIAnalysisResult {
  executiveSummary: AIBullet[];
  actionItems: AIActionItem[];
}

export interface AIBullet {
  text: string;
  severity: 'red' | 'yellow' | 'green' | 'neutral';
}

export interface AIActionItem {
  text: string;
  category: 'immediate' | 'monitoring' | 'strategic';
  assignee?: string;
}

function buildDataSummary(data: DashboardData): string {
  const termOffices = data.offices.filter(o => o.totalCR > 200 && o.totalLoans > 100);
  const cwOffices = data.offices.filter(o =>
    (o.totalCR > 150 && o.totalCR <= 200 && o.totalLoans >= 100) ||
    (o.totalCR > 200 && o.totalLoans < 100)
  );

  const termDetails = termOffices
    .sort((a, b) => b.totalCR - a.totalCR)
    .map(o => {
      const boostDLQ = o.retailBoostDLQ + o.wsBoostDLQ;
      const otherDPADLQ = o.retailOtherDPADLQ + o.wsOtherDPADLQ;
      const nonDPADLQ = o.retailNonDPADLQ + o.wsNonDPADLQ;
      return `  - ${o.name}: Total CR ${o.totalCR}% (Retail ${o.retailCR ?? 'N/A'}%, WS ${o.wsCR ?? 'N/A'}%), ${o.totalLoans} loans, ${o.totalDLQ} DLQ (${nonDPADLQ} Non-DPA, ${boostDLQ} Boost, ${otherDPADLQ} Other DPA), Revised CR after Boost removal: ${o.revisedTotalCR}% (Retail ${o.revisedRetailCR ?? 'N/A'}%, WS ${o.revisedWSCR ?? 'N/A'}%), DPA Conc: Retail ${o.retailDPAConc.toFixed(1)}% / WS ${o.wsDPAConc.toFixed(1)}%`;
    })
    .join('\n');

  const cwTop5 = cwOffices
    .sort((a, b) => b.totalCR - a.totalCR)
    .slice(0, 5)
    .map(o => `  - ${o.name}: Total CR ${o.totalCR}%, ${o.totalLoans} loans, ${o.totalDLQ} DLQ, DPA Conc: ${o.totalDPAConc.toFixed(1)}%`)
    .join('\n');

  const topProviders = [...data.dpaProviders]
    .sort((a, b) => b.delinquent - a.delinquent)
    .slice(0, 5)
    .map(p => `  - ${p.name}: ${p.totalLoans} loans, ${p.delinquent} DLQ (${p.dqRate.toFixed(1)}%), ${p.pctOfDPAVolume.toFixed(1)}% of DPA volume`)
    .join('\n');

  const { standardDQ, dpaDQ, fuelDQ } = data.programComposition;
  const multiplier = standardDQ > 0 ? (dpaDQ / standardDQ).toFixed(1) : 'N/A';

  const t = data.trendAnalysis;

  return `FHA LOAN PORTFOLIO ANALYSIS DATA:

PORTFOLIO OVERVIEW:
- Total Loans: ${data.totalLoans.toLocaleString()}
- Overall DQ Rate: ${data.overallDQRate.toFixed(2)}%
- DPA Portfolio Concentration: ${data.dpaPortfolioConc.toFixed(1)}%
- Program DQ Rates: Standard FHA ${standardDQ.toFixed(2)}%, FUEL ${fuelDQ.toFixed(2)}%, DPA ${dpaDQ.toFixed(2)}% (${multiplier}x standard rate)

CHANNEL COMPARISON:
- Retail: ${data.retailSummary.totalLoans} loans, DPA Conc ${data.retailSummary.dpaConc.toFixed(1)}%, DQ Rate ${data.retailSummary.overallDQRate.toFixed(2)}%, DPA DQ ${data.retailSummary.dpaDQRate.toFixed(2)}%
- Wholesale: ${data.wsSummary.totalLoans} loans, DPA Conc ${data.wsSummary.dpaConc.toFixed(1)}%, DQ Rate ${data.wsSummary.overallDQRate.toFixed(2)}%, DPA DQ ${data.wsSummary.dpaDQRate.toFixed(2)}%

TERMINATION RISK OFFICES (${termOffices.length} offices, >200% CR + >100 loans):
${termDetails || '  None'}

TOP 5 CREDIT WATCH OFFICES:
${cwTop5 || '  None'}
Total Credit Watch: ${cwOffices.length} offices

TOP DPA PROVIDERS BY DELINQUENCY:
${topProviders}

FICO ANALYSIS:
${data.ficoBuckets.map(b => `  ${b.label}: Standard ${b.standardDQ.toFixed(1)}%, FUEL ${b.fuelDQ.toFixed(1)}%, DPA ${b.dpaDQ.toFixed(1)}% (${b.dpaTotal} DPA loans)`).join('\n')}

UNDERWRITING & RISK FACTOR TRENDS:

AUS Type DQ Rates:
${t.ausTypes.map(d => `  ${d.label}: ${d.dqRate.toFixed(1)}% (${d.dlq}/${d.total})`).join('\n')}
  Manual UW = ${t.manualUWRate.toFixed(1)}% of portfolio, DQ rate ${t.manualUWDQRate.toFixed(1)}% vs Auto ${t.autoUWDQRate.toFixed(1)}%

LTV Group DQ Rates (higher LTV = more risk):
${t.ltvGroups.map(d => `  ${d.label}: ${d.dqRate.toFixed(1)}% (${d.dlq}/${d.total})`).join('\n')}

First-Time Homebuyer DQ Rates:
${t.fthb.map(d => `  FTHB=${d.label}: ${d.dqRate.toFixed(1)}% (${d.dlq}/${d.total})`).join('\n')}

DTI Back-End Group DQ Rates:
${t.dtiGroups.map(d => `  ${d.label}: ${d.dqRate.toFixed(1)}% (${d.dlq}/${d.total})`).join('\n')}

Payment Shock Group DQ Rates:
${t.paymentShockGroups.map(d => `  ${d.label}: ${d.dqRate.toFixed(1)}% (${d.dlq}/${d.total})`).join('\n')}

Source of Funds DQ Rates:
${t.sourceOfFunds.map(d => `  ${d.label}: ${d.dqRate.toFixed(1)}% (${d.dlq}/${d.total})`).join('\n')}

Reserves (months) DQ Rates:
${t.reservesGroups.map(d => `  ${d.label} months: ${d.dqRate.toFixed(1)}% (${d.dlq}/${d.total})`).join('\n')}

Risk Indicator Count DQ Rates (layered risk):
${t.riskIndicatorCount.map(d => `  ${d.label} indicators: ${d.dqRate.toFixed(1)}% (${d.dlq}/${d.total})`).join('\n')}

Gift/Grant Funding % DQ Rates:
${t.giftGrantGroups.map(d => `  ${d.label}: ${d.dqRate.toFixed(1)}% (${d.dlq}/${d.total})`).join('\n')}

KEY THRESHOLDS:
- Compare Ratio >200%: Termination risk (HUD can suspend underwriting)
- Compare Ratio 150-200%: Credit watch
- DPA Concentration >40%: High risk
- Each HUD office can independently enforce at >200%`;

}

export async function generateAIAnalysis(data: DashboardData): Promise<AIAnalysisResult> {
  const dataSummary = buildDataSummary(data);

  const url = `${AZURE_ENDPOINT}openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': API_KEY,
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: `You are a senior FHA risk analyst preparing an executive summary and action items for the HUD Compare Ratio Committee at American Financial Network (AFN).

The dashboard UI already shows termination risk office cards, credit watch count, DPA concentration, channel gap, and HUD enforcement note in dedicated visual sections. DO NOT repeat any of those topics.

Your executive summary bullets should ONLY cover the DEEP TREND ANALYSIS from the underwriting and risk factor data. Focus exclusively on:
1-8. DEEP TREND ANALYSIS — analyze the underwriting and risk factor data to identify:
   - Which risk factors have the strongest correlation with delinquency (e.g., Source of Funds: Secured Borrowed at 9.7% vs Borrower Funds at 3.1%)
   - Manual underwriting vs auto-approved DQ rate differences and what that implies
   - LTV concentration risk (high-LTV loans and their DQ rates)
   - First-time homebuyer risk patterns
   - DTI threshold effects on delinquency
   - Payment shock patterns
   - Risk indicator layering (how DQ rate escalates with more risk indicators)
   - Reserves adequacy — which reserve levels show elevated default
   - Any surprising findings or combinations that stand out
   Each trend bullet should reference specific numbers and state the risk implication.

Keep bullets concise (1-2 sentences). Use the exact same language patterns shown above.

For action items, classify as:
- immediate: needs action this week (e.g., respond to QC findings, prepare HUD responses)
- monitoring: ongoing tracking required
- strategic: longer-term process/policy changes

Return your response as JSON with this exact structure:
{
  "executiveSummary": [
    { "text": "...", "severity": "red|yellow|green|neutral" }
  ],
  "actionItems": [
    { "text": "...", "category": "immediate|monitoring|strategic", "assignee": "optional team/person" }
  ]
}

Generate the executive summary bullets following the structure above, and 6-10 action items focused on what the committee needs to decide and act on.`
        },
        {
          role: 'user',
          content: `Analyze this FHA portfolio data and generate the executive summary and action items:\n\n${dataSummary}`
        }
      ],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Azure OpenAI error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in Azure OpenAI response');
  }

  const parsed = JSON.parse(content) as AIAnalysisResult;

  // Validate structure
  if (!Array.isArray(parsed.executiveSummary) || !Array.isArray(parsed.actionItems)) {
    throw new Error('Invalid AI response structure');
  }

  return parsed;
}
