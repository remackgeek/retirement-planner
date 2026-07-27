import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { runSimulation, projectionHorizonYears } from '../src/services/SimulationService';
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

// One unified expected-file shape. `probability` is either an exact number
// (deterministic scenario) or a {min,max} range (stochastic). Every other
// assertion block runs regardless of which probability form is used — the
// old runner silently SKIPPED pathValues/breakdownChecks in range files and
// medianFinalBalance in exact files, leaving carefully-written assertions
// dead for years.
interface Expected {
  _rationale: string;
  probability: number | { min: number; max: number };
  medianFinalBalance?: { min: number; max: number };
  pathValues?: PathCheck[];
  breakdownChecks?: BreakdownCheck[];
  tolerance?: number;
}

// Keys the runner understands. Anything else in an expected file is a silent
// no-op — fail loudly so a typo'd or unsupported key can't masquerade as a
// passing assertion. Underscore-prefixed keys are documentation by convention.
const KNOWN_EXPECTED_KEYS = new Set([
  'probability',
  'medianFinalBalance',
  'pathValues',
  'breakdownChecks',
  'tolerance',
]);

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
        // Death-model horizon, not the self-only lifeExpectancy − currentAge + 1:
        // when spouseLifeExpectancy extends past self's death, the projection
        // runs to the survivor's death.
        const expectedYears = projectionHorizonYears(scenario);
        expect(result.years).toHaveLength(expectedYears);
        expect(result.median).toHaveLength(expectedYears);
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
        const exp = expected;

        it('expected file contains only keys the runner asserts', () => {
          const unknown = Object.keys(exp).filter(
            (k) => !k.startsWith('_') && !KNOWN_EXPECTED_KEYS.has(k)
          );
          expect(unknown, `unknown keys in ${file.replace('.json', '.expected.json')}: ${unknown.join(', ')} — the runner would silently ignore these`).toEqual([]);
        });

        if (typeof exp.probability === 'number') {
          const p = exp.probability;
          it(`probability is exactly ${p}%`, () => {
            expect(result.probability).toBe(p);
          });
        } else {
          const range = exp.probability;
          it(`probability is within expected range [${range.min}%, ${range.max}%]`, () => {
            expect(result.probability).toBeGreaterThanOrEqual(range.min);
            expect(result.probability).toBeLessThanOrEqual(range.max);
          });
        }

        if (exp.medianFinalBalance) {
          const range = exp.medianFinalBalance;
          it('median final balance is within expected range', () => {
            const finalBalance = result.median[result.median.length - 1];
            expect(finalBalance).toBeGreaterThanOrEqual(range.min);
            expect(finalBalance).toBeLessThanOrEqual(range.max);
          });
        }

        if (exp.pathValues) {
          const globalTolerance = exp.tolerance ?? 0.01;
          exp.pathValues.forEach((check: PathCheck) => {
            const tol = check.tolerance ?? globalTolerance;
            const label = check.age ? `age ${check.age}` : `index ${check.index}`;
            it(`${label} (index ${check.index}): median balance ≈ ${check.value}`, () => {
              if (check.age !== undefined) {
                // Cross-check the human-readable age against the index so a
                // drifted file can't lie in its label.
                expect(scenario.currentAge + check.index, 'pathValues age does not match currentAge + index').toBe(check.age);
              }
              const actual = result.median[check.index];
              expect(Math.abs(actual - check.value)).toBeLessThanOrEqual(tol);
            });
          });
        }

        if (exp.breakdownChecks) {
          exp.breakdownChecks.forEach((check: BreakdownCheck) => {
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
    });
  });
});
