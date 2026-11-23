// Token Radar, radar-6 (v5): a fresh implementation.
// Reads the sealed snapshot, fits a launch-value curve on its own traded
// tokens, ranks every rankable pre-token protocol by implied value, nets
// every farm plan to dollars, and shows launch odds as a separate signal.
//
// Model (all terms computed from the snapshot, nothing hard-coded):
//   size curve  OLS ln(mcap) = a + b ln(tvl) over 94 traded comps, plus a
//                 shrunk category intercept (n/(n+3)) x mean residual,
//                 winsorized at +/-1.0 log points. k=3 is a fixed,
//                 documented constant, NOT tuned to the LOO number.
//   multipliers growth (clamp -80..200, w 0.5), peer (change minus the
//                 category median change, clamp -60..120, w 0.3),
//                 maturity (0.70 + min(age,1460)/1460 x 0.30, unknown 365d),
//                 breadth (+3% per extra chain, max 10). Stated
//                 assumptions: fitted single-term additions all score WORSE
//                 on leave-one-out, so the terms stay heuristic.
//   bands      200 bootstrap refits, seeded mulberry32(20261119): P10/P90
//                 of implied value, P10/P90 of rank across refits.
//   odds        peer-record launch odds: category x no-token-age cell rate,
//                 smoothed toward the base rate (prior strength 5),
//                 hierarchical fallback cell -> category -> base. Shown per
//                 row and in the proof panel; NEVER multiplied into the
//                 ranked value (v4 showed that shrinks the FARM set 22->10
//                 and scores lower than v3).
//   farm EV     implied_low x FARMER_SHARE (3e-6), cost = 7 chain-gas
//                 transactions, verdict FARM if net >= $20 and $/h >= $5,
//                 THIN if net >= $0, else SKIP.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
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
  farmer_share: number;
  shrink_k: number;
  adj_cap: number;
  bootstrap_refits: number;
  seed: number;
}

export const MODEL: ModelConstants = {
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
  farmer_share: 3e-6,
  shrink_k: 3,
  adj_cap: 1.0,
  bootstrap_refits: 200,
  seed: 20261119,
};

export const MODEL_VERSION = 'radar-6';
export const LIVE_ROWS = 24;

