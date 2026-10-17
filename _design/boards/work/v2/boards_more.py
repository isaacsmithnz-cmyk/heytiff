from base import ico, sidebar, page
from boards_home import DAYBAR_CSS, box, home_body

EXTRA = """
.pagehead{padding:24px 32px 0;display:flex;flex-direction:column;gap:16px}
.toprow{display:flex;align-items:center;gap:12px}
.steps{display:flex;align-items:center;gap:8px;font-size:13px;line-height:18px;font-weight:500;color:#5f6a79;white-space:nowrap}
.steps .on{color:#050505;font-weight:600}
.steps .dn{color:#196B2D}
.steps .sep{width:16px;height:1px;background:rgba(5,5,5,.2)}
.kv{display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px 16px}
.kv dt{color:#5f6a79;font-weight:500}
.kv dd{margin:0}
.lane{display:grid;grid-template-columns:160px minmax(0,1fr);border-bottom:1px solid rgba(5,5,5,.08);height:72px}
.blk{position:absolute;top:10px;bottom:10px;border-radius:10px;color:#fff;padding:6px 10px;overflow:hidden;white-space:nowrap}
.blk b{display:block;font-size:13px;line-height:18px;overflow:hidden;text-overflow:ellipsis}
.blk span{display:block;font-size:12px;line-height:16px;font-weight:500;overflow:hidden;text-overflow:ellipsis}
.mitem{display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;border-radius:10px;font-weight:500}
.mitem:hover{background:rgba(5,5,5,.04)}
.mitem .ico{color:#5f6a79}
.shelf{padding:16px;display:flex;flex-direction:column;gap:4px}
"""


def jobs_body():
    rows = [
        ("3342", "Rifkin, Julian", "Bellevue Hill", "Install", "On site", "ok", "Today 9:00", "LI, CA", "$9,840", True),
        ("3361", "Okafor, Ada", "Riverview", "Quote", "Quote to write", "info", "Brief saved today", "IS", "", False),
        ("3323", "Northgate Realty", "Ryde", "Install", "Waiting on a day", "warn", "Won 9 October", "KL", "$24,600", False),
        ("3302", "Heuvel Construction", "Chatswood", "Project", "Rough-in, day 2 of 3", "ok", "Today", "KL, DW", "$188,000", False),
        ("1042", "Meridian Data", "Alexandria", "Maintenance", "Booked", "ok", "Today 12:45", "DW", "$1,120", False),
        ("3271", "Randwick Dental", "Randwick", "Service", "Booked", "ok", "Today 2:45", "IS", "$680", False),
        ("2380", "Kingsford Bakery", "Kingsford", "Service", "Ready to invoice", "warn", "Done 8:30 am", "IS", "$420", False),
        ("3294", "Belmont Holdings", "Rozelle", "Quote", "Waiting on an answer", "q", "Sent 2 October", "IS", "$3,150", False),
        ("2601", "Ardex Logistics", "Botany", "Maintenance", "Service due today", "warn", "No day yet", "", "$960", False),
        ("3288", "Grange Microbrewery", "Marrickville", "Install", "Waiting on a day", "warn", "Won 7 October", "", "$12,300", False),
        ("3250", "Scott Group", "Parramatta", "Install", "Waiting on a day", "bad", "Won 14 September", "", "$31,900", False),
    ]
    trs = "".join(
        f'<tr{" class=sel" if sel else ""}><td class="num" style="font-weight:600">{n}</td><td><div style="font-weight:600">{c}</div><div class="lab q">{s}</div></td><td>{k}</td><td><span class="{sc}" style="font-weight:500">{st}</span></td><td class="q">{nx}</td><td class="lab">{who}</td><td class="num" style="text-align:right">{v}</td></tr>'
        for n, c, s, k, st, sc, nx, who, v, sel in rows)
    return f'''<div class="app">
{sidebar("jobs")}
<main class="main">
  <div class="pagehead">
    <div class="toprow"><h1 class="h24">Jobs</h1><span class="q" style="margin-top:6px">142 open</span><span style="flex:1"></span><span class="field" style="width:320px">{ico("search", "ico i16 q")}<span class="q">Search jobs, clients and sites</span></span></div>
    <div style="display:flex;gap:8px"><span class="filt on">All <span class="c">142</span></span><span class="filt">To book <span class="c">19</span></span><span class="filt">Quotes <span class="c">23</span></span><span class="filt">To invoice <span class="c">8</span></span><span class="filt">Owed <span class="c">11</span></span><span class="filt">Projects <span class="c">6</span></span><span class="filt">Agreements <span class="c">34</span></span></div>
  </div>
  <div style="padding:8px 32px 0;overflow:hidden">
    <table class="tbl"><thead><tr><th style="width:72px">Job</th><th>Client and site</th><th style="width:120px">Kind</th><th style="width:200px">Where it's up to</th><th style="width:170px">Next</th><th style="width:90px">Who</th><th style="width:110px;text-align:right">Value</th></tr></thead><tbody>{trs}</tbody></table>
  </div>
</main>
</div>'''


def job_body(tab="Overview"):
    tabs = ["Overview", "Notes", "Quote", "Visits", "Checklist", "Photos", "Documents", "Billing", "Contacts"]
    th = "".join(f'<a class="{"on" if t == tab else ""}" href="{"N-Quote.dc.html" if t == "Quote" else "#"}">{t}</a>' for t in tabs)
    steps = [("Enquiry", "dn"), ("Quoted", "dn"), ("Accepted", "dn"), ("Booked", "dn"), ("On site", "on"), ("Done", ""), ("Invoiced", ""), ("Paid", "")]
    st = '<span class="sep"></span>'.join(f'<span class="{c}">{n}</span>' for n, c in steps)
    return f'''<div class="pagehead">
    <div class="crumb"><a href="N-Jobs.dc.html">Jobs</a>{ico("right", "ico i16")}<b>3342</b></div>
    <div class="toprow" style="align-items:flex-start">
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0"><h1 class="h24">Rifkin, Julian</h1><p class="q">Job 3342, Install, 41 Victoria Rd, Bellevue Hill. <span class="ok" style="font-weight:600">On site</span></p></div>
      <span style="flex:1"></span><a class="btn" href="#">Open in ServiceM8</a><span class="btn">Actions {ico("down", "ico i16")}</span>
    </div>
    <div class="steps">{st}</div>
    <nav class="tabs">{th}</nav>
  </div>'''


