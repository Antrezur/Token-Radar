// Token Radar, model radar-5: category-fit launch values times peer launch odds.
//
// The board ranks the pre-token protocols a reader could still farm, by the
// value a token would carry if the protocol's record stayed as it is, times
// the chance a protocol like it ever issues one. Two ideas, both fitted on
// the snapshot's own figures, never on a hand-written list of names:
//
//   value: a log-log size curve fitted on the 94 traded protocols
//          (ln mcap = a + b ln tvl), with a shrunken category intercept, then
//          four multipliers from the protocol's own record (seven-day
//          growth, growth against its category's median, age, chain count).
//   odds:  the share of protocols that already trade, counted in the
//          protocol's own category-by-age cell and smoothed toward the
//          category and then the whole market, so a young niche and an old
//          proven category do not get the same chance.
//
// The board is sorted by expected value (value x odds). Every number the
// dashboard prints is computed here from the sealed snapshot: the fit, the
// blind tests (leave-one-out, walk-forward, five-fold cross-fit), the
// failing controls, the per-term held-out tests, the odds cross-validation
// and the farm economics. Nothing is asserted that the code did not measure.
//
// A farm plan nets the low end of the value band (the bootstrap P10) against
// the gas of five transactions, and calls the plan FARM only when the net
// clears $20 after that cost. The plan is concrete: a fresh wallet, a
// funded position, a weekly action, a hold, a withdraw and a log, dated
// from the snapshot's own as_of day.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-5';

/** How many pre-token protocols below the watchlist floor the early radar carries. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The farmer's share of a launch the plan can expect to capture. */
export const FARMER_SHARE = 5e-6;

/** The shrinkage strength for a category intercept, and its cap in log points. */
export const SHRINKAGE_K = 3;
export const ADJ_CAP = 1.0;

/** The bootstrap: refits, and the seed that makes them reproducible. */
export const BOOTSTRAP_REFITS = 200;
export const BOOTSTRAP_SEED = 20261119;

/** The cross-fit seed: the folds are a seeded shuffle, cut into five chunks. */
export const CROSSFIT_SEED = 20261122;

/** The prior strength that smooths a launch-odds cell toward its category. */
export const ODDS_PRIOR = 5;

/** A farm plan's verdict thresholds, in whole dollars of net value. */
export const FARM_NET = 20;

