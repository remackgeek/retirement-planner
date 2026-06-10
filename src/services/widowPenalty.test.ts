import { describe, it, expect } from 'vitest';
import { getDeathModel, projectionHorizonYears, runDeterministicProjection } from './SimulationService';
import { getStandardDeduction } from './TaxCalculator';
import type { UserData } from '../types/UserData';
import type { PortfolioAssumptions } from '../types/IncomeEvent';

const PA: PortfolioAssumptions = {
  stockReturn: 0.05,
  stockStdDev: 0,
  bondReturn: 0.05,
  bondStdDev: 0,
  stockBondCorrelationEnabled: false,
  stockBondCorrelation: 0,
  returnDistribution: 'lognormal',
  degreesOfFreedom: 4,
  returnModel: 'parametric',
};

// Deterministic MFJ couple. Spouse (65) dies at 75 → 10 years before self (dies 90).
// Self is the survivor. No inflation, no state tax, SS haircut off → clean numbers.
function makeCouple(overrides: Partial<UserData> = {}): UserData {
  return {
    currentAge: 65,
    lifeExpectancy: 90,
    spouseAge: 65,
    spouseLifeExpectancy: 75,
    filingStatus: 'mfj',
    referenceYear: 2026,
    inflationRate: 0,
    inflationStdDev: 0,
    longTermCapGainsRate: 0.15,
    stateTimeline: [{ state: 'Florida' }],
    simulationSettings: { numSimulations: 1 },
    portfolioAssumptions: PA,
    accounts: [
      { id: 't-self', name: 'Trad Self', type: 'traditional', balance: 500_000, owner: 'self', stockAllocation: 0.6, portfolioBalance: '60_40', accountKind: 'ira' },
      { id: 't-spouse', name: 'Trad Spouse', type: 'traditional', balance: 500_000, owner: 'spouse', stockAllocation: 0.6, portfolioBalance: '60_40', accountKind: 'ira' },
      { id: 'roth', name: 'Roth', type: 'roth', balance: 50_000, owner: 'self', stockAllocation: 0.6, portfolioBalance: '60_40', accountKind: 'ira' },
    ],
    incomeEvents: [
      { id: 'ss-self', type: 'social_security', owner: 'self', name: 'SS Self', amount: 40_000, startAge: 65, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false, amountPeriod: 'annual' },
      { id: 'ss-spouse', type: 'social_security', owner: 'spouse', name: 'SS Spouse', amount: 20_000, startAge: 65, taxStatus: 'before_tax', colaType: 'fixed', ssHaircutEnabled: false, amountPeriod: 'annual' },
    ],
    spendingGoals: [
      { id: 'le', type: 'living_expenses', name: 'Living', amount: 60_000, startAge: 65, inflationAdjusted: false, amountPeriod: 'annual' },
    ],
    ...overrides,
  };
}

describe('getDeathModel', () => {
  it('is inactive when not MFJ / no spouse LE — horizon = self only, bit-identical path', () => {
    const single = makeCouple({ filingStatus: 'single', spouseAge: null, spouseLifeExpectancy: null });
    const dm = getDeathModel(single);
    expect(dm.active).toBe(false);
    expect(dm.firstDeathOffset).toBe(Infinity);
    expect(dm.horizonYears).toBe(90 - 65 + 1);
    // MFJ but no spouseLifeExpectancy → still inactive.
    const mfjNoLE = makeCouple({ spouseLifeExpectancy: null });
    expect(getDeathModel(mfjNoLE).active).toBe(false);
  });

  it('spouse dies first → survivor = self, horizon = self death', () => {
    const dm = getDeathModel(makeCouple());
    expect(dm.active).toBe(true);
    expect(dm.firstDeathOffset).toBe(10); // spouse 65→75
    expect(dm.survivor).toBe('self');
    expect(dm.horizonYears).toBe(26); // self 65→90 = 25 offset +1
    expect(projectionHorizonYears(makeCouple())).toBe(26);
  });

  it('self dies first → survivor = spouse, horizon extends to spouse death', () => {
    // self dies at 80 (offset 15), spouse 60 lives to 95 (offset 35).
    const dm = getDeathModel(makeCouple({ lifeExpectancy: 80, spouseAge: 60, spouseLifeExpectancy: 95 }));
    expect(dm.active).toBe(true);
    expect(dm.firstDeathOffset).toBe(15);
    expect(dm.survivor).toBe('spouse');
    expect(dm.horizonYears).toBe(36); // spouse offset 35 +1
  });
});

