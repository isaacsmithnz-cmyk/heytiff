"""The screens that were still in the older style, redrawn to the 54 rules so
the final canvas is one style throughout. Content is carried over from the
N- boards; nothing is dropped. No review markers: these are the screens."""
from base import ico, page
import boards_v3 as v3
from boards_v3 import frame, sidebar, header, dot, sym, TAB_HOME, tab_job
from boards_menus import CSS as MCSS, hide, actions_menu
import boards_jobconvo as jc

CSS = jc.CSS + MCSS.replace(v3.CSS, "") + """
.kv{display:grid;grid-template-columns:160px minmax(0,1fr);gap:8px 16px;margin:0}
.kv dt{color:var(--q);font-weight:500}
.kv dd{margin:0}
.thumb{height:150px;background:var(--soft);border-bottom:1px solid var(--line);position:relative;border-radius:16px 16px 0 0}
.thumb i{position:absolute;border:2px solid rgba(5,5,5,.16);border-radius:6px}
.lst{display:flex;flex-direction:column;gap:2px}
.lst a{display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:10px}
.lst a.on{background:var(--sel)}
.lst .m{flex:1;min-width:0}
.lst .t{display:block;font-weight:600;white-space:nowrap;overflow:hidden;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 24px),transparent)}
.lst .s{display:block;font-size:13px;line-height:18px;color:var(--q)}
.gh2{display:flex;align-items:baseline;gap:12px;margin:24px 0 4px}
.gh2:first-child{margin-top:0}
.whd{position:absolute;background:#fff;border-radius:16px;box-shadow:0 12px 32px rgba(10,12,20,.16);padding:8px 8px 12px;z-index:8}
.whd .hd{display:flex;align-items:center;justify-content:flex-end;padding:0 0 8px}
.wh{display:flex;gap:4px;position:relative}
.wh .band{position:absolute;left:0;right:0;border-radius:10px;background:var(--sel)}
.whc{flex:1;min-width:0;display:flex;flex-direction:column;position:relative}
.whc .lb3{height:18px;margin-bottom:4px;font-size:12px;line-height:16px;font-weight:500;color:var(--q);text-align:center}
.whs{display:flex;flex-direction:column;-webkit-mask-image:linear-gradient(to bottom,rgba(0,0,0,.25),#000 40%,#000 60%,rgba(0,0,0,.25));mask-image:linear-gradient(to bottom,rgba(0,0,0,.25),#000 40%,#000 60%,rgba(0,0,0,.25))}
.whs span{flex:none;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;color:var(--q);font-variant-numeric:tabular-nums}
.whs span.on{font-size:16px;font-weight:600;color:var(--ink)}
.fi.open{border-color:var(--ink)}
.nb-opt{position:relative;display:flex;align-items:center;gap:10px;height:36px;padding:0 12px;border:1px solid var(--edge);border-radius:10px;overflow:hidden}
.nb-opt i{position:absolute;left:0;top:0;bottom:0;background:var(--soft)}
.nb-opt b,.nb-opt span{position:relative}
.nb-opt b{font-weight:600}
.nb-opt.on{border-color:var(--blue)}
.nb-opt.on b{color:var(--blue)}
.rct{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--edge);border-radius:10px;font-size:13px;font-weight:500}
.rct.on{border-color:var(--blue);color:var(--blue)}
.fth{display:flex;gap:8px}
.fth i{width:120px;height:84px;border-radius:10px;background:var(--soft);border:1px solid var(--line)}
.cmp{width:100%;border-collapse:collapse}
.cmp th,.cmp td{text-align:left;padding:6px 12px 6px 0;border-top:1px solid var(--line);vertical-align:top}
.cmp thead th{border-top:0;font-weight:600;padding-top:10px}
.cmp thead th span{display:block;font-size:13px;line-height:18px;font-weight:500;color:var(--q)}
.cmp tbody th{font-weight:500;color:var(--q);width:180px}
"""

STEPS = ["Enquiry", "Quoted", "Accepted", "Booked", "On site", "Done", "Invoiced", "Paid"]
SECTIONS = ["Overview", "Quote", "Visits", "Checklist", "Photos", "Documents", "Billing"]


def jpage(num, client, colour, kind, addr, state, on, tab, counts, content, tabs=None, steps=STEPS):
    """A job's page head, any job: the same as V3's, with the job as a value."""
    i = steps.index(on)
    st = '<span class="sep"></span>'.join(f'<span class="{"dn" if k < i else "on" if k == i else ""}">{n}</span>' for k, n in enumerate(steps))
    stabs = "".join(f'<a class="{"on" if t == tab else ""}" href="#">{t}{f"<span class=c>{counts[t]}</span>" if t in counts else ""}</a>' for t in SECTIONS)
    tabs = tabs or [TAB_HOME, (ico("jobs"), "Jobs"), tab_job(colour, f"{num} {client.split(',')[0]}")]
    head = f'''<div class="ph">
  <div class="l13 qq" style="display:flex;gap:8px;align-items:center"><a class="lk" href="#" style="color:var(--q)">Jobs</a>{ico("right")}<b style="color:var(--ink);font-weight:600">{num}</b></div>
  <div style="display:flex;align-items:flex-start;gap:12px;margin-top:8px">
    <div style="flex:1;min-width:0"><h1 class="t24">{client}</h1><p class="qq" style="margin-top:4px;display:flex;align-items:center;gap:8px">{dot(colour)}{kind}, Job {num}, {addr}. {state}</p></div>
    <span class="b sec">Open in ServiceM8</span><span class="b sec">{ico("plus")}Add{ico("down")}</span><span class="b sec">Actions{ico("down")}</span>
  </div>
  <div class="steps" style="margin-top:16px">{st}</div>
  <nav class="stb" style="margin-top:16px">{stabs}</nav>
</div>'''
    return frame(sidebar("jobs"), header(tabs, len(tabs) - 1), head + content)


# ------------------------------------------------------------------ a job's quote
def quote():
    lines = [
        ("Daikin FTXM35 3.5 kW split, main bedroom", "1", "$2,180"),
        ("Daikin FTXM35 3.5 kW split, study", "1", "$2,180"),
        ("Back-to-back install kit, 6 m pipe", "2", "$860"),
        ("Isolator and 20 A circuit", "1", "$540"),
        ("Labour, 2 techs, 1 day", "14 h", "$1,890"),
        ("Allowances: parking, disposal", "1", "$120"),
    ]
    cols = "minmax(0,1fr) 80px 110px"
    tr = "".join(f'<div class="tr" style="grid-template-columns:{cols};gap:16px"><span>{a}</span><span class="nm" style="text-align:right">{b}</span><span class="nm" style="text-align:right">{c}</span></div>' for a, b, c in lines)
    qsteps = '<span class="sep"></span>'.join(f'<span class="{c}">{n}</span>' for n, c in [("Brief", "dn"), ("To confirm", "dn"), ("Build-up", "on"), ("Approved", ""), ("Sent", ""), ("Accepted", "")])
    content = f'''<div style="display:flex;align-items:center;gap:8px;padding:16px 40px 0"><div class="steps">{qsteps}</div><span style="flex:1"></span><span class="b sec">Preview</span><span class="b go">Approve the quote</span></div>
<div style="display:flex;gap:40px;padding:16px 40px 0">
  <section style="flex:1;min-width:0;display:flex;flex-direction:column;gap:24px">
    <div class="gp"><h2 class="t16" style="margin-bottom:4px">Brief</h2><p class="r16">Two splits back to back, main bedroom and study. Outdoor on the side path. Ada asked for an isolator by the outdoor.</p><p class="c12" style="margin-top:4px">Said by Dan on site, 13 October</p></div>
    <div class="gp">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px"><h2 class="t16">Option 1</h2><span class="qq">Daikin, back to back</span><span style="flex:1"></span><span class="b sm">{ico("plus")}Add a line</span><span class="b sm">{ico("plus")}Add a kit</span></div>
      <div class="th" style="grid-template-columns:{cols};gap:16px"><span>Line</span><span style="text-align:right">Qty</span><span style="text-align:right">Sell</span></div>{tr}
    </div>
  </section>
  <aside style="width:380px;flex:none;display:flex;flex-direction:column;gap:20px">
    <div class="cd" style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;gap:8px">{jc.tiff_av()}<h2 class="t16">Tiff has 2 questions</h2></div>
      <div class="gp"><p style="font-weight:600">Is there power by the outdoor, or a new circuit?</p><div style="margin-top:8px"><span class="sg"><span>Power there</span><span class="on">New circuit, $540</span></span></div></div>
      <div class="gp"><p style="font-weight:600">Wall bracket or slab for the outdoor?</p><div style="margin-top:8px"><span class="sg"><span>Wall bracket, $90</span><span>Slab</span></span></div></div>
      <span class="fi"><span class="ph2">Answer Tiff in your own words</span></span>
    </div>
    <div class="gp"><dl class="kv"><dt>Ex GST</dt><dd class="nm">$7,770</dd><dt>Inc GST</dt><dd class="nm" style="font-weight:600">$8,547</dd><dt>Profit</dt><dd class="nm">$2,310, 30%</dd></dl></div>
  </aside>
</div>'''
    return jpage("3361", "Okafor, Ada", "Orange", "Quote", "12 Bridge St, Riverview", '<span class="st info">Quote to write</span>', "Enquiry", "Quote", {"Visits": "1", "Photos": "9", "Documents": "1"}, content)


