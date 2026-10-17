"""Time and pay, Claude style: one centred column, plain lists, details open in
place, settings as rows that save themselves. Simplicity first."""
from base import ico, sidebar, page
from boards_pay import av

CCSS = """
.cw{flex:1;min-height:0;overflow:hidden}
.col{max-width:720px;margin:0 auto;padding:40px 32px 24px}
.ttl{display:flex;align-items:center;gap:12px}
.pills{display:flex;gap:4px;margin-top:12px}
.pills a{height:32px;padding:0 12px;border-radius:999px;display:inline-flex;align-items:center;font-size:13px;font-weight:500;color:#5f6a79}
.pills a.on{background:rgba(5,5,5,.07);color:#050505;font-weight:600}
.app .lead{font-size:16px;line-height:24px;margin-top:24px;margin-bottom:8px}
.lr{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(5,5,5,.08)}
.lr .m{flex:1;min-width:0}
.lr .t{font-weight:600}
.s{font-size:13px;line-height:18px;color:#5f6a79}
.s.warn,.s .warn{color:#a44b08}
.s.ok{color:#196B2D}
.who .av,.lr .av{background:#F0F2F5;color:#050505}
.open{padding:4px 0 16px 44px;border-bottom:1px solid rgba(5,5,5,.08);display:flex;flex-direction:column;gap:12px}
.dy{display:grid;grid-template-columns:64px minmax(0,1fr) 48px;gap:8px;font-size:14px;line-height:20px;font-variant-numeric:tabular-nums}
.dy .h{text-align:right}
.gl{font-size:12px;line-height:16px;font-weight:500;color:#5f6a79;padding:24px 0 4px}
.sr{display:flex;align-items:center;gap:24px;padding:16px 0;border-bottom:1px solid rgba(5,5,5,.08)}
.sr .m{flex:1;min-width:0}
.sr .t{font-weight:600}
.sel{height:36px;border:1px solid rgba(5,5,5,.14);border-radius:10px;padding:0 10px 0 12px;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;background:#fff}
.tg{width:36px;height:20px;border-radius:999px;background:#050505;position:relative;flex:none}
.tg::after{content:"";position:absolute;right:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff}
.tg.off{background:rgba(5,5,5,.2)}
.tg.off::after{left:2px;right:auto}
"""

TEAM = [("People", "N-Team.dc.html"), ("Notices", "#"), ("Timesheets", "C-TeamTimesheets.dc.html"), ("Leave", "C-TeamLeave.dc.html"), ("Expenses", "C-TeamExpenses.dc.html"), ("Vehicles", "#")]


def pills(on):
    return '<nav class="pills">' + "".join(f'<a class="{"on" if n == on else ""}" href="{h}">{n}</a>' for n, h in TEAM) + '</nav>'


def shell(active, inner):
    return f'''<div class="app">
{sidebar(active)}
<main class="main"><div class="cw"><div class="col">
{inner}
</div></div></main>
</div>'''


def row(a, title, sub, right, sub_cls="s"):
    return f'<div class="lr">{av(a)}<div class="m"><div class="t">{title}</div><div class="{sub_cls}">{sub}</div></div>{right}</div>'


