# Design Studio — canvas UX fixes plan

Working plan for a batch of canvas interaction bugs found while designing on a
real plan.

## Status — all eleven items built, 2026-07-28

| § | Item | State |
|---|------|-------|
| 1 | Left-drag pans during click-to-place tools | shipped |
| 2 | Calibration card measured, flipped and clamped | shipped |
| 3 | Room panel dodges to the clear slot | shipped |
| 4 | Rotation survives a move | shipped — bug confirmed and fixed |
| 5 | Tape measure tool | shipped |
| 6 | Add room morphs into the shape picker | shipped |
| 7 | Reserved action column on the unit card | shipped |
| 8a/b | Load on the room line; area + required on the card | shipped |
| 9 | Units card scoped to its own room | shipped — bug confirmed and fixed |
| 10 | Rooms grouped by storey, collapsible | shipped |
| 11 | Room label halo + darker area line (A + B) | shipped; C + D still deferred |

3,107 tests green, `next build` clean. **Not verified in a browser** — the
studio's design screen is auth-gated and a local server fires server actions
against the production database, so this project verifies stateful screens with
jest. The visual calls (§11 C/D, and how the new cockpit rows and shape picker
actually feel) still want eyes on the real screen.

Everything lives in `src/components/studio/canvas.tsx` (3.3k lines) plus
`src/components/studio/studio.css`, unless noted.

---

## 1. Can't pan while calibrating (and while marking walls)

**What happens.** During the calibrate step the only way to move the plan is
middle-mouse-drag or hold-Space-and-drag — both undiscoverable, and Space is
swallowed once focus is in the measurement input. A left-drag on the plan just
drops a calibration point, so you can't bring the far end of a wall into view;
you end up zoomed out too far to click the right spot accurately.

**Why.** `onPointerDown` (canvas.tsx:1696) dispatches on `tool` immediately:
`case "calibrate"` (canvas.tsx:1859) commits point A/B on the *down* event.
Only `e.button === 1 || spaceDown.current` (canvas.tsx:1707) reaches `pan()`.
The wall-marking branch (canvas.tsx:1714) returns even earlier, so the same
applies there — and to `set-north`, `place`, `riser`, `room-poly`, `pipe`.

**Fix.** Make left-drag pan for every click-to-place tool by deferring the
placement to pointer-*up*:

- Add a `{ kind: "tap-or-pan" }` drag state that records `startScreen`, the
  world point, and a `commit` callback.
- On `pointermove`, if the pointer travels more than ~4 px, convert it to a
  real `pan` drag (reusing the existing `pan` branch maths) and drop the
  pending commit.
- On `pointerup` under the threshold, run the commit — i.e. place the
  calibration point / toggle the wall / drop the north marker.
- Route `calibrate`, `set-north`, `place`, `riser`, `erase` and the wall-select
  branch through it. `room-poly` and `pipe` should get it too (same complaint
  applies mid-draw), `room-rect`/`crop`/`arrange` already own the drag.

**Also worth doing in the same pass** (decide before building):

- Plain wheel = pan, ⌘/Ctrl + wheel = zoom — the standard design-tool mapping.
  Today `onWheel` (canvas.tsx:~1190) zooms on any `deltaY`, so a trackpad
  two-finger scroll zooms instead of panning. This is a behaviour change for
  existing muscle memory; flag it as a deliberate choice.
- Add the pan gesture to the tool hint text (`toolHint`, canvas.tsx:~2322) so
  it's discoverable: "Click two points on a known length · drag to pan".

**Tests.** `src/components/studio/__tests__/canvas.test.tsx` — a pointerdown +
>4 px move + pointerup in `calibrate` changes the viewport and leaves
`calib.a` unset; a down/up in place sets the point.

---

## 2. Floating panels don't know where the canvas edge is

**What happens.** The measurement card that appears after the second
calibration click gets cut off at the edge of the screen.

**Why.** canvas.tsx:3154–3160 positions it with hard-coded guesses:

```
left: Math.min(calibScreenB.x + 14, size.w - 240),
top:  Math.min(calibScreenB.y + 14, size.h - 130),
```

Three separate problems:

1. `240`/`130` are literals. The card is `width: 226px` (studio.css:2125) but
   its **height depends on content** (title + input row + two buttons +
   padding, comfortably over 130 px), so the bottom clamp under-corrects and
   the actions row hangs off the edge.
2. There is no `Math.max(...)` lower clamp — a point near the top/left can push
   it negative once the offsets change.
3. It never flips. Near the right edge it should sit to the *left* of point B
   rather than being shoved back on top of it.

