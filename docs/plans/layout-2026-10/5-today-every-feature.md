# Today: every feature and every way in

The app as it stands on 12 October 2026, from a read of the code. Each row is something you can do or see, the ways you reach it today, and what's wrong with it. "›" means a click.

## Home and the menu

About 41,000 lines (12,700 of them one stylesheet) and 29,000 lines of tests. The menu has 11 items. "Needs you" alerts show in 6 places, a task can be marked done in 6, and the Tiff window has 9 or more ways in.

### The frame and menu

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Menu: Home, Workboard, Toolbox, Design, Library, Me, Team, Time & Pay, Assets, Analytics, Admin | Always on screen; folds to icons | Lists Action required and Noticeboard under Home, but neither is on Home |
| Search, "Jump to a screen" (screens, staff, clients, projects, jobs, photos) | Top bar button; ⌘K | Repeats the Workboard's own search. "Me" and "Timesheet" are two results for one page |
| Clock and date | Top bar | Home's title shows the same date |
| Tiff button | Top bar, every page | One of 9+ ways into the same Tiff window |
| Bell: reminders due (done, later), tasks given to you (done, got it), up to 20 expiry and approval alerts | Top bar | Same alerts as Action required, Home's list, Home's Calendar and the morning email. The bell and Home send the same alert to different spots |
| Your profile: details, emergency contact, licences, qualifications, signature, work rights, pay | Avatar › Profile; bell; Home's list; letter editor | Not in search or Tiff |
| Sign out | Avatar › Sign out |  |
| Switch organisation | None | Built, never shown |

### Home

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Home page, titled with today's date | Menu; search; Tiff "go home"; signing in; back links on 4 pages; morning email; about 40 "you can't see that" bounces |  |
| Your day bar: your bookings and timed tasks, or your next booked day | Home, top |  |
| Open a job from Your day | Your day › card › Open job | Home has its own copy of the job card |
| Diary: what you told Tiff and what it filed; edit, delete, undo | Home › Diary (default); doors from the list and Tasks |  |
| "Add to the diary" box: save as typed, or Sort it out with Tiff | Home › Diary |  |
| ServiceM8 mentions of you: reply, hide, make a task | Home › Diary; list row "X asked you"; Tasks › Open conversation | Reply opens ServiceM8 in a new tab |
| Tasks: open and done; mark done, move the date, give to someone, delete | Home › Tasks; a link from the bell |  |
| "Add a task" box | Home › Tasks |  |
| The list: Late, Today, Jobs to book, No date, Later (tasks, expiries, visits to book, won jobs to book, leftover bookings, issues) | Home, right side | Expiries repeat the bell |
| List buttons: Renew, Log service, Book in, Clear, Create job, Book | List rows | Book in exists in 4 places |
| Calendar: public and school holidays, company events, notices, renewals; 4 weeks, month, year | Home › Calendar only |  |
| Add or edit a calendar event | Home › Calendar box; event › Edit | Noticeboard events are a second way to add one |
| Action required: every alert as a tile | Search; Tiff; the bell's "N more" past 20 | Same as the bell. Not on Home or the menu |
| Noticeboard: notices, polls, events, comments, reactions | Search; Tiff; Calendar › Open notice | Nothing on Home links to it, nothing says what's unread, and an @mention tells nobody |
| Morning email: reminders and expiries | Daily email | Repeats the bell, on purpose, for people not in the app |

### Tasks, Tiff and calendars, across the whole app

- **Tasks** show in 10 places (Tasks tab, the list, Your day, two bell sections, the morning email, Maintenance Urgent, the job card's strip, diary doors, Tiff's reply). They're made 5 ways and marked done in 6. Install "tasks" on a job are a different thing with the same name.
- **Tiff's window** opens from the top bar, the Diary, Tasks and Calendar boxes, a diary entry's Tiff line, buttons on the visit, agreement, trip and project sheets (not the job card), and "Have a look" on about 10 note fields with a mic.
- **Other Tiff boxes:** the Library's own ask box (a second ask engine), the quote page's Tiff panel, the checklist's voice list, and photo readers for licences, vehicles, receipts, equipment and job photos.
- **Tiff can open** 19 screens and 4 kinds of record (staff, client, project, job). It can't open Home's tabs or your profile.
- **Calendars:** 11 views (Home Calendar, Your day, Schedule, Capacity, Maintenance Calendar, Projects Calendar, Me › Leave, Time & Pay › Leave, holiday settings, Noticeboard events, the date picker). Public holidays show in 3 of them.

