# -*- coding: utf-8 -*-
"""Reconcile every raw dataset onto one H3 res-9 hex grid (~0.1 km2 cells) plus
neighborhood (NTA) rollups. Writes compact JSON into web/public/data/."""
import os, json, glob, math, collections, time
import numpy as np, pandas as pd, h3
from shapely.geometry import shape, Point, Polygon
from shapely.strtree import STRtree

T0 = time.time()
ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "web", "public", "data")
os.makedirs(OUT, exist_ok=True)
RES = 9
BOX = (40.47, 40.93, -74.27, -73.68)
M2_PER_DEG2 = 111320 * 111320 * math.cos(math.radians(40.7))


def log(*a):
    print(f"[{time.time()-T0:6.1f}s]", *a, flush=True)


def inbox(df, lat="latitude", lon="longitude"):
    df[lat] = pd.to_numeric(df[lat], errors="coerce")
    df[lon] = pd.to_numeric(df[lon], errors="coerce")
    return df[(df[lat] > BOX[0]) & (df[lat] < BOX[1]) & (df[lon] > BOX[2]) & (df[lon] < BOX[3])].copy()


def cells(df, lat="latitude", lon="longitude"):
    return [h3.latlng_to_cell(a, b, RES) for a, b in zip(df[lat].values, df[lon].values)]


# ---------------- geography -----------------
nta_fc = json.load(open(os.path.join(RAW, "nta.geojson")))["features"]
ntas = []
for f in nta_fc:
    p = f["properties"]
    ntas.append(dict(code=p["nta2020"], name=p["ntaname"], boro=p["boroname"], type=int(p["ntatype"]),
                     geom=shape(f["geometry"])))
nta_tree = STRtree([n["geom"] for n in ntas])
boro_geoms = [shape(f["geometry"]) for f in json.load(open(os.path.join(RAW, "boro.geojson")))["features"]]
boro_tree = STRtree(boro_geoms)
log("geo loaded", len(ntas))

H = collections.defaultdict(lambda: collections.defaultdict(float))  # hex -> field -> value

# ---------------- PLUTO -----------------
pl = pd.read_csv(os.path.join(RAW, "pluto.csv"), dtype={"bct2020": str, "bldgclass": str, "landmark": str,
                                                        "histdist": str, "address": str, "zonedist1": str})
pl = inbox(pl)
for c in ["landuse", "numfloors", "unitsres", "assesstot", "yearbuilt", "bldgarea", "comarea", "officearea",
          "retailarea", "factryarea", "resarea", "lotarea"]:
    pl[c] = pd.to_numeric(pl[c], errors="coerce").fillna(0)
pl["h"] = cells(pl)
log("pluto", len(pl))
g = pl.groupby("h")
agg = g.agg(lots=("h", "size"), units=("unitsres", "sum"), bldg=("bldgarea", "sum"), res=("resarea", "sum"),
            com=("comarea", "sum"), office=("officearea", "sum"), retail=("retailarea", "sum"),
            factory=("factryarea", "sum"), assess=("assesstot", "sum"), lotarea=("lotarea", "sum"),
            fmax=("numfloors", "max"))
pl["fl_w"] = pl["numfloors"] * pl["bldgarea"]
fw = g["fl_w"].sum() / g["bldgarea"].sum().replace(0, np.nan)
yb = pl[pl.yearbuilt > 1700].groupby("h")["yearbuilt"].median()
lu = pl[pl.landuse > 0].groupby(["h", "landuse"])["lotarea"].sum().reset_index()
lu = lu.sort_values("lotarea").groupby("h").tail(1).set_index("h")["landuse"]
pl["relig"] = pl.bldgclass.fillna("").str.startswith("M")
pl["college"] = pl.bldgclass.fillna("").isin(["W5", "W6"])
pl["hosp"] = pl.bldgclass.fillna("").str.startswith("I1") | pl.bldgclass.fillna("").str.startswith("I5")
pl["school"] = pl.bldgclass.fillna("").isin(["W1", "W2", "W3", "W4", "W8"])
pl["hist"] = pl.histdist.notna()
pl["vacant"] = pl.landuse == 11
flags = g[["relig", "college", "hosp", "school", "hist", "vacant"]].sum()
for h, r in agg.iterrows():
    d = H[h]
    for k, v in r.items():
        d[k] = float(v)
