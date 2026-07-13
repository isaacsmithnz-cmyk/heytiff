# Design Studio — Ducted Build Plan (Stage 7) · v2 — canvas-first steps

> The staged build order for everything in `design-studio-ducted-spec.md`
> (v7), restructured to the agreed **test-as-we-go** sequence: every step
> ends with something new visible and testable on the plan. Engine and data
> foundations land *inside* the step that first needs them (just-in-time),
> not as up-front stages.
>
> Standing rules across all steps:
> - **Dev flag from Step 1** (`NEXT_PUBLIC_STUDIO_DUCTED=1` gating
>   `SYSTEM_MODULES.ducted.available` — no flag mechanism exists yet, Step 1
>   builds it; NEXT_PUBLIC_ vars bake at build time, so flips mean a
>   redeploy): ducted is choosable only with the flag until the go-live
>   flip in Step 8 — main auto-deploys to prod, so every step is prod-safe.
> - **Jest with every step** (lib + component tests, existing conventions);
>   the live checklist runs with the flag on via the `heytiff-preview`
>   server. Auth0 has blocked dashboard preview before — **making the live
>   loop demonstrably work is a Step 1 exit criterion** (fallback: test on
>   prod behind the flag).
> - **The component palette ships once (Step 2) showing all 8 entries** —
>   unbuilt ones disabled with a "coming" reason — so each later step just
>   enables its entry and the progression is visible.
> - Object-type conventions, settings keys, and the type-change wipe list
>   for ALL five new types (`grille`, `duct-run`, `duct-fitting`, `plenum`,
>   `controller`) land once in Step 1, even though the objects arrive later.
> - The traceability table at the bottom maps every spec §12 inventory item
>   + engine/lifecycle rule to a step. Nothing is unassigned.

---

## Overview

| Step | Slice | You can test |
|---|---|---|
| **1** | Ducted system + IDU/ODU + pipe run | create ducted, pick a PEAD, place both units, draw the refrigerant run |
| **2** | Plenums onto the indoor unit | fit supply/return plenums, add/slide spigots, watch the V refacet |
| **3** | Grilles in rooms (incl. return air) | drag MDO/round/linear into rooms, place the eggcrate return, see suggestions |
| **4** | Duct runs + BTOs | snake flex from spigots to grilles, split with takeoffs, watch halos clear |
| **5** | Wall controller placement | drop the controller on a wall, pick the model |
| **6** | Zone motors · reducers · joiners (+ zoning) | zone the job, motorise branches, fix over-6 m runs |
| **7** | Verdict, auto-size, buy list + stragglers | the hero gauge, one-click sizing, the full takeoff list, transfer/void returns |
| **8** | Flow polish, lifecycle, audits — **go live** | prompts, confirms, empty states, B&W/units audits, flag flips public |

Each step below: **Build · Jest · Live checks · Done when.**

---

## Step 1 — Ducted system, indoor + outdoor unit, pipe run

**Goal:** a ducted system exists and its refrigerant side works end-to-end.
Mostly existing split machinery pointed at a new type.

**Build**
- Dev flag gating `SYSTEM_MODULES.ducted.available`; type chooser creates
  ducted systems (flagged).
- Object conventions + typed prop readers for all five future types;
  `Attach` extension (`fitting | spigot`); settings keys (`ahuModel`,
  `diversityFactor`, `maxRunM`, `zones`, `components.*`); type-change wipe
  list extended to the five types. (One-time groundwork — spec §13.)
- Air-capability predicate (spec §11.1) beside `moduleFor()`.
- **SummaryKind dispatch in the cockpit** — `computeHero()` is
  split-hardwired and called unconditionally today; Step 1 first adds the
  switch on `moduleFor(type).summary` (hero + inspect variants), keeping
  computeHero as the "split" arm.
- Cockpit minimal ducted body: pre-AHU state with **required capacity**
  (D keys to zoning — 1.00 unzoned — shown as plain text; the full gauge
  is Step 7) + **"Select air handler"** CTA → `UnitBrowser` with ducted
  form filter, required band highlight, airflow column (the browser
  already filters by form factor — the band highlight is the new part).
  Selecting sets **`settings.pairIdu`/`pairOdu`** (the split pairing keys,
  reused so `resolvePair()`/coverage work unchanged — no separate
  `ahuModel` key).
- **Place the AHU** (drag card from the Components AHU row; basic true-scale
  rect + label — plenum faces/sockets arrive Step 2) and the **ODU**
  (existing). **Pipe tool** works between them (existing anchors/graph).
