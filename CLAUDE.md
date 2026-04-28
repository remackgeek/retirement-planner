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

- `src/components/` — UI (Sidebar, Chart, AccountsManager, SpendingGoalsManager, IncomeEventsManager)
- `src/context/RetirementContext.tsx` — global state, IndexedDB, schema migrations
- `src/services/SimulationService.tsx` — Monte Carlo engine (5000 runs, log-normal)
- `src/services/TaxCalculator.ts` — federal + state tax, memoized, 2024-2026 brackets
- `src/dialogs/` — type-specific edit dialogs (e.g., `SocialSecurityDialog`),
  shared `IncomeEventDialog` for other types, type-selection pickers, import/export
- `src/types/` — Scenario, UserData, Account, IncomeEvent, SpendingGoal
- `src/utils/defaultName.ts` — `eventTypeLabels`, `goalTypeLabels`, default name generators

## Key Concepts

- **Scenario** — top-level unit holding all user config, persisted to IndexedDB.
  Carries an optional `lastSuccessProbability?: number` field that is the **last
  computed Monte Carlo success probability**, used **only** to display a stable `%`
  on inactive scenario rows in the sidebar without re-running 5000-sim MC for each.
  This is a sidebar display cache — never read it from simulation, chart, CSV
  export, scenario JSON export logic, or tests. Authoritative probability always
  comes from the live `runSimulation()` result for the active scenario.
- **Monte Carlo** — median + 10th percentile portfolio paths, success probability
- **Accounts** — 3 tax-profile types: `traditional` (withdrawals taxed as ordinary income),
  `roth` (withdrawals tax-free), `taxable` (withdrawals taxed at flat LTCG rate).
  Replaces the old single `currentSavings` field. All accounts share the scenario's
  stock/bond allocation. Withdrawals follow a fixed waterfall: Taxable → Traditional → Roth.
  Employment-savings income events target a specific account via `accountId`.
  **RMD:** Traditional accounts trigger Required Minimum Distributions at age 73+ (SECURE 2.0,
  IRS Uniform Lifetime Table). The simulation forces `withdrawalFromTraditional ≥ rmdRequired`
  each year. Excess RMD beyond the spending need is reinvested into the first taxable account;
  if none exists, `ensureRMDReinvestmentAccount` auto-creates a `"RMD Reinvestment"` taxable
  account in the working simulation copy (not persisted to UserData). Roth accounts are exempt.
  RMD amounts are taxed as ordinary income like all Traditional withdrawals.
  RMD is calculated on the beginning-of-year (pre-growth) Traditional balance,
  matching the IRS Dec 31 prior-year rule. The simulation captures this balance
  before applying growth in each loop iteration.
  **Per-owner RMD:** `Account` has an optional `owner?: 'self' | 'spouse'` field (defaults to
  `'self'`). The simulation splits Traditional balances by owner and calls `calculateRMD`
  separately for each group using the correct age (`userData.currentAge` for self,
  `userData.spouseAge` for spouse); the total `rmdRequired` is their sum. The `AccountDialog`
  shows an Owner dropdown (Self / Spouse) for Traditional accounts when `spouseAge` is set.
- **Income events** — 10 types (including `employment_savings` for pre-retirement savings
  and `roth_conversion` for Traditional→Roth transfers), each with a required `name`
  (auto-generated defaults like "Pension Income 1"), COLA, before/after-tax, SS 2034 haircut
  (configurable). All cash flow flows through events/goals — no special-cased fields on UserData.
  **Roth Conversions:** A `roth_conversion` event models Traditional → Roth transfers. Unlike
  other income types, the amount does NOT contribute to cash available for spending —
  it is taxed as ordinary income, withdrawn pro-rata from Traditional accounts, and deposited
  pro-rata into Roth accounts. RMD is enforced first (IRS rule: RMD is not eligible for
  conversion); conversion is capped at the Traditional balance remaining after the forced
  RMD/spending withdrawal. Tax is paid implicitly by the withdrawal waterfall — with a
  Taxable account present, the added tax pulls from Taxable first; without one, tax pulls
  from Traditional and effectively reduces the convertible amount. `ensureRothConversionAccount`
  auto-creates a `"Roth Conversion"` Roth account when conversions exist but no Roth accounts
  do. Per-year conversion amount is captured in `AnnualCashFlowBreakdown.rothConversionGross`.
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

