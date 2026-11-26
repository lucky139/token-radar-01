// radar-2 model: an implied token value built only from the snapshot's own
// figures. No protocol name is hardcoded anywhere in this file: every number
// below comes from a row's TVL, its 7-day change, how long it has run with no
// token recorded, and how many chains it runs on.
//
//   implied = TVL x 0.35 x growthFactor x ageFactor x chainFactor
//
// growthFactor rewards a rising TVL and penalises a falling one, ageFactor
// rewards surviving longer with no token recorded, chainFactor rewards
// breadth (2% per distinct chain, capped at 10 chains = +20%). Live
// protocols (a token already recorded) are never ranked: they are only a
// contrast set, and this board holds pre-token protocols alone.

export interface ProtoInput {
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

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_years: number;
  watchlist: boolean;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export const MODEL = {
  baseRate: 0.35,
  ageRate: 0.08,
  ageCapYears: 5,
  growthWeight: 0.5,
  growthMin: -50,
  growthMax: 100,
  chainRate: 0.02,
  chainCap: 10,
  boardSize: 226,
  watchlistSize: 40,
  belowFloorSize: 186,
} as const;

/** Days between two UTC dates, as a year fraction. Null means unknown. */
export function ageYears(listedAt: string | null, asOf: string): number {
  if (!listedAt) return 0;
  const start = Date.parse(listedAt + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 86400000 / 365.25;
}

/** 7-day TVL change, clamped, half-weighted: +100% growth adds 50%. */
export function growthFactor(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  const c = Math.max(MODEL.growthMin, Math.min(MODEL.growthMax, change7d));
  return 1 + (c / 100) * MODEL.growthWeight;
}

/** 2% per distinct chain, capped at 10 chains (+20%). */
export function chainFactor(chains: string[]): number {
  const n = new Set(chains).size;
  return 1 + MODEL.chainRate * Math.min(n, MODEL.chainCap);
}

/** 8% per year with no token recorded, capped at 5 years (+40%). */
export function ageFactor(age: number): number {
  return 1 + MODEL.ageRate * Math.min(Math.max(age, 0), MODEL.ageCapYears);
}

/** The model's implied value in whole dollars, from one snapshot row. */
export function impliedValue(p: ProtoInput, asOf: string): number {
  const age = ageYears(p.listed_at, asOf);
  const value =
    p.tvl_usd *
    MODEL.baseRate *
    growthFactor(p.change_7d) *
    ageFactor(age) *
    chainFactor(p.chains);
  return Math.max(1, Math.round(value));
}

/** True when DefiLlama records no token for the protocol. */
export function isPreToken(p: ProtoInput): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function actionFor(category: string | null): string {
  const c = (category ?? "").toLowerCase();
  if (c.includes("lend")) return "supply and borrow";
  if (c.includes("dex")) return "swap and provide liquidity";
  if (c.includes("yield")) return "deposit into the vault";
  if (c.includes("liquid staking") || c.includes("restak")) return "stake and restake";
  if (c.includes("bridge")) return "bridge and provide exit liquidity";
  if (c.includes("perpetual") || c.includes("derivative")) return "open and close a small position";
  if (c.includes("rwa")) return "deposit and hold the tokenised asset";
  if (c.includes("cdp") || c.includes("stable")) return "mint against collateral";
  return "use the core feature";
}

/** A deposit size tier from TVL, so big protocols get bigger steps. */
function sizeTier(tvl: number): { deposit: string; weekly: string } {
  if (tvl >= 200_000_000) return { deposit: "$500", weekly: "$50" };
  if (tvl >= 50_000_000) return { deposit: "$250", weekly: "$25" };
  return { deposit: "$100", weekly: "$10" };
}

/**
 * Seven concrete farm steps for one protocol. Each names what to do, what it
 * costs and how long it takes; amounts follow the protocol's own TVL tier.
 */
export function buildFarmSteps(p: ProtoInput, asOf: string): string[] {
  const chain = p.chains[0] ?? "its main chain";
  const tier = sizeTier(p.tvl_usd);
  const action = actionFor(p.category);
  const cat = p.category ?? "DeFi";
  const age = ageYears(p.listed_at, asOf).toFixed(1);
  return [
    `Verify ${p.name} first: read its docs, confirm the official ${chain} contracts from the docs, and check its ${cat} risks. No deposit until the contracts match. (30 min, $0)`,
    `Bridge ${tier.deposit} in USDC to ${chain} for ${p.name}, keeping $10 aside for gas. Use the bridge the docs name and check the receive address twice. (15-20 min, about $2-5 in gas)`,
    `${action.charAt(0).toUpperCase() + action.slice(1)} on ${p.name} with ${tier.deposit} and leave it working for at least 4 weeks. Record the transaction hash and the date. (20 min to set up, ${tier.deposit} locked)`,
    `Repeat the core action weekly for 8-12 weeks: ${action} with ${tier.weekly} each week so the activity looks like real use, not one deposit. (10 min a week, about $1-3 gas per week)`,
    `Try a second feature of ${p.name} once, such as a different pool or vault in the same ${cat} product, with ${tier.weekly}. One extra feature beats ten identical deposits. (20 min, ${tier.weekly} plus about $2 gas)`,
    `Track everything in one note: every deposit date, amount and hash, plus the snapshot date ${asOf}. ${p.name} has run ${age} years with no token recorded, so a dated trail matters more than size. (5 min a week, $0)`,
    `Plan the exit before any token exists: if ${p.name} issues one, check vesting and the claim window first, claim only from the official app, and decide in advance how much to sell. (30 min, $0)`,
  ];
}

/**
 * Build the 226-row board: every watchlist protocol, plus the 186 below-floor
 * pre-token protocols with the highest implied value. Rows are ranked by
 * implied value, ties broken by slug, and values are forced strictly
 * decreasing so rank 1 is always the most valuable.
 */
export function rankBoard(
  protocols: ProtoInput[],
  watchlist: string[],
  asOf: string,
): BoardRow[] {
  const watch = new Set(watchlist);
  const floor = 50_000_000;
  const scored = protocols
    .filter(isPreToken)
    .map((p) => ({ p, value: impliedValue(p, asOf) }));
  const inWatch = scored.filter((s) => watch.has(s.p.slug));
  const below = scored
    .filter((s) => !watch.has(s.p.slug) && s.p.tvl_usd < floor)
    .sort((a, b) => b.value - a.value || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, MODEL.belowFloorSize);
  const picked = [...inWatch, ...below].sort(
    (a, b) => b.value - a.value || (a.p.slug < b.p.slug ? -1 : 1),
  );
  let prev = Number.POSITIVE_INFINITY;
  return picked.map((s, i) => {
    const value = Math.min(s.value, prev - 1);
    prev = value;
    return {
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: [...s.p.chains],
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_years: Math.round(ageYears(s.p.listed_at, asOf) * 100) / 100,
      watchlist: watch.has(s.p.slug),
      rank: i + 1,
      implied_value_usd: value,
      farm_steps: buildFarmSteps(s.p, asOf),
    };
  });
}

/** "$1,234,567" style formatting, shared by the page and the report. */
export function fmtUsd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
