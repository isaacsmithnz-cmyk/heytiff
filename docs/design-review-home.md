# Home screen design review

**Date:** 2026-08-09 · **Screen:** `/dashboard` ([page.tsx](../src/app/dashboard/page.tsx),
[home.tsx](../src/components/dashboard/home.tsx), [hero.tsx](../src/components/dashboard/hero.tsx))
· **Reviewed at:** 1500×950 and 1040×900, against the real `shell.css` in a static harness.

---

## The short version

The read is correct, and it is traceable to a file that is still in the repo. The home
screen's hero is not a design decision that happened to land on a common shape — it is the
Make/Figma template's home screen, shipped nearly verbatim, with the fake content swapped
for real numbers. Everything downstream of the hero (the two-column cards, the chip system,
the debrief) is HeyTiff's own work and is good. The hero, and the information architecture
the hero forces, is the part that reads as stock.

---

## Where the page came from

`_design/shell-scripts.js:157` is the exported template's `home()` screen. Its markup:

```
'<div class="hero"><div class="mesh"><i class="m1"></i><i class="m2"></i><i class="m3"></i></div>' +
  '<div class="hrow"><div class="hlead">' +
    '<div class="pill">' + I('activity',12) + date + '</div>' +
    '<h1>Good morning,<br><span>Isaac.</span></h1>' +
    '<p class="lede">You have <b>4 critical tasks</b> pending and 7 recent unread updates…</p>' +
    '<div class="hstats"> … 9/11 Tasks Today … 14 Plans This Week … </div>' +
  '</div>' +
  '<div class="ring-bento"> … 94% Efficiency … </div>'
```

