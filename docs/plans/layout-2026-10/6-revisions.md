# Revisions, 17 and 18 October

Read this after `HANDOVER.md` and before the other files. It records what Isaac decided after the plan was exported, what the build assumes where he hasn't answered yet, and which of the review's corrections the build follows. Where this file and an older one disagree, this file wins; the plan doc on claude.ai has not been updated with it.

The mock-ups for everything below are at https://claude.ai/artifact/Ez9ak2XsHSWCFiv5269rTe (Quote Page, Today and v2). The build's progress is at https://claude.ai/artifact/J94ixCs2UpM5cRrGVK8DMS.

## Where it stands

- **Version 1 is tagged.** `v1.0.0` is on GitHub at `4978e9c3`, the app before any v2 work.
- **The handover is on main** (#1169).
- **v2 is built on the branch `v2-layout`.** Nothing reaches main, and so production, until Isaac says to merge. Main keeps taking v1 work from other sessions; `v2-layout` merges main in as it goes.
- **The data rule holds.** Until v2 has settled, a migration only adds. The migrations since the handover each add a table: `reply_drafts` (18 October), and `tiff_threads` (18 October, on the branch v2-conversations, NOT YET APPLIED), which keeps Tiff's threads per person; until it is applied they stay in the browser.

## Isaac's answers

**Decisions 1 to 11 of the review list (17 October).**

1. **Projects are normal jobs.** A project is quoted and turned into a work order in the usual ServiceM8 way. Marking it a Project in Tiff only adds tracking: the stages, the dates and the linked jobs. There is no separate way to start a project, and no HeyTiff-only project job. This replaces the review's choice between HeyTiff-only projects and required job-sending.
2. **`/` is the door signed out and Home signed in.**
3. **Principle 8, "Off means gone from the menu", is dropped.** A part a business doesn't use shows its empty view (rule 40). No setting is built for it.
4. **HQ's own top bar waits** until HQ is rebuilt, last.
5. **Type size 20 stays** for a dialog's title, a figure beside the big one, and a screen title on the phone. The scale is 12, 13, 14, 16, 20, 24, 32.
6. **The rings' cycle** is the boards' order: blue, purple, pink, red, orange, yellow, green. Grey is not in it. Listening and working look the same.
7. **The mark is still at rest.** It turns only while Tiff is busy. Rule 8 changes to: black and white at rest, black on the page and white on the ink, still; while Tiff listens or works it turns and its rings run through the colours.
8. **The mark in email is the word only,** with no image, because Gmail on Android inverts images.
9. **The sign-in page's hover keeps its colour,** and the custom page template goes.
10. **A business's colour field is typed hex with a swatch,** not the operating system's picker.
11. **Search's last row and the phone's bar show the mark with "Tiff".**

**Also decided on 17 and 18 October.**

- **The teal leaves everywhere:** the app, the sign-in page, the emails, the icons, the link previews, HQ and the live design link. A business's own document colour is its own and is never snapped to the palette.
- **The job's stages line lives on Overview only.** On every other tab the stage is one grey word after the address. Isaac: "the job progress stepper should probably move to the overview page so it doesn't take up an entire row at the top of the job card."
- **A job's page head has no breadcrumb.** The open tab and Jobs in the sidebar say where you are. The head is the name, one line under it, and the section tabs.
- **The quote's progress sits small at the top of the rail** (layout C, his pick on 18 October). Only the job's name and the section tabs sit above the conversation. The Conversation and Line items tabs go; the rail's View line items and Back to the conversation switch between them. View quote sits in the rail beside it, and Approve joins them, blue, once the quote is priced.
- **The Quote tab opens on a landing, "Quotes"** (his ask on 18 October, replacing my "no start screen"):
  - Nothing yet: Create a quote (main) and Update ServiceM8's quote (second), with ServiceM8's quote and its PDF below.
  - In progress: one card per quote with its name, version, total so far, a state word, who is working on it with Tiff and when, and Continue.
  - After acceptance: the quote's versions and variations under it, newest first; Continue on the open one, Open on older ones (read-only), Start a variation.
  - New quote starts a second, separate quote on the same job. Options stay inside a quote.
  - Versions and variations have one home, this landing. Inside a quote the rail names the version or variation, with All versions to go back.
- **Versions and variations** stay as the code has them. Before acceptance, a change to an approved or sent quote makes the next version; the last is kept as sent. After acceptance the accepted version is locked, and each change is a variation priced as the difference. A variation never becomes a version.
- **The empty conversation is worded for the way in.** The heading, Tiff's line, the reply box's placeholder and what she reads ticked follow the button pressed:

  | From | Heading | Her line | The box says | She reads first |
  | --- | --- | --- | --- | --- |
  | Create a quote | Tell Tiff about the job | She reads what's ticked with your brief, lays out the scope, and asks about anything she can't tell. | Tell Tiff about the job | The job's description and notes |
  | Update ServiceM8's quote | What's changing from ServiceM8's quote? | She starts from the quote ServiceM8 sent on {day}, {value}. Tell her what's different, or send it as it is and she'll rebuild it line by line. | What's changed | ServiceM8's quote |
  | Update quote, before acceptance | What's changing in version {n}? | Version {n-1} stays as it was sent on {day}. Tell her what's different; she lays the scope out again with the changes marked, then prices it. | What's changing | The last version |
  | Start a variation | What's the variation? | Version {n} was accepted on {day} and stays as it is. Tell her what the client wants added or taken out; she prices the difference, and once you approve it, it goes to ServiceM8 as its own job. | What the client wants changed | The accepted version |
  | New quote | What's this quote for? | It's separate from the accepted quote, and is priced and sent on its own. Tell her what it covers. | Tell Tiff what it covers | The job; the accepted quote unticked |

  Build it by hand instead is on every one.
- **While Tiff works,** her work sits in a message under her name and time. The heading says what she's doing now ("Changing the grille line", rule 49); finished steps are grey and the current one ink. Send fades until she's done. When she's done the run folds to "Worked through it, N steps" (his pick on 17 October). One fold per turn: a question she asks no longer cuts the run.
- **Her mark's rings show while she works.** They are drawn a little thicker then, so the colour reads at 24 px.
- **Unsent words in a reply box are kept on the server, per person** (his option 2, 18 October). Built for the quote's box on main: `reply_drafts`, `/api/drafts`, `useReplyDraft`. Other boxes join by adding to `DRAFT_BOXES` and the table's check.
- **New makes a Job and a Task** (18 October). Quote: "Quote should just live in the job section, you need a job before a quote." Task: "keep tasks in the new button, have job selection and due section. That way on a job it automatically goes on the job, from home it's a general task and from tiff it can do either." The task form asks what needs doing, one task a line, so a list makes several in one go ("Can you add multiple tasks in one go?", yes), the job (filled in on a job's page, clearable), when (a day, and a time to have it done by), and who (you, unless you give it to someone). A task's job is the column `tasks.sm8_job_uuid` (docs/migrations/tasks_job.sql). Rules 3 and 44 say so.
- **Tiff's button leaves the header** (18 October): "I don't think we need it in the header anymore. Home page will do it all." The header is the date and time, then open tabs. Her box is on Home; a sheet or a box keeps its own Tiff button.
- **The forms keep today's engines** (18 October, on the forms board). Every v2 form is a new layout over the action that does the job today, and does everything today's does. New job has no Next: it just saves. Its "Came in by" includes Existing customer, matched to a client already here. Add cost and Claim an expense start by scanning the receipt, read by today's receipt reader, with the fields filled for checking. Add a vehicle does what today's does, the rego read by Tiff included.
- **A vehicle's own page** (18 October, "Looks good", on https://claude.ai/artifact/1TsCU57DX81zB311Rhj8Hs): Team › Vehicles › a vehicle. The head is its name and rego, one line (driver, kilometres, model) and its state as a word, with Add (Service, Issue, Kilometres, Document; fuel through Claim an expense) and Actions (status, remove). Sections: Overview (Latest, one of each kind; Where it stands, with Renew rego and Renew slip; Details), Service, Issues, Kilometres (a line and a table), Fuel, Documents, Money. Today's vehicle engines underneath. Boards in `shots/v2-board-vehicle-*.png`.
- **Nothing on a quote has a Save button.** Everything saves as it happens, and the one gap, unsent words, is closed above.

## What the build assumes until Isaac answers

These are my recommendations from 17 October. The build follows them; any he changes are redone.

12. New is a list (NJ-1).
13. In a job's conversation, notes, tasks and costs just happen. Anything to the customer, any price change, any delete, and a visit with no clear time is drafted and asked first.
14. A note sends Tiff's summary to ServiceM8, not every word.
15. Money in a job's thread is held back on the server for people without money access.
16. A job's main button follows its stage: Make a quote, Send the quote, Book a visit, Invoice.
17. A project's other ServiceM8 jobs are linked under its main job.
18. Agreements come from Jobs › Agreements, private notes live in Conversations › Only me, your vehicle sits on your card, events come from Schedule.
19. The canvas's archive page stays until phase 5 is done.
20. The Library keeps its name, with the field tools as a shelf.
21. ~~A variation goes to ServiceM8 as its own job, linked under the original.~~ **Answered 18 October: an approved variation goes to ServiceM8 as extra lines on the original job.** (Recording how the client agreed to a variation is still recommended.)
22. Photos taken in HeyTiff go to the ServiceM8 job automatically.
23. Photos are read at once when someone is waiting, overnight for photo search.
24. No redirect pages; an old address lands on Home.
25. The bell goes; its count sits on Home in the menu; the morning email stays.
26. Words don't appear while you talk; the box shows a wave.
27. Hours on site and hours of leave stay number fields; only clock times use the wheel.
28. Home has no notices card; a new notice shows in To do until read.
29. A notice event shows on the Schedule.
30. The handover sheet has no Signed status.
31. One first-run screen for a new owner; the staff details page goes.
32. One company per person, said on the start page.
33. The your-name menu drops Help and adds Sign out.
34. The sidebar doesn't fold; its collapse icon goes.
35. Design's start screen keeps Import design file and the equipment library beside New design.
36. Note recordings keep their audio, so a note can be played back.

**The quote page's points Q1 to Q10** (17 October) are assumed as recommended, with layout C, the landing and the wording above in place of Q8's corner and Q9's view tabs:

- Q1 the conversation in the middle, the quote in the rail;
- Q2 her questions numbered in her message, with nothing to tap;
- Q3 the main button blue;
- Q4 the profit as a figure and a state word, with no box;
- Q5 an item to settle marked with an orange dot and its number;
- Q6 the reply box sends with a blue Send that carries its word;
- Q7 the steps Brief, Scope, Priced, Approved, Sent, Accepted;
- Q10 the parts with no screen built now on main, and the quote's screens in phase 5.

The warnings that a line doesn't fit (a breaker under the outdoor's current, a coil that doesn't match the unit) need a home once the To confirm list goes: an orange word on the line, counted in the rail's Scope. That waits for his yes.

## The review's corrections the build follows

All of them, as written in `4-review.md`, "Corrections to the plan", except where Isaac's answers above replace one:

- the contradictions table's corrections, with Contacts as a Customer group on Overview and Reports shown by permission;
- the rows that were wrong (quote rooms, Trial mode, the attachment-probe route, the Agreements filter, the fake-success bug's step, live transcription, the tools folder, the model section, principle 8 dropped, rule 18 rewritten as "its category's colour, snapped by hue; no hue means grey");
- the subjects the plan never mentioned, each in the step the review gives it;
- "The order that works", which replaces the build plan's phase order.

Rule 8 and rule 18 are rewritten in `docs/design.md` in step 0b.

- **Schedule is horizontal, with Jobs on the right** (18 October; boards https://claude.ai/artifact/4fHAC4CzbhfueDnEJsMhN4). Isaac: "I think build this and I'll test." Day and Week, a row per person, time across (ServiceM8's Day by Staff and Week Rows, Simpro, Skedulo); Month comes later. Jobs sits on the right as ServiceM8's dispatch board keeps it: To book, Recent, All, and a search. You drag a JOB onto a person's row, never a person: picking one up lights its hours in each free person's row ("free from 10" where part free; booked and away fade), and dropping it books that person through Book in's own engine (readBookInContext, then bookJobIn), with Undo on the toast (takeBackBooking). Click a job, then a row, does the same. In Week a job takes a number of days (1 to 5, weekdays only), and someone away for some of them is asked: the days they're free, or Cancel. A Quote booked stays a Quote (a quote visit). Considered and dropped on the way: staff as columns, the jobs-only day with a People panel, a "Not booked yet" lane (a job can't be saved without someone on it). Recurring days off (TAFE, RDOs) belong on a person's page, beside their normal hours and days; not built yet.

- **Step 7, the phone, leaves this build** (18 October). Isaac: "Step 7 not needed. I'll do phone layout in another session." This plan is the desktop; the phone layout is its own piece of work.
