import { useEffect, useRef, useState } from "react";
import { activityRadius } from "../shared/activity";
import { STEP, type RainActivity } from "../shared/types";
import { formatTime } from "../shared/time";
export function RainActivityTrack({
  points,
  start,
  end,
  eligible,
  onSelect,
}: {
  points: RainActivity[] | null;
  start: number;
  end: number;
  eligible: number;
  onSelect: (end: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<RainActivity | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const x = (at: number) =>
    8 + ((at - start) / (end - start)) * Math.max(0, width - 16);
  return (
    <div className="rain-activity" ref={ref}>
      <svg
        width="100%"
        height="26"
        role="img"
        aria-label={
          points === null
            ? "Rain activity unavailable"
            : `${points.length} ten-minute intervals had recorded rain. Dot size is the sum of measured amounts across stations, capped at 12 pixels diameter. A missing dot does not confirm dry weather.`
        }
        onPointerLeave={() => setHovered(null)}
      >
        <g aria-hidden="true">
          {points?.map((point) => (
            <circle
              className="activity-dot"
              key={point.end}
              cx={x(point.end)}
              cy="13"
              r={activityRadius(point.totalMm)}
              fill="#347b64"
              fillOpacity=".65"
              onPointerEnter={() => setHovered(point)}
              onClick={() => onSelect(point.end)}
            >
              <title>
                {formatTime(point.end - STEP)} – {formatTime(point.end)} ·{" "}
                {point.totalMm} mm summed across {point.wetStations} wet{" "}
                {point.wetStations === 1 ? "gauge" : "gauges"}·{" "}
                {point.availableStations}/{eligible} gauges available
              </title>
            </circle>
          ))}
        </g>
      </svg>
      {hovered && (
        <div
          className="activity-tooltip"
          style={{
            left: Math.max(0, Math.min(width - 230, x(hovered.end) - 115)),
          }}
        >
          <strong>
            {formatTime(hovered.end - STEP)} → {formatTime(hovered.end)}
          </strong>
          <span>
            {hovered.totalMm.toLocaleString("en-GB", {
              maximumFractionDigits: 2,
            })}{" "}
            mm summed across {hovered.wetStations} wet{" "}
            {hovered.wetStations === 1 ? "gauge" : "gauges"}
          </span>
          <span>
            {hovered.availableStations}/{eligible} gauges available · click to
            select
          </span>
        </div>
      )}
    </div>
  );
}
