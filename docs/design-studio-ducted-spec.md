# Design Studio — Ducted System Spec (Stage 7) · v8

> Design handoff for the **Ducted** module: every on-canvas component (air
> handler, plenums, grilles, ductwork, takeoffs, joiners, zone motors,
> reducers, controllers), the **left tool dock** with its component palette
> and options HUD, the full design flow with its lifecycle/edge rules, and how
> the module slots into the **cockpit right panel** (`cockpit-panel.tsx`, v3
> skeleton). §12 is the complete visual build inventory.
>
> Companion to `design-studio-right-panel-spec.md` (§4 Family B defines the
> ducted coverage maths — this doc builds the UI around it).
>
> Grounding: `modules.ts`, `document.ts` (open object `type` — no schema
> bump), `graph.ts` (junction nodes + downstream aggregation = "graph v1"),
> `packs/schema.ts` (§2 `airflow_ls` + `static_pressure_pa`; §8 Grilles —
> including the already-present `transfer` type; §9 DuctComponents; §10
> ZoningControllers — all unfilled; ducted ships their seed data plus plenum
> specs per unit). **Convention:** bare § numbers mean THIS spec's sections;
> pack-schema sections are always written **pack-§N**.
>
> **v8.2 changes (plenum geometry rework — field feedback 2026-07-14):**
> the supply plenum is an **arrow/trapezoid whose WIDEST edge is the base ON
> THE UNIT**, tapering OUTWARD to a narrow spigot face (was backwards).
> Spigots render as **rectangles** (plan view of a round takeoff), not
> circles. Base = the unit's **supply-air opening** from the data book (NOT
> the unit width). Spigot face is always ≤ the base; needing more =
> **"too many ducts for this plenum"** (the airflow limit, geometric). The
> "3-face refacet/grow-past-unit" model is REMOVED. Airflow direction isn't
> published → **user-defined** (supply end = where you attach the supply
> plenum; flip to correct; arrow points return→supply). Some units ship with
> **factory spigots**; some returns are **built-in**.
>
> **v8.1 changes:** **spill rooms** — a Configure toggle marks a room as a
> spill destination: excluded from required-capacity sums, shares and
> outlet gating (it just needs to be somewhere air can go); ⤢ badge on
> roster + canvas; the §8 spill-zone picker prefers them. And an explicit
> **brand-agnostic rule**: ME is only the first seeded brand — nothing may
> key off a brand id.
>
> **v8 changes (master passover):** field-review corrections — the 6 m rule
> is now explicitly the MATERIAL rule (joiners/motors restart it) plus a
> separate **total-run hint** (spigot→outlet length; fittings never clear
> it); per-stream velocity settings (supply 3.0 / return 2.5 m/s);
> diversity default keys to zoning (1.00 unzoned · 0.70 zoned) and the
> verdict floor becomes the largest ZONE GROUP once zones exist; return
> suggestion capped at Ø400 per run; min-outlet share hint (~25 l/s);
> side-face plenum spigots; filtered returns by default; void-return
> standing caution; spill-zone sizing hint; linear-bar multi-neck hint.
> Plus the doc-audit consistency fixes (pack-§ convention, HUD/inventory
> alignment, stale band-era wording removed, pairIdu/pairOdu reuse).
>
> **v7 changes:** grille airflow works **off the duct size** for now — one
> table (`capacity(Ø)` at ≤ 3.0 m/s, the pack-§9 series) drives grille capacity,
> the room suggestion, and duct sizing, so they can never disagree. No
> per-grille airflow bands in v1; grille rows carry neck ranges only,
> eggcrate returns a size→neck mapping.
>
> **v6 changes:** concrete v1 grille catalogue — supply = **MDO 300×300**
> (4-way adjustable, accepts a neck range of duct sizes) · **round Ø400**
> (neck range) · **linear bar** (user-input W×H, capacity un-banded — moot
> as of v7: nothing is banded);
> returns = **eggcrate** in six standard sizes (300×300 · 400×400 ·
> 600×400 · 750×400 · 900×400 · 750×550). Return glyph is now a square
> lattice; the suggestion engine defaults to MDO and picks returns from the
> standard list.
>
> **v5 changes:** ALL ductwork is FLEXIBLE — rigid is gone until the
> sheet-metal module. Drawing reflects it: free clicks (no ortho-snap), the
> run **snakes through the points as a smooth curve** and snaps onto its
> grille. No flex/rigid toggle, no elbows; typical topology is home-run flex
> from plenum spigots to each outlet. Pressure relief updated: **spill
> zone** (a motorised zone the kit opens when the others close) is the
> standard, alongside constant zone and bypass. (v4 added transfer grilles,
> void returns, lifecycle rules, and the §11 shared-air-side architecture.)

---

## 0. Principles

1. **Manual routing and placement; automated sizing only on command.** The
   user draws every duct and places every component. **Auto-size** exists as
   one explicit, undoable bulk action. Recommendations are always visible,
   never silently applied. Morphing (fittings/plenums re-describing
   themselves from connections) is display logic, not automation.
2. **Design tool, not engineering software.** Tier 1 (blocks
   engine-readiness): AHU capacity + rated airflow, room loads, grille
   connectivity, a return path. Tier 3 (never blocks): static pressure,
   sound. Constructability issues (over-length runs) are amber warnings, not
   gates.
3. **Rhyme with what exists.** Duct drawing shares the pipe tool's grammar —
   click points, anchors glow before the click, magnetic completion — but
   each medium renders true to itself: refrigerant pipes stay crisp ortho
   lines; flex duct **curves**. Placement extends drag-from-card. The
   cockpit keeps the v3 skeleton.
4. **Chosen sizes are data; everything else derives.** Segment sizes and
   placed components are stored user data. Airflow shares, recommendations,
   fitting specs, plenum shapes, buy-list totals derive live.
5. **Degrade gracefully, never guess.** Missing pack data (no `airflow_ls`,
   no plenum spec), uncalibrated floors, zero-load rooms → the dependent
   number shows "—" with a grey reason, and dependent checks suspend rather
   than fail. (Matches the pack philosophy: rows degrade to "—".)
6. **Everything scales.** Ducts at true width, grilles at true face size,
   plenums and fittings at the size of what they join.

---

## 1. The cast — every object, its look, its placement

All plain `DesignObject`s (open `type`, no schema bump). System colour tints
everything; airstreams differ by **fill treatment**, never hue alone (B&W
mode must survive). Every treatment ships with a glyph/badge fallback —
state is never colour-only.

