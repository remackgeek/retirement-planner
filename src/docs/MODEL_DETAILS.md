# YARP Model Details

> Technical reference for the simulation engine, tax calculations, and underlying methodology.

---

## Monte Carlo Simulation

YARP runs **5,000 independent simulations** by default (configurable: 1,000 / 5,000 / 10,000). Each simulation draws a random sequence of annual stock and bond returns and projects every account from today through your life expectancy, applying income, spending, taxes, and withdrawals each year.

### Success Probability

A run is **successful** if portfolio balance never reaches $0 before life expectancy. The reported success probability is the fraction of successful runs.

### Representative Paths

Rather than year-by-year percentile envelopes (which are smooth but synthetic — no actual run produces them), YARP selects the **single simulation run** whose final balance is closest to the 50th percentile (Median) or 10th percentile (Downside) of all final balances.

This means median/downside paths are coherent: the same year's stock and bond return factors drive every line of that run's yearly detail. Tradeoff: the chart lines are slightly less smooth than envelope-based projections, but every number you see is internally consistent and can be attributed to a real return sequence.

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

Each year, after RMD is enforced, withdrawals follow a fixed sequence:

1. **Taxable** — drawn first (lowest tax cost)
2. **Traditional** — ordinary income tax applies
3. **Roth** — drawn last to preserve tax-advantaged growth

### Spending Shortfall

When the portfolio cannot cover the full spending + tax need, the year is recorded with a `spendingShortfall` value showing exactly how many dollars went unmet. The simulation continues — balance is floored at $0 and subsequent years draw from any remaining income (Social Security, pension, etc.). The success-probability metric counts any year where the balance hits $0 as a failed run, regardless of how large the income floor is.

### Cost-of-Living Adjustment (COLA)

Inflation-adjusted income events (Social Security, pensions with COLA, etc.) compound from each event's **own start year**, not from "today." For an event starting at age 67 with a 2.5% COLA, the inflation factor is `(1.025)^(year − startYear)` — so the first payment at age 67 is the entered nominal amount, and amounts grow from there. Different events can use different COLA rates.

---

## Tax Model

### Federal Income Tax

YARP uses **statically defined 2024, 2025, and 2026 tax brackets**. There is no automatic bracket inflation — for any year beyond 2026, the simulation reuses the **2026 brackets unchanged**. This is conservative; real brackets will inflate, but the magnitude depends on legislation.

Four filing statuses are supported: **single**, **married filing jointly (MFJ)**, **married filing separately (MFS)**, and **head of household (HOH)**. Bracket cutoffs and the standard deduction differ for each.

### Income Categories

Tax is computed on two parallel income streams:

