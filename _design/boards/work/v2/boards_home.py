from base import ico, sidebar, page

DAYBAR_CSS = """
.row5{display:flex;gap:4px;height:88px}
.dcard{position:relative;display:block;min-width:0;border-radius:10px;overflow:hidden}
.dskin{position:absolute;inset:0}
.dfill{position:absolute;top:0;bottom:0;left:0}
.dring{position:absolute;inset:0;border-radius:10px;box-shadow:inset 0 0 0 3px #050505}
.dlab{position:absolute;inset:0;padding:8px 12px 12px;display:flex;flex-direction:column;justify-content:space-between;white-space:nowrap}
.dlab span{overflow:hidden;text-overflow:ellipsis}
.dtag{font-size:12px;line-height:16px;font-weight:600}
.dname{font-size:14px;line-height:20px;font-weight:700}
.sel .dname{font-size:16px;line-height:24px}
.dtime{font-size:13px;line-height:18px;font-weight:600}
.dtick{position:absolute;right:8px;top:8px;width:18px;height:18px;border-radius:50%;background:#196B2D;color:#fff;display:grid;place-items:center}
.done .dtag{padding-right:24px}
.pan{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;padding:16px;border-radius:16px;color:#fff}
.pfacts{display:flex;flex-wrap:wrap;gap:4px 24px;font-size:13px;line-height:18px}
.pfacts b{font-weight:700;margin-right:4px}
"""


def daybar():
    tick = f'<span class="dtick">{ico("check", "ico", "width:12px;height:12px;stroke-width:3")}</span>'
    return f'''<div class="row5">
  <a class="dcard done" href="#" style="flex:112 1 0;color:#43506a" aria-label="Kingsford, Job 2380, 7:30 to 8:30, finished"><span class="dskin" style="background:#B4C5EE"></span><span class="dlab"><span class="dtag">Kingsford</span><span style="display:flex;flex-direction:column"><span class="dname">Job 2380</span><span class="dtime">7:30–8:30</span></span></span>{tick}</a>
  <a class="dcard sel" href="#" style="flex:230 1 0;color:#fff" aria-label="Bellevue Hill, Job 3342, 9:00 to 11:30, on now, 56%"><span class="dskin" style="background:#6D4FD8"><span class="dfill" style="width:56%;background:#291E52"></span><span class="dring"></span></span><span class="dlab"><span class="dtag">Bellevue Hill</span><span style="display:flex;flex-direction:column"><span class="dname">Job 3342</span><span class="dtime">9:00–11:30</span></span></span></a>
  <a class="dcard" href="#" style="flex:150 1 0;color:#2a3342" aria-label="Task, order the grilles, by 12:30"><span class="dskin" style="background:#E6E9EE"></span><span class="dlab"><span class="dtag">Task</span><span style="display:flex;flex-direction:column"><span class="dname">Order the grilles</span><span class="dtime">By 12:30</span></span></span></a>
  <a class="dcard" href="#" style="flex:112 1 0;color:#fff" aria-label="Alexandria, Job 1042"><span class="dskin" style="background:#3D8620"></span><span class="dlab"><span class="dtag">Alexandria</span><span style="display:flex;flex-direction:column"><span class="dname">Job 1042</span><span class="dtime">12:45–1:45</span></span></span></a>
  <a class="dcard" href="#" style="flex:140 1 0;color:#fff" aria-label="Randwick, Job 3271"><span class="dskin" style="background:#8A6A00"></span><span class="dlab"><span class="dtag">Randwick</span><span style="display:flex;flex-direction:column"><span class="dname">Job 3271</span><span class="dtime">2:45–4:00</span></span></span></a>
</div>'''


def box(placeholder="What's happening on site?", context=None, big=True):
    ctx = ""
    if context:
        ctx = f'<span class="filt" style="height:28px;padding:0 4px 0 10px;gap:4px"><span class="sq" style="width:8px;height:8px;background:{context[1]}"></span>{context[0]}<span class="xb" style="width:24px;height:24px" aria-label="Not for this job">{ico("x", "ico", "width:14px;height:14px")}</span></span>'
    return f'''<div class="card" style="border-color:rgba(5,5,5,.14);padding:16px 16px 12px">
  <div class="read q" style="min-height:{56 if big else 40}px">{placeholder}</div>
  <div style="display:flex;align-items:center;gap:8px">
    <span class="btn sm">{ico("camera", "ico i16")}Add photo</span>
    <span class="mic" aria-label="Talk to Tiff">{ico("mic", "ico i16")}</span>
    <span style="flex:1"></span>{ctx}
    <span class="btn sm ink">Send</span>
  </div>
</div>'''


