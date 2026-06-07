import { describe, it, expect } from 'vitest';
import { toDisplay, pathToDisplay } from './displayCurrency';

describe('toDisplay (nominal breakdown → display)', () => {
  it('returns the raw nominal value in nominal mode', () => {
    expect(toDisplay(1000, 1.5, 'nominal')).toBe(1000);
  });

  it('deflates by the inflation factor in real mode', () => {
    expect(toDisplay(1500, 1.5, 'real')).toBe(1000);
  });

  it('is identity at inflationFactor = 1 in either mode', () => {
    expect(toDisplay(100, 1, 'real')).toBe(100);
    expect(toDisplay(100, 1, 'nominal')).toBe(100);
  });
});

describe('pathToDisplay (real portfolio path → display)', () => {
  it('returns the real value unchanged in real mode', () => {
    expect(pathToDisplay(1000, 1.5, 'real')).toBe(1000);
  });

  it('inflates by the inflation factor in nominal mode', () => {
    expect(pathToDisplay(1000, 1.5, 'nominal')).toBe(1500);
  });

  it('is identity at inflationFactor = 1 in either mode', () => {
    expect(pathToDisplay(100, 1, 'real')).toBe(100);
    expect(pathToDisplay(100, 1, 'nominal')).toBe(100);
  });
});

describe('round-trip invariants', () => {
  it('pathToDisplay(nominal) then divide by factor recovers the real value', () => {
    const real = 1234.56;
    const f = 1.82;
    const displayed = pathToDisplay(real, f, 'nominal');
    expect(displayed / f).toBeCloseTo(real, 10);
  });

  it('toDisplay(real) then multiply by factor recovers the nominal value', () => {
    const nominal = 9876.54;
    const f = 2.13;
    const displayed = toDisplay(nominal, f, 'real');
    expect(displayed * f).toBeCloseTo(nominal, 10);
  });
});

describe('regression guards', () => {
  // **Why these exist.** PlanComparisonChart (originally RothConversionComparisonChart)
  // had a custom
  // `deflate` helper that divided already-real path values by inflation again —
  // producing "real-real" units (double-deflated). The chart line ended at
  // ~$6M while the actual real terminal was ~$13M, mismatching the main chart
  // by a factor of (1+r)^horizon. The fix was to use `pathToDisplay` (which
  // treats its input as real and only re-inflates in nominal mode), exactly
  // mirroring the main chart's handling. These guards lock that contract.

  it('pathToDisplay in real mode is identity — no double-deflation', () => {
    // The historical bug pattern was `path[i] / (1+r)^i` applied to already-
    // deflated values. pathToDisplay('real') must be a pass-through; if it
    // ever divides in real mode, this test catches it.
    const inflationFactor = Math.pow(1.03, 30); // ~2.43
    const realPathValue = 13_000_000;
    expect(pathToDisplay(realPathValue, inflationFactor, 'real')).toBe(realPathValue);
  });

  it('pathToDisplay in nominal mode multiplies (re-inflates) — does not divide', () => {
    // Mirror guard: nominal mode must MULTIPLY, not divide. A reversed sign
    // here would silently produce nominal-displayed values smaller than the
    // real baseline, the opposite of what the user expects.
    const inflationFactor = Math.pow(1.03, 30);
    const realPathValue = 13_000_000;
    const nominalDisplay = pathToDisplay(realPathValue, inflationFactor, 'nominal');
    expect(nominalDisplay).toBeGreaterThan(realPathValue);
    expect(nominalDisplay).toBeCloseTo(realPathValue * inflationFactor, 2);
  });
});