### Not used, or can't be reached

- Organisation switcher and its action (63 lines), never shown.
- An old page renderer (5 lines) and an old tab-click handler, with its styles.
- About 114 style names in the main stylesheet that no code uses.
- Bits kept only for tests: the old Home summary, a notes counter, a poll helper, the old "what Tiff filed" wording.
- A Tiff "home" room that nothing sets, and comments describing a five-tab Home that no longer exists.

## Workboard

About 51,700 lines and 32,100 lines of tests. Three sides (All jobs, Projects, Maintenance) and 15 tabs. The job card opens 9 or more ways, and 23 things live in two or more places. None of the tabs has its own address, so nothing can link straight to one.

### The page

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Workboard, opening on All jobs › Schedule | Menu; search; Tiff (2 ways); project page back link; projects list back link; a project's agreement link; Home "won jobs with no day"; Home's "On the maintenance board" chip | 3 of these land on the plain board, not the thing they named |
| Side switcher: All jobs, Projects, Maintenance | Click the page title |  |
| Search the board: jobs, visits, agreements, projects, trips, photos | Search box on every tab; a client result from ⌘K | A second search beside ⌘K and Tiff's: 3 search engines |
| New job, sent to ServiceM8 as a Quote | Workboard › New job (managers, when sending jobs is on) | "Next" only adds words to the description, and nothing opens the new job after Create |
| Display mode, full screen for a wall | Workboard › Display mode |  |
| ServiceM8 sync status | Every tab's toolbar; again on the job card | Said twice |

### All jobs (6 tabs)

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Schedule: one day, a lane per person, ServiceM8 bookings | Workboard (default tab) |  |
| A booking's details › Open job | Schedule › block › Open job, or double-click | Two ways to one thing, on 5 tabs |
| Clear a leftover booking | Schedule › block › Clear booking | Also on the job card and Home: 3 places |
| "Also on this day": visits and project trips with no time | Schedule › shelf | A trip opens the project page, not the trip |
| Work orders: booked, and waiting on a day | All jobs › Work orders |  |
| Quotes: to price, waiting, going cold, over 6 months | All jobs › Quotes |  |
| Completed: last 8 weeks; awaiting payment; didn't go ahead | All jobs › Completed |  |
| Capacity: 4 weeks of how full each day is | All jobs › Capacity |  |
| Who counts toward a day (crew hours) | Capacity › Crew, or Set the crew | Two buttons, one form |
| Gallery of starred photos | All jobs › Gallery | A photo can be starred in 4 places |

### The job card

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Open a job card | Any list row (button or double-click), Schedule, Capacity, board search, ⌘K, Tiff, Analytics, a SWMS, the bell, Home | Two copies of the card, the Workboard's and Home's. Home's can't make an agreement |
| Invoices on the job | Job number menu; crumb; Billing row; Timeline payment | 4 ways to one window |
| Open in ServiceM8 | Card's top chip | Also on the visit sheet, project card, booking line and New job: 5 places |
| Make it a Work Order (writes to ServiceM8) | Top chip | Also a tick box in Book in |
| Create a project from this job | ⋯ menu | Also Projects › New project |
| Create a service agreement from this job | ⋯ menu | The address isn't carried over. On Home it only bounces you to the Workboard |
| "On this job": flags, flagged notes, mentions (reply, make a task, not work) | Top of the card | Clearing a flag is also on both Urgent tabs |
| Progress line (Enquiry to Paid) that opens each section | The card | Checklist and Quote can't be opened at all on work orders or declined quotes |
| Summary: an AI paragraph on where it's up to | Card's default section |  |
| Timeline: every note, visit, photo and payment; write on the job, copy to ServiceM8 | Rail › Timeline | Called "Timeline" in the rail and "Diary" at its top |
| Billing: value, balance, claims, payments, materials, "No deposit" | Rail › Billing (owner) |  |
| Photos by visit day, with stars | Rail › Photos |  |
| Files: upload, delete, open, tick to send | Rail › Files |  |
| Compliance: SWMS, certificates, licences, insurance | Rail › Compliance |  |
| Send to ServiceM8, or email the ticked documents | Tick files › footer; the certificate wizard | Two places |
| Contacts, and edit the customer (writes to ServiceM8) | Left rail › Contacts › Edit |  |
| Check in and out | Progress line only | Not in the rail |
| Book in: people, days, times (writes to ServiceM8) | Visits › Book in; task planner "Book visit N"; Look again; Home's Book in | 4 ways |
| Install tasks by visit: made from the quote by AI, ticks, photos, serial read off the plate | Progress line only |  |
| Checklist: materials and to-dos, typed or spoken | "Materials sorted" step only | Can't be reached on work orders |
| Quote: ServiceM8's quote PDFs; Create, Continue or Update quote | "Quoted" step only, managers | The only way to the quote page |
| Photo and document viewer | Photos, Files, Compliance, the wizards | Built into 5 different screens |

