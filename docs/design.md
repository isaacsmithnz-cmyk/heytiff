# HeyTiff design

The rules, the palette, the scales, and the numbers that hold them. Read this before touching a stylesheet or anything a person sees.

This is the v2 file, written on 18 October 2026 from the layout plan's design rules (`docs/plans/layout-2026-10/3-design-rules.md`) and Isaac's answers since (`6-revisions.md` in the same folder). The file it replaces, with the history of every decision since 10 September, is `docs/design-log.md`. The boards that draw the rules are on the canvas, https://claude.ai/artifact/XF4jr8qxfbr7nR8E59q4xT, pages 1 to 9.

When two sources disagree: Isaac's own words win, then this file, then the canvas pages 1 to 9, then the plan's main tab.

**Moving from v1.** The rules below describe v2. Until step 1 of the build lands, the old tokens are still on `:root` and the screens still wear v1's dress; the ratchets count every place v1 breaks a rule, and those counts fall as each step lands. The order of the build is in `docs/plans/layout-2026-10/4-review.md`, "The order that works".

## Rules 1 to 21

### The frame

- **1. The page and its two curves.** Ink sidebar; a plain white page. The page curls into the ink at its top left, and the ink curls back into the page at its foot: 40 each, square everywhere else.
- **2. The header.** The date and the time together on the left of every page; open tabs on the right.
- **3. New.** At the top of the sidebar, a white disc and the word. Jobs and tasks are made here (rule 44); what belongs to a record comes from its Add (rule 54).
- **4. Search.** Under New, the word alone (no ⌘K beside it, Isaac, 20 October). Finds any record; its last row asks Tiff.
- **5. The eight places.** Home, Conversations, Jobs, Schedule, Documents, Library, Design, Team. The one you're on is white at 12% with its label in bold. No number beside any of them.
- **6. Pinned and Recents.** Stay in the sidebar under the places; a job shows its colour dot.
- **7. Your name.** At the bottom: your card, timesheet, leave, expense claims, Reports and Settings, then Sign out. Reports shows to whoever holds the permission each report needs.
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

- **15. The eight.** Red, orange, yellow, green, blue, purple, pink and grey, each with a bright value and a darker one for words. Plus ink, white and one quiet grey: 19 values in all.
- **16. Red only means wrong.** Overdue, failed, unsuccessful. A job ServiceM8 marks red is unsuccessful, so it keeps its red. No chart or pipe is red.
- **17. State is a word.** Good in green, needs a look in orange, wrong or late in red: a word in its colour, a dot where a list wants one. For your information is a grey word and a grey dot, so blue only ever means press. Never a pill or a fill. A dot always sits beside a word that says what it means.
- **18. A job's colour.** Its ServiceM8 category's colour, snapped to the eight by hue; a category with no hue is grey. A dot beside its name everywhere. No washes, no edge lines. Red follows the Unsuccessful status, never the category.
- **19. Schedule blocks.** Solid blocks in the job's colour at its word value, with white words: black on the bright values was hard to read (Isaac, 20 October). Blue is the press blue, white on it as before.
- **20. Charts.** The kinds of job in the eight, in a fixed order; ventilation grey. A coloured mark always has its figure or name beside it.
- **21. Timesheet days.** A dot and the hours for a day worked. A day away is a small white card with a symbol: a plaster for sick, a sun for leave. The key underneath. No bars or tints.

## Rules 22 to 54

### Buttons

- **22. The main button.** Blue with white words: the one you most likely press, one per area. No black buttons.
- **23. The second button.** White with a thin outline. Every other action that needs a box.
- **24. The quiet button.** No edge until you point at it. Toolbars and rows.
- **25. Delete.** A red word on the second button; a red block only in the dialog that asks you to be sure.
- **26. Links.** Ink, underlined. Going somewhere, not doing something.
- **27. Icon-only.** Close, clear, the microphone, and the ‹ › of a date. Everything else has its word. The sidebar doesn't fold, so it has no collapse control.
- **28. Three sizes.** 32 in rows and lists, 36 in forms and dialogs, 44 on a phone. A field and the button beside it match.

### Choices and fields

