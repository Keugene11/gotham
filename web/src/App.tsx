import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { PathLayer, ColumnLayer, ScatterplotLayer, TextLayer, GeoJsonLayer } from "@deck.gl/layers";
import { FlyToInterpolator, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { Map } from "react-map-gl/maplibre";
import { Icon } from "./Icon";
import { loadWorld, fmt, money, type World, type Hex } from "./data";
import { LENSES, lensById, lerp, makeScale, TERRAIN, cuisineColor, TOP_CUISINES, type RGB } from "./lenses";
import { Inspector, AdvisorCouncil, Explorer, About, WonderList } from "./Panels";

const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json";
const INITIAL: MapViewState = { longitude: -73.955, latitude: 40.715, zoom: 10.6, pitch: 48, bearing: -18 };


export default function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [progress, setProgress] = useState("Surveying the land…");
  const [lensId, setLensId] = useState("terrain");
  const [view, setView] = useState<MapViewState>(INITIAL);
  const [hour, setHour] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [weekend, setWeekend] = useState(false);
  const [selHex, setSelHex] = useState<Hex | null>(null);
  const [selNta, setSelNta] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [panel, setPanel] = useState<null | "advisors" | "explorer" | "about" | "wonders">(null);
  const [show3d, setShow3d] = useState(true);
  const [showSubway, setShowSubway] = useState(true);
  const [showWonders, setShowWonders] = useState(true);
  const [bikes, setBikes] = useState<any[] | null>(null);
  const [showBikes, setShowBikes] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => { loadWorld(setProgress).then(setWorld).catch((e) => setProgress("Failed to load: " + e)); }, []);

  // clock
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setHour((h) => (h + 1) % 24), 650);
    return () => clearInterval(t);
  }, [playing]);

  // live Citi Bike
  useEffect(() => {
    if (!showBikes) return;
    let dead = false;
    const load = () => fetch("/api/citibike").then((r) => r.json()).then((d) => !dead && setBikes(d.stations)).catch(() => setBikes([]));
    load();
    const t = setInterval(load, 60000);
    return () => { dead = true; clearInterval(t); };
  }, [showBikes]);

  const lens = lensById(lensId);
  const effHour = lens.animated || lensId === "transit" ? hour : -1;

  const scale = useMemo(() => {
    if (!world || !lens.value) return null;
    if (lens.animated && hour >= 0) {
      const all: number[] = [];
      for (const h of world.hexes) { const v = world.noise24[h.h3]; if (v) for (const x of v) if (x) all.push(x); }
      return makeScale(all, lens.log);
    }
    return makeScale(world.hexes.map((h) => lens.value!(h, world, -1) as number), lens.log);
  }, [world, lensId, hour >= 0]);

  const colorOf = useCallback((h: Hex): [number, number, number, number] => {
    if (!world) return [0, 0, 0, 0];
    const dim = selNta != null && h.nta !== selNta ? 0.55 : 1;
    let c: RGB;
    if (lens.category) {
      const k = lens.category(h, world);
      if (k == null) c = [44, 46, 54];
      else if (lensId === "terrain") c = TERRAIN[k]?.color ?? TERRAIN[0].color;
      else c = cuisineColor(world.cuisines[k]);
    } else {
      const v = lens.value!(h, world, effHour);
      if (v == null || !scale) c = [40, 42, 50];
      else c = lerp(lens.ramp!, scale.t(v));
    }
    return [c[0] * dim, c[1] * dim, c[2] * dim, 235];
  }, [world, lensId, effHour, scale, selNta]);

  const flyTo = useCallback((lon: number, lat: number, zoom = 13.2) => {
    setView((v) => ({ ...v, longitude: lon, latitude: lat, zoom, pitch: 52, transitionDuration: 1400, transitionInterpolator: new FlyToInterpolator() } as any));
  }, []);

  const selectNta = useCallback((i: number | null, fly = true) => {
    setSelNta(i);
    if (i != null && world && fly) {
      const hs = world.ntaHexes[i];
      const hx = hs[Math.floor(hs.length / 2)] ?? hs[0];
      if (hx) {
        let la = 0, lo = 0;
        for (const h of hs) { const c = h3center(h.h3); la += c[1]; lo += c[0]; }
        flyTo(lo / hs.length, la / hs.length, hs.length > 200 ? 12.3 : 13.2);
      }
    }
  }, [world, flyTo]);

  const layers = useMemo(() => {
    if (!world) return [];
    const L: any[] = [];
    L.push(new H3HexagonLayer<Hex>({
      id: "hexes", data: world.hexes, getHexagon: (d) => d.h3, extruded: show3d, coverage: 0.92,
      getElevation: (d) => (d.floors ? Math.pow(d.floors, 0.85) * 22 : d.lots ? 6 : 2) + (d.park > 10 ? 4 : 0),
      elevationScale: 1, getFillColor: colorOf, pickable: true, autoHighlight: true, highlightColor: [255, 236, 160, 200],
      material: { ambient: 0.55, diffuse: 0.6, shininess: 24, specularColor: [60, 60, 60] },
      updateTriggers: { getFillColor: [lensId, effHour, scale, selNta] },
      transitions: { getFillColor: 350 },
    }));
    if (selNta != null) {
      L.push(new GeoJsonLayer({
        id: "sel", data: { type: "FeatureCollection", features: [world.ntaGeo.features[selNta]] } as any,
        stroked: true, filled: false, getLineColor: [255, 214, 120, 255], lineWidthMinPixels: 3, pickable: false, parameters: { depthTest: false } as any,
      }));
    }
    if (showSubway || lensId === "transit") {
      L.push(new PathLayer({
        id: "lines", data: world.lines, getPath: (d: any) => d.path, getColor: (d: any) => hexRgb(d.color, 210),
        widthMinPixels: 1.5, widthMaxPixels: 4, getWidth: 30, capRounded: true, jointRounded: true, parameters: { depthTest: false } as any,
      }));
      const hr = hour >= 0 ? hour : -1;
      L.push(new ColumnLayer({
        id: "stations", data: world.stations, diskResolution: 12, radius: lensId === "transit" ? 75 : 45, extruded: true, pickable: true,
        getPosition: (d: any) => [d.lon, d.lat],
        getElevation: (d: any) => { const arr = weekend ? d.we : d.wd; const v = hr >= 0 ? arr[hr] * 6 : d.daily / 4; return Math.sqrt(v) * (lensId === "transit" ? 28 : 9); },
        getFillColor: hr >= 0 || lensId === "transit" ? [120, 230, 255, 240] : [200, 220, 240, 150],
        updateTriggers: { getElevation: [hr, weekend, lensId], getFillColor: [hr, lensId] }, transitions: { getElevation: 500 },
      }));
    }
    if (showBikes && bikes) {
      L.push(new ScatterplotLayer({
        id: "bikes", data: bikes, getPosition: (d: any) => [d.lon, d.lat], radiusMinPixels: 2, radiusMaxPixels: 7, getRadius: 40,
        getFillColor: (d: any) => { const t = d.cap ? d.bikes / d.cap : 0; return [255 * (1 - t), 90 + 160 * t, 120, 230]; },
        pickable: true, parameters: { depthTest: false } as any,
      }));
    }
    if (showWonders) {
      L.push(new ScatterplotLayer({
        id: "wonders", data: world.wonders, getPosition: (d: any) => [d.lon, d.lat, 260], getRadius: 120, radiusMinPixels: 5, radiusMaxPixels: 14,
        getFillColor: [255, 210, 110, 255], getLineColor: [40, 26, 6, 255], stroked: true, lineWidthMinPixels: 2, pickable: true,
        parameters: { depthTest: false } as any,
      }));
      if (view.zoom > 12.2) {
        L.push(new TextLayer({
          id: "wonder-labels", data: world.wonders.filter((w) => Math.hypot((w.lon - view.longitude) * 0.76, w.lat - view.latitude) < 0.9 / Math.pow(2, view.zoom - 10)), getPosition: (d: any) => [d.lon, d.lat, 260], getText: (d: any) => d.name,
          getSize: 12, getColor: [255, 236, 190, 255], getPixelOffset: [0, -16], fontFamily: "Inter, sans-serif", fontWeight: 600,
          outlineWidth: 3, outlineColor: [12, 12, 18, 255], fontSettings: { sdf: true }, characterSet: "auto", parameters: { depthTest: false } as any,
        }));
      }
    }
    return L;
  }, [world, colorOf, lensId, effHour, scale, selNta, show3d, showSubway, hour, weekend, showWonders, view.zoom > 12.2, Math.round(view.longitude * 200), Math.round(view.latitude * 200), Math.round(view.zoom * 2), bikes, showBikes]);

  const onHover = (info: PickingInfo) => {
    if (!info.object || !world) return setHover(null);
    const o: any = info.object;
    let text = "";
    if (info.layer?.id === "hexes") {
      const n = world.ntas[o.nta];
      const v = lens.value ? lens.value(o, world, effHour) : null;
      const cat = lens.category?.(o, world);
      const val = lens.category ? (lensId === "terrain" ? TERRAIN[cat ?? 0]?.game : cat != null ? world.cuisines[cat] : "—") : v == null ? "—" : lens.fmt!(v);
      text = `${n?.name ?? ""}\n${lens.name}: ${val}`;
    } else if (info.layer?.id === "stations") {
      const arr = weekend ? o.we : o.wd;
      text = `${o.name}\n${hour >= 0 ? `${fmt(arr[hour])} riders at ${hourLabel(hour)}` : `${fmt(o.daily)} riders / weekday`}`;
    } else if (info.layer?.id === "wonders") {
      text = `★ ${o.name}\n${o.kind} · ${o.stat ?? ""}`;
    } else if (info.layer?.id === "bikes") {
      text = `${o.name}\n${o.bikes} bikes · ${o.ebikes} e-bikes · ${o.docks} docks free`;
    }
    setHover({ x: info.x, y: info.y, text });
  };

  const onClick = (info: PickingInfo) => {
    if (!world) return;
    const o: any = info.object;
    if (!o) { setSelHex(null); setSelNta(null); return; }
    if (info.layer?.id === "hexes") { setSelHex(o); selectNta(o.nta, false); }
    else if (info.layer?.id === "wonders" || info.layer?.id === "stations") {
      flyTo(o.lon, o.lat, 14.5);
      const hx = world.hexIndex.get(h3cell(o.lat, o.lon));
      if (hx) { setSelHex(hx); selectNta(hx.nta, false); }
    }
  };

  const city = world?.meta.city;
  const yields = city ? [
    { icon: "Coins", label: "Gold", v: money(city.assess), tip: "Total assessed value of every tax lot", c: "#e2b246" },
    { icon: "Hammer", label: "Production", v: `${fmt((city.factory + city.com) / 1e6)}M ft²`, tip: "Commercial + industrial floor area", c: "#ec6a2e" },
    { icon: "UtensilsCrossed", label: "Food", v: fmt(city.food), tip: "Restaurants", c: "#f0b43c" },
    { icon: "FlaskConical", label: "Science", v: fmt(city.occ?.scientists), tip: "Residents working in computer, engineering & science", c: "#4fc3a1" },
    { icon: "Drama", label: "Culture", v: fmt(city.culture + city.landmarks), tip: "Cultural institutions + landmarks", c: "#b46ed2" },
    { icon: "Church", label: "Faith", v: fmt(city.relig), tip: "Religious facility lots", c: "#9b8cff" },
    { icon: "Users", label: "Citizens", v: `${(city.a_pop / 1e6).toFixed(2)}M`, tip: "Residents (ACS 2020–24)", c: "#7cc7ff" },
  ] : [];

  const groups = useMemo(() => {
    const g: Record<string, typeof LENSES> = {};
    for (const l of LENSES) (g[l.group] ||= []).push(l);
    return g;
  }, []);

  const matches = useMemo(() => {
    if (!world || query.length < 2) return [];
    const q = query.toLowerCase();
    return world.ntas.map((n, i) => ({ n, i })).filter((r) => r.n.name.toLowerCase().includes(q)).slice(0, 8);
  }, [world, query]);

  if (!world) {
    return (
      <div className="loading">
        <div className="logo big"><span className="hexmark" />GOTHAM</div>
        <div className="sub">{progress}</div>
        <div className="bar"><div /></div>
      </div>
    );
  }

  return (
    <div className="app">
      <DeckGL viewState={view} onViewStateChange={(e: any) => setView(e.viewState)} controller={{ touchRotate: true }} layers={layers}
        onHover={onHover} onClick={onClick} getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}>
        <Map mapStyle={BASEMAP} reuseMaps attributionControl={false} />
      </DeckGL>

      <header className="top">
        <div className="logo" onClick={() => { setSelNta(null); setSelHex(null); setView({ ...INITIAL, transitionDuration: 1200, transitionInterpolator: new FlyToInterpolator() } as any); }}>
          <span className="hexmark" />GOTHAM
        </div>
        <div className="yields">
          {yields.map((y) => (
            <div className="yield" key={y.label} title={y.tip}>
              <Icon name={y.icon} size={14} color={y.c} /><b>{y.v}</b><span>{y.label}</span>
            </div>
          ))}
        </div>
        <div className="search">
          <Icon name="Search" size={14} />
          <input placeholder="Find a neighborhood…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {matches.length > 0 && (
            <div className="results">
              {matches.map(({ n, i }) => (
                <button key={i} onClick={() => { selectNta(i); setSelHex(null); setQuery(""); }}>{n.name}<small>{n.boro}</small></button>
              ))}
            </div>
          )}
        </div>
        <button className="iconbtn" onClick={() => setPanel(panel === "about" ? null : "about")} title="About & sources"><Icon name="CircleHelp" size={18} /></button>
      </header>

      <aside className="lenses">
        <div className="paneltitle">Lenses</div>
        {Object.entries(groups).map(([g, ls]) => (
          <div key={g} className="lensgroup">
            <div className="groupname">{g}</div>
            {ls.map((l) => (
              <button key={l.id} className={"lens" + (l.id === lensId ? " on" : "")} onClick={() => setLensId(l.id)} title={l.desc}>
                <Icon name={l.icon} size={14} />{l.name}
              </button>
            ))}
          </div>
        ))}
        <div className="groupname">Overlays</div>
        <label className="tog"><input type="checkbox" checked={show3d} onChange={(e) => setShow3d(e.target.checked)} /> 3D skyline</label>
        <label className="tog"><input type="checkbox" checked={showSubway} onChange={(e) => setShowSubway(e.target.checked)} /> Subway</label>
        <label className="tog"><input type="checkbox" checked={showWonders} onChange={(e) => setShowWonders(e.target.checked)} /> Wonders</label>
        <label className="tog"><input type="checkbox" checked={showBikes} onChange={(e) => setShowBikes(e.target.checked)} /> Citi Bike <em>live</em></label>
      </aside>

      <Legend world={world} lensId={lensId} scale={scale} hour={effHour} />

      <div className="clock">
        <button className="iconbtn" onClick={() => { if (hour < 0) setHour(new Date().getHours()); setPlaying(!playing); }} title={playing ? "Pause" : "Play the day"}>
          <Icon name={playing ? "Pause" : "Play"} size={16} />
        </button>
        <div className="clockbody">
          <div className="clocklabel">
            <b>{hour < 0 ? "All day" : hourLabel(hour)}</b>
            <span>{hour < 0 ? "press play to run a day" : `${weekend ? "weekend" : "weekday"} · ${fmt(cityRiders(world, hour, weekend))} subway riders this hour`}</span>
          </div>
          <input type="range" min={-1} max={23} value={hour} onChange={(e) => { setHour(+e.target.value); setPlaying(false); }} />
        </div>
        <button className={"chip" + (weekend ? " on" : "")} onClick={() => setWeekend(!weekend)}>{weekend ? "Weekend" : "Weekday"}</button>
      </div>

      <nav className="dock">
        <button onClick={() => setPanel(panel === "advisors" ? null : "advisors")} className={panel === "advisors" ? "on" : ""}><Icon name="Crown" size={16} />Advisors</button>
        <button onClick={() => setPanel(panel === "explorer" ? null : "explorer")} className={panel === "explorer" ? "on" : ""}><Icon name="ChartScatter" size={16} />Explorer</button>
        <button onClick={() => setPanel(panel === "wonders" ? null : "wonders")} className={panel === "wonders" ? "on" : ""}><Icon name="Star" size={16} />Wonders</button>
      </nav>

      {(selHex || selNta != null) && (
        <Inspector world={world} hex={selHex} ntaIdx={selNta} onClose={() => { setSelHex(null); setSelNta(null); }} onLens={setLensId} />
      )}

      {panel === "advisors" && <AdvisorCouncil world={world} ntaIdx={selNta} onPick={(i) => { selectNta(i); setSelHex(null); }} onLens={setLensId} onClose={() => setPanel(null)} />}
      {panel === "explorer" && <Explorer world={world} selected={selNta} onPick={(i) => { selectNta(i); setSelHex(null); }} onClose={() => setPanel(null)} />}
      {panel === "about" && <About world={world} onClose={() => setPanel(null)} />}
      {panel === "wonders" && <WonderList world={world} onPick={(w) => { setPanel(null); flyTo(w.lon, w.lat, 14.2); const hx = world.hexIndex.get(h3cell(w.lat, w.lon)); if (hx) { setSelHex(hx); selectNta(hx.nta, false); } }} onClose={() => setPanel(null)} />}

      {hover && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hover.text.split("\n").map((t, i) => (i === 0 ? <b key={i}>{t}</b> : <div key={i}>{t}</div>))}
        </div>
      )}
    </div>
  );
}

