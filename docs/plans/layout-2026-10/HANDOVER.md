# Handover: HeyTiff version 2, the new layout

Start here. This was written on 17 October 2026, at the end of the planning session, for the session that builds the new layout. That session is expected to run on Isaac's own machine.

## What this is

HeyTiff goes from 11 menu items and 66 pages, with about 150 things living in two or more places, to 8 places with one way to each thing. It also gets a new look: 54 design rules, 19 colours, and a white page on an ink sidebar. The plan is complete and every screen is drawn. Nothing is built yet.

Today's app is version 1. The new layout is version 2.

## Read in this order

1. This file.
2. `2-build-plan.md`: the ground rules, the phases, where each thing is made, Still open, and the bugs.
3. `3-design-rules.md`: the 54 rules, the palette, the scales and the ratchets.
4. `4-review.md`: the plan checked against the code on 15 October. It covers:
   - what the plan would drop;
   - the order that works ("One clean sweep" replaces the phase order in the build plan);
   - version 1;
   - the screens not drawn yet;
   - the brand;
   - the corrections to make before phase 0.
5. `1-main.md`: the reasons, the new map, what gets deleted, and decisions 1 to 17.
6. `5-today-every-feature.md`: every feature as it is today. Nothing on it may be lost.

These five files are exports of the plan doc, https://claude.ai/code/artifact/111b0b59-dac2-42b6-81ae-235d882b8f40 (it needs Isaac's claude.ai sign-in). The doc is the live copy. If the two differ, the doc wins; then update these files.

`research/` holds what the review was built from:

- the inventories of every page, overlay, brand surface, the shell, the flows outside the frame, and HQ;
- `review-findings.json`, all 263 findings.

Only 84 of the findings were checked: 82 held, 1 was wrong and 1 was not worth fixing. `4-review.md` already folds those in. Treat any finding it does not mention as unchecked.

## The mock-ups

- **Online:** https://claude.ai/artifact/XF4jr8qxfbr7nR8E59q4xT. Pages 1 to 9 are the plan. The Archive page is not.
- **On this machine:** run `cd _design/boards/work/v2 && python3 gen.py`. It writes every plan board as an HTML file you can open in a browser. See `_design/boards/README.md`.
- **Precedence:** when sources disagree, the design rules win, then canvas pages 1 to 9, then the main tab.

## Before phase 0, in this order

1. **Make the version 1 tag.** The planning session could not push tags, so make it from here:
   ```
   git fetch origin
   git tag -a v1.0.0 e13d7fb -m "HeyTiff v1: the app and its design before the v2 layout rebuild"
   git push origin v1.0.0
   git ls-remote --tags origin v1.0.0   # prints one line when it worked
   ```
   - `e13d7fb` is main as it was live on 15 October (#1162).
   - If main has changed since and those changes belong to version 1, tag the last commit before phase 0 starts instead, and say so in the tag message.
   - How to restore version 1 is in `4-review.md`, under "Keeping the old shell as a backup". It covers Vercel's Instant Rollback, a branch from the tag, and the data rule.
2. **Get this handover onto main.**
   - The branch `ccr-6324701b-7w9oog` holds this folder, `_design/boards/`, and two earlier commits that are not on main yet: `0c50efd` (Design's equipment data page removed) and `a01b18f` (the note router's model change and its probe, P4, described in the build plan).
   - Open a pull request for the branch. If those two commits aren't wanted yet, cherry-pick only the handover commit.
3. **Settle Isaac's decisions** (listed below), and make the corrections in `4-review.md` to the plan.
4. **Then follow "The order that works"** in `4-review.md`, step 0b onwards.

## Decisions Isaac still owes

- **From the review:**
  - whether a Project job can exist without ServiceM8 job-sending;
  - what `/` is (the door when signed out and Home when signed in, or Home stays at `/dashboard`);
  - dropping principle 8 ("Off means gone from the menu");
  - HQ's own top bar;
  - type size 20.
- **From the review's brand section:**
  - the rings' cycle;
  - whether the mark turns at rest;
  - the mark in email;
  - the Auth0 hover colour and page template;
  - the business colour field;
  - the mark's name in Search and on the phone's bar.
- **From the build plan's Still open list**, which has a recommendation for each:
  - New as a list (NJ-1) or a row (NJ-2);
  - what Tiff may do without asking;
  - what a note sends to ServiceM8;
  - the rest of that list.
- **Added 17 October, with recommendations Isaac has not yet confirmed:**
  - Hours on site and hours of leave stay number fields. Only clock times use the wheel.
  - Home gets no notices card. A new notice shows in To do until it is read.
  - A notice event shows on the Schedule, as today's calendar shows it.

## What changed on 17 October

- **Notices live in Team.** Team › Notices and the Write a notice form are drawn on canvas page 6. The notice that had strayed into the Conversations board is gone.
- **Every clock time is a scroll wheel** (rule 34; the board "A time, on a wheel" on page 1; both timesheets redrawn with the wheel open).
  - The component already exists: `src/components/ui/time-wheel.tsx`. Restyle it to the rules.
  - Put it in place of the browser's own `type="time"` in the calendar's event form (`home-cal-edit.tsx`) and a notice's event (`notices-board.tsx`).
  - Put it in place of the booking panel's 96-option select.
- **Tiff is one engine.** The same Tiff answers wherever you ask: the Home box, Search, a job's conversation, a quote.
  - She reads everything the person asking may see: ServiceM8 jobs and what went into them, quotes, the data packs (specs, pairing, side by side), the Library down to the page, Schedule, and Team by permission.
  - She works as an HVAC assistant from general knowledge where the records stop, and labels where each part of an answer came from.
  - See "Tiff: one engine" in `2-build-plan.md`, and canvas page 2, "Asking Tiff".
- **Anything addressed to you lands in To do on Home**, and only there: a note that names you, a task someone gives you, an @mention in a notice comment. Conversations has no Mentions view.
- **Version 1 and the data rule.** Until version 2 has settled, migrations only add: new tables and columns, nothing renamed, retyped or removed. That way version 1 can still run on the same data.

## House rules

- `AGENTS.md`: this Next.js is newer than you know. Read `node_modules/next/dist/docs/` before writing code.
- Read `docs/design.md` before any stylesheet. A ratchet in `src/app/dashboard/__tests__/design-ratchets.test.ts` may go down, never up.
- The pre-push hook runs the whole suite: about 15,750 tests, roughly six minutes. Never skip or disable a test to get through.
- No test mocks `@anthropic-ai/sdk`. Tests replace `fetch` and read the request body.
- One numbered feature checklist, ticked per commit, is how "nothing dropped" gets checked (`4-review.md`, "The control").
