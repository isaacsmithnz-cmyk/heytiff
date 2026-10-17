"""Tabs on the white page: no dark top bar. The header keeps the date with the
time beside it on the left, and the tabs sit on the right of the same row.
Four styles on one conversation, then the first style in use. Desktop only."""
from base import ico, page
from boards_home2 import MARK_DEFS, tiff, box, today_rows, todo_rows, convo, sidebar as h2_sidebar
import boards_tabs as bt

CSS = bt.CSS + """
.th{height:56px;flex:none;display:flex;align-items:center;gap:8px;padding:0 16px 0 32px;position:relative}
.th .dt{font-weight:500;white-space:nowrap}
.th .tm{color:#5f6a79;font-weight:500;white-space:nowrap;margin-left:4px}
.th .sp{flex:1;min-width:24px}
.tw{display:flex;align-items:center;gap:4px;min-width:0}
.tt{position:relative;height:32px;flex:0 1 auto;max-width:232px;min-width:0;display:flex;align-items:center;gap:8px;padding:0 10px;border-radius:10px;font-size:13px;line-height:18px;font-weight:500;color:#5f6a79;white-space:nowrap}
.tt .ti{overflow:hidden;text-overflow:ellipsis;min-width:0}
.tt .ico{width:16px;height:16px;color:#5f6a79;flex:none}
.tt .x{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none;color:#5f6a79;margin:0 -4px 0 auto}
.tt .x .ico{width:14px;height:14px}
.tnew{height:32px;padding:0 10px;border-radius:10px;display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:18px;font-weight:500;color:#5f6a79;white-space:nowrap;flex:none}
.tnew .ico{width:14px;height:14px}
.tsp{width:1px;height:16px;background:rgba(5,5,5,.12);flex:none}
.tsp.hide{background:transparent}
/* A: soft pills, the selection tint */
.vA .tt.on{background:rgba(5,5,5,.07);color:#050505;font-weight:600}
.vA .tt.on .ico{color:#050505}
/* B: folder tabs standing on the header's line */
.vB .th{border-bottom:1px solid rgba(5,5,5,.08);align-items:flex-end}
.vB .th .dt,.vB .th .tm{align-self:center}
.vB .tw{gap:0}
.vB .tt{height:40px;flex:0 0 188px;border-radius:10px 10px 0 0;border:1px solid transparent;border-bottom:0;padding:0 10px 0 14px}
.vB .tt.on{border-color:rgba(5,5,5,.12);background:#fff;color:#050505;font-weight:600;height:41px;margin-bottom:-1px}
.vB .tt.on .ico{color:#050505}
.vB .tsp{margin-bottom:12px;align-self:flex-end}
.vB .tnew{align-self:flex-end;margin-bottom:4px}
/* C: light Chrome, a pale band with the tab you're on cut into the page */
.vC .th{background:#F0F2F5;align-items:flex-end}
.vC .th .dt,.vC .th .tm{align-self:center}
.vC .tw{gap:0;padding-right:4px}
.vC .tt{height:38px;flex:0 0 188px;border-radius:10px 10px 0 0;padding:0 10px 0 14px}
.vC .tt.on{background:#fff;color:#050505;font-weight:600}
.vC .tt.on .ico{color:#050505}
.vC .tt.on::before,.vC .tt.on::after{content:"";position:absolute;bottom:0;width:10px;height:10px}
.vC .tt.on::before{left:-10px;background:radial-gradient(circle at 0 0,transparent 9.5px,#fff 10px)}
.vC .tt.on::after{right:-10px;background:radial-gradient(circle at 100% 0,transparent 9.5px,#fff 10px)}
.vC .tsp{margin-bottom:11px;align-self:flex-end;background:rgba(5,5,5,.16)}
.vC .tnew{align-self:flex-end;margin-bottom:3px}
/* E: light Chrome, the pale band only as wide as the tabs, flaring into the page */
.vE .th{align-items:flex-end;padding-right:0}
.vE .th .dt,.vE .th .tm{align-self:center}
.vE .tw{position:relative;height:46px;align-items:flex-end;gap:0;padding:0 12px 0 14px;background:#F0F2F5;border-radius:16px 0 0 0}
.vE .tw::before{content:"";position:absolute;left:-16px;bottom:0;width:16px;height:16px;background:radial-gradient(circle at 0 0,transparent 15.5px,#F0F2F5 16px)}
.vE .tt{height:36px;flex:0 0 auto;min-width:132px;border-radius:10px 10px 0 0;padding:0 10px 0 14px}
.vE .tt.on{background:#fff;color:#050505;font-weight:600}
.vE .tt.on .ico{color:#050505}
.vE .tt.on::before,.vE .tt.on::after{content:"";position:absolute;bottom:0;width:10px;height:10px}
.vE .tt.on::before{left:-10px;background:radial-gradient(circle at 0 0,transparent 9.5px,#fff 10px)}
.vE .tt.on::after{right:-10px;background:radial-gradient(circle at 100% 0,transparent 9.5px,#fff 10px)}
.vE .tsp{margin-bottom:10px;align-self:flex-end;background:rgba(5,5,5,.16)}
.vE .tnew{align-self:flex-end;margin:0 0 4px 6px}
/* H: all white, a hairline round each tab */
.vH .tw{gap:6px}
.vH .tt{height:32px;border:1px solid rgba(5,5,5,.14);border-radius:10px;padding:0 8px 0 10px;background:#fff}
.vH .tt.on{border-color:#050505;color:#050505;font-weight:600}
.vH .tt.on .ico{color:#050505}
.vH .tnew{margin-left:2px}
.tplus{width:32px;height:32px;border:1px solid rgba(5,5,5,.14);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;color:#050505;flex:none}
.tplus .ico{width:16px;height:16px}
/* D: the ink pill */
.vD .tt.on{background:#050505;color:#fff;font-weight:600}
.vD .tt.on .ico,.vD .tt.on .x{color:rgba(255,255,255,.6)}
"""

