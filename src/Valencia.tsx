import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { AvametGauge } from "../server/avamet";
import type { StationTotal, Status } from "../shared/types";
import { rainColor, RAIN_LEGEND } from "../shared/rain-scale";
import { formatTime } from "../shared/time";
type Gauge = StationTotal & AvametGauge;
export function Valencia() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const group = useRef<L.LayerGroup | null>(null);
  const [gauges, setGauges] = useState<Gauge[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Gauge | null>(null);
  useEffect(() => {
    const m = L.map(container.current!, {
      center: [39.3, -0.5],
      zoom: 7,
      zoomControl: false,
    });
    map.current = m;
    L.control.zoom({ position: "bottomleft" }).addTo(m);
    L.tileLayer(
      import.meta.env.VITE_TILE_URL ||
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          (import.meta.env.VITE_TILE_ATTRIBUTION ||
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors') +
          ' · Observations: <a href="https://www.avamet.org/">AVAMET</a>',
        maxZoom: 18,
      },
    ).addTo(m);
    group.current = L.layerGroup().addTo(m);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      m.remove();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/regions/valencia", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("AVAMET cache unavailable");
        const data = await response.json();
        setGauges(data.stations);
        setStatus(data.status);
        setError("");
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);
  useEffect(() => {
    const layer = group.current!;
    layer.clearLayers();
    for (const s of gauges) {
      const marker = L.circleMarker([s.lat, s.lon], {
        radius: 7,
        color: s.stale ? "#666" : "#133e36",
        weight: s.stale ? 3 : 1,
        dashArray: s.stale ? "3 3" : undefined,
        fillOpacity: 0.85,
        fillColor: s.dailyMm === null ? "#ddd" : rainColor(s.dailyMm),
      });
      const label = document.createElement("span");
      label.textContent = `${s.name} · ${s.id} · ${s.dailyMm === null ? "No data" : s.dailyMm + " mm since local midnight"}${s.stale ? " · stale" : ""}`;
      marker
        .bindTooltip(label)
        .on("click", () => setSelected(s))
        .addTo(layer);
    }
    setSelected((previous) =>
      previous ? gauges.find((s) => s.id === previous.id) || null : null,
    );
  }, [gauges]);
  return (
    <>
      <div className="avamet-notice" role="status">
        <strong>Valencia · experimental · AVAMET</strong> — Daily measured rain
        since local midnight, up to each station’s reporting time. No rolling
        sums or historical playback: verified interval history is unavailable.
        Missing ≠ zero.
      </div>
      <section
        className="map-area"
        aria-label="Valencian Community AVAMET rain gauges"
      >
        <div className="map" ref={container} />
        <div className="map-tools">
          <div className="map-actions">
            <button onClick={() => map.current?.setView([39.3, -0.5], 7)}>
              All Valencia, Alicante & Castellón ↗
            </button>
          </div>
        </div>
        <div className="map-count">
          {gauges.length} stations ·{" "}
          {gauges.filter((s) => s.dailyMm !== null).length} daily readings
        </div>
        <div className="legend avamet-legend">
          <strong>Rain since midnight · mm</strong>
          <div className="rain-scale">
            {RAIN_LEGEND.map((s) => (
              <div key={s.value}>
                <i style={{ background: rainColor(s.value) }} />
                <span>{s.label}</span>
              </div>
            ))}
          </div>
          <small>
            Grey = missing · dashed ring = older than 1h
            <br />
            Daily zero applies only up to the reporting time.
          </small>
        </div>
        {selected && (
          <aside className="station-panel" aria-label="Station details">
            <button
              className="close"
              aria-label="Close station details"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <div className="eyebrow">{selected.id}</div>
            <h2>{selected.name}</h2>
            <p>{selected.province}</p>
            <div className="station-total">
              <strong>{selected.dailyMm ?? "—"}</strong>
              <span>mm since local midnight</span>
            </div>
            <p>
              {selected.dayStart
                ? formatTime(selected.dayStart)
                : "Start unavailable"}{" "}
              →{" "}
              {selected.measuredAt
                ? formatTime(selected.measuredAt)
                : "Reporting time unavailable"}
            </p>
            <p>
              {selected.stale ? "Stale or unavailable reporting time. " : ""}
              Provisional source daily counter. This is not a rolling 24-hour
              total.
            </p>
            <dl>
              <dt>Coordinates</dt>
              <dd>
                {selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}
              </dd>
              <dt>Elevation</dt>
              <dd>
                {selected.elevation === null
                  ? "Not published"
                  : `${selected.elevation} m`}
              </dd>
            </dl>
            <a
              href={`https://www.avamet.org/mxo_i.php?id=${selected.id.replace("avamet:", "")}`}
              target="_blank"
              rel="noreferrer"
            >
              AVAMET station viewer ↗
            </a>
          </aside>
        )}
        {!gauges.length && (
          <div className="map-empty">
            {error ||
              status?.lastError ||
              "Waiting for AVAMET’s first cached observation poll…"}
          </div>
        )}
      </section>
      <footer>
        <span role="status">
          {error ||
            status?.lastError ||
            "AVAMET observations cached · source polled at most every 30 minutes"}
        </span>
        <span>
          Last successful poll:{" "}
          {status?.lastSuccess ? formatTime(status.lastSuccess) : "never"}
        </span>
        <span>
          <a href="https://www.avamet.org/">AVAMET</a> ·{" "}
          <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/">
            CC BY-NC-ND 4.0
          </a>{" "}
          · Independent experimental viewer
        </span>
      </footer>
    </>
  );
}