**Fix.** One small shared helper (e.g. `lib/studio/anchor.ts` →
`anchorFloating({ anchor, size, box, margin })`) that:

- measures the card with a ref / `getBoundingClientRect` instead of guessing,
- flips to the opposite side of the anchor when it would overflow,
- clamps to `[margin, box - size - margin]` on both axes,
- keeps clear of the reserved chrome: the HUD strip (`.ds-canvas-hud`), the
  bottom-centre hint (`.ds-tool-hint`) and the tool rail.

Then use it for the calibration card, and for anything else anchored to a
world point later. `size` is measured by the `ResizeObserver` at
canvas.tsx:1137 and is the true canvas box (the cockpit is a flex sibling, not
an overlay), so it's the right box to clamp against.

**Tests.** Pure helper — unit test the four corners plus the flip.

---

## 3. The external-wall panel covers the wall you're marking

**What happens.** During "Mark external walls" the panel sits bottom-centre and
hides the bottom wall of the room, which is often exactly the one you need to
click.

**Why.** `.ds-wallsel-panel` (studio.css:2055) is `bottom: 22px; left: 50%` —
a fixed slot with no knowledge of where the room actually is on screen. The
room-sizing panel ("Size the room", canvas.tsx:3220) uses the same class and
has the same problem.

**Fix — pick one** (my preference: A, with C as a cheap safety net):

- **A. Dodge.** Project the room's screen bounding box; if it intersects the
  bottom slot, move the panel to the top (or to whichever side has the most
  clear space). Same helper as §2, anchored to the room rather than a point.
- **B. Get out of the canvas.** Render the panel in the cockpit rail while the
  mode is active. Cleanest occlusion-wise, but it costs the "modal-ish" focus
  the current design has, and the cockpit is only 284 px wide.
- **C. Fade on approach.** Drop the panel to ~15% opacity + `pointer-events:
  none` while the cursor is within ~80 px of it, restoring on move-away. Two
  lines of state, but it means clicking *through* the panel needs care.

Whichever we take, the panel should also shrink to a single row while the room
is small on screen — most of its height is the hint paragraph, which only needs
to be read once.

**Tests.** Placement is geometry — test the dodge decision as a helper; a
jsdom test asserts the panel gets the "top" placement class when the room's
screen box covers the bottom slot.

---

## 4. Moving a rotated unit resets its rotation — **confirmed bug**

**What happens.** Rotate a unit (knob drag, or `[` / `]`), then drag it
somewhere else: it snaps back to 0°.

**Why.** The point-drag commit rebuilds the geometry object from scratch
instead of spreading it — canvas.tsx:2105:

```ts
const next = { ...o, geometry: { kind: "point" as const, at } };
```

`DesignGeometry` for a point is `{ kind: "point"; at: Point; rotation?: number }`
(`src/lib/studio/document.ts:25`), so `rotation` is dropped on every move. Note
this is the *only* path that loses it — `translateRoomWithContents`
(`src/lib/studio/attach.ts:~142`), the rotate-knob commit (canvas.tsx:2132) and
the `[`/`]` handler (canvas.tsx:1220) all spread `o.geometry` correctly, which
is why moving a whole room keeps rotation but moving the unit doesn't.

**Fix.** `{ ...o, geometry: { ...o.geometry, at } }` — one line. Then:

