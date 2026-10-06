# Euskalmet Kapildui radar investigation

Investigated 2026-10-06, approximately 16:30–16:45 UTC. As in [data-source.md](data-source.md), this separates observed behaviour, published documentation and conservative implementation choices.

## What is published (verified)

The [official radar viewer](https://www.euskalmet.euskadi.eus/observacion/radar-kapildui-precipitaciones/) is Leaflet with `leaflet.timedimension`. Its script `/scripts/custom/js/webmet00-kapilduiMap.js` builds frame URLs as:

```
https://www.euskalmet.euskadi.eus/vamet/radar_kapildui_detail/{product}/{day}/webmet00-{HHMM}.png
  product: intensity | acumulated | long_range
  day:     today | yesterday | before_yesterday
  HHMM:    UTC (the viewer uses Date.toISOString), 0000–2350 in 10-minute steps
```

No authentication, cookies or keys. Responses carry `Access-Control-Allow-Origin: *` and `Cache-Control: max-age=300`. `Last-Modified` was identical for every file in all folders (16:31:39 GMT), so it reflects a batch publication, not the frame time, and is not used.

| Product | Meaning (viewer text) | Size | Viewer bounds (S,W → N,E) |
| --- | --- | --- | --- |
| `intensity` | Estimated rain rate, mm/h, every 10 min, from reflectivity via the Marshall–Palmer Z-R relation | 800×800 | 41.864983, −3.747800 → 43.655708, −1.2893926 |
| `acumulated` | Precipitation accumulated over the last hour | 800×800 | same as intensity |
| `long_range` | Reflectivity, PPI 0.5° elevation, ~300 km | 600×600 | 40.050202, −6.365 → 45.372134, 1.36 |

**zirimiri uses only `intensity`**: it is a per-frame snapshot. `acumulated` is a rolling sum and is not wanted. The intensity bounds are a 100 km radius around the radar (±0.9° latitude, ±1.23° longitude at 42.76° N), consistent with the viewer's 100 km range text.

### Image format

Frames are 8-bit RGBA PNG, non-interlaced. Outside echoes, pixels are fully transparent `(0,0,0,0)`, so a frame can be overlaid without processing. A 16:00 UTC sample had 16 distinct colours, a discrete palette, e.g. `(115,255,32)`, `(53,212,32)`, `(0,170,0)`, `(0,85,0)`, `(0,255,255)`, …, `(255,0,255)`, `(170,0,255)`. Viewer stylesheet legend (`webmet00-styles.scss`, `.component-radar-kapildui`) groups 19 colours into five qualitative classes with **no numeric thresholds**:

- Débiles (light): `#7efb30 #29dd15 #00af00 #0b5d00`
- Moderadas (moderate): `#08fdf9 #06a5ff #0056ff #000097`
- Fuertes (heavy): `#fffcad #f6ff03 #ffa713`
- Muy fuertes (very heavy): `red #b90000 #7e0008`
- Torrenciales (torrential): `#f804ed #b000ff #66009b #817e7e #020202`

Legend CSS colours differ slightly from image pixel values; neither is documented as a lookup table. The app shows the qualitative classes only and never converts colours to mm/h.

### Missing frames are HTTP 200

A not-yet-published (or missing) slot returns **HTTP 200** with a 142,012-byte "Sin datos / Ez dago daturik" image, the same bytes for all products (SHA-256 `5785b34e3d7f…`, recorded in `server/radar.ts`; `long_range` placeholder is 800×800, not 600×600). Unlike real frames, its corners are semi-transparent black (alpha ≈ 90). **Never trust HTTP 200.** A frame is accepted only when it decodes as 8-bit RGBA PNG, has the product's expected dimensions, all four corner pixels are fully transparent and its hash is not the known placeholder. Of 72 sampled files (3 products × 3 days × 8 times), all 63 real frames passed and all 9 placeholders failed; the placeholder also fails on its corners alone, without the hash.

### History depth

Only three relative folders exist. `3days_ago`, `before_before_yesterday`, `2026-10-03` and `20261003` all return 404. **The public source retains about three UTC days**; anything older must come from our own archive. Folder names are relative, so a hotlinked URL changes meaning at rollover; the browser therefore never loads Euskalmet frame URLs directly.

### Latency

At 16:37 and 16:39 UTC the newest real frame was 16:00; 16:10–16:40 returned the placeholder. Observed publication delay is **at least 30–40 minutes**, apparently in batches. Not a guaranteed SLA.

### Georeferencing and alignment

Like the official viewer, the app stretches the frame linearly between the latitude/longitude bounds in Web Mercator. If the product grid is equirectangular, the stretch error is at most ~0.7 km (≈3 px of 800) at the centre latitude. The native projection is not published; this is an upper bound under that assumption, not a verified accuracy.

Visual check: the 16:00 UTC frame on OSM tiles showed a convective line from Ondarroa through Zumarraga, Alsasua and Estella, with echoes respecting the coastline. Gauge cross-check (30 randomly chosen stations inside the frame, today's 17:40–18:10 local gauge totals vs any echo within 3 px of the gauge):

| | gauge wet | gauge dry |
| --- | --- | --- |
| echo | 4 | 7 |
| no echo | 3 | 16 |

The two wettest gauges (C030 7.0 mm, C0DB 1.6 mm) lay under echoes; misses were 0.1–0.5 mm. A 10-minute instantaneous radar estimate and 30-minute gauge totals of a moving line are not expected to agree point-by-point; this supports correct placement and UTC naming, not quantitative agreement. Radar and gauges are separate measurements and the app never adjusts one with the other.

### Frame time semantics

The viewer does not say whether `HHMM` is the scan start, scan end or the end of a 10-minute integration. **Implementation interpretation:** a frame is labelled with its named UTC time and shown as an approximate snapshot for timeline positions at or after it.

## Documented API (not used)

The [radar OpenAPI file](https://opendata.euskadi.eus/contenidos/recurso_tecnico/data_api_meteo/es_def/adjuntos/radar.json) (version 0.0.1) lists:

```
/euskalmet/radar/reports/precipitationReport/{intensity|last_accumulated|long_range}/for/{YYYY}/{MM}/{DD}
/euskalmet/radar/reports/reflectivityReport/maximum/for/{YYYY}/{MM}/{DD}
/euskalmet/radar/reports/lightningReport/evolution/for/{YYYY}/{MM}/{DD}
```

The tag description says "Radar captures in Base64"; no response schema is published. It requires the same RS256 API key as the readings API (see [data-source.md](data-source.md)). No credentials were available, so it is untested. It may offer absolute dates and deeper history; it does not appear to offer numeric grids.

## Implementation: own archive

- `server/radar.ts` polls every 10 minutes (`RADAR_POLL_MINUTES`, min 5). Each run maps `today`, `yesterday` and `before_yesterday` to the current, previous and second-previous **UTC** dates and requests only slots that are already in the past and not yet archived. Paced with the station requests (shared ≥250 ms spacing).
- **Rollover guard:** before using `today`, it requests a slot at least 30 minutes in the future. If that returns a real frame, `today` still holds an earlier day, and the run is skipped. The behaviour exactly at 00:00 UTC has not been observed; this guard prevents storing yesterday's frames under today's date.
- Accepted frames are stored as BLOBs in SQLite `radar_frames(product, slot, png, sha256, fetchedAt)`. A stored frame is never overwritten or deleted by later source changes; it is removed only by retention (`RADAR_RETENTION_DAYS`, default 15, covering the 14-day timeline). Archive storage is roughly 1–20 MB per day depending on weather.
- Placeholder/invalid slots are not stored. Past missing slots are retried at most hourly while still in the three-day source window.
- History therefore starts when the app first runs: the first poll backfills up to three days; longer history accumulates while the server keeps running. A gap while the server is down for more than three days cannot be recovered from the public source.
- Browser: `/api/radar/frames` lists archived slot times; `/api/radar/frames/{slot}.png` serves immutable stored bytes. The map shows the newest archived frame at or before the selected timeline end, up to 60 minutes older, labelled with its own time and age. Beyond that, the radar layer is empty and says no frame is available. Frames are never interpolated, accumulated or blended.

## Reuse and attribution

Same position as the station data: Open Data Euskadi reuse guidance, Euskalmet / Basque Government attribution, no implied endorsement, no explicit licence found for the viewer image paths. The UI attributes radar frames to "Euskalmet Kapildui radar". Confirm source-specific terms before high-traffic commercial use.
