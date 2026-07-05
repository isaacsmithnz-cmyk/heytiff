# Design Studio — Master Component Inventory

*Every component to be implemented, grouped by area. Columns: what it does · build stage (per `design-studio-plan.md`) · tier. Tiers: **Core** = required for its stage's lock · **Enhance** = valuable, schedule when convenient · **Later** = explicitly deferred.*

---

## A. Shell & app infrastructure

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Studio route & mount | Real React component tree mounted at `/dashboard/studio` inside the HeyTiff shell (escaping the HTML-string screen pattern) without touching shell layout/animations | 0 | Core |
| HeyTiff theming | Studio chrome in host tokens (Tailwind 4 vars, Jakarta Sans/JetBrains Mono, Design Studio orange accent) | 0 | Core |
| Workflow stepper | Plans → Design → Materials → Job bar, always visible, click-to-jump | 0 | Core |
| Design document schema + persistence | One serialisable JSON tree (objects, systems, settings, pack pins); server save/load (Supabase) | 0 | Core |
| Schema versioning + migrations | Version field, migration per bump, tests opening every prior-version golden doc | 0 | Core |
| Autosave + recovery | Debounced background save; crash/reload recovery | 0 | Core |
| Home / recent designs | Get-started landing, recent-projects grid, search, new-design flow (plan vs blank canvas) | 0 | Core |
| Empty states | Gold-standard empty canvas ("drag units from the sidebar"), empty materials, empty job | 0 | Core |
| Undo/redo | Document-level history (snapshots v1; command-based if perf demands) | 1 | Core |
| Settings panel | Job defaults: climate zone, building type, sizing basis, default diversity, mm/in preference | 3 | Core |
| Keyboard shortcuts | Tool hotkeys (V select, R room, P pipe, D duct…), Esc cancel, Del delete, space-pan, arrow nudge | 1 | Enhance |
| Design file import/export | Download/upload the design JSON for sharing/backup | 0 | Enhance |
| Job templates | Start a design from a saved template (systems pre-configured, no geometry) | — | Later |
| Onboarding sample project | A pre-built example design to explore | — | Later |

## B. Plans stage

| Component | What it does | Stage | Tier |
|---|---|---|---|
| File upload | PDF/PNG/JPG drag-drop + picker | 1 | Core |
| PDF page renderer | pdf.js (npm dep, not CDN) thumbnails + full-res per page | 1 | Core |
| Page picker | Grid + lightbox; select pages to become floors | 1 | Core |
| Keyword floor labelling | Guess floor names from PDF text layer ("ground floor", "level 2"…) | 1 | Enhance |
| AI page classification | Claude-based floor-plan detection/labelling via server route (harvested pattern, rebuilt) | 1 | Later |
| Floor allocation & management | Assign pages to floors, rename, level order, add/remove floors, floor tabs/switcher | 1 | Core |
| Blank-canvas mode | Floors with no plan image; explicit scale setting (default 1:100 grid) so scale honesty holds | 1 | Core |
| 2-point scale calibration | Two clicks + known distance → per-floor scale; live size preview; re-derives dependent geometry | 1 | Core |
| North arrow | Place/drag/rotate; feeds orientation auto-detection | 1 | Core |
| Plan image adjustments | Crop (with coordinate re-offset), grayscale, brightness, plan opacity/fade | 1 | Enhance |
| Floor alignment tool | Align floor images to each other so risers/ghost underlays line up across floors | 6 | Enhance |

## C. Canvas core

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Viewport engine | Pan (space-drag/empty-drag), wheel zoom-at-cursor, zoom buttons, fit/100%, zoom-to-selection, pan clamping | 1 | Core |
| Renderer | Full-scene draw: plan → rooms → runs → junctions → units → risers → overlays; constant screen-weight lines; plane-aware ghost/dashed styles | 1 | Core |
| CAD grid + snapping | Subtle grid; snap to grid/object points; ortho snap; snap-confirmation glow; snap toggle | 1 | Core |
| Selection | Click select, multi-select, marquee; selection drives inspector | 1 | Core |
| Drag move + rotate | Move objects; rotate handle with 90° snap on release | 1 | Core |
| Vertex editing | Post-hoc edit of room polygon and run vertices (absent in legacy app — new build) | 1 | Core |
| Eraser | Unified click-delete with per-type hit tests, segment-level for runs | 1 | Core |
| Hover cards | Fixed-position object info cards escaping canvas clipping | 1 | Core |
| Layers dropdown | Floor plan · IDUs · ODUs · pipe · ductwork · grilles & dampers · ventilation · labels (list grows by stage) | 4 | Core |
| Measurement tape tool | Click two points → scaled distance readout | 1 | Enhance |
| Text annotations / callouts | Notes pinned to plan locations; printable | — | Enhance |
| Copy/duplicate objects | Duplicate placed objects/runs; paste on same or other floor | — | Enhance |
| Ghost floor underlay | Adjacent floor rendered faint when placing risers | 12 | Later |
| Touch/tablet input | Site-use pointer/touch support | — | Later |