for h, v in fw.dropna().items(): H[h]["floors"] = float(v)
for h, v in yb.items(): H[h]["year"] = float(v)
for h, v in lu.items(): H[h]["lu"] = int(v)
for h, r in flags.iterrows():
    for k, v in r.items():
        if v: H[h][k] = float(v)
log("pluto aggregated", len(H))

# ---------------- hex universe + NTA -----------------
# land = any lot, or hex center inside a borough polygon
cand = set(H.keys())
minlat, maxlat, minlon, maxlon = BOX
poly = h3.LatLngPoly([(minlat, minlon), (minlat, maxlon), (maxlat, maxlon), (maxlat, minlon)])
for c in h3.polygon_to_cells(poly, RES):
    lat, lon = h3.cell_to_latlng(c)
    pt = Point(lon, lat)
    for i in boro_tree.query(pt):
        if boro_geoms[i].contains(pt):
            cand.add(c); break
hexes = sorted(cand)
hex_nta = {}
for c in hexes:
    lat, lon = h3.cell_to_latlng(c)
    pt = Point(lon, lat)
    idx = None
    for i in nta_tree.query(pt):
        if ntas[i]["geom"].contains(pt):
            idx = int(i); break
    if idx is None:
        idx = int(nta_tree.nearest(pt))
    hex_nta[c] = idx
log("hexes", len(hexes))
HEXSET = set(hexes)

# ---------------- parks (area intersection) -----------------
hex_polys = [Polygon([(b, a) for a, b in h3.cell_to_boundary(c)]) for c in hexes]
hex_tree = STRtree(hex_polys)
parks = []
for f in json.load(open(os.path.join(RAW, "parks.geojson")))["features"]:
    p = f["properties"]
    try:
        geo = shape(f["geometry"]).buffer(0)
    except Exception:
        continue
    acres = float(p.get("acres") or 0)
    name = p.get("signname") or p.get("name311") or "Park"
    for i in hex_tree.query(geo):
        inter = hex_polys[i].intersection(geo).area * M2_PER_DEG2 / 4046.86
        if inter > 0.01:
            H[hexes[i]]["park"] += inter
    if acres > 0:
        c = geo.representative_point()
        parks.append(dict(name=name, acres=acres, lat=c.y, lon=c.x, cat=p.get("typecategory")))
log("parks", len(parks))


def add_points(df, field, weight=None):
    df = inbox(df)
    hs = cells(df)
    if weight is None:
        cnt = collections.Counter(hs)
        for h, n in cnt.items(): H[h][field] += n
    else:
        for h, w in zip(hs, df[weight].values): H[h][field] += float(w)
    return df, hs


# ---------------- trees -----------------
tr = pd.read_csv(os.path.join(RAW, "trees.csv"))
tr, ths = add_points(tr, "trees")
tr["h"] = ths
good = tr[tr.health == "Good"].groupby("h").size()
for h, v in good.items(): H[h]["treeGood"] = float(v)
top_tree = tr.groupby(["h", "spc_common"]).size().reset_index(name="n").sort_values("n").groupby("h").tail(1)
species = sorted(tr.spc_common.dropna().unique())
sp_idx = {s: i for i, s in enumerate(species)}
for h, s in zip(top_tree.h, top_tree.spc_common):
    if isinstance(s, str): H[h]["topTree"] = sp_idx[s]
city_species = tr.spc_common.value_counts().head(10).to_dict()
log("trees", len(tr))

# ---------------- restaurants -----------------
fd = pd.read_csv(os.path.join(RAW, "food.csv"))
fd = fd.drop_duplicates("camis")
fd, fhs = add_points(fd, "food")
fd["h"] = fhs
fd["cuisine_description"] = fd.cuisine_description.fillna("Other")
cuisines = sorted(fd.cuisine_description.unique())
cu_idx = {s: i for i, s in enumerate(cuisines)}
tc = fd.groupby(["h", "cuisine_description"]).size().reset_index(name="n").sort_values("n").groupby("h").tail(1)
for h, s in zip(tc.h, tc.cuisine_description): H[h]["topCuisine"] = cu_idx[s]
ga = fd[fd.grade == "A"].groupby("h").size()
for h, v in ga.items(): H[h]["gradeA"] = float(v)
log("food", len(fd))