### Projects (4 tabs)

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Urgent: late trips, stuck projects, flags | Projects (default) | Nearly the same as Maintenance Urgent |
| Pipeline: projects by stage, and New project | Projects › Pipeline | New project opens a separate projects list, where a second New project button opens the form |
| Completed: mark done, reopen | Projects › Completed |  |
| Calendar › a day: place a trip, assign crew | Projects › Calendar | A copy of Maintenance's day window |
| Project card: summary, visits, money | Pipeline › a row | A second view of a project beside the project page |
| Trip sheet: gates, day, link a ServiceM8 job by typing its number, close out | 5 ways | Does the same things as the visit sheet, differently |

### Maintenance (5 tabs)

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Urgent: overdue, to confirm, no crew, flags, tasks | Maintenance (default) | "Close it out" opens a sheet staff can't close |
| Upcoming visits by week | Maintenance › Upcoming |  |
| Calendar › a day: place a service, assign crew | Maintenance › Calendar | A copy of Projects' day window |
| Completed, and Mark invoiced | Maintenance › Completed | "Invoiced" is only a tick in HeyTiff |
| Service agreements list | Maintenance › Service agreements; search; Urgent; a visit's chip |  |
| New service agreement, by hand or read from a ServiceM8 job by Tiff | Service agreements › New agreement; job card ⋯; a project's handover | 3 ways |
| Agreement sheet: pause, end, details, how often, equipment on site, tags | From the list | Crew size, service time, packing list and tags are editable in 2 or 3 places |
| Visit sheet: gates, day, link a ServiceM8 job, notes, history, close out | 10 ways | Still shows an old "Skipped" status |

### Not used, or can't be reached

- 15 helpers used only by their own tests, mostly from an older month grid and an older readiness model.
- An API route for quote rooms (48 lines) that nothing calls.
- Unreachable parts of the quote section and the documents section, kept for a layout no longer used.
- The projects list page: only reachable through Pipeline's New project, for managers.

## Projects, quotes and reports

About 35,500 lines and 15,500 lines of tests, of which about 2,200 lines never run. The quote page holds two separate quote builders. "Variation" means three things that don't connect. A project page has 14 ways in, but an archived project can only be found by typing its address. (The Projects tabs are in the Workboard section above.)

### Projects

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Create a project | Pipeline › New project › a list page › New project again; job card ⋯ › Create a project from this job | Two ways. The first detours through a page that exists only for that button |
| Projects list page | Only Pipeline's New project, for managers | Repeats Pipeline and Completed |
| Project page | 14 ways: Pipeline, the project card, Completed, Urgent, a trip, ⌘K, Tiff, board search, a job card chip, list rows, Schedule, Home, after creating, the list page | Its back link goes to All jobs, not Projects |
| Project card: summary, visits, money | Pipeline › click a row | A cut-down second copy of the page. Its visits include ServiceM8 diary days the page doesn't show |
| Block, unblock, hold, resume, mark done, reopen, archive | Project page, top | Mark done and reopen are also in Completed. Archived projects vanish from every list |
| Edit name, client and site | Project page › Edit |  |
| Stage: Quote, Approved, Pre-install, Rough-in, Fit-off, Commission, Handover, Complete | Project page › Stage |  |
| Trips to site | Project page; project card; Calendar; Urgent; Schedule | 5 places |
| Set up a service agreement at handover | Project page, at Handover or Complete | Its link afterwards opens the plain board, not the agreement |
| Money: total, claims, add a claim | Project page; project card; Pipeline column; Completed chip; handover sheet | 5 places |
| Scope: in the price, not in the price | Project page |  |
| Variations: add, approve, decline, claim | Project page | Not connected to quote variations |
| Dates: promised finish, end of defects (makes a task), milestones, hours allowed | Project page |  |
| Checklist by section | Project page; Tiff notes add "bring" items |  |
| Equipment on site, with the nameplate photo read by AI | Project page › Add |  |
| Jobs on this project: attach as quote, install, variation, service or other; detach | Project page | Jobs also link from a trip and from create-from-job: 3 ways |
| Link a design, Open Studio | Project page › Design | The only bridge to a customer's live link |
| Notes, site journal, commissioning readings, recurring issues | Project page; Tiff notes | Typed and Tiff both write each one |
| Documents and photos | Project page › Upload | These files show nowhere else |
| Handover sheet | Project page › Commissioning › Handover sheet | Print only: no email, no ServiceM8. Shows the contract total to staff without money access |

