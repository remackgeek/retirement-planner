import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { runSimulation } from '../src/services/SimulationService';
import { createSeededRandom } from './utils/seededRandom';

// Auto-discover scenario files (exclude .expected.json)
const scenariosDir = join(__dirname, 'scenarios');
const scenarioFiles = readdirSync(scenariosDir)
  .filter((f) => f.endsWith('.json') && !f.endsWith('.expected.json'))
  .sort();

interface PathCheck {
  index: number;
  age?: number;
  value: number;
  tolerance?: number;
  note?: string;
}

interface BreakdownCheck {
  index: number;
  field: string;
  value?: number;
  min?: number;
  max?: number;
  tolerance?: number;
  _note?: string;
}

interface ExpectedExact {
  _rationale: string;
  probability: number;
  pathValues?: PathCheck[];
  breakdownChecks?: BreakdownCheck[];
  tolerance?: number;
}

interface ExpectedRange {
  _rationale: string;
  probability: { min: number; max: number };
  medianFinalBalance?: { min: number; max: number };
}

type Expected = ExpectedExact | ExpectedRange;

function isRangeExpected(expected: Expected): expected is ExpectedRange {
  return typeof expected.probability === 'object';
}

describe('Scenario simulations', () => {
  scenarioFiles.forEach((file) => {
    const scenarioPath = join(scenariosDir, file);
    const scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'));
    const label = scenario._description || file;

    describe(label, () => {
      const seed = scenario._seed ?? 12345;
      const random = createSeededRandom(seed);
      const result = runSimulation(scenario, random);

      it('runs without crashing and returns correct array lengths', () => {
        const expectedYears = scenario.lifeExpectancy - scenario.currentAge + 1;
        expect(result.years).toHaveLength(expectedYears);
        expect(result.median).toHaveLength(expectedYears);
        expect(result.downside).toHaveLength(expectedYears);
        expect(result.nominal).toHaveLength(expectedYears);
        expect(result.probability).toBeGreaterThanOrEqual(0);
        expect(result.probability).toBeLessThanOrEqual(100);
      });

      // Load expected output if it exists
      const expectedPath = scenarioPath.replace('.json', '.expected.json');
      let expected: Expected | null = null;
      try {
        expected = JSON.parse(readFileSync(expectedPath, 'utf-8'));
      } catch {
        // No expected file — only basic assertions above
      }

      if (expected) {
        if (isRangeExpected(expected)) {
          // Stochastic scenario — range-based assertions
          it(`probability is within expected range [${expected.probability.min}%, ${expected.probability.max}%]`, () => {
            expect(result.probability).toBeGreaterThanOrEqual(
              expected!.probability.min
            );
            expect(result.probability).toBeLessThanOrEqual(
              expected!.probability.max
            );
          });

          if (expected.medianFinalBalance) {
            it('median final balance is within expected range', () => {
              const finalBalance = result.median[result.median.length - 1];
              const range = (expected as ExpectedRange).medianFinalBalance!;
              expect(finalBalance).toBeGreaterThanOrEqual(range.min);
              expect(finalBalance).toBeLessThanOrEqual(range.max);
            });
          }
        } else {
          // Deterministic scenario — exact assertions
          it(`probability is exactly ${expected.probability}%`, () => {
            expect(result.probability).toBe(expected!.probability);
          });

          if (expected.pathValues) {
            const globalTolerance = expected.tolerance ?? 0.01;
            expected.pathValues.forEach((check: PathCheck) => {
              const tol = check.tolerance ?? globalTolerance;
              const label = check.age ? `age ${check.age}` : `index ${check.index}`;
              it(`${label} (index ${check.index}): median balance ≈ ${check.value}`, () => {
                const actual = result.median[check.index];
                expect(Math.abs(actual - check.value)).toBeLessThanOrEqual(tol);
              });
            });
          }

          if (expected.breakdownChecks) {
            expected.breakdownChecks.forEach((check: BreakdownCheck) => {
              const note = check._note ?? `${check.field} at index ${check.index}`;
              it(`breakdown: ${note}`, () => {
                const bd = result.medianBreakdowns[check.index] as Record<string, number>;
                const actual = bd[check.field];
                expect(actual).toBeDefined();
                if (check.value !== undefined) {
                  const tol = check.tolerance ?? 1;
                  expect(Math.abs(actual - check.value)).toBeLessThanOrEqual(tol);
                }
                if (check.min !== undefined) {
                  expect(actual).toBeGreaterThanOrEqual(check.min);
                }
                if (check.max !== undefined) {
                  expect(actual).toBeLessThanOrEqual(check.max);
                }
              });
            });
          }
        }
      }
    });
  });
});
