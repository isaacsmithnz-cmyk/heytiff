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

## Stage 4 — Completed, Agreements + create flow (pending)

_Added when the step lands._

## Stage 5 — capture pill + display mode (pending)

_Added when the step lands._

---

### Known transitional states (expected, not bugs)

- Display mode is projects-side only until stage 5 (the maintenance wall
  composition replaces it — light theme, per the decision).
- The Agreements tab links to the OLD manage/detail pages until stage 4's
  agreement sheet + create flow land.
- The note-capture card above the board is the shipped one until stage 5's
  pill replaces it.
