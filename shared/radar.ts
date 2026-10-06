import { STEP } from "./types";
export const RADAR_PRODUCT = "intensity";
// Bounds used by Euskalmet's own Kapildui viewer for the 100 km products: [[S, W], [N, E]].
export const RADAR_BOUNDS: [[number, number], [number, number]] = [
  [41.864983, -3.7478],
  [43.655708, -1.2893926],
];
export const RADAR_SIZE = 800;
// A frame is only shown for timeline positions up to this long after it.
export const RADAR_MAX_AGE = 60 * 60000;
export const RADAR_LEGEND = [
  { label: "Light", colors: ["#7efb30", "#29dd15", "#00af00", "#0b5d00"] },
  { label: "Moderate", colors: ["#08fdf9", "#06a5ff", "#0056ff", "#000097"] },
  { label: "Heavy", colors: ["#fffcad", "#f6ff03", "#ffa713"] },
  { label: "Very heavy", colors: ["#ff0000", "#b90000", "#7e0008"] },
  {
    label: "Torrential",
    colors: ["#f804ed", "#b000ff", "#66009b", "#817e7e", "#020202"],
  },
];
export interface RadarStatus {
  frames: number;
  oldestFrame: number | null;
  newestFrame: number | null;
  lastAttempt: number | null;
  lastSuccess: number | null;
  lastError: string | null;
}
export interface RadarIndex {
  product: string;
  bounds: typeof RADAR_BOUNDS;
  start: number;
  end: number;
  frames: number[];
  status: RadarStatus;
}
// Newest archived frame at or before `at`, never one from the future and never older
// than RADAR_MAX_AGE. `frames` must be sorted ascending.
export function frameAt(frames: number[], at: number): number | null {
  let lo = 0,
    hi = frames.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid] <= at) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0 || at - frames[found] > RADAR_MAX_AGE) return null;
  return frames[found];
}
export function utcDayStart(ms: number) {
  return Math.floor(ms / 86400000) * 86400000;
}
export function slotName(slot: number) {
  if (slot % STEP) throw new Error("Radar slot must be on a 10-minute step");
  return new Date(slot).toISOString().slice(11, 16).replace(":", "");
}
