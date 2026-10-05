import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import { RainActivityTrack } from "./RainActivity";
import { rainColor, RAIN_LEGEND } from "../shared/rain-scale";
import { formatTime, timelineEnd } from "../shared/time";
import {
  STEP,
  type Snapshot,
  type RainActivity,
  type StationTotal,
  type Observation,
} from "../shared/types";
const PRESETS = [10, 30, 60, 180, 360, 720, 1440, 2880];
const durationLabel = (m: number) =>
  m < 60 ? `${m} min` : `${m / 60} ${m === 60 ? "hour" : "hours"}`;
const mm = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
const stateLabel = (s: StationTotal) =>
  s.state === "none"
    ? "No data"
    : s.state === "partial"
      ? "Incomplete"
      : s.state === "zero"
        ? "Confirmed zero"
        : "Measured rainfall";
function App() {
  const [end, setEnd] = useState(timelineEnd),
    [anchor, setAnchor] = useState(timelineEnd),
    [minutes, setMinutes] = useState(60);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<RainActivity[] | null>(null),
    [activityError, setActivityError] = useState("");
  const [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [playing, setPlaying] = useState(false),
    [custom, setCustom] = useState("60");
  const [customMode, setCustomMode] = useState(false);
  const [customError, setCustomError] = useState(""),
    [observations, setObservations] = useState<Observation[]>([]),
    [chartError, setChartError] = useState(""),
    [chartLoading, setChartLoading] = useState(false);
  const [refresh, setRefresh] = useState(0),
    [tileError, setTileError] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    markerGroup = useRef<L.LayerGroup | null>(null),
    initialTime = useRef(true);
  const min = anchor - 14 * 86400000;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/activity?end=${anchor}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Rain activity unavailable");
        return r.json();
      })
      .then((data) => {
        setActivity(data.points);
        setActivityError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setActivity(null);
          setActivityError("Rain activity unavailable");
        }
      });
    return () => controller.abort();
  }, [anchor, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = timelineEnd();
      setAnchor(next);
      setEnd((e) => Math.max(next - 14 * 86400000, e));
      setRefresh((r) => r + 1);
    }, 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(
      () => {
        fetch(`/api/stations?end=${end}&minutes=${minutes}`, {
          signal: controller.signal,
        })
          .then(async (r) => {
            if (!r.ok)
              throw new Error((await r.json()).error || "Request failed");
            return r.json();
          })
          .then((data: Snapshot) => {
            setSnapshot(data);
            setError("");
            setLoading(false);
            if (initialTime.current && data.status.newestMeasurement) {
              initialTime.current = false;
              setEnd(
                Math.max(min, Math.min(anchor, data.status.newestMeasurement)),
              );
            }
          })
          .catch((e) => {
            if (e.name !== "AbortError") {
              setError(e.message || "Cannot reach the server");
              setLoading(false);
            }
          });
      },
      playing ? 0 : 90,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [end, minutes, refresh, playing]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setEnd((t) => {
          if (t + STEP >= anchor) {
            setPlaying(false);
            return anchor;
          }
          return t + STEP;
        }),
      1000,
    );
    return () => clearInterval(timer);
  }, [playing, anchor]);
  useEffect(() => {
    if (!mapRef.current) return;
    const m = L.map(mapRef.current, {
      center: [43.263, -2.935],
      zoom: 11,
      zoomControl: false,
    });
    map.current = m;
    L.control.zoom({ position: "bottomleft" }).addTo(m);
    L.tileLayer(
      import.meta.env.VITE_TILE_URL ||
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          import.meta.env.VITE_TILE_ATTRIBUTION ||
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
        keepBuffer: 1,
      },
    )
      .on("tileerror", () => setTileError(true))
      .addTo(m);
    markerGroup.current = L.layerGroup().addTo(m);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(mapRef.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const group = markerGroup.current;
    if (!group || !snapshot) return;
    group.clearLayers();
    // Do not render previous-window totals while a changed window is loading.
    const current =
      snapshot.end === end && snapshot.start === end - minutes * 60000;
    for (const s of snapshot.stations) {
      const name = s.name.replace(/[&<>"']/g, "");
      const n = current ? s.mm : null,
        state = current ? s.state : "none";
      const size = n === null ? 22 : Math.min(44, 22 + Math.sqrt(n) * 3);
      const badge =
        state === "none"
          ? "×"
          : state === "partial"
            ? "!"
            : n === 0
              ? "0"
              : mm(n);
      const icon = L.divIcon({
        className: "station-marker-wrap",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<button class="station-marker ${state} ${s.stale ? "stale" : ""} ${s.id === selected ? "selected" : ""}" style="width:${size}px;height:${size}px;background:${n === null ? "#f0f1ed" : rainColor(n)};color:${n !== null && n >= 5 ? "white" : "#133e36"}" aria-label="${name}: ${current ? stateLabel(s) : "Loading"}; ${n === null ? "no measured total" : `${mm(n)} millimetres; ${s.available}/${s.expected} intervals`}${s.stale ? "; stale" : ""}">${badge}</button>`,
      });
      L.marker([s.lat, s.lon], { icon, keyboard: false })
        .on("click", () => setSelected(s.id))
        .addTo(group);
    }
  }, [snapshot, selected, end, minutes]);
  useEffect(() => {
    if (!selected) {
      setObservations([]);
      return;
    }
    const controller = new AbortController();
    setObservations([]);
    setChartLoading(true);
    setChartError("");
    fetch(`/api/stations/${selected}/observations`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error("Station history unavailable");
        return r.json();
      })
      .then((d) => {
        setObservations(d.observations);
        setChartLoading(false);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setChartError(e.message);
          setChartLoading(false);
        }
      });
    return () => controller.abort();
  }, [selected, refresh]);
  const station = snapshot?.stations.find((s) => s.id === selected),
    ready =
      !!snapshot &&
      snapshot.end === end &&
      snapshot.start === end - minutes * 60000;
  const matches =
    snapshot?.stations.filter((s) =>
      `${s.name} ${s.id} ${s.municipality}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  function choose(s: StationTotal) {
    setSelected(s.id);
    setSearch("");
    map.current?.setView([s.lat, s.lon], 12);
  }
  function step(delta: number) {
    setPlaying(false);
    setEnd((t) => Math.max(min, Math.min(anchor, t + delta * STEP)));
  }
  const status = snapshot?.status;
  const activityAtEnd = activity?.find((point) => point.end === end);
  return (
    <main>
      <header>
        <a className="brand" href="/" aria-label="zirimiri home">
          <span className="brand-icon">╱╱╱</span>
          <span>
            zirimiri<small>drizzle, measured.</small>
          </span>
        </a>
        <div className="header-note">
          <span className="live-dot" /> Euskalmet station observations
        </div>
        <a
          className="about"
          href="https://github.com/Arsenitim/zirimiri/blob/main/docs/data-source.md"
          target="_blank"
          rel="noreferrer"
        >
          About the data ↗
        </a>
      </header>
      <section className="map-area" aria-label="Station map">
        <div ref={mapRef} className="map" />
        <div className="map-tools">
          <div className="search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Search precipitation stations"
              placeholder="Find a station…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button aria-label="Clear search" onClick={() => setSearch("")}>
                ×
              </button>
            )}
            {search && (
              <div className="search-results">
                {matches.length ? (
                  matches.slice(0, 12).map((s) => (
                    <button key={s.id} onClick={() => choose(s)}>
                      <strong>{s.name}</strong>
                      <small>
                        {s.id} · {s.municipality}
                      </small>
                    </button>
                  ))
                ) : (
                  <p>No eligible stations match.</p>
                )}
              </div>
            )}
          </div>
          <div className="map-actions">
            <button onClick={() => map.current?.setView([43.263, -2.935], 11)}>
              ⌖ Back to Bilbao
            </button>
            <button
              onClick={() =>
                map.current?.fitBounds([
                  [42.55, -3.5],
                  [43.5, -1.65],
                ])
              }
            >
              All Euskadi ↗
            </button>
          </div>
        </div>
        <div className="map-count" aria-live="polite">
          <strong>{snapshot?.stations.length ?? "—"}</strong> eligible gauges{" "}
          <span />{" "}
          <strong>
            {ready ? snapshot.stations.filter((s) => s.complete).length : "—"}
          </strong>{" "}
          complete in this window {loading && <small>· updating</small>}
        </div>
        <div className="legend">
          <strong>
            Accumulated rain <span>mm</span>
          </strong>
          <div className="rain-scale">
            {RAIN_LEGEND.map(({ value: n, label }) => (
              <div key={n}>
                <i style={{ background: rainColor(n) }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="legend-states">
            <span>
              <i className="key partial">!</i> Incomplete
            </span>
            <span>
              <i className="key none">×</i> No data
            </span>
            <span>
              <i className="key stale" /> Stale (&gt;1h)
            </span>
          </div>
          <small>0 = confirmed zero · rings flag data age</small>
        </div>
        {tileError && (
          <div className="tile-warning">
            Base map tiles unavailable. Station locations remain factual.
          </div>
        )}
        {station && (
          <aside className="station-panel" aria-label="Station details">
            <button
              className="close"
              aria-label="Close station details"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <div className="eyebrow">STATION {station.id}</div>
            <h2>{station.name}</h2>
            <p>
              {station.municipality} · {station.province}
            </p>
            <div className="station-total">
              <strong>{ready ? mm(station.mm) : "…"}</strong>
              <span>mm {station.complete ? "accumulated" : "measured"}</span>
            </div>
            <div className={`coverage ${ready ? station.state : "none"}`}>
              {ready ? stateLabel(station) : "Updating window…"}
              {ready && (
                <span>
                  {station.available}/{station.expected} intervals available
                </span>
              )}
            </div>
            <p className="small">
              {ready && !station.complete
                ? "Partial totals are not estimates. Missing readings are never counted as zero."
                : "Temporal coverage is complete only when every required interval is available."}
            </p>
            <dl>
              <dt>Coordinates</dt>
              <dd>
                {station.lat.toFixed(5)}, {station.lon.toFixed(5)}
              </dd>
              <dt>Elevation</dt>
              <dd>
                {station.elevation === null
                  ? "Not published"
                  : `${station.elevation} m`}
              </dd>
              <dt>Sensor ID</dt>
              <dd>{station.sensorId ?? "Not published"}</dd>
              <dt>Gauge height</dt>
              <dd>
                {station.sensorHeight === null
                  ? "Not published"
                  : `${station.sensorHeight} m`}
              </dd>
              <dt>Latest interval ended</dt>
              <dd>
                {station.latest ? formatTime(station.latest) : "No measurement"}
              </dd>
              <dt>Measurement age</dt>
              <dd>
                {station.latest
                  ? `${Math.max(0, Math.floor((Date.now() - station.latest) / 60000))} min${station.stale ? " · stale" : ""}`
                  : "Unknown"}
              </dd>
              <dt>Quality</dt>
              <dd>
                Provisional · source not fully validated
                {ready && station.qualityIssues > 0
                  ? ` · ${station.qualityIssues} invalid slots`
                  : ""}
              </dd>
            </dl>
            <h3>
              Last 14 days <span>10-minute rain · mm</span>
            </h3>
            {chartLoading ? (
              <p>Loading measured intervals…</p>
            ) : chartError ? (
              <p role="alert">{chartError}</p>
            ) : (
              <RainChart
                observations={observations}
                start={min}
                end={anchor}
                windowStart={end - minutes * 60000}
                windowEnd={end}
              />
            )}
            <p className="small">
              Shading marks the selected window. Gaps are missing data. Autumn's
              repeated local hour is excluded if the source cannot distinguish
              it.
            </p>
            <a
              href={
                "https://www.euskalmet.euskadi.eus/observacion/datos-de-estaciones/"
              }
              target="_blank"
              rel="noreferrer"
            >
              Euskalmet station viewer ↗
            </a>
            <small className="source-note">
              Euskalmet / Basque Government · station {station.id}. Select this
              ID in the official viewer.
            </small>
          </aside>
        )}
        {!snapshot && !error && (
          <div className="map-empty" role="status">
            Connecting to measured rainfall…
          </div>
        )}
        {snapshot?.stations.length === 0 && (
          <div className="map-empty">
            {status?.running
              ? "Discovering precipitation sensors…"
              : "No verified precipitation stations yet."}
            <small>Source measurements appear as ingestion completes.</small>
          </div>
        )}
      </section>
      <section className="controls" aria-label="Historical rainfall controls">
        <div className="window-control">
          <label htmlFor="window">ROLLING ACCUMULATION</label>
          <select
            id="window"
            value={customMode ? "custom" : minutes}
            onChange={(e) => {
              setCustomMode(e.target.value === "custom");
              if (e.target.value !== "custom")
                setMinutes(Number(e.target.value));
            }}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {durationLabel(p)}
              </option>
            ))}
            <option value="custom">Custom duration</option>
          </select>
          <form
            className="custom"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(custom);
              if (
                !Number.isInteger(value) ||
                value % 10 ||
                value < 10 ||
                value > 2880
              ) {
                setCustomError("Use 10–2880 minutes in steps of 10.");
                return;
              }
              setMinutes(value);
              setCustomMode(true);
              setCustomError("");
            }}
          >
            <input
              type="number"
              aria-label="Custom duration in minutes"
              min="10"
              max="2880"
              step="10"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <span>min</span>
            <button aria-label="Apply custom duration">Set</button>
          </form>
          {customError && (
            <span className="field-error" role="alert">
              {customError}
            </span>
          )}
        </div>
        <div className="timeline">
          <div className="timeline-top">
            <label htmlFor="timeline">
              WINDOW ENDS <strong>{formatTime(end)}</strong>
            </label>
            <button
              className="now"
              onClick={() => {
                setPlaying(false);
                setEnd(
                  Math.max(
                    min,
                    Math.min(anchor, status?.newestMeasurement ?? anchor),
                  ),
                );
              }}
            >
              Latest ↗
            </button>
          </div>
          <RainActivityTrack
            points={activity}
            start={min}
            end={anchor}
            eligible={snapshot?.stations.length ?? 0}
            onSelect={(t) => {
              setPlaying(false);
              setEnd(t);
            }}
          />
          <div className="scrub">
            <button
              aria-label="Previous 10 minutes"
              disabled={end <= min}
              onClick={() => step(-1)}
            >
              ‹
            </button>
            <button
              className={`play ${playing ? "active" : ""}`}
              aria-label={
                playing
                  ? "Pause historical playback"
                  : "Play historical measurements"
              }
              onClick={() => {
                if (!playing && end >= anchor) setEnd(min);
                setPlaying(!playing);
              }}
            >
              {playing ? "Ⅱ" : "▶"}
            </button>
            <input
              id="timeline"
              aria-label="Historical window end time"
              type="range"
              min={min}
              max={anchor}
              step={STEP}
              value={Math.max(min, end)}
              onChange={(e) => {
                setPlaying(false);
                setEnd(Number(e.target.value));
              }}
              aria-valuetext={`${formatTime(end)}. ${activityAtEnd ? `${activityAtEnd.totalMm} millimetres summed across ${activityAtEnd.wetStations} wet gauges in the preceding 10 minutes` : "No positive rain recorded for the preceding 10 minutes; this does not confirm dry weather"}`}
            />
            <button
              aria-label="Next 10 minutes"
              disabled={end >= anchor}
              onClick={() => step(1)}
            >
              ›
            </button>
          </div>
          <div className="timeline-labels">
            <span>{formatTime(min)}</span>
            <span>Historical measurements · 10-minute steps</span>
            <span>Today</span>
          </div>
          <div className="activity-caption">
            {activityError ||
              (activity === null
                ? "Loading rain activity…"
                : "Rain dots · 10-minute sums across measured gauges · size capped")}
            <span>No dot ≠ confirmed dry</span>
          </div>
          <div className="exact-window">
            <span>{formatTime(end - minutes * 60000)}</span>
            <span>→</span>
            <span>{formatTime(end)}</span>
            <small>rolling sum · {durationLabel(minutes)}</small>
          </div>
        </div>
      </section>
      <footer aria-live="polite">
        {error ? (
          <div className="source-error" role="alert">
            Server error: {error}{" "}
            <button onClick={() => setRefresh((r) => r + 1)}>Retry</button>
          </div>
        ) : status ? (
          <>
            <span className={status.errors ? "status-warning" : ""}>
              {status.errors
                ? "Source error · " + status.lastError
                : status.running
                  ? "Ingesting station history…"
                  : "Observations cached"}{" "}
              · {status.fetchedDays} station-days
            </span>
            <span>
              Newest measured:{" "}
              {status.newestMeasurement
                ? formatTime(status.newestMeasurement)
                : "not available"}{" "}
              · ingested:{" "}
              {status.lastSuccess ? formatTime(status.lastSuccess) : "never"}
            </span>
          </>
        ) : (
          <span>Waiting for source status…</span>
        )}
        <span>No spatial interpolation · provisional data</span>
      </footer>
    </main>
  );
}
function RainChart({
  observations,
  start,
  end,
  windowStart,
  windowEnd,
}: {
  observations: Observation[];
  start: number;
  end: number;
  windowStart: number;
  windowEnd: number;
}) {
  const width = 320,
    height = 104,
    max = Math.max(0.2, ...observations.map((o) => o.mm || 0));
  const x = (t: number) => ((t - start) / (end - start)) * width;
  const valid = observations.filter(
    (o) => o.mm !== null && o.quality === "provisional",
  );
  return (
    <div className="rain-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Measured 10-minute rainfall during the last 14 days. ${valid.length} of ${Math.round((end - start) / STEP)} intervals available. Maximum interval ${max} millimetres.`}
      >
        <g aria-hidden="true">
          <rect width={width} height={height} fill="#edf2ee" />
          <rect
            x={Math.max(0, x(windowStart))}
            y="0"
            width={Math.max(
              1,
              Math.min(width, x(windowEnd)) - Math.max(0, x(windowStart)),
            )}
            height={height}
            fill="#d4ce9e"
          />
          <line
            x1="0"
            y1={height - 16}
            x2={width}
            y2={height - 16}
            stroke="#b7c6bb"
          />
          {valid.map((o) => (
            <rect
              key={o.start}
              x={x(o.start)}
              y={height - 16 - Math.max(1, ((o.mm || 0) / max) * 74)}
              width={Math.max(0.3, (STEP / (end - start)) * width)}
              height={Math.max(1, ((o.mm || 0) / max) * 74)}
              fill="#297c69"
            >
              <title>
                {formatTime(o.start)} · {o.mm} mm
              </title>
            </rect>
          ))}
          <text x="4" y="12" fill="#48675a" fontSize="9">
            {max} mm
          </text>
        </g>
      </svg>
      <div>
        <span>14 days ago</span>
        <span>
          {valid.length}/{Math.round((end - start) / STEP)} intervals
        </span>
        <span>Today</span>
      </div>
      {valid.length < Math.round((end - start) / STEP) && (
        <p className="small">
          Two-week history has {Math.round((end - start) / STEP) - valid.length}{" "}
          missing intervals. Some readings may still be loading or awaiting
          publication.
        </p>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
