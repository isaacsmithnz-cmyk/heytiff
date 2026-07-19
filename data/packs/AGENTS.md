# Extraction brief — turning a data book into a pack

You are transcribing manufacturer data books into HeyTiff's universal table.
Read this before touching anything, then read `../../docs/universal-table-schema.md`
(the contract) and skim `mitsubishi-electric@2026.1/` (a complete worked
example). When the two disagree, **the TypeScript types in
`../../src/lib/studio/packs/schema.ts` win** — they are what the engine reads.

A session's deliverable is one new or extended `data/packs/<brand>@<version>/`
directory plus a written report. Nothing you produce goes live without human
review, so surfacing doubt costs nothing and hiding it costs a lot.

---

## 1. The hard rule: only what the book says

**Never use the internet.** No web search, no fetching a spec page, not even to
"check" or "confirm" a figure you are confident about. The only admissible
sources are the PDFs in `../books/` and figures a staff member hands you
directly.

It follows that:

- **A field the book doesn't state is left absent.** Absent is a legitimate,
  useful value — it becomes a question on the generated gap questionnaire.
- **Absent ≠ zero.** Never write `0` to mean "not published".
- **Never interpolate.** If the book lists airflow for the 71 and the 140 but
  not the 100, the 100 has no airflow. Do not average, scale or infer it from a
  sibling model, another series, or a general knowledge of the product.
- **Never carry a value sideways** between models, series or editions because
  they "look the same". Each row cites the page it came from.
- Anything you wanted but couldn't source goes in the report's watch-list
  section (§7), not into the data.

This rule exists because the tables drive quoting and installation decisions. A
plausible-looking invented number is far worse than a visible gap: the engine is
built so that gaps are safe (an incomplete row is simply never offered), and
invented numbers are not.

## 2. Work in passes, not in one gulp

One book, or one series-family, per session. Within it, go section by section in
this order, because each depends on the last:

1. `indoor_units` → 2. `outdoor_units` → 3. `pair_tables` (splits) →
4. `multi_rules` (multis) → 5. `vrf_pipe_tables` + `parts` (VRF) →
6. `accessories`

Transcribe from the book's own tables, one range at a time, and re-read your
output against the page before moving on. A 300-page book done in one pass is
where transposition errors come from.

## 3. Identify the method before filling parameters

Where books differ in *method* rather than values — additional refrigerant
charge, which IDUs an ODU accepts, how pipe sizes are chosen — the schema stores
a typed rule block: `{ method, ...parameters }`. Your first question about any
such table is **"which method does this book use?"**, and only then "what are
the parameters?".

The supported methods are listed in `docs/universal-table-schema.md` under
"Typed rule blocks". **If a book uses a method none of them fit, stop and report
it as a schema-extension request** — describe the method and the parameters it
needs. Do not force the data into the nearest existing shape; a wrong method is
silently wrong for every model in the range.

## 4. Units and types

Canonical units, converted on entry — the display layer handles imperial:

| Quantity | Store as | Notes |
|---|---|---|
| capacity | kW | |
| airflow | L/s | m³/h ÷ 3.6; CFM × 0.4719 |
| pressure | Pa | |
| length | m | |
| pipe / duct / opening size | mm | exact flare sizes: 6.35, 9.52, 12.7, 15.88, 19.05 |
| refrigerant charge | g/m (rates), kg (charges) | |
| dimensions | mm | |

Numbers are numbers: never `"high static"` or `"~600"` in a numeric field. If a
figure is conditional (e.g. at a stated ESP), take the nominal/high value the
schema asks for and note the condition in the report.

## 5. Airway openings (ducted + AHU)

An AHU here is just the ducted fan coil — same form factor, same rules.

Each ducted unit has a `supply_opening` and a `return_opening`, and each is
independently one of:

| Answer | When | Meaning |
|---|---|---|
| `{ w_mm, h_mm }` | book gives a flange/opening size | sheet-metal opening; sizes the plenum base |
| `{ spigots: [{ count, dia_mm }] }` | book gives takeoff sizes, e.g. "2 × Ø400" | factory spigots — **no plenum**, duct connects to the unit |
| `"spigots"` | spigots visible/stated, sizes not published | same, but nothing to draw at true size |
| `"built-in"` | integral return | no plenum |
| `"open"` | ductable face, no published size | installer sizes it on site |

**Prefer the sized spigot form whenever the diameters are stated** — it's what
lets the canvas draw the connection at true size and label it. These sizes live
on the outline/dimension drawings far more often than in the spec tables, so
cite the drawing page in provenance. Factory plenum or spigot-adaptor kits sold
separately are `accessories` rows, not unit fields.

## 6. Provenance, on every row

```json
"provenance": { "kind": "extracted", "source": "<title from meta.sources>", "edition": "<code>", "page": "116" }
```

`source` must match a `sources[]` entry in the pack's `meta.json`, and every
book you actually mined must be declared there with its edition and how it was
obtained (`"access": "public"` vs dealer portal). Real page numbers — they are
what makes human review possible. Use `kind: "user-entered"` only for figures a
staff member supplied directly.

## 7. Priorities — what blocks, what doesn't

**Tier 1 (do first; these gate engine-readiness):** model/brand/series ·
form factor · footprint W×D×H · capacities · connection sizes · system roles ·
refrigerant · `capacity_index` for multi/VRF · `airflow_ls` and both airway
openings for ducted · and the rule-block rows (`pair_tables`, `multi_rules`,
`vrf_pipe_tables` + the `parts` their refs point to).

A unit row without its table row is inert — a fully specified IDU with no
`pair_tables` entry is never offered as a split. The table sections are where
most of the value and most of the transcription risk live; give them your
slowest, most careful pass.

**Tier 3 (take if it's on the page, never chase):** sound, weight, static
pressure, drain details, max amps.

`drain_pressure` is **staff-entered, not extracted** — no Mitsubishi document
states it. Leave it absent.

## 8. Check your own work

```bash
npm run validate:packs
```

Prints structural errors (dangling refs, bad enums, missing provenance) plus a
per-series engine-readiness rollup with the missing fields named. Iterate until
errors are zero. **Incomplete is fine — broken is not**: the rollup showing
`0/6 — missing: supply_opening` is a correct report of an honest gap, whereas an
error means the pack won't load. `npm test` must also stay green.

## 9. Report at the end of every session

Write it in the PR description:

1. **Mined** — which book(s), which ranges, row counts per section.
2. **Readiness** — the `validate:packs` rollup, before → after.
3. **Watch-list** — every question the book couldn't answer, phrased as what the
   next extraction should look for. These become HQ watch-list rows; they are
   the deliverable's most valuable half, so be specific ("PEFY-P-VMR-E supply
   opening: dimension drawings on pp. 88–92 show the flange but give no W×H").
4. **Suspected errata** — figures that look wrong in the book itself (there is
   precedent: a PEFY liquid/gas swap). Flag, transcribe as printed, never
   silently "fix".
5. **Schema-extension requests** — any method from §3 that didn't fit.

## 10. Ground rules

- One brand per branch (`pack/<brand>-<version>`), PR for human review. Pack
  JSON is the only thing you commit under `data/` — never a PDF.
- Don't edit the engine, the schema types or existing packs' rows to make your
  data fit. If something doesn't fit, that's a §3 report item.
- Keep JSON formatting consistent with the ME pack (1-space indent, same key
  order) so diffs stay readable for the reviewer.