# ------------------------------------------------------------------ a project job
def project():
    def visit(n, what, when, who, state):
        return f'<div class="rw"><span class="tm">Visit {n}</span><div class="m"><div class="t">{what}</div><div class="s">{when}, {who}</div></div>{state}</div>'
    visits = "".join([
        visit(1, "Pre-install: sleeves and set-out", "Done 2 October", "Kai and Dan", '<span class="st good">Done</span>'),
        visit(2, "Rough-in, levels 1 and 2", "Today, day 2 of 3", "Kai and Dan", '<span class="st good">On now</span>'),
        visit(3, "Fit-off", "Around 20 October, crane on the 27th", "Kai and Dan", '<span class="st look">Day to set</span>'),
        visit(4, "Commissioning and handover", "After fit-off", "Kai", '<span class="st info">Not booked</span>'),
    ])

    def row(icon, name, state):
        return f'<a class="rw" href="#" style="padding:10px 0">{ico(icon)}<span class="m"><span class="t" style="display:block">{name}</span></span>{state}</a>'
    content = f'''<div style="display:flex;gap:40px;padding:20px 40px 0">
  <section style="flex:1;min-width:0">
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:4px"><h2 class="t16">Visits</h2><span class="qq">4 on this job</span><span style="flex:1"></span><span class="b sm sec">{ico("plus")}Book a visit</span></div>
    {visits}
  </section>
  <aside style="width:380px;flex:none;display:flex;flex-direction:column;gap:20px">
    <div class="gp"><h2 class="t16" style="margin-bottom:4px">Where it's up to</h2><p>Level 1 roughed in; level 2 tomorrow. Fit-off around 20 October, with the crane booked.</p></div>
    <div class="gp"><div style="display:flex;align-items:center;margin-bottom:6px"><h2 class="t16">Dates</h2><span style="flex:1"></span><span class="b sm">Edit</span></div>
      <dl class="kv"><dt>Promised finish</dt><dd>Friday 20 November</dd><dt>Crane booked</dt><dd>Tuesday 27 October</dd><dt>Defects period ends</dt><dd>20 February 2027</dd><dt>Hours</dt><dd class="nm">96 of 160 used</dd></dl></div>
    <div class="gp"><h2 class="t16" style="margin-bottom:2px">Linked jobs</h2>{row("jobs", "3301, the quote", '<span class="st good">Accepted</span>')}{row("jobs", "3315, variation: drains to the north wall", '<span class="st look">Drafted</span>')}</div>
  </aside>
</div>'''
    return jpage("3302", "Heuvel Construction", "Purple", "Project", "18 Albert Ave, Chatswood", '<span class="st good">Rough-in, day 2 of 3</span>', "Rough-in", "Visits", {"Visits": "4", "Checklist": "31 of 52", "Photos": "140", "Documents": "4"}, content, steps=["Quoted", "Approved", "Pre-install", "Rough-in", "Fit-off", "Commission", "Handover", "Paid"])


# ------------------------------------------------------------------ Documents
DOC_VIEWS = [("All", 48), ("SWMS", 12), ("Certificates", 9), ("Quotes", 14), ("Letters", 3), ("Handover sheets", 6), ("Templates", 7)]


def docs_head(view):
    vw = "".join(f'<a class="{"on" if n == view else ""}" href="#">{n} <span class="c">{c}</span></a>' for n, c in DOC_VIEWS)
    return f'''<div class="ph">
  <div style="display:flex;align-items:center;gap:12px"><h1 class="t24">Documents</h1><span class="qq" style="margin-top:4px">48</span><span style="flex:1"></span><span class="fi" style="width:320px">{ico("search")}<span class="ph2">Search documents</span></span><span class="b sec">Make a document{ico("down")}</span></div>
  <div style="margin-top:16px"><span class="vws">{vw}</span></div>
</div>'''


def documents():
    rows = [
        ("shield", "SWMS, split install", "Blue", "3342 Rifkin, Bellevue Hill", '<span class="st look">2 of 3 signed on</span>', "Today", "IS"),
        ("shield", "SWMS, Heuvel roof work", "Purple", "3302 Heuvel, Chatswood", '<span class="st good">All signed on</span>', "9 October", "KL"),
        ("cert", "Commissioning certificate", "Green", "2380 Kingsford Bakery", '<span class="st good">Issued, emailed to the builder</span>', "Today", "IS"),
        ("doc", "Quote, version 2", "Blue", "3342 Rifkin, Bellevue Hill", '<span class="st good">Accepted</span>', "8 October", "IS"),
        ("doc", "Quote, version 1", "Orange", "3294 Belmont Holdings", '<span class="qq">Sent, waiting</span>', "2 October", "IS"),
        ("letter", "Reference, Dan Walsh", None, "No job", '<span class="qq">Draft</span>', "1 October", "IS"),
        ("doc", "Handover sheet", "Blue", "3240 Hale Street apartments", '<span class="st good">Signed</span>', "28 September", "KL"),
    ]
    cols = "minmax(0,1.4fr) minmax(0,1fr) 240px 130px 60px"
    tr = "".join(f'<div class="tr" style="grid-template-columns:{cols};gap:16px"><span style="display:flex;align-items:center;gap:12px;font-weight:600"><span class="qq" style="display:inline-flex">{ico(i)}</span>{n}</span><span style="display:flex;align-items:center;gap:8px">{dot(c) if c else ""}<span class="{"" if c else "qq"}">{j}</span></span><span>{s}</span><span class="qq">{d}</span><span><span class="avt s">{b}</span></span></div>' for i, n, c, j, s, d, b in rows)
    head = "".join(f"<span>{t}</span>" for t in ["Document", "Job", "Where it's up to", "Updated", "By"])
    body = docs_head("All") + f'<div style="padding:16px 40px 0"><div class="th" style="grid-template-columns:{cols};gap:16px">{head}</div>{tr}</div>'
    return frame(sidebar("doc"), header([TAB_HOME, (ico("doc"), "Documents")], 1), body)


def templates():
    cards = [
        ("shield", "SWMS", "Steps and controls for each kind of work", '<span class="st good">Approved 3 September</span>'),
        ("cert", "Commissioning certificate", "Mechanical compliance wording", '<span class="st look">Wording changed, approve it</span>'),
        ("doc", "Quote", "Notes and payment stages", '<span class="qq">In use</span>'),
        ("letter", "Letterhead", "Logo, details, footer and signature", '<span class="qq">In use</span>'),
        ("doc", "Handover sheet", "Checks before handing over", '<span class="qq">In use</span>'),
        ("letter", "Documents email", "Subject and message when documents are sent", '<span class="qq">In use</span>'),
        ("task", "Project checklist", "Sections every new project starts with", '<span class="qq">In use</span>'),
    ]
    cs = "".join(f'<a class="cd" href="#" style="padding:16px;display:flex;flex-direction:column;gap:6px;min-height:148px"><span class="qq" style="display:inline-flex">{ico(i)}</span><span class="t16" style="margin-top:4px">{t}</span><span class="qq">{d}</span><span style="margin-top:auto">{s}</span></a>' for i, t, d, s in cards)
    body = docs_head("Templates") + f'<div style="padding:20px 40px 0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px">{cs}</div>'
    return frame(sidebar("doc"), header([TAB_HOME, (ico("doc"), "Documents")], 1), body)


