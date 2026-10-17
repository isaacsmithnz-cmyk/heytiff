"""New on a job, the whole way through, with the fixes: the kind of record in
the line, what takes it, the form with the job as a field, staying put after,
a section's own door, and a tech's shorter menu."""
from base import ico, page
import boards_v3 as v3
from boards_menus import CSS as MCSS, hide, OK

CSS = MCSS + """
.nmf .cap{font-size:12px;line-height:16px;font-weight:500;color:rgba(255,255,255,.5);padding:6px 12px 2px}
.dlg{position:absolute;z-index:8;left:588px;top:120px;width:520px;padding:24px;display:flex;flex-direction:column;gap:16px}
.dlg h2{font-size:20px;line-height:28px;font-weight:600;margin:0}
.dlg .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dlg .ft{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.dlg .fi .x{color:var(--q);display:inline-flex;flex:none}
.wfs{width:1440px;height:900px;background:#fff;padding:56px 64px;display:grid;grid-template-columns:minmax(0,1fr) 470px;gap:56px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:var(--ink)}
.wfs h1{margin:0;font-size:24px;line-height:32px;font-weight:600}
.wfs .ld{margin:8px 0 0;color:var(--q);font-size:16px;line-height:24px}
.wfs .st{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px;padding:12px 0;border-top:1px solid var(--line);font-weight:400;white-space:normal;color:var(--ink)}
.wfs .st .n{width:24px;height:24px;border-radius:50%;background:var(--soft);font-size:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.wfs .st b{font-weight:600}
.wfs .st p{margin:2px 0 0;color:var(--q);font-size:13px;line-height:18px}
.wfs h3{margin:0 0 8px;font-size:12px;line-height:16px;font-weight:500;color:var(--q)}
.wfs .tk2{display:grid;grid-template-columns:minmax(0,1fr) 120px;padding:8px 0;border-top:1px solid var(--line);font-size:13px;line-height:18px}
.wfs .tk2 span:last-child{color:var(--q)}
"""


def press_new(h):
    a = '<a class="sr" href="#"><span class="pl">'
    assert a in h
    return h.replace(a, '<a class="sr on" href="#" style="border-radius:10px 0 0 10px;margin-right:-8px"><span class="pl">', 1)


def band(text, color="Blue", clear=True, grey=False):
    lead = v3.dot(color) if color else ""
    st = ' style="color:rgba(255,255,255,.5);font-weight:500"' if grey else ""
    x = f'<span class="x">{ico("x")}</span>' if clear else ""
    return f'<div class="band">{lead}<span class="fade"{st}>{text}</span>{x}</div>'


def menu(band_html, groups, style=""):
    chev = f'<span class="r">{ico("right")}</span>'
    inner = ""
    for g in groups:
        inner += '<div class="mdv"></div>'
        for it in g:
            if it[0] == "cap":
                inner += f'<div class="cap">{it[1]}</div>'
                continue
            icon, label, more = it
            inner += f'<a class="mi" href="#">{ico(icon)}{label}{chev if more else ""}</a>'
    return f'<div class="nmf"{style}>{band_html}<div class="in">{inner}</div></div>'


JOB_BAND = band("For job 3342, Rifkin, Bellevue Hill")
OWNER = [[("jobs", "Job for Julian Rifkin", False), ("dollar", "Quote", False), ("task", "Task", False), ("cal", "Visit", False), ("receipt", "Expense", False)],
         [("doc", "Document", True), ("dots", "More", True)],
         [("cap", "Not for a job"), ("sun", "Leave", False)]]
TECH = [[("task", "Task", False), ("receipt", "Expense", False)],
        [("doc", "Document", True), ("dots", "More", True)],
        [("cap", "Not for a job"), ("sun", "Leave", False)]]


def job_page(**kw):
    return hide(v3.job(**kw))


def with_menu(h, m):
    return press_new(h).replace("</main>", "</main>" + m, 1)


def field(label, inner, cls="", style=""):
    return f'<label class="fl"><span class="lb">{label}</span><span class="fi {cls}" style="{style}">{inner}</span></label>'


def job_field(open_menu=""):
    inner = f'{v3.dot("Blue")}<span class="fade" style="font-weight:500">3342 Rifkin, Bellevue Hill</span>{ico("down")}'
    st = "gap:8px" + (";border-color:var(--ink)" if open_menu else "")
    return f'<label class="fl" style="position:relative"><span class="lb">Job</span><span class="fi" style="{st}">{inner}</span>{open_menu}</label>'


def dialog(title, body, primary):
    return (f'<div class="scr" style="z-index:7"></div><div class="ov dlg"><h2>{title}</h2>{body}'
            f'<div class="ft"><span class="b sec">Cancel</span><span class="b go">{primary}</span></div></div>')


def wf_task():
    body = (field("What", "Order the grilles") + '<div class="two">' + field("When", "Today, by 12:30") + field("Who", f'<span>Lyle Irving</span>{ico("down")}', "sel2") + '</div>' + job_field())
    return job_page().replace("</main>", "</main>" + dialog("New task", body, "Add task"), 1)


def wf_after():
    todo = f'''<div class="gp"><h2 class="t16" style="margin-bottom:2px">To do on this job</h2>
<div class="rw" style="gap:10px;background:var(--sel);border-radius:10px;padding:10px 8px;border-top:0;margin-top:6px"><span class="tk"></span><div class="m"><div class="t">Order the grilles</div><div class="s">Lyle, today by 12:30</div></div></div></div>'''
    h = job_page(aside_top=todo)
    toast = f'<div class="toast" style="z-index:6">Task added to job 3342<a class="lk" href="#">Undo</a></div>'
    return h.replace("</main>", "</main>" + toast, 1)


