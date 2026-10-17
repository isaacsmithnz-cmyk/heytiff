"""Colour cut down to eight hues that pop, the main button without ink, a
job's colour without the wash and the edge line, and Tiff's mark in black and
white."""
from base import ico, page
from boards_home2 import tiff, MARK_DEFS, R, HX, HY, mark_svg
import boards_system as bs

# eight hues: the pop (fills, dots, marks, blocks) and the word (text on white)
HUES = [
    ("Red", "#EF4444", "#BE123C"),
    ("Orange", "#F97316", "#B45309"),
    ("Yellow", "#FACC15", "#A16207"),
    ("Green", "#22C55E", "#15803D"),
    ("Blue", "#2563EB", "#2563EB"),
    ("Purple", "#A855F7", "#7E22CE"),
    ("Pink", "#EC4899", "#9D174D"),
    ("Grey", "#9CA3AF", "#5f6a79"),
]
H = {n: (p, w) for n, p, w in HUES}


def on(name):
    """The label colour on a solid block of this hue: ink on every one but blue."""
    return "#fff" if name == "Blue" else "#050505"


MONO_DEFS = f'''<svg class="tiffbtn-defs" width="0" height="0" aria-hidden="true"><defs>
<linearGradient id="tRunK" gradientUnits="userSpaceOnUse" x1="{50 + R}" y1="50" x2="{HX:.3f}" y2="{HY:.3f}"><stop offset="0" stop-color="#050505" stop-opacity="0"/><stop offset=".6" stop-color="#050505" stop-opacity=".9"/><stop offset="1" stop-color="#050505"/></linearGradient>
<linearGradient id="tRunW" gradientUnits="userSpaceOnUse" x1="{50 + R}" y1="50" x2="{HX:.3f}" y2="{HY:.3f}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".6" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff"/></linearGradient>
</defs></svg>'''


def tiff_mono(size, ink=False, working=False):
    c = "#ffffff" if ink else "#050505"
    run = "url(#tRunW)" if ink else "url(#tRunK)"
    s = tiff(size, working)
    s = s.replace("url(#tFace)", c).replace("url(#tDepth)", c).replace("url(#tRunA)", run).replace("url(#tRunB)", run)
    s = s.replace("stroke:#00A389", f"stroke:{c}").replace("stroke:#2E68FF", f"stroke:{c}")
    if not ink:
        s = s.replace('class="tiffmk', 'style="--tiffbtn-sheen:rgba(255,255,255,.55);--tiffbtn-sheen-hi:rgba(255,255,255,.8)" class="tiffmk', 1)
    return s


CSS = bs.CSS + """
.pop{height:88px;border-radius:10px;display:flex;align-items:flex-end;justify-content:space-between;padding:10px 12px;font-weight:600}
.wd{font-weight:500;font-size:14px;line-height:20px}
.mt{display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px;padding:14px 0;border-bottom:1px solid rgba(5,5,5,.08);align-items:center}
.mt .nm{font-weight:600}
.mt .nm span{display:block;font-size:13px;line-height:18px;font-weight:500;color:#5f6a79;margin-top:2px}
.tags{display:flex;flex-wrap:wrap;gap:8px 20px}
.tg2{display:inline-flex;align-items:center;gap:8px;font-size:13px;line-height:18px;font-weight:500;white-space:nowrap}
.dt{width:10px;height:10px;border-radius:50%;flex:none;display:inline-block}
.sq{width:10px;height:10px;border-radius:3px;flex:none;display:inline-block}
.cnt{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:16px}
.big{font-size:40px;line-height:48px;font-weight:700;letter-spacing:-.4px;font-variant-numeric:tabular-nums}
.opt{border:1px solid rgba(5,5,5,.08);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:16px}
.opt h3{font-size:16px;line-height:24px;font-weight:600}
.ctx{border-top:1px solid rgba(5,5,5,.08);padding-top:14px;display:flex;flex-direction:column;gap:10px}
.ctx .lb{font-size:12px;line-height:16px;font-weight:500;color:#5f6a79}
.b.blue{background:#2563EB;color:#fff}
.b.inko{background:#fff;border:1.5px solid #050505;color:#050505}
.b.grey{background:#EDEFF3;color:#050505}
.b.tintb{background:rgba(37,99,235,.1);color:#1D4ED8}
.lane2{display:grid;grid-template-columns:120px minmax(0,1fr);height:64px;border-bottom:1px solid rgba(5,5,5,.08)}
.blk2{position:absolute;top:8px;bottom:8px;border-radius:10px;padding:6px 10px;overflow:hidden;white-space:nowrap;font-size:13px;line-height:18px}
.blk2 b{display:flex;align-items:center;gap:6px;font-weight:600;overflow:hidden;text-overflow:ellipsis}
.blk2 span{display:block;font-size:12px;line-height:16px;font-weight:500;overflow:hidden;text-overflow:ellipsis}
.blk2.w{background:#fff;border:1px solid rgba(5,5,5,.14);color:#050505}
.blk2.w span{color:#5f6a79}
.agr{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid rgba(5,5,5,.08)}
.agr .tm{width:104px;font-size:13px;line-height:18px;font-weight:500;color:#5f6a79}
.agr .m{flex:1;min-width:0}
.agr .t{font-weight:600}
.panel{border:1px solid rgba(5,5,5,.08);border-radius:16px;padding:20px}
.panel h3{font-size:16px;line-height:24px;font-weight:600;margin-bottom:4px}
.inkp{background:#050505;border-radius:16px;padding:20px;color:#fff}
"""


