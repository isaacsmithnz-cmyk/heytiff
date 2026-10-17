"""Workflow boards: the framework (F-Rules) and one board per area, today
against new, for every task the five traces found."""
import html
from base import ico, page
import flows_data as D

W = 1440

FCSS = """
.doc,.doc *{box-sizing:border-box}
.doc{width:1440px;background:#fff;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#050505;font-size:14px;line-height:20px;-webkit-font-smoothing:antialiased;padding:56px 64px 64px}
.doc p{margin:0}
.doc a{color:inherit}
.doc .link{text-decoration:underline;text-underline-offset:3px;font-weight:500}
.colh{display:grid;grid-template-columns:248px minmax(0,1fr) minmax(0,1fr);gap:32px;padding:0 0 8px;position:sticky;top:0;background:#fff}
.wf{display:grid;grid-template-columns:248px minmax(0,1fr) minmax(0,1fr);gap:32px;padding:20px 0;border-top:1px solid rgba(5,5,5,.08)}
.wid{display:flex;flex-direction:column;gap:4px}
.wid .n{font-size:12px;line-height:16px;font-weight:600;color:#5f6a79}
.wid h3{font-size:16px;line-height:24px;font-weight:600;margin:0}
.path{display:grid;grid-template-columns:88px minmax(0,1fr);gap:8px;align-items:start;margin-bottom:8px}
.path.solo{grid-template-columns:minmax(0,1fr)}
.pl{font-size:12px;line-height:26px;font-weight:500;color:#5f6a79}
.chips{display:flex;flex-wrap:wrap;align-items:center;gap:4px 2px}
.st{height:26px;padding:0 8px;border-radius:6px;border:1px solid rgba(5,5,5,.14);font-size:13px;font-weight:500;display:inline-flex;align-items:center;white-space:nowrap;background:#fff}
.st.f{background:#F0F2F5;border-color:transparent;color:#3d4653;font-weight:400}
.st.first{background:#050505;color:#fff;border-color:#050505}
.st.na{border:0;padding:0 2px;color:#5f6a79;font-weight:400}
.sep{color:#9aa3b0;font-size:13px;padding:0 2px}
.cnt{margin-left:8px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;color:#5f6a79;white-space:nowrap}
.new .cnt{color:#050505}
.note{font-size:13px;line-height:18px;margin-top:4px}
.say{font-size:13px;line-height:18px;color:#5f6a79;margin-top:4px}
.sum{display:flex;gap:48px;padding:24px 0 32px}
.sum b{display:block;font-size:24px;line-height:32px;font-weight:600;font-variant-numeric:tabular-nums}
.legend{display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:13px;color:#5f6a79;padding-bottom:24px}
.legend span.g{display:inline-flex;align-items:center;gap:8px}
.rule{padding:20px;border:1px solid rgba(5,5,5,.08);border-radius:16px;display:flex;flex-direction:column;gap:8px}
.rule h3{font-size:16px;line-height:24px;font-weight:600;margin:0}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.mt{border-collapse:collapse;width:100%}
.mt th{text-align:left;font-size:12px;line-height:16px;font-weight:500;color:#5f6a79;padding:8px 16px 8px 0;border-bottom:1px solid rgba(5,5,5,.08)}
.mt td{padding:12px 16px 12px 0;border-bottom:1px solid rgba(5,5,5,.08);vertical-align:top}
.mt td:first-child{font-weight:600;white-space:nowrap}
.sec{padding-top:56px}
.sec>h2{font-size:24px;line-height:32px;font-weight:600;margin:0 0 8px;letter-spacing:-.2px}
.sec>p.lead{font-size:16px;line-height:24px;max-width:820px;margin-bottom:24px}
.ladder{display:flex;flex-direction:column}
.lrow{display:grid;grid-template-columns:120px 220px minmax(0,1fr);gap:24px;align-items:baseline;padding:16px 0;border-top:1px solid rgba(5,5,5,.08)}
.lrow .sz{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.lrow .use{font-size:13px;line-height:18px;color:#5f6a79}
.mlist{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}
.mlist h4{font-size:12px;line-height:16px;font-weight:500;color:#5f6a79;margin:0 0 8px}
.mlist div.i{display:flex;align-items:center;gap:8px;height:32px;font-weight:500}
"""


def esc(s):
    return html.escape(s, quote=False)


def is_note(s):
    return s.startswith("(") and s.endswith(")")


def steps_count(steps):
    return sum(0 if is_note(s) else 1 for s in steps)


