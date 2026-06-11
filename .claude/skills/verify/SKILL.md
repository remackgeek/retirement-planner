---
name: verify
description: Full lint + build + test verification gate
user-invocable: true
allowed-tools: Bash(npm run lint), Bash(npm run build), Bash(npm run test)
---

# Verify

Run all checks in sequence:

1. `npm run lint` — ESLint (zero errors and zero warnings expected)
2. `npm run build` — TypeScript type-check + production build
3. `npm run test` — all unit + scenario tests

Report results concisely. If anything fails:
- Show the relevant error output
- Identify the likely cause
- Do NOT auto-fix — just report. The user decides what to do next.

If all pass, say so in one line.