describe('widow penalty in the projection', () => {
  const ud = makeCouple();
  const det = runDeterministicProjection(ud);
  const dm = getDeathModel(ud);
  // Pre-death year: both alive AND post-RMD so there's taxable income to deduce the
  // std deduction from. Born 1961 (currentAge 65 @ 2026) → SECURE 2.0 RMD start age 75,
  // so the first MFJ year with RMD-driven taxable income is idx 10 → age 75. MFJ holds
  // through the spouse's death year (offset 10); survivor/single mode begins idx 11.
  // Post-death: idx 12 → self 77 (single survivor, RMD active).
  const preIdx = 10;
  const postIdx = 12;
  const preYear = ud.referenceYear + preIdx;
  const postYear = ud.referenceYear + postIdx;

  it('projection runs to the survivor horizon', () => {
    expect(det.breakdowns.length).toBe(dm.horizonYears);
  });

  it('pre-death year files MFJ; post-death year files single (std deduction halves)', () => {
    const preStd = det.breakdowns[preIdx].audit?.standardDeduction ?? 0;
    const postStd = det.breakdowns[postIdx].audit?.standardDeduction ?? 0;
    expect(preStd).toBeCloseTo(getStandardDeduction('mfj', preYear, 0), 0);
    expect(postStd).toBeCloseTo(getStandardDeduction('single', postYear, 0), 0);
    // Sanity: single is materially smaller than MFJ.
    expect(postStd).toBeLessThan(preStd);
  });

  it('survivor keeps the LARGER Social Security benefit (max, not sum)', () => {
    // Both alive: 40k + 20k = 60k. After spouse death: max(40k, 20k) = 40k.
    expect(det.breakdowns[preIdx].ssGross).toBeCloseTo(60_000, 0);
    expect(det.breakdowns[postIdx].ssGross).toBeCloseTo(40_000, 0);
  });

  it('post-death IRMAA counts a single enrollee', () => {
    expect(det.breakdowns[postIdx].audit?.irmaaEnrolleeCount).toBe(1);
  });

  it('self dies first → survivor is the spouse: filing flips to single and RMD uses the SPOUSE\'s age', () => {
    // Self 65→78 (dies offset 13); spouse 60→92 (offset 32) outlives. Survivor = spouse.
    const ud = makeCouple({ currentAge: 65, lifeExpectancy: 78, spouseAge: 60, spouseLifeExpectancy: 92 });
    const dm = getDeathModel(ud);
    expect(dm.survivor).toBe('spouse');
    const det = runDeterministicProjection(ud);
    // Horizon extends past self's death to the spouse's (offset 32 → 33 years).
    expect(det.breakdowns.length).toBe(33);
    // Post-self-death year: idx 20 → spouse age 80 (self long dead). Survivor files single,
    // and the RMD divisor is the spouse-survivor's age-80 value (20.2), proving the age
    // collapse keys off the survivor and not the (deceased) self.
    const postIdx = 20;
    const b = det.breakdowns[postIdx];
    const postYear = ud.referenceYear + postIdx;
    expect(b.audit?.standardDeduction).toBeCloseTo(getStandardDeduction('single', postYear, 0), 0);
    expect(b.rmdRequired).toBeGreaterThan(0);
    expect(b.audit?.rmdSpouse ?? 0).toBe(0);
    expect(b.audit?.rmdDivisorSelf).toBeCloseTo(20.2, 5); // IRS Uniform Lifetime divisor at age 80
  });

  it('non-SS income owned by the deceased terminates after their death year', () => {
    // Spouse (dies offset 10, i.e. age 75 / year 2036) has a pension with no endAge.
    const ud = makeCouple({
      incomeEvents: [
        ...makeCouple().incomeEvents,
        { id: 'pension-spouse', type: 'pension_income', owner: 'spouse', name: 'Spouse Pension', amount: 20_000, startAge: 65, taxStatus: 'before_tax', colaType: 'fixed', amountPeriod: 'annual' },
      ],
    });
    const det = runDeterministicProjection(ud);
    // otherTaxableGross here = the pension only (no cash interest; Trad pulls are tracked
    // separately as withdrawalFromTraditional). Active while the spouse is alive...
    expect(det.breakdowns[5].otherTaxableGross).toBeCloseTo(20_000, 0);   // idx 5: spouse alive
    expect(det.breakdowns[10].otherTaxableGross).toBeCloseTo(20_000, 0);  // idx 10: death year, still counts
    // ...and gone the year AFTER the spouse's death.
    expect(det.breakdowns[12].otherTaxableGross).toBeCloseTo(0, 0);       // idx 12: terminated
  });

  it('RMD after death is computed on the consolidated (combined) Traditional balance', () => {
    // First RMD year is self age 73 (idx 8), which is post-death (spouse died idx 10? no:
    // spouse dies offset 10 = age 75). At idx 8 (age 73) BOTH still alive → both RMD.
    // Pick idx 12 (age 77, post-death): the survivor's RMD is on all Traditional, and
    // there is exactly one RMD owner (self) — rmdSpouse should be zero.
    const b = det.breakdowns[postIdx];
    expect(b.rmdRequired).toBeGreaterThan(0);
    expect(b.audit?.rmdSpouse ?? 0).toBe(0);
    expect(b.audit?.rmdSelf ?? 0).toBeCloseTo(b.rmdRequired, 0);
  });
});
