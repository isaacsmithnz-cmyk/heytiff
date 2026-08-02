# Workboard maintenance redesign — live verification checklist

Everything below is what jest *can't* prove: real browser motion, real
Supabase writes through a signed-in session, and how the board feels with
real data. Work through a stage after its step deploys; tick items off and
note anything odd inline. Build steps land as commits on PR #235.

House rules while walking: sign in yourself (Claude never drives the
authenticated app), and use the workspace freely — nothing in it is real
data. Every check on this list writes through the same server actions the
tests already cover; what you're verifying is the wiring end-to-end, the
visuals, and the feel.

**Seed data first (needed for every stage):** the new create flow arrives in
step 4, so until then use the OLD form: Workboard → Service agreements tab →
"Manage agreements" → create 3–4 agreements. Useful spread:

- One monthly agreement anchored ~10 days ago → generates an overdue visit.
- One quarterly anchored next week → a this-week/near visit.
- One annual anchored 3 months out → proves the quiet end stays quiet.
- Give at least one a bring list (packing list lives on the sheet from step 2 on).

---

## Stage 1 — schema + status law (commit `76651e0`)

Nothing renders differently by design in this step; the checks are data-level.

- [ ] Supabase → Table editor: `maintenance_visit_techs`, `agreement_categories`,
      `agreement_tags`, `agreement_tag_links`, `agreement_packing_items`,
      `maintenance_visit_packed` all exist and are empty; `maintenance_visits`
      has `booked_date`, `actual_hours`, `completion_note` columns.
- [ ] Old agreement detail page still works (visits list, readiness chips now
      read **Equipment / Access** — two chips, not four).
- [ ] Tick a readiness chip on the old detail page → row's `readiness` jsonb in
      Supabase shows only `equipment_ready` / `access_confirmed` keys.

## Stage 2 — board shell, Upcoming, the visit sheet (commit `5d3413e`)

**The surface rule (E7) — watch it, don't take the code's word:**

- [ ] Workboard opens on **Urgent**; the five tabs read Urgent · Upcoming ·
      Calendar · Completed · Service agreements (C5 order).
- [ ] Switching tabs: the white card **never blinks away** — content drifts up
      and out, new content rises in (vertical only, no sideways slide), and the
      card's box morphs if the height differs. Chrome/Edge get the view
      transition; Safari should show the plain vertical swap. Feel both if handy.
- [ ] The tab underline-slab slides between tabs; the first tab's corner fuses
      with the card's corner.
- [ ] Reduced motion (System Settings → Accessibility): switches become instant,
      nothing animates, nothing breaks.

**Upcoming:**

- [ ] Groups read Overdue → This week → Next week → Week of {Mon date}; inside a
      group the reddest rows sit first; a fully-ready visit shows the green
      **Ready** slab.
- [ ] Row hover lifts gently; row click opens the sheet from the right.

**The sheet (write path — each of these hits prod Supabase):**

- [ ] Tick Equipment / Access → chips flip live; check the jsonb in Supabase once.
- [ ] Crew has **no tickbox** — assign someone from the select; the gate ticks
      itself; "1 of N" reads right; unassign works.
- [ ] Packing list: add an item, tick it packed, chip counts "1 of 2 packed";
      untick; remove the item. Two clients with a same-named service keep
      SEPARATE lists (B13 — worth one deliberate check with two agreements).
- [ ] Day: pick a weekday → "Place it"; pick a Saturday → the two-button choice
      appears (roll to Monday / keep Saturday). Place after the due date → the
      mismatch line goes red ("N days after it was due").
- [ ] Tags: create one ("Our install"), colour sticks; add a second tag —
      the first **must not change colour** (B2). Same tag suggested on other
      agreements' sheets.
- [ ] Notes save.
- [ ] **Close-out (K1):** Mark visit complete → date defaults today, hours
      prefill from the estimate, note field; complete it → visit leaves
      Upcoming, appears in Completed with YOUR hours (not the estimate), and
      the agreement's next visit already exists on the Upcoming list.
- [ ] Esc and scrim-click close the sheet; focus lands on the close button when
      it opens.

