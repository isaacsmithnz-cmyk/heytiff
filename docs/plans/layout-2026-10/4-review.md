# Review of the plan

Oct 15, 2026 · Before the build starts. Everything here was checked against the code at commit a01b18f and against the plan's tabs and the canvas (v101).

## What was checked, and the verdict

**The six questions.** Does the plan remove the ability to do anything? Can it be done in one clean sweep? Can the old shell be kept as a backup? Which surfaces has it not touched, and of those, which cross on the rules' parts and which need their own design first? Where does the brand (the mark, the wordmark, the teal) appear, now that the mark goes black and white? And what is every page the app can render?

**How.** Five readers inventoried the app: every route and page (64 pages, 48 routes, 3 layouts), every overlay (about 60 modals, sheets, pickers, wizards and viewers), every brand surface, the shell and everything coupled to it, and the flows outside the dashboard (sign-in, onboarding, the public papers, the emails). Then 25 finders worked one question or one area of the Today tab each, a critic named what they had missed and six more finders covered it. 263 findings came back, each with a file and line in the code and a pointer to what the plan says. Every finding was then sent to three checkers: one reads only the code, one reads only the plan, one judges whether it matters. The checkers got through 84 of the 263 before the weekly usage limit stopped them (17 October): one claim was refuted and has been corrected here (a plain diary entry saved without Tiff was never team-visible), one was judged not worth its words, and 82 held. The claims this tab leans on in the other 179 were re-checked by hand against the code before writing. HQ was inventoried separately after Isaac put it in scope.

**The verdict.** The decisions in the plan hold up; nothing in the code argues against the eight places, New and Add, the job's conversation, or the 54 rules. But the plan is not yet buildable in one clean sweep, for four reasons, each with a written fix below.

1. **The phases are in the wrong order for the code as it is.** Phase 2 replaces the menu, the bell and the dock three phases before their replacements exist: the eight places have no routes until phase 5, `navHref` throws on a missing key inside four server actions, the bell is the only door to a reminder's Later and a task's Got it, and a set-aside job cannot become a tab until a job is a page. Home at `/` collides with the sign-in door, the proxy's gates and Auth0's landing, none of which the plan mentions.
2. **Phase 1 as one step breaks what it does not name.** The tokens it removes are read by the studio (117 reads of the teal), HQ (its text, quiet tier, amber and focus ring), the sign-in screen and all ten emails (a hand copy checked by a test), and four tests that pin them by name.
3. **About a third of the surfaces have no board.** Vehicles, agreements, a visit opened, Schedule's Week, Month and capacity, five of Settings' seven sections, five of a job's seven sections, the papers, the door, the mail, the mark's motion, the viewer, the date field (the time wheel is drawn now), the scan step, the signature pad, and the 92 native selects the rules' chooser must replace.
4. **The plan drops or blurs about 40 abilities**, a dozen of them outright: starting a project when jobs are not sent to ServiceM8, clearing a leftover booking, importing a design file, the Library's reading controls, an invite's Copy link and Revoke, the ServiceM8 send switches, Quoting's component price picks, letters' privacy, and the old work-rights form that is the only door in a workspace with no checks yet.

