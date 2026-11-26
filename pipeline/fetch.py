"""Download raw NYC open data into raw/. Each job pages a Socrata endpoint as CSV.
Usage: python pipeline/fetch.py [job ...]"""
import sys, os, time, io, concurrent.futures as cf
import requests

RAW = os.path.join(os.path.dirname(__file__), "..", "raw")
os.makedirs(RAW, exist_ok=True)
NYC = "https://data.cityofnewyork.us/resource"
NYS = "https://data.ny.gov/resource"

JOBS = {
    # MapPLUTO: every tax lot in the city
    "pluto": (NYC, "64uk-42ks",
              "borough,latitude,longitude,landuse,bldgclass,numfloors,unitsres,assesstot,yearbuilt,"
              "bldgarea,comarea,officearea,retailarea,factryarea,resarea,lotarea,bct2020,address,zonedist1,landmark,histdist,ownertype",
              "latitude IS NOT NULL", None),
    # 311 service requests, last 12 months
    "311": (NYC, "erm2-nwe9", "complaint_type,latitude,longitude,date_extract_hh(created_date) as hh",
            "created_date > '2025-11-01T00:00:00' AND latitude IS NOT NULL", None),
    # NYPD complaints, current year to date
    "crime": (NYC, "5uac-w243", "law_cat_cd,ofns_desc,latitude,longitude,cmplnt_fr_tm",
              "latitude IS NOT NULL", None),
    # 2015 street tree census
    "trees": (NYC, "uvpi-gqnh", "spc_common,health,latitude,longitude", "latitude IS NOT NULL", None),
    # restaurant inspections, one row per restaurant
    "food": (NYC, "43nn-pn8j", "camis,dba,cuisine_description,nta,latitude,longitude,max(grade) as grade",
             "latitude > 40", "camis,dba,cuisine_description,nta,latitude,longitude"),
    # motor vehicle collisions, last 12 months
    "crashes": (NYC, "h9gi-nx95",
                "latitude,longitude,number_of_persons_injured,number_of_persons_killed",
                "crash_date > '2025-11-01T00:00:00' AND latitude > 40", None),
    # residential evictions executed
    "evictions": (NYC, "6z8x-wfk4", "latitude,longitude,executed_date",
                  "latitude IS NOT NULL AND residential_commercial_ind='Residential'", None),
    # DCLA cultural institutions
    "culture": (NYC, "u35m-9t32", "organization_name,discipline,latitude,longitude", "latitude IS NOT NULL", None),
    # Citi Bike-free alternative: public wifi hotspots
    "wifi": (NYC, "yjub-udmw", "name,provider,latitude,longitude", "latitude IS NOT NULL", None),
    # DOB new building permits (construction = production)
    "permits": (NYC, "ipu4-2q9a", "job_type,gis_latitude as latitude,gis_longitude as longitude,filing_date",
                "job_type='NB' AND gis_latitude IS NOT NULL", None),
}


def fetch(name):
    base, ds, select, where, group = JOBS[name]
    out = os.path.join(RAW, f"{name}.csv")
    if os.path.exists(out) and os.path.getsize(out) > 1000:
        return name, "cached"
    page, offset, header, rows = 50000, 0, None, 0
    with open(out + ".part", "w", encoding="utf-8", newline="") as f:
        while True:
            params = {"$select": select, "$where": where, "$limit": page, "$offset": offset}
            if group:
                params["$group"] = group
                params["$order"] = group.split(",")[0]
            else:
                params["$order"] = ":id"
            for attempt in range(5):
                try:
                    r = requests.get(f"{base}/{ds}.csv", params=params, timeout=600)
                    r.raise_for_status()
                    break
                except Exception as e:
                    print(name, "retry", attempt, e, flush=True)
                    time.sleep(5 * (attempt + 1))
            else:
                raise RuntimeError(name + " failed")
            text = r.text
            lines = text.splitlines(keepends=True)
            if not lines:
                break
            if header is None:
                header = lines[0]
                f.write(header)
            body = lines[1:]
            f.writelines(body)
            rows += len(body)
            print(f"{name}: {rows}", flush=True)
            if len(body) < page:
                break
            offset += page
    os.replace(out + ".part", out)
    return name, rows


if __name__ == "__main__":
    names = sys.argv[1:] or list(JOBS)
    with cf.ThreadPoolExecutor(6) as ex:
        for res in ex.map(fetch, names):
            print("DONE", res, flush=True)