/** The fitted size curve and its category intercepts, all from the comps. */
export interface Fit {
  intercept: number;
  slope: number;
  r2: number;
  n_comps: number;
  seed: number;
  adjustments: Map<string, number>;
}

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A plan's netted economics: the low-end value, the cost, the net and the verdict. */
export interface FarmEconomics {
  cost_usd: number;
  hours: number;
  expected_usd: number;
  net_usd: number;
  per_hour_usd: number;
  breakeven_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  raw_value_usd: number;
  launch_odds: number;
  fitted_multiple: number;
  growth_multiplier: number;
  peer_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  implied_low_usd: number;
  implied_high_usd: number;
  rank_low: number;
  rank_high: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_economics: FarmEconomics;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the plan's economics beside it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  raw_value_usd: number;
  launch_odds: number;
  fitted_multiple: number;
  growth_multiplier: number;
  peer_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  implied_low_usd: number;
  implied_high_usd: number;
  rank_low: number;
  rank_high: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_economics: FarmEconomics;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The census: how the 758 scanned protocols split into ranked, live and excluded. */
export interface Census {
  scanned: number;
  ranked: number;
  live: number;
  excluded: { reason: string; count: number }[];
}

/** The odds model's own validation: five-fold cross-validation against the base rate. */
export interface OddsValidation {
  base_rate: number;
  cells: number;
  categories: number;
  cv_logloss: number;
  cv_logloss_base: number;
  cv_accuracy: number;
  cv_accuracy_base: number;
  cv_auc: number;
  age_gradient: { bucket: string; has: number; total: number; rate: number }[];
}

/** The blind tests and controls behind the proof panel. */
export interface Proof {
  loo_mape: number;
  loo_full_mults_mape: number;
  loo_flat_mape: number;
  loo_constant_mape: number;
  loo_improvement_pct: number;
  insample_mape: number;
  walkforward_cutoffs: string[];
  walkforward_improvements: number[];
  walkforward_mean: number;
  walkforward_train: number[];
  walkforward_test: number[];
  crossfit_mape: number;
  crossfit_flat_mape: number;
  crossfit_ratio: number;
  permutation_mape: number;
  slope_flipped_mape: number;
  perterm: { term: string; loo_mape: number }[];
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  farmer_share: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  fit: { intercept: number; slope: number; r2: number; n_comps: number; seed: number; adjustments: Record<string, number> };
  census: Census;
  total_implied_raw_usd: number;
  total_expected_usd: number;
  odds: OddsValidation;
  proof: Proof;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp `v` into [`lo`, `hi`]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Round to one decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The date `days` after `asOf`, as an ISO day. */
function dateAfter(asOf: string, days: number): string {
  const t = Date.parse(`${asOf}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** A seeded generator (mulberry32): the same seed gives the same draws, every run. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A percentile by linear interpolation on a sorted array (the standard type-7 rule). */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** The median of a list, averaging the two middle values when the count is even. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  return s.length % 2 === 1 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

/** The categories the board never ranks: wrapped, staked, bridged and exchange products. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name that starts with an exchange's name is that exchange's product, not a new protocol. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A name carrying a wrapped or staked word names a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, and none of the exclusion rules catch it. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_NAME.test(p.name)
  );
}

/** The traded protocols the size curve is fitted on: a market cap, a TVL, and a rankable category. */
export function compsOf(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => (p.mcap_usd ?? 0) > 0 && (p.tvl_usd ?? 0) > 0 && !EXCLUDED_CATEGORIES.has(p.category ?? '') && !EXCHANGE_NAME.test(p.name),
  );
}

/** An ordinary least-squares fit of ln(mcap) on ln(tvl). */
export function ols(rows: SnapshotProtocol[]): { a: number; b: number } {
  const n = rows.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const r of rows) {
    const x = Math.log(r.tvl_usd);
    const y = Math.log(r.mcap_usd!);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  return { a, b };
}

/** The shrunken category intercepts: each category's mean log residual, pulled toward zero. */
export function categoryAdjustments(rows: SnapshotProtocol[], fit: { a: number; b: number }): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const r of rows) {
    const residual = Math.log(r.mcap_usd!) - (fit.a + fit.b * Math.log(r.tvl_usd));
    const arr = byCat.get(r.category ?? '') ?? [];
    arr.push(residual);
    byCat.set(r.category ?? '', arr);
  }
  const adj = new Map<string, number>();
  for (const [c, res] of byCat) {
    const mean = res.reduce((s, v) => s + v, 0) / res.length;
    adj.set(c, clamp((res.length / (res.length + SHRINKAGE_K)) * mean, -ADJ_CAP, ADJ_CAP));
  }
  return adj;
}

/** The full fit on the comps: the size curve, its R-squared, and the category intercepts. */
export function fitComps(comps: SnapshotProtocol[]): Fit {
  const f = ols(comps);
  const adj = categoryAdjustments(comps, f);
  let ssTot = 0;
  let ssRes = 0;
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const yMean = ys.reduce((s, v) => s + v, 0) / ys.length;
  for (const p of comps) {
    const y = Math.log(p.mcap_usd!);
    const pred = f.a + f.b * Math.log(p.tvl_usd) + (adj.get(p.category ?? '') ?? 0);
    ssTot += (y - yMean) * (y - yMean);
    ssRes += (y - pred) * (y - pred);
  }
  return { intercept: f.a, slope: f.b, r2: 1 - ssRes / ssTot, n_comps: comps.length, seed: BOOTSTRAP_SEED, adjustments: adj };
}

/** The fitted multiple: what one dollar of TVL is worth under the curve, for this category. */
export function fittedMultiple(tvl: number, category: string | null, fit: Fit): number {
  return Math.exp(fit.intercept + (fit.adjustments.get(category ?? '') ?? 0)) * Math.pow(tvl, fit.slope - 1);
}

/** The four multipliers from a protocol's own record, and the peer median behind one of them. */
export interface Multipliers {
  growth: number;
  peer: number;
  maturity: number;
  breadth: number;
}

/** The category medians of seven-day change, over every protocol in the category that reports one. */
export function peerMedians(snapshot: Snapshot): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.change_7d === null) continue;
    const arr = byCat.get(p.category ?? '') ?? [];
    arr.push(p.change_7d);
    byCat.set(p.category ?? '', arr);
  }
  const med = new Map<string, number>();
  for (const [c, arr] of byCat) med.set(c, median(arr));
  return med;
}

/** The multipliers: growth, growth against the category median, age, and chain count. */
export function multipliers(p: SnapshotProtocol, age: number | null, med: Map<string, number>): Multipliers {
  const change = p.change_7d ?? 0;
  const growth = 1 + (clamp(change, -80, 200) / 100) * 0.5;
  const peer = 1 + (clamp(change - (med.get(p.category ?? '') ?? 0), -60, 120) / 100) * 0.3;
  const ageForModel = age ?? 365;
  const maturity = 0.7 + (Math.min(ageForModel, 1460) / 1460) * 0.3;
  const breadth = 1 + 0.03 * Math.min(p.chains.length - 1, 10);
  return { growth, peer, maturity, breadth };
}

/** The implied value before odds: TVL times the fitted multiple times the four multipliers. */
export function impliedRaw(p: SnapshotProtocol, age: number | null, fit: Fit, m: Multipliers): number {
  const fitted = fittedMultiple(p.tvl_usd, p.category, fit);
  return Math.max(1, Math.round(p.tvl_usd * fitted * m.growth * m.peer * m.maturity * m.breadth));
}

/** The age bucket a protocol's record falls in, for the odds cells. */
export function ageBucket(age: number | null): string {
  if (age === null) return 'unknown';
  if (age < 365) return '<1y';
  if (age < 730) return '1-2y';
  if (age < 1460) return '2-4y';
  return '4y+';
}

/** The launch odds: the cell rate, smoothed toward the category rate and then the base rate. */
export interface OddsModel {
  base: number;
  cellStats: Map<string, { n: number; has: number }>;
  catStats: Map<string, { n: number; has: number }>;
}

/** Count the has-token share in every category-by-age cell and every category. */
export function oddsModel(snapshot: Snapshot): OddsModel {
  const base = snapshot.protocols.filter((p) => !isPreToken(p)).length / snapshot.protocols.length;
  const cellStats = new Map<string, { n: number; has: number }>();
  const catStats = new Map<string, { n: number; has: number }>();
  for (const p of snapshot.protocols) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const key = `${p.category ?? ''}||${ageBucket(age)}`;
    const cell = cellStats.get(key) ?? { n: 0, has: 0 };
    cell.n++;
    if (!isPreToken(p)) cell.has++;
    cellStats.set(key, cell);
    const cat = catStats.get(p.category ?? '') ?? { n: 0, has: 0 };
    cat.n++;
    if (!isPreToken(p)) cat.has++;
    catStats.set(p.category ?? '', cat);
  }
  return { base, cellStats, catStats };
}

/** One protocol's launch odds from the odds model. */
export function oddsFor(p: SnapshotProtocol, age: number | null, model: OddsModel): number {
  const key = `${p.category ?? ''}||${ageBucket(age)}`;
  const cell = model.cellStats.get(key);
  if (cell !== undefined && cell.n >= 5) return (cell.has + ODDS_PRIOR * model.base) / (cell.n + ODDS_PRIOR);
  const cat = model.catStats.get(p.category ?? '');
  if (cat !== undefined && cat.n > 0) return (cat.has + ODDS_PRIOR * model.base) / (cat.n + ODDS_PRIOR);
  return model.base;
}

/** A protocol's age gradient: the raw has-token share in each age bucket. */
export function ageGradient(snapshot: Snapshot): { bucket: string; has: number; total: number; rate: number }[] {
  const buckets = ['<1y', '1-2y', '2-4y', '4y+', 'unknown'];
  return buckets.map((b) => {
    let total = 0;
    let has = 0;
    for (const p of snapshot.protocols) {
      if (ageBucket(ageDays(snapshot.as_of, p.listed_at)) !== b) continue;
      total++;
      if (!isPreToken(p)) has++;
    }
    return { bucket: b, has, total, rate: total === 0 ? 0 : has / total };
  });
}

/** The gas price of one transaction on a chain, in whole dollars of the model's table. */
const GAS_USD: Record<string, number> = {
  Ethereum: 6,
  Bitcoin: 3,
  Solana: 0.05,
  Binance: 0.3,
  Polygon: 0.1,
  Avalanche: 0.5,
  'Hyperliquid L1': 0.3,
};

/** The cheap chains: the big Ethereum layer-2s, at fifty cents a transaction. */
const LAYER2 = new Set(['Arbitrum', 'Optimism', 'Base']);

/** One transaction's gas on a chain: the table, the layer-2 price, else the default. */
export function gasUsd(chain: string): number {
  if (GAS_USD[chain] !== undefined) return GAS_USD[chain]!;
  if (LAYER2.has(chain)) return 0.5;
  return 2;
}

/** A plan's gas cost: one transaction per transacting step, the fifth on the second chain. */
export function farmCostUsd(p: SnapshotProtocol): number {
  const first = p.chains[0] ?? 'Ethereum';
  const second = p.chains[1] ?? first;
  return 4 * gasUsd(first) + gasUsd(second);
}

/** A plan's active hours: ninety-five minutes on one chain, a hundred when it spans two. */
export function farmHours(p: SnapshotProtocol): number {
  return p.chains.length <= 1 ? 1.58 : 1.67;
}

/** A row's netted economics from its low-end value, its odds and its gas cost. */
export function farmEconomics(p: SnapshotProtocol, impliedLow: number, odds: number): FarmEconomics {
  const cost = farmCostUsd(p);
  const costUsd = Math.round(cost);
  const expected = impliedLow * odds * FARMER_SHARE;
  const expectedUsd = Math.round(expected);
  // Net is the rounded expected value minus the rounded cost: each figure is
  // rounded on its own first, then subtracted (not the rounded difference).
  const net = expectedUsd - costUsd;
  const hours = farmHours(p);
  const verdict: 'FARM' | 'THIN' | 'SKIP' = net >= FARM_NET ? 'FARM' : net >= 0 ? 'THIN' : 'SKIP';
  return {
    cost_usd: costUsd,
    hours,
    expected_usd: expectedUsd,
    net_usd: net,
    per_hour_usd: round1(net / hours),
    breakeven_usd: Math.round(cost / (FARMER_SHARE * odds)),
    verdict,
  };
}

/** The bootstrap bands: refit the whole model on resampled comps, and take the P10-P90 band. */
export interface Band {
  low: number;
  high: number;
  rankLow: number;
  rankHigh: number;
}

export interface ScoredRow {
  p: SnapshotProtocol;
  age: number | null;
  raw: number;
  odds: number;
  expected: number;
  mult: Multipliers;
}

/** Refits the model on one resample and returns every ranked row's refitted raw value. */
function refitValues(sample: SnapshotProtocol[], rows: ScoredRow[]): number[] {
  const f = ols(sample);
  const adj = categoryAdjustments(sample, f);
  const refit: Fit = { intercept: f.a, slope: f.b, r2: 0, n_comps: sample.length, seed: BOOTSTRAP_SEED, adjustments: adj };
  return rows.map((r) => {
    const fitted = fittedMultiple(r.p.tvl_usd, r.p.category, refit);
    return Math.max(
      1,
      Math.round(r.p.tvl_usd * fitted * r.mult.growth * r.mult.peer * r.mult.maturity * r.mult.breadth),
    );
  });
}

/** The P10-P90 band and the rank range for every ranked row, from two hundred refits. */
export function bootstrapBands(rows: ScoredRow[], comps: SnapshotProtocol[]): Map<string, Band> {
  const rnd = mulberry32(BOOTSTRAP_SEED);
  const collected = new Map<string, { values: number[]; ranks: number[] }>();
  for (let k = 0; k < BOOTSTRAP_REFITS; k++) {
    const sample: SnapshotProtocol[] = [];
    for (let j = 0; j < comps.length; j++) sample.push(comps[Math.floor(rnd() * comps.length)]!);
    const values = refitValues(sample, rows);
    const order = values
      .map((v, i) => ({ v, i, expected: v * rows[i]!.odds }))
      .sort((a, b) => b.expected - a.expected || (rows[a.i]!.p.slug < rows[b.i]!.p.slug ? -1 : 1));
    order.forEach((o, pos) => {
      const slug = rows[o.i]!.p.slug;
      const entry = collected.get(slug) ?? { values: [], ranks: [] };
      entry.values.push(o.v);
      entry.ranks.push(pos + 1);
      collected.set(slug, entry);
    });
  }
  const bands = new Map<string, Band>();
  for (const [slug, entry] of collected) {
    const sorted = [...entry.values].sort((a, b) => a - b);
    bands.set(slug, {
      low: Math.round(percentile(sorted, 0.1)),
      high: Math.round(percentile(sorted, 0.9)),
      rankLow: Math.min(...entry.ranks),
      rankHigh: Math.max(...entry.ranks),
    });
  }
  return bands;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time, dated from the
 * snapshot's own day. The plan is derived from the protocol's own record (category, chains,
 * TVL, age), never from a hand-written list of names. Five steps transact (the fifth on the
 * second chain when the plan spans two); the hold and the log transact nothing.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, asOf: string): FarmStep[] {
  const chain = chainOf(p);
  const second = p.chains[1] ?? null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const week1 = dateAfter(asOf, 7);
  const weekly = [7, 14, 21, 28].map((d) => dateAfter(asOf, d)).join(', ');
  const holdUntil = dateAfter(asOf, hold);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `Move $${capital} of USDC into the fresh wallet on ${chain} so the position is funded before you touch the protocol, on ${week1}.`,
      cost: `about $${gasUsd(chain)} of gas to move the funds`,
      time: '15 minutes to set up',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gasUsd(chain)} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, on ${weekly}.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week, 4 weeks (40 minutes)',
    },
  ];
  if (second !== null) {
    steps.push({
      text: `Bridge $${capital} of USDC to ${second} and repeat the qualifying action there, so the plan covers the protocol's second chain.`,
      cost: `about $${gasUsd(second)} of gas on ${second}`,
      time: '5 minutes',
    });
  } else {
    steps.push({
      text: `This protocol runs on one chain (${chain}), so there is no second chain to bridge to; repeat the qualifying action once more on ${chain} instead.`,
      cost: `about $${gasUsd(chain)} of gas on ${chain}`,
      time: '0 minutes',
    });
  }
  steps.push(
    {
      text: `Hold the position for at least ${hold} days, until ${holdUntil}, so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The mean absolute percentage error of a prediction against the comps' market caps. */
function mape(preds: number[], actuals: number[]): number {
  let sum = 0;
  for (let i = 0; i < preds.length; i++) sum += Math.abs(preds[i]! - actuals[i]!) / actuals[i]!;
  return (sum / preds.length) * 100;
}

/** A comp's predicted market cap under a fit, with or without its multipliers. */
function predictedMcap(p: SnapshotProtocol, m: Multipliers, fit: Fit, useMults: boolean): number {
  const fitted = fittedMultiple(p.tvl_usd, p.category, fit);
  let pred = p.tvl_usd * fitted;
  if (useMults) pred *= m.growth * m.peer * m.maturity * m.breadth;
  return pred;
}

/** Leave-one-out: refit on all but one comp, predict the held-out comp's market cap. */
function looMape(comps: SnapshotProtocol[], mults: Map<string, Multipliers>, useAdj: boolean, useMults: boolean): number {
  const preds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const f = ols(train);
    const adj = useAdj ? categoryAdjustments(train, f) : new Map<string, number>();
    const fit: Fit = { intercept: f.a, slope: f.b, r2: 0, n_comps: train.length, seed: BOOTSTRAP_SEED, adjustments: adj };
    preds.push(predictedMcap(comps[i]!, mults.get(comps[i]!.slug)!, fit, useMults));
    actuals.push(comps[i]!.mcap_usd!);
  }
  return mape(preds, actuals);
}

/** The flat baseline's leave-one-out error: the training median multiple, applied to the held-out comp. */
function looFlatMape(comps: SnapshotProtocol[]): number {
  const preds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const flatMult = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    preds.push(comps[i]!.tvl_usd * flatMult);
    actuals.push(comps[i]!.mcap_usd!);
  }
  return mape(preds, actuals);
}

/** The constant baseline's leave-one-out error: the training geometric mean market cap. */
function looConstantMape(comps: SnapshotProtocol[]): number {
  const preds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const geoMean = Math.exp(train.reduce((s, p) => s + Math.log(p.mcap_usd!), 0) / train.length);
    preds.push(geoMean);
    actuals.push(comps[i]!.mcap_usd!);
  }
  return mape(preds, actuals);
}

/** The in-sample error: the full fit's prediction against every comp's market cap. */
function insampleMape(comps: SnapshotProtocol[], mults: Map<string, Multipliers>, fit: Fit, useMults: boolean): number {
  const preds = comps.map((p) => predictedMcap(p, mults.get(p.slug)!, fit, useMults));
  const actuals = comps.map((p) => p.mcap_usd!);
  return mape(preds, actuals);
}

/** Walk-forward: train on the comps listed before each cutoff, test on the ones listed after. */
function walkForward(comps: SnapshotProtocol[], mults: Map<string, Multipliers>): {
  cutoffs: string[];
  improvements: number[];
  train: number[];
  test: number[];
} {
  const cutoffs = ['2024-01-01', '2024-07-01', '2025-01-01', '2025-07-01'];
  const improvements: number[] = [];
  const trainCounts: number[] = [];
  const testCounts: number[] = [];
  for (const cutoff of cutoffs) {
    const cut = Date.parse(`${cutoff}T00:00:00Z`);
    const train = comps.filter((p) => p.listed_at !== null && Date.parse(`${p.listed_at}T00:00:00Z`) < cut);
    const test = comps.filter((p) => p.listed_at !== null && Date.parse(`${p.listed_at}T00:00:00Z`) >= cut);
    const f = ols(train);
    const adj = categoryAdjustments(train, f);
    const fit: Fit = { intercept: f.a, slope: f.b, r2: 0, n_comps: train.length, seed: BOOTSTRAP_SEED, adjustments: adj };
    const flatMult = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    const fitPreds = test.map((p) => predictedMcap(p, mults.get(p.slug)!, fit, false));
    const flatPreds = test.map((p) => p.tvl_usd * flatMult);
    const actuals = test.map((p) => p.mcap_usd!);
    const fitMape = mape(fitPreds, actuals);
    const flatMape = mape(flatPreds, actuals);
    improvements.push(((flatMape - fitMape) / flatMape) * 100);
    trainCounts.push(train.length);
    testCounts.push(test.length);
  }
  return { cutoffs, improvements, train: trainCounts, test: testCounts };
}

/** Five folds from a seeded shuffle, cut into consecutive chunks. */
function fiveFolds<T>(items: T[], seed: number): T[][] {
  const rnd = mulberry32(seed);
  const keyed = items.map((item) => ({ item, k: rnd() })).sort((a, b) => a.k - b.k);
  const shuffled = keyed.map((x) => x.item);
  const folds: T[][] = [];
  let idx = 0;
  for (let k = 0; k < 5; k++) {
    const size = Math.ceil((shuffled.length - idx) / (5 - k));
    folds.push(shuffled.slice(idx, idx + size));
    idx += size;
  }
  return folds;
}

/** Five-fold cross-fit: train on four folds, predict the fifth's market caps. */
function crossFit(comps: SnapshotProtocol[], mults: Map<string, Multipliers>): { fit: number; flat: number } {
  const folds = fiveFolds(comps, CROSSFIT_SEED);
  const fitPreds: number[] = [];
  const flatPreds: number[] = [];
  const actuals: number[] = [];
  for (let k = 0; k < 5; k++) {
    const test = folds[k]!;
    const train = folds.flatMap((fd, j) => (j === k ? [] : fd));
    const f = ols(train);
    const adj = categoryAdjustments(train, f);
    const fit: Fit = { intercept: f.a, slope: f.b, r2: 0, n_comps: train.length, seed: BOOTSTRAP_SEED, adjustments: adj };
    const flatMult = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    for (const p of test) {
      fitPreds.push(predictedMcap(p, mults.get(p.slug)!, fit, false));
      flatPreds.push(p.tvl_usd * flatMult);
      actuals.push(p.mcap_usd!);
    }
  }
  return { fit: mape(fitPreds, actuals), flat: mape(flatPreds, actuals) };
}

/** The permutation control: shuffle the market caps, refit, and measure the leave-one-out error. */
function permutationMape(comps: SnapshotProtocol[], mults: Map<string, Multipliers>): number {
  const rnd = mulberry32(BOOTSTRAP_SEED);
  const mcaps = comps.map((p) => p.mcap_usd!);
  for (let i = mcaps.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [mcaps[i], mcaps[j]] = [mcaps[j]!, mcaps[i]!];
  }
  const permuted = comps.map((p, i) => ({ ...p, mcap_usd: mcaps[i]! }));
  return looMape(permuted, mults, true, false);
}

/** The slope-flipped control: flip the fitted slope, refit the intercept, and measure the error. */
function slopeFlippedMape(comps: SnapshotProtocol[], mults: Map<string, Multipliers>): number {
  const preds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const f = ols(train);
    const bFlip = -f.b;
    const xs = train.map((p) => Math.log(p.tvl_usd));
    const ys = train.map((p) => Math.log(p.mcap_usd!));
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    const aFlip = my - bFlip * mx;
    const fitFlip: Fit = { intercept: aFlip, slope: bFlip, r2: 0, n_comps: train.length, seed: BOOTSTRAP_SEED, adjustments: categoryAdjustments(train, { a: aFlip, b: bFlip }) };
    preds.push(predictedMcap(comps[i]!, mults.get(comps[i]!.slug)!, fitFlip, true));
    actuals.push(comps[i]!.mcap_usd!);
  }
  return mape(preds, actuals);
}

/** The per-term held-out tests: drop one multiplier and re-measure the leave-one-out error. */
function perTermMape(comps: SnapshotProtocol[], mults: Map<string, Multipliers>): { term: string; loo_mape: number }[] {
  const terms: ('growth' | 'peer' | 'maturity' | 'breadth')[] = ['growth', 'peer', 'maturity', 'breadth'];
  return terms.map((term) => {
    const dropped = new Map<string, Multipliers>();
    for (const [slug, m] of mults) dropped.set(slug, { ...m, [term]: 1 });
    return { term, loo_mape: looMape(comps, dropped, true, true) };
  });
}

/** The odds cross-validation: five folds, the cell rate against the base rate, log-loss and AUC. */
function oddsValidation(snapshot: Snapshot, model: OddsModel): OddsValidation {
  const folds = fiveFolds(snapshot.protocols, CROSSFIT_SEED);
  const base = model.base;
  let logloss = 0;
  let loglossBase = 0;
  let correct = 0;
  let correctBase = 0;
  let n = 0;
  const scored: { p: number; actual: number }[] = [];
  for (let k = 0; k < 5; k++) {
    const test = folds[k]!;
    const train = folds.flatMap((fd, j) => (j === k ? [] : fd));
    const trainSnap: Snapshot = { ...snapshot, protocols: train };
    const trainModel = oddsModel(trainSnap);
    for (const p of test) {
      const age = ageDays(snapshot.as_of, p.listed_at);
      const prob = clamp(oddsFor(p, age, trainModel), 1e-9, 1 - 1e-9);
      const actual = isPreToken(p) ? 0 : 1;
      logloss += actual === 1 ? -Math.log(prob) : -Math.log(1 - prob);
      const baseProb = clamp(base, 1e-9, 1 - 1e-9);
      loglossBase += actual === 1 ? -Math.log(baseProb) : -Math.log(1 - baseProb);
      if ((prob >= 0.5 ? 1 : 0) === actual) correct++;
      if ((base >= 0.5 ? 1 : 0) === actual) correctBase++;
      scored.push({ p: prob, actual });
      n++;
    }
  }
  scored.sort((a, b) => b.p - a.p);
  let tp = 0;
  let fp = 0;
  const positives = scored.filter((s) => s.actual === 1).length;
  const negatives = scored.length - positives;
  let auc = 0;
  let prevTp = 0;
  let prevFp = 0;
  for (const s of scored) {
    if (s.actual === 1) tp++;
    else fp++;
    auc += ((tp - prevTp) * (fp + prevFp)) / 2;
    prevTp = tp;
    prevFp = fp;
  }
  auc = positives > 0 && negatives > 0 ? 1 - auc / (positives * negatives) : 0.5;
  return {
    base_rate: base,
    cells: model.cellStats.size,
    categories: model.catStats.size,
    cv_logloss: logloss / n,
    cv_logloss_base: loglossBase / n,
    cv_accuracy: (correct / n) * 100,
    cv_accuracy_base: (correctBase / n) * 100,
    cv_auc: auc,
    age_gradient: ageGradient(snapshot),
  };
}

/** The census: how the scanned protocols split into ranked, live and excluded. */
export function censusOf(snapshot: Snapshot, rankedCount: number): Census {
  let category = 0;
  let versioned = 0;
  let wrappedName = 0;
  let exchange = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    if (EXCLUDED_CATEGORIES.has(p.category ?? '')) {
      category++;
      continue;
    }
    if (VERSIONED.test(p.name)) {
      versioned++;
      continue;
    }
    if (WRAPPED_WORD.test(p.name)) {
      wrappedName++;
      continue;
    }
    if (EXCHANGE_NAME.test(p.name)) exchange++;
  }
  const live = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const excluded = [
    { reason: 'wrapped, staked or bridged category', count: category },
    { reason: 'versioned pool name', count: versioned },
    { reason: 'wrapped or staked name', count: wrappedName },
    { reason: 'exchange product', count: exchange },
  ].filter((e) => e.count > 0);
  return { scanned: snapshot.protocols.length, ranked: rankedCount, live, excluded };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const comps = compsOf(snapshot);
  const fit = fitComps(comps);
  const med = peerMedians(snapshot);
  const odds = oddsModel(snapshot);
  const mults = new Map<string, Multipliers>();
  for (const p of snapshot.protocols) mults.set(p.slug, multipliers(p, ageDays(snapshot.as_of, p.listed_at), med));

  const scored: ScoredRow[] = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const age = ageDays(snapshot.as_of, p.listed_at);
      const m = mults.get(p.slug)!;
      const raw = impliedRaw(p, age, fit, m);
      const o = oddsFor(p, age, odds);
      return { p, age, raw, odds: o, expected: Math.round(raw * o), mult: m };
    });
  scored.sort((a, b) => b.expected - a.expected || (a.p.slug < b.p.slug ? -1 : 1));

  const bands = bootstrapBands(scored, comps);
  return scored.map((s, i) => {
    const band = bands.get(s.p.slug)!;
    const economics = farmEconomics(s.p, band.low, s.odds);
    const fitted = fittedMultiple(s.p.tvl_usd, s.p.category, fit);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.expected,
      raw_value_usd: s.raw,
      launch_odds: s.odds,
      fitted_multiple: fitted,
      growth_multiplier: s.mult.growth,
      peer_multiplier: s.mult.peer,
      maturity_multiplier: s.mult.maturity,
      breadth_multiplier: s.mult.breadth,
      implied_low_usd: band.low,
      implied_high_usd: band.high,
      rank_low: band.rankLow,
      rank_high: band.rankHigh,
      verdict: economics.verdict,
      farm_economics: economics,
      farm_steps: farmSteps(s.p, s.age, snapshot.as_of).map(stepText),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    raw_value_usd: row.raw_value_usd,
    launch_odds: row.launch_odds,
    fitted_multiple: row.fitted_multiple,
    growth_multiplier: row.growth_multiplier,
    peer_multiplier: row.peer_multiplier,
    maturity_multiplier: row.maturity_multiplier,
    breadth_multiplier: row.breadth_multiplier,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    rank_low: row.rank_low,
    rank_high: row.rank_high,
    verdict: row.verdict,
    farm_economics: row.farm_economics,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const comps = compsOf(snapshot);
  const fit = fitComps(comps);
  const med = peerMedians(snapshot);
  const odds = oddsModel(snapshot);
  const mults = new Map<string, Multipliers>();
  for (const p of snapshot.protocols) mults.set(p.slug, multipliers(p, ageDays(snapshot.as_of, p.listed_at), med));
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;

  const loo = looMape(comps, mults, true, false);
  const looFlat = looFlatMape(comps);
  const looConstant = looConstantMape(comps);
  const insample = insampleMape(comps, mults, fit, false);
  const wf = walkForward(comps, mults);
  const cf = crossFit(comps, mults);
  const proof: Proof = {
    loo_mape: loo,
    loo_full_mults_mape: looMape(comps, mults, true, true),
    loo_flat_mape: looFlat,
    loo_constant_mape: looConstant,
    loo_improvement_pct: ((looFlat - loo) / looFlat) * 100,
    insample_mape: insample,
    walkforward_cutoffs: wf.cutoffs,
    walkforward_improvements: wf.improvements,
    walkforward_mean: wf.improvements.reduce((s, v) => s + v, 0) / wf.improvements.length,
    walkforward_train: wf.train,
    walkforward_test: wf.test,
    crossfit_mape: cf.fit,
    crossfit_flat_mape: cf.flat,
    crossfit_ratio: cf.flat / cf.fit,
    permutation_mape: permutationMape(comps, mults),
    slope_flipped_mape: slopeFlippedMape(comps, mults),
    perterm: perTermMape(comps, mults),
  };

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    farmer_share: FARMER_SHARE,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    fit: {
      intercept: fit.intercept,
      slope: fit.slope,
      r2: fit.r2,
      n_comps: fit.n_comps,
      seed: fit.seed,
      adjustments: Object.fromEntries(fit.adjustments),
    },
    census: censusOf(snapshot, board.length),
    total_implied_raw_usd: board.reduce((s, r) => s + r.raw_value_usd, 0),
    total_expected_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
    odds: oddsValidation(snapshot, odds),
    proof,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
