# Design Studio — Summary, Logic & Build Order

*Companion to `Design_Studio_Brief_for_Design.md` (the visual/interaction spec). This document is the **engine + build plan**: what the tool is, how every feature ties into the others, how the hard logic works, and the order to build it in so each layer can be tested and locked before the next goes on top.*

---

## Part 1 — What the Design Studio is

One canvas tool inside HeyTiff where a company can design **every HVAC and ventilation system on a job** — on a calibrated floor plan (multi-floor) or a blank canvas — and get a validated design, a materials takeoff, and an exportable job pack out the other end.

It replaces the standalone VRF Builder. VRF becomes *one system type among several*:

| Tier | System types | Complexity driver |
|---|---|---|
| 1 | Split (1:1) | Matched pair selection only |
| 2 | Multi-split | Ports + combination ratio |
| 3 | Unit form factors (bulkhead, floor console, under-ceiling, cassette) | Product data + placement, not new logic |
| 4 | Ducted | Duct network, grilles, zoning (incl. AirTouch / MyAir / OEM), sensors, diversity |
| 5 | VRF | Pipe topology solver, auto pipe sizing, joints/headers, BC boxes — **and can host ducted indoor units, reusing tier 4** |
| 6 | Ventilation | Airflow (L/s) instead of kW; fans, Lossnay/HRV/ERV; reuses duct tools |
| 7 | Sheet metal ductwork | Rectangular duct sizing engine (airflow + distance + velocity), fittings |
| — | Gas heating | Deferred, but the architecture must leave a slot for it |

The critical architectural fact: **these are not seven separate tools.** They are seven *interpreters* sitting on one shared skeleton. Get the skeleton right and each new system type is a bounded module; get it wrong and every addition destabilises the last.

---

## Part 2 — The architecture: five layers, and how everything ties together

