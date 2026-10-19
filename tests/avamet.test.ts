import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAvamet, AvametIngestion } from "../server/avamet";
import { Store } from "../server/store";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/avamet-2026-10-19.json", import.meta.url),
    "utf8",
  ),
);
const html = (rows: unknown) => `var data = ${JSON.stringify(rows)};`;
const now = Date.parse("2026-10-19T18:00:00Z");
test("real AVAMET sample preserves daily units, coordinates, provinces and Madrid reporting time", () => {
  const gauges = parseAvamet(html(fixture), now);
  assert.deepEqual(
    gauges.map((s) => s.province),
    ["Castellón", "Valencia", "Alicante"],
  );
  assert.equal(gauges[0].dailyMm, 20.8);
  assert.equal(gauges[0].elevation, 1181);
  assert.equal(gauges[0].lat, 40.5023293);
  assert.equal(gauges[0].measuredAt, Date.parse("2026-10-19T15:15:00Z"));
  assert.equal(gauges[0].dayStart, Date.parse("2026-10-18T22:00:00Z"));
});
test("missing and invalid amounts never become zero; ambiguous/future times are excluded", () => {
  for (const prec of [null, "", "-1", "NaN", "1.2", "---"]) {
    assert.equal(
      parseAvamet(html([{ ...fixture[0], prec }]), now)[0].dailyMm,
      null,
    );
  }
  assert.equal(
    parseAvamet(html([{ ...fixture[0], prec: "0,0" }]), now)[0].dailyMm,
    0,
  );
  for (const data_ini of ["25/10/2026 02:30", "20/10/2026 10:00", "bad", 42]) {
    assert.equal(
      parseAvamet(html([{ ...fixture[0], data_ini }]), now)[0].dailyMm,
      null,
    );
  }
  assert.throws(() => parseAvamet("<html>upstream error</html>", now));
});
test("poll cache persists, throttles requests, retains last good snapshot on error and stores no interval observations", async () => {
  const store = new Store(":memory:");
  let calls = 0;
  const request = (async () => {
    calls++;
    return new Response(html(fixture));
  }) as typeof fetch;
  const ingestion = new AvametIngestion(store, request);
  await ingestion.run();
  await ingestion.run();
  assert.equal(calls, 1);
  assert.equal(ingestion.snapshot().stations.length, 3);
  assert.equal(ingestion.snapshot().stations[0].complete, false);
  assert.equal(store.range(0, Date.now()).length, 0);
  store.set("lastAttempt", 0);
  const broken = new AvametIngestion(
    store,
    (async () => new Response("unavailable", { status: 503 })) as typeof fetch,
  );
  await broken.run();
  assert.equal(broken.snapshot().stations.length, 3);
  assert.match(broken.snapshot().status.lastError!, /503/);
  store.db.close();
});
