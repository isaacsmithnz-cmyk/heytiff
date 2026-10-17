from base import ico, page, MARK
from boards_home import DAYBAR_CSS

MCSS = DAYBAR_CSS + """
.ph{width:390px;height:844px;overflow:hidden;position:relative;display:flex;flex-direction:column;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#050505;background:#fff;font-size:14px;line-height:20px;-webkit-font-smoothing:antialiased}
.ph *{box-sizing:border-box}
.ph a{color:inherit;text-decoration:none}
.ph p{margin:0}
.ph .link{text-decoration:underline;text-underline-offset:3px;font-weight:500}
.mtop{height:56px;flex:none;display:flex;align-items:center;gap:8px;padding:0 8px 0 4px}
.ib{width:44px;height:44px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex:none}
.mbtn{height:40px;padding:0 14px;border-radius:10px;border:1px solid rgba(5,5,5,.14);font-weight:600;display:inline-flex;align-items:center;gap:8px;background:#fff;white-space:nowrap}
.mbtn.ink{background:#050505;color:#fff;border-color:#050505}
.dock{position:absolute;left:0;right:0;bottom:0;padding:8px 12px 24px;background:#fff;border-top:1px solid rgba(5,5,5,.08)}
.mrow{display:flex;align-items:center;gap:12px;padding:12px 16px}
.mtabs{display:flex;gap:20px;padding:0 16px;border-bottom:1px solid rgba(5,5,5,.08);white-space:nowrap;overflow:hidden}
.mtabs a{height:44px;display:inline-flex;align-items:center;font-weight:500;color:#5f6a79;border-bottom:2px solid transparent;margin-bottom:-1px}
.mtabs a.on{color:#050505;border-color:#050505;font-weight:600}
.sheet{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:16px 16px 0 0;box-shadow:0 12px 32px rgba(10,12,20,.16);padding:8px 16px 24px}
.grab{width:40px;height:4px;border-radius:999px;background:rgba(5,5,5,.2);margin:4px auto 12px}
"""


def mtop(title="", right="new"):
    r = '<a class="mbtn ink" href="M-New.dc.html" style="height:36px">' + ico("plus", "ico i16") + 'New</a>' if right == "new" else right
    return f'<header class="mtop"><a class="ib" href="#" aria-label="Menu">{ico("menu")}</a><span style="flex:1;display:flex;align-items:center;gap:8px;font-weight:700">{title}</span>{r}</header>'


def mbox(ph="What's happening on site?"):
    return f'''<div class="card" style="border:1px solid rgba(5,5,5,.14);border-radius:16px;padding:12px">
  <div class="read q" style="font-size:16px;line-height:24px;min-height:28px">{ph}</div>
  <div style="display:flex;align-items:center;gap:8px;margin-top:8px"><span class="mbtn">{ico("camera", "ico i16")}Photo</span><span class="ib" style="width:40px;height:40px;border:1px solid rgba(5,5,5,.14);border-radius:50%" aria-label="Talk to Tiff">{ico("mic", "ico i16")}</span><span style="flex:1"></span><span class="mbtn ink">Send</span></div>
</div>'''


