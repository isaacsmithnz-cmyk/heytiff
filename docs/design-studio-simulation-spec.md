# Design Studio — Simulation Mode Spec (Stage 12) · v2

> Design handoff for **Simulation mode** — the animated airflow + temperature
> layer: rooms tint blue/orange with their live temperature, conditioned air
> plumes from grilles and units, beads run the ductwork at real velocities,
> and a wall-controller card (on/off · mode · setpoint · fan · zones) drives
> it all. One engine serves every system type; ventilation is the named
> exception (§11).
>
> **v2 changes:** *nothing steps — everything travels* (new Principle 7 +
> the two-clock model, §2f): zone dampers are **continuous positions that
> travel over 5–10 s**, fans ramp, coils lag — flow redistribution and bead
> speeds morph over the travel window instead of snapping. **Discharge
> patterns** (§5a): how a grille fills the room now keys off `mount` +
> style — ceiling grilles bloom downward-out, bulkhead/wall grilles throw
> horizontally across the room, floor vents rise from the perimeter — and
> the room tint **fills from where the air lands** (a growing fill-front,
> not a uniform crossfade). **The wall controller is the thermostat** when
> one is placed (§2b): the system senses its room; return-air sensing is
> the fallback and stays a visible, toggleable choice on the controller
> card.
>
> This claims the slot the master plan already reserves:
> `design-studio-plan.md` Stage 12 "Experience layer" — *"Simulation mode
> (read-only overlay, airflow particles, zone toggles, L/s redistribution,
> time-to-setpoint — all derived from real design numbers)"* — with its lock
> gate *"sim never mutates the document"*, and the four §U components in
> `design-studio-components.md`. The rendering substrate is pre-decided:
> ADR-001 reserves a **dedicated `<canvas>` overlay** above the SVG scene
> graph for exactly this workload.
>
> Grounding: `packs/schema.ts` (§2 `airflow_ls` nominal-high, single figure;
> `sound_low_dba`/`sound_high_dba` = Lo/Hi-fan; **no temperature data of any
> kind** — supply ΔT is *computed* from capacity ÷ airflow); pair tables
> (capacity is a property of the **pairing**, `rated_cool_kw`/`rated_heat_kw`
> on all 108 rows); `loads.ts`/`loads-room.ts` (room load W = area × zone
> W/m² × multipliers; `ceilingHeightM` stored per room → air volume is
> derivable today); `coverage.ts` (room↔unit attribution via `props.roomId`);
> `graph.ts` v0 → **graph v1 + ducted spec** (duct tree, zones, spill /
> constant / bypass relief) which this sim animates.

---

## 0. Principles

1. **One engine, many arrangements.** The thermal model keys off **capacity**
   (pair-table kW — every placeable system has it). The airflow visuals key
   off **airflow_ls** where it exists (ducted) and a capacity-derived visual
   default where it doesn't (hi-walls carry no airflow in the pack). Mirrors
   ducted spec §11: capability keys off unit data, not system type.
2. **A story told with real numbers, not CFD.** Every figure on screen —
   L/s per grille, duct velocity, ΔT, time-to-setpoint — derives from pack
   data, room loads, and the drawn graph. The few modeled constants are
   named, listed, and defended in one table (§9). Nothing else is invented.
3. **Strictly read-only.** Sim never calls `mutate()`. Zone rockers,
   setpoints, fan speeds are sim state, not document state. The Stage-12
   lock gate is a test: after any sim session, the document reference is
   identical. Architecturally guaranteed: sim renders only to its own
   canvas overlay and reads the doc through the same pure lenses the
   cockpit uses.
4. **The design recedes; the air becomes the subject.** Entering sim
   desaturates the static scene (~80% grayscale, labels dimmed). This is
   what resolves the colour collision — system hues #2E68FF / #E4572E would
   otherwise fight a blue↔orange temperature scale. In sim, temperature owns
   hue.
5. **State is never colour-only, motion is never mandatory.** Every sim
   signal has a numeric/glyph channel: per-room temperature chips, per-
   segment L/s labels, damper open/closed glyphs, trend arrows.
   `prefers-reduced-motion` swaps particles and beads for static arrows +
   tints (a tint is not motion) — required by components.md §U from day one.
6. **Degrade, never guess.** A system that isn't engine-ready doesn't fake
   it: its Simulate entry is disabled with the reason (no pair, no placed
   IDU, uncalibrated floor, no `airflow_ls`, no connected return). Sim is
   the *payoff* for Tier-1 completeness — the reward for finishing the
   design.
