"""Where the white page meets the ink: the curls we have, and five other ways
to give HeyTiff a feel of its own. Same Home, nothing open, on each."""
from base import page
from boards_home2 import sidebar as h2_sidebar
import boards_tabs2 as tw

CSS = tw.CSS + """
.f0 .pg{border-radius:16px 0 0 16px}
/* A: a floating sheet, ink all round */
.fA .pg{margin:10px 10px 10px 0;border-radius:16px}
/* B: a rising sheet, like the phone's, square at the foot */
.fB .pg{margin:10px 10px 0 0;border-radius:16px 16px 0 0}
/* C: the menu holds the page: the row you're on is paper and runs into it */
.fC .pg{border-radius:0}
.fC .sd{padding-right:0}
.fC .sr,.fC .rc,.fC .me,.fC .br{margin-right:8px}
.fC .sr.on{position:relative;margin-right:0;background:#fff;color:#050505;border-radius:10px 0 0 10px}
.fC .sr.on .ico,.fC .sr.on .r{color:#050505}
.fC .sr.on::before,.fC .sr.on::after{content:"";position:absolute;right:0;width:10px;height:10px}
.fC .sr.on::before{top:-10px;background:radial-gradient(circle at 0 0,transparent 9.5px,#fff 10px)}
.fC .sr.on::after{bottom:-10px;background:radial-gradient(circle at 0 100%,transparent 9.5px,#fff 10px)}
/* D: the chevron cut: the page's left corners cut at the mark's own angle */
.fD .pg{border-radius:0;clip-path:polygon(20px 0,100% 0,100% 100%,20px 100%,0 calc(100% - 24px),0 24px)}
/* E: one long sweep at the top, square at the foot */
.fE .pg{border-radius:40px 0 0 0}
"""

VARIANTS = [
    ("0", "Now: the two curls"),
    ("A", "A. Floating sheet: ink all round, four round corners"),
    ("B", "B. Rising sheet: square at the foot, like the phone"),
    ("C", "C. The menu holds the page: the row you're on runs into it"),
    ("D", "D. Chevron cut: the corners cut at the Tiff mark's angle"),
    ("E", "E. One long sweep at the top, square at the foot. Chosen"),
]


def board(key):
    return f'''<div class="hz vH f{key}" style="width:1440px;height:900px">{tw.MARK_DEFS}
{h2_sidebar()}
<main class="pg">
{tw.header("H", [], None)}
{tw.home_body()}
</main>
</div>'''


def build(out):
    for key, title in VARIANTS:
        out[f"FR-{key}.dc.html"] = page(title, 1440, 900, CSS, board(key))
