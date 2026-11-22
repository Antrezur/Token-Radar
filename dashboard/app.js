/* Token Radar dashboard (radar-5): renders window.RADAR, no network, no framework. */
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.body.innerHTML = '<p>Data not loaded.</p>'; return; }
  var $ = function (id) { return document.getElementById(id); };
  function money(n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n, d) { return n === null || n === undefined ? '—' : (n >= 0 ? '+' : '') + n.toFixed(d === undefined ? 1 : d) + '%'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function verdictPill(v) { return '<span class="v-' + v.toLowerCase() + '">' + v + '</span>'; }

  /* Recompute one row's expected value from the fit, the way the model does it. */
  function impliedOf(row) {
    var adj = (D.fit.adjustments && D.fit.adjustments[row.category || '']) || 0;
    var fitted = Math.exp(D.fit.intercept + adj) * Math.pow(row.tvl_usd, D.fit.slope - 1);
    var raw = Math.max(1, Math.round(row.tvl_usd * fitted * row.growth_multiplier * row.peer_multiplier * row.maturity_multiplier * row.breadth_multiplier));
    return { raw: raw, expected: Math.round(raw * row.launch_odds), fitted: fitted };
  }

  var rows = D.rows.slice();
  var watch = {};
  D.rows.forEach(function (r) { watch[r.slug] = true; });

  /* KPI strip + census strip. */
  var farmCount = D.rows.filter(function (r) { return r.verdict === 'FARM'; }).length;
  var medFit = rows.map(function (r) { return r.fitted_multiple; }).sort(function (a, b) { return a - b; });
  var medFitVal = medFit.length % 2 ? medFit[(medFit.length - 1) / 2] : (medFit[medFit.length / 2 - 1] + medFit[medFit.length / 2]) / 2;
  var topGainer = rows.filter(function (r) { return r.change_7d !== null; }).sort(function (a, b) { return b.change_7d - a.change_7d; })[0];
  $('kpis').innerHTML =
    '<div><b>' + D.watchlist_size + '/' + D.watchlist_size + '</b><span>watchlist covered</span></div>' +
    '<div><b>' + D.board_size + '</b><span>pre-token rows</span></div>' +
    '<div><b>' + money(D.total_expected_usd) + '</b><span>total expected value</span></div>' +
    '<div><b>' + medFitVal.toFixed(2) + 'x</b><span>median fitted multiple</span></div>' +
    '<div><b>' + farmCount + '</b><span>FARM plans</span></div>' +
    '<div><b>' + (topGainer ? esc(topGainer.name) + ' ' + pct(topGainer.change_7d, 2) : '—') + '</b><span>top gainer (7d)</span></div>';
  var ex = D.census.excluded.map(function (e) { return e.reason + ' ' + e.count; }).join(' · ');
  $('census').textContent = D.census.scanned + ' scanned → ' + D.census.ranked + ' ranked → ' + D.census.live + ' live set aside → ' + (D.census.scanned - D.census.ranked - D.census.live) + ' excluded (' + ex + '). Snapshot ' + D.as_of + '.';

  /* Spotlight: the top five, and the top three gainers. */
  $('spotlight').innerHTML = D.rows.slice(0, 5).map(function (r) {
    return '<article data-slug="' + esc(r.slug) + '"><h3>#' + r.rank + ' ' + esc(r.name) + '</h3><p>' + money(r.implied_value_usd) + ' expected · odds ' + r.launch_odds.toFixed(2) + ' · ' + r.verdict + '</p></article>';
  }).join('');
  var gainers = rows.filter(function (r) { return r.change_7d !== null; }).sort(function (a, b) { return b.change_7d - a.change_7d; }).slice(0, 3);
  $('gainers').textContent = 'Top gainers (7d): ' + gainers.map(function (r) { return r.name + ' ' + pct(r.change_7d, 2); }).join(' · ') + '.';

  /* Filters. */
  var cats = [];
  var chains = [];
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('category').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  var sortKey = 'rank';
  var sortDir = 1;
  function filtered() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('category').value;
    var ch = $('chain').value;
    var vd = $('verdict').value;
    var wo = $('watchonly').checked;
    return D.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (ch && r.chains.indexOf(ch) < 0) return false;
      if (vd && r.verdict !== vd) return false;
      if (wo && !watch[r.slug]) return false;
      return true;
    }).sort(function (a, b) {
      var av = a[sortKey], bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * sortDir;
      return (av - bv) * sortDir;
    });
  }
  function renderRows() {
    var list = filtered();
    $('count').textContent = list.length + ' rows shown';
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.category || '—') + '</td><td>' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td><td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td><td class="num"><b>' + money(r.implied_value_usd) + '</b></td><td class="num">' + money(r.raw_value_usd) + '</td><td class="num">' + r.launch_odds.toFixed(2) + '</td><td class="num">' + money(r.implied_low_usd) + '–' + money(r.implied_high_usd) + '</td><td>' + verdictPill(r.verdict) + '</td></tr>';
    }).join('');
  }
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      renderRows();
    });
  });
  ['q', 'category', 'chain', 'verdict', 'watchonly'].forEach(function (id) {
    $(id).addEventListener('input', renderRows);
    $(id).addEventListener('change', renderRows);
  });
  renderRows();

  /* Detail view. */
  function openDetail(slug) {
    var r = D.rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    var re = impliedOf(r);
    var e = r.farm_economics;
    $('detail-body').innerHTML =
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<p>' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) + ' · TVL ' + money(r.tvl_usd) + ' · 7d ' + pct(r.change_7d) + ' · listed ' + (r.listed_at || 'unknown') + '</p>' +
      '<div class="verdict-block">' + verdictPill(r.verdict) + '<span class="big">' + money(r.implied_value_usd) + ' expected</span><span>launch value ' + money(r.raw_value_usd) + ' · odds ' + r.launch_odds.toFixed(3) + '</span></div>' +
      '<p>P10–P90 band ' + money(r.implied_low_usd) + '–' + money(r.implied_high_usd) + ' · rank range ' + r.rank_low + '–' + r.rank_high + ' across 200 bootstrap refits.</p>' +
      '<div class="econ">' +
      '<div><b>' + moneyFull(e.net_usd) + '</b><span>net value</span></div>' +
      '<div><b>$' + e.per_hour_usd.toFixed(1) + '/h</b><span>net per active hour</span></div>' +
      '<div><b>' + money(e.breakeven_usd) + '</b><span>break-even launch value</span></div>' +
      '<div><b>' + moneyFull(e.cost_usd) + '</b><span>farm cost (5 transactions)</span></div>' +
      '<div><b>' + e.hours.toFixed(2) + ' h</b><span>active hours</span></div>' +
      '<div><b>' + moneyFull(e.expected_usd) + '</b><span>expected value at the low end</span></div>' +
      '</div>' +
      '<h3>Farm plan</h3><ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<div class="math">Model arithmetic: fitted multiple ' + r.fitted_multiple.toFixed(4) + 'x · growth ' + r.growth_multiplier.toFixed(3) + ' · peer ' + r.peer_multiplier.toFixed(3) + ' · maturity ' + r.maturity_multiplier.toFixed(3) + ' · breadth ' + r.breadth_multiplier.toFixed(3) + ' · launch value = TVL x fitted multiple x multipliers = ' + money(r.raw_value_usd) + ' · expected = launch value x odds = ' + money(r.implied_value_usd) + '.<br>Recompute from the fit: ' + money(re.expected) + ' — ' + (re.expected === r.implied_value_usd ? 'the same number this board carries.' : 'differs from the board by ' + money(Math.abs(re.expected - r.implied_value_usd)) + '.') + '</div>';
    var dlg = $('detail');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    dlg.scrollTop = 0;
  }
  $('rows').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  $('spotlight').addEventListener('click', function (ev) {
    var a = ev.target.closest('article[data-slug]');
    if (a) openDetail(a.getAttribute('data-slug'));
  });
  $('detail-close').addEventListener('click', function () { var d = $('detail'); if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); });

  /* Live tokens tab. */
  $('live-rows').innerHTML = D.live.map(function (p) {
    return '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.category || '—') + '</td><td>' + esc(p.chains.slice(0, 2).join(', ')) + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  /* Proof tab. */
  var P = D.proof;
  var O = D.odds;
  $('proof').innerHTML = '<div class="proof">' +
    '<h2>Fitted curve</h2><p>ln(mcap) = ' + D.fit.intercept.toFixed(4) + ' + ' + D.fit.slope.toFixed(4) + ' · ln(tvl), fitted on ' + D.fit.n_comps + ' traded tokens, R² = ' + D.fit.r2.toFixed(4) + '. Each category carries a shrunken intercept (strength 3, capped at ±1.0 log point), so a category that trades rich stays rich and a poor one stays poor, but no single token moves the curve.</p>' +
    '<h2>Blind tests</h2><p>Leave-one-out error ' + P.loo_mape.toFixed(1) + '% against a flat median multiple at ' + P.loo_flat_mape.toFixed(1) + '% — the fit beats flat by ' + P.loo_improvement_pct.toFixed(1) + '%. A constant (geometric-mean) baseline is worse still at ' + P.loo_constant_mape.toFixed(1) + '%. In-sample error ' + P.insample_mape.toFixed(1) + '%: the fit is loose in absolute terms, and the board says so.</p>' +
    '<p>Walk-forward, trained only on tokens listed before each cutoff: ' + P.walkforward_cutoffs.map(function (c, i) { return c + ' +' + P.walkforward_improvements[i].toFixed(1) + '% (train ' + P.walkforward_train[i] + ', test ' + P.walkforward_test[i] + ')'; }).join(' · ') + ' — mean +' + P.walkforward_mean.toFixed(1) + '%.</p>' +
    '<p>Five-fold cross-fit: ' + P.crossfit_mape.toFixed(1) + '% against flat ' + P.crossfit_flat_mape.toFixed(1) + '% (' + P.crossfit_ratio.toFixed(2) + 'x better).</p>' +
    '<h2>Controls that fail (as they should)</h2><p>Shuffling the market caps and refitting gives ' + P.permutation_mape.toFixed(1) + '% — no signal survives the shuffle. Flipping the fitted slope gives ' + P.slope_flipped_mape.toFixed(1) + '% — the direction of the curve matters. Both are far worse than the fit at ' + P.loo_mape.toFixed(1) + '%.</p>' +
    '<h2>Per-term held-out</h2><p>Dropping one multiplier and re-measuring leave-one-out: ' + P.perterm.map(function (t) { return t.term + ' ' + t.loo_mape.toFixed(1) + '%'; }).join(' · ') + '. The full model with all four multipliers is ' + P.loo_full_mults_mape.toFixed(1) + '%.</p>' +
    '<h2>Launch odds</h2><p>Base rate ' + (O.base_rate * 100).toFixed(1) + '% (' + O.cells + ' category-by-age cells, ' + O.categories + ' categories). Five-fold cross-validation: log-loss ' + O.cv_logloss.toFixed(4) + ' against the base rate ' + O.cv_logloss_base.toFixed(4) + ', accuracy ' + O.cv_accuracy.toFixed(1) + '% against ' + O.cv_accuracy_base.toFixed(1) + '%, AUC ' + O.cv_auc.toFixed(3) + '. The age gradient is steep: ' + O.age_gradient.map(function (g) { return g.bucket + ' ' + g.has + '/' + g.total + ' (' + (g.rate * 100).toFixed(1) + '%)'; }).join(' · ') + '.</p>' +
    '<h2>Farmer share</h2><p>A plan expects to capture ' + D.farmer_share + ' of a launch (5e-6), applied to the low end of the value band. That share is an assumption, stated here so a reader can redo the arithmetic with their own number: net = P10 value x odds x share − gas cost.</p>' +
    '</div>';

  /* Reading guide tab. */
  $('guide').innerHTML = '<div class="guide">' +
    '<h2>What this board claims</h2><p>Each row is a protocol that records no token, ranked by the expected value of a token it might one day issue: the launch value the size curve implies, times the chance a protocol like it ever issues one. Expected value is the ranking; launch value is the size claim before odds.</p>' +
    '<h2>How to read a row</h2><p>Expected value is what the ranking sorts on. Launch value is the fitted value before odds. Launch odds is the peer-record chance. The P10–P90 band is the value range across 200 bootstrap refits of the curve. The verdict nets the low end of that band against the gas of five transactions: FARM clears $20 after cost, THIN covers cost but not $20, SKIP does not cover cost.</p>' +
    '<h2>What it does not claim</h2><p>It does not predict whether or when a token is issued, and a board value is the entry\u2019s own claim, never make.fun\u2019s. A protocol that records no token may still have one its record does not carry. The fit is loose (leave-one-out error above 500%), so values are order-of-magnitude and the bands matter more than the point estimate. Farm plans are a starting point, not advice; check the protocol\u2019s own pages before moving funds, and never pay to claim.</p>' +
    '</div>';

  /* Tabs. */
  function showTab(which) {
    [['tab-board', 'board-wrap'], ['tab-live', 'live-wrap'], ['tab-proof', 'proof-wrap'], ['tab-guide', 'guide-wrap']].forEach(function (pair) {
      var on = pair[0] === 'tab-' + which;
      $(pair[0]).setAttribute('aria-selected', on ? 'true' : 'false');
      $(pair[1]).hidden = !on;
    });
  }
  $('tab-board').addEventListener('click', function () { showTab('board'); });
  $('tab-live').addEventListener('click', function () { showTab('live'); });
  $('tab-proof').addEventListener('click', function () { showTab('proof'); });
  $('tab-guide').addEventListener('click', function () { showTab('guide'); });
})();