def chip(s, first=False):
    if is_note(s):
        return f'<span class="st na">{esc(s[1:-1])}</span>'
    if s.startswith("~"):
        return f'<span class="st f">{esc(s[1:])}</span>'
    return f'<span class="st{" first" if first else ""}">{esc(s)}</span>'


def path_html(label, steps, mark_first):
    sep = '<span class="sep">›</span>'
    cs = sep.join(chip(s, mark_first and i == 0) for i, s in enumerate(steps))
    n = steps_count(steps)
    cnt = f'<span class="cnt">{n}</span>' if n else ""
    if label:
        return f'<div class="path"><span class="pl">{esc(label)}</span><div class="chips">{cs}{cnt}</div></div>'
    return f'<div class="path solo"><div class="chips">{cs}{cnt}</div></div>'


def row(w):
    today = "".join(path_html(l, s, False) for l, s in w["today"])
    new = "".join(path_html(l, s, i == 0) for i, (l, s) in enumerate(w["new"]))
    tnotes = []
    if w["tnote"]:
        tnotes.append(f'<p class="note q">{esc(w["tnote"])}</p>')
    if w["tdoors"]:
        tnotes.append(f'<p class="note q">Other ways in: {w["tdoors"]}.</p>')
    nnotes = []
    if w["nnote"]:
        nnotes.append(f'<p class="note">{esc(w["nnote"])}</p>')
    if w["ndoors"]:
        nnotes.append(f'<p class="note q">Also from: {esc(w["ndoors"])}.</p>')
    if w["say"]:
        nnotes.append(f'<p class="say">Or say it: “{esc(w["say"])}”</p>')
    return f'''<div class="wf" id="{w["id"]}">
  <div class="wid"><span class="n">{w["id"]}</span><h3>{esc(w["title"])}</h3><span class="lab q">{esc(w["who"])}</span></div>
  <div>{today}{"".join(tnotes)}</div>
  <div class="new">{new}{"".join(nnotes)}</div>
</div>'''


def totals(ws):
    t = n = doors = 0
    for w in ws:
        a, b = steps_count(w["today"][0][1]), steps_count(w["new"][0][1])
        if a and b:
            t += a
            n += b
        doors += w["tdoors"]
    return t, n, doors


def area_board(title, ws, extra_legend="", preface=""):
    t, n, doors = totals(ws)
    rows = "".join(row(w) for w in ws)
    return f'''<div class="doc">
  <p class="lab q">Workflows, today and new</p>
  <h1 class="h24" style="margin-top:4px">{esc(title)}</h1>
  <div class="sum">
    <div><b>{len(ws)}</b><span class="lab q">tasks traced</span></div>
    <div><b>{t}</b><span class="lab q">steps today, first path of each</span></div>
    <div><b>{n}</b><span class="lab q">steps new, first path of each</span></div>
    <div><b>{doors}</b><span class="lab q">other ways in today</span></div>
  </div>
  <div class="legend">
    <span class="g"><span class="st">Save</span>a press</span>
    <span class="g"><span class="st f">Type or pick</span>a field</span>
    <span class="g"><span class="st first">New</span>the first press, new way</span>
    <span class="g"><span class="cnt" style="margin:0;color:#050505">7</span>steps on that path</span>
    {extra_legend}
  </div>
  {preface}
  <div class="colh"><span class="cap">Task</span><span class="cap">Today, from the code on main</span><span class="cap">New layout</span></div>
  {rows}
</div>'''


# --------------------------------------------------------------------------
# F-Rules: the framework
# --------------------------------------------------------------------------
MAP = [
    ("New", "Job, Quote, Task: the three things that start work, the same on every page. It never fills anything in.",
     "New job, New project, New agreement, New letter, Request leave, Scan a receipt, Log fuel, Invite staff, Add vehicle, Post a notice, Add documents, New design, Create SWMS, Create certificate, Add a task, New conversation"),
    ("Search", "Any record by its name or number: jobs, clients, people, documents, photos, tools. Its last row asks Tiff.",
     "⌘K, the Workboard's search, the Clients jump"),
    ("Home", "The date and time, the box, Today and To do.",
     "Home's Diary, Tasks and Calendar tabs, the bell, Action required, every Urgent tab"),
    ("Conversations", "Everything said to Tiff and what she made of it, with Undo. Your private notes are its Only me view.",
     "The diary's reopen links, Library chats kept in one browser"),
    ("Jobs", "Jobs, quotes and service agreements: one list, one job page. A project is a job with the Project type.",
     "Workboard's three sides and their tabs, the Projects list page, the project page"),
    ("Schedule", "Bookings, visits, events, shutdowns, holidays and leave, by day, by week, by month.",
     "Workboard Schedule and Capacity, the two board calendars, Home's calendar, Who can't work"),
    ("Documents", "Every document made, and the templates they're made from.",
     "The job card's Compliance tab, Admin Templates, Admin Letters"),
    ("Library", "Company information: manuals, SOPs, field notes and the field tools.",
     "Library, Toolbox, Knowledge from the field"),
    ("Design", "Designs. Nothing changes inside the studio.", "Design"),
    ("Team", "People, notices, timesheets, leave, expenses and vehicles. Everyone sees each person's name, role, mobile and email, and Notices; the rest follows permission.", "Team, Time & Pay, Assets, the Noticeboard"),
    ("Your name", "Your card (with your vehicle), Timesheet, Leave, Expense claims; Reports; Settings.",
     "Me, Profile, Analytics, Tax & EOFY, Admin's Organisation, Integrations, Quoting, Price book, Rate Calculator"),
]

