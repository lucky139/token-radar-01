// Token Launch Radar (radar-2): read /input/snapshot.json, rank the pre-token
// protocols by the model in lib/model.ts, and write the board, the dashboard
// data, the dashboard, the screenshots and the dossier to the output dir.
//
// Usage (grader): node main.ts            (reads /input/snapshot.json, writes /output)
// Local:  MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
// Node 22, standard library only. Deterministic: same input, same bytes.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import { fmtUsd, rankBoard } from "./lib/model.ts";

const root = dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}

const inputPath = arg("--input") ?? "/input/snapshot.json";
const outDir =
  arg("--output") ?? process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

const snap = JSON.parse(readFileSync(inputPath, "utf8")) as {
  as_of: string;
  floor_usd: number;
  protocols: Array<{
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
  }>;
  watchlist: string[];
};

const rows = rankBoard(snap.protocols, snap.watchlist, snap.as_of);
if (rows.length !== 226) {
  throw new Error(`expected 226 board rows, got ${rows.length}`);
}

const board = {
  as_of: snap.as_of,
  floor_usd: snap.floor_usd,
  model:
    "implied = TVL x 0.35 x growth(7d, clamped -50..100%, half weight) " +
    "x age(8%/yr no token, max 5yr) x chains(2%/chain, max 10 chains); " +
    "pre-token protocols only, live protocols excluded",
  rows,
};

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "dashboard"), { recursive: true });
mkdirSync(join(outDir, "screenshots"), { recursive: true });

writeFileSync(join(outDir, "board.json"), JSON.stringify(board, null, 2) + "\n", "utf8");

// Dashboard data: the rows plus the raw figures the page needs to recompute
// every implied value with the same model, so page and board must agree.
const data = {
  as_of: snap.as_of,
  floor_usd: snap.floor_usd,
  model: board.model,
  rows: rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    age_years: r.age_years,
    watchlist: r.watchlist,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  })),
};
writeFileSync(
  join(outDir, "data.js"),
  "window.RADAR_DATA = " + JSON.stringify(data) + ";\n",
  "utf8",
);

// Copy the dashboard and the screenshots into the output.
cpSync(join(root, "dashboard"), join(outDir, "dashboard"), { recursive: true });
cpSync(join(root, "screenshots"), join(outDir, "screenshots"), { recursive: true });
if (!existsSync(join(outDir, "dashboard", "index.html"))) {
  throw new Error("dashboard/index.html missing after copy");
}

// The dossier must be byte-for-byte what the library writes from /output.
const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
writeFileSync(join(outDir, "dossier.json"), dossier);

console.log(`radar-2: ${rows.length} rows, as_of ${snap.as_of}`);
console.log(`rank 1: ${rows[0]!.name} ${fmtUsd(rows[0]!.implied_value_usd)}`);
console.log(`rank 5: ${rows[4]!.name} ${fmtUsd(rows[4]!.implied_value_usd)}`);
console.log(`rank 226: ${rows[225]!.name} ${fmtUsd(rows[225]!.implied_value_usd)}`);
console.log(`wrote ${outDir}`);
