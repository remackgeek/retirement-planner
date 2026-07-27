import { describe, it, expect } from 'vitest';
import { getContributionLimits, DEFAULT_CONTRIBUTION_LIMITS } from './contributionLimits';
import type { UserData } from '../types/UserData';

const withLimits = (limits: UserData['contributionLimits']): UserData =>
  ({ contributionLimits: limits } as unknown as UserData);

describe('getContributionLimits — superCatchUp401k fill', () => {
  it('an explicit superCatchUp401k survives the fill', () => {
    const limits = getContributionLimits(withLimits({
      elective401k: 23000,
      iraLimit: 7000,
      catchUpAge: 50,
      catchUp401k: 7500,
      superCatchUp401k: 0,
      catchUpIra: 1000,
      inflationAdjusted: false,
    }));
    expect(limits.superCatchUp401k).toBe(0);
  });

  it('uses the indexed dollar default only when catchUp401k is also defaulted', () => {
    expect(getContributionLimits(withLimits(undefined)).superCatchUp401k)
      .toBe(DEFAULT_CONTRIBUTION_LIMITS.superCatchUp401k);
  });

  it('scales a CUSTOMIZED catchUp401k by the statutory 150% — no dollar floor', () => {
    const at = (catchUp401k: number) => getContributionLimits(withLimits({
      elective401k: 23000,
      iraLimit: 7000,
      catchUpAge: 50,
      catchUp401k,
      catchUpIra: 1000,
      inflationAdjusted: false,
    })).superCatchUp401k;

    // Raised catch-up: statutory 150% rule.
    expect(at(10000)).toBe(15000);
    // Lowered catch-up: scales DOWN. Applying the $12,000 floor here would
    // contradict the user's own (smaller) figure.
    expect(at(2000)).toBe(3000);
  });

  it('treats a null catchUp401k as "not supplied", consistently with catchUp401k itself', () => {
    // A hand-edited file can carry null. `??` already resolves catchUp401k to
    // the default, so the super derivation must agree — `null * 1.5` would
    // otherwise yield 0 alongside a defaulted $8,000 regular catch-up.
    const limits = getContributionLimits(withLimits({
      elective401k: 23000,
      iraLimit: 7000,
      catchUpAge: 50,
      catchUp401k: null,
      catchUpIra: 1000,
      inflationAdjusted: false,
    } as unknown as UserData['contributionLimits']));
    expect(limits.catchUp401k).toBe(DEFAULT_CONTRIBUTION_LIMITS.catchUp401k);
    expect(limits.superCatchUp401k).toBe(DEFAULT_CONTRIBUTION_LIMITS.superCatchUp401k);
  });

  it('catchUp401k: 0 means no catch-up at ANY age — including the 60–63 band', () => {
    // Released-data regression: scenarios that disabled catch-up predate the
    // superCatchUp401k field. Backfilling the $12,000 statutory floor would
    // silently raise their 60–63 cap on upgrade.
    expect(at0()).toBe(0);
    function at0() {
      return getContributionLimits(withLimits({
        elective401k: 23000,
        iraLimit: 7000,
        catchUpAge: 50,
        catchUp401k: 0,
        catchUpIra: 0,
        inflationAdjusted: false,
      })).superCatchUp401k;
    }
  });
});
