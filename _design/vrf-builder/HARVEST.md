# HARVEST MAP — DUCTR VRF Design Studio (standalone)

*Line references point to `extracted/app.html` (8,948 lines), decoded from `vrf-builder-standalone.html`. Audited 2026-07-03. Grades: A = port nearly as-is · B = reshape needed · C = discard/rewrite.*

**Layout:** CSS lines 1–1685 · HTML shell/panels/modals 1686–2365 · main JS 2366–8620 · "ductr-chrome" presentation-override script 8621–8797 · theme "tweaks" script 8867–8945

---

## 1. App architecture

**State:** One global mutable `const state = {...}` object (lines 2371–2399), mutated directly by ~150 top-level functions wired via inline `onclick` handlers (147 of them). No classes, no modules, no framework, no event bus — re-rendering is done by manually calling the relevant `renderX()` functions after every mutation.

```js
// lines 2371–2399 (plus later additions at 4505–4511)
state = {
  step, floors: [], activeFloor,
  systems: [{id, name, color, rooms:[], odu, phase}], activeSys, globalPhase,
  rooms: [], placedUnits: [], pipes: [], risers: [], junctions: [], bcBoxes: [],
  polygons: [],                     // added line 4508
  calibStart, calibEnd, selectedUnit, tool, pipeStart, pipePath: [],
  nextRoomId, nextUnitId, nextPipeId, nextRiserId,
  vp: {x, y, zoom}, crop, canvasOffset, mode, noPlansCanvasMode,
  currentJobnum, _undoStack: [],
  northArrow: {x, y, bearing} | null,
  settings: { climateZone, buildingType, baseWm2Override, defaultGlass,
              defaultCondition, defaultHeight, pipeUnit }
}
```
- `state.scale` is a **getter/setter proxy to the active floor's `scale`** (`Object.defineProperty`, 2405–2408) so per-floor calibration works without touching older code. Clever, but a landmine for porting — scale is implicit global context.
- **Undo:** deep-clone snapshot stack (`pushUndo`/`undo`, 2436–2490), max 30, `JSON.parse(JSON.stringify(...))` of all drawable arrays.
- **Persistence:** localStorage. `saveDesign()` (7382–7420) writes `vrf_design_{jobnum}` but **drops** polygons/junctions/bcBoxes/northArrow/settings; `autoSave()` (8321–8368, 3s debounce + 20s interval, ~4.5MB quota fallback stripping images) saves the **complete** set. So manual save is lossier than autosave — a known-bug to not port.

**Canvas rendering:** Single `<canvas id="floor-canvas">` 2D context (line 2006). Full-scene immediate-mode redraw in `drawCanvas()` (5407–5800): plan image (or dot-grid blank page) → pipes → junctions → rect preview → polygons → units → risers → north arrow → overlays. Zoom/pan is applied via **CSS transform on the wrapper div** (`applyTransform`, 4605–4614), not ctx transform — all stored coordinates are in image-pixel space, and screen↔canvas conversion is `screenToCanvas` (4583). Line widths divide by `state.vp.zoom` to keep constant screen weight. Layer visibility flags in `LAYERS` (2411).

**Drawn-object data shapes** (all coordinates in floor-image px; every object carries `floor` index + `sysId`):
- **Placed unit** (6981–6985): `{id, type:'idu'|'odu', sysId, floor, x, y, rotation, model, kw, roomId}`
- **Pipe run** (4797–4798, 5331–5334): `{id, sysId, floor, points:[{x, y, unitId?, riserId?}...], size (suction mm), liq, lw, col, sized, kw?, riserId?, riseHeight?}` — connectivity to units/risers is recorded **only as tags on endpoint points**, not a graph.
- **Room** (6416–6428): `{id, name, floor, sysId, kw, area_m2, method:'heat', width, length, height, glass, condition, orientation, orientationLocked, partyWall?, externalWalls:[], polygonId, units:[{model, type, kw}] (max 4)}`
- **Polygon** (4768, 6408–6413): `{id, roomId, floor, points, color:'#f59e0b', area_m2, excluded}`
- **Riser** (4991): `{id, sysId, floor, x, y, label:'R-A', dir:'up'|'down', groupId, destFloor?, destName?}`
- **T-junction** (4832–4837): `{id, floor, sysId, x, y}` — cosmetic marker only
- **BC box** (4852–4860): `{id, floor, sysId, x, y, model, branches, label}`
- **Floor** (3665, 3251): `{id, name, level?, imageData (dataURL), pageIndex, srcFile, scale?}`

