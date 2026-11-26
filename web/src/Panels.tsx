import { useMemo, useState } from "react";
import { latLngToCell } from "h3-js";
import type { World, Hex, Nta, Wonder } from "./data";
import { fmt, money, ntaMetric, median } from "./data";
import { TERRAIN } from "./lenses";
import { ADVISORS, advisorLine, advisorRanking } from "./advisors";
import { Icon } from "./Icon";

const CITIZENS: Record<string, { name: string; icon: string }> = {
  merchants: { name: "Managers & financiers", icon: "Briefcase" },
  scientists: { name: "Engineers, coders & scientists", icon: "FlaskConical" },
  scholars: { name: "Teachers, lawyers & artists", icon: "BookOpen" },
  healers: { name: "Doctors & nurses", icon: "Stethoscope" },
  caregivers: { name: "Health aides", icon: "HeartHandshake" },
  guards: { name: "Police & firefighters", icon: "Shield" },
  cooks: { name: "Cooks & servers", icon: "ChefHat" },
  servants: { name: "Cleaners & groundskeepers", icon: "Brush" },
  carers: { name: "Personal care", icon: "Scissors" },
  clerks: { name: "Sales & office", icon: "Store" },
  builders: { name: "Builders & mechanics", icon: "HardHat" },
  haulers: { name: "Drivers & factory hands", icon: "Truck" },
};
const INDUSTRY: Record<string, string> = {
  agri: "Farming & fishing", construction: "Construction", manufacturing: "Manufacturing", wholesale: "Wholesale", retail: "Retail",
  transport: "Transport & utilities", information: "Information & media", finance: "Finance & real estate", professional: "Professional & tech services",
  eduhealth: "Education & health care", arts: "Arts, food & lodging", otherserv: "Other services", publicadmin: "Government",
};

function Close({ onClose }: { onClose: () => void }) {
  return <button className="iconbtn close" onClick={onClose} title="Close"><Icon name="X" size={16} /></button>;
}

export function Inspector({ world, hex, ntaIdx, onClose, onLens }: { world: World; hex: Hex | null; ntaIdx: number | null; onClose: () => void; onLens: (l: string) => void }) {
  const n = ntaIdx != null ? world.ntas[ntaIdx] : null;
  const wondersHere = useMemo(() => (hex ? world.wonders.filter((w) => latLngToCell(w.lat, w.lon, 9) === hex.h3) : []), [hex, world]);
  return (
    <aside className="inspector">
      <Close onClose={onClose} />
      {hex && <TileCard world={world} h={hex} wonders={wondersHere} />}
      {n && ntaIdx != null && <CityCard world={world} n={n} idx={ntaIdx} onLens={onLens} />}
    </aside>
  );
}