### Quotes

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Quotes worklist: ServiceM8's open quotes | Workboard › Quotes | Can't start a quote from it. Analytics repeats it |
| Quote section on the job card: ServiceM8's PDFs, HeyTiff's draft, Create, Continue or Update quote | Job card › "Quoted" step (managers) | Not on the rail. Can't be reached on work orders |
| Quote page | Only the job card's quote button | Not in the menu, search or Tiff |
| Tiff's proposal builder (the default): brief, draft, site questions, units, labour, proposal, approve, mark sent, mark accepted | Quote page | The older of the two builders. "Mark sent" only stamps a date; nothing reaches the customer |
| Lines builder: lines, kits, options, loadings, labour, compare units, versions, variations, approve, accepted | Quote page › Build it by hand, or Edit the lines by hand | The newer builder. It has no "sent" step |
| Tiff panel on a quote: questions with prices, conversation | Quote page, right side | A pilot, switched on per business |
| Price per option, and profit | Quote page |  |
| Send the accepted quote to ServiceM8 as a work order | Quote page › To ServiceM8 | One of 4 ways to make a work order |

### Reports and customer links

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Analytics overview: win rate, quoted, won, days to quote, price by job type, enquiries by week | Menu; search; Tiff | Its tabs have no address |
| Analytics › Quotes: when a quote counts as lost, review the lost, open quotes, tenders | Analytics › Quotes | "Open quotes today" repeats the Workboard list |
| Analytics › To decide: is it a quote, won or lost, does the price belong, what kind of job; make work orders | Analytics › To decide; the overview banner | Work orders can be made here too |
| How jobs are counted | Analytics › link; Admin › Analytics |  |
| Customer's live design link: 14 days, print, airflow view once approved | Design › Summary › Send › Create live link; project › Design › Open Studio | You copy and paste it yourself. HeyTiff never sends it |

### Not used, or can't be reached

- About 2,200 lines of whole files that never run: the quote-rooms route and the 900 lines behind it, four old quote templates, a quote test bench, a projections file.
- 19 exported functions with no caller, unreachable parts of the quote section, and a "from the design" money label nothing writes.
- The same print button, copied into three files.

## Library, Toolbox and Design

The biggest area: about 84,000 lines and 52,900 lines of tests. Design alone is 56,200 lines, a quarter of it styles. There are two separate "ask the manuals" engines, and only the Library page's shows sources. "Library" names three different things. Design works with one brand (Mitsubishi Electric) while its start screen lists four.

### Library

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Library page: ask box, document count, five shelves | Menu; search "library" or "manuals"; Tiff; All documents' back link; a document's "Ask Tiff"; Fault Finder's code lookup |  |
| Ask a question: answer with page sources, from your library or general knowledge | Library › ask box (type or speak) | Tiff's window also answers from the manuals, with a different engine and no sources |
| Ask about one document | All documents › a row's "Ask Tiff" | "Recently added" looks the same but searches the whole library |
| Open a source at the cited page | An answer's source chip |  |
| Saved chats: pick up, rename, delete | Library landing | Kept only in that browser |
| All documents: search, shelves, tags | Library › All documents; Recently added › Open all; a shelf card; search; Tiff; a diary door; Fault Finder | Tags filter 4 ways |
| Find a word inside a document | All documents › a document's title |  |
| Add documents: drop PDFs, title, shelf, brand, tags; large uploads (owner) | All documents › Add documents |  |
| Edit or remove a document | All documents › a row |  |
| Reading progress, retry, read scanned pages, page allowance, fill search gaps | All documents |  |
| Tags: create, rename, recolour, remove | All documents › Tags; while uploading; while editing | 3 places to create one |
| Field notes: what the crew taught Tiff, published from a Tiff note | Tiff's "Add to the Library" on any note | Removed 3 ways: the row, Admin's review queue, Tiff's Undo |
| Review field notes: looks right, take it down | Admin › Knowledge from the field (the only way in) |  |

