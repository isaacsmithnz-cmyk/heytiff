"""Options for the two rows inside Jobs: the views of the list (All, To book...)
and the sections of a job (Overview, Quote...), with Claude's own equivalents."""
from base import ico, page
import boards_v3 as v3
from boards_menus import CSS as MCSS, hide, OK


def show_menu():
    rows = "".join(f'<a class="mi{" cur" if i == 0 else ""}" href="#">{n}<span class="r" style="margin-left:auto">{c}</span>{OK if i == 0 else "<span style=width:16px></span>"}</a>' for i, (n, c) in enumerate(v3.VIEWS))
    return f'<div class="ov mn" style="top:40px;left:0;width:240px">{rows}</div>'


def build(out):
    out["VO-chips.dc.html"] = page("Views as outlined chips", 1440, 900, MCSS, hide(v3.jobs(views="chips")))
    out["VO-soft.dc.html"] = page("Views as soft tabs", 1440, 900, MCSS, hide(v3.jobs(views="soft")))
    out["VO-menu.dc.html"] = page("Views in a Show menu", 1440, 900, MCSS, hide(v3.jobs({"show": show_menu()}, views="menu")))
    out["VO-side.dc.html"] = page("Views in the sidebar", 1440, 900, MCSS, hide(v3.jobs(views="side")))
    out["SO-under.dc.html"] = page("Sections underlined", 1440, 900, MCSS, hide(v3.job(sections="under")))
    out["SO-soft.dc.html"] = page("Sections as soft tabs", 1440, 900, MCSS, hide(v3.job(sections="soft")))
    out["SO-side.dc.html"] = page("Sections down the left", 1440, 900, MCSS, hide(v3.job(sections="side")))


# ---------------------------------------------------------------- more options
XCSS = MCSS + """
.pipe{display:inline-flex;align-items:center;gap:4px}
.pipe a{height:32px;padding:0 10px;border-radius:10px;font-size:13px;line-height:18px;font-weight:500;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.pipe a .c{color:var(--q)}
.pipe a.on{background:var(--sel);font-weight:600}
.pipe .ps{width:12px;height:1px;background:rgba(5,5,5,.2);flex:none}
.hub{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-top:20px}
.hub a{border:1px solid var(--line);border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;position:relative}
.hub a b{font-weight:600}
.hub a span{font-size:13px;line-height:18px;color:var(--q)}
.hub a .ico{position:absolute;top:14px;right:12px;width:14px;height:14px;color:var(--q)}
.qt{display:grid;grid-template-columns:minmax(0,1fr) 60px 110px;gap:16px;padding:10px 0;border-bottom:1px solid var(--line)}
.qt span:last-child{text-align:right;font-variant-numeric:tabular-nums}
"""
WHO = '<span><span class="qq">Who</span> Anyone</span>'
SORT = '<span><span class="qq">Sort</span> Next first</span>'


def title_menu():
    rows = "".join(f'<a class="mi{" cur" if i == 0 else ""}" href="#">{"All jobs" if n == "All" else n}<span class="r" style="margin-left:auto">{c}</span>{OK if i == 0 else "<span style=width:16px></span>"}</a>' for i, (n, c) in enumerate(v3.VIEWS))
    return f'<div class="ov mn" style="top:44px;left:0;width:260px">{rows}</div>'


def vo_title():
    h = v3.jobs(views="none")
    h = h.replace('<h1 class="t24">Jobs</h1>', f'<span style="position:relative;display:inline-flex"><h1 class="t24" style="display:inline-flex;align-items:center;gap:8px">All jobs{ico("down", "ico", "width:20px;height:20px")}</h1>{title_menu()}</span>', 1)
    return hide(h)