# ---------------- misc point layers -----------------
cul = pd.read_csv(os.path.join(RAW, "culture.csv"))
cul, _ = add_points(cul, "culture")
wifi = pd.read_csv(os.path.join(RAW, "wifi.csv"))
add_points(wifi, "wifi")
ev = pd.read_csv(os.path.join(RAW, "evictions.csv"))
add_points(ev, "evict")
cr = pd.read_csv(os.path.join(RAW, "crashes.csv"))
cr["number_of_persons_injured"] = pd.to_numeric(cr.number_of_persons_injured, errors="coerce").fillna(0)
cr["number_of_persons_killed"] = pd.to_numeric(cr.number_of_persons_killed, errors="coerce").fillna(0)
add_points(cr, "crashes")
add_points(cr, "injured", "number_of_persons_injured")
add_points(cr, "killed", "number_of_persons_killed")
if os.path.exists(os.path.join(RAW, "permits.csv")):
    pm = pd.read_csv(os.path.join(RAW, "permits.csv"))
    add_points(pm, "permits")
log("misc points")

# ---------------- crime -----------------
cm = pd.read_csv(os.path.join(RAW, "crime.csv"))
cm = inbox(cm)
cm["h"] = cells(cm)
for cat, field in [("FELONY", "felony"), ("MISDEMEANOR", "misd"), ("VIOLATION", "violation")]:
    for h, n in cm[cm.law_cat_cd == cat].groupby("h").size().items(): H[h][field] += n
cm["hh"] = pd.to_numeric(cm.cmplnt_fr_tm.str[:2], errors="coerce")
crime_hourly = cm.groupby("hh").size().reindex(range(24), fill_value=0).astype(int).tolist()
top_offenses = cm.ofns_desc.value_counts().head(12).to_dict()
log("crime", len(cm))

# ---------------- 311 -----------------
CAT = {
    "noise": lambda s: s.str.startswith("Noise"),
    "heat": lambda s: s.isin(["HEAT/HOT WATER"]),
    "rodent": lambda s: s.isin(["Rodent"]),
    "parking": lambda s: s.isin(["Illegal Parking", "Blocked Driveway"]),
    "street": lambda s: s.str.contains("Street Condition|Sidewalk Condition|Street Light|Traffic Signal", regex=True),
    "dirty": lambda s: s.str.contains("Dirty|Sanitation|Litter|Missed Collection|Illegal Dumping", regex=True),
    "homeless": lambda s: s.str.contains("Homeless|Encampment", regex=True),
    "plumbing": lambda s: s.isin(["PLUMBING", "WATER LEAK", "PAINT/PLASTER", "UNSANITARY CONDITION", "DOOR/WINDOW", "GENERAL", "ELECTRIC", "FLOORING/STAIRS", "APPLIANCE", "SAFETY"]),
}
parts = []
for f in sorted(glob.glob(os.path.join(RAW, "311d", "*.csv"))):
    try:
        parts.append(pd.read_csv(f))
    except Exception:
        pass
s3 = pd.concat(parts, ignore_index=True)
s3 = inbox(s3)
s3["h"] = cells(s3)
s3["complaint_type"] = s3.complaint_type.fillna("")
for h, n in s3.groupby("h").size().items(): H[h]["c311"] += n
cat_hourly, noise24 = {}, {}
for cat, fn in CAT.items():
    m = fn(s3.complaint_type)
    sub = s3[m]
    for h, n in sub.groupby("h").size().items(): H[h][cat] += n
    cat_hourly[cat] = sub.groupby("hh").size().reindex(range(24), fill_value=0).astype(int).tolist()
nz = s3[CAT["noise"](s3.complaint_type)].groupby(["h", "hh"]).size().reset_index(name="n")
for h, hh, n in zip(nz.h, nz.hh, nz.n):
    if h in HEXSET:
        noise24.setdefault(h, [0] * 24)[int(hh)] = int(n)
top311 = s3.complaint_type.value_counts().head(15).to_dict()
log("311", len(s3), "days", len(parts))

# ---------------- ACS (tract) -----------------
def acs_load(table):
    out = {}
    for f in glob.glob(os.path.join(RAW, "acs", f"*_{table}.json")) + glob.glob(os.path.join(RAW, "acs", f"*{table}*.json")):
        d = json.load(open(f))
        for geo, tabs in d["data"].items():
            if table in tabs:
                out[geo] = tabs[table]["estimate"]
    return out

COUNTY = {"1": "061", "2": "005", "3": "047", "4": "081", "5": "085"}
def geoid(bct):
    return f"14000US36{COUNTY[bct[0]]}{bct[1:]}"