| Object | `type` | Geometry | Plane | Placed by |
|---|---|---|---|---|
| Air handler (ducted IDU) | `unit` (`role:"idu"`, ducted form) | point + rotation | ceiling-cavity | drag from Components card |
| Outdoor unit | `unit` (`role:"odu"`) | point + rotation | external-ground | drag from Components card (unchanged) |
| Refrigerant run | `pipe-run` | polyline | — | existing pipe tool (unchanged) |
| Supply / return plenum | `plenum` (`stream`) | attached to AHU face | ceiling-cavity | component palette (snaps to AHU end) |
| Supply grille / diffuser | `grille` (`stream:"supply"`) | point + rotation | room ceiling | drag from room card or palette |
| Return air grille | `grille` (`stream:"return"`) | point + rotation | room ceiling | drag from Components card or palette |
| **Transfer grille** | `grille` (`stream:"transfer"`) | point + rotation | wall between rooms | palette |
| Duct run | `duct-run` (`stream`) | polyline | ceiling-cavity | **Duct tool** (§4) |
| Inline fittings — takeoff · joiner · reducer · zone motor | `duct-fitting` (`ftype`) | point, parametric on host run | ceiling-cavity | component palette (§5) |
| Wall controller / zone sensor | `controller` | point | room (wall) | palette or Components card, optional |

Derived visuals (no object; renderer-drawn, buy-listed): **end caps**, **boot
collars** (branch→grille), **spigot blanking caps** (unused plenum spigots).

**Universal rule — anchors carry their connections:** moving any anchored
object (AHU, plenum, grille, fitting) re-projects every attached duct end
with it. Nothing ever silently detaches.

### 1a. Air handler (AHU)

- Rectangle at true W×D scale, rounded corners, system stroke, 8 % tint.
  The two short ends are the **supply-air opening** and the **return-air
  opening** — ducts never connect to the unit directly, only via a plenum
  (or the opening's factory spigots, §1b). Empty openings show a dashed
  socket outline ("plenum goes here").
- **Airflow direction is user-defined** — no data book publishes which end
  discharges, and these fan-coils can be mounted either way round. So:
  - The end the user attaches the **supply** plenum to becomes the supply
    (discharge) end; the return goes on the opposite end.
  - The **airflow arrow** inside the body points **return → supply** from
    those placements — it's a *consequence* of where the plenums went, not a
    guess. Before any plenum: faint default arrow + a **flip** affordance.
  - A **flip control** (inspector + a rotate-style handle) swaps the
    supply/return ends — for correcting orientation or setting it before
    plenums exist. Flipping with plenums attached swaps which opening each
    is bound to (or warns if that conflicts with a built-in return).
- **Built-in return** (data-book flag `return_opening: "built-in"`):
  integral return box fused to the body, its spigot(s) ready; the palette's
  return-plenum entry is disabled with the reason, and the return end can't
  be flipped away.
- Label: model above, `12.5 kW · 630 l/s` below. Rotation as units today.
- Concealed (ceiling-cavity) read: dashed outline + slight desaturation (§7).
- **One AHU per system.** A house needing two ducted units = two ducted
  systems (own colour, own tree, own gauge). Rooms move between systems via
  the existing serve/adopt flow.

### 1b. Plenums — the arrow that fans out from the unit

**Plan view. The base (widest edge) is ON THE UNIT; the plenum tapers
OUTWARD like an arrow to a narrow spigot face.** This is the opposite of a
funnel — air leaves the wide opening and is gathered down to a few spigots.

- **Base dimension = the unit's supply-air opening** (`supply_opening.w_mm`
  from the data book — the discharge opening, NOT the unit's overall width).
  Return plenum base = `return_opening`. Missing data → a grey derived
  default (a plausible opening, clearly marked "no data") per Principle 5 —
  never the unit width. Plan labels + inspector show **base W × depth D**.
- **Shape by spigot count** — an isosceles trapezoid, base on the unit,
  tapering out; the **spigot face** (far edge) seats the spigots and is
  **always ≤ the base width**:
  - **1 spigot** → a **V / arrow**: full base at the unit converging to a
    point with one spigot at the tip.
  - **2 spigots** → a stubby trapezoid, narrow spigot face.
  - **3–4 spigots** → a fuller trapezoid; the spigot face widens to seat
    them but the **base stays widest**.
  - Hatched 8 % tint, system stroke; ~150 ms morph between counts.
- **Spigots are RECTANGLES, not circles** — a round takeoff seen from above
  (plan) reads as a rectangle standing off the spigot face, width = the
  duct Ø, at true scale. (The Ø label still names the size.) They sit along
  the spigot face; **side-face spigots** are allowed (tight roof spaces),
  bottom (droppers) reserved for the duct-riser fast-follow.
- **Too many ducts for this plenum (the airflow limit, made geometric):**
  when the spigots (widths + gaps) would need a spigot face **wider than the
  base**, that's more duct than the discharge opening carries — an **amber
  "too many ducts for this plenum"** state on the body + a Components hint.
  There is no refacet/grow-past-the-unit; the base is fixed by the opening.
- **Factory spigots** (`supply_opening: "spigots"` — the data book says the
  opening ships with spigots): the openings render the fixed factory spigots
  directly; no drawn plenum body, spigots aren't user-added.
- **Spigots** appear three ways (manual or connection-driven, never guessed):
  1. Plenum inspector **"+ spigot"** with the size series.
  2. **Duct tool started on the spigot face** → spigot of the armed size
     created at the click, run starts from it.
  3. **Landing a duct** on the spigot face → matching spigot added.
- **Spigot management:** slide along the spigot face; deleting a connected
  duct leaves a **blanking-capped** spigot (still bought); caps removable in
  the inspector.
- **Return plenum:** same object, `stream:"return"`, same arrow geometry off
  the return opening. Skipped entirely when `return_opening: "built-in"`.
- **Anchors:** every spigot is magnetic; the bare spigot face is a "create
  spigot here" anchor (pre-click glow = dashed spigot-rectangle ghost).

```
   supply opening (base — WIDEST, on the unit)
        ┌────────────────┐
        │      A H U      │
        └────────────────┘
         \              /       ← plenum tapers OUTWARD (plan view)
          \            /
           \  ▭  ▭  ▭ /         ← spigots = rectangles on the narrow face
            └────────┘
       1200 × 350 · 3 × 14"      (base 1200 = supply opening, not unit width)
```

### 1c. Supply grilles — three basic items (v1 catalogue)

Deliberately basic for now. All system-tint filled (supply = the filled
family), all at true face size:

- **MDO** — square grille, **300 × 300 mm**, 4-way adjustable. Glyph:
  square face with a 4-way adjustable core (four triangular quadrant
  blades). Accepts a **range of duct sizes** (neck range in the catalogue
  row, e.g. Ø150–Ø250).
- **Round** — **Ø400 mm** diffuser. Glyph: circle with two concentric
  rings. Also accepts a neck range.
- **Linear bar** — rectangular, **user-input size**: the picker/HUD swaps
  fixed size chips for **W × H inputs**. Glyph: rectangle with parallel
  bars along its length. Widths over ~1200 mm get a grey hint — one neck
  won't feed a long slot evenly; multi-neck linear is a fast-follow (paired
  with bulkhead installs).
