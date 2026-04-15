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
- `src/dialogs/` — type-specific edit dialogs (e.g., `SocialSecurityDialog`),
  shared `IncomeEventDialog` for other types, type-selection pickers, import/export
- `src/types/` — Scenario, UserData, IncomeEvent, SpendingGoal
- `src/utils/defaultName.ts` — `eventTypeLabels`, `goalTypeLabels`, default name generators

## Key Concepts

- **Scenario** — top-level unit holding all user config, persisted to IndexedDB
- **Monte Carlo** — median + 10th percentile portfolio paths, success probability
- **Income events** — 9 types (including `employment_savings` for pre-retirement savings),
  each with a required `name` (auto-generated defaults like "Pension Income 1"),
  COLA, before/after-tax, SS 2034 haircut (configurable). All cash flow flows through
  events/goals — no special-cased fields on UserData
- **Spending goals** — 11 categories, each with a required `name` (auto-generated defaults
  like "Vacation 1"), inflation adjustment, age-based activation.
  `living_expenses` goals support optional `yearlyDecreasePercent` for spending decay
- **Tax** — aggregate income taxation; SS 50%/85% taxable fraction (IRS provisional
  income formula); standard deduction, filing status, state rates with optional
  relocation timeline, senior/OBBB deductions
- **State timeline** — ordered list of `{ state, startYear? }` on `UserData`. First entry
  is current state (no startYear); subsequent entries are future relocations. Simulation
  resolves effective state per year via `getStateTaxRate(userData, year)`

## Conventions

Follow existing project patterns when adding new features (types, dialogs, services,
context migrations, chart annotations). Read the existing examples before creating new ones.
Run `npm run test` and `npm run build` to verify changes.

**Never commit or push.** The user controls all git operations. When work is done, say so —
do not offer to commit, stage files, or push.

**Income event dialogs:** Each income event type should get its own dedicated dialog
with type-specific fields and labels (Social Security is the first). The type-selection
picker (`EventTypeSelectionDialog`) remains the entry point; `IncomeEventsManager` routes
to the correct per-type dialog. New income types should get a dedicated dialog, not extend
the shared `IncomeEventDialog`.

**Spending goal dialogs:** Spending goal types that have meaningful type-specific fields
should get their own dedicated dialog (e.g., healthcare with recurring vs. one-time toggle,
education with beneficiary, home purchase with down payment vs. full price). The type-selection
picker (`SpendingGoalTypeSelectionDialog`) remains the entry point; `SpendingGoalsManager`
routes to the correct per-type dialog. Simple goal types without unique fields can share
`SpendingGoalDialog`, but create dedicated dialogs where it meaningfully improves UX.

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
- **`colors`** — semantic aliases only; never reference raw hex values here directly.
  Groups: surfaces (`bgLight`, `bgMedium`, `bgHover`), borders (`border`, `borderLight`,
  `borderMedium`), text (`textPrimary`, `textSecondary`, `textMuted`), actions (`primary`,
  `danger`), accents (`income`/`spending` with `Bg` variants), chart lines
  (`chartMedian`, `chartNominal`, `chartDownside`), shadows/overlays (`shadowLight`,
  `shadowMedium`, `overlayLight`), sidebar (`activeRow`, `chipBg`).
  **Two-tier rule:** when adding a color, first add the hex to the private `palette`
  object (named by hue + shade, e.g. `blue600`), then add a semantic alias in `colors`
  that references it. Components always import from `colors`; never from `palette`.
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

## Responsive Design

Single breakpoint at **768px** — phones below, tablet/desktop above.

### Tokens (all in `src/styles/theme.ts`)

- `breakpoints.mobile` — raw pixel value (768) for JS use
- `mediaQuery.mobile` / `mediaQuery.desktop` — pre-built strings for styled-components
- `layout.sidebarExpanded` / `layout.sidebarCollapsed` — sidebar width constants
- `layout.managerMinWidth` — minimum panel width before wrapping (280px)

**Rule: always use `mediaQuery.mobile` / `mediaQuery.desktop` — never write raw `@media`
strings in components.**

### Sidebar

- **Desktop (≥ 768px):** push layout. `isSidebarOpen=true` → 300px, `false` → 50px strip.
  Toggle button (◀/▶) lives inside the sidebar.
- **Mobile (< 768px):** fixed overlay (`position: fixed; z-index: 100`). `isSidebarOpen=true`
  → slides in from left, `false` → hidden (`translateX(-100%)`). A hamburger button in
  `AppHeader` opens it; a close button (✕) inside the sidebar closes it; tapping the
  backdrop also closes it.

`isSidebarOpen` state lives in `AppContent.tsx` and is passed as props to:
- `AppHeader` via `onMenuToggle: () => void`
- `Sidebar` via `isOpen: boolean` + `onToggle: () => void`

### Income/Spending columns (and future third column)

`ManagerSection` uses `flex: 1 1 ${layout.managerMinWidth}` inside a `flex-wrap: wrap`
container. Columns stack automatically on phones (no explicit media query needed). To add a
third column, just add a third `<ManagerSection>` — it auto-wraps at the right breakpoint.

### Yearly Data table

