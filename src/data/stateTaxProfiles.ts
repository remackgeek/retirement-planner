// State income-tax profiles. Replaces the prior flat `STATE_TAX_RATES` table
// with a structured per-state profile that captures brackets, deductions, SS
// taxability, retirement-income exclusions, LTCG treatment, optional locality
// surcharge (NYC), and year-bounded successor profiles for dated transitions
// (SC top-rate sunset, WV SS phase-out).
//
// Data currency: anchored to 2024–2026 published figures. Brackets and
// deductions inflation-index forward from the profile's `bracketBaseYear` when
// `bracketsInflationIndexed` is true (most states; NY/NJ are notable
// exceptions whose statutory brackets are frozen in nominal dollars).
//
// Approximations explicitly accepted in this layer:
//  - Where bracket schedules are not encoded as multi-step (most flat-with-
//    deduction states), the profile carries a single bracket at `topRate` which
//    is applied above the state standard deduction. This is more accurate than
//    the prior flat-on-gross model but still understates the progressivity
//    that a true bracket schedule would capture for high-income retirees.
//  - "Partial" retirement-income exclusions are encoded as a single dollar
//    amount per filing status (e.g., NY $20k pension/IRA exclusion at age
//    59.5+, DE $12.5k at age 60+). Age-based / source-based exclusions that
//    differ from the simulation's lump-sum Traditional withdrawal are
//    approximated as applying to the full Traditional withdrawal up to the
//    encoded amount.
//  - HoH and MFS filing statuses share the `single` bracket and deduction.
//  - MA 4% surtax above $1M is not modeled; multistate part-year residency
//    within a year is not modeled (timeline switches are whole-year only).
//  - Local taxes other than NYC (Yonkers, OH municipal, PA local EIT) are
//    not modeled.

export interface StateBracket {
  /** Income at which this bracket begins (taxable income, post state std deduction). Lowest bracket starts at 0. */
  threshold: number;
  /** Marginal rate applied within this bracket (0..1). */
  rate: number;
}

export interface FilingPair<T> { single: T; mfj: T; }

export type SSRule =
  /** SS taxable amount is included in state ordinary base (federal taxable portion). */
  | { kind: 'taxed' }
  /** SS never taxed at the state level. */
  | { kind: 'exempt' }
  /** SS exempt when filer reaches `age`. Before that, taxed (federal taxable portion). */
  | { kind: 'exempt_if_age'; age: number }
  /** SS exempt below AGI threshold; taxed in full above. (Approximation of a phase-out.) */
  | { kind: 'agi_phaseout'; thresholds: FilingPair<number> };

export type RetirementExclusion =
  | { kind: 'none' }
  /** Traditional withdrawals + pension fully excluded from state taxable income. Optional age gate. */
  | { kind: 'full'; ageThreshold?: number }
  /** Up to `amount` of Traditional withdrawal excluded; optional age gate. */
  | { kind: 'amount'; amount: FilingPair<number>; ageThreshold?: number }
  /** NJ-style: full pension/IRA exclusion up to AGI cap; zero above. */
  | { kind: 'agi_phaseout'; max: FilingPair<number>; agiCap: FilingPair<number>; ageThreshold?: number };

export type LtcgRule =
  /** Apply state ordinary bracket schedule to LTCG (most states). */
  | { kind: 'ordinary' }
  /** LTCG fully exempt (Missouri). */
  | { kind: 'exempt' }
  /** Flat-rate state cap-gains tax above an inflation-indexed threshold (Washington). */
  | { kind: 'threshold'; rate: number; threshold: FilingPair<number>; inflationIndexed: boolean };

export interface StateTaxProfile {
  taxType: 'none' | 'flat' | 'graduated' | 'capital-gains-only';
  /** Per-filing-status bracket schedule. Empty arrays for `none`. */
  brackets: FilingPair<StateBracket[]>;
  /** State standard deduction (null = no statutory standard deduction; treated as 0). */
  standardDeduction: FilingPair<number | null>;
  ssRule: SSRule;
  retirementExclusion: RetirementExclusion;
  ltcgRule: LtcgRule;
  /** Optional municipal/local surcharge (NYC). Applied to ordinary state taxable base only when `appliesToOrdinaryOnly`. */
  localitySurcharge?: { rate: number; appliesToOrdinaryOnly: boolean };
  /** When true, brackets + std deduction + LTCG threshold inflate from `bracketBaseYear`. */
  bracketsInflationIndexed: boolean;
  bracketBaseYear: number;
  /** Inclusive year range during which this profile applies. Omitting both fields means "always". */
  effectiveYears?: { start?: number; end?: number };
  /** Key in STATE_TAX_PROFILES to fall through to once `year > effectiveYears.end`. */
  successorProfileKey?: string;
  /** Short label used by audit/UI (e.g., "Top 13.3% · SS exempt · No retirement exclusion"). */
  summary?: string;
  notes?: string;
}

// ---------------- helper to keep data dense ----------------

const NONE_PROFILE = (key: string): StateTaxProfile => ({
  taxType: 'none',
  brackets: { single: [], mfj: [] },
  standardDeduction: { single: null, mfj: null },
  ssRule: { kind: 'exempt' },
  // No ordinary brackets exist for no-tax states, so this field is unused.
  // `'none'` is more honest than `'full'` (which would imply explicit exclusion).
  retirementExclusion: { kind: 'none' },
  ltcgRule: { kind: 'ordinary' }, // ordinary rate is 0 since no brackets
  bracketsInflationIndexed: false,
  bracketBaseYear: 2026,
  summary: `${key} — no state income tax`,
});

