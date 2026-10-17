"""Where colour could live on Tiff's mark, now the gradient has gone: the rings,
the tail, the face, or only while Tiff is doing something."""
from base import page
from boards_home2 import MARK_CSS, STROKES, VIEW, R, HX, HY

HEX = {"blue": "#2563EB", "purple": "#A855F7", "pink": "#EC4899", "red": "#EF4444", "orange": "#F97316",
       "yellow": "#FACC15", "green": "#22C55E", "grey": "#9CA3AF", "ink": "#050505", "white": "#ffffff"}
CYC = ["#2563EB", "#A855F7", "#EC4899", "#EF4444", "#F97316", "#FACC15", "#22C55E", "#2563EB"]


def _run(name, col, cls=""):
    c = f' class="{cls}"' if cls else ""
    return (f'<linearGradient id="cr-{name}" gradientUnits="userSpaceOnUse" x1="{50 + R}" y1="50" x2="{HX:.3f}" y2="{HY:.3f}">'
            f'<stop offset="0" stop-color="{col}" stop-opacity="0"{c}/><stop offset=".6" stop-color="{col}" stop-opacity=".92"{c}/><stop offset="1" stop-color="{col}"{c}/></linearGradient>')


DEFS = ('<svg class="tiffbtn-defs" width="0" height="0" aria-hidden="true"><defs>'
        + "".join(_run(n, h) for n, h in HEX.items()) + _run("cyc", CYC[0], "cyc") + _run("cyc2", CYC[3], "cyc2") + '</defs></svg>')

steps = "".join(f"{i * 100 / (len(CYC) - 1):.1f}%{{stop-color:{h};stroke:{h}}}" for i, h in enumerate(CYC))
CSS = MARK_CSS + f"""
body{{margin:0}}
@keyframes tcCyc{{{steps}}}
.cyc,.ringcyc{{animation:tcCyc 4s linear infinite}}
.cyc2,.ringcyc2{{animation:tcCyc 4s linear infinite;animation-delay:-2s}}
.tcb,.tcb *{{box-sizing:border-box}}
.tcb{{width:1440px;padding:64px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#050505;background:#fff;-webkit-font-smoothing:antialiased}}
.tcb h1{{margin:0 0 8px;font-size:24px;line-height:32px;font-weight:600}}
.tcb .ld{{margin:0;max-width:880px;font-size:16px;line-height:24px;color:#5f6a79}}
.tcg{{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:40px}}
.tcc{{border:1px solid rgba(5,5,5,.08);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:12px}}
.tcc h3{{margin:0;font-size:16px;line-height:24px;font-weight:600}}
.tcc p{{margin:0;font-size:13px;line-height:18px;font-weight:500;color:#5f6a79;min-height:54px}}
.tcp{{display:grid;grid-template-columns:1fr 1fr;gap:8px}}
.tcp>div{{height:150px;border-radius:10px;display:flex;align-items:center;justify-content:center}}
.tcp .pp{{background:#fff;border:1px solid rgba(5,5,5,.08)}}
.tcp .ik{{background:#050505}}
.tcs{{display:flex;justify-content:space-around;align-items:flex-start;height:150px;padding-top:16px;border:1px solid rgba(5,5,5,.08);border-radius:10px}}
.tcs>span{{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:12px;line-height:16px;font-weight:500;color:#5f6a79}}
.tcx{{display:flex;align-items:center;gap:10px;font-size:14px;line-height:20px;color:#5f6a79;border-top:1px solid rgba(5,5,5,.08);padding-top:12px}}
.tcx b{{color:#050505;font-weight:600}}
.tcl{{display:flex;flex-direction:column;gap:10px;height:150px;justify-content:center;padding:0 12px;border:1px solid rgba(5,5,5,.08);border-radius:10px;font-size:13px;line-height:18px;font-weight:500}}
.tcl span{{display:flex;align-items:center;gap:10px}}
.pick{{display:inline-block;margin-left:8px;font-size:12px;line-height:16px;font-weight:600;color:#2563EB}}
"""


def _layer(face, tail, z, op, is_face=False):
    paths = ""
    for i, (d, w, o, c) in enumerate(STROKES):
        col = tail if (i == 1 and tail) else face
        paths += f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="{c}" stroke-linejoin="round"{"" if o == 1 else f" opacity={o}"}/>'
    return f'<svg class="tiffbtn-ly{" face" if is_face else ""}" viewBox="{VIEW}" style="--z:{z:.4f};{"" if op == 1 else f"opacity:{op:.3f}"}">{paths}</svg>'


def _gim(axis, ring):
    faint = f'class="tiffbtn-ring ring{ring}"' if ring.startswith("cyc") else f'class="tiffbtn-ring" style="stroke:{HEX[ring]}"'
    return (f'<span class="tiffbtn-gim tiffbtn-gim-{axis}"><span class="tiffbtn-arc"><svg viewBox="0 0 100 100">'
            f'<circle {faint} cx="50" cy="50" r="{R}" vector-effect="non-scaling-stroke"/>'
            f'<circle cx="50" cy="50" r="{R}" stroke="url(#cr-{ring})" pathLength="360" stroke-dasharray="120 240" vector-effect="non-scaling-stroke"/>'
            '</svg></span></span>')