The backup is version 1: the tag `v1.0.0` on main as it was live (e13d7fb, #1162), plus committing the canvas generator, which today exists only in this session's scratch space.

**The counts.** 263 findings: 1 blocker, 78 high, 138 medium, 46 low. By kind: 48 screens with no board, 41 subjects the plan never touches, 44 abilities lost or degraded, 26 homes named ambiguously, 30 errors in the plan's own text, 22 contradictions between its tabs and the canvas, 25 sweep and ordering risks, 14 parts that need design first, 13 brand surfaces.

## Abilities at risk

Every row was checked in the code. "Today" says where the ability lives now; "the plan" says what the plan does with it; "fix" is what to write into the plan or the canvas. Nothing here argues against a decision; each is a feature the decisions forgot.

**Would be lost outright**

| Ability | Today | The plan | Fix |
| --- | --- | --- | --- |
| Start a project when jobs are not sent to ServiceM8 | `createProject` inserts a HeyTiff record with no ServiceM8 call (actions/workboard.ts:207); attaching a job is optional | Every project is New › Job with the Project type, but `createNewJob` refuses unless job-sending is on (actions/job-new.ts:206) and the form is hidden unless the writes list names `job` (new-job-offer.ts:10), which production's does not | Decide: a Project job may exist in HeyTiff only (no ServiceM8 mirror, Open in ServiceM8 absent), or job-sending is required for projects and Settings says so. Write the migration rule for today's projects with no attached job. Blocks phase 4 and phase 5 |
| Clear a leftover booking; cancel a booking | `clearLeftoverBooking` (actions/booking-sm8.ts:788), offered from Home's list, the bell, the Schedule inspector and the job's Visits | J7 is titled "Book a visit; move or cancel it" but draws Book, When due and Move; Actions loses Book a day; nothing names cancel or clear | A Cancel on the visit row (rule 25 dialog) and on the Schedule block, and a To do row "Still booked, job complete in ServiceM8 › Clear"; add the path to J7 |
| Import a design file | Studio start screen, "Import design file" restores an exported .heytiff-design.json (studio.tsx:1031) | S-design draws Search, New design and the cards; L5 is New and Open | Draw Import beside New design, or decide the export and import both go and say so |
| The Library's reading controls | Retry, Resume, Read scanned pages, the month's page allowance, Fill these in (tiff/library.tsx:166) for `tiff_manage` | Never mentioned; S-library draws none of it | Add a document's state and these controls to S-library and L1 for `tiff_manage`, and say what starts an unread document |
| An invite's Copy link and Revoke | Copy link is kept on purpose because mail bounces (team/directory.tsx:256); Revoke withdraws a wrong invite | T1 keeps Invite and Resend only | Actions on an invited person: Resend, Copy the invite link, Revoke (red); draw the Invited state on S-person |
| ServiceM8 send switches, Sync now, Disconnect | Off/Paused/On, a switch per kind, quotes Off/Trial/On, Retry, Sync now, Reconnect, Disconnect (integrations/sm8-writes-card.tsx:81) | A4's new path keeps Connect and People; no board for the section | Draw Settings › ServiceM8 and Xero before phase 5's Settings change, with all of it |
| Quoting's component price picks | Maps each quote component to the price-book item and supplier that prices it, with Override, Use lowest and roll length (admin/quoting-screen.tsx:217) | A7 deletes it as a duplicate of the price book's Preferred, which is a different thing | Keep it under Settings › Quoting and prices ("What prices each part"), or say how the two merge |
| Letters' privacy | A letter is seen only by its writer, its signer and the owner (admin/letters/page.tsx:10); the area is admin and up | Letters join Documents, which everyone with jobs can search; no permission named | Say the Letters view and each row are held back on the server to writer, signer and owner, and Make a document › Letter shows to admin and up |
| Record work rights in a workspace with no checks yet | The old form is the only door until a check exists (profile/workrights-card.tsx:72) | Listed under "Nothing uses these: delete first" | Move it to the merge table and delete it in the same change that gives the check record its own door (E9) |
| On hold and Blocked on a project | Actions on the project page, with a two-field Block form and a banner (project-detail-screen.tsx:612) | The main tab puts them under Actions; rule 53 and S-actions list neither | Add both to rule 53 and S-actions above the red line, with the form and the banner |
| The Design page's equipment library | What's new, the lineup by brand (studio/library-modal.tsx:19) | No door on S-design; decision 8 asks about brands without a place to see them | A door beside New design, or decide it goes |
| HQ's door | The front door's "Staff HQ" link (page.tsx:52) is the only way in | `/` becomes Home; the door is never placed | A quiet Staff HQ row at the foot of the your-name menu for the allowlist; HQ's exit points at `/` |

**Becomes harder, or loses options**

| Ability | What goes | Fix |
| --- | --- | --- |
| Booking | The book-in panel books up to eight who/day/start/length rows at once, reads ServiceM8 first and shows who is on that day, and carries "Make it a Work Order / stays a Quote" (board/book-in-panel.tsx:29). J7 draws one booking of who, day, time | Draw the Visit form with several rows, the read-first facts and the work-order switch |
| Make it a work order on a ServiceM8-only quote | Today it needs only the mirror status (job-sheet.tsx:1274); J8's Mark accepted needs HeyTiff quote lines | Say the Quote tab offers Accepted on a job at Quote even with no lines, and name the permission |
| Project checklist sections | Named sections gate the stage stepper and print as the handover's checks (lib/workboard/stages.ts:89); the plan's checklist is grouped by visit | A Project job's checklist keeps named sections seeded from the template; moving the stage warns from the sections behind |
| Trips without ServiceM8 | A trip is a HeyTiff row with a day and no ServiceM8 (actions/workboard-projects.ts:776); the plan's visit "goes to ServiceM8" | The Visit form books in HeyTiff and shows on the Schedule whether or not ServiceM8 is connected; sends only when the bookings switch is on |
| Variations | Decline, reopen and who decided (project-money-cards.tsx:414) are gone from the quote variation | Add Decline (with undo) and who/when to the quote variation |
| Billing on a Project job | The typed total and the Paid toggle on hand-added claims (deposit, retention) | Keep a typed total where no accepted HeyTiff quote exists; hand claims can be marked paid, awaiting or removed |
| Defects end | Setting the date keeps one task pointed at the walk (workboard-projects.ts:287); the plan names only a date | Defects end raises one To do task that moves with the date |
| Tasks already made | Reassign, delete, move the date (home-tasks-face.tsx:65); only creating one is drawn | A To do row opens the task as a rule 51 form with Delete |
| Your own entries | Edit and delete your diary entries; hide a colleague's thread (home-diary-feed.tsx:53). A plain entry saved without Tiff is already private to its author (journal-query.ts:418), so its home is Conversations › Only me | Name Edit and Delete on an entry and Hide on a colleague's thread; give Only me its own Save |
| The calendar's layers | Year view, school holidays, renewals with their button, notice events (home-cal-page.tsx:107) | Say which layers Schedule's Month keeps and what Show: offers |
| Capacity | Hours a day per person and the four-week fullness (capacity-view.tsx:607) | Put Counts toward the schedule and Hours a day on the person's card; draw the Weeks view with a figure per day |
| Salaried timesheets | The one-day "ran long" unlock and the pays-at-rules/absorbed setting (my-timesheet.tsx:1194) | Write the salaried rule in E1 and add the setting to Pay and holidays |
| Approving one week; sending it back with a question | Per-week Approve and Send back (timepay.tsx:167); T6 draws Approve all | Add the per-row paths and the rule 36 question dialog |
| Cancelling an expense claim; removing and restoring a public holiday | Both exist today (my-expenses-face.tsx:141; holiday-section.tsx:23); neither is drawn | Add the paths to E5 and A9; draw Remove and Restore under Public holidays |
| Private notes | Edit, archive, put back, delete for good (my-notes-face.tsx:63); the plan's Only me is Type › Save | Draw one Only-me note with its menu; migrate the staff\_notes rows |
| A driver's vehicle | Fuel, Issues and Services faces, Update odometer, Correct/Delete on own entries (fleet/my-vehicle.tsx:76); the plan gives the driver one line on the card | Say what the card's vehicle group opens: the vehicle page read-only for its driver, with odometer and own-entry edits |
| Importing people | A reviewed import from ServiceM8 or Xero makes cards (integrations/people-import-card.tsx:19); the plan keeps Link only | Add Import beside Link on Settings › ServiceM8 and Xero › People |
| Deactivated people | The Archived view and Reactivate (team/directory.tsx:149); no view in the new Team list | A "Left" view (rule 29) with Reactivate under Actions |
| Field notes | Take it down is admin and up on purpose (actions/kb-review.ts:10); the plan keeps the owner-only Remove | Name Take it down beside Looks right, for admin and up |
| The Library | The tag filter and its shareable `?tag=` links (tiff/library.tsx:141); the ask page's Answer-from choice and one-document scope (tiff/assistant.tsx:68); the `toolbox` capability separate from `tiff` (lib/permissions.ts:17) | Draw a tag filter with its own address; give the box the document scope and the library-only choice (settled 17 October: the Build plan's Tiff: one engine); say which switch gates the Field tools shelf |
| Maintenance visits | Mark invoiced on a visit with no job (completed-tab.tsx:56); Skip this one (project-trip-sheet.tsx:794); the three gates and the bring list on a Project job's visit | Say what Invoice does on an unlinked visit; keep Skip; one visit sheet for every job with gates, bring list and carry-over |

**Home not named**

| Thing | The gap | Fix |
| --- | --- | --- |
| Contacts | J12 calls it a tab; rule 31's seven have none; JC-1 draws none | A Customer group on Overview with Edit (rule 51); rewrite J12 |
| Done and Didn't go ahead jobs | V3-jobs counts "142 open"; the Projects table sends finished projects to Jobs › Completed | Add a Done view (with Didn't go ahead) or say Search and Owed are the only ways |
| A maintenance visit and an agreement | No address, no board; Link a ServiceM8 job, notes and history unplaced; equipment register, packing list, category and tags of a hand-made agreement unplaced | Addresses under Jobs › Agreements; draw both (see the screens section) |
| ServiceM8 sync status | Synced N min ago, running, needs attention (sm8-chip.tsx:63); the toolbar goes | Settings › ServiceM8 and Xero shows it; a failed sync raises a To do row |
| To do's sources | Eleven urgent reasons in urgent-rules.ts and project-rules.ts; V3-home draws three rows | A table of To do's row kinds and the rule behind each, so phase 5 Home is done only when every reason has a row |
| The bell's 21 chip kinds | Several have no To do row named (ServiceM8 trouble, a task's Done that did not reach ServiceM8) | Walk chips.ts and give each kind its row, button and landing |
| The handover sheet | Made from Documents in one table; opened from the job's Documents tab in P9; a stored "Signed" status on S-documents that nothing makes | One home: generated by the Project job, listed in Documents; decide whether Signed exists |
| Reissue and delete a certificate; raise an issue and record it sorted on a SWMS | Both exist (job-documents-face.tsx:374; swms/sign-on.tsx:93); neither named | A document row's own Actions; add the sign-on paths to D2 |
| Settings | The expiry warning window; payment-term presets (three kinds); Reports' permission (owner / money access / financials); the per-person morning email vs today's company switch; account facts | Name each section; Reports shows to whoever holds the permission each report needs |
| Noticeboard events | Date, place, RSVP and comments (notices-board.tsx:158); events are also made from Schedule | Decide: one event record with an optional notice, or notice kinds stay |
| First-run | The company form is kept by A14 and deleted by the merge table; new staff are no longer asked for their details (lib/staff/onboarding-gate.ts:28) | A To do row "Finish your card" while onboarded\_at is null; decide /welcome |
| Several workspaces | Sign-in picks the oldest membership (lib/auth0.ts:145); the switcher is deleted; no row under your name | One company per person, said on /start, or a Switch workspace row shown to people with two |
| Search | Finds five kinds today (actions/palette.ts:52); "any record" names no kinds, no gates | List the kinds, the number for each, and which capability gates each |