def timesheets():
    days = [("Mon 5", "Public holiday", "8.0", "q"), ("Tue 6", "7:00 to 3:30", "8.0", ""), ("Wed 7", "7:00 to 4:00", "8.5", ""), ("Thu 8", "6:30 to 5:00", "10.0", "warn"), ("Fri 9", "7:00 to 3:30", "8.0", ""), ("Sat 10", "7:00 to 11:00", "4.0", "warn")]
    dl = "".join(f'<div class="dy"><b>{d}</b><span class="{c}">{t}</span><span class="h">{h}</span></div>' for d, t, h, c in days)
    return shell("team", f'''
<div class="ttl"><h1 class="h24">Team</h1></div>
{pills("Timesheets")}
<p class="lead">Last week, 5 to 11 October. Four to approve, 150.5 hours.</p>
<div class="lr" style="border-bottom:0">{av("LI")}<div class="m"><div class="t">Lyle Irving</div><div class="s warn">Thursday 10 hours; Saturday added</div></div><span class="s">38.5 h</span></div>
<div class="open">
  <div style="display:flex;flex-direction:column;gap:4px">{dl}</div>
  <div class="card" style="border-color:rgba(5,5,5,.14);padding:12px 12px 12px 16px;display:flex;align-items:center;gap:8px"><span class="q" style="flex:1">Ask Lyle something</span><span class="btn sm">Send back</span><span class="btn sm ink">Approve</span></div>
</div>
{row("DW", "Dan Walsh", "Wednesday moved to 6:00 to 2:30", '<span class="s">32 h</span>', "s warn")}
{row("CA", "Callum Ahn", "His normal week", '<span class="btn sm">Approve</span>')}
{row("MP", "Mia Park", "Her normal week", '<span class="btn sm">Approve</span>')}
{row("KL", "Kai Lee", "Not sent; on leave Thursday and Friday", '<span class="btn sm">Remind</span>')}
''')


def my_timesheet():
    rest = "".join(f'<div class="lr" style="padding:10px 0"><span style="width:64px;font-weight:600">{d}</span><span class="q" style="flex:1">Not yet</span></div>' for d in ["Tue 13", "Wed 14", "Thu 15", "Fri 16"])
    return shell("", f'''
<div class="ttl"><h1 class="h24">Timesheet</h1><span style="flex:1"></span><span class="btn sm ghost">Previous week</span></div>
<p class="lead">This week, 12 to 18 October. It sends itself Sunday at 6:00 pm.</p>
<div class="card" style="border-color:rgba(5,5,5,.14);padding:16px;display:flex;flex-direction:column;gap:12px;margin-top:8px">
  <div style="display:flex;align-items:baseline;gap:12px"><h2 class="h16">Today</h2><span class="s">Started 7:00, when you checked in at Kingsford</span></div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px"><div><span class="flabel">Start</span><div class="field">7:00 am</div></div><div><span class="flabel">Finish</span><div class="field"><span class="q">3:30 pm</span></div></div><div><span class="flabel">Break</span><div class="field">30 min</div></div></div>
  <div style="display:flex;justify-content:flex-end"><span class="btn ink">Save day</span></div>
</div>
<div style="margin-top:8px">{rest}</div>
<div class="lr" style="margin-top:16px;border-top:1px solid rgba(5,5,5,.08)"><div class="m"><div class="t">Last week</div><div class="s">34.5 hours and the public holiday. Sent, waiting on approval.</div></div><a class="link lab" href="#">Show</a></div>
''')


def settings_pay():
    groups = [("Yours", ["Sign-in and security", "Emails and alerts"]), ("Company", ["Business", "Licences and insurance", "ServiceM8 and Xero", "Quoting and prices", "Pay and holidays", "Reports"])]
    nav = ""
    for g, items in groups:
        nav += f'<div class="cap" style="padding:16px 12px 4px">{g}</div>'
        nav += "".join(f'<a class="srow{" on" if i == "Pay and holidays" else ""}" href="#" style="height:36px">{i}</a>' for i in items)
    down = ico("down", "ico i16 q")

    def sr(t, d, ctl):
        return f'<div class="sr"><div class="m"><div class="t">{t}</div><div class="s">{d}</div></div>{ctl}</div>'
    rows = "".join([
        sr("Pay cycle", "When timesheets close", f'<span class="sel">Weekly, Monday to Sunday{down}</span>'),
        sr("Normal day", "Each person's own week is on their Team card", f'<span class="sel">7:00 to 3:30, 30 min break{down}</span>'),
        sr("Overtime", "Time and a half, then double", f'<span class="sel">After 8 hours, then 10{down}</span>'),
        sr("Weekend and holiday rates", "Saturday, Sunday and public holidays", '<span class="btn sm">Change</span>'),
        sr("Send timesheets for people", "Sunday at 6:00 pm, then lock them", '<span class="tg"></span>'),
        sr("Ask for a medical certificate", "Personal leave of 2 days or more", '<span class="tg"></span>'),
        sr("Send approved hours to Xero", "Into the next pay run", '<span class="tg"></span>'),
        sr("Public holidays", "New South Wales, next is Christmas Day", '<span class="btn sm">Show all</span>'),
    ])
    return f'''<div class="app">
{sidebar("")}
<main class="main" style="flex-direction:row">
  <nav style="width:248px;flex:none;padding:40px 12px 0 24px">{nav}</nav>
  <div style="flex:1;min-width:0;padding:40px 32px 0">
    <div style="max-width:640px">
      <h1 class="h24">Pay and holidays</h1>
      <div style="margin-top:16px">{rows}</div>
    </div>
  </div>
</main>
</div>'''


