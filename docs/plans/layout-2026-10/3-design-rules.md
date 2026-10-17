# Design rules

These 54 rules are all decided. In phase 0 of the build plan they replace the 34 laws in docs/design.md, and each one gets a counter in the design test where it can be counted. Canvas page 1 has them as a board, and every screen on pages 2 to 8 marks the rules it shows with a teal disc carrying the rule's number. The numbers below match the board.

## Rules 1 to 21

### The frame

- **1. The page and its two curves.** Ink sidebar; a plain white page. The page curls into the ink at its top left, and the ink curls back into the page at its foot: 40 each, square everywhere else.
- **2. The header.** The date and the time together on the left of every page; open tabs on the right.
- **3. New.** At the top of the sidebar, a white disc and the word. Job, Quote and Task are made here (rule 44); what belongs to a record comes from its Add (rule 54).
- **4. Search.** Under New, with ⌘K beside it. Finds any record; its last row asks Tiff.
- **5. The eight places.** Home, Conversations, Jobs, Schedule, Documents, Library, Design, Team. The one you're on is white at 12% with its label in bold.
- **6. Pinned and Recents.** Stay in the sidebar under the places; a job shows its colour dot.
- **7. Your name.** At the bottom: your card, timesheet, leave, expense claims, Reports and Settings.
- **8. Tiff's mark.** Black and white at rest: black on the page, white on the ink, turning slowly. While Tiff listens or works, it speeds up and its rings run through the eight. Colour on the mark means Tiff is busy.
- **9. The wordmark.** HeyTiff in one colour. The teal leaves the app.

### Tabs, desktop only

- **10. Open tabs.** A thin outline round each; the one you're on outlined in ink. A cross on each. Tabs replace today's dock of set-aside cards.
- **11. New tab.** Shows when one page is open; opens Search in a new tab. Two tabs never show the same page.

### Type

- **12. Screen titles.** 24, semibold (600, down from 700).
- **13. Reading and writing.** 16 for anything you read or type: notes, the box, Tiff's answers.
- **14. Everything else.** Body 14, labels 13, captions 12 (the floor). Figures in columns line up. One big figure (32) per screen at most.

### Colour

- **15. The eight.** Red, orange, yellow, green, blue, purple, pink and grey, each with a bright value and a darker one for words. Plus ink, white and one quiet grey: 19 values in all.
- **16. Red only means wrong.** Overdue, failed, unsuccessful. A job ServiceM8 marks red is unsuccessful, so it keeps its red. No chart or pipe is red.
- **17. State is a word.** Good in green, needs a look in orange, wrong or late in red: a word in its colour, a dot where a list wants one. For your information is a grey word and a grey dot, so blue only ever means press. Never a pill or a fill.
- **18. A job's colour.** Its ServiceM8 colour snapped to the nearest of the eight, as a dot beside its name everywhere. No washes, no edge lines.
- **19. Schedule blocks.** Solid blocks in the job's colour, black words, white on blue.
- **20. Charts.** The kinds of job in the eight, in a fixed order; ventilation grey. A coloured mark always has its figure or name beside it.
- **21. Timesheet days.** A dot and the hours for a day worked. A day away is a small white card with a symbol: a plaster for sick, a sun for leave. The key underneath. No bars or tints.

## Rules 22 to 54

### Buttons

- **22. The main button.** Blue with white words: the one you most likely press, one per area. No black buttons.
- **23. The second button.** White with a thin outline. Every other action that needs a box.
- **24. The quiet button.** No edge until you point at it. Toolbars and rows.
- **25. Delete.** A red word on the second button; a red block only in the dialog that asks you to be sure.
- **26. Links.** Ink, underlined. Going somewhere, not doing something.
- **27. Icon-only.** Close, clear, the microphone, and the ‹ › of a date. Everything else has its word.
- **28. Three sizes.** 32 in rows and lists, 36 in forms and dialogs, 44 on a phone. A field and the button beside it match.

### Choices and fields

- **29. Views of a list.** Soft tabs under the title: words with their counts in grey, the one you're on in a light fill. No outlines.
- **30. One of a few.** Day, Week, Month in a thin tray; the chosen one filled light.
- **31. Section tabs.** Underlined, each with what's in it in grey: Visits 2, Photos 24. A job has seven: Overview, Quote, Visits, Checklist, Photos, Documents, Billing.
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
- **41. Loading.** Nothing for half a second, then a skeleton shaped like what's coming.
- **42. When something goes wrong.** A red dot and word, what it means for you, and what to do.
- **43. Search.** Results by kind; the last row asks Tiff, with Enter.
- **44. The New menu.** Job and Quote: the same on every page, and it never fills anything in. A task is words to Tiff, or a record's Add. The panel reaches out from the New button, dark, square where it leaves the panel.

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