- **29. Views of a list.** Soft tabs under the title: words alone, the one you're on in a light fill. No outlines. No tab anywhere carries a number, and a screen's title carries no count beside it ("Team", not "Team 3 people"): a view with something waiting has its word in amber, red when something is wrong (Isaac, 20 October: "We need to rule it out everywhere").
- **30. One of a few.** Day, Week, Month in a thin tray; the chosen one filled light.
- **31. Section tabs.** Underlined, the one you're on standing on 2px of ink. No numbers on them, as rule 29: a tab with something to look at has its word in amber, red when something is wrong (Isaac, 20 October). A job has seven: Overview, Quote, Visits, Checklist, Photos, Documents, Billing. A person has five: Overview, Hours & leave, Papers, Pay, Access.
- **32. Ticks and switches.** Blue when on. A switch saves itself.
- **33. Fields.** 36 tall, a 6 corner, the label above. A wrong field gets a red edge and says why underneath.
- **34. Menus to choose from.** A field with a chevron; opens a menu. A time opens a wheel: the hour, minutes in fives, am or pm. Nothing types a clock time.

### Surfaces

- **35. Card or group.** A card (outline, 16 corner) is something you act on; everything else is a group under a thin line.
- **36. Menus and dialogs.** White, 16 corner, the one shadow. A dialog darkens the page behind it.
- **37. Toasts.** Ink, bottom left, a few words and Undo.
- **38. People.** Initials on a light grey disc.

### Patterns

- **39. A row.** Time or tick, dot, name in bold, a line under it in grey, then a state word or one button on the right.
- **40. Nothing there yet.** Says what's missing and leads with the action.
- **41. Loading.** Nothing for half a second, then Tiff's mark, turning at her working speed, in the middle of where the page will be. A page never wears a skeleton: one shaped like the page never matched it (Isaac, 20 October 2026).
- **42. When something goes wrong.** A red dot and word, what it means for you, and what to do.
- **43. Search.** Results by kind; the last row asks Tiff, with Enter.
- **44. The New menu.** Job and Task: the same two on every page. It fills in only the record you are on, which you can clear: a task made on a job's page is for that job, and made anywhere else it is a general task. A quote is made on its job, through Add. The panel reaches out from the New button, dark, square where it leaves the panel.

### Motion, shape and the rest

- **45. Three speeds.** 120 ms for pointing, 200 for something moving, and a new 280 for a panel sliding across.
- **46. Corners.** 6 fields, 10 buttons and tabs, 16 cards and dialogs, 40 the page's two curves, round for discs.
- **47. Pills.** Only for a person's name in a note. Never for a state.
- **48. On a phone.** The ink is a bar across the top and the page curls into it at its top left (40), square elsewhere. The menu is the sidebar itself, curling at its foot. Controls 44; the box at the bottom.
- **49. Words.** Sentence case, a verb and a noun on every button, no exclamation marks, no "successfully", waits that say what they're doing.
- **50. Text that doesn't fit.** Fades out at its end, as Claude does. Never cut with a "…".

### Making and doing

- **51. The form.** Opens over the page you're on. The record it's for is a field, filled in, that you can change or clear. Saving keeps you where you were, with a toast and Undo. A document opens in its own tab.
- **52. Other doors.** A section's own button, like Book a visit, opens the same form with the record filled in. Tiff reads the same page.
- **53. Actions.** Only what's done to the record itself: its stage, pin, copy the link, print, then what ends it in red. Making is Add's job.
- **54. Add, on a record.** Makes what belongs to that record. On a job: Visit, Task, Quote (Variation once accepted), Cost, SWMS, Certificate. Opens white, like every menu from the page.

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

**The one shadow:** 0 12px 32px at 16% of a near-black, for anything that floats. **The scrim** behind a dialog: near-black at 45%.

