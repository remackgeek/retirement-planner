// ---------------- Widow's-penalty death model ----------------
//
// Models the survivor tax transition from explicit per-person death ages:
// self death age = `lifeExpectancy`, spouse death age = `spouseLifeExpectancy`.
// At the FIRST death the survivor flips MFJ→single for the remaining years
// (compressed brackets, ~half standard deduction, more SS taxable, lower IRMAA
// tiers), keeps the LARGER of the two Social Security benefits, and consolidates
// all Traditional balances (combined RMD at the survivor's age). The projection
// runs to the LATER of the two deaths.
//
// Convention: filing is MFJ THROUGH the year of the first death (IRS allows joint
// filing in the year of death — the cheapest conversion window), then single every
// year after. So survivor mode is `yearOffset > firstDeathOffset`.
//
// Inactive (not MFJ, no spouseAge, or no spouseLifeExpectancy): `firstDeathOffset`
// is Infinity and `horizonYears` equals the self-only horizon, so every downstream
// array/loop is bit-identical to pre-feature behavior.
//
// This lives in its own module (not SimulationService, which re-exports it)
// because ReturnGenerator and the strategy backends also need the horizon /
// per-year filing status, and importing SimulationService from either would
// create a module cycle. This file is the single source of truth — do NOT
// re-derive the horizon or the filing-flip convention anywhere else.

import type { UserData } from '../types/UserData';

export interface DeathModel {
  active: boolean;
  selfDeathOffset: number;
  spouseDeathOffset: number;
  /** Year offset (0-based) of the first death. Filing flips the year AFTER. */
  firstDeathOffset: number;
  survivor: 'self' | 'spouse';
  /** Total projection years = max(self, spouse) death offset + 1. */
  horizonYears: number;
}

export function getDeathModel(userData: UserData): DeathModel {
  const selfDeathOffset = userData.lifeExpectancy - userData.currentAge;
  const spouseLE = userData.spouseLifeExpectancy;
  const active =
    userData.filingStatus === 'mfj' &&
    userData.spouseAge !== null &&
    spouseLE != null &&
    spouseLE >= userData.spouseAge;
  if (!active || userData.spouseAge === null || spouseLE == null) {
    return {
      active: false,
      selfDeathOffset,
      spouseDeathOffset: selfDeathOffset,
      firstDeathOffset: Infinity,
      survivor: 'self',
      horizonYears: selfDeathOffset + 1,
    };
  }
  const spouseDeathOffset = spouseLE - userData.spouseAge;
  const firstDeathOffset = Math.min(selfDeathOffset, spouseDeathOffset);
  // Ties resolve to 'self' as survivor (consistent with the rest of the engine
  // treating self as the default owner); with equal death offsets there are no
  // survivor years anyway.
  const survivor: 'self' | 'spouse' =
    selfDeathOffset >= spouseDeathOffset ? 'self' : 'spouse';
  const horizonYears = Math.max(selfDeathOffset, spouseDeathOffset) + 1;
  return { active: true, selfDeathOffset, spouseDeathOffset, firstDeathOffset, survivor, horizonYears };
}

// Single source of truth for the projection length. = max(self, spouse) death
// offset + 1 when the death model is active; self horizon otherwise.
export function projectionHorizonYears(userData: UserData): number {
  return getDeathModel(userData).horizonYears;
}

/** Everything one plan year needs to know about the survivor transition.
 *  Derived from a SINGLE getDeathModel call — prefer this over calling
 *  getDeathModel + filingStatusForYearOffset separately. */
export interface SurvivorContext {
  /** True strictly AFTER the first death (MFJ holds through the death year). */
  survivorMode: boolean;
  /** Who died, once `survivorMode` is on; null while both are alive. */
  deceased: 'self' | 'spouse' | null;
  /** MFJ through the year of the first death, single every year after. */
  filingStatus: UserData['filingStatus'];
  /**
   * Spouse's age this year, collapsed to null once the spouse has died — the
   * "household composition" age, mirroring the engine's `spouseAgeByYear`
   * collapse. Use for senior-deduction and Medicare-enrollee counts.
   * NOT for income-event activation: an event owned by the deceased must be
   * filtered by `deceased`, and a surviving-spouse-owned event still needs the
   * raw `spouseAge + yearOffset` to resolve its start/end ages.
   */
  spouseAge: number | null;
}

export function survivorContextForYearOffset(
  userData: UserData,
  yearOffset: number,
): SurvivorContext {
  const dm = getDeathModel(userData);
  const survivorMode = dm.active && yearOffset > dm.firstDeathOffset;
  const deceased: 'self' | 'spouse' | null = survivorMode
    ? (dm.survivor === 'self' ? 'spouse' : 'self')
    : null;
  return {
    survivorMode,
    deceased,
    filingStatus: survivorMode ? 'single' : userData.filingStatus,
    spouseAge:
      userData.spouseAge !== null && deceased !== 'spouse'
        ? userData.spouseAge + yearOffset
        : null,
  };
}

/** Per-year filing status under the death model: MFJ through the year of the
 *  first death, single every year after. Identity when the model is inactive.
 *  Mirrors the Precomputes.filingStatusByYear construction in the engine.
 *  Thin wrapper over {@link survivorContextForYearOffset} — when you need more
 *  than the filing status, call that directly so the model is built once. */
export function filingStatusForYearOffset(
  userData: UserData,
  yearOffset: number,
): UserData['filingStatus'] {
  return survivorContextForYearOffset(userData, yearOffset).filingStatus;
}
