# YARP Model Details

> Technical reference for the simulation engine, tax calculations, and underlying methodology.

---

## Monte Carlo Simulation

YARP runs **1,000 independent simulations** by default (configurable: 1,000 / 5,000 / 10,000). Each simulation draws a random sequence of annual stock and bond returns and projects every account from today through your life expectancy, applying income, spending, taxes, and withdrawals each year.

In the browser, MC runs in parallel across a Web Worker pool sized to your machine's available cores (capped at 8) so the UI stays responsive during a sim. Each worker uses an independent `Math.random` stream — results are statistically equivalent but not bit-identical across machines with different core counts. The deterministic projection ("Projected" chart line, and the Roth-conversion *Net impact on plan value* preview row) does not consume the RNG and is fully reproducible regardless.

### Success Probability

A run is **successful** if portfolio balance never reaches $0 before life expectancy. The reported success probability is the fraction of successful runs.

### Representative Paths

YARP selects the **single simulation run** whose final balance is closest to the 50th percentile (Median) or 10th percentile (Downside) of all final balances. These representative runs power the **yearly data table** breakdowns — the same year's stock and bond return factors drive every line of that run's detail, so income, spending, taxes, withdrawals, and balance evolve consistently from a real return sequence.

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

where `z` is a standard-normal draw (or a standardized Student's t draw if fat-tail mode is on). This parameterization ensures `E[factor] = 1 + mean` regardless of std dev.

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

The `√((df-2)/df)` scaling ensures the realized variance equals 1, so log-space variance still matches your configured `stockStdDev` / `bondStdDev`. **Fat tails come from excess kurtosis, not inflated variance** — extreme events become more frequent without changing the average outcome.

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

Synthetic accounts (auto-created Reinvestment, Roth Conversion accounts) default to **60/40** allocation.

**Cash accounts bypass this formula entirely.** Cash is non-volatile by construction. The growth loop branches on `account.type === 'cash'` and applies a deterministic yield instead:

```
cashInterest = balance · cashYieldRate
balance ← balance + cashInterest
```

`cashYieldRate` lives on `portfolioAssumptions` (default 4%). Cash is also skipped by the black-swan overlay — a "cash is trash" 2022-style episode shows up as opportunity cost vs. equities, not as a cash shock. This holds across all return models (parametric, historical, bootstrap); cash never participates in the stochastic stream.

`cashInterest` is taxed as ordinary income in the year accrued (accrual basis, matching MMF/HYSA behavior — no basis tracking). It is folded into `otherTaxableGross` for the entire tax pipeline (federal/state ordinary, SS provisional income, IRMAA MAGI) and additionally added to the NIIT investment-income proxy per IRC §1411 (MMF interest is investment income for NIIT purposes — without this proxy extension, cash-heavy retirees above the NIIT threshold would be under-taxed).

Cash principal is **tax-free on withdrawal** (no LTCG, no NIIT on principal). The waterfall pulls Cash at priority 0 (before RMD and Brokerage) to avoid LTCG churn and the conversion-tax amplification phantom. See "Withdrawal Waterfall" below.

### Cash bucket policy (optional)

`UserData.cashBucketPolicy` enables automatic cash-bucket management. The policy declares a band in **months of total annual spending** (`monthly = totalSpendingNet / 12`):

```
cashBucketPolicy: {
  minMonths,                // soft floor — spending pulls Cash only down to this
  targetMonths,             // surplus deposits and refills aim for this
  maxMonths,                // hard ceiling — excess sweeps to Brokerage
  refillTrigger: 'always' | 'gains_only' | 'above_baseline' | 'none',
}
```

Behavior:

- **Soft floor.** The spending waterfall pulls Cash only down to `minMonths × monthly`. Below that, spending falls through to Brokerage. This reflects the reality that users have unmodeled liquid cash (checking, bill-pay buffer) — the floor represents how much they're willing to hold in this modeled bucket. Set `minMonths: 0` for full drain-to-zero behavior. The conversion-tax-sourcing chain respects the same floor.
- **Hard ceiling.** When cash balance exceeds `maxMonths × monthly` at end of year, the excess sweeps to the first Brokerage account in a **post-convergence** step. The sweep is a **tax-free balance transfer** — implementation does not route through the withdrawal waterfall, so no LTCG / NIIT is realized.
- **Refill.** When cash is below `minMonths × monthly` AND the trigger fires AND surplus is available, the engine reroutes this year's surplus from Brokerage to Cash up to `targetMonths × monthly`. Refill is **surplus-only** — the engine never sells Brokerage mid-loop to top up cash. That rule prevents phantom-tax archetype #3 (the refill-LTCG leak).
- **Triggers.** `'always'` (any year with surplus). `'gains_only'` (this year's stockFactor > 1 — recommended; bear-aware). `'above_baseline'` (portfolio post-growth / deterministic-baseline > 1; strictest bear-aware). `'none'` (manual mode — also disables the spending-waterfall floor; equivalent to leaving the policy undefined).

**Structural enforcement of the no-tax-mutation invariant.** The post-convergence step lives in `applyPostConvergenceBucketPolicy` which receives only a minimal subset of the settled breakdown (`baseSpendingNet`, `otherSpendingGoalsNet`, `netCashFlow`, `spendingShortfall`) plus account balances and the policy. It does not import any tax module. Its return type contains only cash-routing fields. As a result, the function is type-prevented from mutating `totalTax`, `ordinaryTax`, `federalCapGainsTax`, `niitTax`, `irmaaSurcharge`, or any income field — making "post-convergence step never re-enters the tax calc" a type-level guarantee rather than a runtime discipline.

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

Each year, withdrawals follow a fixed sequence. Two strategies are available, selected per scenario via `UserData.spendingWithdrawalOrder`.

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

**This setting only changes the spending source — it does NOT change conversion size or conversion-tax sourcing.** Conversion tax still follows the hybrid sourcing rule (RMD-excess → Brokerage → withhold). The point of `bracket_aware` is to **preserve Brokerage for the high-`mt` conversion years** by paying for low-bracket-year spending from Traditional cheaply. See CLAUDE.md "Cross-year spending source policy" for the rationale, blind spots, and tradeoffs.

Override the auto-resolved default via the **Withdrawal Source** radio in the Scenario dialog (Auto / Brokerage first / Bracket-aware) — e.g. select Brokerage first on a conversion-bearing scenario to opt out of the smart default.

### Spending Shortfall

When the portfolio cannot cover the full spending + tax need, the year is recorded with a `spendingShortfall` value showing exactly how many dollars went unmet. The simulation continues — balance is floored at $0 and subsequent years draw from any remaining income (Social Security, pension, etc.). The success-probability metric counts any year where the balance hits $0 as a failed run, regardless of how large the income floor is.

### Cost-of-Living Adjustment (COLA)

Inflation-adjusted income events (Social Security, pensions with COLA, etc.) compound from each event's **own start year**, not from "today." For an event starting at age 67 with a 2.5% COLA, the inflation factor is `(1.025)^(year − startYear)` — so the first payment at age 67 is the entered nominal amount, and amounts grow from there. Different events can use different COLA rates.

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

The LTCG rate is **per-scenario configurable** (default 15%) — the model uses a single flat rate, not the federal 0%/15%/20% brackets. If you expect to fall in the 0% LTCG bracket some years, set the rate lower; if you expect to be in the 20% bracket, set it higher.

Each income event carries a `taxStatus` flag: **`before_tax`** events (pension, part-time work, rental income, etc.) flow into `ordinaryIncome`. **`after_tax`** events (inheritance, gifts, tax-free settlements) bypass the tax engine entirely and contribute directly to spendable cash.

### Social Security Taxation

YARP implements the IRS provisional income worksheet. **Provisional income** is:

```
provisional = AGI (excluding SS) + tax-exempt interest + 0.5 · SS_gross
```

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
- **SS taxability rule** — `exempt` (most states), `taxed` (CT, MN, MT, RI, VT, WV-through-2026), `exempt_if_age` (CO 65+), or `agi_phaseout` (NM, UT, VT, RI, KS) with per-filing-status AGI thresholds.
- **Retirement-income exclusion** — applied to Traditional withdrawals: `none`, `full` (IL, PA, MS, IA, MI-67+, HI), `amount` (NY $20k/59.5+, GA $65k/65+, DE $12.5k/60+, MD $36.2k/65+, KY $31k, …), or `agi_phaseout` (NJ — pension exclusion to $75k/$100k below $150k AGI, hard cliff above).
- **LTCG rule** — `ordinary` (most states; LTCG stacked on top of state ordinary brackets), `exempt` (Missouri), or `threshold` (Washington 7% above an inflation-indexed $270k single / $270k MFJ threshold; WA has no ordinary state tax).
- **Locality surcharge** — currently only New York City (pseudo-state `"New York City"`): ~3.876% applied to the state ordinary base on top of NY state brackets.
- **Successor profiles** — `effectiveYears.end` + `successorProfileKey` chain a profile to a different one once a year boundary is crossed. South Carolina sunsets its 6% top rate after 2026 (successor 5.2%); West Virginia's SS taxation phases out into a 2027+ successor profile.

Multiple states across the user's lifespan are supported via the **relocation timeline**: each entry resolves to a profile for that year, switching at the configured move year.

Approximations explicitly accepted:

- **Bracket fidelity** — high-income states (CA, NY, NJ, OR, MN, HI, MD, NM, CT, DE, AR, ND, OH, RI, MO, ME, WI, MT, NE, VT, DC) carry real graduated schedules. States with statutory brackets I haven't encoded yet (some of AL/GA/KS/etc.) are modeled as flat at top rate above the state standard deduction — better than the prior flat-on-gross, but still understates progressivity. Schema is bracket-ready, so this is incremental data work.
- **Partial exclusions** — "partial" SS / retirement exclusions are modeled per-state with structured rules (AGI thresholds, age gates, dollar caps). The exclusion applies to Traditional withdrawals as a lump sum and does not distinguish public vs private pensions or source-specific sub-rules within a state.
- **Filing status** — HoH / MFS share the `single` bracket and deduction at the state level. Most state HoH schedules differ only slightly from single; MFS rules vary too widely to model uniformly.
- **Not modeled** — MA 4% surtax above $1M, OH/PA local municipal income tax, Yonkers surcharge, multistate part-year residency within a single year (timeline switches are whole-year), tax credits (Oregon senior credit, Utah SS credit), alternative minimum tax, capital-gains 0/15/20% bracket stacking (federal LTCG is still a flat rate).

The state tax flows are exposed in `AnnualCashFlowBreakdown.audit` as: `stateOrdinaryTax`, `stateLocalitySurcharge` (top-level), `stateOrdinaryBaseGross`, `stateStdDeduction`, `stateRetirementExclusionApplied`, `stateSsIncludedInState`, `stateMarginalRate`, `stateBracketIndex`, `stateLtcgTaxableAtState`, `stateLtcgThresholdApplied`, and `stateNotes`. The Tax Audit detail tab renders each of these as a labeled row under a per-year "State tax — {name}" section.

**`disableStateRetirementExclusion`** (optional `UserData` field) — set to `true` to disable the profile's retirement-income exclusion (Traditional withdrawals fully exposed to state ordinary brackets). Defaults to `undefined` = use the profile's rule. The Scenario dialog exposes this as an "Disable state retirement-income exclusion (advanced)" checkbox under the state dropdown when the active state has a non-`none` exclusion rule.

**NYC locality base.** NYC (`localitySurcharge: { rate: 0.03876, appliesToOrdinaryOnly: false }`) applies the surcharge to the *combined* ordinary + LTCG base, since NYC taxes capital gains as ordinary income. Other potential localities would set `appliesToOrdinaryOnly: true` to limit the surcharge to ordinary income.

**WA LTCG threshold indexing.** The Washington capital-gains threshold inflates independently of the bracket-indexing flag, since WA has no ordinary brackets and the threshold is statutorily CPI-indexed annually. Anchor: $262k (2024); indexes forward via the scenario's `inflationRate` from 2024.

**Marginal-stack attribution.** The Tax Audit per-event marginal-tax breakdown distributes the year's actual state ordinary tax + locality surcharge proportionally to each event's federal taxable contribution. This conserves the year total (sum of `marginalTax` ≈ federal ordinary tax + state ordinary tax + locality), but individual event rows are an approximation when the state's rules diverge from the federal stack (e.g., SS exempted at the state level, retirement exclusion applied). The federal portion of each event row remains exact via the bracket walk.

### Medicare IRMAA Surcharges

Starting at age 65, Medicare Part B and Part D premiums include an **IRMAA** (Income-Related Monthly Adjustment Amount) surcharge for beneficiaries whose modified AGI exceeds tiered thresholds. The model uses the 2024 official tier table, inflation-indexed forward by `inflationRate`, and applies the IRS **2-year lookback** (year N's surcharge depends on year N-2's MAGI). Surcharge is per Medicare-enrolled person — so a married couple where both spouses are 65+ pays the surcharge twice.

MFS tiers are approximated with the single tier table (the actual MFS table is compressed). Set `enableIRMAA: false` to disable.

### Net Investment Income Tax (NIIT)

A flat **3.8%** tax applied to the lesser of (a) net investment income or (b) MAGI above the threshold. Thresholds are statutory (NOT indexed for inflation): $200k for single/HoH, $250k for MFJ, $125k for MFS. Investment income is proxied by the brokerage-account withdrawal (same proxy as federal LTCG). Set `enableNIIT: false` to disable.

### Deductions

- **Standard deduction** — filing-status base, plus an age-65+ add-on (~$1,950–$2,050 per qualifying senior, indexed by year). Both members of a married couple can independently qualify.
- **OBBBA bonus senior deduction** — applied automatically when active. Hardcoded mechanics (not user-configurable):
  - $6,000 base per qualifying senior (age 65+)
  - 6% phase-out above $75,000 AGI (single) / $150,000 AGI (joint)
  - Active **2025–2028 only** — does not apply in later retirement years

### Tax Audit Fields

Every `AnnualCashFlowBreakdown` carries an `audit` sub-object capturing the intermediate values that the tax model computes and would otherwise discard. These power the **Tax Audit** and **Income Detail** tabs in the yearly data view, and ship as extra columns in the CSV export. Each representative path (median, projected, downside) has its own audit data driven by that path's actual flows.

- **Ordinary income tax** — `agi` (= otherTaxableGross + Traditional withdrawal + SS taxable portion), `standardDeduction`, `seniorAddOn`, `obbbReduction`, `totalDeductions`, `taxableIncome`, `federalBracketIndex` (0=10% rate through 6=37% rate), `federalMarginalRate`, `federalOrdinaryTax`, `stateOrdinaryTax`, and `federalBrackets[]` (per-bracket dollars-in-bracket and tax-in-bracket for the year's inflation-indexed thresholds).
- **Social Security taxability** — `ssProvisionalIncome` (= otherTaxableGross + ½ × ssGross), the frozen IRS `ssProvisionalThreshold1`/`Threshold2`, and the `ssZone` hit (`none` / `50%` / `85%` / `mfs-flat`).
- **IRMAA** — `irmaaLookbackMagi` (2-year-prior MAGI used for this year's surcharge), `irmaaTierIndex` (0..5 in the inflation-indexed tier table), `irmaaTierUpperScaled` (inflation-indexed upper bound of the hit tier), `irmaaMonthlySurcharge` and `irmaaPerEnrolleeAnnual` (Part B + Part D), `irmaaEnrolleeCount` (count of Medicare-enrolled spouses age 65+).
- **NIIT** — `niitMagi`, `niitThreshold` (frozen, not inflation-indexed), `niitMagiExcess`, `niitInvestmentIncome` (= gross brokerage-account withdrawal), `niitTaxableBase` (= min of the two, × 3.8% = niitTax).
- **RMD per owner** — `rmdSelf` / `rmdSpouse` totals, `rmdDivisorSelf` / `rmdDivisorSpouse` (IRS Uniform Lifetime Table divisor for the owner's age, 0 when no RMD), `rmdBoyBalanceSelf` / `rmdBoyBalanceSpouse` (beginning-of-year Traditional balance per owner, from before this year's growth).
- **State** — `effectiveStateName`: which `stateTimeline` entry's flat rate applied this year.

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
| Other Spending Goals | `otherSpendingGoalsNet × spendScale` | After-Tax Cash |
| Pre-Tax → Traditional | `preTaxContributions` | After-Tax Cash |
| Roth Contribution | `rothContributions` | After-Tax Cash |
| After-Tax → Brokerage | `afterTaxContributions` | After-Tax Cash |
| Employer Match Deposit | `employerMatch` | After-Tax Cash |
| RMD Excess → Brokerage | `rmdExcess` | After-Tax Cash |
| Surplus → Brokerage | `surplusContribution` | After-Tax Cash |

**Off-axis transfers** (rendered as a row below the diagram, not passing through any bucket):
- Cash refill ← `cashRefillFromSurplus` (Brokerage → Cash)
- Cash sweep ← `cashSweepToBrokerage` (Cash → Brokerage)

**Bucket residual flows** (the load-bearing conservation invariants):

Each bucket emits one residual link into After-Tax Cash equal to its inflow minus its direct (non-residual) outflows:

- `OrdinaryIncome → AfterTaxCash` = OI_in − (federalOrdinaryTax + stateOrdinaryTax + stateLocalitySurcharge + irmaaSurcharge + (rothConversionGross − rothConversionTaxWithheld))
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

Audit data is computed for **every** breakdown — all 5000 Monte Carlo runs × ~30 years, plus the deterministic projection — not just the representative paths. The per-breakdown cost is roughly one `calculateNetFromGrossDetailed` call plus ~5–10 extra `calculateNetFromGross` calls for the marginal stack; in profiling this added under 2s to a typical 5000-run simulation. Don't move audit computation into a representative-runs-only post-pass without also making the deterministic projection populate it — both the chart's Yearly Data table and the CSV export depend on `audit` being present on every breakdown they touch.

`audit.accountFlows` is the one exception: it's populated by `applyCashFlow` (not by the core cash-flow calc) because it depends on the actual pro-rata distribution over current account balances, which is only known after the withdrawal sinks run. Callers of `calculateAnnualCashFlow` (the public wrapper) that don't subsequently invoke `applyCashFlow` will see `accountFlows` as `undefined`; tests that need it should drive `runSimulation()` instead.

Synthetic stack-step IDs `SYNTHETIC_TRAD_WITHDRAWAL_ID` and `SYNTHETIC_SS_AGGREGATE_ID` are exported from `SimulationService.ts` so UI / tests can match against them without duplicating the literal `__trad_withdrawal__` / `__ss_aggregate__` strings.

---

## Required Minimum Distributions

Traditional accounts trigger **RMDs at age 73** (SECURE 2.0). Each year:

1. RMD is calculated on the **beginning-of-year (pre-growth) balance** using the IRS Uniform Lifetime Table — matching the IRS Dec 31 prior-year rule.
2. The simulation forces `withdrawalFromTraditional ≥ rmdRequired`.
3. **Per-owner split:** if an account has `owner: 'spouse'` set, RMD uses the spouse's age. Self and spouse RMDs are computed independently and summed. **Distribution honors ownership** (IRS rule): `applyCashFlow` pulls `rmdSelf` pro-rata from Self-owned Traditional accounts only and `rmdSpouse` pro-rata from Spouse-owned only — a Spouse's IRA cannot satisfy Self's RMD. Per-account RMD shares are surfaced in `audit.rmdByAccount` (sum equals `rmdRequired` within $1) and consumed by the Cash Flow Sankey's column-0 detail. The non-RMD remainder of the Traditional withdrawal (discretionary spending pull + Roth conversion gross) pulls pro-rata across all Traditional accounts (no household-level IRS constraint).
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

- `elective401k` — 401(k)/403(b)/TSP elective deferral cap (default $23,000)
- `iraLimit` — IRA cap (default $7,000)
- `catchUpAge` — age at which catch-up kicks in (default 50)
- `catchUp401k`, `catchUpIra` — extra contribution allowed at/after `catchUpAge`
- `inflationAdjusted` — when true, all caps scale by deterministic mean inflation each year

Caps are enforced **per owner per kind**. An account's "kind" is set on the account itself (`accountKind`: `'401k'` / `'ira'` / `'brokerage'`). When `accountKind` is absent, `traditional` and `roth` accounts default to `'ira'`, and `brokerage` accounts default to `'brokerage'` (uncapped).

Within an `(owner, kind)` group, employee `pre_tax` and `roth` contributions pool against the same cap. When the group exceeds its cap, all of its deposits are scaled proportionally and the cut amount accumulates into `contributionsCappedAmount`. Employer match is scaled proportionally with the employee contribution but does **not** count against the elective deferral cap (the IRS 415(c) total cap that includes match is not modeled). `after_tax` contributions to brokerage accounts are uncapped.

Capped pre-tax dollars stay in `otherTaxableGross` (they were never deducted, so the worker is taxed on them). Capped roth dollars also remain in spendable cash via the originating wage event — the simulation simply skips the over-cap deposit. Whatever cash remains beyond spending and tax in the year is then routed via the surplus pathway (see below) into the first brokerage account.

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

1. RMD is enforced first; the conversion amount is **capped per owner** at that owner's Traditional balance remaining after their own RMD. Self's conversion cap binds independently of Spouse's plenty (and vice-versa).
2. Converted amount is taxed as **ordinary income** in the year of conversion (joint household calculation; per-owner accounting only matters for sourcing).
3. **Routing is per-owner** (IRS rule: a conversion moves one owner's Trad to that same owner's Roth — Spouse's Trad cannot fund Self's conversion). Each conversion event carries `owner` (defaults to `'self'`). The engine routes the Trad pull pro-rata across that owner's own Traditional accounts only, and the Roth deposit pro-rata across that owner's own Roth accounts only. The breakdown surfaces per-owner totals via `rothConversionGrossSelf` / `rothConversionGrossSpouse` (sum = `rothConversionGross`) and per-owner withholding via `rothConversionTaxWithheldSelf` / `Spouse` (sum = `rothConversionTaxWithheld`; withholding splits proportionally to each owner's gross because each owner's 1099-R is independent). If an owner has conversions but no Roth account, `ensureRothConversionAccount` injects a per-owner synthetic (`Roth Conversion` for self, `Roth Conversion (Spouse)` for spouse). The marginal-stack attribution in `computeMarginalStackAttribution` scales per-event conversion gross by per-owner ratio so the displayed per-event gross matches the per-owner cap when one owner is capped and the other isn't.
4. **Conversion tax sourcing is hybrid**, in priority order: (1) **Cash** balance not consumed by spending (above the cash-bucket floor when a policy is configured) — preferred because cash principal is tax-free and avoids the LTCG/NIIT amplification phantom on Brokerage pulls, (2) RMD-excess cash (already pulled from Trad as part of the forced RMD; using it costs nothing extra), (3) Brokerage balance not consumed by spending, (4) withheld from the conversion itself (IRS Form 1099-R Box 4). Tax is **never** pulled from Traditional-above-RMD or Roth — paying conversion tax from Trad would shrink the conversion's tax arbitrage; paying from Roth would deplete the dollars just deposited. When Cash + RMD-excess + Brokerage can't cover the marginal ordinary tax, the conversion still executes at the requested gross — but the Roth deposit shrinks by the withheld amount. This matches real-world Vanguard/Fidelity withholding mechanics. Withholding is mathematically suboptimal vs. paying tax from external accounts (you give up some of the arbitrage), so the Roth Conversion dialog warns when it activates and advises adding Cash/Brokerage funds or reducing the conversion. The breakdown surfaces `rothConversionGross` (Trad pull), `rothConversionRequested` (user intent), `rothConversionTaxFromCash`, `rothConversionTaxFromRmdExcess`, `rothConversionTaxFromBrokerage`, and `rothConversionTaxWithheld`.
5. **Smart spending waterfall**: when any Roth conversion event is in the scenario, the engine defaults `UserData.spendingWithdrawalOrder` to `'bracket_aware'` so spending pulls from Traditional in low-bracket years instead of burning Brokerage. This preserves Brokerage for the high-`mt` conversion years and improves the conversion's net wealth impact — but it only reorders spending sources, it does NOT change the conversion size or conversion-tax sourcing. See **Withdrawal Waterfall** above for the mechanics.
6. If an owner has conversions but no Roth account, a per-owner synthetic Roth account is auto-created (`"Roth Conversion"` for self, `"Roth Conversion (Spouse)"` for spouse).

The Roth Conversion dialog's **Net impact on plan value** row is computed by running the deterministic projection (same single-path engine as the Projected chart line) twice — once with the conversion event included, once without — and diffing the end-of-plan portfolio balance. The other preview rows (first-year tax, total tax, RMD reduction, projected Roth at life expectancy) are fast closed-form estimates against your baseline income and do not include IRMAA or NIIT.

---

## Roth Conversion scheduling

Roth conversions are first-class `roth_conversion` events on `scenario.incomeEvents`. There is no separate "strategy" runtime layer — what you see in the Income panel is exactly what the engine simulates.

Two paths to add conversions, both in the **Roth Conversion** dialog:

1. **Single conversion** — one event with start/end age, COLA, etc.
2. **Plan a multi-year schedule** (generator wizard) — pick a method, click Compute, review the per-year preview table, click Apply to materialize as `roth_conversion` events.

### Generator methods

- **Fill to bracket** — sizes each year's conversion to fill a target federal bracket (`'12_percent'` / `'22_percent'` / `'24_percent'` / `'none'`). Reads the year's baseline ordinary income (wages, pensions, Social Security taxable portion, RMD net of conversion — but **not** the conversion itself; SS taxable portion is computed against ordinary-without-conversion as a single-pass approximation), subtracts the standard deduction (federal-only, including age 65+ extra), and emits `conversionAmount = max(0, top_of_target_bracket − baseline_taxable)`. Compute: ~5 ms.

- **Auto bracket** — grid-searches all four bracket targets, runs the Fill-to-bracket schedule against the deterministic projection for each, scores by the configured `objective`, and picks the winner. Cost: 4× a deterministic projection (~20 ms). The `'none'` candidate scores the user's *true baseline* (no extra conversions, content-aware spending order) so the grid honestly compares "stay where you are" vs "switch to a bracket-fill strategy."

- **Optimize** — coordinate descent on the per-year conversion vector. Seeded from Auto-bracket's winner. For each year, holds the others fixed and runs a 1D line search over conversion-amount candidates (multipliers of the current amount: 0, 0.25×, 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×, plus a logarithmic absolute-dollar probe set `[5, 10, 15, 20, 30, 40, 50, 75, 100]k` when current is 0). Iterates forward + backward sweeps until relative improvement drops below `OPTIMIZE_CONVERGENCE_EPSILON_FRACTION` (0.1%) or `OPTIMIZE_MAX_SWEEPS` (3). Cost: ~600–1500 deterministic projections (~3–7 s). Result exposes `baselineScore` so the dialog reports improvement as "vs your current setup, +$X (+Y%)". Catches cross-year interactions Fill/Auto can't see: converting more in early years shrinks Trad and the forced RMD at 73, expanding bracket headroom later.

**Open-loop caveat.** All three methods optimize against the deterministic projection — the schedule is fixed at compute time and the MC runs follow it regardless of how the stochastic state evolves. On bad paths it will be suboptimal. This matches every production planner; the wizard footer surfaces this warning before Apply.

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

### Objectives

- **`'max_median_terminal_wealth'`** (default) — score = start-of-last-year portfolio balance from the deterministic projection. Higher = better.
- **`'min_lifetime_tax'`** — score = − sum(totalTax) across all years. Higher = better (negated so "argmax" picks the lowest-tax schedule).
- **`'max_floor'`** — reserved (10th-percentile MC terminal wealth). Currently falls back to terminal-wealth scoring; full MC objective is future work.
- **`'max_lifetime_consumption'`** — reserved (discounted sum of spending-actually-delivered). Currently falls back to terminal-wealth; awaits priority-tier spending feedback to become meaningful.

### Spending source order

Independent of conversion sizing. `UserData.spendingWithdrawalOrder` is the only knob:
- `'brokerage_first'` — pulls Brokerage before Traditional.
- `'bracket_aware'` — pulls Traditional up to top-of-12% federal-bracket headroom (conv- and SS-inclusive) before Brokerage.
- `undefined` (auto) — content-aware default: `'bracket_aware'` if any `roth_conversion` event exists, else `'brokerage_first'`. Resolved at sim start by `resolveSpendingWithdrawalOrder` in `src/services/SimulationService.ts`. User overrides via the **Withdrawal Source** radio in the Scenario dialog.

### Legacy `taxStrategy` migration

Scenarios saved before this rework carried `UserData.taxStrategy.cachedVector.perYearDecisions`. On load, `migrateLegacyTaxStrategy` in `src/context/RetirementContext.tsx` materializes the non-zero decisions as tagged `roth_conversion` events (provenance: the strategy that produced them) and strips the `taxStrategy` field. A one-time toast notifies the user. The `UserData.taxStrategy` type field remains for the legacy parse path but is otherwise unused by the engine.

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
- **No state SS exemption** — applied uniformly even in states that exempt SS (CA, NY, etc.).
- **Flat federal LTCG rate** — the 0/15/20% federal LTCG brackets and ordinary-income-stacking interaction are not modeled; capital gains tax is `longTermCapGainsRate × fromBrokerage`.
- **No cost-basis tracking** in brokerage accounts; the entire withdrawal is treated as long-term capital gain (and as investment income for NIIT).
- **IRMAA tier table is 2024** inflation-indexed forward, not refreshed annually; thresholds and surcharge amounts will drift from real IRS figures as Medicare updates the table.
- **IRMAA threshold indexing uses scenario `inflationRate`** as a proxy. CMS's actual formula tracks Part B premium growth and SS COLAs, which can drift from CPI over a 30-year horizon.
- **MFS IRMAA tiers** are approximated with the single-filer table. The actual 2024 MFS table has a compressed 3-tier structure.
- **NIIT investment-income proxy** is the gross brokerage-account withdrawal (no cost-basis tracking), so NIIT is overstated when a significant portion of the withdrawal would actually be return-of-basis.
- **First-2-years IRMAA lookback** comes from a single `priorWorkingMagi` value on `UserData` (used for both year 0 and year 1). Leave at 0 to assume no IRMAA in the first two retirement years.
- **Existing scenarios upgrade behavior** — scenarios saved before the IRMAA/NIIT/state-LTCG additions load with IRMAA and NIIT enabled by default, so tax bills and success probability will differ from prior runs. Disable under Settings → Tax & IRS to recover prior behavior.
- **No ACA premium tax credit modeling** — pre-65 retirees on ACA-subsidized plans may face large effective marginal rates from subsidy phase-outs that the model does not capture.
- **No surviving-spouse bracket shift** — filing status remains MFJ for the full horizon even after one spouse reaches life expectancy.
- **No tax-loss harvesting**.
- **No mortality modeling** — life expectancy is a hard endpoint (see *Horizon and Mortality* above).
- **No Social Security claiming optimization** — you specify the start age directly.