TABS = [bt.HOME_T, (bt.I("chat"), "Riverview brief"), bt.DESIGN_T, bt.JOB61_T]
WORKING = (tiff(16, True), "Riverview brief")
# which styles show the cross on every tab, not just the one you're on
X_ALL = {"B": True, "C": True, "E": True, "H": True}


def tabs(style, items, on, nt="text"):
    out = []
    for i, (ic, t) in enumerate(items):
        if i and style in ("B", "C", "E"):
            out.append(f'<i class="tsp{" hide" if on in (i - 1, i) else ""}"></i>')
        x = f'<span class="x" aria-label="Close {t}">{ico("x")}</span>' if (i == on or X_ALL.get(style)) else ""
        out.append(f'<div class="tt{" on" if i == on else ""}" role="tab" aria-selected="{"true" if i == on else "false"}">{ic}<span class="ti">{t}</span>{x}</div>')
    btn = {"text": f'<span class="tnew">{ico("plus")}New tab</span>',
           "plus": f'<span class="tplus" aria-label="New tab">{ico("plus")}</span>',
           None: ""}[nt]
    return f'<nav class="tw" role="tablist" aria-label="Open tabs">{"".join(out)}{btn}</nav>'


def header(style, items, on, time="10:05 am", nt="text"):
    return f'<header class="th"><span class="dt">Tuesday 13 October</span><span class="tm">{time}</span><span class="sp"></span>{tabs(style, items, on, nt)}</header>'


def frame(style, side, items, on, body, time="10:05 am", nt="text"):
    return f'''<div class="hz v{style}" style="width:1440px;height:900px">{MARK_DEFS}
{side}
<main class="pg">
{header(style, items, on, time, nt)}
{body}
</main>
</div>'''


def convo_body():
    return f'''<div style="flex:1;min-height:0;overflow:hidden">
    <div class="col" style="display:flex;flex-direction:column;gap:24px;padding-top:16px">{convo()}</div>
  </div>
  <div class="col" style="padding-bottom:24px">{box("Reply to Tiff")}</div>'''