**Text on a solid block** (a bar, a column's head on Home): ink on every hue but blue, which takes white. A schedule block is the exception: the hue's word value with white words (rule 19).

**What each colour means:** red only wrong (rule 16); orange needs a look; green good; blue only press (the main button, ticks and switches when on, a selection); grey for your information. A job's own colour (rule 18) and the chart colours (rule 20) are the only other uses.

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

**Corners:** 6 for fields, 10 for buttons, tabs and blocks, 16 for cards, menus and dialogs, 40 for the page's two curves, round for discs.

**Control heights:** 32 in rows and lists, 36 in forms and dialogs, 44 on a phone. A field and the button beside it match.

**Motion:** 120 ms ease-out for pointing (hover, focus); 200 ms ease-out for something that moves; 280 ms for a panel sliding across (new). Nothing ambient, nothing on keyboard or high-frequency actions, and a transition names what moves, never all.

**Layers:** base 0, raised 1, sticky 10, overlay 100, modal 200, toast 300.

**Focus:** a 2px ring of solid ink, at 3:1 or better on any ground, never an alpha tint.

## Kept from today

- **Spacing** on the scale: 2, 4, 8, 12, 16, 24, 32, 48.
- **Six named layers**, as above.
- **One shadow**, only on things that float.
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
| `pkSweep` | the job card's summary while its read is out (v2's chrome skeleton is still) | a skeleton sweep: the space a screen is about to fill |
| `dsSweep` | the Studio's skeleton blocks | a skeleton sweep |
| `tcDots` | the three dots after "Thinking" in Tiff's chat, one rule with each dot delayed | Tiff is working: the Claude-style chat says so in words and dots, with no mark turning (Isaac, 20 October 2026) |
| `ds-sheet-wait` | the sheet's outline while its raster downloads | a skeleton, breathing rather than swept because it is an outline: the plan lands into its place |
| `vmShimmer` | the reading bar while a scanned document is read | a skeleton sweep for a scan in progress |
| `tkShim` ×2 | the ask bar while a question is out; a library shelf while it is searched | a sweep on the thing being searched |
| `tkSpin` | the ask bar's send glyph while a question is out | a spinner in the control you pressed |
| `tkFlow` ×2 | a lane of the research trace, out to a shelf being searched and back from the shelf the answer is drawn from | a spinner, drawn as a pulse along the line that is waiting |
| `tkCaret` | the last paragraph of an answer still streaming | a caret: "is that all of it" |
| `wb2CursorBlink` | the board's answer while it streams | a caret |
| `fgPulse` ×3 | the recording dot beside the recording clock (the Tiff modal's dock, the ask bar's recording card); the row microphone while it listens; Time & Pay's live period | a live dot: something is open right now |
| `int-pulse` | an integration's backfill while it runs | a live dot |
| `orbSpin` | the orb, as the dictation meter | the orb: the microphone is open |
| `orbSaySweep` | the wait's word beside the working mark | the wait's label, lit while Tiff works: the caret's job on a word |
| `dotfSwell` | the mark while you talk, in the Tiff modal and the ask bar's recording card | the microphone is open: a wave through the mark |
| `dotfTurn`, `dotfZip`, `dotfFire` | the Tiff modal's cloud while Tiff has the words | Tiff is working: the mark as a turning cloud until the answer comes back |
| `wb2Flash` | a calendar day the board's data asked to flash | a flash a row asked for with data |
| `tiffGyro`, `tiffNod`, `tiffSheen`, `tiffGimbalA`, `tiffGimbalB`, `tiffArc` | the Tiff button and the mark wherever it stands for Tiff; the rules are declared on every mark but held paused until the mark is working | Tiff is working (rule 8, v2). Since 18 October 2026 the mark is still at rest (Isaac, 17 October: "The mark does not turn at rest. It can stay still."), which retires the override of 24 September. Home's mark (`.tiffmk.alive`) runs them at rest, in the colours, from 20 October (Isaac), and the page's hold (`.pg-hold`, rule 41) runs them working |
| `tiffCyc` ×2 | the two runs of light on a working mark's rings, their gradient stops cycling blue, purple, pink, red, orange, yellow, green | Tiff is working: colour on the mark means she's busy (rule 8). The gradients are only shown on a working mark |
| `tiffCycRing` ×2 | a working mark's two faint rings, in the same cycle, and Home's mark's at rest | Tiff is working (rule 8); Home's mark is alive (rule 8, 20 October) |
| `hdTrace` | the Trace: the white light round the job on now, on Home's day bar | Isaac's override of law 18 (2026-09-24, "design exempt for now, but keep a note"): his live job, marked by a light that runs round its edge once every 8 seconds while it is on. It goes when the job finishes, and stands still under reduced motion. See "Named exemptions" below |

### The buttons that keep their glyph

Law 25 lets a button stand without its word only as a close cross or a clear
cross, and the guard reads those off the label: it begins "Close" or "Clear".
A box you tick is a checkbox, not a button, and says so (`role="checkbox"`);
its word is the label beside it. Every other button that is only an icon is
here, by glyph and class, with its reason, and the guard holds the sheets to
this list the way it holds the loops: both ways, by name.

| Glyph | On | Why it has no word |
|---|---|---|
| `mic` | `wb2-striprnd`, `wb2-micgo`, `tmic` | the microphone of the dictation controls, on a note strip, a note row and the ask bar: the field beside it is the word, and a microphone is the one glyph the trade reads without one |
| `square` | `wb2-striprnd`, `wb2-micgo`, `wb2-dictmic` | stop, in the same controls: it takes the microphone's seat while it listens |
| `x` | `wb2-striprnd`, `wb2-dictx` ×2, `wb2-ico` | the recording's cross beside stop, and the recording card's own cross in Tiff's ask bar (the capture card had a second, and went with the old capture UI, 2026-09-27): each closes a recording, and its label says what closing costs ("Discard") |
| `plus` | `wb2-striprnd`, `wb2-addgo` | a note composer's commit at the end of its one-line field: the placeholder is the word and Enter is the same press. A form's save is a word; a composer's send is the glyph |
| `rotate` | `ds-tool` ×2 | undo and redo in the Studio toolbar, the candidates law 25 named |
| `x` | `camdel`, `ds-plancard-x` | a thumbnail's cross, on a photo badge and on a plan page in the Studio's import: a picture has no room for a word |
| `chevL` | `hd-cal-nb` | the Home calendar's Earlier, his arrow either side of what is in view ("go with your recommendations", 2026-09-25, which kept his shapes): the range beside it is the word, the button is named Earlier, and it rests at the twelve months' edge |
| `chevR` | `hd-cal-nb` | the Home calendar's Later, on the same terms as its Earlier |

