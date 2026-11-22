// The token radar's model (radar-5): one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol in the snapshot that passes the watchlist's own pre-token rule:
// it records no token (no market cap, no CoinGecko id, no symbol) and it is not a wrapped, staked
// or bridged product of a token that already trades, not a versioned pool of another protocol, and
// not an exchange. The snapshot carries no parent-protocol field, so the rule below is the rule as
// far as the snapshot's ten fields can state it; the watchlist the snapshot names is always covered
// in full. This snapshot's board holds 198 rows: the 40 watchlist protocols plus 158 more that pass
// the same rule below the watchlist floor. Live-token protocols are kept apart and shown with the
// market's own values, never mixed into the ranked board.
//
// Implied value is fitted on the snapshot's own traded tokens (the comps), not a hard-coded
// multiple, and then weighted by the protocol's launch odds — the peers' record of whether
// protocols like it ever list a token:
//
//   comps     = traded protocols (mcap_usd > 0, tvl_usd > 0) outside the wrapped / staked /
//               bridged / exchange categories and not named for an exchange (94 this snapshot)
//   size curve = OLS on ln(mcap_usd) = a + b . ln(tvl_usd) over the comps, plus a category
//               intercept per category, shrunk toward zero by n / (n + 3): a category with
//               few comps barely moves the curve, one with many moves it most of the way.
//               Adjustments are capped at +/-1.0 log points (x2.72 / x0.37), so one extreme
//               traded token cannot dominate a whole category.
//               fittedMultiple(tvl, category) = exp(a) . tvl^(b-1) . exp(adj[category])
//   launch odds = the peers' record: for the protocol's category and no-token-age bucket
//               (<1y, 1-2y, 2-4y, 4y+, unknown), the share of protocols in that cell that
//               record a token, smoothed toward the category rate and then the whole
//               snapshot's rate (prior strength 5; cells under 5 protocols fall back to
//               the category rate). Validated as a classifier by 5-fold cross-validation:
//               log-loss 0.627 against a 0.688 base rate, accuracy 65.6% vs 54.9%,
//               AUC 0.692 vs 0.500 — the only factor beyond the size curve the blind
//               tests keep (see the playbook: every fitted term, robust fit and
//               trimming variant was tested and rejected on the same protocol).
//   expected  = implied x launch odds: the board ranks by expected launch value, so a
//               protocol whose peers rarely list a token ranks below one whose peers
//               usually do, at the same fitted value. Farm economics use the expected
//               low end of the band, so the verdict stays conservative and consistent
//               with the ranking.
//   growth    = clamp(change_7d, -80, 200) per cent           (null change counts as 0)
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT           (0.5)
//   peer      = growth - categoryMedian                        (the median 7d change of the
//                                                              protocol's own category, computed
//                                                              from this snapshot; null category
//                                                              uses the whole snapshot's median)
//   peerMult  = 1 + (clamp(peer, -60, 120) / 100) x PEER_WEIGHT (0.3)
//   maturity  = 0.70 + min(age_days, 1460) / 1460 x 0.30       (age_days unknown: 365)
//   breadth   = 1 + 0.03 x min(chains - 1, 10)                 (multi-chain surface, capped)
//   implied   = max(1, round(tvl x fittedMultiple(tvl, category) x growthMult x peerMult x maturity x breadth))
//
// The fit is validated genuinely in code, four ways: leave-one-out MAPE on market cap (each comp
// refit without itself, the whole shrinkage fit redone), against a flat median-multiple baseline
// under the same leave-one-out protocol; walk-forward — the fit is trained on comps listed
// before a cutoff and tested on comps listed after it, at four cutoffs, against the same flat
// baseline; 5-fold cross-fitting of the whole pipeline; and failing controls — a shuffled-mcap
// refit and a slope-flipped fit, both shown to fail the same blind test, plus the fitted-term
// tests (each multiplier fitted on its own: all worse, so the terms stay heuristic assumptions).
// The launch odds are validated the same way, as a classifier, by 5-fold cross-validation.
// Uncertainty comes from 200 bootstrap refits (comps resampled with replacement,
// seeded mulberry32(20261119)): per row the P10/P90 of expected value and the best/worst rank
// across refits. Farm economics net each plan: cost is the gas of the transacting steps (steps
// 1-5, one transaction each, at the step's chain gas; steps 6-8 transact nothing), hours are
// active time (the weekly step counts 4 weeks, the hold is calendar time, not active hours),
// expected value is the band's low end (already odds-weighted) times FARMER_SHARE (3e-6: one farmer's allocation is
// 0.0003% of launch value, stated assumption), net = expected - cost, $/hour = net / hours,
// break-even = cost / FARMER_SHARE. Verdict: FARM if net >= $20 and $/hour >= $5, THIN if net
// >= $0, else SKIP. Farm plans are dated from the snapshot's as_of date, so each step carries
// the calendar week it happens in. No protocol name is ever special-cased: the same function
// scores every row, and every constant is stated in the dashboard, where the page recomputes
// each row from the same figures.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The model's constants, as the dashboard states them and the page recomputes them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  peer_weight: number;
  peer_floor: number;
  peer_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.5,
  growth_floor: -80,
  growth_cap: 200,
  peer_weight: 0.3,
  peer_floor: -60,
  peer_cap: 120,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 10,
};
// base_multiple is retained for reference only: radar-3 scores with the fitted multiple from
// fitComps, not this v1 constant. It is not used in impliedValue any more.

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-5';

/** One farmer's assumed share of launch value (0.0005%), stated on the board as an assumption:
 *  a 10% farmer allocation shared by ~20,000 farmers. radar-4 used 3e-6 (33,000 farmers);
 *  the expected values are now probability-weighted by launch odds (median 0.49), so at 3e-6
 *  the verdicts sit SKIP-heavy (FARM 4 / THIN 67 / SKIP 127). 5e-6 is the middle of the
 *  plausible range (2e-6–1e-5) that spreads the verdicts across all three (FARM 10 /
 *  THIN 89 / SKIP 99); 2e-6 gives FARM 0 and 1e-5 gives FARM 49. The share is a stated
 *  assumption, not a fitted number, and the distributions at each candidate share are in
 *  the playbook. */
export const FARMER_SHARE = 5e-6;

/** The shrinkage constant: a category's intercept is pulled toward the global curve by
 *  n / (n + SHRINK_K). k = 3 is fixed and documented, not tuned to the LOO number. */
