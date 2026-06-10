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
- `src/services/SimulationService.ts` — Monte Carlo engine (1000 runs default, log-normal)
- `src/services/TaxCalculator.ts` — federal + state tax, memoized, 2024-2026 brackets
- `src/dialogs/` — type-specific edit dialogs (e.g., `SocialSecurityDialog`),
  shared `IncomeEventDialog` for other types, type-selection pickers, import/export
- `src/types/` — Scenario, UserData, Account, IncomeEvent, SpendingGoal
- `src/utils/defaultName.ts` — `eventTypeLabels`, `goalTypeLabels`, default name generators

## Key Concepts

- **Scenario** — top-level unit holding all user config, persisted to IndexedDB.
  Carries an optional `lastSuccessProbability?: number` field that is the **last
  computed Monte Carlo success probability**, used **only** to display a stable `%`
  on inactive scenario rows in the sidebar without re-running 1000-sim MC for each.
  This is a sidebar display cache — never read it from simulation, chart, CSV
  export, scenario JSON export logic, or tests. Authoritative probability always
  comes from the live `runSimulation()` result for the active scenario.
- **Monte Carlo** — median + 10th percentile portfolio paths, success probability
- **Accounts** — 4 tax-profile types: `traditional` (withdrawals taxed as ordinary income),
  `roth` (withdrawals tax-free), `brokerage` (withdrawals taxed at flat LTCG rate),
  `cash` (money-market / HYSA — principal pulls tax-free, deterministic yield via
  `portfolioAssumptions.cashYieldRate` default 4%, credited annually on accrual
  basis as `cashInterest`, folded into `otherTaxableGross` for tax purposes AND
  added to the NIIT investment-income proxy per IRC §1411). Cash accounts
  **bypass the stock/bond growth multiplier and the black-swan overlay** —
  non-volatile by construction across all return models. The yield runs
  deterministically even in historical / bootstrap modes. UI: AccountDialog
  hides the 80/20-60/40-50/50 allocation selector for cash and shows the yield
  read-only (editable in Modeling); ModelingDialog reveals a Cash Yield section
  only when ≥1 cash account exists; AccountsManager row shows a "$X.XX% yield"
  badge instead of the allocation badge.
  Replaces the old single `currentSavings` field. All accounts share the scenario's
  stock/bond allocation. Withdrawals follow a fixed waterfall: when no RMD applies,
  **Cash** → Brokerage → Traditional → Roth. When an RMD applies (age ≥ 73), the forced RMD is
  applied to spending+tax need first (RMD-first ordering); only the residual need
  above the RMD pulls from Brokerage, then Traditional-above-RMD, then Roth. This
  prevents over-pulling from Brokerage (and generating phantom federal/state LTCG and
  NIIT) when the RMD's net-of-tax proceeds already cover the year's need.
  Employment-savings income events target a specific account via `accountId`.
  **RMD:** Traditional accounts trigger Required Minimum Distributions at a SECURE 2.0
  birth-year-dependent start age (born ≤1950 → 72, 1951–1959 → 73, 1960+ → 75; IRS Uniform
  Lifetime Table). The start age is derived per owner from `referenceYear − currentAge`
  (and `− spouseAge`) via `getRmdStartAge` and threaded through `calculateRMD(bal, age,
  rmdStartAge)`; the precompute carries `rmdStartAgeByYear` / `spouseRmdStartAgeByYear`
  (survivor-aware — the self slot uses the survivor's start age post-first-death). The
  pre-2020 70½ rule is not modeled. The simulation forces `withdrawalFromTraditional ≥
  rmdRequired` each year. Excess RMD beyond the spending need is reinvested into the first brokerage account;
  if none exists, `ensureReinvestmentAccount` auto-creates a `"Reinvestment"` brokerage
  account in the working simulation copy (not persisted to UserData). The same synthetic
  account also receives general surplus (see Surplus handling below) — never two synthetics.
  Roth accounts are exempt.
  **Surplus handling:** any year with `netCashFlow > 0` deposits the surplus into the
  first brokerage account (handled inline in `applyCashFlow`). There is no fallback chain to
  Traditional/Roth — `ensureReinvestmentAccount` (called once in `runSimulation`)
  guarantees a brokerage account exists whenever none is configured, so surplus is never
  silently discarded. `AnnualCashFlowBreakdown.surplusContribution` records the
  per-year deposit for detail rows / CSV.
  **Cash bucket policy** (Phase 2): when `UserData.cashBucketPolicy` is configured,
  a post-convergence step (`applyPostConvergenceBucketPolicy` in
  [src/services/SimulationService.ts](src/services/SimulationService.ts)) runs after
  `applyCashFlow` settles all flows for the year. The policy declares a band
  `{ minAmount, targetAmount, maxAmount, refillTrigger }` as **fixed dollar
  amounts** (they do not inflate). Behavior: (a) the spending waterfall
  pulls Cash only down to `minAmount`, then falls through to Brokerage
  (the conversion-tax sourcing chain respects the same floor); (b) when cash
  exceeds `maxAmount`, the excess sweeps to Brokerage as a tax-free
  balance transfer; (c) when cash is below `minAmount` AND the
  trigger fires, this year's surplus reroutes from Brokerage to Cash up to
  `targetAmount`, capped by the surplus available. Refill is
  **surplus-only** (`netCashFlow > 0`) — the engine never sells Brokerage
  mid-loop to refill cash. That rule prevents phantom-tax archetype #3
  (the refill-LTCG leak). Triggers: `'always'`, `'gains_only'` (stockFactor > 1),
  `'above_baseline'` (portfolio post-growth / deterministic-baseline > 1),
  `'none'` (manual mode — also disables the spending-waterfall floor). The
  baseline for `'above_baseline'` is computed by a one-shot deterministic
  projection in `buildPrecomputes` (with `skipBaselineForDeterministic: true`
  to break recursion). **Structural invariant:**
  `applyPostConvergenceBucketPolicy` receives only a minimal subset of the
  settled breakdown and never imports tax modules, so it is type-prevented
  from mutating any tax field — see the function-level doc comment for the
  full enforcement note.
  `AnnualCashFlowBreakdown.cashRefillFromSurplus` and `cashSweepToBrokerage`
  surface the per-year amounts moved. `ensureCashAccount` mirrors
  `ensureReinvestmentAccount`: when the policy is configured but no cash
  account exists, the engine injects a synthetic `"Cash Bucket"` cash account
  at $0 to serve as a routing target.
  RMD amounts are taxed as ordinary income like all Traditional withdrawals.
  RMD is calculated on the beginning-of-year (pre-growth) Traditional balance,
  matching the IRS Dec 31 prior-year rule. The simulation captures this balance
  before applying growth in each loop iteration.
  **Per-owner RMD:** `Account` has an optional `owner?: 'self' | 'spouse'` field (defaults to
  `'self'`). The simulation splits Traditional balances by owner and calls `calculateRMD`
  separately for each group using the correct age (`userData.currentAge` for self,
  `userData.spouseAge` for spouse); the total `rmdRequired` is their sum. The `AccountDialog`
  shows an Owner dropdown (Self / Spouse) for Traditional accounts when `spouseAge` is set.
  **RMD distribution is per-owner too** (IRS rule: each owner's RMD must come from their own
  accounts). `applyCashFlow` in [src/services/SimulationService.ts](src/services/SimulationService.ts)
  splits the Traditional withdrawal into three passes: (1) `rmdSelf` pulls pro-rata from
  Self-owned Trad only; (2) `rmdSpouse` pulls pro-rata from Spouse-owned Trad only;
  (3) the non-RMD remainder (discretionary spending pull + Roth conversion gross) pulls
  pro-rata across all Trad accounts (no household-level IRS constraint on those).
  Per-account RMD shares are surfaced in `audit.rmdByAccount` (sum equals `rmdRequired`
  within $1) — consumed by the Cash Flow Sankey's column-0 detail. `accountFlows[].withdrawal`
  for a Traditional account remains the **total** outflow across all sub-purposes.
- **Income events** — 11 types. `wage_income` (W-2 salary, taxable ordinary income),
  `retirement_contribution` (pre-tax / Roth / after-tax deposit instruction — never adds
  to spendable cash; `pre_tax` reduces `otherTaxableGross` before tax calc, floored at zero;
  routed to a target account by `contributionType` and optional `accountId`; supports
  optional employer match via `employerMatchPercent` + `employerMatchCeilingPercent` and
  optional `wageEventId` to compute the match base off a linked salary event), and
  `roth_conversion` for Traditional→Roth transfers. Each has a required `name`
  (auto-generated defaults like "Pension Income 1"), COLA, before/after-tax, SS 2034 haircut
  (configurable). All cash flow flows through events/goals — no special-cased fields on UserData.
  IRS contribution caps are enforced per `(owner, kind)` group, where account "kind" is
  `Account.accountKind` (`'401k' | 'ira' | 'brokerage'`; defaults: traditional/roth → IRA,
  brokerage → brokerage). Within a group, pre_tax + roth contributions pool against the
  same cap (`elective401k` for 401(k)-kind, `iraLimit` for IRA-kind, plus catch-up at
  `catchUpAge`). Caps live on `UserData.contributionLimits` (see `getContributionLimits`
  for defaults) and optionally inflate yearly. Excess deposits are scaled down
  proportionally; the cut is captured in `AnnualCashFlowBreakdown.contributionsCappedAmount`.
  Capped pre-tax dollars stay in `otherTaxableGross` (they were never deducted); employer
  match is scaled with the employee contribution but does NOT count against the elective
  deferral cap. Per-event contribution amounts are surfaced in `AnnualCashFlowBreakdown`
  as `wageIncomeGross`, `preTaxContributions`, `rothContributions`, `afterTaxContributions`,
  and `employerMatch`.
  **Roth Conversions:** A `roth_conversion` event models Traditional → Roth transfers. Unlike
  other income types, the amount does NOT contribute to cash available for spending —
  it is taxed as ordinary income. **Sourcing is per-owner** (IRS rule: a conversion moves
  one owner's Trad to that same owner's Roth — Spouse's Trad cannot fund Self's conversion,
  and Spouse's Roth cannot receive it). The engine routes each conversion event by
  `event.owner` (defaults to `'self'`): Self events pull pro-rata from Self-owned Trad
  accounts only and deposit into Self-owned Roth accounts only; same for Spouse. The
  per-owner cap binds independently — Self's requested can be capped at Self-Trad
  available even when Spouse-Trad has plenty. `audit.rmdByAccount`-style per-owner detail
  is surfaced via the breakdown fields `rothConversionGrossSelf` / `rothConversionGrossSpouse`
  (sum = `rothConversionGross`) and `rothConversionTaxWithheldSelf` / `Spouse` (sum =
  `rothConversionTaxWithheld` — withholding splits proportionally to each owner's gross
  because each owner's 1099-R is independent). RMD is enforced first (IRS rule: RMD is
  not eligible for conversion); conversion is capped at the per-owner Traditional
  balance remaining after the forced per-owner RMD. **Conversion ordinary tax sourcing is hybrid**, in priority
  order (see "Intents and funding sources" below): (1) Cash balance not consumed by
  spending — preferred because principal is tax-free and avoids the LTCG/NIIT
  amplification phantom on Brokerage pulls; (2) RMD-excess cash, (3) Brokerage balance
  not consumed by spending, (4) withheld from the conversion itself (IRS Form
  1099-R Box 4 mechanic). It is **never** pulled from Traditional-above-RMD or Roth —
  that would defeat the conversion's arbitrage. When Cash + Brokerage + RMD-excess can't
  cover the marginal ordinary tax, the conversion still executes at the user's requested
  gross, but the Roth deposit shrinks by the withheld portion (mathematically suboptimal
  vs. paying from Brokerage, but matches real-world Vanguard/Fidelity withholding behavior
  and keeps the UX honest). `AnnualCashFlowBreakdown` surfaces this via
  `rothConversionGross` (Trad pull / IRS conversion amount),
  `rothConversionTaxFromCash`, `rothConversionTaxFromBrokerage`,
  `rothConversionTaxFromRmdExcess`, and `rothConversionTaxWithheld`. The per-owner Roth
  deposit (in `applyCashFlow`) is `rothConversionGross{Self,Spouse} −
  rothConversionTaxWithheld{Self,Spouse}`, routed to that owner's Roth accounts only.
  The dialog warns when withholding activates in any year of the deterministic
  projection (via `conversionWillBeWithheldYears`/`Dollars` from `estimateConversionImpact`).
  `ensureRothConversionAccount` auto-creates a per-owner `"Roth Conversion"` Roth account
  (`"Roth Conversion (Spouse)"` for spouse) when conversions exist for an owner but no
  Roth account for that owner exists. The marginal-stack attribution in
  `computeMarginalStackAttribution` scales conversion events by per-owner ratio so per-event
  displayed gross matches the per-owner cap when one owner is capped and the other isn't. Per-year conversion amount is captured in `AnnualCashFlowBreakdown.rothConversionGross`.
  The dialog's Impact Preview surfaces `estimateConversionImpact()` results
  (`firstYearTax`, `totalTaxOverConversion`, `rmdReductionAt73`,
  `projectedRothAtEndOfPlan`, and `netPlanValueImpact`). The first four are
  fast closed-form estimates against the user's baseline ordinary income
  (including SS taxability across the 50%/85% provisional thresholds).
  `netPlanValueImpact` is computed differently: it calls
  `runDeterministicProjection()` twice — once with the conversion event
  included and once with it stripped — and diffs the end-of-plan portfolio
  balance. That's the same single-path engine that drives the "Deterministic"
  chart line, so the figure reflects the RMD-first withdrawal waterfall,
  conversion-tax sourcing, IRMAA (2-year lookback), NIIT (3.8%), and state
  tax on LTCG. It ALSO reflects the survivor "widow's penalty" when the
  scenario sets `spouseLifeExpectancy` (MFJ→single at first death — see
  "Survivor / widow's penalty" below). Still excluded everywhere: ACA premium
  tax credit cliffs).
  New conversion events default to `colaType: 'inflation_adjusted'` so the
  entered amount is a real-dollar target across the conversion window. Inline
  warning hints fire when the configured amount is large relative to spending,
  jumps ≥ 2 federal brackets, or would convert > 80% of Traditional balance —
  see `exceedsSpendingHeuristic`, `crossesMultipleBracketsHeuristic`,
  `exceedsMostOfTradHeuristic` in `conversionImpact.ts`.
- **Spending goals** — 11 categories, each with a required `name` (auto-generated defaults
  like "Vacation 1"), inflation adjustment, age-based activation.
  `living_expenses` goals support optional `yearlyDecreasePercent` for spending decay
- **Tax** — aggregate income taxation; SS 50%/85% taxable fraction (IRS provisional
  income formula); standard deduction, filing status, state rates with optional
  relocation timeline, senior/OBBB deductions. For years > 2026, federal bracket
  thresholds and the standard deduction are inflated by `(1 + inflationRate)^(year − 2026)`
  to match IRS Chained CPI-U indexing (using headline CPI as a proxy). SS provisional
  income thresholds remain frozen by law.
  Capital gains tax = federal `longTermCapGainsRate × fromBrokerage` (flat, default)
  + state cap-gains computed by the per-state profile (`computeStateTax` in
  `src/services/StateTaxCalculator.ts`, profiles in `src/data/stateTaxProfiles.ts`).
  **Optional federal 0/15/20% bracket stacking** is opt-in per scenario via
  `UserData.useStackedLtcgBrackets` (default off → flat rate, bit-identical to
  before): when on, the engine taxes `fromBrokerage` via `computeFederalLTCGTax`
  (TaxCalculator), stacking the gain on top of the after-deduction ordinary
  taxable income (`getFederalTaxableIncome`) against inflation-indexed
  0%/15% breakpoints (`getLtcgBreakpoints`). The flat `longTermCapGainsRate` is
  ignored in that mode; state LTCG is unaffected (always per-state profile).
  Cost-basis tracking is still absent in both modes (entire brokerage withdrawal
  treated as gain). `AnnualCashFlowBreakdown` exposes `federalCapGainsTax`
  and `stateCapGainsTax` separately.
  **State tax (per-state profile):** `STATE_TAX_PROFILES` registry keys each state
  to a profile with brackets (single + MFJ), state standard deduction, SS rule
  (`exempt` / `taxed` / `exempt_if_age` / `agi_phaseout`), retirement-income
  exclusion (`none` / `full` / `amount` / `agi_phaseout`), LTCG rule (`ordinary`
  / `exempt` for MO / `threshold` for WA), optional locality surcharge (NYC), and
  inflation-indexing flag (NY/NJ brackets are statutorily frozen). Time-bounded
  profiles chain via `effectiveYears` + `successorProfileKey` (SC top-rate sunset
  after 2026, WV SS phase-out from 2027). Audit fields under `audit.state*`
  capture the per-year decomposition (ordinary base, std deduction, retirement
  exclusion applied, SS included, bracket index, marginal rate, locality, LTCG
  threshold, LTCG state-taxable portion, profile key, notes).
  Override: `UserData.disableStateRetirementExclusion = true` disables the
  profile's retirement-income exclusion for power users whose Traditional
  withdrawals don't qualify (e.g., NY's $20k applies only to public pensions
  and IRAs). The Scenario dialog exposes this as an "advanced" checkbox.
  Special profile-table mechanics worth knowing: `STATE_TAX_PROFILES['New York City']`
  is a composed pseudo-state (`{ ...STATE_TAX_PROFILES['New York'], localitySurcharge }`)
  so NY bracket updates automatically propagate to NYC. Successor profiles for
  dated transitions are chained via `effectiveYears.end` + `successorProfileKey`
  (SC 6%→5.2% after 2026, WV SS-taxed→exempt after 2026); `getStateTaxProfile`
  follows the chain and returns the resolved key for audit display.
  **IRMAA:** Medicare Part B + Part D premium surcharges from `IRMAA.ts` based on
  the 2024 tier table (inflation-indexed forward by `inflationRate`). Driven by
  the 2-year-prior MAGI proxy (`otherTaxableGross + withdrawalFromTraditional +
  ssTaxableAmount + withdrawalFromBrokerage`), applied per Medicare enrollee
  (self ≥ 65 and/or spouse ≥ 65). Captured in `AnnualCashFlowBreakdown.irmaaSurcharge`.
  Gated by `UserData.enableIRMAA` (default `true`). For the first two retirement
  years (before the in-sim history covers the 2-year lookback),
  `UserData.priorWorkingMagi` provides the lookback value; defaults to 0.
  **NIIT:** 3.8% × min(investment income, MAGI − threshold) per `IRMAA.ts`.
  Statutory thresholds (not inflation-indexed): single/HoH $200k, MFJ $250k,
  MFS $125k. Investment-income proxy is `withdrawalFromBrokerage` (same as federal
  LTCG). Captured in `AnnualCashFlowBreakdown.niitTax`. Gated by
  `UserData.enableNIIT` (default `true`).