## D. Rooms & loads

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Polygon room tool | Click vertices, close on first point, shoelace area × scale | 1 | Core |
| Rectangle room tool | Drag-rectangle shortcut | 1 | Core |
| Wall-select flow | Click room edges to mark external walls / party walls → feeds orientation + load | 3 | Core |
| Room inspector | Name, derived area, load inputs (glazing/condition/height/orientation), assigned system; presets | 3 | Core |
| Heat-load engine | `area × W/m² × glass × condition × height × orientation` (pure function; swappable for fuller calc later) | 3 | Core |
| Climate-zone table | Australian NCC zones → W/m² by building type (data, editable defaults) | 2 | Core |
| Orientation auto-detect | Longest-external-edge + solar-rank heuristic from north arrow | 3 | Enhance |
| Airflow-requirement mode | Vent rooms: L/s block (exhaust/supply/balanced) with bathroom/laundry/kitchen + per-person presets | 3 (schema) / 9 (UI) | Core |
| Room area exclusions | Excluded polygons (voids, stairwells) subtracted from area | 1 | Enhance |

## E. Systems framework

| Component | What it does | Stage | Tier |
|---|---|---|---|
| System list panel | Pill/cards: colour, name, type icon, brand tag, eye toggle, solo | 4 | Core |
| Add-system flow | Type picker → brand picker (filtered to type) → auto colour + name | 4 | Core |
| System card expansion | Assigned rooms, ODU pick, validation badge, zoned toggle + diversity (ducted), phase | 4–7 | Core |
| Validation framework | Generic badge system (green/amber/red); modules register pure-function rules; findings list panel | 4 | Core |
| Brand picker | Mitsubishi Electric · MHI · Fujitsu · Daikin, filtered by type availability (= engine-ready data present) | 4 | Core |
| Sizing basis setting | Cooling / heating / worst-of-both | 3 | Core |
| Phase handling | 1Ø/3Ø selection filters ODU proposals | 4 | Core |
| System duplicate | Clone a system's config (not geometry) | — | Enhance |

## F. Product data platform

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Universal table schema | 13 linked sections per `universal-table-schema.md`; canonical units | 2 | Core |
| Typed rule-block evaluators | additional_charge (5 methods), compatibility (3 methods), pipe_sizing; additive extension pattern | 2 (shapes) / 5–8 (evaluators) | Core |
| Pack loader + versioning | Per-brand versioned packs; designs pin pack versions | 2 | Core |
| Ingestion validator | Types/units/enums, cross-section referential integrity, role-completeness — CI-blocking | 2 | Core |
| Engine-ready flags | Computed per model per role (placeable / split / multi / VRF-IDU / VRF-ODU / ducted / vent) | 2 | Core |
| Provenance fields | source/edition/page on every row; "legacy-ductr" marker until book-verified | 2 | Core |
| Legacy DUCTR import | Harvested tables → universal table, fixing the VMHS liq/gas swap + duplicate WALL code | 2 | Core |
| Pack browser | Completeness view per range ("12/12 VRF-ready, 0/12 ducted-ready") = extraction to-do list | 2 | Enhance |
| Data Library (admin screen) | Upload data book PDFs → Supabase storage → AI-assisted extraction against the schema checklist → side-by-side review (value beside source page) → accept commits rows + bumps pack version. Until built: books go through Claude/dev workflow into versioned pack files | — | Later |
| Gap questionnaire | Auto-generated from the diff between extracted fields and the role's required set; user answers flip units engine-ready; no bespoke forms per brand | — | Later |
| Company overlay packs | Per-tenant data layer (uploaded units + manual answers) merged over base packs; in-place editing; `user-entered` provenance; designs pin base + overlay versions | — | Later |

## G. Connectivity graph

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Connection anchors (graph v0) | Magnetic snap points on units/parts; run endpoints bind to them; connected-component detection | 4 | Core |
| Junction-node primitive | Place node → connect runs → part self-resolves; circle = unresolved state, resolved = scaled fitting render | 5 (simple) / 7 (full) | Core |
| Graph builder (v1) | Objects → nodes/edges tree; orphan + loop detection; multi-floor via riser edges | 7 | Core |
| Downstream aggregation | Per-edge rollup of downstream values | 7 | Core |
| Airflow interpreter | Aggregation = L/s (ducted, vent, sheet metal) | 7 | Core |
| Capacity-index interpreter | Aggregation = capacity index (VRF, multi) | 8 | Core |
| Riser cross-floor linking | Riser pairs with shared group id join floor subgraphs; vertical length + lift tracking | 4 (basic) / 8 (lift validation) | Core |

