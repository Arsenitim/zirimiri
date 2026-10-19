# AVAMET investigation and experimental Valencia coverage

Investigated 19 October 2026 using real, unauthenticated GETs. Bilbao remains the initial region, with unchanged Euskalmet ingestion, rolling sums, activity and radar. Valencia's map shows daily measured rainfall; select a gauge and use **Load history & rolling sums** for that station's recent chart, timeline and flexible accumulation windows.

## Public network inventory and daily rainfall

The adapter requests [MeteoXarxaOnline with all territories explicitly selected](https://www.avamet.org/mxo-mxo.php?territori=pv). The viewer's territory selector documents this URL. The bare `/mxo-meteoxarxaonline.html` URL was also tested, but once returned only a selected comarca; always use the explicit `pv` filter for inventory. The tested full response contained 904 stations, including neighbouring territories; live membership changes.

The HTML contains a server-rendered observation table and an inline `var data = [...]` JSON array used by Leaflet. No separately documented JSON API was found. Relevant fields:

| Field | Verified meaning |
| --- | --- |
| `esta`, `muni` | Unique station ID and municipality |
| `dess`, `ptda` | Site descriptions, potentially containing HTML/entities (not rendered) |
| `lati`, `logi` | Source decimal latitude/longitude |
| `msnm` | Elevation; dot is a thousands separator |
| `prec` | Daily measured precipitation, decimal comma, mm |
| `prec_int_h` | Instantaneous rain rate, mm/h; never integrated |
| `data_ini` | Per-station local reporting clock, `dd/MM/yyyy HH:mm` |
| `prec_mes`, `prec_any` | Monthly/yearly counters; not used for rolling sums |

The territory selector groups c01–c08 under Castellón, c09–c25 under Valencia, c26–c34 under Alicante. c99 is excluded. Coordinates are validated rather than geocoded. Null, blank, invalid and negative rainfall remain missing. Daily totals retain the source reporting time; a daily zero applies only up to that time. Invalid/future/ambiguous DST times cannot contribute rainfall. Old cached measurements retain their original dates. Stale reports are marked after one hour.

## Verified chart retrieval and semantics

The [public station detail page](https://www.avamet.org/mxo_i.php?id=c01m038e01) embeds Highcharts configuration in HTML. The fourth chart (`$('#grafic4').highcharts(...)`) has a precipitation axis in mm. Its first series has `yAxis: 0`, `name:'Precipitació'`, `valueSuffix:' mm'` and numerical timestamp/counter pairs. The second series is pressure and is never used.

Three public charts were checked against the full network's daily observations:

| Gauge | Latest chart local clock | Daily counter | Latest value in network table |
| --- | --- | --- | --- |
| Castellfort `c01m038e01` | 19 Oct 2026 17:40 | 20.8 mm | 20.8 mm, 17:40 |
| València `c15m250e39` | 19 Oct 2026 17:45 | 33.2 mm | 33.2 mm, 17:45 |
| Agost `c32m002e03` | 19 Oct 2026 17:48 | 0.5 mm | 0.5 mm, 17:48 |

All three contain about five days, beginning on 14 October, with respectively 820, 1,326 and 1,412 points. The precipitation points are **daily cumulative counters**, not interval amounts: they increase during rain, stay constant during dry periods and reset near local midnight. Castellfort falls from 17.0 to 0.0 at 19 October 00:00; València from 26.0 to 0.0 at that boundary; Agost's first zero occurs at 00:08. Observed spacing includes 5 and 10 minutes, irregular 3–9-minute intervals, and some 15-minute gaps. Source HTML with only the precipitation series retained is in `tests/fixtures/avamet-chart-*.html`.

### Timestamp convention

The numeric chart timestamps encode **local wall-clock components in UTC-shaped epoch numbers**. For example, Castellfort's last raw timestamp `1792431600000` renders as 17:40 if read as UTC, but the reporting clock is 17:40 **CEST**, and the actual instant is 15:40 UTC. The raw timestamp would be almost two hours in the future if used directly as UTC. All three chart headers and network reporting clocks confirm the civil-time interpretation.

The parser reads the raw timestamp's UTC calendar fields, then resolves those fields in `Europe/Madrid` with the existing strict `localSlot` converter. It checks the last raw clock against the station page's reporting header and rejects changed conventions/schema/units. Future, nonexistent spring DST and ambiguous autumn DST clocks are excluded; no fixed two-hour offset is applied. The page also contains `global: {timezoneOffset: -60}`; this rendering option is not used as an epoch conversion rule.

### Measured intervals and accumulation rules

The new adapter retains source counter readings in `avamet_counters` in the separate AVAMET SQLite database. Each adjacent, valid, nondecreasing pair on the same local date, no more than ten minutes apart, yields a measured amount `counterB - counterA` over the actual interval `[A,B)`. This is the change measured by the same gauge over that interval, not an estimate of rainfall within it.

Midnight crossings, counter decreases/corrections, null values, conflicting duplicates and source gaps exceeding ten minutes yield **no interval**. No rain-rate integration, extrapolation, temporal interpolation, splitting or daily-total distribution is used. A source-covered range is replaced transactionally on refresh so corrections and withdrawals can be reflected; failed requests preserve verified history. Older archived samples are retained for 18 days, while the station timeline shows at most the latest 14 days of available samples. Repeated loading is needed to grow the archive beyond the upstream five-day chart. No unattended full-network historical backfill is performed.

The shared `accumulateIntervals` processor sums only whole measured intervals contained within the selected window. It reports the actual covered minutes; a complete sum requires coverage of every minute in the window. Irregular sampling, window edges and midnight crossings can therefore produce partial totals, including for 24/48-hour windows. Partial amounts remain visible and are never scaled. Zero requires an available measured interval. The station UI supports the existing 10-minute–48-hour presets and custom multiples of ten minutes; timeline ends can be chosen at source reading times or minute steps. Selecting a plotted bar chooses that measurement's end time.

These controls deliberately apply to the **selected station only**. Map circles continue to show daily rainfall, with this distinction labelled beside the controls. Loading all ~900 chart pages on every poll would substantially increase source traffic. Gauges whose chart cannot be parsed still retain their daily map observations and show an explicit history error.

## Restricted historical services

[Historical queries](https://www.avamet.org/mx-consultes.php?id=c01m038e01) expose start/end date fields but explicitly display “Zona restringida a socis / Zona restringida a socios”. The form describes daily history. The [historical network page](https://www.avamet.org/mx-meteoxarxa.php) contains daily summaries. No authenticated access or restriction bypass was attempted. Longer historical availability is not promised; the public chart is the only implemented historical input.

## Reuse, attribution and request load

AVAMET's footer links site contents to [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). The [legal notice](https://www.avamet.org/politicacookies.php) describes informational use and disclaims accuracy/availability warranties. This is not an unrestricted open-data licence. Attribution, source links and the licence remain visible; the viewer does not imply endorsement. No API agreement, separate automation permission, or permission for commercial redistribution has been established. Obtain AVAMET clarification before commercial use or redistribution of derived products. A failed robots.txt lookup is not treated as permission.

Request safeguards:

- One whole-network daily-counter poll per 30 minutes, including after failures.
- A station chart is fetched only after the visitor presses its history-load/refresh button; merely selecting a station, scrubbing history or changing windows never fetches upstream.
- Per-station chart attempts, including failures, are cached for 30 minutes across visitors/restarts. Concurrent requests for the same station share one fetch.
- Global chart requests are at least two seconds apart, capped at 30 per rolling hour, with the budget persisted in SQLite. Excess requests return HTTP 429 with `Retry-After` and a visible retry countdown. No immediate upstream retry.
- Thirty-second request timeouts; no browser-to-AVAMET data fetching. GET history requests read local SQLite only.
- A single server process per database is assumed; no cross-process request locking is provided.

Read APIs: `/api/regions/valencia` for daily map totals and `/api/regions/valencia/stations/:id/history` for cached counters/intervals. POST to that history URL requests a throttled source refresh. Unknown station IDs return 404 and cannot trigger arbitrary source requests.

## Verification

`npm test` covers real chart series in all three provinces, reconciliation of Castellfort's accumulated increments with the published 20.8 mm daily total, civil-time conversion, winter/DST handling, source gaps, resets, null/corrected/duplicate/future data, window edges, measured zero, throttling, concurrent-request coalescing, persisted hourly limits, correction/withdrawal replacement and failure preservation. Existing Euskalmet tests remain unchanged. `npm run build` checks TypeScript and produces the app.

Daily ingestion previously verified 888 in-region gauges with no source error and no rows in the Euskalmet ten-minute observation table. Live browser checks for the daily prototype verified Bilbao default, Valencia marker values, station detail clicks and switching back to Bilbao's timeline. No fixtures are used as an automatic production fallback.

The station-history UI was exercised in headless Chrome on desktop and 390px mobile: default Bilbao region, station selection, cached chart loading, complete 60-minute sums, partial 48-hour sums, scrubbing back one day, custom 90-minute duration, responsive panel width and return to Bilbao. No JavaScript exceptions were observed. The checked 48-hour Castellfort window covered 2,860 of 2,880 minutes, correctly retaining two midnight gaps instead of inventing rainfall.