- **State timeline** — ordered list of `{ state, startYear? }` on `UserData`. First entry
  is current state (no startYear); subsequent entries are future relocations. Simulation
  resolves effective state per year via `getEffectiveStateName(userData, year)` and the
  per-state profile via `getStateTaxProfile(stateName, year)`. The selectable state list
  is sourced from `SELECTABLE_STATES` (includes `"New York City"` as a pseudo-state with
  NYC local tax). Per-year precomputes hold both `stateNameByYear` and `stateProfileByYear`.
- **Survivor / widow's penalty** — opt-in via `UserData.spouseLifeExpectancy` (spouse's
  death age). Active only when `filingStatus === 'mfj'` && `spouseAge !== null` &&
  `spouseLifeExpectancy != null`. The single source of truth is `getDeathModel(userData)`
  in [src/services/SimulationService.ts](src/services/SimulationService.ts), which returns
  `{ active, selfDeathOffset, spouseDeathOffset, firstDeathOffset, survivor, horizonYears }`.
  `projectionHorizonYears(userData)` wraps it and is the **single horizon source** — the
  projection now runs to `max(self, spouse) death + 1` (extends past self's death when the
  spouse outlives self). At the **first** death:
  - **Filing flips MFJ → single** the year AFTER the death (MFJ holds through the year of
    death — the IRS rule and the cheapest conversion window). Per-year filing lives in
    `Precomputes.filingStatusByYear`; the hot loop passes it as the `filingStatus` param to
    `calculateAnnualCashFlowCore` (which no longer reads `userData.filingStatus` — that field
    is the default for single-year callers only). `computeBracketHeadroomForTrad` takes the
    same per-year status.
  - **Ages collapse to the survivor.** `Precomputes.ageByYear` becomes the survivor's age and
    `spouseAgeByYear` becomes `null` post-death, so RMD divisor, Medicare-65 IRMAA enrollee
    count, and the senior bonus all reflect a single survivor. (The chart x-axis labels age
    independently as `currentAge + index`, so this collapse doesn't change the displayed age
    frame — see "Chart x-axis" below.)
  - **Social Security: survivor keeps the LARGER of the two benefits** (max, not sum).
    Handled in `accumulateIncome` via a `survivorMode` flag (`Precomputes.survivorModeByYear`).
  - **Traditional consolidates** to the survivor: combined RMD at the survivor's age, and
    RMD/conversion pulls + the Roth conversion deposit ignore the per-owner `owner` filter
    (the `consolidated` flag threaded into `calculateAnnualCashFlowCore` and `applyCashFlow`;
    the caller passes `beginningTradBalances = { self: combined, spouse: 0 }`).
  - **Non-SS income owned by the deceased** (pension/wage with no `endAge`) terminates at the
    owner's death (`eventActiveInYear`); SS is exempt from that cut (handled by the max rule).
  **Backward-compatible:** when inactive, `firstDeathOffset = Infinity`, `horizonYears` =
  self horizon, and every per-year array equals the pre-feature value bit-for-bit (the full
  test suite confirms existing scenarios are unchanged). **Documented simplifications:** no
  2-year qualifying-surviving-spouse grace; survivor household spending is not reduced; the
  closed-form `estimateConversionImpact` preview ignores the penalty (the twice-run
  `netPlanValueImpact` and the optimizer use the real engine and DO reflect it).

