"""Lay the canvas out as the final set: pages in build order holding only what
was chosen, the workflows, then one archive page for everything else."""
import json, sys

PATH = sys.argv[1]
c = json.load(open(PATH))
B = c["boards"]
old_pages = [p for p in c["pages"]]

W, H = 1440, 900
GAP_X, GAP_Y = 80, 200

FINAL = [
    ("f1", "1. The rules and the parts", "1. The 54 rules and the parts they make. A teal disc on a screen is a rule's number, not part of the design.", "rules"),
    ("f2", "2. Home, New and your name", "2. Home, New, Search, Conversations and your name. New: pick the list (NJ-1) or the row (NJ-2).", [
        ["V3-home", "NJ-1", "NJ-2"], ["S-you", "S-convos"]]),
    ("f3", "3. Jobs", "3. Jobs: the list, a job and its conversation, Add, Actions, a quote and a Project job", [
        ["V3-jobs", "MN-who", "MN-sort", "MN-spec"], ["JC-0", "JC-1", "JC-2", "NJ-3"], ["S-actions", "S-quote", "S-project"]]),
    ("f4", "4. Schedule", "4. Schedule", [["V3-schedule"]]),
    ("f5", "5. Documents, Library, Design", "5. Documents, Library and Design", [
        ["S-documents", "S-templates", "S-swms"], ["S-library", "S-design"]]),
    ("f6", "6. Team and your time", "6. Team, and your own time", [
        ["S-person", "S-person-tech", "V3-team"], ["S-leave", "S-expenses", "S-timesheet"]]),
    ("f7", "7. Settings and reports", "7. Settings and reports, under your name", [["V3-settings", "V3-analytics"]]),
    ("f8", "8. On a phone", "8. On a phone", [["V3-phone", "PH-menu", "JC-3", "S-phone-timesheet"]]),
]

TITLES = {
    "V3-rules": "The 54 rules, all decided",
    "SYS-colour8": "The 19 colours: the eight, ink, white and the quiet grey",
    "CU-detail": "The two 40 curves, three times the size",
    "V3-states": "Nothing there yet, loading, and when something goes wrong",
    "S-dialog": "A dialog and a toast, over a job",
    "S-search": "Search: results by kind, the last row asks Tiff",
    "V3-home": "Home  /",
    "NJ-1": "New as a list: Job, Quote, Task. Pick this or NJ-2",
    "NJ-2": "New as a row, in New's own highlight. Pick this or NJ-1",
    "S-you": "Your-name menu",
    "S-convos": "Conversations  /conversations",
    "V3-jobs": "Jobs  /jobs, views as soft tabs",
    "MN-who": "Jobs: choosing who",
    "MN-sort": "Jobs: choosing the order",
    "MN-spec": "Menus: three kinds, and what isn't a menu",
    "JC-0": "How a job's conversation works",
    "JC-1": "A job  /jobs/3342, its conversation",
    "JC-2": "A note opened: Tiff's summary, the recording, every word",
    "NJ-3": "A job's Add",
    "S-actions": "A job's Actions",
    "S-quote": "A job's quote  /jobs/3361/quote, Tiff asking",
    "S-project": "A Project job  /jobs/3302, its visits",
    "V3-schedule": "Schedule  /schedule",
    "S-documents": "Documents  /documents",
    "S-templates": "Documents, Templates",
    "S-swms": "A SWMS from a job's Add, in its own tab",
    "S-library": "Library  /library",
    "S-design": "Design  /design",
    "S-person": "Team  /team/lyle, a person open",
    "S-person-tech": "Team, as a tech sees it",
    "V3-team": "Team, Timesheets  /team/timesheets",
    "S-leave": "Team, Leave  /team/leave",
    "S-expenses": "Team, Expenses  /team/expenses",
    "S-timesheet": "Your timesheet  /you/timesheet",
    "V3-settings": "Settings, Pay and holidays  /settings/pay",
    "V3-analytics": "Reports, under your name",
    "V3-phone": "Home on a phone",
    "PH-menu": "The menu on a phone: the sidebar itself",
    "JC-3": "A tech on site, talking to the job",
    "S-phone-timesheet": "Your timesheet on a phone",
}

NEW_BOARDS = [k for k in TITLES if k.startswith("S-")]
for k in NEW_BOARDS:
    f = k + ".dc.html"
    if f not in B:
        B[f] = {"w": 390, "h": 844, "radius": 44} if "phone" in k else {"w": W, "h": H}

used = set()
pages, notes = [], {}


def place(pid, rows, x0=0, y0=0):
    y = y0
    for row in rows:
        x, mh = x0, 0
        for k in row:
            f = k + ".dc.html"
            b = B[f]
            b.update(page=pid, x=x, y=y, title=TITLES[k])
            used.add(f)
            x += b["w"] + GAP_X
            mh = max(mh, b["h"])
        y += mh + GAP_Y
    return y


for pid, name, note, rows in FINAL:
    pages.append({"id": pid, "name": name})
    notes["n_" + pid] = {"kind": "title1", "maxW": 4400, "page": pid, "text": note, "w": 240, "x": 0, "y": -300}
    if rows == "rules":
        place(pid, [["V3-rules"]])
        place(pid, [["CU-detail", "V3-states"], ["S-dialog", "S-search"], ["SYS-colour8"]], x0=W + GAP_X)
    else:
        place(pid, rows)

# the workflows keep their own layout
pages.append({"id": "flows", "name": "9. Every task, today and new"})
notes["n_flows"] = {"kind": "title1", "maxW": 4400, "page": "flows", "text": "9. Every task, today and in the new layout, with the first press marked", "w": 240, "x": 0, "y": -300}
for f, b in B.items():
    if b.get("page") == "flows":
        used.add(f)

# everything else: one archive page, grouped by where it was
pages.append({"id": "archive", "name": "Archive: not the plan"})
notes["n_archive"] = {"kind": "title1", "maxW": 8800, "page": "archive", "text": "Archive: not the plan. Options turned down, things replaced and earlier rounds, kept only for reference. Where an option was chosen, it is drawn on the pages above.", "w": 240, "x": 0, "y": -300}
y = 200
for p in old_pages:
    rest = sorted((b["y"], b["x"], f) for f, b in B.items() if b.get("page") == p["id"] and f not in used)
    if not rest:
        continue
    notes["n_ar_" + p["id"]] = {"kind": "title1", "maxW": 8800, "page": "archive", "text": f"Was: {p['name']}", "w": 240, "x": 0, "y": y}
    y += 300
    row, x, mh = 0, 0, 0
    for _, _, f in rest:
        b = B[f]
        if row == 6:
            y += mh + GAP_Y
            row, x, mh = 0, 0, 0
        b.update(page="archive", x=x, y=y)
        used.add(f)
        x += b["w"] + GAP_X
        mh = max(mh, b["h"])
        row += 1
    y += mh + 400

orphans = [f for f in B if f not in used]
assert not orphans, orphans

order = []
for pid in [p["id"] for p in pages]:
    order += [f for _, _, f in sorted((b["y"], b["x"], f) for f, b in B.items() if b["page"] == pid)]
c["pages"] = pages
c["notes"] = notes
c["order"] = order
c["launch"] = {"page": "f1", "view": "canvas"}
c["title"] = "HeyTiff, the new layout"
json.dump(c, open(PATH, "w"), indent=1, ensure_ascii=False)
for p in pages:
    print(p["id"], p["name"], sum(1 for b in B.values() if b["page"] == p["id"]))
print("boards", len(B))
