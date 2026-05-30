# YARP User Guide

> *"Essentially, all models are wrong, but some are useful."*
> — George E. P. Box & Norman R. Draper, *Empirical Model-Building and Response Surfaces* (1987)

**App URL:** [yarp.bluewiz.net](https://yarp.bluewiz.net)

---

## What YARP Is For

YARP is a **planning tool, not financial advice** — not a substitute for a financial advisor, tax professional, or estate attorney. It sits between simple calculators and full financial-planning platforms, and it's good for answering questions like:

- Can I retire at 62 instead of 65?
- What happens if the market drops 30% the year after I retire?
- Should I move to a no-income-tax state?
- Should I convert some of my Traditional IRA to Roth in my 60s?
- How much can I safely spend each year?

Use it to **explore the shape of your retirement** — what decisions matter most, where your plan is fragile, how sensitive things are to assumptions. Projections are estimates; real outcomes will differ, sometimes substantially.

It's **not** the right tool for: estate planning, long-term care projections, insurance products, real estate transactions, or tax-loss harvesting strategies. For those, see a professional.

---

## Your Data Stays With You

YARP runs entirely in your web browser. **No account to create, no server, no upload of your financial data.** Everything you enter stays on your device.

- **Privacy by design.** No tracking, no analytics, no selling anything.
- The flip side: if you clear your browser, switch computers, or use a different browser, your scenarios won't be there. **Back them up periodically** — see the *Backing Up Your Data* section near the end.

---

## Getting Started

The first thing to do is create a baseline scenario that reflects your current plan. Don't try to optimize on the first pass — just get a realistic picture in.

If you'd rather kick the tires before entering your own data, the empty sidebar offers three pre-populated example scenarios under **or try an example** (Near retirement, Retired early, Mid-career). The same options live under **Settings → Load example…** once you have scenarios of your own. Loading an example appends a new scenario and makes it active — you can edit, rename, or delete it freely.

1. Click **New Scenario** in the sidebar and give it a name like "Baseline".
2. Enter your **current age** and a **life expectancy** to plan to. Using a high number — 95 or 100 — gives you a margin against living longer than you expect. (There's no "retirement age" field — your retirement timing comes from the start ages of the income events and spending goals you add below: when your salary ends, when Social Security starts, when living expenses begin.)
3. Add your **accounts** with their current balances. Group similar accounts if you want; YARP doesn't need every individual line.
4. Add your **income events** — Social Security, any pension, current paycheck contributions if you're still working.
5. Add your **spending goals** — at minimum, your annual living expenses. Add big one-time items (a new roof, a wedding gift) separately.
6. Set your **tax** info: filing status and state.
7. The chart updates automatically. There is no "Run" button.

Once your baseline looks right, **clone it** to start exploring "what if?" variations.

---

## Scenarios

A scenario is a complete snapshot of your plan. Most people end up with several:

- A baseline reflecting your current plan
- "What if I retired 2 years earlier?"
- "What if I spent $1,000/month more?"
- "What if I moved to Florida?"
- "What if I did Roth conversions in my 60s?"

You can compare any two scenarios on the chart side-by-side (see *Comparing Scenarios* below).

### The probability number and badge

The percentage is the share of simulated future market sequences in which your plan didn't run out of money:

| Badge | Range | What it means |
|---|---|---|
| **Excellent** | 90% or higher | Plan holds up in nearly every scenario. You may have room to spend more or retire earlier. |
| **Good** | 75–89% | Holds up in most scenarios. Some risk in severe downturns. |
| **Fair** | 50–74% | Succeeds more often than not, but the downside is real. |
| **At Risk** | Below 50% | More likely to fall short than succeed. Time to make changes. |

Don't chase 100%. A 95% success rate with comfortable spending usually beats a 100% rate with miserable spending.

---

## Accounts

YARP recognizes four kinds of accounts based on how they're taxed:

| Type | Examples | When you withdraw |
|---|---|---|
| **Traditional** | 401(k), Traditional IRA, 403(b) | Taxed as ordinary income |
| **Roth** | Roth IRA, Roth 401(k) | Tax-free |
| **Brokerage** | Brokerage account (with cost basis, stock/bond holdings) | Taxed as long-term capital gains |
| **Cash** | Money-market fund, HYSA, short-term Treasury | Principal is tax-free; yield is taxed as ordinary income |

For each non-cash account, enter the current balance and pick a stock/bond mix (80/20, 60/40, or 50/50). You can mix and match — for example, a more aggressive 80/20 in your Roth and a conservative 50/50 in your Traditional. Cash accounts don't have a stock/bond mix; they use a deterministic yield rate (default 4%, matching typical MMF / HYSA rates). You can edit that rate right in the cash account dialog or under **Modeling** — it's scenario-wide, so it applies to every cash account.

### When to use Cash vs Brokerage

Pick **Cash** when modeling money you'd normally consider "the bucket I draw from when markets are down" — your emergency fund, a high-yield savings account, a money-market sweep. Cash in YARP is non-volatile: it doesn't move with stocks or bonds, doesn't get touched by black-swan events, and its yield is taxed as ordinary income the year it accrues (matching real-world MMF / HYSA reporting). Withdrawing principal is tax-free.

Pick **Brokerage** when modeling a brokerage account with stock/bond holdings where withdrawals realize long-term capital gains. Volatile, subject to market shocks, taxed at LTCG rates on withdrawal.

### How withdrawals work

YARP draws from your accounts in this order each year: **Cash first** (tax-free principal), **then Brokerage, then Traditional, then Roth**. Pulling cash first avoids realizing capital gains and the cascading NIIT (Net Investment Income Tax) those gains can trigger. When you have no cash account, the Cash step is just skipped.

### Cash Bucket policy (optional)

If you have a cash account and want YARP to actively manage it — refilling from market gains and sweeping when it gets too large — open **Settings → Cash Bucket** (this menu item only appears when at least one cash account exists). The dialog has four controls:

- **Min months** — the floor. Spending pulls Cash only down to this many months of total annual spending; below that, spending falls through to Brokerage. This reflects how much liquid cash you actually want to keep on hand. A typical value is 6.
- **Target months** — the refill goal. When the engine refills the cash bucket from a year's surplus income, it tops up to this band. A typical value is 12–18 months.
- **Max months** — the ceiling. If cash drifts above this, the excess is swept back into Brokerage as a tax-free balance transfer. Typical: 24–36 months.
- **Refill trigger** — when does the engine actually refill?
  - *Gains only (recommended)* — refills only in years with positive stock returns. Bear-market aware: won't try to top up the bucket while equities are down.
  - *Above baseline* — strictest. Refills only when the portfolio is ahead of the deterministic baseline.
  - *Always* — refills any year with surplus. Conservative but can lock in down-market dollars as cash.
  - *None (manual)* — no automatic refill or sweep. You manage the cash balance yourself by editing it directly.

**Refill is surplus-only.** The engine will never sell securities in your Brokerage account to top up cash — it only redirects this year's positive net cash flow. If a year has no surplus, the bucket simply doesn't refill that year (which is exactly what should happen in a bad year).

**Sweep is tax-free.** When cash overflows the maximum, moving it back into Brokerage does not realize capital gains — it's a balance transfer between two already-taxed buckets.

### Required Minimum Distributions (RMDs)

Once you turn **73**, the IRS requires you to withdraw a minimum amount from Traditional accounts each year, whether you need the money or not. YARP handles this automatically: it forces the minimum withdrawal, taxes it as ordinary income, and reinvests anything you didn't actually need into a brokerage account. Roth accounts don't have RMDs.

### Surplus reinvestment

In any year where your income exceeds your spending and taxes, the leftover cash is deposited into your first brokerage account. If you don't have one, YARP creates a synthetic "Reinvestment" account during the simulation so surplus is never silently lost. The yearly data detail rows and CSV export show this as **Surplus Contribution**.

If you're married and have Traditional accounts in both your names, YARP calculates each person's RMD using their own age — set the **owner** (Self / Spouse) on each account.

---

## Income Events

Income events cover everything flowing **into** your portfolio. Common ones:

- **Social Security** — has its own dialog. You can model the 2034 trust-fund haircut if you want to be conservative.
- **Pension** — usually with no cost-of-living adjustment.
- **Part-time work / consulting** in retirement
- **Rental income, annuity payments**
- **Inheritance, gifts** (these come in tax-free — mark them as "after-tax")
- **Salary** (W-2 wages) — taxed as ordinary income, ends at retirement
- **Retirement contributions** — pre-tax 401(k), Roth, or after-tax savings; deposited into the chosen account

Each event has a start age, an optional end age, and an optional cost-of-living adjustment to grow the amount over time.

### Salary and Retirement Contributions (working years)

If you're still working, model your earnings and savings as two separate events:

- **Salary** captures your W-2 wages. It flows into spendable cash and is taxed as ordinary income (federal + state, plus FICA isn't modeled — use after-tax-equivalent if you want a clean accounting).
- **Retirement Contribution** captures the slice of those wages going into a retirement account. Pick one of three flavors:
  - **Pre-tax** — reduces this year's taxable income and deposits to a Traditional account.
  - **Roth** — no tax break today; deposits to a Roth account; growth and qualified withdrawals are tax-free.
  - **After-tax** — deposits to a brokerage account; growth taxed at LTCG on withdrawal.

Optional: an **employer match** (e.g. "100% up to 6% of wages") deposits additional dollars to the same account as your contribution. Link the contribution to a specific salary event so the match ceiling is computed against the actual wage base.

Contributions are *deposit instructions* — they do not show up as spendable cash. If you contribute $20k pre-tax against a $100k salary, the simulation taxes $80k and deposits $20k to your Traditional account.

#### Contribution Limits

YARP enforces IRS contribution caps per owner per account kind. Configure the limits under **Settings → Tax & IRS → Contribution Limits**:

- 401(k)/403(b)/TSP elective deferral (default $23,000)
- IRA limit (default $7,000)
- Catch-up age (default 50) and catch-up amounts
- Optionally, scale the caps by inflation each year

Mark each tax-advantaged account as **IRA** or **401(k)/403(b)/TSP** in the account dialog. Pre-tax and Roth contributions to the same `(owner, kind)` group share the same cap. Employer match is **not** counted against the elective deferral cap. Excess contributions are not deposited; capped pre-tax dollars remain taxed (since the deduction is reduced) and otherwise stay in spendable cash via the originating wage event. Any capped amount is visible as **Contributions Capped** in the yearly detail rows.

### Roth Conversions

A Roth conversion moves money from your Traditional accounts into your Roth accounts. Three things to know:

- **It's not income you can spend** — it's an internal transfer between buckets.
- **You owe tax on the converted amount** in the year you do it (it counts as ordinary income).
- **You have to take your RMD first** if you're 73 or older — the IRS doesn't let RMDs be converted.
- **Conversions are per-owner** — if you mark a conversion as Self, it pulls only from your Self-owned Traditional accounts and lands only in your Self-owned Roth; same for Spouse. The engine will not cross-mix the two spouses' retirement accounts. If you have plenty in Spouse's Trad but only a little in Self's, marking the conversion as Self will cap it at the Self-Trad balance.

The classic strategy is to convert in the low-income years between retirement and age 73, filling up the lower tax brackets to reduce your future RMDs. YARP lets you model exactly how much that strategy is worth in your situation. **YARP automatically picks the better of two spending strategies for your specific scenario** — "brokerage-first" (pull Brokerage before Traditional; conservative) vs "bracket-aware" (pull Traditional up to the 12% federal bracket first, preserving Brokerage for high-tax years). The engine runs both quickly at sim setup and uses whichever wins on your portfolio's projected real terminal balance. You don't choose; the engine does. (Previously this was gated on whether you had any conversions scheduled, which led to surprise jumps when adding even a tiny conversion. Now it's symmetric — the engine just does its best regardless.)

The Roth Conversion dialog shows an **Impact Preview** with a deterministic estimate of first-year tax, total tax over the conversion window, RMD reduction at 73, and projected tax-free Roth at life expectancy. The **Net impact on plan value** row signs the trade-off in dollar terms (green when the conversion pays off, red when it costs more than it saves). That row runs the full deterministic simulation twice — once with the conversion, once without — and diffs the end-of-plan balance, so it reflects everything the Projected chart line does: the RMD withdrawal waterfall, IRMAA surcharges, NIIT, state tax on LTCG, and how conversion tax is sourced from your accounts. Multi-year conversions default to **inflation-adjusted**, so the amount you enter is a real-dollar target — turn that off if you mean a fixed nominal schedule. If you configure a conversion that is unusually large relative to your spending, crosses two or more federal brackets in a single year, or would convert most of your Traditional balance, the dialog shows an inline hint — these are advisory only and never block saving.

### Let YARP plan a multi-year schedule for you

Hand-tuning a conversion schedule year by year is fiddly. Open the **Roth Conversion** dialog (Income → + → Roth Conversion) — the **Plan a multi-year schedule** tab is the default. Two settings sit at the top:

- **Plan window** — through what age should YARP consider conversions? Default is **through age 80**. Practitioner consensus: past 80, conversion is rarely worth it for owner-lifetime tax arbitrage (the math turns into estate planning, which YARP doesn't model). Drop to 73 or 75 if you want to limit the window to pre-RMD; bump to 85 or 90 if you have a specific heir-rate reason. Years past the cap emit no conversions.
- **Cap under IRMAA / NIIT cliffs** — on by default. A large conversion can push your MAGI into a higher Medicare IRMAA tier (two years later) or trip the 3.8% NIIT surcharge. With this on, generated conversions are capped so MAGI stays under the next tier and the NIIT threshold. Only ever lowers a conversion; uncheck if you want to override the cliffs.

Then click **Generate plan**. YARP runs coordinate-descent optimization on the per-year conversion vector. Internally it warm-starts from a quick grid search across four candidate bracket targets ("none", 12%, 22%, 24%) and then probes finer per-year amounts that the bracket grid can't see — but you don't have to choose between the two; YARP just does the best job it can. Takes ~3–5 seconds. Reports improvement **vs your current setup** — not vs the optimizer's internal seed — so the number you see is the honest answer to "is this worth doing?" If the optimizer can't beat your status quo, it says so.

After Generate plan completes, the dialog shows:
- The **proposed schedule table** (Year / Age / Conversion).
- A **what-if comparison chart**: two deterministic projection lines — your current plan (gray) vs the proposed plan (amber). Real dollars, so the lines compare apples-to-apples; the live Monte Carlo band on the main chart shows the full range.
- **Projected success probability** of the schedule vs the no-schedule baseline — a quick MC sanity check before you commit.

When you're happy, click **Apply** — every non-zero year becomes a real Roth Conversion event on your scenario, tagged with the generator that produced it and today's date. They appear in the Income panel grouped under one collapsible card ("Roth Conversions — N years · $total · YYYY-MM-DD") and as badges on the chart.

**Open-loop caveat.** The schedule is baked in at compute time — actual results will differ as markets play out. The Monte Carlo runs reflect the range.

**Editing a generated event detaches it.** Open one row in the group, change anything, save — that row is now treated as a manual event. It survives the next "Apply" (re-run), so you can keep an edited tweak even when you re-generate the rest of the schedule.

**Re-run policy.** Clicking Apply again replaces every still-generated event (rows you haven't touched) with the new batch. Your manual conversions and any rows you've previously edited are untouched. A confirmation dialog fires only when there's a generated batch to overwrite.

**Picking an objective** (under Advanced): "Max terminal wealth" optimizes the deflated start-of-last-year portfolio balance — the right default for most planning. "Min lifetime tax" picks the schedule that minimizes the real-dollar sum of taxes paid across the plan. Differences are usually small.

---

## Spending Goals

Spending goals are everything flowing **out** of your portfolio. Categories include living expenses, healthcare, housing, travel, education, and several more. Each goal has a start age, optional end age, and the option to inflate over time.

### Living expenses

This is your everyday spending — groceries, utilities, gas, insurance. It's almost always the biggest line item. Set this as a single goal that runs from your retirement age to your life expectancy.

If you want to model the **"retirement smile"** — the well-documented pattern where real spending declines about 1–2% per year through your 70s and 80s before ticking back up for end-of-life healthcare — you can set a small yearly decrease percentage on your living expenses goal.

### Healthcare

Healthcare is worth its own goal — sometimes two. Pre-Medicare years (early retirement before 65) are usually the most expensive. A common pattern: a high-amount goal that ends at 65, plus a smaller ongoing goal for Medicare premiums and supplemental coverage afterward.

### One-time expenses

For lumpy events — replacing a car, a wedding gift, a new roof — set the start age and end age to the same year. The whole amount happens in that one year.

---

## Taxes

YARP figures federal and state income tax automatically each year. You configure:

- **Filing status** — Single, Married Filing Jointly, Married Filing Separately, or Head of Household
- **Spouse age** — needed if you're married
- **State** — pick from any of the 50 states + DC, plus **New York City** as a pseudo-state that adds the ~3.876% NYC local income tax on top of NY state brackets. In single-state mode a short profile summary appears beneath the dropdown (e.g., "Graduated 1–13.3% · SS exempt · No retirement exclusion") so you can see at a glance how your state is modeled. When the active state's profile has a retirement-income exclusion, an "Disable state retirement-income exclusion (advanced)" checkbox lets you turn it off if your Traditional withdrawals don't qualify under the actual state rule (e.g., NY's $20k exclusion is for public pensions and IRAs only). In timeline mode (multiple relocations), the per-row chip is omitted to keep the table compact — the active profile still applies in simulation per year.
- **Long-term capital gains rate** — defaults to 15%, which is the federal middle bracket. Most retirees can leave this alone. State LTCG treatment varies by profile: most states tax LTCG at their ordinary brackets, **Missouri** fully exempts LTCG, and **Washington** applies a 7% rate only above an inflation-indexed $270k threshold (and has no ordinary state tax).
- **State retirement-income rules** — states with pension/IRA exclusions (NY $20k at 59.5+, PA all retirement income, IL all, MI age 67+, GA $65k at 65+, NJ phased to $150k AGI, …) are honored automatically based on the active state's profile. SS taxability varies too: states like CO exempt SS at age 65+, NM and UT phase out SS by AGI, and CT/MN/RI/VT/MT still tax SS.
- **State relocation timeline** — if you plan to move to a different state in retirement, add the move year here. YARP will switch profiles at the right time. South Carolina and West Virginia both have **scheduled tax changes** that activate automatically: SC's top 6% rate sunsets after 2026 (drops to ~5.2%) and WV's SS tax phases out by 2027.

The standard deduction (including the larger amount you get at 65+) is applied automatically. Social Security taxation follows IRS rules — depending on your other income, between 0% and 85% of your benefit will be taxable.

Two additional taxes show up as separate line items in the yearly detail:

- **Medicare IRMAA** — once you're 65, your Medicare Part B and Part D premiums include a surcharge if your modified AGI was high two years ago. The surcharge is per Medicare enrollee, so a married couple where both are 65+ pays it twice. If you retired with a high-income final working year, set **Last working year MAGI** under Settings → Tax & IRS so the first two retirement years correctly reflect the IRS lookback; otherwise YARP assumes $0 there and you won't see IRMAA until age 67. Toggle off under **Settings → Tax & IRS** if you'd rather model premiums separately.
- **NIIT** — a flat 3.8% on investment income above $200k MAGI (single) or $250k (MFJ). Mostly relevant for high-balance brokerage accounts. Toggle off under **Settings → Tax & IRS**.

Both matter most in years with large Roth conversions, sizable RMDs, or big brokerage-account withdrawals.

---

## Reading the Chart

The chart shows your portfolio balance over time, displayed in **today's dollars** (so the numbers are comparable to what you spend now).

You'll see:

| Element | What it represents |
|---|---|
| **Projected line** | What happens with no market randomness, using your average return assumptions. The primary line on the chart. (In Historical: Rolling / Bootstrap modes there is no projected baseline, so the **Median** line takes its place.) |
| **Likely range** (shaded band) | The 10th–90th percentile range from the Monte Carlo runs — 80% of simulated futures land inside this band each year. Wider band = more uncertainty. Toggle with the **Hide band** button on the legend row. |

Hover the **Chance of Success** percentage to see Monte Carlo summary stats that the chart can't easily show:

- **Median ending balance** — middle outcome for your final portfolio balance
- **10th-pctile ending** — bad-but-not-worst final balance (90% of runs do better)
- **Median depletion** — the age at which your portfolio runs out in the median run (`never` when more than half of runs survive)
- **Worst-decile depletion** — the age at which the bottom 10% of runs deplete (`never` when more than 90% survive)

The **Yearly Data** panel below the chart has its own Median / Projected / Downside view selector — use it to inspect what a representative bad run (Downside) or a typical run (Median) looks like year by year. The chart itself stays focused on the Projected line plus the Likely range.

If you've added Black Swan stress events (specific years where YARP forces a market crash), they'll show up as shaded vertical bands on the chart.

---

## Year-by-Year Detail

Below the chart, expand **Yearly Data** for a complete breakdown of each year: balance, income from each source, taxes paid, spending, withdrawals from each account, RMD details, and your effective tax rate.

This is where you go when something on the chart looks surprising — expand the year in question and you can see exactly what's happening.

When you expand a year, the detail panel has four tabs:

- **Summary** — the high-level income / spending / tax / cash-flow numbers, plus portfolio withdrawal breakdown and RMD/Roth-conversion notes. Use this for an at-a-glance read.
- **Tax Audit** — IRS-level intermediates so you can verify the model's arithmetic. Shows AGI, the full federal bracket table with the dollars and tax landing in each rate, your standard deduction broken into the base + senior add-on + temporary OBBB bonus, the Social Security provisional-income calc with which 50%/85% zone you hit, the IRMAA lookback MAGI with the exact tier and per-enrollee surcharge, the NIIT MAGI excess and 3.8% base, and per-owner RMD with the IRS Uniform Lifetime Table divisor and beginning-of-year Traditional balance.
- **Income Detail** — per-income-event ordinary tax attribution using marginal stacking (events are layered in IRS order so each event's tax is its incremental delta on top of the prior stack — pre-tax contributions appear as negative reductions). Also shows per-account flows: which account each dollar of withdrawal came from and which account received each deposit (Roth conversion, RMD excess, retirement contribution, surplus reinvestment).
- **Cash Flow** — a Sankey diagram of the year's flows, organized into five columns so the tax story is legible at a glance. The leftmost **Detailed Sources** column shows individual income events by name (each pension, rental, wage event, Social Security event by recipient, Roth conversion event), per-account withdrawals when multiple Brokerage / Cash / Roth accounts contribute, and per-Traditional-account RMD attribution (Self's RMD pulls only from Self-owned Trad; Spouse's only from Spouse-owned). Each detail node feeds an **Aggregated Source** in the next column. For Social Security, each event splits in two — its taxable share flows into "Social Security (Taxable)" and its tax-free share into "Social Security (Tax-Free)" using the year's overall taxability ratio. Three **tax-treatment buckets** sit in the middle: **Ordinary Income** (Social Security taxable, wages, RMD, Traditional withdrawals, Cash Interest, Roth conversion gross), **Capital Gains** (Brokerage account withdrawals only), and **Tax-Exempt** (Roth withdrawals, Cash principal, after-tax income, employer match). Each bucket pays its own taxes directly: Ordinary → Federal Ordinary + State Ordinary + IRMAA; Capital Gains → Federal LTCG + State LTCG + NIIT; Tax-Exempt → no tax. The remainder from each bucket flows into a single **After-Tax Cash** pool, which funds Living Expenses, Other Goals, account contributions, surplus to Brokerage, and the Roth Deposit from any conversion. The conversion pass-through is visible as a chain: Roth Conversion event → Roth Conversion (gross) → Ordinary Income → Roth Deposit. Hover any node or link for the precise dollar figure and share of the year; bucket hovers also show the inflow/outflow split. Inflows always equal outflows globally, within each bucket, and within each multi-detail aggregator — the diagram is conservation-checked, so if anything looks off it's showing you a real number. Inter-account cash-bucket refill or sweep activity, if any, appears as a separate row below the diagram (balance-sheet moves that don't pass through the buckets). If the portfolio depleted in a year, a red banner notes how much spending went unmet and the spending edges shrink to the funded amount.

You can **export the whole table to CSV** using the button in the header — useful for sharing with an advisor or sanity-checking against another tool. The CSV includes scalar audit columns (AGI, deductions, bracket index, marginal rate, federal vs state split, SS zone, IRMAA tier, NIIT components, per-owner RMD). Per-event and per-account tables are in-app only — they don't fit a flat CSV cleanly.

---

## Today's $ vs Future $

There's a toggle to switch between:

- **Today's $** — adjusted for inflation. Use this. The numbers are comparable to your current life and budget.
- **Future $** — actual dollar amounts that would print on statements decades from now. They look bigger because of inflation, but they don't represent more spending power.

Most retirement planning is done in today's dollars.

---

## Comparing Scenarios

Click **Compare with ▾** above the chart to overlay another scenario as a dashed line. You'll see both probabilities and tier badges side by side. Click **End comparison** to clear it.

This is the most useful feature for actually making decisions: rather than asking "is my plan good?" you ask "is plan A better than plan B?"

---

## What If? Mode

Click **What If?** above the chart to enter an experimental mode. A snapshot of your scenario is held in memory; the chart shows the original as a solid gray line and your live edits as a dashed amber **Draft** line. Edit accounts, income events, or spending goals normally — only the dashed line moves.

In What If mode both lines always render the **Projected** baseline so the two paths start identical when no edits have been made. The data table's Median / Projected / Downside view selector still lets you inspect representative runs in the year-by-year detail — but it no longer changes what the chart plots.

Three exit actions:
- **Discard** — restore the scenario to its original state.
- **Save** — keep your edits (they were already being saved as you went).
- **Save as New** — create a brand-new scenario containing your experiment, and restore the original scenario back to its starting state.

While in What If mode, **Compare with** is disabled (and vice versa) — they share the chart's overlay slot. Switching to a different scenario in the sidebar will prompt you before discarding your unsaved changes.

---

## Settings

The **Settings** menu in the header has:

- **Load example…** — append one of the built-in example scenarios.
- **Modeling** — return generation (parametric vs. historical), distribution, asset correlation, inflation, Black Swan events, simulation run count.
- **Cash Bucket** — min/target/max months and refill trigger (only appears when the active scenario has at least one cash account; see *Cash Bucket policy* under Accounts).
- **Tax & IRS** — long-term capital gains rate, IRMAA, NIIT, last working year MAGI, and IRS contribution limits.
- **Export CSV** — download the yearly data table for the active scenario.

### Modeling

Open **Settings → Modeling** to adjust the underlying assumptions. The defaults are reasonable for most people, but a few things are worth knowing:

### Expected returns

The defaults (8.5% stocks, 4.8% bonds) are deliberately a bit below long-run US averages, to be conservative. **Lowering these by 1% each can swing your success probability by 10+ points** — this is one of the most sensitive knobs in the whole tool. If you want to be even more conservative, try 7% / 4%.

### Inflation

The default (3%) is the long-run US average. Adjust if you have a strong view.

### Return Model

This is the deepest knob. The default — **Parametric (random draws)** — generates 5,000 random market sequences using your return assumptions. It's smooth and statistically clean.

The **Historical** modes use real US market data from 1928 onward. **Historical: Rolling Start** is especially useful as an honesty check: it asks "if you'd retired in every possible historical year, how often would your plan have worked?" If your parametric Monte Carlo shows 95% but your historical rolling shows 70%, you've learned something important.

### Black Swan events

You can add specific years where YARP overrides simulated returns with a real historical crash (1929, 2008, etc.). These apply identically across every simulation, shifting your entire outcome distribution downward at that year. Use sparingly — a few well-placed stress events teach you a lot, but piling them on can dominate the result.

For deeper detail on any of these settings — including the math, distributions, and tax-engine internals — see the **Model Details** document (Help → Model Details).

---

## Tips for Honest Planning

- **Plan to a high life expectancy** (95 or 100). You don't want to run out of money at 90 because you planned to age 85.
- **Stress-test with reduced returns.** Even if you believe in 10% stocks long-term, run a scenario at 7%.
- **Try Historical: Rolling Start.** If your plan only succeeds in 70% of actual historical sequences, the parametric Monte Carlo number is overstating safety.
- **Spending matters more than returns.** Getting your spending estimate right within ±10% usually matters more than the exact return assumption.
- **Revisit your plan yearly** as your situation changes.

---

## Backing Up Your Data

Because everything stays in your browser, you should save copies of your scenarios outside the browser. Each scenario has an **Export** button that downloads a small file — save it somewhere durable (cloud storage, a USB drive, a folder you back up).

To restore or move to a new device, click **Import** and select the file. You can also share scenarios with an advisor or family member this way — just send them the file.

---

## Where to Go From Here

- **Help → User Guide** — this document
- **Help → Model Details** — full technical reference for the simulation engine, tax math, and known limitations
- **Help → About YARP** — version and license info

Found a bug or want to suggest an improvement? Open a ticket on the [GitHub Issues page](https://github.com/remackgeek/retirement-planner/issues). The app lives at [yarp.bluewiz.net](https://yarp.bluewiz.net) — open **Help → About YARP** for project and build details.
