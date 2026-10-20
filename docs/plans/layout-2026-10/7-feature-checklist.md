# The feature checklist

Every feature HeyTiff has today, its one home in v2, and the build step that moves it. `4-review.md` asks for this list ("The control"): it is how "nothing dropped" gets checked.

**How to use it.**

- Each step-5 change ticks its rows in the same commit: `[x]`, then the PR number. A change in another step does the same for its rows.
- A feature with no tick when its place is done is a dropped feature. Stop, and put it back or ask Isaac.
- Don't renumber. A row found later takes the next free number (F-257 on) and sits in its area.

**256 rows.** 235 come from `5-today-every-feature.md` (12 October). 21, marked (R), come from `4-review.md` (Abilities at risk, Home not named and the extras it names) or from `6-revisions.md`. A feature the Today file lists twice is one row here, and a Today row that holds two features with different homes is two. Its "Not used, or can't be reached" lists are deletions, not features; they are in `1-main.md`, "What gets deleted". 17 rows need Isaac's call; they are listed again at the end.

**Where the homes come from.** `1-main.md` and `6-revisions.md`, which wins. "rev N" is an item in `6-revisions.md` (1 to 11 are Isaac's answers, 12 to 36 what the build assumes). "main decision N" is `1-main.md`'s. E1, J7, A3 and the like are the flows on canvas page 9 (`_design/boards/work/v2/flows_data.py`). "correction" is one of `4-review.md`'s corrections, which the build follows. "review" is a fix from its Abilities at risk or Home not named tables. Q1 to Q10 are the quote page's points.

**Steps** are "The order that works" in `4-review.md`: 1 tokens, 2 parts, 3 frame, 4 making, 5 screens, 6 the job's conversation, 7 phone, 8 outside the frame and HQ. D is the dead-code change between steps 0b and 3. "none" means nothing moves it. No row is step 7: each screen brings its phone layout in step 5, and step 7 checks them on a real phone.

## Home and the menu

### The frame and menu

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-001 | The menu: 11 items; folds to icons | Sidebar, every page | Frame › sidebar: New, Search, the eight places, Pinned, Recents, your name. It doesn't fold (rev 34) | 3 | [ ] |
| F-002 | Search, ⌘K: screens, staff, clients, projects, jobs, photos | Top bar; ⌘K | Frame › Search, ⌘K; its last row asks Tiff. Its kinds and gates are listed when the places land | 3 | [ ] |
| F-003 | Clock and date | Top bar | Frame › header, left; on the workspace's time zone | 3 | [ ] |
| F-004 | Tiff button | Top bar, every page | Goes. Home › the box; Search's last row from any screen | 3 | [ ] |
| F-005 | Bell: reminders due (Done, Later), tasks given to you (Done, Got it), up to 20 alerts | Top bar | Home › To do; its count on Home in the menu (rev 25). The bell stays until To do lands | 5 | [x] |
| F-006 | Your profile: details, emergency contact, licences, qualifications, signature, work rights, pay | Avatar › Profile; bell; Home's list; letter editor | Your name › Your card, at `/team/<you>` | 5 | [ ] |
| F-007 | Sign out | Avatar › Sign out | Your name menu › Sign out (rev 33) | 3 | [ ] |
| F-008 | Switch organisation | Built, never shown | Goes. One company per person, said on /start (rev 32) | D | [ ] |
| F-009 (R) | Set aside: up to three job cards in the dock | Record dock under the page | Frame › open tabs, Pinned, Recents (rule 10). The dock goes when a job is a page | 3 | [ ] |
| F-010 (R) | Next job, J and K: walk the list a card was opened from | Record window controls | NO HOME: no plan row keeps it or drops it on purpose | 5 | [ ] |
| F-011 (R) | HQ's door, "Staff HQ" | Front door link only | Your name menu › Staff HQ, for the allowlist (review). HQ's exit points at / | 3 | [ ] |

### Home

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-012 | Home page, titled with today's date | Menu; search; Tiff; signing in; back links; morning email; about 40 bounces | Home, at / when signed in (rev 2) | 5 | [x] |
| F-013 | Your day bar: your bookings and timed tasks, or your next booked day | Home, top | Home › Today | 5 | [x] |
| F-014 | Open a job from Your day | Your day › card › Open job (Home's copy of the card) | Home › Today › the job opens Jobs › a job. Home's copy goes | 5 | [x] |
| F-015 | Diary: what you told Tiff and what it filed; edit, delete, undo | Home › Diary; doors from the list and Tasks | Conversations › a conversation: Edit, Delete, Undo | 5 | [ ] |
| F-016 | Add to the diary: Sort it out with Tiff | Home › Diary box | Home › the box | 5 | [x] |
| F-017 | Add to the diary: save as typed, private to you | Home › Diary box | Conversations › Only me, its own box and Save | 5 | [ ] |
| F-018 | ServiceM8 mentions of you: reply, hide, make a task | Home › Diary; list row "X asked you"; Tasks | Home › To do: "X asked you" › Reply, Make it a task, Done (J15, H6) | 5 | [ ] |
| F-019 | Tasks: open and done; mark done, move the date, give to someone, delete | Home › Tasks; the bell | Home › To do. A task opens as its form with Delete; Done today: Show (H3) | 5 | [ ] |
| F-020 | "Add a task" box | Home › Tasks | New › Task (H2) | 4 | [ ] |
| F-021 | The list: Late, Today, Jobs to book, No date, Later | Home, right side | Home › To do | 5 | [ ] |
| F-022 | List buttons: Renew, Log service, Book in, Clear, Create job, Book | List rows | Home › To do rows; each opens its record's one form | 5 | [ ] |
| F-023 | Calendar: public holidays, company events, notices, renewals; 4 weeks, month | Home › Calendar | Schedule › Calendar (S3). Notice events show there (rev 29); renewals go to To do | 5 | [ ] |
| F-024 | Add or edit a calendar event | Home › Calendar box; event › Edit | Schedule › Add an event; the event › Edit (S2) | 4 | [ ] |
| F-025 | Action required: every alert as a tile | Search; Tiff; the bell's "N more" | Home › To do | 5 | [x] |
| F-026 | Noticeboard: notices, polls, events, comments, reactions | Search; Tiff; Calendar › Open notice | Team › Notices; Write a notice. A new notice is in To do until read (rev 28) | 5 | [ ] |
| F-027 (R) | A notice's event: date, place, RSVP, comments | Noticeboard; also made from the calendar | TWO HOMES: Team › Notices › Write a notice (an event) and Schedule › Add an event. One event record or two is unanswered | 5 | [ ] |
| F-028 | Morning email: reminders and expiries, daily | Daily email (sent behind the scenes) | Stays. Outside the frame › the mail; each item links to its place | 8 | [ ] |
| F-029 (R) | To do's row kinds: the eleven urgent reasons and their rules | urgent-rules.ts, project-rules.ts | Home › To do: one table of row kinds, each with its rule | 5 | [ ] |
| F-030 (R) | The bell's 21 chip kinds, including ServiceM8 trouble and a task's Done that missed ServiceM8 | chips.ts | Home › To do: each kind with its row, button and landing | 5 | [ ] |
| F-031 (R) | The calendar's Year view and school holidays | Home › Calendar | NO HOME: which layers Schedule keeps, and what Show offers, is unanswered | 5 | [ ] |

### Tiff across the app

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-032 | Tiff's window, with 9 or more doors (top bar, boxes, sheets, "Have a look" on mic fields) | Everywhere | Home › the box. The same engine answers in Search's last row, a job's conversation and a quote | 5 | [ ] |
| F-033 | Tiff opens a screen or a record by name (19 screens, 4 kinds of record) | Tiff | Home › the box and Search; lands on the one home. Moves with each place | 5 | [ ] |
| F-034 | Photo readers: licences, vehicles, receipts, equipment, job photos | 11 scan doors, 5 drop zones | A part: the scan step, inside each record's own form | 2 | [ ] |

## Workboard

### The page

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-035 | Workboard, opening on All jobs › Schedule | Menu; search; Tiff; back links; Home's chips | Splits into Jobs (the list) and Schedule | 5 | [ ] |
| F-036 | Side switcher: All jobs, Projects, Maintenance | Click the page title | Goes. Jobs' views: Projects, Agreements | 5 | [ ] |
| F-037 | Search the board: jobs, visits, agreements, projects, trips, photos | Every tab; a client result from ⌘K | Search (frame). Jobs' list narrows by client (J3) | 5 | [ ] |
| F-038 | New job, sent to ServiceM8 as a Quote | Workboard › New job (managers, sending on) | New › Job (J1); the job opens after Create | 4 | [ ] |
| F-039 | Display mode, full screen for a wall | Workboard › Display mode | Schedule › Display (S5) | 5 | [ ] |
| F-040 | ServiceM8 sync status | Every tab's toolbar; the job card | Settings › ServiceM8 and Xero. A failed sync raises a To do row | 5 | [ ] |

### All jobs

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-041 | Schedule: one day, a lane per person, ServiceM8 bookings | Workboard, default tab | Schedule › Day | 5 | [ ] |
| F-042 | A booking's details › Open job | Schedule › block › Open job, or double-click | Schedule › the block's facts › Open job | 5 | [ ] |
| F-043 | Clear a leftover booking | Schedule block; job card; Home; the bell | Home › To do: "Still booked, job complete in ServiceM8" › Clear (review) | 5 | [ ] |
| F-044 | "Also on this day": visits and project trips with no time | Schedule › shelf | Schedule › Day, the untimed visits; a trip opens its visit | 5 | [ ] |
| F-045 | Work orders: booked, and waiting on a day | All jobs › Work orders | Jobs › To book (J24) | 5 | [ ] |
| F-046 | Quotes: to price, waiting, going cold, over 6 months (also the Quotes worklist) | All jobs › Quotes | Jobs › Quotes (J21). Going cold raises To do | 5 | [ ] |
| F-047 | Completed: last 8 weeks; awaiting payment; didn't go ahead | All jobs › Completed | Jobs › Done, with Didn't go ahead; awaiting payment in Jobs › Owed (correction) | 5 | [ ] |
| F-048 | Capacity: 4 weeks of how full each day is | All jobs › Capacity | Schedule › Weeks, a figure and a word per day | 5 | [ ] |
| F-049 | Who counts toward a day (crew hours) | Capacity › Crew, or Set the crew | Team › a person › Counts toward the schedule, Hours a day (S1) | 5 | [ ] |
| F-050 | Gallery of starred photos | All jobs › Gallery | Jobs › Starred photos (J23) | 5 | [ ] |

### The job card

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-051 | Open a job card | Any list row, Schedule, Search, Tiff, Analytics, a SWMS, the bell, Home | Jobs › a job, a page at `/jobs/<n>` | 5 | [ ] |
| F-052 | Invoices on the job | Job number menu; crumb; Billing row; Timeline | Jobs › a job › Billing | 5 | [ ] |
| F-053 | Open in ServiceM8 | Card's top chip; 5 places | Jobs › a job › page head, Open in ServiceM8 | 5 | [ ] |
| F-054 | Make it a Work Order (writes to ServiceM8) | Top chip; a tick in Book in | Jobs › a job › Quote › Mark accepted (J8) | 5 | [ ] |
| F-055 | Create a project from this job | ⋯ menu | Jobs › a job › type: Project (P1, rev 1) | 5 | [ ] |
| F-056 | Create a service agreement from this job | ⋯ menu | Jobs › Agreements › New agreement, the job and address filled in (M1) | 4 | [ ] |
| F-057 | "On this job": flags, flagged notes, mentions | Top of the card | Home › To do: the flag › Clear; the mention › Reply (J15, J16) | 5 | [ ] |
| F-058 | Progress line, Enquiry to Paid, opening each section | The card | Jobs › a job › Overview, the stages line only. Other tabs show the stage as one grey word (revisions) | 5 | [ ] |
| F-059 | Summary: an AI paragraph on where it's up to | Card's default section | Jobs › a job › Overview › Where it's up to (the rail, step 6 slice A; the job's own words and the invoice description under The job) | 5 | [x] step 6 slice A |
| F-060 | Timeline: every note, visit, photo, payment; write on the job, copy to ServiceM8 | Rail › Timeline | Jobs › a job › Overview, the job's conversation (JC-1). Each note carries its ServiceM8 state. Slice A: every diary entry in the conversation, oldest first by day; the filters as soft tabs at its head; a note's line and doors (Remove, Send to ServiceM8, Mark done, Reply) the diary's own; the box's Keep as typed is the pen (Also in ServiceM8 beside it), Send is Tiff. The diary has no Edit and no load more: it reads the newest 60, as before | 6 | [x] step 6 slice A |
| F-061 | Billing: value, balance, claims, payments, materials, No deposit | Rail › Billing (owner) | Jobs › a job › Billing (J13) | 5 | [ ] |
| F-062 | Photos by visit day, with stars | Rail › Photos | Jobs › a job › Photos (J6, J23) | 5 | [ ] |
| F-063 | Files: upload, delete, open, tick to send | Rail › Files | NO HOME: the Documents tab lists and sends, but "nothing is created there"; where a file is uploaded is unsaid | 5 | [ ] |
| F-064 | Compliance: SWMS, certificates, licences, insurance | Rail › Compliance | Jobs › a job › Documents: SWMS (who's signed on), certificate. Company papers are added in Send (D8) | 5 | [ ] |
| F-065 | Send to ServiceM8, or email the ticked documents | Tick files › footer; the certificate wizard | Jobs › a job › Documents › Send (J14). One Send form | 5 | [ ] |
| F-066 | Contacts, and edit the customer (writes to ServiceM8) | Left rail › Contacts › Edit | Jobs › a job › Overview › Customer group, Edit (correction) | 5 | [ ] |
| F-067 | Check in and out | Progress line only | Home › Today › the job › Check in (J9) | 5 | [ ] |
| F-068 | Book in: people, days, times; several rows; reads ServiceM8 first; work-order switch | Visits › Book in; task planner; Look again; Home's Book in | Jobs › a job › Add › Visit, the one Visit form. Also Visits' Book a visit and To do | 4 | [ ] |
| F-069 | Install tasks by visit: from the quote, ticks, photos, serial off the plate | Progress line only | Jobs › a job › Checklist (J10) | 5 | [ ] |
| F-070 | Checklist: materials and to-dos, typed or spoken | "Materials sorted" step only | Jobs › a job › Checklist › Add (J11) | 5 | [ ] |
| F-071 | Quote: ServiceM8's quote PDFs; Create, Continue or Update quote (also the Quotes area's "Quote section" row) | "Quoted" step only, managers | Jobs › a job › Quote tab, its landing "Quotes" (revisions) | 5 | [ ] |
| F-072 | Photo and document viewer | Built into 5 screens | A part: the viewer, one for every door | 2 | [ ] |
| F-073 (R) | Presence: who else has the job open; live changes | Job card | Jobs › a job › page head, their initials (rule 38); the page re-reads on a change | 5 | [ ] |

### Projects (4 tabs)

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-074 | Urgent: late trips, stuck projects, flags | Projects (default) | Home › To do | 5 | [ ] |
| F-075 | Pipeline: projects by stage, and New project | Projects › Pipeline | Jobs › Projects, grouped by stage. New › Job, type Project | 5 | [ ] |
| F-076 | Completed: mark done, reopen | Projects › Completed | Jobs › Done. Done is the job completing (rev 1). Reopen: see F-097 | 5 | [ ] |
| F-077 | Calendar › a day: place a trip, assign crew | Projects › Calendar | Schedule › Not on a day yet › Place; crew on the visit (M3, M4). The day dialog reports a refusal | 5 | [ ] |
| F-078 | Project card: summary, visits, money (listed twice in the Today file) | Pipeline › a row | Goes. Jobs › a job, a Project job | 5 | [ ] |
| F-079 | Trip sheet: gates, day, link a ServiceM8 job by number, close out | 5 ways | Jobs › a job › Visits › the visit. One visit sheet for every job | 5 | [ ] |

### Maintenance (5 tabs)

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-080 | Urgent: overdue, to confirm, no crew, flags, tasks | Maintenance (default) | Home › To do (M6) | 5 | [ ] |
| F-081 | Upcoming visits by week | Maintenance › Upcoming | Schedule › Week | 5 | [ ] |
| F-082 | Calendar › a day: place a service, assign crew | Maintenance › Calendar | Schedule › Not on a day yet › Place (M3); crew on the visit (M4) | 5 | [ ] |
| F-083 | Completed, and Mark invoiced | Maintenance › Completed | Home › To do: Invoice (M5) | 5 | [ ] |
| F-084 | Service agreements list | Maintenance › Service agreements; search; Urgent; a visit's chip | Jobs › Agreements, with an Ended view; filter by client, service, site or tag | 5 | [ ] |
| F-085 | New service agreement, by hand or read from a ServiceM8 job by Tiff | Service agreements › New; job card ⋯; a project's handover | Jobs › Agreements › New agreement. To do at a Project job's Handover (M1) | 4 | [ ] |
| F-086 | Agreement sheet: pause, end, details, how often, equipment, packing list, tags | From the list | Jobs › Agreements › an agreement, a page with sections (M2) | 5 | [ ] |
| F-087 | Visit sheet: gates, day, link a ServiceM8 job, notes, history, close out | 10 ways | The visit, under its job's Visits or its agreement's Visits; Close out (P3, M5) | 5 | [ ] |
| F-088 (R) | Skip one maintenance visit | Visit sheet | The visit › Skip (review) | 5 | [ ] |
| F-089 (R) | Invoice a maintenance visit that has no job | Maintenance › Completed | NO HOME: what Invoice does on an unlinked visit is unsaid | 5 | [ ] |
| F-090 (R) | Cancel a booking | Visits; the Schedule inspector | The visit's Cancel (a rule 25 dialog), also on the Schedule block (review) | 5 | [ ] |
| F-091 (R) | A visit booked in HeyTiff with ServiceM8 bookings off | Project trips | Jobs › a job › Add › Visit; shows on the Schedule; sends only when the bookings switch is on (review) | 4 | [ ] |

## Projects, quotes and reports

### Projects

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-092 | Create a project | Pipeline › New project › a list page; job card ⋯ | New › Job, type Project, or change a job's type (P1). It is a ServiceM8 job (rev 1) | 4 | [ ] |
| F-093 | Projects list page | Only Pipeline's New project, for managers | Goes. Jobs › Projects | 5 | [ ] |
| F-094 | Project page | 14 ways in | Jobs › a job, a Project job | 5 | [ ] |
| F-095 | Block, unblock, hold, resume | Project page, top | Jobs › a job › Actions: On hold, Blocked, with the Block form and banner (review) | 5 | [ ] |
| F-096 | Mark done; archive | Project page; Completed | Done is the job completing; nothing to archive | 5 | [ ] |
| F-097 | Reopen a finished project | Project page; Completed | NO HOME: done is the job completing, and reopening is never named | 5 | [ ] |
| F-098 | Edit name, client and site | Project page › Edit | Jobs › a job › Overview › Customer group, Edit | 5 | [ ] |
| F-099 | Stage: Quote, Approved, Pre-install, Rough-in, Fit-off, Commission, Handover, Complete | Project page › Stage | Jobs › a job › Overview › the stages line; warns from the checklist's sections | 5 | [ ] |
| F-100 | Trips to site | Project page; card; Calendar; Urgent; Schedule | Jobs › a job › Visits; Add › Visit (P3) | 5 | [ ] |
| F-101 | Set up a service agreement at handover | Project page, at Handover or Complete | Home › To do: Set up the agreement, the job filled in (M1) | 5 | [ ] |
| F-102 | Money: total, claims, add a claim | Project page and 4 other places | Jobs › a job › Billing › Add a claim (P4) | 5 | [ ] |
| F-103 | Scope: in the price, not in the price | Project page | Jobs › a job › Quote › Included and Not included | 5 | [ ] |
| F-104 | Variations: add, approve, decline, reopen, claim, who decided | Project page | Jobs › a job › Quote landing › Start a variation; Decline with Undo, who and when (review) | 5 | [ ] |
| F-105 | Dates: promised finish, defects end (one task), milestones, hours allowed | Project page | TWO HOMES: Overview (P5) or the job's aside across every tab (S-project). The correction leaves both | 5 | [ ] |
| F-106 | Checklist by section | Project page; Tiff notes add "bring" items | Jobs › a job › Checklist, named sections from the template (review) | 5 | [ ] |
| F-107 | Equipment on site, nameplate photo read by AI | Project page › Add | Jobs › a job › Checklist › the unit › Photo of the plate (P7); it carries to the agreement | 5 | [ ] |
| F-108 | Jobs on this project: attach as quote, install, variation, service, other; detach | Project page | TWO HOMES: Linked jobs in the job's aside (S-project) or on Overview. The same open correction as F-105 | 5 | [ ] |
| F-109 | Link a design, Open Studio | Project page › Design | Design › New design with the job picked (P6); the job's Documents lists it | 5 | [ ] |
| F-110 | Notes, site journal, commissioning readings, recurring issues | Project page; Tiff notes | Jobs › a job › Overview › the note box; commissioning is a kind of note (P8) | 6 | [ ] |
| F-111 | Documents and photos uploaded to a project | Project page › Upload | Jobs › a job › Photos. Files: see F-063 | 5 | [ ] |
| F-112 | Handover sheet | Project page › Commissioning › Handover sheet | Documents › Handover sheet, made by the Project job and listed on its Documents tab (P9). Money held back; no Signed status (rev 30) | 5 | [ ] |
| F-113 (R) | Projects already in HeyTiff with no ServiceM8 job | Project records | NO HOME: rev 1 needs a ServiceM8 job, and the one-time move for these is unwritten | 5 | [ ] |
| F-114 (R) | Billing with no accepted quote: a typed total; hand claims marked paid, awaiting or removed | Project money cards | Jobs › a job › Billing (review) | 5 | [ ] |

### Quotes

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-115 | Quote page | Only the job card's quote button | Jobs › a job › Quote, at `/jobs/<n>/quote`; Search finds it | 5 | [ ] |
| F-116 | Tiff's proposal builder (the older): brief, draft, questions, units, labour, approve, mark sent, mark accepted | Quote page | Jobs › a job › Quote, the one builder (main decision 2). Steps Brief, Scope, Priced, Approved, Sent, Accepted (Q7) | 5 | [ ] |
| F-117 | Lines builder: lines, kits, options, loadings, labour, compare units, versions, variations | Quote page › Build it by hand | Jobs › a job › Quote › the rail's View line items (layout C). Versions and variations on the Quote landing | 5 | [ ] |
| F-118 | Tiff panel on a quote: questions with prices, conversation | Quote page, right side | Jobs › a job › Quote › the conversation in the middle (Q1, Q2) | 5 | [ ] |
| F-119 | Price per option, and profit | Quote page | Jobs › a job › Quote › the rail; profit as a figure and a word (Q4) | 5 | [ ] |
| F-120 | Send the accepted quote to ServiceM8 as a work order | Quote page › To ServiceM8 | Jobs › a job › Quote › Approve, Mark accepted (J19) | 5 | [ ] |
| F-121 (R) | Mark accepted on a ServiceM8-only quote with no HeyTiff lines | Job card status chip | Jobs › a job › Quote tab › Accepted, even with no lines; its permission still to name (review) | 5 | [ ] |
| F-122 (R) | A line's warnings: a breaker under the outdoor's current, a coil that doesn't match | The quote's To confirm list | NO HOME: To confirm goes. An orange word on the line, counted in the rail's Scope, waits for his yes (revisions) | 5 | [ ] |

### Reports and customer links

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-123 | Analytics overview: win rate, quoted, won, days to quote, price by job type, enquiries by week | Menu; search; Tiff | Your name › Reports, shown by each report's permission (correction) | 5 | [ ] |
| F-124 | Analytics › Quotes: when a quote counts as lost, review the lost, open quotes, tenders | Analytics › Quotes | Your name › Reports › Quotes. Open quotes stay in Jobs › Quotes | 5 | [ ] |
| F-125 | Analytics › To decide: quote or not, won or lost, price belongs, kind of job; make work orders | Analytics › To decide; the overview banner | Home › To do: Decide N jobs (A10) | 5 | [ ] |
| F-126 | How jobs are counted (also Admin › Analytics settings) | Analytics › link; Admin › Analytics | Settings › Reports (A10) | 5 | [ ] |
| F-127 | Customer's live design link: 14 days, print, airflow once approved | Design › Summary › Send; project › Design | Design › a design › Share › live link (L7) | 5 | [ ] |

## Library, Toolbox and Design

### Library

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-128 | Library page: ask box, document count, five shelves | Menu; search; Tiff; back links; Fault Finder | Library | 5 | [ ] |
| F-129 | Ask a question: answer with page sources, from your library or general knowledge | Library › ask box (type or speak) | TWO HOMES: Home's box with sources (1-main.md's merge table) and the Library's "Ask the Library" (H5) | 5 | [ ] |
| F-130 | Ask about one document | All documents › a row's Ask Tiff | The box, scoped to one document, from Library › the document (review) | 5 | [ ] |
| F-131 | Open a source at the cited page | An answer's source chip | Library › the document, at that page | 5 | [ ] |
| F-132 | Saved chats: pick up, rename, delete | Library landing, this browser only | Conversations, kept on the server | 5 | [x] branch v2-conversations: the threads in Conversations, and kept on the server once docs/migrations/tiff_threads.sql is applied (NOT YET); until then on the device |
| F-133 | All documents: search, shelves, tags | Library › All documents; 6 other doors | Library, the list; a tag filter with its own address | 5 | [ ] |
| F-134 | Find a word inside a document | All documents › a document's title | Library › the document › Search inside (L2) | 5 | [ ] |
| F-135 | Add documents: drop PDFs, title, shelf, brand, tags; large uploads (owner) | All documents › Add documents | Library › Add a document, the upload drawer (L1) | 4 | [ ] |
| F-136 | Edit or remove a document | All documents › a row | Library › the document › Edit, Remove | 5 | [ ] |
| F-137 | Reading progress, retry, resume, read scanned pages, page allowance, fill search gaps | All documents (tiff_manage) | Library › a document's state and its controls (review) | 5 | [ ] |
| F-138 | Tags: create, rename, recolour, remove | All documents › Tags; uploading; editing | Library › Tags (A13); colours from the eight | 5 | [ ] |
| F-139 | Field notes: what the crew taught Tiff, published from a Tiff note | Tiff's "Add to the Library" on any note | Library › Field notes; Write a field note; Add to the Library from a conversation (L3) | 5 | [ ] |
| F-140 | Review field notes: looks right, take it down | Admin › Knowledge from the field | Library › Field notes: Looks right, Take it down for admin and up; raised in To do (A13, review) | 5 | [ ] |