function TileCard({ world, h, wonders }: { world: World; h: Hex; wonders: Wonder[] }) {
  const t = TERRAIN[h.lu ?? (h.park > 5 ? 9 : 0)] ?? TERRAIN[0];
  const y = [
    { i: "Coins", c: "#e2b246", v: h.gold >= 1 ? fmt(h.gold) : fmt(h.gold, 1), t: "Gold: $M assessed value" },
    { i: "Hammer", c: "#ec6a2e", v: fmt(h.production, 1), t: "Production: 100k ft² commercial/industrial floor + permits" },
    { i: "UtensilsCrossed", c: "#f0b43c", v: fmt(h.food), t: "Food: restaurants" },
    { i: "FlaskConical", c: "#4fc3a1", v: fmt(h.science, 1), t: "Science: colleges ×5 + resident scientists ×0.02" },
    { i: "Drama", c: "#b46ed2", v: fmt(h.cultureY), t: "Culture: institutions + landmarks ×2 + historic district" },
    { i: "Church", c: "#9b8cff", v: fmt(h.faith), t: "Faith: religious facility lots" },
  ];
  return (
    <section className="card tile">
      <div className="eyebrow">Tile · {h.h3.slice(0, 9)}…</div>
      <h2 style={{ color: `rgb(${t.color})` }}>{t.game}</h2>
      <div className="muted">{t.name}{h.hist ? " · historic district" : ""}</div>
      <div className="yieldrow">{y.map((x) => <span key={x.i} title={x.t}><Icon name={x.i} size={13} color={x.c} />{x.v}</span>)}</div>
      {wonders.length > 0 && <div className="wonderhere">{wonders.map((w) => <div key={w.name}><Icon name="Star" size={13} color="#ffd26e" /> <b>{w.name}</b> <span>{w.kind} · {w.stat}</span></div>)}</div>}
      <div className="grid">
        <Stat k="Tax lots" v={fmt(h.lots)} />
        <Stat k="Height" v={h.floors ? `${fmt(h.floors, 1)} fl (max ${fmt(h.fmax)})` : "—"} />
        <Stat k="Median year built" v={h.year ? String(Math.round(h.year)) : "—"} />
        <Stat k="Homes" v={fmt(h.units)} />
        <Stat k="Residents (est.)" v={fmt(h.pop)} />
        <Stat k="Household income" v={money(h.income)} />
        <Stat k="Street trees" v={`${fmt(h.trees)}${h.topTree != null ? ` · ${world.species[h.topTree]}` : ""}`} />
        <Stat k="Parkland" v={h.park ? `${fmt(h.park, 1)} acres` : "—"} />
        <Stat k="Restaurants" v={`${fmt(h.food)}${h.topCuisine != null && h.food ? ` · mostly ${world.cuisines[h.topCuisine]}` : ""}`} />
        <Stat k="311 calls / yr" v={fmt(h.c311)} />
        <Stat k="Noise complaints" v={fmt(h.noise)} />
        <Stat k="Felonies YTD" v={fmt(h.felony)} />
        <Stat k="Crash injuries" v={fmt(h.injured)} />
        <Stat k="Subway riders/wkday" v={fmt(h.subway)} />
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="stat"><span>{k}</span><b>{v}</b></div>;
}

function CityCard({ world, n, idx, onLens }: { world: World; n: Nta; idx: number; onLens: (l: string) => void }) {
  const city = world.meta.city;
  const cityEmp = Object.values(city.occ as Record<string, number>).reduce((a, b) => a + b, 0);
  const emp = Object.values(n.occ).reduce((a, b) => a + b, 0);
  const citizens = Object.keys(CITIZENS).map((k) => {
    const s = emp ? n.occ[k] / emp : 0, cs = city.occ[k] / cityEmp;
    return { k, s, cs, lq: cs ? s / cs : 0 };
  }).sort((a, b) => b.s - a.s);
  const standout = [...citizens].filter((c) => c.s > 0.02).sort((a, b) => b.lq - a.lq)[0];
  const indTot = Object.values(n.ind).reduce((a, b) => a + b, 0);
  const cityIndTot = Object.values(city.ind as Record<string, number>).reduce((a, b) => a + b, 0);
  const inds = Object.keys(INDUSTRY).map((k) => ({ k, s: indTot ? n.ind[k] / indTot : 0, lq: indTot ? n.ind[k] / indTot / (city.ind[k] / cityIndTot) : 0 }))
    .filter((x) => x.s > 0.03).sort((a, b) => b.lq - a.lq).slice(0, 3);
  const sizeName = n.pop > 100000 ? "Metropolis" : n.pop > 50000 ? "City" : n.pop > 20000 ? "Town" : n.pop > 2000 ? "Village" : n.type === 0 ? "Hamlet" : "Territory";
  return (
    <section className="card city">
      <div className="eyebrow">{n.boro} · {sizeName}</div>
      <h2>{n.name}</h2>
      <div className="citystats">
        <div><b>{fmt(n.pop)}</b><span>citizens</span></div>
        <div><b>{money(n.income)}</b><span>median income</span></div>
        <div><b>{n.rent ? money(n.rent) : "—"}</b><span>median rent</span></div>
        <div><b>{n.bachPct != null ? `${fmt(n.bachPct)}%` : "—"}</b><span>degrees</span></div>
      </div>
      {n.districts.length > 0 && (
        <>
          <h3>Districts</h3>
          <div className="districts">
            {n.districts.map((d) => (
              <div key={d.name} className="district" title={`${d.why}: ${d.score}× the city rate`}>
                <Icon name={distIcon(d.icon)} size={14} /><b>{d.name}</b><span>{d.why}{d.icon !== "soup" ? `, ${d.score}×` : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {emp > 200 && (
        <>
          <h3>Citizens <small>{fmt(emp)} working residents</small></h3>
          {standout && standout.lq > 1.25 && (
            <p className="callout">
              1 in {Math.max(1, Math.round(1 / standout.s))} workers here are <b>{CITIZENS[standout.k].name.toLowerCase()}</b>, against 1 in {Math.round(1 / standout.cs)} citywide.
            </p>
          )}
          <div className="citizens">
            {citizens.slice(0, 8).map((c) => (
              <div key={c.k} className="cit">
                <Icon name={CITIZENS[c.k].icon} size={13} />
                <span className="cn">{CITIZENS[c.k].name}</span>
                <span className="cbar"><i style={{ width: `${Math.min(100, c.s * 300)}%` }} /><em style={{ left: `${Math.min(100, c.cs * 300)}%` }} title="city share" /></span>
                <span className="cv">{fmt(c.s * 100)}%</span>
              </div>
            ))}
          </div>
          {inds.length > 0 && <div className="muted small">Over-represented industries: {inds.map((i) => `${INDUSTRY[i.k]} (${i.lq.toFixed(1)}×)`).join(", ")}</div>}
        </>
      )}
      {n.subwayPct != null && n.workers > 200 && (
        <>
          <h3>How they commute</h3>
          <div className="commute">
            {[["Subway", n.subwayPct, "#5ab9de"], ["Bus", n.busPct, "#3f7fbf"], ["Drive", n.drovePct, "#d65c70"], ["Walk", n.walkPct, "#6ebe60"], ["Bike", n.bikePct, "#f0b43c"], ["Home", n.wfhPct, "#9b8cff"]].map(([k, v, c]) => (
              <i key={k as string} style={{ width: `${v ?? 0}%`, background: c as string }} title={`${k}: ${fmt(v as number)}%`} />
            ))}
          </div>
          <div className="commutel">{[["Subway", n.subwayPct], ["Bus", n.busPct], ["Drive", n.drovePct], ["Walk", n.walkPct], ["Home", n.wfhPct]].map(([k, v]) => <span key={k as string}>{k} {fmt(v as number)}%</span>)}</div>
        </>
      )}
      <h3>Advisors</h3>
      <div className="advice">
        {ADVISORS.map((a) => (
          <div key={a.id} className="adv" onClick={() => onLens(a.lens)} title={`Show the ${a.lens} lens`}>
            <span className="advicon" style={{ background: a.color }}><Icon name={a.icon} size={13} color="#111" /></span>
            <div><b>{a.name}</b><p>{advisorLine(a, world, idx)}</p></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function distIcon(i: string) {
  const m: Record<string, string> = { landmark: "Landmark", "graduation-cap": "GraduationCap", factory: "Factory", "shopping-bag": "ShoppingBag", utensils: "Utensils", drama: "Drama", church: "Church", trees: "Trees", ship: "Ship", hospital: "Hospital", soup: "Soup" };
  return m[i] ?? "Hexagon";
}

export function AdvisorCouncil({ world, ntaIdx, onPick, onLens, onClose }: { world: World; ntaIdx: number | null; onPick: (i: number) => void; onLens: (l: string) => void; onClose: () => void }) {
  const [aid, setAid] = useState(ADVISORS[0].id);
  const a = ADVISORS.find((x) => x.id === aid)!;
  const { rows, med } = useMemo(() => advisorRanking(a, world), [a, world]);
  const top = rows.slice(0, 6), bottom = rows.slice(-6).reverse();
  return (
    <div className="modal council">
      <Close onClose={onClose} />
      <div className="eyebrow">The Council</div>
      <h2>Your advisors report</h2>
      <div className="advtabs">
        {ADVISORS.map((x) => (
          <button key={x.id} className={x.id === aid ? "on" : ""} onClick={() => { setAid(x.id); onLens(x.lens); }}>
            <span className="advicon" style={{ background: x.color }}><Icon name={x.icon} size={13} color="#111" /></span>{x.name}
          </button>
        ))}
      </div>
      <div className="advbody">
        <p className="lede"><b>{a.name}</b>, keeper of {a.title.toLowerCase()}: "{lede(a, rows, med)}"</p>
        {ntaIdx != null && <p className="callout">On {world.ntas[ntaIdx].name}: {advisorLine(a, world, ntaIdx)}</p>}
        <div className="twocol">
          <RankList title={a.higherIsGood ? "Strongest" : "Highest"} rows={top} a={a} onPick={onPick} mx={Math.abs(rows[0]?.v ?? 1)} />
          <RankList title={a.higherIsGood ? "Weakest" : "Lowest"} rows={bottom} a={a} onPick={onPick} mx={Math.abs(rows[0]?.v ?? 1)} />
        </div>
        <div className="muted small">{a.label}. Residential neighborhoods only (parks, airports and cemeteries excluded). City median: {a.unit(med)}.{a.id === "safety" ? " Per-resident rates run high where few people live but many work or visit (Midtown, Tribeca)." : ""}</div>
      </div>
    </div>
  );
}

function lede(a: (typeof ADVISORS)[number], rows: { n: Nta; v: number }[], med: number) {
  const t = rows[0], b = rows[rows.length - 1];
  if (!t) return "";
  const ratio = b && b.v > 0 ? t.v / b.v : 0;
  return `${t.n.name} leads the city at ${a.unit(t.v)}${ratio > 1.5 ? `, ${ratio.toFixed(0)}× ${b.n.name} (${a.unit(b.v)})` : ""}. The typical neighborhood sits at ${a.unit(med)}.`;
}

function RankList({ title, rows, a, onPick, mx }: { title: string; rows: { i: number; n: Nta; v: number }[]; a: (typeof ADVISORS)[number]; onPick: (i: number) => void; mx: number }) {
  return (
    <div className="rank">
      <h3>{title}</h3>
      {rows.map((r) => (
        <button key={r.i} onClick={() => onPick(r.i)}>
          <span className="rn">{r.n.name}<small>{r.n.boro}</small></span>
          <span className="rb"><i style={{ width: `${(100 * Math.abs(r.v)) / mx}%`, background: a.color }} /></span>
          <span className="rv">{a.unit(r.v)}</span>
        </button>
      ))}
    </div>
  );
}

const METRICS: { k: string; label: string; f: (v: number) => string }[] = [
  { k: "pop", label: "Population", f: (v) => fmt(v) },
  { k: "density", label: "Residents per km²", f: (v) => fmt(v) },
  { k: "income", label: "Median household income", f: money },
  { k: "rent", label: "Median rent", f: money },
  { k: "age", label: "Median age", f: (v) => fmt(v, 1) },
  { k: "bachPct", label: "% with a bachelor's+", f: (v) => `${fmt(v)}%` },
  { k: "gradPct", label: "% with a graduate degree", f: (v) => `${fmt(v)}%` },
  { k: "sciPct", label: "% workers in tech & science", f: (v) => `${fmt(v, 1)}%` },
  { k: "foreignPct", label: "% foreign-born", f: (v) => `${fmt(v)}%` },
  { k: "subwayPct", label: "% commute by subway", f: (v) => `${fmt(v)}%` },
  { k: "drovePct", label: "% commute by car", f: (v) => `${fmt(v)}%` },
  { k: "wfhPct", label: "% work from home", f: (v) => `${fmt(v)}%` },
  { k: "felonyRate", label: "Felonies per 1k (YTD)", f: (v) => fmt(v, 1) },
  { k: "c311Rate", label: "311 calls per 1k", f: (v) => fmt(v) },
  { k: "noiseRate", label: "Noise complaints per 1k", f: (v) => fmt(v) },
  { k: "rodentRate", label: "Rat complaints per 1k", f: (v) => fmt(v, 1) },
  { k: "heatRate", label: "No-heat complaints per 1k", f: (v) => fmt(v, 1) },
  { k: "evictRate", label: "Evictions per 1k (since 2017)", f: (v) => fmt(v, 1) },
  { k: "injuredRate", label: "Crash injuries per 1k", f: (v) => fmt(v, 1) },
  { k: "foodRate", label: "Restaurants per 1k", f: (v) => fmt(v, 1) },
  { k: "treesRate", label: "Street trees per 1k", f: (v) => fmt(v) },
  { k: "goldPerCap", label: "Assessed value per resident", f: money },
  { k: "parkPct", label: "% parkland (approx.)", f: (v) => `${fmt(v)}%` },
  { k: "culture", label: "Cultural institutions", f: (v) => fmt(v) },
  { k: "relig", label: "Houses of worship", f: (v) => fmt(v) },
  { k: "permits", label: "New-building permit sites", f: (v) => fmt(v) },
  { k: "units", label: "Homes", f: (v) => fmt(v) },
];
const BORO_COLORS: Record<string, string> = { Manhattan: "#e2b246", Brooklyn: "#5ab9de", Queens: "#d65c70", Bronx: "#6ebe60", "Staten Island": "#b46ed2" };

export function Explorer({ world, selected, onPick, onClose }: { world: World; selected: number | null; onPick: (i: number) => void; onClose: () => void }) {
  const [xk, setX] = useState("bachPct");
  const [yk, setY] = useState("income");
  const [sortK, setSortK] = useState<"x" | "y" | "name">("y");
  const [q, setQ] = useState("");
  const X = METRICS.find((m) => m.k === xk)!, Y = METRICS.find((m) => m.k === yk)!;
  const pts = useMemo(() => world.ntas.map((n, i) => ({ i, n, x: ntaMetric(n, xk), y: ntaMetric(n, yk) }))
    .filter((p) => p.n.type === 0 && p.n.pop > 1000 && p.x != null && p.y != null) as { i: number; n: Nta; x: number; y: number }[], [world, xk, yk]);
  const W = 520, H = 330, P = 44;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v: number) => P + ((v - x0) / (x1 - x0 || 1)) * (W - P - 12);
  const sy = (v: number) => H - P + 10 - ((v - y0) / (y1 - y0 || 1)) * (H - P - 10);
  const r = corr(xs, ys);
  const table = [...pts].filter((p) => p.n.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sortK === "name" ? a.n.name.localeCompare(b.n.name) : sortK === "x" ? b.x - a.x : b.y - a.y));
  return (
    <div className="modal explorer">
      <Close onClose={onClose} />
      <div className="eyebrow">Explorer · {pts.length} neighborhoods</div>
      <h2>Ask the city a question</h2>
      <div className="axes">
        <label>X <select value={xk} onChange={(e) => setX(e.target.value)}>{METRICS.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}</select></label>
        <label>Y <select value={yk} onChange={(e) => setY(e.target.value)}>{METRICS.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}</select></label>
        <span className="corr">r = {r.toFixed(2)}</span>
      </div>
      <div className="exbody">
        <div className="scatterwrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="scatter">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line x1={P} x2={W - 12} y1={sy(y0 + t * (y1 - y0))} y2={sy(y0 + t * (y1 - y0))} className="gridl" />
                <text x={P - 6} y={sy(y0 + t * (y1 - y0)) + 4} textAnchor="end" className="tick">{Y.f(y0 + t * (y1 - y0))}</text>
                <text x={sx(x0 + t * (x1 - x0))} y={H - 14} textAnchor="middle" className="tick">{X.f(x0 + t * (x1 - x0))}</text>
              </g>
            ))}
            {pts.map((p) => (
              <circle key={p.i} cx={sx(p.x)} cy={sy(p.y)} r={p.i === selected ? 7 : 3.6} fill={BORO_COLORS[p.n.boro] ?? "#aaa"}
                fillOpacity={p.i === selected ? 1 : 0.75} stroke={p.i === selected ? "#fff" : "none"} strokeWidth={2} onClick={() => onPick(p.i)} style={{ cursor: "pointer" }}>
                <title>{`${p.n.name}\n${X.label}: ${X.f(p.x)}\n${Y.label}: ${Y.f(p.y)}`}</title>
              </circle>
            ))}
          </svg>
          <div className="borolegend">{Object.entries(BORO_COLORS).map(([b, c]) => <span key={b}><i style={{ background: c }} />{b}</span>)}</div>
        </div>
        <div className="extable">
          <input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="thead"><button onClick={() => setSortK("name")}>Neighborhood</button><button onClick={() => setSortK("x")}>{X.label}</button><button onClick={() => setSortK("y")}>{Y.label}</button></div>
          <div className="tbody">
            {table.map((p) => (
              <button key={p.i} className={p.i === selected ? "on" : ""} onClick={() => onPick(p.i)}>
                <span><i style={{ background: BORO_COLORS[p.n.boro] }} />{p.n.name}</span><span>{X.f(p.x)}</span><span>{Y.f(p.y)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function corr(a: number[], b: number[]) {
  const n = a.length; if (n < 3) return 0;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db || 1);
}

export function WonderList({ world, onPick, onClose }: { world: World; onPick: (w: Wonder) => void; onClose: () => void }) {
  const kinds = [...new Set(world.wonders.map((w) => w.kind))];
  return (
    <div className="modal wonders">
      <Close onClose={onClose} />
      <div className="eyebrow">{world.wonders.length} wonders, each chosen by a published rule</div>
      <h2>Wonders of the city</h2>
      {kinds.map((k) => {
        const ws = world.wonders.filter((w) => w.kind === k);
        return (
          <div key={k} className="wkind">
            <h3>{k}s <small>{ws[0].rule}</small></h3>
            <div className="wgrid">
              {ws.map((w) => (
                <button key={w.name + w.lat} onClick={() => onPick(w)}><Icon name="Star" size={13} color="#ffd26e" /><b>{w.name}</b><span>{w.stat}</span></button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function About({ world, onClose }: { world: World; onClose: () => void }) {
  const c = world.meta.counts;
  const SOURCES: [string, string, string][] = [
    ["MapPLUTO (Dept. of City Planning)", `${fmt(c.lots)} tax lots`, "land use, floors, year built, floor area by use, assessed value, building class"],
    ["311 Service Requests", `${fmt(c.r311)} requests, Nov 2025 – Oct 2026`, "grievances, noise by hour, rats, heat, parking, sanitation"],
    ["NYPD Complaint Data (YTD)", `${fmt(c.crime)} complaints`, "felonies, misdemeanors, violations, hour of day"],
    ["NYPD Motor Vehicle Collisions", `${fmt(c.crashes)} crashes, last 12 months`, "injuries and deaths"],
    ["MTA Subway Hourly Ridership", `${fmt(c.stations)} station complexes, week of Oct 5 2026`, "riders per hour, weekday and weekend"],
    ["MTA GTFS", "29 routes", "subway line geometry and colors"],
    ["American Community Survey 2020–24", `${fmt(c.tracts)} census tracts (via Census Reporter)`, "population, income, rent, degrees, commute, birthplace, occupations, industries"],
    ["2015 Street Tree Census (Parks)", `${fmt(c.trees)} trees`, "species and health"],
    ["NYC Parks Properties", `${fmt(c.parks)} parks`, "parkland area per tile, Great Parks"],
    ["DOHMH Restaurant Inspections", `${fmt(c.food)} restaurants`, "food yield, cuisine quarters, grades"],
    ["DCLA Cultural Institutions", `${fmt(c.culture)} institutions`, "culture yield, Theater Squares"],
    ["LPC Individual Landmarks", `${fmt(c.landmarks)} designated sites`, "culture yield, Landmark wonders"],
    ["DOI Marshal Evictions", `${fmt(c.evictions)} evictions since 2017`, "Exile lens"],
    ["DOB Job Filings", "new-building permit sites", "production yield"],
    ["NYC Public Wi-Fi", `${fmt(c.wifi)} hotspots`, "tile stats"],
    ["2020 NTAs + borough boundaries", "262 neighborhoods", "the playable 'cities'"],
    ["Citi Bike GBFS (live)", "~2,200 docks", "live bikes overlay, refreshed each minute"],
  ];
  return (
    <div className="modal about">
      <Close onClose={onClose} />
      <div className="eyebrow">About</div>
      <h2>New York City as a strategy game</h2>
      <p>
        Every land tile is a real ~0.1 km² hexagon (H3 resolution 9). There are {fmt(world.meta.hexes)} of them, each carrying numbers reconciled
        from the public datasets below. The numbers are then spoken in strategy-game language. <b>Gold</b> is assessed property value.
        <b> Production</b> is commercial and industrial floor area plus new construction. <b>Food</b> is restaurants, <b>Faith</b> is houses of worship,
        and <b>Culture</b> is cultural institutions and landmarks. Each of the 262 neighborhoods is a city. Its <b>districts</b> are its real
        specializations (location quotients against the city). Its <b>citizens</b> are its real workforce by occupation, and its
        <b> wonders</b> are picked by fixed rules (tallest, largest, busiest, oldest, most valuable, first designated).
      </p>
      <p className="muted small">
        Caveats: residents are spread from Census tracts onto lots in proportion to housing units, so tile-level population is an estimate.
        Neighborhood figures come straight from tracts. Crime and 311 locations are as reported by the city. Some records lack coordinates
        and are dropped. Median incomes for neighborhoods are population-weighted averages of tract medians.
      </p>
      <h3>Sources</h3>
      <div className="sources">{SOURCES.map(([a, b, d]) => <div key={a}><b>{a}</b><span>{b}</span><small>{d}</small></div>)}</div>
      <p className="muted small">
        Inspired by Andrej Karpathy's <a href="https://karpathy.ai/usaciv/" target="_blank">usaciv</a>. Built end-to-end with Claude Code: data pipeline in Python
        (pandas, h3, shapely), map in deck.gl + MapLibre. Data built {world.meta.built}. Source: <a href="https://github.com/Keugene11/gotham" target="_blank">github.com/Keugene11/gotham</a>.
      </p>
    </div>
  );
}

export { median };