and under it, in the same mock: an **ask bar** ("Ask Tiff about sizing, fault codes, or
SOPs…"), **two suggestion cards**, a **Sydney weather card** ("Optimal ambient conditions
for external condenser placement today"), and a **Field Comms feed** whose three fake rows
are "WORK TRITON", "Paramatta Eels vs South Sydney", and "EOFY toolbox available".

That is the generator's idea of what a trades dashboard looks like. Six of those blocks were
never built. The seventh — the hero — was, and the shipped component
([hero.tsx](../src/components/dashboard/hero.tsx)) still carries, unchanged:

| Element | Template origin | Still in the product |
|---|---|---|
| `.mesh` — three drifting teal/blue/violet blur blobs | `shell.css:249–253` | yes |
| Uppercase, `.2em`-tracked date pill with the `activity` glyph | `shell.css:260` | yes |
| `Good morning,<br><span>Isaac.</span>` at 56px | `shell.css:261` | yes |
| Gradient-clipped first name fading to 60% white | `shell.css:262` | yes |
| `"Welcome back. Your workspace is ready."` | `shell-scripts.js:345` | **verbatim string** |
| Glassmorphic stat tiles on the dark slab | `shell.css:299–304` | yes, as the 2×2 counters |

The lede is the tell. `"Welcome back. Your workspace is ready."` is the placeholder the
generator wrote for the screen where it had nothing to say. It has never been replaced, and
it currently occupies the third-most prominent line on the most-visited screen in the app.

### The template's leftovers are still in the stylesheet

None of these are rendered by anything (checked across `src/**/*.tsx`):

| Block | Lines | What it was |
|---|---|---|
| `.ring-bento` / `.ring` / `.rgw` | 476–482 | the 94% "Efficiency" donut |
| `.bento` / `.c8` / `.c4` | 484–488 | the 12-column mock grid |
| `.askbar` | 490–499 | "Ask Tiff…" input |
| `.sgrid` / `.sugg` / `.scat` / `.stt` / `.sds` | 501–509 | the two suggestion cards |
| `.wcard` / `.wg` / `.wtop` / `.wtemp` / `.wnote` | 511–521 | the weather card |
| `.ccard` / `.ctop` / `.comm` | 522–539 | the Field Comms feed |
| `.helix` / `.hx-wave` | 605–612 | a sidebar wave divider |

~74 lines. Worth deleting on its own terms: this stylesheet has already been bitten twice by
dead rules shadowing live components at equal specificity — the comments at `shell.css:283`
and `shell.css:470` are both about exactly that, and one of them cost the dashboard's hero
counters a release.

---

## Findings

### 1. The hero spends the fold on things the reader already knows — 🔴

Measured in the harness at 1500×950: the outlet is 855px tall, and the first piece of
information the reader did not already have starts at **571px** — 67% of the way down. The
491px above it is the date, their own name, a greeting, a placeholder sentence, and four
numbers.

At 1040×900 it is worse. `.hrow` wraps below ~1100px, the counters drop under the greeting,
and the hero becomes **529px tall on an 820px content viewport**. With the debrief strip
that is 645px — **79% of the first screen** — before a single task, notice or expiry.

### 2. The four counters are the formula, and they throw away data the page already has — 🔴

The 2×2 counter grid is the "four notification cards" shape. Worse than generic, it is
*lossy*: [`loadDashboard`](../src/lib/dashboard/page-data.ts) already returns the full
`ActionChip[]`, each with a written `label` ("Rego expired 4 days ago"), a `subject`
("Hilux ute"), an `href` and an `urgency` rank. The page has the sentences and renders the
digits.

`ChipTile` — the component that renders one of those chips properly, glyph-for-domain and
colour-for-urgency — already exists at
[chip-tile.tsx](../src/components/dashboard/chip-tile.tsx) and is used on the
action-required board. Home doesn't use it.

> Context: PR #255 deliberately deleted the band that named the worst item, because it
> duplicated the counters. That was the right call about the *duplication* and, I think, the
> wrong choice about *which one to keep* — a count is strictly less than the item it counts,
> and it costs a navigation to resolve.

### 3. Four tiles, three destinations, one of which isn't a destination — 🟡

From [hero-stats.ts](../src/lib/dashboard/hero-stats.ts):

- **Urgent** → `/dashboard/action-required`
- **Needs attention** → `/dashboard/action-required` (same place)
- **Noticeboard** → `/dashboard/notices`
- **Tasks** → `#dash-tasks` (an in-page anchor, not a route)

Four identical-looking tiles behave three different ways. The Tasks tile in particular looks
like a door and is a scroll.

### 4. The same number is on screen three times — 🟡

`actionRequiredCount()` ([action-required.ts](../src/app/actions/action-required.ts)) returns
`chipSummary(...).total`, i.e. `bad + warn`. So the topbar bell shows **5** while the hero,
200px below it, shows **2** and **3** of the same list. The Noticeboard count appears twice
as well — hero tile and the card's `1 unread` chip.

### 5. The hero cancels the shell's best idea — 🟡

The frame is the app's strongest piece of identity: black chrome, aurora at frame level
(`.framefx`), and a light well inset into it with a 40px top-left radius. On Home, a
`#0A0B10` slab with its *own* aurora (`.mesh`) is dropped into the top of that well at the
same 40px radius. The result — visible in the screenshots — is that the well is reduced to a
40px light border around a dark rectangle, and there are two aurora systems drifting on top
of each other. The one place the frame idea should land hardest is the one place it is
undone.

### 6. 56px is the largest type in the app, and it says the reader's name — 🟡

Every other page head in the app: Workboard `38px` (`shell.css:3444`), Tiff landing `38px`
(`5399`), Tiff library `44px` (`5060`), Time & Pay `38px` (`1535`), Fleet `38px` (`2096`),
profile `30px` (`1038`), Toolbox `48px` (`699`). Home is `56px` — the outlier — spent on
"Good morning, Isaac."

### 7. The one genuinely distinctive thing on the page is the quietest — 🟡

The Debrief row is HeyTiff. No other app has it, it is the front door to the whole note-token
track, and it is a 76px white strip wedged between the hero and the columns, styled like a
consent banner. The capsule inside it already wears Tiff's material — `#0B0E15` with a
teal→blue→violet 1px gradient rim (`shell.css:5961–5969`) — but its container doesn't, so a
Tiff-skinned control sits on a surface that isn't Tiff.

### Smaller things

- The date pill's glyph is `activity` (the ECG line that is also the Workboard's nav icon)
  next to a date. `calendar` is in `ICON_PATHS` and is what it means.
- The gradient text-clip on the first name (`shell.css:262`) fades the reader's own name out
  to 60% white at its right edge. It is decoration with a legibility cost and no signal.
- `.pill` sets `font-family:var(--mono)` (`shell.css:260`). Harmless today — `--mono`
  resolves to Jakarta — but it is the template's mono-eyebrow idiom left in the token.
- `.hero .lede b { color:#fff }` exists for a bolded fragment the shipped lede doesn't have.
  It was styling `"You have **4 critical tasks** pending"` in the mock.
- The all-clear state keeps the hero's full 48px padding and ~307px height to say one
  sentence, "Nothing needs you right now".

