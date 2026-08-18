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

**Staff may enter figures the book doesn't publish; you may not.** Some rows
carry `provenance.kind: "user-entered"` — an owner's judgement call, labelled so
the app can say "not manufacturer documentation for this model". Those rows are
not a precedent for you. An extraction agent writes `extracted` values or
nothing: absent stays absent, and the gap goes in your report.

## 1b. Read the PDF, never a screenshot

Every extraction error made on this pack so far came from reading a page image
instead of the source PDF. Three in one session: two model-code misreads and a
convention misread, each caught within minutes of opening the book.

**If the PDF is on disk, open it.** Do not extract from a pasted image, a
screenshot, or a photo — not to save time, not when the figure "looks obvious".
Ask for the file instead.

The recipe, cheap enough that there is no excuse (times are for a 1596-page,
124 MB book):

```bash
pdftotext -layout book.pdf out.txt          # ~20 s; gives you a searchable text layer
pdftoppm -r 400 -png -f N -l N \
  -x 3150 -y 800 -W 1500 -H 1700 book.pdf crop   # crop-zoom before believing a dimension
```

- **Map printed folio → PDF page once, and verify it.** The offset is constant
  within a section (it was +1083 for section 3 of the City Multi book) but you
  must confirm it against several known folios before trusting it.
- **Confirm the title block AND the model table** of every page you cite — not
  the drawing. Model codes one letter apart (`VMH-E` / `VMHS-E` / `VMHS-E-F`)
  are indistinguishable at screen resolution and their outlines are nearly
  identical. Grep the text layer for the exact code before writing a value.
- **A code in a page footer may be a SECTION code, not the book's.** Folios
  3-205…3-228 of `MEES21K067` print `MEES21K026`. A differing code is not
  evidence of a different document.
- **Check what a dimension is attached to, not just its value.** On the VMR-E
  outline the `105` sits near the air outlet but is dimensioned against "439
  (Suspension bolt pitch)" — it is a bolt offset. Follow the leader lines.
- **Grep before concluding a model is absent, and before concluding it is
  present.** `PEFY-P·VMH-E` occurs once in 1596 pages, in a controller
  compatibility list: the family is referenced, but no spec or dimension section
  covers it.

## 1c. When your reading contradicts the pack, suspect your reading

Existing rows are evidence. If a figure you have just read disagrees with what
the pack already holds for sibling models, the likeliest explanation is that you
are reading the wrong column, the wrong row, or the wrong convention — not that
the existing data is wrong.

The case that proves it: external static is published as a selectable list,
`50 - <100> - <150> - <200>`. The un-bracketed figure is the factory setting;
the pack stores the **maximum**. A pass that read the factory setting produced
150 for two rows whose siblings all held maxima, then concluded the eight
existing rows were inconsistent. They were correct; the new reading was wrong.

So: derive the convention from the rows already there, state it in your report,
and if you still believe the pack is wrong, say so in the report rather than
"fixing" it.

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

## 4b. Form factor — copy the book's type column, don't judge the casing

`form_factor` is Tier-1 and it is **transcribed, not decided**. Nearly every
data book types its own ranges, in a lineup or combination table near the front
of each section. Find that table, read the row, and write what it says. Height,
depth, external static and how the outline drawing looks are all *consequences*
of the type — none of them is the answer, and a rule of thumb built from them
("under 250 mm is a bulkhead") will be wrong at the next range.

Books do not share a vocabulary, so the mapping onto our enum is per-book and
belongs in your report. Worked example, the two Mitsubishi books behind
`mitsubishi-electric@2026.1`:

