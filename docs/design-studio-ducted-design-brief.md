# Claude Design brief — Ducted module visuals

> Copy-paste these directions into Claude Design, alongside the full
> contents of `design-studio-ducted-spec.md` (v7).

---

You are designing the visual system for the **Ducted module** of HeyTiff's
Design Studio — an HVAC design tool where installers calibrate floor plans,
place equipment, and draw flexible ductwork on a 2D plan canvas. The
attached `design-studio-ducted-spec.md` (v7) is the functional spec: every
interaction, number, and flow in it is already decided. Your job is the
**visuals only**. If you believe a spec decision should change, flag it in a
QUESTIONS section at the end — do not silently redesign.

## What to read

- **§12 "Visual build inventory" is your deliverables checklist** — 30
  items; every item, every listed state.
- §1 (object designs), §3 (tool dock, component palette, options HUD), §9
  (right-panel contents) are the detail behind each item. §2, §4, §5, §7
  and §8 carry the interaction grammar, morph table, canvas-chrome/B&W
  rules and zoning UI behind deliverables B–E — read them too.
- **Read §10 in full** — items 1–5 are the confirm-dialog copy (item 25);
  items 5–9 are the orphaned-fitting, stale-chip and degraded-"—" states
  behind items 9, 20 and 30.
- Skip §11 and §13 (architecture; §13's Jakarta rule is constraint 2). From
  §6, skim 6d–6h: the Auto-size toast, the stale-recommendations chip copy
  ("recommendations changed — Auto-size") and the grey degraded-reason
  copy ("airflow missing from pack") are visual deliverables.

## Constraints you must respect (not up for redesign)

1. **The right panel keeps the existing "cockpit v3" skeleton:**
   Chrome-style system tabs → white page → dark-ink HERO → sliding
   Rooms/Components segmented switch → numbered room pills → inspect card.
   You are designing ducted *contents* for that shell (hero gauge, roster
   rows, sub-tabs, component rows) — not a new shell.
2. **Typeface: Plus Jakarta Sans only.** No monospace anywhere — including
   canvas size labels (Jakarta with tabular numerals).
3. **One hue per system** (the system colour — e.g. #2E68FF; the cycle is
   #2E68FF #E4572E #17A398 #9B5DE5 #F5A623 #D63384). Supply vs return vs
   every state must survive with **no hue at all** — fill treatments,
   hatches, dashes, badges — because there is a black-and-white plan mode.
   State is never colour-only. Semantics: green = covered/connected,
   amber = incomplete/warning, grey = unknown/informational.
4. **Canvas objects render at true scale** (real mm × floor scale). Deliver
   glyphs as **scalable construction rules** (strokes, fills, proportions
   relative to the object's real dimensions), not fixed-pixel art — an MDO
   grille is a 300 × 300 mm square whose 4-way core scales with it, a duct
   is drawn at its actual diameter.
5. **Panel icons match the existing set:** 24×24 stroke-only SVG paths,
   stroke-width ≈ 1.8–2, round caps and joins.
6. **Concealed-vs-visible depth:** everything in the ceiling cavity (AHU,
   plenums, ducts, fittings) sits back (~85 % opacity, dashed AHU outline);
   room-facing items (grille faces, controllers) read crisper.

## Deliverables — in this order (it matches the build order)

**A. Cockpit ducted contents** — hero: pre-AHU state (required kW +
"Select air handler" CTA), the gauge in its three verdicts (UNDERSIZED /
RIGHT-SIZED / OVERSIZED) with failing-condition sub-line, inline diversity
control (D → slider; defaults 1.00 unzoned / 0.70 zoned, with hint),
counts row chips · roster rows with airflow share + three outlet states ·
the Configure / Outlets / Duct inspect card · **all ten object inspect
cards** (spec §9d: duct segment · grille + return-path choice · transfer
grille · AHU · plenum · takeoff · joiner · reducer · zone motor ·
controller/sensor) · the **unit browser ducted treatment** (filter,
required band, airflow column) + **grille mini-picker** (two-pane, W×H
inputs for linear) · Components rows including the expandable **Ductwork
buy list**, the **Auto-size** button + result toast, the
**stale-recommendations chip** ("recommendations changed — Auto-size"),
the **Zoning row** (zone chips with ⤢ spill / ⊙ constant badges, motor
cross-check amber line, pressure-relief choice), and the warnings strip
with "Show".

**B. Tool dock + palette + HUD** — the Air group (Duct, Component) in the
dock with default / hover / armed / disabled-with-reason states · the
component palette flyout (2-column grid, 8 entries, disabled entries show
why) · the floating tool-options HUD and its variants (duct: stream badge +
size chips with a "suggested" dot; grille: supply/return/transfer + MDO ⌇
round ⌇ linear + size, where linear swaps chips for W×H inputs and return
shows the six eggcrate sizes; reducer; plenum; **and the hint-only
variant** for takeoff/joiner/zone motor/controller) · cursors and ghosts
per tool.

**C. Canvas object state sheets** — one sheet per object, all states side
by side:
- **AHU** (+ built-in-return variant, empty plenum-socket outlines,
  concealed treatment, label block).
- **Supply plenum**: the V shape, flat face with 1–2 spigots, **faceted
  3-face** state, spigots at true Ø, blanking caps, spec label
  (`1550×350 · 3×14"`). **Return plenum** rectangle variant.
- **Grilles**: MDO 300×300 (4-way core), round Ø400 (concentric rings),
  linear bar (custom W×H, parallel bars), eggcrate returns (square-lattice
  fill, six standard sizes), transfer grille (wall-straddling) — each in:
  unconnected (amber dashed halo + !), connected (+ boot collar), selected,
  drag ghost, invalid-drop, out-of-neck-range grey hint. Return grilles
  add the void-return dashed ghost link.
- **Flex duct**: supply tint vs return 45° hatch, corrugated centre-line,
  smooth curved rendering at true width, size labels with knock-out +
  suggestion hint dot, open-end cap, over-6 m amber-dashed stretch +
  "7.4 m — add a joiner" chip, crossing hairline break, 2 px zoom minimum —
  **plus the two reserved treatments: dotted *fresh* and cross-hatch
  *exhaust*** (design now, ship later; must be distinguishable from supply
  tint and return hatch in B&W).
- **ODU + refrigerant run** — existing visuals, restyle pass (item 2).
- **Takeoff**: empty dashed circle → tee (12×12×10) → end splitter
  (12×10×10) → multi, orphaned amber, selected/slide, invalid-stream flash.
- **Joiner** (collar), **reducer** (taper, Ø300→Ø250), **zone motor**
  (bowtie + zone letter chip, unassigned "?"), **wall controller**,
  **zone sensor**. (The ⤢ spill / ⊙ constant badges live on the cockpit
  Zoning-row zone chips — deliverable A — not on the canvas motor.)

**D. The three signature animations + draft states** — plenum refacet
(~150 ms), takeoff morph, and duct drawing: the curved true-width rubber
band ("the snake") with the snap sweep onto the grille — plus the rest of
item 12: control-point ticks, live along-curve length readout (amber past
max), pre-click glow on every anchor type, amber invalid-anchor flash,
hint toasts.

**E. The small stuff** — legend rows (ten new, incl. reducer), layers
popover with supply/return sub-toggles under Ducts, empty states (no AHU /
no plenum / no outlets / nothing connected — each naming its next manual
action), destructive confirm dialogs (spec §10 enumerations + the §9f
type-change confirm), the six step-prompt popups, degraded "—" states
with grey reasons, **B&W variant sheets for every new object (item 27)**,
and a **mm ↔ inch formatting sample** (item 29).

## Output format

- **HTML/CSS handoff pages** — the same pixel-faithful format the cockpit
  v3 shell was delivered in. One section per inventory item, all its states
  side by side, labelled with the spec item number. Inline SVG for glyphs.
- Use real spec values as placeholder data: `12.5 kW · 630 l/s`,
  `MDO 300 · 85 l/s`, `1550×350 · 3×14"`, `Ø250`, `600×400 · 370 l/s`,
  `7.4 m — add a joiner`, `Sized 14 segments · 2 reducers added · 3
  skipped (not connected)`.
- End with a **QUESTIONS** section listing anywhere you deviated from or
  doubted the spec.
