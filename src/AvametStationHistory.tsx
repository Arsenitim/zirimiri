import { useEffect, useState } from "react";
import { formatTime } from "../shared/time";
import { accumulateIntervals, type GaugeHistory } from "../shared/intervals";
const presets = [10, 30, 60, 180, 360, 720, 1440, 2880];
const duration = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);
export function AvametStationHistory({ stationId }: { stationId: string }) {
  const [history, setHistory] = useState<GaugeHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [custom, setCustom] = useState("60");
  const [customMode, setCustomMode] = useState(false);
  const [end, setEnd] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now);
  const [retryAt, setRetryAt] = useState(0);
  const url = `/api/regions/valencia/stations/${encodeURIComponent(stationId)}/history`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("History cache unavailable");
        return r.json();
      })
      .then((data: GaugeHistory) => {
        setHistory(data);
        setEnd(data.points.at(-1)?.at ?? null);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setRetryAt(data.retryAt || 0);
        throw new Error(data.error || "History unavailable");
      }
      setHistory(data);
      setEnd(data.points.at(-1)?.at ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const rows = history?.intervals || [];
  const latest = history?.points.at(-1)?.at ?? null;
  const earliest = history?.points[0]?.at ?? null;
  const min =
    latest === null || earliest === null
      ? null
      : Math.max(earliest, latest - 14 * 86400000);
  const total = end === null ? null : accumulateIntervals(rows, end, minutes);
  const cooldown = Math.max(0, Math.ceil((retryAt - clock) / 1000));
  const cached =
    !!history?.lastAttempt && clock - history.lastAttempt < 1800000;
  const firstLoad = !history?.points.length;
  return (
    <section
      className="avamet-history"
      aria-label="Selected station rainfall history"
    >
      <h3>Station history & rolling sums</h3>
      <p className="small">
        These controls apply to this station. Map circles continue to show daily
        rain. Public charts provide about five days; older history grows only
        when this station is loaded again.
      </p>
      <button onClick={load} disabled={loading || cooldown > 0 || cached}>
        {loading
          ? "Loading source chart…"
          : cooldown
            ? `Retry in ${cooldown}s`
            : cached
              ? "History cached · refresh after 30 min"
              : firstLoad
                ? "Load history & rolling sums"
                : "Refresh station history"}
      </button>
      {(error || history?.error) && (
        <p className="field-error" role="alert">
          {error || history?.error}
        </p>
      )}
      {total && min !== null && latest !== null && end !== null && (
        <>
          <div className="avamet-history-controls">
            <label htmlFor="avamet-window">ROLLING ACCUMULATION</label>
            <select
              id="avamet-window"
              value={customMode ? "custom" : minutes}
              onChange={(e) => {
                setCustomMode(e.target.value === "custom");
                if (e.target.value !== "custom") {
                  setMinutes(Number(e.target.value));
                  setCustom(e.target.value);
                }
              }}
            >
              {presets.map((m) => (
                <option key={m} value={m}>
                  {duration(m)}
                </option>
              ))}
              <option value="custom">Custom duration</option>
            </select>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(custom);
                if (!Number.isInteger(n) || n < 10 || n > 2880 || n % 10) {
                  setError("Use 10–2880 minutes in steps of 10.");
                  return;
                }
                setError("");
                setMinutes(n);
                setCustomMode(true);
              }}
            >
              <input
                aria-label="Station custom duration in minutes"
                type="number"
                min="10"
                max="2880"
                step="10"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <span> min </span>
              <button>Set</button>
            </form>
          </div>
          <div className="station-total">
            <strong>{total.mm ?? "—"}</strong>
            <span>
              mm ·{" "}
              {total.complete ? "complete rolling sum" : "partial measured sum"}
            </span>
          </div>
          <p
            className={`coverage ${total.complete ? "rain" : "partial"}`}
            aria-live="polite"
          >
            {total.coveredMinutes.toLocaleString("en-GB", {
              maximumFractionDigits: 1,
            })}
            /{minutes} minutes covered.{" "}
            {total.complete
              ? "All required time covered."
              : "Missing time is never filled or scaled."}
          </p>
          <p className="small">
            {formatTime(end - minutes * 60000)} → {formatTime(end)}
          </p>
          <label htmlFor="avamet-timeline">
            WINDOW ENDS · {formatTime(end)}
          </label>
          <input
            id="avamet-timeline"
            aria-label="Station historical window end time"
            type="range"
            min={min}
            max={latest}
            step="60000"
            value={end}
            onChange={(e) => setEnd(Number(e.target.value))}
            aria-valuetext={formatTime(end)}
          />
          <div className="avamet-time-actions">
            <button
              onClick={() => setEnd(Math.max(min, end - 600000))}
              disabled={end <= min}
            >
              ‹ 10 min
            </button>
            <button onClick={() => setEnd(latest)}>Latest reading ↗</button>
            <button
              onClick={() => setEnd(Math.min(latest, end + 600000))}
              disabled={end >= latest}
            >
              10 min ›
            </button>
          </div>
          <HistoryChart
            history={history!}
            min={min}
            latest={latest}
            end={end}
            minutes={minutes}
            onSelect={setEnd}
          />
          <p className="small">
            {formatTime(min)} → {formatTime(latest)}. Source samples are usually
            5–10 minutes apart, sometimes irregular. Only whole, consecutive
            measured intervals are summed. Midnight resets, source gaps and
            corrections leave gaps; edge intervals are not split.
          </p>
          <small>
            Chart fetched:{" "}
            {history?.fetchedAt ? formatTime(history.fetchedAt) : "never"}. Raw
            chart clocks are converted to Europe/Madrid; ambiguous DST readings
            are excluded.
          </small>
        </>
      )}
      {!total && !loading && !error && !history?.error && (
        <p className="small">
          Load the public chart for this gauge to explore recent measured
          rainfall. Requests are cached for 30 minutes and shared by all
          visitors.
        </p>
      )}
    </section>
  );
}
function HistoryChart({
  history,
  min,
  latest,
  end,
  minutes,
  onSelect,
}: {
  history: GaugeHistory;
  min: number;
  latest: number;
  end: number;
  minutes: number;
  onSelect: (end: number) => void;
}) {
  const rows = history.intervals.filter(
    (r) => r.start >= min && r.end <= latest,
  );
  const width = 320,
    height = 95,
    span = Math.max(60000, latest - min);
  const x = (at: number) => ((at - min) / span) * width;
  const max = Math.max(0.2, ...rows.map((r) => r.mm));
  return (
    <div className="rain-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Measured rainfall amounts between consecutive source counter readings. Gaps are missing; click a bar to select its end time."
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const at = min + ((e.clientX - rect.left) / rect.width) * span;
          const nearest = rows.reduce<(typeof rows)[number] | null>(
            (best, r) =>
              best === null || Math.abs(r.end - at) < Math.abs(best.end - at)
                ? r
                : best,
            null,
          );
          if (nearest) onSelect(nearest.end);
        }}
      >
        <rect width={width} height={height} fill="#edf2ee" />
        <rect
          x={Math.max(0, x(end - minutes * 60000))}
          width={Math.max(0, x(end) - Math.max(0, x(end - minutes * 60000)))}
          height={height}
          fill="#d4ce9e"
        />
        {rows.map((r) => (
          <rect
            key={r.start}
            x={x(r.start)}
            width={Math.max(0.3, x(r.end) - x(r.start))}
            y={height - 12 - Math.max(1, (r.mm / max) * 70)}
            height={Math.max(1, (r.mm / max) * 70)}
            fill="#297c69"
          >
            <title>
              {formatTime(r.start)} → {formatTime(r.end)} · {r.mm} mm
            </title>
          </rect>
        ))}
        <text x="4" y="11" fontSize="9" fill="#48675a">
          {max} mm / source interval
        </text>
      </svg>
    </div>
  );
}
