# YARP — Yet Another Retirement Planner

A browser-based retirement planning tool positioned between simple calculators (HonestMath, Empower) and full-featured tools (ProjectionLab). Clean UX, honest Monte Carlo projections, and solid tax awareness without overwhelming complexity.

**App: [yarp.bluewiz.net](https://yarp.bluewiz.net)**

## Features

- **Monte Carlo simulation** — 1,000 runs by default (configurable up to 10,000) with log-normal or Student's t returns; a deterministic Projected line plus a shaded 10th–90th-percentile "likely range" band
- **Multi-account modeling** — Traditional (pre-tax), Roth (tax-free), and Taxable accounts with per-account stock/bond allocation
- **Tax-aware withdrawals** — federal + state income tax, RMDs at 73+, Roth conversions, SS provisional income formula
- **Income events** — Social Security (with 2034 haircut option), pensions, employment savings, Roth conversions, and more
- **Spending goals** — 11 categories with inflation adjustment, age-based activation, and optional spending decay
- **State tax timeline** — model future relocations with per-year effective state tax rates
- **Historical return modes** — Trinity-style rolling sequences or block bootstrap from 1928–2024 S&P 500 / Treasury / CPI data
- **Scenario comparison** — overlay two scenarios on the same chart
- **No account required** — runs entirely in the browser; data stored in IndexedDB

## Tech Stack

React 19, TypeScript, Vite, PrimeReact, Chart.js, IndexedDB

## Getting Started

```bash
git clone https://github.com/remackgeek/retirement-planner.git
cd retirement-planner
npm install
npm run dev
```

## Dev Commands

```bash
npm run dev      # dev server
npm run build    # type-check + production build
npm run test     # vitest
npm run deploy   # deploy to GitHub Pages
```

## License

MIT — see [LICENSE](LICENSE)
