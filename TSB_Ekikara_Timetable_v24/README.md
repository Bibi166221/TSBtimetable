# v24 — Matched hour rows and clean empty cells

- The left and right main timetables now share one continuous hour range.
- If one direction has no service at a given hour, the hour still appears with **no minute text** (blank cell, no dash).
- Matching desktop rows are resized equally so 04 aligns with 04 even where one direction wraps onto extra lines.
- The same matched rows are included in the high-resolution PNG and SVG exports.
- On phone and portrait iPad, panels stack but use the same hour range.
- Additional separate-origin A/X/L/R boards retain their own hour range; their no-service rows are also blank.
- No API departure time is created or changed.

# TSB Ekikara Timetable v19 — L/R route pairing and first-stop notes (phone and iPad)

## New rule: 113 / 113A and 555 / 555A

- 113 + 113A share a timetable family: `1-44(113)` + `1-44A(113A)`.
- 555 + 555A share another timetable family: `S6(555)` + `S6A(555A)`.
- 113 and 555 are NOT grouped together; they serve unrelated corridors.
- A-route departures have blue minutes and the small code `113A` or `555A` below.
- Departures are mixed only when the origin station names match; a different A-route origin gets its own station panel.
- Selecting either the base route or its A variant opens the same timetable family. Bare route numbers `113`, `113A`, `555`, `555A` are resolved using the live route list.

## New rule: 517 and 517X separate

- `1-56(517)` and `1-56(517X)` show separate timetables. Selecting 517X does not silently include 517.
- This exception overrides the general X suffix pairing. Other X families keep their existing automatic merging behavior.


This is the complete project, including the previous v13 overnight and X-route features.

## Route 34 special grouping

Selecting **34**, **34X**, or the officially published **1-3(34)** / **1-3 (34เสริม)** shows a common service family. The program fetches individual timetables for **34**, **34X**, and the published **1-3** variant from the Thai Smile Bus API.

- **Rangsit (รังสิต)**: departures of 34 plus 34X in **red** with small **เสริม** under 34X minutes.
- **Hua Lamphong (หัวลำโพง)**: departures of 34 plus 1-3 in **blue** with small **บางเขน** under 1-3 minutes.
- **Bangkhen (บางเขน)**: a **separate blue-highlighted departure panel** for 1-3 towards Hua Lamphong, with บางเขน below each 1-3 minute.
- **Kor Por Aor (แยก คปอ.)**: a **separate red-highlighted departure panel** for 34X towards Rangsit, with เสริม below each 34X minute.

The separate express route `1-2E(34E)` is **not** merged with this family. All other X-route grouping rules still work as before.

The route picker is the source of truth for actual route identifiers. For example, it may publish `1-3 (34เสริม)` instead of `1-3(34)`; the program matches either spelling and uses the **exact published route ID** when fetching the timetable. The 1-3 group is only loaded when it exists in the published route list. This avoids showing invented departures.

Data is grouped only by **departure terminal**, never by destination alone; no bus positions, plates, or live status are shown. Overnight routes retain the service-day hour order and the 24,25,26 small next-day captions.

## Install / run

Extract files directly into your `TSBtimetable` folder, *not* a second nested directory.

```
node server.js
```

Visit http://localhost:3000/?route=34

Open `public/index.html` in a Live Server only for a **clearly labeled mock preview**, not for live data.

## Tests

```
node --test tests/*.test.js
```

Tests mock the official API to verify route matching, station-dependent timetable merging, overnight hour ordering, and non-merging of the 34E express route. Network availability and real API payloads require validation on your own computer.

## Phone and iPad support (v15)

- Phone: one easy-to-read timetable at a time, larger minute numbers, a full-width route field, and touch-friendly buttons.
- iPad portrait: one full-width timetable at a time to preserve readable Thai station names and departure times.
- iPad landscape / desktop: two timetable panels side-by-side.
- Jump links for ขาไป / ขากลับ / เส้นทางเสริม on phones and tablets. The supplement link appears only for routes with supplementary panels.
- Supports 320px+ phone widths, safe-area spacing, and small next-day hour captions.
- Existing red เสริม (X) and blue บางเขน (1-3), combined 34/34X/1-3, and overnight 24–26 features are unchanged.