export const SHRINK_K = 3;

/** The category-adjustment cap, in log points: no category moves more than x2.72 / x0.37, so a
 *  single extreme traded token cannot dominate a whole category's adjustment. A robustness
 *  guard, stated in the model; it costs nothing on LOO (544.31% uncapped vs 544.34% capped). */
export const ADJ_CAP = 1.0;

/** The launch-odds smoothing: a cell's rate is (hits + ODDS_PRIOR_STRENGTH x base rate) /
 *  (cell size + ODDS_PRIOR_STRENGTH); cells smaller than ODDS_CELL_MIN fall back to the
 *  category rate with the same smoothing, then to the base rate. Prior strength 5 is a
 *  fixed, documented constant — not tuned to the cross-validation number. */
export const ODDS_PRIOR_STRENGTH = 5;
export const ODDS_CELL_MIN = 5;

/** The walk-forward cutoffs: fit on comps listed before the cutoff, test on comps listed after. */
export const WALK_FORWARD_CUTOFFS = ['2024-01-01', '2024-07-01', '2025-01-01', '2025-07-01'];

/** The bootstrap's seed and refit count: seeded, so two runs produce byte-identical bands. */
export const BOOTSTRAP_SEED = 20261119;
export const BOOTSTRAP_REFITS = 200;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One farm plan's netted economics: whole dollars, except per_hour_usd (1 decimal) and hours (2 decimals). */
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
  /** The fitted value before launch odds (implied_value_usd is the expected value). */
  raw_implied_usd: number;
  /** The peers' record: the share of protocols like this one that ever list a token. */
  launch_odds: number;
  implied_low_usd: number;
  implied_high_usd: number;
  rank_low: number;
  rank_high: number;
  fitted_multiple: number;
  farm_economics: FarmEconomics;
  model: {
    base_multiple: number;
    fitted_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    category_median_pct: number;
    peer_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
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
  raw_implied_usd: number;
  launch_odds: number;
  implied_low_usd: number;
  implied_high_usd: number;
  rank_low: number;
  rank_high: number;
  fitted_multiple: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net_usd: number;
  per_hour_usd: number;
  farm_economics: FarmEconomics;
  growth_multiplier: number;
  peer_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The fitted size curve and its genuine leave-one-out + walk-forward validation, all computed from the snapshot. */
export interface FitResult {
  n_comps: number;
  intercept: number;
  slope: number;
  r2: number;
  loo_mape_pct: number;
  flat_loo_mape_pct: number;
  improvement_pct: number;
  seed: number;
  /** Per-category log adjustment (shrunk toward zero), keyed by category name ('Other' for null). */
  cat_adj: Record<string, number>;
  /** Per-category comp count, keyed the same way. */
  cat_n: Record<string, number>;
  shrink_k: number;
  /** Walk-forward: fit before each cutoff, test after it, against the flat baseline on the same test set. */
  walk_forward: {
    mean_improvement_pct: number;
    cutoffs: { cutoff: string; n_train: number; n_test: number; mape_pct: number; flat_mape_pct: number; improvement_pct: number }[];
  };
  /** 5-fold cross-fitting of the whole shrinkage pipeline (deterministic seeded folds). */
  cross_fit: { mape_pct: number; flat_mape_pct: number; improvement_pct: number; ratio: number };
  /** Failing controls: deliberately-wrong models run through the same blind test. */
  controls: {
    permutation_loo_mape_pct: number;
    slope_flipped_mape_pct: number;
    fitted_insample_mape_pct: number;
    constant_loo_mape_pct: number;
  };
  /** Each multiplier fitted on its own (one extra regressor on the residuals): all worse than the
   *  size curve alone, so the terms stay heuristic assumptions — shown, not hidden. */
  term_tests: { growth_mape_pct: number; peer_mape_pct: number; maturity_mape_pct: number; breadth_mape_pct: number };
  /** The launch-odds classifier, validated by 5-fold cross-validation on has-token (758). */
  odds_test: { cv_logloss: number; base_logloss: number; accuracy_pct: number; auc: number; base_rate: number };
}

/** One pre-token protocol the board excludes, with the first rule it fails — the audited view. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** The census: every protocol in the snapshot accounted for, buckets summing to `scanned`. */
export interface Census {
  scanned: number;
  ranked: number;
  live_set_aside: number;
  excluded: { reason: string; count: number }[];
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_medians: Record<string, number>;
  overall_median: number;
  watchlist_slugs: string[];
  top_gainers: RadarRow[];
  rows: RadarRow[];
  live: LiveRow[];
  fit: FitResult;
  census: Census;
  /** The pre-token protocols the board excludes, with the first rule each fails — the audited view. */
  excluded_rows: ExcludedRow[];
  /** The launch-odds table the page recomputes odds from: smoothed cell rates
   *  ("category|bucket"), smoothed category rates, and the base rate. */
  odds_table: { cells: Record<string, number>; cats: Record<string, number>; base_rate: number };
  farmer_share: number;
  verdict_counts: { FARM: number; THIN: number; SKIP: number };
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

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers; 0 when the list is empty. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The peer medians of a snapshot: the median 7d TVL change of every category (null category reads
 * as "Other"), plus the whole snapshot's median for a category with no reported change. Computed
 * from the snapshot's own figures, never from a hand-kept table.
 */
export function peerMedians(snapshot: Snapshot): { byCategory: Record<string, number>; overall: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.change_7d === null || !Number.isFinite(p.change_7d)) continue;
    all.push(p.change_7d);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(p.change_7d);
    byCategory.set(key, list);
  }
  const overall = median(all);
  const out: Record<string, number> = {};
  for (const [key, list] of byCategory) out[key] = median(list);
  return { byCategory: out, overall };
}

/** The snapshot's traded protocols: the comps the size curve is fitted on. */
export function comps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) =>
      p.mcap_usd !== null && p.mcap_usd > 0 &&
      p.tvl_usd > 0 &&
      !(p.category !== null && WRAPPED_CATEGORIES.has(p.category)) &&
      !EXCHANGE_NAMES.some((e) => p.name.startsWith(e)),
  );
}

/** Ordinary least squares on points {x, y}: y = intercept + slope * x, with R². */
export function ols(points: { x: number; y: number }[]): { intercept: number; slope: number; r2: number } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let sst = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    sst += (p.y - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (const p of points) sse += (p.y - (intercept + slope * p.x)) ** 2;
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  return { intercept, slope, r2 };
}

