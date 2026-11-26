export type Hex = { h3: string; nta: number; [k: string]: any };
export type District = { name: string; icon: string; score: number; why: string };
export type Nta = {
  code: string; name: string; boro: string; type: number; hexes: number; pop: number; income: number | null;
  rent: number | null; age: number | null; bachPct: number | null; gradPct: number | null; subwayPct: number | null;
  busPct: number | null; drovePct: number | null; walkPct: number | null; bikePct: number | null; wfhPct: number | null;
  foreignPct: number | null; workers: number; occ: Record<string, number>; ind: Record<string, number>;
  districts: District[]; topCuisines?: Record<string, number>; [k: string]: any;
};
export type Station = { id: string; name: string; boro: string; lat: number; lon: number; wd: number[]; we: number[]; daily: number };
export type Line = { route: string; color: string; path: [number, number][] };
export type Wonder = { kind: string; name: string; lat: number; lon: number; rule: string; stat: string; addr?: string };
export type Meta = {
  built: string; hexes: number; city: Record<string, any>; hourly: Record<string, number[]>;
  top311: Record<string, number>; topOffenses: Record<string, number>; topTrees: Record<string, number>;
  counts: Record<string, number>;
};
export type World = {
  hexes: Hex[]; ntas: Nta[]; meta: Meta; stations: Station[]; lines: Line[]; wonders: Wonder[];
  species: string[]; cuisines: string[]; noise24: Record<string, number[]>; ntaGeo: any;
  hexIndex: Map<string, Hex>; ntaHexes: Hex[][];
};

const j = (p: string) => fetch(`/data/${p}`).then((r) => r.json());

export async function loadWorld(onProgress: (s: string) => void): Promise<World> {
  onProgress("Surveying 857,127 tax lots…");
  const [hx, ntas, meta, sub, wonders, noise24, ntaGeo] = await Promise.all([
    j("hexes.json"), j("ntas.json"), j("meta.json"), j("subway.json"), j("wonders.json"), j("noise24.json"), j("ntas.geojson"),
  ]);
  onProgress("Founding neighborhoods…");
  const fields: string[] = hx.fields;
  const hexes: Hex[] = hx.rows.map((r: any[]) => {
    const o: Hex = { h3: r[0], nta: r[1] };
    for (let i = 2; i < fields.length; i++) o[fields[i]] = r[i];
    return o;
  });
  const hexIndex = new Map(hexes.map((h) => [h.h3, h]));
  const ntaHexes: Hex[][] = ntas.map(() => []);
  for (const h of hexes) ntaHexes[h.nta]?.push(h);
  for (const h of hexes) deriveYields(h);
  return { hexes, ntas, meta, stations: sub.stations, lines: sub.lines, wonders, species: hx.species, cuisines: hx.cuisines, noise24, ntaGeo, hexIndex, ntaHexes };
}

/** Civ-style yields from real measurements. Units are documented in the About panel. */
export function deriveYields(h: Hex) {
  h.gold = h.assess / 1e6; // $M assessed value
  h.production = (h.factory + h.com) / 1e5 + h.permits * 0.5; // 100k sqft of commercial/industrial floor + new-building sites
  h.foodY = h.food; // restaurants
  h.science = h.college * 5 + (h.sciPct && h.pop ? (h.sciPct / 100) * h.pop * 0.02 : 0);
  h.cultureY = h.culture + h.landmarks * 2 + (h.hist ? 1 : 0);
  h.faith = h.relig;
  h.happy = h.trees * 0.02 + h.park * 0.5 - h.c311 * 0.01;
  h.density = h.pop; // per ~0.105 km2
  h.crime = h.felony;
  h.nature = h.trees + h.park * 20;
}

export const fmt = (n: number | null | undefined, d = 0) =>
  n == null || Number.isNaN(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

export const money = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
};

export function median(xs: number[]) {
  const a = xs.filter((x) => x != null && !Number.isNaN(x)).sort((p, q) => p - q);
  if (!a.length) return 0;
  return a[Math.floor(a.length / 2)];
}

/** Per-capita and density helpers on a neighborhood. */
export function ntaMetric(n: Nta, key: string): number | null {
  const per1k = (v: number) => (n.pop > 500 ? (1000 * v) / n.pop : null);
  switch (key) {
    case "felonyRate": return per1k(n.felony);
    case "c311Rate": return per1k(n.c311);
    case "noiseRate": return per1k(n.noise);
    case "rodentRate": return per1k(n.rodent);
    case "heatRate": return per1k(n.heat);
    case "foodRate": return per1k(n.food);
    case "treesRate": return per1k(n.trees);
    case "evictRate": return per1k(n.evict);
    case "injuredRate": return per1k(n.injured);
    case "density": return n.hexes ? n.pop / (n.hexes * 0.105) : null;
    case "goldPerCap": return n.pop > 500 ? n.assess / n.pop : null;
    case "sciPct": return n.workers > 300 ? (100 * (n.occ.scientists || 0)) / n.workers : null;
    case "parkPct": return n.hexes ? Math.min(100, (100 * n.park) / (n.hexes * 26)) : null;
    default: return n[key] ?? null;
  }
}
