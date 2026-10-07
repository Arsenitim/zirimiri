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

test("manual refresh bypasses today's cache, skips history, and shares a persisted minute limit", async () => {
  const realNow = Date.now;
  let now = Date.UTC(2026, 9, 7, 12);
  Date.now = () => now;
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
      sensorId: "rain",
      eligible: true,
    };
    store.saveStation(station);
    store.set("inventoryAt", now);
    const today = DateTime.fromMillis(now, {
      zone: "Europe/Madrid",
    }).toISODate()!;
    store.markFetched(station.id, today, 200, now);
    const requested: string[] = [];
    const source: SourceAdapter = {
      inventory: async () => [station],
      day: async (_id, day) => {
        requested.push(day);
        return {};
      },
    };
    const ingestion = new Ingestion(store, source);
    ingestion.running = true;
    assert.equal((await ingestion.refresh()).reason, "running");
    ingestion.running = false;
    assert.equal((await ingestion.refresh()).accepted, true);
    assert.deepEqual(requested, [today]);
    const another = new Ingestion(store, source);
    now += 59_999;
    assert.equal((await another.refresh()).reason, "cooldown");
    assert.equal(requested.length, 1);
    now += 1;
    assert.equal((await another.refresh()).accepted, true);
    assert.deepEqual(requested, [today, today]);
  } finally {
    store.db.close();
    Date.now = realNow;
  }
});

test("concurrent manual refreshes cannot start duplicate source polls", async () => {
  const store = new Store(":memory:");
  let finish!: (stations: []) => void;
  const ingestion = new Ingestion(store, {
    inventory: () =>
      new Promise<[]>((resolve) => {
        finish = resolve;
      }),
    day: async () => ({}),
  });
  try {
    const first = ingestion.refresh();
    assert.equal((await ingestion.refresh()).accepted, false);
    finish([]);
    assert.equal((await first).accepted, true);
  } finally {
    store.db.close();
  }
});
