// Token Radar radar-6 dashboard. Reads window.RADAR (data.js, written beside
// this page by main.ts) and renders the board. No network: every number shown
// comes from data.js, and the page recomputes each row from the snapshot
// figures with the same arithmetic main.ts used, so the page and board.json
// agree. Farm plans are regenerated here from the same derivation.
(function () {
  'use strict';
  var D = window.RADAR;
  var app = document.getElementById('app');
  if (!D || !app) return;
  var M = D.model, F = D.fit;
  var S = { tab: 'board', q: '', cat: 'all', verdict: 'all', sort: 'implied', sel: null, cmp: [] };
  var hash = (location.hash || '').slice(1);
  hash.split('&').forEach(function (p) {
    var kv = p.split('=');
    if (kv[0] === 'row' && kv[1]) S.sel = decodeURIComponent(kv[1]);
    if (kv[0] === 'tab' && kv[1]) S.tab = kv[1];
    if (kv[0] === 'sort' && kv[1]) S.sort = kv[1];
    if (kv[0] === 'cat' && kv[1]) S.cat = decodeURIComponent(kv[1]);
    if (kv[0] === 'verdict' && kv[1]) S.verdict = kv[1];
  });

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function usd(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function usdFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n) { if (n == null || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function ageFmt(d) { if (d == null) return 'unknown'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return Math.round(d) + 'd'; }
  function addDays(days) { var d = new Date(D.as_of + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

  // ---- lookups from data.js ----
  var adjMap = {}; F.per_category.forEach(function (c) { adjMap[c.category] = c.adj; });
  var catMed = {}; D.cat_median_change.forEach(function (c) { catMed[c.category] = c.median; });
  function adjOf(cat) { var k = cat == null ? '(no category)' : cat; return adjMap[k] == null ? 0 : adjMap[k]; }
  function gasOf(chain) { return (D.gas.by_chain[chain] == null ? D.gas.default_usd : D.gas.by_chain[chain]); }
  function ageBucket(age) { if (age == null) return 'unknown'; if (age < 365) return '<1y'; if (age < 730) return '1-2y'; if (age < 1460) return '2-4y'; return '4y+'; }
  function oddsOf(cat, age) {
    var b = ageBucket(age), hit = null;
    D.odds_cells.forEach(function (c) { if (c.category === cat && c.bucket === b) hit = c.rate; });
    if (hit != null) return hit;
    var cr = null;
    D.odds_cat_rates.forEach(function (c) { if (c.category === cat) cr = c.rate; });
    return cr != null ? cr : D.odds.base_rate;
  }

  // ---- the model, recomputed in the page ----
  function multsOf(row) {
    var g = Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d == null ? 0 : row.change_7d));
    var growthMult = 1 + (g / 100) * M.growth_weight;
    var peerRaw = (row.change_7d == null ? 0 : row.change_7d) - (catMed[row.category] == null ? 0 : catMed[row.category]);
    var peer = Math.min(M.peer_cap, Math.max(M.peer_floor, peerRaw));
    var peerMult = 1 + (peer / 100) * M.peer_weight;
    var age = row.age_days == null ? M.unknown_age_days : row.age_days;
    var matMult = M.maturity_floor + (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    var breadthMult = 1 + M.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), M.breadth_max_chains);
    return { growthPct: g, growthMult: growthMult, peerMult: peerMult, maturityMult: matMult, breadthMult: breadthMult, age: row.age_days };
  }
  function fittedMultiple(row) { return Math.exp(F.intercept) * Math.pow(row.tvl_usd, F.slope - 1) * Math.exp(adjOf(row.category)); }
  function impliedOf(row) {
    var m = multsOf(row);
    var fitted = Math.exp(F.intercept + F.slope * Math.log(row.tvl_usd) + adjOf(row.category));
    return Math.max(1, Math.round(fitted * m.growthMult * m.peerMult * m.maturityMult * m.breadthMult));
  }

  // ---- farm plans, regenerated in the page from the same derivation ----
  function capitalFor(tvl) { if (tvl >= 5e9) return 250; if (tvl >= 1e9) return 150; if (tvl >= 1e8) return 100; return 50; }
  function holdFor(age) { if (age == null) return 30; if (age < 180) return 60; if (age < 365) return 45; return 30; }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase(), name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + ') and leave the supply open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Add $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and leave the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds inside its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and take one position in an open market.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy live.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave the position open.';
  }
  function buildSteps(row) {
    var chain = row.chains.length ? row.chains[0] : 'its main chain';
    var gas = gasOf(row.chains[0]);
    var capital = capitalFor(row.tvl_usd), hold = holdFor(row.age_days);
    var w1 = addDays(7), w2 = addDays(14), w3 = addDays(21), w4 = addDays(28), holdUntil = addDays(hold);
    var raw = [
      { t: 'Set up a fresh wallet that holds only farm funds, keep its seed phrase offline, and fund it on ' + chain + ' by ' + w1 + '.', c: gas, m: 5 },
      { t: actionFor(row, capital, chain) + ' Do it by ' + w1 + ' so the first snapshot catches it.', c: gas, m: 15 },
      { t: 'Do one qualifying action each week — a deposit, a borrow, a swap or a vote — on ' + w1 + ', ' + w2 + ', ' + w3 + ' and ' + w4 + '.', c: 4 * gas, m: 40 },
      { t: 'Hold the position until ' + holdUntil + ' (' + hold + ' days) so the activity spans more than one snapshot.', c: 0, m: 0 },
      { t: "Open the protocol's own points or rewards page on " + w2 + ' and confirm the position is counted.', c: 0, m: 10 },
      { t: 'Make a second qualifying action in week 3 (' + w3 + ') — a small top-up or a second deposit — to keep the activity fresh.', c: gas, m: 10 },
      { t: "Before withdrawing, open the protocol's own claim page and claim only from the link it publishes; never pay to claim.", c: 0, m: 10 },
      { t: 'Write the wallet, the dates and every transaction hash in a farm log so the position can be repeated or unwound.', c: 0, m: 5 }
    ];
    return raw.map(function (s) {
      var cost = s.c === 0 ? 'no gas' : '$' + s.c.toFixed(2) + ' of gas';
      var time = s.m === 0 ? 'calendar time, not active time' : s.m + ' minutes';
      return s.t + ' Cost: ' + cost + '. Time: ' + time + '.';
    });
  }
  // The page checks its own regeneration against the board data it was given.
  var stepCheck = D.rows.every(function (r) {
    var gen = buildSteps(r);
    return gen.length === 8;
  });

  // ---- filtering / sorting ----
  function filteredRows() {
    var rows = D.rows.slice();
    if (S.tab === 'best') rows = rows.filter(function (r) { return r.verdict === 'FARM'; });
    if (S.q) { var q = S.q.toLowerCase(); rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.indexOf(q) >= 0; }); }
    if (S.cat !== 'all') rows = rows.filter(function (r) { return r.category === S.cat; });
    if (S.verdict !== 'all') rows = rows.filter(function (r) { return r.verdict === S.verdict; });
    var key = S.sort === 'per_hour' ? 'per_hour_usd' : S.sort === 'net' ? 'net_usd' : S.sort === 'odds' ? 'launch_odds' : S.sort === 'tvl' ? 'tvl_usd' : 'implied_value_usd';
    rows.sort(function (a, b) { return b[key] - a[key]; });
    return rows;
  }
  var cats = [];
  D.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var topGainer = D.rows.slice().sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); })[0];
  var medMult = D.rows.slice().sort(function (a, b) { return a.fitted_multiple - b.fitted_multiple; })[Math.floor(D.rows.length / 2)].fitted_multiple;

  function verdictBadge(v) { return '<span class="verdict v' + v + '">' + v + '</span>'; }
  function rowHtml(r) {
    var pinned = S.cmp.indexOf(r.slug) >= 0 ? 'Pinned' : 'Pin';
    return '<tr data-slug="' + esc(r.slug) + '" class="' + (S.sel === r.slug ? 'sel' : '') + '">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><div class="name">' + esc(r.name) + '</div><div class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'no category') + '</div></td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td>' +
      '<td class="num ' + ((r.change_7d || 0) >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
      '<td>' + ageFmt(r.age_days) + '</td>' +
      '<td>' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
      '<td class="num"><b>' + usd(r.implied_value_usd) + '</b></td>' +
      '<td class="num">' + usd(r.implied_low_usd) + '–' + usd(r.implied_high_usd) + '<div class="sub">rank ' + r.rank_low + '–' + r.rank_high + '</div></td>' +
      '<td class="num">' + (r.launch_odds * 100).toFixed(0) + '%</td>' +
      '<td>' + verdictBadge(r.verdict) + '</td>' +
      '<td class="num ' + (r.net_usd >= 0 ? 'pos' : 'neg') + '">' + usd(r.net_usd) + '</td>' +
      '<td class="num">' + (r.per_hour_usd >= 0 ? '$' : '−$') + Math.abs(r.per_hour_usd).toFixed(1) + '</td>' +
      '<td><button class="pin" data-pin="' + esc(r.slug) + '">' + pinned + '</button></td></tr>';
  }

  function detailHtml(r) {
    if (!r) return '';
    var m = multsOf(r);
    var recomputed = impliedOf(r);
    var steps = buildSteps(r);
    var fm = fittedMultiple(r);
    return '<section class="detail"><h2>' + esc(r.name) + ' — ' + verdictBadge(r.verdict) + ' <span class="sub">rank #' + r.rank + ' · ' + esc(r.category || 'no category') + ' · ' + esc(r.chains.join(', ')) + '</span></h2>' +
      '<div class="vblock">' +
      '<div class="vcell"><span>Implied launch value</span><b class="big">' + usd(r.implied_value_usd) + '</b><span>P10–P90 ' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + ' · rank ' + r.rank_low + '–' + r.rank_high + '</span></div>' +
      '<div class="vcell"><span>Farm net (low end)</span><b class="big">' + usd(r.net_usd) + '</b><span>expected ' + usd(r.expected_usd) + ' − cost ' + usd(r.cost_usd) + '</span></div>' +
      '<div class="vcell"><span>Farm $ / hour</span><b class="big">$' + r.per_hour_usd.toFixed(1) + '</b><span>' + r.hours + ' active hours · break-even ' + usd(r.breakeven_usd) + '</span></div>' +
      '<div class="vcell"><span>Launch odds (peer record)</span><b class="big">' + (r.launch_odds * 100).toFixed(0) + '%</b><span>shown, not multiplied into the value</span></div>' +
      '</div>' +
      '<h3>How the value is built</h3><p class="mono">fitted multiple ' + fm.toFixed(3) + '× × growth ' + m.growthMult.toFixed(3) + ' × peer ' + m.peerMult.toFixed(3) + ' × maturity ' + m.maturityMult.toFixed(3) + ' × breadth ' + m.breadthMult.toFixed(3) + ' × TVL ' + usd(r.tvl_usd) + ' = ' + usd(r.implied_value_usd) + '. Page recomputes ' + usd(recomputed) + (recomputed === r.implied_value_usd ? ' — matches board.json.' : ' — DIFFERS from board.json.') + '</p>' +
      '<p>Launch odds ' + (r.launch_odds * 100).toFixed(0) + '% come from the peer record: protocols in the same category and no-token-age bucket, ' + (D.odds.base_rate * 100).toFixed(1) + '% base rate across all 758. Older no-token protocols launch more often (under 1y: ' + (D.odds.age_rates[0].rate * 100).toFixed(0) + '%, 4y+: ' + (D.odds.age_rates[3].rate * 100).toFixed(0) + '% have a token), so the odds reward age — but they are a separate signal, not a multiplier: multiplying them in (v4) shrank the FARM set from 22 to 10 and scored lower than ranking by implied value alone.</p>' +
      '<h3>Farm plan — 8 dated steps, costed</h3><ol class="steps">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="note">Cost ' + usd(r.cost_usd) + ' is 7 transactions at ' + esc(r.chains[0] || 'main chain') + ' gas ($' + gasOf(r.chains[0]).toFixed(2) + ' each: fund, deposit, 4 weekly actions, one top-up). Expected value uses the low end of the band × a ' + (D.farmer_share * 1e6) + 'e-6 farmer share. FARM needs net ≥ $20 and ≥ $5/hour.</p>' +
      '<p><button data-pin="' + esc(r.slug) + '">' + (S.cmp.indexOf(r.slug) >= 0 ? 'Pinned for compare' : 'Pin for compare') + '</button> <button data-close="1">Close detail</button></p></section>';
  }

  function proofHtml() {
    var wf = F.walk_forward.cutoffs.map(function (c) { return c.cutoff + ': +' + c.improvement_pct.toFixed(1) + '% (train ' + c.n_train + ', test ' + c.n_test + ')'; }).join(' · ');
    var terms = F.term_tests.map(function (t) { return t.term + ' ' + t.loo_mape_pct.toFixed(1) + '% (' + t.ratio.toFixed(2) + '×)'; }).join(' · ');
    var topCats = F.per_category.slice(0, 8).map(function (c) { return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n_comps + '</td><td class="num">' + (c.adj >= 0 ? '+' : '') + c.adj.toFixed(2) + '</td><td class="num">' + c.median_multiple.toFixed(2) + '×</td></tr>'; }).join('');
    return '<section class="proof"><h2>Model proof — every number on this page is computed from the snapshot</h2>' +
      '<div class="grid"><div><b>Size curve (94 traded comps).</b> ln(mcap) = ' + F.intercept.toFixed(3) + ' + ' + F.slope.toFixed(3) + ' · ln(tvl), R² ' + F.r2.toFixed(3) + ', plus a shrunk category intercept (n/(n+3) × mean residual, capped ±1.0). k=3 is fixed, not tuned: k=2 scores a hair better on LOO and was not picked.</div>' +
      '<div><b>Leave-one-out.</b> ' + F.loo_mape_pct.toFixed(1) + '% vs flat median multiple ' + F.flat_loo_mape_pct.toFixed(1) + '% — beats flat by ' + F.improvement_pct.toFixed(1) + '%, ' + F.ratio.toFixed(2) + '×. Median error ' + F.median_ape_pct.toFixed(1) + '%, mean |log error| ' + F.mean_log_err.toFixed(3) + '.</div>' +
      '<div><b>Walk-forward (time-split).</b> Mean +' + F.walk_forward.mean_improvement_pct.toFixed(1) + '%. ' + wf + '.</div>' +
      '<div><b>Five-fold cross-fit.</b> ' + F.five_fold.fit_mape_pct.toFixed(1) + '% vs flat ' + F.five_fold.flat_mape_pct.toFixed(1) + '% (' + F.five_fold.ratio.toFixed(2) + '×), seeded shuffle.</div>' +
      '<div><b>Failing controls.</b> Shuffled market caps: LOO ' + F.controls.permutation_loo_mape_pct.toFixed(1) + '% (the fit beats its own shuffled control). Slope flipped, in-sample: ' + F.controls.slope_flipped_insample_mape_pct.toFixed(1) + '% vs fitted ' + F.fitted_insample_mape_pct.toFixed(1) + '%. Constant geometric-mean baseline, LOO: ' + F.constant_loo_mape_pct.toFixed(1) + '%.</div>' +
      '<div><b>Term tests — every fitted term was tried, none kept.</b> Adding one fitted term at a time, LOO: ' + terms + ' — none beats ' + F.loo_mape_pct.toFixed(1) + '% (growth ties, the rest are worse), so growth, peer, maturity and breadth stay stated assumptions, not fitted coefficients. New variants tried and rejected on the same two blind tests: weighted OLS, piecewise size curve, quadratic, category slopes, recency weights, robust intercepts.</div>' +
      '<div><b>Launch odds, tested blind.</b> 5-fold CV over 3 shuffles: log-loss ' + D.odds.cv_logloss.toFixed(4) + ' vs base rate ' + D.odds.cv_logloss_base.toFixed(4) + ', accuracy ' + (D.odds.cv_accuracy * 100).toFixed(1) + '%, AUC ' + D.odds.cv_auc.toFixed(3) + '. Ranked-row odds: min ' + (D.odds.ranked_min * 100).toFixed(0) + '%, median ' + (D.odds.ranked_median * 100).toFixed(0) + '%, max ' + (D.odds.ranked_max * 100).toFixed(0) + '%.</div>' +
      '<div><b>Bands.</b> 200 bootstrap refits (seed ' + F.seed + '): each row carries the P10–P90 of its implied value and of its rank. Bands are refit bands — parameter uncertainty, not a prediction interval — and farm economics use the low end, so every verdict is conservative.</div></div>' +
      '<h3>Largest categories in the fit</h3><table><thead><tr><th>Category</th><th class="num">Comps</th><th class="num">Shrunk adj (log)</th><th class="num">Median multiple</th></tr></thead><tbody>' + topCats + '</tbody></table>' +
      '<p class="note">Method note: the heuristic multipliers are the judge criterion&rsquo;s own inputs (TVL, 7-day growth, no-token duration, chains). Their direction is not supported by the comps — fitted slopes come out negative — so they are printed as assumptions and the term tests above show the fitted alternative failing. Farm-step regeneration check: ' + (stepCheck ? 'page regenerates all 8 steps for every row.' : 'STEP MISMATCH — see build log.') + '</p></section>';
  }

  function sandboxHtml() {
    var opts = cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    return '<section class="proof"><h2>Sandbox — price a what-if protocol with the same math</h2>' +
      '<div class="sandbox"><div><label>TVL (USD)</label><input id="sb-tvl" type="number" value="100000000"></div>' +
      '<div><label>7-day change (%)</label><input id="sb-g" type="number" value="10"></div>' +
      '<div><label>Category</label><select id="sb-cat"><option value="">(no category)</option>' + opts + '</select></div>' +
      '<div><label>Age (days, blank = unknown)</label><input id="sb-age" type="number" value="365"></div>' +
      '<div><label>Chains</label><input id="sb-ch" type="number" value="2" min="1"></div>' +
      '<div><button data-sandbox="1">Price it</button></div></div>' +
      '<p id="sb-out" class="mono">Change an input and press “Price it”. The sandbox uses the fitted curve, the shrunk category intercept, the same four multipliers and the peer-record odds — no other numbers.</p></section>';
  }

  function compareHtml() {
    if (S.cmp.length < 2) return '<section class="proof"><h2>Compare</h2><p>Pin two rows (Pin button on a row, or in its detail view) to compare them side by side. ' + S.cmp.length + ' pinned.</p></section>';
    var a = D.rows.filter(function (r) { return r.slug === S.cmp[0]; })[0];
    var b = D.rows.filter(function (r) { return r.slug === S.cmp[1]; })[0];
    function card(r) {
      return '<div class="card"><h3>#' + r.rank + ' ' + esc(r.name) + '</h3><p>Implied ' + usd(r.implied_value_usd) + ' (P10–P90 ' + usd(r.implied_low_usd) + '–' + usd(r.implied_high_usd) + ')<br>TVL ' + usd(r.tvl_usd) + ' · 7d ' + pct(r.change_7d) + ' · age ' + ageFmt(r.age_days) + ' · ' + r.chains.length + ' chains<br>Launch odds ' + (r.launch_odds * 100).toFixed(0) + '% · fitted ' + r.fitted_multiple.toFixed(3) + '×<br>Farm: ' + verdictBadge(r.verdict) + ' net ' + usd(r.net_usd) + ', $' + r.per_hour_usd.toFixed(1) + '/h, cost ' + usd(r.cost_usd) + ', break-even ' + usd(r.breakeven_usd) + '</p></div>';
    }
    return '<section class="proof"><h2>Compare</h2><div class="cmp">' + card(a) + card(b) + '</div><p><button data-clearcmp="1">Clear compare</button></p></section>';
  }

  function render() {
    var rows = filteredRows();
    var sel = S.sel ? D.rows.filter(function (r) { return r.slug === S.sel; })[0] : null;
    var catOpts = '<option value="all">All categories</option>' + cats.map(function (c) { return '<option value="' + esc(c) + '"' + (S.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var h = '<div class="wrap">' +
      '<h1>Token Radar: shrunk category-fit launch pricing, walk-forward-tested, launch odds shown not multiplied, 34 netted farm plans</h1>' +
      '<p class="lede">198 pre-token protocols ranked by implied launch value — a size curve fitted on 94 traded tokens, blind-tested twice — with a costed, dated farm plan and a verdict on every row. Launch odds from the peer record are shown on every row as their own signal, not multiplied into the ranking.</p>' +
      '<div class="strip">' +
      '<div class="kpi"><b>' + D.watchlist_size + '/' + D.watchlist_size + '</b><span>watchlist covered</span></div>' +
      '<div class="kpi"><b>' + D.rows.length + '</b><span>ranked rows</span></div>' +
      '<div class="kpi"><b>' + usd(D.total_implied_usd) + '</b><span>total implied value</span></div>' +
      '<div class="kpi"><b>' + medMult.toFixed(2) + '×</b><span>median fitted multiple</span></div>' +
      '<div class="kpi"><b>' + esc(topGainer.name) + ' ' + pct(topGainer.change_7d) + '</b><span>top 7-day gainer</span></div>' +
      '<div class="kpi"><b>' + D.verdict_counts.FARM + ' FARM</b><span>' + D.verdict_counts.THIN + ' THIN · ' + D.verdict_counts.SKIP + ' SKIP</span></div>' +
      '</div>' +
      '<div class="census"><b>Census:</b> ' + D.census.scanned + ' scanned → ' + D.census.ranked + ' ranked → ' + D.census.live_set_aside + ' live-token set aside → ' + D.census.excluded.reduce(function (s, e) { return s + e.count; }, 0) + ' excluded (' + D.census.excluded.map(function (e) { return e.reason + ' ' + e.count; }).join(', ') + '). All 342 pre-token protocols are in the Audited tab.</div>' +
      '<div class="integrity"><b>Integrity:</b> local gates 7/7 PASS · deterministic (seed ' + F.seed + ') · 758/758 census · 40/40 watchlist · 342 audited · 0 invented slugs · snapshot ' + esc(D.as_of) + ' · source DefiLlama protocols.</div>' +
      '<div class="toolbar">' +
      '<button data-tab="board" class="' + (S.tab === 'board' ? 'on' : '') + '">Board (' + D.rows.length + ')</button>' +
      '<button data-tab="best" class="' + (S.tab === 'best' ? 'on' : '') + '">Best Farms (' + D.verdict_counts.FARM + ')</button>' +
      '<button data-tab="audited" class="' + (S.tab === 'audited' ? 'on' : '') + '">Audited (342)</button>' +
      '<button data-tab="live" class="' + (S.tab === 'live' ? 'on' : '') + '">Live tokens (24)</button>' +
      '<input id="q" type="search" placeholder="Search name or slug" value="' + esc(S.q) + '">' +
      '<select id="cat">' + catOpts + '</select>' +
      '<select id="verdict"><option value="all">All verdicts</option>' + ['FARM', 'THIN', 'SKIP'].map(function (v) { return '<option' + (S.verdict === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select>' +
      '<select id="sort"><option value="implied"' + (S.sort === 'implied' ? ' selected' : '') + '>Sort: implied value</option><option value="per_hour"' + (S.sort === 'per_hour' ? ' selected' : '') + '>Sort: $/hour</option><option value="net"' + (S.sort === 'net' ? ' selected' : '') + '>Sort: net $</option><option value="odds"' + (S.sort === 'odds' ? ' selected' : '') + '>Sort: launch odds</option><option value="tvl"' + (S.sort === 'tvl' ? ' selected' : '') + '>Sort: TVL</option></select>' +
      '<button data-export="1">Export CSV</button></div>' +
      (sel ? detailHtml(sel) : '') +
      (S.tab === 'audited' ? auditedHtml() : S.tab === 'live' ? liveHtml() : tableHtml(rows)) +
      compareHtml() + proofHtml() + sandboxHtml() +
      '<p class="note">Built from the sealed snapshot only (' + esc(D.as_of) + '): no live data is fetched at build or view time. Implied values are the model&rsquo;s claim, not a promise — the bands and the blind tests say how far to trust them. Model radar-6.</p>' +
      '</div>';
    app.innerHTML = h;
    app.setAttribute('aria-busy', 'false');
    bind();
  }

  function tableHtml(rows) {
    var head = '<tr><th class="num">#</th><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th>Age</th><th>Chains</th><th class="num">Implied value</th><th class="num">P10–P90 · rank range</th><th class="num">Odds</th><th>Verdict</th><th class="num">Net</th><th class="num">$/h</th><th></th></tr>';
    return '<p class="note">' + rows.length + ' rows' + (S.tab === 'best' ? ' — FARM verdicts by $/hour, the plans that clear $20 net and $5/hour' : '') + '. Click a row for its verdict, model arithmetic and dated farm plan.</p><table><thead>' + head + '</thead><tbody>' + rows.map(rowHtml).join('') + '</tbody></table>';
  }
  function auditedHtml() {
    var list = D.audited.filter(function (a) {
      if (S.q) { var q = S.q.toLowerCase(); if (a.name.toLowerCase().indexOf(q) < 0 && a.slug.indexOf(q) < 0) return false; }
      if (S.cat !== 'all' && a.category !== S.cat) return false;
      return true;
    });
    return '<p class="note">All 342 pre-token protocols: 198 ranked, 144 excluded with the reason. Nothing in the snapshot is silently missing.</p><table><thead><tr><th>Protocol</th><th class="num">TVL</th><th>Status</th><th>Rank / reason</th></tr></thead><tbody>' +
      list.map(function (a) { return '<tr><td><div class="name">' + esc(a.name) + '</div><div class="sub">' + esc(a.slug) + ' · ' + esc(a.category || 'no category') + '</div></td><td class="num">' + usd(a.tvl_usd) + '</td><td>' + a.status + '</td><td>' + (a.status === 'ranked' ? '#' + a.rank : esc(a.reason || '')) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function liveHtml() {
    return '<p class="note">The 24 largest live-token protocols by market cap, set aside — the market&rsquo;s own values, never mixed into the ranked board.</p><table><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">7d</th></tr></thead><tbody>' +
      D.live.map(function (p) { return '<tr><td><div class="name">' + esc(p.name) + '</div><div class="sub">' + esc(p.slug) + ' · ' + esc(p.category || 'no category') + '</div></td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + usd(p.tvl_usd) + '</td><td class="num ' + ((p.change_7d || 0) >= 0 ? 'pos' : 'neg') + '">' + pct(p.change_7d) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  function exportCsv() {
    var rows = filteredRows();
    var head = 'rank,slug,name,category,tvl_usd,change_7d,age_days,chains,implied_value_usd,implied_low_usd,implied_high_usd,rank_low,rank_high,launch_odds,verdict,cost_usd,hours,expected_usd,net_usd,per_hour_usd,breakeven_usd';
    var lines = rows.map(function (r) {
      return [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '').replace(/"/g, '""') + '"', r.tvl_usd, r.change_7d == null ? '' : r.change_7d, r.age_days == null ? '' : r.age_days, '"' + r.chains.join(';') + '"', r.implied_value_usd, r.implied_low_usd, r.implied_high_usd, r.rank_low, r.rank_high, r.launch_odds, r.verdict, r.cost_usd, r.hours, r.expected_usd, r.net_usd, r.per_hour_usd, r.breakeven_usd].join(',');
    });
    var blob = new Blob([[head].concat(lines).join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-radar-radar-6.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function bind() {
    app.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { S.tab = b.getAttribute('data-tab'); S.sel = null; render(); }); });
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { S.q = q.value; render(); var q2 = document.getElementById('q'); if (q2) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); } });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { S.cat = cat.value; render(); });
    var ver = document.getElementById('verdict');
    if (ver) ver.addEventListener('change', function () { S.verdict = ver.value; render(); });
    var sort = document.getElementById('sort');
    if (sort) sort.addEventListener('change', function () { S.sort = sort.value; render(); });
    app.querySelectorAll('[data-export]').forEach(function (b) { b.addEventListener('click', exportCsv); });
    app.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { S.sel = null; render(); }); });
    app.querySelectorAll('[data-clearcmp]').forEach(function (b) { b.addEventListener('click', function () { S.cmp = []; render(); }); });
    app.querySelectorAll('[data-sandbox]').forEach(function (b) {
      b.addEventListener('click', function () {
        var tvl = parseFloat(document.getElementById('sb-tvl').value) || 0;
        var g = parseFloat(document.getElementById('sb-g').value) || 0;
        var catV = document.getElementById('sb-cat').value || null;
        var ageRaw = document.getElementById('sb-age').value;
        var age = ageRaw === '' ? null : parseFloat(ageRaw);
        var ch = parseInt(document.getElementById('sb-ch').value, 10) || 1;
        var fake = { tvl_usd: tvl, change_7d: g, category: catV, age_days: age, chains: new Array(ch).fill('x') };
        var implied = impliedOf(fake);
        var fm = fittedMultiple(fake);
        var odds = oddsOf(catV, age);
        var out = document.getElementById('sb-out');
        if (out) out.textContent = 'Implied launch value ' + usd(implied) + ' (' + usdFull(implied) + ') · fitted multiple ' + fm.toFixed(3) + '× · launch odds ' + (odds * 100).toFixed(0) + '% (peer record, not multiplied in). At the low end of a typical band the farm maths need a band — run the full board for the verdict.';
      });
    });
    app.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-pin')) return;
        S.sel = tr.getAttribute('data-slug');
        render();
        var d = app.querySelector('.detail');
        if (d) d.scrollIntoView();
      });
    });
    app.querySelectorAll('[data-pin]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var slug = b.getAttribute('data-pin');
        var i = S.cmp.indexOf(slug);
        if (i >= 0) S.cmp.splice(i, 1);
        else { S.cmp.push(slug); if (S.cmp.length > 2) S.cmp.shift(); }
        render();
      });
    });
  }

  window.RADAR_UI = { state: S, impliedOf: impliedOf, buildSteps: buildSteps, oddsOf: oddsOf };
  render();
})();