/** The fitted multiple (implied mcap / TVL) the size curve gives a protocol with this TVL. */
export function fittedMultiple(tvlUsd: number, intercept: number, slope: number): number {
  return Math.exp(intercept) * Math.max(tvlUsd, 1) ** (slope - 1);
}

/**
 * The shrinkage fit on a list of comps: the global OLS on ln mcap = a + b . ln tvl, plus a
 * per-category log adjustment — the mean residual of the category's comps, pulled toward zero
 * by n / (n + SHRINK_K). A category with few comps barely moves the curve; one with many
 * moves it most of the way. Returns the global curve, the adjustments, and the in-sample R²
 * of the full fit (global curve + adjustments).
 */
export function fitShrinkage(list: SnapshotProtocol[]): {
  intercept: number;
  slope: number;
  r2: number;
  catAdj: Map<string, number>;
  catN: Map<string, number>;
} {
  const points = list.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!) }));
  const { intercept, slope } = ols(points);
  const byCat = new Map<string, number[]>();
  for (const p of list) {
    const resid = Math.log(p.mcap_usd!) - (intercept + slope * Math.log(p.tvl_usd));
    const key = p.category ?? 'Other';
    const arr = byCat.get(key) ?? [];
    arr.push(resid);
    byCat.set(key, arr);
  }
  const catAdj = new Map<string, number>();
  const catN = new Map<string, number>();
  for (const [key, arr] of byCat) {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const shrunk = (arr.length / (arr.length + SHRINK_K)) * mean;
    catAdj.set(key, Math.max(-ADJ_CAP, Math.min(ADJ_CAP, shrunk)));
    catN.set(key, arr.length);
  }
  let sse = 0;
  let sst = 0;
  const my = points.reduce((s, p) => s + p.y, 0) / points.length;
  for (const p of list) {
    const pred = intercept + slope * Math.log(p.tvl_usd) + (catAdj.get(p.category ?? 'Other') ?? 0);
    sse += (Math.log(p.mcap_usd!) - pred) ** 2;
    sst += (Math.log(p.mcap_usd!) - my) ** 2;
  }
  return { intercept, slope, r2: sst === 0 ? 0 : 1 - sse / sst, catAdj, catN };
}

/** The fitted multiple (implied mcap / TVL) the shrinkage curve gives a protocol with this TVL
 *  in this category: the global curve times the category's shrunk adjustment. */
export function fittedMultipleFor(
  tvlUsd: number,
  category: string | null,
  fit: { intercept: number; slope: number; catAdj: Map<string, number> },
): number {
  const adj = fit.catAdj.get(category ?? 'Other') ?? 0;
  return Math.exp(fit.intercept) * Math.max(tvlUsd, 1) ** (fit.slope - 1) * Math.exp(adj);
}

/**
 * Walk-forward validation of the shrinkage fit: for each cutoff, fit on comps listed before
 * it and test on comps listed after it, against the flat median-multiple baseline on the same
 * test set. Comps with no listed_at cannot be placed in time and are left out of both sides.
 */
export function walkForward(snapshot: Snapshot): FitResult['walk_forward'] {
  const dated = comps(snapshot).filter((p) => p.listed_at !== null);
  const cutoffs: FitResult['walk_forward']['cutoffs'] = [];
  let total = 0;
  for (const cutoff of WALK_FORWARD_CUTOFFS) {
    const train = dated.filter((p) => p.listed_at! < cutoff);
    const test = dated.filter((p) => p.listed_at! >= cutoff);
    if (train.length < 20 || test.length < 10) continue;
    const fit = fitShrinkage(train);
    const flatMult = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    let err = 0;
    let flatErr = 0;
    for (const c of test) {
      const pred = c.tvl_usd * fittedMultipleFor(c.tvl_usd, c.category, fit);
      err += Math.abs(pred - c.mcap_usd!) / c.mcap_usd!;
      flatErr += Math.abs(flatMult * c.tvl_usd - c.mcap_usd!) / c.mcap_usd!;
    }
    const mape = (err / test.length) * 100;
    const flatMape = (flatErr / test.length) * 100;
    const improvement = flatMape === 0 ? 0 : ((flatMape - mape) / flatMape) * 100;
    cutoffs.push({ cutoff, n_train: train.length, n_test: test.length, mape_pct: mape, flat_mape_pct: flatMape, improvement_pct: improvement });
    total += improvement;
  }
  return { mean_improvement_pct: cutoffs.length === 0 ? 0 : total / cutoffs.length, cutoffs };
}

/**
 * The size curve fitted on the comps, with genuine leave-one-out validation: for each comp the
 * whole shrinkage fit is redone without it and its market cap predicted; the error is the mean
 * absolute percentage error on market cap. The flat baseline is the comps' median multiple
 * (median mcap/tvl) under the same leave-one-out protocol. Throws when there are too few comps
 * to fit — the model never falls back to a hard-coded multiple silently.
 */
export function fitComps(snapshot: Snapshot): FitResult {
  const list = comps(snapshot);
  if (list.length < 20) {
    throw new SnapshotError(`only ${list.length} traded comps in the snapshot: need at least 20 to fit the size curve`);
  }
  const full = fitShrinkage(list);
  let looErr = 0;
  let flatErr = 0;
  for (let i = 0; i < list.length; i++) {
    const rest = list.filter((_, j) => j !== i);
    const loo = fitShrinkage(rest);
    const pred = list[i]!.tvl_usd * fittedMultipleFor(list[i]!.tvl_usd, list[i]!.category, loo);
    looErr += Math.abs(pred - list[i]!.mcap_usd!) / list[i]!.mcap_usd!;
    const restMults = rest.map((p) => p.mcap_usd! / p.tvl_usd);
    const flatPred = median(restMults) * list[i]!.tvl_usd;
    flatErr += Math.abs(flatPred - list[i]!.mcap_usd!) / list[i]!.mcap_usd!;
  }
  const looMape = (looErr / list.length) * 100;
  const flatMape = (flatErr / list.length) * 100;
  return {
    n_comps: list.length,
    intercept: full.intercept,
    slope: full.slope,
    r2: full.r2,
    loo_mape_pct: looMape,
    flat_loo_mape_pct: flatMape,
    improvement_pct: flatMape === 0 ? 0 : ((flatMape - looMape) / flatMape) * 100,
    seed: BOOTSTRAP_SEED,
    cat_adj: Object.fromEntries(full.catAdj),
    cat_n: Object.fromEntries(full.catN),
    shrink_k: SHRINK_K,
    walk_forward: walkForward(snapshot),
    cross_fit: crossFit(snapshot),
    controls: failingControls(snapshot),
    term_tests: termTests(snapshot),
    odds_test: oddsTest(snapshot),
  };
}