## Intents and funding sources

A recurring class of bug in the simulation engine: **phantom tax** — sourcing the tax on
a tax-generating event from an account whose withdrawal amplifies the same tax bill, so
the fixed-point loop converges to an over-taxed answer. Two archetypes have hit so far:

1. **RMD double-pull** (fixed): The naive waterfall ignored that RMD already pulls and
   taxes Trad cash, then over-pulled Brokerage to cover spending — generating phantom
   LTCG/NIIT on cash the RMD already provided. Fix: RMD-first ordering in
   `computeSpendingWaterfall` (Trad-up-to-RMD → Brokerage → Trad-above-RMD → Roth).
2. **Roth conversion tax leak** (fixed): The waterfall lumped conversion ordinary tax
   into the spending pull, which when Brokerage ran out fell back to Trad-above-RMD or
   Roth — paying conversion tax from the same Traditional being converted (or from
   the Roth just funded). Fix: source conversion ordinary tax exclusively from Brokerage
   + RMD-excess; cap the conversion when neither can fund the marginal tax.

**The principle:** when a new feature generates tax, declare its funding source
explicitly. Do not rely on the spending waterfall to absorb it. The waterfall covers
spending + spending-related tax only.

**Canonical intent → funding-source table:**

| Intent              | Gross driver                                | Funding source for its tax                          |
|---------------------|---------------------------------------------|-----------------------------------------------------|
| RMD                 | IRS Uniform Lifetime Table                  | Self-funding (RMD net is cash)                      |
| Spending withdrawal | `totalSpendingNet`                          | **Cash** → RMD-first → Brokerage → Trad → Roth        |
| Roth conversion     | User-entered (or future: fill-to-bracket)   | **Cash** → RMD-excess → Brokerage → withhold from conversion (IRS 1099-R Box 4) |
| Surplus deposit     | `netCashFlow > 0`                           | Deposit to first Brokerage in `applyCashFlow`; under `cashBucketPolicy` a post-convergence step (Phase 2) reroutes from Brokerage to Cash up to `targetAmount` when the policy's trigger fires. |
| Cash bucket refill  | `netCashFlow > 0` (this year's surplus only)| Move from first Brokerage → first Cash, capped by `targetAmount − cashBal` AND by available surplus. Tax-free balance transfer. **Never sells Brokerage to refill** — surplus-only sourcing prevents phantom-tax archetype #3 (the refill-LTCG leak). |
| Cash bucket sweep   | `cashBal > maxAmount`                       | Move from first Cash → first Brokerage. Tax-free balance transfer (no withdrawal path, no LTCG). |

Cash is **a modeled account type** (Phase 1). The Cash steps in the precedence
above are real — `computeSpendingWaterfall` and the conversion-tax-sourcing block
both consult `cashBal` first. When no cash account exists, the Cash steps are
no-ops by construction (`cashBal = 0`) and the chain falls through to the next
priority.

**Implementation:** see `calculateAnnualCashFlowCore` in
[src/services/SimulationService.ts](src/services/SimulationService.ts):
- `computeSpendingWaterfall(w)` is spending-only (no conversion). It returns
  `spendingFromCash`, `spendingFromBrokerage`, `forcedTrad`, `spendingFromRoth`, `rmdExc`.
- Inside the fixed-point loop, after the spending pull, conversion principal is sized
  by `tradAvailForConv = tradBal − forcedTrad` (RMD must be satisfied first — IRS
  rule).
- The conversion's marginal ordinary tax `mt` is split across three sources in
  priority order: `ctCash = min(mt, cashBal − spendingFromCash)`,
  `ctRmd = min(mt − ctCash, rmdExc)`,
  `ctBrokerage = min(mt − ctCash − ctRmd, brokerageBal − spendingFromBrokerage)`, then
  `ctWithheld = mt − ctCash − ctRmd − ctBrokerage`. The first three are paid from external account
  flows; the third is withheld from the conversion's own Trad pull.
- `rothConversionGross` is the IRS-conventional conversion amount (Trad pull, added to
  `withdrawalFromTraditional`). `applyCashFlow` deposits
  `rothConversionGross − rothConversionTaxWithheld` to Roth.
- The breakdown surfaces all three sourcing fields plus `rothConversionRequested`
  (user intent before any Trad-balance cap).
- The conv-tax-funded Brokerage pull does add incremental LTCG/NIIT to `totalTax`; that
  cascade falls through the normal fixed-point loop and is funded by the spending
  withdrawal (a small acceptable residual — 15–20% of the saved phantom-tax leak).

**Liquid-cash mental model (future refactor target, not committed):** forced inflows
(income, SS, RMD net) fill a bucket; discretionary withdrawals fill only the gap. The
RMD-first branch in `computeSpendingWaterfall` is this idea wedged into one function.
Future refactors should move toward it generically, which would naturally subsume
both the RMD-first and conv-tax-sourcing fixes.

## Decision-making layers

Cash-flow decisions in the engine stack in three layers, inside-out. Each layer
is built on the one below; new features attach at the highest applicable layer.

1. **Intent + funding sources** (section above) — single-year sourcing rules:
   *"where does the tax for THIS taxable event come from?"* RMD, spending
   withdrawal, conversion tax all answered here. The phantom-tax principle
   lives at this layer.
2. **Spending source policy** (section below) — *"which spending waterfall
   does the engine use for THIS scenario?"* Auto-selected once at sim start
   via `selectBestSpendingOrder` — runs two deterministic projections (one
   per candidate policy) and picks the higher real terminal balance. No
   user input, no implicit gating.
3. **Tax-strategy plug-in** (future, not implemented) — *"given the scenario,
   choose layer-2 policies + conversion sizing + ACA/IRMAA constraints."*
   See "Layer 3 (future): tax-strategy plug-in framework" below for the
   roadmap, design sketch, and the structural fix it provides for the
   smart-default's bundled-comparison property.

## Spending source policy

The spending waterfall (RMD → Brokerage → Trad-above-RMD → Roth) is correct on a
single-year basis but **greedy across years**. In pre-pension/pre-SS years,
spending-from-Brokerage burns the most flexible bucket at low effective rates
(LTCG drag), leaving none for later high-`mt` conversion years. A
planner-aware retiree would pull spending from Trad in low-bracket years
(filling the 12% federal bracket cheaply) and preserve Brokerage for the
high-`mt` years.

But `bracket_aware` is not always better. For pre-SS retirees with low
spending and a balanced Trad/Brokerage split, LTCG sits in the 0% federal
bracket (free) — and pulling Trad needlessly triggers 10–12% federal tax.
For high-spending or heavy-Trad scenarios, bracket_aware wins because
spending pushes LTCG into 15% bracket and 12% Trad headroom is cheaper.

**The engine auto-selects per scenario.** `selectBestSpendingOrder` in
[src/services/SimulationService.ts](src/services/SimulationService.ts) runs
two quick deterministic projections (one with each candidate policy pinned)
and picks the higher real terminal balance. ~10–20 ms total at sim setup,
cached in `Precomputes.spendingOrder` so the MC inner loop never re-selects.
Tiebreaker on near-equal scores (within a $1 absolute / 1e-6 relative
tolerance): `brokerage_first` (conservative — preserves Traditional and
avoids the few-hundred-dollar bracket-aware-cascade nudge on zero-spending
scenarios).

The two candidate policies:

- **`brokerage_first`** — RMD → Brokerage → Trad-above-RMD → Roth. The naive
  spending order. Conservative; preserves Traditional.
- **`bracket_aware`** — RMD → Trad up to 12%-federal-bracket headroom
  (conv- and SS-inclusive) → Brokerage → Trad-above-headroom → Roth. Pulls
  Trad cheaply in low-bracket years.

There is no user-facing knob — the field on `UserData` is gone entirely.

**`_forceSpendingOrder` (test-only internal hook).** When you need to
isolate a specific policy in a unit test (or pin one across a perf-critical
batch of projections), pass `_forceSpendingOrder: 'brokerage_first' |
'bracket_aware'` to:
- `runDeterministicProjection(userData, options)` — for one-off projections.
- `buildPrecomputes(userData, options)` — when constructing precomputes
  directly (rare; usually go through `runDeterministicProjection`).
- `calculateAnnualCashFlow(userData, year, inflationRate, ..., _forceSpendingOrder)` — last positional arg on the public thin wrapper.
- `computeAutoBracketSchedule(userData, taxStrategy, pinnedSpendingOrder)` — third arg; used by `runOptimization` to avoid re-running the selector AutoBracket would otherwise do internally.

The underscore prefix signals "internal — not part of the persisted data
model and not exposed via UI." `selectBestSpendingOrder` itself uses this
hook to break the recursion when running its own pair of inner projections
(both inner calls pass the candidate policy via `_forceSpendingOrder`, so
the inner `buildPrecomputes` skips re-running the selector).

**The change kills the implicit gating that previously made the policy
depend on whether any `roth_conversion` event existed.** Old behavior: no
conversions → brokerage_first; conversion present → bracket_aware. This
caused a "+$514K bonus for adding a $1 placeholder conversion" surprise in
the impact preview. New behavior: the engine just picks the better policy
for the scenario, regardless of conversion presence. The Impact Preview's
`netPlanValueImpact` is now the honest marginal effect of the conversion
on top of the engine already doing its best.

The bracket headroom is **conv- and SS-inclusive**: precomputed per year as
`max(0, top_of_12% − max(0, (otherTaxableGross + conversionGross + ssTaxable) − stdDed))`
where `ssTaxable` is computed via `calculateSSTaxableAmount` using ordinary
income inclusive of conversion. Including conversion AND SS in the baseline
is load-bearing: without conv, Trad spending pull + conv could combine to
push past 22%; without SS, the same overshoot can happen for retirees who
claim SS during the conversion window.

**No coordination is needed between this layer and the conv-tax sourcing
rule above.** Conversion tax still prefers Brokerage (withholding from the
conv pull is mathematically inferior since it loses Roth growth on the
withheld dollars). The two systems share a single Brokerage bucket but
compete for distinct dollars (spending overflow vs conv tax); the
conv-inclusive headroom keeps Trad pulls within bracket so the picture
stays consistent.

**Deductions modeled in the headroom:** base standard deduction *plus*
the long-standing IRS age-65 senior bonus (`getUsualSeniorExtra`). The
temporary OBBB extra deduction (2025-2028, AGI-phased) is deliberately
omitted — it's AGI-dependent, which would force a fixed point against
the Trad pull itself. Leaving it out keeps the headroom honestly
conservative through 2028 and bit-for-bit identical after the sunset.

**Blind spots (heuristic, not optimum):**
- Doesn't account for IRMAA tier cliffs — pulling Trad lifts 2-year-prior
  MAGI lookback and could trigger a future tier.
- Doesn't optimize against NIIT thresholds.
- Doesn't use state retirement-income exclusions (VA 65+ age deduction,
  NY $20k pension exclusion, etc.) in the headroom calc — federal 12%
  dominates the decision in most states.