### Toolbox

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-141 | Toolbox: tool tiles, search, categories | Menu; search; Tiff; every tool's back link | Library › Field tools shelf (rev 20). Which right gates the shelf is still to say | 5 | [ ] |
| F-142 | Heat Load: room size to kW and a unit class; advanced factors | Toolbox; Fault Finder | Library › Field tools › Heat load (L4) | 5 | [ ] |
| F-143 | Running Pressures: expected pressures; troubleshoot from readings | Toolbox; Fault Finder | Library › Field tools › Running pressures (L4) | 5 | [ ] |
| F-144 | Fault Finder: 16 symptoms, questions, the fix, what to tell the customer; code lookup | Toolbox | Library › Field tools › Fault finder (L4) | 5 | [ ] |
| F-145 | Outdoor Unit Placement: NSW council check, 13 rules, diagram | Toolbox; Fault Finder | Library › Field tools › Outdoor unit placement (L4) | 5 | [ ] |

### Design

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-146 | Start screen: new design (from a ServiceM8 job or blank), recent designs, import a design file | Menu › Design; search; Tiff; Heat Load's link | Design: New design, recent designs, Import design file (L5, rev 35) | 5 | [ ] |
| F-147 | Open a design from a job or project | Job card › Files; project › Design | Design › the design; the job's Documents lists it | 5 | [ ] |
| F-148 | Equipment library window: what's new, lineup by brand | Start screen › Library | Design › start screen › Equipment library (rev 35) | 5 | [ ] |
| F-149 | Plans: upload floor plans, pick pages, name them, stack floors | New design; Edit plans; empty canvas | Design › a design (L6). The studio stays as it is | 5 | [ ] |
| F-150 | Canvas: floors, scale, north, tape, crop, split, move plans, view options, legend, zoom | Toolbar, keys, pills | Design › a design › canvas | 5 | [ ] |
| F-151 | Draw zones, then size them; zone window with heat load | Toolbar; keys; Next chip | Design › a design › canvas | 5 | [ ] |
| F-152 | Draw pipe, drain, cable, riser, joint, branch box | Toolbar › Draw; keys | Design › a design › canvas. "Duct, coming" goes | 5 | [ ] |
| F-153 | Components: plenum | Toolbar › Component | Design › a design › canvas. The 7 "coming" entries go | 5 | [ ] |
| F-154 | Notes on the drawing; unit callouts | Toolbar; keys; a unit | Design › a design › canvas | 5 | [ ] |
| F-155 | Systems: add, variations, cards, give zones, place units | Systems panel; Next chip | Design › a design › Systems | 5 | [ ] |
| F-156 | System builder: units onto zones, unit browser, compare, buy prices | 5 ways | Design › a design › System builder | 5 | [ ] |
| F-157 | Install details: questions, equipment list, note for the installer | System card; Next chip | Design › a design › Install details | 5 | [ ] |
| F-158 | Schematic for VRF systems: sizes, fittings | Schematic tab; builder switch | Design › a design › Schematic | 5 | [ ] |
| F-159 | Summary sheet: client, site, loads, systems, plans, materials, checks, who worked on it | Summary tab | Design › a design › Summary | 5 | [ ] |
| F-160 | Link a ServiceM8 job; push the materials list to the job | Summary; new design | Design › a design › Summary | 5 | [ ] |
| F-161 | Share: PDF, plans as images, design file, live link, PDF on the ServiceM8 job | Summary › Share | Design › a design › Share (L7) | 5 | [ ] |
| F-162 | Airflow simulation for the customer, once approved | Canvas › Simulate; Summary › Simulate | Design › a design › Simulate | 5 | [ ] |
| F-163 | Equipment data viewer for admins | Typed address only | Goes: removed 12 October at Isaac's say-so. HQ's data editor stays | D | [ ] |