def job_overview():
    notes = [
        ("LI", "#E4DDF6", "Lyle Irving", "10:02 am", "Study head mounted and levelled. Running the pipe through the robe now, 6 m to the outdoor."),
        ("IS", "#050505", "You", "8:12 am", "Lyle needs the Bellevue Hill head on the ute."),
        ("CA", "#DCE8DD", "Callum Ahn", "Yesterday 3:40 pm", "Customer wants an isolator on the deck as well. Said they'd pay the extra."),
    ]
    nt = "".join(
        f'<article class="grp" style="display:flex;gap:12px;padding:16px 0"><span class="av" style="background:{bg};color:{"#fff" if bg == "#050505" else "#050505"}">{a}</span><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><div class="lab"><b>{n}</b> <span class="q">{t}</span></div><p class="read">{x}</p></div></article>'
        for a, bg, n, t, x in notes)
    return f'''<div style="flex:1;min-height:0;display:flex;gap:32px;padding:24px 32px;overflow:hidden">
    <section style="flex:1;min-width:0;display:flex;flex-direction:column">
      <div class="card" style="border-color:rgba(5,5,5,.14);padding:12px 12px 12px 16px">
        <div class="read q" style="min-height:48px">Write a note on this job</div>
        <div style="display:flex;align-items:center;gap:8px"><span class="mic" aria-label="Dictate">{ico("mic", "ico i16")}</span><label class="lab" style="display:inline-flex;align-items:center;gap:8px"><span class="tick on"></span>Also in ServiceM8</label><span style="flex:1"></span><span class="btn sm ink">Save note</span></div>
      </div>
      <div style="display:flex;align-items:baseline;gap:12px;padding:24px 0 4px"><h2 class="h16">Notes</h2><span class="q">23 on this job</span><span style="flex:1"></span><a class="link lab" href="#">All notes</a></div>
      {nt}
    </section>
    <aside style="width:360px;flex:none;display:flex;flex-direction:column;gap:24px">
      <section><h2 class="h16" style="margin-bottom:8px">Where it's up to</h2><p>Day 1 of 1. Both heads in, outdoor on the slab, pipe through the robe. The isolator on the deck is a variation, drafted, not yet approved.</p></section>
      <section><h2 class="h16" style="margin-bottom:8px">Next visit</h2><p>Today 9:00–11:30, Lyle and Callum</p></section>
      <section>
        <h2 class="h16" style="margin-bottom:8px">Documents on this job</h2>
        <div style="display:flex;flex-direction:column">
          <a class="grp" href="N-Documents.dc.html" style="display:flex;align-items:center;gap:12px;padding:10px 0">{ico("shield", "ico q")}<span style="flex:1">SWMS, split install</span><span class="warn" style="font-weight:500">2 of 3 signed on</span></a>
          <a class="grp" href="#" style="display:flex;align-items:center;gap:12px;padding:10px 0">{ico("doc", "ico q")}<span style="flex:1">Quote, version 2</span><span class="ok" style="font-weight:500">Accepted</span></a>
          <a class="grp" href="#" style="display:flex;align-items:center;gap:12px;padding:10px 0">{ico("cert", "ico q")}<span style="flex:1">Commissioning certificate</span><span class="q" style="font-weight:500">Not made yet</span></a>
        </div>
      </section>
      <section><h2 class="h16" style="margin-bottom:8px">Contacts</h2><p>Julian Rifkin, 0412 555 018</p></section>
    </aside>
  </div>'''


def job_page(tab_body, tab="Overview", overlay=""):
    return f'''<div class="app">
{sidebar("jobs", new_on=bool(overlay))}
<main class="main">
  {job_body(tab)}
  {tab_body}
</main>
{overlay}
</div>'''


def new_menu():
    top = [("jobs", "Job"), ("dollar", "Quote"), ("task", "Task"), ("cal", "Event"), ("receipt", "Expense"), ("sun", "Leave")]
    items = "".join(f'<a class="mitem" href="#">{ico(i)}{n}</a>' for i, n in top)
    sub = "".join(f'<a class="mitem" href="{"N-NewSWMS.dc.html" if n == "SWMS" else "#"}">{ico(i)}{n}</a>' for i, n in [("shield", "SWMS"), ("cert", "Certificate"), ("letter", "Letter")])
    chev = ico("right", "ico i16", "margin-left:auto;color:#5f6a79")
    return f'''<div class="overlay" role="menu" aria-label="New" style="position:absolute;left:8px;top:100px;width:264px;padding:8px;z-index:100">
  <div style="display:flex;align-items:center;gap:8px;height:40px;padding:0 4px 0 12px"><span style="width:8px;height:8px;background:#6D4FD8;flex:none"></span><span class="lab" style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">For 3342 Rifkin, Bellevue Hill</span><span class="xb" aria-label="Not for this job">{ico("x", "ico i16")}</span></div>
  <div class="grp" style="padding-top:4px;margin-top:4px">{items}</div>
  <div class="grp" style="padding-top:4px;margin-top:4px">
    <a class="mitem" href="#" style="background:rgba(5,5,5,.07)">{ico("doc")}Document{chev}</a>
    <a class="mitem" href="#">{ico("dots")}More{chev}</a>
  </div>
</div>
<div class="overlay" role="menu" aria-label="Document" style="position:absolute;left:276px;top:398px;width:208px;padding:8px;z-index:100">{sub}</div>'''