---

## 2. Hardcoded product data (the prime cargo)

All Mitsubishi Electric, sourced/annotated against named data books (comment block 2507–2517: City Multi Brochure 2019, PUMY data book M-P0860, PUHY data book MEES21K029). A "knowledge-base integrity guard" `verifyModel()` (2812–2818) warns on unknown models.

| Table | Lines | Shape | Fields | Contents |
|---|---|---|---|---|
| **`UNIT_DATA`** (indoor units) | **2525–2738** | Object keyed by model string | `kw` (cooling), `heat`, `type` (family code), `label`, `w, d, h` (mm; w×d is plan footprint), `esp` (static-pressure note), `liq`, `gas` (connection mm) | ~140 models across 20+ families: PEFY-P VMX/VMA/VMHS (standard ducted, 2528–2559); "advanced": PLFY VEM/VFM/VLMD cassettes (2561–2587), PMFY VBM (2590), PEFY VMR/VMS1/VMA3/VMHS-E-F/VMH-E-F (2594–2627), PKFY wall & cassettes (2629–2633, 2664–2670), PFFY floor-standing (2635–2647, 2708–2713), PCA-M/PLA-M/SLZ-M cassettes (2648–2676), PLFY-P VCM ceiling suspended (2678–2684), PCFY (2686–2692), PEAD-M (2694–2700), SEZ-M (2702–2706), MFZ-KW (2715–2718), MSZ-AP/EF/LN wall-mounts (2720–2736) |
| **`ODU_DATA`** (outdoor units) | **2747–2771** | Array of objects | `model, series, hp, kw, heat, minKw, maxKw` (connectable IDU range = 50–130%), `phase` (1/3), `w, d`, `liq, gas` | 19 models: PUMY-SP 80/112/125/140 in 1Ø & 3Ø (2749–2757), PUMY-P 200/250/300 (2759–2762), PUHY-P 200→500YNW-A1 (8–20 HP, 2764–2770) |
| **`IDU_TYPES`** | **2774–2807** | Array | `value` (family code matching `UNIT_DATA.type`), `label`, `desc`, `advanced` flag | Dropdown taxonomy; `advanced:true` gates BC-controller requirement. Note duplicate `value:'WALL'` entries (2799–2801) — MSZ-AP/EF/LN share a code, so the type→model filter can't distinguish them |
| **`MM_TO_INCH`** | **2823–2826** | Object | mm → imperial string | 6.35→1/4", 9.52→3/8", 12.7→1/2", 15.88→5/8", 19.05→3/4", 22.2→7/8", 28.58→1‑1/8" |
| **`PIPE_SIZE_ORDER`** | **2829–2835** | Array | `{liq, suc, col, lw}` | 5 liq/suction pairs incl. 12.7/28.58 for legend ordering |
| **`PIPE_SIZES`** | **3134–3139** | Object keyed sm/md/lg/xl | `{liq, suc, col, lw, label, name}` | 6.35/12.7 · 9.52/15.88 · 12.7/19.05 · 15.88/22.2 |
| **`getPipeSize(kw)`** | **3141–3147** | Function | kW → size bucket | ≤5.6 kW→sm, ≤14→md, ≤33.5→lg, else xl |
| **`BC_DATA`** (branch controllers) | **3153–3159** | Array | `model, branches, maxKw, w, d, h, label` | CMB-P104/106/108/1012/1016V-J (4–16 port). `selectBCBox(n)` (3167–3170) picks smallest fit; `ADVANCED_IDU_TYPES` Set (3162–3165) lists families requiring one |
| **`CLIMATE_ZONES`** | **2901–2950** | Object keyed 1–8 | `label, cities, residential, light_commercial, commercial` (W/m²), `note` | Australian NCC climate zones with rule-of-thumb W/m² (e.g. Zone 5 residential = 145 W/m²) |
| **`ORIENT_MULT` / `ORIENT_LABELS`** | **3034–3048** | Object | 8-point compass → cooling multiplier | N 1.00 … W 1.30 (Southern-Hemisphere logic) |
| Heat-load factors | **2958–2968** (`calcHeatLoad`) | inline | glass {0.80/1.0/1.24}, condition {0.85/1.0/1.2}, height >2.7m ×1.1 | `kW = area × W/m² × glass × condition × height × orientation / 1000` |
| ODU auto-selection rule | **4462–4473** (`updateOverview`) | inline | picks first ODU with `kw ≥ totalKw×0.85 && maxKw ≥ totalKw`, phase-filtered; loading OK band 50–130% | plus `manualODU()` override with `oduManual` flag (4485–4496) |
| IDU auto-selection | **4436–4446** (`selectUnit`) | function | smallest model of a family with `kw ≥ required`, else largest | |
| `FLOOR_PRESETS`/`ROOM_PRESETS`/`LEVEL_OPTIONS` | 3940–3942 | arrays | name presets | |