## People, time and vehicles

### Me

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-164 | Me page with five tabs | Menu › Me; search; Tiff; five addresses | Your name menu: Your card, Timesheet, Leave, Expense claims | 5 | [ ] |
| F-165 | My timesheet: days, hours, overtime split, pay rules | Me; search; Tiff; the "sent back" alert | Your name › Timesheet, at /you/timesheet | 5 | [ ] |
| F-166 | Fill in a day: worked or off, start, finish, break | Me › Timesheet › a day | Your name › Timesheet › the day; clock times on the wheel (E1) | 5 | [ ] |
| F-167 | Overtime on one day (salaried), the "ran long" unlock | A day's overtime button | Your name › Timesheet › the day; the salaried rule in Settings › Pay and holidays (review) | 5 | [ ] |
| F-168 | Submit the period; automatic at the set day and time | Me › Timesheet › Submit | Your name › Timesheet › Send week; To do: Sent back (E2) | 5 | [ ] |
| F-169 | My normal hours | Timesheet › Normal hours | Your name › Your card › Normal week; managers edit the same one (E3) | 5 | [ ] |
| F-170 | Mark myself unavailable (casuals) | Timesheet › Availability | Your name › Leave › Ask for leave, kind Can't work (E3) | 4 | [ ] |
| F-171 | Upcoming public holidays | Timesheet; Me › Leave; Home's Calendar | Schedule › Calendar (S3) | 5 | [ ] |
| F-172 | My leave: balances, request with certificate, attach one later, cancel, history | Me › Leave; search; Tiff; alerts | Your name › Leave; Ask for leave (E4) | 5 | [ ] |
| F-173 | My expenses: scan a receipt or type it, against a job; cancel | Me › Expenses; search; Tiff; alert | Your name › Expense claims › Claim an expense (E5); Cancel on the claim | 5 | [ ] |
| F-174 | Fuel receipts | Expenses › Vehicle › Log fuel | Your name › Expense claims › Claim an expense; Fuel asks litres and km (E6) | 4 | [ ] |
| F-175 | My vehicle: details, fuel, issues, services, odometer, fix my own entry | Me › Vehicle; Assets; alerts; Home | Your name › Your card › Vehicle: the vehicle read-only for its driver, with odometer and own-entry edits (correction) | 5 | [ ] |
| F-176 | My private notes: add, dictate, edit, archive, put back, delete for good | Me › Notes; search; Tiff; a diary door | Conversations › Only me, its own box; Edit and Archive on a note (correction) | 5 | [x] branch v2-conversations |

