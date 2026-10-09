# Universal Table — Schema Design (Stage 2)

*The single data structure every data book is transcribed into, and the only thing the Design Studio engine ever reads. Companion to `design-studio-plan.md` (architecture & build order) and `_design/vrf-builder/HARVEST.md` (the Mitsubishi import that seeds it).*

## Design rules

1. **The engine never reads a data book.** Books are ingestion sources; every value lands in these sections with provenance.
2. **Canonical units, one each:** capacity kW · airflow L/s · pressure Pa · length m · pipe/duct size mm (imperial is a display map, never stored) · charge g/m · dimensions mm. Numbers are numbers — no text like "high static" in a numeric field (the harvested `esp` note becomes a real Pa value).
3. **Required vs optional is defined per role, not per table.** A model can be engine-ready for one use and not another (a ducted IDU usable in a 1:1 pair but not yet VRF-ready because its index isn't entered). "Engine-ready" is always **computed**, never hand-set.
4. **Every row carries provenance:** `{ source, edition, page }`. Legacy VRF-builder imports get `source: "legacy-ductr"` until verified against the book.
5. **Cross-references are validated at ingestion** — a broken link is an input-time error.
6. **Packs are per brand, versioned; designs pin the pack version they were built with.**
7. **Where brands differ in *method*, not just values, the field is a typed rule block** — see below. Never force one brand's method into another brand's shape.

## Typed rule blocks — handling brands that express the same concept differently

Data books agree on *what* must be answered (how much extra refrigerant? which IDUs may combine?) but not on *how* they specify it. For those concepts the schema stores a **discriminated rule object** — `{ method, ...parameters }` — and the engine ships one small evaluator per method. Transcribing a book means first identifying which method the book uses, then filling that method's parameters. If a new brand uses a method no evaluator supports yet, that is a **schema-extension task** (add one evaluator, additively — existing packs untouched), never a force-fit.

**`additional_charge` rule block** (used in §4 pair tables, §5 multi rules, §6 VRF tables):
- `{ method: "per_meter_by_liquid_size", rates: {6.35: 20, 9.52: 50, ...}, precharged_allowance_m }` — the common Mitsubishi shape
- `{ method: "formula_coefficients", terms: [{liquid_mm, coeff_g_per_m}...], deduction_g, min_charge }` — Daikin-style computed charge
- `{ method: "threshold_then_rate", free_up_to_m, g_per_m_beyond }` — common on 1:1 pairs
- `{ method: "fixed_per_idu", table: {...} }` — some multi ranges
- `{ method: "per_meter_by_liquid_size_by_farthest", bands: [{ farthest_m_max, rates }], plus_by_connected_index, plus_by_odu, plus_per_idu, round_up_g }` — a Mitsubishi VRF network (PUHY, MEES21K029 p.143): the g/m rates depend on the outdoor → farthest indoor length (≤ 30.5 m or longer), then a fixed amount by total connected index, per outdoor and per named indoor unit, rounded up to 100 g. Needs the whole network's lengths per liquid size, so it is evaluated by `evaluateVrfCharge`, not the one-run evaluator
- `{ method: "stepped_by_length", precharged_up_to_m, bands: [{ up_to_m, add_g }], liquid_mm?, length_weights? }` — a **fixed amount per length band**, not a rate: the book prints a table of kilograms by how long the run is. Bands ascend, each **inclusive** at its top ("40 m or less", "Le ≤ 40 m") and starting where the one before ends (the first starts at `precharged_up_to_m`, at or under which nothing is added). **Past the last band the book prints no amount** (Daikin's "Impossible") — the engine gives no figure and the split check is red (`past-charge-table`); it never carries the last band on. `liquid_mm`: the liquid size the table is printed for (another size has no figure). `length_weights`: when the book reads the bands on a weighted length rather than metres — liquid mm → the weight a metre of that size counts for. Examples:
  - Daikin SkyAir R32, EDAU282388 p.112 (RZAV71–125, RZAS71–160): `{ precharged_up_to_m: 30, bands: [{40, 350}, {50, 700}, {60, 1050}, {75, 1400}], liquid_mm: 9.52 }`; RZA71–160 / RZAC85–125 stop at `{50, 700}`
  - MHI FDCA160/200/250VSA-W, '24 PAC-DB-450 2.8: Le = L(φ12.7) + 0.52 × L(φ9.52) → `{ precharged_up_to_m: 30, bands: [{40, 440}, {50, 1310}, {60, 2180}, {70, 2850}], length_weights: { "12.7": 1, "9.52": 0.52 } }`. MHI calls Le an "equivalent length", but it is a liquid-volume weighting, **not** a bends-and-fittings allowance — a book whose bands key on a fittings equivalent length needs a schema extension (the Studio doesn't measure one for a split)
- `{ method: "whole_length_by_liquid_size", rates, chargeless_up_to_m?, plus_past?: { over_m, add_g }, round_g? }` — a g/m rate on the **whole** liquid length (never the metres past an allowance — that is `per_meter_by_liquid_size`). With `chargeless_up_to_m` nothing is added at or under it and the rate covers every metre once past it; without it the rate always applies. `plus_past` is a fixed adder once the run is past `over_m`. `round_g` rounds to the **nearest** step ("rounded off in units of 0.1 kg" → 100). Examples, Daikin SkyAir R410A:
  - RZQ, EDAU282226 p.128: `{ rates: { "12.7": 120, "9.52": 59 }, chargeless_up_to_m: 30, round_g: 100 }`
  - RZYQ 7–8 HP, EDAU282301 p.88: `{ rates: { "6.35": 22, "9.52": 57, "12.7": 110, … }, plus_past: { over_m: 30, add_g: 700 }, round_g: 100 }` (10 HP, EDAU282302 §14.2 "A parameter": `add_g: 1000`)
- `{ method: "none_required" }` — explicit, distinct from "not entered"

**`compatibility` rule block** (which IDUs a given ODU accepts — §5 multi rules, §3 VRF ODUs):
- `{ method: "explicit_combination_table", combos: [...] }` — the book lists every approved combination by MODEL
- `{ method: "capacity_combination_table", combos: [[25, 35], ...], provenance }` — the book lists approved combinations by SIZE CLASS (the ME multi-split form: `25+35` means any 2.5 kW head with any 3.5 kW head). Codes key on `IndoorUnit.capacity_code`, the number printed in the model name — **never** on `capacity_cool_kw`, which differs from the class on some models (AP80 is 7.8 kW, LN60 is 6.1, SLZ-M60FA is 5.6). Carries its own provenance: the table is often in a different book from the rest of the row
- `{ method: "family_whitelist_with_limits", families: [...], max_count, capacity_or_index_min/max, per_port_max }` — rule-based ranges
- `{ method: "index_ratio_band", ratio_min_pct, ratio_max_pct, max_idus }` — the VRF norm
- Methods can compose (a whitelist *and* a ratio band) — the engine applies all blocks present; all must pass.

**Multi limits a book prints beside (or instead of) its table** — each optional, each a block of its own in `compatibility`. A brand that doesn't print one leaves it out: an absent block refuses nothing and passes nothing. **Where the rule carries a combination table, the table is the capacity authority**: a set the table accepts (listed, or still growing into a listed set) is never refused by a head count's or connected total's *maximum*, and a set it lists outright is never refused by their *minimum*. `max_matching` and `excluded_combinations` are the book's own exceptions to its table and apply on top of it. A *minimum* is amber on a set still being built (it can grow into it) and red in the system's verdict; the outdoor picker says Fails, the builder still proposes the outdoor.
- `{ method: "head_count", min?, max?, fewer_allowed?: HeadMatch[][] }` — how many heads. Daikin Super Multi NX: "A single indoor unit cannot be connected for the reverse cycle type" (PCRAU1729B p.58 note 4) → `{ min: 2 }`. MHI SCM100ZS-W (compatibility chart): "normally requires a minimum of 3", up to 5, two only as listed → `{ min: 3, max: 5, fewer_allowed: [[{ models: ZSXA }, { models: ZSXA }], [{ models: ZSXA }, { models: ["SRF35ZS*"] }], [{ models: ["SRK71ZRA*", "SRK80ZRA*", "DXK24ZRA*", "DXK28ZRA*"] }, {}]] }`, where each entry is one head per slot, matched one-to-one, and `{}` is any head
- `{ method: "connected_capacity", basis: "class_kw" | "rated_cool_kw", min?, max? }` — the heads' capacities added up. `class_kw` adds the size classes read as kW (`capacity_code` ÷ 10: a 25 is 2.5 kW, a 46 is 4.6) — the form Daikin ("2.5 kW Class") and MHI ("Indoor Unit Standard Capacity") print; `rated_cool_kw` adds `capacity_cool_kw`, for a book that sums ratings. Daikin 4MXM80: "Total capacity of connected indoor units … up to the 14.5 kW" (PCRAU1729B p.58 note 3) → `{ basis: "class_kw", max: 14.5 }`. MHI SCM100: 9.0–16.0 kW → `{ basis: "class_kw", min: 9, max: 16 }`. Never a ratio (that is `index_ratio_band`), and never on an ME row (ME prints a table)
- `{ method: "max_matching", match: HeadMatch, max?, from_heads?, in_combos?: [{ combo, max }], label? }` — at most `max` heads of a kind. Fujitsu AOTH36/45KBTA5: "Up to 2 units of Medium static pressure duct … in the combination marked with *, only 1" (DR_MU034ES_01 f.10, f.16) → `{ match: { models: ["ARTH18KMTAP", "ARTH24KMTAP"] }, max: 2, in_combos: [{ combo: <the * row's classes>, max: 1 }], label: "medium-static ducted heads" }`. AOTH24KBCA3's starred rows 19, 23, 30 take none → `in_combos` with `max: 0` and no general `max`. MHI SCM100: "5 [heads]: SRK-ZSXA-W/WF, SRF35ZS-W, SRF50ZSX-W must be 4 or less" → `{ match: …, max: 4, from_heads: 5 }`. An `in_combos` entry applies only when the set's size classes are exactly that combo; `from_heads` = only on a set of that many heads or more
- `{ method: "excluded_combinations", combos: [[20, 20, 20, 20, 71], …] }` — sets the book rules out by size class, matched exactly (a set still being built can grow past one). MHI SCM100 "Combination of indoor units that are Not Possible": 20+20+20+20+71, 20+20+20+20+80, 20+20+20+25+71, 20+20+20+50+50
- `HeadMatch` = `{ models?: string[], form_factors?: FormFactor[] }` — model patterns are an exact model or a prefix ending in `*` (as accessories and branch boxes read them; a `*` mid-pattern is invalid — list each model); every criterion given must hold
- **Not a kind of its own, because the existing whitelist says it:** "class 22/24 heads not on AOTH24KBCA3", "floor consoles only on KBCA3/KBTA4", "SRK63/95ZRA and FDUM other than 50 not on SCM100" — list the models the book marks connectable for that outdoor in its `family_whitelist_with_limits.families` (exact model prefixes, never the bare series)
- **Never a limit:** port pipe sizes. Installers adapt ports; a port-size finding would refuse installable jobs

**Other concepts that get rule blocks as brands are added:** pipe-size selection basis (downstream index vs downstream kW vs fixed-by-port), joint/header selection (by index vs by pipe size), max-length accounting (total vs farthest vs equivalent-length with fitting allowances), capacity correction (some books derate by pipe length/lift — a later enhancement, but the slot exists).

The ingestion checklist question is therefore never "what's the g/m value?" but "**which method does this book use, and what are its parameters?**" — that phrasing survives every brand.

---

## Sections

### 1. `brands`
`id` · `name` · `regions` · notes.

### 2. `indoor_units`
The largest section. One row per model.

| Field | Req? | Notes |
|---|---|---|
| `model` | **R** | Exact code, unique per brand |
| `brand`, `series` | **R** | |
| `form_factor` | **R** | `wall · ducted · cassette-4way · cassette-1way · cassette-compact · under-ceiling · floor-console · floor-concealed · bulkhead` — drives palette grouping, plane default, and which extra fields are required |
| `capacity_cool_kw`, `capacity_heat_kw` | **R** | Rated |
| `capacity_index` | R for VRF/multi roles | Brand's index (Mitsubishi P-number, Daikin class). Used for connection-ratio + pipe/joint lookups |
| `airflow_ls` | R for ducted/vent roles | Nominal (high). Optional: per fan speed. **Feeds duct sizing, grille shares, sheet metal — missing from the legacy import** |
| `static_pressure_pa` | O (Tier-3 in v1) | External static, numeric — no ESP check yet; becomes required when the ESP check lands. Optional: selectable ESP settings list |
| `supply_opening`, `return_opening` | **R for ducted forms — gates ducted-ready** | Data-book airway openings, per face: `{w_mm,h_mm}` mm (sheet-metal flange — sizes the plenum base, ducted spec §1b, **never** the unit width) · `{spigots:[{count,dia_mm}]}` (factory spigots — the book publishes takeoffs *instead of* an opening, e.g. `2 × Ø400`; **prefer this whenever the diameters are stated**) · `"spigots"` (spigots confirmed, sizes not published) · `"built-in"` (integral return) · `"open"` (ductable face, no published size — installer sizes it). Either spigot grade means no plenum is fabricated: the duct connects to the unit, and the canvas draws the takeoffs on the unit face |
| `filter` | O | Return-air filter provenance: `"built-in"` (integral washable) vs `"field-supplied"` (by others — typical for ducted forms). Tier-3 |
| `drain_pressure` | O | Which pressure side the drain connection sits on: `"positive"` vs `"negative"` (negative needs the deeper trap). Tier-3 |
| `drain_pump` | O | Condensate lift pump: `"built-in"` vs `"none"` (gravity — field pump by others). Tier-3 |
| `conn_liquid_mm`, `conn_gas_mm` | **R** | Connection sizes |
| `conn_condensate` | O | Size/type; pump built-in flag |
| `default_plane`, `allowed_planes` | **R** | `room · ceiling-cavity · floor-cavity …` — drives placement behaviour |
| `system_roles` | **R** | Which contexts this model may serve in: `["split-pair", "multi", "vrf"]` — e.g. PEFY = vrf only, MSZ = split/multi, PEAD = split (and multi where the book allows) |
| `refrigerant` | **R** | R32 / R410A — pairing + charge calcs |
| `phase`, `power_supply` | O (R for materials/electrical later) | |
| `max_amps_a` | O | Max running amps (Tier-3 — never blocks; electrical planning) |
| `width_mm`, `depth_mm`, `height_mm` | **R** | Plan footprint rendering |
| `sound_low_dba`, `sound_high_dba` | O | Spec-sheet niceties. A sheet publishing ONE figure fills `sound_high_dba` only |
| `weight_kg` | O | Spec-sheet nicety |
| `provenance` | **R** | |

### 3. `outdoor_units`

| Field | Req? | Notes |
|---|---|---|
| `model`, `brand`, `series` | **R** | |
| `system_type` | **R** | `split · multi · vrf` (split ODUs exist only via `pair_tables`, but still get a row for physical/electrical data) |
| `capacity_cool_kw`, `capacity_heat_kw`, `hp` | **R** | |
| `capacity_index` | R for VRF | |
| `phase` | **R** | 1Ø/3Ø — filters selection |
| `max_amps_a` | O | Max running amps (Tier-3 — never blocks; electrical planning) |
| `conn_liquid_mm`, `conn_gas_mm` | **R** | |
| `refrigerant`, `precharged_kg`, `max_charge_kg` | R for charge calc | |
| Multi only: `ports`, `min_connected` / `max_connected` (kW or index per brand), `branch_box_required` | **R** for multi role | |
| VRF only: `ratio_min_pct`, `ratio_max_pct`, `max_idus` | **R** for VRF role | e.g. 50–130% |
| `pipe_table_ref` | **R** for multi/VRF | → §6 — *this is the cross-reference the sizing engine follows* |
| `width_mm`, `depth_mm`, `height_mm`, `weight_kg` | **R**/O | Footprint R |
| `provenance` | **R** | |

### 4. `pair_tables` (split 1:1)
One row per approved IDU+ODU pairing — the split engine reads *only* this section for matching.

`idu_model` · `odu_model` (**R**, validated refs) · `pipe_liquid_mm`, `pipe_gas_mm` (**R**) · `max_length_m`, `max_lift_m` (**R**) · `additional_charge` rule block (**R** — materials needs it) · `rated_cool_kw`, `rated_heat_kw` (O, defaults from units) · `provenance`.

### 5. `multi_rules`
Per multi ODU (or per series): `odu_model_ref` · `port_pipe_sizes` (per port or by connected IDU size, **in the book's port order, A first** — port A is not always the largest: Daikin 3/4MXM's A is the smallest gas port, 5MXM100's the largest) (**R**) · `compatibility` rule block(s) (**R** — combination table, family whitelist and/or ratio band, plus any of the multi limits above, per the book's method) · `max_total_pipe_m`, `max_per_branch_m`, `max_lift_m` (**R**) · `max_lift_idu_idu_m` (O — the height between any two heads: Daikin Super Multi NX 7.5 m "between Indoor Units" (EDTAU122219A), Fujitsu AOTH24–45KB 10 m (DR_MU034ES_01), MHI SCM; judged on where the heads are placed — floor plus height on it — red about the drawing; absent = not checked) · `additional_charge` rule block (**R**) · branch-box models/rules (ref → §7) · `provenance`.

### 6. `vrf_pipe_tables`
Per series (e.g. PUMY-SP vs PUHY-P differ). The topology engine's lookup target.

- `pipe_sizing` rule block (**R**) — Mitsubishi method: `size_by_downstream_index`, an ordered list of `{ index_max, liquid_mm, gas_mm }`; other brands may size by downstream kW or other bases (see Typed rule blocks — never force the index shape onto a book that doesn't use it)
- `odu_to_first_joint`: sizing rule for the main from the ODU (O — Mitsubishi's Table 1 equals the ODU's own connection sizes, so the engine defaults to those)
- `odu_liquid_upsize` (O): per ODU, the farthest-indoor length from which the ODU → 1st joint liquid steps up (PUHY P250 at 90 m, P300 at 40 m → 12.7)
- `joint_selection`: `{ index_max → part_ref }` list (**R**) — refs into §7
- `header_selection`: same, by index + branch count (**R** where the brand offers headers); per step `direct_odus` (the outdoors it may join with no joint before it) and `excludes_idu_index` (indoor sizes it cannot take — CMY-Y104-G can't take P200/P250)
- Limits (**R**): `max_total_m`, `max_farthest_actual_m`, `max_farthest_equiv_m`, `max_after_first_joint_m`, `max_lift_odu_above_m`, `max_lift_odu_below_m`, `max_lift_idu_idu_m`; O: `bend_equiv_m_by_odu` (equivalent length = actual + M × bends), `extended_after_first_joint_m` and `extended_lift_idu_idu_m` (the longer figures the book allows when the liquid pipe goes one size up)
- Charge (**R**): `additional_charge` rule block (per-metre-by-liquid-size for Mitsubishi; other brands per their book's method)
- `provenance`

### 7. `parts` (fittings & control boxes)
One section, typed rows: `part_type` = `joint · header · bc-box · branch-box · reducer · flare-adaptor …` · `model` (**R**) · type-specific block (joints: index range; headers: branches + index; BC boxes: ports, max index/kW; branch boxes: ports) · dimensions O · `provenance`. *(The harvested CMB-P BC table lands here; CMY joint tables are a known gap to extract.)*

### 8. `grilles`
`model/code` (**R**) · `style` (linear-bar · square-4way · round · eggcrate · slimline…) (**R**) · `size` (face mm / neck mm) (**R**) · `airflow_min_ls`, `airflow_max_ls` (**R** — the duct engine checks grille vs room airflow) · `mount` (ceiling/wall/floor) (**R**) · `type` (supply/return/transfer) (**R**) · finish/colour O · `provenance`. Vendor-agnostic (grille suppliers, not AC brands) — `brand` optional here.

### 9. `duct_components`
Flex duct sizes (`diameter_mm`, insulation rating, `max_airflow_ls` at velocity limit) (**R** for ducted) · rigid/sheet-metal standard sizes (W×H list) (R for sheet-metal stage) · fittings (bends/branches/boots/plenums) O until sheet-metal stage · velocity/friction limits per duct class (**R** for auto-size later, O for v1 manual pick).

### 10. `zoning_controllers`
Per vendor system (AirTouch, MyAir/MyPlace, OEM zoning): `vendor`, `model` (**R**) · `max_zones` (**R**) · `damper_part_refs` by duct size (**R**) · `sensor_options` (**R**) · `expansion_rules` (e.g. >4 zones → module X) (**R**) · `compatible_brands/units` (**R**) · touchpad/tablet parts O · `provenance`.

### 11. `ventilation_units`
Fans + ERV/HRV: `model`, `brand` (**R**) · `vent_type` (exhaust · supply · lossnay/erv · hrv · inline · underfloor) (**R**) · `airflow_ls` (per speed; ERV: supply + extract both) (**R**) · `duct_conn_mm` (**R**) · `static_pa` at rated flow (R for duct sizing) · heat-exchange efficiency O · `provenance`.

### 12. `accessories`
`model` (**R**) · `category` (wifi · wired-controller · condensate-pump · filter · drain-kit · mounting…) (**R**) · `compatible_with` (unit model list or family patterns, validated) (**R**) · description O · `provenance`.

### 13. `consumables` (materials backbone)
Pipe stock by size (pair-coil / singles, insulation class) · cable · drain pipe · duct tape/fixings. Mostly seeded once, brand-independent. R for materials pricing later; the schedule can emit sizes/lengths without this in v1.

---

## Engine-ready: the computed flags

A row is offered by the engine only when its role's required set is complete:

| Role | Required set (summary) |
|---|---|
| **Placeable** (appears on canvas at all) | model + form factor + footprint + planes |
| **Split-ready** | Placeable + capacities + a validated `pair_tables` row |
| **Multi-ready** | Placeable + capacities (+ index if brand uses it) + ODU `multi_rules` complete |
| **VRF-ready (IDU)** | Placeable + capacities + `capacity_index` + connection sizes |
| **VRF-ready (ODU)** | above + ratio limits + complete `vrf_pipe_tables` for its series (sizes, joints, limits, charge) |
| **Ducted-ready** | Placeable + `airflow_ls` + `supply_opening` + `return_opening` (`static_pressure_pa` optional in v1 — no ESP check yet) |
| **Vent-ready** | vent type + airflow (+static for ducted vent) |

The pack browser shows completeness per range: *"PEFY-P VMA: 12/12 VRF-ready, 0/12 ducted-ready (airflow missing)"* — which doubles as the extraction to-do list.

---

## What the legacy import already fills vs. the data-book shopping list

**Filled by the DUCTR harvest (verify provenance against books):** indoor/outdoor identity, cool/heat kW, connection sizes, footprints, BC box table, pipe size list + inch map, climate zones, orientation multipliers.

**Missing — the first extraction pass per Mitsubishi book:**
1. `capacity_index` (P-numbers) for all VRF units — **done for PUHY + City Multi (2026.1); still missing on the 11 PUMY outdoors**
2. `airflow_ls` + numeric `static_pressure_pa` for every ducted/cassette model (`esp` is a text note today), plus `supply_opening`/`return_opening` airway sizes for every ducted model and `max_amps_a` from the electrical tables
3. **CMY joint & header selection tables by downstream index** — done for PUHY-P200–500YNW-A1 (MEES21K029 p.139-144); PUMY has none
4. `size_by_downstream_index` pipe tables per series (the legacy kW-bucket rule is an approximation to replace)
5. Length/lift limits per series and per pair
6. Additional-charge rules (g/m by liquid size, pre-charge allowances)
7. Split 1:1 `pair_tables` (M-series/P-series pairings) — none exist yet
8. Refrigerant type per model
9. Accessories (Wi-Fi adaptors, controllers) + compatibility
10. Fix on import: PEFY-P100/125/140VMHS-E liq/gas swap; split the duplicate `WALL` family code

---

## Storage & validation (implementation sketch)

- One directory per brand pack: `data/packs/<brand>@<version>/` holding one JSON file per section; plus `data/packs/shared@<version>/` (grilles, ducts, consumables, zoning).
- **Build the pack loader merge-aware from day one** (resolve = overlay over base, overlay initially always empty). Company overlays are a Later feature, but retrofitting merging into a loader that assumed a single source is painful; supporting it from Stage 2 costs almost nothing.
- A schema module (zod or JSON Schema) validates: field types/units, enum membership, **referential integrity across sections**, and role-completeness (emitting the engine-ready flags).
- Ingestion = edit JSON → run validator → CI blocks broken packs. (An admin UI for entry is a later nice-to-have; validated files are enough for v1.)
- Designs store `packRefs: [{ brand, version }]`.

## Where data books get uploaded

**Initial build:** there is no in-app upload. Data books are given to Claude (or transcribed manually) → extracted against this schema's field checklist → validator + CI gate → new pack version deployed. The pack browser is the read-only visibility layer (what's loaded, what's engine-ready, what's missing).

**Future — the Data Library (admin-gated screen in HeyTiff):** upload a data book PDF → stored in Supabase storage → AI-assisted extraction fills the schema's fields → a **review screen shows every extracted value beside its source page** → accept commits the rows and bumps the pack version (existing designs stay pinned; new designs use the new version). Pack-browser gaps ("airflow missing for this range") become upload prompts. Hard rule regardless of era: **extraction output never writes directly into live data — human review sits between the book and the table.**

### The gap questionnaire (in-app upload flow)

The questionnaire is **generated, not designed**: after extraction, the diff between filled fields and the role's required set (the same diff that computes engine-ready) is presented as questions for the user to answer manually. No bespoke forms per brand or type — a book's blind spots shape its own questionnaire (e.g. Fujitsu ducted books omit supply/return plenum sizes → exactly those fields surface). Required fields block engine-readiness; optional fields are offered but skippable. A partially answered unit is safely inert until its required set completes, then flips engine-ready and appears in the palette.

**Provenance types:** `extracted` (book/edition/page, shown for verification) vs `user-entered` (who/when) vs `legacy-ductr`. The inspector can disclose a value's origin ("entered by you, not from manufacturer documentation") — matters for trust, liability, and debugging.

### Company data layering

Two pack layers: **base packs** (curated, shipped with HeyTiff, versioned) and a per-tenant **company overlay pack** holding that company's uploaded units and manual answers — merged over the base, never visible to other tenants, editable in-place in their Data Library. Some overlay values are conventions rather than facts (field-fabricated plenums: "we always make the return 600×600") — legitimate, but always marked as not-manufacturer-data. Designs pin base version **and** overlay version.

### Data-usage rules (copyright posture)

The universal table stores **facts** (specifications, limits, rules) re-selected and re-arranged into this schema — never the books' expression. Rules: the app renders only our own tables, never source documents; uploaded PDFs stay in private storage as ingestion sources, never redistributed or displayed publicly; no copied diagrams, charts-as-images, or explanatory text; model names used nominatively with a no-affiliation disclaimer; exports carry "verify against manufacturer documentation." Note how each book was obtained (public download vs dealer portal) in pack metadata.
