import type { Nta, World } from "./data";
import { fmt, money, median, ntaMetric } from "./data";

export type Advisor = {
  id: string; name: string; title: string; icon: string; color: string;
  metric: string; label: string; unit: (v: number) => string; higherIsGood: boolean; lens: string;
  line: (n: Nta, v: number | null, rank: number, total: number, cityMed: number, w: World) => string;
};

const ord = (k: number) => {
  const s = ["th", "st", "nd", "rd"], v = k % 100;
  return k + (s[(v - 20) % 10] || s[v] || s[0]);
};
const x = (v: number, m: number) => (m > 0 ? v / m : 0);
const times = (v: number, m: number) => {
  const r = x(v, m);
  return r >= 1 ? `${r.toFixed(1)}× the city median` : `${Math.round(r * 100)}% of the city median`;
};

export const ADVISORS: Advisor[] = [
  { id: "treasury", name: "Treasurer", title: "Gold & land value", icon: "Coins", color: "#e2b246", metric: "income", label: "Median household income", unit: money, higherIsGood: true, lens: "income",
    line: (n, v, r, t, m) => v == null ? `No reliable income figure for ${n.name}; few households live here.` :
      `Households here earn a median ${money(v)}, ${times(v, m)}. That's ${ord(r)} of ${t} neighborhoods. Lots on its tiles are assessed at ${money(n.assess)} in total.` },
  { id: "builder", name: "Master Builder", title: "Production & construction", icon: "Hammer", color: "#ec6a2e", metric: "permits", label: "New-building permit sites", unit: (v) => fmt(v), higherIsGood: true, lens: "production",
    line: (n, v, r, t) => `${fmt(v)} new-building permit sites (${ord(r)} of ${t}). ${fmt(n.factory / 1000)}k sq ft of factory floor and ${fmt(n.office / 1e6, 1)}M sq ft of office space stand here.` },
  { id: "transit", name: "Transit Marshal", title: "Movement", icon: "TrainFront", color: "#5ab9de", metric: "subwayPct", label: "Commute by subway", unit: (v) => `${fmt(v)}%`, higherIsGood: true, lens: "transit",
    line: (n, v, r, t) => v == null ? `Too few commuters to read.` : `${fmt(v)}% of workers ride the subway to work (${ord(r)} of ${t}), ${fmt(n.drovePct)}% drive and ${fmt(n.wfhPct)}% stay home. Stations here carry ${fmt(n.subway)} riders a weekday.` },
  { id: "housing", name: "Steward of Homes", title: "Housing & rent", icon: "Key", color: "#d65c70", metric: "rent", label: "Median gross rent", unit: money, higherIsGood: false, lens: "rent",
    line: (n, v, r, t, m) => v == null ? `Rent data is too thin here.` : `Median rent is ${money(v)}/mo, ${times(v, m)} (${ord(r)} most expensive of ${t}). ${fmt(n.units)} homes; ${fmt(n.evict)} evictions executed since 2017.` },
  { id: "safety", name: "Captain of the Watch", title: "Order", icon: "ShieldAlert", color: "#c8443a", metric: "felonyRate", label: "Felonies per 1,000 residents (YTD)", unit: (v) => fmt(v, 1), higherIsGood: false, lens: "order",
    line: (n, v, r, t, m) => v == null ? `Hardly anyone lives here, so per-capita crime isn't meaningful (${fmt(n.felony)} felonies reported).` : `${fmt(v, 1)} felonies per 1,000 residents this year, ${times(v, m)}. ${r <= 20 ? "Among the most troubled quarters." : r > t - 40 ? "One of the quietest quarters in the city." : "A middling record."}` },
  { id: "health", name: "Physician", title: "Health & environment", icon: "HeartPulse", color: "#6ebe60", metric: "treesRate", label: "Street trees per 1,000 residents", unit: (v) => fmt(v), higherIsGood: true, lens: "nature",
    line: (n, v, r, t) => `${fmt(n.trees)} street trees (${v == null ? "—" : fmt(v)} per 1,000 people, ${ord(r)} of ${t}) and ${fmt(n.park)} acres of parkland. ${fmt(n.rodent)} rat complaints and ${fmt(n.injured)} people hurt in crashes this year.` },
  { id: "culture", name: "Curator", title: "Culture & faith", icon: "Drama", color: "#b46ed2", metric: "culture", label: "Cultural institutions", unit: (v) => fmt(v), higherIsGood: true, lens: "culture",
    line: (n, v, r, t) => `${fmt(v)} city-funded cultural institutions (${ord(r)} of ${t}), ${fmt(n.landmarks)} designated landmarks and ${fmt(n.relig)} houses of worship.` },
  { id: "chef", name: "Royal Chef", title: "Food", icon: "UtensilsCrossed", color: "#f0b43c", metric: "foodRate", label: "Restaurants per 1,000 residents", unit: (v) => fmt(v, 1), higherIsGood: true, lens: "food",
    line: (n, v) => {
      const top = Object.entries(n.topCuisines ?? {}).filter(([k]) => !["Other", "American", "Coffee/Tea"].includes(k)).slice(0, 3).map(([k, c]) => `${k} (${c})`).join(", ");
      return `${fmt(n.food)} restaurants${v != null ? `, ${fmt(v, 1)} per 1,000 residents` : ""}. Signature kitchens: ${top || "none stand out"}.`;
    } },
  { id: "sage", name: "Sage", title: "Science & learning", icon: "FlaskConical", color: "#4fc3a1", metric: "sciPct", label: "Workers in computer, engineering & science", unit: (v) => `${fmt(v, 1)}%`, higherIsGood: true, lens: "science",
    line: (n, v, r, t, m) => v == null ? `Too few workers to read.` : `${fmt(v, 1)}% of working residents are in computer, engineering or science jobs, about 1 in ${Math.max(1, Math.round(100 / Math.max(v, 0.1)))} (city median 1 in ${Math.round(100 / Math.max(m, 0.1))}). ${fmt(n.bachPct)}% of adults hold a degree. Rank ${ord(r)} of ${t}.` },
];

export function advisorRanking(a: Advisor, w: World) {
  const rows = w.ntas
    .map((n, i) => ({ i, n, v: ntaMetric(n, a.metric) }))
    .filter((r) => r.v != null && r.n.type === 0) as { i: number; n: Nta; v: number }[];
  rows.sort((p, q) => q.v - p.v);
  const med = median(rows.map((r) => r.v));
  return { rows, med };
}

export function advisorLine(a: Advisor, w: World, ntaIdx: number) {
  const { rows, med } = advisorRanking(a, w);
  const n = w.ntas[ntaIdx];
  const v = ntaMetric(n, a.metric);
  const rank = rows.findIndex((r) => r.i === ntaIdx) + 1;
  return a.line(n, v, rank || rows.length, rows.length, med, w);
}