**Boundary:** sign in as the staff-tier account (isaacsmithnz@gmail.com) —
gates and packing still tickable, but no place/complete/skip/tags/add-item
(manage-tier controls absent, not broken).

## Stage 3 — Urgent live actions, day modal, toasts (this commit)

**Urgent quick actions (the queue must empty itself):**

- [ ] An equipment-gap row shows **Confirm equipment** — press it: the row
      clears on refresh, a toast appears at the bottom, **Undo brings the row
      back** (the §J loop, now derived).
- [ ] A crew-gap row assigns from the row's select; Undo unassigns.
- [ ] An overdue **unplaced** row says "Book it in" → sheet opens; an overdue
      **placed** row says "Close it out" → sheet opens straight on the
      close-out form.
- [ ] Flag rows Clear with Undo restoring the flag; task rows Done with Undo
      reopening the task.
- [ ] **B23 dead:** fire two actions quickly — TWO toasts stack, each Undo
      undoes only its own action.
- [ ] Filter chips atop Urgent: counts read right; pressing "overdue" hides the
      rest; pressing again returns Everything; empty filter states read kindly.

**Calendar + day modal:**

- [ ] Cells carry colour from the same law as the rows — an overdue placed day
      is red, an all-ready day green, done days grey-ticked, weekends tinted.
- [ ] Today's cell is ringed and labelled.
- [ ] Click a day → the modal: tone-washed header, service cards; gate chips ON
      the cards tick live (toast + undo); the crew chip is a select, never a tick.
- [ ] "Place a service on this day" (K8, wired): unplaced list first (most
      overdue leading), then "Booked another day — moving one reschedules it"
      (A5). Place one → cell repaints after refresh; Undo takes it back to
      where it was.
- [ ] Clicking a Saturday cell and placing there does NOT nag about weekends —
      pointing at the day was the choice (B9).
- [ ] Month paging (‹ ›) keeps the modal-day behaviour on trailing/leading
      cells of the grid.

**Header chip:**

- [ ] With ServiceM8 connected: "ServiceM8 synced N min ago" sits right of the
      tabs; break the connection (or wait for attention state) → chip goes red
      "needs attention"; standalone workspace → no chip at all.

## Stage 4 — Completed folds, agreement sheet, create flow (this commit)

**Completed — the invoicing pass:**

- [ ] Done visits fold into **To invoice** (leading, warn chip counts them) and
      **Invoiced** below. Mark one invoiced → it moves folds on refresh, toast
      Undo brings it back. Un-invoice exists on the other side.
- [ ] `invoiced_at` lands in Supabase when marked; null when unmarked.

**The agreement sheet (rows on the Agreements tab now open it):**

- [ ] Meta edits (label, client, site, billing contact, techs, hours, access
      notes, requirements, notes, we-installed) save as one patch; check one
      field in Supabase.
- [ ] Cadence change warns about the redraw, saves, and only UNTOUCHED future
      visits move (tick a gate on one future visit first, then change cadence —
      that visit must survive where it was; pristine ones redraw).
- [ ] Pause → agreement row chips "Paused", its visits leave Upcoming/Urgent/
      Calendar entirely; Resume brings the horizon back. End needs the second
      press, then the agreement leaves the board (rows stay in Supabase).
- [ ] Category dropdown moves it; "New category…" creates + assigns without
      touching any other agreement (B17). Accent colour on the group header
      band stays stable as categories are added.
- [ ] Tags and packing list edit here too; equipment register adds a unit with
      model/serial/location and removes one.

**The create flow (New agreement on the Agreements tab):**

- [ ] Manual create: visits generate immediately; NO fabricated "last done"
      anywhere (K3) — the story starts at the first due date.
- [ ] Weekend first-due warns and offers the Monday anchor; keeping the
      weekend is allowed (K4/B9).
- [ ] Duplicate guard: type a client that already has an agreement →
      the existing ones list with "Open it instead"; Create disables until
      the deliberate-override tick (the Halston-twice failure, dead).
- [ ] Standalone: no ServiceM8 tab at all. Connected: search by job number or
      client name hits the mirror; picking prefils client + suburb.