def quote_body():
    lines = [
        ("Daikin FTXM35 3.5 kW split, main bedroom", "1", "$2,180"),
        ("Daikin FTXM35 3.5 kW split, study", "1", "$2,180"),
        ("Back-to-back install kit, 6 m pipe", "2", "$860"),
        ("Isolator and 20 A circuit", "1", "$540"),
        ("Labour, 2 techs, 1 day", "14 h", "$1,890"),
        ("Allowances: parking, disposal", "1", "$120"),
    ]
    tr = "".join(f'<tr><td>{a}</td><td class="num" style="text-align:right">{b}</td><td class="num" style="text-align:right">{c}</td></tr>' for a, b, c in lines)
    return f'''<div style="flex:1;min-height:0;display:flex;gap:32px;padding:24px 32px;overflow:hidden">
    <section style="flex:1;min-width:0;display:flex;flex-direction:column;gap:24px">
      <div class="steps" style="font-size:14px"><span class="dn">Brief</span><span class="sep"></span><span class="dn">To confirm</span><span class="sep"></span><span class="on">Build-up</span><span class="sep"></span><span>Approved</span><span class="sep"></span><span>Sent</span><span class="sep"></span><span>Accepted</span><span style="flex:1"></span><span class="btn">Preview</span><span class="btn ink">Approve quote</span></div>
      <section><h2 class="h16" style="margin-bottom:8px">Brief</h2><p class="read">Two splits back to back, main bedroom and study. Outdoor on the side path. Customer wants an isolator on the deck.</p><p class="lab q" style="margin-top:4px">Said by Isaac on site, 11 October</p></section>
      <section>
        <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:8px"><h2 class="h16">Option 1</h2><span class="q">Daikin, back to back</span><span style="flex:1"></span><a class="link lab" href="#">Add a line</a><a class="link lab" href="#">Add a kit</a></div>
        <table class="tbl"><thead><tr><th>Line</th><th style="width:80px;text-align:right">Qty</th><th style="width:110px;text-align:right">Sell</th></tr></thead><tbody>{tr}</tbody></table>
      </section>
    </section>
    <aside style="width:380px;flex:none;display:flex;flex-direction:column;gap:16px">
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center;gap:8px"><h2 class="h16">Tiff</h2><span class="q">2 to confirm</span></div>
        <div class="grp" style="padding-top:12px"><p style="font-weight:600">Is there power at the deck, or a new circuit?</p><div style="display:flex;gap:8px;margin-top:8px"><span class="filt">Power there</span><span class="filt on">New circuit, $540</span></div></div>
        <div class="grp" style="padding-top:12px"><p style="font-weight:600">Wall or slab for the outdoor?</p><div style="display:flex;gap:8px;margin-top:8px"><span class="filt">Wall bracket, $90</span><span class="filt">Slab</span></div></div>
        <div class="field" style="margin-top:4px"><span class="q">Answer Tiff in your own words</span></div>
      </div>
      <div class="card" style="padding:16px">
        <dl class="kv"><dt>Ex GST</dt><dd class="num">$7,770</dd><dt>Inc GST</dt><dd class="num" style="font-weight:700">$8,547</dd><dt>Profit</dt><dd class="num">$2,310, 30%</dd></dl>
      </div>
    </aside>
  </div>'''


def schedule_body():
    hours = list(range(7, 18))
    head = "".join(f'<div class="cap" style="position:absolute;left:{(h - 7) / 10 * 100}%;top:8px;transform:translateX(-50%)">{h if h <= 12 else h - 12}{"am" if h < 12 else "pm"}</div>' for h in hours)
    people = [
        ("Isaac Smith", [(0.5, 1.5, "#B4C5EE", "Kingsford", "Job 2380", "#43506a"), (7.75, 9, "#8A6A00", "Randwick", "Job 3271", "#fff")]),
        ("Lyle Irving", [(2, 4.5, "#6D4FD8", "Bellevue Hill", "Job 3342", "#fff")]),
        ("Callum Ahn", [(2, 4.5, "#6D4FD8", "Bellevue Hill", "Job 3342", "#fff"), (5.5, 8, "#4B5565", "Chatswood", "Job 3302", "#fff")]),
        ("Dan Walsh", [(5.75, 6.75, "#3D8620", "Alexandria", "Job 1042", "#fff"), (7.5, 9.5, "#2F5FD0", "Botany", "Service 2601", "#fff")]),
        ("Kai Lee", []),
    ]
    lanes = ""
    for name, blocks in people:
        bl = "".join(f'<div class="blk" style="left:{s / 10 * 100}%;width:{(e - s) / 10 * 100}%;background:{c};color:{tc}"><b>{t}</b><span>{sub}</span></div>' for s, e, c, t, sub, tc in blocks)
        if not blocks:
            bl = '<div style="position:absolute;inset:10px 0;border-radius:10px;background:#F0F2F5;display:flex;align-items:center;padding:0 12px" class="lab q">On leave, back Thursday</div>'
        lanes += f'<div class="lane"><div style="display:flex;align-items:center;gap:8px;font-weight:600"><span class="av s" style="background:#F0F2F5;color:#050505">{"".join(w[0] for w in name.split())}</span>{name}</div><div style="position:relative">{bl}</div></div>'
    return f'''<div class="app">
{sidebar("schedule")}
<main class="main">
  <div class="pagehead" style="padding-bottom:16px">
    <div class="toprow"><h1 class="h24">Schedule</h1><span class="seg" style="margin-left:12px"><span class="on">Day</span><span>Week</span><span>Month</span></span><span style="flex:1"></span><span class="btn sm">Today</span><span class="xb" aria-label="Previous day">{ico("left")}</span><span style="font-weight:600">Monday 12 October</span><span class="xb" aria-label="Next day">{ico("right")}</span></div>
  </div>
  <div style="flex:1;min-height:0;display:flex">
    <div style="flex:1;min-width:0;padding:0 24px 0 32px">
      <div class="lane" style="height:32px;border-bottom:1px solid rgba(5,5,5,.08)"><div></div><div style="position:relative">{head}</div></div>
      {lanes}
      <div class="lab q" style="padding:16px 0">Crew today: 4 of 5. 31 of 40 hours booked.</div>
    </div>
    <aside style="width:320px;flex:none;border-left:1px solid rgba(5,5,5,.08);padding:16px 16px">
      <h2 class="h16" style="padding:0 0 4px">Not on a day yet</h2><p class="q" style="margin-bottom:12px">Drag one onto a lane</p>
      <div class="card" style="padding:12px;margin-bottom:8px"><div style="font-weight:600">Northgate Realty, 3323</div><div class="lab q">Install, about 2 days</div></div>
      <div class="card" style="padding:12px;margin-bottom:8px"><div style="font-weight:600">Ardex Logistics, service</div><div class="lab warn">Due today</div></div>
      <div class="card" style="padding:12px;margin-bottom:8px"><div style="font-weight:600">Heuvel, visit 3: fit-off</div><div class="lab q">Job 3302, around 20 October</div></div>
      <div class="card" style="padding:12px"><div style="font-weight:600">Grange Microbrewery, 3288</div><div class="lab q">Install, about 1 day</div></div>
    </aside>
  </div>
</main>
</div>'''