function Legend({ world, lensId, scale, hour }: { world: World; lensId: string; scale: any; hour: number }) {
  const lens = lensById(lensId);
  const [open, setOpen] = useState(true);
  return (
    <div className={"legend" + (open ? "" : " closed")}>
      <div className="legendhead" onClick={() => setOpen(!open)}>
        <Icon name={lens.icon} size={15} /><b>{lens.name}</b>{lens.animated && hour >= 0 && <span className="live">{hourLabel(hour)}</span>}
        <Icon name={open ? "ChevronDown" : "ChevronUp"} size={14} style={{ marginLeft: "auto" }} />
      </div>
      {open && <>
        <p>{lens.desc}</p>
        {lensId === "terrain" ? (
          <div className="cats">{TERRAIN.map((t) => (
            <div key={t.name} title={t.name}><i style={{ background: `rgb(${t.color})` }} />{t.game}<small>{t.name}</small></div>
          ))}</div>
        ) : lensId === "cuisine" ? (
          <div className="cats">{TOP_CUISINES.map((c) => <div key={c}><i style={{ background: `rgb(${cuisineColor(c)})` }} />{c}</div>)}
            <div><i style={{ background: "rgb(96,96,104)" }} />Everything else</div></div>
        ) : scale ? (
          <>
            <div className="ramp" style={{ background: `linear-gradient(90deg, ${lens.ramp!.map((c) => `rgb(${c})`).join(",")})` }} />
            <div className="rampl"><span>{lens.fmt!(scale.lo)}</span><span>{lens.fmt!(scale.mid)}</span><span>{lens.fmt!(scale.hi)}+</span></div>
          </>
        ) : null}
        <div className="src">Source: {lens.source}</div>
      </>}
    </div>
  );
}

export function hourLabel(h: number) {
  if (h < 0) return "All day";
  const ap = h < 12 ? "am" : "pm";
  const x = h % 12 === 0 ? 12 : h % 12;
  return `${x}${ap}`;
}

function cityRiders(w: World, h: number, we: boolean) {
  let s = 0;
  for (const st of w.stations) s += (we ? st.we : st.wd)[h] || 0;
  return s;
}

function hexRgb(h: string, a = 255): [number, number, number, number] {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

import { cellToLatLng, latLngToCell } from "h3-js";
function h3center(c: string): [number, number] { const [la, lo] = cellToLatLng(c); return [lo, la]; }
function h3cell(lat: number, lon: number) { return latLngToCell(lat, lon, 9); }