- OBBB extra senior deduction (2025-2028) is not in the headroom; bracket-
  aware is slightly conservative for low-AGI seniors during the OBBB window.
- SS-torpedo second-order effect: the headroom uses SS-taxable computed
  against ordinary income *without* the spending Trad pull. A Trad pull that
  bumps SS into a higher taxable fraction can cause minor overshoot; bounded
  by the 85% SS-taxable ceiling.
- Uses the *requested* conversion (not the executed) in headroom — if
  conversion gets capped by Trad balance late in the window, headroom is
  conservatively tight; bracket_aware under-pulls Trad slightly. Never unsafe.
- Doesn't change the conversion size — that's a future layer-3 strategy.

## Roth Conversion generator wizard

**Conceptual model.** A Roth conversion is *marginal-rate arbitrage*: convert when your current marginal effective rate is lower than your future marginal effective rate. The window is typically the gap years between retirement and first-RMD (≈60–72), extendable for heir-rate arbitrage. Past ~80, the math shifts from owner-lifetime tax arbitrage to estate planning, which the wizard doesn't model — so the wizard caps the conversion window at age 80 by default (`DEFAULT_END_AGE_CAP` in [src/services/strategies/types.ts](src/services/strategies/types.ts)). The right output is a *schedule*, not a yes/no, and the right framing is "how much per year inside a bounded window" — not "should I convert."

