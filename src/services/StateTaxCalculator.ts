// Per-state ordinary + LTCG tax calculation. Replaces the prior
// flat `stateGross × rate` model. Consumes a StateTaxProfile (see
// `src/data/stateTaxProfiles.ts`) and a per-year input describing the income
// composition that's relevant to state-level rules.
//
// State rules differ from federal in three structurally significant ways:
//   1. SS taxability varies by state (some never tax, some tax federal-taxable
//      portion, some phase out by AGI, some exempt for age 65+).
//   2. "Retirement income exclusions" let states exempt Traditional withdrawals
//      and pensions up to a per-state amount (sometimes age- or AGI-gated).
//   3. Capital-gains treatment varies: most piggyback ordinary brackets, MO
//      fully exempts, WA imposes a flat threshold-based rate with no ordinary tax.
//
// The computation:
//   stateOrdinaryBase = ordinaryGross
//                     + (SS rule includes? ssTaxableFederal : 0)
//                     + (traditionalWithdrawal − retirementExclusionApplied)
//   stateTaxableOrdinary = max(0, stateOrdinaryBase − stateStdDed)
//   stateOrdinaryTax = walk(brackets, stateTaxableOrdinary)
//   stateCapGainsTax = ltcgRule(ltcgFromBrokerage, filingStatus, year)
//   localitySurcharge = optional NYC layer
//
// Limitations: see header notes in stateTaxProfiles.ts. HoH/MFS map to single
// brackets. AGI phase-outs are step functions (not graded). Age-gated rules
// honor `age` only (not the spouse's age) — for MFJ households the higher of
// the two ages typically qualifies for senior exclusions, so we approximate by
// using `max(age, spouseAge ?? 0)` when the filing status is MFJ.

import type { FilingStatus } from './TaxCalculator';
import {
  type StateTaxProfile,
  type StateBracket,
  type FilingPair,
  profileInflationFactor,
} from '../data/stateTaxProfiles';

export interface StateTaxInput {
  /** Wages + non-SS, non-Traditional ordinary income (after pre-tax 401k contributions deducted). */
  ordinaryGross: number;
  /** Federal taxable portion of Social Security (drives state inclusion when ssRule is `taxed`). */
  ssTaxableFederal: number;
  /** Gross Social Security (used for AGI-phaseout tests). */
  ssGross: number;
  /** Traditional account withdrawal (subject to retirement-income exclusion). */
  traditionalWithdrawal: number;
  /** Realized LTCG (state cap-gains treatment). */
  ltcgFromBrokerage: number;
  /** Primary filer age (for age-gated SS/retirement exclusions). */
  age: number;
  /** Spouse age (used for MFJ senior age-gate approximation). */
  spouseAge: number | null;
  filingStatus: FilingStatus;
  year: number;
  /** Annual inflation rate used to inflate state brackets, deductions, and LTCG thresholds. */
  inflationRate: number;
  /** Optional user override: true = disable the profile's retirement exclusion (Trad withdrawals fully exposed to state tax). */
  disableStateRetirementExclusion?: boolean;
}

export interface StateTaxResult {
  stateOrdinaryTax: number;
  stateCapGainsTax: number;
  stateLocalitySurcharge: number;
  /** Topmost bracket rate that this year's taxable ordinary income reached. 0 when no brackets. */
  stateMarginalRate: number;
  /** Index into the profile's per-filing-status bracket array (0 = lowest). */
  stateBracketIndex: number;
  /** State ordinary base BEFORE std deduction: ordinaryGross + (Trad − exclusion) + (SS if included). */
  stateOrdinaryBaseGross: number;
  /** Inflation-indexed state standard deduction applied this year. */
  stateStdDeduction: number;
  /** Dollars of Traditional withdrawal excluded by the profile's retirement-income exclusion. */
  retirementExclusionApplied: number;
  /** Dollars of SS taxable portion that ended up in the state ordinary base. */
  ssIncludedInState: number;
  /** Dollars of LTCG actually taxed at the state level after threshold/exemption logic. */
  ltcgTaxableAtState: number;
  /** Inflation-indexed LTCG threshold used (WA); 0 when not applicable. */
  ltcgThresholdApplied: number;
  /** Resolved profile key (may differ from input state name when a successor profile applied, e.g. "South Carolina (2027+)"). User-facing in the audit panel. */
  effectiveStateName: string;
  /** Caveats surfaced to the audit UI ("approximated", etc.). */
  notes?: string;
}

// -------- helpers --------

function pickFilingPair<T>(pair: FilingPair<T>, status: FilingStatus): T {
  // HoH and MFS map to single in this simplified model.
  return status === 'mfj' ? pair.mfj : pair.single;
}