- Grep the file for every other `geometry: { kind: ... }` literal built over an
  existing object and confirm none of them drop a field the same way
  (canvas.tsx:1063, 1602, 1656 are *fresh* objects, so they're fine).
- Check the knock-on: a rotated AHU's plenum derives from `endFace` and should
  travel and stay square with the unit after the move (canvas.tsx:1110).

**Tests.** `canvas.test.tsx` (or a pure test if the commit is extracted):
place a unit, set `rotation: 90`, run a point drag, assert the committed object
still has `rotation: 90` and the room restamp still happened. Worth a second
case for an AHU + plenum so the follower geometry is covered.

---

## 5. Tape measure tool (new)

**What it is.** A throwaway ruler for the bits of a plan that aren't
dimensioned. Press and drag from one point to another; the live distance shows
against the rubber-band line, in real units off the floor's calibration. Let go
and it's gone — nothing is written to the document, nothing appears in the
summary, no undo entry. Click-drag again wherever you want the next check.

**Behaviour.**

- Down → start point. Move → rubber band + live readout. Up → everything
  clears. Esc mid-drag cancels the same way.
- Readout: the distance in metres via `unitsToMeters` + `formatMeters`
  (`src/lib/studio/geometry.ts:278,284`), the same formatting the HUD already
  uses, drawn near the midpoint of the line with the standard text halo so it
  stays legible over a busy drawing.
- Uncalibrated floor: **greyed out**, with a "Calibrate the scale first"
  tooltip (decided). A number with no unit is worse than no number.
- Shift constrains to horizontal/vertical, reusing `orthoSnap`
  (already used by the pipe tool, canvas.tsx:1823).
- Should it snap to room corners / wall vertices? A "rough check" reading
  argues no. Leaving it free also keeps it out of the anchor logic. Starting
  free; revisit if it feels sloppy in use.

**Where it lives.**

- `CanvasTool` union (canvas.tsx:81) gains `"measure"`.
- Purely local state — `const [tape, setTape] = useState<{a: Point; b: Point} | null>(null)` —
  handled in `onPointerDown`/`Move`/`Up` alongside the existing drag kinds. It
  must *not* go through `onMutate`; that's what keeps it out of the document
  and off the undo stack.
- Rendered inside the pan/zoom `<g>` like the calibration overlay
  (canvas.tsx:3122), with a distinct dashed stroke so it doesn't read as a
  pipe run or a calibration line. Constant screen weight (`/ zoom`) like
  everything else in that group.
- Entry point: the **Calibrate menu** in the topbar (studio.tsx:1825), under
  the Calibration group next to Scale and North — that's where the "measuring"
  ideas already live, and the drawing rail is gated on having a system. It's a
  *transient* tool though, so it should also have a bare keyboard shortcut
  (`K`? `V`/`R`/`G`/`P`/`I`/`X`/`M`/`E` are taken, studio.tsx:1608) and should
  drop back to `select` on Esc.
- Tool hint (canvas.tsx:~2322): "Drag across anything to measure it — nothing
  is saved."

**Interaction with §1.** The tape measure is the one tool where left-drag must
*not* pan, so it's an explicit exception in the tap-or-pan dispatch. Panning
while measuring stays on middle-drag/Space (or the wheel, if we take the
wheel-pan option).

**Tests.** A pointer down/move/up sequence in `measure` renders the expected
distance string and leaves `doc` byte-identical (the strongest assertion that
it doesn't persist); pointer-up clears the overlay; Esc mid-drag cancels.

---

## 6. "Add room" looks like it does nothing — move the shape choice onto the button

**What happens.** You click **Add room** (or **Draw a room**) in the cockpit and
nothing appears to happen. The shape choice does appear — but as a pill pinned
to the **top-centre of the canvas** (studio.tsx:2205, `.ds-roomhud` at
`left: 50%; top: 14px`, studio.css:2372) — several hundred pixels away from the
button you just clicked, on the far side of the screen from the cockpit rail.
Your eye is on the button; the feedback is nowhere near it. Even knowing it's
there, it's hard to find.

The marching-ants ring was an attempt to fix this by making the pill louder.
That treats it as a *salience* problem when it's really a *location* problem —
no amount of animation helps if you're not looking at that part of the screen.

**Fix (Isaac's proposal, and the right one).** The button becomes the tool.
Clicking **Add room** morphs that same button, in place, into a three-up
control: **▢ rectangle · ⬡ polygon · ✕ cancel**. The choice appears exactly
where the click landed, so there's no "did that work?" moment at all. Pick a
shape and it stays armed (highlighted) so you can switch shape mid-draw or back
out; it folds back into "Add room" once the room lands, or on cancel/Esc.

**Where it goes.**

- Both entry points morph: the empty-state `Draw a room`
  (cockpit-panel.tsx:1698) and the roster's `Add room` (cockpit-panel.tsx:1780).
  They already share `onDrawRoom`, so they share the new state too.
- State already exists and is already lifted: `roomPicker` (studio.tsx:844) is
  set true by `onDrawRoom` (studio.tsx:1348) and mirrored to the armed tool by
  `changeTool` (studio.tsx:999). The cockpit needs `tool` + `onTool` passed
  down to render the armed state — check what it already receives before adding
  props.
- Three icon buttons fit the 284 px cockpit comfortably (`--ds-cockpit-w`,
  studio.css:13); the row is the same height as the button it replaces, so the
  roster doesn't jump.

**Delete the canvas pill.** Two controls showing one state is part of why the
current one is confusing. The on-canvas end of the message is already carried
by two things that work:

- the crosshair cursor (`ds-cur-cross`, canvas.tsx:2318), and
- the bottom-centre tool hint (`.ds-tool-hint`, canvas.tsx:3255).

The hint should get room-tool text it currently lacks — "Drag a rectangle over
the room" / "Click each corner, close on the first point · Esc to cancel" — so
the canvas still says what to do without a second pill competing with the
cockpit one. That also removes a top-centre z-index competitor for `PlenumHud`
(studio.tsx:2244).

**Details worth getting right.**

- **Morph, don't pop.** Crossfade the label to the icon row and animate the
  width, ~140 ms. The point is that it reads as *the same control changing*,
  not a new thing appearing. Respect `prefers-reduced-motion`.
- **Focus.** On open, move focus to the rectangle button so keyboard users land
  in the choice; Esc closes it and returns focus to the Add room button.
  `role="toolbar"` + `aria-pressed` as the current pill already does.
- **R / G / Esc** keep working as shortcuts — they just drive the same state.
- **Scrolled-out-of-view isn't an issue** for the roster button (you clicked
  it, so it's on screen), but confirm the morph doesn't push the row below the
  fold when the roster is long.

**Open question.** Once a shape is armed and you're drawing on the canvas, the
cancel affordance is back in the cockpit. Esc covers it, and the tool hint can
name Esc explicitly — I think that's enough, but it's the one thing this move
costs and it's worth checking in use.

**Tests.** `cockpit-panel` test: clicking Add room renders the three shape
controls in place of the button and the button is gone; clicking rectangle
calls `onTool("room-rect")`; cancel restores the button. Plus an assertion that
`.ds-roomhud` no longer renders anywhere.

---

## 7. The Recall button sits on top of the unit card — the whole card is crowded

**What happens.** Hover a placed unit card in the cockpit and the **Recall**
pill appears *over* the card's own content, covering the kW figure. Nothing
makes room for it; it just lands on top. The card reads as smashed together.

**Why.** `.ds-ck-recall` is `position: absolute; top: 50%; right: 10px`
(studio.css:6416) and reveals with `opacity: 0 → 1` on hover
(studio.css:6436). It's absolutely positioned precisely so it *doesn't* affect
layout — but the thing it lands on is `.ds-ck-ukw`, the capacity figure, which
is `margin-left: auto` and therefore pinned to that exact spot
(studio.css:6420). Two elements were independently told "go to the right edge".

The card is also carrying a lot in a 284 px rail (`--ds-cockpit-w`,
studio.css:13): a 38 px role icon with a placed-check dot, the role label, the
model, a sub-line, the kW figure, and now a text pill — see
cockpit-panel.tsx:2158–2208.

**Fix.** Give the action a real slot instead of floating it, and thin the card
down:

- **Reserve the space.** Lay the card out as a grid with an explicit action
  column that is always present (even when empty), so the kW figure never
  shares coordinates with the button and nothing shifts on hover. Keep the
  opacity-only reveal — it's the right call for the a11y tree (the comment at
  studio.css:6415 is correct) — but reveal into a slot that was already there.
- **Icon-only Recall.** The word costs ~46 px of a 284 px rail for a control
  that already has a tooltip and an `aria-label` (cockpit-panel.tsx:2200–2201).
  An icon-only ghost button in the reserved column, with the text kept as the
  accessible name, buys back the room that makes the rest breathe.
- **Then re-check the density.** With the collision gone, look at whether the
  role label + model + sub + kW still feel stacked. Likely wins: drop the
  uppercase role label (the icon and its teal/grey treatment already say
  IDU/ODU, studio.css `.ds-ck-uico.idu/.odu`), and let the sub-line truncate
  with a title rather than wrap.

**Check the other reveal-on-hover controls in the same pass** — the roster's
Configure button (`.ds-ck-rcfg`, cockpit-panel.tsx:1765) and anything else
absolutely positioned in the rail — for the same "lands on top of content"
pattern. And confirm `.dstudio.editing .ds-ck-recall` (studio.css:8383) still
behaves after the restructure.

**Tests.** Mostly visual, so this one wants a real look in the browser rather
than a jest assertion. Keep the existing test that Recall is reachable by its
accessible name — that's what protects the icon-only change.

---

## 8. Heat load on the room line; area + required load on the inspect card

Two related placements, split so each surface carries what suits it: the list
is for **scanning**, the card is for **reading**.

### 8a. Rooms list — heat load only, in line with the name

Each roster row shows a number, a status dot and the room name. The heat load
is hidden in a `title` tooltip you have to hover to read
(cockpit-panel.tsx:1745–1751). Put the load on the row itself, inline after the
name. Area stays off the row — it's the less actionable of the two and the rail
has no width to spare.

**Where.** The roster row, cockpit-panel.tsx:1742–1763. It's already a flex
line — `[num] [dot] [name] [spill?]` — with the name on `flex: 1; min-width: 0`
and ellipsising (studio.css:6125). A `.ds-ck-rload` span after the name with
`flex: none` sits inline and lets the name truncate against it, which is the
right priority: the number is fixed-width, the name isn't.

**Data.** `roomCoverage(...)` is already called per row at
cockpit-panel.tsx:1730 for the status dot and carries `loadKw`. Nothing new to
compute.

**Format.** `3.2 kW`, one decimal, `font-variant-numeric: tabular-nums` so the
column doesn't jitter down the list (`.ds-ck-rnum` already does this,
studio.css:6116). Dropping the area makes this fit the 284 px rail comfortably,
which the two-value version didn't.

**This still collides with the Configure button — same bug as §7.**
`.ds-ck-rcfg` is `position: absolute; top: 50%; right: 10px` over the row
(studio.css:6055) and reveals on hover, so a right-aligned figure lands under
it exactly the way Recall lands on the kW figure. Needs §7's reserved action
column applied here too. Do them together.

**Edge cases.** Uncalibrated floor or no load yet → show nothing rather than
`— kW`; the existing tooltip already says "Calibrate the floor to compute the
load" (cockpit-panel.tsx:1750) and the grey dot already reads as "nothing known
yet".

### 8b. Inspect card — area and required load under the room name

`RoomInspectCard` names the room and shows nothing else
(cockpit-panel.tsx:1894–1899). Its `.ds-ck-itxt` wrapper already holds a single
`.ds-ck-iname` line, so a sub-line drops straight in.

**Format.** `18.4 m² · 3.2 kW required`. Area first (the more stable fact),
then the requirement. Don't repeat covered/short — the `.ds-ck-ibadge` beside
it already says "Covered" / "Not complete" (cockpit-panel.tsx:1912).

**Data.** `cov.loadKw` from the `roomCoverage(...)` call already made one line
above at cockpit-panel.tsx:1875; area from `roomAreaM2(doc, room)`
(`src/lib/studio/loads-room.ts:22`).

**Edge cases.**

- **Uncalibrated floor:** `roomAreaM2` returns `null` and there's no load
  either. Replace the whole sub-line with a quiet "Calibrate the floor to size
  this room" — more useful than "— · —", and it names the fix.
- **Area known, no load set:** show the area alone, not `0.0 kW`.
- One decimal on kW, matching `.ds-ck-ukw` and the tooltip.

**Tests.** `cockpit-panel`: a calibrated room's roster row renders the kW and
its inspect card renders both m² and kW; an uncalibrated room renders neither on
the row and the calibrate message on the card.

---

## 9. A placed unit shows up on every room's inspect card — **confirmed bug**

**What happens.** Place a unit in room A, then click room B. Room B's inspect
card shows that same unit as placed, as though it serves B too. Click room C —
it's there again. The unit appears to migrate to whichever room you're looking
at.

**Why.** `UnitsSub` — the split-system units card — looks up the placed units by
**system only**, never by room (cockpit-panel.tsx:1989–1991):

```ts
const mine = doc.objects.filter((o) => o.systemId === system.id && o.type === "unit");
const placedIdu = mine.find((o) => o.props.role === "idu") ?? null;
```

So every room served by that system renders the same object as its own. The
right filter already exists two hundred lines up — `MultiUnitsSub`, the
per-room path, does it correctly (cockpit-panel.tsx:1440–1446):

```ts
o.systemId === system.id && o.type === "unit" &&
o.props.role === "idu" && o.props.roomId === room.id
```

And the data backing it is already there: an IDU dropped inside a room is
stamped `props.roomId` on placement (canvas.tsx:1609) and re-stamped when it's
moved (canvas.tsx:2076–2110). `roomCoverage` filters on it correctly too
(`src/lib/studio/coverage.ts:145`) — which is why the *status dot* on the roster
can disagree with the *card* right now.

**Two live consequences beyond the display.** Both are reachable from the wrong
room's card today:

- **Recall from a room that doesn't own the unit.** `recall` in `UnitsSub`
  (cockpit-panel.tsx:2002–2010) also deletes **every** pipe-run and riser on the
  system, not just the ones touching that unit. `MultiUnitsSub` gets this right
  with `runTouches` (cockpit-panel.tsx:1453–1458).
  **Re-evaluated during the build — deliberately left alone.** A split has
  exactly one IDU and one ODU, so *every* run on the system is that pair's
  pipework and recalling either end leaves all of it dangling. The existing
  test encodes that intent in as many words ("its pipework dropped (would
  dangle)", room-units-section.test.tsx). `runTouches` matches on attach refs,
  so narrowing it here would strand unattached runs on the plan. The
  cross-room hazard it was raised for is closed by the ownership fix instead —
  the wrong room no longer has a Recall button at all.
- **Silent re-stamp.** `choose` writes `settings.roomId = room.id`
  (cockpit-panel.tsx:2024), so picking a pair from room B's card quietly
  re-points the whole split at room B.

**How multiple rooms end up on one split.** Through adoption — dropping a unit
into another system's room adds that room to `settings.roomIds`
(canvas.tsx:1576–1585), and "Serve an existing room" does the same. So this
isn't an edge case, it's the normal path.

> **SHIPPED — option B.** Ownership reads off the placed IDU's `props.roomId`,
> falling back to `settings.roomId` when the pair is chosen but unplaced. A
> served room that doesn't own the pair gets a read-only "Served by System 1 —
> its indoor unit is in Lounge" note with no Recall and no picker. A unit
> dropped outside every room has no owner, so it stays visible on all served
> cards rather than vanishing with nowhere to send you.

**Fix — needs a framing decision first.** A split is one IDU + one ODU serving
one room, so "which room owns the pair" has an answer; the question is what the
*other* served rooms should show:

- **A. Filter and go quiet.** Match `MultiUnitsSub`: add
  `o.props.roomId === room.id`. Other rooms fall back to the "No unit selected
  yet" empty state — but that state offers **Select units**, which would
  re-choose the system's single pair and clobber room A's. Needs handling, or
  it trades one bug for a worse one.
- **B. Filter, and say why it's empty.** (Recommended.) Same filter, but a room
  that doesn't own the pair shows a read-only line — *"Served by System 1 —
  unit is in Living"* — with no Recall and no Select. Honest about the shared
  system, impossible to clobber from the wrong card, and it explains the
  relationship instead of just hiding it.

Ownership should read off the placed IDU's `props.roomId`, falling back to
`settings.roomId` when the pair is chosen but not yet placed.

**Also decide: does the ODU belong on a room card at all?** It's outdoors, it
has no `roomId`, and it's one per system. Showing it under a room is what makes
"this room has 2 units" feel true when it isn't. Moving the outdoor row to the
system level (or the Components tab) is a bigger change than this bug needs —
flagging it, not proposing it.

**Tests.** This is exactly the kind of thing jest should have caught: place an
IDU in room A, assert room B's `UnitsSub` renders the empty/shared state and no
`unit-card-idu` marked placed; assert Recall on room A doesn't remove pipe-runs
belonging to units in other rooms. The `data-testid="unit-card-${role}"` hook
(cockpit-panel.tsx:2161) is already there for it.

---

## 10. Group the rooms list by floor, with collapsible sections

**What happens now.** Every room the system serves is rendered as one flat list
regardless of which floor it's on — `roomsServedBy(doc, system.id)`
(cockpit-panel.tsx:579 → `src/lib/studio/coverage.ts:69`) returns them in
document order, and the roster maps straight over that array
(cockpit-panel.tsx:1729). On a two-storey job the ground-floor and first-floor
rooms interleave with nothing to tell them apart.

**What it should be.** Rooms grouped under a floor header, in the order the
building stacks:

```
▾ First floor                    3 rooms
    1  ● Bed 1              2.4 kW
    2  ● Bed 2              2.4 kW
    3  ● Ensuite            1.2 kW
▾ Ground floor                   4 rooms
    …
```

Draw rooms on the ground floor and the "Ground floor" header appears above
them; switch pages to the first floor and draw there, and a "First floor"
header appears with those rooms under it. Collapse either one and its header
keeps the count — "3 rooms" — so a collapsed floor still tells you it's not
empty.

**Data — all present.** Every room object carries `floorId`, and `doc.floors`
holds the ordered stack with `name` on each (`src/lib/studio/document.ts:157`).
`floorName(id)` already exists in this component (cockpit-panel.tsx:1684) for
the "Serve an existing room" rows. Group with a `useMemo` over `rooms` keyed by
`floorId`, ordered by each floor's index in `doc.floors`.

**Order: top floor first.** Descending stack order, matching how you described
it and how a building section is drawn. `doc.floors[0]` is the ground floor
(the default is created as "Ground floor",
`src/lib/studio/document.ts:211`), so display is `doc.floors` reversed. Note
the known floor-labelling wrinkle in the studio backlog — the label has
previously shown the plan page name rather than the stack position; check
which one `name` is actually carrying before trusting the order visually.

**Decisions to make.**

- **Single-floor jobs.** Suppress the header entirely when the document has
  only one floor — a lone "Ground floor" wrapper on a simple job is noise.
  Show headers as soon as there's a second floor. (With the Add room button
  living inside a group, the no-header case needs the button to fall back to
  the bottom of the flat list.)