def wrap(inner, h):
    return f'<div class="sy" style="min-height:{h}px">{MARK_DEFS}{MONO_DEFS}{inner}</div>'


# ------------------------------------------------------------------ colour, cut down
def colour_trim():
    hues = "".join(
        f'<div class="sw"><div class="pop" style="background:{p};color:{on(n)}"><span>{n}</span><span style="font-weight:500;font-size:12px">Aa</span></div>'
        f'<div><div class="vl">Pop {p.lower()}</div><div class="wd" style="color:{w}">Word {w.lower()}</div></div></div>'
        for n, p, w in HUES)
    neutrals = "".join([
        bs_sw("#050505", "Ink", "#050505", "Text, the frame, focus"),
        bs_sw("#ffffff", "White", "#ffffff", "The page"),
        bs_sw("#5f6a79", "Quiet", "#5f6a79", "Second lines, labels"),
        bs_sw("rgba(5,5,5,.08)", "Line", "ink at 8%", "Hairlines; 14% for edges"),
    ])

    def tags(pairs):
        return '<div class="tags">' + "".join(f'<span class="tg2"><span class="dt" style="background:{H[h][0]}"></span>{label}</span>' for label, h in pairs) + "</div>"
    uses = [
        ("State", "Always a word in the word colour", tags([("Good", "Green"), ("Needs a look", "Orange"), ("Wrong or late", "Red"), ("For your information", "Grey")])),
        ("Kinds of job", "Analytics' series, in this order", tags([("Split", "Blue"), ("Multi", "Orange"), ("Ducted", "Green"), ("VRF", "Purple"), ("Service", "Pink"), ("Maintenance", "Yellow"), ("Ventilation", "Grey")])),
        ("Timesheet days", "In Team, with the key. Leave is a sun and sick a plaster, on a white card", tags([("Normal day", "Green"), ("Over hours", "Orange"), ("Under hours", "Pink"), ("Public holiday", "Purple"), ("Day off", "Grey")])),
        ("Pipe sizes", "In Design, with the key", tags([("1", "Blue"), ("2", "Purple"), ("3", "Pink"), ("4", "Orange"), ("5", "Green"), ("6", "Yellow"), ("7", "Grey")]).replace("</div>", '<span class="tg2"><span class="dt" style="background:#050505"></span>8, in ink</span></div>')),
        ("ServiceM8 categories", "Each snapped to the nearest hue", tags([("Installation", "Blue"), ("Service", "Green"), ("Quote", "Orange"), ("Warranty", "Purple"), ("Unsuccessful, red", "Red")])),
        ("Ordered groups", "Price bands, days to quote", '<div class="tags">' + "".join(f'<span class="tg2"><span class="sq" style="background:#2563EB;opacity:{o}"></span>{t}</span>' for t, o in [("Under $5k", ".25"), ("$5k to $10k", ".5"), ("$10k to $20k", ".75"), ("Over $20k", "1")]) + "</div>"),
    ]
    ut = "".join(f'<div class="mt"><div class="nm">{a}<span>{b}</span></div><div>{c}</div></div>' for a, b, c in uses)

    gone = [
        ("The teal", "3 values: the wordmark, its dark and light steps"),
        ("Tiff's gradient", "7 values; the mark goes black on paper, white on ink"),
        ("The chart set", "11 values: seven series and four blues"),
        ("The day colours", "14 values with their dark steps and tints"),
        ("The pipe colours", "8 values"),
        ("Category washes, patches and edge lines", "3 made from every ServiceM8 colour; now a dot in one of the eight"),
        ("The extra reds and the state tints", "Four reds (#ff3366, #e0264f, #c81a41, #ff5c7a) become one red and its word; the tints behind states go, since a state is a word"),
    ]
    gl = "".join(f'<div class="mt"><div class="nm">{a}</div><div class="q">{b}</div></div>' for a, b in gone)

    inner = f'''<h1 class="t1">Colour, cut down to eight</h1>
<p class="lede">Eight hues that sit far apart, each with a bright value that pops and a darker one for words. With black, white and one grey, that's every colour in HeyTiff. No teal.</p>
<div class="cnt">
  <div class="panel"><div class="q">Today</div><div class="big">265</div><p class="q">different hex colours across the stylesheets, plus 163 rgb values; 62 in the tokens file alone</p></div>
  <div class="panel"><div class="q">Proposed</div><div class="big">19</div><p class="q">eight hues with two values each, plus ink, white and the quiet grey. Tints are those at a set opacity, not new colours</p></div>
</div>
<div class="sec"><h2>The eight</h2><p class="sub">The bright value is for dots, chart marks and solid blocks; a solid block takes ink words, except blue, which takes white. The darker value is for words on white, all 4.9:1 or better.</p><div class="sws k8">{hues}</div></div>
<div class="sec"><h2>And the rest</h2><div class="sws k8" style="grid-template-columns:repeat(4,minmax(0,1fr))">{neutrals}</div></div>
<div class="sec"><h2>Every use, from the same eight</h2><p class="sub">Red only ever means something's wrong: no chart, category or pipe is red, so a red dot always needs a look.</p>{ut}</div>
<div class="sec"><h2>What goes</h2>{gl}</div>'''
    return wrap(inner, 1820)


