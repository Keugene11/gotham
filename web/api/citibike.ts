// Vercel function: proxies Citi Bike's public GBFS feed (no CORS headers upstream) and merges info + status.
export const config = { runtime: "edge" };

const BASE = "https://gbfs.citibikenyc.com/gbfs/en";

export default async function handler() {
  const [info, status] = await Promise.all([
    fetch(`${BASE}/station_information.json`).then((r) => r.json()),
    fetch(`${BASE}/station_status.json`).then((r) => r.json()),
  ]);
  const st = new Map<string, any>(status.data.stations.map((s: any) => [s.station_id, s]));
  const stations = info.data.stations
    .map((s: any) => {
      const x = st.get(s.station_id);
      if (!x || !x.is_installed) return null;
      return {
        name: s.name, lat: s.lat, lon: s.lon, cap: s.capacity,
        bikes: x.num_bikes_available ?? 0, ebikes: x.num_ebikes_available ?? 0, docks: x.num_docks_available ?? 0,
      };
    })
    .filter(Boolean);
  return new Response(JSON.stringify({ updated: status.last_updated, stations }), {
    headers: { "content-type": "application/json", "cache-control": "public, s-maxage=60, stale-while-revalidate=120" },
  });
}
