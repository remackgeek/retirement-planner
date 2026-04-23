// Annual historical returns (1928–2024), one row per calendar year.
//
// Sources (approximate, commonly cited values):
//   stockReturn     — S&P 500 total return with dividends reinvested
//                     (Damodaran NYU Stern historical returns dataset, plus Shiller pre-1926 extension)
//   bondReturn      — 10-year US Treasury total return (coupon + price change)
//   inflationRate   — CPI-U year-over-year (Dec / Dec), BLS
//
// Values are stored as decimals (0.07 = +7.0%). `factor` columns are `1 + rate` for
// direct multiplication in the simulation loop. Pre-verified against the Damodaran
// 2024 update for the major stress years (1929–32, 1973–74, 2000–02, 2008, 2022).
//
// This data is used by HistoricalSingleGenerator and HistoricalRollingGenerator in
// ReturnGenerator.ts. For historical modes inflation is paired with contemporaneous
// returns (so 1970s stagflation keeps bad returns + high inflation correlated).

export interface HistoricalYear {
  year: number;
  stockFactor: number;    // 1 + stock total return
  bondFactor: number;     // 1 + bond total return
  inflationFactor: number; // 1 + CPI-U yoy
}

// Helper: build HistoricalYear from percentage returns (keeps the table readable).
const y = (year: number, stockPct: number, bondPct: number, cpiPct: number): HistoricalYear => ({
  year,
  stockFactor: 1 + stockPct / 100,
  bondFactor: 1 + bondPct / 100,
  inflationFactor: 1 + cpiPct / 100,
});

export const HISTORICAL_RETURNS: HistoricalYear[] = [
  y(1928,  43.81,  0.84, -1.17),
  y(1929,  -8.30,  4.20,  0.58),
  y(1930, -25.12,  4.54, -6.40),
  y(1931, -43.84, -2.56, -9.32),
  y(1932,  -8.64,  8.79, -10.27),
  y(1933,  49.98,  1.86,  0.76),
  y(1934,  -1.19,  7.96,  1.52),
  y(1935,  46.74,  4.47,  2.99),
  y(1936,  31.94,  5.02,  1.45),
  y(1937, -35.34,  1.38,  2.86),
  y(1938,  29.28,  4.21, -2.78),
  y(1939,  -1.10,  4.41,  0.00),
  y(1940, -10.67,  5.40,  0.71),
  y(1941, -12.77, -2.02,  9.93),
  y(1942,  19.17,  2.29,  9.03),
  y(1943,  25.06,  2.49,  2.96),
  y(1944,  19.03,  2.58,  2.30),
  y(1945,  35.82,  3.80,  2.25),
  y(1946,  -8.43,  3.13, 18.13),
  y(1947,   5.20,  0.92,  8.84),
  y(1948,   5.70,  1.95,  2.99),
  y(1949,  18.30,  4.66, -2.07),
  y(1950,  30.81,  0.43,  5.93),
  y(1951,  23.68, -0.30,  6.00),
  y(1952,  18.15,  2.27,  0.75),
  y(1953,  -1.21,  4.14,  0.75),
  y(1954,  52.56,  3.29, -0.74),
  y(1955,  32.60, -1.34,  0.37),
  y(1956,   7.44, -2.26,  2.99),
  y(1957, -10.46,  6.80,  2.90),
  y(1958,  43.72, -2.10,  1.76),
  y(1959,  12.06, -2.65,  1.73),
  y(1960,   0.34, 11.64,  1.36),
  y(1961,  26.64,  2.06,  0.67),
  y(1962,  -8.81,  5.69,  1.33),
  y(1963,  22.61,  1.68,  1.64),
  y(1964,  16.42,  3.73,  0.97),
  y(1965,  12.40,  0.72,  1.92),
  y(1966, -10.06,  2.91,  3.46),
  y(1967,  23.80, -1.58,  3.04),
  y(1968,  10.81,  3.27,  4.72),
  y(1969,  -8.24, -5.01,  6.20),
  y(1970,   3.56, 16.75,  5.57),
  y(1971,  14.22,  9.79,  3.27),
  y(1972,  18.76,  2.82,  3.41),
  y(1973, -14.31,  3.66,  8.71),
  y(1974, -25.90,  1.99, 12.34),
  y(1975,  37.00,  3.61,  6.94),
  y(1976,  23.83, 15.98,  4.86),
  y(1977,  -6.98,  1.29,  6.70),
  y(1978,   6.51, -0.78,  9.02),
  y(1979,  18.52,  0.67, 13.29),
  y(1980,  31.74, -2.99, 12.52),
  y(1981,  -4.70,  8.20,  8.92),
  y(1982,  20.42, 32.81,  3.83),
  y(1983,  22.34,  3.20,  3.79),
  y(1984,   6.15, 13.73,  3.95),
  y(1985,  31.24, 25.71,  3.80),
  y(1986,  18.49, 24.28,  1.10),
  y(1987,   5.81, -4.96,  4.43),
  y(1988,  16.54,  8.22,  4.42),
  y(1989,  31.48, 17.69,  4.65),
  y(1990,  -3.06,  6.24,  6.11),
  y(1991,  30.23, 15.00,  3.06),
  y(1992,   7.49,  9.36,  2.90),
  y(1993,   9.97, 14.21,  2.75),
  y(1994,   1.33, -8.04,  2.67),
  y(1995,  37.20, 23.48,  2.54),
  y(1996,  22.68,  1.43,  3.32),
  y(1997,  33.10,  9.94,  1.70),
  y(1998,  28.34, 14.92,  1.61),
  y(1999,  20.89, -8.25,  2.68),
  y(2000,  -9.03, 16.66,  3.39),
  y(2001, -11.85,  5.57,  1.55),
  y(2002, -21.97, 15.12,  2.38),
  y(2003,  28.36,  0.38,  1.88),
  y(2004,  10.74,  4.49,  3.26),
  y(2005,   4.83,  2.87,  3.42),
  y(2006,  15.61,  1.96,  2.54),
  y(2007,   5.48, 10.21,  4.08),
  y(2008, -36.55, 20.10,  0.09),
  y(2009,  25.94, -11.12,  2.72),
  y(2010,  14.82,  8.46,  1.50),
  y(2011,   2.10, 16.04,  2.96),
  y(2012,  15.89,  2.97,  1.74),
  y(2013,  32.15, -9.10,  1.50),
  y(2014,  13.52, 10.75,  0.76),
  y(2015,   1.38,  1.28,  0.73),
  y(2016,  11.77,  0.69,  2.07),
  y(2017,  21.61,  2.80,  2.11),
  y(2018,  -4.23, -0.02,  1.91),
  y(2019,  31.22,  9.64,  2.29),
  y(2020,  18.02, 11.33,  1.36),
  y(2021,  28.47, -4.42,  7.04),
  y(2022, -18.04, -17.83,  6.45),
  y(2023,  26.06,  3.88,  3.35),
  y(2024,  25.02,  0.96,  2.89),
];

export const HISTORICAL_FIRST_YEAR = HISTORICAL_RETURNS[0].year;
export const HISTORICAL_LAST_YEAR = HISTORICAL_RETURNS[HISTORICAL_RETURNS.length - 1].year;
export const HISTORICAL_YEARS = HISTORICAL_RETURNS.length;

// Index lookup helper. Returns undefined for years outside the series (callers decide wrap/clamp).
export function getHistoricalIndex(year: number): number | undefined {
  if (year < HISTORICAL_FIRST_YEAR || year > HISTORICAL_LAST_YEAR) return undefined;
  return year - HISTORICAL_FIRST_YEAR;
}
