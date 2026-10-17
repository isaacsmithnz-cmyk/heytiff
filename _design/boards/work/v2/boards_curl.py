"""The ink panel curling back at the foot: the page curls into the ink at the
top, and the ink curls into the page at the bottom, the same 40 each way."""
from base import page
import boards_v3 as v3

CSS = v3.CSS + """
.v3.cl{background:linear-gradient(to bottom,var(--ink) 50%,#fff 50%)}
.v3.cl .sd{background:var(--ink);border-radius:0 0 40px 0;padding-bottom:16px}
.v3.old{background:var(--ink)}
.v3.old .sd{border-radius:0;padding-bottom:8px}
.zm{position:relative;width:600px;height:600px;overflow:hidden;border-radius:16px;box-shadow:0 0 0 1px rgba(5,5,5,.14)}
.zm .v3{position:absolute;left:0;top:0;transform-origin:0 0}
.cu{font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#050505;padding:64px 80px;box-sizing:border-box;width:1440px;height:900px;background:#fff}
.cu h1{margin:0 0 8px;font-size:24px;line-height:32px;font-weight:600}
.cu p{margin:0;font-size:16px;line-height:24px;color:#5f6a79}
.cu .pair{display:flex;gap:80px;margin-top:40px}
.cu .lb{margin-top:16px;font-size:16px;line-height:24px;font-weight:600}
.cu .lb span{display:block;font-weight:400;color:#5f6a79}
"""


def curl(html):
    return html.replace('class="v3"', 'class="v3 cl"', 1).replace('<i class="cf"', '<i class="cf" hidden')


def plain(html):
    return html.replace('class="v3"', 'class="v3 old"', 1).replace('<i class="cf"', '<i class="cf" hidden')


def zoom(html, x, y, s=3):
    return f'<div class="zm"><div style="position:absolute;left:{-x * s}px;top:{-y * s}px;width:1440px;height:900px;transform:scale({s});transform-origin:0 0">{html}</div></div>'


def detail():
    h = curl(v3.home())
    return f'''<div class="cu">
<h1>Both corners, three times the size</h1>
<p>At the top the white page curls into the ink. At the foot the ink curls back into the page, the same 40 the other way.</p>
<div class="pair">
<div>{zoom(h, 156, 0)}<div class="lb">Top left of the page<span>The page curls into the ink</span></div></div>
<div>{zoom(h, 156, 700)}<div class="lb">Bottom right of the ink<span>The ink curls into the page</span></div></div>
</div></div>'''


def build(out):
    out["CU-home.dc.html"] = page("Home, the ink curling back at the foot", 1440, 900, CSS, curl(v3.home()))
    out["CU-job.dc.html"] = page("A job, the ink curling back at the foot", 1440, 900, CSS, curl(v3.job()))
    out["CU-schedule.dc.html"] = page("Schedule, the ink curling back at the foot", 1440, 900, CSS, curl(v3.schedule()))
    out["CU-detail.dc.html"] = page("Both corners up close", 1440, 900, CSS, detail())
    out["CU-now.dc.html"] = page("Home now: the top curve only", 1440, 900, CSS, plain(v3.home()))
