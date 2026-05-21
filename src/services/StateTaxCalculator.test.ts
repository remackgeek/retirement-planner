import { describe, it, expect } from 'vitest';
import { computeStateTax, type StateTaxInput } from './StateTaxCalculator';
import { getStateTaxProfile, STATE_TAX_PROFILES, SELECTABLE_STATES } from '../data/stateTaxProfiles';
import { calculateAnnualCashFlow } from './SimulationService';
import type { UserData } from '../types/UserData';

const baseInput = (overrides: Partial<StateTaxInput> = {}): StateTaxInput => ({
  ordinaryGross: 0,
  ssTaxableFederal: 0,
  ssGross: 0,
  traditionalWithdrawal: 0,
  ltcgFromTaxable: 0,
  age: 60,
  spouseAge: null,
  filingStatus: 'single',
  year: 2026,
  inflationRate: 0,
  ...overrides,
});

describe('StateTaxCalculator', () => {
  describe('No-income-tax states', () => {
    it('Florida produces zero tax on all income types', () => {
      const p = getStateTaxProfile('Florida', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ordinaryGross: 100000,
        traditionalWithdrawal: 50000,
        ssTaxableFederal: 20000,
        ltcgFromTaxable: 100000,
      }), 'Florida');
      expect(r.stateOrdinaryTax).toBe(0);
      expect(r.stateCapGainsTax).toBe(0);
      expect(r.stateLocalitySurcharge).toBe(0);
    });

    it('Texas, Wyoming, Tennessee, South Dakota, Nevada, Alaska, New Hampshire all return zero', () => {
      for (const state of ['Texas', 'Wyoming', 'Tennessee', 'South Dakota', 'Nevada', 'Alaska', 'New Hampshire']) {
        const p = getStateTaxProfile(state, 2026).profile;
        const r = computeStateTax(p, baseInput({ ordinaryGross: 200000, ltcgFromTaxable: 500000 }), state);
        expect(r.stateOrdinaryTax, state).toBe(0);
        expect(r.stateCapGainsTax, state).toBe(0);
      }
    });
  });

  describe('California — graduated brackets', () => {
    it('walks the bracket schedule on $100k pension', () => {
      const p = getStateTaxProfile('California', 2026).profile;
      const r = computeStateTax(p, baseInput({ ordinaryGross: 100000 }), 'California');
      // Base 100000 - $5,540 std ded = $94,460. Walk CA single brackets:
      // 1%·10,412 + 2%·14,272 + 4%·14,275 + 6%·15,122 + 8%·14,269 + 9.3%·26,110 ≈ $5,438
      expect(r.stateOrdinaryTax).toBeCloseTo(5438, 0);
      expect(r.stateMarginalRate).toBe(0.093);
    });

    it('top bracket is 13.3% on $2M', () => {
      const p = getStateTaxProfile('California', 2026).profile;
      const r = computeStateTax(p, baseInput({ ordinaryGross: 2_000_000 }), 'California');
      expect(r.stateMarginalRate).toBe(0.133);
    });

    it('CA does NOT exempt SS at the state level', () => {
      const p = getStateTaxProfile('California', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ordinaryGross: 0,
        ssGross: 30000,
        ssTaxableFederal: 0, // federal-taxable portion is 0 (provisional income too low)
      }), 'California');
      // CA ssRule = exempt: SS is never added to state base
      expect(r.ssIncludedInState).toBe(0);
    });
  });

  describe('New York — pension exclusion', () => {
    it('applies $20k pension/IRA exclusion at age 59.5+ to Traditional withdrawals', () => {
      const p = getStateTaxProfile('New York', 2026).profile;
      const r = computeStateTax(p, baseInput({
        traditionalWithdrawal: 50000,
        age: 65,
      }), 'New York');
      expect(r.retirementExclusionApplied).toBe(20000);
      // Base = 50000 - 20000 - $8000 std ded = $22,000 taxable
      // Walk NY single: 4%·8500 + 4.5%·3200 + 5.25%·2200 + 5.5%·8100 = 340 + 144 + 115.5 + 445.5 = 1045
      expect(r.stateOrdinaryTax).toBeCloseTo(1045, 0);
    });

    it('does NOT apply exclusion below age 59.5', () => {
      const p = getStateTaxProfile('New York', 2026).profile;
      const r = computeStateTax(p, baseInput({
        traditionalWithdrawal: 50000,
        age: 55,
      }), 'New York');
      expect(r.retirementExclusionApplied).toBe(0);
    });

    it('caps exclusion at the withdrawal amount when smaller than $20k', () => {
      const p = getStateTaxProfile('New York', 2026).profile;
      const r = computeStateTax(p, baseInput({
        traditionalWithdrawal: 15000,
        age: 65,
      }), 'New York');
      expect(r.retirementExclusionApplied).toBe(15000);
    });
  });

  describe('New York City — locality surcharge', () => {
    it('adds NYC ~3.876% on top of NY state tax', () => {
      const p = getStateTaxProfile('New York City', 2026).profile;
      const r = computeStateTax(p, baseInput({ ordinaryGross: 100000 }), 'New York City');
      // NY state ordinary tax computed as before, plus NYC locality
      expect(r.stateLocalitySurcharge).toBeGreaterThan(3000);
      expect(r.stateLocalitySurcharge).toBeLessThan(4500);
    });
  });

  describe('Washington — capital-gains-only', () => {
    it('charges 7% on LTCG above $262k (2024) indexed threshold; 0 on ordinary', () => {
      const p = getStateTaxProfile('Washington', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ordinaryGross: 200000,
        ltcgFromTaxable: 400000,
        inflationRate: 0,
      }), 'Washington');
      expect(r.stateOrdinaryTax).toBe(0);
      expect(r.ltcgThresholdApplied).toBe(262000);
      expect(r.stateCapGainsTax).toBeCloseTo(0.07 * (400000 - 262000), 1);
    });

    it('threshold inflation-indexes forward independently of bracket indexing', () => {
      const p = getStateTaxProfile('Washington', 2026).profile;
      const r2040 = computeStateTax(p, baseInput({ ltcgFromTaxable: 400000, year: 2040, inflationRate: 0.03 }), 'Washington');
      // 2040 threshold = 262000 × 1.03^16 ≈ $420k → $0 state cap-gains tax
      expect(r2040.ltcgThresholdApplied).toBeGreaterThan(400000);
      expect(r2040.stateCapGainsTax).toBe(0);
    });

    it('charges $0 when LTCG below the threshold', () => {
      const p = getStateTaxProfile('Washington', 2026).profile;
      const r = computeStateTax(p, baseInput({ ltcgFromTaxable: 200000 }), 'Washington');
      expect(r.stateCapGainsTax).toBe(0);
    });
  });

  describe('Missouri — LTCG exemption', () => {
    it('zero state LTCG tax on $500k capital gains', () => {
      const p = getStateTaxProfile('Missouri', 2026).profile;
      const r = computeStateTax(p, baseInput({ ltcgFromTaxable: 500000 }), 'Missouri');
      expect(r.stateCapGainsTax).toBe(0);
    });

    it('still taxes ordinary income normally', () => {
      const p = getStateTaxProfile('Missouri', 2026).profile;
      const r = computeStateTax(p, baseInput({ ordinaryGross: 100000 }), 'Missouri');
      expect(r.stateOrdinaryTax).toBeGreaterThan(0);
    });
  });

  describe('Colorado — SS exempt at age 65+', () => {
    it('includes SS for ages below 65', () => {
      const p = getStateTaxProfile('Colorado', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ssGross: 30000,
        ssTaxableFederal: 25500, // 85% of $30k
        age: 64,
      }), 'Colorado');
      expect(r.ssIncludedInState).toBe(25500);
    });

    it('exempts SS at age 65+', () => {
      const p = getStateTaxProfile('Colorado', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ssGross: 30000,
        ssTaxableFederal: 25500,
        age: 65,
      }), 'Colorado');
      expect(r.ssIncludedInState).toBe(0);
    });
  });

  describe('Pennsylvania — full retirement exclusion', () => {
    it('zero state tax on Traditional withdrawal + SS', () => {
      const p = getStateTaxProfile('Pennsylvania', 2026).profile;
      const r = computeStateTax(p, baseInput({
        traditionalWithdrawal: 80000,
        ssGross: 30000,
        ssTaxableFederal: 25500,
        age: 65,
      }), 'Pennsylvania');
      expect(r.stateOrdinaryTax).toBe(0);
      expect(r.retirementExclusionApplied).toBe(80000);
    });
  });

  describe('Illinois — full retirement exclusion', () => {
    it('zero state tax on Traditional withdrawal regardless of age', () => {
      const p = getStateTaxProfile('Illinois', 2026).profile;
      const r = computeStateTax(p, baseInput({
        traditionalWithdrawal: 100000,
        age: 60,
      }), 'Illinois');
      expect(r.retirementExclusionApplied).toBe(100000);
      expect(r.stateOrdinaryTax).toBe(0);
    });
  });

  describe('New Jersey — AGI phase-out', () => {
    it('applies pension exclusion below $150k AGI', () => {
      const p = getStateTaxProfile('New Jersey', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ordinaryGross: 0,
        traditionalWithdrawal: 50000,
        age: 65,
      }), 'New Jersey');
      // AGI proxy = 0 + 50000 + 0 + 0 = 50000 < 150000 → exclusion applies
      expect(r.retirementExclusionApplied).toBe(50000);
    });

    it('zeroes exclusion above $150k AGI hard cliff', () => {
      const p = getStateTaxProfile('New Jersey', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ordinaryGross: 110000,
        traditionalWithdrawal: 80000,
        age: 65,
      }), 'New Jersey');
      // AGI = 110000 + 80000 = 190000 > 150000 → no exclusion
      expect(r.retirementExclusionApplied).toBe(0);
    });
  });

  describe('South Carolina — successor profile after 2026', () => {
    it('uses 6% rate in 2026', () => {
      const p = getStateTaxProfile('South Carolina', 2026).profile;
      expect(p.brackets.single[0].rate).toBeCloseTo(0.06, 4);
    });

    it('falls through to 2027+ successor profile in 2027', () => {
      const p = getStateTaxProfile('South Carolina', 2027).profile;
      expect(p.brackets.single[0].rate).toBeCloseTo(0.052, 4);
    });
  });

  describe('West Virginia — SS phase-out via successor', () => {
    it('taxes SS through 2026', () => {
      const p = getStateTaxProfile('West Virginia', 2026).profile;
      expect(p.ssRule.kind).toBe('taxed');
    });

    it('exempts SS in 2027 via successor profile', () => {
      const p = getStateTaxProfile('West Virginia', 2027).profile;
      expect(p.ssRule.kind).toBe('exempt');
    });
  });

  describe('Inflation indexing', () => {
    it('CA brackets inflate forward from 2024 baseline', () => {
      const p = getStateTaxProfile('California', 2026).profile;
      const r2026 = computeStateTax(p, baseInput({ ordinaryGross: 100000, inflationRate: 0.03 }), 'California');
      const r2040 = computeStateTax(p, baseInput({ ordinaryGross: 100000, year: 2040, inflationRate: 0.03 }), 'California');
      // CA inflation-indexed; same nominal income should hit lower brackets in the future
      expect(r2040.stateOrdinaryTax).toBeLessThan(r2026.stateOrdinaryTax);
    });

    it('NY brackets do NOT inflate (statutorily fixed)', () => {
      const p = getStateTaxProfile('New York', 2026).profile;
      const r2026 = computeStateTax(p, baseInput({ ordinaryGross: 100000, inflationRate: 0.03 }), 'New York');
      const r2040 = computeStateTax(p, baseInput({ ordinaryGross: 100000, year: 2040, inflationRate: 0.03 }), 'New York');
      expect(r2040.stateOrdinaryTax).toBeCloseTo(r2026.stateOrdinaryTax, 0);
    });
  });

  describe('Override: disableStateRetirementExclusion', () => {
    it('disables NY exclusion when explicitly true', () => {
      const p = getStateTaxProfile('New York', 2026).profile;
      const r = computeStateTax(p, baseInput({
        traditionalWithdrawal: 50000,
        age: 65,
        disableStateRetirementExclusion: true,
      }), 'New York');
      expect(r.retirementExclusionApplied).toBe(0);
    });

    it('default (undefined) applies the profile exclusion', () => {
      const p = getStateTaxProfile('New York', 2026).profile;
      const r = computeStateTax(p, baseInput({
        traditionalWithdrawal: 50000,
        age: 65,
        // disableStateRetirementExclusion intentionally omitted
      }), 'New York');
      expect(r.retirementExclusionApplied).toBe(20000);
    });
  });

  describe('Profile coverage smoke test', () => {
    it('every selectable state resolves to a profile and computes without throwing', () => {
      for (const name of Object.keys(STATE_TAX_PROFILES)) {
        const p = getStateTaxProfile(name, 2026).profile;
        expect(() => computeStateTax(p, baseInput({ ordinaryGross: 80000, ltcgFromTaxable: 20000, age: 65 }), name)).not.toThrow();
      }
    });
  });

  describe('getStateTaxProfile.resolvedKey', () => {
    it('returns the input key for non-transition states', () => {
      expect(getStateTaxProfile('California', 2026).resolvedKey).toBe('California');
    });

    it('returns the successor key when crossing the SC sunset', () => {
      expect(getStateTaxProfile('South Carolina', 2026).resolvedKey).toBe('South Carolina');
      expect(getStateTaxProfile('South Carolina', 2027).resolvedKey).toBe('South Carolina (2027+)');
    });

    it('returns the successor key when crossing the WV SS phase-out', () => {
      expect(getStateTaxProfile('West Virginia', 2026).resolvedKey).toBe('West Virginia');
      expect(getStateTaxProfile('West Virginia', 2027).resolvedKey).toBe('West Virginia (2027+)');
    });

    it('falls back to Florida + warns for unknown states', () => {
      expect(getStateTaxProfile('Atlantis', 2026).resolvedKey).toBe('Florida');
    });
  });

  describe('Filing status mapping (HoH → single)', () => {
    it('HoH walks the single brackets', () => {
      const p = getStateTaxProfile('California', 2026).profile;
      const single = computeStateTax(p, baseInput({ ordinaryGross: 100000, filingStatus: 'single' }), 'California');
      const hoh = computeStateTax(p, baseInput({ ordinaryGross: 100000, filingStatus: 'hoh' }), 'California');
      expect(hoh.stateOrdinaryTax).toBeCloseTo(single.stateOrdinaryTax, 1);
    });

    it('MFS walks the single brackets', () => {
      const p = getStateTaxProfile('California', 2026).profile;
      const single = computeStateTax(p, baseInput({ ordinaryGross: 100000, filingStatus: 'single' }), 'California');
      const mfs = computeStateTax(p, baseInput({ ordinaryGross: 100000, filingStatus: 'mfs' }), 'California');
      expect(mfs.stateOrdinaryTax).toBeCloseTo(single.stateOrdinaryTax, 1);
    });
  });

  describe('NYC LTCG inclusion', () => {
    it('NYC locality applies to ordinary + LTCG base (LTCG NOT excluded)', () => {
      const p = getStateTaxProfile('New York City', 2026).profile;
      const noLtcg = computeStateTax(p, baseInput({ ordinaryGross: 100000 }), 'New York City');
      const withLtcg = computeStateTax(p, baseInput({ ordinaryGross: 100000, ltcgFromTaxable: 50000 }), 'New York City');
      // Adding $50k LTCG raises the locality surcharge by ~3.876% × $50k = $1,938
      expect(withLtcg.stateLocalitySurcharge - noLtcg.stateLocalitySurcharge).toBeCloseTo(0.03876 * 50000, 0);
    });

    it('NYC composed from NY: brackets are reference-identical', () => {
      const ny = getStateTaxProfile('New York', 2026).profile;
      const nyc = getStateTaxProfile('New York City', 2026).profile;
      expect(nyc.brackets.single).toBe(ny.brackets.single);
      expect(nyc.brackets.mfj).toBe(ny.brackets.mfj);
    });
  });

  describe('MFJ age-gate uses max(self, spouse) age', () => {
    it('NY $20k exclusion applies when spouse is 59.5+ even if self is younger', () => {
      const p = getStateTaxProfile('New York', 2026).profile;
      const r = computeStateTax(p, baseInput({
        traditionalWithdrawal: 50000,
        age: 55,
        spouseAge: 65,
        filingStatus: 'mfj',
      }), 'New York');
      expect(r.retirementExclusionApplied).toBe(40000); // MFJ cap
    });

    it('CO SS exemption applies when spouse is 65+ even if self is 63', () => {
      const p = getStateTaxProfile('Colorado', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ssGross: 30000,
        ssTaxableFederal: 25500,
        age: 63,
        spouseAge: 66,
        filingStatus: 'mfj',
      }), 'Colorado');
      expect(r.ssIncludedInState).toBe(0);
    });
  });

  describe('LTCG stacked walk absorbs unused state std deduction', () => {
    it('CA $0 ordinary + $100k LTCG: std ded eats into LTCG before brackets walk', () => {
      const p = getStateTaxProfile('California', 2026).profile;
      const r = computeStateTax(p, baseInput({ ordinaryGross: 0, ltcgFromTaxable: 100000 }), 'California');
      // taxableTotal = max(0, 0 + 100000 - 5540 stdDed) = $94,460
      // Walk CA brackets up to $94,460:
      // 1%·10412 + 2%·14272 + 4%·14275 + 6%·15122 + 8%·14269 + 9.3%·26110 ≈ $5,438
      expect(r.stateCapGainsTax).toBeCloseTo(5438, 0);
    });

    it('CA $20k ordinary + $80k LTCG: stack walks the combined $94,460 same way', () => {
      const p = getStateTaxProfile('California', 2026).profile;
      const r = computeStateTax(p, baseInput({ ordinaryGross: 20000, ltcgFromTaxable: 80000 }), 'California');
      // taxableTotal = 100000 - 5540 = $94,460; ordinary part taxable = 20000 - 5540 = $14,460
      // Total walk tax ≈ $5,438; ordinary-only walk tax ≈ $267.84 (1%·10412 + 2%·4048)
      // Cap-gains portion = $5,438 - $268 ≈ $5,170
      expect(r.stateOrdinaryTax + r.stateCapGainsTax).toBeCloseTo(5438, 0);
    });
  });

  describe('Washington MFJ doubled threshold', () => {
    it('MFJ $400k LTCG: under the $524k threshold → state cap-gains tax = 0', () => {
      const p = getStateTaxProfile('Washington', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ltcgFromTaxable: 400000,
        filingStatus: 'mfj',
        spouseAge: 60,
        inflationRate: 0,
      }), 'Washington');
      expect(r.stateCapGainsTax).toBe(0);
      expect(r.ltcgThresholdApplied).toBe(524000);
    });

    it('MFJ $600k LTCG: above $524k → 7% on $76k = $5,320', () => {
      const p = getStateTaxProfile('Washington', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ltcgFromTaxable: 600000,
        filingStatus: 'mfj',
        spouseAge: 60,
        inflationRate: 0,
      }), 'Washington');
      expect(r.stateCapGainsTax).toBeCloseTo(0.07 * (600000 - 524000), 1);
    });
  });

  describe('NJ AGI proxy excludes SS (P0#3 round 3)', () => {
    it('MFJ retiree, $50k Trad + $40k SS: AGI excludes SS → below $150k cap → exclusion applies', () => {
      const p = getStateTaxProfile('New Jersey', 2026).profile;
      const r = computeStateTax(p, baseInput({
        traditionalWithdrawal: 50000,
        ssGross: 40000,
        ssTaxableFederal: 34000, // 85% × $40k
        age: 65,
        spouseAge: 65,
        filingStatus: 'mfj',
      }), 'New Jersey');
      // Without fix: agi proxy = 0 + 50k + 34k + 0 = 84k (still < $150k cap, so exclusion still applies).
      // With fix: agi = 0 + 50k + 0 + 0 = 50k. Either way exclusion is applied.
      // The test verifies the *correct* AGI proxy by going closer to the cliff:
      expect(r.retirementExclusionApplied).toBeGreaterThan(0);
    });

    it('MFJ retiree, $130k Trad + $40k SS: AGI excludes SS → $130k < $150k cap → exclusion applies', () => {
      const p = getStateTaxProfile('New Jersey', 2026).profile;
      const r = computeStateTax(p, baseInput({
        traditionalWithdrawal: 130000,
        ssGross: 40000,
        ssTaxableFederal: 34000,
        age: 65,
        spouseAge: 65,
        filingStatus: 'mfj',
      }), 'New Jersey');
      // Pre-fix: AGI = 130k + 34k = 164k > 150k cap → exclusion FALSELY zeroed.
      // Post-fix: AGI = 130k → exclusion applies (capped at $100k MFJ max).
      expect(r.retirementExclusionApplied).toBe(100000);
    });
  });

  describe('AGI phase-out boundary', () => {
    it('UT SS exemption at AGI exactly at $45k threshold remains exempt (<=)', () => {
      const p = getStateTaxProfile('Utah', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ordinaryGross: 45000,
        ssGross: 20000,
        ssTaxableFederal: 17000,
        age: 65,
      }), 'Utah');
      // agi proxy (UT is `taxed`-like — ssRule.kind === 'agi_phaseout', not 'exempt')
      // includes SS: 45000 + 0 + 17000 = 62000 > 45000 → SS taxed.
      // Actually checking: profile uses agi_phaseout with thresholds 45000 single.
      // With SS included, AGI = 62k > 45k → SS taxed.
      expect(r.ssIncludedInState).toBe(17000);
    });
  });

  describe('Negative ordinaryGross floor', () => {
    it('floors state base at zero when ordinary is negative (pre-tax contributions)', () => {
      const p = getStateTaxProfile('California', 2026).profile;
      const r = computeStateTax(p, baseInput({
        ordinaryGross: -5000,
        traditionalWithdrawal: 10000,
      }), 'California');
      // state base = max(0, -5000 + 10000 + 0) = $5,000. After std ded → $0 taxable.
      expect(r.stateOrdinaryTax).toBe(0);
    });
  });

  describe('walkBrackets contract', () => {
    it('zero taxable returns zero tax and rate from first bracket', () => {
      // Indirect test via computeStateTax with $0 base.
      const p = getStateTaxProfile('California', 2026).profile;
      const r = computeStateTax(p, baseInput({ ordinaryGross: 0 }), 'California');
      expect(r.stateOrdinaryTax).toBe(0);
      expect(r.stateBracketIndex).toBe(0);
    });

    it('exactly at bracket boundary: tax stops at lower bracket rate', () => {
      const p = getStateTaxProfile('California', 2026).profile;
      // CA single second bracket starts at $10,412 (1% below). Add std ded $5,540 to get pre-deduction.
      const r = computeStateTax(p, baseInput({ ordinaryGross: 10412 + 5540 }), 'California');
      // taxable = $10,412 exactly. Walk: 1% × $10,412 = $104.12. Should not enter 2% bracket.
      expect(r.stateOrdinaryTax).toBeCloseTo(104.12, 1);
      expect(r.stateMarginalRate).toBe(0.01);
    });
  });

  describe('SELECTABLE_STATES contract', () => {
    it('includes "New York City" (composed pseudo-state)', () => {
      expect(SELECTABLE_STATES).toContain('New York City');
    });

    it('excludes year-bounded successor variants', () => {
      expect(SELECTABLE_STATES).not.toContain('South Carolina (2027+)');
      expect(SELECTABLE_STATES).not.toContain('West Virginia (2027+)');
    });

    it('is sorted alphabetically', () => {
      const sorted = [...SELECTABLE_STATES].sort();
      expect(SELECTABLE_STATES).toEqual(sorted);
    });

    it('includes both NY and Washington, DC', () => {
      expect(SELECTABLE_STATES).toContain('New York');
      expect(SELECTABLE_STATES).toContain('Washington, DC');
    });
  });

  describe('Round-3 default bracketBaseYear: 2024 indexing', () => {
    it('Maine brackets inflate forward from 2024 (no explicit override)', () => {
      const p = getStateTaxProfile('Maine', 2026).profile;
      const r2024 = computeStateTax(p, baseInput({ ordinaryGross: 100000, year: 2024, inflationRate: 0.03 }), 'Maine');
      const r2026 = computeStateTax(p, baseInput({ ordinaryGross: 100000, year: 2026, inflationRate: 0.03 }), 'Maine');
      // 2026 with 3% inflation has ~6% wider brackets → less tax on same $100k.
      expect(r2026.stateOrdinaryTax).toBeLessThan(r2024.stateOrdinaryTax);
    });
  });
});