- **Capacity works off the duct, not the face (v1):** a grille handles
  whatever its connected duct carries — `capacity(Ø)` from the pack-§9 series
  (≤ 3.0 m/s). Unconnected, MDO/round show the capacity of their largest
  neck size; linear bar shows grey `—` until its duct lands.
- Label `MDO 300 · 85 l/s`. States: **unconnected** (amber dashed halo +
  `!`) · connected (+ boot collar) · selected · drag ghost · invalid-drop.
- Centre anchor, magnetic. One duct per grille (v1); a second flashes
  invalid. A duct landing **outside the grille's neck range** still
  connects but shows a grey hint ("Ø300 duct on a Ø150–250 neck") —
  informational, never a block.
- Mount variants (catalogue `mount`: ceiling/wall/floor) render identically
  in plan; a small chip in the inspector + buy list carries the mount.

### 1d. Return air grille(s) — eggcrate (v1 catalogue)

- Rectangular **eggcrate** grilles only for now. Glyph: rectangle at true
  face size, unfilled, with a fine square-lattice (eggcrate) fill —
  distinct from every supply treatment. Label `600×400 · 370 l/s`.
- **Standard sizes:** 300×300 · 400×400 · 600×400 · 750×400 · 900×400 ·
  750×550. The return suggestion picks the smallest size whose **neck**
  (§6b-ii size→neck mapping) carries total airflow at the return velocity —
  **capped at Ø400 per run**: past that it suggests **multiple returns**
  (`2 × 600×400`) rather than a single huge flex nobody would install.
- **Filtered by default:** a `filter` chip on the return grille (default
  yes) adds the filter frame + media as buy-list lines — nearly every AU/NZ
  return is filter-backed.
- **Multiple returns are normal** (one per zone/wing); the checklist requires
  ≥ 1 connected return path, and return sizing checks the *sum*.
- **Return path per grille — inspector choice:** `ducted` (default — drawn
  duct to a return-plenum spigot) or **`ceiling void`** (no duct: the void is
  the return path; renders a dashed ghost link to the AHU return, satisfies
  the checklist, and the buy list notes "void return — verify sealed,
  unvented void"). A modelling choice the user makes, not automation — with
  a **standing grey caution** on the inspector choice (vented roof voids
  pull dust, fibre and unconditioned air); no suggestion ever defaults to it.

### 1e. Transfer grilles (door/wall relief)

Air must get *back out* of closed rooms to reach a central return —
transfer grilles (or undercut doors) are that path. Palette entry; snaps to
a **wall shared by two rooms** (or a door leaf).

- **Glyph:** slim wall-mounted rectangle straddling the wall line, half
  louvre-hatched each side. Label `300×200 transfer`. **v1 sizes: 300×200 ·
  400×200 · 600×300** (placeholder seed — swap for supplier rows later).
- **No duct connection, no airflow assignment** — informational + buy list.
- Cross-check (grey hint, never a gate): a supplied room with a closed path
  to the nearest return and no transfer grille gets a one-line hint in its
  Duct sub-tab ("no return relief"). v1 detection is naive (room lacks its
  own return AND has no transfer grille) — honest and cheap.

### 1f. Duct runs — the look (all flexible)

There is no rigid duct in this module — **everything is flex** (rigid
arrives with the sheet-metal module, §11). Both the rendering and the
drawing feel must say "flexible":

- **A smooth curve, not a line.** The clicked points are control points; the
  rendered duct is a **spline that snakes through them** — no kinks, no
  corners, generous bend radii (clamped to a minimum of ~1× the duct
  diameter, so it can never bend tighter than real flex). Editing a point
  re-flows the curve.
- **True-width double-line** at `chosen Ø × floor scale`: outer system
  stroke + inner fill — **supply** flat 14 % tint · **return** sparse 45°
  hatch — plus a subtle sinusoidal centre-line for the corrugated read.
  (Two more fill treatments — dotted *fresh*, cross-hatch *exhaust* — are
  reserved for ventilation, §11; design now, ship later.)
- **Typical topology is home-run:** one flex run per outlet, straight off a
  plenum spigot, snaking around obstructions to its grille. Takeoffs exist
  for when a run genuinely splits — not as the default pattern.
- **Size labels** `Ø250` / `10"` per segment, white knock-out; grey hint dot
  when the recommendation differs from the chosen size. Renders at the armed
  size from the first click.
- **Max-run (material) rule** (default 6 m, `settings.maxRunM`): a
  fitting-free stretch — measured **along the curve**, not point-to-point —
  over the max renders **amber-dashed** with a chip `7.4 m — add a joiner`
  (flex comes in 6 m cartons). **Joiners and zone motors restart the
  count** (any inline fitting does). Live length readout goes amber while
  drawing. Uncalibrated floor → rule suspends (grey note).
- **Total-run hint** (default 6 m, `settings.maxTotalRunM`) — the airflow
  truth the joiner rule can't give: a joiner adds resistance, it never
  resets the pressure problem. When the TOTAL spigot→outlet length exceeds
  the setting, a **grey hint** appears on the segment card and Duct sub-tab:
  "long run — consider upsizing a size or relocating the AHU". **Fittings
  never clear it.** Hint, not amber — Tier-3 territory.
- Selected: brightened stroke, control-point/endpoint handles, mid-curve
  insert-point. **Open ends** get a cap tick and are anchors — starting the
  Duct tool on one continues that run, size pre-armed.
- Crossings free; later run passes over with a hairline break in the lower.

### 1g. Inline fittings — one grammar, four types

Palette-placed onto an existing duct: ghost rides the centre-line, drops
**parametrically** (`{hostRunId, t}`), slides when dragged, survives host
edits, inherits the host's stream, restarts the max-run count, buy-listed.

- **Takeoff:** dashed circle that **morphs** (§5): 12" end + two 10"
  branches = `12×10×10`.
- **Joiner:** double-tick collar. Satisfies the max-run rule + buy list.
- **Reducer:** tapered trapezoid; placement HUD asks the **downstream size**;
  label `Ø300→Ø250`. Auto-size may insert/adjust the same object.
- **Zone motor:** bowtie + zone letter chip; inspector assigns its zone
  (amber `?` until assigned); sized to host. Placed on a trunk it zones
  everything downstream — the Zoning cross-check follows the graph.

### 1h. Wall controller & zone sensors

Rounded square with display line, wall-snapped; sensors are tiny
circle-thermometer glyphs. Optional — Components choice rows are the truth.

---

## 2. Flow — designing a ducted system from scratch

Rooms-first unchanged (draw/adopt rooms, heat-load popup, walls). Then:

1. **Size the air handler** — hero shows required capacity + **"Select air
   handler"** CTA → `UnitBrowser` (ducted filter, required band highlighted,
   airflow column visible). Sets the system's PEAD↔PUZ pair — reusing
   `settings.pairIdu`/`pairOdu` (the split pairing keys) so the existing
   components/coverage engines resolve unchanged.
