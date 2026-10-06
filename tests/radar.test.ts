import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import { Store } from "../server/store";
import { RadarIngestion, inspectFrame, type Folder } from "../server/radar";
import { RADAR_MAX_AGE, frameAt, slotName } from "../shared/radar";
import { STEP } from "../shared/types";
function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]),
    out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
// RGBA PNG, every pixel `fill` except a solid echo block in the middle.
function png(size = 800, fill = [0, 0, 0, 0]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = y % 5; // exercise every filter type on unfiltered data
    for (let x = 0; x < size; x++) {
      const echo = Math.abs(x - size / 2) < 40 && Math.abs(y - size / 2) < 40;
      const px = echo ? [0, 170, 0, 255] : fill;
      px.forEach((v, i) => (raw[y * (size * 4 + 1) + 1 + x * 4 + i] = v));
    }
  }
  // Filter rows so decoding must undo Sub/Up/Average/Paeth correctly.
  const stride = size * 4,
    filtered = Buffer.from(raw);
  for (let y = 0; y < size; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x],
        a = x >= 4 ? raw[y * (stride + 1) + 1 + x - 4] : 0,
        b = y ? raw[(y - 1) * (stride + 1) + 1 + x] : 0,
        c = y && x >= 4 ? raw[(y - 1) * (stride + 1) + 1 + x - 4] : 0;
      const p = a + b - c,
        paeth =
          Math.abs(p - a) <= Math.abs(p - b) &&
          Math.abs(p - a) <= Math.abs(p - c)
            ? a
            : Math.abs(p - b) <= Math.abs(p - c)
              ? b
              : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][f];
      filtered[y * (stride + 1) + 1 + x] = (cur - pred) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filtered)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const frame = png(),
  noData = png(800, [0, 0, 0, 91]);
test("radar frames need RGBA PNG, expected size and transparent corners", () => {
  assert.equal(inspectFrame(frame).ok, true);
  assert.deepEqual(inspectFrame(noData), {
    ok: false,
    reason: "not a radar frame",
  });
  assert.equal(inspectFrame(png(600)).ok, false);
  assert.equal(inspectFrame(Buffer.from("<html>error</html>")).ok, false);
  assert.equal(inspectFrame(frame.subarray(0, 200)).ok, false);
});
test("frame selection never uses a future frame or one older than the limit", () => {
  const frames = [0, STEP, 3 * STEP];
  assert.equal(frameAt(frames, -1), null);
  assert.equal(frameAt(frames, 0), 0);
  assert.equal(frameAt(frames, 2 * STEP), STEP);
  assert.equal(frameAt(frames, 3 * STEP + RADAR_MAX_AGE), 3 * STEP);
  assert.equal(frameAt(frames, 3 * STEP + RADAR_MAX_AGE + 1), null);
  assert.equal(frameAt([], 0), null);
});
test("slot names are UTC HHMM", () => {
  assert.equal(slotName(Date.UTC(2026, 9, 6, 16, 0)), "1600");
  assert.equal(slotName(Date.UTC(2026, 9, 6, 0, 50)), "0050");
  assert.throws(() => slotName(Date.UTC(2026, 9, 6, 0, 55)));
});
const day = Date.UTC(2026, 9, 6),
  now = day + 16 * 3600000 + 39 * 60000; // 16:39 UTC
// Fake source: real frames up to `published` (absolute UTC), placeholder afterwards.
function source(published: number, offsetDays = 0) {
  const calls: string[] = [];
  const fetch = async (folder: Folder, slot: number) => {
    calls.push(`${folder}/${slotName(slot)}`);
    // The slot the folder actually holds; offsetDays simulates a stale rollover.
    const actual = slot - offsetDays * 86400000;
    return actual <= published ? frame : noData;
  };
  return { fetch, calls };
}
test("archives three UTC days, stops at the newest unpublished slot and never stores placeholders", async () => {
  const store = new Store(":memory:"),
    { fetch, calls } = source(day + 16 * 3600000);
  const radar = new RadarIngestion(store, fetch);
  assert.equal(await radar.run(now), 0);
  const slots = store.radarSlots("intensity", 0, now);
  assert.equal(slots.length, 2 * 144 + 16 * 6 + 1);
  assert.equal(slots[0], day - 2 * 86400000);
  assert.equal(slots.at(-1), day + 16 * 3600000);
  // One probe, the 16:10 placeholder, then nothing newer from today.
  assert.equal(calls.filter((c) => c.startsWith("today/161")).length, 1);
  assert.equal(calls.includes("today/1620"), false);
  calls.length = 0;
  await radar.run(now + 60000);
  // Only the probe and the still-unpublished slot are requested again.
  assert.deepEqual(calls, ["today/1720", "today/1610"]);
  assert.equal(store.radarStatus("intensity").lastError, null);
  store.db.close();
});
test("archived frames are immutable and pruned only by retention", async () => {
  const store = new Store(":memory:");
  const slot = day + 12 * 3600000;
  assert.equal(store.saveRadarFrame("intensity", slot, frame, "a"), true);
  assert.equal(store.saveRadarFrame("intensity", slot, noData, "b"), false);
  assert.equal(store.radarFrame("intensity", slot)!.sha256, "a");
  store.pruneRadar(15, slot + 15 * 86400000);
  assert.equal(store.radarFrame("intensity", slot)!.sha256, "a");
  store.pruneRadar(15, slot + 15 * 86400000 + 1);
  assert.equal(store.radarFrame("intensity", slot), null);
  store.db.close();
});
test("a 'today' folder that has not rolled over is not archived under the new date", async () => {
  const store = new Store(":memory:"),
    justAfterMidnight = day + 10 * 60000;
  // Folders still hold the previous UTC day: today/0050 returns yesterday's real frame.
  const { fetch } = source(day - 1, 1);
  const radar = new RadarIngestion(store, fetch);
  assert.equal(await radar.run(justAfterMidnight), 1);
  assert.equal(store.radarStatus("intensity").frames, 0);
  assert.match(store.radarStatus("intensity").lastError!, /rollover/);
  store.db.close();
});
