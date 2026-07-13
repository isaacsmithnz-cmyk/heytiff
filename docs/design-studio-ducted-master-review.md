# Ducted Package — Master Passover (2026-07-13)

> Output of the full-package review: competitor research (PlanDroid,
> Polyplan, market sentiment — 20/20 headline claims independently
> verified), a domain-expert workflow + engineering review, internal audits
> of all three ducted docs, and a codebase grounding pass. The consistency
> and engineering fixes it produced are already applied (spec **v8**, build
> plan updated, design brief updated). This doc records the verdict, the
> competitive landscape, and the roadmap the findings demand.

---

## 1. Verdict

**As planned, Stage 7 ships a better *design tool* than PlanDroid or
Polyplan — but not yet a competitor to them.** The canvas craft (true-scale
morphing plenums, curved flex, honest degraded states, the shared air-side
architecture) is genuinely ahead of both. What makes those tools *sellable*
is the loop after the drawing: **editable catalogues with real prices →
costed takeoff with labour and margins → customer proposal → supplier order
→ to-scale printed plan**. Our package currently ends at a quantities buy
list. The fix is a committed **commercial pack** (Stages 8–10 below) with
**duct risers pulled forward** — multi-storey is the demo-killer.

HeyTiff's structural advantages neither incumbent can match: **cloud +
multi-user** (PlanDroid is Windows-only, per-machine, ~AU$1,390/yr),
**supplier-neutral** (Polyplan is a Polyaire channel tool — catalogue,
pricing and ordering are Polyaire-only), and **the platform** (customer
records, jobs, staff already live here — quote-to-job needs no integration).

## 2. The landscape (verified)

**PlanDroid** (DelftRed, Adelaide, since 2006; Windows desktop; AU$1,390/yr
+ paid modules): the incumbent. 60+ vendor-signed AU/NZ distributor
catalogues auto-updated at startup; drag-drop parts with
connector-compatibility colouring; Quick Build duct tool; **fully automatic
design generation + automatic duct sizing** (flex only); airflow solver
with zones table; simple + ACCA Manual J heat loads; multi-storey with
level alignment and cross-level penetrations; spreadsheet costing with
margins, labour (per-part minutes or fixed), GST; Word/RTF template quotes;
supplier email ordering; simPRO/ServiceM8/webhook integrations; DXF export.
Weaknesses: no cloud/Mac/tablet, no real collaboration, vendor-gated
catalogue pipeline, modules cost extra, automation is layout-blind.
Capterra 4.9/5 — ease of use and support are why people stay.

**Polyplan** (Polyaire, cloud/Chrome, free-ish with a trade account): the
challenger that proves the cloud thesis. Four-tab pipeline (Layout /
Capacity / Components / Pricing); auto zones, **auto outlets** (picks MDO-X
kit sizes/quantities per zone), **auto fittings** (Y vs BTO + damper in 3
clicks), **Auto Flex Pen** (draw a line → sized/insulated/measured flex);
live trade-account pricing; one-click order to a Polyaire branch. Marketed
as a 15-minute residential job. Weaknesses: single-wholesaler lock-in,
simplified area-rule loads, quoting is really a priced parts list (no
labour/margins/branded proposal), Chrome-only, brand-new.

**Adjacent movers:** Cooledge (AI room detection → Good/Better/Best quote
in minutes, Stripe deposits, Xero/ServiceM8 — the quote-to-cash checklist),
FlowSpec (voice-to-quote), EzeCalc (NZ-localised sizing on NIWA data —
worth noting for NZ credibility), CAMEL+ (engineering tier). Market
sentiment: ease-of-use and professional plan output win jobs; the residual
pain is quote turnaround time and after-hours admin.

**Where we already beat them (keep these):** manual-first drawing that
looks like a mechanical drawing (both competitors render cruder), the
morphing plenum/BTO objects (neither has them — Polyplan picks fitting SKUs
from dialogs), honest engineering hints vs silent automation, degraded-data
truthfulness, multi-user cloud on a real platform, supplier neutrality.

