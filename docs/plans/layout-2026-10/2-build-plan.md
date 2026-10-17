# Build plan

## Start here

This tab is for the session that builds HeyTiff's new layout. Read it top to bottom, then Design rules, before touching code. Everything here is decided unless it sits under Still open. The reasons behind each decision are on HeyTiff: every feature, one way in.

**Building from a checkout?** Start with docs/plans/layout-2026-10/HANDOVER.md on the branch ccr-6324701b-7w9oog. It holds these tabs as Markdown, the review's research, and the order to read them in. The scripts that draw every board are in \_design/boards/.

**Where everything lives**

| What | Where |
| --- | --- |
| The design canvas | [HeyTiff canvas](https://claude.ai/artifact/XF4jr8qxfbr7nR8E59q4xT), version 97 |
| The rules for the build: one home, the new map, what gets deleted, decisions 1 to 17 | HeyTiff: every feature, one way in |
| Every task and where it is done after the change | New map: every task |
| Every feature as it is today | Today: every feature |
| The 54 design rules, palette and scales | Design rules |
| The design laws today (1,315 lines, 34 laws) | docs/design.md |
| The ratchets that count each law | `src/app/dashboard/__tests__/design-ratchets.test.ts` |
| The note router (Tiff reading a note) | src/lib/workboard/note-brain.ts |
| The house rules for the repo | AGENTS.md: this Next.js differs from what you know, so read node\_modules/next/dist/docs/ before writing code, and read docs/design.md before any stylesheet |

**The canvas, page by page.** Pages 1 to 8 hold only what was chosen, in the order it gets built, and every screen on them is drawn to the 54 rules. A teal disc on a screen is a rule's number, put there for checking; it isn't part of the design. Board titles carry the page's address where it has one.

| Page | What's on it |
| --- | --- |
| 1. The rules and the parts | All 54 rules; the 19 colours; the two 40 curves up close; nothing there yet, loading and something wrong; a dialog and a toast; Search; a time, on a wheel |
| 2. Home, New and your name | Home; New as a list (NJ-1) or as a row (NJ-2), still to pick; the your-name menu; Conversations with one open |
| 3. Jobs | The list with its views; choosing who and the order; how menus work; a job's conversation (how it works, the page, a note opened); a job's Add; Actions; a quote with Tiff asking; a Project job's visits |
| 4. Schedule | A day, the blocks in each job's colour |
| 5. Documents, Library and Design | Documents and its Templates view; a SWMS from a job's Add, in its own tab; Library; Design |
| 6. Team and your time | A person, as the owner sees them and as a tech does; Timesheets; Leave; Expenses; Notices with an event open; Write a notice; your own timesheet |
| 7. Settings and reports | Settings, Pay and holidays; Reports |
| 8. On a phone | Home, the menu, a tech talking to a job, a timesheet |
| 9. Every task, today and new | The rules for where things live, then every task press by press, today against the new layout, the first press marked |
| Archive: not the plan | Options that were turned down, boards that were replaced, and earlier rounds. Ignore it when building |

**When two sources disagree,** the Design rules tab wins, then canvas pages 1 to 9, then the main tab of this plan. The archive page and the First pass tab never win.

## Ground rules

**The six things that don't bend**

1. **One way to each thing.** Each feature has one home and one path to it. Anywhere else may show a count or a link, never a second copy you can work in.
2. **Manual entry always works.** Everything Tiff can do has a button and a form where it lives. Tiff is the faster way in, never the only one.
3. **Nothing dropped.** Every feature on the Today tab has a home in the new layout, even when its door moves. If a feature seems to have no home, stop and ask; don't delete it.
4. **HQ follows, as a variant.** HQ gets the same rules and parts as the rest, keeping what is its own (its night ground, its KPI tiles) as a variant drawn on its own board before it is built. It is the last place rebuilt, after phase 7. (Changed 15 October: it was "HQ cannot be touched".)
5. **Settings holds settings.** Only settings. Templates live in Documents, reports under your name, and how reports count is a setting.
6. **Design is core.** Design stays one of the eight places, with its own button to start a design.

**The repo's own rules**

- AGENTS.md: this Next.js is newer than you know. Read the guide in node\_modules/next/dist/docs/ before writing code, and heed its deprecation notices.
- Read docs/design.md before any stylesheet or anything a person sees. The ratchet test (`src/app/dashboard/__tests__/design-ratchets.test.ts`) holds its numbers: a change may lower a ratchet, never raise one.
- No test mocks @anthropic-ai/sdk. Tests replace fetch and read the request body instead, as note-read-wire.test.ts does.
- The pre-push hook runs the whole jest suite, about 15,750 tests, which takes several minutes. maintenance-board.test.tsx has failed once under that load and passed on its own; if it does, run the push again once. Never skip or disable a test to get through.

**How to work**

- Do Phase 0 first. The rules file and the ratchets go in before any screen changes, so every later change is held to them.
- Version 1 is the restore point. Before phase 0, check the tag is on GitHub: `git ls-remote --tags origin v1.0.0` prints one line. If it prints nothing, stop and ask Isaac. How to restore v1 is in the Review tab's backup section.
- Migrations only add until v2 has settled: new tables and new columns, nothing renamed, retyped or removed, so v1 can still run on the same data if it is rolled back. What v2 makes obsolete is removed later, in its own change.
- Delete as you replace. When a page is replaced, its old page, redirect, tests and styles go in the same change. No "coming soon" rows, no hidden pages.
- Count it. Each change says what it removed: pages, menu items, ways in, lines of code.
- Check every screen against its board on the canvas, side by side, before calling it done.
- When something in this plan turns out wrong in the code, fix the plan as well as the code.

## The order of work

Eight phases. Each one ends with the app working and every test green. Phases 3 to 6 will each be several changes. Making things (phase 4) comes before the screens (phase 5) so nothing loses its way in while the old pages go.

**Phase 0. The rules file and the ratchets.** Nothing a person sees changes yet.

- Rewrite docs/design.md as a short rules file: the 54 rules, the palette and the scales from the Design rules tab. Move the history, including the section "Decisions taken 2026-09-10", into a decision log beside it.
- Change the ratchet test as the Design rules tab lists: the new radius, the new ratchets, the baselines that drop.
- Done when the ratchet test passes on the new laws and no baseline went up.

**Phase 1. Tokens.**

- In src/app/tokens.css: the 19 colours (each hue's bright and word value, plus ink, white and the quiet grey), the ink alphas, the three motion speeds, the 40 radius. Take out the teal, the grey ground #F0F2F5 and the old state colours.
- Type: screen titles to 600; 16 regular for reading and writing.
- Done when no colour is written outside the token block and the old tokens are gone.

**Phase 2. The frame.**

- The ink sidebar and the white page with their two 40 curves; the header with the date and time on the left and open tabs on the right; New, Search with ⌘K, the eight places, Pinned, Recents and your name.
- Tabs replace the dock of set-aside cards. Tiff's mark goes black and white at rest; the wordmark goes one colour.
- The your-name menu: your card, timesheet, leave, expense claims, Reports, Settings.
- Done when every route sits in the new frame (HQ last, in its variant), and the old 11-item menu and the dock are gone.

**Phase 3. The parts.**

- Buttons (main, second, quiet, delete, link, icon-only; 32, 36 and 44), fields, choosing menus, the time wheel (today's ui/time-wheel.tsx restyled, replacing the browser's type="time" in the calendar's event form and a notice event, and the booking panel's 96-option select), dialogs, toasts, views as soft tabs, section tabs with counts, the tray, ticks and switches, state words and dots, people's initials, the row, the three states (nothing yet, loading, wrong) and the fade for text that doesn't fit.
- Done when canvas page 1's parts exist once each, and the new ratchets hold.

**Phase 4. Making things.**

- New: Job, Quote, Task, the same on every page (NJ-1 or NJ-2, whichever is picked).
- A job's Add: Visit, Task, Quote (Variation once the quote is accepted), Cost, SWMS, Certificate.
- Each place's own button, opening the same forms: Book a visit, Add an event, Make a document, Write a notice, Add a person, Add a vehicle, Add a document, Write a field note, New design, New agreement, Ask for leave, Claim an expense.
- One form for each kind of thing. It opens over the page you're on; the record it's for is a field you can change or clear; saving keeps you where you were, with a toast and Undo. A document opens in its own tab.
- Done when every new path on canvas page 9 that starts with New, Add or a place's own button works as drawn. The 16 old create spots go in phase 5, with their pages.

**Phase 5. The screens, one place at a time.**

- In this order: Home and Search; Conversations; Jobs and a job (sections, Add, Actions, Quote, a Project job's stages); Schedule; Documents, Library and Design; Team; your own timesheet, leave and expense claims; Settings and Reports.
- For each place: build it at its address, move every feature the Today tab lists for it, then delete the old pages, their menu rows, tests and styles in the same change.
- Done when each place matches its board, its old pages are gone, and the counts are written down.

**Phase 6. The job's conversation.**

- A job's Overview becomes its conversation (canvas JC-0 to JC-2). You type or talk; Tiff files notes, tasks, visits and variations through the note router's lanes straight away, with Undo, and asks only when something is unclear. Opening a note shows Tiff's summary, the recording and the exact words.
- Cache each job's thread for the hour, as the router's rules are cached.
- Done when JC-1 and JC-2 work end to end, and everything Tiff makes there can also be made with the job's Add.

**Phase 7. The phone.**

- The ink bar across the top with the page curling in at its top left; the menu is the sidebar itself; controls 44 tall; the box at the bottom (canvas page 8). Tabs are desktop only.
- Done when the phone boards match on a real phone.

**Phase 8. Tiff's model.** This can run at any point: see Tiff's model and what it costs, below.

**Addresses.** Drawn on the canvas: / , /conversations, /jobs, /jobs/3342, /jobs/3361/quote, /jobs/3302, /schedule, /documents, /library, /design, /team/lyle, /team/timesheets, /team/leave, /team/expenses, /you/timesheet, /settings/pay. The rest follow the same shape: a place, then the record, then the section.

## How making things works

- **New** holds the three things that start work: Job, Quote, Task. It's the same on every page and never fills anything in. It opens dark, reaching out of the panel from the New button, square where it leaves the panel. Still to pick: the three as a list (NJ-1) or as a row (NJ-2).
- **A job's Add** makes what belongs to that job: Visit, Task, Quote (Variation once the quote is accepted), Cost, SWMS, Certificate. It opens white, right-aligned under the button, like every menu from the page.
- **A job's conversation** is its Overview. You type or talk to it; Tiff makes the note, task, visit or variation and files it straight away with Undo, and replies only when it has to ask or has something to say. Each job has its own thread. Opening a note shows Tiff's summary, the recording and the exact words said.
- **Actions** on a job holds only what's done to the job itself: Change the stage, Pin to the sidebar, Copy the link, Print the job card, then a line, then Mark unsuccessful in red. Nothing is made from Actions; Book a day is gone from it.
- **The form.** One form for each kind of thing, whichever door you came through. It opens over the page you're on. The record it's for is a field, filled in, that you can change or clear. Saving keeps you where you were, with a toast and Undo. A document (a SWMS, a certificate, a letter) opens in its own tab instead.
- **Your name**, at the foot of the sidebar: your card (with your normal week, pay and vehicle), timesheet, leave, expense claims, then Reports and Settings.
- **Search**, under New with ⌘K: any record by name or number, grouped by kind; its last row asks Tiff, with Enter.
- **The box on Home** talks to Tiff and starts a conversation. Anything you can press, you can say there.

**Where each thing is made**

| Thing | Made from | Other ways in |
| --- | --- | --- |
| Job | New | Tiff, from the box |
| Quote | New, for a new customer; the job's Quote tab for an existing job | To do: Quote to write |
| Task | New; a job's Add | The box; the job's conversation |
| Project | New, Job, with the type set to Project; or change a job's type |  |
| Visit | A job's Add; the Visits tab's Book a visit | To do when one is due; the job's conversation |
| Variation | A job's Add, once the quote is accepted | The job's conversation |
| Cost for a job | A job's Add |  |
| SWMS, certificate | A job's Add, opening in its own tab | Documents, Make a document |
| Letter, handover sheet | Documents, Make a document |  |
| Service agreement | Jobs, Agreements view, New agreement | To do when a Project job reaches Handover |
| Event or shutdown | Schedule, Add an event |  |
| Notice | Team, Notices, Write a notice |  |
| Person | Team, Add a person |  |
| Vehicle | Team, Vehicles, Add a vehicle |  |
| Library document | Library, Add a document |  |
| Field note | Library, Field notes, Write a field note | Say it to Tiff |
| Design | Design, New design, with the job picked |  |
| Leave, or days you can't work | Your name, Leave, Ask for leave |  |
| Expense claim, fuel, company-card receipt | Your name, Expense claims, Claim an expense | A job's Add, Cost, for a cost on a job |
| Private note | Conversations, Only me | Say "Note to self" in the box |

Everything else (notes, quote lines, photos, the checklist, billing, licences, a rego, a timesheet day) is changed where it lives, with no form of its own. Every path, press by press, is on canvas page 9.

## Tiff: one engine

One Tiff and one engine, wherever you ask: the box on Home, Search's last row, a job's conversation, a quote. She can read anything in HeyTiff that the person asking is allowed to see, she works as an HVAC assistant, and she answers in the conversation with where each part came from. Decided 17 October; this replaces decision 3's "keep the box's engine and give it the Library's sources".

**What she reads.** Each is a read tool in the one registry (src/lib/tiff/registry), behind the same permission as the screen it comes from, so nothing a screen hides can be reached by asking.

- Jobs from ServiceM8: find one by client, address or number, or by what went in. Job materials, quote lines and the plates photographed on site are matched to the data packs, so "the last job we put a 10 kW Mitsubishi Electric ducted in" has an answer. A job's history, notes, visits, checklist, photos and documents.
- Quotes and the price book. Money only with Financials.
- The data packs: a unit's specs, whether units pair, and two or more units side by side. These are today's quote tools (search\_book, unit\_specs, pairing\_check, the compare), moved into the registry.
- The Library: manuals, SOPs and field notes, down to the page.
- Schedule, To do and tasks, Documents, and Team: everyone's contact details, and timesheets, leave, expenses and vehicles by permission.
- General HVAC knowledge, for whatever the records don't cover.

**How she answers.**

- Your records first, then the data packs, then general HVAC knowledge. Every part says where it came from: a job's materials, a data pack, a manual and its page, or "General HVAC knowledge, not from your documents". General knowledge is never written as though a document said it.
- When the Library has nothing, she says so and names the document that would have answered. A Library only switch under the box keeps an answer to your own documents.
- A comparison is a table in the conversation, with each pair's price from your book. Putting a unit on a quote happens in the quote, not here. When a request matches several series ("a Daikin 5 kW"), she compares the ones you quote most and offers the rest as buttons.
- A job or record she names is a row you can open.
- No web search. General knowledge is what the model already knows, so a model released lately, a price or a rule change may be missing; she says so when it matters.

**Building it.** Today there are four engines: the Tiff window (lib/brain/ask.ts, five reads), the Library's ask (lib/tiff/answer.ts, with its general, research and miss modes), the quote session (lib/quotes/session, about 25 tools) and the note router. Make them one loop over one registry: move the quote session's reads into the registry, bring the Library's three modes and page sources across, and add the reads above. Writes stay gated where they are today: a quote's tools only with that quote open, the router's lanes in phase 6. Searches read the synced copy of ServiceM8. The reads land with Home in phase 5; the boards are on canvas page 2, "Asking Tiff".

## Tiff's model and what it costs

**Done, in commit a01b18f** (pushed to ccr-6324701b-7w9oog; every test passed on the push)

- The note router (src/lib/workboard/note-brain.ts) and the mention reader (mention-brain.ts) moved from Opus 5 to Opus 5.5, at effort low: $4 in and $20 out per million tokens, down from $5 and $25.
- A refusal falls back to Opus 4.8 through the server-side fallback. Opus 5.5 screens for biology, and site notes talk about legionella, mould and possums.
- The router's fixed rules (777 tokens at the head of its prompt) are cached for an hour instead of five minutes. That pays from the third note in an hour; each note's \[kb-usage\] log line shows cache(r= w=), so the log says whether it does.
- src/lib/tiff/usage.ts prices an hour's cache write at twice the input rate.
- A probe, P4, asks whether a cheaper model could do the router's job.

**Running P4.** It needs ANTHROPIC\_API\_KEY and SUPABASE\_SERVICE\_ROLE\_KEY, which live in .env.local on Isaac's machine. On that machine run `TIFF_PROBE=p4 npm run probe:tiff`. In a cloud session, add both as environment secrets first; never paste them into a chat. P4 reads each recent note four times at effort low: Opus 5.5 twice, to see how often Opus agrees with itself, then Sonnet 5.5 and Haiku 5.5 once each. It writes a table (same rows, wrong assignee, not filed, median time, cost per note) to src/lib/tiff/probes/results.

**The rule for a cheaper model.** It takes over only if it agrees with Opus 5.5 about as often as Opus agrees with itself, and never gives a task to the wrong person. Otherwise Tiff stays on Opus 5.5.

**Prices, per million tokens**

| Model | In | Out | Cache read | Note |
| --- | --- | --- | --- | --- |
| Opus 5.5 | $4 | $20 | $0.20 | The router now |
| Sonnet 5.5 | $2 | $10 | $0.20 | In P4 |
| Haiku 5.5 | $0.10 | $0.50 | $0.01 | In P4. Prompts up to 100K tokens; it counts about 30% more tokens for the same text, and has no server-side fallback |
| Opus 4.8 | $5 | $25 | $0.50 | The fallback only |

A cache write costs 1.25 times the input rate for five minutes, twice for an hour.

**To fix before trusting Sonnet figures in the log:** usage.ts prices Sonnet 5.5's cache reads at $0.10 a million, but the API guide and the probe's own table say $0.20. Check the pricing page and correct usage.ts and its test.

**The job's conversation (phase 6)** goes through the same router, so it inherits whatever P4 decides. Cache each job's thread for the hour as well.

**ServiceM8's AI, for comparison:** an Office Agent; ServiceM8 Chat (voice, tied to the job you're checked in to); help with writing; auto-quote and auto-invoice; a Phone Agent. The free plan allows 10 uses a day. ServiceM8 doesn't say which model it uses.

## Still open

Ask Isaac before the phase each one blocks. Where there's a recommendation, the canvas already draws it.

**From the decisions on the main tab**

| # | Question | Recommendation | Blocks |
| --- | --- | --- | --- |
| 1 | What to call the place with manuals, field notes and the tools | Library, with the tools as one shelf in it | Phase 5, Library |
| 3 | One engine for asking Tiff | Settled 17 October: one engine that reads everything the person may see, and answers as an HVAC assistant (Tiff: one engine, above) | Phase 5, Home |
| 5 | Variations | One kind, on the quote; a project's variations are its job's quote variations | Phase 4, Add |
| 6 | Photos taken in HeyTiff | Send them to the ServiceM8 job automatically, so both apps show one set | Phase 5, a job's Photos |
| 7 | Reading photos now or overnight | Straight away when someone's waiting; overnight at half price for photo search | Nothing in the layout |
| 10 | Old addresses people saved | No redirect pages; an old address lands on Home | Phase 5, each deletion |
| 12 | The bell | It goes; its count sits on Home in the menu; the morning email stays | Phase 2 |
| 14 | Words appearing as you talk | Check whether live transcription is on in production | Nothing in the layout |

**From this round**

| Question | Recommendation | Blocks |
| --- | --- | --- |
| New as a list (NJ-1) or a row (NJ-2) | Either works; pick one | Phase 4 |
| What Tiff may do without asking, in a job's conversation | Notes, tasks and costs just happen. Anything to the customer, any price change and any delete is drafted and asked first; a visit too, when the time isn't clear | Phase 6 |
| What a note sends to ServiceM8 | Tiff's summary, not every word said | Phase 6 |
| Money in a job's thread, for people without money access | Hold it back on the server, the same fix as the handover sheet's bug below | Phase 6 |
| A job's main button following its stage | Enquiry: Make a quote. Quoted: Send the quote. Accepted: Book a visit. Done: Invoice | Phase 5, a job |
| A project on one ServiceM8 job or several | Linked jobs under the main job, as drawn | Phase 5, a Project job |
| Type size 20 | The rules name 12, 13, 14, 16, 24 and 32. The boards use 20 for a dialog's title and for figures beside the big one. Keep 20 for those two, or move them to 16 | Phase 0 |
| Homes that follow from the decisions but were never said outright | Service agreements from Jobs' Agreements view; private notes in Conversations, Only me; your vehicle on your card; events from Schedule's own button | Phase 4 |
| The canvas's archive page | Keep it until phase 5 is done, then delete it | Nothing |
| How long, on a wheel too | No. Clock times are on the wheel. Hours on site and hours of leave stay a number field; the break keeps its − and + | Phase 3 |
| Notices on Home | No card. A new notice shows in To do until read; the board is Team › Notices | Phase 5, Home |
| A notice event on the Schedule | Yes, as today's calendar shows it. It is made and answered in Team › Notices | Phase 5, Schedule |

## Bugs and loose ends

**Bugs found while planning.** Fix these when their place is rebuilt, or sooner.

- **The handover sheet shows money to people without money access.** Hold the figures back on the server, not just in the page. The same fix covers money in a job's conversation (phase 6).
- **The calendar day dialogs fake success.** On the Workboard's maintenance and projects calendars, Place here and Move it here always show a success toast, even when the server refused. Show what actually happened.
- **The maintenance key's Ready to run swatch has no colour.** It points at --ok, which no longer exists. Point it at the green token.
- **usage.ts prices Sonnet 5.5's cache reads at half the published rate** (see Tiff's model above).

**Loose ends carried from earlier work**

- Check that live records update with two people signed in at once.
- Add CRON\_SECRET to the Supabase Vault.
- A filter on the maintenance list: raised earlier, not yet scoped; ask Isaac what it should filter by.
- Make HeyTiff installable on a phone, with phase 7.
- Projects on one ServiceM8 job or several (see Still open).

**When this plan is built,** recount canvas page 9 against the real app and write the before and after counts on the main tab: menu items (11 to 8), pages (66), things that live in two or more places (about 150), and lines of code (about 20,000 to come out).