B1 = {k: v for t in ["B19013", "B01003", "B25064", "B01002"] for k, v in [(t, acs_load(t))]}
B15, B08, B05, C2410, C2450 = [acs_load(t) for t in ["B15003", "B08301", "B05002", "C24010", "C24050"]]
OCC = {  # game citizen classes -> C24010 male/female cols
    "merchants": (4, 40), "scientists": (7, 43), "scholars": (11, 47), "healers": (16, 52), "caregivers": (20, 56),
    "guards": (21, 57), "cooks": (24, 60), "servants": (25, 61), "carers": (26, 62), "clerks": (27, 63),
    "builders": (30, 66), "haulers": (34, 70)}
IND = {"agri": 2, "construction": 3, "manufacturing": 4, "wholesale": 5, "retail": 6, "transport": 7, "information": 8,
       "finance": 9, "professional": 10, "eduhealth": 11, "arts": 12, "otherserv": 13, "publicadmin": 14}


def v(d, geo, tab, col):
    try:
        x = d[geo][f"{tab}{col:03d}"]
        return float(x) if x is not None else 0.0
    except KeyError:
        return 0.0


tract = {}
for geo in B1["B01003"]:
    t = dict(pop=v(B1["B01003"], geo, "B01003", 1),
             inc=v(B1["B19013"], geo, "B19013", 1), rent=v(B1["B25064"], geo, "B25064", 1),
             age=v(B1["B01002"], geo, "B01002", 1),
             ed25=v(B15, geo, "B15003", 1), bach=sum(v(B15, geo, "B15003", c) for c in (22, 23, 24, 25)),
             grad=sum(v(B15, geo, "B15003", c) for c in (23, 24, 25)),
             workers=v(B08, geo, "B08301", 1), subway=v(B08, geo, "B08301", 12), bus=v(B08, geo, "B08301", 11),
             transit=v(B08, geo, "B08301", 10), drove=v(B08, geo, "B08301", 2), walk=v(B08, geo, "B08301", 19),
             bike=v(B08, geo, "B08301", 18), wfh=v(B08, geo, "B08301", 21),
             fbtot=v(B05, geo, "B05002", 1), foreign=v(B05, geo, "B05002", 13),
             emp=v(C2410, geo, "C24010", 1), indtot=v(C2450, geo, "C24050", 1))
    for k, (m, f) in OCC.items():
        t["o_" + k] = v(C2410, geo, "C24010", m) + v(C2410, geo, "C24010", f)
    for k, c in IND.items():
        t["i_" + k] = v(C2450, geo, "C24050", c)
    tract[geo] = t
log("acs tracts", len(tract))

# distribute tract population to hexes by residential units on lots
pl["geo"] = [geoid(b) if isinstance(b, str) and len(b) == 7 else None for b in pl.bct2020]
tract_units = pl.groupby("geo")["unitsres"].sum()
pl["share"] = pl.unitsres / pl.geo.map(tract_units).replace(0, np.nan)
pl["share"] = pl["share"].fillna(0)
hs = pl.groupby(["h", "geo"])["share"].sum().reset_index()
for h, geo, sh in zip(hs.h, hs.geo, hs.share):
    t = tract.get(geo)
    if not t or sh <= 0: continue
    d = H[h]
    p = t["pop"] * sh
    d["pop"] += p
    if t["inc"] > 0:
        d["_incw"] += p; d["_inc"] += t["inc"] * p
    if t["rent"] > 0:
        d["_rentw"] += p; d["_rent"] += t["rent"] * p
    for k in ["ed25", "bach", "workers", "transit", "subway", "fbtot", "foreign", "emp", "o_scientists"]:
        d["_" + k] += t[k] * sh
for d in H.values():
    if d.get("_incw"): d["income"] = d["_inc"] / d["_incw"]
    if d.get("_rentw"): d["rent"] = d["_rent"] / d["_rentw"]
    if d.get("_ed25"): d["bachPct"] = 100 * d["_bach"] / d["_ed25"]
    if d.get("_workers"): d["transitPct"] = 100 * d["_transit"] / d["_workers"]
    if d.get("_fbtot"): d["foreignPct"] = 100 * d["_foreign"] / d["_fbtot"]
    if d.get("_emp"): d["sciPct"] = 100 * d["_o_scientists"] / d["_emp"]