def vo_pipe():
    h = v3.jobs(views="none")
    who, sort = v3.selfield(WHO), v3.selfield(SORT)
    assert who in h and sort in h
    h = h.replace(who, "", 1).replace(sort, "", 1)
    kind = v3.selfield('<span><span class="qq">Kind</span> Any</span>')
    h = h.replace('<span class="fi" style="width:320px">', kind + who + sort + '<span class="fi" style="width:220px">', 1)
    pipe = [("All", 142), ("Enquiry", 12), ("Quoted", 23), ("Accepted", 19), ("Booked", 31), ("On site", 4), ("Done", 8), ("Invoiced", 11)]
    items = []
    for i, (n, c) in enumerate(pipe):
        items.append(f'<a class="{"on" if i == 0 else ""}" href="#">{n}<span class="c">{c}</span></a>')
    strip = '<span class="pipe">' + items[0] + '<span style="width:12px"></span>' + '<span class="ps"></span>'.join(items[1:]) + '</span>'
    row = '<div style="display:flex;gap:8px;margin-top:16px;align-items:center"><span style="flex:1"></span>'
    assert row in h
    h = h.replace(row, '<div style="display:flex;gap:8px;margin-top:16px;align-items:center">' + strip + '<span style="flex:1"></span>', 1)
    return hide(h)


def so_plain():
    h = v3.job(sections="soft")
    a = '<nav class="vws" style="margin-top:16px;display:flex">'
    assert a in h
    return hide(h.replace(a, '<nav class="vwp" style="margin:16px 0 0 -10px;display:flex;padding-bottom:4px;border-bottom:1px solid var(--line)">', 1))


def so_counts():
    return hide(v3.job(sections="counts"))


def so_jump():
    lines = [("Daikin FTXM35 3.5 kW split, main bedroom", "1", "$2,180"), ("Daikin FTXM50 5 kW split, living", "1", "$2,960"), ("Install, two heads, pipe through the robe", "1", "$3,900"), ("Isolator on the deck, variation", "1", "$480")]
    rows = "".join(f'<div class="qt"><span>{a}</span><span class="qq">{b}</span><span>{c}</span></div>' for a, b, c in lines)
    q = f'''<div style="padding:32px 40px 0"><div style="display:flex;align-items:baseline;gap:12px;border-top:1px solid var(--line);padding-top:24px"><h2 class="t20">Quote</h2><span class="qq">Version 2, accepted 2 October</span><span style="flex:1"></span><a class="lk l13" href="#">Open the quote</a></div><div style="margin-top:8px">{rows}</div></div>'''
    h = v3.job()
    return hide(h.replace("</div></main>", q + "</div></main>", 1))


def so_hub():
    h = v3.job(sections="none")
    cards = [("Quote", "$9,840, accepted"), ("Visits", "Day 1 of 1, today"), ("Checklist", "8 of 14 done"), ("Photos", "24, six today"), ("Documents", "SWMS 2 of 3 signed"), ("Billing", "$4,920 to invoice")]
    hub = '<div class="hub">' + "".join(f'<a href="#"><b>{t}</b><span>{f}</span>{ico("right")}</a>' for t, f in cards) + '</div><div style="height:4px;border-bottom:1px solid var(--line)"></div>'
    a = '<div style="height:16px;border-bottom:1px solid var(--line)"></div>'
    assert a in h
    return hide(h.replace(a, hub, 1))


def build_more(out):
    out["VO-plain.dc.html"] = page("Views as plain words", 1440, 900, XCSS, hide(v3.jobs(views="soft")).replace('class="vws"', 'class="vwp"', 1))
    out["VO-pipe.dc.html"] = page("Views as the stages of a job", 1440, 900, XCSS, vo_pipe())
    out["VO-title.dc.html"] = page("Views in the title", 1440, 900, XCSS, vo_title())
    out["VO-grouped.dc.html"] = page("No views: the list grouped", 1440, 900, XCSS, hide(v3.jobs(views="grouped")))
    out["SO-plain.dc.html"] = page("Sections as plain words", 1440, 900, XCSS, so_plain())
    out["SO-counts.dc.html"] = page("Sections with what's in them", 1440, 900, XCSS, so_counts())
    out["SO-jump.dc.html"] = page("One long page, the row jumps", 1440, 900, XCSS, so_jump())
    out["SO-hub.dc.html"] = page("No tabs: a card for each section", 1440, 900, XCSS, so_hub())


_build = build


def build(out):
    _build(out)
    build_more(out)