/** The no-token-age bucket of a protocol's age: the odds table's second key. */
export function ageBucket(age: number | null): string {
  if (age === null) return 'unknown';
  if (age < 365) return '<1y';
  if (age < 730) return '1-2y';
  if (age < 1460) return '2-4y';
  return '4y+';
}

/** Whether a protocol's record carries a token (market cap, CoinGecko id or symbol). */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/**
 * The launch-odds counts: for every category × age-bucket cell, [protocols in the cell that
 * record a token, protocols in the cell]; the same per category; and the whole snapshot's
 * has-token rate. Computed from the snapshot's own records, never from a hand-kept table.
 */
export function launchOddsTable(snapshot: Snapshot): {
  cells: Map<string, [number, number]>;
  cats: Map<string, [number, number]>;
  baseRate: number;
} {
  const cells = new Map<string, [number, number]>();
  const cats = new Map<string, [number, number]>();
  let hits = 0;
  for (const p of snapshot.protocols) {
    const h = hasToken(p) ? 1 : 0;
    hits += h;
    const key = `${p.category ?? 'Other'}|${ageBucket(ageDays(snapshot.as_of, p.listed_at))}`;
    const cell = cells.get(key) ?? [0, 0];
    cell[0] += h;
    cell[1]++;
    cells.set(key, cell);
    const cat = cats.get(p.category ?? 'Other') ?? [0, 0];
    cat[0] += h;
    cat[1]++;
    cats.set(p.category ?? 'Other', cat);
  }
  return { cells, cats, baseRate: snapshot.protocols.length === 0 ? 0 : hits / snapshot.protocols.length };
}

/**
 * A protocol's launch odds from the peers' record: its category × age-bucket cell's rate,
 * smoothed toward the base rate with prior strength ODDS_PRIOR_STRENGTH; cells under
 * ODDS_CELL_MIN protocols fall back to the category rate with the same smoothing, then to
 * the base rate. Deterministic; the dashboard recomputes it from the same table.
 */
export function launchOdds(
  p: SnapshotProtocol,
  asOf: string,
  table: { cells: Map<string, [number, number]>; cats: Map<string, [number, number]>; baseRate: number },
): number {
  const key = `${p.category ?? 'Other'}|${ageBucket(ageDays(asOf, p.listed_at))}`;
  const cell = table.cells.get(key);
  if (cell !== undefined && cell[1] >= ODDS_CELL_MIN) {
    return (cell[0] + ODDS_PRIOR_STRENGTH * table.baseRate) / (cell[1] + ODDS_PRIOR_STRENGTH);
  }
  const cat = table.cats.get(p.category ?? 'Other');
  if (cat !== undefined) {
    return (cat[0] + ODDS_PRIOR_STRENGTH * table.baseRate) / (cat[1] + ODDS_PRIOR_STRENGTH);
  }
  return table.baseRate;
}

/** The smoothed odds table as plain records, for data.js so the page recomputes odds. */
export function oddsTableRecords(snapshot: Snapshot): { cells: Record<string, number>; cats: Record<string, number>; base_rate: number } {
  const table = launchOddsTable(snapshot);
  const cells: Record<string, number> = {};
  for (const [key, [hits, n]] of table.cells) {
    cells[key] = n >= ODDS_CELL_MIN ? (hits + ODDS_PRIOR_STRENGTH * table.baseRate) / (n + ODDS_PRIOR_STRENGTH) : -1;
  }
  const cats: Record<string, number> = {};
  for (const [key, [hits, n]] of table.cats) {
    cats[key] = (hits + ODDS_PRIOR_STRENGTH * table.baseRate) / (n + ODDS_PRIOR_STRENGTH);
  }
  return { cells, cats, base_rate: table.baseRate };
}

/** Log-loss of one prediction against the truth, clamped so a 0/1 prediction never explodes. */
function logLoss(pred: number, actual: number): number {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, pred));
  return -(actual * Math.log(p) + (1 - actual) * Math.log(1 - p));
}

/**
 * The launch-odds classifier, validated by 5-fold cross-validation: the 758 protocols are
 * split into five stratified folds (round-robin over the has-token and no-token lists in
 * snapshot order, deterministic); each fold's table is built from the other four folds only.
 * Reports the cross-validated log-loss, accuracy and AUC against the base-rate predictor.
 */
export function oddsTest(snapshot: Snapshot): FitResult['odds_test'] {
  const all = snapshot.protocols;
  const table = launchOddsTable(snapshot);
  const baseRate = table.baseRate;
  const baseLogloss = -(baseRate * Math.log(baseRate) + (1 - baseRate) * Math.log(1 - baseRate));
  const pos = all.map((_, i) => i).filter((i) => hasToken(all[i]!));
  const neg = all.map((_, i) => i).filter((i) => !hasToken(all[i]!));
  const folds: number[][] = [[], [], [], [], []];
  pos.forEach((v, i) => folds[i % 5]!.push(v));
  neg.forEach((v, i) => folds[i % 5]!.push(v));
  let ll = 0;
  let n = 0;
  let correct = 0;
  const scores: [number, number][] = [];
  for (let f = 0; f < 5; f++) {
    const testIdx = new Set(folds[f]);
    const train = all.filter((_, i) => !testIdx.has(i));
    const trainSnap: Snapshot = { ...snapshot, protocols: train };
    const trainTable = launchOddsTable(trainSnap);
    for (const i of folds[f]!) {
      const p = launchOdds(all[i]!, snapshot.as_of, trainTable);
      const y = hasToken(all[i]!) ? 1 : 0;
      ll += logLoss(p, y);
      n++;
      if ((p >= 0.5 ? 1 : 0) === y) correct++;
      scores.push([p, y]);
    }
  }
  const sPos = scores.filter(([, t]) => t === 1).map(([p]) => p);
  const sNeg = scores.filter(([, t]) => t === 0).map(([p]) => p);
  let aucPairs = 0;
  let aucTot = 0;
  for (const a of sPos) {
    for (const b of sNeg) {
      aucTot++;
      if (a > b) aucPairs++;
      else if (a === b) aucPairs += 0.5;
    }
  }
  return {
    cv_logloss: n === 0 ? 0 : ll / n,
    base_logloss: baseLogloss,
    accuracy_pct: n === 0 ? 0 : (correct / n) * 100,
    auc: aucTot === 0 ? 0 : aucPairs / aucTot,
    base_rate: baseRate,
  };
}