- [ ] **With ANTHROPIC key set:** "Let Tiff read the job" fills label/cadence/
      hours/techs/access + packing suggestions — every field stays editable,
      nothing writes until Create (the form is the review). Without the key
      the button doesn't render and prefill stays direct.
- [ ] Create from SM8 stores client provenance (`client_provider`,
      `client_remote_id` on the agreement row).

**Book the category (the K8 lost feature):**

- [ ] A category header (not Uncategorised) offers "Book the category on one
      day" → pick a day → each agreement's NEXT open visit lands on it; ONE
      toast, one Undo restoring every visit to where it was (or off the board
      if it was unplaced).

## Stage 5 — the capture pill + the light wall (this commit)

**The pill (one capture UI, everywhere — D15):**

- [ ] Workboard header carries the pill: "Add note" text half + round mic half
      (mic absent when ELEVENLABS key is unset — typing carries it). The old
      capture card is GONE from the overview and project pages.
- [ ] Project detail page: same pill, docked in the header row, visible to
      staff-tier too (taking a note is never manage-gated).
- [ ] Press "Add note" → the board dims (a dim, not a blur), the ribbon card
      opens with **"General note"** in the chip, textarea focused. Esc
      discards.
- [ ] Open a visit's sheet first, then the pill → chip reads
      **"Against: {client} · {service}"**; save a note and confirm in Supabase
      that `workboard_notes.target_kind='visit'` with the right id.
- [ ] Mic path: press the mic half → recording state with the live red dot,
      the timer counting, and the REAL sample bars (talk — they must move;
      mute the mic — they must not). "Stop & read" transcribes then shows the
      review. Discard mid-recording releases the mic (OS indicator off).
- [ ] Deny mic permission → kind error, typing still works (the floor).
- [ ] The review inside the overlay is the full engine: editable rows, drop
      ticks, clarify question with chips, task assignee select, "Just keep
      the note", "Save these" disabled when everything's dropped.
- [ ] After save: overlay closes, the pill wears the summary chip for a few
      seconds, the effects land (flag on Urgent, task in the queue).

**Display mode (the big screen):**

The separate "wall" composition is GONE (2026-08-02). Display mode mirrors
the page you were on and takes the app frame away — it is the screen you WORK
off, not one you watch.

- [ ] Display mode button lives on BOTH sides and behaves identically on each.
- [ ] It fills the screen with the SAME board you were looking at: the
      sidebar, topbar and the well's rounded inset go, nothing else moves.
      **LIGHT theme** — there must be NO dark flip anywhere.
- [ ] The side switcher still works from inside it (Maintenance ↔ Projects),
      and so does every tab.
