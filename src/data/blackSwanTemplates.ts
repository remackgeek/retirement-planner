// Named historical-event templates for black swan overlays. Each template is a
// SEQUENCE of yearly multipliers spanning the full crisis arc — both the dip and
// the recovery years — so users see the same shape on the chart that a real
// retiree would have lived through. Multipliers are `1 + return` from the
// corresponding rows of HISTORICAL_RETURNS.
//
// The data is independent of historicalReturns.ts so these templates remain
// stable even if the historical table is ever reweighted or regenerated.

export interface BlackSwanYear {
  stockMultiplier: number;
  bondMultiplier: number;
}

export interface BlackSwanTemplate {
  id: string;
  label: string;
  // One entry per year, in chronological order. The first entry maps to the
  // user's chosen start year; subsequent entries map to start+1, start+2, etc.
  years: BlackSwanYear[];
}

export const BLACK_SWAN_TEMPLATES: BlackSwanTemplate[] = [
  {
    id: 'great-depression',
    label: 'Great Depression (1929-1932)',
    years: [
      { stockMultiplier: 0.9170, bondMultiplier: 1.0420 }, // 1929: -8.30% / +4.20%
      { stockMultiplier: 0.7488, bondMultiplier: 1.0454 }, // 1930: -25.12% / +4.54%
      { stockMultiplier: 0.5616, bondMultiplier: 0.9744 }, // 1931: -43.84% / -2.56%
      { stockMultiplier: 0.9136, bondMultiplier: 1.0879 }, // 1932: -8.64% / +8.79%
    ],
  },
  {
    id: 'roosevelt-recession',
    label: 'Roosevelt Recession (1937-1938)',
    years: [
      { stockMultiplier: 0.6466, bondMultiplier: 1.0138 }, // 1937: -35.34% / +1.38%
      { stockMultiplier: 1.2928, bondMultiplier: 1.0421 }, // 1938: +29.28% / +4.21%
    ],
  },
  {
    id: 'stagflation-1970s',
    label: '1970s Stagflation (1973-1975)',
    years: [
      { stockMultiplier: 0.8569, bondMultiplier: 1.0366 }, // 1973: -14.31% / +3.66%
      { stockMultiplier: 0.7410, bondMultiplier: 1.0199 }, // 1974: -25.90% / +1.99%
      { stockMultiplier: 1.3700, bondMultiplier: 1.0361 }, // 1975: +37.00% / +3.61%
    ],
  },
  {
    id: 'dotcom-crash',
    label: 'Dot-Com Crash (2000-2003)',
    years: [
      { stockMultiplier: 0.9097, bondMultiplier: 1.1666 }, // 2000: -9.03% / +16.66%
      { stockMultiplier: 0.8815, bondMultiplier: 1.0557 }, // 2001: -11.85% / +5.57%
      { stockMultiplier: 0.7803, bondMultiplier: 1.1512 }, // 2002: -21.97% / +15.12%
      { stockMultiplier: 1.2836, bondMultiplier: 1.0038 }, // 2003: +28.36% / +0.38%
    ],
  },
  {
    id: 'gfc',
    label: 'Global Financial Crisis (2008-2009)',
    years: [
      { stockMultiplier: 0.6345, bondMultiplier: 1.2010 }, // 2008: -36.55% / +20.10%
      { stockMultiplier: 1.2594, bondMultiplier: 0.8888 }, // 2009: +25.94% / -11.12%
    ],
  },
  {
    id: 'inflation-2022',
    label: '2022 Inflation Shock (2022-2023)',
    years: [
      { stockMultiplier: 0.8196, bondMultiplier: 0.8217 }, // 2022: -18.04% / -17.83%
      { stockMultiplier: 1.2606, bondMultiplier: 1.0388 }, // 2023: +26.06% / +3.88%
    ],
  },
];

// Match an event's multipliers back to the template (and year-within-template)
// it came from. Used by the editor to label each row with the source template's
// name. Floating-point equality is safe because event values are copied verbatim
// from the template constants (no arithmetic in between).
export function findTemplateForEvent(
  event: { stockMultiplier: number; bondMultiplier: number }
): BlackSwanTemplate | undefined {
  return BLACK_SWAN_TEMPLATES.find((t) =>
    t.years.some(
      (y) =>
        y.stockMultiplier === event.stockMultiplier &&
        y.bondMultiplier === event.bondMultiplier
    )
  );
}
