"""How menus work inside a section, with Jobs as the example: views, choosing,
doing and making, and what never gets a menu."""
from base import ico, page
import boards_v3 as v3

CSS = v3.CSS + """
.mn{position:absolute;z-index:6;padding:6px}
.mn .c12{padding:8px 12px 4px}
.mn .mi .ok{margin-left:auto;color:var(--ink);width:16px;height:16px}
.mn .mi.cur{font-weight:600}
.mn .mi.red{color:var(--red-w)}
.mn .mi.red .ico{color:var(--red-w)}
.mn .mfi{height:36px;margin:2px 2px 6px;border:1px solid var(--edge);border-radius:6px;display:flex;align-items:center;gap:8px;padding:0 10px;color:var(--q);font-weight:500}
.mn .mfi .ico{width:16px;height:16px}
.mn .ft{display:flex;justify-content:space-between;align-items:center;padding:6px 8px 2px;font-size:13px;font-weight:500}
.mn .ctx{display:flex;align-items:center;gap:8px;height:36px;padding:0 6px 0 12px;font-weight:600}
.mn .ctx .x{margin-left:auto;color:var(--q);display:inline-flex}
.mn .ctx .x .ico{width:14px;height:14px}
.spec{width:1440px;height:900px;background:#fff;padding:56px 64px;display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:64px}
.spec h1{margin:0;font-size:24px;line-height:32px;font-weight:600}
.spec .ld{margin:8px 0 0;color:var(--q);font-size:16px;line-height:24px}
.spec .k{display:grid;grid-template-columns:150px minmax(0,1fr);gap:16px;padding:14px 0;border-top:1px solid var(--line)}
.spec .k b{font-weight:600}
.spec .k p{margin:0}
.spec .k p span{display:block;color:var(--q);font-size:13px;line-height:18px;margin-top:2px}
.spec .an{display:flex;flex-direction:column;gap:12px}
.spec .an .c12{padding:0}
"""


def hide(html):
    return html.replace('<i class="cf"', '<i class="cf" hidden')


def mi(icon, text, cls="", right=""):
    lead = ico(icon) if icon else ""
    return f'<a class="mi {cls}" href="#">{lead}{text}{right}</a>'


OK = ico("check", "ico ok")


def sort_menu():
    items = [("Next first", True), ("Newest first", False), ("Oldest first", False), ("Value, highest first", False), ("Client, A to Z", False)]
    rows = "".join(mi("", t, "cur" if c else "", OK if c else "") for t, c in items)
    return f'<div class="ov mn" style="top:40px;right:0;width:240px">{rows}</div>'


def who_menu():
    ppl = [("LI", "Lyle Irving", True), ("CA", "Callum Ahn", True), ("DW", "Dan Walsh", False), ("KL", "Kai Lee", False), ("IS", "Isaac Smith, you", False)]
    rows = "".join(f'<a class="mi" href="#"><span class="tk{" on" if on else ""}">{ico("check") if on else ""}</span><span class="avt s">{a}</span>{n}</a>' for a, n, on in ppl)
    rows += f'<a class="mi" href="#"><span class="tk"></span><span class="avt s" style="background:transparent;border:1px dashed var(--edge)"></span>Nobody yet</a>'
    return f'''<div class="ov mn" style="top:40px;right:0;width:280px"><div class="mfi">{ico("search")}Find a person</div>{rows}
<div class="mdv"></div><div class="ft"><a class="lk" href="#">Clear</a><span class="qq">2 chosen</span></div></div>'''


def actions_menu():
    rows = (mi("repeat", "Change the stage", "", f'<span class="r">{ico("right")}</span>') + mi("pin", "Pin to the sidebar")
            + mi("doc", "Copy the link") + mi("upload", "Print the job card") + '<div class="mdv"></div>'
            + mi("flag", "Mark unsuccessful", "red"))
    return f'<div class="ov mn" style="top:40px;right:0;width:250px;text-align:left">{rows}</div>'