- **Room numbering.** `.ds-ck-rnum` is currently the index in the flat list
  (cockpit-panel.tsx:1753). Restart per floor, or stay continuous across the
  system? Continuous keeps a room's number stable when another floor gains a
  room; per-floor reads better in a collapsed/expanded list. Leaning
  **continuous** — the number identifies the room in the system, and it's
  already unstable enough.
- **Where "Add room" goes — decided.** It moves out of the bottom of the list
  (cockpit-panel.tsx:1780) and sits **under the last room of the floor whose
  page you're currently on**. Switch pages and the button moves with you, to
  the end of that floor's group. It follows the active floor because that's
  where the room you draw will land — the button is always in the section it's
  about to add to. On a floor with no rooms yet, it's the group's only row
  (which also means an empty active floor still renders its header, so there's
  somewhere for the button to be). Note this compounds with §6: the button
  becomes the shape picker in place, so the picker also appears in the right
  group. "Serve an existing room" stays at the bottom of the whole list — it's
  cross-floor by nature.
- **Default expansion.** All expanded; the active floor force-expands when you
  switch to it, so drawing a room never lands in a collapsed section. Collapse
  state is view state — keep it in component state alongside `layers`, don't
  persist it to the document.

**Two implementation traps.**

- **`SegWindow` measures the pane.** It sets the rooms/components window height
  from `pane.offsetHeight` via a `ResizeObserver` (cockpit-panel.tsx:1567–1578).
  Collapsing a group changes that height, so the outer window will animate in
  lockstep with any collapse transition. Either make the collapse instant, or
  test the two animations together before committing to a transition — this is
  the kind of thing that reads as jank.