7. **Nothing steps — everything travels.** No displayed quantity ever
   jumps. Room temps are integrators by nature; every mechanical state
   (damper position, fan volume, coil temperature, plume density) is
   rate-limited or lagged on its own clock (§2f). Flip a zone off and the
   damper *closes over seconds* while its branch slows and the other rooms
   quicken over the same window — sped-up reality, never a cut.

---

## 1. What simulates, per system type

| System | Emitters | Extractors | Control temp | Airflow source | Zoning |
|---|---|---|---|---|---|
| Split (1:1) | the IDU face | same unit (recirculates) | its room | visual default (§9) | — |
| Multi-split | each IDU face | each unit | each room | visual default | — (per-IDU controllers instead) |
| VRF | each IDU face; PEAD sub-trees via grilles | units / return grilles | per IDU / per tree | `airflow_ls` on ducted forms | on ducted sub-trees |
| Ducted | supply grilles | return grille(s) / void return | **return-air mix** (§4) | `airflow_ls` (rated high) | zones + relief (§3) |
| Ventilation | — | — | — | — | **not this engine** (§11) |

The engine sees only three things: **rooms** (thermal nodes), **handlers**
(units with a mode/setpoint/fan and a rated kW + optional rated L/s), and
**emitter/extractor points** attributed to rooms — directly (unit in room,
via `props.roomId`) or through the duct graph (grille → tree → handler,
ducted spec §11.3). System types are just arrangements of those.

**The ventilation exception** the user's instinct is right about: a Lossnay
doesn't drive room temperature, it exchanges air. Same graph, different
state variable — §11 sketches the "freshness" sim (air-age haze that vent
airflow clears) so the reserved dotted-fresh / cross-hatch-exhaust
treatments have their animated meaning designed now, shipped with Stage 9+.

---

## 2. The physics — `sim.ts`

A lumped-capacitance model per room; a small control loop per handler.
Pure functions, no React, jest-golden like `loads.ts`.

### 2a. Room state & parameters

Each served room r is one thermal node with temperature `T_r` (°C):

- **Air volume** `V = areaM2(room) × ceilingHeightM` (prop exists today,
  default 2.4 m).
- **Thermal capacitance** `C = ρ·cp·V·k_fabric` ≈ `1206 × V × 4` J/K —
  `k_fabric` (≈4, §9) stands in for furniture/linings so rooms don't warm
  cartoonishly fast.
- **Loss coefficient** `UA = roomLoadW / ΔT_design` (ΔT_design 15 K, §9).
  This is the elegant bit: **the room's existing heat-load number becomes
  its loss rate**, so an undersized system visibly never gets there — the
  sim *is* the coverage verdict, made visceral.
- Unserved rooms still simulate: they drift toward `T_out + 2` (internal
  gains trickle). In a winter scenario the un-ducted study reads cold blue —
  unserved rooms are instantly obvious.

### 2b. Handler control loop

Per handler h: `mode ∈ {off, heat, cool}`, setpoint `S`, fan
`∈ {auto, lo, mid, hi}` → fraction `φ ∈ {auto, 0.6, 0.8, 1.0}` of rated
airflow (§9 — the pack has no per-speed airflow; Lo/Hi exist only as the
sound convention).

- **Fan volume** `Q_fan = φ × airflow_ls` (ducted). Auto:
  `φ = 0.6 + 0.4·demand`.