def wf_expense():
    opts = (f'<div class="ov mn" style="top:62px;left:0;right:0">'
            f'<a class="mi cur" href="#">{v3.dot("Blue")}<span class="fade">3342 Rifkin, Bellevue Hill</span>{OK}</a>'
            f'<a class="mi" href="#"><span style="width:8px"></span>Not for a job</a><div class="mdv"></div>'
            f'<div class="mfi">{ico("search")}Find a job</div></div>')
    body = ('<div class="two">' + field("What", "Fuel, Hilux XQG 41B") + field("Amount", "$82.40") + '</div>'
            + field("Receipt", f'{ico("camera")}<span class="qq">Add a photo</span>') + job_field(opts) + '<div style="height:132px"></div>')
    return job_page().replace("</main>", "</main>" + dialog("New expense", body, "Add expense"), 1)


def visits_content():
    rows = [("Tuesday 13 October, 9:00 to 11:30", "Install, day 1", "Lyle and Callum", '<span class="st good">On now</span>'),
            ("Friday 16 October, 2:00 to 3:00", "Commissioning", "Lyle", '<span class="qq">Booked</span>')]
    r = "".join(f'<div class="rw" style="gap:16px"><span class="l13 qq nm" style="width:240px;flex:none">{d}</span><div class="m"><div class="t">{t}</div><div class="s">{s}</div></div>{st}</div>' for d, t, s, st in rows)
    return f'''<div style="padding:24px 40px 0;max-width:900px">
<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:8px"><h2 class="t16">Visits</h2><span class="qq">2 on this job</span><span style="flex:1"></span><span class="b sm sec">{ico("plus")}Book a visit</span></div>{r}</div>'''


def wf_visits():
    return job_page(tab="Visits", content=visits_content())


def wf_visit_dialog():
    body = (field("What", "Commissioning") + '<div class="two">' + field("When", "Friday 16 October, 2:00 to 3:00") + field("Who", f'<span>Lyle Irving</span>{ico("down")}', "sel2") + '</div>' + job_field())
    return job_page(tab="Visits", content=visits_content()).replace("</main>", "</main>" + dialog("New visit", body, "Book visit"), 1)


def tech(h):
    for a, b in [('<span class="avt">IS</span>', '<span class="avt">LI</span>'), ('>Isaac Smith<', '>Lyle Irving<'), ('>Owner<', '>Technician<')]:
        assert a in h, a
        h = h.replace(a, b, 1)
    return h


def spec():
    steps = [
        ("Press New.", "It reads the page you're on: a job, a project, a client, or nothing. Never a selection."),
        ("The first line says what it's for.", "With the kind: 'For job 3342', 'For project Heuvel', 'For client Rifkin'. The cross clears it."),
        ("Pick.", "What belongs to a job takes the line; Leave never does. On a job, Job becomes 'Job for Julian Rifkin' and Event becomes Visit. You only see what you're allowed to make."),
        ("The form opens over the page.", "The job is a field in it, filled in, which you can change or clear. You confirm it where you type."),
        ("Save, and stay put.", "A toast says what happened, with Undo. A document opens in its own tab, so the job stays where it was."),
        ("Other doors, the same form.", "A section's own button, like Book a visit, opens the same form with the job in it. Tiff reads the same page."),
        ("Tabs keep things open.", "The dock of set-aside cards goes; New reads the tab in front."),
    ]
    st = "".join(f'<div class="st"><span class="n">{i + 1}</span><div><b>{a}</b><p>{b}</p></div></div>' for i, (a, b) in enumerate(steps))
    ex = [band("For job 3342, Rifkin, Bellevue Hill"), band("For project 3302, Heuvel Construction, Chatswood", "Purple"), band("For client Julian Rifkin", None), band("For a job or client", None, False, True)]
    exs = "".join(f'<div class="nmf" style="position:relative;left:auto;top:auto;width:470px;box-shadow:none;border-radius:16px;padding:6px;margin-bottom:8px">{b}</div>' for b in ex)
    takes = [("Job for Julian Rifkin", "Same client and site"), ("Quote", "Takes it"), ("Task", "Takes it"), ("Visit", "Takes it"), ("Expense", "Takes it; check in the form"), ("Document", "Takes it"), ("Leave", "Never")]
    tk = "".join(f'<div class="tk2"><span>{a}</span><span>{b}</span></div>' for a, b in takes)
    return f'''<div class="v3" style="display:block;background:#fff"><div class="wfs">
<div><h1>New, the whole way through</h1><p class="ld">Making something while you're on a job, with the fixes.</p><div style="margin-top:20px">{st}</div></div>
<div><h3>The first line, by page</h3>{exs}<h3 style="margin-top:20px">What takes it</h3>{tk}</div>
</div></div>'''


def build(out):
    out["WF-0.dc.html"] = page("New, the whole way through", 1440, 900, CSS, spec())
    out["WF-1.dc.html"] = page("1. New on a job", 1440, 900, CSS, with_menu(job_page(), menu(JOB_BAND, OWNER)))
    out["WF-2.dc.html"] = page("2. The task form, the job a field", 1440, 900, CSS, wf_task())
    out["WF-3.dc.html"] = page("3. Saved, still on the job", 1440, 900, CSS, wf_after())
    out["WF-4.dc.html"] = page("4. An expense, the job changed or cleared", 1440, 900, CSS, wf_expense())
    out["WF-5.dc.html"] = page("5. A section's own door", 1440, 900, CSS, wf_visits())
    out["WF-6.dc.html"] = page("6. The same form from that door", 1440, 900, CSS, wf_visit_dialog())
    out["WF-7.dc.html"] = page("7. A tech's New", 1440, 900, CSS, tech(with_menu(job_page(), menu(JOB_BAND, TECH))))
