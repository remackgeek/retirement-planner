# YARP Model Details

> Technical reference for the simulation engine, tax calculations, and underlying methodology.

---

## Monte Carlo Simulation

YARP runs **1,000 independent simulations** by default (configurable: 1,000 / 5,000 / 10,000). Each simulation draws a random sequence of annual stock and bond returns and projects every account from today through your life expectancy, applying income, spending, taxes, and withdrawals each year.

In the browser, MC runs in parallel across a Web Worker pool sized to your machine's available cores (capped at 8) so the UI stays responsive during a sim. Each worker uses an independent `Math.random` stream — results are statistically equivalent but not bit-identical across machines with different core counts. The deterministic projection ("Projected" chart line, and the Roth-conversion *Net impact on plan value* preview row) does not consume the RNG and is fully reproducible regardless.

### Success Probability

A run is **successful** if portfolio balance never reaches $0 before life expectancy. The reported success probability is the fraction of successful runs.

### Representative Path

YARP selects the **single simulation run** whose final balance is closest to the 50th percentile (Median) of all final balances. This representative run powers the **yearly data table** breakdowns in Historical: Rolling / Bootstrap modes (which have no deterministic baseline) — the same year's stock and bond return factors drive every line of that run's detail, so income, spending, taxes, withdrawals, and balance evolve consistently from a real return sequence. In all other modes the table shows the deterministic **Projected** path.

### Percentile Band (chart shading)

Separately, the chart's shaded **10th–90th percentile band** is computed as a **year-by-year percentile envelope**: at each year independently, all run balances are sorted and the 10th and 90th percentile values are taken. The band is therefore synthetic — no single simulated future traces its edges — but it gives the most honest visual summary of uncertainty over time, which the representative-run lines cannot. The band uses the deterministic inflation series as its display-currency deflator. It is skipped when fewer than 10 runs are available (e.g. `historical_single` mode).

### Monte Carlo Stats

The tier-badge tooltip beside *Chance of Success* surfaces four MC summary numbers, all computed once from the full run pool:

- **Median ending balance** — p50 of final-year balances
- **10th-percentile ending balance** — p10 of final-year balances
- **Median depletion age** — p50 of (per-run) first year the portfolio's spending shortfall is positive, converted to age; `null` when more than half of runs survive
- **Worst-decile depletion age** — p10 of the same per-run depletion years; `null` when more than 90% of runs survive

Depletion is detected via `AnnualCashFlowBreakdown.spendingShortfall > 0`, the same definition the success probability uses.

---

## Return Models

### Parametric (default)

Stock and bond returns are drawn from **log-normal distributions** parameterized by your configured arithmetic mean and standard deviation. The implementation computes log-space parameters from the user-facing arithmetic moments:

```
σ = √( ln(1 + stdDev² / (1+mean)²) )
μ = ln(1 + mean) − σ²/2
factor = exp(μ + σ · z)
```

