# HeyTiff: every feature, one way in

Oct 12, 2026 · @Isaac

HeyTiff goes from 11 menu items, 66 pages and about 150 things that live in two or more places to 8 places with one path to each, and about 20,000 lines of code come out. Nothing gets built until the decisions at the end are settled.

**To build it:** the Build plan tab gives the order of work, where everything lives and what is still open. The Design rules tab holds all 54 design rules, the palette and the scales. A new session starts with those two.

**Before building, read the Review tab.** It checked the plan against the code on 15 October: the abilities the plan would drop, the order the phases must run in, the backup, the screens still to draw, where the brand appears, and the corrections to make to these tabs. Its "Corrections to the plan" section lists what to change here before the build starts; the decisions in it are Isaac's to make.

## The rules

Every part of HeyTiff gets one home and one way in. Anything that doesn't fit the map is deleted, not hidden.

1. **One home.** Each feature lives in exactly one place. Anywhere else may show a count or a link to it, never a second copy you can work in.
2. **One path, the shortest.** Each home is reached by one route from the menu, in as few clicks as possible. Every action below is counted in clicks, today and proposed. Search and Tiff can take you there, but they land on that same home, never on their own version of it.
3. **By hand always works.** Anything Tiff can do, you can also do yourself where it lives: open the job card and type a note, fill in a timesheet, edit a quote line. Tiff is a faster way in, never the only one.
4. **Tiff reads, the rules route.** Tiff works out what you meant: a brief, a site note, a task, a question, which job, now or later. Fixed rules decide where each kind of thing goes and what needs your tap. Tiff can't invent a new place, make a job or send anything without you.
5. **One of each engine.** One box to talk to Tiff, one task list, one calendar, one way to make each kind of document.
6. **New starts work; the record keeps the rest.** One New button at the top of the menu makes a job, a quote or a task, the same on every page, and fills nothing in. What belongs to a job comes from the job's Add (visit, task, quote or variation, cost, SWMS, certificate) or its conversation; everything else from its place's own button. What's already made (notes, quote lines, photos, visits, the checklist, billing, licences, a timesheet day) is changed where it lives, never through a second form.
7. **Nothing kept just in case.** When something is replaced, the old page, its redirect, its tests and its styles go in the same change. No "coming soon" rows, no hidden pages.
8. **Off means gone from the menu.** A business that doesn't use a part (Service agreements, say) has it switched off in Settings, so it disappears from the menu rather than sitting there empty.
9. **Count it.** Pages, menu items, ways in and lines of code are counted before and after, so we can see what the strip-back actually removed.

## Today, in numbers

HeyTiff is about 306,000 lines of code, 28,700 lines of styles and 234,700 lines of tests, spread over 66 pages and 11 menu items. Most of it does real work. The trouble is that a lot of it does the same work in two or more places: the audit found about 150 of those. Every feature, with every way in today, is in Today: every feature.

| Area | Code (lines) | Tests (lines) | Same thing in 2+ places | Never used |
| --- | --- | --- | --- | --- |
| Home and the menu | 41,000 | 29,000 | 12 | Org switcher, an old renderer, 114 unused styles |
| Workboard | 51,700 | 32,100 | 23 | 15 helpers, 1 API route |
| Projects, quotes and reports | 35,500 | 15,500 | 21 | About 2,200 lines of whole files |
| Library, Toolbox and Design | 84,000 | 52,900 | 28 | A hidden page, test tools, 8 placeholders |
| People, time and vehicles | 46,500 | 30,300 | 25 | 3 placeholders, an old form |
| Admin, settings and documents | 39,500 | 22,900 | 22 | 7 "coming" rows, 2 redirect pages |
| Outside the app and behind the scenes | 74,000 | not counted | 18 | 2 routes, about 1,900 lines of test tools |

Areas share some code, so the rows add up to more than the total.

**The patterns behind most of the doubling:**

- **Me and the team.** Timesheets, leave, expenses, vehicles and your own card each have two screens: one for you, one for managers.
- **Two of the same.** Two quote builders, two "ask Tiff" engines, two copies of the job card, two project views, two visit sheets, two sets of vehicle forms.
- **Six of the same.** Alerts for you show in 6 places, a task is marked done in 6, there are 6 calendars, and the ServiceM8 sync starts 6 ways.
- **Settings set twice.** Charge-out rate, hours in a day, state, super, payment terms and starter checklists are each set in 2 or 3 places.
- **Doors that land wrong.** The same alert opens different tabs from the bell and from Home, and some links show to people the page then turns away.
- **Things you can't reach.** Checklist and Quote on work orders, archived projects, the Design data page, and the projects list for staff.