**Modeling parameters belong on the scenario, not in global settings.** Any knob that
affects simulation behavior — returns, volatility, distribution choice, withdrawal
ordering, RMD start age, tax assumptions, etc. — must live on `UserData` / `Scenario`
and flow through `runSimulation()` as data. Do not add app-level toggles, module-level
constants, or environment flags that change modeling. This keeps scenarios self-contained
and reproducible: experimenting in one scenario cannot silently alter another,
import/export round-trips stay honest, and scenario tests remain authoritative. When a
genuinely cross-scenario preference is needed (UI state, feature flags for the harness),
keep it outside `UserData` and ensure it has no effect on simulation output.

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

### Accounts/Income/Spending columns

`ManagerSection` uses `flex: 1 1 ${layout.managerMinWidth}` inside a `flex-wrap: wrap`
container. Three columns (Accounts, Income, Spending) stack automatically on phones
(no explicit media query needed).

### Yearly Data table

Intentionally **not** responsive — the expanded table only has horizontal scroll. If users
want to examine yearly data on a phone, they should rotate or use a larger device. The
accordion **header** (view selector + CSV button) does wrap on mobile via `flex-wrap`.

## Design Direction

The app should be **modular and extensible**. Avoid hardcoded assumptions.

### Simulation engine

`SimulationService` uses log-normal Monte Carlo (5000 runs default). All simulation
parameters are per-scenario in `UserData`:

- `account.portfolioBalance` — `'80_20' | '60_40' | '50_50'`; UI preset tracker per account
- `account.stockAllocation` — fraction in stocks (0.0–1.0) per account; derived from
  `portfolioBalance` via `PORTFOLIO_PRESETS`; drives per-account growth in the simulation loop.
  New accounts default to `'60_40'` / `0.6`. Synthetic accounts (RMD Reinvestment, Roth Conversion)
  also default to `'60_40'` / `0.6`.
- `portfolioAssumptions.stockReturn` / `stockStdDev` — stock log-normal return params
- `portfolioAssumptions.bondReturn` / `bondStdDev` — bond log-normal return params
- `portfolioAssumptions.stockBondCorrelationEnabled` / `stockBondCorrelation` — when
  enabled, stock and bond normals are drawn as a correlated bivariate pair via
  two-variable Cholesky decomposition (ρ clamped to `[-1, 1]`); when disabled, draws
  are independent
- `portfolioAssumptions.returnDistribution` — `'lognormal' | 'student_t'`; default
  `'lognormal'`. When `'student_t'`, the N(0,1) shock feeding the log-normal formula
  is replaced with a **standardized** Student's t draw — scaled by `√((df-2)/df)` so
  realized log-space variance still matches `stockStdDev` / `bondStdDev`. Fat tails
  come from excess kurtosis, not inflated variance. Inflation shocks remain log-normal
  regardless of this setting.
- `portfolioAssumptions.degreesOfFreedom` — integer 3–12; default `4`; ignored when
  `returnDistribution === 'lognormal'`. Lower values produce fatter tails.
- `portfolioAssumptions.returnModel` — `'parametric' | 'historical_single' | 'historical_rolling' | 'historical_bootstrap'`;
  defaults to `'parametric'` when absent. Selects which `ReturnGenerator` strategy
  drives the Monte Carlo loop (see `src/services/ReturnGenerator.ts`).
  - `parametric` — random draws from `returnDistribution` with the configured mean
    and std dev. Inflation also stochastic when `inflationStdDev > 0`.
  - `historical_single` — walks one fixed slice of `HISTORICAL_RETURNS` (1928–2024)
    from `historicalStartYear` for `lifeExpectancy - currentAge + 1` years. Single
    deterministic run; `numSimulations` is ignored.
  - `historical_rolling` — Trinity-style. One run per valid start year. Without
    `historicalWrapEnabled`, `numRuns = HISTORICAL_YEARS - horizon + 1`; with wrap,
    every start year is valid (`numRuns = HISTORICAL_YEARS = 97`).
  - `historical_bootstrap` — block bootstrap. Each run concatenates randomly-chosen
    consecutive blocks of length `historicalBlockSize` (1, 3, 5, or 10) until the
    horizon is filled. `numRuns = numSimulations`. Block size 1 reduces to iid year
    resampling. RNG is consumed at construction time so per-call draws are O(1).
  - All historical modes pair returns with the same row's CPI, so a 1970s
    stagflation slice keeps bad returns + high inflation correlated. Parametric
    inflation `inflationRate` / `inflationStdDev` are ignored in historical modes.
  - Black Swan overlay applies regardless of the base generator.
- `portfolioAssumptions.historicalStartYear` — integer in 1928–2024; required when
  `returnModel === 'historical_single'`.