### Time & Pay

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-177 | Team timesheets: needs review, waiting, ready, approved | Menu › Time & Pay; search; Tiff | Team › Timesheets | 5 | [ ] |
| F-178 | Approve one, approve all, send back with a question | Time & Pay › Timesheets | Team › Timesheets: Approve per row, Send back with a question; To do: Review (T6) | 5 | [ ] |
| F-179 | Xero wage-change notice, from the weekly pay-rate check | Foot of Timesheets | NO HOME: no board or flow places it | 5 | [ ] |
| F-180 | Pay settings: cycle, week start, day, hours, breaks, overtime, rates, medical certificate, super, salaried overtime, auto-submit | Time & Pay › gear | Settings › Pay and holidays (A9) | 5 | [ ] |
| F-181 | Pay run export | Time & Pay › gear, "Not built yet" | Goes: a placeholder | D | [ ] |
| F-182 | Match people to Xero payroll | Time & Pay › gear; Admin › Xero | Settings › ServiceM8 and Xero › People › Link (A5) | 5 | [ ] |
| F-183 | Public holidays: add, remove, restore | Time & Pay › gear › Public holidays | Settings › Pay and holidays › Public holidays, with Remove and Restore (A9, review) | 5 | [ ] |
| F-184 | Team leave: approve or decline, set balances, who can't work | Time & Pay › Leave; alert | Team › Leave; To do; balances on the person's card (T7) | 5 | [ ] |
| F-185 | Team expenses: approve, decline, mark paid | Time & Pay › Expenses; tile; alert | Team › Expenses; To do (T8) | 5 | [ ] |