function walkBrackets(brackets: StateBracket[], taxable: number, factor: number): {
  tax: number;
  bracketIndex: number;
  marginalRate: number;
} {
  if (brackets.length === 0 || taxable <= 0) return { tax: 0, bracketIndex: 0, marginalRate: brackets[0]?.rate ?? 0 };
  let tax = 0;
  let bracketIndex = 0;
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    const next = brackets[i + 1];
    const lower = b.threshold * factor;
    const upper = next ? next.threshold * factor : Infinity;
    if (taxable <= lower) break;
    const amountInBracket = Math.max(0, Math.min(taxable, upper) - lower);
    tax += amountInBracket * b.rate;
    bracketIndex = i;
    if (taxable <= upper) break;
  }
  return { tax, bracketIndex, marginalRate: brackets[bracketIndex].rate };
}

/**
 * State-AGI proxy used by SS phase-out and retirement-exclusion phase-out
 * tests. When SS is treated as exempt under the state's ssRule, SS is also
 * excluded from the state's AGI for these tests (matches NJ's gross-income
 * definition). When SS is state-taxed, federal-taxable SS is included.
 */
function stateAgiProxy(profile: StateTaxProfile, input: StateTaxInput): number {
  const includeSS = profile.ssRule.kind !== 'exempt';
  return input.ordinaryGross
    + input.traditionalWithdrawal
    + (includeSS ? input.ssTaxableFederal : 0)
    + input.ltcgFromBrokerage;
}

function applySSRule(profile: StateTaxProfile, input: StateTaxInput): number {
  switch (profile.ssRule.kind) {
    case 'exempt': return 0;
    case 'taxed': return input.ssTaxableFederal;
    case 'exempt_if_age': {
      const seniorAge = input.filingStatus === 'mfj' && input.spouseAge !== null
        ? Math.max(input.age, input.spouseAge)
        : input.age;
      return seniorAge >= profile.ssRule.age ? 0 : input.ssTaxableFederal;
    }
    case 'agi_phaseout': {
      const thresh = pickFilingPair(profile.ssRule.thresholds, input.filingStatus);
      const agi = stateAgiProxy(profile, input);
      return agi <= thresh ? 0 : input.ssTaxableFederal;
    }
  }
}

function applyRetirementExclusion(profile: StateTaxProfile, input: StateTaxInput): number {
  if (input.disableStateRetirementExclusion === true) return 0;
  const rule = profile.retirementExclusion;
  if (rule.kind === 'none') return 0;
  if (input.traditionalWithdrawal <= 0) return 0;
  const seniorAge = input.filingStatus === 'mfj' && input.spouseAge !== null
    ? Math.max(input.age, input.spouseAge)
    : input.age;
  if (rule.kind === 'full') {
    if (rule.ageThreshold !== undefined && seniorAge < rule.ageThreshold) return 0;
    return input.traditionalWithdrawal;
  }
  if (rule.kind === 'amount') {
    if (rule.ageThreshold !== undefined && seniorAge < rule.ageThreshold) return 0;
    const cap = pickFilingPair(rule.amount, input.filingStatus);
    return Math.min(input.traditionalWithdrawal, cap);
  }
  if (rule.kind === 'agi_phaseout') {
    if (rule.ageThreshold !== undefined && seniorAge < rule.ageThreshold) return 0;
    const agi = stateAgiProxy(profile, input);
    const cap = pickFilingPair(rule.agiCap, input.filingStatus);
    if (agi > cap) return 0; // hard cliff (NJ-style)
    const max = pickFilingPair(rule.max, input.filingStatus);
    return Math.min(input.traditionalWithdrawal, max);
  }
  return 0;
}

// Handles the non-`ordinary` LTCG rules (`exempt`, `threshold`). The `ordinary`
// case is computed inline in `computeStateTax` via a stacked bracket walk.
// `factor` is the LTCG-threshold-specific inflation factor (independent of
// bracket inflation indexing — WA has frozen-bracket / indexed-threshold).
function applyLtcgRule(
  profile: StateTaxProfile,
  input: StateTaxInput,
  ltcgFactor: number,
): { capGainsTax: number; ltcgTaxableAtState: number; thresholdApplied: number } {
  const ltcg = Math.max(0, input.ltcgFromBrokerage);
  if (ltcg === 0) return { capGainsTax: 0, ltcgTaxableAtState: 0, thresholdApplied: 0 };
  switch (profile.ltcgRule.kind) {
    case 'exempt':
      return { capGainsTax: 0, ltcgTaxableAtState: 0, thresholdApplied: 0 };
    case 'threshold': {
      const baseThresh = pickFilingPair(profile.ltcgRule.threshold, input.filingStatus);
      const indexedThresh = profile.ltcgRule.inflationIndexed ? baseThresh * ltcgFactor : baseThresh;
      const taxable = Math.max(0, ltcg - indexedThresh);
      return {
        capGainsTax: taxable * profile.ltcgRule.rate,
        ltcgTaxableAtState: taxable,
        thresholdApplied: indexedThresh,
      };
    }
    case 'ordinary':
      // The `ordinary` case is handled inline in `computeStateTax` (it needs the
      // ordinary bracket-walk context). Reaching here would be a logic bug —
      // throw rather than silently return NaN.
      throw new Error('applyLtcgRule called with ordinary LTCG rule (handled inline by caller)');
  }
}