def mk(size, face="ink", ra=None, rb=None, tail=None, working=False):
    """face/ra/rb/tail are names in HEX (or cyc/cyc2 for the rings)."""
    fc = HEX[face]
    ra = ra or face
    rb = rb or ra
    layers = "".join(_layer(fc, HEX.get(tail), -0.06 + 0.12 * k / 9, 1 if k == 9 else 0.45 + 0.5 * k / 9, k == 9) for k in range(10))
    sheen = ' style="--tb:%dpx;--tiffbtn-sheen:rgba(255,255,255,.55);--tiffbtn-sheen-hi:rgba(255,255,255,.8)"' % size if face != "white" else f' style="--tb:{size}px"'
    return (f'<span class="tiffmk{" working" if working else ""}"{sheen} role="img" aria-label="Tiff">'
            '<span class="tiffbtn-st"><span class="tiffbtn-root"><span class="tiffbtn-flip"><span class="tiffbtn-pre"><span class="tiffbtn-nod">'
            + layers + '<span class="tiffbtn-sheen"></span></span></span></span>'
            '<span class="tiffbtn-gw">' + _gim("a", ra) + _gim("b", rb) + '</span></span></span></span>')


def pair(**kw):
    ink = dict(kw)
    if ink.get("face", "ink") == "ink":
        ink["face"] = "white"
    for k in ("ra", "rb"):
        if ink.get(k) == "ink":
            ink[k] = "white"
    if kw.get("face") not in (None, "ink") and not kw.get("ra"):
        ink["ra"] = "white"
    return f'<div class="tcp"><div class="pp">{mk(96, **kw)}</div><div class="ik">{mk(96, **ink)}</div></div>'


def ctx(text, **kw):
    return f'<div class="tcx">{mk(24, **kw)}<span>{text}</span></div>'


def card(title, desc, mid, foot, pick=False):
    return f'<div class="tcc"><h3>{title}{"<span class=pick>Chosen</span>" if pick else ""}</h3><p>{desc}</p>{mid}{foot}</div>'


def board():
    working = "Making a task for 2:00 pm"
    cards = [
        card("A. Black and white", "Decided last round. No colour anywhere on the mark; it turns, nods and speeds up as it does now.",
             pair(), ctx(working, working=True)),
        card("B. Rings in blue", "The chevron stays black or white. Both rings take the app's blue, the colour of the main button.",
             pair(ra="blue"), ctx(working, ra="blue", working=True)),
        card("C. Two rings, two colours", "Each ring its own hue from the eight. Blue and purple here; any two that sit apart.",
             pair(ra="blue", rb="purple"), ctx(working, ra="blue", rb="purple", working=True)),
        card("D. The tail in colour", "One spot of colour, like the old teal on 'Tiff': the chevron's short second stroke in blue. Rings stay plain.",
             pair(tail="blue"), ctx(working, tail="blue", working=True)),
        card("E. Colour only while Tiff works", "Black and white at rest. While Tiff is listening or working, the rings run through the eight. Colour means Tiff is busy.",
             f'<div class="tcp"><div class="pp" style="flex-direction:column;gap:6px">{mk(80)}<span style="font-size:12px;color:#5f6a79">At rest</span></div><div class="pp" style="flex-direction:column;gap:6px">{mk(80, ra="cyc", rb="cyc2", working=True)}<span style="font-size:12px;color:#5f6a79">Working</span></div></div>',
             ctx(working, ra="cyc", rb="cyc2", working=True), pick=True),
        card("F. A colour for each state", "The rings say what Tiff is doing: blue listening, the eight while working, green when done, red when stuck.",
             f'<div class="tcs"><span>{mk(44)}Resting</span><span>{mk(44, ra="blue")}Listening</span><span>{mk(44, ra="cyc", rb="cyc2", working=True)}Working</span><span>{mk(44, ra="green")}Done</span><span>{mk(44, ra="red")}Stuck</span></div>',
             ctx(working, ra="cyc", rb="cyc2", working=True)),
        card("G. The job's colour", "In a job's conversation, the rings take that job's colour, so you can tell at a glance which job Tiff is on.",
             f'<div class="tcl"><span>{mk(28, ra="blue")}<b style="font-weight:600">Bellevue Hill, 3342</b></span><span>{mk(28, ra="purple")}<b style="font-weight:600">Heuvel, Chatswood</b></span><span>{mk(28, ra="green")}<b style="font-weight:600">Kingsford Bakery, 2380</b></span></div>',
             ctx("Drafting the variation for 3342", ra="blue", working=True)),
        card("H. A flat colour face", "The chevron itself in solid blue, no gradient, rings plain. The most 'brand'; colour on every screen Tiff appears on.",
             pair(face="blue", ra="ink"), ctx(working, face="blue", ra="ink", working=True)),
    ]
    return f'''<div class="tcb">{DEFS}
<h1>Colour on Tiff's mark</h1>
<p class="ld">The mark is a chevron with two rings orbiting it. The rings are one place colour could go, but not the only one: the chevron's tail, its face, or colour that only shows while Tiff is doing something. All of these use the eight, flat, no gradient. They move here as they would in the app.</p>
<div class="tcg">{"".join(cards)}</div>
</div>'''


def build(out):
    out["TC-mark.dc.html"] = page("Colour on Tiff's mark", 1440, 1020, CSS, board())
