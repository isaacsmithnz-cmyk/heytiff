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
  glow and the active item's glow go. The only light is the content well.
- **One accent.** Teal does four jobs: the brand mark, the focus ring, the
  primary action, selection. Blue and violet leave the interface palette. The
  avatar ring is a hairline; the status dot is gone until presence means
  something. Open: whether orange remains the Studio's drawing colour on the
  canvas. It is not a UI accent either way.
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

| Accent and state | Value | Use |
|---|---|---|
| teal | `#00E5C0`, `#00A389` on a light ground | brand mark, focus ring, primary action, selection |
| ok | `#00735f` text, `#00A389` chip | state |
| warn | `#a44b08` text, `#F0A431` chip | state |
| bad | `#c81a41` text, `#e0264f` chip | state |
| info | `#2554d8` text | state |

State is never the page accent, and the accent is never a state.

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
    active item is its teal icon and its white label, nothing else.
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
    gap between chips. Nothing is typed by feel.
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

## Guards

`src/app/dashboard/__tests__/design-ratchets.test.ts` counts eight things
across every screen stylesheet under `src` and holds each count at the number
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

The end state for each is zero, or a short allowlist with a reason beside each
entry (a spinner is state; the orb breathing with the microphone is feedback).

## The order of work

1. **The shell**, still. Decided.
2. **This file and the guards.** No pixels change.
3. **Tokens before screens.** The scales above become custom properties on
   `:root` — the greys, the spacing scale, the two motion tokens, the six
   layers, the dark chrome's hairline — and the stylesheets are migrated to
   them mechanically; the four daily screens are walked. The only step that
   touches every family at once. Laws 16 to 19 and 22 land here.
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