def bs_sw(bg, name, val, use):
    return (f'<div class="sw"><div class="chipc" style="background:{bg}"></div>'
            f'<div><div class="nm">{name}</div><div class="vl">{val}</div><div class="vl" style="color:#050505;margin-top:2px">{use}</div></div></div>')


# ------------------------------------------------------------------ main button
def main_buttons():
    opts = [
        ("A. Blue", "The one bright action colour. Pops, and you always know which one to press.", "blue", "Recommended"),
        ("B. Ink outline", "White with a firm black edge. Quiet; the main and second buttons are close.", "inko", ""),
        ("C. Grey fill", "A soft grey block, like Claude's own buttons. Calm, but less obviously the one to press.", "grey", ""),
        ("D. Light blue", "A pale blue block with blue words. Softer than A, still clearly the action.", "tintb", ""),
    ]
    cards = ""
    for name, why, cls, rec in opts:
        cards += f'''<div class="opt">
  <div><h3>{name}{f' <span class="q" style="font-size:13px;font-weight:500">{rec}</span>' if rec else ""}</h3><p class="q" style="margin-top:4px">{why}</p></div>
  <div class="ctx"><span class="lb">A dialog</span><div class="ex" style="justify-content:flex-end"><span class="b out">Cancel</span><span class="b {cls}">Save note</span></div></div>
  <div class="ctx"><span class="lb">Tiff asks which job</span><div class="ex"><span class="b sm {cls}">Yes, 3361 Okafor</span><span class="b sm out">A new job</span></div></div>
  <div class="ctx"><span class="lb">A timesheet to approve</span><div class="ex" style="justify-content:space-between"><span><b style="font-weight:600">Callum Ahn</b><span class="q"> 38 h, his normal week</span></span><span class="ex"><span class="b sm out">Send back</span><span class="b sm {cls}">Approve</span></span></div></div>
  <div class="ctx"><span class="lb">The box</span><div class="ex" style="justify-content:space-between"><span class="ex"><span class="b sm out">{ico("camera")}Add photo</span><span class="ib">{ico("mic")}</span></span><span class="b sm {cls}">Send</span></div></div>
</div>'''
    inner = f'''<h1 class="t1">The main button, without the black</h1>
<p class="lede">Four ways to mark the one button you most likely press. Everything else stays the hairline button. Blue was chosen, so "For your information" moved to grey: blue only ever means "press here".</p>
<div class="sws" style="grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;margin-top:32px">{cards}</div>'''
    return wrap(inner, 820)