### Toolbox (for the field)

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Toolbox: tool tiles, search, categories | Menu; search; Tiff ("toolbox screen" only); every tool's back link | The "New" and "Popular" badges never show |
| Heat Load: room size to kW and a unit class; advanced factors | Toolbox; Fault Finder's related tools and 12 outcomes | Same engine as Design's zone heat load. Its "design it in the Studio" link carries nothing over. No save or print |
| Running Pressures: expected pressures by refrigerant and temperature; troubleshoot from readings | Toolbox; Fault Finder's related tools and 15 outcomes | Overlaps Fault Finder. Has its own "Field notes" card, a clash with the Library's |
| Fault Finder: 16 symptoms, guided questions, the fix, what to tell the customer; code lookup in the Library | Toolbox | Its "related tools" repeat the Toolbox tiles |
| Outdoor Unit Placement: NSW council check, 13 rules, diagram | Toolbox; Fault Finder's related tools | No save or print |

### Design (office)

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Start screen: new design (from a ServiceM8 job or blank), recent designs, import a design file | Menu › Design; search "Design" (not "studio"); Tiff; Heat Load's link; the design menu's New and Open | New and Open both just return here |
| Open a design from a job or project | Job card › Files › a drawing; project › Design › Open Studio |  |
| Equipment library window: what's new, lineup by brand | Start screen › Library | Lists 4 brands; only 1 can be designed with. A third thing called "Library" |
| Plans: upload floor plans, pick pages, name them, stack floors | New design; menu › Edit plans; empty canvas | Floors are also managed from the canvas |
| Canvas: floors, scale, north, tape measure, crop, split, move plans, view options, legend, zoom | Toolbar, keys and pills | Scale and north each have 2 or 3 ways |
| Draw zones, then size them; zone window with heat load | Toolbar; keys; the Next chip | Same heat load engine as the Toolbox |
| Draw pipe, drain, cable, riser, joint, branch box | Toolbar › Draw; keys | "Duct" says "Coming" |
| Components: plenum | Toolbar › Component | 7 of 8 entries say "coming" |
| Notes on the drawing; unit callouts | Toolbar; keys; click a unit |  |
| Systems: add, design variations, cards, give zones, place units | Systems panel; the Next chip | Add a system has 3 ways in |
| System builder: units onto zones, unit browser with specs, compare, buy prices | 5 ways: Build, Edit, Next chip, U key, the zone window |  |
| Install details: questions, equipment list, note for the installer | 3 ways from a system card and the Next chip |  |
| Schematic for VRF systems: sizes, fittings | Schematic tab; the builder's Schematic switch | 2 places |
| Summary sheet: client, site, job, loads, systems, plans, materials; things to check; who worked on it | Summary tab |  |
| Link a ServiceM8 job; push the materials list to the job | Summary | Also linked when starting a new design |
| Share: PDF (print or download), plans as images, design file, customer live link, put the PDF on the ServiceM8 job | Summary › Share | Print and Download make the same PDF two ways |
| Airflow simulation for the customer, once approved | Canvas › Simulate; Summary › Simulate | 2 buttons, and a third unused one |
| Equipment data viewer for admins | Typed address only | Nothing links to it. A fourth view of the same data, beside HQ's editor |

### Not used, or can't be reached

- The Design data-library page (722 lines), with no way in.
- 8 "coming" placeholders in Design, and two system types (ventilation, sheetmetal) nothing creates.
- An unused simulation card, an unused pack index, a brand list for a picker that doesn't exist.
- About 30 functions used only by tests, mostly in the system builder (including 145 lines of split-system checks).
- Tiff probes and evals (947 lines) living inside the app's code.
- A page refresh aimed at a Library address that doesn't exist, and a Library allowance figure nothing shows.

## People, time and vehicles

About 39,800 lines, 6,700 lines of server actions and 30,300 lines of tests. Nearly everything here exists twice: once for "me" (Me) and once for "the team" (Time & Pay, Assets, Team). Tiff can open these pages but can't do anything in them: no "here's my receipt", no leave, no fuel.