```
┌─────────────────────────────────────────────────────────────┐
│ 5. EXPERIENCE      simulation mode · ghost underlays · polish│
├─────────────────────────────────────────────────────────────┤
│ 4. OUTPUT          validation badges · materials/takeoff ·   │
│                    filter matrix · export sheets · job pack  │
├─────────────────────────────────────────────────────────────┤
│ 3. SYSTEM MODULES  split · multi · ducted · VRF · vent ·     │
│                    sheet metal   (each = palette + rules +   │
│                    sizing interpreter + validation plugin)   │
├─────────────────────────────────────────────────────────────┤
│ 2. DOMAIN          rooms & loads engine · product data packs │
│                    · systems container · connectivity graph  │
├─────────────────────────────────────────────────────────────┤
│ 1. FOUNDATION      canvas engine · floor plans & calibration │
│                    · object model · persistence · undo/redo  │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1 — Foundation (system-agnostic, built once, locked hard)

- **Canvas engine.** Pan, zoom, select/multi-select, drag, vertex editing, snapping (grid + object points), eraser, hover cards, layer visibility. Knows *nothing* about HVAC — it renders and edits typed objects.
- **Floor plan management.** Upload PDF/PNG/JPG → page picker → assign pages to floors → 2-point scale calibration → north. Each floor is its own canvas with its own scale. **Everything measurable downstream (room areas, pipe lengths, duct lengths) traces back to calibration** — this is the single most leverage-heavy piece of correctness in the tool.
- **The object model.** Every placed thing is a typed object: `{ id, type, systemId, floorId, geometry, plane, props }`. Rooms are polygons; units are points; runs are polylines; junctions are nodes. All derived values (area, length) are computed, never stored as truth.
- **Placement plane** (answers the "under floor / roof cavity" question). Each floor carries vertical planes: `floor-cavity · room · ceiling-cavity · roof-cavity · external-ground · external-roof`. Every object has a `plane`. **Recommended UX: default by object type** (ducted IDU → ceiling-cavity, underfloor unit → floor-cavity, wall-mounted split → room, ODU → external-ground), **editable in the inspector** — no modal interrogation at placement time. Plane drives: rendering style (ghost/dashed for concealed planes), vertical drop lengths added to runs, riser/dropper materials, and validation (e.g. service access warnings later).
- **Persistence + undo/redo.** The design document is one serialisable JSON tree (objects + systems + settings + data-pack version reference). Undo/redo = document snapshots or ops. This JSON is also the format of every **golden test fixture** (Part 4), so it must be stable and versioned from day one.

### Layer 2 — Domain (the shared brain)

- **Product data packs — the most important asset in the whole build.** One **universal schema**; data books are transcribed into it, and the **engine only ever queries the universal table — no code path reads a data book directly**. Data books and installation manuals are *input sources* for an ingestion step (with validation at entry, so transcription errors are caught at input time, not on a design), and every value carries **provenance** (brand, book, edition, page) so a revised data book maps to exactly the rows it affects. Adding a brand is data entry, not development. Brand quirks that don't share columns (BC boxes vs refnets, differing combination-rule shapes) are handled as a common core + structured per-system-type rule blocks — designed at Stage 2, before any system module is built. The schema also serves as the **extraction checklist**: it declares, per system type, which fields are *required* for the engine vs optional, so ingesting a new data book is a known procedure (hunt for exactly these fields), not an interpretive exercise. An **engine-ready flag is computed per model** — a unit only appears in the palette once its required fields are filled — so partial ingestion is always safe: incomplete entries are simply not offered, and completeness is visible per range ("14 of 22 models engine-ready"). Structurally the table is a set of **linked sections** (units · pipe tables · joint/header parts · grilles · zoning controllers · accessories…) with cross-references between them; the engine **resolves links on design events** (place a VRF IDU → its index → pipe-size section → joint-parts section → materials; pick AirTouch → its damper/sensor/expansion-module parts by zone count). Referential integrity is **validated at ingestion** — a broken cross-reference is an input-time error, never a blank on a design. What the schema holds, per brand:
  - unit models (capacity cool/heat, airflow, form factor, connection sizes, capacity *index* for VRF, allowed planes)
  - 1:1 pair tables (matched IDU+ODU with pipe sizes, max length, max lift, pre-charge, additional charge g/m)
  - multi-split outdoor tables (ports, min/max combination %, per-port pipe sizes, allowed IDU combinations)
  - VRF tables (connection ratio limits, **joint/header part selection by downstream index**, **pipe size by downstream index**, max lengths/lifts, additional charge rules, BC box rules)
  - ducted data (unit static pressures, standard duct size list, grille catalogue: type/style/size/airflow rating)
  - zoning controller packs (AirTouch, MyAir/MyPlace, OEM zoning): max zones, damper types, sensor options, required expansion modules/accessories
  - ventilation (fan curves as simple airflow ratings initially, Lossnay/HRV/ERV models)
  - accessories per unit model (Wi-Fi adaptors, controllers, condensate pumps, filters)
  - A design **stores the data-pack version it was built against**, so an old job never silently changes when a pack is updated.
- **Rooms & loads engine.** Room polygon + scale → area; area + glazing/condition/orientation inputs → heat load (kW). Ventilation mode swaps the kW block for an **airflow requirement (L/s)** with presets (bathroom/laundry/kitchen, fresh-air per person). Pure functions, unit-tested against hand-worked examples.
- **Systems container.** A system = `{ id, type, brand, colour, name, settings }`. It owns objects via `systemId`, drives the inspector flow, picks the validation plugin, and groups the materials output. The type does **not** lock tools — per the brief, all tool groups stay available (a VRF system uses ducted tools for its ducted IDUs).
- **The connectivity graph — one graph, many interpreters.** Refrigerant pipe, ductwork, and vent duct are all the same underlying structure: units and junction nodes connected by run segments (with risers as vertical edges linking floors). Build **one** graph service (build graph from drawn objects, find connected components, compute downstream aggregates per edge, detect orphans/loops). Each system module then *interprets* the graph its own way — VRF aggregates capacity index, ducted aggregates airflow. This single decision is what makes VRF, ducted, vent, and sheet metal all buildable without re-inventing plumbing four times.

### Layer 3 — System modules (each one: palette + selection rules + sizing interpreter + validation plugin)

**Split (1:1).** One room → engine offers matched pairs from the brand's pair table sized ≥ room load → place IDU + ODU → draw the run. Pipe size comes straight off the pair table. Validation: exactly 1 IDU + 1 ODU, run length ≤ max, lift ≤ max. *Deliberately the first module built — it exercises the entire spine (system → rooms → selection → placement → run → validation → materials → export) with the simplest possible rules.*

**Multi-split.** Several rooms → propose an outdoor where `ports ≥ IDU count` and combination % within brand limits → per-port pipe sizes from the table → optional branch boxes. Badge: `4/5 ports · 112% combo ✓`.

**Form factors (bulkhead / floor / under-ceiling / cassette).** Almost entirely **data, not code**: new palette entries with form-factor tags and default planes. The one logic addition is plane-aware placement (bulkhead → ceiling-cavity with a grille implication, floor console → room at floor level).

**Ducted — the drawing model (route, don't draft).** Tools like PolyPlan prove to-scale ducted design works, but at CAD-level complexity — the user drafts every fitting. Design Studio inverts this: **the user routes centerlines and places symbols; the engine does the drafting.** Four rules:
1. *Centerline in, true width out.* Duct runs are click-routed polylines (same interaction as pipe); the selected duct size × floor calibration determines the rendered body width, so a 350 mm trunk visibly occupies 350 mm. Changing size in the inspector reflows the drawn body. Unsized runs render thin/ghost — rough the layout first, size after.
2. *Parametric symbols, no resize handles.* Units/plenums/grilles/dampers take their footprint (w×d mm) from the universal table, scaled by calibration. Wrong size = change the model/size, never drag. Scale honesty is structural.
3. *Branching is explicit; part selection is automatic — the junction-circle model.* The user places a **junction node** (rendered as a circle while unresolved) and routes ducts to it; the fitting resolves itself live from what's connected: 1-in/1-out same size → coupling; sizes differ → reducer; 300 in + 2×200 out → a **12-8-8** branch (fittings labelled in the trade's inch nomenclature, mm alongside); more outlets → multi-way takeoff/header. Add or remove a duct and the part re-resolves. Flow direction (hence which leg is the inlet) is known from the graph's root at the unit/plenum. Once resolved, the node renders as the actual fitting, to scale, oriented to its ducts. Topology is therefore never inferred — a placed junction is an unambiguous "ducts join here" — while the user still never opens a fittings catalogue. *In-line* fittings along a single run still derive automatically: vertices → bends; size changes → reducers; duct↔unit → plenums/boots; duct↔grille → neck adaptors; inspector override always available. (PolyPlan's fitting catalogues live on as *data* in the parts/duct sections — the manual drafting of them does not.) **The identical place-node-connect-runs interaction serves VRF joints/headers and BC boxes** (part self-selects by downstream index) — one pattern, both domains.
4. *Magnetic connection anchors.* Spigots on units/plenums/grilles are snap points; ending a run on one creates the connectivity-graph edge — the same action drives airflow aggregation, undersize warnings, and the live schematic.
Blank-canvas mode sets an explicit scale up front (default 1:100 grid), so "everything scaled to size" holds without a floor plan. Interaction vocabulary stays at three verbs — place, route, edit — for every ducted component.

**Ducted.** The full workflow from the brief: rooms sum → **zoned toggle** applies diversity (`Σ load × 0.70` default, editable; card shows `Connected 14.2 kW → Sized 9.9 kW`) → propose smallest matched ducted pair ≥ sized load → place IDU (ceiling-cavity) + ODU → refrigerant run → **supply trunk + branches + return path** drawn with duct tools → grilles per room (type/style/size/airflow share) → zone dampers on branches + room sensors when zoned → filter at return. Duct sizes: **user picks from the standard size list** (auto-size is a later enhancement — but the graph already computes per-segment airflow, so the engine can *flag* undersized picks from day one and *recommend* later). Room airflow = its share of unit airflow (by load proportion, overridable). **Zoning controllers:** picking AirTouch / MyAir / OEM zoning on the system card swaps in that controller's damper/sensor/expansion-module parts in the materials — data-pack driven, no bespoke code per vendor.

**VRF — the hardest engine, and the one worth the most care.**
- *Topology:* the drawn pipe network (ODU → segments → joints/headers/BC boxes → IDUs, risers across floors) becomes a tree in the connectivity graph. Two junction kinds: **joint (Y-branch)** — one in, two out; **header** — one in, N out (this is the "T-junction off the main run splitting two ways with three units each side").
- *Auto pipe sizing:* for every segment, sum the **capacity index of all downstream IDUs**, then look the size up in the brand's pipe table (liquid + gas, and high/low for R2/heat-recovery later). This is exactly how the data books specify it — and it makes the "equal split" behaviour **fall out naturally**: a header with 3 units of equal index each side has equal downstream index both ways → equal pipe both ways. No special-case code; the *data-book rule is the algorithm*.
- *Fitting selection:* joints and headers are themselves parts chosen by downstream index (e.g. CMY-series selection tables) — same lookup pattern, feeds materials automatically.
- *Also from the same graph:* total/farthest run length vs limits, height differences (ODU↔IDU, IDU↔IDU) via riser edges vs limits, **additional refrigerant charge** (liquid-line length per size × g/m + rules), connection ratio badge (Σ IDU index ÷ ODU index).
- *Ducted IDUs on VRF:* the IDU is simply a ducted-form-factor unit inside a VRF system — the tier-4 duct toolkit attaches to it unchanged, its ductwork/grilles tag to the VRF system and appear in its materials. **This only works if ducted was built as a toolkit, not as a system-exclusive feature** — which is why ducted is built and locked *before* VRF.

**Ventilation.** Rooms carry L/s (exhaust / supply / balanced) instead of kW. Place exhaust fans, fresh-air supply fans (incl. underfloor), or Lossnay/HRV/ERV sized so unit airflow ≥ Σ room flows (both streams for balanced ERV). Vent ducts + grilles/cowls **reuse the duct toolkit and graph** with an airflow interpreter. Badge: extract vs supply balance.

**Sheet metal.** Rectangular duct on the same graph. Sizing engine: per-segment airflow (already computed) + velocity limits per duct class + friction/distance → recommend W×H from a standard sheet-metal size list; fittings (bends, transitions, take-offs, plenums) derived from geometry at junctions. This is where **blank canvas** shines — sketch a duct scenario with no floor plan. Deliberately late in the order: it needs the graph, airflow interpreters, and grille catalogue all mature.

### Layer 4 — Output (generic frameworks, per-module plugins)

- **Validation framework.** One badge system (green/amber/red on the system card); each module registers rules that read the document + graph + data pack and emit findings. Built once at tier-1 (Split) so every later module just adds rules.
- **Materials/takeoff.** A pure function: `document + data pack → schedule`. Grouped per system with type/brand header; sections vary by type (units, pipe by size + additional charge, branch boxes/joints/headers, duct by size, grilles by type/size, dampers/sensors, filters, condensate, risers/fittings, accessories); whole-job rollup of common consumables. (Grille Builder handoff: **not in the initial build** — the schedule's grille section is designed to be exportable so the handoff can be added later without rework.) **Empty design = empty schedule — nothing hardcoded, ever.**
- **Filter matrix + export.** Visibility = `system visible AND layer on`. The same matrix drives export sheets (overview, pipework only, ductwork only, per-system, riser diagram, materials per system) → PDF, from the Job stage.
- **Live schematic.** A toggleable read-only view that renders the **connectivity graph itself** as a simplified tree — outdoor unit at the root, short straight pipe runs, joints/headers/BC boxes as nodes, indoor units as leaves, with sizes and lengths labelled. Its purpose is **trust**: the floor-plan drawing is spatial reference; the schematic is proof the engine understood the topology ("yes, it sees a header with 3 units each side"). Because it is a pure render of the graph, it costs almost nothing once the graph service exists, doubles as the topology-debugging view during engine development, generalises to ducted/vent trees for free, and is the interactive sibling of the riser-diagram export sheet. Clicking a node highlights the same object on the plan (and vice-versa).

### Layer 5 — Experience (built last, on locked foundations)

Simulation mode (read-only overlay, airflow particles, zone toggles, L/s redistribution, time-to-setpoint — all derived from real design numbers), ghost underlay of adjacent floor when placing risers, hover-card polish, onboarding/empty-state refinement.

---

## Part 3 — Build order

**Current repo state (audited 2026-07-02):** `/dashboard/studio` already exists as a blank placeholder route, wired into the nav with the Design Studio label and its reserved orange accent (`#FF8A00`), and a "Create & edit VRF designs" permission is already defined in `profile.ts`. There is **no canvas code or drawing library** in the repo yet. Two Stage-0 consequences:
- **The shell renders screens as HTML strings** (`screens.ts` → `dangerouslySetInnerHTML`). That pattern is fine for the static pages but is **not viable for the Studio** — a stateful canvas tool must mount as a real React component tree inside the shell frame. Stage 0 includes establishing that mount point cleanly (without touching the shell's existing layout/animations).
- **Canvas technology must be chosen at Stage 0**: SVG-in-React vs a canvas library (e.g. Konva). Decide once — it shapes the whole object-rendering layer.

Theme note: adopt the host theme as it actually exists in the repo (Tailwind 4 tokens in `globals.css`, Jakarta Sans / JetBrains Mono) — where the brief's design-language section differs from the shipped shell, the shipped shell wins.

**Visual target (added 2026-07-04):** the design workspace produced a HeyTiff-skinned, shell-embedded preview of the studio — see `_design/vrf-builder/heytiff-skin/` (`heytiff-skin.css` = the re-theme, `embedded-preview.html` = the studio inside the HeyTiff shell frame, `studio.css` = the engine's styles modularised). The engine inside it is 99.7% identical to the audited standalone (packaging changes only — mounts into a `#dstudio` container), so `HARVEST.md` remains accurate. Treat these files as the **look-and-feel reference for Stage 0**, not as implementation: the skin CSS shows the intended chrome (tool rail, topbar, panels, cards) in HeyTiff tokens, harvestable largely as-is; the mounting scripts are design-preview plumbing, not the React mount.

**Ordering principles:**
1. **Skeleton before organs.** Nothing system-specific until canvas, object model, data-pack schema, and persistence exist.
2. **Thinnest end-to-end slice first.** Split (1:1) proves every layer with the simplest rules — and makes the tool genuinely usable at the earliest possible moment.
3. **Shared services before their biggest consumer.** Duct toolkit before VRF (VRF hosts ducted IDUs); connectivity graph before both.
4. **Each stage ends with: golden scenarios written → CI green → LOCKED.** (Lock mechanics in Part 4.)
5. **Data packs are a parallel workstream** — schema early, populate brand-by-brand continuously; code never blocks on data breadth, only on schema.

| Stage | Deliverable | Depends on | Lock gate (what must pass) |
|---|---|---|---|
| **0** | **Port & shell integration.** New route in HeyTiff, HeyTiff theme/design system, stepper skeleton (Plans→Design→Materials→Job), project persistence + document schema v1, empty states. Harvest the existing VRF builder for parts (see below) — do not transplant it whole. | HeyTiff shell | Document save/load round-trips; schema versioned |
| **1** | **Canvas + plans core.** Upload → page pick → floors → 2-pt calibration → north; pan/zoom/select/snap/vertex-edit/eraser; rooms (polygon/rect) with derived area; undo/redo; layers dropdown; floor switcher. | 0 | Calibration accuracy tests; area-from-polygon fixtures; undo/redo property tests |
| **2** | **Data-pack schema + first pack.** Full schema (units, pair/multi/VRF tables, ducted, zoning, vent, accessories) — **drafted in `universal-table-schema.md`**; Mitsubishi Electric seeded for split + multi at minimum (legacy DUCTR import + first data-book extraction pass — ⚠️ **split pair tables are absent from the legacy import**; the M/MSZ-series data book must be sourced before Stage 4 can lock); pack versioning + design pins pack version. | 0 | Schema validation suite; pack loads; version pinning test |
| **3** | **Rooms & loads engine.** Heat load from area+inputs; sizing basis (cool/heat/worst-of-both); airflow-requirement schema (used later by vent). | 1, 2 | Hand-worked load calc fixtures |
| **4** | **Split (1:1) — first usable release.** Add-system flow (type→brand→colour), pair matching, placement, refrigerant run + riser, **connection anchors + graph v0** (endpoint connectivity — knows whether IDU/ODU/run are actually joined; the split badge depends on it), validation framework + split badge, **materials stage v1**, **filter matrix v1**, **job stage + basic PDF export**. | 1–3 | 🔒 **Golden scenario set A** (single-floor split, two-floor split via riser, over-length warning…) — full document→materials snapshots |
| **5** | **Multi-split.** Ports/combination validation, per-port pipe sizes, branch boxes — **debut of the junction-node primitive** (place node → connect runs → part self-resolves) in its simplest form. | 4 | 🔒 Golden set B; set A still green |
| **6** | **Form factors + placement planes.** Bulkhead/floor/under-ceiling/cassette palette data; plane defaults + inspector override; concealed-plane rendering; vertical drops in run lengths. | 4 | 🔒 Plane/length fixtures; A+B green |
| **7** | **Ducted module + connectivity graph v1.** Graph v1 extends graph v0 with junction nodes + downstream aggregation (airflow interpreter); duct draw (trunk/branch/return, rigid/flex), grille placement + catalogue, zoned toggle + diversity, dampers/sensors/filter, manual duct sizes with undersize *warnings*; **live schematic v1** (pure graph render — also the graph engine's debug view); **7b:** zoning-controller packs (AirTouch / MyAir / OEM) driving materials. | 4, 6 | 🔒 **Golden set C** (unzoned ducted, zoned w/ diversity, AirTouch job); graph unit tests; A+B green |
| **8** | **VRF module.** Graph capacity-index interpreter; **auto pipe sizing**, joint/header selection, equal-split headers, BC boxes, connection ratio, length/lift limits, additional charge; ducted IDUs on VRF reusing stage-7 toolkit end-to-end (incl. materials tagging); **live schematic v2** — VRF tree with per-segment sizes, joint parts and lengths labelled, node↔plan cross-highlighting. | 5, 7 | 🔒 **Golden set D** — worked examples reproduced *from the data books* (incl. the 3+3 header split); the single most heavily tested stage; A–C green |
| **9** | **Ventilation.** Airflow room mode, exhaust/supply fans, underfloor supply, Lossnay/HRV/ERV sizing + balance badge, vent ducts via the graph. | 3, 7 | 🔒 Golden set E; A–D green |
| **10** | **Accessories & controls.** Per-unit accessory picker (Wi-Fi, controllers, condensate pumps…) from packs → materials. | 4 | 🔒 Accessory materials fixtures |
| **11** | **Sheet metal.** Rectangular sizing engine (airflow+velocity+distance → W×H recommendation), fittings derivation, blank-canvas scenarios. | 7 | 🔒 Golden set F vs hand calcs |
| **12** | **Experience layer.** Simulation mode, ghost underlays, riser-diagram export sheet, polish. | all | Read-only guarantee test (sim never mutates the document) |

**Parallelisable:** data-pack population (more brands, more models) runs alongside everything from stage 2 on. Stage 10 can start any time after 4. Stages 9 and 11 are independent of each other.

**On the existing 40–50% VRF builder — harvest, don't transplant (audit complete).** The standalone DUCTR app has been decoded and fully audited — the line-referenced harvest map lives at `_design/vrf-builder/HARVEST.md` alongside the extracted source. Headlines, mapped to build stages:
- **Grade A cargo → Stage 2 (data packs):** ~140 Mitsubishi indoor unit models, 19 outdoors (PUMY-SP/PUMY-P/PUHY-P), BC controller table (CMB-P 4–16 port), pipe size tables + mm→inch map, Australian NCC climate-zone W/m² table, orientation multipliers — all clean, source-cited against named data books. These are the first ingestion into the universal table. **Two data bugs to fix on import:** PEFY-P100/125/140VMHS-E have liquid/gas sizes swapped, and a duplicate `WALL` type code makes MSZ-AP/EF/LN indistinguishable.
- **Grade A cargo → Stage 3 (loads engine):** the heat-load calc (`area × W/m² × glass × condition × height × orientation`) and the north-arrow → auto-orientation detection are pure, self-contained functions.
- **Grade A cargo → Stage 1 (canvas):** pan/zoom/snap/ortho/hit-test geometry helpers (framework-free maths), the 2-point calibration flow with per-floor scale, and the palette → drag-drop placement pattern.
- **Grade B (reshape):** pipe-draw tool UX (keep the interactions, store into the graph model instead of loose polylines), riser cross-floor propagation, PDF upload/page-picker flow (its AI page-classification calls the Anthropic API directly from the browser — must move to a server route), materials/BOM aggregation shape, canvas renderer, undo.
- **Grade C (rewrite):** the auto-pipe-sizing "engine" (endpoint-only load attribution, no topology — T-junctions are cosmetic dots with no graph behind them), localStorage persistence (manual save silently drops polygons/junctions/BC boxes — a bug not to port), and the whole UI shell.
- **Confirmed single-system assumptions** (why transplanting was never viable): one active system gates the palette/rooms/pipe tagging, one ODU per system, VRF vocabulary hard-wired into tools/legend/save-keys/exports. The canvas layer itself is genuinely system-agnostic and is the most transplantable part.
- **No functional schematic exists** — the app's only "schematic" is a decorative animated SVG on the home card, so the live schematic (§Layer 4) is a fresh build as planned.

---

## Part 4 — Testing & lock-in strategy (how features stop breaking each other)

1. **Engines are pure functions, fully separated from UI.** Every rule — load calc, pair matching, combination ratio, duct airflow shares, VRF pipe sizing, additional charge, materials generation — takes `(document, dataPack)` and returns results. No canvas, no React, no network. This is what makes "test the logic perfectly in multiple scenarios" actually achievable: thousands of scenario tests run in milliseconds.
2. **Golden scenarios.** Each stage produces saved design documents (real, representative jobs — including nasty ones). CI snapshots their full outputs (validations + materials + sizes). *Any* later change that alters a locked scenario's output fails the build — that's the lock. Adding VRF physically cannot silently change what a split job produces.
3. **Data-book fixtures.** For VRF sizing especially: take worked examples straight from manufacturer data books and installation manuals, encode them as fixtures, and require the engine to reproduce the book's answer exactly (pipe sizes per segment, joint part numbers, additional charge). The book is the oracle.
4. **Versioned data packs, pinned per design.** Engine code and product data evolve independently; a design opened in a year produces the same materials it did on day one unless the user explicitly upgrades its pack.
5. **Schema migrations, tested.** The document schema will grow (plane in stage 6, graph refs in stage 7…). Every schema bump ships a migration + a test that opens every golden document from every prior version.
6. **Module contract.** Each system type registers: palette entries, inspector flow config, graph interpreter, validation rules, materials sections. Modules cannot reach into each other — they share only the foundation and domain layers. This is the structural guarantee behind the lock.

---

## Part 5 — Critical vs nice-to-have

**Critical for first real use (the "bones"):** stages 0–5 — shell integration, canvas + plans + calibration, data packs (one brand), loads, **split + multi end-to-end with materials and PDF export**. At that point it's a genuinely useful daily tool for the most common residential work.

**Core value, next wave:** stages 6–8 — form factors/planes, ducted (+ third-party zoning), VRF with auto pipe sizing. This is the flagship differentiator.

**Important but later:** stage 9 ventilation, stage 10 accessories, stage 11 sheet metal.

**Nice-to-have (do not let these onto the critical path):**
- Simulation mode (the "wow" layer — worthless until the numbers under it are locked)
- Auto duct sizing for flex ducted (manual pick + undersize warning covers v1)
- Riser diagram export sheet; ghost floor underlays
- North/solar-gain refinement of the load engine
- Additional brands beyond the first (data work, not code work)
- Daikin VRV / heat-recovery (R2, high/low gas) VRF variants; multi-module VRF ODU banks (combined outdoors)
- AI floor-plan page classification (harvested pattern; needs a server route — Stage 1 enhancement, not core)
- Grille Builder integration (schedule handoff to the separate Grille Builder tool) — explicitly not in the initial build; the materials grille section stays exportable so this can bolt on later
- Ducted static-pressure check (Σ duct friction vs unit ESP) — pairs with auto duct sizing
- Gas heating (explicitly deferred; the module contract keeps a slot open)

---

## Open decisions (flagged, with recommendations)

1. **Under-floor / roof-cavity selection UX** → recommended: *default plane by object type, override in inspector* (§Layer 1). No placement-time interrogation.
2. **Room airflow share for ducted** → default proportional to room load, per-room override.
3. **Heat-load method** → start with the simple area/glazing/orientation model; keep the engine swappable for a fuller calc later.
4. **Junction drawing UX** → ✅ DECIDED: the junction-circle model (see the ducted drawing model, rule 3) — place an explicit junction node, connect runs, the part self-resolves (duct fittings by connected sizes, VRF joints/headers by downstream index). Explicit topology, automatic part selection, one interaction pattern across both domains.
5. **First brand depth** → Mitsubishi Electric across all types first (matches the brief), breadth-first across the other three brands for split/multi before their ducted/VRF tables.