def needs_panel():
    def row(kind, title, sub, verb=None, dot=None, href="#"):
        lead = '<span class="tick"></span>' if kind == "task" else f'<span class="dot" style="background:{dot};margin:0 5px"></span>'
        v = f'<a class="btn sm" href="{href}">{verb}</a>' if verb else ""
        return f'<div style="display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:10px">{lead}<div style="min-width:0;flex:1"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{title}</div><div class="lab q">{sub}</div></div>{v}</div>'

    def grp(title, n, cls=""):
        return f'<div style="display:flex;align-items:baseline;gap:8px;padding:16px 12px 4px"><span class="lab {cls}" style="font-weight:600">{title}</span><span class="lab q">{n}</span></div>'

    return f'''<aside style="width:360px;flex:none;border-left:1px solid rgba(5,5,5,.08);display:flex;flex-direction:column" id="needs" aria-label="To do">
  <div style="display:flex;align-items:center;gap:8px;padding:16px 16px 12px 24px"><h2 class="h16">To do</h2><span style="flex:1"></span><span class="seg"><span class="on">Mine</span><span>Everyone's</span></span></div>
  <div style="flex:1;min-height:0;overflow:hidden;padding:0 8px">
    {grp("Late", 2, "bad")}
    {row("task", "Chase the Daikin warranty claim", "Due Friday 9 October")}
    {row("dot", "Hilux XQG 41B rego", "Runs out today", "Renew", "#e0264f", "N-Team.dc.html")}
    {grp("Today", 4)}
    {row("task", "Ring the Hilux dealer", "From your 8:12 am note")}
    {row("dot", "Kingsford Bakery, 2380", "Finished, ready to invoice", "Invoice", "#F0A431", "N-Job.dc.html")}
    {row("dot", "Timesheets, last week", "4 to approve, 150.5 hours", "Review", "#F0A431", "N-TeamTimesheets.dc.html")}
    {row("dot", "Quote to write: Riverview", "Brief saved 8:40 am", "Quote", "#2554d8", "N-Quote.dc.html")}
    {grp("Jobs to book", 17)}
    {row("dot", "Northgate Realty, 3323", "Won 3 days ago, no day yet", "Book in", "#050505", "N-Job.dc.html")}
    {row("dot", "Ardex Logistics, 2601", "Service due today", "Book in", "#050505", "N-Schedule.dc.html")}
    {row("dot", "15 more", "Oldest won 14 September", "Show all", "#b6bcc6", "N-Jobs.dc.html")}
    {grp("Later", 3)}
    {row("dot", "Kingsford Medical Centre", "Service, Thursday 15 October", None, "#b6bcc6")}
    {row("task", "Order 2 MERV 11 filters", "For Meridian Data, by Monday 19 October")}
  </div>
  <div style="display:flex;align-items:center;gap:8px;padding:12px 24px;border-top:1px solid rgba(5,5,5,.08)" class="lab">{ico("check", "ico i16 ok")}<span class="q">Done today</span><b>4</b><span style="flex:1"></span><a class="link" href="#">Show</a></div>
</aside>'''


def home_body(extra_overlay=""):
    return f'''<div class="app">
{sidebar("home")}
<main class="main" style="flex-direction:row">
  <section style="flex:1;min-width:0;overflow:hidden;padding:48px 48px 24px">
    <div style="max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:24px">
      <div style="text-align:center"><h1 class="d32">Morning, Isaac</h1><p class="q" style="margin-top:4px">Monday 12 October</p></div>
      {box()}
      <section aria-label="Your day" style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:baseline;gap:12px"><h2 class="h16">Your day</h2><span class="q">4 jobs and a task, 7:30 to 4:00</span><span style="flex:1"></span><a class="link" href="N-Schedule.dc.html">Schedule</a></div>
        {daybar()}
        <div class="pan" style="background:#6D4FD8">
          <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
            <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><span class="h20">Bellevue Hill</span><span style="font-weight:600">Job 3342</span><span style="font-weight:600">On now, 56%</span></div>
            <p>Two Daikin 3.5 kW splits, main bedroom and study, back to back.</p>
            <div class="pfacts"><span><b>Time</b>9:00–11:30</span><span><b>Where</b>41 Victoria Rd, Bellevue Hill</span><span><b>With</b>Lyle and Callum</span></div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:8px"><a class="btn sm ink" href="N-Job.dc.html">Open job</a><span class="xb" style="color:#fff" aria-label="Close">{ico("x")}</span></div>
        </div>
      </section>
      <section aria-label="Earlier today" style="display:flex;flex-direction:column">
        <div style="display:flex;align-items:baseline;gap:12px;padding-bottom:8px"><h2 class="h16">Earlier today</h2><span style="flex:1"></span><a class="link" href="N-Convos.dc.html">Conversations</a></div>
        <article class="grp" style="display:flex;gap:12px;padding:16px 0">
          <span class="av">IS</span>
          <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
            <div class="lab"><b>You</b> <span class="q">8:12 am</span></div>
            <p class="read">Lyle needs the Bellevue Hill head on the ute, and someone has to ring the Hilux dealer.</p>
            <div style="display:flex;gap:16px" class="lab"><a class="link" href="#">1 task for Lyle</a><a class="link" href="#needs">1 task for you</a><a class="link" href="N-Convos.dc.html">Reply</a></div>
          </div>
        </article>
        <article class="grp" style="display:flex;gap:12px;padding:16px 0">
          <span class="av">IS</span>
          <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
            <div class="lab"><b>You</b> <span class="q">8:40 am, spoken</span></div>
            <p class="read">Just been to Riverview. They want a split in the main bedroom, back to back with the study. Don't have time to quote it now, save that as the brief.</p>
            <div style="display:flex;gap:16px" class="lab"><a class="link" href="N-Quote.dc.html">Brief saved on 3361 Okafor, Riverview</a><a class="link" href="N-Convos.dc.html">Reply</a></div>
          </div>
        </article>
      </section>
    </div>
  </section>
  {needs_panel()}
  {extra_overlay}
</main>
</div>'''


def build(out):
    out["N-Home.dc.html"] = page("Home", 1440, 900, DAYBAR_CSS, home_body())
