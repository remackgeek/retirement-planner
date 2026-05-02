import { describe, it, expect } from 'vitest';
import { buildAgeOptions, buildEndAgeOptions, incomeEventAgeRanges, spendingGoalAgeRanges } from './ageOptions';

describe('buildAgeOptions', () => {
  it('builds correct number of options for a given range', () => {
    const options = buildAgeOptions(2026, 50, 62, 120);
    expect(options.length).toBe(59);
    expect(options[0].value).toBe(62);
    expect(options[options.length - 1].value).toBe(120);
  });

  it('labels include age and computed year', () => {
    const options = buildAgeOptions(2026, 50, 62, 120);
    expect(options[0].label).toBe('62 (2038)');
    expect(options[5].label).toBe('67 (2043)');
  });

  it('computes correct year for different current ages', () => {
    const options = buildAgeOptions(2026, 60, 62, 120);
    expect(options[0].label).toBe('62 (2028)');
  });

  it('shows past years when current age exceeds min age', () => {
    const options = buildAgeOptions(2026, 74, 62, 120);
    expect(options[0].label).toBe('62 (2014)');
    expect(options[12].label).toBe('74 (2026)');
  });

  it('works with custom age ranges', () => {
    const options = buildAgeOptions(2026, 40, 18, 70);
    expect(options.length).toBe(53);
    expect(options[0].value).toBe(18);
    expect(options[0].label).toBe('18 (2004)');
    expect(options[options.length - 1].value).toBe(70);
  });

  it('returns single option when min equals max', () => {
    const options = buildAgeOptions(2026, 60, 65, 65);
    expect(options.length).toBe(1);
    expect(options[0]).toEqual({ label: '65 (2031)', value: 65 });
  });
});

describe('buildEndAgeOptions', () => {
  it('prepends a None option with value 0', () => {
    const options = buildEndAgeOptions(2026, 50, 62, 120);
    expect(options[0]).toEqual({ label: 'None', value: 0 });
  });

  it('has one more option than buildAgeOptions for same range', () => {
    const ageOptions = buildAgeOptions(2026, 50, 62, 120);
    const endOptions = buildEndAgeOptions(2026, 50, 62, 120);
    expect(endOptions.length).toBe(ageOptions.length + 1);
  });

  it('age options after None match buildAgeOptions exactly', () => {
    const ageOptions = buildAgeOptions(2026, 50, 62, 120);
    const endOptions = buildEndAgeOptions(2026, 50, 62, 120);
    expect(endOptions.slice(1)).toEqual(ageOptions);
  });
});

describe('age range maps', () => {
  it('all income event ranges have min < max', () => {
    for (const [type, range] of Object.entries(incomeEventAgeRanges)) {
      expect(range.min, `${type} min`).toBeLessThan(range.max);
    }
  });

  it('all spending goal ranges have min < max', () => {
    for (const [type, range] of Object.entries(spendingGoalAgeRanges)) {
      expect(range.min, `${type} min`).toBeLessThan(range.max);
    }
  });
});