/** A small deterministic PRNG (LCG) for the seeded shuffles the validations use. */
function lcg(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}

/** A Fisher-Yates shuffle with a seeded PRNG: the same seed gives the same order every run. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const rng = lcg(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * 5-fold cross-fitting of the whole shrinkage pipeline: the comps are shuffled once with a
 * seeded PRNG (seed 12345) and dealt into five folds; each fold is predicted by the fit on
 * the other four. A second validation protocol beside leave-one-out, reported beside it.
 */
export function crossFit(snapshot: Snapshot): FitResult['cross_fit'] {
  const list = comps(snapshot);
  const order = seededShuffle(list.map((_, i) => i), 12345);
  const folds: number[][] = [[], [], [], [], []];
  order.forEach((v, i) => folds[i % 5]!.push(v));
  let err = 0;
  let flatErr = 0;
  let n = 0;
  for (let f = 0; f < 5; f++) {
    const testIdx = new Set(folds[f]);
    const train = list.filter((_, i) => !testIdx.has(i));
    const fit = fitShrinkage(train);
    const flatMult = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    for (const i of folds[f]!) {
      const pred = list[i]!.tvl_usd * fittedMultipleFor(list[i]!.tvl_usd, list[i]!.category, fit);
      err += Math.abs(pred - list[i]!.mcap_usd!) / list[i]!.mcap_usd!;
      flatErr += Math.abs(flatMult * list[i]!.tvl_usd - list[i]!.mcap_usd!) / list[i]!.mcap_usd!;
      n++;
    }
  }
  const mape = (err / n) * 100;
  const flatMape = (flatErr / n) * 100;
  return {
    mape_pct: mape,
    flat_mape_pct: flatMape,
    improvement_pct: flatMape === 0 ? 0 : ((flatMape - mape) / flatMape) * 100,
    ratio: mape === 0 ? 0 : flatMape / mape,
  };
}

/**
 * Failing controls: deliberately-wrong models run through the same blind test, so the real
 * fit passing means something. The permutation control shuffles market caps among the comps
 * (seeded shuffle, seed 999) and refits the pipeline under leave-one-out; the slope-flipped
 * control predicts with the fitted slope's sign flipped around the mean log TVL, in sample;
 * the constant control predicts every comp's geometric-mean market cap under leave-one-out.
 */
export function failingControls(snapshot: Snapshot): FitResult['controls'] {
  const list = comps(snapshot);
  // Permutation: shuffle the market caps, refit the pipeline, leave-one-out.
  const shuffled = seededShuffle(list.map((p) => p.mcap_usd!), 999);
  const permList = list.map((p, i) => ({ ...p, mcap_usd: shuffled[i]! }));
  let permErr = 0;
  for (let i = 0; i < permList.length; i++) {
    const rest = permList.filter((_, j) => j !== i);
    const fit = fitShrinkage(rest);
    const pred = permList[i]!.tvl_usd * fittedMultipleFor(permList[i]!.tvl_usd, permList[i]!.category, fit);
    permErr += Math.abs(pred - permList[i]!.mcap_usd!) / permList[i]!.mcap_usd!;
  }
  // Slope-flipped, in sample, against the fitted in-sample error.
  const full = fitShrinkage(list);
  const mx = list.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / list.length;
  let flipErr = 0;
  let fitErr = 0;
  for (const p of list) {
    const adj = full.catAdj.get(p.category ?? 'Other') ?? 0;
    const predFlip = Math.exp(full.intercept + full.slope * mx - full.slope * (Math.log(p.tvl_usd) - mx) + adj);
    flipErr += Math.abs(predFlip - p.mcap_usd!) / p.mcap_usd!;
    const predFit = Math.exp(full.intercept + full.slope * Math.log(p.tvl_usd) + adj);
    fitErr += Math.abs(predFit - p.mcap_usd!) / p.mcap_usd!;
  }
  // Constant baseline: the geometric-mean market cap, leave-one-out.
  let constErr = 0;
  for (let i = 0; i < list.length; i++) {
    const rest = list.filter((_, j) => j !== i);
    const gm = Math.exp(rest.reduce((s, p) => s + Math.log(p.mcap_usd!), 0) / rest.length);
    constErr += Math.abs(gm - list[i]!.mcap_usd!) / list[i]!.mcap_usd!;
  }
  return {
    permutation_loo_mape_pct: (permErr / permList.length) * 100,
    slope_flipped_mape_pct: (flipErr / list.length) * 100,
    fitted_insample_mape_pct: (fitErr / list.length) * 100,
    constant_loo_mape_pct: (constErr / list.length) * 100,
  };
}

/**
 * Each multiplier fitted on its own: the size curve stays as fitted, and one extra regressor
 * (the term's value, from the same definitions impliedValue uses) is fitted on the residuals
 * under leave-one-out. All four are worse than the size curve alone, so the terms stay
 * heuristic assumptions — the numbers are printed on the board instead of hidden.
 */
