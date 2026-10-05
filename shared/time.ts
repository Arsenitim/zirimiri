import { DateTime } from "luxon";
import { STEP } from "./types";
export const ZONE = "Europe/Madrid";
export function formatTime(ms: number) {
  const dt = DateTime.fromMillis(ms, { zone: ZONE, locale: "en-GB" });
  return `${dt.toFormat("dd LLL yyyy · HH:mm")} ${dt.isInDST ? "CEST" : "CET"}`;
}
export function dayKey(ms: number) {
  return DateTime.fromMillis(ms, { zone: ZONE }).toISODate()!;
}
// Viewer keys contain only local HH:mm. Refuse to choose either fold at DST fallback.
export function localSlot(day: string, clock: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(clock))
    return null;
  const dt = DateTime.fromISO(`${day}T${clock}`, { zone: ZONE });
  if (
    !dt.isValid ||
    dt.toFormat("yyyy-MM-dd HH:mm") !== `${day} ${clock}` ||
    dt.getPossibleOffsets().length !== 1
  )
    return null;
  return dt.toMillis();
}
export function timelineEnd(now = Date.now()) {
  return Math.floor(now / STEP) * STEP;
}
