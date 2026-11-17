# HeyTiff design

The rules, the palette, the scales, and the numbers that hold them. Read this before touching a stylesheet or anything a person sees.

This is the v2 file, written on 18 October 2026 from the layout plan's design rules (`docs/plans/layout-2026-10/3-design-rules.md`) and Isaac's answers since (`6-revisions.md` in the same folder). The file it replaces, with the history of every decision since 10 September, is `docs/design-log.md`. The boards that draw the rules are on the canvas, https://claude.ai/artifact/XF4jr8qxfbr7nR8E59q4xT, pages 1 to 9.

When two sources disagree: Isaac's own words win, then this file, then the canvas pages 1 to 9, then the plan's main tab.

**Moving from v1.** The rules below describe v2. Until step 1 of the build lands, the old tokens are still on `:root` and the screens still wear v1's dress; the ratchets count every place v1 breaks a rule, and those counts fall as each step lands. The order of the build is in `docs/plans/layout-2026-10/4-review.md`, "The order that works".

## Rules 1 to 21

### The frame

- **1. The page and its two curves.** Ink sidebar; a plain white page. The page curls into the ink at its top left, and the ink curls back into the page at its foot: 40 each, square everywhere else.
- **2. The header.** The date and the time together on the left of every page; open tabs on the right.
- **3. New.** At the top of the sidebar, a white disc and the word. Jobs, tasks and notes are made here (rule 44); what belongs to a record comes from its Add (rule 54).
- **4. Search.** Under New, the word alone (no ⌘K beside it, Isaac, 20 October). Finds any record; its last row asks Tiff.
- **5. The eight places.** Home, Conversations, Jobs, Schedule, Documents, Library, Design, Team. Stock stands ninth for now, after Schedule, as its mock drew it (https://claude.ai/artifact/WQ1yppLgALMhXbHM5XWLDq), built on 11 November 2026 on "Don't wait for my answers. Just build"; whether it stays a place or moves under Team is his call. Design is the Studio's list of every design, to show a customer or look one up; it left on 28 October 2026 and came back the same day (Isaac: "keep a design section somewhere like in the app. When you hit more, you can hit design and you can view previous designs"). The one you're on is white at 12% with its label in bold. No number beside any of them.
- **6. Pinned and Recents.** Stay in the sidebar under the places; a job shows its colour dot.
- **7. Your name.** At the bottom: your card, timesheet, leave, expense claims, your vehicle (only for someone with one assigned) and notes, Reports and Settings, then Sign out. Each is a page of its own: no strip of tabs between them (Isaac, 24 October 2026). Reports shows to whoever holds the permission each report needs.
- **8. Tiff's mark.** Black and white at rest, and still: black on the page, white on the ink. While Tiff listens or works it turns, and its rings run through the colours in the boards' order: blue, purple, pink, red, orange, yellow, green. Listening and working look the same. The one exception is Home's mark over her box, 96 across: it turns in her colours all the time, and faster while she works (Isaac, 20 October: "move at all times, even in standby, and then it can just go faster when it's spinning").
- **9. The wordmark.** HeyTiff in one colour. The teal leaves the app.

### Tabs, desktop only

- **10. Open tabs.** A thin outline round each; the one you're on outlined in ink. A cross on each. Tabs replace today's dock of set-aside cards.
- **11. New tab.** Shows when one page is open; opens Search in a new tab. Two tabs never show the same page.

### Type

- **12. Screen titles.** 24, semibold (600, down from 700).
- **13. Reading and writing.** 16 for anything you read or type: notes, the box, Tiff's answers.
- **14. Everything else.** Body 14, labels 13, captions 12 (the floor). Figures in columns line up. One big figure (32) per screen at most. 20 is for a dialog's title, a figure beside the big one, and a screen title on the phone.

### Colour

- **15. The eight.** Red, orange, yellow, green, blue, purple, pink and grey, each with a bright value and a darker one for words. Plus ink, white and one quiet grey: 19 values in all. A job's card adds three: orange `#EA580C`, yellow `#EAB308` and pink `#DB2777` fill its number box, a step deeper than their brights, as the word values read brown there (Isaac, 6 November 2026: "the oranges, they look very browny"). They are for that box and its hairline alone, and for a Studio system's colour (rule 18a); words keep the word values.
- **16. Red only means wrong.** Overdue, failed, unsuccessful. A job ServiceM8 marks red is unsuccessful, so it keeps its red. No chart or pipe is red. A Studio riser is the one exception: a red disc with DR or PR on it (Isaac, 1 November 2026).
- **17. State is a word.** Good in green, needs a look in orange, wrong or late in red: a word in its colour, a dot where a list wants one. For your information is a grey word and a grey dot, so blue only ever means press. Never a pill or a fill. A dot always sits beside a word that says what it means. The one blue that isn't a press: a person on the workspace, named in the box as you type or say it, turns blue (`--named`), as the phone's box has them (Isaac, 11 November 2026, "Ok good" to https://claude.ai/artifact/DLB79MYBR5eW1NAQYL4rK9, blue as the phone).
- **18. A job's colour.** Its ServiceM8 category's colour, snapped to the eight by hue; a category with no hue is grey. A dot beside its name everywhere. No washes, no edge lines. Two statuses go over the category: red follows Unsuccessful and orange a Quote (Isaac, 6 November 2026: "Quotes should be orange"). So no category is red or orange: one that snaps to orange is pink ("Pink"), and a booked job is never taken for a quote.
- **18a. A Studio system's colour.** The values a job's card wears, in the order a design's systems are made: green `#15803D`, pink `#DB2777`, purple `#7E22CE`, yellow `#EAB308`, then blue `#2563EB`, last as blue is the press. Never red, a riser and what's wrong; never orange, a zone no system has claimed; never grey. Words in a system's colour take the hue's word value. A design made before 7 November 2026 takes them when it opens, its first system green and its second pink (Isaac, 7 November 2026: "Follow the lead of job card session. Stick to our pallete").
- **19. Schedule cards.** A booking is a white card in a hairline of the job's colour, its job number in a solid box of that colour on the left, white on it, ink on yellow (Isaac, 23 October: "the job number in a coloured box, a coloured hairline, the rest white"). Three lines at 12: the client; the suburb; the job's type, its start time, a person and how many are booked, and where it's up to. A done card's colour goes grey, its client and type go quiet, and on the phone it carries a big green tick on the right: a 30 disc in green's word value with a white tick, in place of the word, despite rule 17. A booking is done once the time on it that day has ended, every stretch of it, or its job is completed: a quote visit leaves its job at Quote (Isaac, 12 November 2026, "A, big green tick" to https://claude.ai/artifact/AD6ngYPJTcZNPnVk6BJZXT). Two bookings at once stack in the lane, each with an orange edge, and "Two at once" under the person's name. The colour is the job's word value, but orange, yellow and pink take their card values (rule 15); blue is the press blue. The Jobs list draws its Job column as the head of a job's page, not as this card: the number at 16 in the page head's 40-high square of the job's colour, with no hairline, then the client in bold over the kind and the suburb on one line, so the client and the kind are not columns of their own, and whoever is on the job is named by first name under Next, not as a column of initials (Isaac, 17 November 2026, the first-look fixes, https://claude.ai/artifact/7ijojbkVbMJUGasurPCvVF; before it, 8 November's job-card list on https://claude.ai/artifact/ETHPi3KobpjSLS8nAjMXS7).
- **20. Charts.** The kinds of job in the eight, in a fixed order; ventilation grey. A coloured mark always has its figure or name beside it.
- **21. Timesheet days.** A dot and the hours for a day worked. A day away is a small white card with a symbol: a plaster for sick, a sun for leave. The key underneath. No bars or tints.

## Rules 22 to 54

### Buttons

- **22. The main button.** Blue with white words: the one you most likely press, one per area. No black buttons.
- **23. The second button.** White with a thin outline. Every other action that needs a box.
- **24. The quiet button.** No edge until you point at it. Toolbars and rows.
- **25. Delete.** A red word on the second button; a red block only in the dialog that asks you to be sure.
- **25a. Xero.** A button that goes to Xero (Connect, Reconnect, Pull from Xero, Refresh) is Xero's pale blue with white words, outside the palette on his word and named below.
- **25b. ServiceM8.** A button that goes to ServiceM8 (Send to ServiceM8) is ServiceM8's own green, `#7DC836` from their site, with ink words, outside the palette on his word (Isaac, 2 November 2026: "That could be an exception for anything service mate"). A fill only: as a word on white it can't be read.
- **25c. Quoting.** The button that starts a quote (Quote this job, Build the quote) is white in a 2px bright orange edge, `#F97316`, with an orange quote mark before ink words, as a quote is orange in ServiceM8 (it was a solid orange with ink words until Isaac, 16 November 2026: "Black writing on orange button is a bit annoying", then 6 of six), so blue stays the one thing to press on a job (Isaac, 3 November 2026: "all of these buttons are blue"; "Maybe quoting can be orange, like it is in Service Mate"). On the web it is `Button kind="quote"`, and Update quote on a job's Since the quote and on the quote's rail after it's sent wear it (4 November 2026).
- **25d. Clock off.** On the phone, Clock off in the bar at the top of every tab is green, the green's word value `#15803D`, with white words, despite rule 17 (state is never a fill): it carries your whole time at work since Clock on over its word, 7:26, and the colon blinks at half a second so you can see it running, lit still where the phone reduces motion (Isaac, 7 November 2026: "put that on the button itself to show your total time at work", "B is good" to the blinking dots, then "Maybe green then?" over red). Before your day is on, Clock on sits in the same bar at the same size, blue, as the main button (rule 22). The blink is a phone timer, not a sheet's loop, so it has no row under Guards.
- **26. Links.** Ink, underlined. Going somewhere, not doing something.
- **27. Icon-only.** Close, clear, the microphone, and the ‹ › of a date. Everything else has its word. The sidebar doesn't fold, so it has no collapse control.
- **28. Three sizes.** 32 in rows and lists, 36 in forms and dialogs, 44 on a phone. A field and the button beside it match.

### Choices and fields

- **29. Views of a list.** Soft tabs under the title: words alone, the one you're on in a light fill. No outlines. No tab anywhere carries a number, and a screen's title carries no count beside it ("Team", not "Team 3 people"): a view with something waiting has its word in amber, red when something is wrong (Isaac, 20 October: "We need to rule it out everywhere").
- **30. One of a few.** Day, Week, Month in a thin tray; the chosen one filled light.
- **31. Section tabs.** Underlined, the one you're on standing on 2px of ink. No numbers on them, as rule 29: a tab with something to look at has its word in amber, red when something is wrong (Isaac, 20 October). A job has six: Overview, Scope, Price, On site, Files, Billing (Isaac, 13 November 2026: "compact the row"; built 15 November). Above the tabs, on every one, the job's head is a white card, its number and client, under them the site (the address, Site notes, their PO), and beside it on the right the map of the site as a card of its own, the same height and corners, pressed for directions, in colour, nothing fading (Isaac, 16 November 2026, 1 of three after the fade: "That still looks bad"); Actions at the right end of the tabs' row under it (Isaac, 16 November 2026: "it could sit just under the map on the far right-hand side, so it's in line with the tabs"); Actions lists the six things made most (Add visit, to do, task, quote, cost, purchase) and a work order to make, then More for the rest (Isaac, 16 November 2026, A on https://claude.ai/artifact/XbKL1kUEjP1YxP3qEAQnL6). Overview is the facts card and the Activity feed: Next visit, then where the job is up to, a step to a line with its day, then the contacts, a line each with the name and role, pressed to drop down the numbers and email, so three or four fit; Edit on the label opens Edit customer with every contact on the job (Isaac, 16 November 2026: "Name and role on one line each, clicking it brings a drop down with phone email etc."). Scope is the job's Scope, Since the quote and Latest updates, or its Summary where it has no Scope (mock A), then under them the job's plans and, for whoever holds the Studio, its designs (Isaac, 15 November 2026: "Plans move too"). Price is where what the job is charged is built: every price on the job as a card across the top, the quote and, for whoever holds `workboard_money`, each invoice; the quote chosen shows its paper as the customer gets it, read only, with Open quote, and an invoice opens beside its rail (build 10, below); New invoice at the right end of the cards' row (Isaac, 16 November 2026: "The Price page is messy", then yes to the Price mock). THE QUOTE OPENS IN A TAB OF ITS OWN, `/dashboard/jobs/<id>/quote`, named "Quote 3423" in the job's colour (rule 51), as the phone has it and in the phone's words (Isaac, 17 November 2026: "Quote and invoice should open full screen", "On the app, it's build, breakdown, and proposal… We need them to be the same on either system", then 18 November, "Okay, let's go for it" to https://claude.ai/artifact/HYUSZvc7nRxSVPZBL3bGSs): one row of head, ‹ Job, the number in its colour, the client, the site and the quote's name faded, then its state word (Ready to send, Sent, Customer accepted with Undo beside it, or what's left to settle) and Actions; under it three tabs across the page, Build (the conversation with Tiff, amber while her questions are open), Breakdown (the line items) and Proposal (the paper, the money's), All ex GST at their right; beside Build and Breakdown the total, a white card 400 wide: the options by number, the figures, the profit, what's to confirm, where it's up to and the one next step at its foot (Mark ready to send, then Send to ServiceM8, Share and Customer accepted); Proposal is the paper at full width with no total beside it. A price or a quantity changes only in Breakdown; the Proposal changes words (decision 4, 18 November 2026). The Proposal is typed on where it sits, as a page in Word (Isaac, 18 November 2026: "a fully editable section, like a Word document"): each heading, paragraph and list item is its own box, Enter starts the next item and Backspace on an empty one takes it away, Escape puts a block back, a block saves itself as you leave it and the bar over the page says Saved and when; the choice, the payment stages and the notes keep their Edit. The parts a person typed are theirs: Tiff writes over one only when the change asked for is in it, and says so in Build (decision 5). The Price tab's paper and the PDF are drawn to read, with nothing to type in. AN INVOICE OPENS THE SAME WAY, `/dashboard/jobs/<id>/invoice/<claim>`, named by its number ("Invoice #2845A"), the money's only (decision 6, 18 November 2026: "1"): its head as the quote's, its word in its colour (Awaiting, 7 days overdue, Paid); two tabs, Breakdown (its lines) and Invoice (ServiceM8's PDF, as it was sent; typing on it waits on writing it back to ServiceM8); beside them its figure, what's been paid, Of the job (the quote and every invoice, this one in ink) and what's written on it, Open in ServiceM8 in ServiceM8's green at the foot; the Price tab's invoice has Open invoice. New quote, Add › Quote, a variation's Open and Since the quote's Update quote open that tab; its old Price-tab address lands there; a variation keeps its "Variation" inside. On site is two cards: Visits, with Coming up, then Tasks (what's not on a visit yet, two to a row), then Previous, and the materials 520 wide beside it, each unit and control with its word from Stock and its model whole (mock F; Isaac, 16 November 2026: "Not on a day yet, should just say tasks", then yes to the On site mock). Files is the photos, then the documents and compliance. Billing is the money, only with `workboard_money`: two white cards, Payments (the job's value on its heading's right, one bar of it a part a claim in its state's colour, the claims under it) and the Job tracker's three rings (Isaac, 16 November 2026, yes to the Billing mock). Overview, Scope, Price, On site and Files fit the screen, each card scrolling inside itself and never under 420 high (Price's floor was 520 until the walk of 15 November 2026 found its rail's buttons under a 790 screen). Every old name still lands: `?tab=quote` on Price and the quote's old page on the quote's tab, a claim's own number on its invoice there; `visits`, `materials` and `checklist` on On site; `photos` and `documents` on Files; `design`, `designs` and `plans` on Scope. Under the job's name on every tab, its description: the Scope's first sentence, plain text at 16 with no mark, wrapping when it's long; a job with no Scope has no line (14 November 2026, calls 19 and 22). A project has six: Overview, Trips, Scope, Money, Site, Documents (27 October 2026). A person has five: Overview, Hours & leave, Papers, Pay, Access.
- **32. Ticks and switches.** Blue when on. A switch saves itself.
- **33. Fields.** 36 tall, a 6 corner, the label above. A wrong field gets a red edge and says why underneath.
- **34. Menus to choose from.** A field with a chevron; opens a menu. A time opens a wheel: the hour, minutes in fives, am or pm. Nothing types a clock time.

### Surfaces

- **35. Card or group.** A card (outline, 16 corner) is something you act on; everything else is a group under a thin line.
- **36. Menus and dialogs.** White, 16 corner, the one shadow. A dialog darkens the page behind it.
- **37. Toasts.** Grey (the quiet grey, white words), bottom left, a few words and Undo. Not ink (Isaac, 24 October 2026: "it should be gray or something").
- **38. People.** Initials on a light grey disc.

### Patterns

- **39. A row.** Time or tick, dot, name in bold, a line under it in grey, then a state word or one button on the right.
- **40. Nothing there yet.** Says what's missing and leads with the action.
- **41. Loading.** Nothing for half a second, then Tiff's mark, turning at her working speed, in the middle of where the page will be. A page never wears a skeleton: one shaped like the page never matched it (Isaac, 20 October 2026). Tiff building a quote is a wait with a known shape: her mark, what she's doing and the jumping dots after it, and a thin bar with about how long is left, drawn from how long the business's own turns took (a first build apart from the rest): what's left is the middle of what the turns that ran this long still took, so it narrows as she goes, held short of the end until she's done (Isaac, 1 November 2026; the dots and the estimate, 13 November 2026). What she's doing follows the tool she has begun, not the last one saved, and her reply types out above the wait as she writes it, as her own turn, until it's saved; on the phone a short buzz says she's done (Isaac, 14 November 2026: "Just get it all built").
- **42. When something goes wrong.** A red dot and word, what it means for you, and what to do.
- **43. Search.** Results by kind; the last row asks Tiff, with Enter.
- **44. The New menu.** Job, Task and Note: the same three on every page (Note joined on 24 October 2026, Isaac: "Yes to new note"). It fills in only the record you are on, which you can clear: a task made on a job's page is for that job, and made anywhere else it is a general task. A quote is made on its job, through Add. The panel reaches out from the New button, dark, square where it leaves the panel. On the phone New also holds Purchase, the camera on a supplier's docket (Isaac, 29 October 2026).

### Motion, shape and the rest

- **45. Three speeds.** 120 ms for pointing, 200 for something moving, and a new 280 for a panel sliding across.
- **46. Corners.** 6 fields, 10 buttons and tabs, 16 cards and dialogs, 26 the box's two ends and its speaking bar, 40 the page's two curves, round for discs.
- **47. Pills.** Only for a person's name in a note. Never for a state.
- **48. On a phone.** The ink is a bar across the top and the page curls into it at its top left (40), square elsewhere. The menu is the sidebar itself, curling at its foot. Controls 44; the box at the bottom. On a job's card a bar of the job's doing takes the bottom instead (Note, Photos, Used, Add, More), and Note brings the box up from it as a sheet (Isaac, 6 November 2026: "Build it" to the bar's mock). The card is pushed over the tabs, so the bar never sits on the menu.
- **49. Words.** Sentence case, a verb and a noun on every button, no exclamation marks, no "successfully", waits that say what they're doing.
- **50. Text that doesn't fit.** Fades out at its end, as Claude does. Never cut with a "…".

### Making and doing

- **51. The form.** Opens over the page you're on. The record it's for is a field, filled in, that you can change or clear. Saving keeps you where you were, with a toast and Undo. A document opens in its own tab.
- **52. Other doors.** A section's own button, like Book a visit, opens the same form with the record filled in. Tiff reads the same page.
- **53. Actions.** Only what's done to the record itself: its stage, pin, copy the link, print, then what ends it in red. Making is Add's job.
- **54. Add, on a record.** Makes what belongs to that record. On a job: Visit, Task, Quote (Variation once accepted), Cost, Purchase, SWMS, Certificate. Opens white, like every menu from the page. Purchase is a supplier's docket, photographed, its lines onto the job (Isaac, 29 October 2026); every purchase is also kept under Team, Purchases.

## The palette

Nineteen values: each of the eight hues has a bright value (dots, blocks, charts, ticks) and a word value (state words and text on white), plus ink, white and the quiet grey. Blue's word value is its bright one, and grey's word value is the quiet grey.

| Hue | Bright | Word |
| --- | --- | --- |
| Red | #EF4444 | #BE123C |
| Orange | #F97316 | #B45309 |
| Yellow | #FACC15 | #A16207 |
| Green | #22C55E | #15803D |
| Blue | #2563EB | #2563EB |
| Purple | #A855F7 | #7E22CE |
| Pink | #EC4899 | #9D174D |
| Grey | #9CA3AF | #5F6A79 |

| Also | Value | Used for |
| --- | --- | --- |
| Ink | #050505 | Text, the sidebar, toasts, focus rings |
| White | #FFFFFF | The page, cards, menus, the second button |
| Quiet grey | #5F6A79 | Second lines, counts, captions, for-your-information words |

**Ink at an alpha** (lines and fills, not new colours): line 8%, edge 14%, selected 7%, hover 4%, soft fill 5%. On the ink sidebar, white at 12% marks the place you're on.

**The one shadow:** 0 12px 32px at 16% of a near-black, for anything that floats. **The card shadow** (`--shadow-card`): 0 1px 2px at 5% and 0 4px 16px at 7%, for a card resting on the white page, and only where His rulings name it (On Home, On a job's page). **The scrim** behind a dialog: near-black at 45%.

**Text on a solid block** (a bar, a column's head on Home): ink on every hue but blue, which takes white. A schedule card's number box is the exception: the hue's word value, or its card value for orange, yellow and pink, with white words, ink on yellow (rule 19).

**What each colour means:** red only wrong (rule 16); orange needs a look; green good; blue only press (the main button, ticks and switches when on, a selection), and a person named in the box (rule 17); grey for your information. A job's own colour (rule 18), a Studio system's (rule 18a) and the chart colours (rule 20) are the only other uses.

**A business's own colour is its own.** Its document colour, logo and letterhead go on what it sends (letters, certificates, SWMS, the handover sheet, the live link's bar). They are never snapped to the eight and never appear on the app's own chrome.

**On the ink sidebar,** words are white or white at 60%. A coloured word does not reach 4.5:1 there, so the sidebar shows state with a dot beside a white word.

## The scales

**Type.** One face, Plus Jakarta Sans, in four weights (400, 500, 600, 700).

| Size / line / weight | What | Where |
| --- | --- | --- |
| 32 / 40 / 700 | One big figure | At most one per screen |
| 24 / 32 / 600 | Screen title | Jobs, Schedule, a job's name |
| 20 / 28 / 600 | A dialog's title, a figure beside the big one, a screen title on the phone | A dialog, the quote's rail, the phone |
| 16 / 24 / 600 | Section heading | Today, To do, Details |
| 16 / 24 / 400 | Reading and writing | The box, notes, messages, Tiff's answers |
| 14 / 20 / 400 | Body | Rows, fields, the sidebar; buttons at 600 |
| 13 / 18 / 500 | Labels | Times, counts, second lines, field labels, small buttons |
| 12 / 16 / 500 | Captions, the floor | Column heads, group labels |

The scale is 12, 13, 14, 16, 20, 24, 32. Nothing is set at 40 any more.

**Spacing:** 2, 4, 8, 12, 16, 24, 32, 48. Two is the hairline gap.

**Corners:** 6 for fields, 10 for buttons, tabs and blocks, 16 for cards, menus and dialogs, 26 for the box's ends, 40 for the page's two curves, round for discs.

**Control heights:** 32 in rows and lists, 36 in forms and dialogs, 44 on a phone. A field and the button beside it match.

**Motion:** 120 ms ease-out for pointing (hover, focus); 200 ms ease-out for something that moves; 280 ms for a panel sliding across (new). Nothing ambient, nothing on keyboard or high-frequency actions, and a transition names what moves, never all.

**Layers:** base 0, raised 1, sticky 10, overlay 100, modal 200, toast 300.

**Focus:** a 2px ring of solid ink, at 3:1 or better on any ground, never an alpha tint.

## Kept from today

- **Spacing** on the scale: 2, 4, 8, 12, 16, 24, 32, 48.
- **Six named layers**, as above.
- **One shadow**, only on things that float; the card shadow only where His rulings name it.
- **Focus:** a 2px ink ring with white between, on every ground.
- **Flat:** no gradients, glass, glow or texture.
- **No eyebrows:** no capitals or tracked labels; a title stands alone.
- **One font:** Plus Jakarta Sans, four weights. No mono face.
- **Counted:** every numbered rule gets a counter in the design test, held from day one.
- **One home:** each rule is written once, in one short file; the history moves to a decision log.

## The old laws, as they carry over

The 34 laws of 10 September, as they stand under the rules above. Twenty-four are unchanged, nine are rewritten, and one is done. Their history is in `docs/design-log.md`.

1. A segmented tray is a fill or an edge, never the ground's own value.
2. State is never blue: blue only means press, and for your information is grey (rule 17).
3. No hint text. A caption that excuses a design which did not explain itself
4. No mono face. Jakarta only.
5. No AI badge, no sparkle, no feature named after the technology. A feature is
6. No emoji as an icon.
7. Desktop first, and the phone is designed (rule 48), so a phone finding is a defect.
8. Motion is feedback or state, at three speeds: 120 ms for pointing, 200 for something moving, 280 for a panel sliding across (rule 45). Ease-out on entry, none on keyboard-driven or high-frequency actions, and never ambient. A page appears; it does not arrive.
9. A card is for something you act on. Everything else is grouped by space,
10. The eyebrow is retired. A title stands alone; what the eyebrow said goes under it in sentence case, body size, the quiet colour, with real figures. Tracked caps are the eyebrow's dress and go with it: a label is sentence case, 12 or 13, weight 500, the quiet colour, no tracking. Text typed in caps in the markup is the same tell one layer down. The one thing set in caps is a registration plate, because the plate is.
11. No hero inside the app. The title line and the facts.
12. Copy: sentence case everywhere; a button is a verb and a noun; success is noun plus verb, never "successfully"; no exclamation marks; no apology; an empty state leads with the action; a wait says what it is doing.
13. Real content from the first day: long names, truncation, every state.
14. No bar at the start. A coloured line down the left edge of a row, card, tile or nav item is not a state and not a selection. Selection is a fill; state is a word, or a dot. The schedule's cap goes too, with the Schedule rebuild (rule 19), and then no left bar is left.
15. No taglines, and no caption that explains the section. The two shapes: three nouns in a row under a title ("splits, ducted, multi") and a line that says what the section is for ("What lets the business trade — nothing expiring"). The title names the section; the content shows what it is for. A line under a title earns its place only when it carries a fact the reader came for, with a figure, a date or a name. "3 need attention" is that fact. "Nothing expiring" is the same fact as reassurance, and "What lets the business trade" is an explanation. Keep the fact, drop the rest.
16. Colour comes from the tokens. No hex outside the token block. The greys are chosen: ink, quiet text, the line, surface, ground. They were Tailwind's gray-50 to gray-900 by value, and two tokens were Tailwind steps by definition (`--gray700`, `--gray600`). The state colours were Tailwind's red, green, teal and amber.
17. Spacing is on the scale: 2, 4, 8, 12, 16, 24, 32, 48. Two is the hairline gap between chips. Nothing is typed by feel. Three things are not spacing and stay off the scale: a 1px optical nudge; a layout offset above 48, a rail's width or a footer's clearance; and a negative margin, which is an offset that centres a disc or hides a border. A value that is really a sum of a neighbour's parts, a card's padding plus its border, is written as that sum, `calc(24px + 1px)`, never as 25, so the guard that owns the neighbour can read it. When a value sat between two steps it went down: a working screen is dense.
18. Motion uses the three speed tokens and no curves of its own. A transition names what moves, never `all`. A hover is one change; nothing lifts, scales, nudges or grows a shadow under the pointer, and a press moves 1px. What may loop: a spinner, a skeleton sweep, a caret, a live dot, and Tiff's mark while the microphone is open, she is working, or a page is loading (rule 41). Every loop that runs is named under Guards.
19. Six layers, named: base 0, raised 1, sticky 10, overlay 100, modal 200, toast 300. There were 36 values from 0 to 1200.
20. No arrow on a button. "Continue", not "Continue →". An arrow between two values ("21.5° → 23°") is a fact and stays.
21. No middot chains. A line under a title is a sentence, or a label and a value. The one allowance is a keyboard hint: "Esc to cancel".
22. The dark chrome has one hairline token and no inner highlight. An overlay on it takes the one overlay shadow, not its own.
23. A hover is one change: a fill or a colour. Nothing lifts, slides, scales, sweeps or grows a shadow on hover.
24. A control hidden until hover is also shown on `:focus-within`, or it is not hidden. Keyboard users get the delete control back.
25. A button with only an icon is close, clear, the microphone, the ‹ › of a date (rule 27), or a chat's Send and Minimise, as Claude's are (Isaac, 20 October 2026). Every other button carries its word. A `title` is not a label. The few that still keep their glyph are named under Guards, each with its reason, and leave as their screens are rebuilt.
26. State is not a pill (rule 47). Pills are only for a person's name in a note. Time and Pay's bars and tints go (rule 21).
27. Nothing spins in the first half second. Past it, a page shows Tiff's mark turning (rule 41). The ring lives only inside a button that says what it is doing.
28. One footer. The ten footer families fold into one, and the buttons name the choice: "Keep" and "Delete file", "Cancel" and "Rename".
29. `text-wrap: balance` on headings only. Letter-spacing on display titles only; the positive tracking leaves with the eyebrows. "…", never "...". A typed "…" is for a wait that says what it is doing; text that doesn't fit fades (rule 50) and is never cut with one.
30. *Done, and moved to the decision log: the public pages carry Open Graph metadata and an image.*
31. Colour only where it means something: blue is the colour of pressing (rules 17 and 22); a state word, a state dot, a job's colour, a chart and the drawing are the other uses.
32. A focus ring is 2px of solid ink at 3:1 or better on any ground, never an alpha tint. The commonest ring was blue at 30% opacity, near 1.4:1 on white; it existed and could not be seen.
33. One height per control size. An input and the button beside it share it. Four heights sat in the same rows: 42, 32, 30 and 28.
34. One link token: ink, underlined. Links were declared eight ways, brand blue in one place, three greys elsewhere, teal in the diary, ink in the Toolbox.

## Guards

`src/app/dashboard/__tests__/design-ratchets.test.ts` counts, across every screen stylesheet and component under `src`, each place the sheets break a rule, and holds each count exactly where it is. A change may lower a number; it lowers the recorded number with it, so the number is always the truth. A change may never raise one. Three things it holds by name instead, in the lists below: the loops, the buttons that keep their glyph, and Isaac's named exemptions. Every guard was watched failing before it was trusted.

The three paper stylesheets are outside the guards on purpose: the design sheet (`sheet-doc.css`), the letterhead and the live sheet are documents set for print. The counts of colours outside the palette also leave out the Design studio's own sheet (`studio.css`), which has its own drawing colours and moves onto the palette in its own step.

**Added with v2, on 18 October.** Each starts at the count of that day:

- **Main buttons painted ink** (rule 22). A rule on a button class whose fill is ink.
- **Colours outside the 19** (rule 15). Any hex in a screen stylesheet that is not one of the palette's values, the token block included.
- **Text cut with an ellipsis** (rule 50). `text-overflow: ellipsis` in the sheets, and a typed "…" in on-screen text, counted apart.
- **Native controls no stylesheet reaches.** A `<select>`, a time input, a colour input and a `title` tooltip, each counted apart, so a new one is never added and the chooser, the wheel and the tooltip rule replace them.

Two more come with step 1, when the values they count exist: **blue that isn't a press** (rule 17), and the accent count retiring once the teal has gone. The radius scale gains 40px for the page's two curves (rule 46), the one change that loosens a law; the type scale loses 40.

### The loops that stay

Every rule that runs `infinite` is named here, with what it runs on and why
it may. Each one is feedback or state under law 18: it starts when something
starts and stops when that stops. This list is the guard.
`design-ratchets.test.ts` reads it and holds the sheets to it by name, both
ways: a loop the list does not name fails, and a row whose loop has left the
sheets fails until the row goes with it. A new loop needs its row, with its
reason, before it can run. Every one stops under `prefers-reduced-motion`, by
name, because the frame's global duration override would otherwise turn an
infinite loop into a strobe.

| Keyframes | Runs on | Why it loops |
|---|---|---|
| `tcDots` | the three dots after "Thinking" in Tiff's chat, after "Fixing the wording" in any box whose words take a while to land, and after her words while she works on a quote, beside her turning mark and over her bar; one rule with each dot delayed | Tiff is working, or the words are on their way: said in words and dots (Isaac, 20 October 2026; the box, 9 November 2026; on a quote, with the mark still turning, 13 November 2026: "just adding the dots next to whatever the wording is. Whether she's thinking or building quote") |
| `ds-sheet-wait` | the sheet's outline while its raster downloads | a skeleton, breathing rather than swept because it is an outline: the plan lands into its place |
| `wb2CursorBlink` | the board's answer while it streams | a caret |
| `fgPulse` | Time & Pay's live period (the note strip's recording dot went with the strip, 2026-11-10) | a live dot: something is open right now |
| `int-pulse` | an integration's backfill while it runs | a live dot |
| `orbSpin` | the orb, as the dictation meter | the orb: the microphone is open |
| `orbSaySweep` | the wait's word beside the working mark | the wait's label, lit while Tiff works: the caret's job on a word |
| `tiffGyro`, `tiffNod`, `tiffSheen`, `tiffGimbalA`, `tiffGimbalB`, `tiffArc` | the Tiff button and the mark wherever it stands for Tiff; the rules are declared on every mark but held paused until the mark is working | Tiff is working (rule 8, v2). Since 18 October 2026 the mark is still at rest (Isaac, 17 October: "The mark does not turn at rest. It can stay still."), which retires the override of 24 September. Home's mark (`.tiffmk.alive`) runs them at rest, in the colours, from 20 October (Isaac), and the page's hold (`.pg-hold`, rule 41) runs them working |
| `tiffCyc` ×2 | the two runs of light on a working mark's rings, their gradient stops cycling blue, purple, pink, red, orange, yellow, green | Tiff is working: colour on the mark means she's busy (rule 8). The gradients are only shown on a working mark |
| `tiffCycRing` ×2 | a working mark's two faint rings, in the same cycle, and Home's mark's at rest | Tiff is working (rule 8); Home's mark is alive (rule 8, 20 October) |

### The buttons that keep their glyph

Law 25 lets a button stand without its word only as a close cross or a clear
cross, and the guard reads those off the label: it begins "Close" or "Clear".
A box you tick is a checkbox, not a button, and says so (`role="checkbox"`);
its word is the label beside it. Every other button that is only an icon is
here, by glyph and class, with its reason, and the guard holds the sheets to
this list the way it holds the loops: both ways, by name.

| Glyph | On | Why it has no word |
|---|---|---|
| `mic` | `cv-rnd` ×3 | the microphone, on the box, in a form and on a job's Materials line, round as the phone's (the box, 9 November 2026): the words beside it are the word, and a microphone is the one glyph the trade reads without one |
| `x` | `cv-rnd` | the recording's cross, on the bar every box speaks into, as the phone's ✕ (the capture card had another, and went with the old capture UI, 2026-09-27; the Library's ask bar had another, and went with the bar, 2026-11-07; the form's row and bar had two, and went with the box, 2026-11-09; the note strip had one, and went with the strip, 2026-11-10): each closes a recording, and its label says what closing costs ("Discard") |
| `plus` | `cv-rnd` | a note composer's commit at the end of its one-line field, round on the box's one line: the placeholder is the word and Enter is the same press. A form's save is a word; a composer's send is the glyph |
| `arrowUp` | `cv-rnd` ×2 | Tiff's ↑, on the box and on the bar while you speak: a chat's Send, as Claude's and the phone's are (law 25; the box, 9 November 2026) |
| `rotate` | `ds-tool` ×2 | undo and redo in the Studio toolbar, the candidates law 25 named |
| `x` | `camdel`, `ds-plancard-x` | a thumbnail's cross, on a photo badge and on a plan page in the Studio's import: a picture has no room for a word |
| `bug` | `fr-bug` ×2 | Report bug, at the right end of the top bar and again over a pop-up's scrim, as the phone's bug is in its ink: a symbol pressable from anywhere, for the whole team (Isaac, 18 November 2026: "the bug should move to a symbol at the top of the screen, similar to the app, and it's pressable at any point", then "I need everyone to be able to report bugs") |

### His rulings

Some of Isaac's calls break a rule no ratchet counts, so they are written
here rather than in the table below, each with his words and the day.

#### On the Library

- **The web Library wears the phone's** (`tiff/library-covers.tsx`,
  `tiff/data-pack.tsx`), as mocked on
  https://claude.ai/artifact/1CuFEACnPf9L8gwUGpsziw (Isaac, 16 November 2026:
  "make library web version look more like mobile", then "The toolbox and
  data pack look a little bit hidden", then "Yep looks good"). One search
  that also asks Tiff, its last row the Ask (rule 43, first here, as the
  phone's); Toolbox and Data pack as two big white tiles under it, their
  colour in the icon's square, orange and yellow, as the phone draws its tools
  (Isaac, 17 November 2026, the first-look fixes,
  https://claude.ai/artifact/7ijojbkVbMJUGasurPCvVF); the manuals opened lately as covers; a card per brand.
  Two rules give way, for the Library and Data pack alone:
  - rule 1, the plain white page: the page is the phone's light grey, ink at
    the soft fill's 5% on white, with white groups on it;
  - rule 15 and "A business's own colour is its own": a cover and a brand's
    card are filled with the maker's tag colour, as the phone's are, white
    words on it or ink where white won't read; Mitsubishi Electric's is the
    press blue. The covers keep the maker's name in its own case, not the
    phone's capitals, as the eyebrow is retired.
  - Data pack (Isaac, 16 November 2026: "Just have a Data pack section that
    displays all units to search through, filter and combine. A bit like
    system builder"; "Yep nice" to
    https://claude.ai/artifact/2Jvc2mQkhQscbykt7abwhM) is every unit in the
    Studio's packs: Units, Compare and Combine as soft tabs, Combine's word
    the state (rule 17), read from the Studio's own multi check.

#### On the box

- **Every box you type or speak in is the phone's** (`conversations/box.tsx`,
  `conversations/speak-bar.tsx`, `notes/note-token.tsx`; heytiff-mobile
  `Talk.tsx` and `SayBox.tsx`), as mocked on
  https://claude.ai/artifact/MuhXNPnrWuJh8G6Q4FGvXU (Isaac, 9 November 2026:
  "I want to make the web entry box the same as the mobile one. It's much
  nicer", "I want the boxes to pretty much be identical", then "yes"). Four
  rules give way, for the box alone:
  - rule 28, three sizes: its round buttons are 40, the phone's, on the web
    too, and Save is 40 tall beside them;
  - rule 46, corners: the box's ends and its speaking bar are 26, and Save
    is round-ended;
  - rule 45, three speeds: the words move at the phone's own times, a word
    sliding over in 240 ms and a fixed word settling from ink to grey over
    1.2 s;
  - rule 17, blue only means press: the wave is the press blue, as the
    phone's is.
  Words as you speak are grey and leaning, the phone's; what you typed stays
  ink. At ■ the words stay where they were, grey, until they land: nothing
  says "Thinking". The phone's spacing of 5, 7 and 11 sits on the scale's
  4, 8 and 12. Enter still sends on the web.

#### On Home

- **Home is one card with two tabs, Schedule and the Activity feed**
  (`home.tsx`, `home-schedule.tsx`, `home-feed.tsx`; Isaac, 17 November
  2026: "the person who's going to be looking at the desktop screen over
  the app is probably going to be the admin person on a daily basis",
  "default would be team view", then "let's make it so we've got schedule
  and activity feed as two separate tabs" and "Build it" to
  https://claude.ai/artifact/7ijojbkVbMJUGasurPCvVF). The tabs are a
  record's section tabs (rule 31), the one you're on in its colour's word
  value on 2px of ink; each tab's controls sit on the line under them, and
  both tabs are the same height, so changing tab never moves the page.
  Home keeps the tab, the day's view and the feed's view you left it on.
  - **Schedule**: the days along the top as soft tabs (rule 29), Today and
    the next four working days, Saturday and Sunday passed over; Team or
    You in a tray (rule 30) on the same line, Team the default. Under them
    the day's jobs on the left, each once however many are booked on it,
    in start order: the number in its colour's box (rule 19), the client,
    the suburb and who's on it by first name (on You, the kind and the
    suburb), the start, and where it's up to (On site, Done, Didn't go
    ahead, On now, Booked; a day ahead says its kind). Done goes grey. Who
    is free all day (Schedule capacity's people with nothing booked and no
    time off) is said once over the list, and whose birthday it is today.
  - **The map** beside the list, 640 at most: Google's picture of the view
    under the page's own pins, the key on the server (`/api/home/day-map`).
    A job still to do is its number in its colour; a done one a grey dot;
    who's clocked on to a job sits beside its pin in ink, a count where
    more than one is. It opens fitted to the day's jobs less any more than
    30 km from the rest, which waits as a chip on the edge facing it with
    how far it is from the map's middle; pressing the chip goes there, Show
    all fits everything, + closes in on the jobs on the map (or all of
    them, where none is), − goes out, and the map drags. Jobs too close to read join into one
    black count; pressing it zooms in. Hovering a row lifts its pin. Someone
    clocked on to a job sits beside its pin; where the business has its
    team's location on (Settings, Business, off by default, with the notice
    the law asks for under the switch; Isaac, 17 November 2026: "add it, i
    will give notice"), each person clocked on is a disc in ink with their
    first letter where their phone last said, you in the press blue, for
    20 minutes after it said so. HeyTiff keeps only the last place, and
    forgets it at clock off.
  - **The Activity feed**, the card's full width: All starts with To do,
    what waits on you, the reminders due today among it, each row led by
    the job feed's checklist disc or its tick; then what came in, the day
    said once over each day's items (Today, Yesterday, Thu 12 Nov) and an
    item saying only its time. A mention's Reply opens the feed tab.
  Before: two cards, your own Today beside the feed (17 November, the
  morning; the day's events went with it), and three columns as tall as
  the page, To do the third (20 October to 17 November). Tiff's box is one
  line, the microphone and Send inside it, growing as you type.
- **Home's card is a white card lifted off the white page**
  (`.hm-card`, `--shadow-card`), its tab you're on named in its colour's
  word value, as the job's Overview names its sections (Isaac, 5 November
  2026, on https://claude.ai/artifact/ENNSiAcvz4rSAm2hxQsPbU, told it needs
  the one-shadow law set aside: "C, lifted"). Two rules give way, on Home
  only:
  - one shadow, only on things that float: the card rests on the page
    with the card shadow, its own token, which the shadows ratchet does not
    count, as it does not count the overlay's; the map's pins and counts
    stand on a 2px ring of paper, not a shadow;
  - rule 35, a card is something you act on: the card is not pressed.
  Tiff's box stays as it is, outlined. A hover is still one change, a fill
  (rule 23): nothing lifts more.
- **To do's rows have no buttons: the row is the door** (`home-todo.tsx`),
  despite rule 39's one button on the right (Isaac, 5 November 2026, on
  https://claude.ai/artifact/LHfRit1ThXLpobEXwZGPWK: "remove the action
  buttons… You should just be able to click on whatever item it is… For
  tasks, maybe just a tick to say done", then "build both"). Pressed
  anywhere, a row goes where its button went; a won job's opens Book in
  over Home. A task and a reminder keep their tick, and a reminder keeps
  Later as a clock, an icon-only button despite rule 27, since nothing
  else puts it off. Opening new work given to you is its Got it. Your feed
  follows: its Open and Got it go, and it keeps a field issue's Make it a
  task and Done, which no door does, and Reply on Show all's page.

#### On a person's page

Two of his calls on Team's person page (20 October 2026, on his mock
https://claude.ai/artifact/BH6voDn1axdk96JZCCUSTf).

- **Each group has its icon in its colour** (`.tm2-ic`), despite old law 31,
  colour only where it means something. "Can we add some coloring in
  there? ... These things need to stand out." The colour is the hue's word
  value drawn on the icon itself: no square behind it, no tint, no edge.
- **The emergency contact's title is red** (`.tm2-emerg`), despite rule 16,
  red only means wrong: it is the one group someone has to find in a hurry.
  Its icon is a plaster on the diagonal, never a cross.

#### On a job's page

His calls on the job page (25 and 26 October and 3 and 4 November 2026; the first two
on his mock https://claude.ai/artifact/GL43j32Z8xBo3CXekExHuF, the third
on the refined Overview A, https://claude.ai/artifact/SGFpbThni6YZF6HU3SZpPL,
the fourth on the customer's messages, below).

- **The head is the job's plate, with the way back above it**
  (`.jp-plate`, `.jp-back`; Isaac, 5 November 2026, B on
  https://claude.ai/artifact/SJyEw4dkCb7MLp1bgCzypJ). The job's number in
  a solid box of its colour, white on it, as a Schedule card has it (rule
  19), with no hairline; beside it the job's client at 24, as Schedule,
  Jobs, the tab and Recents name a job, and the address is the Site
  card's, under the stages line, which no longer repeats the number (6
  November, on https://claude.ai/artifact/Wtc1ZrZYkAp1aaedxSn2J4: "job
  number, client name, then underneath it, the site would show the
  address"). A job with no client is named by its address. Above it, a chevron and the
  screen you came from in ink, a word button with no underline: Back to
  it as you left it, and Jobs when there is nowhere to go back to (a
  link, a refresh). It is one word, not a breadcrumb.

- **Every tab's cards are lifted, their names in colour** (`.jp-fit`,
  `face-title.tsx`; Isaac, 17 November 2026, "the job card changes to match
  are good" to https://claude.ai/artifact/7ijojbkVbMJUGasurPCvVF). On site's
  and Files' cards rest on the page with the card shadow and no hairline, as
  Overview's, Scope's and Billing's do, and every card names itself in its
  hue's word value with its glyph beside: Visits purple, Materials green,
  Photos yellow, Documents pink, and under Scope, Plans green and Designs
  yellow. Off the job's page the same faces keep an ink name and no glyph.
- **Materials' groups have their icons in colour** (`.jm-ic`), despite old
  law 31, colour only where it means something. "Now just put some color or
  something on the group headers." Each of the price book's shelves keeps
  one icon in one hue's word value (`SHELF_LOOK` in
  `lib/workboard/material-shelves.ts`), drawn on the icon itself: no square
  behind it, no tint, no edge. Red and blue are never a shelf's, since red
  only means wrong and blue only means press.
- **Billing's Payments bar is red where a claim is overdue** (`.jb-seg--red`),
  despite rule 16, no chart is red: the bar is the job's value, a part a
  claim in its state's colour, red overdue, orange awaiting, green paid,
  grey still to invoice, and each claim's row under it wears a dot of the
  same colour. The job's value is on Payments' heading's right, the one big
  figure; what's paid and what's invoiced, and how much of it is overdue,
  are said under the bar (Isaac, 16 November 2026, yes to the Billing mock).
- **The Overview's section heads wear Home's coloured block** (`.hm-blk` in
  `.jov-head`), despite old law 31, colour only where it means something:
  Summary pink with a file, To do yellow with a tick, the Activity feed
  green with a bubble, the last two as Home's own. He approved the mock
  that drew them ("Yes, build the refined Overview A", 25 October 2026).
  On a job being quoted or worked, the Summary's place is the job's Scope,
  pink with a file: Tiff's written brief, a paragraph per system with its
  sources, then Added, Not ours and To clarify, and Latest updates under it
  in purple with a clock (Isaac picked the written brief, 28 October 2026).
  Since 14 November 2026 the Summary and the Scope stand on the job's Scope
  tab, not the Overview, the Scope on the left from its second sentence and
  Since the quote and Latest updates in a 380 column on the right, each a
  card as the Overview's are.
  The block is solid with its icon in ink, as on Home and in the Library:
  no tint, no edge, and never blue, red or orange.
- **The Overview's parts are white cards lifted off the white page, and
  each section's name is in its colour** (`.jov`, `.jov-head--<hue>`),
  Apple Health's cards (Isaac, 4 November 2026, on
  https://claude.ai/artifact/8L3hw5D8QxHZidsAAQNcX6: "2, check laws", then
  "Unless you have other ideas, you can build it"). It first stood on a
  grey ground; on 5 November 2026 the ground went and the cards were
  lifted, to match Home (on https://claude.ai/artifact/ENNSiAcvz4rSAm2hxQsPbU:
  "Yes, lift it"). Three rules give way, on the Overview only:
  - one shadow, only on things that float: the stages line, each fact and
    each section rests on the page with the card shadow, as Home's columns
    do;
  - rule 35, a card is something you act on: the stages line, each fact
    and each section is a white card, 16 corner, no edge, though most are
    not pressed;
  - the ruling above, the coloured block: on the Overview the block goes,
    and the section's icon and its 16/600 title take the hue's word value
    instead. A green Activity feed or a yellow To do sits near rule 17's
    state words, but a title is 16 and bold with an icon, where a state is
    13 with a dot. A project's page, the letter editor and the SWMS sign-on
    keep the block.
  The facts' labels are 13/500 with an icon: Site a house and Contact a
  person in grey, Next visit a calendar in pink.
  Since 14 November 2026 (mocks C and D on
  https://claude.ai/artifact/MkfHutEG1PanPDCW7fyV5a, and his calls 4, 5, 11,
  19 and 21) the Overview is two columns fitted to the screen, each card
  scrolling inside itself and never under 420 high, the job's head staying
  put above them when a short window scrolls: on the left one facts card 320
  wide, Next visit first, then Google's map of the site, the address with its
  first line at 16 bold and Directions, then the contacts in full, no email
  underlined or faded; on the right the Activity feed. The stages line stands
  beside the job's name, off its card, on the Overview only, its last step
  "Not paid" in orange while money is owing. Money and the Job tracker are
  Billing's, and a tracked job's board is a line in Actions. A long client
  name wraps beside its number and never fades.
- **Price lays every price on the job across its top** (`.jpr`,
  job-price-tab.tsx; the job page plan's build 10, on the Price Tab mock
  https://claude.ai/artifact/LUi5CikRpK5frq6b6M4D9J, and Isaac, 14 November
  2026: "Build all as recommended, I'll change anything I'm not happy with
  after"). Each is a flat card in the hairline, what it is in grey, its name,
  its figure and its state word, and the one open is filled light, never
  outlined (old law 14). The quote built with Tiff; a quote typed into
  ServiceM8 and never built here, with no chat behind it and an orange Update
  quote; and, to `workboard_money` only, each claim ServiceM8 has invoiced,
  its figure and word exactly as Billing's row says them, so what's owed is
  said one way: ex GST where ServiceM8 itemised it, labelled inc GST where it
  didn't, never worked out. New quote ends the row, orange (25c), while the
  job has no quote. The one open has its views in a tray over the left (rule
  30): Chat, where a quote is built and changed (only while Tiff is on for the
  business), Line items, and Preview, the paper as the customer gets it (the
  quote's paper is the money's, so a tech has no Preview), with its rail down
  the right, 400 wide, its buttons pinned at the foot. A quote's Scope and To
  confirm join that one tray, and its rail opens on its price, then where it's
  up to as a list with each step's words, Approved and a client's yes said as
  green words (rule 17), the yes with Undo, and Update quote orange (the walk
  of 15 November 2026). An invoice opens on its
  PDF alone, with no viewer's toolbar, its lines a tab away, and its rail says its figure and word, what's
  been paid inc GST, and what's written on it; the job's own invoice says
  what it was **Built from**, each visit oldest first with who went and for
  how long, the work done's first sentence and how many things were used
  (the walk of 16 November 2026, N4); a past booking nobody checked in on
  is a visit there, said as booked, only when that person left photos or
  notes on the job during it (Isaac, 17 November 2026, 3408). **An invoice has one home**:
  Billing's row opens it on Price, as does the feed's money event and a
  claim's own number, and there is no claim dialog; a claim still to come
  isn't an invoice yet, so its row on Billing is read and not pressed. The
  part claims stay under Billing's Payments, and the Job tracker under them.
  **New invoice**, a second button at the row's end for whoever sees money
  and the business's figures, builds what goes on the job in ServiceM8 from
  what the job knows (the invoice mock of 3 November 2026): the hours on
  site a line a day at the charge-out rate, and what was said used at the
  book's cost and the markup on materials, each with its tick; on a job
  priced already, only what was used beyond its price. Its Preview is the
  invoice ServiceM8 will make, the job's lines and the ticked ones, and its
  rail ends in Send to ServiceM8 in ServiceM8's green (25b), the one press
  that puts the lines there. ServiceM8 makes and sends the invoice.
- **The Job tracker's rings turn red past the quote** (`.jtr-over`),
  despite rule 16, no chart is red (Isaac, 3 November 2026: over the
  allowance is "a red line and how much over"). It is three side by side
  on grey, Labour, Materials and Equipment, each a ring of what's used
  against what was quoted with the share in its middle (Isaac, 16 November
  2026, yes to the Billing mock): used green, overtime's extra hours
  orange, and only what passes the quoted figure red, with the state word
  beside it saying how much ("4.25 h over"); the quote's units are a whole
  ring in ink, as quoted. Show opens a ring's rows under the three.
  Where the quote holds no hours (a ServiceM8 quote of one price), Labour
  says "Hours not quoted" and its quiet Add hours opens in the line, visit
  by visit, people and days at the working day, with no pop-up; Materials
  says "Not quoted" with Add amount. Once added, the line reads as a quoted
  one and says who planned it, with Change (Isaac, 5 November 2026, on
  https://claude.ai/artifact/Gbw8CZCxNYBJSDEHTaAyv9: "Yes, build it").
- **The Activity feed's conversation bubbles are filled** (`.jc-bubble`),
  despite old law 31, colour only where it means something, and "colour is
  solid, never a tint" as it applies elsewhere: here green means "us", not
  "good". "Deep green with white" (26 October 2026, on his mock
  https://claude.ai/artifact/5PZn6N1iwYA99EnuRgNiHb). The team's bubbles
  are the green word value (`--green-w`) with white words, which read at
  5:1; the customer's are a solid light grey (`--bubble-them`, the
  palette's grey laid 22% into white, never an ink alpha) with ink. Runs
  from one speaker stack 2 apart with the inside corners at 6 and the
  card's 16 elsewhere, like iMessage. A message shows whole up to 16
  lines; a longer one shows 12, fading, and a "•••" button inside the
  bubble opens the whole of it, despite rule 50, text that doesn't fit
  fades and is never cut with a "…": the fade stays, and the dots are a
  button, not a mark of cutting. "have the dots to show that there is more
  to open" (26 October 2026). The bubble itself is not a button, so the
  links in it press as links.
- **The Tiff conversation has sides** (`.jc-talk`, `.jc-tiffturn`), his
  call on https://claude.ai/artifact/7aVi2krm8t7m6JAMNVSnVN (26 October
  2026: "Let's do B… keep green to conversations with customers", "do no
  bubble", "give the logo the colors. And have TIFF black"). Your notes are
  on the right and everyone else's on the left, both in the light grey
  (`--bubble-them`), so green stays a text the customer got. Tiff has no
  bubble: her mark in her colours, turning slowly, beside her name in ink
  ("She can turn slowly, given that you won't have an extra one down the
  bottom of the page"). Under a bubble its time and doors are quiet words
  with no underline, and Remove is the red word (rule 25).

- **The Activity feed reads like a chat** (`.jc-convo`, job-conversation.tsx;
  Isaac, 14 November 2026, mock D on
  https://claude.ai/artifact/MkfHutEG1PanPDCW7fyV5a and calls 6, 7, 8, 12
  and 18): oldest at the top, opening at the newest, the box at the card's
  foot, holding its place while pictures load and while you read back. Its
  tabs are All, To do, Comms, Notes, Photos and Tiff; To do and Tiff always
  show. A To do stands in All on the day it was made, who made it above, the
  time below, and a second line saying who it's for and when it's due ("For
  Isaac, due Mon 16 Nov"), red once it's overdue; the To do tab lists Open,
  headed by what's open on the job, then Done, and its word is amber when one
  is due today and red when one is overdue (rule 29). On the To do tab the
  box reads "Add a to do": Save adds it as written for you, the arrow has
  Tiff set who and when. Comms has no box. An empty tab is empty down to its
  box, with no words in it (the walk of 15 November 2026). An email shows its
  words without its sign-off or its signature's pictures, with Whole email
  and Reply under it; with no sign-off over it, the signature starts at a
  line naming the sender, a line of contact details or a disclaimer. "Task" only ever means site work: Actions' Add says "Add to do".
  The box's arrow opens Tiff's docked window with the job as its context,
  with only its × (no Minimise on a job's; other screens keep it), and the
  job's box goes while it is open (Isaac, 14 November 2026, mock E and calls
  10, 17 and 20). She saves each decision as she makes it, with Undo;
  closing only closes, and what she is still doing she finishes. All shows
  what she saved, a To do made by "Tiff, for Isaac Smith", never the chat;
  the Tiff tab lists every chat on the job, the quote's too, each with the
  word that opens it where it was had: Open chat, Open in Price. Only a fact
  about the job goes on to ServiceM8 as a note: a reminder becomes a To do
  and nothing is sent.

- **Plans stand first among a job's Documents** (`.jdoc-group` "Plans",
  job-documents-face), above Drawings (Isaac, 9 November 2026, on
  https://claude.ai/artifact/3gzx9mP747FgTX7qxsH9fe: "Yes, a plans group at
  the top of documents that can be easily read"). A plan is one of the job's
  own files pressed into Plans, from Add's first row, Add plans, from Email
  to Tiff's card, where a set of drawings comes ticked, or from the Studio's
  New design; nothing enters Plans without the press, and a file in Plans
  leaves its old group. Each is a v2 row (rule 39): the tick, the file's
  name, a grey line of what Tiff read and when and which designs use it,
  and under the line the floors she found as pictures 160 wide with their
  names and page numbers at the caption size, the one row whose pictures
  sit under its words. Its state is the word on the right: Reading the
  plans in grey, Read in green, Check the read in orange with the reason in
  the line, as rule 17 has them. Tiff reads a plan once, the moment it is
  pressed in, and every design, the roof and the quote read from that
  ("Go that").

- **A job supplied with plans has two scopes, and a tray to switch them**
  (`job-scope.tsx`, the tray rule 30's own `Tray` in the Scope card's head;
  Isaac, 11 November 2026, on https://claude.ai/artifact/6FP52g4ropVpfAqqzNLk2c:
  "supplied scope and quoted scope ... a toggle switcher ... side by side
  for comparisons", then "Yes, that's it"). Quoted, Supplied, Side by side;
  the card's title is the chosen scope's name. The quoted scope is the brief
  the quote is built from, and each system that departs from what was
  supplied says Differs in grey (rule 17, for your information). The
  supplied scope is what the plans, the specification and the builder's
  emails asked for, kept as read, with its fine print, and "Read on" its
  day under the title. Side by side draws in the Scope tab's left column,
  where the brief is, a row per area with the quoted on the left. A job with
  nothing supplied has one Scope and no tray, as before.

#### On a quote

- **The money rolls** (`.rf`, `components/parts/rolling-figure.tsx`), past law
  8's 300 ms and on a token of its own, `--t-roll`, 600 ms: "the money should
  roll up and down like a slot machine sort of thing" (30 October 2026). Each
  digit is a column that turns to its value when the quote changes. Nothing
  rolls as a page opens, and under reduced motion each is simply there. What
  lands in Tiff's conversation after the page opened eases in on `--t-move`
  ("Things should transition in smoothly even messages").

#### On a letter

- **The letter editor's rail wears Home's coloured block** (`.hm-blk` in
  `.lte-sechead`), despite old law 31, colour only where it means
  something: The letter pink with a file, Signed by purple with a pen. He
  approved the mock that drew them (27 October 2026: "Other than that,
  everything looks fine"). Solid, the icon in ink, as on the job's
  Overview.

#### On a project's page

His call on the old screens' mocks (27 October 2026: "Other than that,
everything looks fine").

- **A project's section heads wear Home's coloured block** (`.hm-blk` in
  `.jov-head`), as the job's Overview does, despite old law 31: Checklist
  and Dates yellow, Jobs, Trips and Design purple, the journals, Claims and
  In the price green, Notes, Variations and Documents pink, Not in the
  price and Recurring issues grey. Solid with the icon in ink, never blue,
  red or orange.

#### On the SWMS sign-on

His call on the mock of the old screens (27 October 2026: "For the swim
sign on, change from crew lead to supervisor. Other than that, everything
looks fine"), which left the mock's own choices standing.

- **The sections wear Home's coloured block** (`.hm-blk` in `.sws-head`),
  as a job's Overview does, despite old law 31: Before you start yellow
  with a warning sign, Who it covers green with people, Sign on pink with a
  pen. Two take the colours the Overview's ruling keeps off its blocks:
  **Emergency is red** with a phone, despite rule 16, red only means wrong,
  on the model of his red emergency contact on a person's page (it is the
  one section someone has to find in a hurry); and **an issue and what
  changed are orange**, a flag and a turn, because each is something that
  needs a look. The block is solid with its icon in ink: no tint, no edge,
  and never blue.
- **The role that leads the work is "Supervisor"**, never "Crew lead": in
  the template's steps (`lib/swms/library.ts`), on the button that tells
  the person in charge about an issue, and in the tests. A SWMS issued
  before the change keeps the words it was issued with, because a version
  is frozen at issue.

#### In the Studio

His call on the Plans mock's boards 8 to 10 (9 November 2026, "Build it";
his words on 9 November: "a button in the design studio that you can refer
back to while doing the design. Clicking it open will pop out the scope
that was built on the home page or on the job home page. You can continue
to edit it from there using TIFF").

- **The job's Scope opens in a column on the left of the plan**
  (`.ds-scopecol`, scope-column.tsx), never a dialog over it: a scope is
  referred to while drawing, so the plan shrinks and Systems stays on the
  right. The button is "Scope", the Overview's own word, beside Open job
  under the design's name with the Overview's pink file; "Brief" would be
  a second name for one thing. The column is 400 wide with a hairline on
  its right and holds the Overview's Scope section word for word (JobScope,
  pink with a file, its lede, a paragraph per system with its sources,
  Added, Not ours, To clarify, Latest updates), the close cross over its
  head (rule 27), and at its foot the job's box: a note typed there is a
  note on the job, filed as the Overview's box files one, and the brief is
  rewritten the one way it is today. No microphone in the column: the
  Studio's is in Tiff's pill. Its tray is Quoted and Supplied only: at 400
  wide there is no room for Side by side (11 November 2026).

### Named exemptions

Isaac's own shapes on the new Home break some of the laws on purpose, on
his word ("design exempt for now, but keep a note", 2026-09-24). A baseline
raised to let them in would let the next rule in with them, unnamed, so
they are held the way the loops are. Six ratchets take a named exemption:
gradients, shadows, bars at the left edge, Tailwind palette hexes, pills
and colours outside the 19. Each counts the sheets without the rule blocks its own rows cover,
so no baseline moves, and `design-ratchets.test.ts` holds the hits in those
blocks to this table exactly, both ways: a named rule that grows fails, and
a row whose rule has gone fails until the row goes. A block is covered only
when every selector in its list names the class, and a row covers its
class under its own ratchet and no other. A row needs his words and the
day he said them.

| Rule | Ratchet | Count | His words | Date |
|---|---|---|---|---|
| `.hd-page` | Tailwind palette hexes | 1 | "design exempt for now, but keep a note": `--hd-done`, the tick on finished work, is Tailwind's green 600 | 2026-09-24 |
| `.wb2-jcattpill` | pills | 1 | "Our mention can just show our name inside a pill. in place of where it was in the note": a task made from a ServiceM8 note carries the note as ServiceM8 shows it, each person it names a pill where their handle stood, where law 26 says a plain word | 2026-09-29 |
| `.pt-btn--xero` | colours outside the 19 | 1 | "give zero button its proper colors. This will be an exemption to the color rules. With a pale blue and white writing.": Xero's brand blue `#13b5ea` on a button that goes to Xero; white on it measures 2.4:1 | 2026-10-27 |
| `.pt-btn--sm8` | colours outside the 19 | 1 | "That could be an exception for anything service mate": ServiceM8's own green `#7DC836` on a button that goes to ServiceM8 (rule 25b), ink words on it; first worn by Send to ServiceM8 on Price's New invoice | 2026-11-02 |

What the guard cannot count is noted here on the same word:

- **Law 16, colour.** `.hd-page` declares his colours as its tokens, and
  no rule on the page writes a colour literal: the ink `#151a24`, the body
  grey `#5b6472`, the rules `#e6e9ee`, `#eef0f3` (which also fills his
  name tag, solid, so a lit row cannot darken it) and `#e2e5ea`, the teal
  of Today `#0f766e`, the green of done `#16a34a`, the list's quiet
  dot `#c3cad4`, and the diary's wash `#e6f7f3`, his pale teal under an
  entry that has just landed. `text-contrast` holds every one that is
  text to 4.5:1 on the page's fills, the wash among them; the quiet dot
  is a mark at 1.65:1, and a row's group title says what it means. The Trace's
  masks are `#000`, which a mask reads only for its alpha, and its light
  is `--paper`.
- **Law 16, the Calendar's colours.** `.hd-cal` declares his calendar's
  colours as its own tokens, and no rule writes a colour literal: each
  category — holidays his purple `#7c5ce0`, events his teal `#0f9488`,
  admin his amber `#d9860f` — with its tint and its ink, his pale late
  red `#fbe0db` with its ink `#a8202f`, the school holidays' grey and its
  hatch, the holiday day's tint and the weekend's, and the shadow under
  the view switch's chosen seat. A thing says its
  category with `data-c`, never an inline colour. The late mark itself is
  the page's one late red, and a hover and a choice are the app's own
  tints, as on the list. `text-contrast` holds every pair that is text to
  4.5:1 on the fill it stands on; the swatches, the bars' fills and the
  year's dots are marks, and the filters beside them name what they mean.
  The switch's tray is the one thing of his the calendar does not take:
  his `#eef0f3` holds only on the ground it was picked on, so the tray is
  the app's tint of whatever it stands on (`--tint-2`, law 1), which
  `segmented-tray-contrast` checks on every ground.
- **Law 26 and the radius scale, the Calendar's filters and Today.** His
  filters, which are also the legend, and his Today are capsules,
  `999px`, where law 26 gives a filter you tap a hairline and the tile
  radius and the scale gives a button `10px` ("go with your
  recommendations", 2026-09-25, which kept his shapes). They keep law
  26's hairline, and a filter says whether it is on with `aria-pressed`,
  its fill and its swatch, never a word in a box. The pills counter reads
  only rules named for a pill, chip, tag or badge, so these two are held
  here, by class: `.hd-cal-filter` and `.hd-cal-today`.
- **Law 14, the Calendar's choice on Month's bars and Year's days.** A
  chosen bar or day wears his ring, 2px of ink hugging its edge, where
  law 14 makes a selection a fill ("go with your recommendations",
  2026-09-25): a bar and a holiday's day are already filled with what
  they are, and a fill over them would hide it. A day of Year picked
  itself (2026-09-26) wears the same ring as the day a chosen thing
  leads. Everywhere else in the calendar a choice is a fill: Month's day
  picked fills its date row, the holiday's own deeper tint on a holiday,
  and 4 weeks' fills its date. The keyboard's focus is law 32's outline,
  2px of ink standing 2px off the edge with paper between, so on Year's
  days the two are told apart by that gap: the choice sits on the day,
  the focus stands off it, and today's own ring is inside it. The panel
  beside them names the choice in words.
- **Law 10, the panel's kicker.** Above the chosen thing's title the panel
  says what kind of thing it is, "Public holiday", "Admin, overdue", 13/500
  in the category's ink ("go with your recommendations", 2026-09-25, which
  kept his panel as he drew it): law 10's retired eyebrow, kept in its
  sentence case and weight, without caps or tracking. An admin date past
  its due keeps the admin's ink there; only his capsule under the title
  turns late, so the late red is said once, as he drew it.
- **Law 18, motion tokens, and law 8, the Calendar's fades.** The Calendar
  moves as the prototype he walked moves it ("design exempt for now, but
  keep a note", 2026-09-24), where law 18 has two tokens and law 8 says a
  page appears. A view, a step or Today: the toolbar says where you are
  going at once, the body fades out on `--t-fast` and the new one fades in
  over his 180 ms, rising his 4px into place (his calSwap). A pick while
  the panel is up, a thing or a day: the views show it at once, and the
  panel fades out what it showed and fades the pick in the same way
  (calPick). A filter turned off: its things fade out on `--t-fast` before
  the view closes up, and turned back on they fade in over 180 ms where
  they stand (calChip). What Save lands grows in over his 280 ms and
  stands on his event tint for 55% of his 2.4 s before easing to the
  choice's grey (calLand, calFresh), past law 8's 300 ms: a flash a row
  asked for with data, once, never a loop. What is lit but not the choice
  — what Save put on the day picked, a series' later dates — has no
  choice's grey to ease to, and stands on the tint, still, for the 2.4 s,
  as Month's do. All of it is for a pointer only: from the keyboard, or under
  reduced motion, each is simply there, and what Save lands is a still
  tint for the 2.4 s. Anything pressed while a fade is on its way lands
  it at once first. What Tiff puts on the calendar lands as a Save does
  once the modal has closed, but still: its first date chosen and every
  date of it in view on the same tint, as his calLand lights the rest of
  a series. It arrives with the modal closing, by × or Escape as often as
  a pointer, never with a press on the calendar.
- **Law 18, motion tokens, and law 8, a tab's content appears.** The faces
  slide, in 280 ms rather than `--t-move`: "Calendar should slide across"
  (2026-09-25). Nothing slides under reduced motion, and nothing slides
  for a face chosen from the keyboard, a tab or a door between faces:
  law 8's "none on keyboard-driven actions" still holds there. A door
  pressed with a pointer slides its face in as its tab would, and so does
  the Diary when Tiff lands something while the Calendar is up, as his
  prototype's `land()` did — simply there when the keyboard drove the
  conversation (opened with a key, closed with Escape or a key), and not
  at all for words said in the Calendar's own room, which land on the
  Calendar (his `calLand`). The day stepping aside for the Calendar rides
  the same 280 ms: the tabs and the body rise over it as the Calendar
  slides in, and go down to uncover it as the Calendar leaves — never from
  the keyboard, never under reduced motion, and not when Tiff's landing
  brings the Diary back, which is decided while rendering, where nothing
  can be measured: the day is simply there.
- **Law 18, motion tokens, and law 8, the grow.** A card that opens grows,
  and the cards beside it give way, in his 350 ms on his `ease`, as the
  prototype he walked eased it: past law 8's 300 ms and off `--t-move`
  ("go with your recommendations", 2026-09-25, which kept his 350 ms
  grow). Finished work folds into its block and opens out of it the same
  way. So does a card the pointer moves onto in a crowded bar: it comes
  out of its sliver or the fold at full strength and the cards beside it
  give way, in the same 350 ms, where law 18 has nothing scale under the
  pointer and law 8 no motion on a high-frequency action. His prototype
  grew the card under the pointer so ("design exempt for now, but keep a
  note", 2026-09-24). Only a move of the pointer counts: a card that
  grows under a pointer standing still is not taken as hovered, so the
  bar never chases it. It is a FLIP on transforms, so nothing is laid
  out again frame by frame. The panel under the bar fades in on
  `--t-fast`, and the body under the day moves to make room for it on
  `--t-move`. Nothing grows under reduced motion, or for a change made
  from the keyboard: a card, the folded block, the cross or Escape.
- **Law 18, motion tokens, and law 8, the diary's wash.** An entry that
  has just landed in the diary, a message from someone who asked you
  something that is today's and unanswered, or what a door asked for,
  stands on his pale teal and fades on his keyframes, as his prototype's
  `protoFresh` did: on at once, held for three quarters of seven seconds, then gone
  over the last quarter, where law 18 has two tokens and law 8 says under
  300 ms ("design exempt for now, but keep a note", 2026-09-24). It is a
  flash a row asked for with data, once, never a loop. Under reduced
  motion it is a still tint for the seven seconds. The door that brings
  an entry up scrolls smoothly only when a pointer pressed it.
- **Law 18, loops.** The Trace moves while the job it marks is on, the
  one thing on the page that does: `hdTrace`, 8 seconds a turn, in the
  loops table above. It is a rotation, which the compositor runs without
  painting the page.
- **Law 16 and law 31, the day's colours.** Each card on "Your day" is
  filled with its job's Workboard colour, darkened only where white on it
  would fall under 4.5:1, and goes pale once finished. The colours are
  worked out in `lib/dashboard/day-bar` (`dayCardPaint`), where every pair
  is measured, and reach the sheet as inline properties; no rule names a
  hue. They are the drawing, which law 31 lets carry colour.