## The new map

Eleven menu items, three Workboard sides, 15 tabs and a scatter of hidden pages become eight places. Everything a person does lives in exactly one of them.

*(In the plan doc this is a picture of the new menu: New, Search, the eight places and your name. Canvas page 2 draws it.)*

Home is the only place you need for a normal day: say it to the box, check today, clear To do. Every other place is where a kind of thing lives, and the box can take you to any of them.

- **Home:** the date and time across the top, the box (talk, type or snap a photo) with Tiff's mark above it, Today, and To do. To do is the one task list and the one alert list, and the one place anything addressed to you lands: a note that names you, a task someone gives you, an @mention in a notice comment. The bell goes; its count sits on Home in the menu.
- **Conversations:** every note and question you gave Tiff and what it became, with Undo. There's no New conversation button: the box always starts a new one, and you carry one on by replying under it. Anything addressed to you lands in To do, not here; Conversations has no Mentions view.
- **Jobs:** one list of every job, quote and service agreement, with views for To book, Quotes, To invoice, Owed, Projects and Agreements. A project is a job with the Project type: its progress line runs through the project stages, and the other ServiceM8 jobs it spans are linked under it. One job page, with every section always reachable. Jobs start from the menu's New button; agreements from the Agreements view, by hand or from a ServiceM8 job.
- **Schedule:** one calendar. Day, week and month, with bookings, visits, trips, leave, public holidays and company events, and the unplaced visits ready to drop on a day.
- **Documents:** every SWMS, certificate, quote, handover sheet, letter and design PDF, searchable across all jobs for the first time, and the templates they're made from. A job's own Documents tab lists what's on that job, with Send; nothing is created there.
- **Library:** company information only: manuals, SOPs, field notes, and the four field tools. Asking happens in the box, which now shows its sources.
- **Design:** the design studio, one of the main parts of HeyTiff, in its own place.
- **Team:** people and their cards, invites and access, the company's notices (everyone sees the notices and each person's name, role, mobile and email; the rest follows permission), plus approving timesheets, leave and expenses, and the vehicles.
- **Your name:** your own card, timesheet, leave, expenses, vehicle and private notes, and Settings: the one place for every setting, your own and the company's (business, ServiceM8 and Xero, quoting and prices, pay and holidays, how reports count). For the owner, Reports.

Every task, its one path and its clicks are in New map: every task. Of 88 tasks, 29 take fewer clicks, 48 the same, 9 one more, and 2 are new.