- `portfolioAssumptions.historicalWrapEnabled` — when true, single/rolling modes
  wrap the historical index modulo `HISTORICAL_YEARS` instead of clamping to the
  last row at series end.
- `portfolioAssumptions.historicalBlockSize` — `1 | 3 | 5 | 10`; required when
  `returnModel === 'historical_bootstrap'`.
- `portfolioAssumptions.blackSwanEvents` — optional `BlackSwanEvent[]`; each entry
  replaces the drawn stock/bond factors for a specific calendar year with fixed historical
  multipliers, applied identically across every Monte Carlo run. `BlackSwanEvent.groupId`
  is a **UI-only field** (ties multi-year templates together for grouped deletion in the
  editor) — never read it in simulation, ReturnGenerator, chart plugins, CSV export, or
  tests. Scenario JSON files may omit it; the field is optional and simulation-transparent.
- `simulationSettings.numSimulations` — run count (1000 / 5000 / 10000)
- `inflationRate` — annual inflation, affects cash flow inflation-adjustment
- `inflationStdDev` — inflation volatility; affects portfolio deflation (real vs nominal)
  in the MC loop only; cash flows always use the deterministic mean `inflationRate`

**Monte Carlo path construction:** each year draws a stock and bond return factor;
each account's balance is multiplied by its own `account.stockAllocation × stockFactor + (1 - account.stockAllocation) × bondFactor`. When
`stockBondCorrelationEnabled` is true, the two underlying shocks are generated as a
bivariate pair using Cholesky (stock = `z1`, bond = `ρ·z1 + √(1-ρ²)·z2`); otherwise they
are drawn independently. Each shock is an N(0,1) draw when `returnDistribution ===
'lognormal'` or a standardized Student's t draw (unit variance, `df` degrees of
freedom) when `returnDistribution === 'student_t'` — the same Cholesky construction
applies either way. Annual rebalancing to target allocation is assumed. The median
and downside paths are the single simulation runs whose final balance is closest to the
50th/10th percentile of all final balances — coherent per-year paths with actual return
factors, not year-by-year envelopes.

**Per-path breakdowns:** `runSimulation()` returns `medianBreakdowns` and `downsideBreakdowns`
(`AnnualCashFlowBreakdown[]`) alongside the path arrays. These are computed during the
simulation loop (not post-hoc) and capture the effective per-year cash flow for each
representative run — including portfolio depletion effects (when balance hits $0,
`portfolioWithdrawal` is capped at the available balance and a spending shortfall is shown).
The deterministic (Nominal) path uses `nominalBreakdowns` returned by `runSimulation()`
alongside the nominal path array. The yearly data detail rows show the breakdown for
whichever view is selected.

**Performance architecture:** `runSimulation()` precomputes balance-independent inputs
once before the Monte Carlo loop — `lognormalParams` for stock/bond/inflation, and
per-year arrays (`stateTaxRateByYear`, `ageByYear`, `incomeByYear`, `spendingByYear`).
The inner hot loop calls `calculateAnnualCashFlowCore` (internal fast-path) with these
arrays instead of recomputing them 5000× per year. The public `calculateAnnualCashFlow`
signature is unchanged — it is a thin wrapper that recomputes inputs inline; use it in
tests and any call-site that doesn't have precomputed values. The simulation trigger in
`Content.tsx` is debounced 250ms so rapid field edits don't fire redundant Monte Carlo
runs. Chart.js props (`chartData`, `options`, `htmlAnnotations`) are wrapped in `useMemo`
with precise deps; `Projections` is wrapped in `React.memo`.

Future direction:

- Historical sequence-of-returns ✓ implemented — see `returnModel` above. 1928–2024
  S&P 500 / 10-yr Treasury / CPI series in `src/data/historicalReturns.ts`. Future:
  stationary bootstrap (geometric block lengths), era filters
  (`historicalSampleStart` / `historicalSampleEnd`), regime-weighted resampling.
- Fat-tail distributions: Student's t ✓ implemented (standardized, unit variance, df
  configurable per scenario). Future: skewed-t, no-tail / bounded distributions.
- New strategies drop in without changing the rest of the app (`modelType` placeholder
  reserved in `SimulationSettings`)
- **Full stochastic inflation**: `inflationStdDev` currently only affects portfolio deflation
  (real vs nominal balance). Future: propagate per-run cumulative inflation to cash flow
  adjustments (income/spending), which requires rethinking whether users enter amounts in
  today's dollars vs nominal future dollars throughout the UI.
- **Median/downside path construction**: currently uses the single run whose final balance
  is closest to the 50th/10th percentile. An alternative is year-by-year percentile envelopes
  (smoother chart lines, but synthetic paths with no coherent per-year actuals). The
  representative-run approach was chosen to enable exact stock/bond attribution in detail rows.