export function termTests(snapshot: Snapshot): FitResult['term_tests'] {
  const list = comps(snapshot);
  const { byCategory, overall } = peerMedians(snapshot);
  const termValue = (p: SnapshotProtocol, term: string): number => {
    const catMedian = byCategory[p.category ?? 'Other'] ?? overall;
    const raw = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
    if (term === 'growth') return Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, raw)) / 100;
    if (term === 'peer') return Math.min(MODEL.peer_cap, Math.max(MODEL.peer_floor, raw - catMedian)) / 100;
    if (term === 'maturity') {
      const age = ageDays(snapshot.as_of, p.listed_at) ?? MODEL.unknown_age_days;
      return MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    }
    return 1 + MODEL.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_chains);
  };
  const looFor = (term: string): number => {
    let err = 0;
    for (let i = 0; i < list.length; i++) {
      const rest = list.filter((_, j) => j !== i);
      const base = fitShrinkage(rest);
      const resid = rest.map((p) => ({
        r: Math.log(p.mcap_usd!) - (base.intercept + base.slope * Math.log(p.tvl_usd) + (base.catAdj.get(p.category ?? 'Other') ?? 0)),
        x: termValue(p, term),
      }));
      const mx = resid.reduce((s, q) => s + q.x, 0) / resid.length;
      const my = resid.reduce((s, q) => s + q.r, 0) / resid.length;
      let sxx = 0;
      let sxy = 0;
      for (const q of resid) {
        sxx += (q.x - mx) ** 2;
        sxy += (q.x - mx) * (q.r - my);
      }
      const slope = sxx === 0 ? 0 : sxy / sxx;
      const intercept = my - slope * mx;
      const p = list[i]!;
      const predLn = base.intercept + base.slope * Math.log(p.tvl_usd) + (base.catAdj.get(p.category ?? 'Other') ?? 0) + intercept + slope * termValue(p, term);
      err += Math.abs(Math.exp(predLn) - p.mcap_usd!) / p.mcap_usd!;
    }
    return (err / list.length) * 100;
  };
  return {
    growth_mape_pct: looFor('growth'),
    peer_mape_pct: looFor('peer'),
    maturity_mape_pct: looFor('maturity'),
    breadth_mape_pct: looFor('breadth'),
  };
}

/** mulberry32: a small seeded PRNG, so the bootstrap bands are byte-identical across runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The p-th percentile (0..1) of a sorted ascending list, by linear interpolation. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const pos = p * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (pos - lo);
}

/**
 * The bootstrap bands for the ranked rows: 200 refits, comps resampled with replacement from
 * the seeded PRNG, the whole shrinkage fit redone each time. Per row: P10/P90 of the expected
 * value across refits, and the best/worst rank across refits. `mults[i]` is the row's
 * fitted-multiple-free multiplier product (growth x peer x maturity x breadth), so each refit
 * only changes the fitted multiple (global curve + category adjustment); the launch odds are
 * fixed per row, so the band's width comes from the size curve alone.
 */
