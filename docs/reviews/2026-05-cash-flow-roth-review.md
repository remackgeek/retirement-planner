# Review: Cash Flow & Roth Conversion Feature Set

*Diagnostic written 2026-05-26. Captures findings only — no implementation scoping. Follow-on work is triaged separately.*

## Context

The user felt the cash flow + Roth conversion feature set "didn't feel right" and asked for a thorough review of modeling assumptions, usability, guardrails, and reasonableness, with reference to how other planners handle the same problems. **This document is diagnostic only.** It captures findings but does not scope implementation work.

Weighted toward three areas: **modeling correctness**, **bundled-comparison / preview honesty**, and **guardrails & warnings**. The other-planner comparison and the longer UX list are kept but compressed.

The engine is well-structured around a three-layer model (intent → funding source / cross-year spending policy / strategy plug-in) and the phantom-tax principle is genuinely better than what most consumer planners ship. The issues below are mostly at the seams between layers, in the honesty of the previews, and in the absence of warnings users need to make informed choices.

---

## 1. Bundled-Comparison / Preview Honesty (top concern)

### 1.1 Net Impact silently bundles two effects
When a user adds a `roth_conversion` event, `resolveSpendingWithdrawalOrder` in [src/services/SimulationService.ts:2013](../../src/services/SimulationService.ts#L2013) flips the spending waterfall from `brokerage_first` → `bracket_aware`. The Roth Conversion dialog's **Net impact** row in [src/dialogs/RothConversionDialog.tsx:871-929](../../src/dialogs/RothConversionDialog.tsx#L871-L929) bundles two distinct effects into one number:

1. The conversion itself (Trad → Roth, ordinary tax now for tax-free growth later).
2. The withdrawal-order change (Trad-up-to-12%-bracket before Brokerage across **all** years).

Concrete failure mode: a user adds a conversion, Net Impact reads +$50k, they conclude "conversions are worth $50k." Later they flip Withdrawal Source back to `brokerage_first` in [src/dialogs/ScenarioDialog.tsx:427-467](../../src/dialogs/ScenarioDialog.tsx#L427-L467), Net Impact drops to +$10k, and they cannot tell whether they broke something or whether the original number lied. CLAUDE.md lines 297–309 flag this explicitly as the "bundled-comparison property" and mark it for a future layer-3 fix. The dialog's disclaimers (lines 899–927) mention the bundling in prose but never decompose the figure.

A truthful preview would show two rows ("Effect of conversion alone: +$X" + "Effect of switching to bracket-aware withdrawal: +$Y") that sum to the existing total. Cost: one extra deterministic projection (~5ms).

### 1.2 "Auto (recommended)" hides what it resolved to
The Scenario dialog shows the Withdrawal Source radio with "Auto (recommended)" as the default option but never surfaces the resolved value. A user cannot tell whether they are currently on `bracket_aware` or `brokerage_first`. The information exists at runtime (the simulation already computed it); nothing surfaces it.

### 1.3 Wizard schedule preview is deterministic; MC uncertainty arrives only after Apply
The wizard's generated schedule table shows Year / Age / $Amount and one deterministic Net Impact. A user can reasonably read it as "the wizard says I'll have $500k in Roth by 2040." In reality it is the median deterministic projection; Monte Carlo outcomes only appear after Apply. Adding a single line — "Projected success probability with this schedule: X% (vs Y% baseline)" — would cost ~250ms (one MC via the existing Web Worker pool) per Apply preview and would honestly communicate that the schedule was optimized against expected returns, not guaranteed.

### 1.4 No upfront notice that adding a conversion flipped the waterfall
The first time a user adds a conversion event, the engine silently switches them from `brokerage_first` to `bracket_aware`. No toast, no inline note, no marker in the Scenario dialog. The "Auto" default is doing work the user cannot see.

---

## 2. Modeling Assumptions Worth Questioning

### 2.1 Cash yield is deterministic 4% in every Monte Carlo run
[SimulationService.ts:2098](../../src/services/SimulationService.ts#L2098) credits `cashYieldRate ?? 0.04` regardless of return model, black swans, or path. CLAUDE.md describes cash as "non-volatile by construction." That is defensible for principal but creates an **implicit volatility floor**: no MC downside path can ever look as bad as the historical reality of HYSA rates dropping to 0.05% (2010–2021) while inflation stayed positive. A 30%-cash portfolio gets a guaranteed 4% real-dollar floor on a large slice of the portfolio every year. Two ways out: (a) expose `cashYieldRate` editable per-scenario with a documented "constant across all paths" assumption, or (b) add `cashYieldStdDev` and model the yield with a simple short-rate / random-walk process.

### 2.2 Capital-gains bracket stacking is not modeled
[SimulationService.ts:1444,1711](../../src/services/SimulationService.ts#L1444) uses a flat `longTermCapGainsRate`. Real federal LTCG is 0% / 15% / 20% **stacked on ordinary income** — the bracket each gain falls into depends on the gain's position above ordinary AGI. A retiree filling the 12% bracket with a conversion is also filling the 0% LTCG bracket; that is a Kitces-standby strategy ("fill the 0% bracket") and the current model is blind to both the opportunity and the inverse risk (a conversion that pushes ordinary income high enough to bump LTCG from 0% to 15% on a separately-realized taxable sale).

### 2.3 IRMAA / NIIT cliff blindness in bracket headroom
CLAUDE.md lines 368–370 documents both. Filling the 12% bracket can push the 2-year-prior MAGI lookback into a future IRMAA tier ($500–$1,000+/yr) or trip NIIT ($200k single / $250k MFJ × 3.8%) on the same Brokerage-funded conversion tax that the conv-tax-sourcing rule prefers. The Optimize backend sees these in the score function but does not aim against them in candidate generation. Bracket-aware headroom does not see them at all. For pre-Medicare retirees converting heavily, this can entirely invert which schedule is optimal.

### 2.4 SS-torpedo second-order in bracket headroom is bounded but untested
[SimulationService.ts:1367-1389](../../src/services/SimulationService.ts#L1367-L1389) computes `ssTaxable` against ordinary income **without** the spending Trad pull. A pull that bumps SS from 50% to 85% taxable means headroom was over-claimed. CLAUDE.md describes the overshoot as bounded by the 85% SS-taxable ceiling. No test scenario exercises the case where bracket-aware claims headroom and the actual Trad pull tips SS into a higher zone. Bounded does not mean zero — for SS-heavy retirees the realized over-pull is real, just small.

### 2.5 OBBB deduction omission silently flips behavior post-2028
The bracket-aware headroom deliberately excludes the 2025–2028 OBBB extra senior deduction to avoid a circular fixed-point against the Trad pull itself (CLAUDE.md lines 362–365). After the 2028 sunset, the headroom suddenly behaves identically (no OBBB to exclude). A user comparing 2027 vs. 2029 plans sees headroom **increase** for reasons that look like a bug. The transition is smooth; it is also undocumented anywhere user-visible.

### 2.6 Conversion-requested vs. -executed mismatch in headroom
CLAUDE.md lines 380–382 — bracket-aware headroom uses the **requested** conversion gross, not the **executed** amount post-Trad-balance cap. When Trad balance constrains the real conversion to (say) 60% of requested late in the schedule, bracket-aware reserves headroom that the conversion will not actually use, so the spending Trad pull is conservatively tight. Documented as "never unsafe" but a real efficiency loss.

### 2.7 Fixed-point convergence is absolute, not relative
[SimulationService.ts:1733](../../src/services/SimulationService.ts#L1733) — convergence at `|Δwithdrawal| < 0.01`. For a $10M+ portfolio with stacked state LTCG + NIIT + IRMAA interactions, $0.01 absolute can still be a basis point of error. A relative epsilon (`|Δw| / max(w, 1) < 1e-5`) is the standard fix.

### 2.8 Pro-rata rule / basis tracking absent
All Traditional balances are treated as 100% taxable on withdrawal. Users with non-deductible Traditional contributions (after-tax basis) are over-taxed in the model. Adds one field on `Account` and one branch in `applyCashFlow`; the UX is the harder part (users must know what basis is to enter it).

### 2.9 State retirement-income exclusions ignored in headroom
NY $20k IRA/pension exclusion, VA 65+ age deduction, SC retirement-income exclusion. These widen real bracket space by $5k–$20k in those states. Bracket-aware is conservatively tight there — the state profile is queried for tax calculation but not for headroom sizing.

### 2.10 Survivor / ACA APTC unmodeled (known out-of-scope)
Listed for completeness — spouse death + filing-status transition, and ACA premium-tax-credit cliffs for under-65 retirees, are both known omissions. The ACA gap is arguably the biggest real-world hole for a 55–64 user converting heavily.

---

## 3. Guardrails & Warnings — What's Missing

**Present (correctly):**
- Three heuristic warnings on the conversion dialog: exceeds-spending, crosses-multiple-brackets, exceeds-most-of-Trad ([RothConversionDialog.tsx:346-403](../../src/dialogs/RothConversionDialog.tsx#L346-L403)).
- A withholding/shortfall warning when the deterministic projection shows withholding fires.
- Min ≤ target ≤ max validation on Cash Bucket inputs.
- Contribution caps enforced per (owner, kind) with proportional scaling.

**Missing:**

### 3.1 No quantified withholding-shortfall summary pre-Apply
The withholding warning fires but does not say **how much** will be withheld in **which years**. A line like "Years 2031–2033 will withhold ~$3,200/yr because your Brokerage cannot cover the conversion tax — net Roth deposit reduced by ~$9,600 total" would tell the user whether to (a) reduce the conversion, (b) move more to Brokerage beforehand, or (c) accept the suboptimal arbitrage. The data is already in `estimateConversionImpact` (CLAUDE.md mentions `conversionWillBeWithheldYears` / `Dollars`); it just isn't surfaced as a quantified row.

### 3.2 No warning when the conversion will be capped by Trad balance
If the deterministic projection shows the conversion gets capped (Trad balance exhausts mid-schedule), the user discovers this only after Apply. The Impact Preview could surface "Conversion will be capped in years 2034–2036 — your requested $50k/yr will execute as ~$30k/yr."

### 3.3 No notice when the auto-default flipped the withdrawal order
Adding a conversion silently switches `brokerage_first` → `bracket_aware` (see §1.4). No toast, no marker on the Scenario dialog, no inline note in the conversion dialog.

### 3.4 "No conversions" option in Fill-to-bracket is misleading
[RothConversionDialog.tsx:222-227](../../src/dialogs/RothConversionDialog.tsx#L222-L227) offers `'12% bracket'`, `'22% bracket'`, `'24% bracket'`, `'No conversions'`. The first three size each year's conversion to fill that bracket. "No conversions" is meaningful as an **Auto-bracket candidate** (the true baseline) but as a Fill-to-bracket user pick it generates an empty schedule — a confusing no-op that looks like a "cancel" button.

### 3.5 Unimplemented optimizer objectives are advertised
The Optimize objective dropdown lists `max_floor` and `max_lifetime_consumption`. Both silently fall back to `max_median_terminal_wealth` (CLAUDE.md confirms). A user picking "Maximize floor" gets terminal-wealth scoring with no warning that the option is not actually wired up.

### 3.6 Auto-bracket's "Nothing to apply" win message
When Auto-bracket's grid search picks `'none'` as the winner, the dialog says "Nothing to apply." A user reads that as "the wizard found nothing useful." The honest message is "Your current setup is optimal — no scheduled conversions improved the plan vs. doing nothing."

### 3.7 Cash bucket defaults (6/18/36, gains_only) are unjustified in the UI
[CashBucketDialog.tsx:87-92](../../src/dialogs/CashBucketDialog.tsx#L87-L92) chooses sensible defaults but never tells the user the rationale. No tooltip explains why 18 months is the target, why `gains_only` is recommended, or what the Kitces 2-bucket reasoning is. Users either trust the defaults blindly or change them without a model.

### 3.8 Bracket-headroom formula is opaque
The Scenario dialog tooltip says "pulls Trad up to the top of the 12% federal bracket." A user verifying the math has no way to see which deductions are included, whether SS is folded in, or what the actual headroom is for a given year. Surfacing the per-year headroom in the yearly data detail row would close this.

### 3.9 Cash-yield edit is disconnected from the AccountDialog
The Account dialog shows cash yield as read-only "set in Modeling." A user adding a cash account has to leave the dialog, find Modeling, find the yield (which only appears when a cash account exists — circular), edit it, and return. Either inline-edit it in the Account dialog or add a direct link.

### 3.10 Owner field rationale never explained
The Account dialog's Owner dropdown (Self / Spouse, shown for Traditional accounts when spouseAge is set) drives per-spouse RMD splits with different ages. No tooltip; the dropdown looks decorative.

---

## 4. Strategy Backends — Real but Subtler Issues

- **Optimize terminal-wealth scoring** under-weights short-horizon volatility and gives candidates with higher bond allocation a slight bias (lower terminal-year variance). Industry-standard default, but the StrategyRationale panel should plainly say "scored against deterministic terminal balance, not Monte Carlo success probability." Currently it does not.
- **Open-loop assumption** (vector baked at sim start, MC paths do not re-optimize) is honestly disclaimed; no change needed.
- **Auto-bracket's `'none'` candidate** correctly uses the user's true baseline (content-aware spending order, no synthetic conversions). The implementation is right; only the win-message copy (§3.6) is wrong.

---

## 5. Test Coverage Gaps

The test runner is solid generic infrastructure. The gap is data files. Highest-risk missing compositions:

1. **Roth conversion + cash bucket refill with `gains_only` trigger.** The interaction that motivates phantom-tax archetype #3 (the refill-LTCG leak) has zero test coverage. A refactor that re-introduces phantom LTCG would not be caught.
2. **Conversion + IRMAA 2-year lookback transition.** No scenario with `priorWorkingMagi` + first-year conversion + age-65 onset + year-3 IRMAA tier change.
3. **Conversion + NIIT threshold crossing during Brokerage-funded conversion tax.** Does the fixed-point converge correctly when the conv-tax-source pull itself trips NIIT?
4. **Conversion + state retirement exclusion (NY $20k, VA 65+).** Bracket-aware should be conservative; needs verification.
5. **SS-torpedo verification.** Scenario where bracket-aware headroom assumes 50%-SS-taxable but the spending Trad pull bumps SS to 85% — does actual year-end MAGI stay within target bracket?
6. **Conversion during a historical bad cohort (1966–1982).** Capping behavior when Trad depletes during a drawdown.

---

## 6. How YARP Compares (compressed)

**Where YARP is genuinely ahead** of consumer planners:
- Phantom-tax principle documented and structurally enforced.
- Hybrid conversion-tax sourcing (Cash → RMD-excess → Brokerage → withhold) matches Kitces / Vanguard BETR best practice.
- Surplus-only cash refill (never sell Brokerage to refill cash) is structurally enforced by the post-convergence step's type-safety.
- Per-owner RMD splits.

**Where YARP lags:**
- No goal/MAGI-target selector (Boldin lets users say "stay under IRMAA tier 2").
- No IRMAA-aware sizing (ProjectionLab and Boldin treat IRMAA tiers as constraints).
- No 0% LTCG bracket fill (consequence of the flat LTCG model).
- No dynamic withdrawal priority (the `gains_only` idea is implemented for refill, not for spending).
- No ACA APTC modeling (critical for 55–64 conversion-heavy users).

**Where everyone punts:** true multi-year DP/Bellman optimizer, surviving-spouse transitions (Boldin and PL do it, YARP and HonestMath do not), basis tracking / pro-rata.

---

## 7. Critical Files for Follow-up

| File | Why it matters |
|---|---|
| [src/services/SimulationService.ts](../../src/services/SimulationService.ts) | `calculateAnnualCashFlowCore` (1394–1930) — fixed-point loop, waterfall, conversion tax sourcing, headroom precompute (1367–1389), `resolveSpendingWithdrawalOrder` (2013–2026), `applyPostConvergenceBucketPolicy` (423–502), cash yield (2098). |
| [src/dialogs/RothConversionDialog.tsx](../../src/dialogs/RothConversionDialog.tsx) | Two-mode UX, wizard, Impact Preview, warnings — the bundled-comparison surface. |
| [src/dialogs/ScenarioDialog.tsx](../../src/dialogs/ScenarioDialog.tsx) | Withdrawal Source radio (427–467). |
| [src/dialogs/CashBucketDialog.tsx](../../src/dialogs/CashBucketDialog.tsx) | Min/target/max + trigger. |
| [src/services/strategies/](../../src/services/strategies/) | Fill-to-bracket, Auto-bracket, Optimize backends. |
| [src/services/conversionImpact.ts](../../src/services/conversionImpact.ts) | `estimateConversionImpact` — drives Impact Preview; already has the withholding-year data that §3.1 needs to surface. |
| [src/components/IncomeEventsManager.tsx](../../src/components/IncomeEventsManager.tsx) | Generator-event grouping (180–328). |
| [test/scenarios/](../../test/scenarios/) | Coverage gaps. |

---

## 8. Follow-up

This document is diagnostic only. When the user picks a slice to act on, a separate plan will scope the implementation, the unit tests, and any new scenario JSONs needed (per CLAUDE.md testing rules).

**First follow-on plan (2026-05-26):** Add a Cash Flow Sankey tab to the yearly data detail row, making per-year mechanics legible. Plan lives at `~/.claude/plans/review-the-cash-flow-resilient-hennessy.md`. This is the user's preferred response to §1's bundled-comparison opacity — make the mechanics visible rather than expose the policy lever.