def documents_body(tab="All documents"):
    tabs = "".join(f'<a class="{"on" if t == tab else ""}" href="{"N-Templates.dc.html" if t == "Templates" else "N-Documents.dc.html"}">{t}</a>' for t in ["All documents", "Templates"])
    rows = [
        ("shield", "SWMS, split install", "3342 Rifkin, Bellevue Hill", "2 of 3 signed on", "warn", "Today", "Isaac"),
        ("shield", "SWMS, Heuvel roof work", "3302 Heuvel, Chatswood", "All signed on", "ok", "9 October", "Kai"),
        ("cert", "Commissioning certificate", "2380 Kingsford Bakery", "Issued, emailed to builder", "ok", "Today", "Isaac"),
        ("doc", "Quote, version 2", "3342 Rifkin, Bellevue Hill", "Accepted", "ok", "8 October", "Isaac"),
        ("doc", "Quote, version 1", "3294 Belmont Holdings", "Sent, waiting", "q", "2 October", "Isaac"),
        ("letter", "Reference, Dan Walsh", "No job", "Draft", "q", "1 October", "Isaac"),
        ("doc", "Handover sheet", "3240 Hale Street apartments", "Signed", "ok", "28 September", "Kai"),
        ("design", "Design, 4 Hale St level 3", "3240 Hale Street apartments", "Shared with customer", "ok", "26 September", "Isaac"),
    ]
    tr = "".join(f'<tr><td><div style="display:flex;align-items:center;gap:12px">{ico(i, "ico q")}<span style="font-weight:600">{n}</span></div></td><td class="q">{j}</td><td><span class="{sc}" style="font-weight:500">{s}</span></td><td class="q">{d}</td><td class="lab">{b}</td></tr>' for i, n, j, s, sc, d, b in rows)
    return f'''<div class="app">
{sidebar("documents")}
<main class="main">
  <div class="pagehead">
    <div class="toprow"><h1 class="h24">Documents</h1><span style="flex:1"></span><span class="field" style="width:320px">{ico("search", "ico i16 q")}<span class="q">Search documents</span></span></div>
    <nav class="tabs">{tabs}</nav>
    <div style="display:flex;gap:8px"><span class="filt on">All</span><span class="filt">SWMS</span><span class="filt">Certificates</span><span class="filt">Quotes</span><span class="filt">Letters</span><span class="filt">Handover sheets</span><span class="filt">Designs</span></div>
  </div>
  <div style="padding:8px 32px 0;overflow:hidden">
    <table class="tbl"><thead><tr><th>Document</th><th style="width:280px">Job</th><th style="width:240px">State</th><th style="width:130px">Updated</th><th style="width:80px">By</th></tr></thead><tbody>{tr}</tbody></table>
  </div>
</main>
</div>'''


def templates_body():
    cards = [
        ("shield", "SWMS", "Steps and controls for each kind of work", "Approved 3 September", "ok"),
        ("cert", "Commissioning certificate", "Mechanical compliance wording", "Wording changed, approve it", "warn"),
        ("doc", "Quote", "Notes and payment stages", "In use", "q"),
        ("letter", "Letterhead", "Logo, details, footer and signature", "In use", "q"),
        ("doc", "Handover sheet", "Checks before handing over", "In use", "q"),
        ("letter", "Documents email", "Subject and message when documents are sent", "In use", "q"),
        ("task", "Project checklist", "Sections every new project starts with", "In use", "q"),
    ]
    cs = "".join(f'<a class="card" href="#" style="padding:16px;display:flex;flex-direction:column;gap:8px">{ico(i)}<span class="h16">{t}</span><span class="q">{d}</span><span class="{sc}" style="font-weight:500;margin-top:auto">{s}</span></a>' for i, t, d, s, sc in cards)
    return f'''<div class="app">
{sidebar("documents")}
<main class="main">
  <div class="pagehead">
    <div class="toprow"><h1 class="h24">Documents</h1><span style="flex:1"></span><span class="field" style="width:320px">{ico("search", "ico i16 q")}<span class="q">Search documents</span></span></div>
    <nav class="tabs"><a href="N-Documents.dc.html">All documents</a><a class="on" href="#">Templates</a></nav>
  </div>
  <div style="padding:24px 32px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px">{cs}</div>
</main>
</div>'''


def new_swms_body():
    return f'''<div class="app">
{sidebar("documents")}
<main class="main">
  <div class="pagehead">
    <div class="crumb"><a href="N-Documents.dc.html">Documents</a>{ico("right", "ico i16")}<b>New SWMS</b></div>
    <div class="toprow"><h1 class="h24">New SWMS</h1><span style="flex:1"></span><span class="steps" style="font-size:14px"><span class="on">The work</span><span class="sep"></span><span>How it's done</span><span class="sep"></span><span>Who it covers</span><span class="sep"></span><span>Review</span></span></div>
  </div>
  <div style="flex:1;min-height:0;padding:24px 32px;display:flex;gap:48px">
    <form style="width:560px;display:flex;flex-direction:column;gap:20px">
      <div><span class="flabel">Job</span><div class="field"><span class="sq" style="width:8px;height:8px;background:#6D4FD8"></span>3342 Rifkin, Bellevue Hill<span style="flex:1"></span><span class="xb" style="width:24px;height:24px" aria-label="Clear">{ico("x", "ico i16")}</span></div></div>
      <div><span class="flabel">The work</span><div class="field">Install two split systems, back to back</div></div>
      <div><span class="flabel">Where on site</span><div class="field">Main bedroom, study, side path</div></div>
      <div><span class="flabel">High-risk work</span>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          <label style="display:flex;gap:8px;align-items:center"><span class="tick on"></span>Work at height over 2 m</label>
          <label style="display:flex;gap:8px;align-items:center"><span class="tick on"></span>Electrical work near live parts</label>
          <label style="display:flex;gap:8px;align-items:center"><span class="tick"></span>Confined space</label>
        </div></div>
      <div style="display:flex;gap:8px;margin-top:8px"><span class="btn">Cancel</span><span class="btn ink">Next</span></div>
    </form>
    <aside style="width:360px">
      <h2 class="h16" style="margin-bottom:8px">From the job</h2>
      <p>Tiff filled the work and the site from the quote and Lyle's notes. Check them before you go on.</p>
      <p class="lab q" style="margin-top:12px">Template approved 3 September</p>
    </aside>
  </div>
</main>
</div>'''


def library_body():
    shelves = [("Installation manuals", "86 documents"), ("Service manuals", "41 documents"), ("Specs and data books", "120 documents"), ("Company SOPs", "12 documents"), ("Field notes", "23, 3 to check")]
    sh = "".join(f'<a class="card" href="#" style="padding:16px;display:flex;flex-direction:column;gap:4px">{ico("lib", "ico q")}<span class="h16" style="margin-top:8px">{n}</span><span class="q">{c}</span></a>' for n, c in shelves)
    tools = [("Heat load", "Room size to kW"), ("Running pressures", "Expected and measured"), ("Fault finder", "16 symptoms"), ("Outdoor unit placement", "NSW council check")]
    tl = "".join(f'<a class="card" href="#" style="padding:16px;display:flex;flex-direction:column;gap:4px"><span class="h16">{n}</span><span class="q">{d}</span></a>' for n, d in tools)
    recent = [("Daikin FTXM-R installation manual", "Installation manuals", "Added today"), ("Getting an E6 clear on a Daikin split", "Field notes, Lyle", "Added yesterday"), ("Mitsubishi City Multi data book 2026", "Specs and data books", "Added 8 October")]
    rc = "".join(f'<a class="grp" href="#" style="display:flex;align-items:center;gap:12px;padding:12px 0">{ico("doc", "ico q")}<span style="flex:1;font-weight:600">{t}</span><span class="q" style="width:220px">{s}</span><span class="q" style="width:140px">{d}</span></a>' for t, s, d in recent)
    return f'''<div class="app">
{sidebar("library")}
<main class="main">
  <div class="pagehead">
    <div class="toprow"><h1 class="h24">Library</h1><span class="q" style="margin-top:6px">282 documents</span><span style="flex:1"></span><span class="field" style="width:360px">{ico("search", "ico i16 q")}<span class="q">Search manuals, specs, SOPs and field notes</span></span></div>
  </div>
  <div style="padding:24px 32px;display:flex;flex-direction:column;gap:32px;overflow:hidden">
    <section><h2 class="h16" style="margin-bottom:12px">Shelves</h2><div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px">{sh}</div></section>
    <section><h2 class="h16" style="margin-bottom:12px">Field tools</h2><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px">{tl}</div></section>
    <section><h2 class="h16" style="margin-bottom:4px">Recently added</h2>{rc}</section>
  </div>
</main>
</div>'''


