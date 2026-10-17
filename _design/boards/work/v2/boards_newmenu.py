"""The New menu, tied to its button: three ways, on a job."""
from base import ico, page
import boards_v3 as v3
from boards_menus import CSS as MCSS, hide, mi

CSS = MCSS + """
.nm2{position:absolute;z-index:6}
.nm2 .nh{display:flex;align-items:center;gap:12px;height:36px;padding:0 8px;font-weight:600}
.nm2 .nh .pl{width:24px;height:24px;border-radius:50%;background:var(--ink);color:#fff;display:inline-flex;align-items:center;justify-content:center;margin:0 -3px}
.nm2 .nh .pl .ico{width:14px;height:14px;color:#fff}
.nm2 .nh .x{margin-left:auto;color:var(--q);display:inline-flex}
.nm2 .nh .x .ico{width:14px;height:14px}
.flow{position:absolute;z-index:6;left:8px;top:60px;filter:drop-shadow(0 12px 32px rgba(10,12,20,.16))}
.flow .rowp{position:absolute;left:0;top:0;width:240px;height:36px;background:#fff;border-radius:10px 0 0 10px;display:flex;align-items:center;gap:12px;padding:0 8px;font-weight:600}
.flow .rowp .pl{width:24px;height:24px;border-radius:50%;background:var(--ink);color:#fff;display:inline-flex;align-items:center;justify-content:center;margin:0 -3px}
.flow .rowp .pl .ico{width:14px;height:14px;color:#fff}
.flow .fil{position:absolute;left:230px;top:36px;width:10px;height:10px;background:radial-gradient(circle at 0 100%,transparent 9.5px,#fff 10px)}
.flow .body2{position:absolute;left:240px;top:0;width:280px;background:#fff;border-radius:0 16px 16px 16px;padding:6px}
"""


def items(ctx=True):
    rows = "".join(mi(i, t) for i, t in [("jobs", "Job"), ("dollar", "Quote"), ("task", "Task"), ("cal", "Event"), ("receipt", "Expense"), ("sun", "Leave")])
    c = (f'<div class="ctx">{v3.dot("Blue")}<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">For 3342 Rifkin, Bellevue Hill</span><span class="x">{ico("x")}</span></div><div class="mdv"></div>' if ctx else "")
    more = mi("doc", "Document", "", f'<span class="r">{ico("right")}</span>') + mi("dots", "More", "", f'<span class="r">{ico("right")}</span>')
    return c + rows + '<div class="mdv"></div>' + more


def base_job(press=True):
    h = hide(v3.job())
    if press:
        h = h.replace('<a class="sr" href="#"><span class="pl">', '<a class="sr on" href="#"><span class="pl">', 1)
    return h


def below():
    menu = f'<div class="ov mn" style="left:8px;top:100px;width:280px">{items()}</div>'
    return base_job().replace("</main>", "</main>" + menu, 1)


def grow():
    menu = f'''<div class="ov mn nm2" style="left:8px;top:60px;width:280px;padding:0 6px 6px">
<div class="nh"><span class="pl">{ico("plus")}</span>New</div><div class="mdv" style="margin-top:0"></div>{items()}</div>'''
    return base_job(False).replace("</main>", "</main>" + menu, 1)


def flow():
    menu = f'''<div class="flow"><div class="rowp"><span class="pl">{ico("plus")}</span>New</div><div class="fil"></div>
<div class="body2 mn" style="position:absolute">{items()}</div></div>'''
    return base_job(False).replace("</main>", "</main>" + menu, 1)


def build(out):
    out["NM-below.dc.html"] = page("New, the menu dropping from the button", 1440, 900, CSS, below())
    out["NM-grow.dc.html"] = page("New, the button opening into the menu", 1440, 900, CSS, grow())
    out["NM-flow.dc.html"] = page("New, the button running into the menu", 1440, 900, CSS, flow())


# ---------------------------------------------------------------- dark, like the panel
DCSS = CSS + """
.dk{background:var(--ink);color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:16px;box-shadow:0 12px 32px rgba(10,12,20,.16)}
.dk .mi{color:#fff}
.dk .mi .ico,.dk .mi .r{color:rgba(255,255,255,.6)}
.dk .mi.on{background:rgba(255,255,255,.12)}
.dk .mdv{background:rgba(255,255,255,.14)}
.dk .ctx{color:#fff}
.dk .ctx .x{color:rgba(255,255,255,.5)}
.dk .nh{background:rgba(255,255,255,.12);border-radius:10px;margin:6px 0 0}
.dk .nh .pl{background:#fff}
.dk .nh .pl .ico{color:var(--ink)}
"""