### Accessibility

Nothing failing. `rgba(255,255,255,.5)` on `#0A0B10` ≈ 5.2:1 for the lede and the counter
labels, over AA. The one caveat is that the mesh blobs lighten the hero unevenly and drift on
14/18/22s loops, so the contrast behind the right-hand counters varies continuously rather
than sitting at a measured value — `shell.css:818` freezes it under
`prefers-reduced-motion`, but not otherwise. Touch targets are fine (counter tiles ≈ 174×62).

---

## Redesign — round eight (current): one card, five tabs

> **https://claude.ai/code/artifact/e4cee707-33d2-457e-b387-389acfe261e4** — tabs are live.
>
> Isaac's idea: one white card with a tab strip — **Journal · Urgent · Needs attention ·
> Noticeboard · Tasks**, defaulting to Journal, copying the maintenance/projects card. Debrief
> renamed **Journal**.
>
> **Verdict: take it.** It is the first version that makes Home *cheaper* to build than what is
> there now, because every part already exists in `shell.css` and is lifted unchanged —
> `.wb2-vtabs`, `.wb2-vt`, `.wb2-vslide`, `.wb2-vtn`, `.wb2-vtcap`, `.wb2-card`, `.wb2-trj`,
> `.wb2-tk`. Home stops being a bespoke screen.
>
> **The condition it depends on: the counts must live on the tabs.** A tab hides its content by
> definition, and the counters' whole job was the glance. `.wb2-vtn` already ships count badges
> with `.dan` / `.warn` variants, so all four numbers stay visible *and* bring their content —
> strictly better than the cards, which showed a number and nothing else. Journal-as-default is
> only safe because of this.
>
> **Tiff goes in `.wb2-vtcap`** — the slot at the right end of the tab row the Workboard already
> uses for its capture pill ("slightly proud of the tab baseline so it reads as a tool, not a
> sixth tab"). Debrief becomes reachable from every tab.
>
> **The cost:** no ink surface. The mark wears the `core` skin (dark face, no halo) per the
> button's own light-ground rule. Calmer and more consistent; loses the one dramatic surface.
>
> **Naming:** "Journal" is the record, not the act — the composer still needs a verb
> ("Sort it out"). Decide whether the topbar button's language follows.
>
> Build notes: outcome links use `--wb2-cy` #007fa8 (the card family's link colour), *not* the
> ok-green, which is reserved for state. And `.wb2-body[hidden]` must be written at (0,3,0) —
> `.wb2-urbody.twocol { display:grid }` is (0,2,0) and otherwise wins, leaving the Tasks panel
> painted under whichever tab is open.

### The rail loses Noticeboard — as a move, not a deletion

`nav.ts` already has the mechanism and the vocabulary for this. A `subItem` is defined there as
a *"sibling route shown as a tab on the page rather than a row in the rail"*, and the two
exports split accordingly:

- `NAV` — rows **plus** subItems. The command palette's universe.
- `NAV_ROWS` — top-level items only. What the rail draws.

So Noticeboard becomes a `subItem` of `home`: off the rail, still reachable in ⌘K, exactly as
Leave did under Timesheet ("⌘K still lists Leave in its own right") and Knowledge under Tiff AI.
`/dashboard/notices` stays — it is where posting and editing happen, and where the tab's
`board →` door lands.

**`actionreq` is already a `subItem` of `home`.** The tab strip in this design is the first
thing that actually *draws* the tabs that data structure has been describing. Rail goes 16 rows
→ 13.

Not applied in this branch, deliberately — see the sequencing note below.

### Sequencing / collision

Two reasons the nav edit has not been made here:

1. **The redesign isn't built.** Until the tab strip exists, taking Noticeboard off the rail
   removes a nav path to a screen whose replacement doesn't exist yet. The two changes belong
   in one PR.
2. **Another session is already editing `nav.ts` on `main`.** As of this writing the main
   checkout has a *staged, uncommitted* modification to `src/components/shell/nav.ts` that
   removes both `notices` and `actionreq` outright. Committed `HEAD` still has `notices` as a
   rail row. Whoever lands first wins; this branch should rebase onto that rather than make a
   competing edit. (See the shared-worktree hazard — sessions share one checkout and HEAD.)

## Round seven (superseded): journal always on, cards cut down

> **https://claude.ai/code/artifact/d1f87238-3902-4421-bfec-08fd6a8cdd33**
>
> Two corrections from Isaac: the 307px cards **looked silly** (portrait rectangles with one
> digit in them), and the **journal should stay visible until the day resets**, with previous
> days scrollable.
>
> - **The journal no longer waits for a press.** It is the bottom of the panel all day and
>   scrolls back through Today / Yesterday / earlier — the reset moves a divider rather than
>   clearing the page. Today's heading is teal, previous days grey; the scroller is masked at
>   the bottom edge so there is always a visible hint of more.
> - **Pressing Tiff now only grows row one.** The left column becomes the capture box; the
>   cards do not move and the journal is simply pushed down.
> - **`--rowh` is the mechanism.** One custom property on `.hero`: the panel takes it as
>   `min-height`, the card strip as an exact `height`. That is what pins the cards when the
>   panel grows.
> - **Card proportions to choose from:** A square-ish 132px (label top, 60px numeral on the
>   floor), B letterbox 88px (numeral and label share a line), C one card divided into four
>   cells by hairlines at 132px.
>
> Build note found while mocking: with `align-items:start` on the hero grid, the ink layer has
> no content and **collapses to zero height** — it needs `align-self:stretch` or the whole
> panel disappears.

## Round six (superseded): the panel, four counts, and the journal

> **https://claude.ai/code/artifact/b5001ef3-cfdd-4d7a-8090-fbcb803aed39**
>
> Isaac picked **version 2's left panel** and specified the rest: the four cards fill the
> remaining width at *exactly the panel's height*, carry **no text — just the count**, and are
> the app's own four: **Urgent · Needs attention · Noticeboard · Tasks**. Pressing Tiff grows
> the panel **down and to the right so it runs underneath the cards**, its height governed by
> content, keeping a **running journal of everything debriefed that day**.
>
> **How it's built.** One CSS grid, `290px + 4×1fr`. The ink is a *layer*, not a container:
> resting it occupies cell 1/1; open it spans `1 / -1` and rows `1 / 3`. So the growth is one
> rectangle changing size and the cards genuinely float on top of it — no panels appearing,
> no reflow of the cards. `min-height:307px` on the panel locks row 1 so the cards don't jump
> between states; the open panel's textarea flexes to fill.
>
> **The counts.** 104px numerals, bottom-aligned, label pinned to the top edge, so the four
> baselines line up across the row. Urgent and Needs attention keep the state colours; the two
> that are *places* stay ink — red and amber never become decoration. Zero renders grey, not
> absent.
>
> **The journal.** Each entry is what you actually said, verbatim, with the outcomes as quiet
> links underneath ("2 tasks · 1 assigned to Dane · 1 note kept"). Newest first. Three states
> mocked: resting, first debrief of the day, and three-deep at lunchtime.
>
> Open questions: whether closing the panel keeps the journal as a short strip or hides it;
> and whether yesterday's journal rolls into Notes.

## Round five (superseded): the four cards ARE the hero, with Tiff in it

> **https://claude.ai/code/artifact/ecf4dfd3-4487-4207-afde-3735c7742bfa**
>
> Steer: *"the four cards as the new hero"* + *"the debrief button needs to look more like the
> global button and should be incorporated as a hero section."*
>
> **Content model (all three).** The four counters and the five content cards collapse into the
> same four objects — **Need you · Your tasks · Unread · Away today** — so a count and its
> receipts finally live in one place. Payroll folds into Need you ("2 to approve"); the roster
> and the team's open work fold into Away today. 9 surfaces → 4. Numerals at 46px are the only
> big type; no greeting, no chips, no icon tiles. The topbar clock (now shipped) means nothing
> sits above the cards.
>
> **The debrief.** No longer a strip underneath — it is part of the hero and wears
> `.tiffbtn`'s exact anatomy: halo, glass face, chevron and sparkle at the approved 46%/30%
> ratios, and the same ground rule (`glow` skin on ink, `core` skin on the light well). The
> heading keeps the verb — a mark alone is "what does the sparkle do", Isaac's own rule
> from #287.
>
> - **1 · The mantel** — ink band across the top with the mark at 76px; the four cards sit *up
>   onto it*, half on ink and half on the well, so the hero is one object rather than a banner
>   with cards under it.
> - **2 · The left panel** — Tiff takes a full-height column of the hero at 84px (the biggest
>   the mark has been), four cards in a 2×2 beside it. Same spot every morning.
> - **3 · The opening line** — no plate: the mark sits directly on the well in the sheet skin
>   (dark face + core, no halo), one line of copy beside it, cards straight under. No dark
>   surface anywhere on the page.

## Round four (superseded): one card, big elements, no greeting

> Isaac's steer after round three: **no big hero but keep big elements; kill the greeting
> entirely; amalgamate all the cards into one; a few options.** Round four:
> **https://claude.ai/code/artifact/7d0bf967-d193-4942-81b1-d551969f8256**
>
> Shared by all three: everything the five cards carried lives in **a single card** floating
> on the well; the greeting is gone (the date survives as data); round three's noise rules
> stand (dots for state, weight for unread, quiet text actions, the debrief capsule as the
> one dark control, bell owns the tally). Timesheets-to-approve moves into needs-you where
> it belongs; all-in states don't render.
>
> - **1 · The tally** — each zone is a giant numeral (58px) fused beside its own rows:
>   5 need you / 4 tasks / 1 unread / 2 off. The counter and its receipts, one object.
> - **2 · The index** — the counts become declarative 31px headlines: "Five need you." /
>   "Four tasks — one overdue." / "Two with the team." No labels, no numerals, type is the
>   structure.
> - **3 · The masthead** — one card, two materials fused at the Tiff gradient seam: ink head
>   with the date-as-object (09 SUN AUG) + the worst item at poster scale ("The Hilux's rego
>   ran out four days ago." · "and four more need you"), light two-column ledger below.
>   The whole day in one viewport.

## Round three (superseded): three quiet directions

> Round one (plain 38px page head + a `Needs you` chip card) was rejected as flat. Round two
> (THE BRIEF, kept below for the record) was rejected too — Isaac's steer: **a few options,
> think about the whole page, less noise.** Round three is three whole-page directions, all
> built on the same noise cuts, mocked in the live palette and type:
> **https://claude.ai/code/artifact/a96cb4d5-5b3e-4da3-81da-0b9c4d1fd9f8**
>
> Shared by all three: the template hero, the counters, every chip, every icon tile, and all
> boxed cards are gone (6 boxed surfaces → 0–1, 11 chips → 0, 9 always-on buttons → 1,
> 2 aurora systems → 1, largest type 56px → 27px). State becomes a 7px dot; unread becomes
> weight; actions become quiet text. The debrief capsule is the one dark control; the bell
> keeps the tally.
>
> - **A · The ledger** — the whole page is one typeset document on the well, no cards.
>   Sections: Needs you / Today / Your tasks / Across the team / On the board. All-clear:
>   empty sections just don't render.
> - **B · The two rooms** — the well splits; an ink room (greeting, four spoken summary
>   lines, off-today, "Now tell me yours." + capsule anchored bottom) beside the working
>   ledger. Strongest identity; costs ~350px width.
> - **C · The runsheet** — one merged queue, worst first, numbered 01–06, imperative voice;
>   item 07 is the debrief; everything browse-y drops to a three-column shelf. Most
>   opinionated IA: home = triage.
>
> Options compose — A's rows are B's right room; C's shelf is A's quiet sections.

## Round two (rejected): THE BRIEF

> Kept for the record — the line-writing machinery below is reusable if any direction wants
> Tiff-voiced sentences.

**The concept: Tiff briefs you, and you debrief Tiff.**

The app already coined "Debrief" — the button you press before you get stuck in, unloading
your head so the sorting is the machine's problem. The home page is the other half of that
conversation, and it doesn't exist yet: **the Brief**. One ink-glass card at the top of the
well, in exactly the material Tiff's surfaces already wear (the `#0B0E15` capture sheet, the
gradient-rim debrief capsule), in which Tiff *writes you your day* — a salutation and three
to five short sentences, each one a real item with its receipts inline and a door at the end
of the line:

> **Morning, Isaac.**
> 🚚 The **Hilux's rego** ran out **four days ago** — I'd sort that first. →
> 🗝 **Dane's work rights** are still unverified, and **three more** are coming up on the board. →
> 📄 Sarah's pinned notice **mentions you** — *New PPE supplier from Monday*. →
> 🧮 **Two timesheets** are waiting on you for **Friday's pay run**. →
> ☑ **Four tasks** on your plate — the **WHS induction** is two days overdue. ↓

And on the card's other side, the reply: **"Now tell me yours."** — the debrief capsule,
living inside the brief rather than in a white strip below it. The card is literally a
two-way conversation: Tiff's half and yours, split by a hairline. That is a home page no
template generates, and it is *this* product's thesis — talk to it like a person and it
files everything — made into the layout.

### Why this beats both the hero and proposal one

- **The hero's job was presence; the counters' job was information. The brief does both in
  one object.** Ink card, gradient rim, the chevron signing the eyebrow — more identity than
  the mesh slab, not less — and every line in it is data.
- **It converts finding 2 from a hygiene fix into the design.** The page loads full
  `ActionChip[]` sentences and was rendering digits; the brief IS those sentences, worst
  first. Which-is-worst is answered by line order.
- **It scans and it reads.** Each line leads with a small glyph tile carrying the chip
  system's two-channel law (glyph = domain, colour = urgency: red truck, amber calc, violet
  note). Skimmers read the tiles and bold phrases; everyone else reads prose.