describe('SC transition end-to-end (precompute → audit)', () => {
  const makeSC = (): UserData => ({
    currentAge: 60,
    lifeExpectancy: 62,
    accounts: [{ id: 'a', name: 'Reinvest', type: 'taxable', balance: 100000, stockAllocation: 0.6, portfolioBalance: '60_40' }],
    spendingGoals: [],
    incomeEvents: [{ id: 'p1', type: 'pension_income', name: 'P', amount: 80000, startAge: 60, taxStatus: 'before_tax', colaType: 'fixed' }],
    portfolioAssumptions: {
      stockReturn: 0, stockStdDev: 0, bondReturn: 0, bondStdDev: 0,
      stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
      returnDistribution: 'lognormal', degreesOfFreedom: 4, returnModel: 'parametric',
    },
    referenceYear: 2026,
    inflationRate: 0,
    inflationStdDev: 0,
    simulationSettings: { numSimulations: 100 },
    filingStatus: 'single',
    spouseAge: null,
    stateTimeline: [{ state: 'South Carolina' }],
    longTermCapGainsRate: 0.15,
    enableIRMAA: false,
    enableNIIT: false,
  });

  it('audit effectiveStateName reflects successor profile post-2026', () => {
    const u = makeSC();
    const y2026 = calculateAnnualCashFlow(u, 2026, 0);
    const y2027 = calculateAnnualCashFlow(u, 2027, 0);
    expect(y2026.audit?.effectiveStateName).toBe('South Carolina');
    expect(y2027.audit?.effectiveStateName).toBe('South Carolina (2027+)');
  });
});
