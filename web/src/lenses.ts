import type { Hex, World } from "./data";
import { fmt, money } from "./data";

export type RGB = [number, number, number];
export type Lens = {
  id: string; name: string; group: string; icon: string; desc: string; source: string;
  value?: (h: Hex, w: World, hour: number) => number | null;
  category?: (h: Hex, w: World) => number | null;
  ramp?: RGB[]; fmt?: (v: number) => string; animated?: boolean; log?: boolean;
};

// Ramps: perceptually ordered, readable on a dark map.
const GOLD: RGB[] = [[38, 34, 28], [92, 70, 30], [170, 124, 40], [226, 178, 70], [255, 232, 150]];
const EMBER: RGB[] = [[30, 24, 40], [92, 30, 60], [170, 45, 55], [236, 104, 46], [255, 214, 120]];
const MINT: RGB[] = [[20, 34, 34], [24, 78, 64], [40, 134, 86], [110, 190, 96], [220, 240, 150]];
const ICE: RGB[] = [[22, 28, 48], [36, 64, 120], [50, 120, 190], [90, 186, 222], [210, 244, 250]];
const VIOLET: RGB[] = [[28, 24, 44], [70, 44, 112], [126, 66, 168], [196, 110, 200], [250, 200, 236]];
const ROSE: RGB[] = [[30, 26, 34], [86, 40, 60], [150, 52, 80], [214, 92, 112], [252, 190, 180]];

// Terrain = dominant land use by lot area (PLUTO LandUse codes 1–11)
export const TERRAIN: { name: string; color: RGB; game: string }[] = [
  { name: "No tax lots (marsh, beach, highway)", color: [52, 72, 76], game: "Wilds & Marsh" },
  { name: "One & two family homes", color: [126, 150, 84], game: "Townhouse Plains" },
  { name: "Walk-up apartments", color: [176, 146, 92], game: "Walk-up Hills" },
  { name: "Elevator apartments", color: [206, 120, 84], game: "Tower Highlands" },
  { name: "Mixed residential & commercial", color: [214, 168, 82], game: "Market Lanes" },
  { name: "Commercial & office", color: [236, 210, 120], game: "Commerce Core" },
  { name: "Industrial & manufacturing", color: [138, 120, 160], game: "Ironworks" },
  { name: "Transportation & utility", color: [104, 112, 132], game: "Railyards & Docks" },
  { name: "Public facilities & institutions", color: [110, 156, 190], game: "Civic Grounds" },
  { name: "Open space & recreation", color: [52, 128, 74], game: "Parkland Forest" },
  { name: "Parking", color: [92, 92, 96], game: "Asphalt Flats" },
  { name: "Vacant land", color: [120, 98, 76], game: "Wasteland" },
];

const CUISINE_COLORS: RGB[] = [
  [232, 90, 70], [240, 180, 60], [90, 170, 110], [80, 150, 220], [180, 110, 210], [230, 130, 180],
  [120, 200, 200], [200, 200, 110], [160, 120, 80], [250, 120, 40], [110, 120, 230], [190, 60, 110],
];
export const TOP_CUISINES = ["Chinese", "Italian", "Mexican", "Latin American", "Caribbean", "Japanese", "Jewish/Kosher",
  "Indian", "Korean", "Spanish", "Thai", "Middle Eastern"];

export function cuisineColor(name: string | undefined): RGB {
  const i = name ? TOP_CUISINES.indexOf(name) : -1;
  return i >= 0 ? CUISINE_COLORS[i] : [96, 96, 104];
}

const usd = (v: number) => money(v);
const n0 = (v: number) => fmt(v);
const pct = (v: number) => `${fmt(v)}%`;