/**
 * Build a single-bracket "flat" profile. Used for states that have a flat
 * rate, and also as a fallback for graduated states where bracket data is
 * not yet encoded (the single bracket is applied above the state standard
 * deduction — already a substantial improvement over flat-on-gross).
 */
function flatProfile(opts: {
  rate: number;
  stdDed: FilingPair<number | null>;
  ssRule?: SSRule;
  retirementExclusion?: RetirementExclusion;
  ltcgRule?: LtcgRule;
  bracketsInflationIndexed?: boolean;
  bracketBaseYear?: number;
  effectiveYears?: { start?: number; end?: number };
  successorProfileKey?: string;
  summary?: string;
  notes?: string;
}): StateTaxProfile {
  return {
    taxType: 'flat',
    brackets: {
      single: [{ threshold: 0, rate: opts.rate }],
      mfj: [{ threshold: 0, rate: opts.rate }],
    },
    standardDeduction: opts.stdDed,
    ssRule: opts.ssRule ?? { kind: 'exempt' },
    retirementExclusion: opts.retirementExclusion ?? { kind: 'none' },
    ltcgRule: opts.ltcgRule ?? { kind: 'ordinary' },
    bracketsInflationIndexed: opts.bracketsInflationIndexed ?? true,
    bracketBaseYear: opts.bracketBaseYear ?? 2026,
    effectiveYears: opts.effectiveYears,
    successorProfileKey: opts.successorProfileKey,
    summary: opts.summary,
    notes: opts.notes,
  };
}

function graduatedProfile(opts: {
  brackets: FilingPair<StateBracket[]>;
  stdDed: FilingPair<number | null>;
  ssRule?: SSRule;
  retirementExclusion?: RetirementExclusion;
  ltcgRule?: LtcgRule;
  bracketsInflationIndexed?: boolean;
  bracketBaseYear?: number;
  summary?: string;
  notes?: string;
}): StateTaxProfile {
  return {
    taxType: 'graduated',
    brackets: opts.brackets,
    standardDeduction: opts.stdDed,
    ssRule: opts.ssRule ?? { kind: 'exempt' },
    retirementExclusion: opts.retirementExclusion ?? { kind: 'none' },
    ltcgRule: opts.ltcgRule ?? { kind: 'ordinary' },
    bracketsInflationIndexed: opts.bracketsInflationIndexed ?? true,
    // Default graduated-profile base year is 2024 — most encoded bracket data
    // comes from 2024 DOR/Tax-Foundation publications. Profiles with statutory
    // frozen brackets (NY, NJ) override via `bracketsInflationIndexed: false`,
    // in which case the base year is moot. Explicit overrides (e.g. SC 2027+
    // successor) still win.
    bracketBaseYear: opts.bracketBaseYear ?? 2024,
    summary: opts.summary,
    notes: opts.notes,
  };
}

// ---------------- the profile table ----------------

