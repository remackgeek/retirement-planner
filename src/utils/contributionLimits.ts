import type { UserData, ContributionLimits } from '../types/UserData';

// Default 2026 IRS limits (Notice 2025-67).
export const DEFAULT_CONTRIBUTION_LIMITS: Required<ContributionLimits> = {
  elective401k: 24500,
  iraLimit: 7500,
  catchUpAge: 50,
  catchUp401k: 8000,
  // SECURE 2.0 §109 ages-60–63 super catch-up: greater of $10,000-indexed or
  // 150% of the regular catch-up. For 2026 (regular $8,000) → $12,000.
  superCatchUp401k: 12000,
  catchUpIra: 1100,
  inflationAdjusted: true,
};

// Returns the scenario's contributionLimits with all fields filled from defaults
// where absent. Always returns a complete record.
export function getContributionLimits(userData: UserData): Required<ContributionLimits> {
  const u: Partial<ContributionLimits> = userData.contributionLimits ?? {};
  const catchUp401k = u.catchUp401k ?? DEFAULT_CONTRIBUTION_LIMITS.catchUp401k;
  return {
    elective401k: u.elective401k ?? DEFAULT_CONTRIBUTION_LIMITS.elective401k,
    iraLimit: u.iraLimit ?? DEFAULT_CONTRIBUTION_LIMITS.iraLimit,
    catchUpAge: u.catchUpAge ?? DEFAULT_CONTRIBUTION_LIMITS.catchUpAge,
    catchUp401k,
    // Backfill for scenarios saved before this field existed. The statutory
    // amount is "greater of $10,000-indexed or 150% of the regular catch-up",
    // but the dollar floor is applied ONLY to the built-in default — never to a
    // scenario that customized `catchUp401k`.
    //
    // Why: a released scenario with `catchUp401k: 0` means "model no catch-up".
    // Backfilling the $12,000 floor there would silently raise that owner's
    // 401(k) cap by $12k at ages 60–63 on app upgrade — changing deposits,
    // taxes, and success probability for data the user never touched. Scaling
    // the user's own figure by 150% honors their intent at both ends: 0 → 0,
    // and a raised $10,000 → $15,000 (the statutory ratio).
    // `typeof === 'number'` (not `!== undefined`): a hand-edited file can carry
    // `catchUp401k: null`, which `??` above already treats as "not supplied" —
    // and `null * 1.5` would silently derive 0 while catchUp401k resolved to
    // the default. Both reads must agree on what "customized" means.
    superCatchUp401k:
      u.superCatchUp401k ??
      (typeof u.catchUp401k === 'number'
        ? Math.round(u.catchUp401k * 1.5)
        : DEFAULT_CONTRIBUTION_LIMITS.superCatchUp401k),
    catchUpIra: u.catchUpIra ?? DEFAULT_CONTRIBUTION_LIMITS.catchUpIra,
    inflationAdjusted:
      u.inflationAdjusted ?? DEFAULT_CONTRIBUTION_LIMITS.inflationAdjusted,
  };
}