**Grade A cargo.** These tables are clean, well-commented, source-cited JSON-ready data. Extract into the universal table with provenance. Two data bugs to fix on import: `PEFY-P100/125/140VMHS-E` (2555–2557) have `liq:15.88, gas:9.52` — liq/gas visibly **swapped**; and the duplicate `WALL` type code above.

---

## 3. Pipe sizing / connection logic

What exists:

- **`autoPipeSize()` (6561–6584)** — the only "engine". Per pipe run: sum `kw` of units tagged on its endpoints; if zero, fall back to **the whole system's total load** ("trunk" assumption); bucket via `getPipeSize(kw)`; stamp `size/liq/lw/col/sized/kw` onto the pipe. That's it.
- **No graph model.** Pipes are independent polylines. T-junctions (4827–4842) are visual dots snapped onto a pipe (`nearestPointOnPipes`, 6524–6542) with **no topology** — they don't split runs or aggregate downstream load. There is **no downstream-capacity aggregation**, no branch tree, no REFNET/joint schedule, no length-based corrections, no vertical-lift derating, no max-length validation against ODU limits (`minKw/maxKw` exist in data but are only used for ODU selection).
- **Riser vertical travel:** `promptPipeHeight()` (6587–6594) asks metres of rise via `prompt()` and stores `pipe.riseHeight` "for the engine" — but nothing consumes it except the materials riser-length estimate.
- Endpoint snapping tags `unitId`/`riserId` onto points (4782–4824), which is the seed of a real connectivity graph.

**Verdict: grade C for the algorithm, grade A for the size tables/rules.** The new Design Studio needs a proper network graph (nodes = units/branches/risers, edges = runs) with downstream aggregation; only `getPipeSize`, `PIPE_SIZES`, `MM_TO_INCH`, and the endpoint-snapping UX are worth carrying.

## 4. Floor plan handling

- **Upload:** drag-drop/file input (1839–1846, 3314–3316) → `processFiles` (3332–3376). PDFs rendered client-side via **pdf.js from CDN** (`loadPDF`, 3404–3474) at 0.5× thumbs + 2× full-res dataURLs; images via FileReader (3382–3402). Page labels guessed by **keyword-scoring the PDF text layer** ("ground floor", "level 2", …, 3434–3456).
- **AI page classification:** `analyseWithAI()` (3672–3821) posts each page thumbnail to `https://api.anthropic.com/v1/messages` (claude-sonnet-4, 3706–3733) **directly from the browser with no API key header** — cannot work as-is; must move server-side in Next.js. Returns `{label, is_floor_plan, reason}`, auto-selects floor-plan pages, computes token cost. Nice pattern, needs a proxy route + current model id.
- **Page picker → floor allocation:** picker grid with lightbox (3477–3654), `buildFloorAllocFromSelection` (3656–3669) creates `state.floors`; per-floor rename/level allocation modal (3945–4037); "no plans" path creates blank floors (3246–3312).
- **Scale calibration (2-point):** tool `calib` — two clicks store `calibStart/calibEnd` (4752–4756) → modal (2281+, `showCalibModal` 7104) shows px length, user types real-world metres, live preview shows how wide a known unit would render (7115–7122), `confirmCalib` (7124–7138) sets `scale = px/metres` **per floor**, re-derives all room dimensions from polygons (`recalcRoomsFromPolygons`, 7140–7164), then prompts to set north. Simple and effective — grade A concept.
- **Multi-floor:** floor tabs (4534+); per-floor scale; every object carries `floor`. **Riser linking between floors is real:** `showRiserConfig`/`confirmRiserConfig` (6598–6682) sets direction + destination floor and **propagates a mirrored riser onto the destination floor at the same x/y with a shared `groupId`** — but positional mirroring assumes both floor images share alignment, and nothing links the pipe networks across floors beyond the marker.