### Chart plugins

All Chart.js plugins live in `src/plugins/` as `chartXxx.ts` files and are registered once via
`ChartJS.register()` at the top of `src/components/Chart/Chart.tsx`. **Never** pass a plugin as an
inline `<Line plugins={[...]}>` prop — that creates a new plugin object on every render and breaks
Chart.js's internal deduplication.

Each plugin file follows this structure:

1. **Type augmentation** — extend `PluginOptionsByType` via `declare module 'chart.js'` so every
   call-site gets type-safe options:
   ```ts
   declare module 'chart.js' {
     interface PluginOptionsByType<TType extends ChartType> {
       myPlugin?: MyPluginOptions;
     }
   }
   ```

2. **Options interface** — document each field, including how the consuming component should drive it.

3. **Plugin object** — read configuration exclusively from `chart.options.plugins?.myPlugin` inside
   lifecycle hooks (never from module-level variables or React refs).

To drive a plugin from React state, include the state variable in the `options` useMemo deps and add
it to the `plugins` block:
```ts
const options = useMemo(() => ({
  plugins: {
    myPlugin: { activeIndex: someState },
  },
}), [..., someState]);
```
react-chartjs-2 detects the options change and calls `chart.update()` automatically.

Plugins that need a DOM overlay (e.g. `htmlAnnotations`) use `beforeInit`/`beforeDestroy` to
attach/detach a container `<div>` next to the canvas.

Current plugins:
- `chartHtmlAnnotations` — renders income/spending event badges as HTML elements over the chart
- `chartBlackSwanShading` — draws vertical shaded bands for portfolio stress events
- `chartCrosshair` — draws a dashed vertical line at the hovered year index

### Top bar: Settings menu

`AppHeader` renders a single **Settings** dropdown (PrimeReact `Menu` popup) with one item:

- **Modeling** → `ModelingDialog` — Return Model selector at the top
  (Parametric / Historical: Single Sequence / Historical: Rolling Start / Historical:
  Block Bootstrap) with mode-specific fields (start year, wrap-around, block size);
  stock/bond expected return % and std dev % (grouped), distribution (lognormal /
  student-t), asset correlation, inflation rate % and std dev %, simulation run count;
  read-only blended return (portfolio-weighted average across accounts). Parametric-only
  inputs (returns, distribution, correlation, inflation rate/stddev) are disabled when a
  historical mode is active

Stock/bond allocation per account is configured in `AccountDialog` (80/20, 60/40, or 50/50
preset buttons). The allocation badge is displayed on each account row in `AccountsManager`.

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

- Portfolio: user-defined asset classes beyond stocks/bonds/cash; per-account
  allocation (bonds-in-Traditional, stocks-in-Roth placement); cost-basis tracking
  for taxable accounts with long-term capital gains brackets
- Tax: bracket updates as legislation changes; user-configurable withdrawal ordering
  (currently hardcoded Taxable → Traditional → Roth). Roth conversions ✓ implemented —
  see Income events section above; future: fill-to-bracket and percentage-of-balance
  amount modes, explicit tax-withholding source selection
- RMD modeling: ✓ implemented — see Accounts section above. Per-owner RMD ✓ implemented
  (`owner?: 'self' | 'spouse'` on Account). Future: user-configurable RMD start age
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

Two assertion types are supported:

- **`pathValues`** — checks `result.median[index]` (portfolio balance at that year):
  ```json
  { "index": 3, "age": 63, "value": 250000, "tolerance": 1, "note": "..." }
  ```
- **`breakdownChecks`** — checks any field of `result.medianBreakdowns[index]`:
  ```json
  { "index": 0, "field": "withdrawalFromRoth", "value": 50000, "tolerance": 5, "_note": "..." }
  ```
  Use `value` for exact checks (with optional `tolerance`), or `min`/`max` for range
  checks. Valid fields: all keys of `AnnualCashFlowBreakdown` — `portfolioWithdrawal`,
  `withdrawalFromTaxable`, `withdrawalFromTraditional`, `withdrawalFromRoth`, `totalTax`,
  `netCashFlow`, `ssGross`, `otherTaxableGross`, `afterTaxIncome`, `ssTaxableAmount`,
  `totalGrossIncome`, `baseSpendingNet`, `otherSpendingGoalsNet`, `totalSpendingNet`,
  `rmdRequired`, `rmdExcess`, `rothConversionGross`, `ordinaryTax`, `capitalGainsTax`.

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
