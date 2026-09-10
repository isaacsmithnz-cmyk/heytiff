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
- **Icons are drawn in the chevron's language**, in house, most-used first: a
  7% stroke (1.7 on a 24 grid), butt caps, round joins, and one stroke at 55%
  for the detail or the motion. The Lucide paths in `shell/icon.tsx` are what
  they replace.
- **No texture.** Grain and paper noise are the third generated look. The paper
  idea comes from structure and type.
- **HQ stays as it is.** Its KPI tiles are not user-facing. Not in scope.
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
| 32px | 700 | display, one per screen at most |
| 40px | 700 | display, the sheet and the door only |

Weight 800 is retired. Figures that line up in columns take
`font-variant-numeric: tabular-nums` and carry their unit.

| Surface | Value | Role |
|---|---|---|
| ground | `#F0F2F5` | the page |
| surface | `#fff` | anything that holds content |
| line | `rgba(5,5,5,.08)` | the one hairline; a raised thing is surface plus line |
| overlay | `0 12px 32px rgba(10,12,20,.16)` | the one shadow, only for a thing that floats over the page |

| Spacing | 2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 | two is the hairline gap between chips |
|---|---|---|
| Motion | `--t-fast` 120 ms ease-out · `--t-move` 200 ms ease-out | hover and focus · anything that changes place |
| Layers | base 0 · raised 1 · sticky 10 · overlay 100 · modal 200 · toast 300 | nothing else |
| Dark chrome | one hairline token, no inner highlight | overlays take the one overlay shadow |

A box is one of three things. A **card** is something you act on: surface,
line, 16px. A **group** is something you read: no box, a hairline top. An
**overlay** floats: surface and the one shadow. A fourth kind is a question for
this file, not a new class prefix.

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
11. No hero inside the app. The title line and the facts.
12. Copy: sentence case everywhere; a button is a verb and a noun; success is
    noun plus verb, never "successfully"; no exclamation marks; no apology; an
    empty state leads with the action; a wait says what it is doing.
13. Real content from the first day: long names, truncation, every state.
14. No bar at the start. A coloured line down the left edge of a row, card,
    tile or nav item is not a state and not a selection. Selection is a fill.
    State is a word, or a dot, in the state colour. Kind is a label. The nav's
    active item is its white icon and its white label, nothing else (it was
    teal until the ink-and-paper decision).
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
    that changes place. The overshoot curve `cubic-bezier(.22,1,.36,1)` was on
    69 declarations and is not a Linear value; Linear runs plain 0.1 s and
    0.25 s. The bounce on the command palette goes with it.
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
25. A button with only an icon is a close cross, or the clear cross in a
    search field. Every other button carries its word: "Save estimate", not a
    tick; "Discard", not a cross; "Actions", not three dots. A `title` is not a
    label. Candidates for a named allowance when their family is folded: the
    microphone and stop in the dictation controls, undo and redo in the Studio
    toolbar.
26. State is not a pill. A chip is for a filter you tap. The Workboard's
    chips become words in the state colour at body size.
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

`src/app/dashboard/__tests__/design-ratchets.test.ts` counts twenty-seven things
across every screen stylesheet and component under `src` and holds each count at the number
recorded there. A PR may lower a number. A PR may never raise one. When a
count drops, the PR lowers the recorded number with it, so the number is
always the truth. Every guard was watched failing before it was trusted.

The three paper stylesheets are outside the guards on purpose: the design
sheet (`sheet-doc.css`), the letterhead and the live sheet are documents set
for print, with their own type.

| Ratchet | Law | 2026-09-10 |
|---|---|---|
| type below 12px | the floor | 545 |
| weight 800 or 900 | retired | 625 |
| `transition: all` | transitions name what moves | 96 |
| `text-transform: uppercase` | the eyebrow is retired | 202 |
| radius off the scale | four radii and a circle | 748 |
| ambient `infinite` animation | motion is feedback or state | 45 |
| gradients | one accent, flat surfaces | 136 |
| shadows that are not a focus ring | one shadow, overlays only | 291 |
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
| icon-only buttons that are not a close or clear cross | every other button carries its word | 34 |
| uses of the OK text colour | colour only where it means something | 88 |
| focus rings drawn as an alpha tint | 2px of solid ink | 137 |
| colour declared on anchors | one link token | 26 |

The end state for each is zero, or a short allowlist with a reason beside each
entry (a spinner is state; the orb breathing with the microphone is feedback).

## The order of work

1. **The shell**, still, with a white active item. Decided.
2. **This file and the guards.** No pixels change.
3. **Tokens before screens.** The scales above become custom properties on
   `:root` — the greys, the spacing scale, the two motion tokens, the six
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
     order, and only the family knows which.
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
5. **The icons.**
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