- **Busy days get a bigger brief.** Height tracks load: 5 lines ≈ 339px (the hero was 307
  saying nothing), a quiet day is smaller, and **all-clear is one teal-ticked line in a
  193px card** — "All quiet. Nothing's waiting on you, everyone's in, and the board is
  clear." The all-clear idea survives, in words, in Tiff's voice.

### How the lines are written — deterministically

Not an LLM call. A pure `lib/dashboard/brief.ts` with one writer per domain, taking exactly
what `loadDashboard` already returns, so capability gating is inherited (no `financials`, no
payroll line; no `team`, no roster material):

- **Priority order:** bad chips (worst first, aggregate the rest: "…and three more") →
  mentions (being named outranks having something to read — the noticeboard card's own
  rule) → money warns → tasks (overdue named) → roster. Cap at 5, deepest door wins.
- Every line = `{ segments, tone, icon, href }` — pure, jest-testable per domain, gating,
  overflow and all-clear. React escapes by construction; hour/daypart comes from the server
  like the greeting already does, so nothing breaks hydration.
- Tone colours are the hero tiles' existing dark-surface set (#FF6B8A / #F0A431 / #C79BFF /
  teal) — semantic state stays semantic, the gradient rim stays identity.

### The material details

- Card: `#0B0E15`, 30px radius, the sheet's teal→blue→violet 1px rim at ~.5 opacity.
- **The hour's light instead of the template's mesh:** one static radial wash keyed to the
  greeting's daypart — morning puts a low teal glow on the horizon corner and faint blue
  high; evening would flip it. The capture sheet's dusk skin is the precedent: HeyTiff
  surfaces already know what time it is. No drifting blobs; `.framefx` stays the only
  aurora, at frame level, where the design rule puts it.