- **Clicking a room on a non-active floor.** `onSelect(r.id)` selects a room
  that isn't on the canvas you're looking at. That wrinkle exists today but is
  invisible while the list is flat; grouping by floor advertises it. Selecting
  a room on another floor should switch the canvas to that floor.

**Tests.** `cockpit-panel`: rooms on two floors render under two headers in
descending stack order; the header count matches the group size; collapsing
hides the rows but keeps the count; a single-floor document renders no header;
**Add room renders inside the active floor's group and moves when the active
floor changes.**

---

## 11. Room labels are unreadable over the drawing — options

**What happens.** The room name and its area sit directly on the plan
linework. Over a busy area (the screenshot: crossing orange service lines
through "Open Plan / 73.9 m²") the text is hard to pick out, and the area line
is worse than the name.

**Root cause, and it's a genuine oversight.** The studio already has a
carefully-tuned plan text halo — a white `paint-order: stroke` outline laid
under the glyphs, with round joins after miter joins were found to fire white
starbursts off every sharp corner (studio.css:7039–7056). Five label classes
share that rule. **The room name and area are not among them.** `.ds-room text`
is plain `fill: var(--ink)` with no stroke at all (studio.css:1992), and
`.ds-room-area` is `--gray500` (studio.css:1999) — mid-grey over orange
linework, which is the faintest thing in the picture.

