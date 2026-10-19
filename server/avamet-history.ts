import { DateTime } from "luxon";
import { localSlot } from "../shared/time";
import {
  type CounterPoint,
  type GaugeHistory,
  type MeasuredInterval,
} from "../shared/intervals";
import { Store } from "./store";

export function parseAvametHistory(
  html: string,
  now = Date.now(),
): CounterPoint[] {
  const chart = /\$\('#grafic4'\)\.highcharts\(\{([\s\S]*?)\}\);/.exec(
    html,
  )?.[1];
  if (!chart || !/Precipitació \(mm\)/.test(chart))
    throw new Error("AVAMET rainfall chart missing or units changed");
  const series =
    /series:\s*\[\{yAxis:\s*0,\s*data:(\[\[.*?\]\]),color:[^\n]*?name:'Precipitació'/s.exec(
      chart,
    )?.[1];
  if (!series) throw new Error("AVAMET daily counter series missing");
  const raw: unknown = JSON.parse(series);
  if (!Array.isArray(raw) || !raw.length) throw new Error("Empty AVAMET chart");
  const header = /<div id="hora">(\d{2}-\d{2}-\d{4} \d{2}:\d{2})<\/div>/.exec(
    html,
  )?.[1];
  const last = raw.at(-1);
  if (
    !header ||
    !Array.isArray(last) ||
    !Number.isSafeInteger(last[0]) ||
    DateTime.fromMillis(last[0], { zone: "UTC" }).toFormat(
      "dd-MM-yyyy HH:mm",
    ) !== header
  )
    throw new Error(
      "Chart timestamp convention does not match station reporting clock",
    );
  const points = new Map<number, CounterPoint>();
  let previous = -Infinity;
  for (const r of raw) {
    if (
      !Array.isArray(r) ||
      r.length !== 2 ||
      !Number.isSafeInteger(r[0]) ||
      r[0] % 60000 !== 0 ||
      r[0] < previous
    )
      throw new Error("Invalid or unordered AVAMET counter timestamp");
    previous = r[0];
    // AVAMET encodes the local wall clock in epoch-shaped numbers. Do not use as UTC.
    const civil = DateTime.fromMillis(r[0], { zone: "UTC" });
    const day = civil.toISODate()!;
    const at = localSlot(day, civil.toFormat("HH:mm"));
    if (at === null || at > now || at < now - 7 * 86400000) continue;
    const mm =
      typeof r[1] === "number" && Number.isFinite(r[1]) && r[1] >= 0
        ? r[1]
        : null;
    const old = points.get(at);
    points.set(at, { at, day, mm: old && old.mm !== mm ? null : mm });
  }
  if (!points.size)
    throw new Error("No unambiguous recent AVAMET counter times");
  return [...points.values()].sort((a, b) => a.at - b.at);
}
export function counterIntervals(points: CounterPoint[]): MeasuredInterval[] {
  const intervals: MeasuredInterval[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    // Only consecutive, same-day readings at most ten minutes apart. Reset crossings
    // and source gaps stay missing; neither rainfall nor the time gap is interpolated.
    if (
      a.day !== b.day ||
      a.mm === null ||
      b.mm === null ||
      b.mm < a.mm ||
      b.at <= a.at ||
      b.at - a.at > 600000
    )
      continue;
    intervals.push({
      start: a.at,
      end: b.at,
      mm: Math.round((b.mm - a.mm) * 1000) / 1000,
    });
  }
  return intervals;
}
export class HistoryRateLimit extends Error {
  constructor(public retryAt: number) {
    super("History request limit reached. Please try again shortly.");
  }
}
export class AvametHistory {
  private pending = new Map<string, Promise<GaugeHistory>>();
  constructor(
    public store: Store,
    private request: typeof fetch = fetch,
    private clock = Date.now,
  ) {
    store.db.exec(
      `CREATE TABLE IF NOT EXISTS avamet_counters(stationId TEXT NOT NULL, at INTEGER NOT NULL, mm REAL, day TEXT NOT NULL, PRIMARY KEY(stationId,at));`,
    );
  }
  read(stationId: string): GaugeHistory {
    const points = this.store.db
      .prepare(
        "SELECT at,mm,day FROM avamet_counters WHERE stationId=? ORDER BY at",
      )
      .all(stationId) as unknown as CounterPoint[];
    return {
      stationId,
      points,
      intervals: counterIntervals(points),
      fetchedAt: this.store.get(`historySuccess:${stationId}`, null),
      lastAttempt: this.store.get(`historyAttempt:${stationId}`, null),
      error: this.store.get(`historyError:${stationId}`, null),
    };
  }
  async load(stationId: string): Promise<GaugeHistory> {
    if (!/^avamet:c\d{2}m\d{3}e\d{2}$/.test(stationId))
      throw new Error("Invalid AVAMET station ID");
    const existing = this.pending.get(stationId);
    if (existing) return existing;
    const now = this.clock();
    if (now - this.store.get(`historyAttempt:${stationId}`, 0) < 1800000)
      return this.read(stationId);
    const recent = this.store
      .get<number[]>("historyRequests", [])
      .filter((t) => t > now - 3600000);
    // One server-wide budget, persisted across restarts. Scrubbing/GETs never fetch upstream.
    if (recent.length >= 30 || recent.some((t) => now - t < 2000))
      throw new HistoryRateLimit(
        recent.length >= 30 ? recent[0] + 3600000 : recent.at(-1)! + 2000,
      );
    this.store.set("historyRequests", [...recent, now]);
    this.store.set(`historyAttempt:${stationId}`, now);
    const task = this.fetch(stationId, now);
    this.pending.set(stationId, task);
    try {
      return await task;
    } finally {
      this.pending.delete(stationId);
    }
  }
  private async fetch(stationId: string, now: number) {
    try {
      const response = await this.request(
        `https://www.avamet.org/mxo_i.php?id=${stationId.slice(7)}`,
        {
          signal: AbortSignal.timeout(30000),
          headers: {
            "User-Agent":
              "Zirimiri on-demand station history (30-minute station cache; 30 requests/hour maximum)",
          },
        },
      );
      if (!response.ok) throw new Error(`AVAMET chart HTTP ${response.status}`);
      const points = parseAvametHistory(await response.text(), now);
      // Replace the source-covered range to apply corrections/withdrawals, retaining
      // older archived samples. Never merge across an upstream gap by interpolation.
      this.store.db.exec("BEGIN IMMEDIATE");
      try {
        this.store.db
          .prepare(
            "DELETE FROM avamet_counters WHERE stationId=? AND at>=? AND at<=?",
          )
          .run(stationId, points[0].at, points.at(-1)!.at);
        const insert = this.store.db.prepare(
          "INSERT INTO avamet_counters VALUES(?,?,?,?)",
        );
        for (const p of points) insert.run(stationId, p.at, p.mm, p.day);
        this.store.db
          .prepare("DELETE FROM avamet_counters WHERE at<?")
          .run(now - 18 * 86400000);
        this.store.set(`historySuccess:${stationId}`, now);
        this.store.set(`historyError:${stationId}`, null);
        this.store.db.exec("COMMIT");
      } catch (e) {
        this.store.db.exec("ROLLBACK");
        throw e;
      }
    } catch (e) {
      this.store.set(`historyError:${stationId}`, (e as Error).message);
    }
    return this.read(stationId);
  }
}
