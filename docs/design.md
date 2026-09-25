# HeyTiff design

The scales, the laws, and the numbers that hold them. Read this before touching
a stylesheet or anything a person sees. Written 2026-09-10 after an audit of
`src` on main `c02be59` against the catalogue of tells that mark an app as
generated (the research and the audit are linked at the end).

## Why this file exists

The app converged on the generic look by inheritance, not by choice. The v3
Figma shell was ported verbatim, and every screen since inherited its dress:
the 24px card with the icon in a tinted square, the tracked-caps eyebrow over a
38px title, the staggered page entrance, weight 800 for everything, and a frame
lit by roaming orbs. Later screens did not fix that; each grew its own dress
instead, and the stylesheets now hold twenty-five class-prefix families with
thirteen radii and seventy-nine type sizes between them.

The laws that kept some of this out lived in comments and in one assistant's
notes. Neither is read by the next tool that draws a screen. This file is.
Every decision below is made once, here, and a guard test holds each number.

## Decisions taken 2026-09-10

- **The shell is still.** The dark frame, the rail, the bar and the light well
  stay exactly where they are. The aurora blobs, the rising orbs, the corner
  glow and the active item's glow go. The only light is the content well. The
  active item is white on the rail, not teal.
- **Ink and paper. There is no accent.** Decided 2026-09-10, after the three
  ways out were rendered side by side. Ink does the four jobs the accent had:
  the mark on a light ground, the focus ring, the primary action, the selection
  tint. Colour appears on a working screen only where it means something: the
  state words, and the drawing in the Studio. Teal survives in one place, the
  "Tiff" of the wordmark, and nowhere else. The reason is arithmetic before it
  is taste: the accent was three teals, `#00E5C0` at 1.6:1 on white, `#00A389`
  at 3.2:1, `#00735f` at 5.8:1, and the one that could be read was the OK
  state token, which is why the OK colour ended up as decoration 89 times.
  Blue and violet leave the interface palette with it. The avatar ring is a
  hairline; the status dot is gone until presence means something. Open:
  whether orange remains the Studio's drawing colour on the canvas. It is not a
  UI accent either way.
- **Icons are drawn in the chevron's language** (decided 2026-09-14, "use
  whichever is best"): the renderer sets a 7% stroke (1.7 on a 24 grid), butt
  caps and round joins on every icon at once, and a second stroke at 55% only
  where an icon has a clear tail — the search handle, a bell's clapper, the
  dot over an i, the tray under an arrow, sixteen in all, named in
  `ICON_TAILS`. The tail is chosen, never guessed; an icon without a clear
  second stroke has none. The geometry is still Lucide's, redrawn glyph by
  glyph as each family is folded. Two glyphs are gone by law 5, the robot and
  the sparkle, and nothing draws a robot anywhere. The house-drawn connector
  glyphs (a circled X for Xero, a figure-8 for ServiceM8) do not read;
  connectors will carry the providers' own logos, later.
- **Home is one card with three rooms** (decided 2026-09-15, from the
  three-room handoff): the day across the top, a rail of the four faces, the
  face's list, and the page the chosen row opens onto. Its h1 is the date, not
  the word Home: the shell's rail names the screen one column to the left, and
  the day is what the screen is about. Bookings on the day wear the Schedule
  tab's own paint, wash and cap by category, so one booking is one colour on
  the two screens that draw it. Home carries one green of its own (Isaac,
  2026-09-15: "we're missing a little bit of colour"): the part of the day
  that has gone, and the entry being read — two places, and nowhere else. The
  card fills the screen with no width cap — to a 16px edge until 2026-09-20,
  when the well went and the card became the paper itself (below). The rail stands
  beside the shell's rail on purpose. A booking on the band is a door: it
  opens the job card the Schedule tab opens, over Home, on the same row and
  wearing the same day-state; the card's agreement door lands on the board
  with the job open (`/dashboard/workboard?job=`), where the modal lives.