# tract -> NTA by unit-weighted majority of its lots' hexes
pl["nta"] = pl.h.map(hex_nta)
tn = pl.dropna(subset=["geo", "nta"]).groupby(["geo", "nta"])["unitsres"].sum().reset_index()
tn = tn.sort_values("unitsres").groupby("geo").tail(1)
tract_nta = dict(zip(tn.geo, tn.nta.astype(int)))

# ---------------- subway -----------------
st = pd.read_csv(os.path.join(RAW, "sub_stations.csv"))
wd = pd.read_csv(os.path.join(RAW, "sub_weekday.csv"))
we = pd.read_csv(os.path.join(RAW, "sub_weekend.csv"))
stations = []
for _, r in st.iterrows():
    sid = r.station_complex_id
    a = wd[wd.station_complex_id == sid].set_index("hh")["r"].reindex(range(24), fill_value=0) / 5
    b = we[we.station_complex_id == sid].set_index("hh")["r"].reindex(range(24), fill_value=0) / 2
    stations.append(dict(id=str(sid), name=r.station_complex, boro=r.borough, lat=round(r.lat, 5), lon=round(r.lon, 5),
                         wd=[int(x) for x in a.values], we=[int(x) for x in b.values], daily=int(a.sum())))
    h = h3.latlng_to_cell(r.lat, r.lon, RES)
    H[h]["subway"] += int(a.sum())
stations = [s for s in stations if s["daily"] > 0]
stations.sort(key=lambda s: -s["daily"])
log("stations", len(stations))

# subway lines from GTFS shapes: longest shape per route
G = os.path.join(RAW, "gtfs")
routes = pd.read_csv(os.path.join(G, "routes.txt"))
trips = pd.read_csv(os.path.join(G, "trips.txt"), usecols=["route_id", "shape_id"]).dropna().drop_duplicates()
shapes = pd.read_csv(os.path.join(G, "shapes.txt"))
lens = shapes.groupby("shape_id").size()
trips["n"] = trips.shape_id.map(lens)
best = trips.sort_values("n").groupby("route_id").tail(1)
lines = []
from shapely.geometry import LineString
for _, r in best.iterrows():
    pts = shapes[shapes.shape_id == r.shape_id].sort_values("shape_pt_sequence")
    ls = LineString(list(zip(pts.shape_pt_lon, pts.shape_pt_lat))).simplify(0.00008)
    rr = routes[routes.route_id == r.route_id].iloc[0]
    col = str(rr.route_color) if isinstance(rr.route_color, str) else "808183"
    lines.append(dict(route=str(r.route_id), color="#" + col,
                      path=[[round(x, 5), round(y, 5)] for x, y in ls.coords]))
log("lines", len(lines))

# ---------------- wonders (rule based) -----------------
wonders = []
KNOWN = {"338 5 AVENUE": "Empire State Building", "395 LEXINGTON AVENUE": "Chrysler Building",
         "185 GREENWICH STREET": "One World Trade Center", "1000 5 AVENUE": "The Metropolitan Museum of Art",
         "154-68 BROOKVILLE BLVD": "JFK International Airport", "83-00 23 AVENUE": "LaGuardia Airport",
         "123-01 ROOSEVELT AVENUE": "Citi Field", "1 EAST 161 STREET": "Yankee Stadium", "620 ATLANTIC AVENUE": "Barclays Center",
         "217 WEST 57TH STREET": "Central Park Tower", "111 WEST 57 STREET": "Steinway Tower", "157 WEST 57 STREET": "One57",
         "8 SPRUCE STREET": "8 Spruce Street", "432 PARK AVENUE": "432 Park Avenue", "146 WEST 57 STREET": "Metropolitan Tower",
         "360 WEST STREET": "Javits Center", "FLATBUSH AVENUE": "Floyd Bennett Field (Gateway)", "53 WEST 53RD STREET": "MoMA / 53W53", "9 DEKALB AVENUE": "The Brooklyn Tower"}
OWN = pd.read_csv(os.path.join(RAW, "owners.csv")).set_index("address")["ownername"].to_dict()
def lotname(addr):
    return KNOWN.get(str(addr), str(addr).title())
def owner(addr):
    o = OWN.get(addr)
    return "" if not isinstance(o, str) or o == "UNAVAILABLE OWNER" else f" · owner: {o.title()}"