## H. Pipework tools (universal)

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Pipe draw tool | Click-vertex routing, ortho snap, snap-to-anchor, auto L-corner, double-click/Esc end | 4 | Core |
| Riser tool + config | Place riser, direction, destination floor, mirrored twin on destination | 4 | Core |
| Run inspector | Size (auto/manual), derived length (incl. vertical drops from planes), type | 4 | Core |
| mm/inch display map | Canonical mm storage; toggleable imperial display (6.35→1/4″…) | 4 | Core |
| Manual length allowance | Per-run extra-length fudge (site reality) feeding materials | — | Enhance |

## I. Split (1:1) module

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Pair matcher | Room load → matched IDU+ODU pairs from `pair_tables` ≥ load; manual override | 4 | Core |
| Split palette | The matched pair as placeable objects (one each) | 4 | Core |
| Split validation rules | Exactly 1 IDU + 1 ODU, connected, length ≤ max, lift ≤ max | 4 | Core |
| Split materials section | Pair, pipe by size, additional charge (rule block), condensate estimate | 4 | Core |

## J. Multi-split module

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Multi ODU proposer | Ports ≥ IDU count + compatibility rule blocks pass; phase filter | 5 | Core |
| Ports/combination badge | `4/5 ports · 112% combo ✓` | 5 | Core |
| Branch-box node | Junction-node primitive; port allocation | 5 | Core |
| Per-port pipe sizing | Sizes from `multi_rules` per port/IDU | 5 | Core |

## K. Form factors & placement planes

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Form-factor palette data | Bulkhead, floor console, floor concealed, under-ceiling, cassettes (4-way/1-way/compact), wall — data entries with footprints | 6 | Core |
| Plane model | floor-cavity / room / ceiling-cavity / roof-cavity / external per object; defaults by type; inspector override | 6 | Core |
| Concealed-plane rendering | Ghost/dashed styling per plane | 6 | Core |
| Vertical drops | Plane transitions add real length to runs + dropper materials | 6 | Core |
| ODU level | Ground/roof attribute on outdoor units | 4 | Core |

## L. Ducted module

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Duct draw tool | Centerline routing; true-width render from size × calibration; unsized = thin/ghost | 7 | Core |
| Standard duct size list | Flex diameters + rated max airflow (data) | 2/7 | Core |
| Junction circles (duct) | Fitting self-resolution from connected sizes (300+2×200 → **12-8-8**), trade inch naming, flow-direction-aware | 7 | Core |
| Derived in-line fittings | Vertices→bends, size changes→reducers, duct↔unit→plenums/boots, duct↔grille→necks; inspector override | 7 | Core |
| Grille placement + catalogue | Drop grilles in rooms; type/style/size/airflow from grille section; airflow share per room (load-proportional, overridable) | 7 | Core |
| Return-air path | Return duct + return grille + filter at return | 7 | Core |
| Zoned toggle + diversity | `Σ load × factor` sizing target; card shows both numbers | 7 | Core |
| Ducted pair proposer | Smallest ducted IDU+ODU ≥ sized load; override | 7 | Core |
| Zone dampers + room sensors | Placed on branches / in rooms when zoned | 7 | Core |
| Undersize warnings | Graph airflow vs duct/grille rated capacity | 7 | Core |
| Zoning controller packs | AirTouch / MyAir / OEM: max zones, damper parts, sensors, expansion rules → materials | 7b | Core |
| Condensate | Drain runs/estimates per IDU; pump suggestion when below drain level | 7 | Enhance |
| Auto duct sizing | Engine picks sizes from airflow (v1 = manual pick + warnings) | — | Later |
| Static-pressure check | Σ friction vs unit ESP | — | Later |

## M. VRF module

| Component | What it does | Stage | Tier |
|---|---|---|---|
| VRF ODU proposer | Connection-ratio band + index totals; manual override | 8 | Core |
| Auto pipe sizing | Per-segment size from downstream index via `pipe_sizing` rule block | 8 | Core |
| Joint/header selection | Part self-resolution by downstream index (junction-node primitive); equal-split headers fall out naturally | 8 | Core |
| BC box support | Ports, index limits, R2 slot (heat-recovery Later) | 8 | Core |
| Connection-ratio badge | `112% ✓` live | 8 | Core |
| Length/lift validation | Total, farthest, after-first-joint, ODU↔IDU and IDU↔IDU lift via riser edges | 8 | Core |
| Additional-charge calc | Rule-block evaluation over liquid-line lengths → materials | 8 | Core |
| Ducted-on-VRF | Ducted toolkit attaches to VRF ducted IDUs; ductwork tags to the VRF system's materials | 8 | Core |
| Multi-module ODU banks | Combined outdoor modules with combination tables | — | Later |
| Heat-recovery (R2) variants | High/low gas, port modes | — | Later |