### Me: timesheet, leave, expenses, vehicle, notes

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Me page with five tabs | Menu › Me (opens Timesheet); search; Tiff; five separate addresses | "Me" and "Timesheet" are two search results for one page |
| My timesheet: days, hours, overtime split, pay rules | Me; search; Tiff "my hours"; Time & Pay for staff; the "sent back" alert |  |
| Fill in a day: worked or off, start, finish, break | Me › Timesheet › a day |  |
| Overtime on one day (salaried) | A day's overtime button |  |
| Submit the period | Me › Timesheet › Submit; automatic at the set day and time | The automatic submit only runs when someone opens a timesheet page |
| My normal hours | Timesheet › Normal hours | "Normal week" is also set for the business and on the staff card: 3 places |
| Mark myself unavailable (casuals) | Timesheet › Availability |  |
| Upcoming public holidays | Timesheet; Me › Leave; Home's Calendar | Shown in 3 places |
| My leave: balances, request (with medical certificate), attach a certificate later, cancel, history | Me › Leave; search; Tiff; the "declined" alert; a day's "My leave" link | Labels for balances "synced from Xero, MYOB or QuickBooks" exist, but nothing syncs them |
| My expenses: scan a receipt (Tiff reads it), or enter by hand, against a job; cancel | Me › Expenses; search; Tiff; the "declined" alert |  |
| Fuel receipts | Scanning a fuel receipt in Expenses sends you to Vehicle › Log fuel | Fuel can be logged from 3 doors. Fuel paid with your own money also makes a claim |
| My vehicle: details, fuel, issues, services; log fuel, update odometer, report an issue, fix my own entry | Me › Vehicle; search; Tiff; Assets for staff; vehicle alerts; Home's list | Uses an older set of forms than the vehicle card, for the same jobs |
| My private notes: add, dictate, edit, archive | Me › Notes; search; Tiff; a diary door | "Notes" also means notes on a staff card, and the diary |

### Time & Pay (the team)

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Team timesheets: needs review, waiting, ready, approved | Menu › Time & Pay; search; Tiff; Xero's "Time & Pay settings" link | The same day view as My timesheet |
| Approve one, approve all, send back with a question | Time & Pay › Timesheets |  |
| Xero wage-change notice | Foot of Timesheets (weekly check) |  |
| Pay settings: pay cycle, week start, standard day, normal hours, breaks, overtime, weekend and holiday rates, medical certificate rule, super, salaried overtime, auto-submit | Time & Pay › gear |  |
| Pay run export | Time & Pay › gear | Says "Not built yet". No timesheet export exists at all |
| Match people to Xero payroll | Time & Pay › gear › Xero payroll | Also in Admin › Integrations › Xero |
| Public holidays: add, remove, restore | Time & Pay › gear › Public holidays (the only way in) |  |
| Team leave: approve or decline, set balances, who can't work | Time & Pay › Leave; the "leave waiting" alert | The alert shows to approvers who can't open the page, so they bounce to their own leave |
| Team expenses: approve, decline, mark paid | Time & Pay › Expenses; the Expenses tile on Timesheets; the "claims waiting" alert | The same bounce. "Owed" money shows on the tab to people the tile hides it from |

### Assets

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Fleet register: search, sort, filter, fleet value, "Value with Tiff" | Menu › Assets; search; Tiff |  |
| Add or edit a vehicle: rego certificate read by Tiff, specs, purchase, assignment | Assets › Add vehicle; a row's menu; the card's Edit | Status, driver, odometer, purchase, value and service cycle are also edited on the card |
| Vehicle card: photo, status, odometer, next service, driver, renewals, history | 9 ways: row click, row menu, info icon, a staff card's van, alerts, Home's list, Home's Renew and Log service, the calendar |  |
| Renewals: rego, insurance, CTP, scanned by Tiff | Card › a renewal; alerts; Home; calendar | The first rego is also in Add vehicle |
| Money: value, purchase, invoices, finance agreement, running cost | Card › money | Purchase and value are also in the form |
| Log a service | 4 places: card › Log, row menu, Services screen, Home's list |  |
| Log fuel, issue or odometer | Card › Log; also My vehicle | Odometer can be set in 4 places |
| Equipment & tools | Assets › Equipment & tools | An empty placeholder: nothing behind it |

### Team, staff cards and access

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Team list: active, compliance gaps, pending invites, archived | Menu › Team; search; Tiff; a staff card's breadcrumb; Organisation's Team link; 3 links in the Rate Calculator |  |
| Open a staff card | Row click, name link, row menu › View profile; search; Tiff "open Dane's card"; licence alerts | 3 ways inside one row. Your own card also opens two ways: Profile, and Team |
| Invite staff, resend, revoke, copy link | Team › Invite staff; a row's menu; Pending invites | Needs the invite right and the Team page right |
| Make a staff card | Accepting an invite; Team › Create card; importing from ServiceM8 or Xero | 3 ways |
| Deactivate or reactivate | Team row menu; staff card › Personal › Status | 2 places |
| Staff card: overview, photo, van, personal, nicknames, emergency, payroll (wage, basis, hours, super, cost split), notes about the person | Staff card sections | Employment type is set in 3 places, wage in 2. Nicknames are typed or learned from notes |
| Licences and tickets: scan with Tiff, renewals, history, documents; qualifications | Staff card › Licences; alerts; Home's list |  |
| Work rights: the old form, and the newer checks with evidence | Staff card › Work rights | The old form is locked once any check exists |
| Role and permissions: Staff, Admin, Owner; individual rights | Staff card › Permissions |  |
| Expiry alerts for licences, work rights, rego, insurance, CTP, service | Bell; Action required; Home's list; morning email; Team's Compliance gaps | The bell and Home send the same alert to different places. The email has one link to Home, not to the item |