- Components tab: AHU / ODU / charge rows resolve via the existing
  `components.ts` pairing (PEAD↔PUZ pair tables).

**Jest** — module flag gating · browser filter/band/column · `ahuModel`
mutation · placement reducers under a ducted system · wipe-rule cases ·
predicate cases.

**Live** — create ducted → rooms → pick PEAD → place IDU + ODU → draw pipe
run → Components shows ODU + charge. Undo across all of it.

**Done when** the refrigerant side of a ducted job is indistinguishable in
quality from a split job.

---

## Step 2 — Plenums onto the indoor unit

**Goal:** the AHU grows its plenum faces and the morphing plenum works.

**Build**
- Pack: `supply_plenum` / `return_plenum` fields (`{w,h,d}` | `"built-in"`)
  + validation + PEAD seed rows (incl. one built-in-return case if the
  range has one). Grey derived-default when data missing.
- AHU glyph completed: plenum mounting faces, dashed socket outlines,
  built-in-return variant, concealed (ceiling-cavity) treatment; **moving
  the AHU carries plenums**.
- **Component tool (C) + palette flyout** ships (all 8 entries, only
  *Plenum* enabled; others disabled "coming — Step N"; return-plenum entry
  disabled with reason when built-in), **with the spec-§2 air-tool
  gating**: disabled until rooms confirmed + an air-capable unit exists,
  tooltip says why (jest against the Step 1 predicate). **Options HUD
  framework** ships with the plenum variant (supply ⌇ return).
- `plenum` object: placement snapping to AHU faces; **V body** from spec;
  plenum spec derivation engine (spigot packing → flat vs **faceted
  3-face**, label string); inspector **"+ spigot"** (size series picker),
  spigot slide, spigot delete; return-plenum rectangle variant.
- Size-series helpers (standard series, mm ↔ inch formatting) — first
  needed here for spigot sizes.
- Plenum + AHU inspect cards (plenum status, Change model keeps geometry).