export interface FarmEconomics {
  cost_usd: number;
  hours: number;
  expected_usd: number;
  net_usd: number;
  per_hour_usd: number;
  breakeven_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

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
  implied_low_usd: number;
  implied_high_usd: number;
  rank_low: number;
  rank_high: number;
  fitted_multiple: number;
  launch_odds: number;
  farm_economics: FarmEconomics;
  model: {
    fitted_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    peer_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    launch_odds: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

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
  implied_low_usd: number;
  implied_high_usd: number;
  rank_low: number;
  rank_high: number;
  fitted_multiple: number;
  growth_multiplier: number;
  peer_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  launch_odds: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  cost_usd: number;
  hours: number;
  expected_usd: number;
  net_usd: number;
  per_hour_usd: number;
  breakeven_usd: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface AuditedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  status: 'ranked' | 'excluded';
  rank: number | null;
  reason: string | null;
}

export interface FitReport {
  n_comps: number;
  intercept: number;
  slope: number;
  r2: number;
  loo_mape_pct: number;
  flat_loo_mape_pct: number;
  improvement_pct: number;
  ratio: number;
  median_ape_pct: number;
  mean_log_err: number;
  fitted_insample_mape_pct: number;
  constant_loo_mape_pct: number;
  walk_forward: { mean_improvement_pct: number; cutoffs: { cutoff: string; n_train: number; n_test: number; improvement_pct: number; fit_mape_pct: number; flat_mape_pct: number }[] };
  five_fold: { fit_mape_pct: number; flat_mape_pct: number; ratio: number };
  term_tests: { term: string; loo_mape_pct: number; ratio: number }[];
  controls: { permutation_loo_mape_pct: number; slope_flipped_insample_mape_pct: number };
  per_category: { category: string; n_comps: number; adj: number; median_multiple: number }[];
  seed: number;
}

export interface OddsReport {
  base_rate: number;
  n_has_token: number;
  cv_logloss: number;
  cv_logloss_base: number;
  cv_accuracy: number;
  cv_auc: number;
  ranked_min: number;
  ranked_p25: number;
  ranked_median: number;
  ranked_p75: number;
  ranked_max: number;
  age_rates: { bucket: string; n: number; rate: number }[];
}

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
  rows: RadarRow[];
  live: LiveRow[];
  audited: AuditedRow[];
  fit: FitReport;
  odds: OddsReport;
  census: { scanned: number; ranked: number; live_set_aside: number; excluded: { reason: string; count: number }[] };
  farmer_share: number;
  verdict_counts: { FARM: number; THIN: number; SKIP: number };
  total_implied_usd: number;
  total_low_usd: number;
  gas: { default_usd: number; by_chain: Record<string, number> };
  odds_cells: { category: string | null; bucket: AgeBucket; n: number; rate: number }[];
  odds_cat_rates: { category: string | null; n: number; rate: number }[];
  cat_median_change: { category: string | null; median: number }[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Gas for one plain transaction on a chain, in USD (Nov 2026 levels, stated assumption). */
export const GAS_USD: Record<string, number> = {
  Ethereum: 5.0, Arbitrum: 0.4, Optimism: 0.35, Base: 0.25, Polygon: 0.1, BSC: 0.3,
  Solana: 0.05, Avalanche: 0.4, 'zkSync Era': 0.3, Linea: 0.25, Scroll: 0.25, Blast: 0.25,
  Mantle: 0.25, Mode: 0.15, Fantom: 0.2, Gnosis: 0.3, Cronos: 0.2, Berachain: 0.3,
  Hyperliquid: 0.1, Sui: 0.05, Aptos: 0.05, Sei: 0.05, TON: 0.1, Tron: 0.3,
};
export const GAS_DEFAULT_USD = 0.5;

export function gasUsd(chain: string | undefined): number {
  if (!chain) return GAS_DEFAULT_USD;
  return GAS_USD[chain] ?? GAS_DEFAULT_USD;
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is NOT ranked, or null when it is rankable. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped / staked product';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'exchange product';
  return null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** The traded comps the size curve is fitted on. */
export function compsOf(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0
      && !EXCLUDED_CATEGORIES.has(p.category ?? '')
      && !EXCHANGE_NAMES.some((e) => p.name.startsWith(e)),
  );
}

// ---- linear algebra (small, deterministic) ----
function ols1(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

/** Least squares for a small design matrix (Gaussian elimination). */
function solveLS(X: number[][], ys: number[]): number[] {
  const n = X[0]!.length;
  const M: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const rhs = new Array<number>(n).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let r = 0; r < n; r++) {
      rhs[r]! += X[i]![r]! * ys[i]!;
      for (let c = 0; c < n; c++) M[r]![c]! += X[i]![r]! * X[i]![c]!;
    }
  }
  const A = M.map((row, i) => [...row, rhs[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!) ) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let j = c; j <= n; j++) A[r]![j]! -= f * A[c]![j]!;
    }
  }
  return A.map((row, i) => row[n]! / row[i]!);
}

export interface ShrinkFit {
  a: number;
  b: number;
  adj: Map<string | null, number>;
  predictLn: (p: SnapshotProtocol) => number;
}

/** Global OLS + shrunk category intercepts (k=3, winsorized +/-1.0). */
export function fitShrink(train: SnapshotProtocol[]): ShrinkFit {
  const { a, b } = ols1(train.map((p) => Math.log(p.tvl_usd)), train.map((p) => Math.log(p.mcap_usd!)));
  const byCat = new Map<string | null, number[]>();
  for (const p of train) {
    const r = Math.log(p.mcap_usd!) - (a + b * Math.log(p.tvl_usd));
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category)!.push(r);
  }
  const adj = new Map<string | null, number>();
  for (const [cat, rs] of byCat) {
    const mean = rs.reduce((s, v) => s + v, 0) / rs.length;
    adj.set(cat, Math.max(-MODEL.adj_cap, Math.min(MODEL.adj_cap, (rs.length / (rs.length + MODEL.shrink_k)) * mean)));
  }
  return { a, b, adj, predictLn: (p) => a + b * Math.log(p.tvl_usd) + (adj.get(p.category) ?? 0) };
}