def new_menu():
    items = [("jobs", "Job"), ("dollar", "Quote"), ("task", "Task"), ("cal", "Event"), ("receipt", "Expense"), ("sun", "Leave")]
    rows = "".join(mi(i, t) for i, t in items)
    return f'''<div class="ov mn" style="left:262px;top:64px;width:280px">
<div class="ctx">{v3.dot("Blue")}<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">For 3342 Rifkin, Bellevue Hill</span><span class="x">{ico("x")}</span></div><div class="mdv"></div>
{rows}<div class="mdv"></div>{mi("doc", "Document", "", f'<span class="r">{ico("right")}</span>')}{mi("dots", "More", "", f'<span class="r">{ico("right")}</span>')}</div>'''


def spec():
    kinds = [
        ("Views", "Soft tabs under the title: All, To book, Quotes, To invoice, Owed, Projects, Agreements.", "Not a menu. Always in sight, one tap, counts in grey. The one you're on in a light fill."),
        ("Choosing", "A field with a chevron: Who and Sort.", "Opens below the field, its right edge on the field's. A tick on what's chosen; it closes when you pick. Where you can pick several, ticks in blue, and a search on top past eight."),
        ("Doing", "The Actions menu on a job's page.", "Only what's done to the job itself: its stage, pin, link, print. Then a line, then what ends it, in red, last. Making is Add's job."),
        ("Making", "New at the top of the sidebar; Add on a job.", "New is Job, Quote, Task, the same on every page, and fills nothing in; it opens dark from the panel. Add makes what belongs to the job: Visit, Task, Quote or Variation, Cost, SWMS, Certificate; it opens white under the button."),
        ("Moving", "The seven section tabs on a job, underlined, with what's in each.", "Not a menu. Overview, Quote, Visits 2, Checklist 8 of 14, Photos 24, Documents 3, Billing."),
        ("Never", "No menu on a row, no three dots, no right-click.", "A row opens its job; ⌘-click opens it in a new tab. Anything you'd do to it is on its page: one way to each thing."),
    ]
    rows = "".join(f'<div class="k"><b>{a}</b><p>{b}<span>{c}</span></p></div>' for a, b, c in kinds)
    sample = f'''<div class="ov mn" style="position:relative;width:250px">{mi("repeat", "Change the stage", "on", f'<span class="r">{ico("right")}</span>')}{mi("pin", "Pin to the sidebar")}{mi("upload", "Print the job card")}<div class="mdv"></div>{mi("flag", "Mark unsuccessful", "red")}</div>'''
    anat = [
        "White, 16 corner, the one shadow. It appears; it doesn't slide. New is the one dark menu, because it comes out of the panel.",
        "Rows 36 tall, words at 14. An icon on every row or on none.",
        "A line between groups. A chevron opens a second menu beside it.",
        "Arrows move, Enter picks, Esc closes. Typing jumps to a match.",
        "Flips upward when there's no room below.",
    ]
    anat_html = "".join(f'<p style="margin:0;padding-top:10px;border-top:1px solid var(--line)">{t}</p>' for t in anat)
    return f'''<div class="v3" style="display:block;background:#fff"><div class="spec">
<div><h1>Menus inside a section</h1><p class="ld">Jobs as the example. Six kinds of thing: three of them open menus, and the rest are deliberately not menus.</p><div style="margin-top:24px">{rows}</div></div>
<div class="an"><div class="c12">Every menu</div>{sample}{anat_html}</div>
</div></div>'''


def build(out):
    out["MN-spec.dc.html"] = page("Menus inside a section", 1440, 900, CSS, spec())
    out["MN-who.dc.html"] = page("Jobs, choosing who", 1440, 900, CSS, hide(v3.jobs({"who": who_menu(), "who_label": "Lyle and Callum"})))
    out["MN-sort.dc.html"] = page("Jobs, choosing the order", 1440, 900, CSS, hide(v3.jobs({"sort": sort_menu()})))
    out["MN-actions.dc.html"] = page("A job's Actions", 1440, 900, CSS, hide(v3.job(actions_menu())))
    job = hide(v3.job()).replace('<a class="sr" href="#"><span class="pl">', '<a class="sr on" href="#"><span class="pl">', 1)
    out["MN-new.dc.html"] = page("New, on a job", 1440, 900, CSS, job.replace("</main>", "</main>" + new_menu(), 1))