RULES = [
    ("New starts work; the rest is made where it belongs",
     "New, at the top of the sidebar and the top right on a phone, makes a job, a quote or a task, the same on every page. What belongs to a job comes from the job's Add; everything else from its place's own button."),
    ("You change a thing where it lives",
     "Notes, the quote, photos, visits, the checklist, billing, a licence, a rego, a timesheet day: open the record, press the tab, type, Save. There's no second form for any of them."),
    ("Every record has one home",
     "A job (projects included) or an agreement lives in Jobs; a booking in Schedule; a document in Documents; a person or vehicle in Team; you on your card. Its page has one address, Back works, and Pinned and Recents bring it back."),
    ("To do is the one list",
     "The bell, Action required, the Urgent tabs and Home's chips become one list on Home, mirrored by the morning email. Each row opens the record at the right step. It never has a form of its own."),
    ("Settings only holds settings",
     "Behind your name. Yours: sign-in, emails and alerts. Company: business, licences and insurance, ServiceM8 and Xero, quoting and prices, pay and holidays, reports. Each section shows to whoever has its permission."),
    ("Anything you press, you can say",
     "The box on Home does the same jobs as the buttons, and Search's last row asks Tiff from any screen. Everything Tiff can do also has a button, so doing it by hand always works."),
]

NEW_GROUPS = [
    ("New, on every page", [("jobs", "Job"), ("dollar", "Quote"), ("task", "Task")]),
    ("A job's Add", [("cal", "Visit"), ("task", "Task"), ("dollar", "Quote, or Variation once accepted"), ("receipt", "Cost"), ("shield", "SWMS"), ("cert", "Certificate")]),
    ("A place's own button", [("cal", "Event: Schedule"), ("letter", "Letter: Documents"), ("repeat", "Service agreement: Jobs, Agreements"), ("megaphone", "Notice, person, vehicle: Team"), ("upload", "Library document: Library"), ("design", "Design: Design"), ("sun", "Leave, expense claims: your name")]),
]

SCENARIOS = [
    ("Job card, Compliance tab", "Create SWMS, Create certificate, Add compliance", "The job's Add: SWMS or Certificate, opening in its own tab. The job's Documents tab lists what's on the job, who's signed on, and Send."),
    ("Job card, More menu", "Create a project from this job; Create a maintenance agreement (twice from outside the board)", "Set the job's type to Project; Jobs, Agreements, New agreement, or To do at Handover with the job filled in."),
    ("Project page, Handover stage", "Set up the agreement", "To do raises it when a Project job reaches Handover; it opens the agreement form with the job filled in."),
    ("Workboard, Projects, Pipeline", "New project opens a list page with a second New project", "New, Job, with the type set to Project."),
    ("Workboard, Maintenance", "New agreement", "Jobs, Agreements, New agreement."),
    ("Workboard, All jobs", "New job (a form that ends on Done)", "New, Job; Create lands on the job."),
    ("Home, Calendar", "Add to a day; a shutdown only through Tiff", "Schedule, Add an event, with a range for a shutdown."),
    ("Home, Tasks", "Add a task (Enter sends it to Tiff)", "New, Task, with a time; or a job's Add, Task."),
    ("Admin, Letters", "New letter", "Documents, Make a document, Letter."),
    ("Team", "Invite staff", "Team, Add a person."),
    ("Assets", "Add vehicle", "Team, Vehicles, Add a vehicle."),
    ("Me, Expenses and Vehicle", "Scan a receipt, Enter it myself, Log fuel, Company card", "Your name, Expense claims; fuel asks litres and km. A cost for a job: the job's Add, Cost."),
    ("Me, Leave and Timesheet", "Request leave; casuals' Mark days I can't work", "Your name, Leave; can't work is a kind of leave."),
    ("Noticeboard", "Post a notice (no sidebar row)", "Team, Notices, Write a notice."),
    ("Library", "Add documents; field notes only through Tiff", "Library, Add a document; Field notes, Write a field note."),
    ("Design", "New design; no way from a job", "Design, New design, with the job picked."),
]