### Not used, or can't be reached

- A staff-only branch of the Assets page that can't be reached, and two blocks of the vehicle screen that only it used.
- The Equipment tab, the Pay run export setting and the Xero, MYOB and QuickBooks leave labels: all placeholders.
- The old work rights form.
- Leftover comments from retired "Remind me" buttons in 12 files, and three comments pointing at a deleted file.
- A dozen unused functions, an unused permission rule and a duplicate roles file.

## Admin, settings and documents

About 39,500 lines and 22,900 lines of tests. Admin has 10 working rows and 7 "coming" rows that go nowhere. Search and Tiff know "Admin", but none of the pages inside it. A certificate or SWMS can only be found again from its own job: there is no list of either.

### The Admin menu

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Admin menu: Business, Tools, Owner | Menu (admins); search; Tiff; back links on 9 pages | Searching "compliance" or "documents" finds it, but both are only "coming" |
| Seven "coming" rows: Compliance, Documents, Licences & insurances, Training & apprentices, Password vault, Billing, Usage analytics | Not clickable | Licences & insurance already works under Organisation. Your plan already shows under Account |

### Organisation

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Company: logo, document colour, trading details (ABN, GST), contact and address | Admin › Organisation › Company | The same as the first-run setup form, which writes the same fields |
| Preferences: payment terms in days, expiry warning days, morning email on or off | Organisation › Preferences | "Payment terms" is also a different setting on the quote template |
| Company licences and insurance: add (Tiff reads the certificate), renew, history, delete | Organisation › Licences & insurance; the bell; Home's list; Home's calendar | The bell opens the wrong tab; Home opens the right one |
| Account: owner, team count, plan, hand over ownership | Organisation › Account |  |

### Integrations

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| ServiceM8: connect, disconnect, sync now; what HeyTiff may send (files, notes, bookings, leave, jobs, customers, quotes); what it reads; link people; permissions | Admin › Integrations › ServiceM8; 2 bell alerts; Workboard's "Connect ServiceM8"; Home's "Link yourself to the crew"; the job card's "link people"; Analytics | Workboard's link shows to admins but the page is owner-only, so they bounce to Home. A retired "trial run" mode lingers in the code |
| Xero: connect, choose the organisation, link or import payroll people | Admin › Integrations › Xero | Linking people is also in Time & Pay settings |

### Templates and letters

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Templates list: Quote, Handover sheet, Documents email, Letterhead, Certificate, SWMS, Project checklist | Admin › Templates; Organisation › "View on templates" | Staff can only open it by typing the address |
| Quote template: notes and payment stages | Templates › Quote | How a quote looks is split between here and Quoting |
| Handover sheet and Project checklist | Templates | Both edit the same checklist, so resetting one resets both. A third starter list is in Quoting |
| Documents email wording | Templates › Documents email |  |
| Letterhead: logo, details, footer, closing, signature | Templates › Letterhead; Letters | Only letters use it. SWMS, handover and quotes use a fixed letterhead |
| Approve the certificate wording (owner) | Templates › Certificate; the bell; the certificate wizard; an old address |  |
| Approve the SWMS steps (owner) | Templates › SWMS; the bell; inside the SWMS wizard; an old address | Two places to approve |
| Letters: list, new, write, download PDF, delete | Admin › Letters | Can't be emailed. "Draw your signature" opens your profile, not the signature |