export const STATE_TAX_PROFILES: Record<string, StateTaxProfile> = {
  'Alabama': flatProfile({
    rate: 0.05, // top rate; AL is graduated 2%/4%/5% but ~99% of retiree income lands at top — approximated as flat
    stdDed: { single: 3000, mfj: 8500 },
    retirementExclusion: { kind: 'amount', amount: { single: 6000, mfj: 12000 } },
    summary: 'Top 5% · SS exempt · $6k retirement exclusion',
    notes: 'AL graduated 2%/4%/5% approximated as flat at top. Defined-benefit pensions further excluded.',
  }),
  'Alaska': NONE_PROFILE('Alaska'),
  'Arizona': flatProfile({
    rate: 0.025,
    stdDed: { single: 14600, mfj: 29200 }, // AZ uses federal std ded
    retirementExclusion: { kind: 'amount', amount: { single: 2500, mfj: 5000 } },
    summary: 'Flat 2.5% · SS exempt · $2.5k retirement exclusion',
  }),
  'Arkansas': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0 },
        { threshold: 5300, rate: 0.02 },
        { threshold: 10600, rate: 0.03 },
        { threshold: 15100, rate: 0.039 },
      ],
      mfj: [
        { threshold: 0, rate: 0 },
        { threshold: 5300, rate: 0.02 },
        { threshold: 10600, rate: 0.03 },
        { threshold: 15100, rate: 0.039 },
      ],
    },
    stdDed: { single: 2270, mfj: 4540 },
    retirementExclusion: { kind: 'amount', amount: { single: 6000, mfj: 12000 } },
    summary: 'Top 3.9% · SS exempt · $6k retirement exclusion',
  }),
  'California': graduatedProfile({
    // 2024 single brackets (FTB tax year 2024; CA inflation-indexes annually, so
    // bracketsInflationIndexed handles forward years). MFJ = 2× single, with the
    // statutory $1M Mental Health surcharge (+1%) boundary interleaved.
    brackets: {
      single: [
        { threshold: 0, rate: 0.01 },
        { threshold: 10756, rate: 0.02 },
        { threshold: 25499, rate: 0.04 },
        { threshold: 40245, rate: 0.06 },
        { threshold: 55866, rate: 0.08 },
        { threshold: 70606, rate: 0.093 },
        { threshold: 360659, rate: 0.103 },
        { threshold: 432787, rate: 0.113 },
        { threshold: 721314, rate: 0.123 },
        { threshold: 1000000, rate: 0.133 }, // 12.3% + 1% Mental Health surcharge
      ],
      mfj: [
        { threshold: 0, rate: 0.01 },
        { threshold: 21512, rate: 0.02 },
        { threshold: 50998, rate: 0.04 },
        { threshold: 80490, rate: 0.06 },
        { threshold: 111732, rate: 0.08 },
        { threshold: 141212, rate: 0.093 },
        { threshold: 721318, rate: 0.103 },
        { threshold: 865574, rate: 0.113 },
        { threshold: 1000000, rate: 0.123 }, // 11.3% statutory + 1% Mental Health surcharge
        { threshold: 1442628, rate: 0.133 }, // 12.3% statutory + 1% Mental Health surcharge
      ],
    },
    stdDed: { single: 5540, mfj: 11080 },
    retirementExclusion: { kind: 'none' },
    bracketBaseYear: 2024,
    summary: 'Graduated 1–13.3% · SS exempt · No retirement exclusion',
    notes: 'CA fully exempts Social Security but taxes all other retirement income at ordinary brackets.',
  }),
  'Colorado': flatProfile({
    rate: 0.044,
    stdDed: { single: 16100, mfj: 32200 }, // CO uses federal std ded
    ssRule: { kind: 'exempt_if_age', age: 65 }, // CO 2023+: full SS exemption for 65+; under-65 partial
    // CO actually tiers: $20k @ 55-64, $24k @ 65+ (uncapped above $24k for 65+).
    // Modeled at the 65+ tier since most retiree users are 65+; slightly under-models the 55-64 case.
    retirementExclusion: { kind: 'amount', amount: { single: 24000, mfj: 48000 }, ageThreshold: 55 },
    summary: 'Flat 4.4% · SS exempt 65+ · $24k/$48k retirement exclusion (55+, approx; CO law is tiered)',
  }),
  'Connecticut': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.02 },
        { threshold: 10000, rate: 0.045 },
        { threshold: 50000, rate: 0.055 },
        { threshold: 100000, rate: 0.06 },
        { threshold: 200000, rate: 0.065 },
        { threshold: 250000, rate: 0.069 },
        { threshold: 500000, rate: 0.0699 },
      ],
      mfj: [
        { threshold: 0, rate: 0.02 },
        { threshold: 20000, rate: 0.045 },
        { threshold: 100000, rate: 0.055 },
        { threshold: 200000, rate: 0.06 },
        { threshold: 400000, rate: 0.065 },
        { threshold: 500000, rate: 0.069 },
        { threshold: 1000000, rate: 0.0699 },
      ],
    },
    stdDed: { single: null, mfj: null }, // CT has no statutory standard deduction
    ssRule: { kind: 'agi_phaseout', thresholds: { single: 75000, mfj: 100000 } },
    retirementExclusion: { kind: 'agi_phaseout', max: { single: 75000, mfj: 100000 }, agiCap: { single: 75000, mfj: 100000 } },
    summary: 'Graduated 2–6.99% · SS partial · Pension exclusion below AGI cap',
    notes: 'CT exempts SS below $75k/$100k AGI; pension exclusion uses the same AGI cap by coincidence. Real CT pension exclusion has a graded phase-out, modeled here as a hard cliff for simplicity.',
  }),
  'Delaware': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0 },
        { threshold: 2000, rate: 0.022 },
        { threshold: 5000, rate: 0.039 },
        { threshold: 10000, rate: 0.048 },
        { threshold: 20000, rate: 0.052 },
        { threshold: 25000, rate: 0.0555 },
        { threshold: 60000, rate: 0.066 },
      ],
      mfj: [
        { threshold: 0, rate: 0 },
        { threshold: 2000, rate: 0.022 },
        { threshold: 5000, rate: 0.039 },
        { threshold: 10000, rate: 0.048 },
        { threshold: 20000, rate: 0.052 },
        { threshold: 25000, rate: 0.0555 },
        { threshold: 60000, rate: 0.066 },
      ],
    },
    stdDed: { single: 3250, mfj: 6500 },
    retirementExclusion: { kind: 'amount', amount: { single: 12500, mfj: 25000 }, ageThreshold: 60 },
    summary: 'Graduated 0–6.6% · SS exempt · $12.5k retirement exclusion (60+)',
  }),
  'Florida': NONE_PROFILE('Florida'),
  'Georgia': flatProfile({
    rate: 0.0519, // GA moved to flat 5.39% (2024), trending toward 5.19% (2026 projection); use 2026 value
    stdDed: { single: 12000, mfj: 24000 },
    retirementExclusion: { kind: 'amount', amount: { single: 65000, mfj: 130000 }, ageThreshold: 65 },
    summary: 'Flat 5.19% · SS exempt · $65k/$130k retirement exclusion (65+)',
    notes: 'GA exempts up to $65k retirement income for 65+ (lower at 62–64).',
  }),
  'Hawaii': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.014 },
        { threshold: 2400, rate: 0.032 },
        { threshold: 4800, rate: 0.055 },
        { threshold: 9600, rate: 0.064 },
        { threshold: 14400, rate: 0.068 },
        { threshold: 19200, rate: 0.072 },
        { threshold: 24000, rate: 0.076 },
        { threshold: 36000, rate: 0.079 },
        { threshold: 48000, rate: 0.0825 },
        { threshold: 150000, rate: 0.09 },
        { threshold: 175000, rate: 0.10 },
        { threshold: 200000, rate: 0.11 },
      ],
      mfj: [
        { threshold: 0, rate: 0.014 },
        { threshold: 4800, rate: 0.032 },
        { threshold: 9600, rate: 0.055 },
        { threshold: 19200, rate: 0.064 },
        { threshold: 28800, rate: 0.068 },
        { threshold: 38400, rate: 0.072 },
        { threshold: 48000, rate: 0.076 },
        { threshold: 72000, rate: 0.079 },
        { threshold: 96000, rate: 0.0825 },
        { threshold: 300000, rate: 0.09 },
        { threshold: 350000, rate: 0.10 },
        { threshold: 400000, rate: 0.11 },
      ],
    },
    stdDed: { single: 2200, mfj: 4400 },
    // HI exempts employer-funded pensions in full, but taxes IRA/401(k) distributions normally.
    // Approximating as `none` is more conservative for the typical retiree who holds Traditional IRA/401(k) balances;
    // those with majority public/private DB-pension income will be slightly overstated here.
    retirementExclusion: { kind: 'none' },
    summary: 'Graduated 1.4–11% · SS exempt · No IRA/401(k) exclusion (DB pensions exempt; not modeled separately)',
    notes: 'HI exempts employer-funded DB pensions but taxes IRA/401(k) distributions. Modeled as no exclusion since the simulation does not distinguish pension sources.',
  }),
  'Idaho': flatProfile({
    rate: 0.053,
    stdDed: { single: 14600, mfj: 29200 }, // ID uses federal std ded
    summary: 'Flat 5.3% · SS exempt',
  }),
  'Illinois': flatProfile({
    rate: 0.0495,
    stdDed: { single: null, mfj: null },
    retirementExclusion: { kind: 'full' },
    summary: 'Flat 4.95% · SS exempt · All retirement income exempt',
  }),
  'Indiana': flatProfile({
    rate: 0.0295, // IN flat rate falling; 2026 ~2.9%
    stdDed: { single: 1000, mfj: 2000 }, // personal exemption proxy
    summary: 'Flat 2.95% · SS exempt',
  }),
  'Iowa': flatProfile({
    rate: 0.039, // IA moved to flat 3.9% by 2026
    stdDed: { single: 2470, mfj: 6090 },
    // IA exempts retirement income at age 55+ (not unconditional). Modeling under-55 cases requires
    // the ageThreshold gate so younger Traditional withdrawals are correctly taxed.
    retirementExclusion: { kind: 'full', ageThreshold: 55 },
    ssRule: { kind: 'exempt' },
    summary: 'Flat 3.9% · SS exempt · Retirement income exempt (55+)',
  }),
  'Kansas': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.031 },
        { threshold: 15000, rate: 0.0525 },
        { threshold: 30000, rate: 0.057 },
      ],
      mfj: [
        { threshold: 0, rate: 0.031 },
        { threshold: 30000, rate: 0.0525 },
        { threshold: 60000, rate: 0.057 },
      ],
    },
    stdDed: { single: 3500, mfj: 8000 },
    summary: 'Graduated 3.1–5.7% · SS exempt (below $75k AGI; approx as always)',
    ssRule: { kind: 'agi_phaseout', thresholds: { single: 75000, mfj: 75000 } },
  }),
  'Kentucky': flatProfile({
    rate: 0.035, // KY trending down: 2026 ~3.5%
    stdDed: { single: 3160, mfj: 6320 },
    retirementExclusion: { kind: 'amount', amount: { single: 31110, mfj: 62220 } },
    summary: 'Flat 3.5% · SS exempt · $31k retirement exclusion',
  }),
  'Louisiana': flatProfile({
    // LA enacted a flat 3% individual income tax effective 2025 (HB10/2024). Using the 2025+ rate.
    rate: 0.03,
    stdDed: { single: 12500, mfj: 25000 }, // LA 2025 std ded: $12,500 single / $25,000 MFJ
    retirementExclusion: { kind: 'amount', amount: { single: 6000, mfj: 12000 }, ageThreshold: 65 },
    summary: 'Flat 3% (2025+) · SS exempt · $6k retirement exclusion (65+)',
  }),
  'Maine': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.058 },
        { threshold: 26800, rate: 0.0675 },
        { threshold: 63450, rate: 0.0715 },
      ],
      mfj: [
        { threshold: 0, rate: 0.058 },
        { threshold: 53600, rate: 0.0675 },
        { threshold: 126900, rate: 0.0715 },
      ],
    },
    stdDed: { single: 14600, mfj: 29200 }, // ME mirrors federal std ded
    retirementExclusion: { kind: 'amount', amount: { single: 30000, mfj: 60000 } },
    summary: 'Graduated 5.8–7.15% · SS exempt · $30k pension exclusion',
  }),
  'Maryland': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.02 },
        { threshold: 1000, rate: 0.03 },
        { threshold: 2000, rate: 0.04 },
        { threshold: 3000, rate: 0.0475 },
        { threshold: 100000, rate: 0.05 },
        { threshold: 125000, rate: 0.0525 },
        { threshold: 150000, rate: 0.055 },
        { threshold: 250000, rate: 0.0575 }, // top combined with avg county ~3.2% gives notes-cited ~6.5%; bracket here is state-only
      ],
      mfj: [
        { threshold: 0, rate: 0.02 },
        { threshold: 1000, rate: 0.03 },
        { threshold: 2000, rate: 0.04 },
        { threshold: 3000, rate: 0.0475 },
        { threshold: 150000, rate: 0.05 },
        { threshold: 175000, rate: 0.0525 },
        { threshold: 225000, rate: 0.055 },
        { threshold: 300000, rate: 0.0575 },
      ],
    },
    stdDed: { single: 2400, mfj: 4850 },
    retirementExclusion: { kind: 'amount', amount: { single: 36200, mfj: 72400 }, ageThreshold: 65 },
    summary: 'Graduated 2–5.75% · SS exempt · $36k retirement exclusion (65+)',
    notes: 'Local (county) tax of ~2.25–3.2% not modeled; bracket is state-only.',
  }),
  'Massachusetts': flatProfile({
    rate: 0.05,
    // MA has no statutory standard deduction; use personal exemption as deduction proxy ($4,400 single / $8,800 MFJ).
    stdDed: { single: 4400, mfj: 8800 },
    retirementExclusion: { kind: 'amount', amount: { single: 2000, mfj: 4000 } }, // small pension exclusion
    summary: 'Flat 5% · SS exempt · Small retirement exclusion',
    notes: 'MA 4% surtax above $1M not modeled. Personal exemption used as std-deduction proxy.',
  }),
  'Michigan': flatProfile({
    rate: 0.0425,
    stdDed: { single: 5400, mfj: 10800 }, // MI personal exemption proxy
    retirementExclusion: { kind: 'full', ageThreshold: 67 }, // age 67+ full
    summary: 'Flat 4.25% · SS exempt · Retirement income exempt (67+)',
    notes: 'MI 2024+ phases in full retirement exclusion; full at age 67+.',
  }),
  'Minnesota': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.0535 },
        { threshold: 31690, rate: 0.068 },
        { threshold: 104090, rate: 0.0785 },
        { threshold: 193240, rate: 0.0985 },
      ],
      mfj: [
        { threshold: 0, rate: 0.0535 },
        { threshold: 46330, rate: 0.068 },
        { threshold: 184040, rate: 0.0785 },
        { threshold: 321450, rate: 0.0985 },
      ],
    },
    stdDed: { single: 14575, mfj: 29150 },
    ssRule: { kind: 'agi_phaseout', thresholds: { single: 105380, mfj: 134510 } },
    summary: 'Graduated 5.35–9.85% · SS phased out by AGI · No retirement exclusion',
  }),
  'Mississippi': flatProfile({
    rate: 0.04, // MS phase-down: 2024 4.7% → 2025 4.4% → 2026 4.0% (scheduled).
    stdDed: { single: 2300, mfj: 4600 },
    retirementExclusion: { kind: 'full' },
    summary: 'Flat 4% · SS exempt · All retirement income exempt',
  }),
  'Missouri': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0 },
        { threshold: 1207, rate: 0.02 },
        { threshold: 2414, rate: 0.025 },
        { threshold: 3621, rate: 0.03 },
        { threshold: 4828, rate: 0.035 },
        { threshold: 6035, rate: 0.04 },
        { threshold: 7242, rate: 0.045 },
        { threshold: 8449, rate: 0.048 },
      ],
      mfj: [
        { threshold: 0, rate: 0 },
        { threshold: 1207, rate: 0.02 },
        { threshold: 2414, rate: 0.025 },
        { threshold: 3621, rate: 0.03 },
        { threshold: 4828, rate: 0.035 },
        { threshold: 6035, rate: 0.04 },
        { threshold: 7242, rate: 0.045 },
        { threshold: 8449, rate: 0.048 },
      ],
    },
    stdDed: { single: 14600, mfj: 29200 },
    retirementExclusion: { kind: 'amount', amount: { single: 6000, mfj: 12000 } },
    ltcgRule: { kind: 'exempt' }, // MO statutory cap-gains exclusion (full)
    summary: 'Graduated 0–4.8% · SS exempt · LTCG fully exempt',
  }),
  'Montana': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.047 },
        { threshold: 20500, rate: 0.0565 },
      ],
      mfj: [
        { threshold: 0, rate: 0.047 },
        { threshold: 41000, rate: 0.0565 },
      ],
    },
    stdDed: { single: 5000, mfj: 10000 },
    ssRule: { kind: 'taxed' },
    retirementExclusion: { kind: 'amount', amount: { single: 4640, mfj: 9280 } },
    summary: 'Graduated 4.7–5.65% · SS taxed · Small pension exclusion',
  }),
  'Nebraska': flatProfile({
    // NE phase-down: 2024 top 5.84% → 2025 5.20% → 2026 4.55% → 2027 3.99% (flat).
    // 2026 top is 4.55%. Modeled flat-at-top above the std deduction; a real
    // bracket schedule would lower effective rates for low-income years but
    // most retiree income lands at or near the top in NE's compressed schedule.
    rate: 0.0455,
    stdDed: { single: 7900, mfj: 15800 },
    summary: 'Flat ~4.55% (2026; trending to 3.99% by 2027) · SS exempt · No exclusion',
  }),
  'Nevada': NONE_PROFILE('Nevada'),
  'New Hampshire': NONE_PROFILE('New Hampshire'),
  'New Jersey': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.014 },
        { threshold: 20000, rate: 0.0175 },
        { threshold: 35000, rate: 0.035 },
        { threshold: 40000, rate: 0.05525 },
        { threshold: 75000, rate: 0.0637 },
        { threshold: 500000, rate: 0.0897 },
        { threshold: 1000000, rate: 0.1075 },
      ],
      mfj: [
        { threshold: 0, rate: 0.014 },
        { threshold: 20000, rate: 0.0175 },
        { threshold: 50000, rate: 0.0245 },
        { threshold: 70000, rate: 0.035 },
        { threshold: 80000, rate: 0.05525 },
        { threshold: 150000, rate: 0.0637 },
        { threshold: 500000, rate: 0.0897 },
        { threshold: 1000000, rate: 0.1075 },
      ],
    },
    stdDed: { single: null, mfj: null }, // NJ has personal exemption ($1k) but no std ded — approximate as 0
    retirementExclusion: { kind: 'agi_phaseout', max: { single: 75000, mfj: 100000 }, agiCap: { single: 150000, mfj: 150000 }, ageThreshold: 62 },
    bracketsInflationIndexed: false, // NJ brackets are statutorily fixed
    summary: 'Graduated 1.4–10.75% · SS exempt · Pension exclusion to $75k/$100k below $150k AGI',
  }),
  'New Mexico': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.017 },
        { threshold: 5500, rate: 0.032 },
        { threshold: 11000, rate: 0.047 },
        { threshold: 16000, rate: 0.049 },
        { threshold: 210000, rate: 0.059 },
      ],
      mfj: [
        { threshold: 0, rate: 0.017 },
        { threshold: 8000, rate: 0.032 },
        { threshold: 16000, rate: 0.047 },
        { threshold: 24000, rate: 0.049 },
        { threshold: 315000, rate: 0.059 },
      ],
    },
    stdDed: { single: 14600, mfj: 29200 },
    ssRule: { kind: 'agi_phaseout', thresholds: { single: 100000, mfj: 150000 } },
    retirementExclusion: { kind: 'amount', amount: { single: 8000, mfj: 16000 }, ageThreshold: 65 },
    summary: 'Graduated 1.7–5.9% · SS exempt below AGI thresholds · $8k retirement exclusion (65+)',
  }),
  'New York': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.04 },
        { threshold: 8500, rate: 0.045 },
        { threshold: 11700, rate: 0.0525 },
        { threshold: 13900, rate: 0.055 },
        { threshold: 80650, rate: 0.06 },
        { threshold: 215400, rate: 0.0685 },
        { threshold: 1077550, rate: 0.0965 },
        { threshold: 5000000, rate: 0.103 },
        { threshold: 25000000, rate: 0.109 },
      ],
      mfj: [
        { threshold: 0, rate: 0.04 },
        { threshold: 17150, rate: 0.045 },
        { threshold: 23600, rate: 0.0525 },
        { threshold: 27900, rate: 0.055 },
        { threshold: 161550, rate: 0.06 },
        { threshold: 323200, rate: 0.0685 },
        { threshold: 2155350, rate: 0.0965 },
        { threshold: 5000000, rate: 0.103 },
        { threshold: 25000000, rate: 0.109 },
      ],
    },
    stdDed: { single: 8000, mfj: 16050 },
    retirementExclusion: { kind: 'amount', amount: { single: 20000, mfj: 40000 }, ageThreshold: 59.5 },
    bracketsInflationIndexed: false, // NY statutory brackets are fixed in nominal dollars
    summary: 'Graduated 4–10.9% · SS exempt · $20k pension/IRA exclusion (59.5+)',
    notes: 'NY exempts NY-source public pensions in full; private pensions/IRAs limited to $20k. Approximated as $20k across Traditional withdrawals.',
  }),
  // 'New York City' is defined below the table (composition of NY + locality)
  // to avoid duplicating the NY bracket schedule. See `STATE_TAX_PROFILES['New York City']`
  // assignment immediately after this object literal.
  'North Carolina': flatProfile({
    rate: 0.0399, // NC scheduled top by 2026
    stdDed: { single: 12750, mfj: 25500 },
    summary: 'Flat 3.99% · SS exempt · No retirement exclusion',
  }),
  'North Dakota': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0 },
        { threshold: 47150, rate: 0.0195 },
        { threshold: 238200, rate: 0.025 },
      ],
      mfj: [
        { threshold: 0, rate: 0 },
        { threshold: 78775, rate: 0.0195 },
        { threshold: 289975, rate: 0.025 },
      ],
    },
    stdDed: { single: 14600, mfj: 29200 },
    summary: 'Graduated 0–2.5% · SS exempt',
  }),
  'Ohio': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0 },
        { threshold: 26050, rate: 0.0275 },
        { threshold: 100000, rate: 0.0275 },
      ],
      mfj: [
        { threshold: 0, rate: 0 },
        { threshold: 26050, rate: 0.0275 },
        { threshold: 100000, rate: 0.0275 },
      ],
    },
    stdDed: { single: 2650, mfj: 5300 },
    retirementExclusion: { kind: 'amount', amount: { single: 200, mfj: 200 } }, // OH uses a small credit; modeled as deduction equivalent
    summary: 'Effectively flat 2.75% above $26k · SS exempt · Senior credit',
    notes: 'OH retirement-income credit is a tax credit, approximated as a small deduction here.',
  }),
  'Oklahoma': flatProfile({
    rate: 0.0475, // OK has a slightly graduated schedule, top 4.75%
    stdDed: { single: 6350, mfj: 12700 },
    retirementExclusion: { kind: 'amount', amount: { single: 10000, mfj: 20000 }, ageThreshold: 65 },
    summary: 'Flat ~4.75% · SS exempt · $10k retirement exclusion (65+)',
  }),
  'Oregon': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.0475 },
        { threshold: 4300, rate: 0.0675 },
        { threshold: 10750, rate: 0.0875 },
        { threshold: 125000, rate: 0.099 },
      ],
      mfj: [
        { threshold: 0, rate: 0.0475 },
        { threshold: 8600, rate: 0.0675 },
        { threshold: 21500, rate: 0.0875 },
        { threshold: 250000, rate: 0.099 },
      ],
    },
    stdDed: { single: 2605, mfj: 5210 },
    summary: 'Graduated 4.75–9.9% · SS exempt · Retirement credit (not modeled)',
    notes: 'OR senior retirement income credit not modeled; effective rates may overstate for low-income retirees.',
  }),
  'Pennsylvania': flatProfile({
    rate: 0.0307,
    stdDed: { single: null, mfj: null },
    retirementExclusion: { kind: 'full' }, // PA exempts all retirement income (incl. 401k/IRA distributions for retirees)
    summary: 'Flat 3.07% · SS exempt · All retirement income exempt',
  }),
  'Rhode Island': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.0375 },
        { threshold: 77450, rate: 0.0475 },
        { threshold: 176050, rate: 0.0599 },
      ],
      mfj: [
        { threshold: 0, rate: 0.0375 },
        { threshold: 77450, rate: 0.0475 },
        { threshold: 176050, rate: 0.0599 },
      ],
    },
    stdDed: { single: 10550, mfj: 21150 },
    ssRule: { kind: 'agi_phaseout', thresholds: { single: 101000, mfj: 126250 } },
    retirementExclusion: { kind: 'amount', amount: { single: 20000, mfj: 40000 } },
    summary: 'Graduated 3.75–5.99% · SS exempt below AGI cap · $20k pension exclusion',
  }),
  // South Carolina: temporary 6% top through 2026, then reverting to scheduled lower rate.
  'South Carolina': flatProfile({
    rate: 0.06,
    stdDed: { single: 14000, mfj: 28000 },
    retirementExclusion: { kind: 'amount', amount: { single: 10000, mfj: 20000 }, ageThreshold: 65 },
    bracketBaseYear: 2026,
    effectiveYears: { end: 2026 },
    successorProfileKey: 'South Carolina (2027+)',
    summary: 'Flat 6% (sunset 2026) · SS exempt · $10k retirement exclusion (65+)',
  }),
  'South Carolina (2027+)': flatProfile({
    rate: 0.052,
    stdDed: { single: 14000, mfj: 28000 },
    retirementExclusion: { kind: 'amount', amount: { single: 10000, mfj: 20000 }, ageThreshold: 65 },
    bracketBaseYear: 2027,
    summary: 'Flat 5.2% (post-2026 successor) · SS exempt · $10k retirement exclusion (65+)',
  }),
  'South Dakota': NONE_PROFILE('South Dakota'),
  'Tennessee': NONE_PROFILE('Tennessee'),
  'Texas': NONE_PROFILE('Texas'),
  'Utah': flatProfile({
    rate: 0.0455,
    stdDed: { single: 14600, mfj: 29200 },
    ssRule: { kind: 'agi_phaseout', thresholds: { single: 45000, mfj: 75000 } }, // UT SS credit phases out by AGI
    retirementExclusion: { kind: 'amount', amount: { single: 450, mfj: 900 }, ageThreshold: 65 },
    summary: 'Flat 4.55% · SS partial (credit) · Small senior credit',
  }),
  'Vermont': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.0335 },
        { threshold: 45400, rate: 0.066 },
        { threshold: 110050, rate: 0.076 },
        { threshold: 229550, rate: 0.0875 },
      ],
      mfj: [
        { threshold: 0, rate: 0.0335 },
        { threshold: 75850, rate: 0.066 },
        { threshold: 183400, rate: 0.076 },
        { threshold: 279450, rate: 0.0875 },
      ],
    },
    stdDed: { single: 7000, mfj: 14050 },
    ssRule: { kind: 'agi_phaseout', thresholds: { single: 50000, mfj: 65000 } },
    summary: 'Graduated 3.35–8.75% · SS partial · No retirement exclusion',
  }),
  'Virginia': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.02 },
        { threshold: 3000, rate: 0.03 },
        { threshold: 5000, rate: 0.05 },
        { threshold: 17000, rate: 0.0575 },
      ],
      mfj: [
        { threshold: 0, rate: 0.02 },
        { threshold: 3000, rate: 0.03 },
        { threshold: 5000, rate: 0.05 },
        { threshold: 17000, rate: 0.0575 },
      ],
    },
    stdDed: { single: 8000, mfj: 16000 },
    retirementExclusion: { kind: 'amount', amount: { single: 12000, mfj: 24000 }, ageThreshold: 65 },
    summary: 'Graduated 2–5.75% · SS exempt · $12k age deduction (65+)',
  }),
  'Washington': {
    taxType: 'capital-gains-only',
    brackets: { single: [], mfj: [] },
    standardDeduction: { single: null, mfj: null },
    ssRule: { kind: 'exempt' },
    // WA has no ordinary brackets (`taxType: 'capital-gains-only'`), so this
    // field is effectively unused — `none` is clearer than `full` (which would
    // falsely imply Traditional withdrawals are explicitly excluded somewhere).
    retirementExclusion: { kind: 'none' },
    // 2024 statutory base = $262,000; threshold is CPI-indexed annually from 2024.
    // 2025 actual value was ~$270k. We anchor at $262k @ 2024 and let
    // StateTaxCalculator's independent `ltcgFactor` index forward.
    // WA's $262k threshold is per-filer; MFJ couples filing jointly effectively
    // get 2 × $262k since each spouse's LTCG is tested against their own threshold.
    ltcgRule: { kind: 'threshold', rate: 0.07, threshold: { single: 262000, mfj: 524000 }, inflationIndexed: true },
    bracketsInflationIndexed: false,
    bracketBaseYear: 2024,
    summary: 'WA capital gains tax only · 7% on LTCG above $262k single / $524k MFJ (2024, CPI-indexed)',
    notes: 'WA has no ordinary income tax. 7% Long-Term Capital Gains Tax applies above an inflation-indexed $262k (single, 2024 base) threshold; MFJ couples effectively get 2× that. Only realized state-source LTCG is in scope.',
  },
  'West Virginia': flatProfile({
    rate: 0.0482,
    stdDed: { single: 2000, mfj: 4000 },
    ssRule: { kind: 'taxed' }, // 2026 — partial; phase-out completes by 2027
    retirementExclusion: { kind: 'amount', amount: { single: 8000, mfj: 16000 } },
    summary: 'Flat 4.82% · SS taxed (phase-out 2026) · $8k retirement exclusion',
    effectiveYears: { end: 2026 },
    successorProfileKey: 'West Virginia (2027+)',
  }),
  'West Virginia (2027+)': flatProfile({
    rate: 0.0482,
    stdDed: { single: 2000, mfj: 4000 },
    ssRule: { kind: 'exempt' },
    retirementExclusion: { kind: 'amount', amount: { single: 8000, mfj: 16000 } },
    summary: 'Flat 4.82% · SS exempt (post-2026 successor) · $8k retirement exclusion',
    bracketBaseYear: 2027,
  }),
  'Wisconsin': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.035 },
        { threshold: 14320, rate: 0.044 },
        { threshold: 28640, rate: 0.053 },
        { threshold: 315310, rate: 0.0765 },
      ],
      mfj: [
        { threshold: 0, rate: 0.035 },
        { threshold: 19090, rate: 0.044 },
        { threshold: 38190, rate: 0.053 },
        { threshold: 420420, rate: 0.0765 },
      ],
    },
    stdDed: { single: 12760, mfj: 23620 },
    retirementExclusion: { kind: 'amount', amount: { single: 5000, mfj: 10000 }, ageThreshold: 65 },
    summary: 'Graduated 3.5–7.65% · SS exempt · $5k retirement exclusion (65+)',
  }),
  'Wyoming': NONE_PROFILE('Wyoming'),
  'Washington, DC': graduatedProfile({
    brackets: {
      single: [
        { threshold: 0, rate: 0.04 },
        { threshold: 10000, rate: 0.06 },
        { threshold: 40000, rate: 0.065 },
        { threshold: 60000, rate: 0.085 },
        { threshold: 250000, rate: 0.0925 },
        { threshold: 500000, rate: 0.0975 },
        { threshold: 1000000, rate: 0.1075 },
      ],
      mfj: [
        { threshold: 0, rate: 0.04 },
        { threshold: 10000, rate: 0.06 },
        { threshold: 40000, rate: 0.065 },
        { threshold: 60000, rate: 0.085 },
        { threshold: 250000, rate: 0.0925 },
        { threshold: 500000, rate: 0.0975 },
        { threshold: 1000000, rate: 0.1075 },
      ],
    },
    stdDed: { single: 14600, mfj: 29200 },
    summary: 'Graduated 4–10.75% · SS exempt · No retirement exclusion',
  }),
};