Roth conversion *scheduling* lives in [src/dialogs/RothConversionDialog.tsx](src/dialogs/RothConversionDialog.tsx) as a two-mode dialog. **Launch points (mode is driven by the `onApplyBatch` prop):**

- **Tools menu → "Roth Conversions"** ([AppHeader.tsx](src/components/AppHeader/AppHeader.tsx)) renders the dialog *with* `onApplyBatch` → the wizard tab is the default (single still reachable as a secondary tab). This is the discoverable home for the multi-year planner, a sibling of the SS claiming-age wizard. Its Apply calls the shared `applyGeneratedConversions` helper ([src/utils/applyGeneratedConversions.ts](src/utils/applyGeneratedConversions.ts)) via `context.updateScenario`.
- **Income panel → + → "Roth Conversion"** ([IncomeEventsManager.tsx](src/components/IncomeEventsManager.tsx)) renders it *without* `onApplyBatch` → `wizardAvailable` is false, locking it to single-conversion entry (no wizard tab). Editing an existing row also opens single/edit mode here.

Generator-produced batches (whichever launch point) remain real `roth_conversion` events grouped in the Income list as before. The two modes:

- **Plan a multi-year schedule** (default in the Tools-menu launch) — the generator wizard. User picks a **plan window** (end-age cap, default 80) and toggles **cliff awareness** (default ON), then clicks **Generate plan**. ~3–5 s. Runs `runOptimization` (coordinate descent on the per-year vector, ~600–1500 deterministic projections), which seeds internally from an Auto-bracket grid search across `{none, 12_percent, 22_percent, 24_percent}`. The Auto-bracket grid is not user-facing — it's an internal warm-start for the descent. Reports improvement vs the user's *true baseline* (no extra conversions, content-aware spending order), not vs the Auto-bracket seed. Hidden behind **Advanced**: the objective (`'max_median_terminal_wealth'` default, `'min_lifetime_tax'` alternative). Differences are usually small for typical scenarios.
- **Single conversion** — user manually enters one event with start/end age, COLA, etc. The standalone "Fill to bracket" picker was removed; users who want to fill a specific bracket use this mode and enter the amount themselves.

The dialog shows an **inline what-if comparison chart** ([src/dialogs/RothConversionComparisonChart.tsx](src/dialogs/RothConversionComparisonChart.tsx)) after Generate plan completes — two deterministic projection lines (current plan vs proposed plan), in real (year-0) dollars. Matches the framing of the wizard's scoring (also real dollars), so the optimizer's "improvement" claim aligns visually with what the chart shows.

The compute backends live in [src/services/strategies/](src/services/strategies/): `computeFillToBracketSchedule`, `computeAutoBracketSchedule`, `runOptimization`. They're pure compute — given `UserData` + a `TaxStrategy` config object (now including `endAgeCap`), they return a `PerYearStrategyDecision[]`. The engine no longer consults `userData.taxStrategy` at sim time. All three backends honor `taxStrategy.endAgeCap`: years where `min(self_age, spouse_age) > endAgeCap` emit zero (vector length stays `totalYears` so OptimizeStrategy's coordinate descent indexing stays uniform).

**Scoring** (`scoreProjection` in [AutoBracketStrategy.ts](src/services/strategies/AutoBracketStrategy.ts)):
- `'max_median_terminal_wealth'` (default) — start-of-last-year portfolio balance, **deflated to real (year-0) dollars** by `(1+inflationRate)^horizon`. Prevents the optimizer being seduced by nominal terminal wealth into late-life conversions whose owner-lifetime payoff is near zero once you correct for inflation.
- `'min_lifetime_tax'` — negative sum of per-year `totalTax`, each year deflated to year 0.
- `'max_floor'` / `'max_lifetime_consumption'` — reserved; currently fall back to terminal wealth (full MC scoring / spending-tier feedback is future work).

**IRMAA/NIIT cliff awareness is default ON** (`UserData.respectIrmaaNiitCliffs` treats `undefined` and `true` as enabled; only explicit `false` opts out). Practitioner consensus treats IRMAA tier crossings as hard caps, not soft scoring penalties. The toggle lives in the wizard itself, not the Scenario dialog — it's a generation-time concern, not a scenario-level configuration. Manual single-conversion entries remain uncapped (matches user intent).

**Withdrawal source is not a user-facing knob.** The engine auto-selects per scenario via `selectBestSpendingOrder` — runs two deterministic projections (one per candidate policy) and picks the higher real terminal balance. No user input, no implicit gating on conversion presence. The `UserData.spendingWithdrawalOrder` field was removed entirely; a test-only `_forceSpendingOrder` internal hook lets unit tests isolate specific-policy behavior without exposing it as data. No competing planner (ProjectionLab, Boldin, Pralana, Income Lab) asks users to pick a withdrawal source for conversion tax.

**Apply → first-class events.** When the user clicks Apply, the dialog converts each non-zero `PerYearStrategyDecision` into a real `roth_conversion` event on `scenario.incomeEvents`, tagged with `meta = { generatedBy, generatedAt, generatorRunId }`. From then on the conversions are visible everywhere (Income panel, chart badges, CSV export, scenario JSON export).

**Provenance + re-run replace policy.** [src/types/IncomeEvent.ts](src/types/IncomeEvent.ts):
```ts
export type IncomeEventGeneratedBy = 'user' | 'fill_to_bracket' | 'auto_bracket' | 'optimize';
export interface IncomeEventMeta {
  generatedBy?: IncomeEventGeneratedBy;
  generatedAt?: string;       // ISO date
  generatorRunId?: string;    // shared across one batch
}
```
- New manual events: `meta` is undefined (treated as `'user'`).
- Generator-Apply: every event in the batch shares one `generatorRunId` + `generatedBy = <method>` + today's ISO date.
- **Editing a generated event flips `meta.generatedBy` to `'user'`** (`handleSubmit` in [RothConversionDialog.tsx](src/dialogs/RothConversionDialog.tsx)). The row leaves the regenerable schedule; it survives re-runs.
- **Re-run policy** (`applyGeneratedConversions` in [src/utils/applyGeneratedConversions.ts](src/utils/applyGeneratedConversions.ts), called from the Tools-menu wizard in [AppHeader.tsx](src/components/AppHeader/AppHeader.tsx)): remove every `roth_conversion` event where `meta.generatedBy ∈ {fill_to_bracket, auto_bracket, optimize}`; keep all `'user'`/untagged events; append the new batch. Replace-confirm fires only when generator-tagged events exist.

**Income panel grouping.** [src/components/IncomeEventsManager.tsx](src/components/IncomeEventsManager.tsx) collapses every group of generator-tagged events sharing a `generatorRunId` into one expandable card (`Roth Conversions · [method chip] · N years · $total · YYYY-MM-DD`). Manual conversions render as individual cards. Editing one row inside the group (which flips `generatedBy → 'user'`) pulls it out of the group on the next render.

**No runtime override.** The engine has no `resolveTaxStrategy` layer — `prepareUserData` flows raw `UserData` through the synthetic-account ensures and into the MC loop unchanged. The `spendingWithdrawalOrder` field on `UserData` was removed in Revision 2; `selectBestSpendingOrder` in [SimulationService.ts](src/services/SimulationService.ts) auto-picks the better of `'brokerage_first'` and `'bracket_aware'` per scenario by running two deterministic projections and comparing real terminal balances. No user override at all (UI or JSON) — a test-only `_forceSpendingOrder` internal hook lets unit tests isolate a specific policy without exposing it as data.

**Legacy `taxStrategy` migration.** Scenarios saved before this rework carried `taxStrategy.cachedVector.perYearDecisions`. On load, `migrateLegacyTaxStrategy` in [scenarioMigration.ts](src/utils/scenarioMigration.ts) (run via the shared `runMigrationPipeline` from both the `initDB` load loop and `importScenario` in [RetirementContext.tsx](src/context/RetirementContext.tsx)) materializes the non-zero entries as tagged `roth_conversion` events (`meta.generatedBy = <strategy name>`), strips the dead field, persists back to IndexedDB, and shows a one-time toast. The `UserData.taxStrategy` type field still exists for the legacy parse path but is otherwise unused.