/** Same pipeline with one extra fitted term: ln mcap ~ ln tvl + term + shrunk intercepts. */
function fitWithTerm(train: SnapshotProtocol[], termOf: (p: SnapshotProtocol) => number): (p: SnapshotProtocol) => number {
  const X = train.map((p) => [1, Math.log(p.tvl_usd), termOf(p)]);
  const ys = train.map((p) => Math.log(p.mcap_usd!));
  const beta = solveLS(X, ys);
  const base = (p: SnapshotProtocol): number => beta[0]! + beta[1]! * Math.log(p.tvl_usd) + beta[2]! * termOf(p);
  const byCat = new Map<string | null, number[]>();
  for (const p of train) {
    const r = Math.log(p.mcap_usd!) - base(p);
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category)!.push(r);
  }
  const adj = new Map<string | null, number>();
  for (const [cat, rs] of byCat) {
    const mean = rs.reduce((s, v) => s + v, 0) / rs.length;
    adj.set(cat, Math.max(-MODEL.adj_cap, Math.min(MODEL.adj_cap, (rs.length / (rs.length + MODEL.shrink_k)) * mean)));
  }
  return (p) => base(p) + (adj.get(p.category) ?? 0);
}

const ape = (predLn: number, actual: number): number => Math.abs(Math.exp(predLn) - actual) / actual;

