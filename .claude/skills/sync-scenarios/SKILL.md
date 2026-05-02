---
name: sync-scenarios
description: Update all scenario JSONs when types change
user-invocable: true
---

# Sync Scenario Files

Update all scenario JSON files in `test/scenarios/` to match current type definitions.

## Steps

1. **Read current types** — read all files in `src/types/` to get the authoritative field
   list for UserData, IncomeEvent, SpendingGoal, PortfolioAssumptions, RetirementSpending.

2. **Read all scenario JSONs** — glob `test/scenarios/*.json` (exclude `.expected.json`).

3. **Diff fields** — for each scenario file, compare its keys against the type definitions.
   Report:
   - Fields in types but missing from scenario JSON (need to add)
   - Fields in scenario JSON but not in types (stale, need to remove)
   - Also check nested objects: `retirementSpending`, `portfolioAssumptions`,
     each item in `incomeEvents` and `spendingGoals` arrays

4. **Fix each file** — add missing fields with sensible defaults:
   - Strings: `null` or `""` depending on type nullability
   - Numbers: `0` or `null` depending on type nullability
   - Booleans: `false`
   - Arrays: `[]`
   - New optional IncomeEvent fields: only add if the event type requires them
   - Remove stale fields that no longer exist in types

5. **Don't touch expected files** — `.expected.json` files have their own schema
   and don't need field sync.

6. **Run tests** — `npm run test` to verify nothing broke.

7. **Report** — list every file changed and what was added/removed.
