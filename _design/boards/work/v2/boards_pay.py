"""Time and pay in the new layout: Team's Timesheets, Leave and Expenses tabs,
Settings' Pay and holidays, and your own timesheet."""
from base import ico, sidebar, page
from boards_more import EXTRA

PCSS = EXTRA + """
.tile{padding:12px 16px;border:1px solid rgba(5,5,5,.08);border-radius:10px;min-width:0}
.tile b{display:block;font-size:20px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums}
.gh{display:flex;align-items:center;gap:8px;padding:20px 0 8px}
.gh .n{color:#5f6a79;font-weight:500}
.tbl td.num,.tbl th.num{text-align:right;font-variant-numeric:tabular-nums}
.who{display:flex;align-items:center;gap:12px}
.who .av{background:#F0F2F5;color:#050505}
.panel{width:420px;flex:none;border-left:1px solid rgba(5,5,5,.08);padding:24px;display:flex;flex-direction:column;gap:16px;overflow:hidden}
.days{width:100%;border-collapse:collapse}
.days td{padding:8px 0;border-bottom:1px solid rgba(5,5,5,.08)}
.days td.num{text-align:right;font-variant-numeric:tabular-nums}
.sub{font-size:13px;line-height:18px;color:#5f6a79}
"""

PEOPLE = {"LI": "#E4DDF6", "DW": "#DCE8DD", "CA": "#FBE7C6", "MP": "#D9E6F7", "KL": "#F6DADF", "IS": "#050505"}


def av(a):
    bg = PEOPLE.get(a, "#F0F2F5")
    return f'<span class="av" style="background:{bg};color:{"#fff" if bg == "#050505" else "#050505"}">{a}</span>'


def team_head(tab):
    tabs = [("People", ""), ("Notices", "2"), ("Timesheets", "4"), ("Leave", "1"), ("Expenses", "2"), ("Vehicles", "")]
    href = {"People": "N-Team.dc.html", "Notices": "#", "Timesheets": "N-TeamTimesheets.dc.html", "Leave": "N-TeamLeave.dc.html", "Expenses": "N-TeamExpenses.dc.html", "Vehicles": "#"}
    t = "".join(f'<a class="{"on" if n == tab else ""}" href="{href[n]}">{n}{f"<span class=q>&nbsp;{c}</span>" if c else ""}</a>' for n, c in tabs)
    return f'''<div class="pagehead">
    <div class="toprow"><h1 class="h24">Team</h1><span style="flex:1"></span><span class="field" style="width:280px">{ico("search", "ico i16 q")}<span class="q">Search people</span></span></div>
    <nav class="tabs">{t}</nav>
  </div>'''


