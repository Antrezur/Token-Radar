# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Antrezur/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Antrezur/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: a static dashboard that ranks pre-token protocols by implied value and shows how to farm each one. It reads a sealed DefiLlama snapshot (758 protocols, 40 on the watchlist), scores every protocol that passes the watchlist's own pre-token rule with the radar-2 model — TVL, 7-day growth, growth vs its category's median, age with no token, and chain breadth — and writes a ranked board with an 8-step farm plan per protocol. The dashboard is a plain static page with no network: board, detail view, filters, and a live-token view set aside from the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Then open `out/dashboard/index.html` in a browser. `main.ts` reads the snapshot, writes `out/board.json`, `out/data.js`, copies `dashboard/` and `screenshots/` into `out/`, and writes `out/dossier.json`.

## Before submitting

Replace `{owner}` and `{repo}` in the badges above with the GitHub repository's owner and name, and set the repository's About (website `https://make.fun/bounty/token-radar-01`, topic `makefun`). This repository must be created after the competition opened (2026-11-14) and carry an OSI-approved license (MIT, included).
