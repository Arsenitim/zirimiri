# AVAMET investigation and experimental Valencia coverage

Investigated 19 October 2026 using real, unauthenticated GET requests. Bilbao remains the initial region; Euskalmet ingestion, rolling sums, activity and radar are unchanged. Valencia uses its own daily-counter view and SQLite database, reusing the existing Store, map library, rainfall colours, timezone formatting and layout. It never inserts daily counters into the ten-minute observation table.

## Verified public retrieval

- [MeteoXarxaOnline](https://www.avamet.org/mxo-meteoxarxaonline.html), also linked through `/mxo-mxo.php`, returns HTML containing a server-rendered observation table and an inline `var data = [...]` JSON array used by its Leaflet map. This is the adapter's single request per poll; no per-station scraping is needed. No separate JSON API was needed or verified.
- The tested response contained 903 stations, including neighbouring territories. Fields: `esta` station ID, `muni` municipality, `dess` / `ptda` site descriptions (may contain HTML/entities), `lati` latitude, `logi` longitude, `msnm` elevation, `prec` daily measured precipitation in mm, `prec_int_h` instantaneous rain rate in mm/h, `data_ini` station reporting time. Monthly/yearly counters are `prec_mes` / `prec_any`. The adapter uses municipality plus unique ID, without rendering source HTML.
- Coordinates are decimal strings with a dot; precipitation uses a decimal comma; elevation uses a dot as a thousands separator. Null/blank/invalid/negative rainfall remains missing. A real sample is stored in `tests/fixtures/avamet-2026-10-19.json`, reduced to relevant fields.
- Verified example: Castellfort `c01m038e01`, coordinates 40.50232930, -0.19081161, elevation `1.181` m, daily `20,8` mm at `19/10/2026 17:15` (15:15 UTC in Europe/Madrid). Reports are asynchronous and not ten-minute aligned.
- The viewer's territory selector explicitly groups comarca IDs c01–c08 under Castellón, c09–c25 under Valencia, c26–c34 under Alicante. c99 is excluded. Coordinates are validated; no locations are geocoded or invented.

Reproduce (one request):

```sh
curl -L 'https://www.avamet.org/mxo-meteoxarxaonline.html' -o /tmp/avamet.html
```

## Time and history limitations

`prec` is labelled “Día mm” by the source, not a rolling 24-hour accumulation. The prototype shows local midnight through the exact per-gauge reporting time in Europe/Madrid, with stale readings marked after one hour. Daily zero only describes that published daily counter. Old cached readings keep their original dates. Future, invalid and ambiguous autumn DST timestamps cannot contribute rainfall. Midnight bounds use the calendar timezone, not a fixed 24-hour subtraction.

The public [station detail](https://www.avamet.org/mxo_i.php?id=c01m038e01) embeds Highcharts series: its fourth chart has precipitation and pressure, with ten-minute-looking numerical timestamps and points. This confirms finer public chart data exists. The investigation did **not** establish whether those precipitation points represent interval amounts or cumulative counters, nor whether numeric timestamps encode UTC or shifted display time. No conversion of those points is implemented. The adapter never differences counters, integrates rain rates, distributes daily amounts or manufactures ten-minute slots.

[Historical queries](https://www.avamet.org/mx-consultes.php?id=c01m038e01) show start/end date fields and an explicit “Zona restringida a socis / Zona restringida a socios” message. The form describes daily history, not verified interval history. The [network historical page](https://www.avamet.org/mx-meteoxarxa.php) exposes daily summaries. No authenticated access or restriction bypass was attempted.

Consequently Valencia has daily counters only, with no rolling-window controls, interval activity, radar, chart or historical playback. The existing 10-minute–48-hour rolling windows and 14-day timeline remain fully available in Bilbao. Supporting them for AVAMET requires verified interval semantics, timestamp conventions, and an appropriate access agreement. The current prototype does not claim a historical archive.

## Attribution, reuse and access load

AVAMET's footer links its site and contents to [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). Its [legal notice](https://www.avamet.org/politicacookies.php) describes informational use and no availability/accuracy warranty. This is **not** an unrestricted open-data licence. The prototype displays AVAMET attribution, source links, the licence, and unchanged measured daily values. Do not assume commercial redistribution or derived rainfall products are authorised; obtain AVAMET clarification before such deployment. No separate automation permission or documented API agreement was established. The robots.txt web lookup failed and is not treated as permission.

The server makes at most one network-wide request per 30 minutes (48/day per process/database), including after failures; attempt times persist across restarts. A poll has a 30-second timeout, no immediate retry, no browser-to-source requests, and no per-gauge fanout. Browser polling reads only local SQLite. Failures preserve the last verified snapshot and expose the error and last successful poll. Missing stations in a new successful inventory are removed from that snapshot. Parser/schema failures retain the old snapshot rather than producing fabricated zeroes. Run one ingestion server per database; no cross-process poll locking is supplied.

## Verification

`npm test` covers real samples in all three provinces, units, coordinates, timezone conversion, missing/invalid/zero, future and DST ambiguity, request throttling, failure preservation, and isolation from interval storage. Existing Euskalmet tests remain in place. `npm run build` checks TypeScript and produces the app. A whole live viewer response was parsed locally during investigation; no live data is bundled as an automatic fallback.

An end-to-end live adapter smoke test on 19 October returned 888 stations spanning Castellón, Valencia and Alicante, no source error, and zero rows in the ten-minute observation table. (The earlier downloaded response had 887 in-region stations; live membership can change.) Browser rendering has not been manually verified in this environment.