### Assets

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-186 | Fleet register: search, sort, filter, fleet value, Value with Tiff | Menu › Assets; search; Tiff | Team › Vehicles | 5 | [ ] |
| F-187 | Add or edit a vehicle: rego read by Tiff, specs, purchase, assignment | Assets › Add vehicle; row menu; card's Edit | Team › Vehicles › Add a vehicle (T9); edits on the vehicle | 4 | [ ] |
| F-188 | Vehicle card: photo, status, odometer, next service, driver, renewals, history | 9 ways | Team › Vehicles › a vehicle | 5 | [ ] |
| F-189 | Renewals: rego, insurance, CTP, scanned by Tiff | Card; alerts; Home; calendar | Team › Vehicles › a vehicle › Renew; To do when due (T10) | 5 | [ ] |
| F-190 | Money: value, purchase, invoices, finance, running cost | Card › money | Team › Vehicles › a vehicle › Money | 5 | [ ] |
| F-191 | Log a service | Card; row menu; Services screen; Home | Team › Vehicles › a vehicle › Log a service (T10) | 5 | [ ] |
| F-192 | Log fuel, an issue or the odometer | Card › Log; My vehicle | The vehicle's page for an issue and the odometer; fuel through Claim an expense (E6) | 5 | [ ] |
| F-193 | Equipment & tools | Assets › Equipment & tools, empty | Goes: a placeholder | D | [ ] |