# 1. LPC landmarks: the oldest designations are the canon; keep individual landmarks w/ names
lm = json.load(open(os.path.join(RAW, "landmarks.geojson")))["features"]
lmk = []
for f in lm:
    p = f["properties"]
    try:
        la, lo = float(p["latitude"]), float(p["longitude"])
    except (TypeError, ValueError):
        continue
    if p.get("landmarkty") in ("Individual", "Interior") or True:
        lmk.append(dict(name=p.get("lpc_name"), lat=la, lon=lo, date=p.get("desdate"), lp=p.get("lpc_lpnumb"),
                        type=p.get("landmarkty"), addr=p.get("address")))
        H[h3.latlng_to_cell(la, lo, RES)]["landmarks"] += 1
def lpnum(x):
    try: return int(str(x["lp"]).split("-")[1])
    except Exception: return 99999
first_lmk = sorted([x for x in lmk if x["name"] and not x["name"][0].isdigit()], key=lpnum)[:12]
for x in first_lmk:
    wonders.append(dict(kind="Landmark", name=x["name"].title() if x["name"].isupper() else x["name"], lat=x["lat"], lon=x["lon"],
                        rule=f"Among the first 12 NYC landmarks designated ({x['lp']})", stat=x.get("addr")))
# 2. tallest by floors
for _, r in pl[pl.numfloors <= 120].sort_values("numfloors", ascending=False).drop_duplicates("address").head(10).iterrows():
    wonders.append(dict(kind="Skyscraper", name=lotname(r.address), lat=r.latitude, lon=r.longitude, addr=str(r.address).title(),
                        rule="Top 10 tax lots by number of floors (PLUTO)", stat=f"{int(r.numfloors)} floors"))
# 3. biggest parks
for p in sorted(parks, key=lambda p: -p["acres"])[:10]:
    wonders.append(dict(kind="Great Park", name=p["name"], lat=p["lat"], lon=p["lon"],
                        rule="Top 10 parks by acreage (NYC Parks)", stat=f"{p['acres']:,.0f} acres"))
# 4. busiest stations
for s in stations[:8]:
    wonders.append(dict(kind="Grand Station", name=s["name"], lat=s["lat"], lon=s["lon"],
                        rule="Top 8 subway complexes by weekday ridership (MTA, Oct 2026)", stat=f"{s['daily']:,} riders/weekday"))
# 5. most valuable lots
for _, r in pl.sort_values("assesstot", ascending=False).drop_duplicates("address").head(6).iterrows():
    wonders.append(dict(kind="Treasury", name=lotname(r.address), lat=r.latitude, lon=r.longitude, addr=str(r.address).title(),
                        rule="Top 6 lots by assessed value (DOF via PLUTO)", stat=f"${r.assesstot/1e6:,.0f}M assessed" + owner(r.address)))
# 6. oldest buildings
for _, r in pl[pl.yearbuilt > 1600].sort_values("yearbuilt").drop_duplicates("address").head(6).iterrows():
    wonders.append(dict(kind="Ancient Ruin", name=str(r.address).title(), lat=r.latitude, lon=r.longitude,
                        rule="6 oldest year-built lots (PLUTO)", stat=f"built {int(r.yearbuilt)}"))
for w in wonders:
    w["lat"], w["lon"] = round(float(w["lat"]), 5), round(float(w["lon"]), 5)
log("wonders", len(wonders))

# ---------------- write hexes -----------------
FIELDS = ["lots", "units", "bldg", "res", "com", "office", "retail", "factory", "assess", "lotarea", "fmax", "floors",
          "year", "lu", "relig", "college", "hosp", "school", "hist", "vacant", "park", "trees", "treeGood", "topTree",
          "food", "topCuisine", "gradeA", "culture", "wifi", "evict", "crashes", "injured", "killed", "permits",
          "felony", "misd", "violation", "c311", "noise", "heat", "rodent", "parking", "street", "dirty", "homeless",
          "plumbing", "pop", "income", "rent", "bachPct", "transitPct", "foreignPct", "sciPct", "subway", "landmarks"]
rows = []
for c in hexes:
    d = H.get(c, {})
    row = [c, hex_nta[c]]
    for f in FIELDS:
        x = d.get(f)
        if x is None or (isinstance(x, float) and (math.isnan(x))):
            row.append(None if f in ("lu", "topTree", "topCuisine", "income", "rent", "bachPct", "transitPct",
                                     "foreignPct", "sciPct", "year", "floors") else 0)
        else:
            row.append(round(x, 1) if isinstance(x, float) and abs(x) < 1000 else (int(round(x)) if isinstance(x, float) else x))
    rows.append(row)
