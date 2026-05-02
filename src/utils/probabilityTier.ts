import { colors } from '../styles/theme';

export type ProbabilityTier = 'excellent' | 'good' | 'fair' | 'atRisk';

export interface ProbabilityTierInfo {
  tier: ProbabilityTier;
  label: string;
  tooltip: string;
  color: string;
  backgroundColor: string;
}

const TIERS: Record<ProbabilityTier, Omit<ProbabilityTierInfo, 'tier'>> = {
  excellent: {
    label: 'Excellent',
    tooltip:
      'Your plan survives nearly all modeled market scenarios. You may have room to spend more, retire earlier, or take less investment risk.',
    color: colors.success,
    backgroundColor: colors.successBg,
  },
  good: {
    label: 'Good',
    tooltip:
      'Your plan holds up in most scenarios. Some tail risk remains in severe downturns — worth monitoring as conditions change.',
    color: colors.successMuted,
    backgroundColor: colors.successMutedBg,
  },
  fair: {
    label: 'Fair',
    tooltip:
      'Your plan succeeds more often than not, but the downside is real. Consider higher savings, lower spending, or working longer.',
    color: colors.warning,
    backgroundColor: colors.warningBg,
  },
  atRisk: {
    label: 'At Risk',
    tooltip:
      'Your plan is more likely to fall short than succeed. Meaningful structural changes are recommended.',
    color: colors.dangerStrong,
    backgroundColor: colors.dangerStrongBg,
  },
};

export function getProbabilityTier(probability: number): ProbabilityTierInfo {
  let tier: ProbabilityTier;
  if (probability >= 90) tier = 'excellent';
  else if (probability >= 75) tier = 'good';
  else if (probability >= 50) tier = 'fair';
  else tier = 'atRisk';
  return { tier, ...TIERS[tier] };
}
