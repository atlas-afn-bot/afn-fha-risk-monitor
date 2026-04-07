import type { ParsedLoan } from './types';

function weightedRandom<T extends Record<string, any>>(items: T[], key: string): T {
  const total = items.reduce((s, item) => s + item[key], 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item[key];
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

export function generateFakeData(): ParsedLoan[] {
  const loans: ParsedLoan[] = [];
  const totalLoans = 9400;

  const hudOffices = [
    { name: 'San Antonio', weight: 108, cr: 325, dpaRetail: 0.26, dpaWS: 0.65 },
    { name: 'Fresno', weight: 129, cr: 268, dpaRetail: 0.23, dpaWS: 0.26 },
    { name: 'Birmingham', weight: 125, cr: 251, dpaRetail: 0.35, dpaWS: 0.78 },
    { name: 'Fort Worth', weight: 98, cr: 238, dpaRetail: 0.17, dpaWS: 0.69 },
    { name: 'Atlanta', weight: 492, cr: 225, dpaRetail: 0.18, dpaWS: 0.55 },
    { name: 'Baltimore', weight: 196, cr: 213, dpaRetail: 0.07, dpaWS: 0.67 },
    { name: 'Santa Ana', weight: 471, cr: 180, dpaRetail: 0.18, dpaWS: 0.34 },
    { name: 'Columbia', weight: 298, cr: 174, dpaRetail: 0.28, dpaWS: 0.45 },
    { name: 'Tampa', weight: 377, cr: 173, dpaRetail: 0.17, dpaWS: 0.74 },
    { name: 'Camden', weight: 136, cr: 167, dpaRetail: 0.17, dpaWS: 0.80 },
    { name: 'Buffalo', weight: 136, cr: 167, dpaRetail: 0.00, dpaWS: 0.10 },
    { name: 'Cleveland', weight: 125, cr: 163, dpaRetail: 0.15, dpaWS: 0.30 },
    { name: 'Greensboro', weight: 183, cr: 163, dpaRetail: 0.12, dpaWS: 0.25 },
    { name: 'Chicago', weight: 198, cr: 151, dpaRetail: 0.20, dpaWS: 0.35 },
    { name: 'Miami', weight: 239, cr: 156, dpaRetail: 0.10, dpaWS: 0.30 },
    { name: 'Houston', weight: 400, cr: 135, dpaRetail: 0.12, dpaWS: 0.40 },
    { name: 'Phoenix', weight: 450, cr: 140, dpaRetail: 0.15, dpaWS: 0.51 },
    { name: 'Sacramento', weight: 350, cr: 130, dpaRetail: 0.10, dpaWS: 0.25 },
    { name: 'Denver', weight: 300, cr: 125, dpaRetail: 0.08, dpaWS: 0.20 },
    { name: 'Las Vegas', weight: 190, cr: 157, dpaRetail: 0.05, dpaWS: 0.30 },
    { name: 'Portland', weight: 134, cr: 153, dpaRetail: 0.05, dpaWS: 0.20 },
    { name: 'Orlando', weight: 280, cr: 120, dpaRetail: 0.12, dpaWS: 0.35 },
    { name: 'Dallas', weight: 114, cr: 156, dpaRetail: 0.15, dpaWS: 0.25 },
    { name: 'Louisville', weight: 65, cr: 180, dpaRetail: 0.10, dpaWS: 0.20 },
  ];

  const dpaProviders = [
    { name: 'Boost FHA Loan Program', weight: 69, dqRate: 0.104 },
    { name: 'Aurora FHA Loan Program', weight: 8, dqRate: 0.091 },
    { name: 'Elevate FHA Loan Program', weight: 6, dqRate: 0.016 },
    { name: 'AFN Boost 3.5% Repayable', weight: 3, dqRate: 0.054 },
    { name: 'AFN Boost FHA', weight: 3, dqRate: 0.057 },
    { name: 'FL Housing Assist Program', weight: 2, dqRate: 0.048 },
    { name: 'CalHFA DPA Program', weight: 1, dqRate: 0.000 },
    { name: 'MSHDA DPA Program', weight: 1, dqRate: 0.043 },
    { name: 'Other DPA Programs', weight: 7, dqRate: 0.065 },
  ];

  const ficoBuckets = [
    { min: 500, max: 579, weight: 1.5 },
    { min: 580, max: 619, weight: 12.7 },
    { min: 620, max: 659, weight: 28.4 },
    { min: 660, max: 679, weight: 14.5 },
    { min: 680, max: 699, weight: 12.4 },
    { min: 700, max: 739, weight: 17.0 },
    { min: 740, max: 850, weight: 13.5 },
  ];

  for (let i = 0; i < totalLoans; i++) {
    const office = weightedRandom(hudOffices, 'weight');
    const isWholesale = Math.random() < 0.51;
    const channel = isWholesale ? 'Banked - Wholesale' : 'Banked - Retail';
    const dpaConc = isWholesale ? office.dpaWS : office.dpaRetail;
    const roll = Math.random();

    let programType: 'DPA' | 'FUEL' | 'Standard';
    let isDPA = false;
    let isFUEL = false;
    let loanProgram: string;

    if (roll < dpaConc) {
      isDPA = true;
      programType = 'DPA';
      loanProgram = Math.random() < 0.07 ? 'FF30 DPA MF' : 'FF30 DPA';
    } else if (roll < dpaConc + 0.23) {
      isFUEL = true;
      programType = 'FUEL';
      loanProgram = 'FF30 FUEL';
    } else {
      programType = 'Standard';
      loanProgram = Math.random() < 0.08 ? 'FF30 MF' : 'FF30';
    }

    const bucket = weightedRandom(ficoBuckets, 'weight');
    const fico = Math.floor(Math.random() * (bucket.max - bucket.min + 1)) + bucket.min;

    let baseDQ = 0.031;
    if (isFUEL) baseDQ = 0.045;
    if (isDPA) baseDQ = 0.089;
    const ficoAdj = Math.max(0, (680 - fico) / 1000);
    const isDelinquent = Math.random() < (baseDQ + ficoAdj);

    let dpaName = '';
    let dpaProg = '';
    if (isDPA) {
      const provider = weightedRandom(dpaProviders, 'weight');
      dpaName = provider.name;
      dpaProg = provider.name + ' - Standard';
    }

    const isBoost = isDPA && dpaName.toLowerCase().includes('boost');

    // Simulate Enhanced Guidelines fields for fake data
    const units = Math.random() < 0.03 ? '3-4' : '1';
    const ausType = Math.random() < 0.3 ? 'Manual' : 'Approve/Eligible';
    const reserveMonths = Math.floor(Math.random() * 5);
    const giftFunds = Math.random() < 0.2 ? 'Yes' : 'No';
    const paymentShock = Math.floor(50 + Math.random() * 100);

    // Check enhanced guidelines for Boost DPA
    let failsEnhancedGuidelines = false;
    if (isBoost) {
      if (fico < 640) failsEnhancedGuidelines = true;
      else if (units.includes('3') || units.includes('4')) failsEnhancedGuidelines = true;
      else if (ausType.includes('Manual') || ausType.includes('Refer')) {
        if (fico >= 680 && (reserveMonths < 1 || giftFunds === 'Yes')) failsEnhancedGuidelines = true;
        if (fico < 680 && (reserveMonths < 3 || giftFunds === 'Yes' || paymentShock > 100)) failsEnhancedGuidelines = true;
      } else {
        if (fico < 680 && (reserveMonths < 2 || giftFunds === 'Yes')) failsEnhancedGuidelines = true;
        if (fico >= 680 && reserveMonths < 1) failsEnhancedGuidelines = true;
      }
    }

    loans.push({
      DQ: isDelinquent ? 'Yes' : 'No',
      HUDOffice: office.name,
      HUDOfficeCR: office.cr,
      Channel: channel,
      LoanProgram: loanProgram,
      DPAName: dpaName,
      DPAProgram: dpaProg,
      FICO: fico,
      LTVGroup: Math.random() < 0.7 ? '95.01 - 100' : '90.01 - 95',
      FTHB: Math.random() < 0.68 ? 'Y' : 'N',
      DTIBackEndGroup: ['< 30%', '30.01 - 40%', '40.01 - 45%', '45.01 - 50%', '> 50%'][Math.floor(Math.random() * 5)],
      PaymentShockGroup: ['0 - 24', '025 - 49', '050 - 74', '075 - 99', '100 - 149', '150 - 199', '200 - 299', '300 - 399', '900 +'][Math.floor(Math.random() * 9)],
      SourceOfFundsGroup: Math.random() < 0.56 ? 'Borrower Funds' : Math.random() < 0.6 ? 'Secured Borrowed Funds' : 'Gift',
      ReservesGroup: String(Math.floor(Math.random() * 10)),
      RiskIndicatorCount: Math.floor(Math.random() * 7),
      GiftGrantGroup: ['< 25%', '25% - 49.99%', '50% - 74.99%', '75%+'][Math.floor(Math.random() * 4)],
      Units: units,
      AUSType: ausType,
      ReserveMonths: reserveMonths,
      GiftFunds: giftFunds,
      PaymentShock: paymentShock,
      isDelinquent,
      programType,
      channelType: isWholesale ? 'Wholesale' : 'Retail',
      isDPA,
      isFUEL,
      isBoost,
      failsEnhancedGuidelines,
    });
  }

  return loans;
}
