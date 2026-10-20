// Builds src/modules/people/psgc-ph.json: Philippine provinces and their cities/municipalities.
// Run once by hand (`pnpm tsx scripts/build-psgc.mts`) and commit the result; the app never calls this at runtime.
//
// Source: the Philippine Standard Geographic Code (PSGC), published by the Philippine Statistics Authority (PSA).
// It is Philippine government statistical data. This script reads the public JSON mirror at psgc.gitlab.io, which
// republishes the PSA tables as-is. Check the PSA's latest publication before regenerating and note the date in the commit.
//
// Shape: { "<province>": ["<city or municipality>", ...] } in alphabetical order.
// - Metro Manila (NCR) has no provinces in PSGC; it is listed as one entry holding its cities and Pateros.
// - Two independent cities PSGC lists without a province are placed in the province they sit in:
//   City of Isabela -> Basilan, City of Cotabato -> Maguindanao.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://psgc.gitlab.io/api";
const NCR = "130000000";
const INDEPENDENT_HOME: Record<string, string> = { "City of Isabela": "Basilan", "City of Cotabato": "Maguindanao" };

type Province = { code: string; name: string };
type Place = { name: string; provinceCode: string | false; regionCode: string };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}/`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const provinces = await get<Province[]>("provinces");
const places = await get<Place[]>("cities-municipalities");

const byCode = new Map(provinces.map((p) => [p.code, p.name]));
const out = new Map<string, string[]>([["Metro Manila", []], ...provinces.map((p): [string, string[]] => [p.name, []])]);

for (const place of places) {
  const home =
    place.provinceCode !== false ? byCode.get(place.provinceCode) : place.regionCode === NCR ? "Metro Manila" : INDEPENDENT_HOME[place.name];
  const list = home ? out.get(home) : undefined;
  if (!list) throw new Error(`No province for ${place.name}`);
  list.push(place.name);
}

const sorted = Object.fromEntries(
  [...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.sort((a, b) => a.localeCompare(b))]),
);
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "modules", "people", "psgc-ph.json");
writeFileSync(target, `${JSON.stringify(sorted)}\n`);
console.log(`${Object.keys(sorted).length} provinces, ${places.length} cities and municipalities -> ${target}`);
