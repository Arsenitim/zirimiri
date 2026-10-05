import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { parseDay } from "../server/source";
import { localSlot } from "../shared/time";
const day = "2026-10-04",
  start = localSlot(day, "03:00")!;
test("SQLite atomic replacement updates corrected records and removes withdrawn slots", () => {
  const store = new Store(":memory:");
  store.replaceDay("C029", day, [
    { stationId: "C029", start, mm: 0.1, quality: "provisional" },
    {
      stationId: "C029",
      start: start + 600000,
      mm: 0.2,
      quality: "provisional",
    },
  ]);
  store.replaceDay("C029", day, [
    { stationId: "C029", start, mm: 0.4, quality: "provisional" },
  ]);
  const rows = store.range(start, start + 1200000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mm, 0.4);
  assert.ok(store.fetchedAt("C029", day));
  store.db.close();
});
test("eligibility and gauge metadata survive temporary missing readings", () => {
  const store = new Store(":memory:");
  const station = {
    id: "test",
    name: "Station",
    municipality: "Bilbao",
    province: "Bizkaia",
    lat: 43,
    lon: -3,
    elevation: 10,
    sensorHeight: 1.2,
    sensorId: null,
    eligible: true,
  };
  store.saveStation(station);
  store.saveStation({ ...station, eligible: false, sensorHeight: null });
  assert.equal(store.stations(true).length, 1);
  assert.equal(store.stations(true)[0].sensorHeight, 1.2);
  store.db.close();
});
test("parser keeps zero, rejects invalid amounts and current unfinished slots", () => {
  const parsed = parseDay(
    "C029",
    day,
    {
      "40": {
        name: "precipitation",
        station: "C029",
        type: "measuresForWater",
        data: {
          "147": {
            "03:00": 0,
            "03:10": null,
            "03:20": -999,
            "03:30": "0.1",
            "03:40": 0.2,
          },
        },
      },
    },
    start + 40 * 60000,
  );
  assert.equal(parsed.observations.length, 4);
  assert.equal(parsed.observations[0].mm, 0);
  assert.equal(parsed.observations[1].quality, "missing");
  assert.equal(parsed.observations[2].quality, "invalid");
  assert.equal(parsed.observations[3].mm, null);
  assert.equal(parsed.sensorHeight, 1.47);
});
test("no precipitation field never implies zero; mismatched or multiple gauges rejected", () => {
  assert.equal(parseDay("test", day, {}).eligible, false);
  assert.throws(() =>
    parseDay("test", day, {
      "40": {
        name: "precipitation",
        station: "wrong",
        data: { "100": { "00:00": 0 } },
      },
    }),
  );
  assert.throws(() =>
    parseDay("test", day, {
      "40": {
        name: "precipitation",
        station: "test",
        data: { "100": {}, "200": {} },
      },
    }),
  );
});
