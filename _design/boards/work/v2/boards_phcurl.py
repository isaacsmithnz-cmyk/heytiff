"""The two curves on a phone: no sidebar, so the ink is a band across the top.
Three ways to carry the curves over, and the menu, which is the sidebar itself."""
from base import ico, page
import boards_v3 as v3
from boards_home2 import MARK_DEFS, mark_svg
from boards_trim import tiff_mono, MONO_DEFS

CSS = v3.CSS + """
.php{width:390px;height:844px;display:flex;flex-direction:column;position:relative;overflow:hidden}
.php .tb{flex:none;display:flex;align-items:center;gap:8px;padding:0 12px 0 8px;color:#fff;background:var(--ink)}
.php .pp{flex:1;min-height:0;background:#fff;display:flex;flex-direction:column;overflow:hidden}
.php.know{background:var(--ink)} .php.know .tb{height:56px} .php.know .pp{border-radius:16px 16px 0 0}
.php.ka{background:linear-gradient(to right,var(--ink) 50%,#fff 50%)} .php.ka .tb{height:64px;padding-right:32px;border-radius:0 0 40px 0} .php.ka .pp{border-radius:40px 0 0 0}
.php.kb{background:var(--ink)} .php.kb .tb{height:56px} .php.kb .pp{border-radius:40px 0 0 0}
.php .scr{z-index:4}
.php .sd{position:absolute;left:0;top:0;bottom:0;width:300px;z-index:5}
"""


def body():
    rows = "".join(f'<div class="rw" style="gap:10px"><span class="l13 qq nm" style="width:72px">{tm}</span>{v3.dot(c)}<div class="m"><div class="t">{t}</div><div class="s">{s}</div></div>{r}</div>' for tm, c, t, s, r in [("7:30", "Green", "Kingsford Bakery", "Service, you", '<span class="st good l13">Done</span>'), ("9:00", "Blue", "Bellevue Hill", "Installation, Lyle", '<span class="st good l13">On now</span>'), ("12:45", "Orange", "Riverview", "Quote, Dan", ""), ("2:45", "Green", "Randwick Dental", "Service, you", "")])
    return f'''<div style="height:48px;flex:none;display:flex;align-items:flex-end;padding:0 16px 4px 24px;font-weight:500">Tuesday 13 October<span class="qq" style="margin-left:8px">10:05 am</span></div>
    <div style="flex:1;min-height:0;padding:0 16px;overflow:hidden"><div style="display:flex;align-items:baseline;gap:12px;margin:12px 0 4px"><h2 class="t16">Today</h2><span style="flex:1"></span><a class="lk l13" href="#">Schedule</a></div>{rows}</div>
    <div class="box" style="margin:8px 12px 12px;border-radius:20px;padding:12px">
      <div style="display:flex;align-items:center;gap:10px;min-height:32px">{tiff_mono(26)}<span class="r16 qq">What's happening on site?</span></div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px"><span class="b lg sec" style="padding:0 14px">{ico("camera")}Photo</span><span class="ib lg">{ico("mic")}</span><span style="flex:1"></span><span class="b lg go">Send</span></div>
    </div>'''


def bar():
    return f'<div class="tb"><span class="ib bare lg" style="background:transparent;color:#fff">{ico("menu")}</span>{mark_svg()}<b style="font-size:16px;font-weight:700">HeyTiff</b><span style="flex:1"></span><span class="b" style="height:40px;background:#fff;color:var(--ink)">{ico("plus")}New</span></div>'


def phone(kind, extra=""):
    return f'<div class="v3 php {kind}" style="width:390px;height:844px">{MARK_DEFS}{MONO_DEFS}{bar()}<div class="pp">{body()}</div>{extra}</div>'


def menu():
    side = v3.sidebar("home").replace(ico("panel"), ico("x"))
    return phone("ka", '<div class="scr"></div>' + side)


def build(out):
    out["PH-now.dc.html"] = page("Phone now: both top corners round", 390, 844, CSS, phone("know"))
    out["PH-a.dc.html"] = page("A. The same S, turned on its side", 390, 844, CSS, phone("ka"))
    out["PH-b.dc.html"] = page("B. The top curve only. Chosen", 390, 844, CSS, phone("kb"))
    out["PH-menu.dc.html"] = page("The menu: the sidebar itself, curling at its foot", 390, 844, CSS, menu())
