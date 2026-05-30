import { describe, it, expect } from 'vitest';
import { buildPlanWindowOptions, defaultPlanWindow } from './RothConversionDialog';

describe('buildPlanWindowOptions', () => {
  it('includes all fixed options when lifeExpectancy is well past the highest', () => {
    const opts = buildPlanWindowOptions(95);
    const values = opts.map((o) => o.value);
    expect(values).toContain(73);
    expect(values).toContain(75);
    expect(values).toContain(80);
    expect(values).toContain(85);
    expect(values).toContain(90);
    expect(values).toContain(95); // life-expectancy option appended
  });

  it('drops fixed options above lifeExpectancy', () => {
    const opts = buildPlanWindowOptions(78);
    const values = opts.map((o) => o.value);
    expect(values).toContain(73);
    expect(values).toContain(75);
    expect(values).toContain(78); // life-expectancy option
    expect(values).not.toContain(80);
    expect(values).not.toContain(85);
    expect(values).not.toContain(90);
  });

  it('does NOT duplicate when lifeExpectancy equals a fixed option (regression for round-5 audit)', () => {
    // Before the audit fix, lifeExpectancy === 80 would emit "through age 80
    // (default)" AND "through life expectancy (age 80, advanced)" as two
    // options sharing value=80. PrimeReact's Dropdown rendered the
    // last-matching label as the selected text, so the user's default of 80
    // showed up as "(advanced)" — misleading. Asserting no duplicate values.
    for (const le of [73, 75, 80, 85, 90]) {
      const opts = buildPlanWindowOptions(le);
      const values = opts.map((o) => o.value);
      const uniqueValues = new Set(values);
      expect(values.length).toBe(uniqueValues.size);
      // And the option at value=lifeExpectancy is the fixed-label one, not
      // the "(advanced)" relabel.
      const match = opts.find((o) => o.value === le);
      expect(match).toBeDefined();
      expect(match!.label).not.toContain('advanced');
    }
  });

  it('appends "(advanced)" lifeExpectancy option when not in the fixed set', () => {
    // lifeExpectancy values between fixed options should get the advanced
    // suffix to make it explicit they're outside the usual choices.
    const opts = buildPlanWindowOptions(88);
    const advanced = opts.find((o) => o.value === 88);
    expect(advanced).toBeDefined();
    expect(advanced!.label).toContain('advanced');
    expect(advanced!.label).toContain('88');
  });
});

describe('defaultPlanWindow', () => {
  it('returns the DEFAULT_END_AGE_CAP (80) when lifeExpectancy is past it', () => {
    expect(defaultPlanWindow(95)).toBe(80);
  });

  it('clamps to lifeExpectancy when it is short of the default', () => {
    // Regression for the wizEndAgeCap init bug: without the clamp, a user
    // with lifeExpectancy=75 would get wizEndAgeCap=80 which doesn't match
    // any option in the rebuilt dropdown.
    expect(defaultPlanWindow(75)).toBe(75);
    expect(defaultPlanWindow(73)).toBe(73);
  });

  it('returns 80 exactly when lifeExpectancy equals it', () => {
    expect(defaultPlanWindow(80)).toBe(80);
  });
});
