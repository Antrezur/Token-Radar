# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Antrezur/Token-Radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Antrezur/Token-Radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: a static dashboard that ranks pre-token protocols by expected launch value and shows how to farm each one. It reads a sealed DefiLlama snapshot (758 protocols, 40 on the watchlist), scores every protocol that passes the watchlist's own pre-token rule with the radar-5 model — a size curve fitted on the snapshot's own traded tokens (94 comps, R² 0.29, leave-one-out error 544% vs a 1,036% flat-multiple baseline, walk-forward +79.5%), multiplied by a peer-record launch odds (category × no-token-age launch rate, 5-fold CV log-loss 0.627 vs 0.688 base, accuracy 65.6% vs 54.9%) — and writes a ranked board with an 8-step farm plan per protocol, each netted to cost, expected value, net $ and $/hour with a FARM / THIN / SKIP verdict (FARM 10 / THIN 89 / SKIP 99; total expected value $783M). The dashboard is a plain static page with no network: board, detail view, filters, compare, sandbox, export, and a live-token view set aside from the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Then open `out/dashboard/index.html` in a browser. `main.ts` reads the snapshot, writes `out/board.json`, `out/data.js`, copies `dashboard/` and `screenshots/` into `out/`, and writes `out/dossier.json`.

## Submission

Entry for the make.fun token-radar-01 bounty (opened 2026-11-14, ends 2026-12-14). Repository created 2026-11-19, MIT licensed. Set the repository's About (website `https://make.fun/bounty/token-radar-01`, topic `makefun`) before submitting.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