**What to do about all of it.** The plan says phase 5 moves "every feature the Today tab lists", but the Today tab has no row ids and misses features the code has (Set aside, presence, account linking, the address proxy, the icons), and canvas page 9 misses rows the Today tab has (saved chats, Open in ServiceM8, sign out, hand over ownership). Generate one numbered checklist from the Today tab plus the rows above, keep it in the repo beside the rules file, and have each phase-5 change tick its rows in the same commit. Nothing else stops a feature being dropped mid-sweep.

## One clean sweep

The plan can be done in one sweep, but not in the order written. Four things break the app between phase 2 and phase 5 as the plan stands, and phase 1 as one step takes colour out of surfaces the plan never names.

**What breaks between phase 2 and phase 5**

- **The eight places have no routes.** Every page is under `src/app/dashboard`; `/jobs`, `/schedule`, `/documents` and `/conversations` exist only after phase 5. `navHref` throws on an unknown key (shell/nav.ts:188), and four server actions revalidate by key (`kb-tags.ts:55`, `my-notes.ts:55`, `calendar.ts:89`), the Library links by key (tiff/assistant.tsx:1533), Tiff's `open_screen` reads `ALL_SCREENS`, and `nav-destinations.test.ts` checks every key against the filesystem. Replacing the 11-item menu in phase 2 either throws inside saving a note, tagging a document and editing the calendar, or hides the old pages, which the ground rules forbid.
- **The bell is the only door to a reminder's Later and a task's Got it.** `myDueReminders`, `snoozeReminder`, `myNewAssignments` and `acknowledgeTask` have one caller, shell/bell.tsx. Decision 12 removes the bell in phase 2; To do is built in phase 5.
- **The dock cannot become tabs until a job is a page.** A job today is a card over the screen it opened on (records/record-host.tsx:48); its only address is a Workboard query (lib/shell/links.ts:15). Rule 11 says a tab is a page. Jobs is phase 5's third step.
- **Home at `/` collides with the sign-in door, the proxy and Auth0.** `/` is the front door (page.tsx:26); `proxy.ts:9` protects `/dashboard`, `/hq`, `/welcome`, `/start` by prefix and sends a session with no workspace to `/start` only from `/dashboard` and `/welcome` (`proxy.ts:25`); every sign-in lands on `/dashboard` (lib/auth0.ts:121); a callback that arrives without its cookie is sent to `/` on purpose because `/auth/login` would loop (auth0.ts:91); sign out returns to `/`; HQ's exit and the invite route point at `/dashboard`. None of this is in the plan. 135 test files assert `/dashboard` hrefs.

**What phase 1 breaks as one step**

- The studio reads `--teal` 117 times and `--teal-d` 62 (studio.css), and dresses `/live` and `/print/design`; HQ reads `--paper`, `--on-ink-q`, `--warn`, `--wordmark` and `--ring` for all its text, quiet tier, amber and focus (hq.css:19-23); the sign-in screen and the ten emails are a hand copy of the old tokens (lib/brand/auth0/palette.ts) that `palette.test.ts` checks name by name against `tokens.css` and `globals.css`; `frame-still.test.ts:90` requires the teal wordmark; `design-ratchets.test.ts:519` requires `--ground`, `--ok-t`, `--ok-tint`, `--ring-bad`, `--r-pill` to exist. "Done when the old tokens are gone" means re-pointing 337 colour literals in shell.css alone.
- The mark's colours are tokens phase 1 removes (`--mark-*`, tokens.css:34) while the mark is restyled in phase 2; the `Wordmark` component hard-codes #00A389 (logo.tsx:85), so callers outside the frame stay teal whatever happens to the tokens.

**The order that works**

