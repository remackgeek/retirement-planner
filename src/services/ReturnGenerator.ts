import type { UserData } from '../types/UserData';
import type { PortfolioAssumptions } from '../types/IncomeEvent';
import {
  HISTORICAL_RETURNS,
  HISTORICAL_FIRST_YEAR,
  HISTORICAL_YEARS,
} from '../data/historicalReturns';

// ---------------- Math primitives (parametric draws) ----------------

// Derive log-normal mu/sigma from arithmetic mean return and standard deviation.
export function lognormalParams(mean: number, stdDev: number): { mu: number; sigma: number } {
  const sigma = Math.sqrt(Math.log(1 + (stdDev * stdDev) / ((1 + mean) * (1 + mean))));
  const mu = Math.log(1 + mean) - (sigma * sigma) / 2;
  return { mu, sigma };
}

export function standardNormalRandom(random: () => number = Math.random): number {
  let u = 0,
    v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Student's t variate with `df` integer degrees of freedom (UI enforces df in 3..12).
// Ratio-of-normals construction: Z / sqrt(V / df), V ~ chi-squared(df) built as sum
// of `df` squared standard normals. Variance of raw t is df/(df-2).
export function studentTRandom(df: number, random: () => number): number {
  const z = standardNormalRandom(random);
  let chiSq = 0;
  for (let i = 0; i < df; i++) {
    const n = standardNormalRandom(random);
    chiSq += n * n;
  }
  return z / Math.sqrt(chiSq / df);
}

// Unit-variance Student's t: scale by sqrt((df-2)/df) so realized variance = 1.
// Drop-in replacement for standardNormalRandom() in the log-normal return formula.
export function standardizedTRandom(df: number, random: () => number): number {
  return studentTRandom(df, random) * Math.sqrt((df - 2) / df);
}

function drawFactor(
  params: { mu: number; sigma: number },
  random: () => number
): number {
  return Math.exp(params.mu + params.sigma * standardNormalRandom(random));
}

// ---------------- Strategy interface ----------------

export interface ReturnGenerator {
  // Number of simulation runs the outer loop should execute. Parametric returns the
  // user's numSimulations setting; historical_rolling is data-driven; the rest are 1.
  getNumRuns(): number;
  // Draw stock/bond growth factors for the given run/year. `random` is consumed only
  // by the parametric generator; historical generators ignore it.
  drawFactors(
    runIndex: number,
    yearIndex: number,
    random: () => number
  ): { stockFactor: number; bondFactor: number };
  // Return the inflation rate (not factor) for the given year. Parametric draws
  // stochastically when inflationStdDev > 0; historical returns the CPI for that year.
  drawInflation(runIndex: number, yearIndex: number, random: () => number): number;
}

// ---------------- Parametric generator ----------------

// Wraps the log-normal + Cholesky + student-t draw logic. RNG cadence is preserved
// exactly so seeded scenarios produce byte-identical results to the pre-refactor engine.
function createParametricGenerator(userData: UserData): ReturnGenerator {
  const pa = userData.portfolioAssumptions;
  const stockParams = lognormalParams(pa.stockReturn, pa.stockStdDev);
  const bondParams = lognormalParams(pa.bondReturn, pa.bondStdDev);
  const inflationParams =
    userData.inflationStdDev > 0
      ? lognormalParams(userData.inflationRate, userData.inflationStdDev)
      : null;

  const rho = pa.stockBondCorrelationEnabled ? pa.stockBondCorrelation : 0;
  const useCorrelation = pa.stockBondCorrelationEnabled && rho !== 0;
  const rhoComplement = useCorrelation ? Math.sqrt(Math.max(0, 1 - rho * rho)) : 1;

  const drawShock: (r: () => number) => number =
    pa.returnDistribution === 'student_t'
      ? (r) => standardizedTRandom(pa.degreesOfFreedom, r)
      : (r) => standardNormalRandom(r);

  return {
    getNumRuns: () => userData.simulationSettings.numSimulations,
    drawFactors(_runIndex, _yearIndex, random) {
      let sf: number;
      let bf: number;
      if (useCorrelation) {
        const z1 = drawShock(random);
        const z2 = drawShock(random);
        sf = Math.exp(stockParams.mu + stockParams.sigma * z1);
        bf = Math.exp(
          bondParams.mu + bondParams.sigma * (rho * z1 + rhoComplement * z2)
        );
      } else {
        const zs = drawShock(random);
        const zb = drawShock(random);
        sf = Math.exp(stockParams.mu + stockParams.sigma * zs);
        bf = Math.exp(bondParams.mu + bondParams.sigma * zb);
      }
      return { stockFactor: sf, bondFactor: bf };
    },
    drawInflation(_runIndex, _yearIndex, random) {
      return inflationParams !== null
        ? drawFactor(inflationParams, random) - 1
        : userData.inflationRate;
    },
  };
}

// ---------------- Historical generators ----------------

// Resolve the historical index for (startYear + yearIndex). If wrap is enabled the
// offset wraps modulo HISTORICAL_YEARS; otherwise overshoot is clamped to the last
// available year (the last row of the series repeats, which is a deliberate choice —
// at end-of-series the safest assumption is "the most recent observation persists"
// rather than inventing synthetic data).
function resolveHistoricalIndex(
  startIndex: number,
  yearIndex: number,
  wrap: boolean
): number {
  const raw = startIndex + yearIndex;
  if (raw < HISTORICAL_YEARS) return raw;
  if (wrap) return raw % HISTORICAL_YEARS;
  return HISTORICAL_YEARS - 1;
}

function validateStartYear(startYear: number | undefined, context: string): number {
  if (startYear === undefined) {
    throw new Error(
      `${context}: historicalStartYear is required when returnModel is historical_single`
    );
  }
  const idx = startYear - HISTORICAL_FIRST_YEAR;
  if (idx < 0 || idx >= HISTORICAL_YEARS) {
    throw new Error(
      `${context}: historicalStartYear ${startYear} is outside the available series ` +
        `(${HISTORICAL_FIRST_YEAR}-${HISTORICAL_FIRST_YEAR + HISTORICAL_YEARS - 1})`
    );
  }
  return idx;
}

function createHistoricalSingleGenerator(userData: UserData): ReturnGenerator {
  const pa = userData.portfolioAssumptions;
  const startIndex = validateStartYear(pa.historicalStartYear, 'HistoricalSingleGenerator');
  const wrap = pa.historicalWrapEnabled ?? false;

  return {
    getNumRuns: () => 1,
    drawFactors(_runIndex, yearIndex) {
      const row = HISTORICAL_RETURNS[resolveHistoricalIndex(startIndex, yearIndex, wrap)];
      return { stockFactor: row.stockFactor, bondFactor: row.bondFactor };
    },
    drawInflation(_runIndex, yearIndex) {
      const row = HISTORICAL_RETURNS[resolveHistoricalIndex(startIndex, yearIndex, wrap)];
      return row.inflationFactor - 1;
    },
  };
}

function retirementHorizon(userData: UserData): number {
  return userData.lifeExpectancy - userData.currentAge + 1;
}

function createHistoricalRollingGenerator(userData: UserData): ReturnGenerator {
  const pa = userData.portfolioAssumptions;
  const wrap = pa.historicalWrapEnabled ?? false;
  const horizon = retirementHorizon(userData);

  // Without wrap: one run per start year where the full horizon fits in the series.
  // With wrap: every start year in the series is valid (wrap fills any overshoot).
  const numRuns = wrap
    ? HISTORICAL_YEARS
    : Math.max(1, HISTORICAL_YEARS - horizon + 1);

  return {
    getNumRuns: () => numRuns,
    drawFactors(runIndex, yearIndex) {
      const row = HISTORICAL_RETURNS[resolveHistoricalIndex(runIndex, yearIndex, wrap)];
      return { stockFactor: row.stockFactor, bondFactor: row.bondFactor };
    },
    drawInflation(runIndex, yearIndex) {
      const row = HISTORICAL_RETURNS[resolveHistoricalIndex(runIndex, yearIndex, wrap)];
      return row.inflationFactor - 1;
    },
  };
}

// ---------------- Nominal (deterministic) generator ----------------

// Used by runSimulation's nominal projection path: blended mean return every year,
// deterministic inflation. Single run, no randomness consumed.
export function createNominalGenerator(userData: UserData): ReturnGenerator {
  const pa = userData.portfolioAssumptions;
  const stockFactor = 1 + pa.stockReturn;
  const bondFactor = 1 + pa.bondReturn;
  return {
    getNumRuns: () => 1,
    drawFactors: () => ({ stockFactor, bondFactor }),
    drawInflation: () => userData.inflationRate,
  };
}

// ---------------- Factory ----------------

export function createReturnGenerator(userData: UserData): ReturnGenerator {
  const model: PortfolioAssumptions['returnModel'] =
    userData.portfolioAssumptions.returnModel ?? 'parametric';
  switch (model) {
    case 'historical_single':
      return createHistoricalSingleGenerator(userData);
    case 'historical_rolling':
      return createHistoricalRollingGenerator(userData);
    case 'parametric':
    default:
      return createParametricGenerator(userData);
  }
}

// ---------------- Black swan overlay ----------------

// Apply per-year multipliers on top of whatever factors the base generator produced.
// Years not listed in the overlay pass through unchanged. O(1) lookup via a Map.
export function buildBlackSwanLookup(
  userData: UserData
): Map<number, { stockMultiplier: number; bondMultiplier: number }> {
  const lookup = new Map<number, { stockMultiplier: number; bondMultiplier: number }>();
  const events = userData.portfolioAssumptions.blackSwanEvents;
  if (!events) return lookup;
  for (const ev of events) {
    lookup.set(ev.year, {
      stockMultiplier: ev.stockMultiplier,
      bondMultiplier: ev.bondMultiplier,
    });
  }
  return lookup;
}

export function applyBlackSwan(
  factors: { stockFactor: number; bondFactor: number },
  year: number,
  lookup: Map<number, { stockMultiplier: number; bondMultiplier: number }>
): { stockFactor: number; bondFactor: number } {
  const ev = lookup.get(year);
  if (!ev) return factors;
  return {
    stockFactor: ev.stockMultiplier,
    bondFactor: ev.bondMultiplier,
  };
}
