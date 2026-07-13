# Design Studio — Right Panel Spec (per system type)

> Handoff brief for redesigning the Design-step right panel.
> Grounded in the current implementation: `studio.tsx` (`ds-sidecol`),
> `split-panel.tsx`, `modules.ts`, `coverage.ts`, `system-type-chooser.tsx`.
> **Split is the only live module today.** Multi-split, Ducted, VRF are
> declared in `modules.ts` but fall through to a "Coming at Stage X"
> placeholder — designing them is the point of this doc.

---

## 1. What the right panel is

On the **Design** step, the panel is the `<aside className="ds-sidecol">` to the
right of the canvas (`studio.tsx`). It's the **system cockpit**: where you
create systems, serve rooms, size and place units, and confirm coverage. Its
contents swap based on (a) the **active system's type** and (b) **what's
selected on the canvas** — it is not a static properties panel.

It stacks two pieces:

### 1a. `SystemsPanel` (top, always visible)
- **System tabs** — one colour-dotted pill per system + a `+` to add. Clicking a
  tab makes that system *active*; the canvas and the rest of the panel scope to it.
- **Type chooser** — with no systems yet (or on `+`), the panel is replaced by a
  grid of system-type cards (`SystemTypeChooser`). **Type-first**: you pick the
  type before anything else. Only Split is enabled; others show "Coming at Stage X".
- **System header** — active system's type label + **Change** (changing type
  wipes that system's units/pipework, keeps its rooms) and delete (×) with confirm.
- **Rooms list** — every room the system serves: coverage dot, name, area,
  `covered/total kW`; shared rooms get a "shared ✕" chip. **"Serve an existing
  room"** lets this system adopt rooms drawn under other systems.

### 1b. Inspector (bottom, context-sensitive)
- **Room (or nothing) selected → `RoomInspector`** ("Configure"): room name +
  rename, Area / Heat-load / Floor facts, polygon thumbnail, **Edit** (heat-load
  modal), then **`RoomUnitsSection`** — *Select units* → `UnitBrowser`, the chosen
  units as **drag-to-plan cards**, a **coverage bar**, and a **Pipework** list.
- **Placed unit / riser / pipe-run selected → `SystemObjectInspector`** — model,
  system, floor, "serves room" for IDUs; group + rise for risers; attached-ends
  for runs; delete.

**One-line purpose:** choose the system type → serve rooms → size and place
units → confirm coverage and pipework.

---

## 2. The module contract (why panels differ)

Each type declares its behaviour in `modules.ts`. The three fields that drive the
panel:

| field | meaning |
|---|---|
| `roomScope` | `single` (split) vs `multi` (one outdoor/handler serves many rooms) |
| `unitFlow` | `pair` (1 IDU + 1 ODU) · `per-room` (an IDU per room, shared ODU) · `ducted` (one air handler + grille/outlet per room) |
| `summary` | what the live summary emphasises: `split` · `capacity` · `ducted` |

---

## 3. Per-type panel layouts

| | **Split (1:1)** — *live* | **Multi-split** | **Ducted** | **VRF / VRV** |
|---|---|---|---|---|
| Room scope | single room per system | many rooms, one outdoor | many rooms, one air handler | many rooms, one refrigerant network |
| Unit flow | `pair` — 1 IDU + 1 ODU | `per-room` — IDU per room, shared ODU | `ducted` — one handler + grille/outlet per room | `per-room` — many IDUs on a branched network |
| Panel emphasis (`summary`) | pair · run length · badge | **ODU capacity gauge** + IDU count | **system size · zones · outlets · grilles** | capacity gauge **+ refrigerant network / pipe sizing** |
| Rooms list role | one room, its pair | **IDU roster** — a unit per room, rolling to one ODU | **zones/outlets** fed by one handler | IDU roster, network-wide coverage + connection limits |
| Unit selection | pick 1 IDU + 1 ODU | pick an IDU per room; ODU **suggested from summed load** | pick one air handler sized to total; outlet/grille per room | pick IDUs per room; ODU + branch controllers from the network |
| Pipework section | one run + optional riser | a run per IDU back to shared ODU | **duct runs / branches** (not refrigerant) | branched refrigerant network with joint/header sizing |
| Key new UI element | coverage bar (exists) | **connected-capacity gauge** on shared ODU | **airflow & duct/zone summary** | **capacity gauge + network diagram** |