That tab was the first pass. The committed version is on the design canvas, [Workflows: today and new](https://claude.ai/artifact/XF4jr8qxfbr7nR8E59q4xT): 108 tasks traced press by press through today's code, each with its new route and the first press marked, and the new screens on the page beside them. 55 take fewer steps, 40 the same and 13 more, mostly settings now behind your name; 541 steps become 442, and 283 other ways in become one home each. Where the tab and the boards differ, the boards win.

### Projects are jobs

A project is now a job with the Project type, because the job card already tracks what a project needs. The project record and its page, board, calendar and trip sheet go; every part has a place on the job. Service agreements stay their own record. The projects already in HeyTiff move onto their main job once.

| On the project today | On a Project job |
| --- | --- |
| Stage stepper, Quote to Complete, with checklist warnings | The progress line, with the project stages: Approved, Pre-install, Rough-in, Fit-off, Commission, Handover |
| Block, hold, done, archive | Actions: On hold or Blocked, on any job. Done is the job completing; nothing to archive |
| Trips to site: day, crew, gear, access, close-out | Visits: day, crew, tasks, check in and out, close-out |
| Job total, claims | Billing: the accepted quote plus approved variations; claims are its payment stages, matched to ServiceM8 invoices |
| Variations | Quote: Update quote, Start variation |
| Promised finish, defects end, milestones, hours allowed | Overview: Dates, shown on the Schedule; hours used come from check-ins |
| Jobs on this project: quote, install, variation, service | Linked jobs, under the main job |
| Design link | Designs made for the job, from Design with the job picked, belong to it |
| Equipment on site | Checklist units with their plate photos; they carry to the service agreement |
| Site journal, commissioning entries | The note box; commissioning is a kind of note |
| Checklist and its sections | Checklist |
| Scope: in the price, not in the price | The quote's Included and Not included |
| Handover sheet | Documents: Handover sheet, money only for people with money access |
| Pipeline by stage, Urgent, Completed, Calendar | Jobs › Projects grouped by stage, To do, Jobs › Completed, Schedule |
| Set up the agreement at Handover | To do raises it and opens the agreement form, with the job filled in |

Open question: do your projects usually run on one ServiceM8 job, or several? If several, the main job carries the project and the rest are linked under it.

## How it works, end to end

### Saying a brief on site

1. Tap the mic on Home and talk: "Just been to Riverview, need to install a split system…"
2. Send. Tiff reads it as a job brief and shows the matching ServiceM8 jobs, plus "New job" filled in from your words.
3. Tap the job. You land on its quote at the Brief step with your words in it, and the quote builder drafts lines from them.
4. Said "no time to quote it now, save it as the brief"? Tiff saves it and stops. The job shows in To do as "Quote to write" until someone does it.

By hand: Jobs › the job › Quote › Brief. Today there's nowhere for a brief to go: Tiff can only ask "which job?" from agreements and projects, and nothing reaches the quote.

### Taking photos on site

1. Snap one or more photos in the box (a camera button beside the mic) and say what they are.
2. Tiff asks which job, with the same picker, and puts them on that job's Photos.
3. Tiff reads what's useful. A rating plate fills in the unit's model and serial; a gauge photo becomes readings.
4. A receipt goes to your expenses and a fuel docket to your vehicle, wherever you snapped it. You confirm with one tap.

By hand: the job › Photos › Add. Today a site photo can land in three places, and photos taken in HeyTiff only reach ServiceM8 if a manager sends them.

### Typing a note yourself

1. Jobs › the job. Its notes show as it opens.
2. Type in the note box and press Save. It stays a plain note, exactly as typed, unless you press "Sort it out" to let Tiff file it.

## What gets deleted

About 20,000 lines of code go, roughly 7% of the app, and about as many lines of tests with them. About 4,500 lines are things nothing uses; about 16,000 do a job something else already does. The rest of the code does real work, and no feature is being dropped.

### Nothing uses these: delete first

| What | Lines | Why |
| --- | --- | --- |
| The quote-rooms route and the code only it uses | 950 | Nothing calls it. The route went on main (#1124); its 390-line reader is still there |
| Four old quote templates | 610 | Done: gone on main (#1126) |
| An extra read-only list of the equipment data, inside Design, that nothing links to. Not HQ: HQ's data editor stays. Done: removed 12 October, at your say-so | 720 | No way in |
| A ServiceM8 test route | 230 | Its own notes say "meant to be deleted" |
| The org switcher and an old tab handler (the old page renderer is already gone on main) | 85 | Never shown |
| "Coming" rows and placeholders: Admin's 7, Equipment & tools, Pay run export, Design's 8 | 200 | They promise things that don't exist |
| The old work rights form | 280 | Locked once a newer check exists |
| Two redirect pages, a projections file, about 200 unused functions | 900 | Nothing calls them |
| Unused styles in the main stylesheet | 500 | 114 style names no code uses |

Test tools that live inside the app (the voice comparison, Tiff's probes and evals, the quote bench: 2,500 lines) move to a separate tools folder rather than being deleted. The evals are what you'd run before switching Tiff to a cheaper model.

### These repeat something else: merge, then delete

| What goes | Merged into | Lines, about |
| --- | --- | --- |
| The bell, Home's Tasks tab, Action required | To do | 1,500 |
| The Library's own ask page and engine | The box, which gains the Library's page sources | 3,400 |
| One of the two quote builders (under way on main: the old one is being retired, #1123 to #1127) | The one you keep | 3,500 |
| Home's copy of the job card | The job page | 170 |
| The project record: its page, card, list page, board, calendar and trip sheet | The job page, as a Project job | Most of 9,000 |
| The trip sheet, and the project copies of the day window, Urgent and Completed tabs | The visit sheet and Schedule | 1,700 |
| Home's Calendar, Capacity, the Maintenance and Projects calendars | Schedule (net of what Schedule gains) | 2,500 |
| The old set of vehicle forms | The vehicle card's forms | 970 |
| The Noticeboard page | Team › Notices | 800 |
| The first-run company and staff forms | The Settings and Your card forms | 700 |
| Three copies of the PDF signing code, three print buttons, two tab strips | One of each | 250 |

### Not touched

No feature is dropped. The cuts above come only from code nothing uses and from things done twice.

- **HQ**, HeyTiff's own console, keeps every feature and is restyled last, as a variant of the new rules that keeps its night ground and its KPI tiles (decided 15 October).
- **Design** is one of the main parts of HeyTiff and gets its own place in the menu.
- **Everything else** keeps working in its new home: the field tools, Rate Calculator, Analytics, Letters and valuing vehicles.

## Decisions for you

Nothing gets built until these are settled. Each has my recommendation; pick Agree, Change it or Talk it through, and comment on any row.

| # | Decision | My recommendation | Your call |
| --- | --- | --- | --- |
| 1 | What to call the place with manuals, field notes and the four tools | Keep "Library", with the tools as one shelf in it. The other options: "Toolbox" for all of it, or a separate menu item just for the tools |  |
| 2 | Which quote builder stays | Settled in the code: the old builder is being retired, and the lines builder with Tiff is on for every business (#1123 to #1127) |  |
| 3 | One engine for asking Tiff | Settled 17 October: one engine, wherever you ask. Tiff reads everything the person may see (ServiceM8 jobs and what went in them, quotes, the data packs, the Library down to the page, Schedule, Team by permission), answers as an HVAC assistant from general knowledge where the records stop, and labels where each part came from. Build plan, Tiff: one engine |  |
| 4 | The Noticeboard | Settled: notices live in Team, made with its Write a notice. Everyone can open Team: each person's name, role, mobile and email, and Notices. The full record, timesheets, leave, expenses and vehicles stay behind permission, held back on the server so the rest never reaches the browser. A new notice shows in To do until read. Polls and reactions stay, since nothing is dropped |  |
| 5 | Variations | One kind, on the quote. A project's variations are its job's quote variations |  |
| 6 | Photos taken in HeyTiff | Send them to the ServiceM8 job automatically, so both apps show one set |  |
| 7 | Reading photos: straight away or overnight | Straight away when someone's waiting (plates, Tiff, receipts). Overnight in a batch, at half price, for photo search. Test the newer, cheaper Haiku before switching |  |
| 8 | Design | Settled: Design stays, one of the main parts. Still open: are more brands coming? Only Mitsubishi Electric can be designed with today |  |
| 9 | Settings as the one place for every setting | Settled: Settings holds your own settings and every company setting, including how reports count. Templates live in Documents, beside what they make. Reports sit under your name for the owner |  |
| 10 | Old addresses people have saved | Keep no redirect pages. An old address lands on Home |  |
| 11 | Projects | Settled: a project is a job with the Project type, and a finished project is a completed job, found like any other. Service agreements stay their own record |  |
| 12 | The bell | It goes, and its count sits on Home in the menu. The morning email stays, with each item linking to its place |  |
| 13 | Features to drop entirely | Settled: nothing is dropped |  |
| 14 | Words appearing as you talk | Check whether live transcription is switched on in production; I can't see those settings |  |
| 15 | One New button instead of New conversation | Settled: New holds Job, Quote and Task, the same on every page, and fills nothing in. What belongs to a job comes from its Add; everything else from its place's own button. No chat box in it: talking to Tiff stays in the box on Home, and Search's last row asks Tiff from any screen. Still to pick: the three as a list or a row |  |
| 16 | The job card's create SWMS and compliance section | Settled: drop the create part. A job's Add makes a SWMS or a certificate, opening in its own tab. The job's Documents tab lists its SWMS (who's signed on), certificate, quote and designs, with Send |  |
| 17 | Text sizes | Settled, as rules 12 to 14: titles 24 semibold, 16 for reading and writing, body 14, labels 13, captions 12, and one big figure at 32. Whether 20 stays is open (Build plan, Still open) |  |