Intentionally **not** responsive — the expanded table only has horizontal scroll. If users
want to examine yearly data on a phone, they should rotate or use a larger device. The
accordion **header** (view selector + CSV button) does wrap on mobile via `flex-wrap`.

## Design Direction

The app should be **modular and extensible**. Avoid hardcoded assumptions.

### Simulation engine

`SimulationService` uses log-normal Monte Carlo (5000 runs default). All simulation
parameters are per-scenario in `UserData`:

- `portfolioAssumptions.portfolioBalance` — `'80_20' | '60_40' | '50_50' | 'custom'`;
  presets set `stockAllocation` only — return assumptions are independent
- `portfolioAssumptions.stockAllocation` — fraction in stocks (0.0–1.0); bonds = 1 - stock
- `portfolioAssumptions.stockReturn` / `stockStdDev` — stock log-normal return params
- `portfolioAssumptions.bondReturn` / `bondStdDev` — bond log-normal return params
- `simulationSettings.numSimulations` — run count (1000 / 5000 / 10000)
- `inflationRate` — annual inflation, affects cash flow inflation-adjustment
- `inflationStdDev` — inflation volatility; affects portfolio deflation (real vs nominal)
  in the MC loop only; cash flows always use the deterministic mean `inflationRate`

**Monte Carlo path construction:** each year draws independent stock and bond return factors;
portfolio return = `stockAllocation × stockFactor + bondAllocation × bondFactor`. Annual
rebalancing to target allocation is assumed. The median and downside paths are the single
simulation runs whose final balance is closest to the 50th/10th percentile of all final
balances — coherent per-year paths with actual return factors, not year-by-year envelopes.

**Per-path breakdowns:** `runSimulation()` returns `medianBreakdowns` and `downsideBreakdowns`
(`AnnualCashFlowBreakdown[]`) alongside the path arrays. These are computed during the
simulation loop (not post-hoc) and capture the effective per-year cash flow for each
representative run — including portfolio depletion effects (when balance hits $0,
`portfolioWithdrawal` is capped at the available balance and a spending shortfall is shown).
The deterministic (Nominal) path uses `nominalBreakdowns` computed in `Chart.tsx`. The
yearly data detail rows show the breakdown for whichever view is selected.

Future direction:

- Historical sequence-of-returns using real S&P 500 and interest rate data
- Fat-tail / no-tail distribution options
- New strategies drop in without changing the rest of the app (`modelType` placeholder
  reserved in `SimulationSettings`)
- **Stock/bond correlation**: returns are currently drawn independently per year. Real
  negative correlation (~-0.2) slightly understates diversification benefit. Future: inject
  a correlation matrix into the return generation step.
- **Full stochastic inflation**: `inflationStdDev` currently only affects portfolio deflation
  (real vs nominal balance). Future: propagate per-run cumulative inflation to cash flow
  adjustments (income/spending), which requires rethinking whether users enter amounts in
  today's dollars vs nominal future dollars throughout the UI.
- **Median/downside path construction**: currently uses the single run whose final balance
  is closest to the 50th/10th percentile. An alternative is year-by-year percentile envelopes
  (smoother chart lines, but synthetic paths with no coherent per-year actuals). The
  representative-run approach was chosen to enable exact stock/bond attribution in detail rows.

### Top bar: Settings menu

`AppHeader` renders a single **Settings** dropdown (PrimeReact `Menu` popup) with two items:

- **Portfolio** → `PortfolioDialog` — stock/bond split (80/20, 60/40, 50/50, Custom);
  selecting a preset sets `stockAllocation` only; return assumptions are managed in Modeling
- **Modeling** → `ModelingDialog` — stock/bond expected return % and std dev % (grouped),
  inflation rate % and std dev %, simulation run count; read-only blended return display

Both dialogs are disabled when no active scenario.

### Implemented UX

- **View selection**: radio control (Median / Deterministic / Downside) in the yearly
  data header; selected path renders bold on the chart; portfolio balance, income/spending/
  tax detail rows, and portfolio growth all reflect the selected path. Depleted years on
  downside/median paths show a shortfall indicator in the detail row.
- **CSV export**: download button in yearly data header exports all three portfolio paths
  plus full income/spending/tax breakdown per year as a `.csv` file

### Planned UX

- Side-by-side scenario comparison (visual, not just switching)
- PDF export of scenario summaries
- Monthly/annual input toggle for remaining spending goal and income event dialogs
  (the `amountPeriod` field is already on both `SpendingGoal` and `IncomeEvent` types;
  living expenses and Social Security dialogs already have the toggle)

### Other extensibility

- Portfolio: user-defined asset classes beyond stocks/bonds/cash
- Tax: bracket updates as legislation changes; complex mechanics (RMDs, Roth
  conversions, withdrawal ordering) may be added later but are not current goals
- Income/spending: new types without UI refactoring
- State timeline: "Other" option with custom name + tax rate for international
  retirement (Mexico, Portugal, etc.)

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
- **When changing `UserData` or `Scenario` fields,** update ALL existing scenario JSON
  files to include the new fields. Scenario files must stay in sync with the type
  definitions — missing fields won't cause TypeScript errors (they're plain JSON) but
  will silently produce wrong defaults at runtime.
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
