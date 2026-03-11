---
name: scenario
description: Create a new scenario test with expected output
user-invocable: true
argument-hint: [description-of-what-to-test]
---

# Create Scenario Test

Create a new scenario test pair in `test/scenarios/`. The scenario should test: $ARGUMENTS

## Steps

1. **Read types first** — read all files in `src/types/` to get the current field definitions
   for UserData, Scenario, IncomeEvent, SpendingGoal, PortfolioAssumptions, RetirementSpending.

2. **Read an existing example** — read `test/scenarios/ss-basic.json` and
   `test/scenarios/ss-basic.expected.json` as format reference.

3. **Design the scenario** — isolate the behavior being tested:
   - Start simple: 0% variance, 0% inflation, no tax, single variable changed
   - Only add complexity if the test specifically requires it
   - Use deterministic settings (stddev 0) unless testing stochastic behavior
   - Choose a short lifespan (10-15 years) to keep spot-checks manageable

4. **Create the scenario JSON** — must include:
   - `_description` — what this scenario tests, in plain English
   - `_rationale` — why the expected numbers are correct (the trust anchor)
   - `_seed` — PRNG seed (use 12345 for deterministic, pick something for stochastic)
   - **ALL fields from UserData** — every single one, no omissions:
     - `name`, `currentAge`, `retirementAge`, `lifeExpectancy`, `referenceYear`
     - `currentSavings`, `annualSavings`
     - `retirementSpending` (with `monthlyAmount`, `startAge`)
     - `spendingGoals` (array, can be empty)
     - `incomeEvents` (array, can be empty)
     - `portfolioAssumptions` (with `riskLevel`, `expectedReturn`, `standardDeviation`)
     - `inflationRate`
     - `filingStatus`, `spouseName`, `spouseAge`, `state`

5. **Create the expected JSON** — must include:
   - `_rationale` — plain English explanation of WHY each number is what it is
   - For deterministic scenarios: `probability: 100`, `pathValues` array with spot-checks,
     `tolerance: 1.0`
   - For stochastic scenarios: range-based `probability: { "min": X, "max": Y }`
   - pathValues format: `{ "index": N, "age": A, "value": V, "note": "explanation" }`
   - Include at least: start, one middle point, and end

6. **Hand-verify the math** — before writing the expected file, manually calculate at least
   3 data points and show your work. This is critical — the expected file IS the trust anchor.

7. **Run tests** — `npm run test` to verify the new scenario passes.

## Naming

Use kebab-case: `my-scenario-name.json` + `my-scenario-name.expected.json`