export const LENSES: Lens[] = [
  { id: "terrain", name: "Terrain", group: "Land", icon: "Mountain", desc: "Dominant land use by lot area, translated to terrain.", source: "DCP MapPLUTO", category: (h) => h.lu ?? (h.park > 5 ? 9 : 0) },
  { id: "height", name: "Skyline", group: "Land", icon: "Building2", desc: "Floor-area-weighted building height (floors).", source: "DCP MapPLUTO", value: (h) => h.floors, ramp: ICE, fmt: (v) => `${fmt(v, 1)} fl` },
  { id: "age", name: "Antiquity", group: "Land", icon: "Hourglass", desc: "Median year built of the tile's lots. Brighter = older.", source: "DCP MapPLUTO", value: (h) => (h.year ? 2030 - h.year : null), ramp: GOLD, fmt: (v) => `built ${Math.round(2030 - v)}` },
  { id: "gold", name: "Gold", group: "Yields", icon: "Coins", desc: "Total assessed value of all lots on the tile (city's own valuation).", source: "DOF via MapPLUTO", value: (h) => h.assess, ramp: GOLD, fmt: usd, log: true },
  { id: "production", name: "Production", group: "Yields", icon: "Hammer", desc: "Commercial + industrial floor area, plus new-building permit sites.", source: "MapPLUTO, DOB", value: (h) => h.production, ramp: EMBER, fmt: (v) => fmt(v, 1), log: true },
  { id: "food", name: "Food", group: "Yields", icon: "UtensilsCrossed", desc: "Restaurants inspected by the Health Department.", source: "DOHMH inspections", value: (h) => h.food || null, ramp: EMBER, fmt: n0, log: true },
  { id: "cuisine", name: "Cuisine", group: "Yields", icon: "Soup", desc: "The most common cuisine among each tile's restaurants.", source: "DOHMH inspections", category: (h) => (h.food >= 2 && h.topCuisine != null ? h.topCuisine : null) },
  { id: "faith", name: "Faith", group: "Yields", icon: "Church", desc: "Religious facility lots (building class M).", source: "MapPLUTO", value: (h) => h.relig || null, ramp: VIOLET, fmt: n0 },
  { id: "culture", name: "Culture", group: "Yields", icon: "Drama", desc: "City-funded cultural institutions + designated landmarks.", source: "DCLA, LPC", value: (h) => h.cultureY || null, ramp: VIOLET, fmt: n0, log: true },
  { id: "pop", name: "Population", group: "People", icon: "Users", desc: "Residents, distributed from Census tracts onto lots by housing units.", source: "ACS 2020–24 + PLUTO", value: (h) => h.pop || null, ramp: ICE, fmt: n0 },
  { id: "income", name: "Wealth", group: "People", icon: "Wallet", desc: "Median household income of the tracts living on the tile.", source: "ACS 2020–24 (B19013)", value: (h) => h.income, ramp: GOLD, fmt: usd },
  { id: "rent", name: "Rent", group: "People", icon: "Key", desc: "Median gross rent.", source: "ACS 2020–24 (B25064)", value: (h) => h.rent, ramp: ROSE, fmt: usd },
  { id: "degrees", name: "Learning", group: "People", icon: "GraduationCap", desc: "Share of adults 25+ with a bachelor's degree or higher.", source: "ACS 2020–24 (B15003)", value: (h) => h.bachPct, ramp: ICE, fmt: pct },
  { id: "science", name: "Science", group: "People", icon: "FlaskConical", desc: "Share of workers in computer, engineering & science jobs.", source: "ACS 2020–24 (C24010)", value: (h) => h.sciPct, ramp: MINT, fmt: (v) => `${fmt(v, 1)}%` },
  { id: "immig", name: "Diaspora", group: "People", icon: "Globe2", desc: "Share of residents born outside the US.", source: "ACS 2020–24 (B05002)", value: (h) => h.foreignPct, ramp: VIOLET, fmt: pct },
  { id: "transit", name: "Transit", group: "Movement", icon: "TrainFront", desc: "Share of commuters who ride transit. Columns are subway stations at the clock hour.", source: "ACS (B08301), MTA hourly ridership", value: (h) => h.transitPct, ramp: ICE, fmt: pct },
  { id: "peril", name: "Peril", group: "Movement", icon: "Siren", desc: "People injured in motor-vehicle crashes, last 12 months.", source: "NYPD collisions", value: (h) => h.injured || null, ramp: EMBER, fmt: n0 },
  { id: "nature", name: "Nature", group: "Environment", icon: "Trees", desc: "Street trees + parkland.", source: "2015 Tree Census, NYC Parks", value: (h) => h.nature || null, ramp: MINT, fmt: n0, log: true },
  { id: "order", name: "Unrest", group: "Order", icon: "ShieldAlert", desc: "Felony complaints, year to date.", source: "NYPD complaints", value: (h) => h.felony || null, ramp: EMBER, fmt: n0, log: true },
  { id: "grievance", name: "Grievances", group: "Order", icon: "Megaphone", desc: "All 311 service requests, last 12 months.", source: "311", value: (h) => h.c311 || null, ramp: ROSE, fmt: n0, log: true },
  { id: "noise", name: "Noise", group: "Order", icon: "Volume2", desc: "Noise complaints. Animates by hour of day with the clock.", source: "311", animated: true,
    value: (h, w, hour) => (hour >= 0 ? w.noise24[h.h3]?.[hour] ?? null : h.noise || null), ramp: VIOLET, fmt: n0, log: true },
  { id: "rats", name: "Rats", group: "Order", icon: "Rat", desc: "Rodent complaints to 311.", source: "311", value: (h) => h.rodent || null, ramp: ROSE, fmt: n0 },
  { id: "heat", name: "Winter", group: "Order", icon: "Thermometer", desc: "No heat / hot water complaints.", source: "311", value: (h) => h.heat || null, ramp: ICE, fmt: n0, log: true },
  { id: "evict", name: "Exile", group: "Order", icon: "DoorOpen", desc: "Residential evictions executed by city marshals since 2017.", source: "DOI marshals", value: (h) => h.evict || null, ramp: ROSE, fmt: n0 },
];

export function lensById(id: string) {
  return LENSES.find((l) => l.id === id) ?? LENSES[0];
}

export function lerp(ramp: RGB[], t: number): RGB {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const f = x - i;
  const a = ramp[i], b = ramp[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Quantile scale built from current values so every lens uses its full color range. */
export function makeScale(values: number[], log = false) {
  const vs = values.filter((v) => v != null && Number.isFinite(v) && (!log || v > 0)).sort((a, b) => a - b);
  const q = (p: number) => vs[Math.min(vs.length - 1, Math.floor(p * (vs.length - 1)))] ?? 0;
  const lo = q(0.02), hi = q(0.98);
  const tf = (v: number) => (log ? Math.log1p(Math.max(0, v)) : v);
  const a = tf(lo), b = tf(hi);
  return {
    t: (v: number) => (b === a ? 0.5 : (tf(v) - a) / (b - a)),
    lo, hi, mid: q(0.5),
  };
}