### Open on a phone or iPad using the same Wi-Fi

1. Extract directly into the `TSBtimetable` folder on your Windows PC (no extra nested folder).
2. Open PowerShell inside that folder and run `node server.js`.
3. The terminal prints `Phone / iPad (same Wi-Fi): http://192.168.x.x:3000` (your actual IP may be different).
4. Connect the phone or iPad to the **same local Wi-Fi** as the computer, then open the URL printed for the computer's Wi-Fi IP in Safari or Chrome.
5. If Windows Firewall asks, allow Node.js for **Private networks** only. Keep the computer running while using the site.

**Important:** `localhost` on a phone means the phone, not your computer. Use the LAN IP printed by the server. This is local-network access, not public internet hosting. If you want the site accessible outside your Wi-Fi, it must be deployed to a suitable host separately.

On iPhone/iPad you may optionally use Safari → Share → Add to Home Screen to create a shortcut. This does not make the site available offline; the server must remain reachable.

## v17 – Different destinations / passenger warning

Shared timetable headings now list **every distinct destination** from that departure station, e.g. `มีนบุรี - หัวลำโพง / อนุสาวรีย์ชัยสมรภูมิ` for 113 + 113A. Destination alternatives are derived from each route's `data-start` / `data-destination` in the official catalog (or the route info fallback), never from the departure times alone.

Colour keys appear immediately above each mixed timetable: **normal dark text** identifies the main service and its terminal; **red** identifies X (เสริม) and its actual terminal; **blue** identifies A or the special 1-3(34) service and its actual terminal. A Thai notice warns passengers that sharing a departure station and timetable does not guarantee the same route or destination. Different-origin services continue to use independent panels.

**529EX correction:** The currently published TSB selector lists `4-29EX(529EX)` as ending at Mo Chit 2, but a user-requested, route-specific manual correction changes the displayed terminus to **สุทธิสาร** in the outbound direction, and the departure origin to **สุทธิสาร** for the reverse direction. This affects only **529EX**, not **529E**. This is a display correction supplied by the user, not independently verified against live operator dispatch records.

Phone/iPad layouts and all previous group rules (113/113A, 555/555A, route 34, 517 separate), overnight labels, and source links are preserved.

## v18 – First-stop departure-time references (ป้ายแรก)

Each timetable now states in Thai that departure times refer to the **first stop of each individual route**, rather than the time a bus reaches later stops. The first-stop name is taken from the matching route/direction's TSB API fields:

- `get_route.php` → `data.go.info.first_station` for outbound trips.
- `get_route.php` → `data.back.info.first_station` for return trips.
- If `first_station` is absent, use the first named stop in the same direction's `stops[]` array. If neither is supplied, display **ไม่ระบุใน API** rather than guessing from the route picker.

The route selector's `data-start` / `data-destination` still controls the main origin–destination heading; these are deliberately **not** treated as the timetable's first stop. Each departure has `firstStop` and `firstStopSource` from its own API response so merged 113/113A, 555/555A, 34/34X/1-3 and other X services keep distinct first-stop references. Extra departure-station panels get the same notes.

Each route/stop note links to the official TSB schedule page for **that specific route**, not an invented stop URL. The user-requested 529EX สุทธิสาร destination override remains a separate display override and does not alter what the API actually reports as the first station. On static Live Server preview, the first-stop note explicitly says the data is illustrative.


## v19 – L/R routes together, with first-stop references everywhere

