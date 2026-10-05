// A fixed pixel cap keeps unusually large multi-gauge sums from taking over the timeline.
// Area rises with measured rainfall; it is an activity cue, never a regional rainfall estimate.
export function activityRadius(totalMm: number): number {
  return Math.min(6, 1.5 + Math.sqrt(Math.max(0, totalMm)) * 0.6);
}