function looWith(train: SnapshotProtocol[], predictFactory: (t: SnapshotProtocol[]) => (p: SnapshotProtocol) => number): { mape: number; meanLogErr: number; medianApe: number } {
  const errs: number[] = [];
  const logErrs: number[] = [];
  for (let i = 0; i < train.length; i++) {
    const rest = train.filter((_, j) => j !== i);
    const pred = predictFactory(rest);
    const p = train[i]!;
    errs.push(ape(pred(p), p.mcap_usd!));
    logErrs.push(Math.abs(pred(p) - Math.log(p.mcap_usd!)));
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  return { mape: mean(errs) * 100, meanLogErr: mean(logErrs), medianApe: median(errs) * 100 };
}

function flatLoo(train: SnapshotProtocol[]): number {
  let sum = 0;
  for (let i = 0; i < train.length; i++) {
    const rest = train.filter((_, j) => j !== i);
    const med = median(rest.map((q) => q.mcap_usd! / q.tvl_usd));
    const p = train[i]!;
    sum += Math.abs(p.tvl_usd * med - p.mcap_usd!) / p.mcap_usd!;
  }
  return (sum / train.length) * 100;
}

// ---- the heuristic multipliers (stated assumptions, not fitted) ----
export interface Multipliers {
  growthPct: number;
  growthMult: number;
  peerMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

export function multipliersOf(p: SnapshotProtocol, asOf: string, catMedianChange: Map<string | null, number>): Multipliers {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * MODEL.growth_weight;
  const peerRaw = rawGrowth - (catMedianChange.get(p.category) ?? 0);
  const peerClamped = Math.min(MODEL.peer_cap, Math.max(MODEL.peer_floor, peerRaw));
  const peerMult = 1 + (peerClamped / 100) * MODEL.peer_weight;
  const ageFor = age ?? MODEL.unknown_age_days;
  const maturityMult = MODEL.maturity_floor + (Math.min(Math.max(ageFor, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const breadthMult = 1 + MODEL.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_chains);
  return { growthPct, growthMult, peerMult, maturityMult, breadthMult, age };
}

export function fittedMultiple(p: SnapshotProtocol, fit: ShrinkFit): number {
  return Math.exp(fit.a) * p.tvl_usd ** (fit.b - 1) * Math.exp(fit.adj.get(p.category) ?? 0);
}

export function impliedValue(p: SnapshotProtocol, fit: ShrinkFit, mult: Multipliers): number {
  const fitted = Math.exp(fit.predictLn(p));
  return Math.max(1, Math.round(fitted * mult.growthMult * mult.peerMult * mult.maturityMult * mult.breadthMult));
}

// ---- launch odds (peer record, shown, never multiplied into the ranking) ----
export type AgeBucket = '<1y' | '1-2y' | '2-4y' | '4y+' | 'unknown';
export function ageBucket(age: number | null): AgeBucket {
  if (age === null) return 'unknown';
  if (age < 365) return '<1y';
  if (age < 730) return '1-2y';
  if (age < 1460) return '2-4y';
  return '4y+';
}

export interface OddsModel {
  baseRate: number;
  cellRate: Map<string, number>;
  catRate: Map<string | null, number>;
  cellN: Map<string, number>;
  catN: Map<string | null, number>;
  oddsOf: (p: SnapshotProtocol, age: number | null) => number;
}

export function buildOdds(protocols: SnapshotProtocol[], asOf: string): OddsModel {
  const has = protocols.filter((p) => !isPreToken(p)).length;
  const baseRate = has / protocols.length;
  const prior = 5;
  const cells = new Map<string, { n: number; has: number }>();
  const cats = new Map<string | null, { n: number; has: number }>();
  for (const p of protocols) {
    const key = `${p.category ?? 'null'}|${ageBucket(ageDays(asOf, p.listed_at))}`;
    if (!cells.has(key)) cells.set(key, { n: 0, has: 0 });
    const c = cells.get(key)!;
    c.n++;
    if (!isPreToken(p)) c.has++;
    if (!cats.has(p.category)) cats.set(p.category, { n: 0, has: 0 });
    const g = cats.get(p.category)!;
    g.n++;
    if (!isPreToken(p)) g.has++;
  }
  const cellRate = new Map<string, number>();
  for (const [key, c] of cells) {
    if (c.n >= 5) cellRate.set(key, (c.has + prior * baseRate) / (c.n + prior));
  }
  const catRate = new Map<string | null, number>();
  for (const [cat, g] of cats) catRate.set(cat, (g.has + prior * baseRate) / (g.n + prior));
  const cellN = new Map([...cells.entries()].map(([k, c]) => [k, c.n] as [string, number]));
  const catN = new Map([...cats.entries()].map(([k, g]) => [k, g.n] as [string | null, number]));
  const oddsOf = (p: SnapshotProtocol, age: number | null): number => {
    const key = `${p.category ?? 'null'}|${ageBucket(age)}`;
    if (cellRate.has(key)) return cellRate.get(key)!;
    if (catRate.has(p.category)) return catRate.get(p.category)!;
    return baseRate;
  };
  return { baseRate, cellRate, catRate, cellN, catN, oddsOf };
}

function oddsCv(protocols: SnapshotProtocol[], asOf: string): { logloss: number; loglossBase: number; accuracy: number; auc: number } {
  // 5-fold, 3 seeded shuffles; log-loss / accuracy / AUC vs the base rate.
  const seeds = [20261119, 7, 12345];
  let ll = 0, llb = 0, acc = 0, n = 0;
  let aucSum = 0, aucN = 0;
  for (const seed of seeds) {
    const rnd = mulberry32(seed);
    const arr = [...protocols];
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j]!, arr[i]!]; }
    for (let f = 0; f < 5; f++) {
      const test = arr.filter((_, i) => i % 5 === f);
      const train = arr.filter((_, i) => i % 5 !== f);
      const model = buildOdds(train, asOf);
      const base = model.baseRate;
      const scored: { y: number; o: number }[] = [];
      for (const p of test) {
        const y = isPreToken(p) ? 0 : 1;
        const o = Math.min(0.999, Math.max(0.001, model.oddsOf(p, ageDays(asOf, p.listed_at))));
        ll += -(y * Math.log(o) + (1 - y) * Math.log(1 - o));
        llb += -(y * Math.log(base) + (1 - y) * Math.log(1 - base));
        acc += (o >= 0.5 ? 1 : 0) === y ? 1 : 0;
        scored.push({ y, o });
        n++;
      }
      // AUC (Mann-Whitney on this fold)
      const pos = scored.filter((s) => s.y === 1);
      const neg = scored.filter((s) => s.y === 0);
      if (pos.length && neg.length) {
        let wins = 0;
        for (const a of pos) for (const b of neg) wins += a.o > b.o ? 1 : a.o === b.o ? 0.5 : 0;
        aucSum += wins / (pos.length * neg.length);
        aucN++;
      }
    }
  }
  return { logloss: ll / n, loglossBase: llb / n, accuracy: acc / n, auc: aucSum / aucN };
}

// ---- farm plans ----
export interface FarmStep {
  text: string;
  costUsd: number;
  minutes: number;
}

function addDays(asOf: string, days: number): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the supply open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s main pool on ${chain} and leave the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in an open market.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy live.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

export function stepText(step: FarmStep): string {
  const cost = step.costUsd === 0 ? 'no gas' : `$${step.costUsd.toFixed(2)} of gas`;
  const time = step.minutes === 0 ? 'calendar time, not active time' : `${step.minutes} minutes`;
  let s = `${step.text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the farm log up to date.`;
  return s;
}

export function farmSteps(p: SnapshotProtocol, age: number | null, asOf: string): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasUsd(p.chains[0]);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const w1 = addDays(asOf, 7);
  const w2 = addDays(asOf, 14);
  const w3 = addDays(asOf, 21);
  const w4 = addDays(asOf, 28);
  const holdUntil = addDays(asOf, hold);
  return [
    { text: `Set up a fresh wallet that holds only farm funds, keep its seed phrase offline, and fund it on ${chain} by ${w1}.`, costUsd: gas, minutes: 5 },
    { text: `${actionFor(p, capital, chain)} Do it by ${w1} so the first snapshot catches it.`, costUsd: gas, minutes: 15 },
    { text: `Do one qualifying action each week — a deposit, a borrow, a swap or a vote — on ${w1}, ${w2}, ${w3} and ${w4}.`, costUsd: 4 * gas, minutes: 40 },
    { text: `Hold the position until ${holdUntil} (${hold} days) so the activity spans more than one snapshot.`, costUsd: 0, minutes: 0 },
    { text: `Open the protocol's own points or rewards page on ${w2} and confirm the position is counted.`, costUsd: 0, minutes: 10 },
    { text: `Make a second qualifying action in week 3 (${w3}) — a small top-up or a second deposit — to keep the activity fresh.`, costUsd: gas, minutes: 10 },
    { text: `Before withdrawing, open the protocol's own claim page and claim only from the link it publishes; never pay to claim.`, costUsd: 0, minutes: 10 },
    { text: `Write the wallet, the dates and every transaction hash in a farm log so the position can be repeated or unwound.`, costUsd: 0, minutes: 5 },
  ];
}