**Text on a solid block** (a schedule block, a bar): ink on every hue but blue, which takes white.

**What each colour means:** red only wrong (rule 16); orange needs a look; green good; blue only press (the main button, ticks and switches when on, a selection); grey for your information. A job's own colour (rule 18) and the chart colours (rule 20) are the only other uses.

## The scales

**Type.** One face, Plus Jakarta Sans, in four weights (400, 500, 600, 700).

| Size / line / weight | What | Where |
| --- | --- | --- |
| 32 / 40 / 700 | One big figure | At most one per screen |
| 24 / 32 / 600 | Screen title | Jobs, Schedule, a job's name |
| 16 / 24 / 600 | Section heading | Today, To do, Details |
| 16 / 24 / 400 | Reading and writing | The box, notes, messages, Tiff's answers |
| 14 / 20 / 400 | Body | Rows, fields, the sidebar; buttons at 600 |
| 13 / 18 / 500 | Labels | Times, counts, second lines, field labels, small buttons |
| 12 / 16 / 500 | Captions, the floor | Column heads, group labels |

The boards also use 20 / 28 / 600 for a dialog's title and for figures beside the big one. Whether 20 stays is on the build plan's Still open list.

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

## The old laws in docs/design.md

**They stay as written (24):** 1 a tray is a fill or an edge; 3 no hint text; 4 no mono face; 5 no AI badge or sparkle; 6 no emoji as an icon; 9 a card is for something you act on; 10 no eyebrow; 11 no hero inside the app; 12 copy; 13 real content from day one; 15 no taglines; 16 colour from the tokens; 17 spacing on the scale; 19 six layers; 20 no arrow on a button; 21 no middot chains; 22 one hairline on the dark chrome; 24 hover-only controls also show on focus; 27 nothing spins in the first half second; 28 one footer; 29 balanced headings, letter-spacing on display titles only; 32 the focus ring; 33 one height per control size; 34 one link token.

**They change (9):**

| Law | Now |
| --- | --- |
| 2. State colour is never the page accent | State is never blue: blue only means press, and for your information is grey (rule 17) |
| 7. Desktop first | Still first, but the phone is designed now (rule 48), so a phone finding is a defect |
| 8 and 18. Motion | Three speeds: 120, 200, and 280 for a panel sliding across (rule 45) |
| 14. No bar at the start | The schedule's cap goes too, so no left bar is left (rule 19) |
| 23. A hover is one change | Drop the sentence about the teal |
| 25. Icon-only buttons | Close, clear, the microphone, and the ‹ › of a date (rule 27) |
| 26. State is not a pill | Pills only for a person's name in a note (rule 47); Time and Pay's bars and tints go (rule 21) |
| 31. Colour only where it means something | "No accent" goes: blue is the colour of pressing (rules 17 and 22) |

**Also changing:** screen titles 700 to 600 (rule 12); the 24 size used for reading becomes 16 (rule 13); the radius scale gains 40 (rule 46). Truncation (law 13) now means the fade (rule 50).

**Going:** law 30 (Open Graph on the public pages) is done and moves to the log. So do the grey ground #F0F2F5, the teal, black main buttons, the old state colours, and the section "Decisions taken 2026-09-10", which becomes the start of the decision log.

## The ratchets

The test is `src/app/dashboard/__tests__/design-ratchets.test.ts`. A baseline may only go down. A new ratchet starts at today's count.

**Baselines that drop**

- **Bars at the left edge:** 1 to 0, since the schedule's cap goes.
- **Type off the scale:** the scale is 12, 13, 14, 16, 20, 24, 32, 40. Drop 40 once nothing uses it, and 20 too if it goes (Still open).
- **Accent colour uses:** the old accent is the teal, so this falls to 0 when the teal goes, then retires. Blue is counted by a new ratchet instead (below).
- **Tailwind palette hexes, gradients, shadows, letter-spacing:** keep counting; they fall as screens are rebuilt.

**One set that widens, by decision:** the allowed radii are {0, 6px, 10px, 16px, 999px, 50%, inherit, initial}; add 40px for the page's two curves (rule 46). Record it in the decision log, since it's the one change that loosens a law.

**New ratchets**

- **Black buttons:** an ink-filled button (rule 22).
- **Colours outside the 19:** any hex that isn't one of the palette's values, the token block included (rule 15).
- **Blue that isn't a press:** blue outside the main button, ticks, switches and a selection (rule 17).
- **Pills for anything but a name:** a fully rounded box round anything but a person's name in a note (rule 47).
- **Text cut with an ellipsis:** text-overflow: ellipsis, or a typed "…" on screen (rule 50).

Each new ratchet names its law in the test, as the others do.