**Jest** — plenum schema/validation · facet-threshold derivation (2×14"
flat → 3×14" refacets) · placement/carry reducers · spigot add/slide
(incl. side-face spigots) · AHU model swap preserving spigots + amber
mismatch flag · missing plenum spec → grey derived default · series
formatting mm↔inch. Pack schema stays **v1** (optional-only additions, no
migration).

**Live** — fit plenums, add a third 14" spigot and watch the refacet,
slide spigots, swap AHU model and see the body re-derive.

**Done when** the plenum tells the truth about itself in its label and
survives every AHU edit.

---

## Step 3 — Grilles in the rooms (including return air)

**Goal:** every room gets its outlets; the return grille is placed. Amber
halos everywhere (nothing connected yet — correct).

**Build**
- Pack seed: **MDO 300×300** (4-way, neck range) · **round Ø400** (neck
  range) · **linear bar** (`size:"custom"`, >1200 mm multi-neck hint) ·
  **eggcrate returns** (300×300 · 400×400 · 600×400 · 750×400 · 900×400 ·
  750×550, size→neck mapping) · **transfer sizes** (300×200 · 400×200 ·
  600×300 — UI enables Step 7); pack-§8 schema gains
  `neck_min_mm`/`neck_max_mm`, airflow bands relaxed to optional.
  **Pack-§9 flex series** seeded in ALL EIGHT sizes (`max_airflow_ls` at
  the per-stream velocities — supply 3.0 / return 2.5 m/s settings) — the
  capacity table, needed now for suggestions.
- Engine: **room airflow shares** (AHU rated l/s pro-rata by load;
  zero-load → "—") · **grille suggestion** (MDO default,
  `count = ceil(Q_room / capacity(neck_max))`, even re-split,
  **min-outlet hint** below `minOutletLs` 25 l/s) · **return suggestion**
  (smallest eggcrate whose neck carries total airflow at the return
  velocity, **capped Ø400/run** → multiples; **filter chip** default yes
  with frame + media buy lines).
- Glyphs at true face size: MDO 4-way core · round rings · linear parallel
  bars (custom W×H) · eggcrate lattice. States: unconnected amber halo +
  `!` · selected · drag ghost · invalid-drop.
- Placement: **Outlets sub-tab** goes live (suggestion card, count stepper,
  per-grille l/s, drag-to-plan cards, room airflow bar) · **grille
  mini-picker** (two-pane, W×H inputs for linear) · palette *Grille* entry
  + HUD variant (supply ⌇ return · style · size / W×H) · **Return air
  Components row** (suggested size + style choice, drag card).
- Roster rows show airflow share + placed counts (`1/2 placed`).
- Grille inspect card (style/size/mount, assigned l/s, serves room, swap).

**Jest** — shares + suggestion + return-suggestion engines (incl. `—`
degradations) · seed validation · placement/room-assignment reducers ·
Outlets sub-tab + picker components.

**Live** — suggestions per room look sane; drag MDOs in; switch a lounge to
linear bar with typed size; place the return; roster counts tick.

**Done when** a fully-grilled (unducted) layout reads clearly and every
number shown traces to the capacity table or loads.

---

## Step 4 — Duct runs + BTOs

**Goal:** the headline step — flex snakes from spigots to grilles, BTOs
split runs, connectivity goes live.

**Build**
- **Curve geometry** (spline through control points, min-bend-radius clamp,
  along-curve length, `t`-maths, curve split) + **graph v1** (nodes: units /
  per-spigot plenums / grilles / fittings; edges split at `t`-points;
  downstream aggregation; reachability; per-handler attribution; orphans).
- **Duct tool (D)** + duct HUD (stream badge · size chips + **suggested
  dot** · `[`/`]` bump): anchor-only starts (spigots, plenum faces →
  spigot created at armed size, grilles, open ends, takeoffs), pre-click
  glow, free point clicks, **curved true-width rubber band**, along-curve
  live length readout, landing sweep + magnetic completion, stream
  matching (amber flash), **hint toasts** (invalid start / wrong stream),
  Esc/Enter, open-end caps. Same spec-§2 air-tool gating as Component.
- Rendering: true-width spline, supply tint / return hatch, corrugated
  centre-line, size labels + knock-out + hint dot, **boot collars**,
  **blanking caps** (deleting a connected duct), crossing hairline break,
  zoom clamps, ceiling-cavity opacity, `ducts` layer + supply/return
  sub-toggles + legend rows.
- Editing: control-point handles (curve re-flows), endpoint re-snap,
  insert-point, per-segment size chips + "suggested — Apply", per-segment
  eraser (fitting orphaning), anchor-move re-projection.
- **Takeoff (BTO)**: palette entry enabled; ghost rides curves, parametric
  drop/slide, **morph** (empty → tee → `12×10×10` splitter → multi) with
  spec labels + animation; branches draw to/from takeoffs; orphaned state.
- Engine: **per-segment recommendation** (`capacity(Ø)` table) · **fitting
  spec derivation** · neck-range hint on grille landings.
- **Connectivity live**: halos clear on landing; roster three-state outlet
  status; **Duct sub-tab** (runs feeding the room, tap-to-select,
  **Connect** arming); basic checklist (grilles reachable · return path
  drawn · plenum placed) surfaced as simple hero lines (full warnings strip
  Step 7).
- Duct segment + takeoff inspect cards (size/stream, carries l/s,
  along-curve length, velocity amber over limit).

**Jest** — heavy: curve maths vs known shapes · graph fixtures (home-run,
splits, orphaning, attribution, uncalibrated nulls) · recommendation +
fitting-spec engines (the 12×10×10 case verbatim) · draw/edit/erase
reducers · connectivity states.

**Live** — home-run every grille; snake around obstructions; drop a BTO on
a run and branch it; watch it become `12×10×10`; erase a host stretch and
see the orphan; connected statuses ripple through the roster; delete a
connected duct and confirm the blanking-capped spigot; land on a
wrong-stream anchor (amber flash); continue from an open end; toggle the
supply/return sub-toggles on a dense plan. NOTE: mid-run `[`/`]` bumps
create a bare size step until Step 6 lands reducers — known interim, not
a bug.

**Done when** every grille in a real plan connects by hand and the canvas
reads like a mechanical drawing.

---

## Step 5 — Wall controller placement

**Goal:** small, deliberate step — the controller on the wall.

**Build**
- Seed the controller catalogue rows this step needs — wall controllers
  AND the **pack-§10 zone controllers** (4-zone, 8-zone) land here, so
  Step 6 only wires validation (fixes the dependency inversion).
- Palette *Wall controller* entry enabled; glyph (rounded square + display
  line), **wall-snap** ghost + placement; inspect card (model choice,
  delete); **Controller Components row** (choice, drag-to-plan optional).

**Jest** — wall-snap placement reducer · controller row/card tests.

**Live** — drop the controller in the hallway, swap its model from the row.

**Done when** the controller places, snaps, and is counted.

---

## Step 6 — Zone motors, reducers, joiners (+ zoning)

**Goal:** the remaining inline fittings, and the zoning layer that gives
zone motors meaning.

**Build**
- Palette entries enabled: **Joiner** (collar glyph) · **Reducer**
  (taper glyph, downstream-size HUD; mid-run `[`/`]` bump now lands one) ·
  **Zone motor** (bowtie glyph, amber `?` until assigned). Shared inline
  grammar already exists from Step 4 — these are new `ftype`s + glyphs +
  cards.
- **Run-length rules** (paired with their fix): the material rule —
  `settings.maxRunM` (default 6, seeded from pack `max_flex_run_m`),
  along-curve fitting-free stretch audit, amber-dashed stretch +
  `7.4 m — add a joiner` chip, live readout amber while drawing,
  suspended-grey when uncalibrated, any inline fitting restarts the
  count — AND the **total-run grey hint** (`settings.maxTotalRunM`,
  spigot→outlet, fittings never clear it: "long run — consider upsizing a
  size or relocating the AHU").
- Pack seed: joiner / reducer / zone-motor rows — needs the **pack-§9
  schema growth** the base shape lacks (optional `model`/`name`, an
  `ftype` subtype, `max_flex_run_m`). Zone-controller rows landed in
  Step 5; Step 6 wires `max_zones` validation + damper part refs.
- **Zoning**: `settings.zones` (with `handlerId`) · Zoning Components row
  (`None / 4-zone / 8-zone`, zone chips add/rename, motor cross-check via
  the graph) · per-room zone picker in Configure · zone-tint wall bands ·
  motor zone-assignment dropdown + zone letter chips · **pressure relief
  choice** (spill ⤢ default / constant ⊙ / bypass hardware line) ·
  **spill sizing hint** (spill/constant zone capacity ≥ ~30–40 % rated
  airflow, grey) · **diversity re-keys to 0.70 + the verdict floor
  upgrades to largest zone group** once zones exist (spec §6h) ·
  `max_zones` validation · **zone sensors** (palette entry, glyph,
  per-zone, inspect card).

**Jest** — max-run audit (restart at each fitting, uncalibrated
suspension) · total-run hint accumulating THROUGH fittings · reducer
size-step mechanics · zoning cross-check cases (spill keeps motor,
constant exempts, unassigned `?`) · spill sizing hint · bypass choice
produces the hardware line and no drawn duct · sensor placement + zone
assignment · diversity re-key on first zone · `max_zones` validation ·
seed validation.

**Live** — exceed 6 m and fix it with a joiner; step a size mid-run and
get the reducer; zone the job, motorise branches, pick the spill zone,
over-zone a 4-zone kit and see the validation.

**Done when** a zoned job's Zoning row reads clean and over-length runs
tell you exactly where the joiner goes.

---

## Step 7 — Verdict, auto-size, buy list + the stragglers

**Goal:** the takeoff-side payoff and everything from the spec not yet
placed in Steps 1–6.

**Build**
- **Hero completed**: the gauge (required tick vs installed fill,
  UNDERSIZED / RIGHT-SIZED / OVERSIZED, failing-condition sub-line),
  inline **diversity slider** (0.60–1.00), **counts row** chips
  (handler · zones · outlets · return), coverage verdict engine in
  `coverage.ts` (`oversized/undersized`), Tier-1 checklist complete
  (incl. `airflow_ls`-missing grey degradation).
- **Warnings strip** (`⚠ unconnected · no return path · over 6 m — Show`,
  select-and-pan navigation).
- **Auto-size**: `autoSize()` engine (walks both streams, sizes connected
  segments, resizes spigots + fitting specs, inserts/updates reducers,
  report) · button on the Ductwork row + duct-HUD chip · **one undo
  step** · result toast (`Sized 14 · 2 reducers added · 3 skipped`) ·
  **stale-recommendations chip** wired to edits.
- **Ductwork row + full buy list** (per-size flex lengths along curves,
  takeoffs by spec, joiners/reducers/motors by size, end caps, boot
  collars, blanking caps) + `maxRunM` setting inline · **Plenums row**
  (spec labels) · Mounting row gains the AHU suspension kit.
- **Stragglers**: **transfer grilles** — NOT a new palette entry: the
  Grille entry's **transfer stream chip** + HUD sizes go live (seeded in
  Step 3), wall-straddling glyph, wall-snap ghost, inspect card (size ·
  the two relieved rooms · delete), relief hint in the Duct sub-tab ·
  **void-return option** on return grilles (dashed ghost link + standing
  grey caution, satisfies checklist, buy-list note) · **ESP estimate vs
  rating + sound** (grey, Tier-3) on the AHU card · ODU restyle pass.

**Jest** — verdict boundaries + diversity effect (unzoned 1.00 / zoned
0.70, zone-group floor) · autoSize integration (undo restores sizes and
removes inserted reducers; idempotent second run; works on an
uncalibrated floor) · warnings-strip line derivation · buy-list totals vs
hand-counted fixtures (incl. filter frame + media) · stale-chip triggers ·
transfer-hint + void-return checklist cases.

**Live** — the full loop: verdict honest at every stage; Auto-size a
hand-drawn tree and undo it; buy list matches a manual count; mark a
void return; add a transfer grille where the hint asks; hit **Show** on
each warning and confirm it pans to the offender; tap the counts-row
chips.

**Done when** the hero tells the truth, Auto-size is trustworthy and
reversible, and the buy list is quotable.

---

## Step 8 — Flow polish, lifecycle, audits — GO LIVE

**Goal:** the guided path, the destructive edges, the quality passes, and
the public flip.

**Build**
- **Step prompts** (six: AHU → place+plenums → outlets → ductwork →
  auto-size/zoning → return), dismissible, next-action arming.
- **Destructive confirms** (spec §10): room delete / un-serve (outlets +
  freed ends enumerated), AHU delete (plenums go, tree ambers), plenum
  delete, type-change copy listing the five types. **Undo audit**: every
  confirm + draw + placement + autoSize = single steps.
- **Empty states** (no AHU · no plenum · no outlets · nothing connected —
  each naming its next manual action).
- **Audits**: B&W pass (state never colour-only) · mm↔inch pass over every
  label/chip/line · degraded-data pass ("—" + grey reasons) · animation
  timing (refacet, morph, snap sweep) · label density at zoom extremes ·
  Jakarta-only (no mono in canvas labels).
- **Flip ducted public** (chooser available without the flag; keep the
  flag as a kill switch for one release).

**Jest** — confirm copy · prompt sequencing · empty states · full
regression sweep of every ducted suite.

**Live** — the full Stage-7 BUILD-then-TEST run: fresh job → finished
zoned ducted design → every lifecycle action performed deliberately →
nothing surprises. Then the flag flips.

**Done when** the live checklist passes end-to-end and ducted ships.

---

## Traceability — spec §12 inventory → step

| Items | Step |
|---|---|
| 1 AHU (faces/sockets/built-in: 2) · 2 ODU (restyle: 7) | 1–2 |
| 3 supply plenum · 4 return plenum | 2 (blanking caps live: 4) |
| 5 supply grilles ×3 · 6 return eggcrate | 3 (collars/neck hints/void link: 4, 7) |
| 7 transfer grille | 7 |
| 8 duct runs (flex, curved, all states) | 4 (over-6 m amber: 6; fresh/exhaust treatments = design-brief deliverables only) |
| 9 takeoff (all states) | 4 |
| 10 joiner · reducer · zone motor | 6 |
| 11 controller · sensor | 5 (sensors: 6) |
| 12 draft states (snake, readout, glows, toasts) | 4 |
| 13 dock | 2 (Duct button arms: 4) |
| 14 palette | 2 (entries enable: 3/4/5/6/7) |
| 15 HUD | 2 framework · 3 grille · 4 duct · 6 reducer |
| 16 cursors/ghosts | with each tool's step |
| 17 hero | 1 minimal → 7 gauge/counts |
| 18 roster rows | 3 placed → 4 connected |
| 19 room inspect card | 3 Outlets · 4 Duct · 6 zone picker |
| 20 components view | 1 AHU/ODU/charge · 3 return air · 5 controller · 6 zoning · 7 ductwork/plenums/warnings |
| 21 auto-size toast · 22 object inspect cards | 7 · with each object's step |
| 23 unit browser + grille picker | 1 · 3 |
| 24 step prompts · 25 destructive confirms | 8 (wipe rule: 1) |
| 26 layers/legend + sub-toggles | 4 (plenum/grille legend rows retrofit at 4 — before that they ride the units layer) |
| 27 B&W variants | with each object · audit 8 |
| 28 empty states | 1 pre-AHU · rest 8 |
| 29 units formatting | 2 helpers · audit 8 |
| 30 degraded-data states | 3/4 engines · 7 surfaced · audit 8 |

Engine/lifecycle: curve maths + graph → 4 · shares/suggestions → 3 ·
recommendations/fitting specs → 4 · plenum specs → 2 · max-run → 6 ·
coverage verdict + autoSize + buy list + stale chip → 7 · §10 lifecycle
confirms → 8 (orphaning mechanics 4) · §11 forward-architecture decisions
(stream strings, `handlerId`, predicate, `kind` field) → 1/2/4.
