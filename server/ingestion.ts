import { DateTime } from "luxon";
import { ZONE } from "../shared/time";
import { Store } from "./store";
import {
  ViewerSource,
  SourceError,
  parseDay,
  type SourceAdapter,
} from "./source";
export class Ingestion {
  running = false;
  constructor(
    public store: Store,
    private source: SourceAdapter = new ViewerSource(),
  ) {}
  async run() {
    if (this.running) return;
    this.running = true;
    this.store.set("lastAttempt", Date.now());
    this.store.set("running", true);
    const runDay = DateTime.fromMillis(Date.now(), { zone: ZONE }).startOf(
      "day",
    );
    let failures = 0,
      lastError: string | null = null;
    try {
      if (process.env.SOURCE && process.env.SOURCE !== "viewer")
        throw new Error(
          "Only verified viewer adapter is enabled. API normalisation requires a real authenticated response.",
        );
      const inventoryTime = this.store.get("inventoryAt", 0);
      if (
        !this.store.stations().length ||
        Date.now() - inventoryTime > 86400000
      ) {
        const inventory = await this.source.inventory();
        for (const s of inventory) this.store.saveStation(s);
        this.store.set("inventoryAt", Date.now());
      }
      const subset = process.env.STATION_IDS?.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const stations = this.store
        .stations()
        .filter((s) => !subset?.length || subset.includes(s.id));
      if (this.source.metadata) {
        const yesterday = runDay.minus({ days: 1 }).toISODate()!;
        for (const station of stations.filter(
          (s) => s.eligible && !s.sensorId,
        )) {
          const attempted = this.store.get(`metadataAt:${station.id}`, 0);
          if (Date.now() - attempted < 86400000) continue;
          this.store.set(`metadataAt:${station.id}`, Date.now());
          try {
            this.store.saveStation({
              ...station,
              ...(await this.source.metadata(station.id, yesterday)),
            });
          } catch {
            /* Metadata absence cannot erase measured observations. Retry tomorrow. */
          }
        }
      }
      // Day-first: make every gauge visible before completing the two-week backfill.
      for (let offset = 0; offset <= 17; offset++) {
        const day = runDay.minus({ days: offset }).toISODate()!;
        for (const station of stations) {
          const previous = this.store.fetchedAt(station.id, day);
          const knownGauge = this.store
            .stations(true)
            .some((s) => s.id === station.id);
          const ttl =
            previous?.status === 404
              ? 6 * 3600000
              : offset === 0 && knownGauge
                ? Math.max(20, Number(process.env.POLL_MINUTES) || 30) * 60000
                : offset === 1 && knownGauge
                  ? 6 * 3600000
                  : 86400000;
          const dayEnd = DateTime.fromISO(day, { zone: ZONE })
            .plus({ days: 1 })
            .toMillis();
          // A file fetched while that day was still in progress must be refreshed
          // after midnight, even when yesterday's usual six-hour TTL has not expired.
          const fetchedBeforeDayFinished =
            previous && offset > 0 && previous.fetchedAt < dayEnd;
          if (
            previous &&
            !fetchedBeforeDayFinished &&
            Date.now() - previous.fetchedAt < ttl
          )
            continue;
          // Unknown stations are also probed on historical days: a gauge can be
          // temporarily missing today and yesterday when the cache is first built.
          try {
            const body = await this.source.day(station.id, day);
            const parsed = parseDay(station.id, day, body);
            this.store.saveStation({
              ...station,
              eligible: parsed.eligible,
              sensorHeight: parsed.sensorHeight,
            });
            this.store.replaceDay(station.id, day, parsed.observations);
            this.store.set("lastSuccess", Date.now());
          } catch (e) {
            if (e instanceof SourceError && e.status === 404) {
              this.store.markFetched(station.id, day, 404);
              continue;
            }
            failures++;
            lastError =
              e instanceof Error ? e.message : "Source request failed";
            this.store.set("lastError", lastError);
            this.store.set("errors", failures);
            // Stop on widespread source failure or throttling; retry at next backed-off poll.
            if (
              failures >= 5 ||
              (e instanceof SourceError && [401, 403, 429].includes(e.status))
            )
              throw e;
          }
        }
      }
      this.store.prune(Number(process.env.RETENTION_DAYS) || 18);
    } catch (e) {
      failures = Math.max(1, failures);
      lastError = e instanceof Error ? e.message : "Ingestion failed";
    } finally {
      this.store.set("errors", failures);
      this.store.set("lastError", lastError);
      this.store.set("running", false);
      this.running = false;
    }
  }
  start() {
    const poll = async () => {
      await this.run();
      const error = this.store.get("errors", 0);
      setTimeout(
        poll,
        Math.max(20, Number(process.env.POLL_MINUTES) || 30) *
          60000 *
          (error ? 2 : 1),
      ).unref();
    };
    void poll();
  }
}