where `z` is a standard-normal draw (or a standardized Student's t draw if fat-tail mode is on). With a standard-normal shock, this parameterization ensures `E[factor] = 1 + mean` regardless of std dev. **The mean-preservation guarantee holds only for the normal branch.** With a Student's t shock the log-normal mean is not strictly preserved — the t-distribution's moment-generating function does not exist, so `E[exp(σ·t)]` is unbounded in theory; in practice fat-tail mode introduces a small upward mean bias and occasional extreme up-years. The variance matching (next section) is unaffected.

### Historical: Single Sequence

Walks one fixed slice of the **1928–2024 historical series** (S&P 500 total return / 10-year Treasury / CPI), starting at `historicalStartYear`. Deterministic — `numSimulations` is ignored, success is binary.

### Historical: Rolling Start (Trinity-style)

One simulation per valid historical start year. Each run uses the actual sequence of returns beginning in that year.

- Without wrap: `numRuns = HISTORICAL_YEARS − horizon + 1`
- With wrap enabled: every start year is valid (`numRuns = 97`); the index wraps modulo the series length when it walks off the end.

Success rate is the fraction of start years that survived. This is the classic Trinity Study methodology.

### Historical: Block Bootstrap

Each run concatenates randomly-chosen consecutive blocks of historical years until the horizon is filled. Block size is configurable: **1, 3, 5, or 10**. Block size 1 reduces to independent year resampling. Larger blocks preserve short-term serial correlation (a 1970s stagflation block keeps bad returns paired with high inflation).

`numRuns = numSimulations` for this mode.

### Historical Mode Coupling

In every historical mode, returns and CPI are drawn from the **same row** of the historical table. This preserves the empirical correlation between asset returns and inflation regimes. Your configured `inflationRate` and `inflationStdDev` are **ignored** in historical modes.

---

## Return Distribution

### Log-Normal (default)

The standard model. Annual return factors are log-normally distributed: prices stay positive, returns are right-skewed, and volatility scales naturally.

### Student's t (fat tails)

The standard normal shock `z` is replaced with a **standardized Student's t draw**:

```
t_standardized = t(df) · √((df − 2) / df)
```

The `√((df-2)/df)` scaling ensures the realized variance equals 1, so log-space variance still matches your configured `stockStdDev` / `bondStdDev`. **Fat tails come from excess kurtosis, not inflated variance** — extreme events become more frequent. Note this does *not* leave the average outcome exactly unchanged: because the mean-preservation identity above holds only for the normal shock, fat-tail mode adds a slight upward bias to the average factor along with the heavier tails (see the caveat under "Log-Normal").

When asset correlation is enabled, the bond shock is formed as a Cholesky blend of two independent t-draws. A linear combination of t-variables is **not itself exactly t-distributed**, so the bond marginal in correlated fat-tail mode is an approximation rather than a true Student's t. This is acceptable for the model's purposes and noted here for honesty.

`df` (degrees of freedom) is configurable from 3 to 12; default is **4**. Lower `df` = fatter tails. Inflation always uses log-normal regardless of this setting.

---

## Asset Correlation

When enabled, stock and bond shocks are drawn as a **correlated bivariate pair** via two-variable Cholesky decomposition:

```
stock_shock = z₁
bond_shock  = ρ · z₁ + √(1 − ρ²) · z₂
```

where `z₁`, `z₂` are independent draws (normal or standardized t) and `ρ` is the configured correlation, clamped to `[−1, 1]`. When disabled, shocks are independent. The same construction applies whether the underlying distribution is normal or Student's t.

---

## Inflation

Inflation is modeled as a **log-normal process** with a configurable mean rate and optional standard deviation. The mean and std dev use the same arithmetic-to-log-space conversion as asset returns.

### Cash Flow vs Portfolio Treatment

YARP currently splits how inflation is applied:

- **Cash flows** (income events, spending goals) are inflation-adjusted using the **deterministic mean rate only**. Each year's spending/income is treated as a known nominal amount.
- **Portfolio deflation** (real vs nominal balance display) uses the **stochastic per-run inflation series**, so each run has its own real-balance trajectory.

This asymmetry exists because user inputs are entered in today's dollars; propagating per-run cumulative inflation to cash flows would change how every dollar amount in the UI is interpreted. Treat it as a known limitation.

---

## Real vs Nominal Display

The chart and yearly table can show values in either **real** (today's dollars) or **nominal** (future dollars) terms. Internally, two different storage conventions are used:

- **Portfolio paths** are stored in **real** dollars. The simulation divides by the per-run cumulative inflation factor at each step. Nominal display multiplies back:
  ```
  nominalValue = realValue · inflationFactor(year)
  ```
- **Cash-flow breakdowns** (income, spending, taxes, withdrawals) are stored in **nominal** dollars — the actual dollar amounts paid/received that year. Real display divides:
  ```
  realValue = nominalValue / inflationFactor(year)
  ```

In both cases the toggle is a presentation transform; no simulation re-runs.

---

## Per-Account Growth

Each account has its own stock allocation `s` (fraction in stocks, 0.0–1.0). Annual growth multiplier:

```
balance ← balance · (s · stockFactor + (1 − s) · bondFactor)
```

**Rebalancing:** the formula implicitly assumes the account is rebalanced to its target allocation each year. We do not track separate stock and bond sub-balances per account.

**Timing convention (end-of-year spending).** Each year a full year of growth is applied to balances *before* any withdrawal is taken — withdrawals effectively occur on December 31. (RMD is the consistent exception in spirit: it is computed on the *beginning-of-year*, pre-growth Traditional balance, matching the IRS Dec-31-prior-year rule.) End-of-year withdrawal is the optimistic end of the standard conventions — a mid-year convention would be neutral by comparison — so reported balances run modestly higher than a mid-year model would produce. We disclose it here rather than model multiple timing options.

Synthetic accounts (auto-created Reinvestment, Roth Conversion accounts) default to **60/40** allocation.

**Cash accounts bypass this formula entirely.** Cash is non-volatile by construction. The growth loop branches on `account.type === 'cash'` and applies a deterministic yield instead:

```
cashInterest = balance · cashYieldRate
balance ← balance + cashInterest
```

`cashYieldRate` lives on `portfolioAssumptions` (default 4%). Cash is also skipped by the black-swan overlay — a "cash is trash" 2022-style episode shows up as opportunity cost vs. equities, not as a cash shock. This holds across all return models (parametric, historical, bootstrap); cash never participates in the stochastic stream.

`cashInterest` is **reinvested into the cash balance** (`balance ← balance + cashInterest`, above) — it is *not* paid out as separately-spendable income. Spending draws from the already-grown balance via a withdrawal; the interest funds spending there, never as a second offset against the year's spending need. (Counting it in both the balance and the year's available cash would double-count the yield — a 4% account behaving like 8%.)

`cashInterest` is taxed as ordinary income in the year accrued (accrual basis, matching MMF/HYSA behavior — no basis tracking). It is folded into `otherTaxableGross` for the entire tax pipeline (federal/state ordinary, SS provisional income, IRMAA MAGI) and additionally added to the NIIT investment-income proxy per IRC §1411 (MMF interest is investment income for NIIT purposes — without this proxy extension, cash-heavy retirees above the NIIT threshold would be under-taxed). The tax on accrued interest is funded by the normal spending waterfall, as accrual-basis income should be.

Cash principal is **tax-free on withdrawal** (no LTCG, no NIIT on principal). The waterfall pulls Cash at priority 0 (before RMD and Brokerage) to avoid LTCG churn and the conversion-tax amplification phantom. See "Withdrawal Waterfall" below.

### Cash bucket policy (optional)

`UserData.cashBucketPolicy` enables automatic cash-bucket management. The policy declares a band in **fixed dollar amounts** (they stay constant every year — they do not inflate):

```
cashBucketPolicy: {
  minAmount,                // soft floor — spending pulls Cash only down to this
  targetAmount,             // surplus deposits and refills aim for this
  maxAmount,                // hard ceiling — excess sweeps to Brokerage
  refillTrigger: 'always' | 'gains_only' | 'above_baseline' | 'none',
}
```

Behavior:

- **Soft floor.** The spending waterfall pulls Cash only down to `minAmount`. Below that, spending falls through to Brokerage. This reflects the reality that users have unmodeled liquid cash (checking, bill-pay buffer) — the floor represents how much they're willing to hold in this modeled bucket. Set `minAmount: 0` for full drain-to-zero behavior. The conversion-tax-sourcing chain respects the same floor. Floor-locked dollars are also **excluded from the withdrawal cap**: a year whose spending can only be met by dipping below the floor reports an honest `spendingShortfall` (and fails the run) instead of silently pretending the locked cash was spent.
- **Hard ceiling.** When cash balance exceeds `maxAmount` at end of year, the excess sweeps to the first Brokerage account in a **post-convergence** step. The sweep is a **tax-free balance transfer** — implementation does not route through the withdrawal waterfall, so no LTCG / NIIT is realized.
- **Refill.** When cash is below `minAmount` AND the trigger fires AND surplus is available, the engine reroutes this year's surplus from Brokerage to Cash up to `targetAmount`. Refill is **surplus-only** — the engine never sells Brokerage mid-loop to top up cash. That rule prevents phantom-tax archetype #3 (the refill-LTCG leak).
- **Triggers.** `'always'` (any year with surplus). `'gains_only'` (this year's stockFactor > 1 — recommended; bear-aware). `'above_baseline'` (portfolio post-growth / deterministic-baseline > 1; strictest bear-aware). `'none'` (manual mode — also disables the spending-waterfall floor; equivalent to leaving the policy undefined).

**Structural enforcement of the no-tax-mutation invariant.** The post-convergence step lives in `applyPostConvergenceBucketPolicy` which receives only a minimal subset of the settled breakdown (`netCashFlow`, `spendingShortfall`) plus account balances and the policy. It does not import any tax module. Its return type contains only cash-routing fields. As a result, the function is type-prevented from mutating `totalTax`, `ordinaryTax`, `federalCapGainsTax`, `niitTax`, `irmaaSurcharge`, or any income field — making "post-convergence step never re-enters the tax calc" a type-level guarantee rather than a runtime discipline.

The `cashRefillFromSurplus` and `cashSweepToBrokerage` fields in `AnnualCashFlowBreakdown` expose the per-year amounts moved.

### Blended Return (displayed in Modeling dialog)

The "Blended return" shown in the Modeling dialog is the **balance-weighted arithmetic average** of stock and bond expected returns across all your accounts:

```
weightedStockAlloc = Σ(account_balance · stockAllocation) / Σ(account_balance)
blendedReturn      = weightedStockAlloc · stockReturn
                   + (1 − weightedStockAlloc) · bondReturn
```

This is a UI summary only — the simulation always uses each account's individual allocation, never the blended figure.

---

## Withdrawal Waterfall

Each year, withdrawals follow a fixed sequence. Two strategies are available, auto-selected per scenario by `selectBestSpendingOrder` (runs two deterministic projections, picks the higher real terminal balance). No user knob.

### `'brokerage_first'` (default when no Roth conversions are scheduled)

1. **Cash** — drains first when a cash account exists (tax-free principal pulls; cash interest already credited as ordinary income separately during growth). When no cash account exists, this step is a no-op.
2. **Traditional, up to the RMD** — the year's RMD is forced from Traditional regardless of spending need, so its gross is applied to spending+tax first. (When age < 73, RMD is $0 and this step is skipped.)
3. **Brokerage** — fills any remaining spending+tax need above the RMD (lowest tax cost on the residual)
4. **Traditional, above the RMD** — fills any need still unmet
5. **Roth** — drawn last to preserve tax-advantaged growth

RMD-first ordering avoids over-pulling from Brokerage in high-RMD years: when the RMD's net-of-tax proceeds already cover the year's spending, `withdrawalFromBrokerage` stays at 0 and no federal/state LTCG or NIIT is generated. Excess RMD (the portion not consumed by spending+tax) reinvests into the first Brokerage account.

Cash priority 0 has the same intent generalized: when cash covers (some of) spending, downstream LTCG/NIIT on Brokerage pulls is avoided.

### `'bracket_aware'` (default when any Roth conversion event is scheduled)

Inserts a **Traditional-up-to-12%-bracket-headroom** step before Brokerage, so spending pulls from Traditional cheaply in low-bracket years instead of burning Brokerage at LTCG rates. Order becomes:

1. **Cash** — same as above; cash drains before any brokerage source.
2. **Traditional, up to the RMD** (as above)
3. **Traditional, up to bracket headroom** — the additional Traditional spending pull is capped so that conversion + this Trad pull + SS-taxable portion together stay within the top of the 12% federal bracket. Headroom is precomputed per year as `max(0, top_of_12% − max(0, (otherTaxableGross + conversionGross + ssTaxable) − stdDed))`, and the full mandatory RMD is subtracted from it at the per-year level. Conv- and SS-inclusive means a Trad pull within headroom is guaranteed to keep the year inside the 12% bracket.
4. **Brokerage** — spending overflow
5. **Traditional, above headroom**
6. **Roth** — last resort

**The waterfall choice only changes the spending source — it does NOT change conversion size or conversion-tax sourcing.** Conversion tax still follows the hybrid sourcing rule (RMD-excess → Brokerage → withhold). The point of `bracket_aware` is to **preserve Brokerage for the high-`mt` conversion years** by paying for low-bracket-year spending from Traditional cheaply. See CLAUDE.md "Spending source policy" for the rationale, blind spots, and tradeoffs.

The waterfall is fully auto-selected at sim start by `selectBestSpendingOrder`. Two deterministic projections (one per candidate policy) run via `runDeterministicProjection` with an internal `_forceSpendingOrder` option to pin each policy; the higher real terminal balance wins, tiebreaker `brokerage_first` within `max(100, |score| × 5e-4)` tolerance to absorb noise on operationally-equivalent scenarios (e.g., the LTCG-cascade refeed under bracket_aware on a zero-spending scenario). The resolved order is cached in `Precomputes.spendingOrder` so the MC inner loop never re-selects. The UI does not expose an override; the `UserData.spendingWithdrawalOrder` field was removed entirely. A test-only `_forceSpendingOrder` hook on `runSimulation`-adjacent entry points (`runDeterministicProjection`, `buildPrecomputes`, `calculateAnnualCashFlow`, and `computeAutoBracketSchedule`'s `pinnedSpendingOrder` third arg) lets unit tests isolate a specific policy without exposing it as user data.

### Spending Shortfall

When the portfolio cannot cover the full spending + tax need, the year is recorded with a `spendingShortfall` value showing exactly how many dollars went unmet. The simulation continues — balance is floored at $0 and subsequent years draw from any remaining income (Social Security, pension, etc.). The success-probability metric counts any year where the balance hits $0 as a failed run, regardless of how large the income floor is.

### Cost-of-Living Adjustment (COLA)

COLA is a **binary per-event toggle**, not a per-event rate:

- **`fixed`** — the entered amount is paid every year unchanged (frozen in nominal dollars).
- **`inflation_adjusted`** — the amount grows at the **scenario inflation rate**, compounded from **today (the reference year)**, *not* from the event's start year. Because all inputs are entered in today's dollars, an inflation-adjusted amount has already been inflated to the start year by the time the event begins: the factor is `(1 + inflationRate)^(year − referenceYear)`. So an inflation-adjusted pension entered as $40k starting at age 67 pays *more* than $40k nominal in its first year — $40k of today's purchasing power, inflated forward to that future year.

All inflation-adjusted events share the single scenario `inflationRate`; there is no per-event COLA rate.

**Exception — Social Security with a future-dollar basis.** A `social_security` event whose `ssAmountBasis === 'future'` compounds from its **claim (start) year** instead of the reference year, so the entered figure is the first-year payment. This matches how an SSA statement quotes a future-dollar benefit at a chosen claiming age. (See the Social Security section.)

---

## Tax Model

### Federal Income Tax

YARP uses **statically defined 2024, 2025, and 2026 tax brackets**. For any year beyond 2026, the 2026 bracket thresholds, standard deduction, and senior additional deduction are **inflation-indexed forward** using the scenario's configured inflation rate: each dollar-denominated threshold is multiplied by `(1 + inflationRate)^(year − 2026)`. Tax *rates* are never scaled — only the dollar limits. This matches how the IRS adjusts brackets annually via Chained CPI-U (the model uses headline CPI as an approximation; the real adjustment runs about 0.2–0.3 pp lower).

Four filing statuses are supported: **single**, **married filing jointly (MFJ)**, **married filing separately (MFS)**, and **head of household (HOH)**. Bracket cutoffs and the standard deduction differ for each.

### Income Categories

Tax is computed on two parallel income streams:

```
ordinaryIncome = Traditional withdrawals
               + taxable Social Security portion
               + before-tax income events
               + Roth conversions
capitalGains   = Brokerage account withdrawals (taxed at flat LTCG rate)
```

Federal LTCG has two modes, selected per scenario under Settings → Tax & IRS:

- **Flat rate (default)** — `longTermCapGainsRate × fromBrokerage`, a single configurable rate (default 15%). If you expect to fall in the 0% LTCG bracket some years, set the rate lower; if you expect the 20% bracket, set it higher.
- **0/15/20% bracket stacking** (`useStackedLtcgBrackets: true`) — gains stack on top of your ordinary taxable income: the portion below the 0% ceiling is untaxed, the portion up to the 15% ceiling is taxed 15%, and anything above is 20%. Breakpoints are per-filing-status, inflation-indexed forward from 2026 (`getLtcgBreakpoints`). The flat rate is ignored in this mode. State LTCG is unaffected either way (it always uses the per-state profile).

Each income event carries a `taxStatus` flag: **`before_tax`** events (pension, part-time work, rental income, etc.) flow into `ordinaryIncome`. **`after_tax`** events (inheritance, gifts, tax-free settlements) bypass the tax engine entirely and contribute directly to spendable cash.

### Social Security Taxation

YARP implements the IRS provisional income worksheet. **Provisional income** is:

```
provisional = AGI (excluding SS) + tax-exempt interest + 0.5 · SS_gross
```

In YARP, **AGI (excluding SS)** is `otherTaxableGross + Traditional withdrawals + brokerage withdrawals (capital gains)`. Capital gains are part of AGI, so a brokerage-funded retirement raises provisional income and makes SS taxable just as a Traditional withdrawal would — even though the gains themselves are taxed at LTCG rates, not as ordinary income. (This matches the IRMAA/NIIT MAGI proxy, which also counts brokerage withdrawals.) Roth withdrawals are *not* in AGI and so never raise provisional income.

The taxable portion of Social Security is then determined by two thresholds (frozen by Congress since 1983/1993, never inflation-adjusted):

| Filing Status | Threshold 1 | Threshold 2 |
|---|---|---|
| Single / HOH | $25,000 | $34,000 |
| Married Filing Jointly | $32,000 | $44,000 |

- Below threshold 1: **0%** of SS is taxable
- Between thresholds: up to **50%** is taxable
- Above threshold 2: up to **85%** is taxable (with a phase-in formula, not a hard cliff)

Because thresholds are frozen in nominal terms, the share of retirees with taxable SS rises over time — this is real, not a modeling artifact.

### State Taxes

State tax is computed from a **per-state profile** registry (`src/data/stateTaxProfiles.ts`) rather than a single flat rate. Each profile encodes:

- **Tax type & brackets** — `none` (FL, TX, etc.), `flat` (PA, IL, MA, etc.), `graduated` (CA, NY, NJ, OR, MN, HI, MD, DC, …), or `capital-gains-only` (WA). Per-filing-status (single / MFJ) bracket schedules are walked above the state standard deduction. HoH / MFS approximate to single.
- **State standard deduction** — applied to the state ordinary base before brackets are walked. Inflation-indexed forward from the profile's base year when `bracketsInflationIndexed` is true. NY and NJ brackets are statutorily fixed in nominal dollars — neither indexes.
- **SS taxability rule** — `exempt` (most states, incl. KS since 2024 per SB 1), `taxed` (CT, MN, MT, RI, VT, WV-through-2025), `exempt_if_age` (CO 65+), or `agi_phaseout` (NM, UT, VT, RI) with per-filing-status AGI thresholds.
- **Retirement-income exclusion** — applied to Traditional withdrawals: `none`, `full` (IL, PA, MS, IA, MI-67+, HI), `amount` (NY $20k/59.5+, GA $65k/65+, DE $12.5k/60+, MD $36.2k/65+, KY $31k, …), or `agi_phaseout` (NJ — pension exclusion to $75k/$100k below $150k AGI, hard cliff above).
- **LTCG rule** — `ordinary` (most states; LTCG stacked on top of state ordinary brackets), `exempt` (Missouri), or `threshold` (Washington 7% above an inflation-indexed $270k single / $270k MFJ threshold; WA has no ordinary state tax).
- **Locality surcharge** — currently only New York City (pseudo-state `"New York City"`): ~3.876% applied to the state ordinary base on top of NY state brackets.
- **Successor profiles** — `effectiveYears.end` + `successorProfileKey` chain a profile to a different one once a year boundary is crossed. South Carolina sunsets its 6% top rate after 2026 (successor 5.2%); West Virginia's SS taxation ends with tax year 2025 (HB 4880 — 100% exempt from 2026 via a 2026+ successor profile; the 2024/25 partial 35%/65% exemptions are approximated as fully taxed).

Multiple states across the user's lifespan are supported via the **relocation timeline**: each entry resolves to a profile for that year, switching at the configured move year.

Approximations explicitly accepted:

- **Bracket fidelity** — high-income states (CA, NY, NJ, OR, MN, HI, MD, NM, CT, DE, AR, ND, OH, RI, MO, ME, WI, MT, NE, VT, DC) carry real graduated schedules. States with statutory brackets I haven't encoded yet (some of AL/GA/KS/etc.) are modeled as flat at top rate above the state standard deduction — better than the prior flat-on-gross, but still understates progressivity. Schema is bracket-ready, so this is incremental data work.
- **Partial exclusions** — "partial" SS / retirement exclusions are modeled per-state with structured rules (AGI thresholds, age gates, dollar caps). The exclusion applies to Traditional withdrawals as a lump sum and does not distinguish public vs private pensions or source-specific sub-rules within a state.
- **Filing status** — HoH / MFS share the `single` bracket and deduction at the state level. Most state HoH schedules differ only slightly from single; MFS rules vary too widely to model uniformly.
- **Not modeled** — MA 4% surtax above $1M, OH/PA local municipal income tax, Yonkers surcharge, multistate part-year residency within a single year (timeline switches are whole-year), tax credits (Oregon senior credit, Utah SS credit), alternative minimum tax, and *state*-level capital-gains 0/15/20% bracket stacking (each state's LTCG follows its profile's `ltcgRule`). Note: *federal* LTCG bracket stacking **is** modeled — opt in per scenario via `useStackedLtcgBrackets` (see Capital Gains above).

The state tax flows are exposed in `AnnualCashFlowBreakdown.audit` as: `stateOrdinaryTax`, `stateLocalitySurcharge` (top-level), `stateOrdinaryBaseGross`, `stateStdDeduction`, `stateRetirementExclusionApplied`, `stateSsIncludedInState`, `stateMarginalRate`, `stateBracketIndex`, `stateLtcgTaxableAtState`, `stateLtcgThresholdApplied`, and `stateNotes`. The Tax Audit detail tab renders each of these as a labeled row under a per-year "State tax — {name}" section.

**`disableStateRetirementExclusion`** (optional `UserData` field) — set to `true` to disable the profile's retirement-income exclusion (Traditional withdrawals fully exposed to state ordinary brackets). Defaults to `undefined` = use the profile's rule. The Scenario dialog exposes this as an "Disable state retirement-income exclusion (advanced)" checkbox under the state dropdown when the active state has a non-`none` exclusion rule.

**NYC locality base.** NYC (`localitySurcharge: { rate: 0.03876, appliesToOrdinaryOnly: false }`) applies the surcharge to the *combined* ordinary + LTCG base, since NYC taxes capital gains as ordinary income. Other potential localities would set `appliesToOrdinaryOnly: true` to limit the surcharge to ordinary income.

**WA LTCG threshold indexing.** The Washington capital-gains threshold inflates independently of the bracket-indexing flag, since WA has no ordinary brackets and the threshold is statutorily CPI-indexed annually. Anchor: $270k (the 2024 indexed value of the $250k/2021 statutory base); indexes forward via the scenario's `inflationRate` from 2024. Spouses filing jointly share **one** combined deduction (RCW 82.87.060) — the MFJ threshold equals the single one.

**Marginal-stack attribution.** The Tax Audit per-event marginal-tax breakdown distributes the year's actual state ordinary tax + locality surcharge proportionally to each event's federal taxable contribution. This conserves the year total (sum of `marginalTax` ≈ federal ordinary tax + state ordinary tax + locality), but individual event rows are an approximation when the state's rules diverge from the federal stack (e.g., SS exempted at the state level, retirement exclusion applied). The federal portion of each event row remains exact via the bracket walk.

### Medicare IRMAA Surcharges

Starting at age 65, Medicare Part B and Part D premiums include an **IRMAA** (Income-Related Monthly Adjustment Amount) surcharge for beneficiaries whose modified AGI exceeds tiered thresholds. The model uses the 2024 official tier table, inflation-indexed forward by `inflationRate`, and applies the IRS **2-year lookback** (year N's surcharge depends on year N-2's MAGI). Surcharge is per Medicare-enrolled person — so a married couple where both spouses are 65+ pays the surcharge twice.

**MFS** (married filing separately, lived with spouse) uses its own statutory 3-row table rather than the graduated 6-tier one: no surcharge at or below $103k, the second-highest surcharge level above that, and the top level at $397k **or above** (2024 figures, indexed forward). Note the boundary asymmetry — the single/MFJ rows are "$X or less" (inclusive), but the MFS middle row is "less than $397,000", so exactly $397k lands in the top tier. Set `enableIRMAA: false` to disable.

**`respectIrmaaNiitCliffs`** (optional `UserData` field, default ON — `undefined` and `true` are both enabled; only explicit `false` opts out) — the Roth Conversion wizard's generated conversions are capped per year so MAGI stays under the **next IRMAA tier ceiling** — applied only when a Medicare enrollee exists in year+2, matching the 2-year lookback. It is conservative (only ever lowers a conversion) and affects generated schedules only, not manually entered conversions or the bracket-aware spending pull. With the cap OFF, the optimizer instead *arbitrates* tier crossings: it probes conversion amounts that fill MAGI exactly to each tier ceiling and lets the projection's priced surcharge decide whether crossing pays. NIIT is **not** part of the cap (it's a marginal 3.8% tax, not a cliff — see below; the field name keeps "Niit" for data compatibility only). Exposed in the Roth Conversion wizard as "Avoid IRMAA tier jumps".

### Net Investment Income Tax (NIIT)

A flat **3.8%** tax applied to the lesser of (a) net investment income or (b) MAGI above the threshold. Thresholds are statutory (NOT indexed for inflation): $200k for single/HoH, $250k for MFJ, $125k for MFS. Investment income is proxied by the brokerage-account withdrawal (same proxy as federal LTCG). Set `enableNIIT: false` to disable.

### Deductions

- **Standard deduction** — filing-status base, plus an age-65+ add-on (~$1,950–$2,050 per qualifying senior, indexed by year). Both members of a married couple can independently qualify.
- **OBBBA bonus senior deduction** — applied automatically when active. Hardcoded mechanics (not user-configurable):
  - $6,000 base per qualifying senior (age 65+)
  - 6% phase-out above $75,000 AGI (single) / $150,000 AGI (joint)
  - Active **2025–2028 only** — does not apply in later retirement years

### Tax Audit Fields

Every `AnnualCashFlowBreakdown` carries an `audit` sub-object capturing the intermediate values that the tax model computes and would otherwise discard. These power the **Tax Audit** and **Income Detail** tabs in the yearly data view, and ship as extra columns in the CSV export. Each representative path (median, projected) has its own audit data driven by that path's actual flows.

- **Ordinary income tax** — `agi` (= otherTaxableGross + Traditional withdrawal + SS taxable portion), `standardDeduction`, `seniorAddOn`, `obbbReduction`, `totalDeductions`, `taxableIncome`, `federalBracketIndex` (0=10% rate through 6=37% rate), `federalMarginalRate`, `federalOrdinaryTax`, `stateOrdinaryTax`, and `federalBrackets[]` (per-bracket dollars-in-bracket and tax-in-bracket for the year's inflation-indexed thresholds).
- **Social Security taxability** — `ssProvisionalIncome` (= otherTaxableGross + Traditional withdrawal + brokerage withdrawal/capital gains + ½ × ssGross), the frozen IRS `ssProvisionalThreshold1`/`Threshold2`, and the `ssZone` hit (`none` / `50%` / `85%` / `mfs-flat`).
- **IRMAA** — `irmaaLookbackMagi` (2-year-prior MAGI used for this year's surcharge), `irmaaTierIndex` (0..5 in the inflation-indexed tier table), `irmaaTierUpperScaled` (inflation-indexed upper bound of the hit tier), `irmaaMonthlySurcharge` and `irmaaPerEnrolleeAnnual` (Part B + Part D), `irmaaEnrolleeCount` (count of Medicare-enrolled spouses age 65+).
- **NIIT** — `niitMagi`, `niitThreshold` (frozen, not inflation-indexed), `niitMagiExcess`, `niitInvestmentIncome` (= gross brokerage-account withdrawal), `niitTaxableBase` (= min of the two, × 3.8% = niitTax).
- **RMD per owner** — `rmdDivisorSelf` / `rmdDivisorSpouse` (IRS Uniform Lifetime Table divisor for the owner's age, 0 when no RMD), `rmdBoyBalanceSelf` / `rmdBoyBalanceSpouse` (beginning-of-year Traditional balance per owner, from before this year's growth). The per-owner RMD **amounts** are not audit fields — they sit on the breakdown itself as `rmdRequiredSelf` / `rmdRequiredSpouse` (sum = `rmdRequired`), because the engine's per-owner sourcing reads them in every run, audited or not.
- **State** — `effectiveStateName`: which `stateTimeline` entry's flat rate applied this year.

The Tax Audit tab's **Tax Rates** section derives its effective rates from these fields: the denominator is `totalGrossIncome + portfolioWithdrawal − rothConversionGross` (cash actually flowing into the household — converted dollars aren't spendable), and the headline effective rate excludes IRMAA from the numerator (it's a Medicare premium, not an income tax); an "incl. IRMAA" all-in variant appears separately when a surcharge exists. The marginal rows are the statutory bracket rates per jurisdiction — they are deliberately not summed into a combined figure, because the two rates apply to different bases (state exclusions/deductions can absorb the next dollar) and neither reflects the SS-taxability phase-in, so a sum would misstate the true next-dollar rate.

#### Per-event ordinary tax attribution (marginal stack)

`audit.incomeEventTaxBreakdown` is an array of per-event marginal-tax records. Events are walked in IRS stacking order:

1. Wages (each `wage_income` event)
2. Other ordinary before-tax events (pension, rental, annuity, sale, work-during-retirement, other-income)
3. Pre-tax retirement contributions (negative, with cumulative ordinary gross floored at zero)
4. Traditional withdrawal for spending need (synthetic source `traditional_withdrawal`, gross = `withdrawalFromTraditional − rothConversionGross`)
5. Roth conversion event(s)
6. Social Security (aggregated; if multiple SS events, the marginal tax is split proportionally by gross)

Each entry's `marginalTax` is the incremental federal+state ordinary-tax delta when its `taxableContribution` is added on top of the prior cumulative gross. Marginal rates sum to `ordinaryTax` modulo floor-at-zero rounding (any drift is surfaced as a reconciliation row in the UI). Capital-gains tax, NIIT, and IRMAA are not attributed to specific events — they sit in the Tax Audit tab as separate sections.

#### Per-account flows

`audit.accountFlows` is one row per account that had any movement this year:

- `withdrawal` — dollars taken out of this account (pro-rata across each tax-type group: Brokerage → Traditional → Roth waterfall).
- `deposit` — dollars added (Roth conversion arrival, RMD excess reinvestment, retirement contribution, surplus contribution).

A single account can have both in the same year (e.g., a Brokerage account that paid for spending then received the surplus reinvestment). Growth (return-driven balance change) is not represented here — it's part of the path itself, shown on the Summary tab.

#### Per-goal spending attribution

`audit.spendingGoalBreakdown` is the spending-side sibling of `incomeEventTaxBreakdown`: one `{ goalId, goalName, goalType, amountNet }` row per spending goal active in the year (living-expenses goals included), where `amountNet` is the post-inflation, post-decay amount the goal contributed. Invariants: rows with `goalType === 'living_expenses'` sum to `baseSpendingNet`; the rest sum to `otherSpendingGoalsNet`. Built once per year in the precompute phase (`accumulateSpending`), so it adds no Monte Carlo hot-loop cost. Consumed by the secondary **Expenses** chart and the Sankey's per-goal sink nodes.

#### Cash Flow Sankey (per-year flow diagram)

The **Cash Flow** tab in the yearly data detail row renders a five-column Sankey of each year's flows. The model is built in `src/components/Chart/sankeyLayout.ts` from the `AnnualCashFlowBreakdown` (plus a couple of `audit` fields to split the ordinary-tax lump and to source per-event / per-account detail). The middle is structured by tax treatment so the categorization story is legible: Detailed Sources → Aggregated Sources → Tax Buckets → After-Tax Cash → Uses.

**Column 0 — Detailed Sources** (per-event / per-account upstream of aggregators, emitted only when source data is available):

| Detail node | Source data | Feeds aggregator |
|---|---|---|
| Each `wage_income` / `pension_income` / `rental_income` / `annuity_income` / `inheritance` / `sale_of_property` / `work_during_retirement` / `other_income` event (before-tax) | `audit.incomeEventTaxBreakdown` filtered by `eventType` against the `IncomeEventType` union (typed at compile time; synthetic `traditional_withdrawal` excluded) and `gross > 0` | "Wage & Other Income" |
| Each Social Security event | `classification === 'social_security' && gross > 0`. Each event emits two outgoing edges: `taxable_part = gross × (ssTaxableAmount / ssGross)` into "Social Security (Taxable)", `tax_free_part = gross − taxable_part` into "Social Security (Tax-Free)". | Both SS aggregators |
| Each Roth conversion event | `classification === 'roth_conversion' && gross > 0` | "Roth Conversion (gross)" |
| Each brokerage / cash / Roth account withdrawal | `audit.accountFlows` filtered by `accountType` and `withdrawal > 0` | "Brokerage Withdrawal" / "Cash Withdrawal" / "Roth Withdrawal" |
| Each Traditional account contributing RMD | `audit.rmdByAccount` filtered by `withdrawal > 0` (engine populates this with per-owner-aware shares: Self's RMD pulls pro-rata from Self-owned Trad only; Spouse's from Spouse-owned Trad only) | "RMD" |
| Each Roth account receiving conversion deposit | `audit.rothConvDepositByAccount` filtered by `deposit > 0` (engine populates per-owner-aware shares: Self's conversion deposits to Self-owned Roth only; Spouse's to Spouse-owned Roth only) | (downstream — fed by `dst_rothdep`, not by an aggregator on the source side) |

Detail nodes use `IncomeEventTaxAttribution.eventName` or `AccountFlowRow.accountName` as their display label, and are id'd as `detail_<eventId>`, `detail_acct_<accountId>`, or `detail_rmd_acct_<accountId>` (distinct prefix for RMD-source detail avoids collision with brokerage/cash/Roth withdrawal detail in the same year). d3-sankey deduplicates by id.

**Sources without column-0 detail** (single node at the aggregator depth):

- Traditional Withdrawal (the discretionary spending pull — synthetic, not event-driven).
- Cash Interest (deterministic yield, not an event).
- Employer Match (single aggregate — deposit detail is on the use side).
- After-Tax Income (aggregate of `afterTaxIncome` field).

**Synthetic residual.** If the sum of detail edges into an aggregator is less than the aggregator's expected total (rounding, classification mismatch), a small "Other ordinary" / "Other brokerage" / etc. residual detail node bridges the gap. The zero-edge filter hides it when the residual is near zero.

**Column 1 — Aggregated Sources** (each appears only if non-zero):

| Source | Field | Routes to bucket |
|---|---|---|
| Social Security (Taxable) | `ssTaxableAmount` | Ordinary Income |
| Social Security (Tax-Free) | `ssGross − ssTaxableAmount` | Tax-Exempt |
| Wage & Other Income | `otherTaxableGross + preTaxContributions − cashInterest` | Ordinary Income |
| After-Tax Income | `afterTaxIncome` | Tax-Exempt |
| Cash Interest | `cashInterest` | Ordinary Income |
| Employer Match | `employerMatch` | Tax-Exempt |
| RMD | `rmdRequired` | Ordinary Income |
| Traditional Withdrawal | `withdrawalFromTraditional − rmdRequired − rothConversionGross` | Ordinary Income |
| Roth Conversion (gross) | `rothConversionGross` | Ordinary Income |
| Brokerage Withdrawal | `withdrawalFromBrokerage` | Capital Gains |
| Cash Withdrawal | `withdrawalFromCash` | Tax-Exempt |
| Roth Withdrawal | `withdrawalFromRoth` | Tax-Exempt |

**Column 2 — Tax buckets** aggregate inflows by treatment: **Ordinary Income**, **Capital Gains**, **Tax-Exempt**. Each appears only if at least one source feeds it.

**Column 3 — After-Tax Cash** is a single pool. It receives the post-tax residual from each bucket and fans out to non-tax uses.

**Column 4 — Uses** (each appears only if non-zero):

| Use | Field | Pulls from |
|---|---|---|
| Federal Ordinary Tax | `audit.federalOrdinaryTax` (fallback `ordinaryTax − stateOrdinaryTax − stateLocalitySurcharge`) | Ordinary Income |
| State Ordinary Tax | `audit.stateOrdinaryTax + stateLocalitySurcharge` | Ordinary Income |
| IRMAA | `irmaaSurcharge` | Ordinary Income *(MAGI-driven)* |
| Roth Deposit (conversion) | `rothConversionGross − rothConversionTaxWithheld` | **Ordinary Income** *(conv pass-through chain visible)* |
| Federal LTCG Tax | `federalCapGainsTax` | Capital Gains |
| State LTCG Tax | `stateCapGainsTax` | Capital Gains |
| NIIT | `niitTax` | Capital Gains |
| Living Expenses | `baseSpendingNet × spendScale` *(see shortfall handling below)* | After-Tax Cash |
| Per-goal sinks (`dst_goal_<goalId>`, labeled with the goal's name) | `audit.spendingGoalBreakdown` non-living rows, each `amountNet × spendScale` | After-Tax Cash |
| Other Spending Goals (`dst_goals` — fallback only) | `otherSpendingGoalsNet × spendScale`, emitted when `spendingGoalBreakdown` is absent or its non-living sum diverges from the aggregate by more than $1 | After-Tax Cash |
| Pre-Tax → Traditional | `preTaxContributions` | After-Tax Cash |
| Roth Contribution | `rothContributions` | After-Tax Cash |
| After-Tax → Brokerage | `afterTaxContributions` | After-Tax Cash |
| Employer Match Deposit | `employerMatch` | After-Tax Cash |
| RMD Excess → Brokerage | `rmdExcess` | After-Tax Cash |
| Surplus → Brokerage | `surplusContribution` | After-Tax Cash |
| Cash Interest → Cash | `cashInterest` | **Ordinary Income** *(see cash-interest note below)* |

**Cash interest is a pass-through, not a fresh inflow.** The engine credits the
year's cash yield *into* the cash balance (`balances[id] += interest`), so it is
already contained in `withdrawalFromCash`; the engine then subtracts it back out of
spendable cash (`availableCash = … − cashInterest`). The Sankey mirrors this exactly:
`cashInterest` enters the Ordinary Income bucket as a source (so it drives the
ordinary-tax base) and an equal **Cash Interest → Cash** use pulls it straight back
out of that bucket. The pair nets to zero in the flow totals, so the interest
contributes its tax (funded from the bucket residual) but no phantom spendable
dollars — the actual cash delivery stays with `withdrawalFromCash`. Omitting this
balancing use double-counts the interest and produces a spurious global drift equal
to `cashInterest` (worst-bucket / worst-aggregator drift stay $0 because only the
un-audited After-Tax Cash node is off).

**Off-axis transfers** (rendered as a row below the diagram, not passing through any bucket):
- Cash refill ← `cashRefillFromSurplus` (Brokerage → Cash)
- Cash sweep ← `cashSweepToBrokerage` (Cash → Brokerage)

**Bucket residual flows** (the load-bearing conservation invariants):

Each bucket emits one residual link into After-Tax Cash equal to its inflow minus its direct (non-residual) outflows:

- `OrdinaryIncome → AfterTaxCash` = OI_in − (federalOrdinaryTax + stateOrdinaryTax + stateLocalitySurcharge + irmaaSurcharge + (rothConversionGross − rothConversionTaxWithheld) + cashInterest)
- `CapitalGains → AfterTaxCash` = CG_in − (federalCapGainsTax + stateCapGainsTax + niitTax)
- `TaxExempt → AfterTaxCash` = TE_in (no taxes; full passthrough)

Conservation is enforced at five levels, each within $1:

1. **Global**: Σ source amounts = Σ use amounts.
2. **Per bucket**: bucket inflow = bucket outflow (taxes + residual).
3. **After-Tax Cash**: Σ residuals_in = Σ uses_from_ATC.
4. **Per aggregator** (those with column-0 detail children): Σ detail edges = aggregator outflow to its bucket. The synthetic residual mechanic guarantees this stays within $1 even when event-sum vs. aggregator amount diverges due to rounding.
5. **Off-axis transfers**: refill and sweep are pure balance-sheet moves with their own pair (source → destination) that always sums to zero on net.

The component's dev-mode warning fires if the global drift OR the worst per-bucket drift OR the worst per-aggregator drift exceeds $1 — engine regressions show up immediately.

**Shortfall handling.** When `spendingShortfall > 0` (portfolio depleted), `spendScale = (totalSpendingNet − spendingShortfall) / totalSpendingNet` is applied to both spending nodes. The spending edges shrink to the funded amount, a red banner reports the unmet portion, and all conservation invariants still hold against the funded picture.

#### Performance & invariants

Audit data is computed only for the breakdowns the UI actually renders: the representative **Median** run (recomputed via `replayRunWithAudit`) and the deterministic **Projected** projection. The ~5000 stat-only Monte Carlo runs execute with `includeAudit=false` (`runShard` → `simulateOneRun(..., false)`), which skips the per-breakdown audit work — the dominant performance win, since the audit cost is roughly one `calculateNetFromGrossDetailed` call plus ~5–10 extra `calculateNetFromGross` calls for the marginal stack. Replaying just the representative run afterward keeps that cost to ~2 extra runs total. Don't move the deterministic projection off the audited path: both the chart's Yearly Data table and the CSV export depend on `audit` being present on every breakdown of whichever path they render (Projected, or Median in the historical rolling/bootstrap modes that have no deterministic baseline).

`audit.accountFlows` is the one exception: it's populated by `applyCashFlow` (not by the core cash-flow calc) because it depends on the actual pro-rata distribution over current account balances, which is only known after the withdrawal sinks run. Callers of `calculateAnnualCashFlow` (the public wrapper) that don't subsequently invoke `applyCashFlow` will see `accountFlows` as `undefined`; tests that need it should drive `runSimulation()` instead.

Synthetic stack-step IDs `SYNTHETIC_TRAD_WITHDRAWAL_ID` and `SYNTHETIC_SS_AGGREGATE_ID` are exported from `SimulationService.ts` so UI / tests can match against them without duplicating the literal `__trad_withdrawal__` / `__ss_aggregate__` strings.

---

## Secondary Charts (flow views)

The **Charts** panel below the main chart renders four views of the same primary path the yearly table follows (Projected, or Median in historical rolling/bootstrap modes). Builders live in `src/components/Chart/secondaryChartData.ts`; every monetary series passes through the same `toDisplay` deflation as the table, so the Today's-$/Future-$ toggle applies uniformly.

**Per-type beginning-of-year balances.** Four flat fields on `AnnualCashFlowBreakdown` — `boyBalanceTraditional`, `boyBalanceRoth`, `boyBalanceBrokerage`, `boyBalanceCash` — capture each account type's **nominal, pre-growth (beginning-of-year)** balance at the exact instant the path point is recorded, so their sum equals `path[i] × inflation[i]` in every year and the Balances view's stacked total overlays the main chart line exactly. They're assigned by `simulateOneRun` (the core initializes them to 0, so the public single-year `calculateAnnualCashFlow` wrapper reports zeros). Being flat (not audit-gated) makes them assertable from scenario `breakdownChecks` — see `test/scenarios/boy-balance-by-type.json`.

**Income view decomposition.** `ssGross`; "Other income" = `max(0, otherTaxableGross + preTaxContributions − cashInterest) + afterTaxIncome` — pre-tax deferrals are added back so working years show the full wage gross (the deferral appears as a Retirement-contributions expense instead), with per-event itemization in the hover tooltip via `audit.incomeEventTaxBreakdown`; `rmdRequired`; "Additional 401(k)/IRA" = `max(0, withdrawalFromTraditional − rmdRequired − rothConversionGross)`; the Brokerage/Roth/Cash withdrawal fields. **Cash interest is deliberately not a series** — the engine credits it into the cash balance (it's inside `withdrawalFromCash` when withdrawn), so rendering it as income would double-count spendable dollars. The optional hatched conversion segment is the flat `rothConversionGross` — not the per-event attributions, whose conversion rows are per-owner-cap-scaled approximations.

**Expenses view decomposition.** `baseSpendingNet` (living expenses); one series per non-living row of `audit.spendingGoalBreakdown` — colors assign by the scenario's goal-list order (stable under start-age/horizon edits; the cycle wraps past its length, never folds); a "Goals" aggregate series appears only for audit-less breakdowns (defensive fallback); "Retirement contributions" = `preTaxContributions + rothContributions + afterTaxContributions` (employer match is in NEITHER view — it moves account-to-account without touching spendable cash); `totalTax` as one segment (the Taxes view has the split). **Depleted years:** living + per-goal segments scale by the same funded fraction the Sankey uses (`(totalSpendingNet − spendingShortfall) / totalSpendingNet`; taxes unscaled) and the unmet remainder renders as a hatched "Unfunded shortfall" segment — the stack still totals requested spending + taxes while agreeing with the Income view's actual withdrawals.

**Taxes view decomposition.** `audit.federalOrdinaryTax` + (`audit.stateOrdinaryTax` + `stateLocalitySurcharge`) + (`federalCapGainsTax` + `stateCapGainsTax`) + `niitTax` + `irmaaSurcharge` — additive to `totalTax` (the flat `ordinaryTax` field already contains state + locality and is deliberately not used). The federal marginal bracket (`audit.federalMarginalRate`) renders as a separate slim step strip sharing the x-axis — dollars and percent never share a y-axis.

---

## Required Minimum Distributions

Traditional accounts trigger **RMDs at a birth-year-dependent start age** (SECURE 2.0): **born ≤ 1950 → 72, 1951–1959 → 73, 1960 or later → 75**. The start age is derived per owner from `referenceYear − currentAge` (and `referenceYear − spouseAge`) via `getRmdStartAge`, so a retiree born in 1960+ correctly defers RMDs to 75 — two extra low-bracket conversion years. (The pre-2020 70½ rule is not modeled — it affects only those born ≤ 1949.) Each year:

1. RMD is calculated on the **beginning-of-year (pre-growth) balance** using the IRS Uniform Lifetime Table — matching the IRS Dec 31 prior-year rule.
2. The simulation forces `withdrawalFromTraditional ≥ rmdRequired`.
3. **Per-owner split:** if an account has `owner: 'spouse'` set, RMD uses the spouse's age. Self and spouse RMDs are computed independently and summed. **Distribution honors ownership** (IRS rule): `applyCashFlow` pulls `rmdRequiredSelf` pro-rata from Self-owned Traditional accounts only and `rmdRequiredSpouse` pro-rata from Spouse-owned only — a Spouse's IRA cannot satisfy Self's RMD. Per-account RMD shares are surfaced in `audit.rmdByAccount` (sum equals `rmdRequired` within $1) and consumed by the Cash Flow Sankey's column-0 detail. The non-RMD remainder of the Traditional withdrawal (discretionary spending pull + Roth conversion gross) pulls pro-rata across all Traditional accounts (no household-level IRS constraint).
4. **Excess RMD** beyond the spending need is reinvested into the first brokerage account. If none exists, a `"Reinvestment"` brokerage account is auto-created in the working simulation copy (not persisted). The same synthetic account also receives general surplus (see Surplus Handling below).
5. RMD is **not eligible** for Roth conversion (IRS rule). Roth accounts are exempt from RMD.

---

## Wage Income and Retirement Contributions

`wage_income` events are taxable ordinary income (always `before_tax`). They flow into `otherTaxableGross` exactly like a pension or part-time work event.

`retirement_contribution` events are **deposit instructions, not income**. They never add to spendable cash. Each event carries a `contributionType`:

- **`pre_tax`** — the contribution amount is subtracted from `otherTaxableGross` before the tax calc, then deposited to the target Traditional account. The deduction is floored at zero (you can't reduce taxable income below zero).
- **`roth`** — no tax effect; deposited to the target Roth account.
- **`after_tax`** — no tax effect; deposited to the target Brokerage account.

If the event's `accountId` doesn't match the contribution type (or is omitted), the simulation falls back to the first account of the implied type, then to the first account of any type.

**Employer match** is configured per contribution event with `employerMatchPercent` and `employerMatchCeilingPercent`. The match base is either the linked `wageEventId`'s annual amount (when set) or the contribution amount itself. The match is `matchRate × min(employeeContribution, ceilingRate × matchBase)`. Match dollars are deposited to the **same target account** as the employee contribution — a documented simplification (in reality, employer match for a Roth 401(k) historically went to the pre-tax bucket; SECURE 2.0 allows it Roth, but the model keeps things simple).

### Contribution Limits

Per-scenario IRS limits are configured under Tax & IRS → Contribution Limits:

- `elective401k` — 401(k)/403(b)/TSP elective deferral cap (default $24,500)
- `iraLimit` — IRA cap (default $7,500)
- `catchUpAge` — age at which catch-up kicks in (default 50)
- `catchUp401k`, `catchUpIra` — extra contribution allowed at/after `catchUpAge`
- `superCatchUp401k` — SECURE 2.0 §109 enhanced 401(k) catch-up for ages **60–63**
  (the band itself is statutory — it can't be moved — but it still starts no earlier than
  `catchUpAge`, so setting that past 63 disables it): the greater of $10,000-indexed or 150%
  of the regular catch-up — default $12,000 for 2026. Replaces (not stacks on) the
  regular catch-up in those years; at 64 the regular amount resumes. IRAs have **no**
  enhanced catch-up. When absent it is backfilled as `1.5 × catchUp401k` if the
  scenario set its own `catchUp401k`, else the year's default — so a scenario that
  disabled catch-up (`catchUp401k: 0`) gets no enhanced catch-up either.
- `inflationAdjusted` — when true, all caps scale by deterministic mean inflation each year

Caps are enforced **per owner per kind**. An account's "kind" is set on the account itself (`accountKind`: `'401k'` / `'ira'` / `'brokerage'`). When `accountKind` is absent, `traditional` and `roth` accounts default to `'ira'`, and `brokerage` accounts default to `'brokerage'` (uncapped).

Within an `(owner, kind)` group, employee `pre_tax` and `roth` contributions pool against the same cap. When the group exceeds its cap, all of its deposits are scaled proportionally and the cut amount accumulates into `contributionsCappedAmount`. Employer match is scaled proportionally with the employee contribution but does **not** count against the elective deferral cap (the IRS 415(c) total cap that includes match is not modeled). `after_tax` contributions to brokerage accounts are uncapped.

Capped pre-tax dollars stay in `otherTaxableGross` (they were never deducted, so the worker is taxed on them). Capped roth dollars also remain in spendable cash via the originating wage event — the simulation simply skips the over-cap deposit. Whatever cash remains beyond spending and tax in the year is then routed via the surplus pathway (see below) into the first brokerage account.

**Deposited (post-cap) Roth / after-tax contributions leave spendable cash** — the same dollars can't be deposited into their target account *and* counted again as surplus. The subtraction is floored at the year's modeled cash inflow: a contribution larger than modeled income (e.g. a lone `retirement_contribution` event with no wage event) is funded exogenously, preserving the "model my savings without modeling my whole salary" pattern. This mirrors pre-tax's floor-at-zero deduction. Employer match is never subtracted — it's the employer's money and was never spendable.

---

## Surplus Handling

Whenever annual cash flow leaves money on the table — `netCashFlow > 0` after income, contributions (capped), spending, and tax — that surplus is deposited into the **first brokerage account**.

- Routing is unconditional: surplus always goes to brokerage, never to Traditional or Roth.
- If no brokerage account exists in the user's configuration, `ensureReinvestmentAccount` injects a $0 synthetic `"Reinvestment"` brokerage account (60/40 allocation) into the working simulation copy. This is the same account used for RMD excess reinvestment — the two pathways share one synthetic account, never two.
- The synthetic account is not persisted to `UserData`. It only exists for the duration of the simulation run.
- When the portfolio cap is binding (depletion year), there is no surplus by definition; `surplusContribution` is 0.

`AnnualCashFlowBreakdown.surplusContribution` records the dollars deposited as surplus each year and is exposed in the yearly-data detail rows and CSV export.

`AnnualCashFlowBreakdown` exposes `wageIncomeGross`, `preTaxContributions`, `rothContributions`, `afterTaxContributions`, `employerMatch`, and `contributionsCappedAmount` for visibility in detail rows and CSV export.

---

## Roth Conversions

A `roth_conversion` income event moves money from Traditional to Roth accounts. Unlike other income types, the converted amount **does not contribute to spendable cash** — it's a transfer. Mechanics:

1. RMD is enforced first; the conversion amount is **capped per owner** at that owner's *live* (post-growth) Traditional balance remaining after their own RMD, then **jointly** at the Traditional dollars remaining after the year's spending pull (both owners scale down proportionally when the joint cap binds). Self's conversion cap binds independently of Spouse's plenty (and vice-versa). The joint + live-balance cap guarantees the year's total Traditional outflow can never exceed what the accounts actually hold — in a market-crash year, a conversion sized against the higher beginning-of-year balance is trimmed to what survived.
2. Converted amount is taxed as **ordinary income** in the year of conversion (joint household calculation; per-owner accounting only matters for sourcing).
3. **Routing is per-owner** (IRS rule: a conversion moves one owner's Trad to that same owner's Roth — Spouse's Trad cannot fund Self's conversion). Each conversion event carries `owner` (defaults to `'self'`). The engine routes the Trad pull pro-rata across that owner's own Traditional accounts only, and the Roth deposit pro-rata across that owner's own Roth accounts only. The breakdown surfaces per-owner totals via `rothConversionGrossSelf` / `rothConversionGrossSpouse` (sum = `rothConversionGross`) and per-owner withholding via `rothConversionTaxWithheldSelf` / `Spouse` (sum = `rothConversionTaxWithheld`; withholding splits proportionally to each owner's gross because each owner's 1099-R is independent). If an owner has conversions but no Roth account, `ensureRothConversionAccount` injects a per-owner synthetic (`Roth Conversion` for self, `Roth Conversion (Spouse)` for spouse). The marginal-stack attribution in `computeMarginalStackAttribution` scales per-event conversion gross by per-owner ratio so the displayed per-event gross matches the per-owner cap when one owner is capped and the other isn't.
4. **Conversion tax sourcing is hybrid**, in priority order: (1) **Cash** balance not consumed by spending (above the cash-bucket floor when a policy is configured) — preferred because cash principal is tax-free and avoids the LTCG/NIIT amplification phantom on Brokerage pulls, (2) RMD-excess cash (already pulled from Trad as part of the forced RMD; using it costs nothing extra), (3) Brokerage balance not consumed by spending, (4) withheld from the conversion itself (IRS Form 1099-R Box 4). Tax is **never** pulled from Traditional-above-RMD or Roth — paying conversion tax from Trad would shrink the conversion's tax arbitrage; paying from Roth would deplete the dollars just deposited. When Cash + RMD-excess + Brokerage can't cover the marginal ordinary tax, the conversion still executes at the requested gross — but the Roth deposit shrinks by the withheld amount. This matches real-world Vanguard/Fidelity withholding mechanics. Withholding is mathematically suboptimal vs. paying tax from external accounts (you give up some of the arbitrage), so the Roth Conversion dialog warns when it activates and advises adding Cash/Brokerage funds or reducing the conversion. The breakdown surfaces `rothConversionGross` (Trad pull), `rothConversionRequested` (user intent), `rothConversionTaxFromCash`, `rothConversionTaxFromRmdExcess`, `rothConversionTaxFromBrokerage`, and `rothConversionTaxWithheld`.
5. **Smart spending waterfall**: the engine auto-selects the spending policy per scenario via `selectBestSpendingOrder` (`'brokerage_first'` vs `'bracket_aware'`). For conversion-bearing plans, `'bracket_aware'` usually wins — it pulls Traditional in low-bracket years to preserve Brokerage for high-`mt` conversion years. The choice is independent of conversion sizing and conversion-tax sourcing. See **Withdrawal Waterfall** above for the mechanics.
6. If an owner has conversions but no Roth account, a per-owner synthetic Roth account is auto-created (`"Roth Conversion"` for self, `"Roth Conversion (Spouse)"` for spouse).

The Roth Conversion dialog's **Net impact on plan value** row is computed by running the deterministic projection (same single-path engine as the Projected chart line) twice — once with the conversion event included, once without — and diffing the end-of-plan portfolio balance. The other preview rows (first-year tax, total tax, RMD reduction, projected Roth at life expectancy) are fast closed-form estimates against your baseline income and do not include IRMAA or NIIT.

---

## Roth Conversion scheduling

Roth conversions are first-class `roth_conversion` events on `scenario.incomeEvents`. There is no separate "strategy" runtime layer — what you see in the Income panel is exactly what the engine simulates.

Two paths to add conversions, both backed by the same `RothConversionDialog`:

1. **Single conversion** — Income → + → Roth Conversion. One event with start/end age, COLA, etc. The dialog is rendered without an `onApplyBatch` callback here, so it locks to single-conversion entry (the wizard tab is hidden).
2. **Plan a multi-year schedule** — **Tools → Roth Conversions**. The generator wizard: pick a **plan window** (end-age cap, default 80) and toggle **cliff awareness** (default ON), click **Generate plan**, review the per-year preview table and the inline what-if chart, click **Apply** to materialize as `roth_conversion` events. Apply uses the shared `applyGeneratedConversions` helper ([src/utils/applyGeneratedConversions.ts](src/utils/applyGeneratedConversions.ts)) — it replaces the previous generator-tagged batch and preserves manual/detached conversions.

### Plan window (`endAgeCap`)

All three generator backends honor `taxStrategy.endAgeCap` (default `DEFAULT_END_AGE_CAP = 80` in `src/services/strategies/types.ts`). Years where `min(self_age, spouse_age) > endAgeCap` emit zero conversions. The vector length stays `totalYears` so OptimizeStrategy's coordinate descent indexing is uniform. Rationale: practitioner consensus says past ~80 the math is estate planning, not owner-lifetime tax arbitrage — and the wizard doesn't model heir brackets.

### Generator methods

The wizard's **Generate plan** button calls `runOptimization` directly. The three compute primitives below are all involved internally; the user sees one button and one result.

- **Fill to bracket** (internal building block) — sizes each year's conversion to fill a target federal bracket (`'12_percent'` / `'22_percent'` / `'24_percent'` / `'none'`). Reads the year's baseline ordinary income (wages, pensions, Social Security taxable portion, RMD net of conversion — but **not** the conversion itself; SS taxable portion is computed against ordinary-without-conversion as a single-pass approximation), subtracts the standard deduction (federal-only, including age 65+ extra), and emits `conversionAmount = max(0, top_of_target_bracket − baseline_taxable)`. Compute: ~5 ms. Not user-facing.

- **Auto bracket** (internal warm-start for Optimize) — grid-searches all four bracket targets, runs the Fill-to-bracket schedule against the deterministic projection for each, scores by the configured `objective`, and picks the winner. Cost: 4× a deterministic projection (~150 ms total). The `'none'` candidate scores the user's *true baseline* (no extra conversions, content-aware spending order) so the grid honestly compares "stay where you are" vs "switch to a bracket-fill strategy." Not user-facing — its winner is the seed for the coordinate descent.

- **Optimize** (what the **Generate plan** button runs) — coordinate descent on the per-year conversion vector. Seeded internally from Auto-bracket's winner. For each year, holds the others fixed and runs a 1D line search over conversion-amount candidates (multipliers of the current amount: 0, 0.25×, 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×, plus a logarithmic absolute-dollar probe set `[5, 10, 15, 20, 30, 40, 50, 75, 100]k` when current is 0). Each candidate is cliff-capped by `capConversionForCliffs` before scoring; with the IRMAA cap toggled OFF, the candidate set instead gains tier-boundary probes (`irmaaTierFillCandidates` — the conversion that fills MAGI exactly to each IRMAA tier ceiling) so deliberate tier crossings are evaluated at their efficient frontier points and the projection's priced surcharge arbitrates. Iterates forward + backward sweeps until relative improvement drops below `OPTIMIZE_CONVERGENCE_EPSILON_FRACTION` (0.1%) or `OPTIMIZE_MAX_SWEEPS` (3). **Cost:** ~600–1500 deterministic projections (~3–5 s). The spending policy is pinned upstream (`runOptimization` picks it once via `selectBestSpendingOrder` and threads it through every candidate via `_forceSpendingOrder`), so each candidate is exactly 1 projection — no 3× multiplier from auto-select firing inside the descent. Setup overhead: 2 for the policy pin + 1 for the baseline + 4 for the Auto-bracket seed (Auto-bracket also receives the pin, so its own selector call is skipped) = 7 projections before the descent starts. Result exposes `baselineScore` so the dialog reports improvement as "vs your current setup, +$X". Catches cross-year interactions Fill/Auto can't see: converting more in early years shrinks Trad and the forced RMD at 73, expanding bracket headroom later.

**Open-loop caveat.** The optimizer scores against the deterministic projection — the schedule is fixed at compute time and the MC runs follow it regardless of how the stochastic state evolves. On bad paths it will be suboptimal. This matches every production planner; the wizard footer surfaces this warning before Apply.

### Inline what-if chart

After Generate plan completes, the dialog renders a small Chart.js line plot ([src/dialogs/PlanComparisonChart.tsx](src/dialogs/PlanComparisonChart.tsx) — a generic current-vs-proposed component shared with the Social Security wizard) with two deterministic projection lines: the current plan (generator-tagged conversions stripped, manual conversions kept) vs the proposed plan (current + new schedule as synthetic events). **Real (year-0) dollars**, matching the wizard's scoring frame so the optimizer's "improvement" claim aligns visually with the chart.

### Impact Preview unit invariant

**All `ConversionImpact` dollar fields are reported in year-0 (real) dollars** — `firstYearTax`, `totalTaxOverConversion`, `rmdReductionAt73`, `projectedRothAtEndOfPlan`, and `netPlanValueImpact`. The engine path is pre-deflated by `path.push(startBalance / cumulativeInflation)` in [SimulationService.ts](src/services/SimulationService.ts), so the `netPlanValueImpact` derived from path-last-value is already real. The closed-form helpers (tax, Roth growth, RMD reduction) deflate per-year nominal values using the shared `deflateToYearZero` utility ([src/utils/deflate.ts](src/utils/deflate.ts)) before summing. A future contributor adding a new row should reuse `deflateToYearZero` rather than inlining the formula — keeps the grid unit-consistent and prevents the recurring "real vs nominal" confusion that originally caused the +$172K vs +$514K mismatch.

### Apply, provenance, and re-run policy

Every Apply tags each event with `meta = { generatedBy: <method>, generatedAt: <ISO date>, generatorRunId: <UUID> }`. Manual events have `meta` undefined (treated as `'user'`).

**Editing a generated event detaches it.** Opening any generator-tagged event in the dialog and saving (even unchanged) flips `meta.generatedBy → 'user'`. The row leaves the regenerable schedule and survives future re-runs.

**Re-run replace policy.** Apply replaces every `roth_conversion` event whose `meta.generatedBy ∈ {fill_to_bracket, auto_bracket, optimize}`. Manual events and edited-detached events are untouched. Replace-confirm fires only when there are generator-tagged events to overwrite.

**Income panel grouping.** Generator-tagged events sharing a `generatorRunId` collapse into one expandable card on the Income panel; manual conversions render as individual cards.

### Caveats of Fill-to-bracket

- Does NOT consult Traditional balance when sizing. If you have $100k Trad and the schedule wants $150k conversions, the engine caps the conversion at the available Traditional balance per year — but the schedule itself stays "what you'd convert if you had it."
- Does NOT model IRMAA cliffs. A 12% conversion can push your two-year-prior MAGI into a higher IRMAA tier. Auto bracket and Optimize avoid IRMAA cliffs *indirectly* via terminal-wealth scoring — the surcharge cost shows up in the projection.
- Does NOT respect ACA premium-credit cliffs (pre-65 retirees). ACA is not modeled in the engine yet.
- SS-taxable-portion feedback is approximate. Single-pass approximation; multi-pass refinement is future work.
- IS survivor-aware (widow's penalty): when `spouseLifeExpectancy` is set, post-first-death years fill to the **single** bracket ceiling and cap against **single** IRMAA tiers, the deceased's non-SS income drops out of the baseline, the SS baseline keeps only the larger benefit, and — when self dies first — post-death years emit zero (the wizard's conversions are self-owned events the engine terminates at death).
- One-time income events (`isOneTime`) count toward the baseline only in their start year — a one-time property sale doesn't suppress conversions for the rest of the plan.

### Objectives (under Advanced in the wizard)

All scoring is in **real (year-0) dollars** — the projection is deflated by `(1+inflationRate)^horizon` before scoring. This prevents the optimizer being seduced by nominal terminal wealth into late-life conversions whose owner-lifetime payoff is near zero once you correct for inflation.

- **`'max_median_terminal_wealth'`** (default) — score = start-of-last-year portfolio balance, deflated. Higher = better. **Important caveat: this scores pre-tax balances** — a Traditional dollar counts the same as a Roth dollar. A conversion's tax bill is fully visible in the score, but its benefit only registers for dollars that would actually have been withdrawn (and taxed) within the plan horizon. For scenarios that end with a large Traditional balance, this objective systematically under-recommends conversions.
- **`'max_after_tax_terminal_wealth'`** (opt-in) — same instant and real-dollar frame, but each account type is valued net of its embedded tax liability: `Roth + Cash + Brokerage × (1 − longTermCapGainsRate) + Traditional × (1 − terminalTradTaxRate)`. The terminal Traditional rate (default 25%, editable in the wizard when this objective is selected) is a proxy for the rate you or your heirs would pay on un-withdrawn Traditional dollars. Brokerage is discounted at the flat LTCG rate, consistent with the engine's no-cost-basis model. This objective credits the conversion benefit the pre-tax score can't see, and typically recommends larger schedules. The inline comparison chart still plots pre-tax balances.
- **`'min_lifetime_tax'`** — score = − sum(deflated per-year totalTax). Higher = better (negated so "argmax" picks the lowest-tax schedule).
- **`'max_floor'`** — reserved (10th-percentile MC terminal wealth). Currently falls back to terminal-wealth scoring; full MC objective is future work.
- **`'max_lifetime_consumption'`** — reserved (discounted sum of spending-actually-delivered). Currently falls back to terminal-wealth; awaits priority-tier spending feedback to become meaningful.

### IRMAA cliff cap

`UserData.respectIrmaaNiitCliffs` is **default ON** (treats `undefined` and `true` as enabled; only explicit `false` opts out). Practitioner consensus treats IRMAA tier crossings as hard caps. `capConversionForCliffs` in `src/services/strategies/FillToBracketStrategy.ts` caps each year's generated conversion so MAGI stays under the next IRMAA tier (year+2 lookback, gated on a Medicare enrollee in that year). Honored by Fill, Auto-bracket, and Optimize uniformly — the toggle is the same hard cap across all three. Exposed in the Roth Conversion wizard ("Avoid IRMAA tier jumps"), not the Scenario dialog (it's a generation-time concern).

With the cap **OFF**, the Optimize descent doesn't go blind — it gains tier-boundary probes (`irmaaTierFillCandidates`): for each IRMAA tier ceiling, the conversion amount that fills the year's MAGI exactly to that ceiling. The engine prices the resulting surcharge (2-year lookback) inside every scored projection, so the score decides whether a deliberate tier crossing pays.

**NIIT is not capped** (changed June 2026): NIIT is a marginal 3.8% tax — `3.8% × min(investment income, MAGI − threshold)` — not a discontinuity, and a Roth conversion is not investment income, so crossing the threshold often costs nothing at all. The previous hard cap silently limited every generated conversion to $200k/$250k MAGI even when the marginal NIIT cost was $0. The engine prices NIIT in every scored projection, so the optimizer's score arbitrates it correctly. (The `respectIrmaaNiitCliffs` field name keeps "Niit" for persisted-data compatibility.)

### Spending source order

Auto-selected per scenario by `selectBestSpendingOrder` in `src/services/SimulationService.ts`. Two policies are candidates:
- `'brokerage_first'` — pulls Brokerage before Traditional.
- `'bracket_aware'` — pulls Traditional up to top-of-12% federal-bracket headroom (conv- and SS-inclusive) before Brokerage.

The selector runs two deterministic projections (one per candidate, via the internal `_forceSpendingOrder` option) and picks the higher real terminal balance. Tiebreaker `brokerage_first` within `max(100, |score| × 5e-4)` tolerance. No user knob — the previous `UserData.spendingWithdrawalOrder` field was removed. The Roth Conversion wizard's `netPlanValueImpact` is now the honest marginal effect of the conversion on top of the engine already doing its best (no more "+$514K bonus for a $1 placeholder conversion" surprise — see CLAUDE.md "Spending source policy" for the full story).

### Legacy `taxStrategy` migration

Scenarios saved before this rework carried `UserData.taxStrategy.cachedVector.perYearDecisions`. On load, `migrateLegacyTaxStrategy` in `src/utils/scenarioMigration.ts` (run via the shared `runMigrationPipeline`, which both the IndexedDB load loop and the import path use) materializes the non-zero decisions as tagged `roth_conversion` events (provenance: the strategy that produced them) and strips the `taxStrategy` field. A one-time toast notifies the user. The `UserData.taxStrategy` type field remains for the legacy parse path but is otherwise unused by the engine.

---

## Social Security claiming-age wizard

**Tools → Social Security.** Finds the claiming age (62–70) that maximizes the plan's real terminal value, supplying the actuarial link the engine itself doesn't model (an SS event's `amount` and `startAge` are otherwise independent — the engine pays whatever amount you entered, whenever you claim).

### Actuarial model (`src/services/socialSecurity.ts`, pure, no engine dependency)

- **Full Retirement Age (FRA)** from birth year per the SSA table (`computeFraMonths`): 66 for 1943–1954, +2 months/year through 1959, 67 for 1960+. Birth year is derived as `referenceYear − ownerAge`. Computed in **months** so fractional FRAs (e.g. 66y 8m for 1958) are exact.
- **Benefit multiplier** (`benefitMultiplier`): early claiming reduces the benefit by 5/9 of 1% per month for the first 36 months before FRA, then 5/12 of 1% per month beyond; delayed claiming adds 2/3 of 1% per month (8%/yr) from FRA to age 70 (capped at 70). Anchors: FRA 67 → 62 = 70%, 70 = 124%; FRA 66 → 62 = 75%, 70 = 132%.
- **PIA** (Primary Insurance Amount = benefit at FRA) is reconstructed from the single benefit figure the user enters: `piaFromBenefit(benefit, fraMonths, enteredAgeMonths)` inverts the multiplier. `benefitAtAge(pia, fraMonths, claimAge)` then gives the actuarially-correct benefit at each candidate age. The wizard works entirely in **today's dollars** (`ssAmountBasis: 'today'`), matching how the SSA statement quotes the figure.

> **Amount basis (today's dollars).** The Social Security dialog no longer exposes the today-vs-future basis toggle — every new SS entry is in **today's dollars**, matching the SSA statement and the claiming-age wizard. The `ssAmountBasis` field is retained on `IncomeEvent` and still honored by the engine (`SimulationService.inflateAmount` / `conversionImpact`) only so legacy scenarios and imported JSON carrying `'future'` continue to resolve correctly. **Future task:** fully remove `ssAmountBasis` — the field on `IncomeEvent`, the `'future'` branches in `inflateAmount` and `conversionImpact`, the wizard's deflation/apology logic, and the `IncomeEventsManager` row label — once legacy `'future'` data is no longer a concern.

### Sweep (`src/services/socialSecurityOptimizer.ts`)

`optimizeClaimingAge` replaces the selected owner's SS event with `buildClaimingEvent(...)` at each claim age in `[max(62, ⌈ownerAge⌉) … 70]`, runs `runDeterministicProjection` (the same single-path engine as the Projected chart line), and records each age's real terminal value. Per-age deltas in the table are measured against the candidate at the current claim age (so that row reads exactly $0), not a separate baseline run. `buildClaimingEvent` is the single source of truth shared with the dialog's Apply, so candidate generation and the applied event never drift; it always emits `ssAmountBasis: 'today'`, inherits COLA from the existing SS event, and takes the **trust-fund haircut** (`ssHaircutEnabled`/`ssHaircutPercent`/`ssHaircutYear`) from explicit options — per-event fields the wizard exposes as a checkbox + editable start year + percent so the user can sweep with and without it, or model a different depletion year (the values fall back to the existing event, then to the defaults `DEFAULT_SS_HAIRCUT_YEAR` / `DEFAULT_SS_HAIRCUT_PERCENT` = 2032 / 22%, tracking the 2026 Trustees Report). Spending order is auto-selected per projection (not pinned), exactly as the live chart does it. ~9 deterministic projections (≈ tens of ms), so the dialog computes synchronously in a `useMemo` off debounced inputs — no worker, no spinner. When the owner already has a saved SS entry, one extra projection of the scenario *as saved* (`enteredPlanPath`) provides a stable "Your saved plan" reference line on the comparison chart (it uses the saved event's own haircut, so it stays put as the wizard's haircut toggle moves the candidates).

`findCrossoverAge(later, earlier, planCurrentAge)` returns the breakeven age — where the delayed-claim portfolio path overtakes the earlier-claim path (the classic SS crossover expressed against the portfolio).

### Scope, edge cases, and provenance

- **Per-owner, not joint.** With MFJ + spouse age set, the wizard optimizes one person at a time; the other's SS is held fixed. Second-order tax coupling between the two is not optimized (documented in-UI). An owner already claiming (existing `startAge ≤ ownerAge`) or past 70 is locked out, with the wizard pointing to the other owner.
- **Own-benefit only.** Spousal (50%) and survivor benefits are not modeled (the per-owner machinery + `buildClaimingEvent` make them a clean future extension). Objective is fixed to real terminal value (a configurable objective is a future extension mirroring `scoreProjection`).
- **Apply** writes the chosen age as a normal `social_security` event (replacing the owner's prior one), tagged `meta.generatedBy = 'ss_optimizer'`. The tag is informational provenance only — there is no re-run-replace or detach-on-edit machinery (one SS event per owner). Replacing a manually-entered SS event prompts a confirm first.

The wizard presents everything in **today's (year-0) dollars** — it does not follow the app-wide Today's $/Future $ toggle (real terminal wealth is the optimizer's scoring frame and the SSA benefit input is a today's-dollar figure; a saved `'future'`-basis benefit is deflated to today's dollars before PIA reconstruction). The dialog's lead visual is [PlanComparisonChart.tsx](src/dialogs/PlanComparisonChart.tsx) (current-vs-selected lines, pinned to real here, shared with the Roth wizard, plus the optional "Your saved plan" reference line). Below it, an always-visible per-age table carries the longevity-vs-check-size tradeoff numerically — each claiming age's annual benefit, real plan final value, and Δ vs the current age, with ★ (recommended) and (current) markers; clicking a row drives the chart's selected line and the Apply target.

---

## Black Swan Events

Optional portfolio stress events. Each `BlackSwanEvent` replaces the drawn stock/bond return factors for a specific calendar year with **fixed historical multipliers** — applied **identically across every Monte Carlo run**.

This is a prescriptive overlay, not a stochastic shock: it shifts the entire distribution of outcomes downward at that year, useful for stress-testing against known historical events (1929, 1973–74, 2008) or hypothetical scenarios.

---

## Horizon and Mortality

The simulation runs from your current age through your `lifeExpectancy` — exactly `lifeExpectancy − currentAge + 1` years. Life expectancy is treated as a **hard endpoint**, not a stochastic event:

- No probability-of-death modeling. Every run goes the full distance.
- Success is "did the portfolio survive to life expectancy," not "did it survive to a random death age."
- Setting `lifeExpectancy` higher is the standard way to add longevity-risk margin (e.g., age 95 or 100 instead of an actuarial median).

This is a deliberate choice. Stochastic mortality would inflate success rates artificially — runs that "succeed" by ending early via simulated death are not actually plans that worked.

### Survivor "widow's penalty" (optional, for couples)

For married-filing-jointly scenarios you can set a **Spouse Life Expectancy** (the spouse's death age) alongside your own. When set, the model captures the *survivor penalty* — the often-overlooked reason Roth conversions pay off for couples:

- The projection runs to the **later** of the two deaths (it no longer stops at your own life expectancy when your spouse outlives you).
- At the **first** death, the survivor's filing status flips **Married Filing Jointly → Single** the year after the death. That roughly **halves the standard deduction**, **compresses the tax brackets**, makes **more of Social Security taxable**, and pushes **IRMAA Medicare surcharge tiers** to lower income — all while the combined Required Minimum Distributions keep coming.
- The survivor keeps only the **larger** of the two Social Security benefits (the smaller one stops).
- All Traditional balances **consolidate** to the survivor; the RMD is computed on the combined balance at the survivor's age.

Because pre-converting to Roth while *both* spouses are alive (at the wider joint brackets) avoids taxing those dollars later in the survivor's compressed single brackets, modeling this typically **increases the value the Roth Conversion optimizer reports**. Leave Spouse Life Expectancy blank to skip the feature entirely (results are then identical to before).

**Modeled simplifications:** no 2-year "qualifying surviving spouse" grace (we switch to single immediately the year after death); household spending is not reduced for a single survivor; and heir/estate value under the SECURE Act 10-year rule is not scored.

---

## Defaults Quick Reference

| Parameter | Default |
|---|---|
| Number of simulations | 1,000 |
| Stock return / std dev | 8.5% / 16% |
| Bond return / std dev | 4.8% / 6% |
| Stock/bond correlation | −0.20 (enabled) |
| Inflation rate / std dev | 3.0% / 1.2% |
| Return distribution | Log-normal |
| Student's t degrees of freedom | 4 |
| Return model | Parametric |
| Long-term capital gains rate | 15% |
| Filing status | Single |
| Account allocation | 60/40 |
| Block bootstrap block size | 5 |

---

## Known Limitations

- **Federal bracket inflation uses headline CPI** — the model inflates post-2026 brackets using the scenario's `inflationRate`, but the IRS uses Chained CPI-U which historically runs ~0.2–0.3 pp lower. The difference is small and conservative (slightly over-indexes brackets, slightly under-taxes late years).
- **No SS provisional thresholds inflation** — these are frozen by Congress, so this matches reality, but the resulting "tax torpedo" gets steeper over time.
- **No stochastic inflation in cash flows** — only portfolio deflation uses per-run inflation; income/spending use the deterministic mean.
- **State tax on capital gains** uses the per-state profile's `ltcgRule`: most states stack LTCG on top of state ordinary brackets, Missouri exempts LTCG entirely, and Washington applies a 7% rate above an inflation-indexed $270k threshold (with no underlying ordinary state tax). NH/TN dividend & interest tax is not modeled.
- **State SS taxability is per-profile** — each state profile carries an SS rule (`exempt` / `taxed` / `exempt_if_age` / `agi_phaseout`), so states that exempt Social Security (CA, NY, etc.) are modeled correctly. (Per-state *partial* SS rules use the structured exclusion mechanics; see "Partial exclusions" above.)
- **Federal LTCG rate** — defaults to a flat `longTermCapGainsRate × fromBrokerage`. Optional 0/15/20% bracket stacking (gains stacked on ordinary taxable income) is available per scenario via `useStackedLtcgBrackets`; when off, the flat rate is used. Cost-basis tracking is still absent in both modes — the entire brokerage withdrawal is treated as gain.
- **No cost-basis tracking** in brokerage accounts; the entire withdrawal is treated as long-term capital gain (and as investment income for NIIT).
- **IRMAA tier table is 2024** inflation-indexed forward, not refreshed annually; thresholds and surcharge amounts will drift from real IRS figures as Medicare updates the table.
- **IRMAA threshold indexing uses scenario `inflationRate`** as a proxy. CMS's actual formula tracks Part B premium growth and SS COLAs, which can drift from CPI over a 30-year horizon.
- **IRMAA tier boundaries are knife-edges**, as in the statute — one dollar of MAGI over a threshold charges the full higher surcharge for the year, with no phase-in.
- **NIIT investment-income proxy** is the gross brokerage-account withdrawal (no cost-basis tracking), so NIIT is overstated when a significant portion of the withdrawal would actually be return-of-basis.
- **First-2-years IRMAA lookback** comes from a single `priorWorkingMagi` value on `UserData` (used for both year 0 and year 1). Leave at 0 to assume no IRMAA in the first two retirement years.
- **Existing scenarios upgrade behavior** — scenarios saved before the IRMAA/NIIT/state-LTCG additions load with IRMAA and NIIT enabled by default, so tax bills and success probability will differ from prior runs. Disable under Settings → Tax & IRS to recover prior behavior.
- **No ACA premium tax credit modeling** — pre-65 retirees on ACA-subsidized plans may face large effective marginal rates from subsidy phase-outs that the model does not capture.
- **Surviving-spouse bracket shift is modeled** (opt-in via `spouseLifeExpectancy`) — at the first death the filing status flips MFJ→single the following year, ages collapse to the survivor, and SS becomes the larger of the two benefits (the "widow's penalty"; see that section). Simplifications: no 2-year qualifying-surviving-spouse grace, and survivor household spending is not reduced.
- **No tax-loss harvesting**.
- **No mortality modeling** — life expectancy is a hard endpoint (see *Horizon and Mortality* above).
- **Social Security claiming optimization is available** — the SS claiming-age wizard sweeps candidate ages and recommends one (see that section). You can also still specify the start age directly. (Spousal/survivor benefits and joint two-owner optimization remain future work.)