def swms():
    """A document opens in its own tab (rule 51), here from the job's Add."""
    tick = lambda on, t: f'<label style="display:flex;gap:10px;align-items:center"><span class="tk{" on" if on else ""}">{ico("check") if on else ""}</span>{t}</label>'
    ssteps = '<span class="sep"></span>'.join(f'<span class="{c}">{n}</span>' for n, c in [("The work", "on"), ("How it's done", ""), ("Who it covers", ""), ("Review", "")])
    body = f'''<div class="ph">
  <div class="l13 qq" style="display:flex;gap:8px;align-items:center"><a class="lk" href="#" style="color:var(--q)">Documents</a>{ico("right")}<b style="color:var(--ink);font-weight:600">New SWMS</b></div>
  <div style="display:flex;align-items:center;gap:12px;margin-top:8px"><h1 class="t24">New SWMS</h1><span style="flex:1"></span><div class="steps">{ssteps}</div></div>
</div>
<div style="display:flex;gap:64px;padding:24px 40px 0">
  <div style="width:560px;display:flex;flex-direction:column;gap:20px">
    <label class="fl"><span class="lb">Job</span><span class="fi">{dot("Blue")}<span style="flex:1">3342 Rifkin, Bellevue Hill</span><span style="display:inline-flex">{ico("x")}</span></span></label>
    <label class="fl"><span class="lb">The work</span><span class="fi">Install two split systems, back to back</span></label>
    <label class="fl"><span class="lb">Where on site</span><span class="fi">Main bedroom, study, side path</span></label>
    <div class="fl"><span class="lb">High-risk work</span><div style="display:flex;flex-direction:column;gap:10px;margin-top:2px">{tick(True, "Work at height over 2 m")}{tick(True, "Electrical work near live parts")}{tick(False, "Confined space")}</div></div>
    <div style="display:flex;gap:8px;margin-top:8px"><span class="b sec">Cancel</span><span class="b go">Next</span></div>
  </div>
  <aside class="gp" style="width:360px;align-self:flex-start">
    <h2 class="t16" style="margin-bottom:4px">From the job</h2>
    <p>Tiff filled in the work and the site from the quote and Lyle's notes. Check them before you go on.</p>
    <p class="c12" style="margin-top:12px">Template approved 3 September</p>
  </aside>
</div>'''
    tabs = [TAB_HOME, tab_job("Blue", "3342 Rifkin"), (ico("shield"), "New SWMS")]
    return frame(sidebar("doc"), header(tabs, 2), body)


# ------------------------------------------------------------------ Library
def library():
    shelves = [("Installation manuals", "86 documents", ""), ("Service manuals", "41 documents", ""), ("Specs and data books", "120 documents", ""), ("Company SOPs", "12 documents", ""), ("Field notes", "23 notes", '<span class="st look">3 to check</span>'), ("Field tools", "Heat load, running pressures, fault finder, outdoor unit placement", "")]
    sh = "".join(f'<a class="cd" href="#" style="padding:16px;display:flex;flex-direction:column;gap:4px;min-height:132px"><span class="qq" style="display:inline-flex">{ico("lib")}</span><span class="t16" style="margin-top:8px">{n}</span><span class="qq">{c}</span>{f"<span>{s}</span>" if s else ""}</a>' for n, c, s in shelves)
    recent = [("Daikin FTXM-R installation manual", "Installation manuals", "Added today"), ("Getting an E6 clear on a Daikin split", "Field notes, Lyle", "Added yesterday"), ("Mitsubishi City Multi data book 2026", "Specs and data books", "Added 8 October")]
    rc = "".join(f'<a class="rw" href="#"><span class="qq" style="display:inline-flex">{ico("doc")}</span><div class="m"><div class="t">{t}</div></div><span class="qq" style="width:220px">{s}</span><span class="qq" style="width:140px">{d}</span></a>' for t, s, d in recent)
    body = f'''<div class="ph">
  <div style="display:flex;align-items:center;gap:12px"><h1 class="t24">Library</h1><span class="qq" style="margin-top:4px">282 documents</span><span style="flex:1"></span><span class="fi" style="width:360px">{ico("search")}<span class="ph2">Search manuals, specs, SOPs and field notes</span></span><span class="b sec">{ico("upload")}Add a document</span></div>
</div>
<div style="padding:24px 40px 0">
  <h2 class="t16" style="margin-bottom:12px">Shelves</h2>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">{sh}</div>
  <div class="gh2" style="margin-top:32px"><h2 class="t16">Recently added</h2></div>{rc}
</div>'''
    return frame(sidebar("lib"), header([TAB_HOME, (ico("lib"), "Library")], 1), body)


# ------------------------------------------------------------------ Design
def design():
    designs = [("4 Hale St, level 3", "Blue", "3240 Hale Street apartments", "Edited today"), ("Heuvel new build, floors 1 and 2", "Purple", "3302 Heuvel Construction", "Edited yesterday"), ("Okafor house", "Orange", "3361 Okafor, Riverview", "Edited 9 October"), ("Grange brewhouse cool room", "Blue", "3288 Grange Microbrewery", "Edited 7 October"), ("Scott Group office", "Blue", "3250 Scott Group, Parramatta", "Edited 30 September"), ("Northgate level 2", "Blue", "3323 Northgate Realty", "Edited 28 September")]
    th = '<div class="thumb"><i style="inset:24px 40px"></i><i style="left:40px;right:40px;top:75px;height:0;border-width:1px;border-radius:0"></i><i style="left:50%;top:24px;bottom:24px;width:0;border-width:1px;border-radius:0"></i></div>'
    cs = "".join(f'<a class="cd" href="#" style="overflow:hidden;display:flex;flex-direction:column">{th}<div style="padding:12px 16px"><div style="font-weight:600">{n}</div><div class="l13 qq" style="display:flex;align-items:center;gap:8px;margin-top:2px">{dot(c)}<span class="fade">{j}</span></div><div class="l13 qq">{d}</div></div></a>' for n, c, j, d in designs)
    body = f'''<div class="ph">
  <div style="display:flex;align-items:center;gap:12px"><h1 class="t24">Design</h1><span class="qq" style="margin-top:4px">18 designs</span><span style="flex:1"></span><span class="fi" style="width:300px">{ico("search")}<span class="ph2">Search designs</span></span><span class="b sec">{ico("plus")}New design</span></div>
</div>
<div style="padding:24px 40px 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">{cs}</div>'''
    return frame(sidebar("design"), header([TAB_HOME, (ico("design"), "Design")], 1), body)


# ------------------------------------------------------------------ Team
def team_head(tab, tech=False):
    items = [("People", ""), ("Notices", "2")] if tech else [("People", ""), ("Notices", "2"), ("Timesheets", "4"), ("Leave", "1"), ("Expenses", "2"), ("Vehicles", "")]
    stabs = "".join(f'<a class="{"on" if t == tab else ""}" href="#">{t}{f"<span class=c>{c}</span>" if c else ""}</a>' for t, c in items)
    btn = "" if tech else '<span class="b sec">' + ico("plus") + 'Add a person</span>'
    return f'''<div class="ph">
  <div style="display:flex;align-items:center;gap:12px"><h1 class="t24">Team</h1><span style="flex:1"></span><span class="fi" style="width:280px">{ico("search")}<span class="ph2">Search people</span></span>{btn}</div>
  <nav class="stb" style="margin-top:12px">{stabs}</nav>
</div>'''