### Certificates and SWMS

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Commissioning certificate: 5 steps (job, equipment from the quote, the certifier's list read by Tiff, checks, sign), issued as a PDF on the job | Job card › Compliance › Create certificate | No list of certificates anywhere |
| Send a certificate: email, to ServiceM8, download, share | Straight after issuing; job card › tick › footer | Two places |
| Reissue or delete a certificate | Job card › the certificate |  |
| SWMS: 4 steps, issue, revise | Job card › Compliance › Create SWMS | No list. Can't be emailed or sent |
| SWMS sign-on: read, sign, raise an issue, sign others on, mark it sorted | 2 bell alerts; job card; after issuing; an older version | A second page per SWMS just for printing |
| Your drawn signature | Profile › Signature; certificate wizard › Sign | Two places |

### Money tools (owner)

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Tax & EOFY: spend, GST and receipts by financial year; export CSV | Admin › Tax & EOFY |  |
| Rate Calculator: staff, costs, vehicles, risk, profit; results, insights, settings; costs pulled from Xero | Admin › Rate Calculator | No way back to Admin. Rate, hours in a day, state and super are also set elsewhere |
| Quoting: charge-out rate, hours in a day, markups, allowances, task hours, starter tasks, ductwork default, what the customer sees, preferred items, ranges, habits, kits | Admin › Quoting; a quote's "Set in Quoting" | Rate and hours in a day repeat the Rate Calculator |
| Price book: items and preferred prices; suppliers, price lists, discounts, invoices read by Tiff, code letters; matching | Admin › Price book | "Make preferred" is also in Quoting |
| Analytics settings: how jobs and quotes are counted | Admin › Analytics; Analytics › "How jobs are counted" | Same name as the Analytics page |

### Not used, or can't be reached

- The 7 "coming" rows, and an empty-state message no one can see.
- Two old addresses kept only to redirect (the certificate and SWMS templates).
- A ServiceM8 test route (227 lines) whose own notes say it's "meant to be deleted".
- The retired "trial run" mode, old example data in the Rate Calculator, two unused number formats.
- Five old company columns in the database, waiting to be dropped.

## Outside the app and behind the scenes

About 10,000 lines of pages outside the dashboard, 46 API routes (5,000 lines), 83 files of server actions (26,200 lines) and about 33,000 lines of background work. 20,300 of those lines are the ServiceM8 connection. Two routes are never called.

### Pages outside the app

| Feature | Ways in today | What's wrong |
| --- | --- | --- |
| Front door: Create account, Sign in, Staff HQ | The web address | A signed-in visitor still sees Create account |
| No workspace yet: accept your invite, or create a company | Signing in without a workspace |  |
| First-run company setup | After creating a company; Home sends unfinished owners here | Same fields as Admin › Organisation |
| First-run staff details | Home sends new staff here | Same as your profile's details. Loads the whole 12,700-line stylesheet for one address box |
| Accept an invitation, or see why it failed | Invite email; Team's copy-link button; the no-workspace screen |  |
| Customer's live design link, with the airflow view once approved | Design › Summary › Send › copy the link | One of 3 separate ways a design is drawn |
| Project handover sheet, to print | Project page › Handover |  |
| SWMS and certificate papers, to print | Job card viewer; SWMS sign-on | Two pages each for the same document |
| PDF print pages for certificates, letters and designs | Only the server opens them | Three copies of the same signing code |
| HQ, HeyTiff's own console: businesses, users, data packs, catalogue edits, change log, system map | "Staff HQ" on the front door | The system map is out of date. It shows each business's sign-in email instead of its name |

### Behind the scenes

| What runs | When | What's wrong |
| --- | --- | --- |
| ServiceM8 sync and sending | Nightly at 6am east coast; also on opening Home, Workboard or the ServiceM8 screen, after a send, on Sync now, on connecting, and on live updates | 6 triggers for one job |
| Morning reminder email | Daily |  |
| Xero pay-rate check | Weekly |  |
| ServiceM8 live updates | When ServiceM8 pings | Off unless switched on |
| Sending to ServiceM8: files, notes, bookings, leave, jobs, customers, quotes | When someone presses | Each kind has its own switch |
| ServiceM8 mentions turned into tasks | After a sync |  |
| AI reading: job summaries, sorting notes, photos, receipts, licences, invoices | As used (28 files call Claude) |  |
| Library reading: uploads, scanned pages, the search index | From the Library page |  |
| Voice: record, then turn into words; or words as you talk | Every mic | Words-as-you-talk is behind a switch that is off unless set |
| Emails: invites, documents, the morning list | As sent |  |

### Not used, or can't be reached

- A quote-rooms API route (48 lines) and about 900 lines of quote code only it uses.
- A ServiceM8 test route (227 lines) its own notes say is "meant to be deleted".
- Four old quote templates (611 lines) and a projections file (62) used only by tests.
- Test and benchmark tools living inside the app: the voice comparison (982 lines), Tiff probes (854), the quote bench (566), evals (93).
- An unlinked Design data-library page.
- About 130 exported functions nothing calls, and two small unused files.