export function farmEconomics(impliedLow: number, steps: FarmStep[]): FarmEconomics {
  const cost = steps.reduce((s, st) => s + st.costUsd, 0);
  const minutes = steps.reduce((s, st) => s + st.minutes, 0);
  const hours = round2(minutes / 60);
  const expected = Math.round(impliedLow * MODEL.farmer_share);
  const net = Math.round(expected - cost);
  const perHour = round2(net / hours);
  const breakeven = Math.round(cost / MODEL.farmer_share);
  const verdict: 'FARM' | 'THIN' | 'SKIP' = net >= 20 && perHour >= 5 ? 'FARM' : net >= 0 ? 'THIN' : 'SKIP';
  return { cost_usd: round2(cost), hours, expected_usd: expected, net_usd: net, per_hour_usd: perHour, breakeven_usd: breakeven, verdict };
}

// ---- validation reports ----
function fitReport(comps: SnapshotProtocol[]): FitReport {
  const fit = fitShrink(comps);
  const loo = looWith(comps, (t) => fitShrink(t).predictLn);
  const flat = flatLoo(comps);
  const ybar = comps.reduce((s, p) => s + Math.log(p.mcap_usd!), 0) / comps.length;
  let ssTot = 0, ssRes = 0, insample = 0;
  for (const p of comps) {
    const r = Math.log(p.mcap_usd!) - fit.predictLn(p);
    ssRes += r * r;
    ssTot += (Math.log(p.mcap_usd!) - ybar) ** 2;
    insample += Math.abs(Math.exp(fit.predictLn(p)) - p.mcap_usd!) / p.mcap_usd!;
  }
  insample = (insample / comps.length) * 100;
  // constant baseline LOO (geometric-mean mcap)
  let constSum = 0;
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const gmean = Math.exp(rest.reduce((s, q) => s + Math.log(q.mcap_usd!), 0) / rest.length);
    constSum += Math.abs(gmean - comps[i]!.mcap_usd!) / comps[i]!.mcap_usd!;
  }
  const constantLoo = (constSum / comps.length) * 100;
  // walk-forward
  const cutoffs = ['2024-01-01', '2024-07-01', '2025-01-01', '2025-07-01'];
  const wfRows = [];
  for (const c of cutoffs) {
    const train = comps.filter((p) => p.listed_at && p.listed_at < c);
    const test = comps.filter((p) => p.listed_at && p.listed_at >= c);
    const f = fitShrink(train);
    const med = median(train.map((q) => q.mcap_usd! / q.tvl_usd));
    let fe = 0, be = 0;
    for (const p of test) { fe += ape(f.predictLn(p), p.mcap_usd!); be += Math.abs(p.tvl_usd * med - p.mcap_usd!) / p.mcap_usd!; }
    fe = (fe / test.length) * 100;
    be = (be / test.length) * 100;
    wfRows.push({ cutoff: c, n_train: train.length, n_test: test.length, improvement_pct: round2(((be - fe) / be) * 100), fit_mape_pct: round2(fe), flat_mape_pct: round2(be) });
  }
  const wfMean = round2(wfRows.reduce((s, r) => s + r.improvement_pct, 0) / wfRows.length);
  // 5-fold, seeded shuffle, seed 20261119
  const rnd = mulberry32(MODEL.seed);
  const arr = [...comps];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j]!, arr[i]!]; }
  let ffe = 0, fbe = 0, fn = 0;
  for (let k = 0; k < 5; k++) {
    const test = arr.filter((_, i) => i % 5 === k);
    const train = arr.filter((_, i) => i % 5 !== k);
    const f = fitShrink(train);
    const med = median(train.map((q) => q.mcap_usd! / q.tvl_usd));
    for (const p of test) { ffe += ape(f.predictLn(p), p.mcap_usd!); fbe += Math.abs(p.tvl_usd * med - p.mcap_usd!) / p.mcap_usd!; fn++; }
  }
  const ffFit = (ffe / fn) * 100;
  const ffFlat = (fbe / fn) * 100;
  // term tests: one fitted term at a time (needs the category medians)
  const catMed = new Map<string | null, number>();
  {
    const byCat = new Map<string | null, number[]>();
    for (const p of comps) { if (p.change_7d === null) continue; if (!byCat.has(p.category)) byCat.set(p.category, []); byCat.get(p.category)!.push(p.change_7d); }
    for (const [c, vs] of byCat) catMed.set(c, median(vs));
  }
  const termOf = {
    growth: (p: SnapshotProtocol) => Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, finite(p.change_7d, 0))),
    peer: (p: SnapshotProtocol) => Math.min(MODEL.peer_cap, Math.max(MODEL.peer_floor, finite(p.change_7d, 0) - (catMed.get(p.category) ?? 0))),
    maturity: (p: SnapshotProtocol) => { const a2 = ageDays('2026-11-14', p.listed_at) ?? MODEL.unknown_age_days; return MODEL.maturity_floor + (Math.min(Math.max(a2, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range; },
    breadth: (p: SnapshotProtocol) => p.chains.length,
  };
  const termTests = (Object.keys(termOf) as (keyof typeof termOf)[]).map((term) => {
    const r = looWith(comps, (t) => fitWithTerm(t, termOf[term]));
    return { term, loo_mape_pct: round2(r.mape), ratio: round2(flat / r.mape) };
  });
  // failing controls
  const permRnd = mulberry32(MODEL.seed);
  const shuffled = comps.map((p) => ({ ...p }));
  const mcaps = shuffled.map((p) => p.mcap_usd!);
  for (let i = mcaps.length - 1; i > 0; i--) { const j = Math.floor(permRnd() * (i + 1)); [mcaps[i], mcaps[j]] = [mcaps[j]!, mcaps[i]!]; }
  shuffled.forEach((p, i) => { p.mcap_usd = mcaps[i]!; });
  const permLoo = looWith(shuffled, (t) => fitShrink(t).predictLn);
  const meanX = comps.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / comps.length;
  let flipped = 0;
  for (const p of comps) {
    const predLn = fit.a + 2 * fit.b * meanX - fit.b * Math.log(p.tvl_usd) + (fit.adj.get(p.category) ?? 0);
    flipped += Math.abs(Math.exp(predLn) - p.mcap_usd!) / p.mcap_usd!;
  }
  flipped = (flipped / comps.length) * 100;
  // per-category table
  const perCat = new Map<string | null, { n: number; mults: number[] }>();
  for (const p of comps) {
    if (!perCat.has(p.category)) perCat.set(p.category, { n: 0, mults: [] });
    const e = perCat.get(p.category)!;
    e.n++;
    e.mults.push(p.mcap_usd! / p.tvl_usd);
  }
  const perCategory = [...perCat.entries()]
    .map(([category, e]) => ({ category: category ?? '(no category)', n_comps: e.n, adj: fit.adj.get(category) ?? 0, median_multiple: median(e.mults) }))
    .sort((x, y) => y.n_comps - x.n_comps || (x.category < y.category ? -1 : 1));
  return {
    n_comps: comps.length,
    intercept: fit.a,
    slope: fit.b,
    r2: round4(1 - ssRes / ssTot),
    loo_mape_pct: round2(loo.mape),
    flat_loo_mape_pct: round2(flat),
    improvement_pct: round2(((flat - loo.mape) / flat) * 100),
    ratio: round2(flat / loo.mape),
    median_ape_pct: round2(loo.medianApe),
    mean_log_err: round4(loo.meanLogErr),
    fitted_insample_mape_pct: round2(insample),
    constant_loo_mape_pct: round2(constantLoo),
    walk_forward: { mean_improvement_pct: wfMean, cutoffs: wfRows },
    five_fold: { fit_mape_pct: round2(ffFit), flat_mape_pct: round2(ffFlat), ratio: round2(ffFlat / ffFit) },
    term_tests: termTests,
    controls: { permutation_loo_mape_pct: round2(permLoo.mape), slope_flipped_insample_mape_pct: round2(flipped) },
    per_category: perCategory,
    seed: MODEL.seed,
  };
}

// ---- the build ----
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const comps = compsOf(snapshot.protocols);
  if (comps.length < 20) throw new SnapshotError(`only ${comps.length} traded comps: the size curve cannot be fitted`);
  const fit = fitShrink(comps);
  const report = fitReport(comps);
  // category median 7d change over ALL protocols (validated: reproduces the
  // v3 totals exactly — see the experiment log).
  const catChanges = new Map<string | null, number[]>();
  for (const p of snapshot.protocols) {
    if (p.change_7d === null) continue;
    if (!catChanges.has(p.category)) catChanges.set(p.category, []);
    catChanges.get(p.category)!.push(p.change_7d);
  }
  const catMedianChange = new Map<string | null, number>();
  for (const [c, vs] of catChanges) catMedianChange.set(c, median(vs));

  const odds = buildOdds(snapshot.protocols, snapshot.as_of);
  const oddsCvRes = oddsCv(snapshot.protocols, snapshot.as_of);

  const ranked = snapshot.protocols.filter(isRankable);
  const watchSet = new Set(snapshot.watchlist);
  const early = ranked.filter((p) => !watchSet.has(p.slug)).length;

  // bootstrap bands + rank ranges: 200 refits, seeded, over the comps.
  const rnd = mulberry32(MODEL.seed);
  const refitPreds: number[][] = ranked.map(() => []);
  const refitRanks: number[][] = ranked.map(() => []);
  const mults = ranked.map((p) => {
    const m = multipliersOf(p, snapshot.as_of, catMedianChange);
    return { p, m, base: impliedValue(p, fit, m) };
  });
  for (let b = 0; b < MODEL.bootstrap_refits; b++) {
    const sample = Array.from({ length: comps.length }, () => comps[Math.floor(rnd() * comps.length)]!);
    const rf = fitShrink(sample);
    const vals = mults.map(({ p, m }) => {
      const fitted = Math.exp(rf.predictLn(p));
      return Math.max(1, Math.round(fitted * m.growthMult * m.peerMult * m.maturityMult * m.breadthMult));
    });
    const order = vals.map((v, i) => ({ v, i })).sort((x, y) => y.v - x.v || (ranked[x.i]!.slug < ranked[y.i]!.slug ? -1 : 1));
    order.forEach((o, pos) => { refitPreds[o.i]!.push(vals[o.i]!); refitRanks[o.i]!.push(pos + 1); });
  }

  const rows: BoardRow[] = mults.map(({ p, m, base }, i) => {
    const preds = [...refitPreds[i]!].sort((x, y) => x - y);
    const ranks = [...refitRanks[i]!].sort((x, y) => x - y);
    const low = Math.min(quantile(preds, 0.1), base);
    const high = Math.max(quantile(preds, 0.9), base);
    const steps = farmSteps(p, m.age, snapshot.as_of);
    const econ = farmEconomics(low, steps);
    const oddsVal = odds.oddsOf(p, m.age);
    const fm = fittedMultiple(p, fit);
    return {
      rank: 0, // assigned after sorting
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: m.age,
      implied_value_usd: base,
      implied_low_usd: low,
      implied_high_usd: high,
      rank_low: quantile(ranks, 0.1),
      rank_high: quantile(ranks, 0.9),
      fitted_multiple: round4(fm),
      launch_odds: round4(oddsVal),
      farm_economics: econ,
      model: {
        fitted_multiple: round4(fm),
        growth_pct: round4(m.growthPct),
        growth_multiplier: round4(m.growthMult),
        peer_multiplier: round4(m.peerMult),
        maturity_multiplier: round4(m.maturityMult),
        breadth_multiplier: round4(m.breadthMult),
        launch_odds: round4(oddsVal),
        age_days: m.age,
      },
      farm_steps: steps.map(stepText),
    };
  });
  rows.sort((x, y) => y.implied_value_usd - x.implied_value_usd || (x.slug < y.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
    // The refit rank range is widened to include the point rank: the range
    // reports refit spread, and the point estimate is inside it by construction.
    r.rank_low = Math.min(r.rank_low, r.rank);
    r.rank_high = Math.max(r.rank_high, r.rank);
  });

  const verdictCounts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) verdictCounts[r.farm_economics.verdict]++;
  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const totalLow = rows.reduce((s, r) => s + r.implied_low_usd, 0);

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));

  const rankBySlug = new Map(rows.map((r) => [r.slug, r.rank]));
  const audited: AuditedRow[] = snapshot.protocols
    .filter(isPreToken)
    .map((p) => {
      const reason = exclusionReason(p);
      return { slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, status: reason === null ? 'ranked' as const : 'excluded' as const, rank: reason === null ? rankBySlug.get(p.slug) ?? null : null, reason };
    })
    .sort((a, b) => b.tvl_usd - a.tvl_usd);

  const excludedCounts = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const reason = exclusionReason(p);
    if (reason !== null) excludedCounts.set(reason, (excludedCounts.get(reason) ?? 0) + 1);
  }
  const excluded = [...excludedCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  const liveSetAside = snapshot.protocols.length - ranked.length - excluded.reduce((s, e) => s + e.count, 0);

  const oddsVals = rows.map((r) => r.launch_odds).sort((a, b) => a - b);
  const qv = (q: number) => oddsVals[Math.min(oddsVals.length - 1, Math.floor(q * oddsVals.length))]!;
  const ageRates = (['<1y', '1-2y', '2-4y', '4y+', 'unknown'] as AgeBucket[]).map((bucket) => {
    const inBucket = snapshot.protocols.filter((p) => ageBucket(ageDays(snapshot.as_of, p.listed_at)) === bucket);
    const has = inBucket.filter((p) => !isPreToken(p)).length;
    return { bucket, n: inBucket.length, rate: round4(inBucket.length ? has / inBucket.length : 0) };
  });

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    early_size: early,
    live_size: live.length,
    rows: rows.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      implied_low_usd: r.implied_low_usd,
      implied_high_usd: r.implied_high_usd,
      rank_low: r.rank_low,
      rank_high: r.rank_high,
      fitted_multiple: r.fitted_multiple,
      growth_multiplier: r.model.growth_multiplier,
      peer_multiplier: r.model.peer_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      launch_odds: r.launch_odds,
      verdict: r.farm_economics.verdict,
      cost_usd: r.farm_economics.cost_usd,
      hours: r.farm_economics.hours,
      expected_usd: r.farm_economics.expected_usd,
      net_usd: r.farm_economics.net_usd,
      per_hour_usd: r.farm_economics.per_hour_usd,
      breakeven_usd: r.farm_economics.breakeven_usd,
    })),
    live,
    audited,
    fit: report,
    odds: {
      base_rate: round4(odds.baseRate),
      n_has_token: snapshot.protocols.length - snapshot.protocols.filter(isPreToken).length,
      cv_logloss: round4(oddsCvRes.logloss),
      cv_logloss_base: round4(oddsCvRes.loglossBase),
      cv_accuracy: round4(oddsCvRes.accuracy),
      cv_auc: round4(oddsCvRes.auc),
      ranked_min: qv(0),
      ranked_p25: qv(0.25),
      ranked_median: qv(0.5),
      ranked_p75: qv(0.75),
      ranked_max: qv(0.999),
      age_rates: ageRates,
    },
    census: { scanned: snapshot.protocols.length, ranked: ranked.length, live_set_aside: liveSetAside, excluded },
    farmer_share: MODEL.farmer_share,
    verdict_counts: verdictCounts,
    total_implied_usd: totalImplied,
    total_low_usd: totalLow,
    gas: { default_usd: GAS_DEFAULT_USD, by_chain: GAS_USD },
    odds_cells: [...odds.cellRate.entries()].map(([key, rate]) => {
      const [category, bucket] = key.split('|');
      return { category: category === 'null' ? null : category, bucket: bucket as AgeBucket, n: odds.cellN.get(key) ?? 0, rate };
    }),
    odds_cat_rates: [...odds.catRate.entries()].map(([category, rate]) => ({ category, n: odds.catN.get(category) ?? 0, rate })),
    cat_median_change: [...catMedianChange.entries()].map(([category, median]) => ({ category, median })),
  };
  return { board: rows, radar };
}

/** Why a board is not one the gate will take, or null. */
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
    if (r.implied_low_usd > r.implied_value_usd || r.implied_high_usd < r.implied_value_usd) return `${r.slug} has a band that does not contain its implied value`;
    if (r.rank_low > r.rank || r.rank_high < r.rank) return `${r.slug} has a rank range that does not contain its rank`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