2. **Place the AHU** + ODU + refrigerant run (existing pipe tool). **Fit
   plenums** from the palette — supply always; return unless built-in.
3. **Outlets** — drag every supply grille from room cards (or palette-stamp);
   place return grille(s); transfer grilles where rooms need relief.
4. **Draw the ductwork** (§4) — home-run flex from plenum spigots to each
   outlet (takeoffs where a run splits), joiners past 6 m, return path (or
   void returns). All manual.
5. **Auto-size (optional)** — one click re-derives every connected segment
   (§6d). Or size everything by hand.
6. **Zoning (optional)** — define zones, place + assign zone motors, pick
   pressure relief (spill zone default / constant / bypass — §8), zone
   controller.
7. **Done when** the hero gauge passes and the connectivity checklist is
   green.

Steps 3–5 interleave freely — trunk-first with open ends and takeoffs, then
grilles, then connect, is equally valid; open ends and empty takeoffs make
partial states legal, and amber marks whatever's unfinished.

**Guided step prompts** (`step-prompt.tsx`): one dismissible prompt per
stage, next-action button arming the right tool. Never modal.

**Air-tool gating:** Duct + Component tools disabled until rooms are
confirmed **and the active system has an air-capable unit** (§11) — tooltip
says why.

---

## 3. The left tool dock, the component palette, the options HUD

### 3a. The dock

| Group | Tool | Key | Notes |
|---|---|---|---|
| Pointer | **Select** | V | existing |
| | **Arrange** | — | existing |
| Rooms | **Room · rect** | R | existing |
| | **Room · poly** | P | existing |
| Air *(new)* | **Duct** | D | draws flex duct runs; HUD: size |
| | **Component** | C | first press opens the **palette**; once used, C re-arms the last component (long-press always opens the grid) |
| Refrigerant | **Pipe** | I | existing — AHU↔ODU |
| | **Riser** | — | existing |
| Erase | **Erase** | E | existing per-segment eraser, extended to ducts |

28 px hits, icon-only, tooltip = name + hotkey, armed = filled system-colour
chip, disabled = 40 % + reason. (Place stays hidden, armed by drag-from-card;
calibrate/north/crop remain top-toolbar pills.)

### 3b. The component palette

Flyout anchored to the Component button: 2-column icon + label grid. Click →
palette closes, component armed (ghost + HUD). First `C` press opens the
grid; once a component has been used this session, `C` re-arms it;
long-press (or clicking the dock button) always opens the grid. Disabled
entries show why.

| Entry | Places | Where |
|---|---|---|
| **Takeoff** | `duct-fitting · takeoff` | on a duct run |
| **Joiner** | `duct-fitting · joiner` | on a duct run |
| **Reducer** | `duct-fitting · reducer` | on a duct run |
| **Zone motor** | `duct-fitting · zone-motor` | on a duct run |
| **Plenum** | `plenum` | on an AHU end face (disabled when built-in) |
| **Grille** | `grille` | supply/return: in a served room · transfer: on a shared wall |
| **Wall controller** | `controller` | on a wall |
| **Zone sensor** | `controller · sensor` | in a zoned room |

### 3c. The tool options HUD

Floating pill strip, top-centre, shown while a tool with options is armed.

- **Duct:** `[ stream badge ] [ Ø150 … Ø500 size chips ]` — the full §3d
  series as chips; stream badge read-only (inherited from start anchor);
  suggested chip wears a dot; `[`/`]` bumps size mid-draw (a reducer lands
  at that point). Once ductwork exists, an **Auto-size chip** (§6d) sits at
  the strip's right end.
- **Grille:** `[ supply ⌇ return ⌇ transfer ] [ style: MDO ⌇ round ⌇ linear ]
  [ size ]` — the `[size]` slot per pick: **MDO/round** show their fixed
  face as a read-only chip (the neck comes from whatever duct lands);
  **linear** swaps to W × H inputs; **return** drops the style control and
  shows the six eggcrate chips (300×300 … 750×550); **transfer** shows the
  §1e transfer sizes.
- **Reducer:** `[ downstream size chips ]`. **Plenum:** `[ supply ⌇ return ]`.
- **Takeoff / joiner / zone motor / controller:** one-line hint.

### 3d. Size series (units-aware)

| mm | 150 | 200 | 250 | 300 | 350 | 400 | 450 | 500 |
|---|---|---|---|---|---|---|---|---|
| inch | 6" | 8" | 10" | 12" | 14" | 16" | 18" | 20" |

`settings.units` drives every label, chip, inspector, buy-list line. Ships
as pack-§9 duct-component seed rows (`max_airflow_ls` = the per-stream
velocity limits, §6c).

### 3e. Cursors & ghosts

Duct: crosshair + width tick. Fittings: centre-line-riding ghost
(solid = valid, hollow 40 % = invalid). Plenum: AHU-face ghost. Grille:
style/size ghost (red-hinted outside a valid drop). Transfer grille:
wall-riding ghost.

---

## 4. Drawing ductwork — the interaction

Click to create a path; it renders as real ductwork at the armed size from
the first segment. Routing is never automated.

1. **First click — on an anchor:** plenum spigot · plenum face (creates a
   spigot at the armed size) · grille centre · takeoff · open end. Nearest
   valid anchor glows **before** the click; empty plan → hint toast. The
   start anchor sets the run's **stream** — inherited, never asked.
2. **Point clicks — free, not ortho.** Each click drops a control point and
   the duct **re-flows as a smooth curve** through everything so far — you
   are laying flex around obstructions, not drafting lines. The curved
   rubber band renders at armed width from the last point to the cursor;
   live length readout (`6.4 m` / `21 ft`, measured along the curve), amber
   past the max-run remaining since the last fitting.
3. **Landing on an anchor completes** — grille, spigot, takeoff, open end,
   plenum face. Within snap range the curve's tail **sweeps onto the
   anchor** — the grille snap is the moment the whole gesture aims at.
   **Stream must match:** wrong-stream anchors flash amber.
4. **`Esc`** cancels; **`Enter` / double-click** ends unterminated (end cap).

**Bare duct body is not a landing.** Branches connect at **takeoffs only** —
drop one first, then draw. One explicit fitting per branch keeps the buy
list real.

**Editing:** control-point handles (the curve re-flows) · endpoint re-snap ·
insert-point · per-segment size chips (+ "suggested — Apply") · per-segment
eraser (erasing a fitting's host stretch orphans it — dashed amber, branches
kept, subtree amber).

---

## 5. The takeoff morph

**Placement grammar** shared by all inline fittings (§1g). The takeoff
derives its **spec** from every duct meeting it — host mid-body counts twice
(through in + out), host end once, each branch once. **Label = sizes
descending, joined ×**, in active units.

