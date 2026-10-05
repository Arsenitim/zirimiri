import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { activityRadius } from "../shared/activity";
const station = (id: string, eligible = true) => ({
  id,
  name: id,
  municipality: "Bilbao",
  province: "Bizkaia",
  lat: 43,
  lon: -3,
  elevation: 10,
  sensorHeight: 1,
  sensorId: null,
  eligible,
});
test("rain activity sums factual gauge intervals, excludes missing and invalid values, and omits confirmed dry slots", () => {
  const store = new Store(":memory:");
  const start = Date.UTC(2026, 9, 4, 1);
  for (const id of ["a", "b", "c", "d"]) store.saveStation(station(id));
  store.saveStation(station("notEligible", false));
  for (const [id, mm, quality] of [
    ["a", 0.2, "provisional"],
    ["b", 0.3, "provisional"],
    ["c", null, "missing"],
    ["d", 5, "invalid"],
    ["notEligible", 10, "provisional"],
  ] as const)
    store.replaceDay(id, "2026-10-04", [
      { stationId: id, start, mm, quality },
      { stationId: id, start: start + 600000, mm: 0, quality: "provisional" },
    ]);
  assert.deepEqual(store.activity(start, start + 1200000), [
    { end: start + 600000, totalMm: 0.5, wetStations: 2, availableStations: 2 },
  ]);
  assert.deepEqual(store.activity(start + 600000, start + 1200000), []);
  // A corrected station/day replaces rather than adds to the activity sum.
  store.replaceDay("a", "2026-10-04", [
    { stationId: "a", start, mm: 0.4, quality: "provisional" },
  ]);
  assert.equal(store.activity(start, start + 600000)[0].totalMm, 0.7);
  store.db.close();
});
test("activity dots grow with rainfall and stay capped even during extreme readings", () => {
  assert.ok(activityRadius(0.1) < activityRadius(5));
  assert.equal(activityRadius(1000), 6);
  assert.equal(activityRadius(1e9), 6);
});