- Eyebrow: chevron mark + THE BRIEF · date. The mark can keep its `ht-draw` self-drawing
  loop here — Tiff signing the brief.
- Salutation 26px (inside the app's 30–48 range; the 56px monument is gone).
- Below ~1150px the say-column drops to a full-width footer row inside the card —
  heading · copy · capsule — which reads as a conversation bar.

### The mock, measured

Rebuilt in the harness against the real `shell.css` (~90 lines of new `.hm-` rules, the
debrief capsule markup reused verbatim). At 1500×950: first real item at **y≈236** (current
page: y=571), columns at y≈505. At 1040×900 — where the current hero wraps to 529px of
greeting — the brief holds the same five lines plus the debrief footer, all information.
Pane caveat: the 1px rim and dawn tint are at the edge of the pane's downscale; real weights
unverified on a retina display.

### The rest of the page, and the moves that carry over

- Tasks / Noticeboard / Who's-about / Payroll keep the two-column split and the `.card2`
  language unchanged — the brief is the digest, the cards are the working surfaces (Done
  buttons, undo, full lists).
- **The bell owns the tally** (it is already, by construction, the count of the board it
  opens); the brief owns the story; the board owns the list. The number stops appearing
  three times.
- **Delete the template's dead CSS** — the seven blocks above, ~74 lines — and with the hero
  gone, `hero.tsx`, `hero-stats.ts` and the `.hero`/`.mesh`/`.hstat` blocks go too.

### Implementation sketch

`lib/dashboard/brief.ts` (pure writers + tests) · `components/dashboard/brief.tsx` (the
card, debrief capsule moved inside) · `home.tsx` swaps hero + debrief strip for the brief ·
`shell.css` −template blocks −hero blocks +`.hm-` (~90 lines). No schema, no new data reads,
no layout.tsx changes.

---

## Not covered

Phone layout (<640px) — the harness was run at 1500 and 1040 only. The hero's behaviour
below `.hrow`'s wrap point suggests it gets worse, not better, but that is unverified.
