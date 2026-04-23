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
