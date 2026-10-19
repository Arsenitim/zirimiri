import { DateTime } from "luxon";
import type { Station, StationTotal, Status } from "../shared/types";
import { Store } from "./store";

export const AVAMET_URL = "https://www.avamet.org/mxo-mxo.php?territori=pv";
export interface AvametGauge extends Station {
  dailyMm: number | null;
  measuredAt: number | null;
  dayStart: number | null;
}
const decimal = (v: unknown): number | null => {
  if (typeof v !== "string" || !/^-?\d+(?:,\d+)?$/.test(v)) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
export function parseAvamet(html: string, now = Date.now()): AvametGauge[] {
  const match = /\bvar data\s*=\s*(\[.*?\]);/s.exec(html);
  if (!match) throw new Error("AVAMET viewer data array missing");
  const rows: unknown = JSON.parse(match[1]);
  if (!Array.isArray(rows)) throw new Error("Invalid AVAMET inventory");
  const gauges: AvametGauge[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const id = /^c(\d{2})m\d{3}e\d{2}$/.exec(r.esta);
    if (!id) continue;
    const comarca = Number(id[1]);
    if (comarca < 1 || comarca > 34) continue; // c99 is outside the region.
    const lat =
      typeof r.lati === "string" && /^-?\d+\.\d+$/.test(r.lati)
        ? Number(r.lati)
        : NaN;
    const lon =
      typeof r.logi === "string" && /^-?\d+\.\d+$/.test(r.logi)
        ? Number(r.logi)
        : NaN;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < 37 ||
      lat > 41 ||
      lon < -2 ||
      lon > 1
    )
      continue;
    const time = DateTime.fromFormat(
      typeof r.data_ini === "string" ? r.data_ini : "",
      "dd/MM/yyyy HH:mm",
      { zone: "Europe/Madrid" },
    );
    const validTime =
      time.isValid &&
      time.getPossibleOffsets().length === 1 &&
      time.toMillis() <= now;
    const rain = decimal(r.prec);
    gauges.push({
      id: `avamet:${r.esta}`,
      name: typeof r.muni === "string" ? r.muni : r.esta,
      municipality: typeof r.muni === "string" ? r.muni : "",
      province:
        comarca <= 8 ? "Castellón" : comarca <= 25 ? "Valencia" : "Alicante",
      lat,
      lon,
      elevation: decimal(
        typeof r.msnm === "string" ? r.msnm.replaceAll(".", "") : null,
      ),
      sensorHeight: null,
      sensorId: null,
      eligible: true,
      dailyMm: validTime && rain !== null && rain >= 0 ? rain : null,
      measuredAt: validTime ? time.toMillis() : null,
      dayStart: validTime ? time.startOf("day").toMillis() : null,
    });
  }
  if (!gauges.length) throw new Error("No valid AVAMET station coordinates");
  return gauges;
}
// Separate database: daily counters must never enter the ten-minute observation table.
export class AvametIngestion {
  running = false;
  constructor(
    public store: Store,
    private request: typeof fetch = fetch,
  ) {}
  async run() {
    if (
      this.running ||
      Date.now() - this.store.get("lastAttempt", 0) < 30 * 60000
    )
      return;
    this.running = true;
    this.store.set("lastAttempt", Date.now());
    try {
      const response = await this.request(AVAMET_URL, {
        signal: AbortSignal.timeout(30000),
        headers: {
          "User-Agent":
            "Zirimiri experimental rainfall viewer (30-minute cache)",
        },
      });
      if (!response.ok) throw new Error(`AVAMET HTTP ${response.status}`);
      const gauges = parseAvamet(await response.text());
      this.store.set("gauges", gauges);
      this.store.set("lastSuccess", Date.now());
      this.store.set("lastError", null);
    } catch (e) {
      this.store.set("lastError", (e as Error).message);
    } finally {
      this.running = false;
    }
  }
  start() {
    void this.run();
    setInterval(() => void this.run(), 30 * 60000).unref();
  }
  snapshot() {
    const gauges = this.store.get<AvametGauge[]>("gauges", []);
    const times = gauges.flatMap((s) =>
      s.measuredAt === null ? [] : [s.measuredAt],
    );
    const status: Status = {
      ...this.store.status(this.running),
      source: "AVAMET MeteoXarxaOnline · daily counters",
      inventory: gauges.length,
      eligible: gauges.length,
      newestMeasurement: times.length ? Math.max(...times) : null,
      oldestMeasurement: times.length ? Math.min(...times) : null,
      errors: this.store.get("lastError", null) ? 1 : 0,
    };
    const stations: (StationTotal & AvametGauge)[] = gauges.map((s) => ({
      ...s,
      mm: s.dailyMm,
      latest: s.measuredAt,
      stale: s.measuredAt === null || Date.now() - s.measuredAt > 3600000,
      complete: false,
      available: 0,
      expected: 0,
      qualityIssues: 0,
      state: s.dailyMm === null ? "none" : "partial",
    }));
    return { status, stations };
  }
}
