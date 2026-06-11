import { DEFAULT_END_AGE_CAP } from '../services/strategies/types';

// Plan-window options: end-age cap for the conversion schedule. Default 80
// reflects practitioner consensus — past ~80 the math shifts from
// owner-lifetime tax arbitrage to estate planning, which is a different
// objective the wizard doesn't model.
// Base END_AGE_OPTIONS — the fixed-age choices. The 'through life expectancy
// (advanced)' option is appended at render time because its value depends on
// userData.lifeExpectancy. Surfacing it as the last option keeps the default-
// case UX clean while giving heir-rate-arbitrage users an explicit escape
// hatch (vs. having to pick 90 as a workaround).
const BASE_END_AGE_OPTIONS: { label: string; value: number }[] = [
  { label: 'through age 73 (RMD start)', value: 73 },
  { label: 'through age 75', value: 75 },
  { label: 'through age 80 (default)', value: DEFAULT_END_AGE_CAP },
  { label: 'through age 85', value: 85 },
  { label: 'through age 90', value: 90 },
];

export const buildPlanWindowOptions = (lifeExpectancy: number): { label: string; value: number }[] => {
  // Keep fixed-age options up to AND INCLUDING lifeExpectancy (no point
  // offering "through age 90" when the plan ends at 85). Append a separate
  // "through life expectancy" option ONLY when lifeExpectancy doesn't
  // already equal one of the fixed values — otherwise we'd duplicate the
  // value (e.g. for lifeExpectancy=80, "through age 80 (default)" and
  // "through life expectancy (age 80, advanced)" would both have value=80,
  // and the dropdown would show whichever label rendered last as the
  // selected state, confusingly relabeling the default as "advanced").
  const fixed = BASE_END_AGE_OPTIONS.filter((o) => o.value <= lifeExpectancy);
  const alreadyCovered = BASE_END_AGE_OPTIONS.some((o) => o.value === lifeExpectancy);
  return alreadyCovered
    ? fixed
    : [...fixed, { label: `through life expectancy (age ${lifeExpectancy}, advanced)`, value: lifeExpectancy }];
};

/** Initial / reset value for `wizEndAgeCap`. Clamps the default (80) to the
 *  scenario's `lifeExpectancy` so users with a short plan don't end up with
 *  a state value that doesn't match any option in the dropdown. */
export const defaultPlanWindow = (lifeExpectancy: number): number =>
  Math.min(DEFAULT_END_AGE_CAP, lifeExpectancy);