json.dump(dict(fields=["h3", "nta"] + FIELDS, rows=rows, species=species, cuisines=cuisines),
          open(os.path.join(OUT, "hexes.json"), "w"), separators=(",", ":"))
json.dump({k: v for k, v in noise24.items()}, open(os.path.join(OUT, "noise24.json"), "w"), separators=(",", ":"))
log("hexes written", len(rows))

# ---------------- NTA rollups -----------------
SUMF = [f for f in FIELDS if f not in ("fmax", "floors", "year", "lu", "topTree", "topCuisine", "income", "rent",
                                       "bachPct", "transitPct", "foreignPct", "sciPct")]
N = [collections.defaultdict(float) for _ in ntas]
nta_hex_count = collections.Counter()
for c in hexes:
    i = hex_nta[c]; nta_hex_count[i] += 1
    d = H.get(c, {})
    for f in SUMF: N[i][f] += d.get(f, 0) or 0
for geo, i in tract_nta.items():
    t = tract.get(geo)
    if not t: continue
    n = N[i]
    for k, val in t.items():
        if k in ("inc", "rent", "age"):
            if val > 0: n["_" + k] += val * t["pop"]; n["_" + k + "w"] += t["pop"]
        else:
            n["a_" + k] += val
# cuisines per NTA (from inspection data's own nta field when present)
fd["nta_i"] = fd.h.map(hex_nta)
nta_cuisine = fd.groupby(["nta_i", "cuisine_description"]).size()
city_cuisine = fd.cuisine_description.value_counts(normalize=True)

city = collections.defaultdict(float)
for n in N:
    for k, val in n.items(): city[k] += val

def lq(n, key, denom):
    a = n.get(key, 0); b = n.get(denom, 0)
    if b <= 0 or city[denom] <= 0 or city[key] <= 0: return 0
    return (a / b) / (city[key] / city[denom])

DISTRICTS = [  # name, icon, test(n)->score, blurb
    ("Financial Center", "landmark", lambda n: lq(n, "office", "bldg") * (n["office"] > 2e6), "office floor area"),
    ("Campus", "graduation-cap", lambda n: (n["college"] >= 2) * 2 + lq(n, "a_o_scientists", "a_emp") * (n["a_emp"] > 2000), "colleges + science workers"),
    ("Industrial Zone", "factory", lambda n: lq(n, "factory", "bldg") * (n["factory"] > 3e5), "factory floor area"),
    ("Market Quarter", "shopping-bag", lambda n: lq(n, "retail", "bldg") * (n["retail"] > 2e5), "retail floor area"),
    ("Food Hall", "utensils", lambda n: lq(n, "food", "units") * (n["food"] > 80), "restaurants per home"),
    ("Theater Square", "drama", lambda n: lq(n, "culture", "units") * (n["culture"] >= 8) + lq(n, "a_o_scholars", "a_emp") * 0.5 * (n["a_emp"] > 2000), "cultural institutions"),
    ("Holy Site", "church", lambda n: lq(n, "relig", "units") * (n["relig"] >= 15), "houses of worship"),
    ("Preserve", "trees", lambda n: (n["park"] / max(n["lotarea"] / 43560 + n["park"], 1)) * 4 * (n["park"] > 30), "parkland share"),
    ("Harbor & Rail", "ship", lambda n: lq(n, "a_i_transport", "a_indtot") * (n["a_indtot"] > 2000), "transport workers"),
    ("Medical Center", "hospital", lambda n: (n["hosp"] >= 3) * 1.5 + lq(n, "a_o_healers", "a_emp") * (n["a_emp"] > 2000) * 0.8, "hospitals + health workers"),
]

