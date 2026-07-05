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
- `{ method: "none_required" }` — explicit, distinct from "not entered"

**`compatibility` rule block** (which IDUs a given ODU accepts — §5 multi rules, §3 VRF ODUs):
- `{ method: "explicit_combination_table", combos: [...] }` — the book lists every approved combination (small multis often do)
- `{ method: "family_whitelist_with_limits", families: [...], max_count, capacity_or_index_min/max, per_port_max }` — rule-based ranges
- `{ method: "index_ratio_band", ratio_min_pct, ratio_max_pct, max_idus }` — the VRF norm
- Methods can compose (a whitelist *and* a ratio band) — the engine applies all blocks present; all must pass.

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
| `static_pressure_pa` | R for ducted forms | External static, numeric. Optional: selectable ESP settings list |
| `conn_liquid_mm`, `conn_gas_mm` | **R** | Connection sizes |
| `conn_condensate` | O | Size/type; pump built-in flag |
| `default_plane`, `allowed_planes` | **R** | `room · ceiling-cavity · floor-cavity …` — drives placement behaviour |
| `system_roles` | **R** | Which contexts this model may serve in: `["split-pair", "multi", "vrf"]` — e.g. PEFY = vrf only, MSZ = split/multi, PEAD = split (and multi where the book allows) |
| `refrigerant` | **R** | R32 / R410A — pairing + charge calcs |
| `phase`, `power_supply` | O (R for materials/electrical later) | |
| `width_mm`, `depth_mm`, `height_mm` | **R** | Plan footprint rendering |
| `sound_dba`, `weight_kg` | O | Spec-sheet niceties |
| `provenance` | **R** | |

### 3. `outdoor_units`

| Field | Req? | Notes |
|---|---|---|
| `model`, `brand`, `series` | **R** | |
| `system_type` | **R** | `split · multi · vrf` (split ODUs exist only via `pair_tables`, but still get a row for physical/electrical data) |
| `capacity_cool_kw`, `capacity_heat_kw`, `hp` | **R** | |
| `capacity_index` | R for VRF | |
| `phase` | **R** | 1Ø/3Ø — filters selection |
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
Per multi ODU (or per series): `odu_model_ref` · `port_pipe_sizes` (per port or by connected IDU size) (**R**) · `compatibility` rule block(s) (**R** — combination table, family whitelist and/or ratio band, per the book's method) · `max_total_pipe_m`, `max_per_branch_m`, `max_lift_m` (**R**) · `additional_charge` rule block (**R**) · branch-box models/rules (ref → §7) · `provenance`.

### 6. `vrf_pipe_tables`
Per series (e.g. PUMY-SP vs PUHY-P differ). The topology engine's lookup target.

- `pipe_sizing` rule block (**R**) — Mitsubishi method: `size_by_downstream_index`, an ordered list of `{ index_max, liquid_mm, gas_mm }`; other brands may size by downstream kW or other bases (see Typed rule blocks — never force the index shape onto a book that doesn't use it)
- `odu_to_first_joint`: sizing rule for the main from the ODU (**R**)
- `joint_selection`: `{ index_max → part_ref }` list (**R**) — refs into §7
- `header_selection`: same, by index + branch count (**R** where the brand offers headers)
- Limits (**R**): `max_total_m`, `max_farthest_m`, `max_after_first_joint_m`, `max_lift_odu_above_m`, `max_lift_odu_below_m`, `max_lift_idu_idu_m`
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
| **Ducted-ready** | Placeable + `airflow_ls` + `static_pressure_pa` |
| **Vent-ready** | vent type + airflow (+static for ducted vent) |

The pack browser shows completeness per range: *"PEFY-P VMA: 12/12 VRF-ready, 0/12 ducted-ready (airflow missing)"* — which doubles as the extraction to-do list.

---

## What the legacy import already fills vs. the data-book shopping list

**Filled by the DUCTR harvest (verify provenance against books):** indoor/outdoor identity, cool/heat kW, connection sizes, footprints, BC box table, pipe size list + inch map, climate zones, orientation multipliers.

**Missing — the first extraction pass per Mitsubishi book:**
1. `capacity_index` (P-numbers) for all VRF units — currently only kW
2. `airflow_ls` + numeric `static_pressure_pa` for every ducted/cassette model (`esp` is a text note today)
3. **CMY joint & header selection tables by downstream index** — the heart of VRF auto-sizing; absent entirely
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