### His rulings on a person's page

Two of Isaac's calls on Team's person page break a rule no ratchet counts,
so they are written here rather than in the table below (20 October 2026,
on his mock https://claude.ai/artifact/BH6voDn1axdk96JZCCUSTf).

- **Each group has its icon in its colour** (`.tm2-ic`), despite old law 31,
  colour only where it means something. "Can we add some coloring in
  there? ... These things need to stand out." The colour is the hue's word
  value drawn on the icon itself: no square behind it, no tint, no edge.
- **The emergency contact's title is red** (`.tm2-emerg`), despite rule 16,
  red only means wrong: it is the one group someone has to find in a hurry.
  Its icon is a plaster on the diagonal, never a cross.

### Named exemptions

Isaac's own shapes on the new Home break some of the laws on purpose, on
his word ("design exempt for now, but keep a note", 2026-09-24). A baseline
raised to let them in would let the next rule in with them, unnamed, so
they are held the way the loops are. Five ratchets take a named exemption:
gradients, shadows, bars at the left edge, Tailwind palette hexes and
pills. Each counts the sheets without the rule blocks its own rows cover,
so no baseline moves, and `design-ratchets.test.ts` holds the hits in those
blocks to this table exactly, both ways: a named rule that grows fails, and
a row whose rule has gone fails until the row goes. A block is covered only
when every selector in its list names the class, and a row covers its
class under its own ratchet and no other. A row needs his words and the
day he said them.

| Rule | Ratchet | Count | His words | Date |
|---|---|---|---|---|
| `.hd-page` | Tailwind palette hexes | 1 | "design exempt for now, but keep a note": `--hd-done`, the tick on finished work, is Tailwind's green 600 | 2026-09-24 |
| `.hd-bar` | bars at the left edge | 1 | "go with your recommendations", which kept his end-card line: the first card's outer slant is cut away by the bar, so the open card's 3px ink outline closes down the bar's square end | 2026-09-25 |
| `.hd-chip` | pills | 1 | "go with your recommendations", which kept his On-now capsule: the state word in the day's panel sits in a white capsule, "On now, 17%" | 2026-09-25 |
| `.hd-ls-tag` | pills | 1 | "go with your recommendations", which kept his name tag: a task on the list that is someone else's carries their first name in a grey capsule, where law 26 says a plain word | 2026-09-25 |
| `.hd-trace` | gradients | 5 | "design exempt for now, but keep a note": the Trace, his white light round the job on now, is a conic gradient turning behind a ring that two masks cut from the card's edge, each mask written twice, prefixed and plain | 2026-09-24 |
| `.hd-cal` | gradients | 2 | "design exempt for now, but keep a note": the Calendar's school holidays wear his grey hatch, a striped gradient declared once as the calendar's token, and its swatch the same hatch drawn finer | 2026-09-24 |
| `.hd-cal-tag` | pills | 1 | "go with your recommendations", which kept his span tags: a week in the Calendar's 4 weeks carries a tinted capsule for what runs through it, "School holidays all week", where law 26 says a plain word | 2026-09-25 |
| `.hd-cal-chip` | pills | 1 | "go with your recommendations", which kept his status chip: the Calendar's panel says where the chosen thing stands, "Due in 8 days", in a capsule in the tint of what it says | 2026-09-25 |
| `.wb2-jcattpill` | pills | 1 | "Our mention can just show our name inside a pill. in place of where it was in the note": a task made from a ServiceM8 note carries the note as ServiceM8 shows it, each person it names a pill where their handle stood, where law 26 says a plain word | 2026-09-29 |
| `.hd-cal-vb` | shadows | 1 | "design exempt for now, but keep a note": the chosen seat in the Calendar's 4 weeks, Month and Year switch is paper lifted off its tray by his small shadow, `0 1px 2px`, its colour the calendar's token | 2026-09-24 |

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