def person(tech=False):
    people = [("LI", "Lyle Irving", "Senior tech", '<span class="st look">Licence runs out in 21 days</span>'), ("CA", "Callum Ahn", "Apprentice, 2nd year", ""), ("DW", "Dan Walsh", "Tech", ""), ("KL", "Kai Lee", "Project lead", '<span class="qq">On leave, back Thursday</span>'), ("IS", "Isaac Smith", "Owner", ""), ("MP", "Mia Park", "Office", '<span class="qq">Invite sent 9 October</span>')]
    if tech:
        people = [(a, n, r, "" if "Licence" in s or "Invite" in s else s) for a, n, r, s in people if n != "Mia Park"]
    pl = "".join(f'<a class="{"on" if i == 0 else ""}" href="#"><span class="avt">{a}</span><span class="m"><span class="t">{n}</span><span class="s">{s or r}</span></span></a>' for i, (a, n, r, s) in enumerate(people))

    def lic(n, s, b):
        return f'<div class="rw"><div class="m"><div class="t">{n}</div></div><span style="width:220px">{s}</span>{b}</div>'
    if tech:
        card = '''<div class="gp"><h2 class="t16" style="margin-bottom:8px">Contact</h2>
      <dl class="kv"><dt>Mobile</dt><dd><a class="lk" href="#">0413 222 871</a></dd><dt>Email</dt><dd><a class="lk" href="#">lyle@yourbusiness.com.au</a></dd></dl></div>'''
        role = "Senior tech"
    else:
        card = f'''<div class="gp"><div style="display:flex;align-items:center;margin-bottom:8px"><h2 class="t16">Details</h2><span style="flex:1"></span><span class="b sm sec">Edit details</span></div>
      <dl class="kv"><dt>Mobile</dt><dd>0413 222 871</dd><dt>Email</dt><dd>lyle@yourbusiness.com.au</dd><dt>Address</dt><dd>14 Carrington St, Marrickville NSW 2204</dd><dt>Employment</dt><dd>Full time, from 8 March 2021</dd><dt>Emergency</dt><dd>Sam Irving, partner, 0414 908 112</dd></dl></div>
    <div class="gp"><div style="display:flex;align-items:center;margin-bottom:2px"><h2 class="t16">Licences and tickets</h2><span style="flex:1"></span><span class="b sm sec">{ico("plus")}Add a licence</span></div>
      {lic("ARCtick refrigerant handling licence", '<span class="st look">Runs out 2 November</span>', '<span class="b sm sec">Renew</span>')}
      {lic("Electrical licence, restricted", '<span class="st good">Current to 2027</span>', '<span class="b sm" style="width:68px">Open</span>')}
      {lic("Working at heights", '<span class="st good">Current to May 2027</span>', '<span class="b sm" style="width:68px">Open</span>')}</div>
    <div class="gp" style="display:flex;gap:48px">
      <div><h2 class="t16" style="margin-bottom:2px">Work rights</h2><p class="st good">Citizen, checked 2021</p></div>
      <div><h2 class="t16" style="margin-bottom:2px">Pay</h2><p>Hourly, Xero linked</p></div>
      <div><h2 class="t16" style="margin-bottom:2px">Vehicle</h2><p>Hilux XQG 41B</p></div>
      <div><h2 class="t16" style="margin-bottom:2px">Access</h2><p>Staff, plus Workboard manage</p></div></div>'''
        role = "Senior tech, with us since March 2021"
    body = team_head("People", tech) + f'''<div style="display:flex;height:calc(900px - 56px - 106px)">
  <div class="lst" style="width:320px;flex:none;padding:12px 12px 0 28px;border-right:1px solid var(--line)">{pl}</div>
  <div style="flex:1;min-width:0;padding:24px 40px 0;display:flex;flex-direction:column;gap:20px;max-width:900px">
    <div style="display:flex;align-items:center;gap:16px"><span class="avt" style="width:56px;height:56px;font-size:16px">LI</span><div><h2 class="t16">Lyle Irving</h2><p class="qq">{role}</p></div></div>
    {card}
  </div>
</div>'''
    side = sidebar("team")
    if tech:
        side = side.replace(">IS<", ">DW<", 1).replace("Isaac Smith", "Dan Walsh", 1).replace(">Owner<", ">Tech<", 1)
    return frame(side, header([TAB_HOME, (ico("team"), "Team")], 1), body)


def leave():
    cols_c = "160px 150px 170px minmax(0,1fr)"
    coming = [("LI", "Lyle Irving", "Annual leave", "Wednesday 28 October", '<span class="st good">Approved</span>'), ("MP", "Mia Park", "Personal leave", "Friday 16 October", '<span class="st good">Approved</span><span class="l13 qq" style="display:block">Certificate in</span>')]
    cr = "".join(f'<div class="tr" style="grid-template-columns:{cols_c};gap:16px"><span style="display:flex;align-items:center;gap:10px;font-weight:600"><span class="avt s">{a}</span>{n}</span><span style="display:flex;align-items:center;gap:8px">{sym("Leave" if "Annual" in k else "Sick")}{k}</span><span style="white-space:nowrap">{d}</span><span>{s}</span></div>' for a, n, k, d, s in coming)
    bal = [("LI", "Lyle Irving", "112.4", "46.0"), ("DW", "Dan Walsh", "152.0", "61.2"), ("CA", "Callum Ahn", "64.0", "38.0"), ("KL", "Kai Lee", "79.2", "22.8"), ("MP", "Mia Park", "30.4", "15.2")]
    cols_b = "minmax(0,1fr) 80px 80px 64px"
    br = "".join(f'<div class="tr" style="grid-template-columns:{cols_b};gap:12px"><span style="display:flex;align-items:center;gap:10px;font-weight:600"><span class="avt s">{a}</span>{n}</span><span class="nm" style="text-align:right">{x}</span><span class="nm" style="text-align:right">{y}</span><span style="text-align:right"><span class="b sm">Edit</span></span></div>' for a, n, x, y in bal)
    body = team_head("Leave") + f'''<div style="display:flex;gap:48px;padding:20px 40px 0">
  <section style="flex:1;min-width:0">
    <div class="gh2"><h2 class="t16">Waiting on you</h2><span class="qq">1</span></div>
    <div class="cd" style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;gap:12px"><span class="avt">KL</span><div style="flex:1"><div style="font-weight:600">Kai Lee, annual leave</div><div class="l13 qq">Asked this morning, 7:55 am</div></div>{sym("Leave")}</div>
      <dl class="kv"><dt>Days</dt><dd>Monday 26 to Friday 30 October</dd><dt>Hours</dt><dd class="nm">38.0, leaving 41.2 annual</dd><dt>Note</dt><dd>Family holiday, booked a while ago</dd></dl>
      <p style="display:flex;align-items:center;gap:8px">{dot("Orange")}<span class="st look">Lyle is off on Wednesday 28 too.</span></p>
      <label class="fl"><span class="lb">Reason, if you decline. Kai sees it.</span><span class="fi"></span></label>
      <div style="display:flex;gap:8px"><span class="b sec">Decline</span><span style="flex:1"></span><span class="b go">Approve</span></div>
    </div>
    <div class="gh2" style="margin-top:28px"><h2 class="t16">Coming up</h2><span class="qq">2</span><span style="flex:1"></span><a class="lk l13" href="#">Schedule</a></div>
    {cr}
  </section>
  <section style="width:440px;flex:none">
    <div class="gh2"><h2 class="t16">Balances</h2><span class="qq">hours, today</span></div>
    <div class="th" style="grid-template-columns:{cols_b};gap:12px"><span>Person</span><span style="text-align:right">Annual</span><span style="text-align:right">Personal</span><span></span></div>{br}
  </section>
</div>'''
    return frame(sidebar("team"), header([TAB_HOME, (ico("team"), "Team")], 1), body)


def expenses():
    cols = "170px minmax(0,1fr) 140px 180px 84px 172px"

    def r(a, n, what, sup, job, amt, extra, act):
        return f'<div class="tr" style="grid-template-columns:{cols};gap:16px"><span style="display:flex;align-items:center;gap:10px;font-weight:600"><span class="avt s">{a}</span>{n}</span><span><span style="display:block">{what}</span><span class="l13 qq" style="display:block;white-space:nowrap">{sup}</span></span><span>{job}</span><span class="qq">{extra}</span><span class="nm" style="text-align:right;font-weight:600">{amt}</span><span style="display:flex;gap:8px;justify-content:flex-end">{act}</span></div>'
    ad = '<span class="b sm sec">Decline</span><span class="b sm sec">Approve</span>'
    paid = '<span class="b sm sec">Mark paid</span>'
    job = lambda c, t: f'<span style="display:flex;align-items:center;gap:8px">{dot(c)}{t}</span>'
    body = team_head("Expenses") + f'''<div style="padding:20px 40px 0">
  <div class="gh2"><h2 class="t16">Waiting on you</h2><span class="qq">2, $199.20</span><span style="flex:1"></span><span class="b go">Approve both</span></div>
  {r("LI", "Lyle Irving", "Copper fittings and flux", "Reece, Friday 9 October", job("Blue", "3342 Rifkin"), "$86.40", "Own money, receipt read", ad)}
  {r("DW", "Dan Walsh", "Fuel, 52.3 litres", "Ampol Botany, Thursday 8 October", "Hilux XQG 41B", "$112.80", "Own money, receipt read", ad)}
  <div class="gh2" style="margin-top:28px"><h2 class="t16">Approved, to pay back</h2><span class="qq">2, $213.40</span></div>
  {r("CA", "Callum Ahn", "Drill bits", "Bunnings, Tuesday 6 October", "Workshop", "$34.90", "Approved 7 October", paid)}
  {r("KL", "Kai Lee", "Parking and tolls", "Week of 28 September", job("Purple", "3302 Heuvel"), "$178.50", "Approved 2 October", paid)}
  <div class="gh2" style="margin-top:28px"><h2 class="t16">On the company card</h2><span class="qq">3 this week, no approval needed</span></div>
  {r("IS", "Isaac Smith", "Fuel, 61.0 litres", "BP Rosebery, Monday 12 October", "Ranger YHT 22C", "$131.75", "", "")}
  {r("LI", "Lyle Irving", "Pipe and lagging", "Reece, Thursday 8 October", job("Blue", "3342 Rifkin"), "$412.10", "", "")}
  {r("MP", "Mia Park", "Printer toner", "Officeworks, Wednesday 7 October", "Office", "$89.00", "", "")}
</div>'''
    return frame(sidebar("team"), header([TAB_HOME, (ico("team"), "Team")], 1), body)


