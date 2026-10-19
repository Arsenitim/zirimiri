import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DateTime } from "luxon";
import {
  AvametHistory,
  HistoryRateLimit,
  parseAvametHistory,
  counterIntervals,
} from "../server/avamet-history";
import { accumulateIntervals } from "../shared/intervals";
import { Store } from "../server/store";
const now = Date.parse("2026-10-19T16:00:00Z");
const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/avamet-chart-${name}.html`, import.meta.url),
    "utf8",
  );
function chart(rows: [number, number | null][]) {
  const last = DateTime.fromMillis(rows.at(-1)![0], { zone: "UTC" }).toFormat(
    "dd-MM-yyyy HH:mm",
  );
  return `<div id="hora">${last}</div>$('#grafic4').highcharts({yAxis:[{title:'Precipitació (mm)'}],series:[{yAxis: 0,data:${JSON.stringify(rows)},color:'#0099FF',name:'Precipitació'}]});`;
}
const civil = (iso: string) => Date.parse(iso + "Z");
test("real charts in all three provinces contain daily counters and local-encoded timestamps", () => {
  for (const [name, count, value, reporting] of [
    ["now", 820, 20.8, "2026-10-19T15:40:00Z"],
    ["valencia", 1326, 33.2, "2026-10-19T15:45:00Z"],
    ["agost", 1412, 0.5, "2026-10-19T15:48:00Z"],
  ] as const) {
    const points = parseAvametHistory(fixture(name), now);
    assert.equal(points.length, count);
    assert.equal(points.at(-1)!.at, Date.parse(reporting));
    assert.equal(points.at(-1)!.mm, value);
    const intervals = counterIntervals(points);
    assert.ok(intervals.length > 700);
    assert.ok(intervals.every((r) => r.mm >= 0 && r.end - r.start <= 600000));
    const sameDay = points.filter((p) => p.day === "2026-10-19");
    assert.ok(sameDay[0].mm === 0);
    assert.ok(
      !intervals.some(
        (r) =>
          DateTime.fromMillis(r.start, {
            zone: "Europe/Madrid",
          }).toISODate() !==
          DateTime.fromMillis(r.end, { zone: "Europe/Madrid" }).toISODate(),
      ),
    );
  }
  const rows = counterIntervals(parseAvametHistory(fixture("now"), now));
  const total = accumulateIntervals(
    rows,
    Date.parse("2026-10-19T15:40:00Z"),
    1060,
  );
  assert.equal(total.complete, true);
  assert.equal(total.mm, 20.8); // Reconciles to source daily total; not the sum of cumulative counters.
});
test("gaps, nulls, midnight resets and corrections are never interpreted as rainfall", () => {
  const points = parseAvametHistory(
    chart([
      [civil("2026-10-18T23:50:00"), 17],
      [civil("2026-10-19T00:00:00"), 0],
      [civil("2026-10-19T00:05:00"), 0.2],
      [civil("2026-10-19T00:10:00"), 0.4],
      [civil("2026-10-19T00:25:00"), 1],
      [civil("2026-10-19T00:30:00"), 0.1],
      [civil("2026-10-19T00:35:00"), null],
      [civil("2026-10-19T00:40:00"), 0.3],
    ]),
    now,
  );
  const rows = counterIntervals(points);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.mm),
    [0.2, 0.2],
  );
  const total = accumulateIntervals(
    rows,
    Date.parse("2026-10-18T22:40:00Z"),
    50,
  );
  assert.equal(total.mm, 0.4);
  assert.equal(total.coveredMinutes, 10);
  assert.equal(total.complete, false);
});
test("whole source intervals only: no splitting, no invented edge or gap zeroes", () => {
  const rows = [
    { start: 0, end: 300000, mm: 1 },
    { start: 300000, end: 600000, mm: 2 },
  ];
  assert.deepEqual(accumulateIntervals(rows, 600000, 10), {
    mm: 3,
    coveredMinutes: 10,
    expectedMinutes: 10,
    complete: true,
  });
  assert.equal(accumulateIntervals(rows, 540000, 8).mm, null);
  assert.equal(accumulateIntervals([], 600000, 10).mm, null);
  assert.equal(
    accumulateIntervals([{ start: 0, end: 600000, mm: 0 }], 600000, 10).mm,
    0,
  );
});
test("DST folds, future points, conflicting duplicates and changed chart timestamps fail safely", () => {
  const autumn = chart([
    [civil("2026-10-25T01:50:00"), 1],
    [civil("2026-10-25T02:00:00"), 2],
    [civil("2026-10-25T02:30:00"), 3],
    [civil("2026-10-25T03:00:00"), 4],
  ]);
  const points = parseAvametHistory(autumn, Date.parse("2026-10-25T04:00:00Z"));
  assert.equal(points.length, 2);
  assert.equal(counterIntervals(points).length, 0);
  const winter = parseAvametHistory(
    chart([
      [civil("2026-10-26T10:00:00"), 0],
      [civil("2026-10-26T10:05:00"), 0.2],
    ]),
    Date.parse("2026-10-26T12:00:00Z"),
  );
  assert.equal(winter[0].at, Date.parse("2026-10-26T09:00:00Z"));
  const duplicate = parseAvametHistory(
    chart([
      [civil("2026-10-19T12:00:00"), 0],
      [civil("2026-10-19T12:00:00"), 1],
      [civil("2026-10-19T12:05:00"), 2],
    ]),
    now,
  );
  assert.equal(duplicate[0].mm, null);
  assert.equal(counterIntervals(duplicate).length, 0);
  assert.throws(
    () =>
      parseAvametHistory(
        fixture("now").replace("19-10-2026 17:40", "19-10-2026 16:40"),
        now,
      ),
    /clock/,
  );
  assert.throws(
    () => parseAvametHistory("<html>unavailable</html>", now),
    /missing/,
  );
  assert.throws(
    () => parseAvametHistory(chart([[civil("2026-10-20T10:00:00"), 1]]), now),
    /No unambiguous/,
  );
});
test("on-demand cache coalesces requests, persists limits, applies withdrawals and preserves data on failure", async () => {
  const store = new Store(":memory:");
  let clock = now,
    calls = 0;
  let body = fixture("now");
  let status = 200;
  const request = (async () => {
    calls++;
    return new Response(body, { status });
  }) as typeof fetch;
  let history = new AvametHistory(store, request, () => clock);
  const id = "avamet:c01m038e01";
  await Promise.all([history.load(id), history.load(id)]);
  assert.equal(calls, 1);
  assert.equal(history.read(id).points.length, 820);
  await history.load(id);
  assert.equal(calls, 1);
  await assert.rejects(
    () => history.load("avamet:c15m250e39"),
    HistoryRateLimit,
  );
  history = new AvametHistory(store, request, () => clock); // restart shares the same persisted budget
  await assert.rejects(
    () => history.load("avamet:c15m250e39"),
    HistoryRateLimit,
  );
  clock += 1800001;
  status = 503;
  await history.load(id);
  assert.equal(calls, 2);
  assert.equal(history.read(id).points.length, 820);
  assert.match(history.read(id).error!, /503/);
  clock += 1800001;
  status = 200;
  const parsed = /data:(\[\[.*?\]\])/.exec(body)![1];
  const raw = JSON.parse(parsed);
  const removed = raw[400][0];
  raw.splice(400, 1);
  body = body.replace(parsed, JSON.stringify(raw));
  await history.load(id);
  assert.equal(history.read(id).points.length, 819);
  assert.ok(
    !history
      .read(id)
      .points.some(
        (p) =>
          p.at ===
          DateTime.fromMillis(removed, { zone: "UTC" })
            .setZone("Europe/Madrid", { keepLocalTime: true })
            .toMillis(),
      ),
  );
  assert.equal(store.range(0, clock).length, 0);
  assert.equal(history.read(id).error, null);
  store.db.close();
});
test("shared hourly history budget caps distinct station fetches", async () => {
  const store = new Store(":memory:");
  let clock = now,
    calls = 0;
  const history = new AvametHistory(
    store,
    (async () => {
      calls++;
      return new Response("", { status: 503 });
    }) as typeof fetch,
    () => clock,
  );
  for (let n = 0; n < 30; n++) {
    await history.load(`avamet:c01m038e${String(n).padStart(2, "0")}`);
    clock += 2000;
  }
  await assert.rejects(
    () => history.load("avamet:c01m038e99"),
    HistoryRateLimit,
  );
  assert.equal(calls, 30);
  store.db.close();
});