def design_body():
    designs = [("4 Hale St, level 3", "Hale Street apartments, 3240", "Edited today"), ("Heuvel new build, floors 1 and 2", "Heuvel Construction, 3302", "Edited yesterday"), ("Okafor house", "Riverview, 3361", "Edited 9 October"), ("Grange brewhouse cool room", "Grange Microbrewery, 3288", "Edited 7 October"), ("Scott Group office", "Parramatta, 3250", "Edited 30 September"), ("Northgate level 2", "Northgate Realty, 3323", "Edited 28 September")]
    cs = "".join(f'<a class="card" href="#" style="overflow:hidden;display:flex;flex-direction:column"><div style="height:150px;background:#F0F2F5;border-bottom:1px solid rgba(5,5,5,.08);position:relative"><div style="position:absolute;inset:24px 40px;border:2px solid rgba(5,5,5,.18);border-radius:6px"></div><div style="position:absolute;left:40px;right:40px;top:75px;height:2px;background:rgba(5,5,5,.18)"></div><div style="position:absolute;left:50%;top:24px;bottom:24px;width:2px;background:rgba(5,5,5,.18)"></div></div><div style="padding:12px 16px"><div style="font-weight:600">{n}</div><div class="lab q">{c}</div><div class="lab q">{d}</div></div></a>' for n, c, d in designs)
    return f'''<div class="app">
{sidebar("design")}
<main class="main">
  <div class="pagehead">
    <div class="toprow"><h1 class="h24">Design</h1><span class="q" style="margin-top:6px">18 designs</span><span style="flex:1"></span><a class="link lab" href="#">Equipment library</a><span class="field" style="width:300px">{ico("search", "ico i16 q")}<span class="q">Search designs</span></span></div>
  </div>
  <div style="padding:24px 32px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">{cs}</div>
</main>
</div>'''


def team_body():
    people = [("LI", "Lyle Irving", "Senior tech", "Licence runs out in 21 days", "warn", True), ("CA", "Callum Ahn", "Apprentice, 2nd year", "", "", False), ("DW", "Dan Walsh", "Tech", "", "", False), ("KL", "Kai Lee", "Project lead", "On leave, back Thursday", "q", False), ("IS", "Isaac Smith", "Owner", "", "", False), ("MP", "Mia Park", "Office", "Invite sent 9 October", "q", False)]
    pl = "".join(f'<a href="#" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;{"background:rgba(5,5,5,.07)" if sel else ""}"><span class="av" style="background:#F0F2F5;color:#050505">{a}</span><span style="min-width:0;flex:1"><span style="display:block;font-weight:600">{n}</span><span class="lab {sc or "q"}" style="display:block">{s or r}</span></span></a>' for a, n, r, s, sc, sel in people)
    return f'''<div class="app">
{sidebar("team")}
<main class="main">
  <div class="pagehead">
    <div class="toprow"><h1 class="h24">Team</h1><span style="flex:1"></span><span class="field" style="width:280px">{ico("search", "ico i16 q")}<span class="q">Search people</span></span></div>
    <nav class="tabs"><a class="on" href="#">People</a><a href="#">Notices <span class="q">&nbsp;2</span></a><a href="N-TeamTimesheets.dc.html">Timesheets <span class="q">&nbsp;4</span></a><a href="N-TeamLeave.dc.html">Leave <span class="q">&nbsp;1</span></a><a href="N-TeamExpenses.dc.html">Expenses <span class="q">&nbsp;2</span></a><a href="#">Vehicles</a></nav>
  </div>
  <div style="flex:1;min-height:0;display:flex">
    <div style="width:320px;flex:none;padding:12px 12px 0 20px;border-right:1px solid rgba(5,5,5,.08)">{pl}</div>
    <div style="flex:1;min-width:0;padding:24px 32px;display:flex;flex-direction:column;gap:24px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:16px"><span class="av" style="width:56px;height:56px;font-size:16px;background:#E4DDF6;color:#050505">LI</span><div><h2 class="h20">Lyle Irving</h2><p class="q">Senior tech, with us since March 2021</p></div></div>
      <section class="grp" style="padding-top:16px"><div style="display:flex;align-items:center;margin-bottom:12px"><h3 class="h16">Details</h3><span style="flex:1"></span><span class="btn sm">Edit details</span></div>
        <dl class="kv"><dt>Mobile</dt><dd>0413 222 871</dd><dt>Email</dt><dd>lyle@yourbusiness.com.au</dd><dt>Address</dt><dd>14 Carrington St, Marrickville NSW 2204</dd><dt>Employment</dt><dd>Full time, from 8 March 2021</dd><dt>Emergency</dt><dd>Sam Irving, partner, 0414 908 112</dd></dl></section>
      <section class="grp" style="padding-top:16px"><div style="display:flex;align-items:center;margin-bottom:12px"><h3 class="h16">Licences and tickets</h3><span style="flex:1"></span><span class="btn sm">Add a licence</span></div>
        <div style="display:flex;flex-direction:column">
          <div style="display:flex;align-items:center;gap:12px;padding:8px 0"><span style="flex:1;font-weight:600">ARCtick refrigerant handling licence</span><span class="warn" style="font-weight:500;width:220px">Runs out 2 November</span><span class="btn sm">Renew</span></div>
          <div class="grp" style="display:flex;align-items:center;gap:12px;padding:8px 0"><span style="flex:1;font-weight:600">Electrical licence, restricted</span><span class="ok" style="font-weight:500;width:220px">Current to 2027</span><span class="btn sm ghost">Open</span></div>
          <div class="grp" style="display:flex;align-items:center;gap:12px;padding:8px 0"><span style="flex:1;font-weight:600">Working at heights</span><span class="ok" style="font-weight:500;width:220px">Current to May 2026</span><span class="btn sm ghost">Open</span></div>
        </div></section>
      <section class="grp" style="padding-top:16px;display:flex;gap:48px">
        <div><h3 class="h16" style="margin-bottom:4px">Work rights</h3><p class="ok" style="font-weight:500">Citizen, checked 2021</p></div>
        <div><h3 class="h16" style="margin-bottom:4px">Pay</h3><p>Hourly, Xero linked</p></div>
        <div><h3 class="h16" style="margin-bottom:4px">Access</h3><p>Staff, plus Workboard manage</p></div>
      </section>
    </div>
  </div>
</main>
</div>'''


