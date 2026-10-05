import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { Store } from "../server/store";
import { Ingestion } from "../server/ingestion";
import { SourceError, type SourceAdapter } from "../server/source";
test("yesterday's unfinished snapshot refreshes after midnight despite its cache TTL", async () => {
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 9, 6, 0, 10);
  const store = new Store(":memory:");
  try {
    const station = {
      id: "test",
      name: "Station",
      municipality: "Bilbao",
      province: "Bizkaia",
      lat: 43,
      lon: -3,
      elevation: 10,
      sensorHeight: 1,
      sensorId: null,
      eligible: true,
    };
    store.saveStation(station);
    store.set("inventoryAt", Date.now());
    const dayEnd = DateTime.fromISO("2026-10-06", {
      zone: "Europe/Madrid",
    }).toMillis();
    store.markFetched("test", "2026-10-05", 200, dayEnd - 600000);
    const requested: string[] = [];
    const source: SourceAdapter = {
      inventory: async () => [station],
      day: async (_id, day) => {
        requested.push(day);
        return {};
      },
    };
    await new Ingestion(store, source).run();
    assert.ok(requested.includes("2026-10-05"));
    assert.equal(store.fetchedAt("test", "2026-10-05")!.fetchedAt, Date.now());
  } finally {
    store.db.close();
    Date.now = realNow;
  }
});
test("source errors retain cached measurements and report failed ingestion without inventing data", async () => {
  const store = new Store(":memory:");
  const station = {
    id: "test",
    name: "Station",
    municipality: "Bilbao",
    province: "Bizkaia",
    lat: 43,
    lon: -3,
    elevation: 10,
    sensorHeight: 1,
    sensorId: null,
    eligible: true,
  };
  store.saveStation(station);
  store.set("inventoryAt", Date.now());
  const start = DateTime.now()
    .setZone("Europe/Madrid")
    .startOf("day")
    .toMillis();
  store.replaceDay(
    "test",
    DateTime.now().setZone("Europe/Madrid").toISODate()!,
    [{ stationId: "test", start, mm: 0.2, quality: "provisional" }],
    0,
  );
  const source: SourceAdapter = {
    inventory: async () => [station],
    day: async () => {
      throw new SourceError(403, "Source refused access");
    },
  };
  await new Ingestion(store, source).run();
  assert.equal(store.range(start, start + 600000)[0].mm, 0.2);
  assert.equal(store.status().errors, 1);
  assert.equal(store.status().lastError, "Source refused access");
  assert.equal(store.status().running, false);
  store.db.close();
});