### Team, staff cards and access

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-194 | Team list: active, compliance gaps, pending invites, archived | Menu › Team; search; Tiff; 5 links | Team, its views, with Left for the archived (review) | 5 | [ ] |
| F-195 | Open a staff card | Row, name, row menu; search; Tiff; alerts | Team › a person, at `/team/<name>` | 5 | [ ] |
| F-196 | Invite staff, resend, revoke, copy link | Team › Invite staff; row menu; Pending invites | Team › Add a person (T1). An invited person's Actions: Resend, Copy the invite link, Revoke (review) | 4 | [ ] |
| F-197 | Make a staff card | Accepting an invite; Team › Create card | Team › Add a person | 4 | [ ] |
| F-198 | Import people from ServiceM8 or Xero, reviewed | Integrations › people import | Settings › ServiceM8 and Xero › People › Import (review) | 5 | [ ] |
| F-199 | Deactivate or reactivate | Team row menu; Personal › Status | Team › a person › Actions › Deactivate; the Left view › Reactivate (T11) | 5 | [ ] |
| F-200 | Staff card: overview, photo, van, personal, nicknames, emergency, payroll, notes about the person | Staff card sections | Team › a person, one Edit per section; the admin note box (T2, T5, T12) | 5 | [ ] |
| F-201 | Licences and tickets: scan, renewals, history, documents; qualifications | Staff card › Licences; alerts; Home | Team › a person › Licences (T3); To do when due | 5 | [ ] |
| F-202 | Work rights: the old form, and the newer checks with evidence | Staff card › Work rights | Team › a person › Work rights › Record a check (E9). The old form stays until that door exists (review) | 5 | [ ] |
| F-203 | Role and permissions: Staff, Admin, Owner; each right | Staff card › Permissions | Team › a person › Access (T4, A15) | 5 | [ ] |
| F-204 | Expiry alerts: licences, work rights, rego, insurance, CTP, service | Bell; Action required; Home; email; Compliance gaps | Home › To do › Renew; the morning email links to the item | 5 | [ ] |

