import { test } from "node:test";
import assert from "node:assert/strict";
import { localSlot, formatTime } from "../shared/time";
import { accumulate } from "../shared/accumulation";
import { STEP, type Observation } from "../shared/types";
test("Madrid local summer and winter observations convert to UTC", () => {
  assert.equal(localSlot("2026-10-04", "03:00"), Date.UTC(2026, 9, 4, 1));
  assert.equal(localSlot("2026-01-04", "03:00"), Date.UTC(2026, 0, 4, 2));
});
test("spring forward skips nonexistent labels and remains a 10-minute UTC step", () => {
  assert.equal(localSlot("2026-03-29", "02:10"), null);
  assert.equal(
    localSlot("2026-03-29", "03:00")! - localSlot("2026-03-29", "01:50")!,
    STEP,
  );
  assert.match(formatTime(Date.UTC(2026, 2, 29, 0, 50)), /01:50 CET/);
  assert.match(formatTime(Date.UTC(2026, 2, 29, 1)), /03:00 CEST/);
});
test("fallback ambiguous source labels are excluded, never assigned an invented fold", () => {
  assert.equal(localSlot("2026-10-25", "02:00"), null);
  assert.match(formatTime(Date.UTC(2026, 9, 25, 0, 30)), /02:30 CEST/);
  assert.match(formatTime(Date.UTC(2026, 9, 25, 1, 30)), /02:30 CET/);
});
test("rolling UTC duration is exact across spring and autumn transitions", () => {
  for (const end of [Date.UTC(2026, 2, 29, 2), Date.UTC(2026, 9, 25, 2)]) {
    const rows: Observation[] = Array.from({ length: 18 }, (_, i) => ({
      stationId: "test",
      start: end - (18 - i) * STEP,
      mm: 0.1,
      quality: "provisional",
    }));
    assert.equal(accumulate(rows, end, 180).mm, 1.8);
  }
});
test("invalid clock labels never silently normalize to a different date", () => {
  assert.equal(localSlot("2026-02-30", "12:00"), null);
  assert.equal(localSlot("2026-10-04", "24:00"), null);
});
