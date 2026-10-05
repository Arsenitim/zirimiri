# Euskalmet source investigation

Investigated 2026-10-05, approximately 21:22–21:30 UTC. This document distinguishes observations, published documentation and conservative implementation assumptions.

## Working public requests (verified)

The [official viewer](https://www.euskalmet.euskadi.eus/observacion/datos-de-estaciones/) loads public files without authentication. Its `webmet00-stations.js` defines these exact paths. Months and days are zero-padded. These are observation files, not forecasts or model outputs.

```sh
curl -L 'https://www.euskalmet.euskadi.eus/vamet/stations/stationList/webmet00-stationList.json'
curl -L 'https://www.euskalmet.euskadi.eus/vamet/stations/readings/C029/2026/10/04/webmet00-readingsData.json'
curl -L 'https://www.euskalmet.euskadi.eus/vamet/stations/readings/C029/2026/10/04/webmet00-summaryData.json'
curl -L 'https://www.euskalmet.euskadi.eus/vamet/stations/readings/C029/2026/09/19/webmet00-readingsData.json'
```

Inventory response contains station ID, name, municipality, province, altitude, `x` longitude and `y` latitude. It arrived in a legacy single-byte encoding; the adapter attempts strict UTF-8 then Windows-1252. Example C029 Zizurkil: longitude -2.06181, latitude 43.1901, altitude 149 m. C072 Orduña: -3.03726, 42.9837, 934 m. Altitude unit metres agrees with official viewer labels. No reprojection is needed.

The one-time current-day scan returned 154 inventory entries, 141 readable daily files and 101 containing a `name: precipitation` field. Counts are snapshots, not constants. Station types do not prove a rain gauge: C040 Gasteiz and C042 Punta Galea returned other sensors without rain; C0B0 La Merced had level sensors only. C003 Derio returned 404. Only demonstrated precipitation fields enable map eligibility, and that eligibility survives missing daily files. The scan is not an exhaustive sensor inventory: an absent field does not prove a station never measured rain.

C029 rain field: key `40`, `type: measuresForWater`, `station: C029`, `data: {"147": {"00:00":0.0,...}}`. Position key is centimetres above station level, verified against summary `_sensorPositionValue: {_unit:CENTIMETERS,_at:147}`. The summary provides sensor ID `G4AB`. The lightweight daily file does not contain hardware model or per-reading quality flags. Multiple rain fields/positions are rejected, not summed across instruments.

## Resolution, units and amounts

The [annual catalogue](https://opendata.euskadi.eus/catalogo/-/estaciones-meteorologicas-lecturas-recogidas-en-2026/) documents 10-minute readings; its description incorrectly says 2018 despite the 2026 title. Viewer `hoursConst` lists 00:00 through 23:50 at 10-minute steps. The detailed table labels rain `mm=l/m²`. The [abbreviations](https://opendata.euskadi.eus/w79-contdata/es/contenidos/ds_meteorologicos/met_stations_ds_2009/es_dataset/adjuntos/abreviaturas.txt) call field 40 accumulated precipitation in mm, without saying the accumulation period.

**Empirically verified interval amounts:** C029 on 2026-10-04 has seven nonzero slots, each 0.1 mm: 03:00, 03:30, 03:50, 06:50, 07:00, 07:10, 08:20. Their sum is 0.7 mm, matching the official summary `_total:0.7`; later slots return to zero, ruling out a day-long cumulative counter. The 03:00–04:00 window contains six slots and totals 0.3 mm. A reduced, real source response is in `tests/fixtures/c029-2026-10-04.json`, used only by tests. No counters are supplied by the active adapter, so counter resets are not applicable.

## Timestamps and boundaries

The viewer labels detailed clock times **Hora oficial** (local official time). For 2026-10-04, the summary's internal UTC maximum at 01:00 corresponds to the detailed file's 03:00, consistent with Europe/Madrid UTC+2. The JSON clock labels have no explicit offset. The [official OpenAPI readings schema](https://opendata.euskadi.eus/contenidos/recurso_tecnico/data_api_meteo/es_def/adjuntos/stations_readings.json) defines slot `00:00–00:09`, `lowerEndPointDesc` as starting time and `upperEndPointDesc` as ending time.

**Implementation interpretation:** treat the viewer's clock key as the start of the documented 10-minute slot, i.e. `[03:00,03:10)`. This is supported by the API slot definitions, but the viewer JSON itself does not carry interval endpoints. Map calculations use exact UTC `[T-W,T)` and exclude the current unfinished slot. Timestamp labels show `Europe/Madrid` and CET/CEST. Timeline steps are elapsed UTC 10-minute steps, so spring days have 23 hours and autumn days 25.

The viewer schema cannot distinguish the two occurrences of a local 02:xx during autumn fallback. **Neither fold is guessed:** ambiguous labels are dropped, making affected sums explicitly incomplete. Nonexistent spring labels are also dropped. The authenticated API may support unambiguous dates but has not been tested with credentials. This limitation remains visible in station panels.

## Missing values, quality and corrections

Viewer code treats undefined, null and empty strings as unavailable, while numeric zero is a value. Its charts keep nulls. The parser accepts only finite non-negative numeric amounts; invalid strings/sentinels/negative numbers become invalid, not zero. Missing keys remain missing. No particular numeric sentinel was observed or officially documented in the retrieved material; negative numbers are conservatively rejected.

The viewer warns that data are not fully validated. The active JSON has no per-reading validation status, revision ID or correction flags, so every usable reading is marked **provisional**. A complete temporal sum is not certified quality. Required completeness: one valid amount at every required slot, no inferred amounts. Duplicate station/start keys are prevented by SQLite's primary key. A successful re-fetch atomically replaces the station/day snapshot: changed values update and withdrawn values disappear. Failed requests retain previous measured observations and report source errors. Daily historical refreshes catch corrections; source latency and re-fetch delay remain possible.

## Availability and latency

Verified C029 has current-day data and a file from 2026-09-19 (more than the requested 14-day history plus 48-hour buffer). Full-network availability must be assessed per station/day: a working example is not proof of universal completeness. Startup backfills 18 calendar days, persists them, and reports exact available/expected slot counts. No unavailable file becomes zero.

At approximately 21:22 UTC (23:22 CEST), the latest C029 clock key was 23:10, corresponding to a slot ending 21:20 UTC. This indicates about **2 minutes after interval end** (12 minutes after slot start) for this sampled fetch. Polling and station-specific delays differ; status computes current latency from newest valid completed slot, separately from last ingestion. No fixed publication SLA or usage quota was found. Default polling is conservatively 30 minutes with paced sequential requests, not per-browser requests.

The [2026 index](https://opendata.euskadi.eus/contenidos/ds_meteorologicos/met_stations_ds_2026/opendata/url.txt) lists station/month XML and XSD links. Catalogue updated 2026-09-16, with quarterly refresh, but examined index goes through August. A guessed C003 August XML was an error document; never trust HTTP 200 alone. Annual archives cannot supply today. They are not used as a silent live-data substitute. 2025 archive is unnecessary for the current retention period and was not used.

## Documented API and credentials

[Authentication instructions](https://opendata.euskadi.eus/api-euskalmet/-/how-to-use-meteo-rest-services/) require valid public/private API keys from the key-management application. JWT: RS256, audience `met01.apikey`, version `1.0.0`, issuer, `iat`, `exp`, and owner email or public-key fingerprint loginId. Send `Authorization: Bearer …`. Documentation uses sandbox; production is `https://api.euskadi.eus`.

Official OpenAPI files can be read publicly. Daily request:

```sh
curl -H "Authorization: Bearer $EUSKALMET_JWT" \
 'https://api.euskadi.eus/euskalmet/readings/aggregated/byDay/forStation/C029/at/2026/10/04'
```

`server/source.ts` includes server-side RS256 token creation and this documented transport. No API credentials were available, and no access restrictions were bypassed. Public viewer files support the working app, so credentials are not necessary for it. The authenticated API response normaliser is deliberately not enabled without a real response to verify: its slot/date encoding differs from the viewer. To migrate, configure private key path and email/loginId server-side, retrieve a sample, verify timezone and quality semantics, then add/validate that adapter. Do not put keys in `VITE_*` variables.

## Reuse and attribution

[Open Data Euskadi reuse guidance](https://opendata.euskadi.eus/como-utilizar-datos/) encourages derived services; [Open Data legal information](https://opendata.euskadi.eus/general/-/informacion-legal-opendata/) requires attribution and preservation of data meaning. The dataset's specific legal link points to an inaccessible legacy Euskalmet page. The current viewer legal page gives general site ownership notices, not an observation-service quota or explicit JSON licence. **Unresolved:** explicit terms for these viewer JSON paths were not found. We treat the same public meteorological measurements as reusable public information under the portal guidance, preserve source attribution and provisional status, and make no claim of endorsement. Confirm source-specific terms with Euskalmet before a high-traffic commercial deployment. No cookies, hidden keys, authenticated sessions or bypasses are used.

OSM tiles use [standard tile policy](https://operations.osmfoundation.org/policies/tiles/): interactive browser viewing, visible attribution, normal cache/referrer, no bulk/offline fetching. The tile URL and attribution are configurable for other usage levels.
