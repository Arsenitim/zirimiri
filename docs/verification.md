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

## Radar overlay (2026-10-06)

- 26 Node tests pass, including 6 radar tests: PNG validation (filters, size, corners, truncation), frame selection limits, UTC slot names, three-day archive with stop at the newest unpublished slot, immutability and retention, and refusal to archive when `today` has not rolled over.
- The frame validator, run on 72 real downloaded files, accepted all 63 real frames and rejected all 9 placeholders, also without the placeholder hash.
- Live first run at 16:4x UTC archived 386 frames (2026-10-04 00:00 to 2026-10-06 16:10 UTC) with no gaps or errors: 4.9 MB, mean 13 KB per frame.
- Chrome desktop: the 18:00 CEST frame rendered at 60% opacity in its pane (z-index 350) beneath the gauge marker pane (600). Opacity slider, toggle and remembered settings work. "Latest" shows the 18:10 CEST frame labelled 30 min before window end. 22 Sept shows "No radar frame within 60 min" with no image.
- Chrome 390 × 844 emulation: document width 390 px, legend with radar controls fits.
- Not observed: actual folder behaviour at 00:00 UTC rollover (guarded, see radar-source.md).

SQLite cache and raw investigation files are local and ignored by Git. The only committed observation sample is explicitly isolated in `tests/fixtures` and never served as fallback data. Source-specific limitations, provisional quality and DST ambiguity are recorded in [data-source.md](data-source.md).