def leave():
    coming = row("LI", "Lyle Irving", "Annual leave, Wednesday 28 October", '<span class="s ok">Approved</span>') + row("MP", "Mia Park", "Personal leave, Friday 16 October", '<span class="s ok">Approved</span>')
    return shell("team", f'''
<div class="ttl"><h1 class="h24">Team</h1></div>
{pills("Leave")}
<p class="lead">One to decide.</p>
<div class="card" style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
  <div style="display:flex;align-items:center;gap:12px">{av("KL")}<div><div class="t" style="font-weight:600">Kai Lee</div><div class="s">Asked this morning</div></div></div>
  <p class="read">Annual leave, Monday 26 to Friday 30 October. Family holiday, booked a while ago.</p>
  <p class="s">38 hours, leaving 41.2. <span class="warn" style="font-weight:500">Lyle is off on the 28th too.</span></p>
  <div style="display:flex;gap:8px;justify-content:flex-end"><span class="btn">Decline</span><span class="btn ink">Approve</span></div>
</div>
<div class="gl">Coming up</div>
{coming}
<div class="lr"><div class="m"><div class="t">Leave balances</div><div class="s">Annual and personal hours for everyone</div></div><a class="link lab" href="#">Show</a></div>
''')


def expenses():
    ad = '<span class="btn sm">Decline</span><span class="btn sm ink">Approve</span>'
    return shell("team", f'''
<div class="ttl"><h1 class="h24">Team</h1></div>
{pills("Expenses")}
<p class="lead">Two to decide, two to pay back.</p>
{row("LI", "Copper fittings and flux, $86.40", "Lyle Irving at Reece, for 3342 Rifkin", ad)}
{row("DW", "Fuel, $112.80", "Dan Walsh at Ampol Botany, 52.3 litres, Hilux", ad)}
<div class="gl">To pay back, $213.40</div>
{row("CA", "Drill bits, $34.90", "Callum Ahn at Bunnings", '<span class="btn sm">Mark paid</span>')}
{row("KL", "Parking and tolls, $178.50", "Kai Lee, for 3302 Heuvel", '<span class="btn sm">Mark paid</span>')}
<div class="lr" style="margin-top:16px;border-top:1px solid rgba(5,5,5,.08)"><div class="m"><div class="t">On the company card</div><div class="s">3 this week, $632.85, no approval needed</div></div><a class="link lab" href="#">Show</a></div>
''')


def build(out):
    out["C-TeamTimesheets.dc.html"] = page("Timesheets, Claude style", 1440, 900, CCSS, timesheets())
    out["C-Timesheet.dc.html"] = page("Your timesheet, Claude style", 1440, 900, CCSS, my_timesheet())
    out["C-SettingsPay.dc.html"] = page("Pay and holidays, Claude style", 1440, 900, CCSS, settings_pay())
    out["C-TeamLeave.dc.html"] = page("Leave, Claude style", 1440, 900, CCSS, leave())
    out["C-TeamExpenses.dc.html"] = page("Expenses, Claude style", 1440, 900, CCSS, expenses())