### The two big shape-changes to design

1. **Single-room vs whole-system panel.** Split = "one room, its pair."
   Multi / VRF / Ducted need a **system-wide roster** (all rooms/IDUs at once)
   with a single shared-outdoor summary above it (the capacity gauge). The rooms
   list stops being a picker and becomes the editable roster.
2. **Refrigerant-pair model vs airflow model.** Split / Multi / VRF speak
   IDU + ODU + refrigerant pipe. **Ducted breaks that**: one air handler, rooms
   are *outlets/grilles with airflow (l/s or CFM)* connected by *ducts*, not a
   refrigerant run. Its Units and Pipework sections need different labels and fields.

---

## 4. Coverage confirmation (per type)

**Universal principle:** every design must prove the rooms it serves are
sufficiently covered. *How* it's computed and shown differs in two families.

### Family A — per-room coverage (Split, Multi-split, VRF)

One IDU per room → check room-by-room. This is what `coverage.ts` does today.

- **Per room:** `installed capacity (Σ placed IDUs in room) ≥ room heat load`
  → `covered` / `under` / `unknown`.
- **Display:** coverage dot on every room row (green / amber / grey) + a system
  roll-up ("6 of 6 rooms covered").
- **Multi-split & VRF add a second, separate check** on the shared outdoor:
  connected IDU capacity vs ODU rated capacity (the capacity gauge). Room ticks
  and the ODU gauge are independent — a job can have every room covered yet an
  over-connected outdoor, or vice versa.

### Family B — system-total coverage with diversity (Ducted)

No IDU per room — one air handler feeds all served rooms. Coverage is a
**system-level** check with **two conditions that must both pass**:

1. **Diversified total:** `installed capacity ≥ D × Σ(peak load of every served room)`
2. **Largest-zone floor:** `installed capacity ≥ max(single room load)`

- **D = diversity factor, default `0.70`, adjustable per system.** Expose an
  inline field/slider (≈ 60–100%); persist on `system.settings`
  (e.g. `settings.diversityFactor`).
- The system **passes only if both hold.** Fail states: **undersized** (fails 1
  or 2) and **oversized** (well above required).

**Display — show both levels:**
- **Top: system-total gauge** (the verdict) — `Σ room loads → ×D → required
  capacity → vs installed capacity`, with the diversity control inline. Names the
  failing condition ("meets diversified total but 4.2 kW short of the master bedroom").
- **Below: per-room breakdown** — each served room with load and share (and later
  airflow, l/s) for duct balancing. **Informational, not a pass/fail gate** — the
  single system gauge is the gate.

### Summary line

> **Split / Multi-split / VRF:** prove *every room row* is covered (installed
> IDU ≥ room load), one unit per room. Multi/VRF also gauge connected-vs-outdoor
> capacity.
> **Ducted:** prove *the whole system* is covered — installed air-handler
> capacity ≥ **max(0.7 × Σ all served-room loads, largest single room load)**,
> with 0.7 adjustable. System-total gauge is the verdict; per-room breakdown sits
> beneath it.

---

## 5. Data model notes (for whoever implements)

- System type: `SystemType` in `document.ts` (`split | multi-split | ducted |
  vrf | ventilation | sheet-metal`).
- Per-system state lives on `DesignSystem.settings` (`Record<string, unknown>`):
  today `pairIdu` / `pairOdu` / `roomId` / `roomIds[]`. Ducted adds a diversity
  factor and (later) airflow/duct fields here.
- Room load: `roomLoadKw(doc, room)` (`loads-room.ts`). Coverage:
  `roomCoverage(...)` and `systemPairKw(...)` (`coverage.ts`) — per-room today;
  a ducted system-total function is the new engine work.
- Coverage status enum: `covered | under | unknown` — ducted needs an
  `oversized`/`undersized` distinction at the system level.