def team_tech_body():
    """Team as a tech sees it: everyone's name, role and how to reach them, and
    Notices. Nothing else of anyone's record leaves the server for them."""
    people = [("LI", "Lyle Irving", "Senior tech", "", True), ("CA", "Callum Ahn", "Apprentice, 2nd year", "", False), ("DW", "Dan Walsh", "Tech", "", False), ("KL", "Kai Lee", "Project lead", "Away, back Thursday", False), ("IS", "Isaac Smith", "Owner", "", False)]
    pl = "".join(f'<a href="#" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;{"background:rgba(5,5,5,.07)" if sel else ""}"><span class="av" style="background:#F0F2F5;color:#050505">{a}</span><span style="min-width:0;flex:1"><span style="display:block;font-weight:600">{n}</span><span class="lab q" style="display:block">{s or r}</span></span></a>' for a, n, r, s, sel in people)
    html = f"""<div class="app">
{sidebar("team")}
<main class="main">
  <div class="pagehead">
    <div class="toprow"><h1 class="h24">Team</h1><span style="flex:1"></span><span class="field" style="width:280px">{ico("search", "ico i16 q")}<span class="q">Search people</span></span></div>
    <nav class="tabs"><a class="on" href="#">People</a><a href="#">Notices <span class="q">&nbsp;2</span></a></nav>
  </div>
  <div style="flex:1;min-height:0;display:flex">
    <div style="width:320px;flex:none;padding:12px 12px 0 20px;border-right:1px solid rgba(5,5,5,.08)">{pl}</div>
    <div style="flex:1;min-width:0;padding:24px 32px;display:flex;flex-direction:column;gap:24px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:16px"><span class="av" style="width:56px;height:56px;font-size:16px;background:#E4DDF6;color:#050505">LI</span><div><h2 class="h20">Lyle Irving</h2><p class="q">Senior tech</p></div></div>
      <section class="grp" style="padding-top:16px"><h3 class="h16" style="margin-bottom:12px">Contact</h3>
        <dl class="kv"><dt>Mobile</dt><dd><a class="link" href="#">0413 222 871</a></dd><dt>Email</dt><dd><a class="link" href="#">lyle@yourbusiness.com.au</a></dd></dl></section>
    </div>
  </div>
</main>
</div>"""
    return html.replace('<span class="av">IS</span>', '<span class="av">DW</span>').replace('Isaac Smith</span><span class="cap">Owner', 'Dan Walsh</span><span class="cap">Tech', 1)


def settings_body():
    groups = [("Yours", ["Sign-in and security", "Emails and alerts"]), ("Company", ["Business", "Licences and insurance", "ServiceM8 and Xero", "Quoting and prices", "Pay and holidays", "Reports"])]
    nav = ""
    for g, items in groups:
        nav += f'<div class="cap" style="padding:16px 12px 4px">{g}</div>'
        nav += "".join(f'<a class="srow{" on" if i == "Business" else ""}" href="{"N-SettingsPay.dc.html" if i == "Pay and holidays" else "#"}" style="height:36px">{i}</a>' for i in items)
    return f'''<div class="app">
{sidebar("")}
<main class="main">
  <div class="pagehead"><div class="toprow"><h1 class="h24">Settings</h1></div></div>
  <div style="flex:1;min-height:0;display:flex;padding:16px 32px 0">
    <nav style="width:240px;flex:none;padding-right:24px">{nav}</nav>
    <div style="flex:1;min-width:0;max-width:720px;display:flex;flex-direction:column;gap:24px">
      <section><h2 class="h20">Business</h2></section>
      <section class="grp" style="padding-top:16px;display:flex;align-items:center;gap:16px"><div style="width:120px;height:56px;border:1px dashed rgba(5,5,5,.2);border-radius:10px;display:grid;place-items:center" class="lab q">Your logo</div><span class="btn sm">Replace logo</span><span style="flex:1"></span><span class="lab">Document colour</span><span style="width:24px;height:24px;border-radius:6px;background:#1E3A5F"></span></section>
      <section class="grp" style="padding-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><span class="flabel">Trading name</span><div class="field">[Your business]</div></div>
        <div><span class="flabel">Legal name</span><div class="field">[Your business] Pty Ltd</div></div>
        <div><span class="flabel">ABN</span><div class="field num">51 824 753 556</div></div>
        <div><span class="flabel">GST</span><div class="field">Registered</div></div>
        <div><span class="flabel">Phone</span><div class="field">02 9555 0140</div></div>
        <div><span class="flabel">Email</span><div class="field">office@yourbusiness.com.au</div></div>
        <div style="grid-column:1 / span 2"><span class="flabel">Address</span><div class="field">22 Parramatta Rd, Annandale NSW 2038</div></div>
      </section>
      <div style="display:flex;gap:8px"><span class="btn ink">Save</span></div>
    </div>
  </div>
</main>
</div>'''