// -------- public entry point --------

export function computeStateTax(
  profile: StateTaxProfile,
  input: StateTaxInput,
  resolvedKey: string,
): StateTaxResult {
  const factor = profileInflationFactor(profile, input.year, input.inflationRate);
  // LTCG threshold (WA-style) inflation-indexes independently of brackets:
  // WA freezes nothing about the threshold — it's CPI-indexed annually — even
  // though `bracketsInflationIndexed` is false for WA (which has no brackets).
  // Anchor: 2024 indexed value $270k (RCW 82.87.060, statutory base $250k @
  // 2021, CPI-indexed); subsequent values index forward from 2024.
  const ltcgBaseYear = 2024;
  const ltcgFactor = input.inflationRate && input.year > ltcgBaseYear
    ? Math.pow(1 + input.inflationRate, input.year - ltcgBaseYear)
    : 1;

  // 1. State ordinary base composition
  const ssIncludedInState = applySSRule(profile, input);
  const retirementExclusionApplied = applyRetirementExclusion(profile, input);
  const tradAfterExclusion = Math.max(0, input.traditionalWithdrawal - retirementExclusionApplied);
  const stateOrdinaryBaseGross = Math.max(0, input.ordinaryGross + tradAfterExclusion + ssIncludedInState);

  // 2. State standard deduction (inflation-indexed)
  const stdDedRaw = pickFilingPair(profile.standardDeduction, input.filingStatus) ?? 0;
  const stateStdDeduction = stdDedRaw * factor;
  const stateTaxableOrdinary = Math.max(0, stateOrdinaryBaseGross - stateStdDeduction);

  // 3. Walk state brackets for ordinary
  const brackets = pickFilingPair(profile.brackets, input.filingStatus);
  const ordinaryWalk = walkBrackets(brackets, stateTaxableOrdinary, factor);

  // 4. Cap gains
  let stateCapGainsTax = 0;
  let ltcgTaxableAtState = 0;
  let ltcgThresholdApplied = 0;
  if (profile.ltcgRule.kind === 'ordinary') {
    if (input.ltcgFromBrokerage > 0 && brackets.length > 0) {
      // Stack LTCG on the *pre-deduction* ordinary base + LTCG, then subtract
      // the std deduction once. This way residual deduction (when ordinary <
      // stdDed) correctly absorbs into LTCG before walking brackets.
      const totalTaxable = Math.max(0, stateOrdinaryBaseGross + input.ltcgFromBrokerage - stateStdDeduction);
      const stackedWalk = walkBrackets(brackets, totalTaxable, factor);
      stateCapGainsTax = Math.max(0, stackedWalk.tax - ordinaryWalk.tax);
      ltcgTaxableAtState = input.ltcgFromBrokerage;
    }
  } else {
    const ltcgRes = applyLtcgRule(profile, input, ltcgFactor);
    stateCapGainsTax = ltcgRes.capGainsTax;
    ltcgTaxableAtState = ltcgRes.ltcgTaxableAtState;
    ltcgThresholdApplied = ltcgRes.thresholdApplied;
  }

  // 5. Locality surcharge (NYC). When `appliesToOrdinaryOnly`, only on ordinary base;
  // otherwise on ordinary + LTCG base (NYC behavior).
  let stateLocalitySurcharge = 0;
  if (profile.localitySurcharge) {
    const base = profile.localitySurcharge.appliesToOrdinaryOnly
      ? stateTaxableOrdinary
      : stateTaxableOrdinary + input.ltcgFromBrokerage;
    stateLocalitySurcharge = base * profile.localitySurcharge.rate;
  }

  return {
    stateOrdinaryTax: ordinaryWalk.tax,
    stateCapGainsTax,
    stateLocalitySurcharge,
    stateMarginalRate: ordinaryWalk.marginalRate,
    stateBracketIndex: ordinaryWalk.bracketIndex,
    stateOrdinaryBaseGross,
    stateStdDeduction,
    retirementExclusionApplied,
    ssIncludedInState,
    ltcgTaxableAtState,
    ltcgThresholdApplied,
    effectiveStateName: resolvedKey,
    notes: profile.notes,
  };
}