def timesheets_body():
    def r(a, name, role, sent, worked, ot, look, action, sel=False, cls=""):
        return (f'<tr{" class=sel" if sel else ""}><td><div class="who">{av(a)}<div><div style="font-weight:600">{name}</div><div class="sub">{sent}</div></div></div></td>'
                f'<td class="num">{worked}</td><td class="num">{ot}</td><td class="{cls}" style="font-weight:{500 if cls else 400};padding-left:24px">{look}</td><td style="text-align:right">{action}</td></tr>')
    cols = '<colgroup><col style="width:230px"><col style="width:76px"><col style="width:92px"><col><col style="width:104px"></colgroup>'
    head = cols + '<thead><tr><th>Person</th><th class="num">Worked</th><th class="num">Overtime</th><th style="padding-left:24px">To look at</th><th></th></tr></thead>'
    look = f'''<table class="tbl" style="table-layout:fixed">{head}<tbody>
      {r("LI", "Lyle Irving", "Senior tech", "Sent Sunday 6:00 pm", "38.5", "6.5", "Thursday 10 hours; Saturday added", '<span class="btn sm">Approve</span>', True, "warn")}
      {r("DW", "Dan Walsh", "Tech", "Sent Sunday 6:00 pm", "32.0", "0", "Wednesday moved to 6:00 to 2:30", '<span class="btn sm">Approve</span>', False, "warn")}
    </tbody></table>'''
    ready = f'''<table class="tbl" style="table-layout:fixed">{cols}<tbody>
      {r("CA", "Callum Ahn", "Apprentice, 2nd year", "Sent Sunday 6:00 pm", "32.0", "0", "Their normal week", '<span class="btn sm">Approve</span>')}
      {r("MP", "Mia Park", "Office", "Sent Friday 4:10 pm", "32.0", "0", "Their normal week", '<span class="btn sm">Approve</span>')}
    </tbody></table>'''
    notsent = f'''<table class="tbl" style="table-layout:fixed">{cols}<tbody>
      {r("KL", "Kai Lee", "Project lead", 'Not sent', "16.0", "0", "On leave Thursday and Friday", '<span class="btn sm">Remind</span>')}
    </tbody></table>'''
    days = [("Mon 5", "Public holiday", "8.0", "q"), ("Tue 6", "7:00 to 3:30", "8.0", ""), ("Wed 7", "7:00 to 4:00", "8.5", ""), ("Thu 8", "6:30 to 5:00", "10.0", "warn"), ("Fri 9", "7:00 to 3:30", "8.0", ""), ("Sat 10", "7:00 to 11:00", "4.0", "warn"), ("Sun 11", "Off", "", "q")]
    dl = "".join(f'<tr><td style="width:72px;font-weight:600">{d}</td><td class="{c}">{t}</td><td class="num" style="width:56px">{h}</td></tr>' for d, t, h, c in days)
    return f'''<div class="app">
{sidebar("team")}
<main class="main">
  {team_head("Timesheets")}
  <div style="flex:1;min-height:0;display:flex">
    <section style="flex:1;min-width:0;padding:16px 32px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:12px"><h2 class="h20">5 to 11 October</h2><span class="q">Last week</span><span style="flex:1"></span><span class="btn sm">Previous week</span><span class="btn sm">This week</span></div>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px">
        <div class="tile"><span class="sub">Worked</span><b>150.5 h</b></div>
        <div class="tile"><span class="sub">Payroll hours</span><b>210.8 h</b></div>
        <div class="tile"><span class="sub">Overtime</span><b>6.5 h</b></div>
        <div class="tile"><span class="sub">Owed to staff</span><b>$213.40</b></div>
      </div>
      <div class="gh"><h3 class="h16">Needs a look</h3><span class="n">2</span></div>
      {look}
      <div class="gh"><h3 class="h16">Ready to approve</h3><span class="n">2</span><span style="flex:1"></span><span class="btn sm ink">Approve both</span></div>
      {ready}
      <div class="gh"><h3 class="h16">Not sent</h3><span class="n">1</span></div>
      {notsent}
    </section>
    <aside class="panel">
      <div class="who">{av("LI")}<div><h2 class="h20">Lyle Irving</h2><p class="sub">5 to 11 October, sent Sunday 6:00 pm</p></div></div>
      <table class="days"><tbody>{dl}</tbody></table>
      <dl class="kv" style="grid-template-columns:150px minmax(0,1fr);gap:4px 16px"><dt>Normal hours</dt><dd class="num">32.0</dd><dt>Public holiday</dt><dd class="num">8.0</dd><dt>Time and a half</dt><dd class="num">2.5</dd><dt>Saturday rate</dt><dd class="num">4.0</dd></dl>
      <div class="field tall"><span class="q">Ask Lyle something before you approve</span></div>
      <div style="display:flex;gap:8px"><span class="btn">Send back</span><span style="flex:1"></span><span class="btn ink">Approve</span></div>
    </aside>
  </div>
</main>
</div>'''


