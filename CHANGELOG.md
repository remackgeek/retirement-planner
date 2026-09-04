# Changelog

User-facing release notes for YARP. Manually curated — not generated from git history.

The latest `## x.y.z` heading **is** the product version (About, What's New, git tag, GitHub Release). Do not bump `package.json`.

Before merging to `master`:

1. Move Unreleased bullets under a new `## x.y.z — YYYY-MM-DD`.
2. Leave an empty `## Unreleased`.
3. Merge. Deploy tags `vX.Y.Z`, opens a GitHub Release with those bullets, and publishes Pages.

## Unreleased

## 0.2.0 — 2026-09-03

- What's New dialog after an upgrade, with notes for every version you missed
- Help → Changelog shows the full shipped history

## 0.1.0 — 2026-05-01

- Monte Carlo projections with a deterministic Projected line and a 10th–90th-percentile likely-range band
- Multi-account modeling (Traditional, Roth, brokerage, cash) with tax-aware withdrawals and RMDs
- Income events and spending goals, including Social Security, pensions, Roth conversions, and a cash-bucket policy
- Federal and state tax, IRMAA, NIIT, and a state relocation timeline
- Historical return modes (single sequence, rolling start, block bootstrap) and Black Swan overlays
- Scenario comparison, What If mode, and in-browser IndexedDB persistence
