# YARP User Guide

> *"Essentially, all models are wrong, but some are useful."*
> — George E. P. Box & Norman R. Draper, *Empirical Model-Building and Response Surfaces* (1987)

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

1. Click **+ New Scenario** in the sidebar and give it a name like "Baseline".
2. Enter your **current age**, **planned retirement age**, and a **life expectancy** to plan to. Using a high number — 95 or 100 — gives you a margin against living longer than you expect.
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

YARP recognizes three kinds of accounts based on how they're taxed:

| Type | Examples | When you withdraw |
|---|---|---|
| **Traditional** | 401(k), Traditional IRA, 403(b) | Taxed as ordinary income |
| **Roth** | Roth IRA, Roth 401(k) | Tax-free |
| **Taxable** | Brokerage, savings, money market | Taxed as long-term capital gains |

For each account, enter the current balance and pick a stock/bond mix (80/20, 60/40, or 50/50). You can mix and match — for example, a more aggressive 80/20 in your Roth and a conservative 50/50 in your Traditional.

### How withdrawals work

YARP draws from your accounts in this order each year: **Taxable first, then Traditional, then Roth**. This is the standard tax-efficient ordering — you pay the lowest tax cost on taxable accounts, save Roth for last because it grows tax-free.

### Required Minimum Distributions (RMDs)

Once you turn **73**, the IRS requires you to withdraw a minimum amount from Traditional accounts each year, whether you need the money or not. YARP handles this automatically: it forces the minimum withdrawal, taxes it as ordinary income, and reinvests anything you didn't actually need into a taxable account. Roth accounts don't have RMDs.

### Surplus reinvestment

In any year where your income exceeds your spending and taxes, the leftover cash is deposited into your first taxable account. If you don't have one, YARP creates a synthetic "Reinvestment" account during the simulation so surplus is never silently lost. The yearly data detail rows and CSV export show this as **Surplus Contribution**.

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
  - **After-tax** — deposits to a taxable brokerage; growth taxed at LTCG on withdrawal.

Optional: an **employer match** (e.g. "100% up to 6% of wages") deposits additional dollars to the same account as your contribution. Link the contribution to a specific salary event so the match ceiling is computed against the actual wage base.

Contributions are *deposit instructions* — they do not show up as spendable cash. If you contribute $20k pre-tax against a $100k salary, the simulation taxes $80k and deposits $20k to your Traditional account.

#### Contribution Limits

YARP enforces IRS contribution caps per owner per account kind. Configure the limits under **Settings → Modeling → Contribution Limits**:

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

The classic strategy is to convert in the low-income years between retirement and age 73, filling up the lower tax brackets to reduce your future RMDs. YARP lets you model exactly how much that strategy is worth in your situation.

The Roth Conversion dialog shows an **Impact Preview** with a deterministic estimate of first-year tax, total tax over the conversion window, RMD reduction at 73, projected tax-free Roth at life expectancy, and a **Net impact on plan value** row that signs the trade-off in dollar terms (green when the conversion pays off, red when it costs more than it saves). Multi-year conversions default to **inflation-adjusted**, so the amount you enter is a real-dollar target — turn that off if you mean a fixed nominal schedule. If you configure a conversion that is unusually large relative to your spending, crosses two or more federal brackets in a single year, or would convert most of your Traditional balance, the dialog shows an inline hint — these are advisory only and never block saving.

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
- **State** — pick from any of the 50 states + DC
- **Long-term capital gains rate** — defaults to 15%, which is the federal middle bracket. Most retirees can leave this alone. Your state's tax rate is **also** applied to capital gains automatically (most states tax LTCG as ordinary income).
- **State relocation timeline** — if you plan to move to a different state in retirement, add the move year here. YARP will switch state rates at the right time.

The standard deduction (including the larger amount you get at 65+) is applied automatically. Social Security taxation follows IRS rules — depending on your other income, between 0% and 85% of your benefit will be taxable.

Two additional taxes show up as separate line items in the yearly detail:

- **Medicare IRMAA** — once you're 65, your Medicare Part B and Part D premiums include a surcharge if your modified AGI was high two years ago. The surcharge is per Medicare enrollee, so a married couple where both are 65+ pays it twice. If you retired with a high-income final working year, set **Last working year MAGI** under Settings → Modeling so the first two retirement years correctly reflect the IRS lookback; otherwise YARP assumes $0 there and you won't see IRMAA until age 67. Toggle off under **Settings → Modeling → Tax** if you'd rather model premiums separately.
- **NIIT** — a flat 3.8% on investment income above $200k MAGI (single) or $250k (MFJ). Mostly relevant for high-balance taxable accounts. Toggle off under **Settings → Modeling → Tax**.

Both matter most in years with large Roth conversions, sizable RMDs, or big taxable-account withdrawals.

---

## Reading the Chart

The chart shows your portfolio balance over time, displayed in **today's dollars** (so the numbers are comparable to what you spend now).

You'll see three lines:

| Line | What it represents |
|---|---|
| **Median** | A typical outcome — the middle of all simulated futures |
| **Deterministic** | What happens with no market randomness, using your average return assumptions (hidden when a Historical return model is active) |
| **Downside** | A bad outcome — the 10th-percentile result |

Use the **Median / Deterministic / Downside** selector to switch which line drives the year-by-year detail below the chart. Pay attention to the Downside path — if your plan looks fine on Median but craters on Downside, you have sequence-of-returns risk to think about.

If you've added Black Swan stress events (specific years where YARP forces a market crash), they'll show up as shaded vertical bands on the chart.

---

## Year-by-Year Detail

Below the chart, expand **Yearly Data** for a complete breakdown of each year: balance, income from each source, taxes paid, spending, withdrawals from each account, RMD details, and your effective tax rate.

This is where you go when something on the chart looks surprising — expand the year in question and you can see exactly what's happening.

You can **export the whole table to CSV** using the button in the header — useful for sharing with an advisor or sanity-checking against another tool.

---

## Real vs Nominal

There's a toggle to switch between:

- **Real (today's dollars)** — adjusted for inflation. Use this. The numbers are comparable to your current life and budget.
- **Nominal (future dollars)** — actual dollar amounts that would print on statements decades from now. They look bigger because of inflation, but they don't represent more spending power.

Most retirement planning is done in real terms.

---

## Comparing Scenarios

Click **Compare with ▾** above the chart to overlay another scenario as a dashed line. You'll see both probabilities and tier badges side by side. Click **End comparison** to clear it.

This is the most useful feature for actually making decisions: rather than asking "is my plan good?" you ask "is plan A better than plan B?"

---

## What If? Mode

Click **What If?** above the chart to enter an experimental mode. A snapshot of your scenario is held in memory; the chart shows the original as a solid line and your live edits as a dashed amber **Draft** line. Edit accounts, income events, or spending goals normally — only the dashed line moves.

Three exit actions:
- **Discard** — restore the scenario to its original state.
- **Save** — keep your edits (they were already being saved as you went).
- **Save as New** — create a brand-new scenario containing your experiment, and restore the original scenario back to its starting state.

While in What If mode, **Compare with** is disabled (and vice versa) — they share the chart's overlay slot. Switching to a different scenario in the sidebar will prompt you before discarding your unsaved changes.

---

## Modeling Settings

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

- **Help → Model Details** — full technical reference for the simulation engine, tax math, and known limitations
- **Help → About** — version and license info

Found a bug or want to suggest an improvement? Open a ticket on the [GitHub Issues page](https://github.com/remackgeek/retirement-planner/issues), or open **Help → About YARP** for project and build details.
