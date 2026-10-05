# Verification

Checked locally on 2026-10-05 using real public Euskalmet observations, never UI fixtures.

- TypeScript strict type check and Vite production build pass.
- 20 Node tests pass: rolling boundaries; complete zero versus missing; partial coverage; duplicates, corrections and withdrawals; invalid values; duration constraints; DST gaps/folds; midnight refresh of unfinished day files; ingestion failures preserving cached measurements; real manually checked C029 sample; factual multi-gauge rain activity aggregation and capped dot sizes. Counter resets are inapplicable to the verified interval-amount source.
- HTTP API returns C029 0.3 mm, 6/6 intervals for 2026-10-04 03:00–04:00 Europe/Madrid. Source daily readings sum to the official 0.7 mm daily summary.
- Initial 18-day ingestion completed with 260,205 records, 101 demonstrated precipitation stations and no source errors. At 2026-09-21 23:50 CEST (the earliest timeline point at verification), the 48-hour window is complete at 99 stations, partial at one and unavailable at one. Those limitations remain explicit in the UI. The further historical sensor-evidence scan completed without errors; eligible count remained 101. At 2026-10-06 shortly after midnight, 260,402 records were retained and normal polling was enabled.
- Chrome desktop: real map tiles and station markers, station search, metadata/coverage/chart, changing durations, keyboard-accessible controls, previous step and historical play/pause were checked.
- Chrome 390 × 844: map, compact controls and scrolling station panel render correctly; document width is 390 px, so no horizontal overflow. Two-week history gaps are explicitly counted. Viewport override was reset after testing.
- Rain activity: 582 real rainy intervals rendered, maximum dot radius 6 px on desktop and mobile; clicking the last dot selected 2026-10-05 13:50 CEST, and its tooltip showed 0.1 mm across one wet gauge with 101/101 gauges available. Badge removal verified in the rendered DOM.
- Docker Compose configuration validates. Container runtime was not tested because the local Docker daemon is stopped.

SQLite cache and raw investigation files are local and ignored by Git. The only committed observation sample is explicitly isolated in `tests/fixtures` and never served as fallback data. Source-specific limitations, provisional quality and DST ambiguity are recorded in [data-source.md](data-source.md).