# ------------------------------------------------------------------ you
DAYKEY = [("Green", "Normal day"), ("Orange", "Over hours"), ("Pink", "Under hours"), ("Purple", "Public holiday"), ("Leave", "Leave"), ("Sick", "Sick")]


def day_rows(days):
    out = ""
    for d, c, hrs, t, s in days:
        mark = (sym(c) if c in ("Leave", "Sick") else dot(c)) if c else '<span class="dt" style="box-shadow:inset 0 0 0 1.5px var(--edge)"></span>'
        out += f'<div class="rw" style="gap:16px"><span style="width:72px;font-weight:600">{d}</span><span style="width:22px;display:inline-flex;justify-content:center">{mark}</span><span class="nm" style="width:48px;text-align:right;font-weight:600">{hrs}</span><span class="nm qq" style="width:150px">{t}</span><span style="flex:1"></span>{s}</div>'
    return out


def timesheet():
    this = [("Mon 12", "Green", "8.0", "7:00 to 3:30", ""), ("Tue 13", None, "", "7:00 to now", '<span class="st good">On now</span>'), ("Wed 14", None, "", "", ""), ("Thu 15", None, "", "", ""), ("Fri 16", None, "", "", "")]
    last = [("Mon 5", "Purple", "8.0", "Public holiday", ""), ("Tue 6", "Orange", "8.5", "7:00 to 4:00", '<span class="qq">0.5 at time and a half</span>'), ("Wed 7", "Green", "8.0", "7:00 to 3:30", ""), ("Thu 8", "Orange", "10.0", "6:30 to 5:00", '<span class="qq">2.0 at time and a half</span>'), ("Fri 9", "Green", "8.0", "7:00 to 3:30", "")]
    key = "".join(f'<span style="display:inline-flex;align-items:center;gap:6px">{sym(c) if c in ("Leave", "Sick") else dot(c)}{t}</span>' for c, t in DAYKEY)
    pager = f'<span class="ib bare">{ico("left")}</span><span style="font-weight:600">12 to 18 October</span><span class="ib bare">{ico("right")}</span>'
    body = f'''<div class="ph">
  <div class="l13 qq" style="display:flex;gap:8px;align-items:center"><span>Isaac Smith</span>{ico("right")}<b style="color:var(--ink);font-weight:600">Timesheet</b></div>
  <div style="display:flex;align-items:center;gap:12px;margin-top:8px"><h1 class="t24">Timesheet</h1><span style="flex:1"></span><span style="display:inline-flex;align-items:center;gap:4px">{pager}</span></div>
</div>
<div style="display:flex;gap:48px;padding:16px 40px 0">
  <div style="flex:1;min-width:0">
    <div class="gh2"><h2 class="t16">This week</h2><span style="flex:1"></span><span class="qq">Sends itself Sunday 6:00 pm</span></div>{day_rows(this)}
    <div class="gh2" style="margin-top:28px"><h2 class="t16">Last week, 5 to 11 October</h2><span style="flex:1"></span><span class="st info">Sent, waiting on approval</span></div>{day_rows(last)}
    <p class="l13 qq" style="padding-top:12px">42.5 hours, 2.5 of them at time and a half, with the public holiday.</p>
    <div class="l13" style="display:flex;align-items:center;gap:20px;margin-top:12px;color:var(--q)">{key}</div>
  </div>
  <aside style="width:380px;flex:none;display:flex;flex-direction:column;gap:20px">
    <div class="cd" style="padding:16px;display:flex;flex-direction:column;gap:16px">
      <h2 class="t16">Tuesday 13 October</h2>
      <span class="sg" style="align-self:flex-start"><span class="on">Worked</span><span>Off</span><span>Leave</span></span>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;position:relative">
        {time_field("Start", "7:00 am")}
        {time_field("Finish", "", True)}
        <label class="fl"><span class="lb">Break, unpaid</span><span class="fi" style="justify-content:space-between;padding:0 4px"><span class="ib bare" style="width:28px;height:28px">&minus;</span><span class="nm" style="font-weight:600">30 min</span><span class="ib bare" style="width:28px;height:28px">+</span></span></label>
        <label class="fl"><span class="lb">Total</span><span class="fi" style="background:var(--soft);border-color:transparent"><span class="ph2">When you finish</span></span></label>
        {wheel_drop("finish", "3", "30", "pm", "right:0;top:66px;width:230px")}
      </div>
      <p class="l13 qq">Started at 7:00, when you checked in at Kingsford.</p>
      <div style="display:flex"><span style="flex:1"></span><span class="b go">Save the day</span></div>
    </div>
    <div class="gp"><h2 class="t16" style="margin-bottom:2px">Your normal week</h2><p>Monday to Friday, 7:00 to 3:30, 30 minute break.</p><a class="lk l13" href="#" style="display:inline-block;margin-top:6px">Change it on your card</a></div>
  </aside>
</div>'''
    you = sidebar("").replace('<a class="you"', '<a class="you" style="background:rgba(255,255,255,.12)"', 1)
    return frame(you, header([TAB_HOME, (ico("clock"), "Timesheet")], 1), body)


def you_menu():
    g1 = "".join(f'<a class="mi" href="#">{ico(i)}{t}</a>' for i, t in [("person", "Your card"), ("clock", "Timesheet"), ("sun", "Leave"), ("receipt", "Expense claims")])
    g2 = "".join(f'<a class="mi" href="#">{ico(i)}{t}</a>' for i, t in [("dollar", "Reports"), ("gear", "Settings")])
    menu = f'''<div class="ov mn" style="left:8px;bottom:68px;width:240px;z-index:7">
  <div style="padding:8px 12px"><div style="font-weight:600">Isaac Smith</div><div class="l13 qq">isaac@yourbusiness.com.au</div></div>
  <div class="mdv"></div>{g1}<div class="mdv"></div>{g2}<div class="mdv"></div><a class="mi" href="#">Help</a><a class="mi" href="#">Sign out</a>
</div>'''
    html = hide(v3.home())
    html = html.replace('<a class="you"', '<a class="you" style="background:rgba(255,255,255,.12)"', 1)
    return html.replace("</main>", "</main>" + menu, 1)


# ------------------------------------------------------------------ a time, on a wheel
HOURS = [str(h) for h in range(1, 13)]
MINUTES = [f"{m:02d}" for m in range(0, 60, 5)]
HALVES = ["am", "pm"]


def wheel(h, m, ap, row=36):
    """Three columns of real times, the chosen one on the band. Five rows show:
    two either side of the chosen one, fading out. Hour 1 to 12, minutes in
    fives, am or pm, as TimeWheel has them today."""
    def col(label, opts, val):
        i = opts.index(val)
        cells = ""
        for k in (-2, -1, 0, 1, 2):
            j = i + k
            t = opts[j] if 0 <= j < len(opts) else ""
            cells += f'<span class="{"on" if k == 0 else ""}" style="height:{row}px">{t}</span>'
        return f'<div class="whc"><span class="lb3">{label}</span><div class="whs">{cells}</div></div>'
    band = f'<span class="band" style="top:{22 + 2 * row}px;height:{row}px"></span>'
    return f'<div class="wh">{band}{col("Hour", HOURS, h)}{col("Minute", MINUTES, m)}{col("am or pm", HALVES, ap)}</div>'


def time_field(label, value, open_=False, h=36):
    chev = ico("down", style="transform:rotate(180deg)") if open_ else ico("down")
    val = f'<span class="nm">{value}</span>' if value else '<span class="ph2">Set a time</span>'
    return f'<label class="fl"><span class="lb">{label}</span><span class="fi sel2{" open" if open_ else ""}" style="height:{h}px">{val}{chev}</span></label>'


def wheel_drop(name, h, m, ap, style):
    return f'<div class="whd" style="{style}"><div class="hd"><span class="b sm go">Set {name}</span></div>{wheel(h, m, ap)}</div>'


def phone_sheet(name, h, m, ap):
    return f'''<div style="position:absolute;left:0;right:0;bottom:0;z-index:8;background:#fff;border-radius:16px 16px 0 0;padding:12px 16px 20px;display:flex;flex-direction:column;gap:12px">
    <span style="align-self:center;width:36px;height:4px;border-radius:2px;background:var(--edge)"></span>
    <div style="display:flex;align-items:center"><h2 class="t16">{name.capitalize()}</h2><span style="flex:1"></span><span class="ib bare lg">{ico("x")}</span></div>
    {wheel(h, m, ap, row=44)}
    <span class="b lg go">Set {name}</span>
  </div>'''