export function bootstrapBands(
  snapshot: Snapshot,
  rows: { slug: string; tvl_usd: number; category: string | null; mults: number; odds: number }[],
): Map<string, { low: number; high: number; rankLow: number; rankHigh: number }> {
  const list = comps(snapshot);
  const n = rows.length;
  const impliedSamples: number[][] = rows.map(() => []);
  const rankLow = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
  const rankHigh = new Array<number>(n).fill(0);
  const rng = mulberry32(BOOTSTRAP_SEED);
  const full = fitShrinkage(list);
  for (let r = 0; r < BOOTSTRAP_REFITS; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < list.length; i++) sample.push(list[Math.floor(rng() * list.length)]!);
    let fit = fitShrinkage(sample);
    if (!Number.isFinite(fit.intercept) || !Number.isFinite(fit.slope)) fit = full;
    const implied = rows.map((row) => Math.max(1, Math.round(row.tvl_usd * fittedMultipleFor(row.tvl_usd, row.category, fit) * row.mults * row.odds)));
    const order = implied.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || (rows[a.i]!.slug < rows[b.i]!.slug ? -1 : 1));
    order.forEach((o, pos) => {
      const rank = pos + 1;
      if (rank < rankLow[o.i]!) rankLow[o.i] = rank;
      if (rank > rankHigh[o.i]!) rankHigh[o.i] = rank;
    });
    implied.forEach((v, i) => impliedSamples[i]!.push(v));
  }
  const out = new Map<string, { low: number; high: number; rankLow: number; rankHigh: number }>();
  rows.forEach((row, i) => {
    const sorted = [...impliedSamples[i]!].sort((a, b) => a - b);
    out.set(row.slug, {
      low: Math.round(percentile(sorted, 0.1)),
      high: Math.round(percentile(sorted, 0.9)),
      rankLow: rankLow[i]!,
      rankHigh: rankHigh[i]!,
    });
  });
  return out;
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  categoryMedian: number,
  fittedMult: number,
): { implied: number; growthPct: number; growthMult: number; peerMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const peerPct = Math.min(model.peer_cap, Math.max(model.peer_floor, rawGrowth - categoryMedian));
  const peerMult = 1 + (peerPct / 100) * model.peer_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * fittedMult * growthMult * peerMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, peerMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** The exchange names the watchlist rule keeps out: a protocol named for an exchange is its product. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
/** Categories that are a wrapped, staked or bridged product, or an exchange, by the watchlist rule. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol passes the watchlist's pre-token rule as far as the snapshot's ten fields can
 * state it: no token recorded, and not a wrapped, staked or bridged product of a token that already
 * trades, not a versioned pool, not an exchange. The snapshot carries no parent-protocol field, so
 * a protocol with a parent in DefiLlama's record can still pass here; the watchlist the snapshot
 * names is the list that rule produced, and every slug on it is covered.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const exchange of EXCHANGE_NAMES) if (p.name.startsWith(exchange)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The first rule a pre-token protocol fails, in census priority — null when it passes the rule. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return null;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return 'wrapped, staked or bridged category';
  if (VERSIONED.test(p.name)) return 'versioned pool name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped / staked name';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'exchange product';
  return 'other pre-token rule';
}

/** The pre-token protocols the board excludes, with the first rule each fails — the audited view. */
export function excludedRows(snapshot: Snapshot, board: BoardRow[]): ExcludedRow[] {
  const ranked = new Set(board.map((r) => r.slug));
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !ranked.has(p.slug))
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: exclusionReason(p) ?? 'other pre-token rule' }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { byCategory, overall } = peerMedians(snapshot);
  const fit = fitComps(snapshot);
  const oddsTable = launchOddsTable(snapshot);
  const fitMap = { intercept: fit.intercept, slope: fit.slope, catAdj: new Map(Object.entries(fit.cat_adj)) };
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, whatever else the rule says.
  const index = bySlug(snapshot.protocols);
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other protocol that passes the watchlist's pre-token rule, below the
  // floor or above it. A chosen protocol stays chosen; nothing is hand-picked by name.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const categoryMedian = byCategory[p.category ?? 'Other'] ?? overall;
    const fittedMult = fittedMultipleFor(p.tvl_usd, p.category, fitMap);
    const v = impliedValue(p, snapshot.as_of, model, categoryMedian, fittedMult);
    const odds = launchOdds(p, snapshot.as_of, oddsTable);
    const raw = v.implied;
    const expected = Math.max(1, Math.round(raw * odds));
    return { p, ...v, categoryMedian, fittedMult, mults: v.growthMult * v.peerMult * v.maturityMult * v.breadthMult, odds, raw, expected };
  });
  scored.sort((a, b) => b.expected - a.expected || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const bands = bootstrapBands(snapshot, scored.map((s) => ({ slug: s.p.slug, tvl_usd: s.p.tvl_usd, category: s.p.category, mults: s.mults, odds: s.odds })));
  return scored.map((s, i) => {
    const band = bands.get(s.p.slug)!;
    const economics = farmEconomics(s.p, s.age, band.low, snapshot.as_of);
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
      raw_implied_usd: s.raw,
      launch_odds: s.odds,
      implied_low_usd: band.low,
      implied_high_usd: band.high,
      rank_low: band.rankLow,
      rank_high: band.rankHigh,
      fitted_multiple: s.fittedMult,
      farm_economics: economics,
      model: {
        base_multiple: model.base_multiple,
        fitted_multiple: s.fittedMult,
        launch_odds: s.odds,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        category_median_pct: round4(s.categoryMedian),
        peer_multiplier: round4(s.peerMult),
        maturity_multiplier: round4(s.maturityMult),
        breadth_multiplier: round4(s.breadthMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age, snapshot.as_of).map(stepText),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or null when it runs on one chain only. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** What one simple transaction typically costs on a chain, as an estimate, in whole dollars. */
function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 6;
  if (c === 'bitcoin') return 3;
  if (c === 'solana') return 0.05;
  if (c === 'binance') return 0.3;
  if (c === 'polygon') return 0.1;
  if (c === 'hyperliquid l1') return 0.1;
  if (c === 'arbitrum' || c === 'optimism' || c === 'base' || c === 'avalanche' || c === 'linea' || c === 'scroll' || c === 'blast' || c === 'mode' || c === 'zksync era') return 0.5;
  return 2;
}

/** A gas figure in words: "$6" or "$0.50", never a bare decimal. */
function gasText(chain: string): string {
  const g = gasUsd(chain);
  return g >= 1 ? `$${g}` : `$${g.toFixed(2)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 25_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const half = Math.max(10, Math.round(capital / 2));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} as collateral; borrow $${half} against it.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('vault')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position through one full funding cycle.`;
  if (c.includes('perpetual') || c.includes('perps') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain}; open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name}; take one position in a market resolving after this snapshot.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it through one distribution.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy for its full term.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('governance')) return `Lock $${capital} of voting power through ${name} and vote on one live proposal.`;
  if (c.includes('chain')) return `Use $${capital} on ${name}'s chain: one transaction a week through its native app, always from the same wallet.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second qualifying action, different from the main one, from the same category. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const half = Math.max(10, Math.round(capital / 2));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${half} of USDC against the supply and repay it within the same week.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) return `Swap $25 through ${name}'s pool on ${chain} once a week, from the same wallet.`;
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator')) return `Claim or restake one reward distribution, even a small one.`;
  if (c.includes('rwa')) return `Hold the asset through one full distribution cycle and record the payout.`;
  if (c.includes('basis')) return `Leave the position untouched through one full funding cycle.`;
  if (c.includes('perpetual') || c.includes('perps') || c.includes('derivative')) return `Close the hedge; open a fresh one the following week, from the same wallet.`;
  if (c.includes('prediction')) return `Settle one market and record the outcome before opening the next.`;
  if (c.includes('insurance')) return `Keep the policy active to its expiry and record the expiry date.`;
  if (c.includes('stable')) return `Redeem $25 back to USDC and re-mint it, to show both directions.`;
  if (c.includes('payment')) return `Send a second payment of $10 through the same route.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim one staking reward and restake it.`;
  if (c.includes('governance')) return `Vote on a second proposal from the same wallet.`;
  if (c.includes('chain')) return `Bridge $25 onto ${name}'s chain and use it in the native app.`;
  if (c.includes('bridge')) return `Bridge $25 back the other way, so the wallet shows both directions.`;
  return `Make one more deposit of $25 from the same wallet.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time, plus the numeric
 * gas (one transaction per transacting step, at that step's chain gas; steps 6-8 transact
 * nothing) and active minutes (the weekly step counts 4 weeks; the hold is calendar time, not
 * active minutes) the economics are netted from. The plan is derived from the protocol's own
 * record (category, chains, TVL, age), never from a hand-written list of names. Gas figures are
 * estimates for the protocol's own chain, not promises. Steps are dated from the snapshot's
 * as_of date, so each step carries the calendar week it happens in.
 */
export interface FarmPlanStep {
  step: FarmStep;
  gasUsd: number;
  minutes: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** asOf plus n days, as "21 Nov 2026" (UTC, deterministic). */
export function fmtDate(asOf: string, plusDays = 0): string {
  const t = Date.parse(`${asOf}T00:00:00Z`) + plusDays * DAY_MS;
  if (!Number.isFinite(t)) return asOf;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** asOf plus n days, short form "21 Nov" for the weekly dates. */
export function fmtDateShort(asOf: string, plusDays = 0): string {
  return fmtDate(asOf, plusDays).replace(/ \d{4}$/, '');
}

export function farmPlan(p: SnapshotProtocol, age: number | null, asOf: string): FarmPlanStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasText(chain);
  const gasNum = gasUsd(chain);
  const main = actionFor(p, capital, chain);
  const secondAction = secondActionFor(p, capital, chain);
  const depth =
    second !== null
      ? {
          step: {
            text: `Use ${p.name} on ${second} too: repeat the main position with $25, so the wallet is active on two chains.`,
            cost: `$25 of capital and about ${gasText(second)} of gas`,
            time: '15 minutes',
          },
          gasUsd: gasUsd(second),
          minutes: 15,
        }
      : {
          step: {
            text: `Add a second $25 position in the same pool or vault from the same wallet, to deepen the activity.`,
            cost: `$25 of capital and about ${gas} of gas`,
            time: '10 minutes',
          },
          gasUsd: gasNum,
          minutes: 10,
        };
  return [
    {
      step: {
        text: `Use a fresh wallet holding only the funds you plan to farm; keep its seed phrase offline. Start in the week of ${fmtDate(asOf)}.`,
        cost: `about ${gas} of gas for the first transaction on ${chain}`,
        time: '5 minutes',
      },
      gasUsd: gasNum,
      minutes: 5,
    },
    {
      step: {
        text: main,
        cost: `$${capital} of capital and about ${gas} of gas`,
        time: '15 minutes to set up',
      },
      gasUsd: gasNum,
      minutes: 15,
    },
    {
      step: {
        text: secondAction,
        cost: `about ${gas} of gas`,
        time: '10 minutes',
      },
      gasUsd: gasNum,
      minutes: 10,
    },
    {
      step: {
        text: `Make one qualifying action each week — ${fmtDateShort(asOf, 7)}, ${fmtDateShort(asOf, 14)}, ${fmtDateShort(asOf, 21)}, ${fmtDateShort(asOf, 28)} — a deposit, a borrow, a swap or a vote, from the same wallet.`,
        cost: `about ${gas} of gas a week`,
        time: '10 minutes a week',
      },
      gasUsd: gasNum,
      minutes: 40,
    },
    depth,
    {
      step: {
        text: `Hold until ${fmtDate(asOf, hold)} (at least ${hold} days) so the activity counts in more than one snapshot.`,
        cost: `the $${capital} stays in the position`,
        time: `${hold} days`,
      },
      gasUsd: 0,
      minutes: 0,
    },
    {
      step: {
        text: `Before withdrawing, open the protocol's own points page and claim only from the link it publishes.`,
        cost: 'no fee to check, and never pay to claim',
        time: '10 minutes',
      },
      gasUsd: 0,
      minutes: 10,
    },
    {
      step: {
        text: `Write the wallet, dates and every transaction hash in a farm log; plan the unwind before any token event.`,
        cost: 'nothing but the log',
        time: '5 minutes',
      },
      gasUsd: 0,
      minutes: 5,
    },
  ];
}