| Step | What | Why here |
| --- | --- | --- |
| 0a | Tag `v1.0.0` on main (e13d7fb) and commit the canvas generator (see the backup section) | Before anything changes |
| 0b | Rules file and ratchets, as phase 0, with these corrections: the three tables the ratchet test parses by heading (`### The loops that stay`, `### The buttons that keep their glyph`, `### Named exemptions`, design-ratchets.test.ts:236) stay under those headings; drop 40 from the type set but not 20 (52 declarations use it; dropping it raises a baseline, which the file forbids); write each new counter's definition before adding it (two of the five have no computable count with the helpers that exist); skip `:root` in the Tailwind-hex ratchet (four of the 19 are on its list); retire the accent ratchet when the teal goes, or `--blue` can never reach 0; name the paper sheets and studio.css as excluded, or the new ratchets are born at the studio's numbers | Phase 0 as written fails on day one |
| 1 | Tokens, additive: the 19 values, the alphas, the speeds and the 40 radius land on `:root`; every old name becomes an alias of a new value; nothing is deleted yet. In the same change: the mark black and white (rules 8 and 9) with its tests, `logo.tsx` on one colour, the Auth0 value sheet and `palette.ts` with its test, the email envelope, the icon and OG files, HQ's own `--hq-*` aliases, the studio's own `--ds-*` block | The one change that touches every surface's colour, done once, and nothing left blank |
| 2 | The parts (phase 3 as written), plus the parts no rule draws yet: the date picker, the time wheel (drawn now), the chooser that replaces the 92 native selects, the scan step, the signature pad, the viewer, the box while it listens, the not-found and error pages, a tooltip rule | The frame is made of these; building it first means building them twice |
| 3 | The frame (phase 2), with: the layout moved to a route group so Home can be `/`; `proxy.ts` as an allowlist of public routes; the sign-in landing, the callback's no-cookie landing, sign out and the no-workspace rule re-pointed; the door at its own address; the old nav keys kept resolvable off the rail until their pages go; the bell and the dock kept until step 5 replaces them; pins, recents and open tabs given a store; the clock on the workspace's time zone, not Sydney's (lib/au-dates.ts:51) | "Every route sits in the new frame" becomes true, and nothing is hidden or thrown |
| 4 | Making (phase 4), done when New and the job's Add work from the frame and the old job card, with one form per kind; each place's own button is ticked when its place lands | As written, phase 4's done-when needs pages phase 5 builds |
| 5 | The screens, by dependency: Jobs and a job (split into the list and its views; the job page, its sections, Add and Actions; the project merge with its one-time data move; agreements and the quote), then Schedule, Team, Documents and Library and Design, Conversations, Home (the bell and the dock go here, with To do), your own time, Settings and Reports. Each change also moves `links.ts`, `ref.ts`, `SCREEN_ALIASES`, the Tiff address regex, HQ's `system-map.ts` paths (its test requires every path to exist), the place's rows in the ratchet's exemption tables, and deletes the old token names whose last use went | Home first means every door on Home leads to a page a later step deletes |
| 6 | The job's conversation, after step 4: this is router work. The router has lanes for notes and tasks only (note-brain.ts:248); visit, variation and cost each need a schema lane, a prompt rule (which changes the 777-token cached head), a shaper, an apply branch behind the same gates as the Add form, an Undo and tests. Decide the recording first: the schema stores the transcript and deliberately not the audio (docs/migrations/workboard\_notes.sql:18), and JC-2 shows a recording | The plan calls three new lanes "straight away" |
| 7 | The phone: the ink bar, the menu and the box come with the frame in step 3; each screen carries its phone layout when it lands in step 5, with a phone column on its board. Phase 7 then checks the four boards on a real phone and adds the manifest, icons and `theme-color` that "installable" needs and that do not exist | Today's 56 per-screen phone rules in shell.css are deleted by step 5; redoing sixty screens in phase 7 touches each twice |
| 8 | Outside the frame: the door and its states, the papers (SWMS, certificate, letter, handover, the live link's chrome), the mail, the mark's files; `welcome/details` off shell.css. Then HQ as its variant, last | No phase reaches these today, so the sweep would end with them in the old style |
| 9 | The model and P4, any time |  |

**What must change in one commit.** Routes with the proxy, the nav, the Tiff aliases, `links.ts`, `ref.ts`, the sign-in landing and the tests that assert them. Tokens with the ratchet's token list, frame-still, the Auth0 palette and its test. A deleted page with its menu row, tests, styles, its exemption rows in docs/design.md, its path in HQ's system map, and every redirect that targets it (`invite/accept/route.ts:242`, `start/page.tsx:31`, the two welcome gates). The project record with `/handover/[id]`, which reads it.

**Data the new frame needs that does not exist.** A per-person table for pins and recents (nothing persists them today; recents are five records in memory, records-context.ts:60); a store for open tabs (URL plus sessionStorage); a conversations table (Tiff's threads live in localStorage, tiff/assistant.tsx:115, and are lost at cutover unless exported); the job's colour snapped to the eight (the only colour ServiceM8 hands over is the category's, a near-white wash; snap by hue, not distance); To do's sources as one list; a decision on the recording.

**Tests.** About 15,750 tests; 32 read shell.css, 135 files assert `/dashboard` hrefs, 59 test files belong to the shell, records and Tiff modal families, six pin the dock, 37 the top bar. Each step above names the tests it rewrites. No test can see a native control, so the chooser, the time field and the tooltips need one new ratchet with today's counts (92 selects, 3 time inputs, 1 colour input, 157 title tooltips) as baselines.

**The control.** One numbered feature checklist in the repo, ticked per commit, is the only thing that makes "nothing dropped" checkable.

## Keeping the old shell as a backup

**What the shell is.** `src/app/dashboard/shell.css` (12,786 lines), `src/app/dashboard/layout.tsx`, the 18 files under `src/components/shell` (the frame, sidebar, top bar, nav, bell, clock, palette, tabs, skeletons), `src/components/records` and `record-modal` (the record host, windows, dock), `src/components/tiff/modal` and `notes` (the Tiff host and button), `src/app/tokens.css`, `globals.css`, and the tests that hold them: `frame-still.test.ts`, `design-ratchets.test.ts` with its 27 baselines, and 59 test files across those families. Beside the code: `docs/design.md` as it stands (1,315 lines; it becomes the decision log), and `_design/shell.html`, the Figma replica the shell was ported from, which is already in the repo.

**Where the restore point is.** Main as it was live before phase 0: e13d7fb (#1162, 15 October), tagged `v1.0.0`. A tag "before phase 2" would be the wrong point: phase 0 rewrites docs/design.md and the ratchets, and phase 1 removes tokens shell.css reads, so a pre-phase-2 checkout is the old frame wearing missing tokens, not the app as it stands. If main changes again before phase 0 starts, tag its last commit before phase 0 `v1.1.0` the same way.

**The options, judged**

| Option | Verdict |
| --- | --- |
| A git tag, `v1.0.0`, on main, pushed | Yes. One command restores the whole app, its tests, its docs and its baselines. No copy lives in the working tree, so principle 7 holds |
| A worktree of the tag beside the build, to look at the old app while building | Yes, when wanted. The repo already runs sibling checkouts as worktrees under `.claude/worktrees/` with a symlinked `node_modules` and its own dev port |
| A Vercel preview of a branch at the tag | No. DEPLOY.md:1021 records that preview URLs fail Auth0 sign-in unless each is added to Auth0. The worktree is cheaper |
| A screenshot archive | Reference, not a backup: it restores nothing, and the old app cannot run in this sandbox (no .env.local). If wanted for the decision log, shoot it on Isaac's machine from the worktree, and keep it outside `src` |
| Copying shell.css and the shell components into `docs/` or `_design/` | No. A copied `.css` escapes the ratchet (it scans `src/` only), but copied `.tsx` is type-checked by `tsc` and `next build`, and jest runs any `__tests__` folder; it would also break principle 7 |
| A flag that keeps the old shell switchable | No. The only flag convention is a public build-time variable, so both frames would ship in every build; shell.css would stay in the ratchets' reach, the accent ratchet could never reach 0, and "one way to each thing" would be false for the frame itself |

**The recommendation, with commands**

```
# A session's git access pushes only its own branch: GitHub refused the tag (403, 17 October).
# Make it on GitHub: Releases, Draft a new release, Choose a tag, type v1.0.0,
# Target main (or commit e13d7fb under Recent commits if main has moved), title "Version 1", Publish.
# Or from Isaac's own machine:
git tag -a v1.0.0 e13d7fb -m "HeyTiff v1: the app and its design before the v2 layout rebuild"
git push origin v1.0.0
# Before phase 0, check it is there (this prints one line):
git ls-remote --tags origin v1.0.0
```

Restore the code with `git checkout v1.0.0`, or `git clone --branch v1.0.0`. To fix v1 while v2 is being built, branch from the tag: `git switch -c v1 v1.0.0`. For the old app on screen while building:

```
git worktree add .claude/worktrees/v1 v1.0.0
cp .env.local .claude/worktrees/v1/
ln -s ../../../node_modules .claude/worktrees/v1/node_modules
(cd .claude/worktrees/v1 && NEXT_DIST_DIR=.next-v1.nosync next dev -p 3100)
```

The decision log then cites history by name (`git show v1.0.0:docs/design.md`) instead of copying it.

**Putting v1 back live.** Vercel keeps the production deployments it has built. Find the one built from e13d7fb under Deployments and use Instant Rollback: v1 is live again in seconds, with no rebuild. On the Hobby plan only the deployment just before the current one can be rolled back to; on Pro, any. The lasting way is a branch from the tag, deployed.

**The data rule that keeps v1 restorable.** Code rolls back; the database does not. Through v2, a migration only adds: new tables and new columns, nothing renamed, retyped or removed, so v1 still runs on v2's data. What v2 makes obsolete is removed later, in its own change, once v2 has settled. Take a database backup the day phase 3 first ships. DEPLOY.md already rolls features back this way.

**Version 2.** When the last phase is done and v2 is live, tag that commit `v2.0.0` the same way. package.json's version can follow (it says 0.1.0 today).

**The one thing at real risk of loss.** The canvas is produced by 29 Python modules and two Node scripts (6,509 lines) that exist only in this session's scratch space; the published canvas survives, but it cannot be edited or regenerated without them, and the plan's own index points at scratch paths. Done 17 October (commit 29afc1f on ccr-6324701b-7w9oog): they are in the repo under `_design/boards/` (the folder already holds reference material and is eslint-ignored), with a README saying `python3 gen.py` writes the boards and how `shot.js` renders a PNG, and the plan's text exports are under `docs/plans/layout-2026-10/`. The PNGs and the generated boards are left out; they regenerate. The handover for a local session is docs/plans/layout-2026-10/HANDOVER.md.

## Screens and overlays not yet drawn

Three groups. The first needs a board before its phase, because no rule describes it and a builder would have to invent it. The second crosses on the rules' parts with nothing more than a caption. The third is replaced by something the plan already names.

**Needs its own design first**

*Parts, for canvas page 1 (used everywhere, so draw them once):*

- **The date picker.** Every date in HeyTiff is picked, never typed (ui/date-field.tsx:9); 33 files use it. Rule 27 allows the ‹ › and rule 33 the field, but nothing draws the popover, the Monday-first grid, Today and Clear, a range (leave, shutdowns), or the holiday and leave warnings M3 promises.
- **The time field. Decided 17 October: every clock time is a wheel** (canvas page 1, "A time, on a wheel"). It is today's wheel (ui/time-wheel.tsx: hour, minutes in fives, am or pm), restyled to the rules. It goes in the timesheet, your normal week, the calendar's event form and a notice event's start (both today the browser's own `type="time"`), and the booking panel's time (today a 96-option select). Nothing types a clock time; rule 34 says so.
- **The chooser.** 92 native `<select>`s. The OS draws their open list, so no stylesheet reaches it; MN-spec draws the chooser for two list filters and never says it replaces every select, inside forms too.
- **The scan step.** Eleven doors share "photo of the paper, Tiff fills the fields, check, Save" (record-modal/scan-card.tsx:9) plus five drop zones; the rules have a form and fields but nothing for a dropped file, a Reading wait or the read-back.
- **The signature pad.** Drawn on a canvas in your card, the SWMS sign-on and the certificate's Sign step (swms/controls.tsx:76); no rule shows a pad, its Clear or Keep this signature; it is signed on a phone, so rule 48 applies.
- **The viewer.** One dark full-window viewer with five doors (photos, PDFs, the gallery, Search's photo hits, the quote paper) and a second copy for a notice's photo. It is ink where rule 36 dialogs are white; its star is #f5b400, outside the 19; PDFs open in an iframe where rule 51 says a document opens in its own tab.
- **The box while it listens.** A level meter, interim words, a clock, Stop and discard, and three refusals for a mic that is asking, blocked or missing (notes/dictation.tsx:144). Rule 8 gives the mark colour while listening; nothing draws the box.
- **The form.** NJ-1 to NJ-3 draw the menus, not the forms they open. One board (Task as the example, the record as a field per rule 51) and a table of every phase-4 form with its fields.
- **The mark's motion.** Rule 8 says the rings run through the eight while Tiff listens or works, but no page-1 board gives the cycle; the one board that explored it is on the Archive page and cycles seven hues at 4 s. Decide: the order, grey in or out, listening vs working, and whether the dot cloud takes the cycle or goes mono. Today the mark has no colour state at all (tiff-mark.tsx:91).
- **Not found, error, and the state outside the gate.** No `not-found.tsx`, `error.tsx` or `global-error.tsx` exists except the live link's; 15 pages call `notFound()` into Next's default. Decision 10 ("an old address lands on Home") and rule 42 have no page to live in, and a sign-in callback that fails answers a bare sentence with status 500 (lib/auth0.ts:116).
- **A tooltip rule.** 157 native `title=` tooltips carry the only word on icon-only buttons, people's full names, dates and reasons; the OS draws them and a phone never does.

*Records and pages, for pages 3 to 7:*

- **A job's other sections** (page 3): Photos with the grid by day and the viewer; Book a visit as the one form the Schedule, To do and Add all open (today a 706-line panel); Checklist, Documents with Send and company papers, Billing with claims, and Contacts can be captioned as rows and groups on JC-1.
- **A service agreement and a visit opened** (page 3): today a 640-line sheet and a 1,513-line sheet; the plan keeps both as records with no address and no board. Draw the agreement as a page with sections (Overview, Schedule, Equipment and packing list, Visits, History) and the visit over the job or at its own address, with gates, crew, the linked ServiceM8 job, notes, close-out and carry-over.
- **Schedule's Week, Month and Weeks, and Add an event** (page 4): V3-schedule draws Day. A capacity cell today is a gauge that fills from the bottom (capacity-view.tsx:57); rule 21 forbids fills, so the Weeks view needs a figure and a word per day. Also Schedule, Display (an office wall needs type above the 32 cap and no frame; a named exemption).
- **Settings' other sections** (page 7): Business (logo, the native colour swatch, trading details, the address lookup, licences and insurance, hand over), ServiceM8 and Xero (the writes switches, people review and link, sync status, disconnect), Quoting and prices with the price book's three faces (Items, Suppliers with invoices read by Tiff, Matching), the rate calculator (its help modal and settings slide-over are inline styles no sweep can restyle, rate-calculator/help-modal.tsx:3), Reports' counting settings, Emails and alerts, Sign-in and security.
- **Team › Vehicles and a vehicle** (page 6): the register (search, three sorts, four filters, Fleet value, Value with Tiff) and the card's eight screens (fleet/vehicle-modal/index.tsx:26): status, driver, odometer, renewals, services, history, money. Also Team › Notices with a post open and the Write a notice form (posts, polls, events, comments, reactions; 1,210 lines). Drawn 17 October on page 6: Team › Notices with an event open, and Write a notice.
- **Your card** (page 6): eleven flows start there, no board, no address, no phase; S-person-tech shows a tech only a person's Contact. Say that your card is the Team page of yourself, always full for its own person, and draw the Vehicle group, the Normal week and Leave rows.
- **Your own leave and expense claims** (page 6): S-leave and S-expenses are the manager's; draw Claim an expense once (photo first, Tiff reads it; own money or company card; fuel asks litres and km; a job picked).
- **The three record modals** (page 6): a staff licence, a company credential and a work-rights check share one undrawn screen: identity, the term in force, a history of terms, papers previewed inline, a scan step.
- **Documents** (page 5): the letter editor (a rich-text toolbar rule 27 forbids as icon-only; a paper in a tab), the certificate wizard (five steps, an upload, the pad), the SWMS sign-on page (Draw, Raise an issue, Sign others on), the Send form, the seven template editors behind S-templates (four are word forms; the certificate, SWMS and letterhead open on the paper with Approve).
- **Library** (page 5): the upload drawer (a queue with progress and a monthly allowance, not a rule 51 form); the tag filter; a tool (heat load as the example: the form, the result as one big figure, the fault finder's guided questions, the placement diagram); an answer with its page sources and a manual opened at its cited page.
- **The quote** (page 3 caption): options as soft tabs, kits, Compare as a dialog, versions and variations as papers.
- **Reports** (page 7): a line chart and a histogram outside rule 20; the Quotes view (when a quote counts as lost, the review with keep-as-tender and mark-lost in ServiceM8); Tax year with its export.
- **HQ** (its own page): the variant on the night ground. Needs a dark-ground reading of the 19 (the word values chosen for white fail 4.5:1 on #0e1114), the KPI tiles as a named exemption from one-32-per-screen, the system map's five kind colours from the eight, the value and tag editors as night dialogs, the delete-workspace typed confirm, its own top bar (HQ users may hold no workspace, so the ink sidebar's New, Search, Pinned and your name mean nothing there). The full inventory is on file.

*Outside the dashboard:*

- **The door**: the front door (page.tsx: gradient chevron, teal wordmark, ink button), /start's four states, /invite/error's four reasons, and whatever of /welcome survives (the plan keeps A14's two-step company setup and deletes the first-run forms at once). One "door" board on the white page with the mono mark: a rule 35 card, rule 22 button, rule 26 links.
- **The sign-in and sign-up screens** (Auth0's widget, dressed by a value sheet pushed from the repo) and its seven letters: a board of the widget to the rules, and a value sheet (see the brand section).
- **The mail**: all ten letters wear one envelope (email-shell.ts). One "letter" board.
- **The papers**: the SWMS, certificate, letter, handover sheet and live link share the studio's sheet stylesheet through DocPaper, which the ratchets skip as paper. The handover sheet is an inline stylesheet of Tailwind greys that reads the project record the plan deletes. One "papers" board, and a line in the rules saying the business's document colour and logo are the business's brand.
- **The live link's chrome** (not the sheet inside, which is the studio's): a blurred bar, three pills and a teal button, and the expired and not-found cards with "HeyTiff" in teal.

**Transitions on the rules' parts** (a caption on the nearest board is enough): Edit customer, New service agreement, New job, the claim and variation forms, the day dialogs (Place here, Move it here, as a rule 36 dialog that reports a refusal), Give it to, Set due date, the confirm dialogs (hand-over, disconnect, delete a note, deactivate), the invite form, the sign-in email change, the licence and credential add forms, the fuel, odometer and issue logs, the leave request and cancel, the expense claim (with the scan step above), the timesheet day editor (with the time field above), the normal week, can't-work days, the tag picker and tag manager, the Library's edit and remove, template word editors, the Xero organisation picker, the people link panel, the address field's suggestion list, the notice post form, the task row's menu, toasts. Three decisions ride with this list: a delete asks in a dialog everywhere and the inline ask-twice goes; every native select becomes the chooser in one sweep; tag and badge colours are picked from the eight. Four of them deserve the wider dialog because they are rows of fields: the customer's contacts, the book-in rows, New agreement and the vehicle form.

**Replaced by something the plan names**: the dock and set-aside cards (tabs, Pinned, Recents), the bell (To do), Action required and the Urgent tabs (To do), the command palette (Search), the Tiff modal and its nine doors (the box on Home, Search's last row, a job's conversation), the record windows (a job is a page; the visit and agreement sheets become pages too), the plastic ID, licence and credential cards (rows per rule 39), the time wheel (a typed time), the Library's ask page (the box), the first-run forms (Settings and your card), the Workboard's docked inspector (the Schedule block's facts), the projects pages (a Project job), the Noticeboard page (Team › Notices), Admin (Settings), My notes (Conversations › Only me).

## The brand everywhere

Rules 8, 9 and 15 change the mark, the wordmark and the teal. These are every surface that draws them today, what the rule does to each, and the decisions the plan has not made.

| Surface | Today | What changes |
| --- | --- | --- |
| The mark in the app | `tiff-mark.tsx:91-108` draws depth, face and rings from `--mark-teal`, `--mark-blue` and their steps (tokens.css:34); `working` only quickens the loops; the dot cloud behind the modal lerps the same gradient (ui/dot-field.tsx) | Ink on white, white on ink, `currentColor` at rest; the rings take the cycle while busy. Four tests pin today's colours |
| The sidebar's chevron and the skeletons | `sidebar.tsx:52` and `shell-skeletons.tsx` pass `gradient` to Chevron | One colour, no gradient |
| The wordmark | `--wordmark` token (#00E5C0), and `logo.tsx:85` hard-codes #00A389 for "Tiff", so every caller outside the frame stays teal whatever happens to the token; `frame-still.test.ts:90` requires the teal | One colour everywhere; the component and the test change together |
| The Tiff button and modal | The top-bar button (topbar.tsx:79) beside the bell; four sheet buttons; the modal is ink with a teal-blue outline | The top bar has no room for it under rule 2; the plan must say that Tiff from any screen is Search's last row and Home's box, and from a job its conversation. The modal goes with the box |
| The nav accents | 17 per-item accents in `nav.ts` (teal for Home, orange for Design, violet for Toolbox), painted by the palette on a wash | Delete the field; results by kind, mono icons |
| Library shelves, Toolbox tools, badges | Each tool page passes a hard-coded accent (#00E5C0, #FF3366, #8A2BE2); badges and the payroll card's split carry their own hues | Rows with no colour; badges as words |
| Stored badge colours | Credential and licence records store a chosen swatch (Teal #00A389, Blue #2E68FF, Violet #8A2BE2) and paint it on the ID card wall (credential-modal/identity-screen.tsx:49) | The swatches become the eight's word values, and one migration maps the stored values; no ratchet can see data |
| Icons and brand files | `src/app/icon.png` and `apple-icon.png` are the gradient chevron on an ink tile; `public/brand` holds the gradient chevron PNG and SVG, the lockup with the teal "Tiff" and the favicon; Auth0 and every email load them by absolute URL and cache them | New files under new names, with a re-push to Auth0 |
| The Open Graph cards | `lib/og/card.tsx:19` draws "Tiff" in the bright teal; the live link's card adds the business's band | Read the one-colour wordmark; keep law 30 as a rule rather than retiring it as done |
| The sign-in and sign-up screens | Auth0's widget, dressed by `lib/brand/auth0/theme.ts`: an ink primary button, teal focus and hover, the #F0F2F5 ground, a 24 corner, the gradient lockup; the page template adds two blurred teal and blue discs; `palette.test.ts` checks the hand copy against the tokens | A value sheet to the rules, pushed by `npm run auth0:brand`: primary button #2563EB with white, focus ring ink, white ground, corner 16, inputs 6, a mono lockup, no glows; `palette.ts` and its test re-pointed at the 19 in the same change as the tokens |
| The ten emails | One envelope (`email-shell.ts`): grey ground, gradient chevron PNG, "Tiff" in teal, weight 800 headings, an ink button. The file explains the PNG: Gmail on Android inverts the card and not images, so an ink mark vanished once | White ground, 16 corner, a blue button (a mid-tone survives inversion), the wordmark as one-colour live text, and a mark image that survives inversion. The morning digest also says "from the bell" and buttons to `/dashboard` |
| The live link's chrome | `live-sheet.css:16` restates `--teal` on its own root; a teal button, three pills, a blurred bar; the expired and not-found cards say HeyTiff in teal | The bar to rules 17, 22, 23 and 47; the cards as door cards; the local teal goes with phase 1 |
| HQ | "HQ" in `--wordmark` (hq.css:65); the system map paints a feature kind #00e5c0 in TSX (system-map.tsx:26) | One colour; the map's five kinds from the eight's bright values with a key |
| The customer's own brand | The business's logo, trading name and one seed colour, derived by `org/theme.ts` and drawn on letters, certificates, SWMS, the handover sheet and the live link's bar; the colour is picked with the OS colour dialog (`org/brand-color.tsx:94`) | Not HeyTiff's. The palette rule needs one sentence: a business's document colour, logo and letterhead are its own, never snapped to the eight and never on app chrome; the new outside-the-19 ratchet must skip the paper sheets |
| HeyTiff's own words on paper | "Prepared by HeyTiff" where a business has no brand (doc-paper.tsx:59); "Sent by HeyTiff" in mail; "{business} via HeyTiff" as the sender | Stay as plain ink text; say so |

**Where the teal hides beyond `--teal`.** `--wordmark`, `--teal-d`, `--blue` (#2E68FF, not the palette's #2563EB), `--violet`, the seven `--mark-*` values, `--day-leave`, globals.css's `@theme` brand family, Time and Pay's local remap of `--teal` to the day green, and the live sheet's own root. Phase 1 must name all of them, and the accent ratchet's regex must include `--wordmark` and `--mark-*` or "falls to 0 when the teal goes" cannot be checked.

**Decisions for Isaac**

1. The rings' cycle: the order (board E ran blue, purple, pink, red, orange, yellow, green), whether grey is in it, the period, and whether listening looks different from working.
2. Whether the mark turns at rest. Rule 8 says "turning slowly"; the scales say "nothing ambient" and the loops ratchet requires every infinite animation to be named with a reduced-motion stop.
3. The mark in mail: a mid-tone grey PNG that survives Gmail's inversion, or no image beside the word.
4. The Auth0 widget's hover colour (the rules give none), and whether the custom-domain page template is kept now that it would add only a white ground and a footer.
5. The business's colour field: the typed hex box with a swatch that shows (already in the file), or the OS picker as the one allowed native control.
6. The mark's name in Search's last row and on the phone's bar: the mark alone, or the mark and the word.

## Corrections to the plan

**Contradictions between the tabs, the rules and the canvas.** The plan's own precedence (the rules, then the canvas, then the main tab) decides most of these; where it does not, the recommendation says which should win.

| Where | The contradiction | Correction |
| --- | --- | --- |
| Rule 31, J12, JC-1 | A job has seven sections; J12 makes Contacts an eighth tab; no board draws it | Keep seven. A Customer group on Overview with Edit |
| Main tab "Typing a note yourself", J4, S-actions vs phase 6 and JC-0 | Save note exactly as typed with Also in ServiceM8 on one side; everything goes to Tiff on the other | State the end state once: the Overview is JC-1; a typed message is kept word for word; the box has a Keep as typed choice; each note carries its ServiceM8 state |
| S-project vs P5 | Dates and Linked jobs drawn in the Visits tab's aside; P5 puts Dates on Overview | The aside belongs to the job and stays across every tab, or move them to Overview and redraw |
| Rule 7, decision 9, A10, the code | Reports is in everyone's menu / for the owner / money access / financials | Reports shows to whoever holds the permission each report needs (Analytics: workboard\_money; Tax year: financials). Fix rule 7, decision 9 and the Your name bullet |
| Main tab, build plan, Y1, S-convos | Private notes under your name / in Conversations › Only me; the Only me view has no Save, no Edit, no Archive | Conversations › Only me, with its own box (Note to self, Save) and Edit and Archive on a note |
| Decision 5, S-project, the Add table, P4 and J20 | One kind of variation on the quote; S-project lists a variation as a linked ServiceM8 job; Add and the Quote tab each make one | A variation is a quote variation, from Add or the Quote tab's Update quote (the same form); once accepted it is sent to ServiceM8 as its own job and appears under Linked jobs |
| Build plan, S-person, E6 | "Your vehicle on your card" is one line; today's My vehicle has Fuel, Issues and Services a tech opens with no capability | Say what the group holds and that it opens the vehicle's page read-only for its driver |
| E3, E6 to E11, Y2 vs the canvas and phases | Eleven flows start at Your card; no board, no address, no phase | Your card is /team/\<you>, always full for its own person; draw its rows |
| The project table, decision 11, J23, M2, S1 vs V3-jobs and V3-schedule | Jobs › Completed, Starred photos, Agreements › Ended and Schedule › Weeks are routed to and never drawn; V3-jobs counts "142 open" | Add Done and Starred photos views, an Ended view inside Agreements, a Weeks view on Schedule |
| Addresses, V3-home vs page.tsx and proxy.ts | Home at `/` where the sign-in door lives | Write it down: `/` is the door signed out and Home signed in, with the proxy changed; or Home stays at /dashboard |
| The Add table | "Cost for a job" is its own row beside the expense row that already names Add › Cost; today a cost on a job is an expense with the job picked | Delete the row; say Add › Cost opens the expense form with the job filled in |
| The Add table, P9, S-documents | The handover sheet is made from Documents, opened from the job, and listed with a Signed status nothing makes | Generated by the Project job, listed in Documents; decide Signed |
| Rule 27 vs every board | The sidebar's collapse icon and the your-name chevron are icon-only | Add both to rule 27, or drop them; say whether the sidebar folds |
| V3-settings vs A1, A6, A9 | "Changes save as you go" with no Edit; the flows count Edit and Save presses | Switches and menus save themselves; typed fields save per section; recount |
| S-you vs rule 7 | Help and Sign out drawn; neither listed; nothing exists behind Help | Add Sign out to rule 7; drop Help or give it a destination |
| Main tab's counts | 55/40/13 and 541 to 442 | The flows now give 54 fewer, 40 same, 14 more; 541 to 450 |
| Still open, type 20 | Named for a dialog title and a figure; JC-3 also uses it for a screen title on the phone | Add the third use; give rule 48 a phone title size |
| HQ (now fixed in both tabs) | "Cannot be touched" and "stays exactly as it is" | Restyled as a variant, last |

**Rows in the plan that are wrong**

- Delete-first row 1 (quote rooms, 950 lines): the route and its reader went in #1124; `src/lib/quotes/brief-rooms.ts` stays because the lines builder reads it.
- The Today tab calls the quotes Trial mode retired code; the kind-wide trial run was retired, the quotes' own Trial is live (sm8-quote-trial.ts:4) and belongs on the send switches.
- The ServiceM8 test route row must name the route (`api/integrations/servicem8/attachment-probe/route.ts`), not its lib twin, which is live.
- "A filter on the maintenance list" is the Agreements ledger's old search (agreements-tab.tsx:26); it becomes a filter on Jobs › Agreements by client, service, site or tag.
- The fake-success bug belongs to phase 5's Schedule step (Not on a day yet and the visit form's day), not "when their place is rebuilt"; the `--ok` swatch dies with calendar-tab.tsx and should not be fixed with a token phase 1 retires.
- Decision 14 is in the layout after all: `NEXT_PUBLIC_VOICE_REALTIME` decides whether words appear while Tiff listens (notes/dictation.tsx:52), and three in-repo sources disagree on its production value. It blocks phase 2's box and phase 6's bar.
- The tools folder for probes and evals has no phase and no path; both npm scripts hard-code the jest paths that phase 8 relies on.
- The model section: the mention reader runs at effort medium, not low (mention-brain.ts:70); the Sonnet cache price is contested by two files in the repo, so check the pricing page before changing usage.ts.
- "Off means gone from the menu" (principle 8): no per-business part switch exists, nothing in the plan builds one, and in the new map no part is a menu item (Service agreements are a view, a button, three To do sources, Schedule blocks and a Search kind). Recommend dropping the rule and letting rule 40 carry an empty view, since nothing-dropped and Settings-holds-settings both argue against a new setting.
- Rule 18: no job carries its own colour; the only colour ServiceM8 hands over is the category's, a near-white wash (sm8-sync-plan.ts:222). Rewrite as "its category's colour, snapped by hue; no hue means grey"; red follows the Unsuccessful status, never the category.
- Phase 4's done-when needs pages phase 5 builds; phase 2's done-when cannot cover routes outside the frame.

**Subjects the plan never mentions** (each with the step it belongs to in the order above)

- The 14 capabilities and roles against the eight places, each view and each your-name row; a tech's view of Jobs, Schedule and Documents (step 3).
- The keyboard model: Escape closes the front overlay only, focus in on open and back on close, ⌘-click and middle-click open a browser tab, j/k (step 2).
- Contrast on the sidebar: every word value fails 4.5:1 on white-at-12%-on-ink; red, purple, pink and the quiet grey fail on plain ink. The palette needs an on-ink column, and rule 17 should say a dot always sits beside a word (step 1).
- Reduced motion: the mark's idle turn is a new infinite loop; the loops ratchet requires it named with a stop (step 0b).
- The clock's time zone: `au-dates.ts:51` anchors to Sydney; a Brisbane or Perth business sees the wrong hour on every page once rule 2 promotes it (step 3).
- Pinned, Recents and open tabs: where kept, how many, whether they survive a reload (step 3). Tiff's threads are in localStorage and need a conversations table (step 5).
- Presence and live changes on a job page and its tab (step 5).
- Search's kinds and gates; today it finds five kinds (step 5).
- The browser's own chrome: every tab reads "HeyTiff" (one root title); no `theme-color` or `viewport` export for the ink bar; no manifest, icons or start\_url for "installable" (steps 3 and 7).
- The language policy: reply in kind, record in English (lib/lang/policy.ts) must carry into the conversation (step 6).
- Native controls that no stylesheet reaches: 92 selects, 3 time inputs, 1 colour input, 157 title tooltips; one new ratchet with today's counts (step 0b).
- The morning email's content and chrome (reminder-digest.ts) and its footnotes that point at the bell and Organisation (steps 1 and 5).
- The dead-code deletions have no phase; make them one change between steps 0 and 3, naming each file.
- `welcome/details` imports all of shell.css for one address box (step 8).

## Every page the app can render

64 pages, 3 layouts, the routes that hand a person a document, and 10 emails. "Crosses as": board (a board draws it), parts (the rules' parts carry it with a caption), board needed (see the screens section), goes (the plan replaces it; what takes over), stays (by decision).

**Signed out, onboarding and auth**

| Page | What | Crosses as |
| --- | --- | --- |
| `/` | The front door: Create account, Sign in, Staff HQ | board needed (the door); its address collides with Home |
| `/auth/login`, `/auth/logout`, `/auth/callback` and Auth0's hosted sign-in, sign-up, password and verify screens | The SDK's routes; the widget dressed from `lib/brand/auth0` | board needed (a value sheet and a push); the callback's failure page is a bare sentence |
| `/start` | Signed in with no workspace: accept the waiting invite or create a company (four states) | board needed (the door card) |
| `/welcome` | The owner's first-run company setup | goes (Settings › Business) or stays as the one first-run screen: decide |
| `/welcome/details` | New staff's details; imports all of shell.css | goes (your card, with a To do row "Finish your card") |
| `/invite/accept`, `/invite/error` | Accepting an invite (renders nothing); why a link failed (four reasons) | parts (the door card); its `/dashboard` targets move |
| `/link-account` | Auth0 account linking; a plain 400 if opened by hand | stays |
| `/opengraph-image`, `/icon`, `/apple-icon`, `public/brand/*` | The link preview, the icons, the brand files | regenerated from the new mark |

**Signed in: the frame and Home**

| Page | What | Crosses as |
| --- | --- | --- |
| The dashboard frame | Sidebar, top bar with clock, bell, Tiff button and your-name menu, ⌘K palette, record host and dock, toasts, loading skeleton | board (V3-home, S-you, S-search, S-dialog, V3-states); the bell and dock go with To do and the job page |
| `/dashboard` | Home: Diary, Urgent, Needs attention, Noticeboard and Tasks faces, the Calendar, the box | board (V3-home); the Calendar's layers need a decision |
| `/dashboard/action-required` | The chips board | goes (To do) |
| `/dashboard/notices` | Posts, polls, events, comments, reactions | goes (Team › Notices, drawn on page 6) |
| `/dashboard/tiff` | The Library's ask page | goes (the box and Search's last row; sources need a board) |
| `/dashboard/my-notes` | Private notes | goes (Conversations › Only me, caption needed) |

**Jobs, projects, quotes, schedule**

| Page | What | Crosses as |
| --- | --- | --- |
| `/dashboard/workboard` | All jobs (6 tabs), Projects (4), Maintenance (5), Capacity, Gallery, Display mode, the job card with its faces and every sheet | board (V3-jobs, JC-1, S-quote, S-project, V3-schedule) for part of it; boards needed for Photos and the viewer, Book a visit, the agreement, a visit opened, Schedule's Week, Month, Weeks and Display, Starred photos, Done |
| `/dashboard/workboard/projects`, `/projects/[id]` | The project list and page | goes (a Project job; the data move is unplanned) |
| `/dashboard/workboard/quotes/[id]` | The quote builder | board (S-quote), with a caption for options, kits, Compare, versions |

**Documents, Library, Design**

| Page | What | Crosses as |
| --- | --- | --- |
| `/dashboard/admin/templates`, `/templates/[key]` | The seven templates and their editors | board (S-templates) for the list; the editors need captions and the paper ones a board |
| `/dashboard/admin/letters`, `/letters/[id]` | Letters and the editor on letterhead | goes (Documents); the editor needs a board |
| `/dashboard/swms/[versionId]` | Sign on to a SWMS | board needed |
| `/dashboard/certificates/template`, `/swms/template` | Redirects | goes |
| `/dashboard/tiff/library` | All documents, upload, tags, search | board (S-library); the upload drawer, tag filter and reading controls need captions or a board |
| `/dashboard/toolbox` and its four tools | Heat load, running pressures, fault finder, outdoor unit | board (S-library's shelf); one tool board needed |
| `/dashboard/studio` | The Design studio | stays inside (by decision); its doors are on S-design |

**Team, time, vehicles, you**

| Page | What | Crosses as |
| --- | --- | --- |
| `/dashboard/team`, `/team/[staff]` | The directory, invites, a person's card | board (S-person, S-person-tech); invite actions and the Left view need captions |
| `/dashboard/timepay`, `/leave`, `/expenses` | The team's timesheets, leave, expenses, the pay settings | board (V3-team, S-leave, S-expenses, V3-settings) |
| `/dashboard/assets` | The vehicle register and the vehicle card's eight screens | board needed (Team › Vehicles and a vehicle) |
| `/dashboard/profile` | Your card: details, licences, work rights, signature, pay, vehicle, sign-in email, photo | board needed (Your card) |
| `/dashboard/my-timesheet` | Your timesheet | board (S-timesheet, S-phone-timesheet) |
| `/dashboard/my-leave`, `/my-expenses` | Your leave and claims | caption on S-leave and S-expenses; Claim an expense needs a board |
| `/dashboard/my-vehicle` | Your vehicle: fuel, issues, services | goes (your card's vehicle group; the driver's view needs a decision) |

**Settings and reports**

| Page | What | Crosses as |
| --- | --- | --- |
| `/dashboard/admin` | The index with seven "coming" rows | goes (Settings) |
| `/dashboard/admin/organization` | Trading details, contact, licences and insurance, payments, expiry warnings, logo and colour, hand over | board needed (Settings › Business, Licences and insurance) |
| `/dashboard/admin/integrations`, `/servicem8`, `/xero` | Connect, send switches, writes, people, sync | board needed (Settings › ServiceM8 and Xero) |
| `/dashboard/admin/quoting`, `/price-book`, `/rate-calculator` | Rates and markups, the price book's three faces, the calculator | board needed (Settings › Quoting and prices) |
| `/dashboard/admin/analytics` | How jobs are counted | parts (Settings › Reports) |
| `/dashboard/analytics`, `/admin/tax` | Win rate, prices, to decide; a financial year and its export | board (V3-analytics) for the overview; Quotes and Tax year views need a board |
| `/dashboard/admin/knowledge` | Field notes to review | goes (To do and the Field notes shelf) |

**Public papers and print**

| Page | What | Crosses as |
| --- | --- | --- |
| `/swms/[versionId]`, `/certificates/[versionId]` | The SWMS and certificate as paper, with Print | board needed (the papers) |
| `/handover/[id]` | The project handover sheet; inline Tailwind greys; reads the project record; shows money to everyone | board needed; re-pointed at the Project job in the same change; money held back |
| `/live/[token]` and its not-found | The customer's live design sheet (the studio's) with HeyTiff's bar and cards around it | the sheet stays; the chrome needs a board |
| `/print/certificate`, `/print/letter`, `/print/design` | Headless Chrome targets for the PDFs | parts (the papers board); the design print stays |

**HQ** (six pages: overview, an org, data, a brand's catalogue, changes, the system map): board needed, the variant on its own page, built last.

**Routes that hand a person a document**: the letter PDF, the certificate issue, the design PDF and design-to-job (studio), the tax CSV, the ServiceM8 and Xero connect and callback hops (their landing moves to Settings), the invite and link-account turnarounds, the OG images, the morning-email cron.

**Emails** (all through `email-shell.ts`): the invitation, the documents letter, the morning digest, and Auth0's seven (verify, verify by code, reset, reset by code, welcome, blocked account, stolen credentials). One "letter" board carries all ten.

**Pages that do not exist and the plan needs**: `not-found.tsx`, `error.tsx` and `global-error.tsx` (15 pages call `notFound()` into Next's default); a manifest for "installable"; a public landing for a failed sign-in callback.