STAYS = ["Notes on a job, project, agreement or person", "Quote lines, options and variations", "Photos", "Visits and bookings on a record", "Checklist: install tasks, to-dos, materials", "Billing, claims, No deposit", "Contacts", "Equipment on site", "Licences on a card", "Rego, insurance and CTP", "A timesheet day", "Pay, access, normal week", "Templates", "Settings"]

TYPE = [
    ("32 / 700", "One big figure", "At most one per screen", '<span style="font-size:32px;line-height:40px;font-weight:700;letter-spacing:-.4px">$697,300</span>'),
    ("24 / 600", "Screen title", "Jobs, Schedule, a job's name", '<span style="font-size:24px;line-height:32px;font-weight:600;letter-spacing:-.2px">Rifkin, Julian</span>'),
    ("16 / 600", "Section heading", "Today, To do, Details", '<span style="font-size:16px;line-height:24px;font-weight:600">Today</span>'),
    ("16 / 400", "Reading and writing", "The box, notes, messages, Tiff's answers", '<span style="font-size:16px;line-height:24px">Lyle needs the Bellevue Hill head on the ute.</span>'),
    ("14 / 400", "Body", "Rows, fields, the sidebar; buttons at 600", '<span style="font-size:14px;line-height:20px">Kingsford Bakery, 2380</span><span class="st" style="margin-left:16px;font-weight:600;font-size:14px;height:32px">Open job</span>'),
    ("13 / 500", "Labels", "Times, counts, second lines, field labels", '<span style="font-size:13px;line-height:18px;font-weight:500;color:#5f6a79">8:12 am</span>'),
    ("12 / 500", "Captions", "Column heads, group labels; the floor", '<span style="font-size:12px;line-height:16px;font-weight:500;color:#5f6a79">Pinned</span>'),
]


def rules_board(n_tasks, n_areas):
    maprows = "".join(f'<tr><td>{esc(a)}</td><td>{esc(b)}</td><td class="q">{esc(c)}</td></tr>' for a, b, c in MAP)
    rules = "".join(f'<div class="rule"><span class="cap">Rule {i + 1}</span><h3>{esc(t)}</h3><p>{esc(d)}</p></div>' for i, (t, d) in enumerate(RULES))
    groups = "".join(
        f'<div><h4>{g}</h4>' + "".join(f'<div class="i">{ico(i, "ico i16 q")}{esc(n)}</div>' for i, n in items) + '</div>'
        for g, items in NEW_GROUPS)
    scen = "".join(f'<tr><td>{esc(a)}</td><td class="q">{esc(b)}</td><td>{esc(c)}</td></tr>' for a, b, c in SCENARIOS)
    stays = "".join(f'<span class="st">{esc(s)}</span>' for s in STAYS)
    ladder = "".join(f'<div class="lrow"><span class="sz">{a}</span><span><span style="display:block;font-weight:600">{esc(b)}</span><span class="use">{esc(c)}</span></span>{d}</div>' for a, b, c, d in TYPE)
    return f'''<div class="doc">
  <p class="lab q">The new layout</p>
  <h1 class="d32" style="margin-top:4px">How every task gets done</h1>
  <p class="read" style="max-width:820px;margin-top:12px">I traced {n_tasks} tasks through today's code, press by press, and gave each one a new route. This board sets the rules those routes follow. The {n_areas} boards beside it show every task, today and new, with the first press marked.</p>

  <section class="sec">
    <h2>Where everything lives</h2>
    <p class="lead">Ten rows in the sidebar and a menu behind your name. Each row is the only home for what's in it.</p>
    <table class="mt"><thead><tr><th style="width:150px">Sidebar</th><th style="width:520px">What lives there</th><th>What it replaces today</th></tr></thead><tbody>{maprows}</tbody></table>
  </section>

  <section class="sec">
    <h2>Six rules</h2>
    <p class="lead">When a new feature lands, these decide where it goes. If a feature doesn't fit them, the feature changes, not the rules.</p>
    <div class="grid3">{rules}</div>
  </section>

  <section class="sec">
    <h2>One New button, instead of New conversation</h2>
    <p class="lead">New holds the three things that start work: Job, Quote, Task. It's the same on every page and never fills anything in. What belongs to a job is made from that job's Add, or by telling the job's conversation. Everything else is made where it lives, with that place's own button, and every one of those opens the same form over the page you're on.</p>
    <div class="card" style="padding:24px">
      <div class="mlist">{groups}</div>
    </div>
    <p class="note q" style="margin-top:12px">Each person sees only what they're allowed to make.</p>
  </section>

  <section class="sec">
    <h2>Make it where it belongs</h2>
    <p class="lead">The job card's create SWMS and compliance section goes: the job's Add makes a SWMS or a certificate, and the job's Documents tab lists what's on the job, the SWMS and who's signed on, the certificate, the quote, the designs, with Send. The same goes for the other 15 places below that make things today.</p>
    <table class="mt"><thead><tr><th style="width:250px">Where it's made today</th><th style="width:420px">What's there</th><th>New way</th></tr></thead><tbody>{scen}</tbody></table>
    <h3 class="h16" style="margin:32px 0 12px">Never made through a form: these are changed where they live</h3>
    <div class="chips" style="gap:8px">{stays}</div>
  </section>

  <section class="sec">
    <h2>Text sizes</h2>
    <p class="lead">Rules 12 to 14: 24 semibold for screen titles, 16 for anything you read or write, 14 for the rest, 13 for labels and 12 for captions, the floor. One big figure at 32, at most, per screen.</p>
    <div class="ladder">{ladder}</div>
  </section>
</div>'''

