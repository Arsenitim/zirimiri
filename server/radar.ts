import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { Store } from "./store";
import { BASE, SourceError, requestBytes } from "./source";
import { STEP } from "../shared/types";
import {
  RADAR_PRODUCT,
  RADAR_SIZE,
  slotName,
  utcDayStart,
} from "../shared/radar";
// The "Sin datos / Ez dago daturik" image Euskalmet serves with HTTP 200 for missing slots.
export const PLACEHOLDER_SHA256 =
  "5785b34e3d7f8d761fc8ceb34ce9dc1b23025c369ac585df167087f736d7cc19";
const FOLDERS = ["today", "yesterday", "before_yesterday"] as const;
export type Folder = (typeof FOLDERS)[number];
export type FrameCheck =
  { ok: true; sha256: string } | { ok: false; reason: string };
// Real frames are 8-bit RGBA with fully transparent corners outside the radar circle.
// The placeholder (and anything else that is not a radar frame) fails these checks.
export function inspectFrame(bytes: Uint8Array, size = RADAR_SIZE): FrameCheck {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 === PLACEHOLDER_SHA256) return { ok: false, reason: "no data" };
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    buf.length < 33 ||
    !buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { ok: false, reason: "not a PNG" };
  let offset = 8,
    width = 0,
    height = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset),
      type = buf.toString("latin1", offset + 4, offset + 8),
      data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      // bit depth 8, colour type 6 (RGBA), no interlace
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
        return { ok: false, reason: "unexpected PNG format" };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (width !== size || height !== size)
    return { ok: false, reason: `unexpected size ${width}×${height}` };
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return { ok: false, reason: "corrupt PNG" };
  }
  const stride = width * 4;
  if (raw.length !== height * (stride + 1))
    return { ok: false, reason: "corrupt PNG" };
  let prev = Buffer.alloc(stride),
    first: Buffer | null = null;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)],
      line = Buffer.from(
        raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      );
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0,
        b = prev[x],
        c = x >= 4 ? prev[x - 4] : 0;
      if (filter === 1) line[x] += a;
      else if (filter === 2) line[x] += b;
      else if (filter === 3) line[x] += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        line[x] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) return { ok: false, reason: "corrupt PNG" };
    }
    if (y === 0) first = line;
    prev = line;
  }
  const alpha = [first![3], first![stride - 1], prev[3], prev[stride - 1]];
  if (alpha.some((v) => v !== 0))
    return { ok: false, reason: "not a radar frame" };
  return { ok: true, sha256 };
}
export type FetchFrame = (folder: Folder, slot: number) => Promise<Uint8Array>;
export const viewerFrame: FetchFrame = (folder, slot) =>
  requestBytes(
    `${BASE}/vamet/radar_kapildui_detail/${RADAR_PRODUCT}/${folder}/webmet00-${slotName(slot)}.png`,
  );
export class RadarIngestion {
  running = false;
  // Slots that returned no frame, and when. In memory only: a restart simply re-checks.
  private missing = new Map<number, number>();
  constructor(
    public store: Store,
    private fetchFrame: FetchFrame = viewerFrame,
  ) {}
  async run(now = Date.now()) {
    if (this.running) return;
    this.running = true;
    this.store.set("radarLastAttempt", now);
    let failures = 0,
      lastError: string | null = null;
    try {
      const today = utcDayStart(now);
      // If `today` still holds an earlier UTC day, a slot that has not happened yet
      // would return a real frame. Skip until the folders have rolled over.
      const probe = Math.floor(now / STEP) * STEP + 4 * STEP;
      if (probe < today + 86400000) {
        const check = inspectFrame(await this.fetchFrame("today", probe));
        if (check.ok)
          throw new Error(
            "Radar 'today' folder holds a future slot; waiting for rollover",
          );
      }
      for (const [index, folder] of FOLDERS.entries()) {
        const day = today - index * 86400000;
        for (let slot = day; slot < day + 86400000; slot += STEP) {
          // Publication takes at least ~30 minutes; nothing newer can exist yet.
          if (slot > now - 15 * 60000) break;
          if (this.store.hasRadarFrame(RADAR_PRODUCT, slot)) continue;
          const checked = this.missing.get(slot);
          if (checked && now - checked < 3600000 && now - slot > 3600000)
            continue;
          let bytes: Uint8Array;
          try {
            bytes = await this.fetchFrame(folder, slot);
          } catch (e) {
            failures++;
            lastError = e instanceof Error ? e.message : "Radar request failed";
            if (
              failures >= 5 ||
              (e instanceof SourceError && [401, 403, 429].includes(e.status))
            )
              throw e;
            continue;
          }
          const check = inspectFrame(bytes);
          if (!check.ok) {
            this.missing.set(slot, now);
            // Frames are published in order: stop at the first recent unpublished slot
            // instead of downloading a placeholder for every newer one.
            if (now - slot < 3600000) break;
            continue;
          }
          this.missing.delete(slot);
          this.store.saveRadarFrame(RADAR_PRODUCT, slot, bytes, check.sha256);
          this.store.set("radarLastSuccess", Date.now());
        }
      }
      for (const slot of this.missing.keys())
        if (slot < today - 2 * 86400000) this.missing.delete(slot);
      this.store.pruneRadar(
        Number(process.env.RADAR_RETENTION_DAYS) || 15,
        now,
      );
    } catch (e) {
      failures = Math.max(1, failures);
      lastError = e instanceof Error ? e.message : "Radar ingestion failed";
    } finally {
      this.store.set("radarLastError", failures ? lastError : null);
      this.running = false;
    }
    return failures;
  }
  start() {
    const poll = async () => {
      const failures = await this.run();
      setTimeout(
        poll,
        Math.max(5, Number(process.env.RADAR_POLL_MINUTES) || 10) *
          60000 *
          (failures ? 2 : 1),
      ).unref();
    };
    void poll();
  }
}