def leave_body():
    bal = [("LI", "Lyle Irving", "112.4", "46.0"), ("DW", "Dan Walsh", "152.0", "61.2"), ("CA", "Callum Ahn", "64.0", "38.0"), ("KL", "Kai Lee", "79.2", "22.8"), ("MP", "Mia Park", "30.4", "15.2")]
    br = "".join(f'<tr><td><div class="who">{av(a)}<span style="font-weight:600">{n}</span></div></td><td class="num">{x}</td><td class="num">{y}</td><td style="text-align:right"><span class="btn sm">Edit</span></td></tr>' for a, n, x, y in bal)
    coming = [("LI", "Lyle Irving", "Annual leave", "Wednesday 28 October", "Approved", "ok"), ("MP", "Mia Park", "Personal leave", "Friday 16 October", "Approved, with certificate", "ok")]
    cr = "".join(f'<tr><td><div class="who">{av(a)}<span style="font-weight:600">{n}</span></div></td><td>{k}</td><td>{d}</td><td class="{c}" style="font-weight:500">{s}</td></tr>' for a, n, k, d, s, c in coming)
    return f'''<div class="app">
{sidebar("team")}
<main class="main">
  {team_head("Leave")}
  <div style="flex:1;min-height:0;display:flex;gap:32px;padding:16px 32px;overflow:hidden">
    <section style="flex:1;min-width:0">
      <div class="gh" style="padding-top:8px"><h3 class="h16">Waiting on a decision</h3><span class="n">1</span></div>
      <div class="card" style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
        <div class="who">{av("KL")}<div style="flex:1"><div style="font-weight:600">Kai Lee, annual leave</div><div class="sub">Asked this morning, 7:55 am</div></div></div>
        <dl class="kv"><dt>Days</dt><dd>Monday 26 to Friday 30 October</dd><dt>Hours</dt><dd class="num">38.0, leaving 41.2 annual</dd><dt>Note</dt><dd>Family holiday, booked a while ago</dd></dl>
        <p class="warn" style="font-weight:500">Lyle is off on Wednesday 28 too.</p>
        <div class="field"><span class="q">Reason, if you decline. Kai sees it.</span></div>
        <div style="display:flex;gap:8px"><span class="btn">Decline</span><span style="flex:1"></span><span class="btn ink">Approve</span></div>
      </div>
      <div class="gh"><h3 class="h16">Coming up</h3><span class="n">2</span><span style="flex:1"></span><a class="link lab" href="N-Schedule.dc.html">Schedule</a></div>
      <table class="tbl" style="table-layout:fixed"><colgroup><col style="width:190px"><col style="width:140px"><col style="width:200px"><col></colgroup><thead><tr><th>Person</th><th>Kind</th><th>Days</th><th>State</th></tr></thead><tbody>{cr}</tbody></table>
    </section>
    <section style="width:460px;flex:none">
      <div class="gh" style="padding-top:8px"><h3 class="h16">Balances</h3><span class="n">hours today</span></div>
      <table class="tbl"><thead><tr><th>Person</th><th class="num">Annual</th><th class="num">Personal</th><th style="width:80px"></th></tr></thead><tbody>{br}</tbody></table>
    </section>
  </div>
</main>
</div>'''


def expenses_body():
    def r(a, n, what, sup, job, amt, extra, act, cls=""):
        return f'<tr><td><div class="who">{av(a)}<span style="font-weight:600">{n}</span></div></td><td><div>{what}</div><div class="sub">{sup}</div></td><td>{job}</td><td class="{cls}">{extra}</td><td class="num" style="font-weight:600">{amt}</td><td style="text-align:right;white-space:nowrap">{act}</td></tr>'
    ecols = '<colgroup><col style="width:180px"><col><col style="width:144px"><col style="width:240px"><col style="width:96px"><col style="width:184px"></colgroup>'
    head = ecols + '<thead><tr><th>Person</th><th>What</th><th>For</th><th></th><th class="num">Amount</th><th></th></tr></thead>'
    ad = '<span class="btn sm">Decline</span> <span class="btn sm ink">Approve</span>'
    return f'''<div class="app">
{sidebar("team")}
<main class="main">
  {team_head("Expenses")}
  <section style="flex:1;min-height:0;padding:8px 32px;overflow:hidden">
    <div class="gh"><h3 class="h16">Waiting on a decision</h3><span class="n">2</span></div>
    <table class="tbl" style="table-layout:fixed">{head}<tbody>
      {r("LI", "Lyle Irving", "Copper fittings and flux", "Reece, Friday 9 October", "3342 Rifkin", "$86.40", "Own money, receipt read", ad)}
      {r("DW", "Dan Walsh", "Fuel, 52.3 litres", "Ampol Botany, Thursday 8 October", "Hilux XQG 41B", "$112.80", "Own money, receipt read", ad)}
    </tbody></table>
    <div class="gh"><h3 class="h16">Approved, to pay back</h3><span class="n">2, $213.40</span></div>
    <table class="tbl" style="table-layout:fixed">{ecols}<tbody>
      {r("CA", "Callum Ahn", "Drill bits", "Bunnings, Tuesday 6 October", "Workshop", "$34.90", "Approved Wednesday 7 October", '<span class="btn sm">Mark paid</span>')}
      {r("KL", "Kai Lee", "Parking and tolls", "Week of 28 September", "3302 Heuvel", "$178.50", "Approved Friday 2 October", '<span class="btn sm">Mark paid</span>')}
    </tbody></table>
    <div class="gh"><h3 class="h16">On the company card</h3><span class="n">3 this week, no approval needed</span></div>
    <table class="tbl" style="table-layout:fixed">{ecols}<tbody>
      {r("IS", "Isaac Smith", "Fuel, 61.0 litres", "BP Rosebery, Monday 12 October", "Ranger YHT 22C", "$131.75", "", "")}
      {r("LI", "Lyle Irving", "Pipe and lagging", "Reece, Thursday 8 October", "3342 Rifkin", "$412.10", "", "")}
      {r("MP", "Mia Park", "Printer toner", "Officeworks, Wednesday 7 October", "Office", "$89.00", "", "")}
    </tbody></table>
  </section>
</main>
</div>'''


