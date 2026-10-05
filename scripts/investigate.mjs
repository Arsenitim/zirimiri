import { writeFileSync, mkdirSync } from "node:fs";
const response = await fetch(
  "https://www.euskalmet.euskadi.eus/vamet/stations/stationList/webmet00-stationList.json",
);
if (!response.ok) throw new Error(`Inventory HTTP ${response.status}`);
const stations = JSON.parse(
  new TextDecoder("windows-1252").decode(await response.arrayBuffer()),
);
mkdirSync("data/raw", { recursive: true });
const results = [];
for (const station of stations) {
  const url = `https://www.euskalmet.euskadi.eus/vamet/stations/readings/${station.id}/2026/10/05/webmet00-readingsData.json`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) {
      results.push({ id: station.id, status: r.status });
      continue;
    }
    const body = await r.json();
    writeFileSync(
      `data/raw/${station.id}-2026-10-05.json`,
      JSON.stringify(body),
    );
    const rain = Object.values(body).filter((v) => v.name === "precipitation");
    results.push({
      id: station.id,
      status: 200,
      rain: rain.map((v) => ({ type: v.type, heights: Object.keys(v.data) })),
    });
  } catch (e) {
    results.push({ id: station.id, error: e.message });
  }
  await new Promise((r) => setTimeout(r, 150));
}
writeFileSync("data/discovery.json", JSON.stringify(results, null, 2));
console.log(
  JSON.stringify(
    {
      inventory: stations.length,
      responding: results.filter((x) => x.status === 200).length,
      rain: results.filter((x) => x.rain?.length).map((x) => x.id),
    },
    null,
    2,
  ),
);