So the single most important label on the plan is the one label that never got
the treatment every other label has.

### Ideas, cheapest first

**A. Join the existing halo rule.** Add `.ds-room-name, .ds-room-area` to the
selector list at studio.css:7047. One line, immediately better, and it makes
the room label consistent with pipe lengths and unit models. **Do this
regardless of what else we pick** — but on its own it may not be enough: a halo
only fills the gaps *between* glyphs, and in the screenshot the lines pass
straight through the letterforms.

**B. Darken the area line.** `--gray500` is the wrong value over a coloured
drawing. Take it to `--ink2` and keep it smaller/lighter-weight than the name —
let *size and weight* carry the hierarchy rather than lightness, which is what
fails against a busy background. Cheap, and it fixes the weakest element in the
screenshot. **Pair with A as the minimum viable fix.**

**C. A plate behind the label.** (Recommended as the real answer.) A rounded
near-white rect, ~90% opacity, sized to both lines and drawn under them as one
block. Highest legibility by a distance, and it suits what the label *is* — a
UI object you click and hover, not an annotation printed on the drawing.

The cost is measuring the text to size the rect in SVG:

- `getComputedTextLength()` in a layout effect — accurate, needs a
  measure-then-paint pass and a re-measure on zoom/rename.
- `<foreignObject>` with an HTML div — auto-sizes, no measuring. **But check
  the export path first**: the summary's PlanFigure rasterises to PNG, and
  `foreignObject` is exactly what breaks in SVG→canvas rasterisation. Likely
  disqualifying.