**Where they beat us today (the roadmap):** everything in §3, plus
PlanDroid's multi-storey and its heat-load report depth, and both tools'
automation *option* (we deliberately chose manual + Auto-size — right call;
Polyplan proves buyers also want speed, which our templates + Auto-size +
guided flow must answer).

## 3. The missing commercial loop → proposed Stages 8–10

Must-haves before this is sellable against the incumbents (each was a
`must` in the domain review):

- **Stage 8 — Price & quote.** Cost/sell (or markup rules) on catalogue
  rows; company markup rules by category; labour norms (per outlet / zone /
  return / AHU set / base install); job cost/sell/GP% in the cockpit; GST.
  Then the **proposal**: branded template, plan snapshot, system summary,
  lump sum + optional itemisation, priced options ("add 4-zone +$1,450"),
  validity, e-acceptance — bound to the HeyTiff customer/job record.
- **Stage 9 — Order & print.** Supplier order export (PDF/CSV/email):
  grouped by supplier, SKUs, flex rounded to 6 m cartons, job reference.
  **To-scale PDF plan** (1:100/1:50, A3, title block, legend), auto outlet
  IDs (S1…S9, R1), outlet schedule (room · grille · size · design l/s ·
  duct Ø · length), duct cut list, commissioning sheet (design vs measured
  l/s per outlet). Every number already exists in the engine — this is the
  way out of the app.
- **Stage 9.5 — Duct risers (pull forward).** Two-storey homes are most
  new builds; "a ducted system spans one floor" is the wall the first real
  demo hits. Mirror pipe risers (bottom plenum spigots are already
  reserved for this in spec §1b); even a schematic riser that carries
  airflow attribution across floors unblocks the sale.
- **Stage 10 — Catalogue & price book.** User-editable catalogue over the
  pack rows (own grilles, flex brand, zone kits, SKUs, supplier, cost),
  CSV import for distributor price files, per-company price book layered
  over shared seed data. This is PlanDroid's moat made self-serve.