def time_part():
    lede = "Every clock time is chosen, never typed: the hour, the minutes in fives, am or pm. Each value on a wheel is a real time, so a time can never be unreadable, and nothing needs a “we can’t read that” state."
    rules = [("Where", "Your timesheet’s start and finish, your normal week on your card, a Schedule event’s from and to, a notice event’s start, a visit’s time when one is set."),
             ("The field", "Reads like any menu field (rule 34): the time, then a chevron. Empty, it says Set a time."),
             ("Open on a computer", "Drops under its field, white, the one shadow (rule 36). The blue button at the top sets it: Set start, Set finish. Clicking away keeps what was there."),
             ("Open on a phone", "Rises from the bottom as a sheet, rows 44 tall (rule 48), the button under the wheel where a thumb is."),
             ("Scroll, click or keys", "Scroll a column, click a value, or use the keys: up and down move a column, Tab the next column, Enter sets. A screen reader hears each column as a list."),
             ("How long, not when", "Hours on site, hours of leave and a break are how long, not a clock time. They are not on the wheel yet: see Still open.")]
    rs = "".join(f'<div class="gp" style="padding-top:10px"><b>{a}</b><p class="qq l13" style="margin-top:2px">{b}</p></div>' for a, b in rules)
    desk = f'''<div class="cd" style="padding:20px;position:relative;height:420px">
      <h2 class="t16" style="margin-bottom:12px">On a computer</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;width:360px">{time_field("Start", "7:00 am")}{time_field("Finish", "3:30 pm", True)}</div>
      {wheel_drop("finish", "3", "30", "pm", "left:206px;top:118px;width:230px")}
    </div>'''
    sheet = f'''<div style="width:330px;height:640px;border-radius:24px;border:1px solid var(--line);background:#fff;position:relative;overflow:hidden">
      <div style="padding:20px 16px;display:flex;flex-direction:column;gap:12px"><h2 class="t24">Timesheet</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">{time_field("Start", "7:00 am", h=44)}{time_field("Finish", "3:30 pm", True, h=44)}</div></div>
      <div class="scr" style="z-index:7"></div>
      {phone_sheet("finish", "3", "30", "pm")}
    </div>'''
    body = f'''<div class="ph"><h1 class="t24">A time, on a wheel</h1><p class="qq" style="margin-top:4px;max-width:820px">{lede}</p></div>
<div style="display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:40px;padding:20px 40px 0">
  <div style="display:flex;flex-direction:column;gap:20px">{desk}<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 32px">{rs}</div></div>
  <div><h2 class="t16" style="margin-bottom:12px">On a phone</h2>{sheet}</div>
</div>'''
    return frame(sidebar(""), header(), body)


# ------------------------------------------------------------------ Team, Notices
NOTICES = [("Toolbox talk: working at heights", "Event, Monday 20 October, 7:00 am", True, True),
           ("Christmas shutdown", "Notice, Friday", False, False),
           ("Friday drinks: who’s in", "Poll, closes Thursday", True, False),
           ("New fuel cards for the utes", "Notice, 6 October", False, False),
           ("Bring your ARCtick card on Monday", "Notice, 2 October", False, False)]


def notices():
    new_word = '<span class="st info l13">New</span>'
    li = "".join(f'<a class="{"on" if on else ""}" href="#"><span class="m"><span class="t">{t}</span><span class="s">{s}</span></span>{new_word if new and not on else ""}</a>' for t, s, new, on in NOTICES)
    li += f'<a href="#" style="margin-top:8px"><span class="m"><span class="t" style="font-weight:500;color:var(--q)">Archived</span></span><span class="qq l13">6</span>{ico("down")}</a>'
    rsvp = [("Going", 5, 62, True), ("Maybe", 1, 12, False), ("Can’t make it", 2, 26, False)]
    opts = "".join(f'<div class="nb-opt{" on" if on else ""}"><i style="width:{w}%"></i><b>{a}</b><span style="flex:1"></span><span class="qq nm">{n}</span></div>' for a, n, w, on in rsvp)
    reacts = "".join(f'<span class="rct{" on" if on else ""}">{e}<span class="nm">{n}</span></span>' for e, n, on in [("\U0001F44D", 4, True), ("\U0001F64F", 2, False)]) + f'<span class="rct" style="color:var(--q)">{ico("plus")}React</span>'

    def comment(a, n, t, txt):
        return f'<div class="msg">{jc.av(a)}<div class="bd">{jc.who(n, t)}<p style="font-size:14px;line-height:20px">{txt}</p></div></div>'
    detail = f'''<div style="display:flex;align-items:flex-start;gap:8px">
      <div style="flex:1;min-width:0"><h2 class="t20">Toolbox talk: working at heights</h2><p class="l13 qq" style="margin-top:2px">Isaac Smith, Friday 10 October. Edited. Comes down 21 October.</p></div>
      <span class="b sm sec">Edit</span><span class="b sm sec">Archive</span><span class="b sm del">Delete</span>
    </div>
    <div class="cd" style="padding:16px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;gap:10px">{ico("cal")}<b>Monday 20 October, 7:00 am</b><span class="qq">at the Kingsford yard</span></div>
      {opts}
      <a class="lk l13" href="#">Who said what</a>
    </div>
    <p class="r16">Half an hour before we head out. Harnesses, the new ladder rules and the roof at Bellevue Hill. Coffee’s on me.</p>
    <div class="fth"><i></i><i></i></div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">{reacts}<span style="flex:1"></span><span class="l13 qq" style="display:inline-flex;align-items:center;gap:6px">{ico("check")}Read by 6 of 8</span></div>
    <div class="gp" style="display:flex;flex-direction:column;gap:12px">
      <h3 class="t16">Comments <span class="qq" style="font-weight:500">2</span></h3>
      {comment("LI", "Lyle Irving", "Friday 2:10 pm", 'I’ll bring the spare harness. <span class="nt">Callum</span> yours is due for its check.')}
      {comment("CA", "Callum Ahn", "Friday 3:02 pm", "Booked it in for Saturday.")}
      <div style="display:flex;gap:8px"><span class="fi" style="flex:1"><span class="ph2">Write a comment</span></span><span class="b sec">Post comment</span></div>
    </div>'''
    head = team_head("Notices").replace('<span class="b sec">' + ico("plus") + 'Add a person</span>', '<span class="b go">' + ico("megaphone") + 'Write a notice</span>')
    body = head + f'''<div style="display:flex;height:calc(900px - 56px - 106px)">
  <div class="lst" style="width:340px;flex:none;padding:12px 12px 0 28px;border-right:1px solid var(--line)">{li}</div>
  <div style="flex:1;min-width:0;padding:20px 40px 0;display:flex;flex-direction:column;gap:16px;max-width:860px;overflow:hidden">{detail}</div>
</div>'''
    return frame(sidebar("team"), header([TAB_HOME, (ico("team"), "Team")], 1), body)


def notice_write():
    base = notices()
    kinds = '<span class="sg" style="align-self:flex-start"><span>Notice</span><span>Poll</span><span class="on">Event</span></span>'
    form = f'''<div class="scr" style="z-index:4"></div>
<div class="ov" style="position:absolute;left:calc(256px + (100% - 256px) / 2 - 280px);top:72px;width:560px;padding:24px;z-index:5;display:flex;flex-direction:column;gap:16px">
  <div style="display:flex;align-items:center"><h2 class="t20">Write a notice</h2><span style="flex:1"></span><span class="ib bare">{ico("x")}</span></div>
  <div class="fl"><span class="lb">Kind</span>{kinds}</div>
  <label class="fl"><span class="lb">Title</span><span class="fi">Toolbox talk: working at heights</span></label>
  <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:12px;position:relative">
    <label class="fl"><span class="lb">Date</span><span class="fi sel2">Monday 20 October{ico("cal")}</span></label>
    {time_field("Start", "7:00 am", True)}
    {wheel_drop("start", "7", "00", "am", "right:0;top:66px;width:230px")}
  </div>
  <label class="fl"><span class="lb">Where</span><span class="fi">the Kingsford yard</span></label>
  <label class="fl"><span class="lb">Message</span><span class="fi" style="height:84px;align-items:flex-start;padding-top:8px;white-space:normal">Half an hour before we head out. Harnesses, the new ladder rules and the roof at Bellevue Hill.</span></label>
  <div style="display:flex;gap:12px;align-items:center"><span class="b sm sec">{ico("photo")}Add photos or files</span><span style="flex:1"></span><span class="l13 qq">Comes down</span><span class="fi sel2" style="width:170px">21 October{ico("cal")}</span></div>
  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px"><span class="b sec">Cancel</span><span class="b go">Post notice</span></div>
</div>'''
    return base.replace("</main>", "</main>" + form, 1)


