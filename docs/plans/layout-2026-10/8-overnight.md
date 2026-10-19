# The overnight build, 18 October

What was built on `v2-layout` between 1 am and the morning of Sunday 18 October, what waits for Isaac, and what to do at the switch-over. The live checklist is the progress page: https://claude.ai/artifact/J94ixCs2UpM5cRrGVK8DMS.

Nothing here is on main or in production. `v1.0.0` is today's app, tagged. Every push to `v2-layout` passed the full test suite (about 16,300 tests).

## Built

**Step 0b, the rules.** `docs/design.md` is v2's 54 rules, the palette and the scales; the old file is `docs/design-log.md`. The design test counts the new rules, and a count only goes down.

**Step 1, the colours.** The 19 colours are tokens and every old name points at one. Tiff's mark is black and white and still at rest; its rings run through the boards' colours while she works. HeyTiff is one colour. The emails show the word only and a blue button; the icons are black and white; HQ, Design and the live link are off the teal. The code nothing used is deleted.

**Step 2, the parts.** One folder, `src/components/parts`: buttons, fields, the menu, the chooser, the time field with the wheel, dialogs, toasts, view and section tabs, the tray, ticks and switches, state words and dots, initials, rows, the three states, the fade, the tooltip, and the not-found and error pages. Every main button in the app that was black is blue.

**Step 3, the frame.** The ink sidebar and the white page with its two curls; New, Search, the places, Pinned, Recents and your name; the header with the day, the time in the workspace's own zone, and open tabs. `/` is Home when you're signed in. The sidebar no longer folds.

**Step 4, so far.** New opens dark, with Task (built) and Job (the board's form). A job card's Add opens Visit, Task, Quote (Variation once accepted), Cost, SWMS and Certificate into today's flows.

**Step 5, so far.**
- The quote page in layout C, and the Quote tab's landing (nothing yet, in progress, accepted with versions and variations).
- A job's own page, `/dashboard/jobs/<id>`, with its seven sections.
- Jobs, `/dashboard/jobs`, from the board.
- Conversations, `/dashboard/conversations`, from the board, on Tiff's threads; Only me is your notes.
- Home from the board: Tiff's box, Today and To do. The bell is gone; its count sits beside Home. Today's old Home is at `/dashboard/desk` until Schedule takes its calendar.

**Across the app.**
- The typed "…" is gone from the words (193 to 2), and the CSS cuts fade instead (91 to 1).
- The browser's hover tooltips are gone (372 to 7). Where the words mattered they are in the Tooltip part; elsewhere the control already says them. A few hovers went with them: a schedule block's summary, one disabled reason in Design's menu, an approver's week strip, and the names behind "on 2 projects".
- Colours outside the 19 fell from 150 to 68. What's left defines the tokens, is Home's named exemption, or keeps v1's darker state words until their tints go.

## Waiting for Isaac

- **The forms** New and Add open: https://claude.ai/artifact/HGHsnezZh5Jz6s8mC2n3pA, with six calls.
- **Schedule, Team, Documents and your timesheet**: https://claude.ai/artifact/S4UAyEiwfm4VQY7un7Nnyz, with seven calls.
- **What New › Quote makes.**
- **Approve only once every line is priced**, as layout C does now.
- **The second button's outline**: v2's 14% edge (the boards, and now the app), or August's 3.15:1 grey.
- **Decisions 12 to 36 and Q1 to Q10** stand as recommended (`6-revisions.md`) until he says otherwise.

## At the switch-over

In this order, each one a step Isaac says yes to:

1. **Isaac's look** at Schedule and Design on the branch (the boards' calls stand as recommended unless he says otherwise).
2. **The four migrations**, each only adding to the database, so v2 works before them and the old app keeps working after them:
   - `docs/migrations/nav_pins.sql` (Pinned in the sidebar);
   - `docs/migrations/tiff_threads.sql` (Conversations);
   - `docs/migrations/tasks_job.sql` (a task on a job);
   - `docs/migrations/staff_regular_days_off.sql` (TAFE and other regular days off on the Schedule).
3. **`npm run auth0:brand`** for the sign-in page's new look.
4. **Merge `v2-layout` into main** on Isaac's word, then a walk on production: Home, Jobs, a job, Schedule, Documents, Library, Design (a new design from a PDF), Team, Settings.

Leave as they are: `NEXT_PUBLIC_STUDIO_READING` stays unset, so Start design doesn't run Tiff's plan reading until the Rooms page shows it (20 October).

After launch, queued: Tiff's Rooms page on the plans reading; the Units shelf in the Library (search a model, its specs, compare); the 3D view; the phone layout; Tiff's whole-set reading and write tools from Home.