| State | Connections | Reads as | Label |
|---|---|---|---|
| Empty | host only | dashed circle | — |
| Tee | 12" mid-body + one 10" | collar tee | `12×12×10` |
| End splitter | 12" end + 10" + 10" | wye / twin-tee | `12×10×10` |
| Multi | 12" end + 10" + 8" + 8" | takeoff head | `12×10×8×8` |

Node renders at the largest connected size; spigot stubs at true width and
approach angle; morph animates. True many-outlet distribution is what
**plenums** are for — takeoffs stay in-line fittings.

States: empty · tee · end splitter · multi · orphaned (host erased — amber,
branches kept) · selected/slide · invalid-stream flash.

---

## 6. The numbers — airflow engine (pure lib, `ducted.ts`)

- **6a. Room airflow shares:** `Q_room = Q_handler_rated × roomLoad / Σ loads`
  — rated `airflow_ls` pro-rata by load **over the rooms whose grilles
  connect to that handler's tree** (attribution follows the duct graph — in
  the ducted module's one-handler case this is simply all served rooms; the
  distinction is what makes the engine reusable, §11). Zero/unknown-load
  rooms → "—" shares, recommendations suspend for affected segments.
  **Spill rooms** (Configure toggle, §9c) are excluded from Σ and get no
  share — an outlet placed in one is spill capacity, not sized supply.