def m_home():
    needs = [("bad", "#e0264f", "Hilux XQG 41B rego", "Runs out today", "Renew"), ("", "#F0A431", "Kingsford Bakery, 2380", "Ready to invoice", "Invoice"), ("", "#2554d8", "Quote to write: Riverview", "Brief saved 8:40 am", "Quote"), ("", "#050505", "Northgate Realty, 3323", "Won 3 days ago, no day yet", "Book in")]
    nr = "".join(f'<div class="mrow" style="padding:10px 16px"><span style="width:8px;height:8px;border-radius:50%;background:{c};flex:none;margin:0 5px"></span><div style="flex:1;min-width:0"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{t}</div><div class="lab {k or "q"}" style="font-size:13px">{s}</div></div><span class="mbtn" style="height:36px;font-size:13px">{v}</span></div>' for k, c, t, s, v in needs)
    return f'''<div class="ph">
{mtop(MARK + "HeyTiff")}
<div style="flex:1;min-height:0;overflow:hidden;padding-bottom:150px">
  <div style="padding:8px 16px 16px"><h1 style="font-size:24px;line-height:32px;font-weight:600;margin:0">Morning, Isaac</h1><p class="q">Monday 12 October. 4 jobs and a task.</p></div>
  <div style="overflow:hidden;padding:0 16px"><div class="row5" style="width:640px">
    <a class="dcard sel" href="#" style="flex:0 0 200px;color:#fff"><span class="dskin" style="background:#6D4FD8"><span class="dfill" style="width:56%;background:#291E52"></span><span class="dring"></span></span><span class="dlab"><span class="dtag">Bellevue Hill</span><span style="display:flex;flex-direction:column"><span class="dname">Job 3342</span><span class="dtime">9:00–11:30</span></span></span></a>
    <a class="dcard" href="#" style="flex:0 0 140px;color:#2a3342"><span class="dskin" style="background:#E6E9EE"></span><span class="dlab"><span class="dtag">Task</span><span style="display:flex;flex-direction:column"><span class="dname">Order the grilles</span><span class="dtime">By 12:30</span></span></span></a>
    <a class="dcard" href="#" style="flex:0 0 120px;color:#fff"><span class="dskin" style="background:#3D8620"></span><span class="dlab"><span class="dtag">Alexandria</span><span style="display:flex;flex-direction:column"><span class="dname">Job 1042</span><span class="dtime">12:45</span></span></span></a>
  </div></div>
  <a href="M-Job.dc.html" class="mbtn" style="margin:12px 16px 0;width:calc(100% - 32px);justify-content:center">Open job 3342</a>
  <div style="display:flex;align-items:center;padding:24px 16px 4px"><h2 class="h16" style="font-size:16px;line-height:24px;margin:0">To do</h2><span class="q" style="margin-left:8px">9</span><span style="flex:1"></span><a class="link" href="#">All</a></div>
  {nr}
</div>
<div class="dock">{mbox()}</div>
</div>'''


def m_new():
    top = [("jobs", "Job"), ("dollar", "Quote"), ("task", "Task"), ("cal", "Event"), ("receipt", "Expense"), ("sun", "Leave")]
    row = lambda i, n, more=False: f'<a href="#" style="display:flex;align-items:center;gap:12px;height:48px;padding:0 12px;border-radius:10px;font-size:16px;font-weight:500">{ico(i, "ico q")}{n}{ico("right", "ico i16", "margin-left:auto;color:#5f6a79") if more else ""}</a>'
    it = "".join(row(i, n) for i, n in top)
    return f'''<div class="ph">
{mtop("Rifkin, Julian", right='<span class="ib"></span>')}
<div style="padding:0 16px" class="q">Job 3342, Install</div>
<div style="position:absolute;inset:0;background:rgba(10,11,16,.45)"></div>
<div class="sheet">
  <div class="grab"></div>
  <div style="display:flex;align-items:center;margin-bottom:4px"><h2 style="font-size:20px;line-height:28px;font-weight:600;margin:0">New</h2><span style="flex:1"></span><span class="ib" aria-label="Close">{ico("x")}</span></div>
  <div style="display:flex;align-items:center;gap:8px;height:44px;padding:0 4px 0 12px"><span style="width:8px;height:8px;background:#6D4FD8;flex:none"></span><span style="flex:1;font-size:13px;font-weight:500">For 3342 Rifkin, Bellevue Hill</span><span class="ib" style="width:40px;height:40px" aria-label="Not for this job">{ico("x", "ico i16")}</span></div>
  <div style="border-top:1px solid rgba(5,5,5,.08);padding-top:4px">{it}</div>
  <div style="border-top:1px solid rgba(5,5,5,.08);padding-top:4px;margin-top:4px">{row("doc", "Document", True)}{row("dots", "More", True)}</div>
</div>
</div>'''