def convos_body():
    items = [("Bellevue Hill wrap-up and isolator", "Today 10:20 am", True), ("Riverview brief", "Today 8:40 am", False), ("Hilux and the head for Lyle", "Today 8:12 am", False), ("Lyle asked: fans for Rozelle", "Mention, 7:40 am", False), ("Clearing an E6 on a Daikin split", "Yesterday", False), ("Christmas shutdown", "Team notice, Friday", False), ("Who's free Thursday", "Friday", False)]
    li = "".join(f'<a href="#" style="display:block;padding:10px 12px;border-radius:10px;{"background:rgba(5,5,5,.07)" if s else ""}"><span style="display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{t}</span><span class="lab q">{d}</span></a>' for t, d, s in items)
    return f'''<div class="app">
{sidebar("conversations")}
<main class="main" style="flex-direction:row">
  <div style="width:340px;flex:none;border-right:1px solid rgba(5,5,5,.08);display:flex;flex-direction:column">
    <div style="padding:24px 20px 12px"><h1 class="h24">Conversations</h1></div>
    <div style="display:flex;gap:8px;padding:0 20px 12px;flex-wrap:wrap"><span class="filt on">All</span><span class="filt">Mentions</span><span class="filt">Team</span><span class="filt">Only me</span></div>
    <div style="padding:0 8px">{li}</div>
  </div>
  <section style="flex:1;min-width:0;display:flex;flex-direction:column">
    <div style="flex:1;overflow:hidden;padding:32px 48px;display:flex;flex-direction:column;gap:24px;max-width:860px">
      <div style="display:flex;gap:12px"><span class="av">IS</span><div style="display:flex;flex-direction:column;gap:4px"><div class="lab"><b>You</b> <span class="q">10:20 am, spoken, on 3342</span></div><p class="read">Lyle's finished the study head. Customer wants an extra isolator on the deck, quote it. And book Northgate in for Thursday with Kai.</p></div></div>
      <div style="display:flex;gap:12px"><span class="av" style="background:#fff;border:1px solid rgba(5,5,5,.14)">{"<svg width='18' height='18' viewBox='0 0 100 100' aria-hidden='true'><path d='M22 24 L40 24 L62 50 L40 76 L22 76 L44 50 Z' fill='none' stroke='#050505' stroke-width='10' stroke-linejoin='round'></path></svg>"}</span><div style="display:flex;flex-direction:column;gap:8px;min-width:0"><div class="lab"><b>Tiff</b></div><p class="read">Done. Noted on 3342, the isolator is drafted as a variation for you to check, and Northgate is held for Thursday with Kai. Book it in ServiceM8?</p>
        <div class="card" style="padding:12px 16px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:12px">{ico("check", "ico i16 ok")}<span style="flex:1">Note on 3342 Rifkin</span><a class="link lab" href="N-Job.dc.html">Open</a></div>
          <div class="grp" style="display:flex;align-items:center;gap:12px;padding-top:8px">{ico("check", "ico i16 ok")}<span style="flex:1">Variation drafted on the quote</span><a class="link lab" href="N-Quote.dc.html">Check it</a></div>
          <div class="grp" style="display:flex;align-items:center;gap:12px;padding-top:8px">{ico("clock", "ico i16 warn")}<span style="flex:1">Northgate 3323, Thursday, Kai</span><span class="btn sm ink">Book it</span></div>
        </div>
        <div style="display:flex;gap:16px" class="lab"><a class="link" href="#">Undo all</a></div>
      </div></div>
    </div>
    <div style="padding:0 48px 24px;max-width:860px">{box("Reply to Tiff", None, big=False)}</div>
  </section>
</main>
</div>'''


def you_menu():
    items = [("person", "Your card"), ("clock", "Timesheet"), ("sun", "Leave"), ("receipt", "Expenses"), ("truck", "Vehicle"), ("pin", "Notes")]
    a = "".join(f'<a class="mitem" href="{"N-Timesheet.dc.html" if n == "Timesheet" else "#"}">{ico(i)}{n}</a>' for i, n in items)
    b = "".join(f'<a class="mitem" href="{"N-Settings.dc.html" if n == "Settings" else "#"}">{ico(i)}{n}</a>' for i, n in [("dollar", "Reports"), ("gear", "Settings")])
    return f'''<div class="overlay" role="menu" aria-label="Your menu" style="position:absolute;left:8px;bottom:64px;width:248px;padding:8px;z-index:100">
  <div style="padding:8px 12px 8px"><div style="font-weight:600">Isaac Smith</div><div class="lab q">isaac@yourbusiness.com.au</div></div>
  <div class="grp" style="padding-top:4px">{a}</div>
  <div class="grp" style="padding-top:4px;margin-top:4px">{b}</div>
  <div class="grp" style="padding-top:4px;margin-top:4px"><a class="mitem" href="#">Help</a><a class="mitem" href="#">Sign out</a></div>
</div>'''


def timesheet_body():
    days = [("Mon 5", "7:00–3:30", "8.0", "Worked", ""), ("Tue 6", "7:00–4:00", "8.5", "Worked", "0.5 at 1.5"), ("Wed 7", "7:00–3:30", "8.0", "Worked", ""), ("Thu 8", "6:30–5:00", "10.0", "Worked", "2.0 at 1.5"), ("Fri 9", "7:00–3:30", "8.0", "Worked", ""), ("Mon 12", "7:00–", "", "Today", "")]
    rows = "".join(f'<tr{" class=sel" if d.startswith("Mon 12") else ""}><td style="font-weight:600">{d}</td><td class="num">{t}</td><td class="num" style="text-align:right">{h}</td><td class="q">{o}</td><td><span class="{"ok" if s == "Worked" else "info"}" style="font-weight:500">{s}</span></td></tr>' for d, t, h, s, o in days)
    return f'''<div class="app">
{sidebar("")}
<main class="main">
  <div class="pagehead">
    <div class="crumb"><span>Isaac Smith</span>{ico("right", "ico i16")}<b>Timesheet</b></div>
    <div class="toprow"><h1 class="h24">Timesheet</h1><span style="flex:1"></span><span class="xb" aria-label="Previous fortnight">{ico("left")}</span><span style="font-weight:600">5 to 18 October</span><span class="xb" aria-label="Next fortnight">{ico("right")}</span></div>
  </div>
  <div style="flex:1;min-height:0;display:flex;gap:32px;padding:16px 32px">
    <div style="flex:1;min-width:0">
      <table class="tbl"><thead><tr><th style="width:120px">Day</th><th style="width:160px">Hours</th><th style="width:80px;text-align:right">Total</th><th>Overtime</th><th style="width:120px">State</th></tr></thead><tbody>{rows}</tbody></table>
      <p class="lab q" style="padding:12px 0">42.5 hours so far, 2.5 at time and a half. Sends itself Sunday 6 pm.</p>
    </div>
    <aside class="card" style="width:380px;flex:none;padding:16px;display:flex;flex-direction:column;gap:16px;align-self:flex-start">
      <div style="display:flex;align-items:center"><h2 class="h16">Monday 12 October</h2><span style="flex:1"></span><span class="seg"><span class="on">Worked</span><span>Off</span></span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><span class="flabel">Start</span><div class="field num">7:00 am</div></div><div><span class="flabel">Finish</span><div class="field num">3:30 pm</div></div><div><span class="flabel">Break</span><div class="field num">30 min</div></div><div><span class="flabel">Total</span><div class="field num" style="background:#F0F2F5">8.0 h</div></div></div>
      <div style="display:flex;gap:8px"><span class="btn">Cancel</span><span class="btn ink">Save day</span></div>
    </aside>
  </div>
</main>
</div>'''