# ------------------------------------------------------------------ Conversations
def conversations():
    items = [("Bellevue Hill wrap-up and isolator", "Today 10:20 am", True), ("Riverview brief", "Today 8:40 am", False), ("Hilux and the head for Lyle", "Today 8:12 am", False), ("Lyle asked: fans for Rozelle", "Mention, 7:40 am", False), ("Clearing an E6 on a Daikin split", "Yesterday", False), ("Fans for Rozelle: which brand", "Friday", False), ("Who's free Thursday", "Friday", False)]
    li = "".join(f'<a class="{"on" if s else ""}" href="#"><span class="m"><span class="t">{t}</span><span class="s">{d}</span></span></a>' for t, d, s in items)
    vw = "".join(f'<a class="{"on" if i == 0 else ""}" href="#">{n}{f" <span class=c>{c}</span>" if c else ""}</a>' for i, (n, c) in enumerate([("All", ""), ("Mentions", "1"), ("Team", ""), ("Only me", "")]))
    voice = f'{ico("mic")}<span class="qq">Spoken, on 3342</span>'
    thread = f'''<div class="dd2">Today</div>
<div class="msg">{jc.av("IS")}<div class="bd">{jc.who("Isaac Smith", "10:20 am", voice)}<p>Lyle's finished the study head. Customer wants an extra isolator on the deck, quote it. And book Northgate in for Thursday with Kai.</p></div></div>
<div class="msg">{jc.tiff_av()}<div class="bd">{jc.who("Tiff", "10:20 am")}<p>Done. Noted on 3342, the isolator is drafted as a variation for you to check, and Northgate is held for Thursday with Kai.</p>
  {jc.act("check", "Note on 3342 Rifkin", "In ServiceM8 too", "Open")}
  {jc.act("doc", "Variation: isolator on the deck", "$480 plus GST, waiting for you", "Open")}
  <div class="act">{ico("cal")}<div class="m2"><b>Northgate 3323, Thursday, Kai</b><span>Held, not booked yet</span></div><span class="b sm go">Book it</span></div>
  <p class="l13" style="margin-top:10px"><a class="lk" href="#">Undo all three</a></p></div></div>'''
    bar = f'''<div class="jbar"><div class="r16 qq" style="min-height:32px">Reply to Tiff</div><div class="row"><span class="b sm sec">{ico("camera")}Add photo</span><span class="ib">{ico("mic")}</span><span style="flex:1"></span><span class="b sm go">Send</span></div></div>'''
    body = f'''<div style="display:flex;height:calc(900px - 56px)">
  <div style="width:340px;flex:none;border-right:1px solid var(--line);display:flex;flex-direction:column">
    <div style="padding:8px 20px 12px 28px"><h1 class="t24">Conversations</h1><div style="margin-top:12px"><span class="vws">{vw}</span></div></div>
    <div class="lst" style="padding:0 12px 0 16px">{li}</div>
  </div>
  <section class="jc" style="padding:0 48px;max-width:960px">
    <div class="jt">{thread}</div>{bar}
  </section>
</div>'''
    return frame(sidebar("chat"), header([TAB_HOME, (ico("chat"), "Conversations")], 1), body)



# ------------------------------------------------------------------ one engine: asking Tiff anything
ASK_ITEMS = [("Last 10 kW Mitsubishi ducted", "Today 10:42 am"), ("Daikin or Mitsubishi, 5 kW", "Today 10:31 am"), ("Bellevue Hill wrap-up and isolator", "Today 10:20 am"), ("Riverview brief", "Today 8:40 am"), ("Hilux and the head for Lyle", "Today 8:12 am"), ("Clearing an E6 on a Daikin split", "Yesterday"), ("Who's free Thursday", "Friday")]


def src(icon, text):
    return f'<div class="l13 qq" style="display:flex;align-items:center;gap:6px;margin-top:8px">{ico(icon, style="width:14px;height:14px")}{text}</div>'


def reading(*lines):
    return "".join(f'<div class="l13 qq" style="display:flex;align-items:center;gap:6px">{ico("check", style="width:14px;height:14px")}{t}</div>' for t in lines)


def ask_page(on, thread):
    li = "".join(f'<a class="{"on" if t == on else ""}" href="#"><span class="m"><span class="t">{t}</span><span class="s">{d}</span></span></a>' for t, d in ASK_ITEMS)
    vw = "".join(f'<a class="{"on" if i == 0 else ""}" href="#">{n}{f" <span class=c>{c}</span>" if c else ""}</a>' for i, (n, c) in enumerate([("All", ""), ("Mentions", "1"), ("Team", ""), ("Only me", "")]))
    bar = f'''<div class="jbar"><div class="r16 qq" style="min-height:32px">Ask Tiff anything</div><div class="row"><span class="b sm sec">{ico("camera")}Add photo</span><span class="ib">{ico("mic")}</span><span style="flex:1"></span><span class="b sm go">Send</span></div></div>'''
    body = f'''<div style="display:flex;height:calc(900px - 56px)">
  <div style="width:340px;flex:none;border-right:1px solid var(--line);display:flex;flex-direction:column">
    <div style="padding:8px 20px 12px 28px"><h1 class="t24">Conversations</h1><div style="margin-top:12px"><span class="vws">{vw}</span></div></div>
    <div class="lst" style="padding:0 12px 0 16px">{li}</div>
  </div>
  <section class="jc" style="padding:0 48px;max-width:960px">
    <div class="jt">{thread}</div>{bar}
  </section>
</div>'''
    return frame(sidebar("chat"), header([TAB_HOME, (ico("chat"), "Conversations")], 1), body)


def ask_jobs():
    def job(dotc, title, sub):
        return f'<div class="act">{dot(dotc)}<div class="m2"><b>{title}</b><span>{sub}</span></div><a class="lk l13" href="#">Open</a></div>'
    thread = f'''<div class="dd2">Today</div>
<div class="msg">{jc.av("IS")}<div class="bd">{jc.who("Isaac Smith", "10:42 am")}<p>When did we last put in a 10 kW Mitsubishi Electric ducted?</p></div></div>
<div class="msg">{jc.tiff_av()}<div class="bd">{jc.who("Tiff", "10:42 am")}
  {reading("Read the Mitsubishi Electric data pack: three 10 kW ducted heads", "Searched the materials on 1,240 ServiceM8 jobs, your quotes and the plates photographed on site")}
  <p style="margin-top:8px">3318 Hartley in Lane Cove, finished Thursday 2 October by Lyle and Kai: a PEAD-M100JAA on a PUZ-ZM100VKA2. Before that, 3271 Osei in Ryde in August.</p>
  {job("Green", "3318 Hartley, Lane Cove", "PEAD-M100JAA, PUZ-ZM100VKA2. Finished 2 October, Lyle and Kai")}
  {job("Blue", "3271 Osei, Ryde", "PEAD-M100JAA, PUZ-M100VKA. Finished 14 August, Dan")}
  {src("doc", "From ServiceM8 job materials, matched to the data pack’s 10 kW ducted models")}
</div></div>
<div class="msg">{jc.av("IS")}<div class="bd">{jc.who("Isaac Smith", "10:44 am")}<p>Why would the coil on one of those ice up in cooling?</p></div></div>
<div class="msg">{jc.tiff_av()}<div class="bd">{jc.who("Tiff", "10:44 am")}
  <p>Nothing in your library covers this; the PEAD-M100JAA installation manual would. From general HVAC knowledge:</p>
  <p style="margin-top:8px">Usually too little air over the coil: a blocked filter or return grille, a crushed or disconnected duct, or too many zones shut. After that, a low refrigerant charge. Check the filter and the return first.</p>
  {src("info", "General HVAC knowledge, not from your documents")}
</div></div>'''
    return ask_page("Last 10 kW Mitsubishi ducted", thread)