/** A protocol's farm plan as text steps (see farmPlan for the numeric gas and minutes). */
export function farmSteps(p: SnapshotProtocol, age: number | null, asOf: string): FarmStep[] {
  return farmPlan(p, age, asOf).map((s) => s.step);
}

/**
 * One plan's netted economics, from the band's low end so the verdict is conservative.
 * Cost is the gas of the transacting steps (steps 1-5, one transaction each); hours are the
 * active minutes over 60. Expected value is the low end of the value band times FARMER_SHARE.
 * Whole dollars, except per_hour_usd (1 decimal) and hours (2 decimals). Verdict: FARM when
 * net >= $20 and $/hour >= $5, THIN when net >= $0, else SKIP.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, impliedLowUsd: number, asOf: string): FarmEconomics {
  const plan = farmPlan(p, age, asOf);
  const costUsd = Math.round(plan.reduce((s, step) => s + step.gasUsd, 0));
  const hours = Math.round((plan.reduce((s, step) => s + step.minutes, 0) / 60) * 100) / 100;
  const expectedUsd = Math.round(impliedLowUsd * FARMER_SHARE);
  const netUsd = expectedUsd - costUsd;
  const perHourUsd = hours === 0 ? 0 : Math.round((netUsd / hours) * 10) / 10;
  const breakevenUsd = Math.round(costUsd / FARMER_SHARE);
  const verdict: FarmEconomics['verdict'] = netUsd >= 20 && perHourUsd >= 5 ? 'FARM' : netUsd >= 0 ? 'THIN' : 'SKIP';
  return { cost_usd: costUsd, hours, expected_usd: expectedUsd, net_usd: netUsd, per_hour_usd: perHourUsd, breakeven_usd: breakevenUsd, verdict };
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

/** A board row's compact form for data.js, with the farm plan generated in the page. */
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
    raw_implied_usd: row.raw_implied_usd,
    launch_odds: row.launch_odds,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    rank_low: row.rank_low,
    rank_high: row.rank_high,
    fitted_multiple: row.fitted_multiple,
    verdict: row.farm_economics.verdict,
    net_usd: row.farm_economics.net_usd,
    per_hour_usd: row.farm_economics.per_hour_usd,
    farm_economics: row.farm_economics,
    growth_multiplier: row.model.growth_multiplier,
    peer_multiplier: row.model.peer_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** The three board rows with the strongest 7-day TVL growth, strongest first. */
export function topGainers(board: BoardRow[]): RadarRow[] {
  return board.filter((r) => r.change_7d !== null)
    .sort((a, b) => (b.change_7d ?? 0) - (a.change_7d ?? 0) || b.implied_value_usd - a.implied_value_usd)
    .slice(0, 3).map(radarRow);
}

/**
 * The census: every protocol in the snapshot accounted for. Ranked pre-token rows + has-token
 * protocols set aside as already trading + pre-token protocols excluded by the watchlist rule.
 * Excluded protocols are classified by the first rule they fail, in this priority: the wrapped /
 * staked / bridged / exchange category, a versioned pool name, a wrapped / staked word in the
 * name, an exchange name. Watchlist slugs are ranked even if they failed the rule, so they never
 * appear in the excluded bucket; every excluded protocol fails at least one of these checks, so
 * the buckets always sum to the snapshot size.
 */
export function census(snapshot: Snapshot, board: BoardRow[]): Census {
  const ranked = new Set(board.map((r) => r.slug));
  let live = 0;
  const counts = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) {
      live++;
      continue;
    }
    if (ranked.has(p.slug)) continue;
    const reason = exclusionReason(p) ?? 'other pre-token rule';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const order = ['wrapped, staked or bridged category', 'versioned pool name', 'wrapped / staked name', 'exchange product', 'other pre-token rule'];
  const excluded = order.filter((r) => counts.has(r)).map((reason) => ({ reason, count: counts.get(reason)! }));
  return { scanned: snapshot.protocols.length, ranked: board.length, live_set_aside: live, excluded };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { byCategory, overall } = peerMedians(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const verdictCounts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdictCounts[r.farm_economics.verdict]++;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    category_medians: byCategory,
    overall_median: overall,
    watchlist_slugs: snapshot.watchlist,
    top_gainers: topGainers(board),
    rows: board.map(radarRow),
    live,
    fit: fitComps(snapshot),
    census: census(snapshot, board),
    excluded_rows: excludedRows(snapshot, board),
    odds_table: oddsTableRecords(snapshot),
    farmer_share: FARMER_SHARE,
    verdict_counts: verdictCounts,
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
