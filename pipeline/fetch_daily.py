"""Fetch 311 by day (fast, no deep paging) and subway hourly aggregates."""
import os, datetime as dt, concurrent.futures as cf, requests, time, sys
RAW = os.path.join(os.path.dirname(__file__), "..", "raw")
os.makedirs(os.path.join(RAW, "311d"), exist_ok=True)

def get(url, params):
    for a in range(6):
        try:
            r = requests.get(url, params=params, timeout=300); r.raise_for_status(); return r.text
        except Exception as e:
            print("retry", a, e, flush=True); time.sleep(4 * (a + 1))
    raise RuntimeError(url)

def day311(d):
    out = os.path.join(RAW, "311d", f"{d}.csv")
    if os.path.exists(out): return
    nxt = d + dt.timedelta(days=1)
    txt = get("https://data.cityofnewyork.us/resource/erm2-nwe9.csv", {
        "$select": "complaint_type,latitude,longitude,date_extract_hh(created_date) as hh",
        "$where": f"created_date >= '{d}T00:00:00' AND created_date < '{nxt}T00:00:00' AND latitude IS NOT NULL",
        "$limit": 50000})
    n = txt.count("\n")
    if n >= 50000: print("WARN truncated", d, flush=True)
    open(out, "w", encoding="utf-8").write(txt)

if __name__ == "__main__":
    start = dt.date(2025, 11, 1)
    days = [start + dt.timedelta(days=i) for i in range(390) if start + dt.timedelta(days=i) < dt.date(2026, 11, 1)]
    done = 0
    with cf.ThreadPoolExecutor(8) as ex:
        for _ in ex.map(day311, days):
            done += 1
            if done % 25 == 0: print("311 days", done, flush=True)
    S = "https://data.ny.gov/resource/5wq4-mkjj.csv"
    for name, a, b in [("sub_weekday", "2026-10-05", "2026-10-09"), ("sub_weekend", "2026-10-10", "2026-10-11")]:
        txt = get(S, {"$select": "station_complex_id,date_extract_hh(transit_timestamp) as hh,sum(ridership) as r",
                      "$where": f"transit_timestamp between '{a}T00:00:00' and '{b}T23:59:59'",
                      "$group": "station_complex_id,hh", "$limit": 50000})
        open(os.path.join(RAW, name + ".csv"), "w", encoding="utf-8").write(txt)
    txt = get(S, {"$select": "station_complex_id,station_complex,borough,avg(latitude) as lat,avg(longitude) as lon",
                  "$where": "transit_timestamp between '2026-10-05T00:00:00' and '2026-10-05T23:59:59'",
                  "$group": "station_complex_id,station_complex,borough", "$limit": 50000})
    open(os.path.join(RAW, "sub_stations.csv"), "w", encoding="utf-8").write(txt)
    print("ALL DONE", flush=True)