def m_job():
    notes = [("LI", "#E4DDF6", "Lyle Irving", "10:02 am", "Study head mounted and levelled. Running the pipe through the robe now."), ("IS", "#050505", "You", "8:12 am", "Lyle needs the Bellevue Hill head on the ute.")]
    nt = "".join(f'<div style="display:flex;gap:12px;padding:12px 16px;border-top:1px solid rgba(5,5,5,.08)"><span class="av" style="width:32px;height:32px;border-radius:50%;background:{bg};color:{"#fff" if bg == "#050505" else "#050505"};font-size:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex:none">{a}</span><div><div style="font-size:13px;font-weight:500"><b>{n}</b> <span class="q">{t}</span></div><p style="font-size:16px;line-height:24px">{x}</p></div></div>' for a, bg, n, t, x in notes)
    return f'''<div class="ph">
<header class="mtop"><a class="ib" href="M-Home.dc.html" aria-label="Back">{ico("left")}</a><span style="flex:1;font-weight:600">Jobs</span><a class="mbtn ink" href="M-New.dc.html" style="height:36px">{ico("plus", "ico i16")}New</a></header>
<div style="padding:0 16px 12px"><h1 style="font-size:24px;line-height:32px;font-weight:600;margin:0">Rifkin, Julian</h1><p class="q">Job 3342, Install, Bellevue Hill. <span class="ok" style="font-weight:600">On site</span></p></div>
<nav class="mtabs"><a class="on">Overview</a><a>Notes</a><a>Quote</a><a>Visits</a><a>Checklist</a><a>Photos</a></nav>
<div style="padding:16px">
  <div style="border:1px solid rgba(5,5,5,.14);border-radius:16px;padding:12px">
    <div class="q" style="font-size:16px;line-height:24px;min-height:28px">Write a note on this job</div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:8px"><span class="ib" style="width:40px;height:40px;border:1px solid rgba(5,5,5,.14);border-radius:50%" aria-label="Dictate">{ico("mic", "ico i16")}</span><span style="flex:1"></span><span class="mbtn ink">Save note</span></div>
  </div>
</div>
<div style="padding:0 16px 8px;display:flex;align-items:center;gap:12px"><span style="font-weight:600;flex:1">Check in on site</span><span class="mbtn">Check in</span></div>
{nt}
</div>'''


def m_timesheet():
    this = [("Mon 12", "7:00 to now", "On now"), ("Tue 13", "Not yet", ""), ("Wed 14", "Not yet", ""), ("Thu 15", "Not yet", ""), ("Fri 16", "Not yet", "")]
    rows = "".join(f'<div class="mrow" style="border-top:1px solid rgba(5,5,5,.08)"><span style="font-weight:600;width:72px">{d}</span><span style="flex:1" class="{"" if s else "q"}">{t}</span><span class="ok" style="font-weight:600">{s}</span></div>' for d, t, s in this)
    return f'''<div class="ph">
<header class="mtop"><a class="ib" href="#" aria-label="Menu">{ico("menu")}</a><span style="flex:1;font-weight:600">Timesheet</span></header>
<div style="padding:0 16px 12px"><h1 style="font-size:24px;line-height:32px;font-weight:600;margin:0">12 to 18 October</h1><p class="q">This week. Sends itself Sunday 6:00 pm.</p></div>
{rows}
<div class="mrow" style="border-top:1px solid rgba(5,5,5,.08)"><span style="font-weight:600;flex:1">Last week</span><span class="info" style="font-weight:500">Sent</span></div>
<div style="position:absolute;inset:0;background:rgba(10,11,16,.45)"></div>
<div class="sheet">
  <div class="grab"></div>
  <div style="display:flex;align-items:center;margin-bottom:16px"><h2 style="font-size:20px;line-height:28px;font-weight:600;margin:0">Monday 12 October</h2><span style="flex:1"></span><span class="seg" style="display:inline-flex;gap:2px;padding:2px;border-radius:10px;background:#F0F2F5"><span style="height:36px;padding:0 14px;border-radius:8px;display:inline-flex;align-items:center;background:#fff;font-weight:600;box-shadow:0 0 0 1px rgba(5,5,5,.08)">Worked</span><span style="height:36px;padding:0 14px;display:inline-flex;align-items:center;color:#5f6a79">Off</span></span></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div><span style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">Start</span><div style="height:44px;border:1px solid rgba(5,5,5,.14);border-radius:6px;display:flex;align-items:center;padding:0 12px">7:00 am</div></div>
    <div><span style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">Finish</span><div style="height:44px;border:1px solid rgba(5,5,5,.14);border-radius:6px;display:flex;align-items:center;padding:0 12px">3:30 pm</div></div>
    <div><span style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">Break</span><div style="height:44px;border:1px solid rgba(5,5,5,.14);border-radius:6px;display:flex;align-items:center;padding:0 12px">30 min</div></div>
    <div><span style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">Total</span><div style="height:44px;border-radius:6px;display:flex;align-items:center;padding:0 12px;background:#F0F2F5">8.0 h</div></div>
  </div>
  <span class="mbtn ink" style="width:100%;justify-content:center;margin-top:16px;height:48px">Save day</span>
</div>
</div>'''


def build(out):
    out["M-Home.dc.html"] = page("Home on a phone", 390, 844, MCSS, m_home())
    out["M-New.dc.html"] = page("New on a phone", 390, 844, MCSS, m_new())
    out["M-Job.dc.html"] = page("A job on a phone", 390, 844, MCSS, m_job())
    out["M-Timesheet.dc.html"] = page("Timesheet on a phone", 390, 844, MCSS, m_timesheet())