def project_page():
    tabs = ["Overview", "Notes", "Quote", "Visits", "Checklist", "Photos", "Documents", "Billing", "Contacts"]
    th = "".join(f'<a class="{"on" if t == "Overview" else ""}" href="#">{t}</a>' for t in tabs)
    steps = [("Quoted", "dn"), ("Approved", "dn"), ("Pre-install", "dn"), ("Rough-in", "on"), ("Fit-off", ""), ("Commission", ""), ("Handover", ""), ("Paid", "")]
    st = '<span class="sep"></span>'.join(f'<span class="{c}">{n}</span>' for n, c in steps)
    notes = [
        ("KL", "#E4DDF6", "Kai Lee", "11:20 am", "Rough-in done on level 1. Two penetrations to seal Monday before the plasterers start."),
        ("DW", "#DCE8DD", "Dan Walsh", "Yesterday 4:05 pm", "Builder wants the condensate drains moved to the north wall on level 2. Variation drafted."),
    ]
    nt = "".join(
        f'<article class="grp" style="display:flex;gap:12px;padding:16px 0"><span class="av" style="background:{bg};color:#050505">{a}</span><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><div class="lab"><b>{n}</b> <span class="q">{t}</span></div><p class="read">{x}</p></div></article>'
        for a, bg, n, t, x in notes)
    def row(icon, name, state, cls, href="#"):
        return f'<a class="grp" href="{href}" style="display:flex;align-items:center;gap:12px;padding:10px 0">{ico(icon, "ico q")}<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{name}</span><span class="{cls}" style="font-weight:500;white-space:nowrap">{state}</span></a>'
    return f'''<div class="app">
{sidebar("jobs")}
<main class="main">
  <div class="pagehead">
    <div class="crumb"><a href="N-Jobs.dc.html">Jobs</a>{ico("right", "ico i16")}<b>3302</b></div>
    <div class="toprow" style="align-items:flex-start">
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0"><h1 class="h24">Heuvel Construction</h1><p class="q">Job 3302, Project, 18 Albert Ave, Chatswood. <span class="ok" style="font-weight:600">Rough-in, day 2 of 3</span></p></div>
      <span style="flex:1"></span><a class="btn" href="#">Open in ServiceM8</a><span class="btn">Actions {ico("down", "ico i16")}</span>
    </div>
    <div class="steps">{st}</div>
    <nav class="tabs">{th}</nav>
  </div>
  <div style="flex:1;min-height:0;display:flex;gap:32px;padding:24px 32px;overflow:hidden">
    <section style="flex:1;min-width:0;display:flex;flex-direction:column">
      <div class="card" style="border-color:rgba(5,5,5,.14);padding:12px 12px 12px 16px">
        <div class="read q" style="min-height:48px">Write a note on this job</div>
        <div style="display:flex;align-items:center;gap:8px"><span class="mic" aria-label="Dictate">{ico("mic", "ico i16")}</span><span class="filt" style="height:28px">Kind: Note {ico("down", "ico i16")}</span><label class="lab" style="display:inline-flex;align-items:center;gap:8px;margin-left:4px"><span class="tick on"></span>Also in ServiceM8</label><span style="flex:1"></span><span class="btn sm ink">Save note</span></div>
      </div>
      <div style="display:flex;align-items:baseline;gap:12px;padding:24px 0 4px"><h2 class="h16">Notes</h2><span class="q">41 on this job</span><span style="flex:1"></span><a class="link lab" href="#">All notes</a></div>
      {nt}
    </section>
    <aside style="width:380px;flex:none;display:flex;flex-direction:column;gap:20px">
      <section><h2 class="h16" style="margin-bottom:8px">Where it's up to</h2><p>Level 1 roughed in; level 2 tomorrow. Fit-off visit 3 is around 20 October, with the crane booked.</p></section>
      <section>
        <div style="display:flex;align-items:baseline;margin-bottom:4px"><h2 class="h16">Dates</h2><span style="flex:1"></span><span class="btn sm">Edit</span></div>
        <dl class="kv" style="grid-template-columns:150px minmax(0,1fr);gap:4px 16px"><dt>Promised finish</dt><dd>Friday 20 November</dd><dt>Crane booked</dt><dd>Tuesday 27 October</dd><dt>Defects period ends</dt><dd>20 February 2027</dd><dt>Hours</dt><dd>96 of 160 used</dd></dl>
      </section>
      <section>
        <h2 class="h16" style="margin-bottom:4px">Linked jobs</h2>
        <div style="display:flex;flex-direction:column">
          {row("jobs", "3301, the quote", "Accepted", "ok")}
          {row("jobs", "3315, variation: drains to the north wall", "Drafted", "warn")}
        </div>
      </section>
      <section>
        <h2 class="h16" style="margin-bottom:4px">Documents on this job</h2>
        <div style="display:flex;flex-direction:column">
          {row("shield", "SWMS, Heuvel roof work", "All signed on", "ok", "N-Documents.dc.html")}
          {row("doc", "Handover sheet", "At Handover", "q")}
        </div>
      </section>
    </aside>
  </div>
</main>
</div>'''


def build(out):
    css = DAYBAR_CSS + EXTRA
    out["N-New.dc.html"] = page("New, over a job", 1440, 900, css, job_page(job_overview(), overlay=new_menu()))
    out["N-Jobs.dc.html"] = page("Jobs", 1440, 900, css, jobs_body())
    out["N-Job.dc.html"] = page("A job", 1440, 900, css, job_page(job_overview()))
    out["N-Project.dc.html"] = page("A project job", 1440, 900, css, project_page())
    out["N-Quote.dc.html"] = page("A job's quote", 1440, 900, css, job_page(quote_body(), tab="Quote"))
    out["N-Schedule.dc.html"] = page("Schedule", 1440, 900, css, schedule_body())
    out["N-Documents.dc.html"] = page("Documents", 1440, 900, css, documents_body())
    out["N-Templates.dc.html"] = page("Templates", 1440, 900, css, templates_body())
    out["N-NewSWMS.dc.html"] = page("New SWMS", 1440, 900, css, new_swms_body())
    out["N-Library.dc.html"] = page("Library", 1440, 900, css, library_body())
    out["N-Design.dc.html"] = page("Design", 1440, 900, css, design_body())
    out["N-Team.dc.html"] = page("Team", 1440, 900, css, team_body())
    out["N-TeamTech.dc.html"] = page("Team, as a tech sees it", 1440, 900, css, team_tech_body())
    out["N-Settings.dc.html"] = page("Settings", 1440, 900, css, settings_body())
    out["N-Convos.dc.html"] = page("Conversations", 1440, 900, css, convos_body())
    out["N-You.dc.html"] = page("Your menu", 1440, 900, css, home_body().replace("</main>\n</div>", "</main>\n" + you_menu() + "\n</div>"))
    out["N-Timesheet.dc.html"] = page("Your timesheet", 1440, 900, css, timesheet_body())
