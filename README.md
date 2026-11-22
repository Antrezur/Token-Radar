# Token-Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Antrezur/Token-Radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Antrezur/Token-Radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (radar-5) ranks 198 protocols that record no token by the expected value of a token they might one day issue: a category-fit launch value times the chance a protocol like it ever issues one. The launch value comes from a size curve fitted on 94 traded tokens — ln(mcap) = 8.998 + 0.405 · ln(tvl), R² = 0.290, with a shrunken intercept per category — and the chance comes from the peer record: category-by-age cells of 758 protocols, 416 of which have a token, smoothed toward the category rate and then the base rate of 0.549. The fit is blind-tested twice (leave-one-out error 544.3% vs a flat median multiple at 1036.4%; walk-forward mean +79.5%; five-fold cross-fit 537.1% vs flat 1052.7%), and the controls that should fail do fail (shuffled caps 710.4%, flipped slope 765.8%). Every farm plan is netted: expected value at the low end of a 200-refit P10–P90 band, minus the gas of five transactions, at a 5e-6 farmer share — FARM clears $20 after cost, THIN covers cost, SKIP does not. Verdicts: FARM 10 / THIN 89 / SKIP 99. Total expected value $782,847,132.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

This builds `out/board.json` (the 198-row board), `out/data.js` (the dashboard data), copies `dashboard/` and `screenshots/` into `out/`, and writes `out/dossier.json`. Open `out/dashboard/index.html` in a browser to view the board.

## Submission

Entered on make.fun for the "Build the best token launch radar" bounty ($1,325 in USDC). The board is built from the competition snapshot (758 protocols, as of 2026-11-14) and nothing else; no live data is fetched at build or view time.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