## Admin, settings and documents

### The Admin menu

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-205 | Admin menu: Business, Tools, Owner | Menu (admins); search; Tiff; 9 back links | Goes. Your name › Settings | 5 | [ ] |
| F-206 | Seven "coming" rows | Not clickable | Goes: placeholders | D | [ ] |

### Organisation

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-207 | Company: logo, document colour, trading details (ABN, GST), contact and address | Organisation › Company; the first-run form | Settings › Business (A1). The colour is typed hex with a swatch (rev 10) | 5 | [ ] |
| F-208 | Payment terms in days | Organisation › Preferences | TWO HOMES: Settings › Quoting and prices › Payment terms (A3) and Documents › Templates › Quote (D5) | 5 | [ ] |
| F-209 | Expiry warning days | Organisation › Preferences | NO HOME: A3's title names it, but no Settings section holds it | 5 | [ ] |
| F-210 | Morning email on or off | Organisation › Preferences | Settings › Emails and alerts (A3). Per person or company-wide is still unsaid | 5 | [ ] |
| F-211 | Company licences and insurance: add (Tiff reads it), renew, history, delete | Organisation › Licences & insurance; bell; Home | Settings › Licences and insurance (A2); To do when due | 5 | [ ] |
| F-212 | Hand over ownership | Organisation › Account | Settings › Business › Owner: Hand over (A12) | 5 | [ ] |
| F-213 | Account facts: owner, team count, plan | Organisation › Account | NO HOME: the review asks for a section and none is named | 5 | [ ] |

### Integrations

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-214 | ServiceM8: connect, disconnect, sync now; send switches (quotes Off, Trial, On); what it reads; link people; permissions | Admin › Integrations › ServiceM8; bell; Workboard; Home; job card; Analytics | Settings › ServiceM8 and Xero, with every switch, Sync now, Reconnect, Disconnect (A4, review) | 5 | [ ] |
| F-215 | Xero: connect, choose the organisation, link payroll people | Admin › Integrations › Xero | Settings › ServiceM8 and Xero (A5) | 5 | [ ] |

### Templates and letters

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-216 | Templates list: Quote, Handover sheet, Documents email, Letterhead, Certificate, SWMS, Project checklist | Admin › Templates; Organisation link | Documents › Templates (D5) | 5 | [ ] |
| F-217 | Quote template: notes and payment stages | Templates › Quote | Documents › Templates › Quote. Payment terms: see F-208 | 5 | [ ] |
| F-218 | Handover sheet and Project checklist templates (one shared list; a third starter list in Quoting) | Templates; Admin › Quoting | TWO HOMES: Documents › Templates (D5) and Settings › Quoting and prices › starter tasks (A6) | 5 | [ ] |
| F-219 | Documents email wording | Templates › Documents email | Documents › Templates › Documents email | 5 | [ ] |
| F-220 | Letterhead: logo, details, footer, closing, signature | Templates › Letterhead; Letters | Documents › Templates › Letterhead | 5 | [ ] |
| F-221 | Approve the certificate wording (owner) | Templates › Certificate; bell; the wizard; an old address | Home › To do: Approve (D4); the wording in Documents › Templates › Certificate | 5 | [ ] |
| F-222 | Approve the SWMS steps (owner) | Templates › SWMS; bell; the SWMS wizard | Home › To do: Approve (D4); the steps in Documents › Templates › SWMS | 5 | [ ] |
| F-223 | Letters: list, new, write, download PDF, delete | Admin › Letters | Documents › Make a document › Letter (D6); the Letters view | 5 | [ ] |
| F-224 (R) | Letters' privacy: writer, signer and owner only; the area admin and up | Admin › Letters | Documents › Letters, held back on the server; Make a document › Letter for admin and up (review) | 5 | [ ] |

### Certificates and SWMS

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-225 | Commissioning certificate: 5 steps, issued as a PDF on the job | Job card › Compliance › Create certificate | Jobs › a job › Add › Certificate, in its own tab (D3) | 4 | [ ] |
| F-226 | Send a certificate: email, to ServiceM8, download, share | Straight after issuing; job card › tick › footer | The one Send form: on issue, and Jobs › a job › Documents › Send (D3, J14) | 5 | [ ] |
| F-227 | Reissue or delete a certificate | Job card › the certificate | Documents › the certificate › Actions (review) | 5 | [ ] |
| F-228 | SWMS: 4 steps, issue, revise | Job card › Compliance › Create SWMS | Jobs › a job › Add › SWMS (D1); Revise from Documents › the SWMS | 4 | [ ] |
| F-229 | SWMS sign-on: read, sign, raise an issue, sign others on, mark it sorted | 2 bell alerts; job card; after issuing | Documents › the SWMS › sign-on; To do: Sign on (D2, review) | 5 | [ ] |
| F-230 | Your drawn signature | Profile › Signature; certificate wizard › Sign | Your name › Your card › Signature (E10); the pad is a part | 5 | [ ] |

### Money tools

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-231 | Tax & EOFY: spend, GST and receipts by financial year; export CSV | Admin › Tax & EOFY | Your name › Reports › Tax year › Export CSV (A11), for financials | 5 | [ ] |
| F-232 | Rate Calculator: staff, costs, vehicles, risk, profit; costs from Xero | Admin › Rate Calculator | Settings › Quoting and prices › Work out my rate (A8) | 5 | [ ] |
| F-233 | Quoting: charge-out rate, hours, markups, allowances, task hours, starter tasks, ductwork, what the customer sees, preferred, ranges, habits, kits | Admin › Quoting; a quote's "Set in Quoting" | Settings › Quoting and prices (A6) | 5 | [ ] |
| F-234 (R) | Quoting's component price picks: each part to its item and supplier; Override, Use lowest, roll length | Admin › Quoting | NO HOME: A7 deletes it as a copy of Preferred; the review says keep it under Settings › Quoting and prices | 5 | [ ] |
| F-235 | Price book: items, preferred prices, suppliers, price lists, discounts, invoices read by Tiff, code letters, matching | Admin › Price book | Settings › Quoting and prices › Price book, Suppliers, Matching (A7) | 5 | [ ] |