| Book | Its word | Our `form_factor` |
|---|---|---|
| M-P0922 (2024) p.B-2, S-series table | **Compact Bulkhead** (SEZ-M·DA) | `bulkhead` |
| M-P0922 (2024) p.A-2, P-series table | **Ceiling-concealed** (PEAD-M·JAA, PEA-M·GAA/HAA/LAA) | `ducted` |
| City Multi Brochure 2019, folio 110 + model pages | **Compact Depth Type** (PEFY-P·VMX-E, PEFY-P·VMS1-E) | `bulkhead` |
| City Multi Brochure 2019, folio 110 | **Medium / High Static Pressure Type** (PEFY-P·VMA, ·VMA3, ·VMHS) | `ducted` |
| City Multi Brochure 2019, folio 110 | **Low Noise Type** (PEFY-P·VMR-E) | `ducted` |

Two things that example is there to teach:

- **The books disagree with each other, and sometimes with themselves.** City
  Multi never prints "bulkhead" for any PEFY — its word for that tier is
  "Compact Depth Type" — and folio 128 files VMS1 under "Low Static Pressure
  Type" while folio 110 and the model page file it under "Compact Depth Type".
  Transcribe what the majority of pages say, cite them, and put the dissenting
  page in the watch-list (§9.3). Do not average, and do not pick the reading
  that tidies the range.
- **Where a book's vocabulary genuinely has no home in the enum, stop and
  report it** as a schema-extension request (§3). Do not force it into the
  nearest existing form factor.

**A row is not evidence for another row.** Matching casing, opening sizes and
static pressure between two series proves they were transcribed the same way,
not that they are the same type — if the first extraction carried figures
sideways, the check confirms a copy against its own copy and reads as several
independent agreements. This is §1c and §1 in a specific costly shape: it
happened, VMS1 was classified on it, and it had to be retracted and redone off
the pages. Only a page settles a type.

**Why this one hides.** `ducted` and `bulkhead` are treated identically by
everything downstream — both require `airflow_ls` and both airway openings,
both are air-capable, both take an external static (`DUCTED_FORMS` /
`AIR_CAPABLE_FORMS` in the engine read `["ducted", "bulkhead"]`). So a wrong
choice between them fails no validation, lowers no readiness figure and throws
no error. It surfaces only as the wrong word on a customer-facing sheet, months
later. Getting it right is a transcription discipline, not something the
validator will catch for you.

## 5. Airway openings (ducted + AHU)

An AHU here is just the ducted fan coil — same form factor, same rules. So is
a `bulkhead` unit: it is a different TYPE (§4b) but an identical set of airway
questions, and the engine requires both openings of it just the same.

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
form factor (**§4b** — off the book's type column) · footprint W×D×H ·
capacities · connection sizes · system roles · refrigerant · `capacity_index`
for multi/VRF · `airflow_ls` and both airway openings for the ducted forms
(`ducted` AND `bulkhead`) · and the rule-block rows (`pair_tables`,
`multi_rules`, `vrf_pipe_tables` + the `parts` their refs point to).

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
6. **Form-factor vocabulary** — the book's own type names and what you mapped
   each onto (§4b), with the table and page you read them from. The next pass
   on the same brand should not have to rediscover that "Compact Depth Type"
   means `bulkhead`, and a reviewer cannot check a mapping you didn't state.

Before you write it, **re-verify your own citations against the PDF** — open
each page you cited and confirm its title block names the models you wrote to.
This is the check that catches the errors in §1b, and it is fastest immediately
after the pass, while you still remember which page was which.

## 9b. If you find an earlier extraction was wrong

Retract it, in its own commit, before doing anything else. Say what was wrong,
what the correct reading is, and how it was caught. Do not quietly overwrite the
bad value in a later commit — the review trail is what makes the pack
trustworthy, and a silent fix looks identical to a silent error.

If a retraction lowers the readiness rollup, that is the correct outcome: the
rollup was overstating. Never leave a number in place because removing it would
look like going backwards.

## 10. Ground rules

- One brand per branch (`pack/<brand>-<version>`), PR for human review. Pack
  JSON is the only thing you commit under `data/` — never a PDF.
- Don't edit the engine, the schema types or existing packs' rows to make your
  data fit. If something doesn't fit, that's a §3 report item.
- Keep JSON formatting consistent with the ME pack (1-space indent, same key
  order) so diffs stay readable for the reviewer.