### IndexedDB schema migrations

Two distinct migration patterns, do not confuse them:

1. **Content-level (inside a stored Scenario): in-band via the shared pipeline.** When a field changes shape inside a `Scenario` object — added, renamed, removed, or restructured — write a `migrate<X>` helper that takes a `Scenario` and returns a `{ scenario, ... }` tuple in [src/utils/scenarioMigration.ts](src/utils/scenarioMigration.ts), and wire it into `runMigrationPipeline` there. That single pipeline (normalize defaults → versioned migrators → inference migrations → schemaVersion stamp) is called by **both** the `initDB` load loop and `importScenario` in [RetirementContext.tsx](src/context/RetirementContext.tsx), so the two paths can no longer diverge. The load loop persists the migrated scenario back via `db.put` so subsequent loads skip the work. `migrateLegacyTaxStrategy` is the reference implementation. The `DB_VERSION` constant stays the same — only the scenario content evolves.

2. **Structural (the IndexedDB schema itself): bump `DB_VERSION`.** When the change is at the database layer — a new object store, a new index, a renamed key scheme — increment the `DB_VERSION` constant in [RetirementContext.tsx](src/context/RetirementContext.tsx) and add a branch to the `upgrade(db, oldVersion, newVersion, tx)` callback. The `upgrade` handler must be idempotent: users whose DB is already at the new version skip it; users at older versions step through each branch in order. The current version is 1 with a single `scenarios` object store.

For all content-level changes — adding `meta` to `IncomeEvent`, splitting a goal type, adding a portfolioAssumptions field — pattern 1 is correct. Don't bump `DB_VERSION` unnecessarily.

**Content-schema version stamp (`schemaVersion`).** Every persisted/exported `Scenario`
carries an optional `schemaVersion?: number` (in [src/types/Scenario.ts](src/types/Scenario.ts)),
stamped to the exported `CURRENT_SCHEMA_VERSION` constant (currently `1`) on **every write** —
`addScenario`, `updateScenario`, `exportScenario`, and the `initDB` load loop. The load-loop
stamp is **silent**: it persists via `db.put` but must NOT fire the "Scenarios updated" toast,
so it's gated by a `needsPersist` flag kept separate from `migratedThisScenario` (only the
pattern-1 content migrations increment the toast counter). `undefined` means a pre-versioning
record/file ("legacy"). This is **distinct from `DB_VERSION`** — that versions the IndexedDB
*structure*; this versions the *content* shape inside a Scenario.

**The value is stamped but the inference migrations still do all the actual transforms.**
The shape-inference migrations (which detect old shape by field presence/type) plus
`normalizeScenario` cover all v0→v1 work today. `schemaVersion: 1` asserts "this is the
current Scenario shape, post all existing inference migrations." The **ordered-registry
skeleton** (`MIGRATORS` + `applyVersionedMigrators` in
[src/utils/scenarioMigration.ts](src/utils/scenarioMigration.ts)) is wired into the pipeline
but currently empty — it's the home for the *next* content change. Do not read `schemaVersion`
to branch behavior elsewhere; the registry is the one sanctioned place that does.

**Release-readiness (mostly done — released-mode rules now apply).** An external user now has
real data, so the data-stability rules below are live (see "Released-mode data stability" in
Conventions). The version stamp was added *early and deliberately* because it's the one thing
that can't be retrofitted — you can't version files that were already exported unversioned.
Status of the three roadmap items:
- ✓ **Load/import convergence** — both paths run the single `runMigrationPipeline`
  ([scenarioMigration.ts](src/utils/scenarioMigration.ts)); the formerly import-only
  `portfolioAssumptions` normalization now lives in `normalizeScenario` and runs on load too.
- ✓ **Forward-compat guard** — `validateImportedScenario` rejects an imported file whose
  `schemaVersion > CURRENT_SCHEMA_VERSION` with a clear "newer version of YARP" error; the
  `initDB` load loop skips (and never re-persists) a newer-stamped record so an app downgrade
  can't corrupt it.
- ✓ **Deep import validation** — `validateImportedScenario` checks `accounts` / `incomeEvents`
  / `spendingGoals` array elements and the required `portfolioAssumptions` numbers
  (`stockStdDev`/`bondStdDev`, historical-mode requirements), so a malformed file fails loudly
  at import instead of NaN-ing at the first MC tick.
- ◻ **Remaining for a future content change:** convert to the ordered registry by populating
  `MIGRATORS[v]` and bumping `CURRENT_SCHEMA_VERSION` once per content change (the
  `while (v < CURRENT_SCHEMA_VERSION && MIGRATORS[v]) ...` loop already chains them).

**Deliberate non-goal: multi-year optimizer.** A full optimizer (DP / RL /
Bellman over the lifetime tax-and-withdrawal joint decision) is a research
project, not production code. Production planners (ProjectionLab,
NewRetirement, RighteousDuck) all use *heuristics* — each addresses a
specific real-world planning constraint, named clearly, and users pick the
one that matches their situation. We follow that pattern.

**Deferred items the generator wizard / compute backends would subsume:**

- `'pro_rata'` spending order — would split the spending gap across
  Trad-above-RMD and Brokerage proportionally to their balances. Not in the
  current enum; tracked here for future extension; re-adding to the enum
  is a one-line type change.
- State retirement-income exclusions in the bracket-headroom calc (VA
  65+ age deduction, NY $20k pension exclusion, etc.).
- Full SS-torpedo modeling in headroom (currently uses a static
  approximation — see "Blind spots" above).