def home_body():
    return f'''<div class="col" style="padding-top:12px">
    <div style="display:flex;justify-content:center;margin-bottom:16px">{tiff(52)}</div>
    {box()}
    <div class="sh"><h2 class="h16">Today</h2><span class="q">4 jobs and a task</span><span style="flex:1"></span><a class="lk" href="#">Schedule</a></div>
    {today_rows()}
    <div class="sh"><h2 class="h16">To do</h2><span class="q">9</span><span style="flex:1"></span><a class="lk" href="#">Show all</a></div>
    {todo_rows(4).replace("Brief saved yesterday, 8:40 am", "Brief saved today, 8:40 am")}
  </div>'''


def build(out):
    working = [TABS[0], WORKING, TABS[2], TABS[3]]
    side_convo = h2_sidebar(home_on=False, convo_on=True)
    for s, name in [("A", "soft pills"), ("B", "folder tabs on a line"), ("C", "light Chrome"), ("D", "the ink pill")]:
        out[f"TW-{s}.dc.html"] = page(f"Tabs on white, {name}", 1440, 900, CSS,
                                      frame(s, side_convo, working, 1, convo_body(), "8:41 am"))
    out["TW-A-home.dc.html"] = page("Tabs on white, soft pills, on Home", 1440, 900, CSS,
                                    frame("A", h2_sidebar(), TABS, 0, home_body()))
    out["TW-A-design.dc.html"] = page("Tabs on white, soft pills, designing", 1440, 900, CSS,
                                      frame("A", bt.sidebar("design"), TABS, 2, bt.design_body()))
    out["TW-A-job.dc.html"] = page("Tabs on white, soft pills, the job", 1440, 900, CSS,
                                   frame("A", bt.sidebar("jobs"), TABS, 3, bt.job61_body()))

    side_convo = h2_sidebar(home_on=False, convo_on=True)
    out["TW-E.dc.html"] = page("Tabs on white, light Chrome as wide as the tabs", 1440, 900, CSS,
                               frame("E", side_convo, working, 1, convo_body(), "8:41 am"))
    out["TW-E-home.dc.html"] = page("Light Chrome as wide as the tabs, on Home", 1440, 900, CSS,
                                    frame("E", h2_sidebar(), TABS, 0, home_body()))
    out["TW-E-design.dc.html"] = page("Light Chrome as wide as the tabs, designing", 1440, 900, CSS,
                                      frame("E", bt.sidebar("design"), TABS, 2, bt.design_body()))
    out["TW-E-job.dc.html"] = page("Light Chrome as wide as the tabs, the job", 1440, 900, CSS,
                                   frame("E", bt.sidebar("jobs"), TABS, 3, bt.job61_body()))

    out["TW-H-empty.dc.html"] = page("Hairline tabs: nothing open but Home", 1440, 900, CSS,
                                     frame("H", h2_sidebar(), [], None, home_body()))
    out["TW-H.dc.html"] = page("Hairline tabs: a conversation", 1440, 900, CSS,
                               frame("H", side_convo, working, 1, convo_body(), "8:41 am"))
    out["TW-H-design.dc.html"] = page("Hairline tabs: designing", 1440, 900, CSS,
                                      frame("H", bt.sidebar("design"), TABS, 2, bt.design_body()))
    out["TW-H-job.dc.html"] = page("Hairline tabs: the job", 1440, 900, CSS,
                                   frame("H", bt.sidebar("jobs"), TABS, 3, bt.job61_body()))
    out["TW-H-plus-empty.dc.html"] = page("Hairline tabs, a plus for a new tab: nothing open", 1440, 900, CSS,
                                          frame("H", h2_sidebar(), [], None, home_body(), nt="plus"))
    out["TW-H-plus.dc.html"] = page("Hairline tabs, a plus for a new tab", 1440, 900, CSS,
                                    frame("H", side_convo, working, 1, convo_body(), "8:41 am", nt="plus"))
    out["TW-H-none-empty.dc.html"] = page("Hairline tabs, no new-tab button: nothing open", 1440, 900, CSS,
                                          frame("H", h2_sidebar(), [], None, home_body(), nt=None))