**Second wave (should):** templates / standard systems ("quote this
project home in 2 minutes" — the strongest speed claim available to us);
design revisions + variation diffs (quote Rev A/B, buy-list delta priced);
gas ducted + add-on cooling (dominant in VIC/SA — first proof of the §11
architecture); underfloor cavity setting; ancillaries checklist (safe tray,
drain, filter media, sundries %) so the buy list stops under-quoting;
commissioning sheet.

**Later:** bulkhead install variant + multi-neck linear; roof-space
constraints (hatch size vs AHU box — pack has the dims already); CFM/
imperial locale (route every quantity through the units layer now); as-built
/ warranty / service handoff (the platform play PlanDroid structurally
can't match).

## 4. Engineering corrections (applied in spec v8)

From the veteran review — all applied as spec changes, none reversing a
prior product decision:

1. **6 m rule split in two.** Joiner-restart stays as the *material/carton*
   rule (your mechanic, correctly named). New **total-run grey hint**
   (spigot→outlet along-curve, `maxTotalRunM`, fittings never clear it) —
   because a joiner adds resistance; it never resets the pressure problem.
2. **Per-stream velocities** (`velocity`: supply 3.0 / return 2.5 m/s) —
   returns are the noise path; one hot limit was over-crediting them.
3. **Diversity keys to zoning** — 1.00 unzoned (0.70 on an unzoned system
   undersizes 30 % while reading RIGHT-SIZED), 0.70 zoned; verdict floor
   upgrades to **largest zone group** once zones exist. *(Refines the
   right-panel spec §4B flat 0.70 — flagged for sign-off.)*
4. **Return suggestion capped at Ø400/run** → multiples (`2 × 600×400`);
   a single Ø500 flex is the thing nobody installs.
5. **Min-outlet hint** (25 l/s default) — tiny rooms get "serve from
   adjacent / transfer relief", not a dribbling outlet.
6. **Side-face plenum spigots** in v1; bottom spigots reserved for risers.
7. **Filtered returns by default** (frame + media buy lines).
8. **Void-return standing caution** (vented voids pull dust/fibre).
9. **Spill-zone sizing hint** (≥ ~30–40 % rated airflow; nudge to
   living/hall zones).
10. **Capacity ≠ grille rating** noted; real grille bands overlay later as
    grey noise hints. All eight series capacities seeded (Ø350/450/500
    included); fully-stretched-flex assumption documented.
11. **Linear bar >1200 mm multi-neck hint.**

## 5. Doc & code audit — fixed

- **Spec (26 issues):** stale band-era return wording + impossible
  `630 l/s` label; pack-§ vs spec-§ numbering collision (convention
  adopted: bare § = spec, **pack-§N** = schema); §2 flow missing spill
  zone; step-prompt inventory mismatch; duct HUD range/idiom; maxRunM vs
  `max_flex_run_m` precedence; zone-controller vs wall-controller
  conflation; grille-HUD size slot per stream; transfer sizes defined;
  C-key behaviour unified; takeoff state vocabulary aligned; plenum W×D
  convention; reducer added to the legend (ten rows); Attach gains
  `"grille"`; "system-level takeoff" heading renamed (BOM).
- **Code grounding (5 mismatches, now in the plan):** the cockpit hero is
  split-hardwired — Step 1 builds the `summary` dispatch; AHU selection
  reuses `pairIdu`/`pairOdu` (no `ahuModel`) so `resolvePair()`/coverage
  work day one; pack-§9 DuctComponent needs `model`/`ftype`/
  `max_flex_run_m` growth; pack schema stays v1 (optional-only); the dev
  flag mechanism must be built (none exists). Confirmed good: cockpit v3
  **is on main** (PRs #31–34), 6 PEAD ducted IDUs + 13 PEAD↔PUZ pairs
  seeded with `airflow_ls`, unit browser already filters by form factor,
  `transfer` grille type + `FormFactor "ducted"` already in schema,
  per-segment pipe eraser + grayscale mode exist to copy.
- **Build plan (17 issues):** zone-controller seed moved to Step 5 (fixes
  the one dependency inversion); air-tool gating wired into Steps 2/4;
  transfer = the Grille entry's stream chip, not a ninth palette entry
  (seed in Step 3, UI in Step 7); Step 4 test lists now cover blanking
  caps, stream-mismatch, sub-toggles, toasts, and note the `[`/`]`-bump
  interim; Auth0/live-check risk made a Step 1 exit criterion; ESP/sound
  assigned; jest gaps in Steps 2/6/7 filled.
- **Brief (9 issues):** deliverable A now asks for all ten object inspect
  cards + unit browser + grille mini-picker + Zoning row + stale chip;
  ⤢/⊙ badges moved to the Zoning-row chips; fresh/exhaust treatments and
  ODU restyle added; §10 read-in-full; full draft-state list; B&W sheets +
  units sample; toast copy corrected. **Re-paste the brief to Claude
  Design — the earlier pasted version is superseded.**

## 6. Open decisions

1. **Diversity re-key (1.00 unzoned)** — refines the previously agreed
   flat 0.70; sign off or revert.
2. **Commercial pack sequencing** — the proposed Stages 8–10 order
   (price/quote → order/print → catalogue editor) optimises for "sellable
   demo soonest"; risers (9.5) could move earlier if two-storey demos come
   first.
3. **Transfer-grille seed sizes** (300×200 · 400×200 · 600×300) are
   placeholders — swap for the sizes you actually buy.
4. **Pricing data source** — per-company price book vs HeyTiff-maintained
   distributor catalogues (PlanDroid's model) is a business call; the
   schema supports both (cost fields on rows + overlay packs).
