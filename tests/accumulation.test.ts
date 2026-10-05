import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accumulate } from "../shared/accumulation";
import { STEP, type Observation } from "../shared/types";
import { localSlot, formatTime } from "../shared/time";
import { parseDay } from "../server/source";
const end = Date.UTC(2026, 9, 4, 13),
  start = end - 3 * 3600000;
const row = (at: number, mm: number | null): Observation => ({
  stationId: "C029",
  start: at,
  mm,
  quality: mm === null ? "missing" : "provisional",
});
test("rolling sum includes start and excludes end; no moving average", () => {
  const rows = Array.from({ length: 18 }, (_, i) => row(start + i * STEP, 0.1));
  const total = accumulate(
    [row(start - STEP, 90), ...rows, row(end, 100)],
    end,
    180,
  );
  assert.equal(total.mm, 1.8);
  assert.equal(total.complete, true);
  assert.equal(total.expected, 18);
});
test("confirmed zero, partial zero and absent measurements are distinct", () => {
  assert.equal(accumulate([row(end - STEP, 0)], end, 10).state, "zero");
  assert.equal(accumulate([row(end - STEP, 0)], end, 30).state, "partial");
  const missing = accumulate([row(end - STEP, null)], end, 10);
  assert.equal(missing.mm, null);
  assert.equal(missing.state, "none");
  assert.equal(missing.complete, false);
});
test("partial window shows actual measured sum with exact coverage; never scales", () => {
  const rows = Array.from({ length: 14 }, (_, i) =>
    row(start + i * STEP, i === 0 ? 0.5 : 0.1),
  );
  const result = accumulate(rows, end, 180);
  assert.equal(result.mm, 1.8);
  assert.equal(result.available, 14);
  assert.equal(result.expected, 18);
  assert.equal(result.complete, false);
});
test("duplicate and corrected intervals counted once with latest value", () => {
  assert.equal(
    accumulate([row(end - STEP, 0.1), row(end - STEP, 0.4)], end, 10).mm,
    0.4,
  );
  assert.equal(
    accumulate([row(end - STEP, 0.1), row(end - STEP, null)], end, 10).mm,
    null,
  );
});
test("invalid quality and invalid numerical readings cannot make complete totals", () => {
  assert.equal(
    accumulate([{ ...row(end - STEP, 1), quality: "invalid" }], end, 10)
      .complete,
    false,
  );
  assert.equal(accumulate([row(end - STEP, -1)], end, 10).complete, false);
});
test("custom duration respects native resolution and maximum", () => {
  for (const duration of [0, 5, 11, 2881, Infinity])
    assert.throws(() => accumulate([], end, duration));
  assert.throws(() => accumulate([], end + 1, 10));
  assert.equal(accumulate([], end, 2880).expected, 288);
});
test("manually checked real C029 2026-10-04 matches 0.3 mm hour and official 0.7 mm day", () => {
  const sample = JSON.parse(
    readFileSync("tests/fixtures/c029-2026-10-04.json", "utf8"),
  );
  const rows = parseDay(
    "C029",
    "2026-10-04",
    sample,
    Date.UTC(2026, 9, 6),
  ).observations;
  const hourEnd = localSlot("2026-10-04", "04:00")!;
  assert.deepEqual(accumulate(rows, hourEnd, 60), {
    mm: 0.3,
    available: 6,
    expected: 6,
    complete: true,
    qualityIssues: 0,
    state: "rain",
  });
  const dayEnd = localSlot("2026-10-05", "00:00")!;
  assert.equal(accumulate(rows, dayEnd, 1440).mm, 0.7);
  assert.equal(accumulate(rows, dayEnd, 1440).complete, true);
});