```
ordinaryIncome = Traditional withdrawals
               + taxable Social Security portion
               + before-tax income events
               + Roth conversions
capitalGains   = Taxable account withdrawals (taxed at flat LTCG rate)
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

Configured as flat rates applied to **ordinary income only** (Traditional withdrawals, taxable Social Security, before-tax income events, Roth conversions). Capital gains from taxable accounts are **not** subject to state tax in the model — federal LTCG only.

Multiple states are supported via a **relocation timeline**: enter a future move year and the simulation switches the state rate in that year.

Two simplifications worth knowing:
- **Social Security** is taxed at the full state rate even though several states (CA, NY, NJ, etc.) exempt SS from state income tax. If you live in such a state, the model slightly overstates state tax during SS years.
- State **capital gains** are not modeled. If you live in a state that taxes capital gains as ordinary income (CA, etc.), the model slightly understates state tax during years with large taxable-account withdrawals.

### Deductions

- **Standard deduction** — filing-status base, plus an age-65+ add-on (~$1,950–$2,050 per qualifying senior, indexed by year). Both members of a married couple can independently qualify.
- **OBBBA bonus senior deduction** — applied automatically when active. Hardcoded mechanics (not user-configurable):
  - $6,000 base per qualifying senior (age 65+)
  - 6% phase-out above $75,000 AGI (single) / $150,000 AGI (joint)
  - Active **2025–2028 only** — does not apply in later retirement years

---

## Required Minimum Distributions

Traditional accounts trigger **RMDs at age 73** (SECURE 2.0). Each year:

1. RMD is calculated on the **beginning-of-year (pre-growth) balance** using the IRS Uniform Lifetime Table — matching the IRS Dec 31 prior-year rule.
2. The simulation forces `withdrawalFromTraditional ≥ rmdRequired`.
3. **Per-owner split:** if an account has `owner: 'spouse'` set, RMD uses the spouse's age. Self and spouse RMDs are computed independently and summed.
4. **Excess RMD** beyond the spending need is reinvested into the first taxable account. If none exists, a `"Reinvestment"` taxable account is auto-created in the working simulation copy (not persisted). The same synthetic account also receives general surplus (see Surplus Handling below).
5. RMD is **not eligible** for Roth conversion (IRS rule). Roth accounts are exempt from RMD.

---

## Wage Income and Retirement Contributions

`wage_income` events are taxable ordinary income (always `before_tax`). They flow into `otherTaxableGross` exactly like a pension or part-time work event.

`retirement_contribution` events are **deposit instructions, not income**. They never add to spendable cash. Each event carries a `contributionType`:

- **`pre_tax`** — the contribution amount is subtracted from `otherTaxableGross` before the tax calc, then deposited to the target Traditional account. The deduction is floored at zero (you can't reduce taxable income below zero).
- **`roth`** — no tax effect; deposited to the target Roth account.
- **`after_tax`** — no tax effect; deposited to the target Taxable account.

If the event's `accountId` doesn't match the contribution type (or is omitted), the simulation falls back to the first account of the implied type, then to the first account of any type.

**Employer match** is configured per contribution event with `employerMatchPercent` and `employerMatchCeilingPercent`. The match base is either the linked `wageEventId`'s annual amount (when set) or the contribution amount itself. The match is `matchRate × min(employeeContribution, ceilingRate × matchBase)`. Match dollars are deposited to the **same target account** as the employee contribution — a documented simplification (in reality, employer match for a Roth 401(k) historically went to the pre-tax bucket; SECURE 2.0 allows it Roth, but the model keeps things simple).

### Contribution Limits

Per-scenario IRS limits are configured under Modeling → Contribution Limits:

- `elective401k` — 401(k)/403(b)/TSP elective deferral cap (default $23,000)
- `iraLimit` — IRA cap (default $7,000)
- `catchUpAge` — age at which catch-up kicks in (default 50)
- `catchUp401k`, `catchUpIra` — extra contribution allowed at/after `catchUpAge`
- `inflationAdjusted` — when true, all caps scale by deterministic mean inflation each year

Caps are enforced **per owner per kind**. An account's "kind" is set on the account itself (`accountKind`: `'401k'` / `'ira'` / `'brokerage'`). When `accountKind` is absent, `traditional` and `roth` accounts default to `'ira'`, and `taxable` accounts default to `'brokerage'` (uncapped).

Within an `(owner, kind)` group, employee `pre_tax` and `roth` contributions pool against the same cap. When the group exceeds its cap, all of its deposits are scaled proportionally and the cut amount accumulates into `contributionsCappedAmount`. Employer match is scaled proportionally with the employee contribution but does **not** count against the elective deferral cap (the IRS 415(c) total cap that includes match is not modeled). `after_tax` contributions to brokerage accounts are uncapped.

Capped pre-tax dollars stay in `otherTaxableGross` (they were never deducted, so the worker is taxed on them). Capped roth dollars also remain in spendable cash via the originating wage event — the simulation simply skips the over-cap deposit. Whatever cash remains beyond spending and tax in the year is then routed via the surplus pathway (see below) into the first taxable account.

---

## Surplus Handling

Whenever annual cash flow leaves money on the table — `netCashFlow > 0` after income, contributions (capped), spending, and tax — that surplus is deposited into the **first taxable account**.

- Routing is unconditional: surplus always goes to taxable, never to Traditional or Roth.
- If no taxable account exists in the user's configuration, `ensureReinvestmentAccount` injects a $0 synthetic `"Reinvestment"` taxable account (60/40 allocation) into the working simulation copy. This is the same account used for RMD excess reinvestment — the two pathways share one synthetic account, never two.
- The synthetic account is not persisted to `UserData`. It only exists for the duration of the simulation run.
- When the portfolio cap is binding (depletion year), there is no surplus by definition; `surplusContribution` is 0.

`AnnualCashFlowBreakdown.surplusContribution` records the dollars deposited as surplus each year and is exposed in the yearly-data detail rows and CSV export.

`AnnualCashFlowBreakdown` exposes `wageIncomeGross`, `preTaxContributions`, `rothContributions`, `afterTaxContributions`, `employerMatch`, and `contributionsCappedAmount` for visibility in detail rows and CSV export.

---

## Roth Conversions

A `roth_conversion` income event moves money from Traditional to Roth accounts. Unlike other income types, the converted amount **does not contribute to spendable cash** — it's a transfer. Mechanics:

1. RMD is enforced first; the conversion amount is **capped at the Traditional balance remaining after RMD and spending withdrawals**.
2. Converted amount is taxed as **ordinary income** in the year of conversion.
3. Withdrawal is pro-rata across Traditional accounts; deposit is pro-rata across Roth accounts.
4. Tax owed on the conversion is paid implicitly by the regular waterfall — Taxable first if available, otherwise Traditional (which reduces the convertible amount further).
5. If no Roth accounts exist, a `"Roth Conversion"` Roth account is auto-created.

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
| Number of simulations | 5,000 |
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

- **No federal bracket inflation** — post-2026 brackets are static; real outcomes for late retirees may be slightly more favorable than projected.
- **No SS provisional thresholds inflation** — these are frozen by Congress, so this matches reality, but the resulting "tax torpedo" gets steeper over time.
- **No stochastic inflation in cash flows** — only portfolio deflation uses per-run inflation; income/spending use the deterministic mean.
- **No state tax on capital gains** — federal LTCG only.
- **No state SS exemption** — applied uniformly even in states that exempt SS (CA, NY, etc.).
- **No cost-basis tracking** in taxable accounts; the entire withdrawal is treated as long-term capital gain.
- **No tax-loss harvesting**.
- **No mortality modeling** — life expectancy is a hard endpoint (see *Horizon and Mortality* above).
- **No Social Security claiming optimization** — you specify the start age directly.
- **Fixed withdrawal order** (Taxable → Traditional → Roth); no fill-to-bracket Roth conversion or tax-aware withdrawal ordering yet.