// NYC composed from NY (DRY — when NY brackets/std-ded/exclusion update, NYC follows automatically).
// NYC adds the ~3.876% locality surcharge applied to ordinary + LTCG base (NYC taxes LTCG as ordinary).
STATE_TAX_PROFILES['New York City'] = {
  ...STATE_TAX_PROFILES['New York'],
  localitySurcharge: { rate: 0.03876, appliesToOrdinaryOnly: false },
  summary: 'NY State + NYC ~3.876% local · SS exempt · $20k retirement exclusion',
  notes: 'NYC top rate is graduated 3.078%/3.762%/3.819%/3.876% — approximated as 3.876% above the NY state std deduction. NYC also taxes LTCG (locality applies to ordinary + LTCG base).',
};

// Canonical list of selectable state names (for UI dropdowns). Includes NYC.
export const SELECTABLE_STATES: string[] = Object.keys(STATE_TAX_PROFILES)
  .filter((k) => !/\(\d+\+\)/.test(k)) // hide successor variants from the UI
  .sort();

/**
 * Resolve the effective profile for a given state name + tax year. Follows
 * `successorProfileKey` when the current profile's `effectiveYears.end` is
 * exceeded. Returns the FL/no-tax profile if the state is unknown.
 *
 * Returns both the profile and the *resolved* registry key — callers should
 * use `resolvedKey` (not the original `stateName`) for audit display so that
 * post-transition years correctly label as e.g. "South Carolina (2027+)".
 */
