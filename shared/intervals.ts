export interface MeasuredInterval {
  start: number;
  end: number;
  mm: number;
}
export interface IntervalTotal {
  mm: number | null;
  coveredMinutes: number;
  expectedMinutes: number;
  complete: boolean;
}
// Sum whole measured intervals only. Never split a measurement at a window edge.
export function accumulateIntervals(
  rows: MeasuredInterval[],
  end: number,
  minutes: number,
): IntervalTotal {
  const start = end - minutes * 60000;
  let mm = 0,
    covered = 0,
    previous = start;
  for (const r of [...rows].sort((a, b) => a.start - b.start)) {
    if (
      r.start < start ||
      r.end > end ||
      r.end <= r.start ||
      r.start < previous ||
      !Number.isFinite(r.mm) ||
      r.mm < 0
    )
      continue;
    mm += r.mm;
    covered += r.end - r.start;
    previous = r.end;
  }
  return {
    mm: covered ? Math.round(mm * 1000) / 1000 : null,
    coveredMinutes: covered / 60000,
    expectedMinutes: minutes,
    complete: covered === minutes * 60000,
  };
}
export interface CounterPoint {
  at: number;
  mm: number | null;
  day: string;
}
export interface GaugeHistory {
  stationId: string;
  points: CounterPoint[];
  intervals: MeasuredInterval[];
  fetchedAt: number | null;
  lastAttempt: number | null;
  error: string | null;
}
