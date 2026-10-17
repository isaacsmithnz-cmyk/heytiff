# HQ inventory (for the HQ variant board), from the HQ reader, 15 October

Repo a01b18f. 8,427 lines across 42 HQ files; hq.css 1,576 lines.

## Pages
- Gate: src/app/hq/layout.tsx:15 requireHqPage(); src/lib/hq/guard.ts:31-36 (no session: login; not allowlisted: 404). Allowlist of Auth0 ids, src/lib/hq/allow.ts:24-38. proxy.ts:9 login-protected, proxy.ts:22-24 not workspace-protected (HQ staff may hold no org).
- /hq: 7 KPI tiles (page.tsx:138-160), Organisations table, System and support card (env checklist, page.tsx:118-136).
- /hq/orgs/[id]: members table; Delete workspace when empty (orgs/[id]/page.tsx:50-57, :117-122).
- /hq/data: a card per brand pack (brand-cards.tsx:19-55). /hq/data/[brand]: stale-override and validation warnings, WatchlistPanel, HqBrandCatalog editor (1,223 lines, brand-catalog.tsx): search with counts, expand/collapse, system-type tabs with counts, series accordions, comparison tables with sticky Model/Status columns, capacity chips cool/heat/ref, "+" add buttons (red when engine-blocking), To-add group in amber, override amber value + dot, value-edit popover with airway editor, tag editor popover with bulk apply.
- /hq/changes: audit trail grouped by day (changes-list.tsx:43-72).
- /hq/map: system map, 58 nodes from src/lib/hq/system-map.ts; wires as SVG beziers (system-map.tsx:66-103); inspector aside with "Open {name}" into the dashboard (:263-267); kind colours as hex literals in TSX (:25-29, one is the teal #00e5c0).
- Components: hq-nav (Overview, Data, Changes, System map), kpi-grid (32/700 figures), org-table (uses the shell's Icon), system-card, brand-cards, brand-catalog, changes-list, delete-workspace (typed-name confirm), watchlist-panel (5 auto signals + manual add/resolve), system-map.
- Actions: hq-overrides.ts, hq-watchlist.ts, hq-workspaces.ts.

## Tokens
- Own: --hq-bg #0e1114, --hq-panel #161a1f, --hq-panel-2 #1c2127, --hq-line #262c33, --hq-scrim .55, --hq-ink var(--paper), --hq-mut var(--on-ink-q), --hq-block #ff6b5d, --hq-ready #3ddc97, --hq-edit var(--warn), --hq-cool #6aa2ff, --hq-heat #ff8a75 (hq.css:13-25).
- Shared from tokens.css: --t-fast 12, --ease 12, --r-button 10, --r-control 8, --r-card 6, --z-sticky 3, --z-raised 3, --warn-tint 3, --ring 3, --bad-tint 2, --z-modal 1, --wordmark 1, --warn 1, --shadow-overlay 1, --paper 1, --on-ink-q 1, --font-jakarta 1.
- Phase 1 risk: --paper feeds every word in HQ (36 rules); --on-ink-q every quiet word (72 rules); --warn (an "old state colour") feeds the override amber (17 rules + tints); --wordmark the teal "HQ"; --ring is paper-inside/ink-outside, invisible as solid ink on night (tokens.css:126 has --ring-ink). Motion/radius/layer tokens survive if names are kept. Fix: give HQ its own --hq-* aliases for text, quiet, edited, blocking, ready and ring in the same change as phase 1, reading the palette's dark-ground values.
- Ratchets already scan hq.css (design-ratchets.test.ts:34-57) and the hq TSX (:128-150): letter-spacing baseline includes hq.css:114, :158; new ratchets would count hq.css:670 (ellipsis) and 13 hexes (hq.css:14-25, system-map.tsx:25-29). page-title-size.test.ts:38-44 leaves hq.css out by name.

## The variant against the rules
- Apply unchanged: type sizes (title 24/700 → 600; one 0.86em at :39 off scale), buttons (.hq-btn primary/ghost/danger → main/second/delete; ad hoc sizes), fields (.hq-search, .hq-pop-input, .hq-watch-input → 36/6/label above), tabs (.hq-tabs with counts → soft tabs; hq-nav → section tabs), rows/tables, state words (already words), rule 50 fade (hq.css:666-671), rule 49 words (Add, Save, Resolve, Clear, Tags…), rules 40-42 (no loading.tsx; .hq-warn fills → dot and word).
- Need a dark-ground reading: the 19 values on #0e1114 (word values chosen for white fail 4.5:1; hq.css:8-11 says so); which bright/word per hue; rule 22 blue button on night vs today's paper-on-night primary; rule 35 cards (KPI tiles kept by Isaac; brand cards and map nodes act; tables do not); rule 36 dialogs (night .hq-pop + .55 scrim vs white dialog + .45); rule 26 links (whole-card links); rules 1/46 have no meaning on a night page.
- Not described by any rule: the 7 KPI tiles (rule 14 allows one 32 per screen); the system map (kind colours, wires, dim states, inspector); the watchlist; the editor's overrides, chips, To-add band, sticky columns, legend; tag chips; the env checklist; the night panel pair and scrim.

## Doors
- Front door "Staff HQ →" (src/app/page.tsx:49-57; teal hover; an arrow on a link counts in the arrows ratchet). HQ chrome: sticky top bar with "HeyTiff HQ" (HQ in teal), nav, staff email, "Exit to dashboard" (layout.tsx:19-30). No dashboard → HQ link. HQ → dashboard: the exit, and the map's 17 "Open" hrefs (all resolve today; the new map will break them and src/lib/hq/__tests__/system-map.test.ts:24-31 enforces every registry path exists).
- Recommendation: HQ keeps its own top bar rebuilt from the rules' parts, not the ink sidebar: the frame's contents (New, Search over records, the eight places, Pinned, your name) do not exist in HQ and HQ users may hold no workspace (proxy.ts:22-24); HQ has four places of its own; the night ground is why HQ exists apart (hq.css:1-3; docs/design.md:199-202). Take from the frame: rule 2's date and time, rule 9's one-colour wordmark, rule 10's tab styling for the four links, rule 8's mark. "Exit to dashboard" needs a workspace-less fallback (/start).

## Tests
- src/components/hq/__tests__ (6 files, 824 lines) pin class names and words (Expand all, Save, Tags…, Resolve, Add, .hq-change, .hq-map-node-name, hrefs). src/lib/hq/__tests__ (8 files): system-map.test.ts:24-31 requires every registry path to exist, so phase 5's deletions must move system-map.ts paths/hrefs in the same change. page-title-size.test.ts: add hq.css when its h1 goes to 24/600.

## Under-described on the Today tab (row 1051-1053)
KPI tiles with Xero tier ceiling; the System and support env checklist; the org member drill-down; Delete a test workspace (typed confirm, Auth0 leftovers); the extraction watch-list; stale-override and validation warnings; the editor's search/expand/gaps/To-add/sticky columns/chips/legend/tag bulk apply/airway editor/save refusing a validation error; the map inspector's Open links and code paths; Exit to dashboard and the returnTo door; no loading state; no phone layout but the map's 1080px collapse. The row's "shows sign-in email instead of name": org-table.tsx:30 renders the name; likely a data issue (a guess).
