/**
 * Social Security actuarial helper — pure, no DOM, no engine dependency.
 *
 * The simulation engine treats an SS event's `amount` and `startAge` as
 * independent: it pays whatever amount you entered, whenever you claim. That's
 * wrong for a "when should I claim?" tool, because claiming earlier produces a
 * permanently smaller check and claiming later a larger one. This module
 * supplies the missing actuarial link via the real SSA rules:
 *
 *   - Primary Insurance Amount (PIA) = the benefit at Full Retirement Age (FRA).
 *   - FRA depends on birth year (66 for 1943–1954, ramping to 67 for 1960+).
 *   - Claiming before FRA reduces the benefit; claiming after FRA (up to 70)
 *     adds delayed-retirement credits.
 *
 * All math is done in *months* so fractional FRAs (e.g. 66y 8m for 1958) are
 * exact. Consumers pass integer claim ages (62–70); the wizard back-computes
 * PIA from a single benefit figure off the user's SSA statement.
 */

/** Earliest age Social Security retirement benefits can begin. */
export const MIN_CLAIM_AGE = 62;
/** Age past which delayed-retirement credits stop accruing. */
export const MAX_CLAIM_AGE = 70;

/**
 * Full Retirement Age in months for a given birth year, per the SSA table.
 * Birth years before 1938 (FRA 65) are clamped to 65; we never expect them, but
 * the function stays total.
 */
export function computeFraMonths(birthYear: number): number {
  if (birthYear <= 1937) return 65 * 12;
  if (birthYear <= 1942) return 65 * 12 + (birthYear - 1937) * 2; // 65y2m … 65y10m
  if (birthYear <= 1954) return 66 * 12;
  if (birthYear <= 1959) return 66 * 12 + (birthYear - 1954) * 2; // 66y2m … 66y10m
  return 67 * 12;
}

/** Birth year implied by an age at the plan's reference year. */
export function birthYearFromAge(referenceYear: number, ageAtReferenceYear: number): number {
  return referenceYear - ageAtReferenceYear;
}

/**
 * The actuarial benefit multiplier applied to PIA when claiming at
 * `claimAgeMonths` given a Full Retirement Age of `fraMonths`.
 *
 *   - Early: −5/9 of 1% per month for the first 36 months before FRA, then
 *     −5/12 of 1% per month beyond 36.
 *   - Delayed: +2/3 of 1% per month (8%/yr) from FRA up to age 70 (capped).
 *
 * Anchors: FRA 67 → 62 = 0.70, 70 = 1.24. FRA 66 → 62 = 0.75, 70 = 1.32.
 */
export function benefitMultiplier(claimAgeMonths: number, fraMonths: number): number {
  if (claimAgeMonths < fraMonths) {
    const monthsEarly = fraMonths - claimAgeMonths;
    const first36 = Math.min(36, monthsEarly);
    const beyond36 = Math.max(0, monthsEarly - 36);
    const reduction = first36 * (5 / 900) + beyond36 * (5 / 1200);
    return 1 - reduction;
  }
  if (claimAgeMonths > fraMonths) {
    const cappedClaim = Math.min(claimAgeMonths, MAX_CLAIM_AGE * 12);
    const monthsDelayed = Math.max(0, cappedClaim - fraMonths);
    return 1 + monthsDelayed * (0.08 / 12);
  }
  return 1;
}

/** PIA → actuarially-adjusted annual benefit for an integer claim age. */
export function benefitAtAge(pia: number, fraMonths: number, claimAge: number): number {
  return pia * benefitMultiplier(Math.round(claimAge * 12), fraMonths);
}

/**
 * Inverse of {@link benefitAtAge}: recover PIA from a benefit the user reports
 * at a known age (e.g. their SSA statement's "at full retirement age" figure).
 */
export function piaFromBenefit(benefit: number, fraMonths: number, enteredAgeMonths: number): number {
  const mult = benefitMultiplier(enteredAgeMonths, fraMonths);
  return mult > 0 ? benefit / mult : benefit;
}

/** Human-readable FRA, e.g. "66y 8m" or "67". */
export function formatFra(fraMonths: number): string {
  const years = Math.floor(fraMonths / 12);
  const months = fraMonths % 12;
  return months === 0 ? `${years}` : `${years}y ${months}m`;
}