export function getStateTaxProfile(stateName: string, year: number): { profile: StateTaxProfile; resolvedKey: string } {
  let key = stateName;
  let profile = STATE_TAX_PROFILES[key];
  if (!profile) {
    if (typeof console !== 'undefined' && !warnedUnknownStates.has(stateName)) {
      warnedUnknownStates.add(stateName);
      console.warn(`[stateTaxProfiles] Unknown state "${stateName}" — falling back to Florida (no state tax).`);
    }
    return { profile: STATE_TAX_PROFILES['Florida'], resolvedKey: 'Florida' };
  }
  let guard = 0;
  while (
    profile.effectiveYears?.end !== undefined &&
    year > profile.effectiveYears.end &&
    profile.successorProfileKey &&
    STATE_TAX_PROFILES[profile.successorProfileKey] &&
    guard++ < 5
  ) {
    key = profile.successorProfileKey;
    profile = STATE_TAX_PROFILES[key];
  }
  return { profile, resolvedKey: key };
}

// Module-level dedupe for the unknown-state warning. Intentional: one warning per
// distinct misspelled state name per page load, not per scenario. Acceptable trade-off
// since the warning is a dev affordance, not a user-visible error path.
const warnedUnknownStates = new Set<string>();

/** Inflation factor relative to profile's bracketBaseYear, matching TaxCalculator.inflationFactor semantics. */
export function profileInflationFactor(profile: StateTaxProfile, year: number, inflationRate: number | undefined): number {
  if (!profile.bracketsInflationIndexed) return 1;
  if (!inflationRate || year <= profile.bracketBaseYear) return 1;
  return Math.pow(1 + inflationRate, year - profile.bracketBaseYear);
}