## N. Ventilation module

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Fan palette | Exhaust, fresh-air supply, inline, underfloor supply | 9 | Core |
| Lossnay/ERV/HRV sizing | Unit airflow ≥ Σ room flows, both streams for balanced | 9 | Core |
| Airflow-balance badge | Extract vs supply | 9 | Core |
| Vent ducts + cowls/grilles | Duct toolkit with airflow interpreter; external cowls/hoods | 9 | Core |

## O. Sheet metal module

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Rectangular size list | Standard W×H catalogue (data) | 11 | Core |
| Sizing engine | Airflow + velocity limits + distance/friction → recommended W×H per segment | 11 | Core |
| Rect fittings | Bends, transitions, takeoffs, plenums via junction circles + derivation | 11 | Core |
| Blank-canvas scenarios | Sheet-metal sketching with no plan (explicit scale) | 11 | Core |

## P. Accessories

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Accessory picker | Per placed unit: Wi-Fi, controllers, condensate pumps, filters, drain kits — filtered by compatibility | 10 | Core |
| Accessory materials | Selected accessories → schedule | 10 | Core |

## Q. Live schematic

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Tree layout renderer | Graph → simplified schematic: ODU root, short runs, junction nodes, IDU leaves | 7 | Core |
| Sizing labels (v2) | Per-segment sizes, joint parts, lengths | 8 | Core |
| Cross-highlighting | Click schematic node ↔ highlight plan object | 8 | Core |
| Per-type variants | Ducted airflow tree, vent tree | 9 | Enhance |

## R. Materials stage

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Schedule generator | Pure function `document + packs → schedule`; per-system grouping with type/brand headers | 4 | Core |
| Whole-job rollup | Common consumables (pipe/duct by size) totalled across systems | 4 | Core |
| Live mini-summary | Running counts in the inspector's third mode | 4 | Core |
| Grille schedule handoff | Export shaped for the separate Grille Builder tool (schedule's grille section stays cleanly structured so this bolts on later) | — | Later |
| Rounding/waste factors | Round pipe to coil lengths, duct to stock lengths; configurable waste % | — | Enhance |
| CSV/Excel export | Schedule as spreadsheet | — | Enhance |
| Pricing hooks | Cost columns from consumables/supplier data | — | Later |

## S. Job stage & export

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Job details form | Name/number, client, site, date, designer | 4 | Core |
| Sheet builder | Filter-matrix-driven sheet selection (overview, pipework only, ductwork only, per-system, materials) | 4 (basic) / 7+ (full) | Core |
| PDF composer | Title block, legend (auto from systems/layers), scale bar, plan renders at print scale | 4 | Core |
| Riser diagram sheet | Schematic as an export page | 12 | Later |
| DXF/CAD export | — | — | Later |

## T. Filter matrix

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Two-axis visibility | Object shows iff system visible AND layer on; Show all / Solo | 4 | Core |
| System pills on canvas toolbar | Quick per-system toggles | 4 | Core |
| Export integration | Same matrix drives sheet contents | 4 | Core |

## U. Simulation mode

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Read-only overlay engine | Guaranteed non-mutating; reduced-motion respected | 12 | Later |
| Airflow particles + room tint | Throw patterns from emitters; fill rate from real airflow | 12 | Later |
| Zone toggles + live L/s | Close a damper → redistribution; time-to-setpoint estimates | 12 | Later |
| Sim controls panel | Per-system on/off, cool/heat, speed | 12 | Later |

## V. Quality infrastructure

| Component | What it does | Stage | Tier |
|---|---|---|---|
| Golden-scenario runner | Saved design docs → snapshot full outputs (validations/sizes/materials); CI-blocking | 4 | Core |
| Data-book fixtures | Manufacturer worked examples encoded as tests; the book is the oracle | 8 | Core |
| Engine unit tests | Pure-function tests per rule (loads, matching, aggregation, charge, fittings resolution) | every stage | Core |
| Migration tests | Every golden doc from every prior schema version must open | 0+ | Core |
| Pack validation CI | Broken packs block merge | 2 | Core |

---

**Counts:** ~120 components. Core ≈ 85 · Enhance ≈ 20 · Later ≈ 18. The Core set through Stage 5 (first usable release) is ≈ 45 components.
