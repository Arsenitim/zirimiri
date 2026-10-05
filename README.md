# zirimiri

Measured precipitation at Euskalmet rain gauges around Bilbao and across the Basque Country. Every point is a station, never an interpolated rainfall surface. **Rolling sums, not averages.**

## Run locally

Node.js 24 or later (native SQLite), npm:

```sh
npm ci
cp .env.example .env
npm run dev
```

Open http://127.0.0.1:5173. The Node backend listens on 3001. On first run, station discovery and 18-day backfill happen in the background; the UI reports progress and partial coverage. Full-network backfill makes approximately 2,000 paced requests and takes several minutes. SQLite persists in `data/zirimiri.sqlite`. No synthetic observations or automatic demo fallback are used.

```sh
npm run ingest   # optional standalone ingestion (do not run alongside the server)
npm test
npm run typecheck
npm run build
npm start       # serves the production build at http://127.0.0.1:3001
```

Polling defaults to 30 minutes, with sequential requests at least 350 ms apart, retries and exponential backoff. Recent files refresh each poll; older retained days refresh daily to pick up corrections. `STATION_IDS=C029,C072` restricts ingestion for a quick smoke test; leave empty for full coverage. Stations stay visible after temporary data loss. HTTP 404 means an unavailable day, never zero rainfall.

## Data access and interpretation

Read [the source investigation](docs/data-source.md) for real request examples, tested semantics, caveats and licensing. The working adapter reads the same public JSON files as Euskalmet's station viewer. The documented API requires RS256 credentials; its server-only token transport is included, but its different response format must be validated before switching sources. Keys must never be put in Vite environment variables or committed.

The timeline is the last 14 elapsed days; storage retains 18 days to cover the earliest 48-hour sum. Windows are `[T-W,T)` in UTC, with labels in `Europe/Madrid`. A complete total requires every 10-minute slot to contain a finite non-negative source amount. All readings are provisional, not certified. Missing, invalid, future or ambiguous DST readings cannot contribute to a complete sum. Partial totals are never scaled.

## Docker

```sh
docker compose up --build -d
```

Open http://localhost:3001. A named volume persists SQLite. To configure, edit `compose.yaml` environment values or provide a local `.env`; key files, if used for API investigation, should be mounted read-only outside the public assets. The image runs as an unprivileged user.

## Map tiles

OpenStreetMap standard tiles with visible attribution and browser caching are suitable for modest interactive use; no bulk downloads or offline prefetch. See [tile policy](https://operations.osmfoundation.org/policies/tiles/). Set `VITE_TILE_URL` and `VITE_TILE_ATTRIBUTION` before building to use another provider for substantial traffic. Rain markers use only verified station coordinates.

## Structure

- `server/source.ts`: verified viewer adapter, strict parsing, optional authenticated API transport.
- `server/ingestion.ts`: discovery, incremental fetches, retries and retention.
- `server/store.ts`: SQLite transactions and indexed observations; station/day replacement allows corrections and withdrawals.
- `shared/`: UTC accumulation and timezone conversion.
- `src/`: React + Leaflet UI.
- `tests/`: interval boundaries, missing/zero, corrections, DST and a manually checked real sample.

Source attribution: Euskalmet / Basque Government. This independent app does not imply endorsement. Data availability and publication delays are shown in the UI.
