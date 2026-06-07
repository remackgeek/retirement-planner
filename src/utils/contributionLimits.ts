import type { UserData, ContributionLimits } from '../types/UserData';

// Default 2026 IRS limits (Notice 2025-67).
export const DEFAULT_CONTRIBUTION_LIMITS: ContributionLimits = {
  elective401k: 24500,
  iraLimit: 7500,
  catchUpAge: 50,
  catchUp401k: 8000,
  catchUpIra: 1100,
  inflationAdjusted: true,
};

// Returns the scenario's contributionLimits with all fields filled from defaults
// where absent. Always returns a complete record.
export function getContributionLimits(userData: UserData): ContributionLimits {
  const u: Partial<ContributionLimits> = userData.contributionLimits ?? {};
  return {
    elective401k: u.elective401k ?? DEFAULT_CONTRIBUTION_LIMITS.elective401k,
    iraLimit: u.iraLimit ?? DEFAULT_CONTRIBUTION_LIMITS.iraLimit,
    catchUpAge: u.catchUpAge ?? DEFAULT_CONTRIBUTION_LIMITS.catchUpAge,
    catchUp401k: u.catchUp401k ?? DEFAULT_CONTRIBUTION_LIMITS.catchUp401k,
    catchUpIra: u.catchUpIra ?? DEFAULT_CONTRIBUTION_LIMITS.catchUpIra,
    inflationAdjusted:
      u.inflationAdjusted ?? DEFAULT_CONTRIBUTION_LIMITS.inflationAdjusted,
  };
}