## 5. Canvas interactions (quality/reusability)

- **Pan/zoom:** wheel zoom-at-cursor (`zoomAt`/`canvasWheel`, 4648–4665), space-drag or empty-click pan, pan clamping/centring (`clampPan`, 4591), fit/100% (4616–4640). Clean, dependency-free, grade A.
- **Select/drag:** unit hit-test respecting rotation (`findUnitAt`, 6851), drag-move (5091–5100 region), floating rotate handle with free spin snapping to 90° on release (5003–5007, 5246–5250), inspector popover, `Delete` key. Good.
- **Drag-and-drop placement from palette** (6883–6996): HTML5 dataTransfer with custom drag image; palette derived from rooms so each room's unit can be placed exactly once; ODU once per system. Grade A pattern.
- **Pipe drawing:** click-to-add-vertex with **ortho snap** (`orthoSnap`, 6516), snap-to-unit-connection (18px/zoom, 6503), snap-to-riser ends run with auto L-corner insertion (4789–4805), double-click ends run (5326–5339), Esc/right-click cancels (`cancelCurrentAction`, 4704). Good UX, no post-hoc **vertex editing** (mousemove handles only north/rotate/unit drags + hover cards).
- **Polygon/rect room tools:** click-vertices/close-on-first-point (4764–4780), drag-rectangle (5268–5294), shoelace area, then a **wall-select flow** (click edges to mark external walls, 5825–6092) feeding orientation + heat load, room modal (6113–6440).
- **Eraser:** unified click-delete for units/pipe-segments/junctions/BC/risers with per-type hit tests (4876–4936). Segment-level pipe deletion included.
- **North arrow:** place, drag-to-move, drag-tip-to-rotate (4944–4985), drives `autoDetectOrientations()` (3110–3118) with the longest-edge/solar-rank heuristic `primaryWallBearing` (3059–3107) — genuinely nice, grade A.
- **Crop / grayscale / brightness** of plan (5364+, 5421), incl. coordinate re-offsetting on crop reset (5340–5359).
- Snap-confirmation glow feedback (5031–5040, 5483–5488), hover cards for rooms/units/components (5110–5237 region).

Overall grade **A/B**: the interaction code is well-factored per-tool inside three big mouse handlers; portable to a React canvas component largely by transcription, but it's all keyed to the global `state` and `state.activeFloor/activeSys`.

## 6. Materials / takeoff

`renderMaterials()` (7219–7363) + `calcPipeLength()` (7200–7217): per system — indoor unit rows from rooms, BC controllers (with "advanced units detected, place a BC" warning), ODU row with phase note, pipe lengths **grouped by liq/suction pair measured with each pipe's own floor scale**, riser vertical = count × floor-height input, condensate drain = 1m/IDU estimate; plus a combined-totals table across systems (7347–7360). `exportPDF()` (7422–7560): jsPDF + autotable from CDN — job header block, per-system unit/pipe tables, first floor-plan image, footers. Grade **B**: logic is sound and simple; it's HTML-string soup and VRF-specific categories, but the shape (per-system BOM → combined) matches the new Materials step. No pricing, no fittings/insulation/cable, no branch joints in the takeoff.

## 7. UI structure

Stepper topbar `Home(0) → 1 Plans → 2 Design → 3 Materials → 4 Job` (1700–1711, `goStep` 3172), **exactly the Plans→Design→Materials→Job flow** the new studio wants. Panels: Home with recent-designs grid + search (1739–1805, re-rendered by chrome layer 8624–8677); Plans with mode chooser/upload/floor alloc + newer "pv2" sheet-strip layout (1808–1888, 8725–8778); Design = left vertical tool rail (select/undo/crop/B&W · rect/poly · pipe/T-junction/BC/riser/eraser, 1907–1950), canvas topbar (floor tabs, zoom, layers dropdown, legend, **Calibrate scale**, **Set north**, **Auto-size pipes**, 1955–2001), right panel with system tabs + Rooms/Units/Parts pill sections (2013–2029+); Materials (2124–2135); Job details form (`jd-*` inputs, 7368–7379). A "chrome" script (8621–8797) monkey-patches `renderHome`/`updateTopbar`/`goStep` for presentation, and a "tweaks" panel (8844–8945) does accent/texture/font theming via postMessage edit-mode protocol — both are shell-specific, discard.