## Outside the app and behind the scenes

### Pages outside the app

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-236 | Front door: Create account, Sign in, Staff HQ | / | / when signed out (rev 2); the door at its own address in step 3 | 8 | [ ] |
| F-237 | No workspace yet: accept your invite, or create a company | Signing in without a workspace | /start, a door card; it says one company per person (rev 32) | 8 | [ ] |
| F-238 | First-run company setup | After creating a company; Home sends unfinished owners | /welcome, the one first-run screen for a new owner (A14, rev 31) | 8 | [ ] |
| F-239 | First-run staff details | Home sends new staff here | Goes. Your name › Your card; To do: Finish your card (rev 31) | 5 | [ ] |
| F-240 | Accept an invitation, or see why it failed | Invite email; copy link; /start | /invite/accept and /invite/error as door cards; their targets move off /dashboard | 8 | [ ] |
| F-241 | Customer's live design page, with the airflow view once approved | The copied link | `/live/<token>`: the sheet stays, its chrome is redrawn | 8 | [ ] |
| F-242 | Project handover sheet, to print | Project page › Handover | `/handover/<id>`, re-pointed at the Project job; money held back | 8 | [ ] |
| F-243 | SWMS and certificate papers, to print | Job card viewer; SWMS sign-on | /swms and /certificates, one paper each | 8 | [ ] |
| F-244 | PDF print pages: certificates, letters, designs | Only the server opens them | /print/*, one copy of the signing code | 8 | [ ] |
| F-245 | HQ: businesses, users, data packs, catalogue edits, change log, system map | "Staff HQ" on the front door | HQ, as its own variant, last. Its own top bar waits (rev 4) | 8 | [ ] |
| F-246 (R) | Account linking turnaround | /link-account | Stays at /link-account | 8 | [ ] |
| F-247 (R) | The icons, brand files and link previews | icon.png, apple-icon.png, public/brand, the OG cards | Regenerated from the black and white mark, re-pushed to Auth0 | 1 | [ ] |
| F-248 (R) | The address proxy: Google address lookup, kept on the server | /api/address; the address field | A part: the address field and its suggestions | 2 | [ ] |

### Behind the scenes

| ID | Feature | Today | v2 home | Step | Done |
| --- | --- | --- | --- | --- | --- |
| F-249 | ServiceM8 sync and sending: nightly, plus 6 triggers | 6am east coast; on opening pages; Sync now | Stays. Sync now and its status in Settings › ServiceM8 and Xero | 5 | [ ] |
| F-250 | ServiceM8 live updates, off unless switched on | When ServiceM8 pings | Stays, behind the scenes | none | [ ] |
| F-251 | Sending to ServiceM8: files, notes, bookings, leave, jobs, customers, quotes | When someone presses | Stays, from where it is pressed; each switch in Settings › ServiceM8 and Xero | 5 | [ ] |
| F-252 | ServiceM8 mentions turned into tasks | After a sync | Stays; they land in Home › To do | 5 | [ ] |
| F-253 | AI reading: job summaries, notes, photos, receipts, licences, invoices | As used | Tiff: one engine over one registry | 5 | [ ] |
| F-254 | Library reading: uploads, scanned pages, the search index | From the Library page | Stays; its controls in Library › a document | 5 | [ ] |
| F-255 | Voice: record, then words; or words as you talk (a switch) | Every mic | A part: the box while it listens, a wave, no live words (rev 26). Recordings kept (rev 36) | 2 | [ ] |
| F-256 | Emails: invites, documents, the morning list | As sent | Outside the frame › the mail, one envelope | 8 | [ ] |

## Rows that need Isaac's call

17 rows. The plan gives each of these no home, or two. The build does not invent one: it asks.

| ID | Feature | The gap |
| --- | --- | --- |
| F-010 | Next job, J and K: walk the list a card was opened from | NO HOME: no plan row keeps it or drops it on purpose |
| F-027 | A notice's event: date, place, RSVP, comments | TWO HOMES: Team › Notices › Write a notice (an event) and Schedule › Add an event. One event record or two is unanswered |
| F-031 | The calendar's Year view and school holidays | NO HOME: which layers Schedule keeps, and what Show offers, is unanswered |
| F-063 | Files: upload, delete, open, tick to send | NO HOME: the Documents tab lists and sends, but "nothing is created there"; where a file is uploaded is unsaid |
| F-089 | Invoice a maintenance visit that has no job | NO HOME: what Invoice does on an unlinked visit is unsaid |
| F-097 | Reopen a finished project | NO HOME: done is the job completing, and reopening is never named |
| F-105 | Dates: promised finish, defects end (one task), milestones, hours allowed | TWO HOMES: Overview (P5) or the job's aside across every tab (S-project). The correction leaves both |
| F-108 | Jobs on this project: attach as quote, install, variation, service, other; detach | TWO HOMES: Linked jobs in the job's aside (S-project) or on Overview. The same open correction as F-105 |
| F-113 | Projects already in HeyTiff with no ServiceM8 job | NO HOME: rev 1 needs a ServiceM8 job, and the one-time move for these is unwritten |
| F-122 | A line's warnings: a breaker under the outdoor's current, a coil that doesn't match | NO HOME: To confirm goes. An orange word on the line, counted in the rail's Scope, waits for his yes (revisions) |
| F-129 | Ask a question: answer with page sources, from your library or general knowledge | TWO HOMES: Home's box with sources (1-main.md's merge table) and the Library's "Ask the Library" (H5) |
| F-179 | Xero wage-change notice, from the weekly pay-rate check | NO HOME: no board or flow places it |
| F-208 | Payment terms in days | TWO HOMES: Settings › Quoting and prices › Payment terms (A3) and Documents › Templates › Quote (D5) |
| F-209 | Expiry warning days | NO HOME: A3's title names it, but no Settings section holds it |
| F-213 | Account facts: owner, team count, plan | NO HOME: the review asks for a section and none is named |
| F-218 | Handover sheet and Project checklist templates (one shared list; a third starter list in Quoting) | TWO HOMES: Documents › Templates (D5) and Settings › Quoting and prices › starter tasks (A6) |
| F-234 | Quoting's component price picks: each part to its item and supplier; Override, Use lowest, roll length | NO HOME: A7 deletes it as a copy of Preferred; the review says keep it under Settings › Quoting and prices |