- **Demand** `D = clamp(|S − T_ctl| / band, 0, 1)`, band 1.5 K, with
  inverter floor 0.2 when running and a 0.3 K deadband with hysteresis at
  setpoint (units settle, plumes go gentle, they don't flap on/off).
- **Output** `kW = D × ratedKw` — rated from the **pair table**
  (`rated_heat_kw` / `rated_cool_kw` by mode), not IDU nameplate.
- **Control temp** `T_ctl` — a sensing hierarchy, exactly as installed
  systems have one:
  1. **Wall controller placed** (the §1h `controller` object, in a served
     room): the system senses **that room** — the controller *is* the
     thermostat, and where the designer placed it now matters. Default
     when present.
  2. **Return-air mix** (§4): the fallback when no controller is placed,
     and a visible toggle on the controller card (`sensing: Living ⌇
     return air`) — real ME controllers offer exactly this choice, and
     flipping it mid-sim is a teaching moment (sense the hallway return
     vs. sense the room you actually live in).
  3. **Zone sensors** (v2 hook, §4): per-zone sensing when they land.
  Direct units (hi-wall/cassette) always sense their own room.

### 2c. Supply temperature — computed, not invented

The pack has no temperature data, and doesn't need any:

```
T_supply = T_return ± kW·1000 / (1.21 × Q_fan[L/s])        (± by mode)
```

(1.21 = ρ·cp for air per L/s.) Worked example, straight from pack rows:
PEAD-M100JAA + PUZ-M100VKA pair, heating 12.5 kW at 567 L/s → rise
18.2 K → supply ≈ 39 °C off a 21° return. Cooling 10.0 kW → drop 14.6 K
→ supply ≈ 12–14 °C. Textbook numbers, derived live — and honest side
effects fall out free: drop the fan to Lo and supply air runs *hotter*
(same kW, less air), exactly like the real thing. Clamp guard [8, 50] °C.

The equation gives the *target*; the displayed/emitted supply temp chases
it through a first-order **coil lag** (τ ≈ 90 sim-seconds, §9): switch a
cold system on and the first air out of the grilles is neutral, warming to
full supply temperature over a couple of demo-seconds — the plume blushes
red rather than igniting (Principle 7).

### 2f. Two clocks — mechanical time vs thermal time

The sped-up process must not speed up the machinery, or a 60× thermal
compression would make a 60-second damper travel invisible. Sim runs two
clocks:

- **Thermal clock** (compressed, ×1/30/60 — §8): room integration, coil
  lag, compressor modulation, time-to-setpoint. This is "the afternoon in
  forty seconds."
- **Mechanical clock** (real seconds, eased): damper travel (5–10 s, §3),
  fan volume ramp (~3 s), plume/bead response, louvre-style visual
  flourishes. These are *watched*, so they play at watching speed —
  the same reason particles already animate in real time.

Airflow distribution is recomputed every frame from the *current* damper
positions and fan volume, so anything mechanical mid-travel produces
smoothly morphing flows; the thermal side then follows because it is an
integrator. No displayed quantity anywhere is allowed a discontinuity.

### 2d. Room energy balance

```
dT_r/dt = [ Σ_grilles 1.21·q_g·(T_supply − T_r)     (ducted air in)
          + Σ_direct  kW_unit·1000                   (hi-wall/cassette in-room)
          − UA·(T_r − T_out) ] / C
```

Direct units recirculate room air, so their heat lands as kW; their plume
is visual (§5). Integration: fixed 0.1 s sim step × time compression (§8),
forward Euler — the system is heavily damped, nothing stiff.

Warm-up sanity check: 20 m² room, 2.9 kW load, winter 5° outside, room at
15°, 100 L/s of 39° supply → net ≈ 1 kW → ≈ 0.26 K/min real → reaches 21°
in ~30–45 min real time = **30–45 s of demo at 60×**. The user's described
scene — faint blue room, warm plume, slow turn to orange — falls out at
default settings.

### 2e. Multi-split & VRF: the shared-outdoor envelope

Each IDU runs its own loop, but `Σ demanded kW` is capped at the ODU's
rated capacity; over-demand derates every caller pro-rata. Turn every room
on at once on a tightly-diversified ODU and all rooms warm *slower* —
**diversity made visible**, the second great sales moment after
time-to-setpoint.

---

## 3. Airflow distribution & zoning dynamics

This animates ducted spec §8 — zones, motors, and the pressure-relief
choice — on the graph v1 tree.

- **Design shares** come from the existing engine (ducted 6a):
  `w_g = load-pro-rata room share ÷ grilles in room`.
- **Dampers are positions, not booleans.** Each zone motor holds
  `pos ∈ [0,1]` that **travels** toward its commanded state over
  `damperTravelS` (default 8 s, settable 5–10 — §9; real zone motors take
  tens of seconds, and the whole redistribution story lives in that
  window). A grille's gate is the product of damper positions along its
  path: `g_g = Π pos`, and the effective open share is continuous:
  `s = Σ w_g · g_g`.
- **Fan droop**: closing zones raises static and a real fan backs off its
  curve, so total volume isn't conserved:
  `Q_open = Q_fan × (0.4 + 0.6·s)` (droop constant §9). Per grille:
  `q_g = Q_open × w_g·g_g / s` — closing half the house pushes roughly
  1.7× through what's left. Faster, not double: honest.
- **The close, as watched**: flip Zone B off → its bowtie glyph rotates
  shut over ~8 s while `pos` falls; B's beads decelerate and thin as its
  branch throttles; simultaneously `s` shrinks frame by frame, so the
  open branches' beads quicken and their plumes thicken *over the same
  eight seconds*, and those rooms' fill-fronts (§5a) advance visibly
  faster. One continuous morph, no cut (Principle 7).

### 3b. Two zoning kinds — on/off kits vs linear (ZoneIQ)

The continuous-position model above deliberately covers both real ME
generations. The zoning controller row (pack §10) declares
`control: "onoff" | "linear"`, and the sim behaves accordingly:

- **On/off kit** (legacy PAC-ZC / new S-variants): dampers are commanded
  to 0 or 1 only (positions still *travel*); one system setpoint; zones
  are airflow switches; static spill zone opens when the others close.
  Rooms visibly overshoot and sag around setpoint as zones slam —
  honest.
- **Linear (ZoneIQ / L-variants)**: **each zone has its own setpoint**
  (0.5° steps) and its own sensor (the per-room sensors ZoneIQ requires —
  §4's sensing hierarchy per zone, no longer a v2 hook when the
  controller is linear). Every few sim-minutes the controller nudges each
  damper in **5% steps** toward holding its zone at setpoint (slow
  adaptive control, matching ME's "adapts every few minutes"); commands
  quantise to 0.05. A zone without a sensor object falls back to a manual
  airflow % — exactly the real product's rule (zone setpoint unavailable
  when no sensor is linked). **Dynamic spill**: when the total open ratio
  drops below the programmable threshold, the spill zone opens *only by
  the amount required* — a proportional target, natural in the position
  model. Fan AUTO tracks the open ratio.
- **The demo contrast is the sales pitch**: same house, same design —
  toggle the zoning kind on the controller card and watch on/off rooms
  oscillate while ZoneIQ rooms feather their dampers at 45% and hold
  flat. The sim argues the upgrade better than any brochure.
- Humidity (ZoneIQ sensors report it; Dry Mode targets 40–70%) is **not
  simulated** in v1 — the readout may show "—" where a humidity figure
  would sit, honest as ever.
- **Per-segment flow** = Σ q_g downstream (graph v1 aggregation) →
  `velocity = Q / (π·Ø²/4)`. Beads run at this speed (§5). Over **5.0 m/s**
  the segment goes **amber** live with a `6.2 m/s` chip — the sim doubles
  as a "what happens when only Zone A is open" checker, surfacing the
  velocity/noise problem zone kits actually cause.
- **Pressure relief behaves per the §8 choice**:
  - **Spill zone (default)**: when `s` falls below the relief threshold
    (or any segment trips the velocity cap), the spill zone's motor
    auto-opens — its rocker flips itself with the ⤢ badge pulsing. That IS
    what the kit's pressure switch does; the sim teaches it.
  - **Constant zone**: its share is always in the open set; its rocker
    renders locked-on with the ⊙ badge.
  - **Bypass damper**: excess `Q_fan × 0.6 × (1−s)` shunts supply→return
    directly. The return mix ingests supply-temperature air, ΔT collapses,
    the unit ramps down — the short-circuit penalty, shown honestly.
- **All zones closed** (no relief configured): fan winds to the droop
  floor, every bead crawls, a warning chip states the problem. Designs
  that skipped relief get to watch why it exists.

---

## 4. Return air

The user asked how return grilles participate. Three ways:

1. **They can be the thermostat.** When no wall controller is placed — or
   the sensing toggle says so (§2b) — `T_ctl` = the **flow-weighted mix of
   the rooms the return path drains**:
   `T_return = Σ q_ret,i · T_room(i) / Σ q_ret` (+ bypass air at
   `T_supply` when that relief is chosen). Void returns use the same maths
   — the void is just the duct. This produces the classic, real phenomenon:
   hallway return, bedroom doors shut, hallway hits setpoint first, the
   unit ramps down while bedrooms lag — visible, explainable, and exactly
   why transfer grilles exist. (The return mix is always *computed* and
   shown on the AHU badge even when a wall controller is sensing — the ΔT
   readout needs it.)
2. **They complete the loop visually.** Return grilles pull ambient-hue
   particles inward (the room's own air leaving); return ducts run beads
   *toward* the AHU tinted with the mixed return temperature; the AHU badge
   shows `567 L/s · ΔT 14.2°` live between its return and supply sides.
3. **They gate honesty.** Mass balance holds every tick
   (`Σ q_supply = Σ q_return` — a jest invariant). A supplied room with a
   closed path to the return and no transfer grille gets the ducted spec's
   §1e "no return relief" hint surfaced *live* as an amber room chip during
   sim — v1 keeps it informational (no invented pressurisation physics),
   consistent with the spec's naive-and-honest detection.

**Zone sensors (v2 hook)**: placed `controller · sensor` objects — today
buy-list-only — get a live role later: a zone with a sensor controls off
its room instead of the return mix. Designed now, shipped when zoning UX
matures.

---

## 5. The visual language

Two signals with different clocks, matching the described scene: **plume
colour tracks supply temperature (instant)**; **room tint tracks room
temperature (slow integration)**. Set 23° at Hi in a 15° room: the room sits
faint blue, warm orange-red smoke rolls out of the grille immediately, and
over the next half-minute the room itself crossfades to orange.

- **Scene recede**: design layers to ~80% desaturation + 60% label opacity.
  System colour stops meaning anything in sim; temperature is the only hue.

### 5a. Discharge patterns — how a grille fills a room

Plan view can't show up/down literally, but it can show **where the air
lands and how the room fills from there** — which is the difference the
mount actually makes. Everything reduces to **two primitives** with
mode-dependent parameters (keeping the visual simple):

- **CONE** — horizontal discharge (hi-wall splits, bulkheads, wall
  grilles, consoles): a directional fan-shaped jet from the face,
  travelling across the room. **Throw length ∝ `q_g`**, and it is
  **mode-dependent**: cooling throws ~1.4× further than heating (cool
  supply rides the ceiling — the Coanda effect on a hi-wall's ceiling —
  while warm supply is pitched down at the floor and lands sooner).
  Direction comes from the object's facing: grilles have rotation; units
  don't yet, so v1 **infers facing as the inward normal of the nearest
  wall** of the containing room (hi-walls hang on walls), falling back to
  the glyph's louvre edge. A small direction tick renders on horizontal
  emitters in sim so the inferred facing is visible (and auditable).
- **BLOOM** — vertical discharge (ceiling grilles, cassettes): a radial
  pattern centred on the grille, and this is where the **Coanda effect**
  lives. Coanda-capable diffusers (MDO 4-way, round, cassettes — later a
  `coanda` flag on the §8 grille row) split by mode: **cooling → Coanda
  spread**: air clings to the ceiling and travels wide before falling —
  a broad, soft, slow-fading bloom (~1.5× radius, lighter alpha);
  **heating → straight drop**: warm air must be driven down — a tight,
  dense bloom at the grille (~0.6× radius) that then creeps outward along
  the floor as an expanding ring. Same grille, visibly different
  behaviour per mode — true to life and it teaches why ceiling diffusers
  feel different in summer and winter.

| Emitter | Primitive | Parameters |
|---|---|---|
| Hi-wall / console split | cone | inferred facing · cool 1.4× throw / heat 0.7× |
| Linear bar — bulkhead/wall | cone | curtain-wide start (bar length) · same mode factors |
| Wall grille (supply, wall mount) | cone | facing = grille rotation |
| MDO 300 / round (ceiling) | bloom | Coanda: cool wide+soft · heat tight+dense→floor ring |
| Cassette 4-way | bloom | as MDO at unit scale, four-lobed |
| Linear bar — ceiling | bloom (linear) | narrow rectangular curtain along the bar, no Coanda |
| Floor vent | bloom (perimeter) | rising: slow soft creep along the near wall, laziest particles, no Coanda |

**Grille depiction in sim**: glyphs stay as designed (desaturated with the
scene); horizontal emitters gain the direction tick; ceiling emitters need
nothing extra — the bloom speaks. Locations are wherever the design put
them: grilles at their placed point+rotation, units at their placed point
with inferred facing. The AHU itself never plumes — it's concealed; its
air appears where it should, at the grilles.

- **Room tint fills from where the air lands** — not a uniform crossfade.
  Warm-up progress `p = (T_r − T_start)/(S − T_start)` drives a
  **fill-front**: a soft gradient anchored at each emitter's landing
  pattern (bloom centre, throw cone, perimeter strip per the table) that
  expands to cover the polygon as `p → 1`, then holds as a uniform tint.
  Cheap on canvas (per-emitter gradients clipped to the room polygon), and
  it *is* the user-facing promise: you watch the bulkhead grille push
  warmth across the lounge, not watch a rectangle change colour. Hue comes
  from the temperature scale below; the front's shape comes from the
  discharge pattern.
- **Two colour scales, one per subject.** Room tint reads **room
  temperature** (a light blue → light orange wash); the plume reads
  **supply-air temperature** on its own, wider ramp. They are deliberately
  different: the room warms gently while the air pouring out can be far
  colder or hotter than any room.
- **Room-temperature tint** (tint hue/strength): anchored at **21° =
  clear**. Stops: 13° deep blue 0.32 α · 17° 0.18 · 20° 0.06 · 21° 0 ·
  22° 0.06 · 25° 0.18 · 29°+ 0.32 orange — a **light blue → light orange**
  read of the room. Cool blue is held clearly apart from #2E68FF chrome.
  Every room carries a **temp chip** `18.4°` (Jakarta tabular numerals —
  no mono) with a trend arrow ↗/↘/→: the non-colour channel.
- **Supply-air ramp** (plume hue): the vapour's colour is the temperature
  of the air leaving the unit — **very dark blue at the coldest** (≈7°),
  through pale neutral (≈21°), to **very dark orange at the hottest** (≈48°;
  a deep burnt orange, deliberately not red). Ramp stops (°C→rgb): 7
  `12,30,110` · 13 `30,85,205` · 18 `92,160,240` · 21 `180,208,226` · 25
  `252,188,120` · 32 `252,130,48` · 40 `214,96,20` · 48 `165,70,8`.
- **Plumes**: soft, feathered, velocity-aligned **vapour** puffs per emitter
  following the §5a pattern (a stretched radial-gradient sprite), count &
  speed ∝ `q_g`, **hue from the supply ramp** above (lagged per §2c — first
  air out is near room-temp/neutral, warming or cooling in colour as the
  coil catches up), gentle curl growing as it mixes. **Visibility (alpha)
  keys off the supply-vs-room gap**, not the absolute temperature, so a
  draft shows whenever the unit is actually conditioning even when the
  supply itself is unremarkable. Emission density eases with fan ramp and
  damper travel — plumes thicken and thin, never pop.
- **Duct beads**: dots riding the rendered flex spline, spacing ∝ flow,
  speed = scaled real velocity — *the* zoning payoff: flip a zone off and
  watch its branch drain while the others quicken. Supply beads in supply
  hue, return beads toward the AHU in return hue. Over-velocity stretch =
  amber + chip. Closed zone motor: bowtie glyph fills solid, beads
  downstream decelerate and fade.
- **Return grilles**: inward-converging streaks in the room's ambient hue.
- **B&W mode**: tints collapse to lightness; chips, arrows, bead motion and
  glyph states carry everything (state never colour-only).
- **Reduced motion**: particles/beads replaced by static flow arrows sized
  by L/s; tints, chips, and glyph states unchanged.

---

## 6. The controller — the sim's one input surface

A floating card on the canvas (draggable, default bottom-right), styled as
a simplified wall controller — rounded rect, soft shadow, `ds-ck` card
language, Jakarta throughout (the `controller` glyph already in the cockpit
set is its icon).

```
┌──────────────────────────────┐
│  ⏻   System 1 · Ducted   ▾  │   ← power · system tab/selector
│                              │
│   HEAT ◉ ─── ○ COOL          │   ← mode
│        ┌────────┐            │
│    –   │  23.0° │   +        │   ← setpoint, 0.5° steps, big numeral
│        └────────┘            │
│   sensing: Living ⌇ return   │   ← thermostat source (§2b), tappable
│   18.4° sensed · 39° supply  │   ← live readout line
│                              │
│   fan  ▂ ▄ ▆  AUTO·LO·MID·HI │   ← fan bars
│                              │
│   ZONES                      │
│   Living   ⊙ constant  [ON]  │   ← rockers; ⊙/⤢ badges per relief
│   Beds     [ON] [OFF]        │
│   Rumpus ⤢ [ON]*             │   ← *spill: flips itself, pulses
└──────────────────────────────┘
```

- One card, tabs per simulatable system (multi-split shows per-IDU tabs —
  each IDU is its own controller, as in life).
- **Sensing line** (§2b): shows the thermostat source — the placed wall
  controller's room by default, `return air` otherwise; tappable to flip
  when a controller exists. Where the designer put the controller now has
  a consequence.
- Zone rows appear only when `settings.zones` exist; rockers write **sim**
  damper *commands* only. The rocker flips instantly (it's the button);
  the damper *travels* (§3) — the row shows a small `closing…` tick and
  the canvas bowtie rotates over the travel window. Spill zone's rocker
  can flip itself (§3) — the pulse + a one-line toast ("spill zone opened
  — pressure relief") teaches why.
- **Linear controller variant (§3b)**: zone rows swap the rocker for a
  per-zone setpoint stepper + a live **damper % bar** (`▮▮▮▯▯ 60%`)
  feathering as the controller nudges; the card header shows the
  whole-home average temp the way the PAR-ZM01A-A does. A `zoning:
  on/off ⌇ linear` toggle on the card drives the §3b demo contrast when
  the design's controller choice allows both.
- Disabled/off states: powered off → card dims, plumes stop, rooms drift.
- Keyboard: arrows nudge setpoint, space play/pause (sim-scoped).

---

## 7. Entering sim · the cockpit · gating

- **Entry**: a **Simulate ▶ pill** in the canvas top bar (with layers/B&W —
  it's view-mode chrome, not a dock tool). Sim is the Design step's first
  *persistent mode*: dock tools disable, selection/marquee off, pan/zoom
  live, Esc or the pill exits. Existing toolbar pills arm one-shot tools;
  this one holds — worth that precedent, and it's transient state like
  layers/grayscale, never persisted.
- **Cockpit**: the panel body swaps wholesale to the **Sim panel** (the
  `SystemTypeChooser` full-body-swap precedent — avoids widening
  `SegWindow`'s hard-typed two panes):
  - **Live hero**: outdoor chip + scenario, per-system card — mode ·
    output % · L/s · ΔT · dB (interpolated `sound_low → high` by fan
    fraction; only PEAD rows have the data — everything else "—").
  - **Rooms live list**: temp · trend · **time-to-setpoint** — the
    first-order estimate, or the brutal one: *"never reaches 23° — steady
    state 20.1°"* when `T_ss < S`. Coverage maths as an experience;
    the single most persuasive line in the product.
  - **Warnings strip**: over-velocity segments · no return relief ·
    all zones closed · unit short-cycling — Show pans to the offender.
- **Gating** (per system, reasons shown, Tier-1's payoff): pack pair
  resolved + IDU placed + calibrated floor + room loads present; ducted
  adds `airflow_ls` + ≥1 connected supply grille + a return path. Ready
  systems simulate; unready ones sit greyed with the reason. No system
  ready → the pill itself is disabled with the checklist.

---

## 8. Scenario & time

- **Outdoor**: Winter 5° · Summer 30° presets + a custom slider (−5…40°).
  Preset suggests the mode (winter→heat) — suggestion, not automation.
  Initial room temps = unconditioned drift (`T_out + 2`), so winter starts
  the house faint blue, summer faint orange. The described 15°-room scene
  is simply the winter preset.
- **Time**: compression chips `1× · 30× · 60×` (default 60×), play/pause.
  Temperatures integrate in sim time; particles and beads animate in real
  time (aesthetics don't fast-forward). A small elapsed clock `04:12`
  (sim-minutes) sits by the chips.

---

## 9. Modeled constants — the honesty table

Everything not derived from pack + design, in one place. All tunable in
one `SIM_CONSTANTS` block; none persisted.

| Constant | Value | Why | Upgrade path |
|---|---|---|---|
| Fan fractions lo/mid/hi | 0.6 / 0.8 / 1.0 | pack has one nominal-high figure; matches typical ME Lo/Hi ratios | per-speed `airflow_ls` pack fields (Tier-3) |
| ΔT_design (UA derivation) | 15 K | AU heating design gap; makes load ↔ loss consistent | climate-zone design temps |
| k_fabric (capacitance ×) | 4 | bare-air rooms respond cartoonishly fast | room `condition` prop could modulate |
| Fan droop constant | 0.6 | closed zones raise static; flow drops, doesn't vanish | real fan curves need `static_pressure_pa` (0/172 units have it) |
| Velocity amber | 5.0 m/s | flex noise threshold; sizing table already uses 3.0 m/s design | pack duct rows (§9) when filled |
| Supply clamp | 8–50 °C | coil realism guard | operating-envelope pack data |
| Hi-wall visual airflow | ≈ 55 L/s per kW | plume scale only — **thermal maths never uses it** (kW lands directly) | extract hi-wall `airflow_ls` (Tier-3) |
| Inverter floor / band / deadband | 0.2 / 1.5 K / 0.3 K | civilised modulation, no flapping | — |
| `damperTravelS` | 8 s (5–10 settable) | real zone motors take tens of seconds; the redistribution story plays in this window (§3) | zoning-controller pack rows could carry travel time |
| Fan ramp | 3 s real | fans spin up, they don't step | — |
| Coil lag τ | 90 sim-s | first air out is neutral, warming over ~2 demo-s (§2c) | — |
| Throw scale | saturating: 2 m + 0.02 m per L/s, cap 8 m, × mode factor, **never past the far wall** (100 L/s ≈ 4 m neutral) | reach tracks real airflow without linear blow-out on big units; air stops at the room boundary (§5a) | grille throw data if ever extracted |
| Mode throw factors | cool 1.4× / heat 0.7× (cone) · Coanda bloom cool 1.5× / heat 0.6× radius | ceiling-riding cool air vs floor-pitched warm air (§5a) | — |
| Linear-control cadence | nudge every 2 sim-min, ±5% steps | ME publishes "adapts every few minutes" + 5% increments; cadence itself unpublished | commissioning docs if ever released |
| Dynamic spill threshold | open ratio < 30% | ME says "programmable threshold", value unpublished | pack §10 row when known |

Pack wishlist (all Tier-3, never gating): per-speed airflow · hi-wall
airflow_ls · static curves. Three PEFY units lack `airflow_ls` entirely —
they're not ducted-ready today and simply don't simulate (Principle 6).

---

## 10. Architecture & the read-only guarantee

- **`src/lib/studio/sim.ts`** (pure, React-free, like `loads.ts`):
  `buildSimModel(doc, pack, floorId)` → rooms/handlers/emitters/returns/
  segments/zones (consumes `coverage.ts` attribution, graph v1, ducted
  shares); `simTick(model, state, controls, dtSim)` → next state.
  Jest goldens: warm-up curve fixture · mass balance `Σ supply = Σ return`
  · zone-close redistribution invariants (flows morph monotonically across
  the travel window) · **continuity invariant**: no simulated or displayed
  quantity moves more per tick than its rate limit allows (Principle 7 as
  a test) · spill auto-open · **the lock gate: document reference
  unchanged across a scripted session**.
- **Overlay**: one absolutely-positioned `<canvas>` over the SVG (ADR-001's
  reserved layer), inside the canvas component so it can mirror the
  viewport transform per frame. rAF loop; sim state in refs; React sees a
  ~2 Hz digest for panel readouts and chips. The document render path is
  untouched — `mutate()`/autosave/history never fire (a per-frame `setDoc`
  would snapshot undo + write localStorage every frame; architecturally
  excluded, not just avoided).
- **Perf**: particle cap ~600, beads pooled, tick 0.1 s sim-step
  accumulator, everything drawn in one pass. Tens of rooms, a few dozen
  emitters — trivial for canvas 2D.
- **Scope**: sim is per-floor and building-wide across systems (rooms are
  shared thermal nodes; each ready system contributes handlers). The
  canvas's one-active-system scoping applies to *editing*; sim mode locks
  editing, so it may render all systems' air without fighting that model.

---

## 11. Per-module deltas (future)

- **VRF**: multiple trees per system; envelope derate per §2e; nothing new.
- **Ventilation (Stage 9+)**: same graph, different state variable —
  per-room **air age**. Rooms accumulate a faint haze (staleness); Lossnay
  airflow clears it at the real air-change rate; fresh ducts animate the
  reserved dotted treatment, exhaust the cross-hatch; temperature stays
  untouched (heat-recovery tempering is a one-line readout, not a sim).
  Different verdict, same engine skeleton — exactly ducted spec §11.5.
- **Sheet-metal (Stage 11)**: rect ducts reuse beads verbatim; velocity
  from W×H area.

## 12. Explicitly out of scope (v1)

CFD/stratification/air-mixing fidelity (the §5a pattern table is the
deliberate abstraction — plan view shows where air lands, not vertical
layers) · humidity & latent loads · per-zone thermostat control (sensors
are the v2 hook, §4) · defrost/oil-return cycles · energy & running-cost
metering · multi-floor stack effect · acoustic mapping beyond the dB
readout · occupancy/solar schedules · persisting any sim state.

---

## 13. Implementation notes & sequencing

- **Dependencies**: graph v1 + grilles/zones/relief land with ducted
  Stage 7 — the full ducted sim needs them. A **split-only sim slice**
  (§1 row 1: room tint, hi-wall plume, controller card, time-to-setpoint)
  needs *none* of it and could ship any time after today as the visual
  proof-of-concept; ducted's beads/zoning then land on top when Stage 7
  does. Worth considering as "Stage 12a" — it's also the slice that makes
  the best early sales demo.
- **New files**: `sim.ts` (engine) · `sim-overlay.tsx` (canvas layer) ·
  `sim-controller.tsx` (the card) · `sim-panel.tsx` (cockpit body swap).
  `ds-sim-*` CSS namespace.
- **No schema bump**: zero persisted state. The doc is never touched.
- **Unit rotation**: the one modelling gap the sim exposes — point geometry
  supports `rotation?` but placement never sets it, so hi-wall discharge
  direction is unknown. V1 assumes the louvre edge; when ducted adds AHU
  rotation, extend the affordance to all units and plumes follow.
- **Master-plan hygiene**: this spec claims Stage 12's sim scope as
  written; ghost underlays / riser export stay Stage 12 siblings,
  unclaimed. Sim remains off the critical path per the plan's
  nice-to-have note — "worthless until the numbers under it are locked"
  — which is precisely why it gates on Tier-1 readiness (§7).