- **The staff card's Summary is the checklist that fills itself in** (decided
  2026-09-15 from the worker-profile handoff; **redrawn 2026-09-16 and the
  second draw is the one to build to**). The first draw kept every law on this
  page and was still hard to read. Isaac, on it: *"it's actually quite hard to
  scan because everything looks the same — it says name, and then the name
  underneath it is almost the same."* That is arithmetic, not taste. Nine
  roles — group title, field label, field value, ticket number, expiry, count,
  link, tab, sentence — were all set at 13/500 or 14/400: one pixel apart, and
  the weight ran BACKWARDS, so a label was heavier than the value it
  introduced. Two greys were being asked to carry hierarchy that size should
  have carried, and the scale has eight sizes while that screen used three.
  What the page is now:
  - **Tiers far enough apart to scan.** 32/700 the name — the one display size
    on the screen, and at 24 it was the same size as the line under it; 24/400
    the standing line; 20/600 in ink a group's title; 12/500 quiet a field's
    label; 16/600 in ink its answer. A label and its answer differ by size,
    weight and colour, not by colour alone.
  - **The right to work is the standing line, not a tile.** It was the first
    tile in the row of tickets, in the same grey as the White card beside it,
    which made the thing that decides whether a person can be sent to a job
    the thing you could not pick out. It is not a ticket: nothing on it
    expires the way a ticket does. It reads as a sentence at the reading size
    — the lead carries the rank in its colour ("Cleared to work" / "Not
    cleared to work" / "Right to work not recorded"), the evidence follows and
    colours only when the evidence itself wants attention. A person on a valid
    visa IS cleared, so a visa about to lapse warns on the visa and not on the
    word "cleared". One rule, `lib/staff/work-rights-summary`.
  - **The facts are a ledger.** Label over value in a three-column grid makes
    the eye zigzag — read down, jump right, read down — the slowest way to
    look one fact up. A 132px label column with the answer beside it and a
    hairline between rows gives one column of scaffolding and one of answers.
    Personal and Emergency sit side by side: Emergency is three fields and
    never earned a band of its own, and the pair is what closed the dead third
    column the grid left at every width.
  - **Absence is said once, and comes with the way to fix it.** Every required
    blank used to be announced twice — the word Required beside the field and
    again in the count above it. On a card with four gaps that made absence
    the loudest thing on the screen, in the page's only strong colour, while
    everything on file sat quiet: the look of a form nobody had filled in. The
    record line counts them now and nothing else does, and the count carries
    the page's one filled object — an ink button onto the first required gap,
    in its form, with the cursor in the field. Ink doing the primary action is
    the job this file already gives it. A blank in a cell is a plain Add, or a
    dash where nobody is short of it. "Profile complete" went the same way:
    11 of 11 in the OK colour is the same sentence with one fact instead of
    two.
  - **The tickets are a list.** Two tiles in a 1000px row look unfinished at
    any quality, because there are two. A ruled list reads as a record at one
    row and still reads at twelve, which is what a ticket wall holds. Each row
    is a door to the tab that manages it, the expiry is the state in its
    colour, and the list keeps its Add whether or not it has rows — with tiles
    the Add was the empty state, and a list needs the way to add the next one.
  - Unchanged from the first draw: colour is state only and kept where it
    means something ("keep colour where it makes sense"); the completion strip
    stays out of the breadcrumb row; the tabs' counts carry the gaps to the
    other tabs; and if the identity row says it, a group doesn't.

  No law in this file changes — a 12/500 quiet field label is what law 10
  asks for, and a group's title is a title, which stands alone. What changed
  is that the page stopped spending its whole budget on the bottom two rungs
  of the scale.

  **And the other eight tabs took the same ledger the same day.** They already
  had its shape — `.pdrow` has been a fixed label column with the answer
  beside it since edit-in-place — but wore a different dress on it: the label
  13/600 in `--gray500` against Summary's 12/500 in `--q`, a 112px column
  against 132, a blank as 14px italic in a literal `#bcc2cd`, and an Add as
  14/600 italic beside a dashed square holding a "+" where Summary drew the
  plain link token. One card, two vocabularies, decided by which tab you were
  on. The dress is Summary's now, on every tab and on the Organisation screen,
  which shares the same rows. The blank is a dash everywhere: `.pdnone` had
  two declarations, one scoped to `.psec2`, so the same absence read as
  italic grey on one screen and clean ink-quiet on another.

  **And the field panels stopped being cards.** `.pdlcard` drew a 1px box with
  a 16px radius around every group of four rows — four of them inside a card,
  inside a panel, inside a tab that already names the screen. Law 9 gives a
  card to something you ACT ON, and you act on the section: one Edit at the
  top, one Save at the bottom, never on a panel. So it is a group now, the
  same one Summary's `.psum-g` has been since it was redrawn — a hairline top
  and a title in ink at 20/600, where the title used to be 12/500 in the quiet
  grey, lighter than the labels underneath it. The first row drops its own top
  rule because the section head already ends in one 16px above: two hairlines
  that close read as a doubled border, not as two things. The panel's "Open"
  lost its chevron with it — law 20's arrow in another alphabet, and no other
  group on this card draws one.

  **One verb for a blank, and it is Add.** The overrides were "Set" on a date
  or a figure and "Select" on a dropdown — the verb naming the CONTROL rather
  than the act, which the reader neither knows nor cares about and which opens
  the same form either way. Three words for "there is nothing here" also gave
  one field two accessible names depending on the tab: Summary said "Add Date
  of birth" where Personal said "Set Date of birth". Law 12 still wants a verb
  AND a noun, and in a ledger row the label column beside the button is the
  noun — which is why the visible word is the verb alone and the field name is
  read out with it. A button with no label beside it, in a panel that holds
  prose or chips rather than rows, carries its own: "Write a note", "List
  qualifications".

- **No texture.** Grain and paper noise are the third generated look. The paper
  idea comes from structure and type.
- **HQ keeps its night ground and its KPI tiles**, and takes everything else.
  On 2026-09-10 it was out of scope (its KPI tiles are not user-facing); on
  2026-09-15 Isaac called its fold. The dark backstage ground stays, because
  the context must be unmistakable against the light app, and the tiles stay,
  because law 11 is for what a customer sees. The rest follows the laws: the
  tokens (which now sit in `tokens.css`, loaded by the root layout, so a route
  outside the frame is no longer a route without the palette), paper doing
  the accent's jobs on the dark ground, state and kind as words, no glow, no
  lift, no coloured left edge, the one overlay shadow, the six layers.
- **The day vocabulary stays, and it is named** (decided 2026-09-15, in the
  mts2 fold). Time & Pay's nine day states — normal, overtime, short, leave,
  sick, public holiday, missing, off, empty — keep a colour each, read against
  the key on the screen, as `--day-*` tokens on `:root`. Blue and violet live
  there as vocabulary, the way the Schedule's categories and the Studio's
  drawing do, not as an accent. What the vocabulary does not cover is ink and
  paper: a day's kind in the panel head is a word in the day's ink, not a
  pill; the rate buckets are words; the pay figure is a figure, not a green
  tile; the derived-hours line, the clock's centre line and the hover borders
  stop borrowing the green. The green pair is still Tailwind's until the
  admin screen's tiles fold, because their on-fill inks are tuned to it.
- **The Workboard wears the handoff's board at a laptop's width** (decided
  2026-09-17, after "the one you made looks terrible compared to the mock
  up", and tuned on the live board over the two days after). The first build
  took the handoff's layout but kept the old board in it — lanes of three
  bold lines at 76px, a red ring round every job that did not go ahead, a
  header that wrapped to two lines below 1500px — and squared the well's
  corners. What it is now: one 56px band of the title, the tabs, the search
  and Display mode — **and the title is the switcher** (decided 2026-09-20,
  from six ways drawn side by side at 1440: "go with 1, the title switcher").
  The three sides stood in a tray on a line of their own for one release,
  which cost 48px of board on every tab and named the screen under a rail
  that already names it. The title says which side you are reading, "All
  jobs", and opens a menu to change it; what the seats did and the menu keeps
  is the summons — the arrow wears a dot in the worst tone waiting on another
  side, and the menu says which side and how many, in words. The mirror's
  freshness at the end of every toolbar; a week
  of seven equal day chips across the toolbar, each the day's name alone,
  the chosen one in ink; cards of three lines in 64px lanes — the customer,
  the job number with the category, the suburb — so every card carries its
  number, with the cap at the card's edge; the day drawn 7am–4pm across the
  rail's width and never under 96px an hour; a job that did not go ahead
  drawn as closed work with the issue mark, and a quote never marked late.
  The well keeps the frame's inset and corner, as on every screen. What
  stays the laws' rather than the handoff's: ink for its teal, sentence case
  for its caps, words and figure boxes for its pills, commas for its
  middots. Open: the key under the board holds too much.
- **Every screen with tabs wears the Workboard's frame** (decided
  2026-09-20; Isaac: "my main objective is to remove the gray light well and
  make use of the full screen inside the shell… and changing the menu
  selection at the top from the Chrome tabs to what we have in the work
  board"). Two changes and no others. The grey well and the card on it go:
  the page is paper to the frame's inset, keeping the frame's 16px corner,
  with no width cap and the tab's own panel doing the scrolling. And the
  folder tabs — the strip whose thumb WAS the card's top edge — become the
  band: the screen's h1, then underline tabs, then whatever the title row
  used to carry, at the right end. What a tab holds is untouched, only
  wider: its own card loses its edge and keeps its padding, so the content
  still stands in the band's 24px gutter. A way back (a staff card's Team, a
  section's Admin) keeps its own line above the band, because it belongs to
  the screen you came from. `.page.full` is what asks for it; `ViewTabs`
  and `BoardTabs` take the title as `lead`. The sheets and the SWMS wizard
  keep the card-edge strip: they are overlays, not pages.
- **A screen with no tabs wears the same band** (decided 2026-09-20). The
  Admin menu, the Noticeboard, the Toolbox, Integrations and the pages it
  opens have one title and no tabs, and they sat on the same grey well. They
  take `ScreenBand` + `ScreenPanel` (`components/shell/screen-band.tsx`): the
  same 56px row, the same 24px gutter, the same hairline, the same right-hand
  end for what stood beside the title — the Toolbox's search, the
  Noticeboard's Post a notice. A list that reads across the screen loses its
  width cap with the well (the Admin menu, Integrations); a form does not
  (Xero, ServiceM8 keep their 760 column), because a field is no easier to
  fill for being 1400px wide.
- **Every screen wears it now, and the exceptions are named** (2026-09-20).
  With the tabbed screens, the untabbed ones, Action required, Projects and a
  project, the Library's All documents, the four tool pages and both SWMS
  screens on `.page.full`, the grey well is gone from the app but for the
  Studio, which is Isaac's to call. Two kinds of surface keep the old shape on
  purpose: the sheets and the SWMS wizard, which are overlays rather than
  pages, and a tool's own body — Heat Load's two-up at 1020, Fault Finder's
  grid, Running Pressures' sticky rail — because that composition is the
  tool's design, not the well's. The route loading skeleton takes the band
  too: it holds the frame a screen is about to fill, with its title block in
  the title's own seat, so nothing moves when the page lands.
- **A title that is DATA must be able to give way.** A project's name, a
  person's, can be any length and the band does not wrap, so a long one used
  to push the last button past the frame's inset, where `overflow:hidden` ate
  it. The title ellipsises, and a cap holding only buttons stops shrinking —
  the board's cap still shrinks, because the search field in it is built to.
- **Home is paper to the frame too** (decided 2026-09-20, retiring the 16px
  margin this file decided on 2026-09-15). The day's card was the only card
  on its screen, so the margin drew a second frame 16px inside the first and
  an edge a pixel from the shell's own. On `.page.full` the card's border and
  corner come off and it IS the screen.
- **The job sheet is parked.** A ruled-list job sheet reads as paper but scans
  worse than the row. Nothing in that direction moves until a version keeps the
  row's scannability.

## Scales

A screen picks a role. It never picks a number.

| Radius | Role |
|---|---|
| 6px | control: input, chip, checkbox |
| 10px | button, tile |
| 16px | card, panel, sheet |
| 999px | pill |
| 50% | circle: avatar, dot |

Three shapes are geometry, not a role, and are read off the element itself:
a square rounded to its half or past it is a disc, `50%`; a bar rounded to
its half is a pill, `999px`; a swatch of 12px or under is a sharp square, `0`
— a key on a drawing has corners. An inner well is concentric with what holds
it, `calc(6px - 3.5px)`, its radius less the inset, never a number of its own.
A corner that is deliberately smaller than the others (a bubble's tail) keeps
the nearest step. When a value sat between two steps it went down: the paper
register is the sharper one.

| Type | Weight | Role |
|---|---|---|
| 12px | 500 | caption, the floor; nothing is set smaller |
| 13px | 500 | label, table cell |
| 14px | 400 | body |
| 16px | 600 | heading in a card or section |
| 20px | 600 | screen section title |
| 24px | 700 | screen title |
| 24px | 400 | reading: the one entry or task being read, one per screen |
| 32px | 700 | display, one per screen at most |
| 40px | 700 | display, the sheet and the door only |

Weight 800 is retired, and so are the variable font's in-between stops, 650
and 750. Figures that line up in columns take `font-variant-numeric:
tabular-nums` and carry their unit.

Under 12 is the floor and goes to 12. When a size sat between two steps it
went **up**, the other way from spacing and radius: those are denser and
sharper for going down, but text is for reading and the floor is a floor. In
the app 32 is the cap; 40 belongs to the sheet and the door. A page title is
an `h1` and is the screen title, 24, whatever it was. A relative size
(`0.86em` on inline code) is not on the scale and not counted: it follows the
text it sits in.

| Surface | Value | Role |
|---|---|---|
| ground | `#F0F2F5` | the page |
| surface | `#fff` | anything that holds content |
| line | `rgba(5,5,5,.08)` | the one hairline; a raised thing is surface plus line |
| overlay | `0 12px 32px rgba(10,12,20,.16)` | the one shadow, only for a thing that floats over the page |
| scrim | `rgba(10,11,16,.45)` | the one veil under a modal or a sheet; a lightbox is darker on purpose |

| Spacing | 2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 | two is the hairline gap between chips |
|---|---|---|
| Motion | `--t-fast` 120 ms ease-out · `--t-move` 200 ms ease-out | hover and focus · anything that changes place |
| Layers | base 0 · raised 1 · sticky 10 · overlay 100 · modal 200 · toast 300 | nothing else |
| Dark chrome | one hairline token, two tints of paper on ink, no inner highlight | overlays take the one overlay shadow; paper does the accent's jobs there |

A box is one of three things. A **card** is something you act on: surface,
line, 16px. A **group** is something you read: no box, a hairline top. An
**overlay** floats: surface and the one shadow. A fourth kind is a question for
this file, not a new class prefix.

A shadow is a shadow however it is spelled. `box-shadow` and `filter:
drop-shadow()` are the same paint and count together; drop-shadow takes none
of box-shadow's exemptions, because it has no spread to draw a ring with and
no `inset` to draw a hairline with. Until 2026-09-21 the guard read only the
first spelling, so six drop-shadows were never counted — the count below said
291 on the day the law was written and the truth was 297. Widening the guard
is what moved the number; the sheets did not get worse. Of the five left (the
canvas plan's own lift went with the dead-CSS sweep, #681), two do a job the
overlay shadow does not and stay, named here: **the star on a photo thumbnail**
in the Workboard's media strip, which separates a gold glyph from an unknown
photo and would vanish on a bright one, and **the Studio's close-ready vertex**,
a glow at zero offset — not a lift — marking the click that closes a room. The
capacity donut's three are a lift under a figure and are owed; they go with the
Studio's new design.

| Ink, paper and state | Value | Use |
|---|---|---|
| ink | `#050505` | text, the mark on a light ground, the primary action, the link, the focus ring (2px solid, 18:1 on the well) |
| ink tint | ink at 7% | selection; a hover is one step of the same ladder |
| paper | white on the rail | the active item |
| wordmark | `#00E5C0`, the "Tiff" only | the one dot; nowhere else on a working screen |
| ok | `#196B2D` text, 6.6:1 on white | state; a plain green, not a teal-green |
| warn | `#a44b08` text, `#F0A431` chip | state |
| bad | `#c81a41` text, `#e0264f` chip | state |
| info | `#2554d8` text | state |

There is no accent, so nothing can be confused with a state. A chroma on a
working screen is a state word, a state dot, or the drawing. The old
`--ok-t #00735f` retires with the teals; a green that reads as green replaces
it, and the chip fill is set in the tokens step beside it.

## Laws

Most of these were already practice. They are written down so the next tool
starts with them.

1. A segmented tray is a fill or an edge, never the ground's own value.
2. State colour is never the page accent.
3. No hint text. A caption that excuses a design which did not explain itself
   is a design bug; fix the design.
4. No mono face. Jakarta only.
5. No AI badge, no sparkle, no feature named after the technology. A feature is
   named after what it does with the data.
6. No emoji as an icon.
7. Desktop first. A phone-width finding is unbuilt surface, not a defect.
8. Motion is feedback or state. Under 300 ms, ease-out on entry, none on
   keyboard-driven or high-frequency actions, and never ambient. A page
   appears; it does not arrive.
9. A card is for something you act on. Everything else is grouped by space,
   proximity and type.
10. The eyebrow is retired. A title stands alone; what the eyebrow said goes
    under it in sentence case, body size, the quiet colour, with real figures.
    Tracked caps are the eyebrow's dress and go with it: a label is sentence
    case, 12 or 13, weight 500, the quiet colour, no tracking. Text typed in
    caps in the markup is the same tell one layer down. The one thing set in
    caps is a registration plate, because the plate is.
11. No hero inside the app. The title line and the facts.
12. Copy: sentence case everywhere; a button is a verb and a noun; success is
    noun plus verb, never "successfully"; no exclamation marks; no apology; an
    empty state leads with the action; a wait says what it is doing.
13. Real content from the first day: long names, truncation, every state.
14. No bar at the start. A coloured line down the left edge of a row, card,
    tile or nav item is not a state and not a selection. Selection is a fill.
    State is a word, or a dot, in the state colour. Kind is a label. The nav's
    active item is its white icon and its white label, nothing else (it was
    teal until the ink-and-paper decision). A dot may sit at the left edge; a
    bar may not. One bar stays: the cap on the Schedule board's blocks, their
    leading edge in the category's colour, which the board's key mirrors — that
    board's vocabulary, not a state.
15. No taglines, and no caption that explains the section. The two shapes:
    three nouns in a row under a title ("splits, ducted, multi") and a line
    that says what the section is for ("What lets the business trade —
    nothing expiring"). The title names the section; the content shows what
    it is for. A line under a title earns its place only when it carries a
    fact the reader came for, with a figure, a date or a name. "3 need
    attention" is that fact. "Nothing expiring" is the same fact as
    reassurance, and "What lets the business trade" is an explanation. Keep
    the fact, drop the rest.

Round two, 2026-09-10. Fifteen more, found by a second research pass and
approved together.

16. Colour comes from the tokens. No hex outside the token block. The greys
    are chosen: ink, quiet text, the line, surface, ground. They were
    Tailwind's gray-50 to gray-900 by value, and two tokens were Tailwind
    steps by definition (`--gray700`, `--gray600`). The state colours were
    Tailwind's red, green, teal and amber.
17. Spacing is on the scale: 2, 4, 8, 12, 16, 24, 32, 48. Two is the hairline
    gap between chips. Nothing is typed by feel. Three things are not spacing
    and stay off the scale: a 1px optical nudge; a layout offset above 48, a
    rail's width or a footer's clearance; and a negative margin, which is an
    offset that centres a disc or hides a border. A value that is really a
    sum of a neighbour's parts, a card's padding plus its border, is written
    as that sum, `calc(24px + 1px)`, never as 25, so the guard that owns the
    neighbour can read it. When a value sat between two steps it went down: a
    working screen is dense.
18. Motion has two tokens and no curves of its own: `--t-fast`, 120 ms
    ease-out, for hover and focus; `--t-move`, 200 ms ease-out, for anything
    that changes place. A transition names what moves — never `all`. A hover
    is one step of the ink ladder, a fill shift; nothing lifts, scales,
    nudges or grows a shadow under the pointer, and a press moves 1px. A page
    appears, a panel appears, a tab's content appears: nothing arrives
    staggered. What may loop: a spinner, a skeleton sweep, a caret, a live
    dot, the orb and the capture card's mark while the microphone is open or
    Tiff is working, and a flash a row asked for with data. A halo, a
    breathing glow, a logo drawing itself and a dot that nudges toward the
    next step do not. Every loop that runs is named under Guards.
19. Six layers, named: base 0, raised 1, sticky 10, overlay 100, modal 200,
    toast 300. There were 36 values from 0 to 1200.
20. No arrow on a button. "Continue", not "Continue →". An arrow between two
    values ("21.5° → 23°") is a fact and stays.
21. No middot chains. A line under a title is a sentence, or a label and a
    value. The one allowance is a keyboard hint: "Esc to cancel".
22. The dark chrome has one hairline token and no inner highlight. An overlay
    on it takes the one overlay shadow, not its own.
23. A hover is one change: a fill or a colour. Nothing lifts, slides, scales,
    sweeps or grows a shadow on hover. The nav label stops moving; the active
    item is its teal icon.
24. A control hidden until hover is also shown on `:focus-within`, or it is
    not hidden. Keyboard users get the delete control back.
25. A button with only an icon is a close cross, or a clear cross: the one in
    a search field, the one on a chip, the one beside a chosen value. Every
    other button carries its word: "Save", not a tick; "Discard", not a
    cross; "Actions", not three dots. A `title` is not a label. A box you
    tick is a checkbox, not a button, and its word is the label beside it.
    The few that keep their glyph — the dictation controls, undo and redo in
    the Studio toolbar, the rail's handle, a thumbnail's cross — are named
    under Guards, each with its reason.
26. State is not a pill. A chip is for a filter you tap. The Workboard's
    chips become words in the state colour at body size, and so do every
    status pill, kind tag and badge on the light well: the word, 14/500, no
    fill, no box. What keeps a chip's form is what a person taps or types
    into — a filter, a segmented choice, a tag strip — which wears a hairline
    and the tile radius. Time & Pay's day and rate vocabulary is settled
    above: the day's colour is a bar and a tint with a key, the kind and the
    rate buckets are words.
27. Nothing spins in the first half second. Past a second, a skeleton shaped
    like what is coming. The ring lives only inside a button that says what it
    is doing.
28. One footer. The ten footer families fold into one, and the buttons name
    the choice: "Keep" and "Delete file", "Cancel" and "Rename".
29. `text-wrap: balance` on headings only. Letter-spacing on display titles
    only; the positive tracking leaves with the eyebrows. "…", never "...".
30. The public pages carry Open Graph metadata and an image. The live design
    link is sent to customers and arrived as a grey box. A task, not a law,
    and the first small PR of the visual work.

Round three, 2026-09-10. Four found by the third research pass; three of them
became consequences of the ink-and-paper decision rather than choices.

31. Colour only where it means something. With no accent, a chroma on a
    working screen is a state word, a state dot or the drawing. The OK colour
    is never an eyebrow, an icon tile or a hover; it was, 89 times.
32. A focus ring is 2px of solid ink at 3:1 or better on any ground, never an
    alpha tint. The commonest ring was blue at 30% opacity, near 1.4:1 on
    white; it existed and could not be seen.
33. One height per control size. An input and the button beside it share it.
    Four heights sat in the same rows: 42, 32, 30 and 28.
34. One link token: ink, underlined. Links were declared eight ways, brand
    blue in one place, three greys elsewhere, teal in the diary, ink in the
    Toolbox.

## Guards

`src/app/dashboard/__tests__/design-ratchets.test.ts` counts twenty-six things
across every screen stylesheet and component under `src` and holds each count at the number
recorded there. A PR may lower a number. A PR may never raise one. When a
count drops, the PR lowers the recorded number with it, so the number is
always the truth. Two it holds by name instead — the loops, and the buttons
that keep their glyph — in the lists below. Every guard was watched failing
before it was trusted.

The three paper stylesheets are outside the guards on purpose: the design
sheet (`sheet-doc.css`), the letterhead and the live sheet are documents set
for print, with their own type.

| Ratchet | Law | 2026-09-10 |
|---|---|---|
| type below 12px | the floor | 545 |
| type off the scale | eight sizes, picked by role | 1,223 |
| weight off 400, 500, 600, 700 | 800 is retired, and 650 and 750 with it | 671 |
| `transition: all` | transitions name what moves | 96 |
| `text-transform: uppercase` | the eyebrow is retired | 202 |
| radius off the scale | four radii and a circle | 748 |
| ambient `infinite` animation | motion is feedback or state; held by name since 2026-09-15, below | 45 |
| gradients | one accent, flat surfaces | 136 |
| shadows that are not a focus ring | one shadow, overlays only, `box-shadow` and `drop-shadow` alike; the figure was 291 until the guard learned the second spelling on 2026-09-21, above | 297 |
| bars at the left edge | selection is a fill, state is a word | 27 |
| Tailwind palette hexes | colour comes from the tokens | 261 |
| spacing off the scale | 2, 4, 8, 12, 16, 24, 32, 48 | 2,866 |
| `cubic-bezier` | two motion tokens, no custom curves | 104 |
| distinct z-index values | six layers | 36 |
| arrows in on-screen strings | the word is the button | 18 |
| middot chains in on-screen strings | a sentence, or a label and a value | 242 |
| inner-highlight glass edges | no glass | 6 |
| white-alpha hairlines on the dark chrome | one hairline token | 38 |
| stacked hovers (transform and shadow together) | a hover is one change | 34 |
| hover nudges (`translateX` on hover) | nothing slides on hover | 11 |
| hover-revealed controls | shown on focus too, or not hidden | 25 |
| pill, chip, tag and badge rules | state is a word | 141 |
| letter-spacing | display titles only | 451 |
| icon-only buttons that are not a close or clear cross | every other button carries its word; held by name since 2026-09-15, below | 34 |
| uses of the OK text colour | colour only where it means something | 88 |
| focus rings drawn as an alpha tint | 2px of solid ink | 137 |
| colour declared on anchors | one link token | 26 |
| accent colour uses | ink does the accent's jobs | 468 |

The end state for each is zero, or a short allowlist with a reason beside each
entry (a spinner is state; the orb breathing with the microphone is feedback).
The loops reached theirs first.

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
| `pkSweep` ×3 | the route skeleton, the chrome skeleton, and the job card's summary while its read is out | a skeleton sweep: the space a screen is about to fill |
| `dsSweep` | the Studio's skeleton blocks | a skeleton sweep |
| `ds-sheet-wait` | the sheet's outline while its raster downloads | a skeleton, breathing rather than swept because it is an outline: the plan lands into its place |
| `vmShimmer` | the reading bar while a scanned document is read | a skeleton sweep for a scan in progress |
| `orgLogoSweep` | the logo tile while a new logo uploads | a sweep across the subject, rather than an icon landing on it |
| `tkShim` ×2 | the ask bar while a question is out; a library shelf while it is searched | a sweep on the thing being searched |
| `tkSpin` | the ask bar's send glyph while a question is out | a spinner in the control you pressed |
| `tkSlide` | the library's progress bar when it cannot say how far | a spinner, drawn as a bar |
| `tkFlow` ×2 | a lane of the research trace, out to a shelf being searched and back from the shelf the answer is drawn from | a spinner, drawn as a pulse along the line that is waiting |
| `tkCaret` | the last paragraph of an answer still streaming | a caret: "is that all of it" |
| `wb2CursorBlink` | the board's answer while it streams | a caret |
| `fgPulse` ×3 | the recording dot beside the capture clock; the row microphone while it listens; Time & Pay's live period | a live dot: something is open right now |
| `int-pulse` | an integration's backfill while it runs | a live dot |
| `orbSpin` | the orb, as the dictation meter | the orb: the microphone is open |
| `orbSaySweep` | the wait's word beside the working mark | the wait's label, lit while Tiff works: the caret's job on a word |
| `dotfSwell` | the capture card's mark while you talk | the microphone is open: a wave through the mark |
| `dotfTurn`, `dotfZip`, `dotfFire` | the capture card's cloud while Tiff has the words | Tiff is working: the mark as a turning cloud until the answer comes back |
| `wb2Flash` | a calendar day the board's data asked to flash | a flash a row asked for with data |
| `tiffGyro`, `tiffNod`, `tiffSheen`, `tiffGimbalA`, `tiffGimbalB`, `tiffArc` | the Tiff button, on the frame and in a sheet's header; and the mark wherever it stands for Tiff (at rest, at the thinking pace while Tiff works, or on hover in a list) | not feedback or state: Isaac's override of law 18 (2026-09-24, "make it gently alive all the time"), the one thing in the app that moves at rest. See "The Tiff button" below |

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
| `x` | `wb2-striprnd`, `wb2-dictx` ×2, `wb2-ico` ×2 | the recording's cross beside stop, and the capture card's own cross: each closes a recording, and its label says what closing costs ("Discard") |
| `plus` | `wb2-striprnd`, `wb2-addgo` | a note composer's commit at the end of its one-line field: the placeholder is the word and Enter is the same press. A form's save is a word; a composer's send is the glyph |
| `rotate` | `ds-tool` ×2 | undo and redo in the Studio toolbar, the candidates law 25 named |
| `chevR` | `railtg` | the rail's handle, a chevron riding the seam between rail and content; the shell stands as it is |
| `x` | `camdel`, `ds-plancard-x` | a thumbnail's cross, on a photo badge and on a plan page in the Studio's import: a picture has no room for a word |

### The Tiff button

The logo as a gyroscope (Isaac, 2026-09-25, picked from the "Tiff Button in
3D" board). A solid chevron leans 18° and the lean circles once every 6
seconds, with a small nod on it. It sits inside two gimbal rings that turn on
their own axes with a line of light running along each, and a band of light
crosses its face once a turn. It is 36px on the frame and 30px in a sheet's
header, beside the close cross. The ground decides the skin. On the ink frame
it has a paper face and the brand gradient in its depth. On a sheet's paper
the face takes the brand gradient and the depth goes a step darker. It has no
disc, no halo and no sparkle: "aura looks too generic ai". A press turns the
mark once on its point and sends a ring out from its edge.

It breaks five laws, on Isaac's word ("they are design exempt for now, but
keep a note", 2026-09-24). This is the note:

- **Law 18, loops.** It moves at rest, the only thing in the app that does.
  Its six keyframes are in the loops table above, and every one stops under
  reduced motion, leaving a still pose: the mark leaning, the rings tipped.
- **Law 18, motion tokens.** Its clocks (6, 7, 5, 2.6 and 1.5 seconds) and
  its press (800 ms) are its own, not `--t-fast` or `--t-move`.
- **Law 23, hover.** A hover is two changes here: the rings brighten and the
  mark comes forward 7%. Keyboard focus does the same.
- **Law 16, colour.** Its colours are its own tokens, `--mark-*` in
  `tokens.css`: the logo's colours on the logo, the way `--wordmark` is. The
  accent count does not read them, by design, as it does not read
  `--wordmark`.
- **Law 25, the word.** It is the mark alone. Its label is "Ask or tell
  Tiff", and in a sheet it names what the sheet is about.

The gradients and shadows ratchets did not move. The old press wash's
gradient went as the band of light's came, and the button casts no shadow.

**The mark elsewhere** (`TiffGlyph`, 2026-09-25). Wherever the chevron
stands for Tiff it is the gimbal too, and it moves the way the button does.
Isaac chose it after a still pose read as a smudge at label size: "round
end, moving, no dark background". That is the same law 18 exemption as the
button's, on his word, and it runs the button's six loops with no new one.

- **At rest** it runs at the button's pace: the Tiff chat's header and ask
  bar and its "General knowledge" choice, the answer's ribbon, the palette's
  footer, the fleet's Tiff total, "Read by Tiff" on a scanned receipt, and
  the vehicle card's "Tiff value".
- **Working** it runs at the thinking pace: every wait (it replaced the orb
  there; the orb stays the dictation meter), "Tiff is valuing…" on the
  fleet, and a receipt being read.
- **Quiet** it moves only while its control is hovered or focused, or its
  row, where a list row declares itself the host with `data-tiff-hover`.
  That is for a mark repeated down a list, like Ask Tiff on every document
  in the library or Tiff's price on every vehicle, where a hundred turning
  marks would be a page of motion.
- It is small, so the logo fills more of it: 74%, with the rings at its edge.
- **A Tiff control has a round end** (`.tiffkey`): a button that asks Tiff
  (Ask Tiff, Value with Tiff) has a full circle for its left end. The mark
  sits in it, concentric, with no disc behind it: the rings are the circle.
  The radius is on the scale (the pill and the button's own).

## The order of work

1. **The shell**, still, with a white active item. Decided.
2. **This file and the guards.** No pixels change.
3. **Tokens before screens.** The scales above become custom properties on
   `:root` (in `src/app/tokens.css` since the HQ fold, so every route has them) — the greys, the spacing scale, the two motion tokens, the six
   layers, the dark chrome's hairline, and now ink in the accent's four jobs,
   the ink ring, the link token, one height per control size and the plain
   green for OK — and the stylesheets are migrated to them mechanically; the
   four daily screens are walked. The only step that touches every family at
   once. Laws 16 to 19, 22 and 31 to 34 land here.

   Split into five PRs on 2026-09-10, once the counts were in hand, because
   four of the families recolour or reflow whole screens and each needs its
   own walk:
   - **3a, the tokens and the neutrals.** Every token defined on `:root`; the
     Tailwind greys onto `--ink`, `--q`, `--line` and `--tint`; the 104 curves
     onto `--ease`; the 154 focus rings onto the two-tone `--ring`, paper
     inside ink, which shows on any ground; the OK colour split, 38 state
     uses on the new green and 60 decorative uses onto ink; the light-ground
     links onto `--link`. Lands unwalked: nothing moves, and the contrast
     guards read the result.
   - **3b, the accent.** About 900 declarations of teal, blue and violet
     become ink, the ink tint, or a state tint by role. Time & Pay's private
     green fills, the day vocabulary, are settled here too. Walked.
   - **3c, spacing** (2,861 values onto the scale), **3d, radius** (747 onto
     the four), **3e, type** (545 sizes under the floor, 625 rules at 800).
     Each walked; each reflows.
   - z-index and the dark chrome's hairlines are settled family by family in
     the fold (step 6): a layer scale collapses siblings that rely on their
     order, and only the family knows which. The frame's own went last
     (2026-09-15): its edge hairline, its two shadows, the topbar's glass and
     the well's inner highlight were paint the one-piece frame had already
     cancelled, so they went without a change on screen; the nav's group
     divider is the one hairline token, and now shows. The Studio's dark
     chrome followed the same day: its start screen, its HUD, legend and
     zoom control, the unit card, present mode and the live sheet's door
     sit on the on-ink tokens, the elevated dark and the one overlay
     shadow, with no glass. The board's dark surfaces closed the count the
     next day (2026-09-16): the media viewer, the capture card's dusk and
     the toast, on the same tokens, and the last inner highlight went with
     the dusk card's drop. White-alpha hairlines and inner highlights stand
     at zero.
4. **The inherited tells**, one walked PR each: the orbs, the card and its
   icon square, the eyebrows, the stagger and shimmer and spotlight, the
   hero on My Vehicle. Then the two Isaac named on 2026-09-10: the bars at the
   left edge (33 places on that day, eleven of them in the Workboard, seven in
   the Toolbox) and the taglines and section captions (the list is in the
   step 2 PR). Then round two's screen-level tells: the arrows on buttons,
   the middot chains, the stacked hovers and the nudge, the pills, and the
   small ones (laws 20, 21, 23, 26, 29).
4a. **Open Graph for the public pages** (law 30). Its own small PR, and the
   first visual one to land: it is the only change a customer would notice
   this week.
5. **The icons.** Done as a renderer change with chosen tails (above); the
   glyph-by-glyph redraw rides with each family in step 6.
6. **Fold the dress families into the tokens**, one per PR, deleting dead CSS as
   you go. The hover-only controls, the icon-only buttons, the spinners and
   the ten footer families are fixed family by family here (laws 24, 25, 27,
   28). By rule count: `wb2-` 1,316 · `ds-` 325 · `hq-` 287 · `tk-` 281 ·
   `hm-` 265 · `vm-` 245 · `fl-` 203 · `mts2-` 155 · `dsd-` 129 · `wb-` 102 ·
   the rest. The v3 Studio glass chrome in `shell.css` (`.fg .dhead`,
   `.dtools`, `.dstatus`, `.dprops`, `.dview`, `.dread`) has no consumer and
   goes first. Target: both big stylesheets halved.
7. **The paper.** Parked, see above.

Walking means merging, because previews cannot sign in, and a deploy reloads
open tabs, so nothing merges while Isaac is designing. Batch by step, walk each
step in one sitting.

## What stays because it is already ours

No component kit: the app is hand-written CSS with Tailwind imported and barely
used. One typeface. Real focus rings. No AI badge. And the copy: no exclamation
marks, no "Oops", no "successfully", no "Are you sure", empty states written in
the trade ("Nothing claimed yet — the deposit is usually the first row"), and a
wait that says what it is doing. That is the app's strongest signature. Guard it
as hard as the rest.

## References

- The landscape: https://claude.ai/code/artifact/90a7cf7b-76b2-4c05-bf07-a75a6420cc8d
- The audit and the seven-part markup: https://claude.ai/code/artifact/e8237787-9957-40a7-895d-539d4db07482
