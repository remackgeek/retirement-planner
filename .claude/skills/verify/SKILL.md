---
name: verify
description: Full build + test verification gate
user-invocable: true
allowed-tools: Bash(npm run build), Bash(npm run test)
---

# Verify

Run both checks in sequence:

1. `npm run build` — TypeScript type-check + production build
2. `npm run test` — all unit + scenario tests

Report results concisely. If anything fails:
- Show the relevant error output
- Identify the likely cause
- Do NOT auto-fix — just report. The user decides what to do next.

If both pass, say so in one line.