def dark_items(ctx_text, sub=False):
    rows = "".join(mi(i, t) for i, t in [("jobs", "Job"), ("dollar", "Quote"), ("task", "Task"), ("cal", "Event"), ("receipt", "Expense"), ("sun", "Leave")])
    c = f'<div class="ctx">{v3.dot("Blue")}<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{ctx_text}</span><span class="x">{ico("x")}</span></div><div class="mdv"></div>'
    chev = f'<span class="r">{ico("right")}</span>'
    if sub:
        subm = "".join(mi(i, t) for i, t in [("shield", "SWMS"), ("cert", "Certificate"), ("letter", "Letter")])
        doc = f'<div style="position:relative">{mi("doc", "Document", "on", chev)}<div class="dk mn" style="position:absolute;left:calc(100% + 12px);top:-7px;width:200px">{subm}</div></div>'
    else:
        doc = mi("doc", "Document", "", chev)
    return c + rows + '<div class="mdv"></div>' + doc + mi("dots", "More", "", chev)


def grow_dark(width, ctx_text, sub=False):
    menu = f'''<div class="dk mn nm2" style="left:1px;top:53px;width:{width}px;padding:0 6px 6px">
<div class="nh"><span class="pl">{ico("plus")}</span>New</div><div class="mdv"></div>{dark_items(ctx_text, sub)}</div>'''
    return base_job(False).replace("</main>", "</main>" + menu, 1)


def build_dark(out):
    out["NM-dark.dc.html"] = page("New, opening dark inside the panel", 1440, 900, DCSS, base_job(False).replace("</main>", "</main>" + v3.new_menu_dark("For 3342 Rifkin, Bellevue Hill"), 1))
    out["NM-dark-wide.dc.html"] = page("New, opening dark, a little wider, Document open", 1440, 900, DCSS, grow_dark(296, "For 3342 Rifkin, Bellevue Hill", True))


_b = build


def build(out):
    _b(out)
    build_dark(out)


# ---------------------------------------------------------------- C, dark: the panel reaches out
FCSS = DCSS + """
.fd{position:absolute;z-index:6;left:256px;top:54px;width:300px;background:var(--ink);color:#fff;border-radius:0 16px 16px 0;padding:6px 6px 6px 0;box-shadow:0 12px 32px rgba(10,12,20,.16)}
.fd .jn{position:absolute;left:0;width:10px;height:10px}
.fd .jn.ftop{top:-10px;background:radial-gradient(circle at 100% 0,transparent 9.5px,var(--ink) 10px)}
.fd .jn.fbot{bottom:-10px;background:radial-gradient(circle at 100% 100%,transparent 9.5px,var(--ink) 10px)}
.fd .band{display:flex;align-items:center;gap:8px;height:36px;padding:0 8px 0 12px;background:rgba(255,255,255,.12);border-radius:0 10px 10px 0;font-weight:600}
.fd .band .x{margin-left:auto;color:rgba(255,255,255,.5);display:inline-flex}
.fd .band .x .ico{width:14px;height:14px}
.fd .in{padding-left:6px}
.fd .mi{color:#fff}
.fd .mi .ico,.fd .mi .r{color:rgba(255,255,255,.6)}
.fd .mi.on{background:rgba(255,255,255,.12)}
.fd .mdv{background:rgba(255,255,255,.14)}
"""


def flow_dark():
    h = base_job(False)
    a = '<a class="sr" href="#"><span class="pl">'
    assert a in h
    h = h.replace(a, '<a class="sr on" href="#" style="border-radius:10px 0 0 10px;margin-right:-8px"><span class="pl">', 1)
    rows = "".join(mi(i, t) for i, t in [("jobs", "Job"), ("dollar", "Quote"), ("task", "Task"), ("cal", "Event"), ("receipt", "Expense"), ("sun", "Leave")])
    chev = f'<span class="r">{ico("right")}</span>'
    menu = f'''<div class="fd"><i class="jn ftop"></i><i class="jn fbot"></i>
<div class="band">{v3.dot("Blue")}<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">For 3342 Rifkin, Bellevue Hill</span><span class="x">{ico("x")}</span></div>
<div class="in"><div class="mdv"></div>{rows}<div class="mdv"></div>{mi("doc", "Document", "", chev)}{mi("dots", "More", "", chev)}</div></div>'''
    return h.replace("</main>", "</main>" + menu, 1)


_b2 = build


def build(out):
    _b2(out)
    out["NM-flow-dark.dc.html"] = page("New, the panel reaching out into the menu", 1440, 900, FCSS, v3.with_new_menu_old(base_job(False), "For 3342 Rifkin, Bellevue Hill"))