def settings_pay_body():
    groups = [("Yours", ["Sign-in and security", "Emails and alerts"]), ("Company", ["Business", "Licences and insurance", "ServiceM8 and Xero", "Quoting and prices", "Pay and holidays", "Reports"])]
    nav = ""
    for g, items in groups:
        nav += f'<div class="cap" style="padding:16px 12px 4px">{g}</div>'
        nav += "".join(f'<a class="srow{" on" if i == "Pay and holidays" else ""}" href="{"N-Settings.dc.html" if i == "Business" else "#"}" style="height:36px">{i}</a>' for i in items)
    rules = [("Pay cycle", "Weekly, Monday to Sunday"), ("Normal day", "7:00 to 3:30 with a 30 minute break, 8 hours, Monday to Friday. Each person's own week is on their Team card."), ("Overtime", "Time and a half after 8 hours in a day, double time after 10"), ("Weekends", "Saturday time and a half for 2 hours, then double; Sunday double"), ("Public holidays", "Double time and a half"), ("Breaks", "30 minutes unpaid after 5 hours"), ("Sending", "Timesheets send themselves Sunday 6:00 pm and lock once sent"), ("Certificates", "Asked for personal leave of 2 days or more"), ("Super", "12%"), ("Pay run", "Approved hours go to Xero payroll")]
    kv = "".join(f'<dt>{a}</dt><dd>{b}</dd>' for a, b in rules)
    hol = [("Friday 25 December", "Christmas Day"), ("Saturday 26 December", "Boxing Day"), ("Monday 28 December", "Boxing Day, the extra day"), ("Friday 1 January", "New Year's Day"), ("Tuesday 26 January", "Australia Day")]
    hl = "".join(f'<tr><td style="width:220px">{d}</td><td>{n}</td><td style="text-align:right"><span class="btn sm ghost">Remove</span></td></tr>' for d, n in hol)
    return f'''<div class="app">
{sidebar("")}
<main class="main">
  <div class="pagehead"><div class="toprow"><h1 class="h24">Settings</h1></div></div>
  <div style="flex:1;min-height:0;display:flex;padding:16px 32px 0;overflow:hidden">
    <nav style="width:240px;flex:none;padding-right:24px">{nav}</nav>
    <div style="flex:1;min-width:0;max-width:760px;display:flex;flex-direction:column;gap:24px">
      <section>
        <div style="display:flex;align-items:center;margin-bottom:12px"><h2 class="h20">Pay rules</h2><span style="flex:1"></span><span class="btn sm">Edit</span></div>
        <dl class="kv" style="grid-template-columns:150px minmax(0,1fr);gap:10px 16px">{kv}</dl>
      </section>
      <section class="grp" style="padding-top:20px">
        <div style="display:flex;align-items:center;margin-bottom:4px"><h2 class="h20">Public holidays</h2><span class="q" style="margin-left:12px">New South Wales</span><span style="flex:1"></span><span class="btn sm">Add a holiday</span></div>
        <table class="tbl"><tbody>{hl}</tbody></table>
      </section>
    </div>
  </div>
</main>
</div>'''


