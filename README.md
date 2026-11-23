# Token-Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Antrezur/Token-Radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Antrezur/Token-Radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (radar-6) ranks 198 protocols that record no token by implied launch value: a size curve fitted on 94 traded tokens — ln(mcap) = 8.998 + 0.405 · ln(tvl), R² = 0.290, with a shrunken intercept per category — blind-tested twice (leave-one-out error 544.3% vs a flat median multiple at 1036.4%; walk-forward mean +79.5%). Launch odds from the peer record (category × no-token-age cells, 5-fold CV log-loss 0.631 vs base rate 0.690, AUC 0.688) are shown on every row as their own signal and are deliberately NOT multiplied into the ranking: multiplying them in shrank the FARM set from 22 to 10 and scored lower than ranking by implied value alone. Every farm plan is netted: expected value at the low end of a 200-refit P10–P90 band, minus the gas of seven transactions, at a 3e-6 farmer share — FARM clears $20 after cost and $5/hour. Verdicts: FARM 34 / THIN 114 / SKIP 50. Total implied value $1,958,243,227.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

This builds `out/board.json` (the 198-row board), `out/data.js` (the dashboard data), copies `dashboard/` and `screenshots/` into `out/`, and writes `out/dossier.json`. Open `out/dashboard/index.html` in a browser to view the board.

## Submission

Entered on make.fun for the "Build the best token launch radar" bounty ($1,325 in USDC). The board is built from the competition snapshot (758 protocols, as of 2026-11-14) and nothing else; no live data is fetched at build or view time.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