- **6b. Grille capacity & suggestion — works off the duct (v1):** one
  table rules everything: `capacity(Ø) = π/4 · Ø² · v` — the pack-§9
  series' `max_airflow_ls`. At the supply default v = 3.0 m/s: Ø150 ≈ 53 ·
  Ø200 ≈ 94 · Ø250 ≈ 147 · Ø300 ≈ 212 · Ø350 ≈ 289 · Ø400 ≈ 377 ·
  Ø450 ≈ 477 · Ø500 ≈ 589 l/s (all eight seeded; assumes fully-stretched
  flex — the velocity setting is the compensator). **A grille's capacity is
  its duct's capacity** — a duct velocity limit, NOT a grille rating; when
  real grille bands land in the optional pack fields they overlay as a grey
  noise hint ("147 l/s on an MDO 300 — check noise"). Suggestion: default
  **MDO 300×300**, `count = ceil(Q_room / capacity(neck_max))` — rooms
  beyond one MDO's largest neck get more MDOs, not bigger faces. Per-grille
  assigned airflow = share ÷ count, and the branch recommendation (6c) is
  the smallest size that carries it — same table, so they can never
  disagree. **Min-outlet hint:** shares below `settings.minOutletLs`
  (default 25 l/s) get a grey hint ("small share — serve from an adjacent
  outlet or transfer relief") instead of a suggested grille. Linear bar:
  count user-chosen; capacity reads from its duct once connected. Placing
  more grilles than suggested re-splits the share evenly.
- **6b-ii. Return suggestion:** eggcrate sizes map to a max neck
  (300×300→Ø250 · 400×400→Ø350 · 600×400→Ø400 · 750×400→Ø450 ·
  900×400 / 750×550→Ø500 — seed mapping); capacities use the **return
  velocity** (default 2.5 m/s — the return path is the noise path).
  Suggest the smallest whose neck carries total airflow, **capped at Ø400
  per run** (`settings.maxReturnRunDia`): past it, multiple returns
  (`2 × 600×400`) — a single Ø450–500 flex is special-order and
  near-impossible to route through trusses. The full mapping stays
  available for manual picks.
- **6b-iii. Plenum supply-duct count (main trunks):** the plenum's spigots
  are the **main supply ducts** off the unit — each then branches downstream
  via takeoffs (§5), so this is a small count, not one-per-room. Suggested
  from total airflow at the supply velocity: `ceil(Q_ahu / capacity(Ø))`
  for the chosen main-duct size — e.g. ~1000 l/s ≈ **3 × Ø350 (14")** or
  **2 × Ø400 (16")**. Shown as a plenum hint; the geometric "too many ducts"
  guard (§1b) is the hard signal when spigots exceed the opening.
- **6c. Per-segment recommendation:** where downstream resolves:
  `d = √(4Q/πv)` with **per-stream velocity settings** (`settings.velocity`:
  supply 3.0 · return 2.5 m/s defaults — dealers calibrate to their flex
  brand), rounded up the series.
  Appears as the suggested HUD chip, the label hint dot, the inspector
  "suggested — Apply". Chosen-size velocity shown, amber over limit.
- **6d. AUTO-SIZE (bulk, user-invoked):** walks supply + return from the
  plenum spigots outward; assigns every *connected* segment its recommended
  size; resizes spigots + fitting specs (derived anyway); inserts/updates
  **reducers** at size steps. One undoable action. Toast: **"Sized 14
  segments · 2 reducers added · 3 skipped (not connected)"**. Doesn't need
  floor scale (airflow-driven). Lives on the Ductwork row + a duct-HUD chip.
- **6e. Stale-recommendation signal:** any edit that shifts derived
  recommendations away from chosen sizes (room load change, grille
  added/moved, AHU swap) lights a grey chip on the Ductwork row —
  **"recommendations changed — Auto-size"** — and the affected labels' hint
  dots. Signal only; nothing resizes itself.
- **6f. Run-length accounting — two independent audits.** **Material:**
  fitting-free stretch vs `settings.maxRunM` (default 6 — seeded from pack
  `max_flex_run_m`; the setting is authoritative once edited; editable in
  the Ductwork row expansion) → amber treatment + warnings-strip line.
  **Total-run:** spigot→outlet along-curve length vs
  `settings.maxTotalRunM` (default 6) → grey hint only; fittings never
  clear it (§1f). Both suspended (grey) on uncalibrated floors.
- **6g. Buy-list derivations:** per-size flex lengths (measured along the
  curve) · takeoffs by spec · joiners/reducers/zone motors by size · end
  caps · boot collars · blanking caps · plenums with spigot rosters ·
  grilles (incl. transfer) by style/size/mount · controllers/sensors.
- **6h. Coverage & readiness:** capacity verdict per right-panel spec §4B,
  with one field-reality refinement: **the D default keys to zoning** —
  1.00 while the system is unzoned (everything can call at once; the slider
  carries a hint saying so), 0.70 once zones exist. And once zones exist,
  the verdict's floor condition upgrades from largest single room to
  **largest zone group** (incl. the spill/constant zone) — open-plan zones
  routinely exceed any one room. Inline control unchanged (0.60–1.00).
  **Tier-1 checklist:** every supply
  grille reachable from a supply-plenum spigot (spill rooms expect no
  outlets) · ≥ 1 connected return path
  (ducted or void) · AHU + supply plenum placed · AHU has `airflow_ls` in
  the pack (else "airflow missing from pack" replaces airflow-dependent
  checks — grey, per Principle 5). **Tier-3:** ESP estimate vs rating
  (needs scale), sound, transfer-relief hints.

---

## 7. Canvas chrome

- **Layers:** `ducts` joins `LayerFlags`, with **supply / return
  sub-toggles** inside it (dense plans need to mute one stream). Legend
  gains: supply duct · return duct · grille · return grille · transfer
  grille · takeoff · joiner · reducer · zone motor · plenum (ten rows).
- **Ceiling-cavity read:** AHU + plenums + ducts + fittings at ~85 % opacity,
  dashed-outline AHU; room-facing things (grille faces, controllers) crisper.
- **B&W plan mode:** system colour is the only hue; streams differ by fill
  treatment; every state also carries a glyph/badge (never colour-only).
- **Zoom-out floor:** duct widths clamp at 2 px, fittings at 4 px; labels
  follow existing density rules.
- **Other systems** render dimmed as today — two ducted systems (two AHUs)
  read as two distinctly-coloured trees.

---

## 8. Zoning

- **Model:** `settings.zones = [{ id, name, colourIdx, roomIds[],
  handlerId }]` (`handlerId` = the AHU — redundant with one handler, future-
  proof for §11).
- **UI:** Components → Zoning row expands to zone chips; per-room zone
  picker in Configure; thin zone-tint band along zoned rooms' walls.
- **Zone motors are placed manually** and assigned in their inspector. The
  Zoning row cross-checks via the graph: zone without a motor on its
  branch(es) → amber "Zone B — no motor"; unassigned motor → `?`. The
  **zone controller** choice (pack-§10 — distinct from the §1h wall
  controller) validates `max_zones`.
- **Pressure relief** (zoned systems must dump air somewhere when zones
  close): a Zoning-row choice. **`Spill zone` (default — the standard most
  zone kits offer):** pick one zone; it stays a fully motorised zone, and
  the kit opens it automatically when the others close or only one small
  room calls. Its chip gets a ⤢ badge; its motor stays in the buy list and
  the cross-check. **`Constant zone`:** a zone that never fully closes —
  ⊙ badge, no motor required on it (the cross-check exempts it).
  **`Bypass damper`:** a buy-list hardware line; the drawn supply→return
  bypass duct stays deferred (needs a stream-crossing exception, §14).
  **Spill sizing hint (grey):** the spill/constant zone's connected outlet
  capacity should be ≥ ~30–40 % of rated airflow (or the pack's
  minimum-airflow figure when present) — pick a small bedroom and it
  roars; the picker nudges toward living/hall zones, and rooms marked
  **spill** in Configure (§9c) sort first.

---

## 9. The right panel — cockpit contents for ducted

Same v3 skeleton: tabs → hero → seg (Rooms | Components) → pills → inspect
card.

### 9a. Hero (`summary: "ducted"`)

1. **The gauge:** required tick (`max(D×Σ, largest room)`) vs installed AHU
   fill; chips `UNDERSIZED` / `RIGHT-SIZED` / `OVERSIZED`; sub-line names the
   failing condition; inline diversity control (0.60–1.00).
2. **Counts row:** `1 handler · 3 zones · 9 outlets · 1 return` — tappable
   chips. Pre-AHU: required capacity + **"Select air handler"** CTA.

### 9b. Rooms view

Roster rows: coverage dot → **airflow share** (`85 l/s`) · outlet status
(`2/2 outlets` green · `1/2 placed` grey · `⚠ unconnected` amber) ·
⤢ spill badge on spill rooms (no share, no outlet gating).

### 9c. Room inspect card — `Configure · Outlets · Duct`

- **Configure** — name/area/load/floor + airflow share + zone picker +
  **Spill toggle**: marks the room as a spill destination — excluded from
  the required-capacity sums, shares and outlet gating (it just needs to be
  somewhere air can go); the roster row + canvas room chip wear a ⤢ spill
  badge, and the §8 spill-zone picker prefers spill-marked rooms.
- **Outlets** — suggestion card (style, size, count stepper, per-grille
  l/s), grille **drag-to-plan cards**, room airflow bar.
- **Duct** — the run(s) feeding this room (size · length · state · inline
  fittings) · transfer-relief hint (§1e) · tap selects on canvas ·
  **"Connect"** arms the Duct tool from the unconnected grille.

### 9d. Object inspect cards

- **Duct segment:** size/stream (flex) · carries l/s · length (along the
  curve) · velocity (amber over limit) · max-run readout (`7.4 m / 6 m —
  add a joiner`) · total-run hint when over (§6f) · size chips +
  suggested/Apply · delete.
- **Grille:** style/size/mount (linear bar: editable W×H) · assigned l/s ·
  neck-range hint · serves room · swap size · **return grilles add the path
  choice (ducted / ceiling void)** · delete.
- **Transfer grille:** size · the two rooms it relieves · delete.
- **AHU:** model · kW · rated l/s · ESP (grey) · plenum status · **Change
  model** (keeps geometry; plenum body re-derives from the new spec, spigots
  kept; mismatches flag amber).
- **Plenum:** body `W × D` (plan dims — H in the full spec line;
  spec-sourced / derived-grey) · spigot roster
  (size, connected/capped, delete) · **"+ spigot"** · facet state.
- **Takeoff:** spec + per-spigot list · slide · delete. **Joiner:** size ·
  delete. **Reducer:** in→out (editable). **Zone motor:** size · zone
  dropdown · delete.
- **Controller / sensor:** model choice · zone (sensors) · delete.

### 9e. Components view (the system bill of materials)

| Row | Kind | Value |
|---|---|---|
| Air handler | derived | model · kW · l/s (drag-to-plan card while unplaced) |
| Outdoor unit | derived | unchanged |
| Refrigerant charge | derived | unchanged |
| **Plenums** | derived | supply `1550×350 · 3×14"` · return (or "built-in") |
| **Ductwork** | derived + **Auto-size button** | `40 m flex · 11 fittings` → expands to the full buy list (§6g) + `maxRunM` setting + stale-recommendations chip |
| **Return air** | derived + choice | eggcrate size (from Q, capped Ø400/run) · filter chip · drag-to-plan card · void-return note when chosen |
| **Zoning** | choice | zone controller `None / 4-zone / 8-zone` (pack-§10, validates max_zones) · zone chips + motor cross-check · **pressure relief choice** · spill sizing hint |
| Controller | choice | wall controller (drag-to-plan optional) |
| Electrical | choice | existing |
| Mounting | choice | existing + AHU suspension kit |

**Warnings strip** while gaps exist: `⚠ 2 outlets unconnected · no return
path · 2 runs over 6 m — Show` — Show selects/pans to the first offender.
Navigation only; the sole bulk action anywhere is Auto-size.

### 9f. Elsewhere

Unit browser ducted filter + required band + airflow column · grille
mini-picker (two-pane) · type-change wipe extends to `grille` / `duct-run` /
`duct-fitting` / `plenum` / `controller`, confirm enumerates.

---

## 10. Lifecycle & edge rules (the destructive/derived cases)

Design needs these as real dialogs/toasts/states — they're where tools
usually feel broken.

1. **Delete a room** that has outlets: confirm enumerates — "Removes 2
   outlets; 2 branches lose their ends (open caps)". Grilles go with the
   room; ducts stay (they're system geometry), ends freed.
2. **Un-serve a room** (system stops serving it): same enumeration; grilles
   removed with confirm, ducts keep open ends.
3. **Delete the AHU:** plenums go with it (they're its plenums — confirm
   says so); ducts stay with open ends; whole tree amber until a new AHU +
   plenums are placed. Swapping models (9d) never does this.
4. **Delete a plenum:** its spigots' ducts get open ends; confirm counts them.
5. **Erase a fitting's host stretch:** fitting orphans (amber dashed,
   branches kept) — §4.
6. **Room load edited / grille count changed / AHU swapped:** shares +
   recommendations re-derive; chosen sizes never move; the
   stale-recommendation chip lights (§6e).
7. **Recalibrate the floor:** lengths, max-run audit, ESP estimate recompute
   silently (derived); chosen sizes untouched.
8. **Uncalibrated floor:** lengths "—", max-run suspended (grey), auto-size
   still works (airflow-driven), buy-list lengths "—".
9. **Pack gaps:** no `airflow_ls` → airflow-dependent derivations show "—" +
   grey reason in hero/checklist; no plenum spec → grey derived-default
   plenum. Nothing red, nothing invented (Principle 5).
10. **Undo:** every placement, draw, size choice, auto-size run, and
    destructive confirm above is one undo step.

---

## 11. The air side is shared — forward architecture

Ducted elements are NOT ducted-module-only. Ducted-form indoor units exist
on **multi-split** and **VRF** (one PEAD among the hi-walls), and
**ventilation** (Lossnay ERV) is nothing *but* ductwork. Build the air
toolkit once, against these rules:

1. **Capability keys off unit data, not system type.** Any placed unit whose
   pack row is air-capable (ducted/vent form, `airflow_ls` present) is an
   **air handler node**: it exposes plenum faces, accepts plenums/spigots,
   and unlocks the Duct + Component tools for its system. The ducted
   *module* is one arrangement of this capability (one handler, system-total
   coverage) — not its owner.
2. **Streams are open data, not a boolean.** `stream: "supply" | "return"`
   now, `"fresh" | "exhaust"` when ventilation lands (Lossnay has four
   spigots: outdoor-air in, supply out, extract in, exhaust out — two
   airstreams crossing in one box). Inheritance-from-anchor and
   stream-matching already generalise; the two reserved fill treatments
   (dotted = fresh, cross-hatch = exhaust) should be designed now.
3. **Attribution follows the duct graph.** A grille belongs to whichever
   handler's tree it's connected to — never stored, always derived. That's
   what lets one multi-split system hold two hi-walls *and* a small PEAD
   tree: the PEAD's rooms get airflow shares from the PEAD; the hi-wall
   rooms stay Family-A per-room coverage. Mixed systems fall out of the
   engine instead of being special-cased.
4. **Zones reference their handler** (`handlerId`, §8) so a future system
   with two air trees zones each independently.
5. **Per-module future deltas** (each module adds only its own layer):
   - **Multi-split / VRF:** ducted IDUs join the IDU roster; their sub-trees
     use this toolkit verbatim; coverage = per-room family A, where a ducted
     IDU's rooms check `IDU capacity × room share ≥ room load`; the ODU
     capacity gauge is unchanged.
   - **Ventilation:** Lossnay = an air handler node with four stream faces;
     grille catalogue grows extract/supply valves; **new terminal
     components** (external wall louvre, roof cowl) join the palette;
     coverage becomes airflow-per-room targets (vent rates), not heat load —
     a different verdict formula on the same graph.
   - **Sheet-metal (Stage 11):** rigid arrives here — the Duct tool with
     W×H rectangular sizing, straight ortho rendering (the crisp treatment
     flex deliberately doesn't have), elbows in the buy list, and
     velocity-from-airflow. Same grammar, different medium.
6. **Palette, buy list, layers, legend are airstream-agnostic already** —
   new modules add entries, not mechanisms.

---

## 12. Visual build inventory — everything design must produce

### A. Canvas objects

1. **AHU** — default · selected · rotating · drag ghost · concealed variant ·
   empty opening-socket outlines · **airflow arrow (return→supply) + flip
   affordance** · built-in-return variant · label.
2. **ODU + refrigerant run** — existing, restyle pass only.
3. **Supply plenum** — arrow/V (1 spigot) → trapezoid (3–4), **base widest
   ON the unit**, tapering out · spigots as **rectangles** at true width on
   the narrow spigot face · **"too many ducts"** amber state · blanking-
   capped spigot · spigot slide · face "create spigot" ghost glow · base =
   supply-opening label · morph animation · grey derived-default (no data) ·
   factory-spigots variant.
4. **Return plenum** — same arrow geometry off the return opening; built-in
   variant lives fused on the AHU.
5. **Supply grilles × 3 items** — **MDO 300×300** (4-way core) · **round
   Ø400** (concentric rings) · **linear bar** (custom W×H, parallel bars) —
   each: unconnected (amber halo `!`) · connected (+ boot collar) ·
   selected · drag ghost · invalid-drop · out-of-neck-range grey hint.
6. **Return grille (eggcrate)** — square-lattice fill, six standard sizes,
   same states, **void-return dashed ghost link** variant.
7. **Transfer grille** — wall-straddling glyph + wall-riding ghost.
8. **Duct runs (flex, curved)** — supply + return treatments (+ **fresh/
   exhaust designed, shipped later**) · smooth-spline rendering with min
   bend radius · selected + control-point handles · open-end cap · size
   label + hint dot · over-max-run amber stretch + "add a joiner" chip ·
   crossing break · 2 px clamp.
9. **Takeoff** — empty · tee · end splitter · multi · orphaned · selected/
   slide · invalid-stream flash · morph animation.
10. **Joiner** — collar + size. **Reducer** — taper + `Ø300→Ø250`. **Zone
    motor** — bowtie + zone chip / amber `?`.
11. **Wall controller · zone sensor** — glyphs + wall-snap ghost.
12. **Draft states** — true-width **curved** rubber band (the snake) ·
    control-point ticks · live along-curve length readout (amber past max) ·
    the grille snap sweep · pre-click glow on every anchor type · amber
    invalid-anchor flash · hint toasts.

### B. Dock, palette, HUD

13. **Dock** — Duct + Component in an Air group; default / hover+tooltip /
    armed / disabled (+ reason).
14. **Component palette** — 2-col grid, 8 entries, disabled + reasons,
    last-used re-arm.
15. **Options HUD** — strip + variants: duct (stream badge · full-series
    size chips + suggested dot + Auto-size chip) · grille
    (supply/return/transfer · style · per-pick size slot) · reducer ·
    plenum · hint-only.
16. **Cursors/ghosts** — duct tick · fitting centre-line ghost · plenum face
    ghost · grille ghost · transfer wall ghost.

### C. Cockpit

17. **Hero** — pre-AHU CTA · three gauge verdicts · failing-condition
    sub-line · diversity slider · counts chips.
18. **Rooms roster rows** — airflow share + three outlet states + ⤢ spill
    badge.
19. **Room inspect card** — Configure (+zone picker + spill toggle) ·
    Outlets (suggestion
    card, stepper, drag cards, airflow bar) · Duct (branch rows + Connect +
    transfer-relief hint).
20. **Components view** — Plenums row · Ductwork row (**Auto-size**, buy
    list, `maxRunM` setting, **stale-recommendations chip**) · Return air
    (+ void note) · Zoning (chips with ⤢ spill / ⊙ constant badges, motor
    cross-check, **pressure-relief choice**) · Controller · warnings strip
    + Show.
21. **Auto-size result toast** — "Sized 14 · 2 reducers added · 3 skipped".
22. **Object inspect cards** — duct segment · grille (+ return-path choice) ·
    transfer grille · AHU · plenum · takeoff · joiner · reducer · zone
    motor · controller/sensor.
23. **Unit browser** (ducted filter, required band, airflow column) ·
    **grille mini-picker**.
24. **Step prompts** — six popups mirroring §2 (AHU → place + plenums →
    outlets → ductwork incl. return → auto-size → zoning).
25. **Destructive confirms** — room delete / un-serve / AHU delete / plenum
    delete / type change — each enumerating consequences (§10).

### D. System-level

26. **Layers popover + legend** — ten legend rows; ducts toggle **with
    supply/return sub-toggles**.
27. **B&W variants** for every new object (state never colour-only).
28. **Empty states** — no AHU · no plenum · no outlets · nothing connected —
    each pointing at its next manual action.
29. **Units formatting** — mm ↔ inch everywhere.
30. **Degraded-data states** — "—" values + grey reasons (uncalibrated, pack
    gaps, zero-load rooms).

---

## 13. Implementation notes

- **New object types:** `grille` (`stream`, mount), `duct-run` (`stream`,
  per-segment `diaMm`; `kind` fixed `"flex"` in v1 — the field exists so
  sheet-metal can add rect later), `duct-fitting` (`ftype`,
  `{hostRunId, t}`), `plenum` (`stream`, unit ref + end, spigot list),
  `controller` — open `type`, **no schema bump**. `Attach` extends with
  `{ kind: "fitting" | "spigot" | "grille", id }` (duct ends reference
  grilles the same way — extend `attachOf()` and the graph's node
  collection together). Stored geometry is the clicked
  control points; the spline is render-time (Catmull-Rom or equivalent,
  min-radius clamped), and **lengths + fitting `t`-positions are measured
  along the rendered curve** so labels, the max-run audit, and the buy list
  agree with what's drawn.
- **Graph v1** (`graph.ts`): nodes = units, plenums (per-spigot), grilles,
  fittings; edges = duct segments split at fitting `t`-points; downstream
  aggregation powers recommendations, auto-size, connectivity, max-run,
  **and per-handler attribution (§11.3)**.
- **New lib `ducted.ts`:** airflow shares (per handler) · recommendations ·
  `autoSize()` (mutation + report) · grille suggestion · fitting/plenum spec
  derivation (facet threshold from spigot packing) · max-run audit ·
  transfer-relief hint · ducted coverage verdict (`coverage.ts` gains
  system-total with `oversized/undersized`) · buy-list totals.
- **Pack seed data:** pack-§2 ducted IDUs gain `supply_opening` /
  `return_opening` — the data-book discharge / return-air opening dims
  (`{w_mm, h_mm}` | `"built-in"` | `"spigots"`) that size the plenum base
  (NOT the unit width; airflow direction is NOT a field — it's user-set,
  §1a); pack-§8 grilles — **MDO
  300×300** (4-way, neck range), **round Ø400** (neck range), **linear
  bar** (`size: "custom"` — the placed object stores its W×H in props),
  **eggcrate returns** in the six standard sizes (300×300 · 400×400 ·
  600×400 · 750×400 · 900×400 · 750×550), **transfer sizes** (§1e);
  pack-§8 schema gains optional `neck_min_mm` / `neck_max_mm` and relaxes
  `airflow_min_ls`/`airflow_max_ls` to optional — **no grille airflow
  bands in v1**: capacity works off the duct size via the pack-§9 series
  (`max_airflow_ls` at the per-stream velocity); grille rows carry neck
  ranges only, eggcrates a size→neck mapping. pack-§9 duct components:
  the flex series in ALL EIGHT sizes plus joiner / reducer / zone-motor
  rows — which needs **pack-§9 schema growth** the base shape lacks:
  optional `model`/`name`, an `ftype` subtype, and `max_flex_run_m` (seeds
  `settings.maxRunM`). pack-§10 one 4-zone + one 8-zone controller. Pack
  schema stays **v1** (optional-only additions, no migration — per
  `packs/migrations.ts` discipline). All `provenance: user-entered`.
  **Brand-agnostic throughout:** the fields live on the shared schema and
  every engine keys off unit data — Mitsubishi Electric is only the first
  seeded brand; nothing may branch on a brand id.
- **Canvas:** tools `duct` (D) + `component` (C + armed sub-kind) · `ducts`
  layer flag with stream sub-toggles · palette flyout · options HUD ·
  place-tool payload generalised (unit | grille | controller | plenum).
- **Settings:** the AHU pick **reuses `pairIdu`/`pairOdu`** (the split
  pairing keys — `components.ts` `resolvePair()` and coverage resolve
  unchanged; there is no separate `ahuModel` key) · `diversityFactor`
  (zoning-keyed default, §6h) · `maxRunM` · `maxTotalRunM` · `velocity`
  (per stream) · `minOutletLs` · `maxReturnRunDia` · `zones` (with
  `handlerId`) · `components.return-air / zoning / relief / controller`.
  Auto-size writes per-segment fields — one undo step.
- **Air-capability predicate** (§11.1) lives beside `moduleFor()` so multi/
  VRF/vent reuse it untouched.
- Jakarta only, everywhere — canvas labels included (tabular-nums, no mono).

## 14. Explicitly out of scope (v1)

Auto-ROUTING / auto-PLACEMENT (auto-size is in) · **rigid ductwork of any
section** (round or rect — arrives with sheet-metal) · condensate drains ·
fresh-air intakes + fresh/exhaust streams (designed, not shipped — §11) ·
multi-floor duct risers (vertical chases — later, mirroring pipe risers;
until then a ducted system spans one floor) · drawn bypass ducts (the
stream-crossing exception; relief ships as the Zoning-row choice, spec §8) · branch-onto-
bare-duct without a takeoff · manual balancing dampers (palette candidate
later) · outlet ID tags + grille schedules (documentation stage) · ESP as a
gate · acoustic checks · per-zone airflow rebalancing · group-move of
subtrees · rectangular sheet-metal sizing (Stage 11).