- IRMAA + NIIT cliff awareness in conversion sizing — **implemented and on by default**:
  `UserData.respectIrmaaNiitCliffs` treats `undefined`/`true` as on; only explicit
  `false` opts out. `capConversionForCliffs` (exported from `FillToBracketStrategy.ts`)
  caps each year's generated conversion so MAGI stays under the next IRMAA tier
  (year+2 lookback, gated on a Medicare enrollee existing then) and the NIIT
  threshold. Honored uniformly by Fill, Auto-bracket, and the Optimize descent —
  all three treat the flag as the same hard cap, not a soft scoring penalty. The
  bracket-aware *spending* headroom is deliberately NOT clamped: the 12% bracket
  fills to ~$66k/$133k gross, always below the first IRMAA tier and the NIIT
  threshold, so a spending pull can't trip them. Exposed in the **Roth Conversion
  wizard** as a checkbox, not on the Scenario dialog (it's a generation-time concern).
- Liquid-cash bucket internal refactor (cleaner accounting that subsumes
  the RMD-first branch and the bracket-aware branch into one principled
  per-year cash-flow model).
- **Survivor-as-single-filer brackets after first death — ✓ implemented.** See
  "Survivor / widow's penalty" below. Remaining sub-items not yet modeled: the
  2-year qualifying-surviving-spouse grace (we flip to single the year after the
  first death), survivor spending reduction, and heir/estate (SECURE 10-yr) value.

## In-App Documentation

Two Markdown files are served as in-app documentation via the sidebar viewer:

- `src/docs/USER_GUIDE.md` — user-facing guide covering UI, scenarios, income/spending
  events, accounts, and how to interpret results
- `src/docs/MODEL_DETAILS.md` — technical reference covering the simulation engine,
  tax model, RMD rules, return models, and all `UserData` / `portfolioAssumptions` fields

**Keep these files in sync with code changes.** When you add, rename, or remove a feature
that affects user-visible behavior or modeling parameters, update the relevant doc(s) in
the same pass. This includes: new income/spending types, new `portfolioAssumptions` fields,
changes to tax logic, new dialogs or UX flows, and any change to simulation defaults.

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

**Released-mode data stability (the app now has external users).** Real user data exists in
the wild — in IndexedDB and in exported `.json` files — so it must survive future builds.
**Do not wipe the `scenarios` store or assume users will re-enter data.** When you rename,
remove, or restructure a field inside a `Scenario`:
- Add a content migration so old records/files load correctly — wire it into
  `runMigrationPipeline` in [src/utils/scenarioMigration.ts](src/utils/scenarioMigration.ts)
  (the shared load+import pipeline). Prefer the inference style for the current pass, or
  populate `MIGRATORS[v]` and bump `CURRENT_SCHEMA_VERSION` for a registry-tracked change.
- Keep migrations **idempotent** (re-running on already-migrated data is a no-op) and
  **non-throwing** on load (a slightly-off record must not brick the app — only the *import*
  path throws, to reject foreign/corrupt files).
- Code-level cleanliness still applies to the *live* shape: you may delete dead types and
  avoid re-export shims, as long as the migration converts old data to the new shape first.
This replaces the earlier "wipe IndexedDB freely / no backward compatibility" stance, which
was valid only in pre-release dev. The `schemaVersion` stamp (see "IndexedDB schema
migrations" above) is the mechanism that makes this cheap.

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
  (`chartMedian`, `chartNominal`), black-swan shading (`blackSwanShade`,
  `blackSwanStockLabel`), shadows/overlays (`shadowLight`,
  `shadowMedium`, `overlayLight`), sidebar (`activeRow`, `chipBg`).
  **Two-tier rule:** when adding a color, first add the hex to the private `palette`
  object (named by hue + shade, e.g. `blue600`), then add a semantic alias in `colors`
  that references it. Components always import from `colors`; never from `palette`.
- **`fontSize`** — `xs` (0.65rem) through `xl` (1.1rem). `base` (0.85rem) for body text.
- **`border`** — `standard` (`1px solid #ddd`), `light`, `medium`, plus `radius` (4px),
  `radiusRound` (8px), `radiusCircle` (50%).

### Tooltips

Use `<PrimeTooltip>` with rich content for all tooltips — never bare `data-pr-tooltip` strings. Wrap content in a `<div>` with `fontSize: fontSize.xs` and `lineHeight: 1.4` to match the app's compact type scale. Constrain width with `maxWidth: '18rem'` for short tips, `'20rem'` for longer explanations.

```tsx
<PrimeTooltip target=".my-element" position="bottom" showDelay={150}>
  <div style={{ maxWidth: '18rem', fontSize: fontSize.xs, lineHeight: 1.4 }}>
    Tooltip text here.
  </div>
</PrimeTooltip>
```

### Compact spacing rules

- **Padding:** `spacing.xs`–`spacing.sm` for elements, `spacing.md`–`spacing.xl` for
  containers. Avoid `2rem+` anywhere. When in doubt, go tighter.
- **Margins:** zero out default browser margins on headings and `<p>` tags, then add
  only what's needed (typically `0`–`spacing.sm`).
- **Gaps:** `spacing.sm`–`spacing.lg` for flex/grid gaps.
- **General rule:** if a new element adds visible dead space, tighten it. The app should
  feel information-dense and efficient, not padded out.

### Dialog widths (mobile-safe)

PrimeReact's `<Dialog>` honors a fixed `width` but doesn't shrink for narrow viewports. At 360 px a 34rem dialog overflows by ~50 %. Use the `dialogWidth(rem)` helper from `theme.ts` instead of a raw width prop:

```tsx
import { dialogWidth } from '../styles/theme';
<Dialog style={dialogWidth('34rem')} ...>
```

The helper returns `{ width: 'min(34rem, 95vw)', maxWidth: '95vw' }` so the dialog gets its desktop width when there's room and shrinks to fit phones. **All `<Dialog>` widths must use this helper**; raw `style={{ width: '34rem' }}` is a code-review reject.

### Currency formatting

Three patterns coexist intentionally; use the right one for the surface:

- **Compact / abbreviated** (`$1.2M`, `$850K`, `$500`) — `formatCurrencyShort(amount)` from [src/utils/formatCurrencyShort.ts](src/utils/formatCurrencyShort.ts). Default mode is `'compact'`; pass `'precise'` for chart popups during scenario-compare (where small inter-scenario deltas need to be visible). Use this for: **chart axes, sidebar totals, chart tooltips.** Negatives wrap as `-$1.2M`; non-finite returns `—`.

- **Full precision, currency-formatted** — `n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })`. Renders as `$28,584`. Use for: **dialog inputs, dialog preview tables, Impact Preview rows, wizard preview** — places where users compare specific dollar amounts and abbreviation would hide signal.

- **Signed / delta** (`+$28,584`, `-$1,200`) — hand-rolled with a sign prefix and one of the above formatters for the magnitude. Use for: **tax-audit detail rows, surplus/shortfall indicators, what-if delta callouts.**

When in doubt: compact for at-a-glance numbers (charts, sidebars); full precision for cross-checkable values (tables, dialogs); signed when the absence of a sign would itself be misleading.

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

`SimulationService` uses log-normal Monte Carlo (1000 runs default). All simulation
parameters are per-scenario in `UserData`:

- `account.portfolioBalance` — `'80_20' | '60_40' | '50_50'`; UI preset tracker per account
- `account.stockAllocation` — fraction in stocks (0.0–1.0) per account; derived from
  `portfolioBalance` via `PORTFOLIO_PRESETS`; drives per-account growth in the simulation loop.
  New accounts default to `'60_40'` / `0.6`. Synthetic accounts (Reinvestment, Roth Conversion)
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
path is the single simulation run whose final balance is closest to the
50th percentile of all final balances — a coherent per-year path with actual return
factors, not a year-by-year envelope.

**Per-path breakdowns:** `runSimulation()` returns `medianBreakdowns`
(`AnnualCashFlowBreakdown[]`) alongside the path arrays. These are computed during the
simulation loop (not post-hoc) and capture the effective per-year cash flow for the
median representative run — including portfolio depletion effects (when balance hits $0,
`portfolioWithdrawal` is capped at the available balance and a spending shortfall is shown).
The deterministic (Nominal) path uses `nominalBreakdowns` returned by `runSimulation()`
alongside the nominal path array. The yearly data detail rows show the breakdown for the
chart's primary path (Projected, or Median in the historical rolling/bootstrap modes that
have no deterministic baseline). There is no separate Downside representative run — the
chart's shaded percentile band conveys the downside envelope instead.

**Percentile band + MC stats:** `runSimulation()` also returns `percentileBand:
{ p10: number[]; p90: number[] } | null` (year-by-year envelope, computed
independently of the representative runs — no breakdowns attached) and
`mcStats: { medianEndingBalance, p10EndingBalance, medianDepletionAge,
worstDecileDepletionAge } | null`. Both are `null` when `numRuns < 10` (e.g.
`historical_single` mode). The band powers the chart's shaded region via
`chartPercentileBand` plugin; the stats power the header strip. Depletion ages
use the same `spendingShortfall > 0` definition that drives `failed`/`failedYear`.

**Performance architecture:** `runSimulation()` precomputes balance-independent inputs
once before the Monte Carlo loop — `lognormalParams` for stock/bond/inflation, and
per-year arrays (`stateProfileByYear`, `stateNameByYear`, `ageByYear`, `incomeByYear`, `spendingByYear`).
The inner hot loop calls `calculateAnnualCashFlowCore` (internal fast-path) with these
arrays instead of recomputing them 1000× per year. The public `calculateAnnualCashFlow`
signature is unchanged — it is a thin wrapper that recomputes inputs inline; use it in
tests and any call-site that doesn't have precomputed values. The simulation trigger in
`Content.tsx` is debounced 250ms so rapid field edits don't fire redundant Monte Carlo
runs. Chart.js props (`chartData`, `options`, `htmlAnnotations`) are wrapped in `useMemo`
with precise deps; `Projections` is wrapped in `React.memo`.

**Web Worker pool (parallel MC):** Production MC runs through `SimulationClient`
([src/services/SimulationClient.ts](src/services/SimulationClient.ts)) which shards
the run loop across a pool of workers sized to `clamp(hardwareConcurrency - 1, 2, 8)`.
The protocol is two-pass: workers execute their slice via `runShard` and return
lightweight summary arrays (scores, failedFlags/Years, year-major `pathColumns`) as
zero-copy `Transferable` Float64Arrays; the main thread merges across shards to
compute the global percentile band + `mcStats` + the median representative-run pick, then
requests `replay` from the owning shard for the median run (which
gets full `AnnualCashFlowBreakdown` audit data via `replayRunWithAudit`). The
deterministic nominal projection runs on the main thread (~5ms). Cancellation
is supersession-via-terminate-and-respawn: a new `run()` while one is in flight
kills the pool and rejects the prior Promise with `SupersededError` (the 250ms
debounce upstream absorbs most rapid edits before they reach the client).
Scenarios with `effectiveNumRuns < INLINE_THRESHOLD` (200) — including
`historical_single` and `historical_rolling` without wrap — skip the pool and
run inline on the main thread (worker spawn + message overhead dominates for
tiny sims). `simulationClient.warmUp()` is called from `AppContent` on mount
so first-MC pays no cold-start cost. The Web Worker entry is
[src/workers/simulation.worker.ts](src/workers/simulation.worker.ts); engine
modules (`SimulationService`, `TaxCalculator`, `IRMAA`, `StateTaxCalculator`,
`ReturnGenerator`) have no DOM dependencies so they import cleanly in worker
context. **Determinism caveat:** each worker uses an independent `Math.random`
stream, so cross-machine results differ when `hardwareConcurrency` differs.
Scenario tests use the inline (`shardCount=1`) path with a seeded RNG and
remain bit-exact.

Account-level lookups (by id, by type, first brokerage, contribution target by event id,
allocation by id) are precomputed once into an `AccountIndex` and threaded through
`simulateOneRun` / `applyCashFlow` so the hot loop never re-scans `userData.accounts`.
New helpers that depend only on static `userData` should be hoisted into a precompute
(see the comment above the `Precomputes` interface).

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
- **Median path construction**: currently uses the single run whose final balance
  is closest to the 50th percentile. An alternative is year-by-year percentile envelopes
  (smoother chart lines, but synthetic paths with no coherent per-year actuals). The
  representative-run approach was chosen to enable exact stock/bond attribution in detail rows.
- **Cross-flow priority** (compare/What If supersede primary): all three flows
  share one `simulationClient` singleton and supersede each other. Acceptable in
  practice (React effects re-fire and recover) but a future improvement is to
  plumb a `priority`/`kind` field and queue rather than terminate when the
  caller is compare/What If.

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
- `chartPercentileBand` — fills the 10th–90th percentile region beneath the projected line (year-by-year envelope; toggled via the session-only `showBand` flag in `Projections`). Also installs an `afterDataLimits` hook that extends the y-axis to include the band's full lower edge and the upper edge up to `Y_CAP_MULT × max(line)` (constant `2.0`) — keeps the projected line visually prominent when the band has heavy upside tails.
- `chartMilestones` — draws a thin dashed vertical line + a small top pill label at a milestone calendar year. Currently used for the survivor "widow's penalty" filing-status transition (pill: "Now filing Single"), with the year derived from `getDeathModel(userData)` in `Chart.tsx` (no persisted field). Lighter than `chartBlackSwanShading` (a line, not a full-height band) so it reads as a neutral plan event.

**Chart x-axis age frame.** Labels are `${currentAge + index} (${year})` — i.e. **your** age, which naturally keeps counting past your own death when the spouse outlives you (matches the "your age, full range" decision). When `spouseAge` is set, a session-only Self/Spouse toggle in the legend row (`ageAxisMode` state) relabels the points as the spouse's age. The calendar years and the engine horizon are unchanged by the toggle.

### Top bar: Settings menu

`AppHeader` renders a **Settings** dropdown (PrimeReact `Menu` popup) with these items:

- **Load example…** — appends a built-in example scenario (Near retirement / Retired early / Mid-career) and makes it active. Always enabled.
- **Modeling** → `ModelingDialog` — Return Model selector at the top
  (Parametric / Historical: Single Sequence / Historical: Rolling Start / Historical:
  Block Bootstrap) with mode-specific fields (start year, wrap-around, block size);
  stock/bond expected return % and std dev % (grouped), distribution (lognormal /
  student-t), asset correlation, inflation rate % and std dev %, simulation run count;
  read-only blended return (portfolio-weighted average across accounts). Parametric-only
  inputs (returns, distribution, correlation, inflation rate/stddev) are disabled when a
  historical mode is active.
- **Cash Bucket** → `CashBucketDialog` — min/target/max dollar amounts and refill trigger for `UserData.cashBucketPolicy`. Menu item only rendered when the active scenario has ≥1 cash account (or already has a configured policy).
- **Tax & IRS** → `TaxAndIrsDialog` — long-term capital gains rate, IRMAA / NIIT toggles, `priorWorkingMagi` (last working year MAGI for first-2-years IRMAA lookback), and IRS contribution limits.
- **Export CSV** — downloads the active scenario's yearly data table.

Stock/bond allocation per account is configured in `AccountDialog` (80/20, 60/40, or 50/50
preset buttons). The allocation badge is displayed on each account row in `AccountsManager`.

Modeling, Cash Bucket, Tax & IRS, and Export CSV are disabled when there is no active scenario; Load example… is always enabled.

### Implemented UX

- **Chart rendering**: chart shows the **Projected** line (or Median when no
  deterministic baseline exists — `historical_rolling` / `historical_bootstrap`)
  plus a shaded **Likely range** band (`chartPercentileBand` plugin) — a
  year-by-year envelope of the 10th–90th percentile across all Monte Carlo
  runs. Median and Downside no longer render as separate chart lines. The
  `mcStats` summary (median ending balance, p10 ending balance, median
  depletion age, worst-decile depletion age) lives inside the tier-badge
  tooltip beside "Chance of Success", not on the page as a separate strip.
  A `Hide band` toggle sits next to the `Data` button on the bottom legend
  row. Internal UI labels use friendly names: `Projected` (not Deterministic),
  `Likely range` (not "10th–90th percentile"), `Future $` (not Nominal $).
  The underlying `DisplayCurrency` type and `view` mode strings remain
  `'nominal'` / `'real'` — UI rename only.
- **What If mode**: chart locks to the primary (Projected / Median) line — Original (gray solid) vs Draft (amber dashed). Band is hidden in What If. This makes Draft and Original coincide at entry because the deterministic projection is reproducible. `Content.tsx` still calls `runSimulation(whatIfSnapshot)` redundantly when entering What If (the deterministic projection makes the redundant run user-invisible, just wasteful). Intentionally deferred — don't "fix" by reusing `results` without revisiting the locking decision.
- **Yearly data table**: there is no table-view switcher. The table renders the
  chart's primary path (`chartPrimaryMode` in `Chart.tsx`) — the Projected
  (deterministic) path, or the Median MC run in `historical_rolling` /
  `historical_bootstrap` (which have no deterministic baseline). Its portfolio
  column, income/spending/tax detail rows, and CSV export all follow that one
  path. Depleted years still show a shortfall indicator in the detail row.
- **CSV export**: download button in yearly data header exports the Projected and Median portfolio paths
  plus the band p10/p90 columns and the full income/spending/tax breakdown per year as a `.csv` file
- **Scenario comparison**: "Compare with ▾" button in the chart heading (right-aligned via
  `margin-left: auto`) opens a PrimeReact `Menu` popup listing other scenarios. Selecting
  one overlays the compared scenario's currently-selected path as a dashed line on the
  chart and shows both names + probabilities + tier badges in the heading; "End comparison"
  clears it. State (`compareScenarioId`) lives in `AppContent` and flows to `Content` →
  `Projections`. Comparison auto-clears when the active scenario changes (effect on
  `activeScenario?.id` in `Content.tsx`). To avoid a one-frame flash of the wrong button
  while the compare sim runs, `compareResults` is tagged with the scenario id it was
  computed for, and `isCompareCalculating` is derived synchronously from the id mismatch
  rather than via `useEffect`.

### Planned UX

- True side-by-side dual-chart layout (separate canvases for each scenario instead of
  the current single-chart overlay)
- Compare 3+ scenarios at once
- PDF export of scenario summaries
- Monthly/annual input toggle for remaining spending goal and income event dialogs
  (the `amountPeriod` field is already on both `SpendingGoal` and `IncomeEvent` types;
  living expenses and Social Security dialogs already have the toggle)

### Other extensibility

- Portfolio: user-defined asset classes beyond stocks/bonds/cash; per-account
  allocation (bonds-in-Traditional, stocks-in-Roth placement); cost-basis tracking
  for brokerage accounts with long-term capital gains brackets
- Tax: bracket updates as legislation changes; user-configurable withdrawal ordering
  (currently hardcoded Brokerage → Traditional → Roth). Roth conversions ✓ implemented —
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
  checks. Valid fields: all top-level keys of `AnnualCashFlowBreakdown` —
  `portfolioWithdrawal`, `withdrawalFromBrokerage`, `withdrawalFromTraditional`,
  `withdrawalFromRoth`, `totalTax`, `netCashFlow`, `ssGross`, `otherTaxableGross`,
  `afterTaxIncome`, `ssTaxableAmount`, `totalGrossIncome`, `baseSpendingNet`,
  `otherSpendingGoalsNet`, `totalSpendingNet`, `rmdRequired`, `rmdExcess`,
  `rothConversionGross`, `ordinaryTax`, `federalCapGainsTax`, `stateCapGainsTax`,
  `niitTax`, `irmaaSurcharge`. Audit intermediates (`audit.federalBracketIndex`,
  `audit.ssZone`, `audit.incomeEventTaxBreakdown`, `audit.accountFlows`, etc.) are
  nested under `audit` and **not** checkable via `breakdownChecks` — the runner
  does flat key lookup. Assert these in unit tests against `runSimulation()` /
  `calculateAnnualCashFlow()` directly, or against the detailed variants in
  `TaxCalculator` / `IRMAA`.

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