- Approximate the width from character count at the known font — crude, but the
  plate is forgiving; a few px of slack either side is invisible.

Must work for the `.ghost` (other system's room) and `.sel` states, and in
grayscale mode (studio.css:1986–1991).

**D. Move the label off the busy part of the room.** The label is placed at
`polygonCentroid` (canvas.tsx:2491). For an L-shaped or open-plan space the
centroid can land on the busiest region — or, for a concave room, outside the
polygon entirely. The cartographic fix is the **pole of inaccessibility** (the
centre of the largest inscribed circle) instead of the centroid: it puts the
label in the room's most open space, which is usually also the emptiest part of
the drawing. ~40 lines, self-contained, and it improves every room label at
once. Good companion to C.

**E. Hide the area line when zoomed out.** Labels scale with `labelZoom`, so at
low zoom the text is small *and* crossed by proportionally more linework. Show
name-only below a zoom threshold, name + area above it. Reduces clutter where
it's worst; costs nothing.

**F. Knock a hole in the plan raster behind the label.** Mentioned for
completeness — a mask over the plan image layer. More machinery than this
deserves, and it would fight the crop/grayscale/layer toggles. Not recommended.

### Noticed while shipping A — check this during the visual review

The shared halo is `stroke-width: 3px` with **no** `vector-effect:
non-scaling-stroke`, so it lives in world units and scales with the group
transform. Text doesn't: `labelZoom = Math.max(zoom, 1)` (canvas.tsx:2248)
pins it to a constant screen size above 100%. So above 100% zoom the halo
grows while the text doesn't — at 3× it's a 9px outline around 13px text.
Below 100% the two stay in proportion.

That's pre-existing and shared by all five original halo'd labels, so A adopts
it as-is rather than deviating — but it's worth a look while judging C and D,
because the screenshot that started this was a zoomed-in view. The clean fix
would be an inline `strokeWidth: 3 / labelZoom` on every halo'd label, which
matches the rule the code already states two lines up: *"Use this for text —
never for stroke widths, which should stay hairline at every zoom."*

### Decided

**Ship A + B first** — add `.ds-room-name, .ds-room-area` to the shared halo
rule (studio.css:7047) and take the area line off `--gray500`, letting size and
weight carry the hierarchy instead of lightness. Both are a few lines.

**Then look at the real screen at several zoom levels before touching C or D.**
A + B may well be enough on its own, and a plate is a heavy visual object to
add to an already-dense drawing — that call should be made against the fixed
version, not the current one. E is a cheap extra whenever someone's in there.

**Tests.** Halo/colour changes are CSS and want eyes, not jest. If C lands, the
plate geometry is worth a unit test (a label's rect encloses its text bounds);
if D lands, test the pole-of-inaccessibility helper against a concave polygon
where the centroid falls outside.

---

## Suggested order

0. **§9** — the only bug here that corrupts what the design *says*, and it can
   destroy pipework from the wrong card. Needs the A/B decision, then goes
   first.
1. **§4** — one-line correctness bug, own PR, ship immediately.
2. **§1** — biggest usability win; self-contained in the pointer handlers.
3. **§2** — build the anchor helper.
4. **§3** — reuses §2's helper; needs the A/B/C decision first.
5. **§5** — independent of the rest, but it has to know about §1's dispatch, so
   it lands after it.
6. **§6** — independent of all of it (cockpit + one deletion on the canvas);
   can run in parallel with anything above.
7. **§7 + §8 together** — they're the same fix (a reserved action column) on
   two different rows, and doing §8 without §7 just moves the collision. Land
   after §6 so the cockpit CSS is only reworked once.
8. **§10** — restructures the same roster §8a adds a figure to, so it goes
   last of the cockpit set; the row markup should be settled before it gets
   wrapped in groups.
9. **§11 A + B** — small CSS fix, can go in with anything. **§11 C + D** are
   deferred pending a look at the real screen once A + B has landed.

§6, §7 and §8 are all cockpit work — worth doing as one sitting even if they
ship as separate PRs.

§1 and §3 both touch the wall-select branch, so if they land separately, §1
first.

---

## Backlog (to be added)

_Isaac to append further items here before work starts._