PROJECT_MAP = [
    ("Stage stepper, Quote to Complete, with checklist warnings", "The progress line, with the project stages: Approved, Pre-install, Rough-in, Fit-off, Commission, Handover"),
    ("Block, hold, done, archive", "Actions: On hold or Blocked, on any job. Done is the job completing; nothing to archive"),
    ("Trips to site: day, crew, gear, access, close-out", "Visits: day, crew, tasks, check in and out, close-out"),
    ("Job total, claims", "Billing: the accepted quote plus approved variations; claims are its payment stages, matched to ServiceM8 invoices"),
    ("Variations", "Quote: Update quote, Start variation"),
    ("Promised finish, defects end, milestones, hours allowed", "Overview: Dates, shown on the Schedule; hours used from check-ins"),
    ("Jobs on this project: quote, install, variation, service", "Linked jobs, under the main job"),
    ("Design link", "Designs made for the job, from Design with the job picked, belong to it"),
    ("Equipment on site", "Checklist units with their plate photos; they carry to the service agreement"),
    ("Site journal, commissioning entries", "The note box; commissioning is a kind of note"),
    ("Checklist and its sections", "Checklist"),
    ("Scope: in the price, not in the price", "The quote's Included and Not included"),
    ("Documents and photos", "Documents and Photos"),
    ("Handover sheet", "Documents: Handover sheet, money only for money access"),
    ("Pipeline by stage; Urgent; Completed; Calendar", "Jobs, Projects, grouped by stage; To do; Jobs, Completed; Schedule"),
    ("Set up the agreement at Handover", "To do raises it and opens the agreement form, job filled in"),
]


def project_map():
    rows = "".join(f'<tr><td>{esc(a)}</td><td>{esc(b)}</td></tr>' for a, b in PROJECT_MAP)
    return f'''<section style="padding-bottom:40px">
    <h2 class="h20" style="margin-bottom:4px">Projects are jobs with the Project type</h2>
    <p class="read" style="max-width:820px;margin-bottom:16px">The job card already tracks what a project needs, so the project record, its page, board, calendar and trip sheet go. Each part has a place on the job. Service agreements stay their own record.</p>
    <table class="mt"><thead><tr><th style="width:520px">On the project today</th><th>On a Project job</th></tr></thead><tbody>{rows}</tbody></table>
  </section>'''


def build(out):
    import json, os
    hp = os.path.join(os.path.dirname(__file__), "flow_heights.json")
    H = json.load(open(hp)) if os.path.exists(hp) else {}
    n_tasks = sum(len(ws) for _, _, ws in D.AREAS)
    out["F-Rules.dc.html"] = page("The new layout", W, H.get("F-Rules", 3600), FCSS, rules_board(n_tasks, len(D.AREAS)))
    for key, title, ws in D.AREAS:
        extra = ""
        if key == "F-Jobs":
            extra = '<span class="g"><span class="st">Open the job</span>Search, the number, the row; one step both ways</span>'
        if key == "F-Work":
            extra = '<span class="g"><span class="st">Open the project</span>today and <span class="st">Open the job</span>new are one step each; P2 shows what each takes</span>'
        pre = project_map() if key == "F-Work" else ""
        out[f"{key}.dc.html"] = page(title, W, H.get(key, 3600), FCSS, area_board(title, ws, extra, pre))