ntaout = []
for i, (meta, n) in enumerate(zip(ntas, N)):
    hc = nta_hex_count[i]
    rec = dict(code=meta["code"], name=meta["name"], boro=meta["boro"], type=meta["type"], hexes=hc)
    for f in SUMF: rec[f] = round(n[f], 1)
    pop = n.get("a_pop", 0)
    rec["pop"] = int(pop)
    rec["income"] = int(n["_inc"] / n["_incw"]) if n.get("_incw") else None
    rec["rent"] = int(n["_rent"] / n["_rentw"]) if n.get("_rentw") else None
    rec["age"] = round(n["_age"] / n["_agew"], 1) if n.get("_agew") else None
    def pct(a, b):
        return round(100 * n.get(a, 0) / n[b], 1) if n.get(b) else None
    rec["bachPct"] = pct("a_bach", "a_ed25"); rec["gradPct"] = pct("a_grad", "a_ed25")
    rec["subwayPct"] = pct("a_subway", "a_workers"); rec["busPct"] = pct("a_bus", "a_workers")
    rec["drovePct"] = pct("a_drove", "a_workers"); rec["walkPct"] = pct("a_walk", "a_workers")
    rec["bikePct"] = pct("a_bike", "a_workers"); rec["wfhPct"] = pct("a_wfh", "a_workers")
    rec["foreignPct"] = pct("a_foreign", "a_fbtot")
    rec["workers"] = int(n.get("a_emp", 0))
    rec["occ"] = {k: int(n.get("a_o_" + k, 0)) for k in OCC}
    rec["ind"] = {k: int(n.get("a_i_" + k, 0)) for k in IND}
    # districts
    ds = []
    if pop > 0 or n["bldg"] > 0:
        for name, icon, fn, why in DISTRICTS:
            if not why: continue
            try:
                sc = float(fn(n))
            except ZeroDivisionError:
                sc = 0
            if sc >= 1.6:
                ds.append(dict(name=name, icon=icon, score=round(sc, 2), why=why))
    ds.sort(key=lambda x: -x["score"])
    # food district: cuisine with strongest LQ (min 6 restaurants)
    if i in nta_cuisine.index.get_level_values(0):
        cz = nta_cuisine.loc[i]
        tot = cz.sum()
        best_c, best_lq = None, 0
        for cu, cnt in cz.items():
            if cnt >= 6 and cu not in ("Other", "American", "Coffee/Tea", "Pizza", "Chicken", "Bakery Products/Desserts", "Hamburgers", "Donuts", "Sandwiches", "Juice, Smoothies, Fruit Salads", "Frozen Desserts"):
                l = (cnt / tot) / city_cuisine.get(cu, 1)
                if l > best_lq: best_c, best_lq = cu, l
        if best_c and best_lq >= 3:
            ds.append(dict(name=f"{best_c} Quarter", icon="soup", score=round(best_lq, 1),
                           why=f"{int(cz[best_c])} {best_c} restaurants, {best_lq:.1f}x the city share"))
        rec["topCuisines"] = {k: int(v) for k, v in cz.sort_values(ascending=False).head(5).items()}
    rec["districts"] = ds[:4]
    ntaout.append(rec)

citystats = {k: round(v, 1) for k, v in city.items() if not k.startswith("_")}
citystats["occ"] = {k: int(city.get("a_o_" + k, 0)) for k in OCC}
citystats["ind"] = {k: int(city.get("a_i_" + k, 0)) for k in IND}
meta = dict(built=time.strftime("%Y-%m-%d"), hexes=len(hexes), res=RES, city=citystats,
            hourly=dict(crime=crime_hourly, **cat_hourly), top311=top311, topOffenses=top_offenses,
            topTrees=city_species, counts=dict(lots=len(pl), trees=len(tr), food=len(fd), r311=len(s3), crime=len(cm),
                                               crashes=len(cr), evictions=len(ev), culture=len(cul), wifi=len(wifi),
                                               landmarks=len(lmk), parks=len(parks), stations=len(stations), tracts=len(tract)))
json.dump(ntaout, open(os.path.join(OUT, "ntas.json"), "w"), separators=(",", ":"))
json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), separators=(",", ":"))
json.dump(dict(stations=stations, lines=lines), open(os.path.join(OUT, "subway.json"), "w"), separators=(",", ":"))
json.dump(wonders, open(os.path.join(OUT, "wonders.json"), "w"), separators=(",", ":"))
# NTA outlines (simplified) for selection highlight
fc = []
for i, m in enumerate(ntas):
    g2 = m["geom"].simplify(0.0002)
    fc.append(dict(type="Feature", properties=dict(i=i), geometry=json.loads(json.dumps(g2.__geo_interface__))))
def rnd(o):
    if isinstance(o, float): return round(o, 5)
    if isinstance(o, (list, tuple)): return [rnd(x) for x in o]
    if isinstance(o, dict): return {k: rnd(x) for k, x in o.items()}
    return o
json.dump(rnd(dict(type="FeatureCollection", features=fc)), open(os.path.join(OUT, "ntas.geojson"), "w"), separators=(",", ":"))
log("done")
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, "KB")