**The 'schematic' mention:** line 1350 CSS comment — *"Pipework schematic draw-in behind the New-design text"*. It is purely a **decorative animated SVG** on the Home "New design" card (SVG at 1744–1767). There is **no functional schematic/riser-diagram view** anywhere in the app.

## 8. Reuse grades

| Piece | Lines | Grade | Notes |
|---|---|---|---|
| Product data tables (UNIT_DATA, ODU_DATA, BC_DATA, IDU_TYPES, pipe sizes, MM_TO_INCH) | 2525–3170 | **A** | Extract verbatim to the universal table; fix VMHS liq/gas swap + duplicate `WALL` code; add system-type dimension for multi-system future |
| Heat-load model (CLIMATE_ZONES, ORIENT_MULT, calcHeatLoad, north/orientation detection) | 2901–3118 | **A** | Pure functions + data; Australia-specific but self-contained |
| 2-point scale calibration + per-floor scale + room re-derivation | 7104–7171, 2401–2408 | **A** (concept) / B (code) | Replace the `state.scale` getter-proxy with explicit `floor.scale` passing |
| Pan/zoom/snap/ortho/hit-test geometry helpers | 4583–4674, 6483–6553, 3121–3128 | **A** | Framework-free math, lift directly |
| Unit palette → drag-drop placement → rotate/inspect | 6883–7100, 5000–5024 | **A−** | Rework "one placement per room-unit" rule for multi-system |
| Pipe-draw tool UX (ortho, unit/riser snap, auto-corner, dbl-click end) | 4782–4825, 5326–5339 | **B** | Keep UX; store results into a proper graph model instead of loose polylines |
| Riser cross-floor propagation | 6598–6682 | **B** | Good idea; needs floor-alignment handling and network linkage |
| Auto pipe sizing algorithm | 6561–6584 | **C** | Endpoint-only load attribution + whole-system fallback; rewrite as downstream aggregation over a branch tree. Keep `getPipeSize` thresholds |
| T-junctions | 4827–4842 | **C** | Cosmetic markers, no topology |
| PDF upload / pdf.js page picker / AI page classify | 3319–3821 | **B** | Solid flow; AI call must move to a Next.js API route (currently key-less browser fetch to Anthropic, model id stale); CDN pdf.js → npm dep |
| Materials/BOM generation + PDF export | 7195–7560 | **B** | Right aggregation shape; re-implement as data → React table; categories are VRF-only |
| drawCanvas full-scene renderer + eraser + crop/grayscale | 5407–5800, 4876–4936, 5364+ | **B** | Fine as a canvas layer; entangled with globals and DOM ids |
| Undo (deep-clone snapshots) | 2436–2490 | **B** | Works; consider command-based undo in the new app |
| Autosave/save/load (localStorage) | 7382–7420, 8304–8620 | **C** | Replace with server persistence; note manual-save drops polygons/junctions/bcBoxes/settings (bug) |
| Stepper/panels/home/chrome/tweaks UI shell | 1–2365, 8621–8945 | **C** | Rebuild in Next.js; keep only the Plans→Design→Materials→Job step taxonomy and tool-rail layout ideas |

**Single-system / VRF-only assumptions woven in (things multi-system Design Studio must break):**
1. `state.systems` exists (max 5 colors, `SYS_COLORS` 2492) but **one active system at a time** gates everything: palette (6886), rooms sidebar filter (4310), ODU auto-pick per system (4448–4483), pipe `sysId` stamped from `state.activeSys` at draw time (4796). Cross-system views exist only in Materials.
2. Each room has exactly one `sysId`; each system exactly one ODU (`sys.odu`), placed at most once (6977–6979) — no multi-module ODU banks, no heat-recovery vs heat-pump distinction.
3. VRF vocabulary is hard-wired into tool rail (BC Controller, riser), legend, save keys (`vrf_design_*`, `vrf_autosave*`), PDF header ("VRF SYSTEM DESIGN", 7441), and validation copy — the canvas engine itself (rooms/polygons/scale/units/pipes) is actually system-agnostic and is the most transplantable layer.
4. `autoPipeSize` fallback "no endpoint units → whole system load" bakes in one-trunk-per-system topology.

**Top 5 highest-value extractions, in order:** (1) product/climate/pipe data tables, (2) heat-load + orientation engine, (3) calibration + geometry/snap helpers, (4) palette→canvas placement interaction pattern, (5) per-system→combined BOM aggregation shape.
