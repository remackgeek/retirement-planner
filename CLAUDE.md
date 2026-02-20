# YARP — Yet Another Retirement Planner

A browser-based retirement planning app positioned between simple tools (HonestMath,
Empower) and full-featured tools (ProjectionLab). The goal: clean UX, honest Monte Carlo
projections, and good tax awareness without overwhelming the user.

> **Naming:** The codebase uses `retirement-planner`. "YARP" is for documentation and
> user-facing text only — don't rename source files or variables.

## Tech Stack

- React 19 + TypeScript (strict), Vite
- PrimeReact + styled-components
- Chart.js for visualization
- IndexedDB (via `idb`) for browser persistence

## Project Structure

- `src/components/` — UI (Sidebar, Chart, SpendingGoalsManager, IncomeEventsManager)
- `src/context/RetirementContext.tsx` — global state, IndexedDB, schema migrations
- `src/services/SimulationService.tsx` — Monte Carlo engine (5000 runs, log-normal)
- `src/services/TaxCalculator.ts` — federal + state tax, memoized, 2024-2026 brackets
- `src/dialogs/` — CRUD and import/export dialogs
- `src/types/` — Scenario, UserData, IncomeEvent, SpendingGoal

## Key Concepts

- **Scenario** — top-level unit holding all user config, persisted to IndexedDB
- **Monte Carlo** — median + 10th percentile portfolio paths, success probability
- **Income events** — 8 types, COLA, before/after-tax, SS 2034 haircut
- **Spending goals** — 11 categories, inflation adjustment, age-based activation
- **Tax** — standard deduction only for now; filing status, state rates, senior/OBBB deductions

## Conventions

Follow existing project patterns when adding new features (types, dialogs, services,
context migrations, chart annotations). Read the existing examples before creating new ones.
Run `npm run test` and `npm run build` to verify changes.

**No backward compatibility required.** This is active development — when fields, types,
or data structures are renamed or removed, just change them cleanly. Do not leave behind
deprecated aliases, re-exports, compatibility shims, or migration code for old field names.
Old data in IndexedDB can be wiped; users will re-enter it.

## Styling Guidelines

Keep the UI **compact and dense**. Prefer tight spacing over generous whitespace — this
is a data-heavy tool, not a marketing page.

### Theme tokens (`src/styles/theme.ts`)

All spacing, colors, font sizes, and border styles are centralized in `theme.ts`.
**Always use theme tokens** — never hardcode hex colors, rem values, or border strings
in components. Import what you need:

```ts
import { spacing, colors, fontSize, border } from '../styles/theme';
// or '../../styles/theme' depending on depth
```

- **`spacing`** — `xs` (0.25rem) through `xl` (1.25rem). Use these for all padding,
  margin, and gap values.
- **`colors`** — surfaces (`bgLight`, `bgMedium`), text (`textPrimary`, `textSecondary`,
  `textMuted`), actions (`primary`, `danger`), accents (`income`/`spending` with `Bg`
  variants), sidebar (`activeRow`, `chipBg`).
- **`fontSize`** — `xs` (0.65rem) through `xl` (1.1rem). `base` (0.85rem) for body text.
- **`border`** — `standard` (`1px solid #ddd`), `light`, `medium`, plus `radius` (4px),
  `radiusRound` (8px), `radiusCircle` (50%).

### Compact spacing rules

- **Padding:** `spacing.xs`–`spacing.sm` for elements, `spacing.md`–`spacing.xl` for
  containers. Avoid `2rem+` anywhere. When in doubt, go tighter.
- **Margins:** zero out default browser margins on headings and `<p>` tags, then add
  only what's needed (typically `0`–`spacing.sm`).
- **Gaps:** `spacing.sm`–`spacing.lg` for flex/grid gaps.
- **General rule:** if a new element adds visible dead space, tighten it. The app should
  feel information-dense and efficient, not padded out.

## Design Direction

The app should be **modular and extensible**. Avoid hardcoded assumptions.

### Simulation engine (priority)
`SimulationService` should evolve toward a pluggable architecture:
- User-selectable simulation strategies (log-normal Monte Carlo is the first)
- Historical sequence-of-returns using real S&P 500 and interest rate data
- Configurable run count, distribution type, parameters
- New strategies drop in without changing the rest of the app

### Planned UX
- Side-by-side scenario comparison (visual, not just switching)
- PDF export of scenario summaries

### Other extensibility
- Portfolio: user-defined asset classes beyond stocks/bonds/cash
- Tax: bracket updates as legislation changes; complex mechanics (RMDs, Roth
  conversions, withdrawal ordering) may be added later but are not current goals
- Income/spending: new types without UI refactoring

## Testing

Two testing layers with different audiences:

### Unit tests (`src/**/*.test.ts`)
Developer-facing, isolated, per-module. Test individual functions directly.

### Scenario tests (`test/scenarios/` + `test/simulation.test.ts`)
Human-facing, end-to-end trust artifacts. The test runner (`test/simulation.test.ts`) is
generic infrastructure — it auto-discovers `test/scenarios/*.json` files, runs them through
`runSimulation()`, and checks results against sidecar `.expected.json` files. **Don't touch
the runner when adding features.** The intelligence lives in the data files.

#### Scenario file format
Each `.json` is a valid `UserData` object (importable by the app) plus `_`-prefixed
test metadata:
- `_description` — what this scenario tests, in plain English
- `_rationale` — why the expected numbers are correct (the trust anchor)
- `_seed` — PRNG seed for reproducible runs

#### Expected output files (`.expected.json`)
Deterministic scenarios (0% stddev) use exact values with `pathValues` spot-checks.
Stochastic scenarios use range-based assertions (`{ "min": 70, "max": 85 }`).
Every expected file **must** include a `_rationale` explaining in plain English why the
numbers are what they are.

#### Key rules
- **When a test breaks, fix the code — not the expected values.** Unless the requirements
  changed, in which case update both the expected values AND the rationale.
- **When adding features,** add degenerate scenarios that isolate the new behavior for
  hand-verification (e.g., 0% variance, no tax, single variable changed).
- **Layer complexity gradually:** start with the simplest scenario that exercises the
  feature (no tax, no inflation, no randomness), then add variables one at a time.
- **Injectable RNG:** `runSimulation()` accepts an optional `random` function parameter.
  Tests pass in a seeded PRNG (`test/utils/seededRandom.ts`); production uses `Math.random`.

#### Adding a new scenario
1. Create `test/scenarios/my-scenario.json` with full `UserData` + `_` metadata
2. Create `test/scenarios/my-scenario.expected.json` with rationale + assertions
3. Run `npm test` — the runner discovers it automatically

## Dev Commands

```
npm run dev        # dev server
npm run build      # type-check + production build
npm run test       # vitest
npm run deploy     # gh-pages
```