- [ ] Everything is still pressable — open a visit sheet, tick a gate, use
      the capture pill. Sheets and toasts must be VISIBLE (they portal to
      `<body>`; that's why the fullscreen element is the whole document).
- [ ] The header's button reads **Close display mode** and returns you to the
      app with the shell back.
- [ ] Esc does the same thing as the close button.
- [ ] Leave it up past the minute mark — it refreshes itself (change a gate
      from your phone; it repaints within a minute) WITHOUT closing an open
      sheet or losing a draft.

### Post-walk cleanup worth queueing (not bugs)

- The legacy routes `/dashboard/workboard/maintenance` (+ `[id]`) still exist
  as fallback surfaces; once the sheet has proven itself live, retire them.
- `agreement-detail-screen.tsx`, `maintenance-screen.tsx` and the old radar
  pieces (`vitals.ts` maintenance halves) become dead once those routes go.

---

### Known transitional states (expected, not bugs)

- The Agreements tab links to the OLD manage/detail pages until stage 4's
  agreement sheet + create flow land.
- The note-capture card above the board is the shipped one until stage 5's
  pill replaces it.

---

# Projects side (PR #236) — the five-step overhaul's second half

Same house rules. Seed: create 2–3 projects (Workboard → Projects tab →
Pipeline → "New project" — the All-projects page holds the create form).
Useful spread: one at Pre-install with its checklist part-ticked, one at
Fit-off with a budget + a couple of claims, one blocked. Give each a trip
or two (project page → Trips → "Add a trip"), one overdue (target date in
the past), one placed on a real day.

## Stage P1 — foundations (commit `7522b23`)

Data-level only:

- [ ] Supabase: `project_scope_items`, `project_variations`, `project_claims`,
      `project_milestones`, `project_visit_items` exist; `maintenance_visits`
      has `project_id` + `label`, and `projects` has the blocked/budget/hours/
      promised/defects columns.
- [ ] Creating a trip writes a `maintenance_visits` row with `project_id` set
      and `agreement_id` null — and the MAINTENANCE board doesn't show it.

## Stage P2 — the four-tab board (commit `21ca988`)

- [ ] Workboard → Projects: the funnel/strip/vitals are gone; four tabs
      (Urgent / Pipeline / Completed / Calendar) on the persistent card, same
      motion as maintenance (card never re-enters, content swaps vertically).
- [ ] Urgent: a blocked project shows danger with "Open the project"; an
      overdue trip offers Book it in / Close it out; a gate gap confirms in
      place and the row leaves; assign-select fills Crew.
- [ ] Pipeline: stage groups in order, trouble first inside each; money chip
      says "claimed of total"; blocked/on-hold chips read right; row click
      opens the project page.
- [ ] Completed: a project at stage Complete but active sits in "ready to
      close"; Mark it done moves it below with its money verdict chip; undo
      in the toast restores it.
- [ ] Calendar: per-side by default; "Everything" folds the maintenance dots
      in wearing hollow rings; a day click opens the TRIPS day modal (place /
      move with undo); the maintenance calendar's "Everything" shows project
      dots the same way.
- [ ] Trip sheet (from any row): gates tick, crew assigns, day places with
      the weekend choice, bring list adds/ticks/removes, SM8 link takes a
      typed number, close-out records hours + carries unpacked items to the
      next trip, delete takes two presses.
- [ ] Flags: a note flagged against a project (or its trip) appears on the
      PROJECTS urgent queue only; a general flag stays with maintenance.

## Stage P3 — the project page (commit `d664317`)

- [ ] Header: Block… demands reason AND who; the banner tells the story and
      Unblock clears it; Hold/Resume/Mark done (only at Complete) behave.
- [ ] Stage: advancing past unticked items warns with the honest count and
      needs the second press; backward asks nothing; completing a section
      (e.g. all of Approval & prep at Pre-install) shows the nudge and one
      press moves it.
- [ ] Trips card: same rows as the board (open + ran), opens the same sheet,
      labour-burn line under it when an hours budget is set.

## Stage P4 — money, scope, dates, handover, flywheel (commit `11bc567`)

- [ ] Money: set a $50k total, add a $10k claim → "Claimed $10,000 of
      $50,000 — $40,000 to go". Approve a $4k variation (it asks who made
      the call) → the line's total becomes $54,000 and the claimed does NOT
      move. Mark the claim paid → the paid strip changes, the claimed line
      doesn't. "Claim it" on the approved variation raises its prefilled row.
- [ ] Scope: inclusions/exclusions add + remove, two columns.
- [ ] Dates: promised finish counts down (set one 5 days out → warn chip;
      past → danger + the board's urgent row); defects end creates ONE open
      task on the dashboard and moving the date moves the task; a milestone
      inside 7 days wears "this week".
- [ ] Commissioning: type a reading → it lands dated; /handover/1234 opens
      the printable sheet outside the app shell with equipment/serials,
      commissioning record, scope, handover ticks and sign-off lines; Print
      gives a clean A4.
- [ ] Flywheel: at Handover, "Set up the agreement" takes cadence + first
      service → the agreement exists on the maintenance board with the
      project's equipment/serials copied; the project card now LINKS to it
      and the prompt is gone.

## Stage P5 — photo-scan, documents, cleanup (this commit)

- [ ] Equipment → Add: photo of a nameplate prefills description/model/
      serial as a DRAFT (or says Tiff is offline when no key); "keep the
      photo" lands it in Documents & photos.
- [ ] Documents & photos: upload a photo + a PDF; both list with size/age;
      Open serves the signed URL; remove works; the handover sheet still
      renders after uploads.
- [ ] Capture pill: on the project page a note lands against the project;
      on the board with a trip sheet open it lands against that trip.
- [ ] The old projects funnel/strip never flashes anywhere; nothing on the
      maintenance side moved.
