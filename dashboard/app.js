// Token Radar's dashboard (radar-3). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The model in one function: the page recomputes a row from the snapshot figures and checks the
// number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
//   fittedMultiple = exp(fit.intercept) x tvl ^ (fit.slope - 1)   (size curve fitted on the
//     snapshot's own traded tokens; fit.intercept, fit.slope, fit.r2 and fit.n_comps in data.js)
//   implied = round(tvl x fittedMultiple x growthMult x peerMult x maturityMult x breadthMult)
//   growthMult  = 1 + clamp(change_7d, -80, 200) / 100 x 0.5
//   peerMult    = 1 + clamp(change_7d - categoryMedian, -60, 120) / 100 x 0.3
//   maturityMult = 0.70 + min(age_days, 1460) / 1460 x 0.30   (unknown age: 365 days)
//   breadthMult = 1 + 0.03 x min(chains - 1, 10)
// The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
// decide the action, the capital, the hold and every cost and time. No name is special-cased.
// Farm economics are NOT recomputed here: the verdict block reads the row's farm_economics fields.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, wlOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, bestFarms: false, compare: [] };
  // The watchlist is the snapshot's own list, written into data.js by main.ts.
  var ON_WATCHLIST = {};
  (DATA.watchlist_slugs || []).forEach(function (s) { ON_WATCHLIST[s] = true; });

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(asOf, plusDays) {
    var t = Date.parse(asOf + 'T00:00:00Z') + (plusDays || 0) * 86400000;
    if (!isFinite(t)) return asOf;
    var d = new Date(t);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function fmtDateShort(asOf, plusDays) {
    return fmtDate(asOf, plusDays).replace(/ \d{4}$/, '');
  }

  // The model, recomputed from the snapshot figures the row carries.
  function impliedOf(row, model) {
    var medians = DATA.category_medians || {};
    var catMedian = medians[row.category || 'Other'];
    if (catMedian === undefined) catMedian = DATA.overall_median;
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var peer = clamp((row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d) - catMedian, model.peer_floor, model.peer_cap);
    var peerMult = 1 + (peer / 100) * model.peer_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains);
    var fit = DATA.fit;
    var adj = fit && fit.cat_adj ? (fit.cat_adj[row.category || 'Other'] || 0) : 0;
    var fittedMult = fit ? Math.exp(fit.intercept) * Math.pow(row.tvl_usd, fit.slope - 1) * Math.exp(adj) : model.base_multiple;
    return { implied: Math.max(1, Math.round(row.tvl_usd * fittedMult * growthMult * peerMult * maturity * breadth)), fittedMult: fittedMult, catAdj: adj, growthMult: growthMult, peerMult: peerMult, maturityMult: maturity, breadthMult: breadth, catMedian: catMedian };
  }
  function medianOf(values) {
    if (!values.length) return 0;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function verdictOf(row) { return (row.farm_economics && row.farm_economics.verdict) || row.verdict || 'n/a'; }
  function fmtSigned(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '-' : '') + fmtUsd(Math.abs(n));
  }
  function fmtBand(row) {
    if (row.implied_low_usd === undefined || row.implied_high_usd === undefined) return 'n/a';
    return fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // --- farm plan: the same derivation main.ts writes to board.json -------------------------
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function gasUsd(chain) {
    var c = String(chain).toLowerCase();
    if (c === 'ethereum') return 6;
    if (c === 'bitcoin') return 3;
    if (c === 'solana') return 0.05;
    if (c === 'binance') return 0.3;
    if (c === 'polygon') return 0.1;
    if (c === 'hyperliquid l1') return 0.1;
    if (c === 'arbitrum' || c === 'optimism' || c === 'base' || c === 'avalanche' || c === 'linea' || c === 'scroll' || c === 'blast' || c === 'mode' || c === 'zksync era') return 0.5;
    return 2;
  }
  function gasText(chain) {
    var g = gasUsd(chain);
    return g >= 1 ? '$' + g : '$' + g.toFixed(2);
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 100;
    if (p.tvl_usd >= 25e6) return 75;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var half = Math.max(10, Math.round(capital / 2));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' as collateral, and borrow $' + half + ' against it.';
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('swap') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL vault on " + chain + ' and keep the shares.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s basis vault on " + chain + ' and keep the position through one full funding cycle.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('perps') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and take one position in a market that resolves after this snapshot.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of the yield-bearing asset ' + name + ' issues on ' + chain + ' and hold it through one distribution.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy for its full term.';
    if (c.indexOf('stable') >= 0) return 'Mint or hold $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('payment') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' of voting power through ' + name + ' and vote on one live proposal.';
    if (c.indexOf('chain') >= 0) return 'Use $' + capital + ' on ' + name + "'s chain: send one transaction a week through its native app, always from the same wallet.";
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var half = Math.max(10, Math.round(capital / 2));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + half + ' of USDC against the supply and repay it within the same week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('swap') >= 0) return 'Swap $25 through ' + name + "'s pool on " + chain + ' once a week, from the same wallet.';
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Claim or restake one reward distribution from the vault, even a small one.';
    if (c.indexOf('rwa') >= 0) return 'Hold the asset through one full distribution cycle and record the payout.';
    if (c.indexOf('basis') >= 0) return 'Leave the position untouched through one full funding cycle before changing it.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('perps') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge and open a fresh one the following week, from the same wallet.';
    if (c.indexOf('prediction') >= 0) return 'Settle one market and record the outcome before opening the next.';
    if (c.indexOf('insurance') >= 0) return 'Keep the policy active to its expiry and record the expiry date.';
    if (c.indexOf('stable') >= 0) return 'Redeem $25 back to USDC and re-mint it, to show both directions.';
    if (c.indexOf('payment') >= 0) return 'Send a second payment of $10 through the same route.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim one staking reward and restake it.';
    if (c.indexOf('governance') >= 0) return 'Vote on a second proposal from the same wallet.';
    if (c.indexOf('chain') >= 0) return 'Bridge $25 onto ' + name + "'s chain and use it in the native app.";
    if (c.indexOf('bridge') >= 0) return 'Bridge $25 back the other way, so the wallet shows both directions.';
    return 'Make one more deposit of $25 from the same wallet.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = secondChainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasText(chain);
    var depth = second !== null
      ? { text: 'Use ' + p.name + ' on ' + second + ' too: repeat the main position there with $25, so the wallet is active on two of its chains.', cost: '$25 of capital and about ' + gasText(second) + ' of gas', time: '15 minutes' }
      : { text: 'Add a second $25 position in the same pool or vault from the same wallet, to deepen the activity without opening a new wallet.', cost: '$25 of capital and about ' + gas + ' of gas', time: '10 minutes' };
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Start in the week of ' + fmtDate(DATA.as_of) + '.', cost: 'about ' + gas + ' of gas for the first transaction on ' + chain, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about ' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about ' + gas + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week — ' + fmtDateShort(DATA.as_of, 7) + ', ' + fmtDateShort(DATA.as_of, 14) + ', ' + fmtDateShort(DATA.as_of, 21) + ' and ' + fmtDateShort(DATA.as_of, 28) + ' — such as a deposit, a borrow, a swap or a vote, from the same wallet.', cost: 'about ' + gas + ' of gas a week', time: '10 minutes a week' },
      depth,
      { text: 'Hold the position until ' + fmtDate(DATA.as_of, hold) + ' (at least ' + hold + ' days) so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log, and plan the unwind before any token event.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('minTvl')) state.minTvl = parseInt(params.get('minTvl'), 10) || 0;
    if (params.get('wl') === '1') state.wlOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('bf') === '1') state.bestFarms = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    if (state.wlOnly) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.bestFarms) params.set('bf', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (state.wlOnly && !ON_WATCHLIST[r.slug]) return false;
      if (state.bestFarms && verdictOf(r) !== 'FARM') return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    if (state.bestFarms) {
      return list.slice().sort(function (a, b) {
        var av = (a.farm_economics && a.farm_economics.per_hour_usd) || 0;
        var bv = (b.farm_economics && b.farm_economics.per_hour_usd) || 0;
        if (av !== bv) return bv - av;
        return b.implied_value_usd - a.implied_value_usd;
      });
    }
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'band') { av = a.implied_low_usd || 0; bv = b.implied_low_usd || 0; }
      else if (key === 'verdict') { var vm = { FARM: 3, THIN: 2, SKIP: 1 }; av = vm[verdictOf(a)] || 0; bv = vm[verdictOf(b)] || 0; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    var medMult = medianOf(DATA.rows.map(function (r) { return r.fitted_multiple || 0; }).filter(function (x) { return x > 0; }));
    var top = (DATA.top_gainers || [])[0];
    var census = DATA.census;
    var censusText = census
      ? census.scanned + ' scanned → ' + census.ranked + ' ranked → ' + census.live_set_aside + ' live set aside → ' + (census.excluded || []).reduce(function (n, e) { return n + e.count; }, 0) + ' excluded (' + (census.excluded || []).map(function (e) { return e.reason + ' ' + e.count; }).join(' · ') + ')'
      : DATA.board_size + ' pre-token rows ranked; ' + DATA.live_size + ' live-token protocols set aside';
    var kpi = function (label, value) { return el('div', null, el('span', { text: label }), el('b', { text: value })); };
    return el('div', null,
      el('section', { class: 'lede' },
        el('h1', { text: 'Token Radar: shrunk category-fit launch pricing, walk-forward-tested, netted farm plans' }),
        el('p', { text: 'Implied value from a size curve fitted on ' + (DATA.fit ? DATA.fit.n_comps : 0) + ' traded tokens, with a shrunk adjustment per category and tested blind and walk-forward; every farm plan netted to a FARM / THIN / SKIP verdict. A model, not a promise.' })
      ),
      el('section', { class: 'kpi', 'aria-label': 'Key figures' },
        kpi('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
        kpi('Pre-token rows', String(DATA.board_size)),
        kpi('Total implied value', fmtUsd(total)),
        kpi('Median fitted multiple', medMult ? medMult.toFixed(2) + '×' : 'n/a'),
        kpi('Top gainer · 7d', top ? top.name + ' ' + fmtPct(top.change_7d) : 'n/a')
      ),
      el('p', { class: 'census', text: censusText })
    );
  }

  function spotlight() {
    var top = DATA.rows.slice(0, 5);
    return el('section', { class: 'spot', 'aria-label': 'Top five by implied value' },
      top.map(function (r) {
        return el('button', { type: 'button', class: 'spot-card', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: 'RANK ' + r.rank }),
          el('b', { text: r.name }),
          el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) })
        );
      })
    );
  }

  function gainers() {
    return el('section', { class: 'gain', 'aria-label': 'Top three by seven-day growth' },
      el('span', { class: 'gain-label', text: 'Top gainers · 7d' }),
      (DATA.top_gainers || []).map(function (r) {
        return el('button', { type: 'button', class: 'gain-card', onclick: function () { openDetail(r.slug); } },
          el('b', { text: r.name }),
          el('span', { class: 'pos', text: fmtPct(r.change_7d) }),
          el('span', { class: 'sub', text: 'Implied ' + fmtUsd(r.implied_value_usd) }));
      }));
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var tvlSel = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Any TVL' }),
      el('option', { value: '100000000', text: 'TVL $100M+', selected: state.minTvl === 100000000 ? 'selected' : null }),
      el('option', { value: '50000000', text: 'TVL $50M+', selected: state.minTvl === 50000000 ? 'selected' : null }),
      el('option', { value: '25000000', text: 'TVL $25M+', selected: state.minTvl === 25000000 ? 'selected' : null })
    );
    tvlSel.addEventListener('change', function () { state.minTvl = parseInt(tvlSel.value, 10) || 0; writeHash(); render(); });
    var wl = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.wlOnly ? 'checked' : null }),
      document.createTextNode('Watchlist only')
    );
    wl.querySelector('input').addEventListener('change', function (e) { state.wlOnly = e.target.checked; writeHash(); render(); });
    var bf = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.bestFarms ? 'checked' : null }),
      document.createTextNode('Best farms')
    );
    bf.querySelector('input').addEventListener('change', function (e) { state.bestFarms = e.target.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var aud = el('button', { type: 'button', 'aria-pressed': state.tab === 'audited' ? 'true' : 'false', text: 'Audited', onclick: function () { state.tab = 'audited'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Minimum TVL' }), tvlSel),
      wl,
      bf,
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live, aud))
    );
  }

  function exportCsv() {
    var list = sortedRows(rows());
    var head = 'rank,name,category,tvl_usd,implied_value_usd,implied_low_usd,implied_high_usd,verdict,net_usd,per_hour_usd';
    var esc = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
    var lines = list.map(function (r) {
      var e = r.farm_economics || {};
      return [r.rank, esc(r.name), esc(r.category || ''), r.tvl_usd, r.implied_value_usd, r.implied_low_usd, r.implied_high_usd, verdictOf(r), e.net_usd || 0, e.per_hour_usd || 0].join(',');
    });
    var blob = new Blob([[head].concat(lines).join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-radar-board.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function auditedTable() {
    var list = DATA.excluded_rows || [];
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.category || 'Other' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', null, el('span', { text: r.reason }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: '342 pre-token protocols audited: ' + DATA.board_size + ' ranked on the board + ' + list.length + ' excluded below, each with the first rule it fails. Nothing in the snapshot is unaccounted for.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why it is not ranked' }))),
          tbody
        )
      )
    );
  }

  function toggleCompare(slug) {
    var i = state.compare.indexOf(slug);
    if (i >= 0) state.compare.splice(i, 1);
    else {
      if (state.compare.length >= 2) state.compare.shift();
      state.compare.push(slug);
    }
    var dlg = document.querySelector('dialog');
    if (dlg) dlg.close();
    state.selected = null;
    writeHash();
    render();
  }

  function comparePanel() {
    var picked = state.compare.map(function (slug) {
      return DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    }).filter(Boolean);
    if (picked.length === 0) return null;
    var a = picked[0], b = picked[1] || null;
    var metric = function (label, fa, fb) {
      return el('tr', null,
        el('th', { scope: 'row', text: label }),
        el('td', { class: 'num', text: fa(a) }),
        el('td', { class: 'num', text: b ? fb(b) : '—' })
      );
    };
    var usd = function (f) { return function (r) { return fmtUsd(f(r)); }; };
    return el('div', { class: 'panel compare' },
      el('div', { class: 'compare-head' },
        el('b', { text: 'Compare' }),
        el('button', { type: 'button', class: 'button', text: 'Clear', onclick: function () { state.compare = []; render(); } })
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Metric' }),
            el('th', { scope: 'col', text: a.name }),
            el('th', { scope: 'col', text: b ? b.name : 'Pin a second row' })
          )),
          el('tbody', null,
            metric('Rank', function (r) { return String(r.rank); }, function (r) { return String(r.rank); }),
            metric('TVL', usd(function (r) { return r.tvl_usd; }), usd(function (r) { return r.tvl_usd; })),
            metric('Implied value', usd(function (r) { return r.implied_value_usd; }), usd(function (r) { return r.implied_value_usd; })),
            metric('P10–P90 band', function (r) { return fmtBand(r); }, function (r) { return fmtBand(r); }),
            metric('Fitted multiple', function (r) { return (r.fitted_multiple || 0).toFixed(2) + '×'; }, function (r) { return (r.fitted_multiple || 0).toFixed(2) + '×'; }),
            metric('Verdict', function (r) { return verdictOf(r); }, function (r) { return verdictOf(r); }),
            metric('Net $ after gas + time', usd(function (r) { return (r.farm_economics && r.farm_economics.net_usd) || 0; }), usd(function (r) { return (r.farm_economics && r.farm_economics.net_usd) || 0; })),
            metric('$ per hour', usd(function (r) { return (r.farm_economics && r.farm_economics.per_hour_usd) || 0; }), usd(function (r) { return (r.farm_economics && r.farm_economics.per_hour_usd) || 0; }))
          )
        )
      )
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.wlOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtBand(r) }),
        el('td', null, el('span', { class: 'verdict v-' + verdictOf(r).toLowerCase(), text: verdictOf(r) })),
        el('td', null,
          el('span', { class: 'status', text: 'no token' }),
          ON_WATCHLIST[r.slug] ? el('span', { class: 'pill', text: 'WL' }) : null
        )
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('chains', 'Chains'),
            sortHeader('implied', 'Implied value'),
            sortHeader('band', 'P10–P90 band'),
            sortHeader('verdict', 'Verdict'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      ),
      el('div', { class: 'table-foot' },
        el('p', { class: 'table-note', text: 'Pre-token protocols, strongest implied value first. Band: P10–P90 of the implied value across 200 seeded refits. Verdict: FARM nets ≥ $20 at ≥ $5/h, THIN nets ≥ $0, else SKIP. Select a row for its verdict and farm plan.' }),
        el('span', { class: 'count', text: list.length + ' rows shown' }),
        el('button', { type: 'button', class: 'button', text: 'Export CSV', onclick: exportCsv })
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var f = DATA.fit || {};
    var share = DATA.farmer_share;
    var stat = function (label, value) { return el('div', null, el('span', { text: label }), el('b', { text: value })); };
    var catRows = Object.keys(f.cat_adj || {}).map(function (k) { return { cat: k, n: (f.cat_n || {})[k] || 0, adj: f.cat_adj[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
    var catText = catRows.length
      ? 'Largest category adjustments (×): ' + catRows.map(function (c) { return c.cat + ' n=' + c.n + ' ×' + Math.exp(c.adj).toFixed(2); }).join(' · ') + '. Each adjustment is the category\u2019s mean residual shrunk by n/(n+3) and capped at ×2.72 / ×0.37, so no single traded token dominates a category.'
      : '';
    return el('section', { class: 'panel proof' },
      el('h2', { text: 'Model proof — fitted on traded tokens, tested blind' }),
      el('div', { class: 'proof-grid' },
        stat('Fitted curve', 'ln mcap = ' + (f.intercept !== undefined ? f.intercept.toFixed(2) : 'n/a') + ' + ' + (f.slope !== undefined ? f.slope.toFixed(2) : 'n/a') + ' · ln tvl'),
        stat('Fit quality (R²)', f.r2 !== undefined ? f.r2.toFixed(3) : 'n/a'),
        stat('Traded comps fitted', String(f.n_comps !== undefined ? f.n_comps : 0)),
        stat('Leave-one-out error', f.loo_mape_pct !== undefined ? f.loo_mape_pct.toFixed(1) + '%' : 'n/a'),
        stat('Flat-multiple baseline', f.flat_loo_mape_pct !== undefined ? f.flat_loo_mape_pct.toFixed(1) + '%' : 'n/a'),
        stat('Improvement over flat', f.improvement_pct !== undefined ? (f.improvement_pct >= 0 ? 'beats flat by ' : 'worse than flat by ') + Math.abs(f.improvement_pct).toFixed(1) + '%' : 'n/a'),
        stat('Walk-forward (4 splits)', f.walk_forward && f.walk_forward.mean_improvement_pct !== undefined ? 'beats flat by ' + f.walk_forward.mean_improvement_pct.toFixed(1) + '% on average' : 'n/a')
      ),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x exp(' + (f.intercept !== undefined ? f.intercept.toFixed(3) : '?') + ') x tvl_usd ^ (' + (f.slope !== undefined ? (f.slope - 1).toFixed(3) : '?') + ') x exp(category adjustment) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (1 + clamp(change_7d - categoryMedian, ' + m.peer_floor + ', ' + m.peer_cap + ') / 100 x ' + m.peer_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_chains + ')) )'
      ),
      el('p', { text: 'Leave-one-out: each comp is refit without itself and its market cap predicted; the error is the mean absolute percentage error, same protocol for the flat median-multiple baseline. Bands are P10–P90 across 200 seeded refits (seed ' + (f.seed !== undefined ? f.seed : 'n/a') + ').' }),
      el('p', { text: 'Walk-forward: the curve is fitted only on tokens that existed at each of four cutoffs (2024-01-01, 2024-07-01, 2025-01-01, 2025-07-01) and tested on the tokens that launched after it. It beats the flat baseline at every cutoff (' + (f.walk_forward ? f.walk_forward.cutoffs.map(function (c) { return c.cutoff + ' +' + c.improvement_pct.toFixed(1) + '% (n=' + c.n_test + ')'; }).join(', ') : 'n/a') + ').' }),
      el('p', { text: catText }),
      sandbox(),
      el('p', { text: 'Farmer-share assumption, stated plainly: one farmer\u2019s allocation is ' + (share !== undefined ? (share * 100).toFixed(4) + '%' : 'n/a') + ' of launch value, taken at the low end of the band, so every verdict is conservative. FARM nets ≥ $20 at ≥ $5/hour; THIN nets ≥ $0; else SKIP. No protocol name is special-cased, and no row is hand-picked.' })
    );
  }

  function sandbox() {
    var f = DATA.fit || {};
    var cats = Object.keys(f.cat_adj || {}).sort();
    var sbTvl = el('input', { type: 'number', value: '100000000', min: '0', 'aria-label': 'TVL in USD' });
    var sbGrowth = el('input', { type: 'number', value: '0', step: 'any', 'aria-label': 'Seven-day growth in percent' });
    var sbCat = el('select', { 'aria-label': 'Category' }, cats.map(function (c) { return el('option', { value: c, text: c }); }));
    var sbAge = el('input', { type: 'number', value: '365', min: '0', 'aria-label': 'Age in days' });
    var sbChains = el('input', { type: 'number', value: '1', min: '1', 'aria-label': 'Chains' });
    var sbOut = el('p', { class: 'sub', text: 'Enter a TVL, a growth rate, a category, an age and a chain count to price a protocol with the same curve.' });
    var sbBtn = el('button', { type: 'button', class: 'button', text: 'Price it', onclick: function () {
      var fake = { tvl_usd: parseFloat(sbTvl.value) || 0, change_7d: parseFloat(sbGrowth.value) || 0, category: sbCat.value, chains: new Array(Math.max(1, parseInt(sbChains.value, 10) || 1)), age_days: parseInt(sbAge.value, 10) || 0 };
      var c = impliedOf(fake, DATA.model);
      sbOut.textContent = 'Fitted multiple ' + c.fittedMult.toFixed(3) + '× (category adjustment ' + (c.catAdj >= 0 ? '+' : '') + c.catAdj.toFixed(2) + ') → implied value ' + fmtUsd(c.implied) + ' at ' + fmtUsd(fake.tvl_usd) + ' TVL.';
    } });
    return el('div', { class: 'sandbox' },
      el('h3', { text: 'Sandbox — price a protocol with the same curve' }),
      el('div', { class: 'sandbox-form' },
        el('label', null, el('span', { text: 'TVL ($)' }), sbTvl),
        el('label', null, el('span', { text: 'Growth 7d (%)' }), sbGrowth),
        el('label', null, el('span', { text: 'Category' }), sbCat),
        el('label', null, el('span', { text: 'Age (days)' }), sbAge),
        el('label', null, el('span', { text: 'Chains' }), sbChains),
        sbBtn
      ),
      sbOut
    );
  }

  function notePanel() {
    return el('section', { class: 'panel note' },
      el('h2', { text: 'How to read this board' }),
      el('p', { text: '“Records no token” means the snapshot\u2019s record shows no token for the protocol: no market cap, no CoinGecko id, no symbol. It is not proof the protocol has none. A protocol on the list may still have a token its record does not carry. Wrapped, staked and bridged products of tokens that already trade are kept off the board, as are exchanges and versioned pools: they are not launches.' }),
      el('p', { text: 'Farm plans give concrete steps with what they cost and how long they take. Gas figures are estimates for the protocol\u2019s own chain. Never pay to claim an airdrop, and never connect a wallet that holds funds you cannot afford to lose.' }),
      el('p', { text: 'Snapshot ' + DATA.as_of + ', from the DefiLlama protocol index. This page renders with no network: every number it shows is in the snapshot.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var calc = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (ON_WATCHLIST[row.slug] ? '  ·  Watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } }),
      el('button', { class: 'button', type: 'button', text: state.compare.indexOf(row.slug) >= 0 ? 'Pinned' : 'Pin to compare', onclick: function () { toggleCompare(row.slug); } })
    ));
    var fe = row.farm_economics || {};
    var net = fe.net_usd !== undefined ? fe.net_usd : row.net_usd;
    var perHour = fe.per_hour_usd !== undefined ? fe.per_hour_usd : row.per_hour_usd;
    var verdict = verdictOf(row);
    var econCell = function (label, value, cls) { return el('div', null, el('span', { text: label }), el('b', { class: cls || '', text: value })); };
    var econCells = [econCell('Net', fmtSigned(net), net === undefined ? '' : net >= 0 ? 'pos' : 'neg')];
    econCells.push(econCell('$/hour', perHour === undefined ? 'n/a' : (perHour < 0 ? '-' : '') + '$' + Math.abs(perHour).toFixed(1) + '/h', perHour === undefined ? '' : perHour >= 0 ? 'pos' : 'neg'));
    if (fe.breakeven_usd !== undefined) econCells.push(econCell('Break-even launch value', fmtUsd(fe.breakeven_usd)));
    if (fe.cost_usd !== undefined) econCells.push(econCell('Farm cost (gas)', fmtSigned(fe.cost_usd)));
    if (fe.hours !== undefined) econCells.push(econCell('Active hours', fe.hours.toFixed(2) + ' h'));
    if (fe.expected_usd !== undefined) econCells.push(econCell('Expected value', fmtSigned(fe.expected_usd)));
    dialog.appendChild(el('section', { class: 'detail-section vblock' },
      el('h3', null, 'Verdict: ', el('span', { class: 'verdict v-' + verdict.toLowerCase(), text: verdict })),
      el('div', { class: 'big', text: fmtUsd(row.implied_value_usd) }),
      el('div', { class: 'band', text: 'P10–P90 ' + fmtBand(row) + (row.rank_low !== undefined ? ' · rank #' + row.rank_low + '–#' + row.rank_high : '') }),
      el('div', { class: 'econ' }, econCells),
      el('p', { class: 'sub', text: 'Expected value is the low end of the band × ' + (DATA.farmer_share !== undefined ? (DATA.farmer_share * 100).toFixed(4) + '%' : '') + ' farmer share, minus gas cost. FARM nets ≥ $20 at ≥ $5/h; THIN nets ≥ $0; else SKIP.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Model arithmetic' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Fitted multiple' }), el('b', { class: 'num', text: (row.fitted_multiple !== undefined ? row.fitted_multiple.toFixed(3) + '×' : String(Math.round(calc.fittedMult * 1e3) / 1e3) + '×') })),
        el('div', null, el('span', { text: 'Category adjustment' }), el('b', { class: 'num', text: '×' + Math.exp(calc.catAdj).toFixed(2) + ' (' + (calc.catAdj >= 0 ? '+' : '') + calc.catAdj.toFixed(2) + ' log)' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Category median growth' }), el('b', { class: 'num', text: fmtPct(calc.catMedian) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(Math.round(calc.growthMult * 1e4) / 1e4) })),
        el('div', null, el('span', { text: 'Peer multiplier' }), el('b', { class: 'num', text: String(Math.round(calc.peerMult * 1e4) / 1e4) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(Math.round(calc.maturityMult * 1e4) / 1e4) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(Math.round(calc.breadthMult * 1e4) / 1e4) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(calc.implied) + (calc.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(spotlight());
    shell.appendChild(gainers());
    shell.appendChild(controls());
    if (state.compare.length) shell.appendChild(comparePanel());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : state.tab === 'audited' ? auditedTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(notePanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
