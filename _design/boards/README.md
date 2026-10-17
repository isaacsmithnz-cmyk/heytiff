# The v2 layout boards

The mock-ups for HeyTiff's new layout (version 2) are drawn by the Python here, not in a design tool. Each board is a plain HTML page at 1440 × 900 (390 × 844 for a phone). The plan that goes with them is in `docs/plans/layout-2026-10/`; start with its `HANDOVER.md`.

The published canvas is https://claude.ai/artifact/XF4jr8qxfbr7nR8E59q4xT (Isaac's claude.ai sign-in). Pages 1 to 9 are the plan. The Archive page is not.

## Draw them

```
cd _design/boards/work/v2
python3 gen.py
```

This needs only Python 3, with no packages. It writes every board to `_design/boards/canvas/project/` as `<name>.dc.html`. They are generated, so git ignores them. Open any of them in a browser. Board names and pages are in `canvas/project/canvas.json`. Its `boards` entry gives each file's page (`f1` to `f8`, `flows`, `archive`) and title.

Every board on pages 1 to 9 regenerates. 29 boards on the Archive page came from earlier scripts and exist only on the published canvas.

## Check them

The two Node scripts need Playwright (`npm i -g playwright`, then a Chromium):

- `node work/shot.js 1440 900 out.png canvas/project/S-time.dc.html` takes a screenshot of one board.
- `node work/fit.js canvas/project/canvas.json` lists any plan board whose content is taller or wider than its frame. A clean run prints only `checked`.

## Where things are

| File | What it draws |
| --- | --- |
| `work/v2/boards_v3.py` | The frame, the parts and the 54 rules board (`RULES`): Home, Jobs, Schedule, Team, Settings, Reports, the phone |
| `work/v2/boards_jobconvo.py` | A job's conversation (JC-0 to JC-3) |
| `work/v2/boards_newadd.py` | New on every page (NJ-1, NJ-2) and a job's Add (NJ-3) |
| `work/v2/boards_menus.py` | The menu boards (MN-*) and a job's Actions |
| `work/v2/boards_final.py` | The S-* screens: Conversations, a quote, a Project job, Documents, Library, Design, Team (people, leave, expenses, notices), timesheets, the time wheel, a dialog, Search |
| `work/v2/boards_flows.py`, `flows_data.py` | Page 9: every task, today against the new layout |
| `work/v2/gen.py` | Runs every module in turn |
| `work/layout_final.py` | Laid the canvas out into pages 1 to 9 and the Archive, once. Don't run it on today's `canvas.json`: it would file the plan pages under the Archive. Add new boards to `canvas.json` by hand, as the 17 October ones were |

The other `boards_*.py` modules draw the earlier rounds that now sit on the Archive page. `gen.py` still runs them because some later modules import their helpers.

## Changing a board

Edit the module, run `gen.py`, look at it, then run `fit.js`. To put it on the published canvas, a session with the Artifact tool publishes `canvas/project/canvas.json`, using `canvas` as the root and the changed `project/<name>.dc.html` files as `files`. Otherwise, just commit the change. The plan text is what the build follows, and the boards show it.
