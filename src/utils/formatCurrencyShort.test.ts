import { describe, it, expect } from 'vitest';
import { formatCurrencyShort } from './formatCurrencyShort';

describe('formatCurrencyShort — compact (default)', () => {
  it('handles non-finite and zero', () => {
    expect(formatCurrencyShort(NaN)).toBe('—');
    expect(formatCurrencyShort(Infinity)).toBe('—');
    expect(formatCurrencyShort(0)).toBe('$0');
  });

  it('formats sub-$1K as whole dollars', () => {
    expect(formatCurrencyShort(245)).toBe('$245');
    expect(formatCurrencyShort(-245)).toBe('-$245');
  });

  it('formats $1K–$10K with 1 decimal', () => {
    expect(formatCurrencyShort(2_450)).toBe('$2.5K');
    expect(formatCurrencyShort(1_000)).toBe('$1.0K');
  });

  it('formats $10K–$1M as whole K', () => {
    expect(formatCurrencyShort(24_500)).toBe('$25K');
    expect(formatCurrencyShort(245_000)).toBe('$245K');
  });

  it('formats $1M–$10M with 2 decimals (precision bump)', () => {
    expect(formatCurrencyShort(2_448_000)).toBe('$2.45M');
    expect(formatCurrencyShort(2_402_000)).toBe('$2.40M');
  });

  it('formats $10M–$100M with 1 decimal', () => {
    expect(formatCurrencyShort(24_500_000)).toBe('$24.5M');
  });

  it('formats ≥$100M as whole M', () => {
    expect(formatCurrencyShort(123_000_000)).toBe('$123M');
  });

  it('handles negatives', () => {
    expect(formatCurrencyShort(-2_448_000)).toBe('-$2.45M');
  });
});

describe('formatCurrencyShort — precise', () => {
  it('keeps an extra significant figure in millions', () => {
    expect(formatCurrencyShort(2_448_000, 'precise')).toBe('$2.448M');
    expect(formatCurrencyShort(2_402_000, 'precise')).toBe('$2.402M');
  });

  it('exposes small deltas previously collapsed in compact mode', () => {
    // The motivating bug: $2.448M vs $2.402M must render differently.
    expect(formatCurrencyShort(2_448_000, 'precise'))
      .not.toBe(formatCurrencyShort(2_402_000, 'precise'));
  });

  it('$10M–$100M gets 2 decimals', () => {
    expect(formatCurrencyShort(24_560_000, 'precise')).toBe('$24.56M');
  });

  it('≥$100M still whole', () => {
    expect(formatCurrencyShort(123_400_000, 'precise')).toBe('$123M');
  });

  it('$10K–$100K gets 1 decimal', () => {
    expect(formatCurrencyShort(24_500, 'precise')).toBe('$24.5K');
  });

  it('$1K–$10K gets 2 decimals', () => {
    expect(formatCurrencyShort(2_450, 'precise')).toBe('$2.45K');
  });
});