def my_timesheet_body():
    this = [("Mon 12", "7:00 to now", "", "On now", "ok", True), ("Tue 13", "", "", "", "", False), ("Wed 14", "", "", "", "", False), ("Thu 15", "", "", "", "", False), ("Fri 16", "", "", "", "", False)]
    last = [("Mon 5", "Public holiday", "8.0", "", "q"), ("Tue 6", "7:00 to 4:00", "8.5", "0.5 at time and a half", ""), ("Wed 7", "7:00 to 3:30", "8.0", "", ""), ("Thu 8", "6:30 to 5:00", "10.0", "2.0 at time and a half", ""), ("Fri 9", "7:00 to 3:30", "8.0", "", "")]
    tr = "".join(f'<tr{" class=sel" if sel else ""}><td style="width:100px;font-weight:600">{d}</td><td style="width:180px;font-variant-numeric:tabular-nums">{t or "<span class=q>Not yet</span>"}</td><td class="num" style="width:70px">{h}</td><td class="{c}" style="font-weight:500">{s}</td></tr>' for d, t, h, s, c, sel in this)
    lr = "".join(f'<tr><td style="width:100px;font-weight:600">{d}</td><td class="{c}" style="width:180px;font-variant-numeric:tabular-nums">{t}</td><td class="num" style="width:70px">{h}</td><td class="q">{o}</td></tr>' for d, t, h, o, c in last)
    return f'''<div class="app">
{sidebar("")}
<main class="main">
  <div class="pagehead">
    <div class="toprow"><h1 class="h24">Timesheet</h1><span style="flex:1"></span><span class="btn sm">Previous week</span><span class="btn sm">Next week</span></div>
  </div>
  <div style="flex:1;min-height:0;display:flex;gap:32px;padding:16px 32px;overflow:hidden">
    <div style="flex:1;min-width:0">
      <div class="gh" style="padding-top:0"><h2 class="h16">This week, 12 to 18 October</h2><span style="flex:1"></span><span class="q">Sends itself Sunday 6:00 pm</span></div>
      <table class="tbl"><tbody>{tr}</tbody></table>
      <div class="gh" style="padding-top:28px"><h2 class="h16">Last week, 5 to 11 October</h2><span style="flex:1"></span><span class="info" style="font-weight:500">Sent, waiting on approval</span></div>
      <table class="tbl"><tbody>{lr}</tbody></table>
      <p class="sub" style="padding-top:12px">34.5 hours worked, 2.5 of them at time and a half, plus the public holiday.</p>
    </div>
    <aside style="width:380px;flex:none;display:flex;flex-direction:column;gap:16px">
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;align-items:center"><h2 class="h16">Monday 12 October</h2><span style="flex:1"></span><span class="seg"><span class="on">Worked</span><span>Off</span><span>Leave</span></span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><span class="flabel">Start</span><div class="field num">7:00 am</div></div><div><span class="flabel">Finish</span><div class="field num"><span class="q">Type a time</span></div></div><div><span class="flabel">Break</span><div class="field num">30 min</div></div><div><span class="flabel">Total</span><div class="field num" style="background:#F0F2F5"><span class="q">When you finish</span></div></div></div>
        <p class="sub">Started at 7:00, when you checked in at Kingsford.</p>
        <div style="display:flex;gap:8px"><span style="flex:1"></span><span class="btn ink">Save day</span></div>
      </div>
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:4px">
        <h2 class="h16">Your normal week</h2>
        <p>Monday to Friday, 7:00 to 3:30, 30 minute break.</p>
        <a class="link lab" href="#" style="margin-top:4px">Change it on your card</a>
      </div>
    </aside>
  </div>
</main>
</div>'''


def build(out):
    out["N-TeamTimesheets.dc.html"] = page("Team, timesheets", 1440, 900, PCSS, timesheets_body())
    out["N-TeamLeave.dc.html"] = page("Team, leave", 1440, 900, PCSS, leave_body())
    out["N-TeamExpenses.dc.html"] = page("Team, expenses", 1440, 900, PCSS, expenses_body())
    out["N-SettingsPay.dc.html"] = page("Settings, pay and holidays", 1440, 900, PCSS, settings_pay_body())
    out["N-Timesheet.dc.html"] = page("Your timesheet", 1440, 900, PCSS, my_timesheet_body())