# ------------------------------------------------------------------ a job's colour
def job_colour():
    people = [
        ("Isaac", [(7.5, 8.5, "Green", "Kingsford Bakery", "2380, Service"), (14.75, 16, "Green", "Randwick Dental", "3271, Service")]),
        ("Lyle", [(9, 11.5, "Blue", "Bellevue Hill", "3342, Installation")]),
        ("Callum", [(9, 11.5, "Blue", "Bellevue Hill", "3342, Installation"), (12.5, 15.5, "Purple", "Heuvel, Chatswood", "3302, Project")]),
        ("Dan", [(12.75, 13.75, "Orange", "Riverview", "3361, Quote"), (14.25, 16.25, "Yellow", "Ardex Logistics", "2601, Maintenance")]),
    ]

    def lanes(style):
        out = ""
        for who, blocks in people:
            bl = ""
            for s, e, hue, t, sub in blocks:
                left = (s - 7) / 10 * 100
                width = (e - s) / 10 * 100
                p = H[hue][0]
                if style == "dot":
                    bl += f'<div class="blk2 w" style="left:{left}%;width:{width}%"><b><span class="dt" style="background:{p}"></span>{t}</b><span>{sub}</span></div>'
                else:
                    c = on(hue)
                    bl += f'<div class="blk2" style="left:{left}%;width:{width}%;background:{p};color:{c}"><b>{t}</b><span style="opacity:.85">{sub}</span></div>'
            out += f'<div class="lane2"><div style="display:flex;align-items:center;font-weight:600">{who}</div><div style="position:relative">{bl}</div></div>'
        return out

    today = [("7:30 to 8:30", "Green", "Kingsford Bakery, Job 2380", "Service, you", '<span class="wd" style="color:#15803D">Done</span>'),
             ("9:00 to 11:30", "Blue", "Bellevue Hill, Job 3342", "Installation, Lyle and Callum", '<span class="wd" style="color:#15803D">On now</span>'),
             ("12:45 to 1:45", "Orange", "Riverview, Job 3361", "Quote, Dan", ""),
             ("2:45 to 4:00", "Green", "Randwick, Job 3271", "Service, you", "")]
    tl = "".join(f'<div class="agr"><span class="tm">{tm}</span><span class="dt" style="background:{H[h][0]}"></span><div class="m"><div class="t">{t}</div><div class="s q" style="font-size:13px">{s}</div></div>{r}</div>' for tm, h, t, s, r in today)

    inner = f'''<h1 class="t1">A job's colour, without the wash or the edge line</h1>
<p class="lede">The pale fill and the coloured line down the left go. A job's ServiceM8 colour, snapped to the nearest of the eight, shows as a dot by its name everywhere: the Schedule, Today, Jobs, a tab, Search. Two ways to draw the Schedule.</p>
<div class="sws" style="grid-template-columns:1fr;gap:24px;margin-top:32px">
  <div class="panel"><h3>Schedule, A: white blocks with a dot</h3><p class="q" style="margin-bottom:12px">Calm. The colour is small, and the day reads by name.</p>{lanes("dot")}</div>
  <div class="panel"><h3>Schedule, B: solid blocks in the colour</h3><p class="q" style="margin-bottom:12px">Pops. The day reads by colour at a glance; ink words, white on blue.</p>{lanes("solid")}</div>
</div>
<div class="sws" style="grid-template-columns:1fr 1fr;gap:24px;margin-top:24px">
  <div class="panel"><h3>Home's Today, a dot instead of the strip</h3>{tl}</div>
  <div class="panel"><h3>On the job card and in a tab</h3>
    <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px"><span style="font-size:24px;line-height:32px;font-weight:600">Rifkin, Julian</span>
    <span class="q"><span class="dt" style="background:{H["Blue"][0]};margin-right:8px;vertical-align:0"></span>Installation, Job 3342, 41 Victoria Rd, Bellevue Hill. <span class="wd" style="color:#15803D">On site</span></span></div>
    <div class="ex" style="margin-top:20px"><span class="tt on"><span class="dt" style="background:{H["Blue"][0]}"></span>3342 Rifkin<span class="x">{ico("x")}</span></span><span class="tt"><span class="dt" style="background:{H["Orange"][0]}"></span>3361 Okafor<span class="x">{ico("x")}</span></span></div>
  </div>
</div>'''
    return wrap(inner, 1300)