- When the published TSB route catalog contains a genuine matched L/R pair, selecting **either** side shows the pair on the **same page**. For example, `4-25L(147L)` / `4-25R(147R)` produces a **left L** timetable and a **right R** timetable. The public shorthand `147L` / `147R` works when uniquely resolvable.
- Matching is based on *both* actual official route IDs (or their shared catalog stem), never on a guessed R counterpart. A route without a published partner retains its ordinary go/back display.
- Each column fetches its own route timetable and first-stop name from `get_route.php`: `data.go.info.first_station` or `data.back.info.first_station` for the API direction that supplies its departures. If a route has only a `back` timetable, it is used as that route's main L/R column.
- If the operator publishes **two distinct go/back departure lists inside the same L or R route**, the additional list is shown separately below, not silently discarded or incorrectly assigned to the other route's first stop.
- Each individual board (main L, main R, additional direction panels, X and A variants, route 34 special panels, and ordinary routes) identifies the first stop using the API. When `info.first_station` is missing, the first stop in that direction's `stops[]` is used; if neither exists, the label explicitly reads `ไม่ระบุใน API`. This metadata is **not** derived from the public endpoint names.
- On mobile the paired timetables stack **L first, R second** for legibility; on desktop and iPad landscape they appear side by side. Phone navigation labels follow L/R.
- General X-group rules and 517 vs 517X separation continue unchanged. A published L/R pair does not swallow an unrelated X service.
- The visual Live Server preview for 147L/147R uses example times and clearly identifies itself as a DEMO; live data is available only via `node server.js` on port 3000.

**Live API note:** Route pairing and API response parsing have automated test coverage with simulated operator responses. The live operator endpoint and actual published route catalog still require confirmation on the user's network.

## v20: Route 34 service-day and legend corrections

- Red legend: `สีแดง = รถเส้นทางตัดเสริม X (เสริม)`
- Blue legend: `สีน้ำเงิน = สาย A หรือสายที่มีปลายทางต่างจากเส้นทางหลัก`
- Separate blue service notice: `สาย 1-3(34) หมดระยะบางเขน`
- Blue 1-3(34) minutes have a compact `หมดระยะบางเขน` label.
- Route 34's Hua Lamphong return board now uses a source-informed timetable display start. When API shows the outbound first bus in early morning and the return list spans 01:xx/02:xx and the daytime, the return list starts at its first departure at or after 03:00, and 01:xx and 02:xx display as 25 and 26 at the end.
- These are **operating-day timetable labels**, not independently verified calendar dates. The TSB feed has no per-departure calendar date field.
- Other routes and other grouping rules remain unchanged.


## v21 — Per-route service-day ordering for ALL routes

The earlier v20 route-34-specific guess has been removed. For every route and
API direction, the site's time layout now uses that **same direction**'s
`get_route.php` → `info.first_bus` to position departures relative to the
published beginning of the operating day. Departures **earlier than that
first-bus time** are placed at the bottom in the 24–29 hour format, and
show a small `วันถัดไป` clock-hour caption.

This also works for a combined station board containing separate A or X route
trips: their published `first_bus` values are used separately. The API's
clock-only times do NOT prove a specific calendar date. In particular, if
the source reports 03:00 as its first bus, it stays at the beginning rather
than being arbitrarily converted to 27:00. Confirm unexpected bounds using
the official TSB source linked on the board.

As before, a normal route with only a 00:xx overnight time keeps its familiar
00 row at the bottom. Route 34, A/X pairs, L/R boards, mobile/iPad layouts,
and the existing Thai color legends are preserved.

## v22: Blue legend correction
- General blue legend remains: `สีน้ำเงิน = สาย A หรือสายที่มีปลายทางต่างจากเส้นทางหลัก`.
- The separate blue explanation `สาย 1-3(34) หมดระยะบางเขน` is displayed **only** when an actual `1-3(34)` / `1-3 (34เสริม)` service is present in the loaded timetable, including the route 34 combined page.
- Other routes do not display the 1-3-specific explanation.

## v23: High-quality picture export

Use **บันทึก PNG** to download the complete timetable signboard as a 3× high-resolution PNG (about 3480 pixels wide), or **SVG** for a scalable vector image. Export includes all timetable panels and supplementary route boxes, legends, source link and first-stop notes. Controls and navigation are excluded.

For best compatibility, use Chrome or Edge on a desktop. The SVG download is a fallback if a mobile browser cannot rasterize the image. The PNG export uses standard browser Canvas/SVG features and does not install libraries or upload data.

**Note:** Live departure times must finish loading before export. If you are in Live Server preview mode, the exported timetable contains DEMO times, not live service times.