def ask_compare():
    rows = [("Cooling and heating", "5.0 and 6.0 kW", "5.0 and 6.0 kW"), ("Sound, low to high", "28 to 45 dB(A)", "28 to 49 dB(A)"), ("Indoor, W × H × D", "990 × 295 × 263 mm", "798 × 299 × 219 mm"), ("Indoor weight", "13 kg", "10.5 kg"), ("Airflow", "267 L/s", "268 L/s"), ("Pipes", "6.35 and 12.7 mm, R32", "6.35 and 12.7 mm, R32"), ("Your price, the pair", "$1,290", "$1,365")]
    tr = "".join(f'<tr><th>{a}</th><td class="nm">{b}</td><td class="nm">{c}</td></tr>' for a, b, c in rows)
    table = f'''<div class="cd" style="margin-top:10px;padding:4px 16px 12px">
  <table class="cmp"><thead><tr><th></th><th>Daikin Cora<span>FTXV50WVMA</span></th><th>Mitsubishi Electric AP<span>MSZ-AP50VGD2</span></th></tr></thead><tbody>{tr}</tbody></table>
  <div style="display:flex;gap:8px;margin-top:12px"><span class="b sm sec">{ico("plus")}Add Cora to a quote</span><span class="b sm sec">{ico("plus")}Add AP to a quote</span></div>
</div>'''
    series = '<div class="chips2" style="flex-wrap:wrap"><span class="b sm sec">Daikin: Zena</span><span class="b sm sec">Alira X</span><span class="b sm sec">Lite</span><span class="b sm sec">Mitsubishi Electric: LN</span><span class="b sm sec">EF</span><span class="b sm sec">GS</span></div>'
    thread = f'''<div class="dd2">Today</div>
<div class="msg">{jc.av("IS")}<div class="bd">{jc.who("Isaac Smith", "10:31 am")}<p>What’s the difference between a Daikin 5 kW and a Mitsubishi Electric 5 kW split?</p></div></div>
<div class="msg">{jc.tiff_av()}<div class="bd">{jc.who("Tiff", "10:31 am")}
  {reading("Read the Daikin and Mitsubishi Electric data packs, and your price book")}
  <p style="margin-top:8px">Each makes four at 5 kW, so here are the two you quote most. The same capacity on paper: the Mitsubishi head is 19 cm narrower and 2.5 kg lighter, the Daikin 4 dB quieter on high.</p>
  {table}
  {src("doc", "Figures from the makers’ data packs; prices from your price book")}
  <p style="margin-top:12px">Energy ratings aren’t in the data packs, so check the star rating labels before choosing on running cost.</p>
  {src("info", "General HVAC knowledge, not from your documents")}
  <p class="l13 qq" style="margin-top:12px">Compare another series instead</p>{series}
</div></div>'''
    return ask_page("Daikin or Mitsubishi, 5 kW", thread)


# ------------------------------------------------------------------ phone
def phone_timesheet():
    rows = "".join(f'<div class="rw" style="gap:12px"><span style="width:56px;font-weight:600">{d}</span>{dot(c) if c else '<span class="dt" style="box-shadow:inset 0 0 0 1.5px var(--edge)"></span>'}<span class="nm" style="font-weight:600;width:36px;text-align:right">{h}</span><span class="nm qq l13" style="flex:1">{t}</span>{s}</div>' for d, c, h, t, s in [("Mon 12", "Green", "8.0", "7:00 to 3:30", ""), ("Tue 13", None, "", "7:00 to now", '<span class="st good l13">On now</span>')])
    return f'''<div class="v3 on-ink" style="width:390px;height:844px;flex-direction:column;position:relative">{v3.MARK_DEFS}{v3.MONO_DEFS}
  <div style="height:56px;flex:none;display:flex;align-items:center;gap:8px;padding:0 12px 0 8px;color:#fff"><span class="ib bare lg" style="background:transparent;color:#fff">{ico("menu")}</span>{v3.mark_svg()}<b style="font-size:16px;font-weight:700">HeyTiff</b><span style="flex:1"></span><span class="b" style="height:40px;background:#fff;color:var(--ink)">{ico("plus")}New</span></div>
  <div style="flex:1;min-height:0;background:#fff;border-radius:40px 0 0 0;display:flex;flex-direction:column;overflow:hidden">
    <div style="height:48px;flex:none;display:flex;align-items:flex-end;padding:0 16px 4px 24px;font-weight:500">Tuesday 13 October<span class="qq" style="margin-left:8px">10:05 am</span></div>
    <div style="padding:12px 16px 0;display:flex;flex-direction:column;gap:16px;flex:1;min-height:0">
      <div style="display:flex;align-items:center;gap:8px"><h1 class="t24">Timesheet</h1><span style="flex:1"></span><span class="ib bare lg">{ico("left")}</span><span class="ib bare lg">{ico("right")}</span></div>
      <div>{rows}</div>
      <div class="cd" style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;align-items:center"><h2 class="t16">Today</h2><span style="flex:1"></span><span class="sg"><span class="on" style="height:38px">Worked</span><span style="height:38px">Off</span><span style="height:38px">Leave</span></span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          {time_field("Start", "7:00 am", h=44)}
          {time_field("Finish", "", True, h=44)}
          <label class="fl"><span class="lb">Break, unpaid</span><span class="fi" style="height:44px;justify-content:space-between;padding:0 4px"><span class="ib bare" style="width:36px;height:36px">&minus;</span><span class="nm" style="font-weight:600">30 min</span><span class="ib bare" style="width:36px;height:36px">+</span></span></label>
          <label class="fl"><span class="lb">Total</span><span class="fi" style="height:44px;background:var(--soft);border-color:transparent"><span class="ph2">When you finish</span></span></label>
        </div>
        <p class="l13 qq">Started at 7:00, when you checked in at Kingsford.</p>
      </div>
      <span style="flex:1"></span>
      <span class="b lg go" style="margin-bottom:16px">Save the day</span>
    </div>
  </div>
  <div class="scr" style="z-index:7"></div>
  {phone_sheet("finish", "3", "30", "pm")}
</div>'''


# ------------------------------------------------------------------ on the job's conversation
def jc_content():
    return f'<div class="jcw"><section class="jc"><div class="jt">{jc.thread()}</div>{jc.bar()}</section>{jc.side()}</div>'


def actions():
    return hide(v3.job(actions_menu(), content=jc_content()))


def over_job(v3html):
    """V3's overlays (a dialog, Search) laid over the job as it is now: its conversation."""
    tail = v3html.split("</main>", 1)[1]
    return jc.job_convo().split("</main>", 1)[0] + "</main>" + tail


def build(out):
    out["S-convos.dc.html"] = page("Conversations, one open", 1440, 900, CSS, conversations())
    out["S-you.dc.html"] = page("Your-name menu", 1440, 900, CSS, you_menu())
    out["S-quote.dc.html"] = page("A job's quote, Tiff asking", 1440, 900, CSS, quote())
    out["S-project.dc.html"] = page("A project job, its visits", 1440, 900, CSS, project())
    out["S-documents.dc.html"] = page("Documents", 1440, 900, CSS, documents())
    out["S-templates.dc.html"] = page("Documents, Templates", 1440, 900, CSS, templates())
    out["S-swms.dc.html"] = page("A SWMS from a job, in its own tab", 1440, 900, CSS, swms())
    out["S-library.dc.html"] = page("Library", 1440, 900, CSS, library())
    out["S-design.dc.html"] = page("Design", 1440, 900, CSS, design())
    out["S-person.dc.html"] = page("Team, a person open", 1440, 900, CSS, person())
    out["S-person-tech.dc.html"] = page("Team, as a tech sees it", 1440, 900, CSS, person(tech=True))
    out["S-leave.dc.html"] = page("Team, Leave", 1440, 900, CSS, leave())
    out["S-expenses.dc.html"] = page("Team, Expenses", 1440, 900, CSS, expenses())
    out["S-timesheet.dc.html"] = page("Your timesheet", 1440, 900, CSS, timesheet())
    out["S-actions.dc.html"] = page("A job's Actions", 1440, 900, CSS, actions())
    out["S-dialog.dc.html"] = page("A dialog and a toast, over a job", 1440, 900, CSS, over_job(v3.dialog()))
    out["S-search.dc.html"] = page("Search, over a job", 1440, 900, CSS, over_job(v3.search()))
    out["S-phone-timesheet.dc.html"] = page("Your timesheet on a phone", 390, 844, CSS, phone_timesheet())
    out["S-time.dc.html"] = page("A time, on a wheel", 1440, 900, CSS, time_part())
    out["S-notices.dc.html"] = page("Team, Notices", 1440, 900, CSS, notices())
    out["S-notice-write.dc.html"] = page("Write a notice, an event", 1440, 900, CSS, notice_write())
    out["S-ask-jobs.dc.html"] = page("Asking Tiff: a job by what went in, then a trade question", 1440, 900, CSS, ask_jobs())
    out["S-ask-compare.dc.html"] = page("Asking Tiff: two units side by side", 1440, 900, CSS, ask_compare())