# ------------------------------------------------------------------ the mark
def mark():
    side = f'''<div class="inkp" style="display:flex;flex-direction:column;gap:16px">
  <div style="display:flex;align-items:center;gap:8px">{mark_svg()}<b style="font-size:16px;font-weight:700;letter-spacing:-.2px">HeyTiff</b></div>
  <div style="display:flex;align-items:center;gap:16px">{tiff_mono(52, ink=True)}<span style="color:rgba(255,255,255,.5)">On the ink: white</span></div>
</div>'''
    paper = f'''<div class="panel" style="display:flex;flex-direction:column;gap:16px">
  <div style="display:flex;justify-content:center">{tiff_mono(52)}</div>
  <div class="box" style="border:1px solid rgba(5,5,5,.14);border-radius:16px;padding:14px 14px 12px 16px"><div class="q" style="font-size:16px;line-height:24px;min-height:40px">What's happening on site?</div>
  <div class="ex" style="justify-content:space-between"><span class="ex"><span class="b sm out">{ico("camera")}Add photo</span><span class="ib">{ico("mic")}</span></span><span class="b sm blue">Send</span></div></div>
  <div style="display:flex;align-items:flex-start;gap:12px">{tiff_mono(28, working=True)}<span class="q" style="font-size:16px;line-height:24px">Making a task for 2:00 pm</span></div>
</div>'''
    before = f'''<div class="panel" style="display:flex;flex-direction:column;gap:16px;align-items:flex-start">
  <div class="q">Today, for comparison</div>
  <div class="inkp" style="display:flex;align-items:center;gap:8px;padding:12px 16px">{mark_svg()}<b style="font-size:16px;font-weight:700">Hey<span style="color:#00E5C0">Tiff</span></b></div>
  <div style="display:flex;gap:24px;align-items:center">{tiff(52)}<span class="q">The teal-to-blue mark</span></div>
</div>'''
    inner = f'''<h1 class="t1">Tiff in black and white</h1>
<p class="lede">The mark keeps its shape and its motion: it still turns, nods and speeds up while Tiff works. Only the colour goes: black on paper, white on the ink. The wordmark is one colour, so the teal leaves the app entirely.</p>
<div class="sws" style="grid-template-columns:1fr 1.3fr 1fr;gap:24px;margin-top:32px;align-items:start">{side}{paper}{before}</div>'''
    return wrap(inner, 480)


def build(out):
    out["SYS-colour8.dc.html"] = page("Colour, cut down to eight", 1440, 1840, CSS, colour_trim())
    out["SYS-main.dc.html"] = page("The main button, without the black", 1440, 820, CSS, main_buttons())
    out["SYS-jobcolour.dc.html"] = page("A job's colour, without the wash", 1440, 1300, CSS, job_colour())
    out["SYS-mark.dc.html"] = page("Tiff in black and white", 1440, 480, CSS, mark())
