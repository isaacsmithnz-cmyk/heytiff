"""Home, round two: ink frame with the white page curving into it, the date and
time across the header, the spinning Tiff mark by the box, today as a plain
list, To do instead of Needs you. Plus the same Home with a conversation going.
Desktop and phone."""
import math
from urllib.parse import quote
from base import ico, page

# ---------------------------------------------------------------- the mark
STROKES = [("M22 24 L40 24 L62 50 L40 76 L22 76 L44 50 Z", 7, 1, "butt"), ("M54 24 L72 24 L90 46", 7, .55, "round")]
VIEW = "6 0 100 100"
R = 48
HX, HY = 50 + R * math.cos(2 * math.pi / 3), 50 + R * math.sin(2 * math.pi / 3)
_mask = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VIEW}">' +
         "".join(f'<path d="{d}" fill="none" stroke="#fff" stroke-width="{w}" stroke-linecap="{c}" stroke-linejoin="round"/>' for d, w, o, c in STROKES) + "</svg>")
MASK = 'url("data:image/svg+xml,' + quote(_mask, safe="") + '")'

MARK_DEFS = f'''<svg class="tiffbtn-defs" width="0" height="0" aria-hidden="true"><defs>
<linearGradient id="tFace" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00A389"/><stop offset="1" stop-color="#2E68FF"/></linearGradient>
<linearGradient id="tDepth" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#007A67"/><stop offset="1" stop-color="#1D46C8"/></linearGradient>
<linearGradient id="tRunA" gradientUnits="userSpaceOnUse" x1="{50 + R}" y1="50" x2="{HX:.3f}" y2="{HY:.3f}"><stop offset="0" stop-color="#00A389" stop-opacity="0"/><stop offset=".6" stop-color="#00A389" stop-opacity=".92"/><stop offset=".95" stop-color="#00A389"/><stop offset="1" stop-color="#00A389"/></linearGradient>
<linearGradient id="tRunB" gradientUnits="userSpaceOnUse" x1="{50 + R}" y1="50" x2="{HX:.3f}" y2="{HY:.3f}"><stop offset="0" stop-color="#2E68FF" stop-opacity="0"/><stop offset=".6" stop-color="#2E68FF" stop-opacity=".92"/><stop offset=".95" stop-color="#2E68FF"/><stop offset="1" stop-color="#2E68FF"/></linearGradient>
</defs></svg>'''


def _layer(stroke, z, op, face=False):
    paths = "".join(f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{w}" stroke-linecap="{c}" stroke-linejoin="round"{"" if o == 1 else f" opacity={o}"}/>' for d, w, o, c in STROKES)
    return f'<svg class="tiffbtn-ly{" face" if face else ""}" viewBox="{VIEW}" style="--z:{z:.4f};{"" if op == 1 else f"opacity:{op:.3f}"}">{paths}</svg>'


def _gimbal(axis, run, ring):
    return (f'<span class="tiffbtn-gim tiffbtn-gim-{axis}"><span class="tiffbtn-arc"><svg viewBox="0 0 100 100">'
            f'<circle class="tiffbtn-ring" cx="50" cy="50" r="{R}" style="stroke:{ring}" vector-effect="non-scaling-stroke"/>'
            f'<circle cx="50" cy="50" r="{R}" stroke="url(#{run})" pathLength="360" stroke-dasharray="120 240" vector-effect="non-scaling-stroke"/>'
            '</svg></span></span>')


def tiff(size=24, working=False):
    layers = []
    for k in range(10):
        z = -0.06 + 0.12 * k / 9
        layers.append(_layer("url(#tFace)", z, 1, True) if k == 9 else _layer("url(#tDepth)", z, 0.45 + 0.5 * k / 9))
    return (f'<span class="tiffmk{" working" if working else ""}" style="--tb:{size}px" role="img" aria-label="Tiff">'
            '<span class="tiffbtn-st"><span class="tiffbtn-root"><span class="tiffbtn-flip"><span class="tiffbtn-pre"><span class="tiffbtn-nod">'
            + "".join(layers) + '<span class="tiffbtn-sheen"></span></span></span></span>'
            '<span class="tiffbtn-gw">' + _gimbal("a", "tRunA", "#00A389") + _gimbal("b", "tRunB", "#2E68FF") + '</span></span></span></span>')


MARK_CSS = """
.tiffbtn-defs{position:absolute;width:0;height:0;overflow:hidden}
.tiffmk{--tb:24px;position:relative;display:inline-block;flex:none;width:var(--tb);height:var(--tb);vertical-align:middle;
  --tiffbtn-sheen:color-mix(in srgb,#fff 90%,transparent);--tiffbtn-sheen-hi:#fff;--tiffbtn-mask:MASKURL}
.tiffbtn-st{position:absolute;inset:0;perspective:calc(var(--tb) * 6);pointer-events:none}
.tiffbtn-root,.tiffbtn-flip,.tiffbtn-pre,.tiffbtn-nod,.tiffbtn-gw,.tiffbtn-gim{position:absolute;inset:0;transform-style:preserve-3d}
.tiffbtn-ly,.tiffbtn-sheen{position:absolute;left:50%;top:50%;width:calc(var(--tb) * .74);height:calc(var(--tb) * .74);margin:calc(var(--tb) * -.37) 0 0 calc(var(--tb) * -.37)}
.tiffbtn-ly{display:block;overflow:visible;transform:translateZ(calc(var(--tb) * var(--z)))}
.tiffbtn-pre{animation:tiffGyro 6s linear infinite}
@keyframes tiffGyro{from{transform:rotateZ(0deg) rotateY(18deg) rotateZ(0deg)}to{transform:rotateZ(360deg) rotateY(18deg) rotateZ(-360deg)}}
.tiffbtn-nod{animation:tiffNod 1.5s ease-in-out infinite alternate}
@keyframes tiffNod{from{transform:rotateX(-3deg)}to{transform:rotateX(3deg)}}
.tiffbtn-sheen{overflow:hidden;transform:translateZ(calc(var(--tb) * .061));-webkit-mask:var(--tiffbtn-mask) center/100% 100% no-repeat;mask:var(--tiffbtn-mask) center/100% 100% no-repeat}
.tiffbtn-sheen::before{content:"";position:absolute;top:-20%;bottom:-20%;left:0;width:60%;background:linear-gradient(100deg,transparent,var(--tiffbtn-sheen) 40%,var(--tiffbtn-sheen-hi) 55%,transparent);animation:tiffSheen 6s ease-in-out infinite}
@keyframes tiffSheen{0%,30%{transform:translateX(-120%)}62%,100%{transform:translateX(260%)}}
.tiffbtn-gw{opacity:.85}
.tiffbtn-gim-a{animation:tiffGimbalA 7s linear infinite}
.tiffbtn-gim-b{animation:tiffGimbalB 5s linear infinite}
@keyframes tiffGimbalA{from{transform:rotateZ(-20deg) rotateY(0deg)}to{transform:rotateZ(-20deg) rotateY(360deg)}}
@keyframes tiffGimbalB{from{transform:rotateZ(25deg) rotateX(0deg)}to{transform:rotateZ(25deg) rotateX(360deg)}}
.tiffbtn-arc{--r:calc(var(--tb) * var(--k));position:absolute;left:50%;top:50%;width:var(--r);height:var(--r);margin:calc(var(--r) / -2) 0 0 calc(var(--r) / -2);animation:tiffArc 2.6s linear infinite}
.tiffmk .tiffbtn-gim-a .tiffbtn-arc{--k:1}
.tiffmk .tiffbtn-gim-b .tiffbtn-arc{--k:.9}
@keyframes tiffArc{to{transform:rotate(360deg)}}
.tiffbtn-arc svg{display:block;width:100%;height:100%;overflow:visible}
.tiffbtn-arc circle{fill:none;stroke-width:max(1.2px,calc(var(--tb) * .022))}
.tiffbtn-ring{stroke-opacity:.18}
.tiffmk.working .tiffbtn-pre,.tiffmk.working .tiffbtn-sheen::before{animation-duration:2.4s}
.tiffmk.working .tiffbtn-nod{animation-duration:.5s}
.tiffmk.working .tiffbtn-gim-a{animation-duration:2.8s}
.tiffmk.working .tiffbtn-gim-b{animation-duration:2s}
.tiffmk.working .tiffbtn-arc{animation-duration:1s}
""".replace("MASKURL", MASK)

# ---------------------------------------------------------------- the page
CSS = MARK_CSS + """
body{margin:0}
.hz,.hz *{box-sizing:border-box}
.hz{display:flex;overflow:hidden;position:relative;font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:14px;line-height:20px;color:#050505;background:#050505;-webkit-font-smoothing:antialiased}
.hz a{color:inherit;text-decoration:none}
.hz p,.hz h1,.hz h2{margin:0}
.ic{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.i16{width:16px;height:16px}
.sd{width:264px;flex:none;color:#fff;display:flex;flex-direction:column;padding:12px 8px 8px}
.br{display:flex;align-items:center;gap:8px;height:40px;padding:0 8px;margin-bottom:8px}
.br b{font-size:16px;font-weight:700;letter-spacing:-.2px}
.br b span{color:#00E5C0}
.sr{display:flex;align-items:center;gap:12px;height:36px;padding:0 8px;border-radius:10px;font-weight:500;white-space:nowrap}
.sr.on{background:rgba(255,255,255,.12);font-weight:600}
.sr .r{margin-left:auto;font-size:13px;font-weight:600}
.sr .r.q{color:rgba(255,255,255,.5);font-weight:500}
.nb .pl{width:24px;height:24px;border-radius:50%;background:#fff;color:#050505;display:inline-flex;align-items:center;justify-content:center;margin:0 -3px}
.sl{font-size:12px;line-height:16px;font-weight:500;color:rgba(255,255,255,.5);padding:16px 8px 4px}
.rc{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px;border-radius:10px;white-space:nowrap;overflow:hidden}
.rc.on{background:rgba(255,255,255,.12)}
.rc .tx{overflow:hidden;text-overflow:ellipsis}
.rc .sq{width:8px;height:8px;flex:none}
.rc .ic{width:16px;height:16px;color:rgba(255,255,255,.5)}
.me{margin-top:auto;display:flex;align-items:center;gap:12px;padding:8px;border-radius:10px}
.av{width:32px;height:32px;border-radius:50%;background:#fff;color:#050505;font-size:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex:none}
.qd{color:rgba(255,255,255,.5)}
.pg{flex:1;min-width:0;background:#fff;border-radius:40px 0 0 0;display:flex;flex-direction:column;overflow:hidden}
.hdr{height:56px;flex:none;display:flex;align-items:center;gap:12px;padding:0 32px;font-weight:500}
.q{color:#5f6a79}
.col{width:100%;max-width:720px;margin:0 auto;padding:0 32px}
.box{background:#fff;border:1px solid rgba(5,5,5,.14);border-radius:16px;padding:14px 14px 12px 16px;box-shadow:0 1px 2px rgba(10,12,20,.04)}
.box .ph{font-size:16px;line-height:24px;color:#5f6a79;min-height:44px}
.bt{height:32px;padding:0 12px;border-radius:10px;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(5,5,5,.14);background:#fff;white-space:nowrap;flex:none}
.bt.ink{background:#050505;color:#fff;border-color:#050505}
.hz a.bt.ink{color:#fff}
.mic{width:32px;height:32px;border-radius:50%;border:1px solid rgba(5,5,5,.14);display:inline-flex;align-items:center;justify-content:center;flex:none}
.sh{display:flex;align-items:baseline;gap:12px;margin:36px 0 4px}
.h16{font-size:16px;line-height:24px;font-weight:600}
.hz .lk{text-decoration:underline;text-underline-offset:3px;font-weight:500;font-size:13px}
.ag{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid rgba(5,5,5,.08)}
.ag .tm{width:104px;flex:none;font-size:13px;line-height:18px;font-weight:500;color:#5f6a79;font-variant-numeric:tabular-nums}
.ag .cbar{width:4px;align-self:stretch;border-radius:2px;flex:none}
.ag .m{flex:1;min-width:0}
.ag .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s{font-size:13px;line-height:18px;color:#5f6a79}
.ag.done .t,.ag.done .tm{color:#5f6a79}
.td{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid rgba(5,5,5,.08)}
.td .m{flex:1;min-width:0}
.td .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dd{width:8px;height:8px;border-radius:50%;flex:none;margin:0 5px}
.tk{width:18px;height:18px;border:1.5px solid rgba(5,5,5,.3);border-radius:6px;flex:none}
.ok{color:#196B2D}.bad{color:#c81a41}
.msg-me{align-self:flex-end;max-width:80%;background:#F0F2F5;border-radius:16px;padding:10px 14px;font-size:16px;line-height:24px}
.msg-t{display:flex;gap:12px;align-items:flex-start}
.msg-t .bd{font-size:16px;line-height:24px;min-width:0;flex:1;display:flex;flex-direction:column;gap:12px}
.res{border:1px solid rgba(5,5,5,.08);border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:12px}
/* phone */
.phn{width:390px;height:844px;display:flex;flex-direction:column;background:#050505}
.mt{height:56px;flex:none;display:flex;align-items:center;gap:8px;padding:0 12px 0 8px;color:#fff}
.ib{width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px}
.hz a.mb{height:40px;padding:0 14px;border-radius:10px;font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:6px;background:#fff;color:#050505}
.mpg{flex:1;min-height:0;background:#fff;border-radius:16px 16px 0 0;display:flex;flex-direction:column;overflow:hidden}
.mhdr{height:44px;flex:none;display:flex;align-items:center;padding:0 16px;font-weight:500}
.mbody{flex:1;min-height:0;overflow:hidden;padding:0 16px}
.mbox{flex:none;margin:8px 12px 12px;background:#fff;border:1px solid rgba(5,5,5,.14);border-radius:20px;padding:12px 12px 10px 12px;box-shadow:0 1px 2px rgba(10,12,20,.04)}
"""


def mark_svg(color="#fff"):
    return (f'<svg width="22" height="22" viewBox="0 0 100 100" aria-hidden="true"><path d="M22 24 L40 24 L62 50 L40 76 L22 76 L44 50 Z" fill="none" stroke="{color}" stroke-width="10" stroke-linejoin="round"></path>'
            f'<path d="M54 24 L72 24 L90 46" fill="none" stroke="{color}" stroke-width="10" stroke-linecap="round" opacity="0.4"></path></svg>')


def sidebar(home_on=True, convo_on=False):
    nav = [("home", "Home", "3"), ("chat", "Conversations", ""), ("jobs", "Jobs", ""), ("cal", "Schedule", ""), ("doc", "Documents", ""), ("lib", "Library", ""), ("design", "Design", ""), ("team", "Team", "")]
    rows = "".join(f'<a class="sr{" on" if (k == "home" and home_on) else ""}" href="#">{ico(k)}{n}{f"<span class=r>{c}</span>" if c else ""}</a>' for k, n, c in nav)
    pinned = "".join(f'<a class="rc" href="#"><span class="sq" style="background:{c}"></span><span class="tx">{x}</span></a>' for c, x in [("#6D4FD8", "3342 Rifkin, Bellevue Hill"), ("#4B5565", "3302 Heuvel, Chatswood")])
    rec_items = [("chat", "Riverview brief"), ("doc", "SWMS, Heuvel roof work"), ("person", "Lyle Irving"), ("jobs", "Northgate Realty, 3323"), ("chat", "Clearing an E6 on a Daikin split")]
    rec = "".join(f'<a class="rc{" on" if (convo_on and n == 0) else ""}" href="#">{ico(k)}<span class="tx">{x}</span></a>' for n, (k, x) in enumerate(rec_items))
    return f'''<aside class="sd">
  <div class="br">{mark_svg()}<b>Hey<span>Tiff</span></b><span style="flex:1"></span><span class="qd">{ico("panel")}</span></div>
  <a class="sr nb" href="#"><span class="pl">{ico("plus", "ic", "width:14px;height:14px;stroke-width:2.4")}</span>New</a>
  <a class="sr" href="#">{ico("search")}Search<span class="r q">⌘K</span></a>
  <div style="height:12px"></div>
  {rows}
  <div class="sl">Pinned</div>{pinned}
  <div class="sl">Recents</div>{rec}
  <a class="me" href="#"><span class="av">IS</span><span style="display:flex;flex-direction:column;min-width:0;flex:1"><span style="font-weight:600">Isaac Smith</span><span class="qd" style="font-size:12px;line-height:16px">Owner</span></span><span class="qd">{ico("updown")}</span></a>
</aside>'''


TODAY = [
    ("done", "7:30 to 8:30", "#B4C5EE", "Kingsford Bakery, Job 2380", "Service, you", '<span class="s ok" style="font-weight:600">Done</span>'),
    ("now", "9:00 to 11:30", "#6D4FD8", "Bellevue Hill, Job 3342", "Two Daikin splits, Lyle and Callum", '<span class="s ok" style="font-weight:600">On now</span>'),
    ("task", "By 12:30", "#B6BCC6", "Order the grilles", "Task, for Bellevue Hill", '<span class="tk"></span>'),
    ("", "12:45 to 1:45", "#3D8620", "Alexandria, Job 1042", "Meridian Data, service, Dan", ""),
    ("", "2:45 to 4:00", "#8A6A00", "Randwick, Job 3271", "Randwick Dental, service, you", ""),
]
TODO = [
    ("dot", "#e0264f", "Hilux XQG 41B rego", "Runs out today", "Renew", True),
    ("dot", "#F0A431", "Kingsford Bakery, 2380", "Finished, ready to invoice", "Invoice", False),
    ("dot", "#F0A431", "Timesheets, last week", "4 to approve, 150.5 hours", "Review", False),
    ("dot", "#2554d8", "Quote to write: Riverview", "Brief saved yesterday, 8:40 am", "Quote", False),
    ("task", "", "Ring the Hilux dealer", "From your note yesterday", None, False),
]


def today_rows(n=5, phone=False):
    out = []
    for kind, tm, c, t, s, right in TODAY[:n]:
        tmw = "style=\"width:84px\"" if phone else ""
        out.append(f'<div class="ag{" done" if kind == "done" else ""}"><span class="tm" {tmw}>{tm}</span><span class="cbar" style="background:{c}"></span><div class="m"><div class="t">{t}</div><div class="s">{s}</div></div>{right}</div>')
    return "".join(out)


def todo_rows(n=5):
    out = []
    for kind, c, t, s, verb, bad in TODO[:n]:
        lead = '<span class="tk"></span>' if kind == "task" else f'<span class="dd" style="background:{c}"></span>'
        v = f'<a class="bt" href="#">{verb}</a>' if verb else ""
        out.append(f'<div class="td">{lead}<div class="m"><div class="t">{t}</div><div class="s{" bad" if bad else ""}">{s}</div></div>{v}</div>')
    return "".join(out)


def box(ph="What's happening on site?", inner_mark=False):
    lead = f'<span style="margin-right:10px">{tiff(28)}</span>' if inner_mark else ""
    return f'''<div class="box">
  <div class="ph" style="display:flex;align-items:flex-start">{lead}<span>{ph}</span></div>
  <div style="display:flex;align-items:center;gap:8px"><span class="bt">{ico("camera", "ic i16")}Add photo</span><span class="mic" aria-label="Talk to Tiff">{ico("mic", "ic i16")}</span><span style="flex:1"></span><span class="bt ink">Send</span></div>
</div>'''


def desk_home():
    return f'''<div class="hz" style="width:1440px;height:900px">{MARK_DEFS}
{sidebar()}
<main class="pg">
  <div class="hdr"><span>Tuesday 13 October</span><span style="flex:1"></span><span class="q">7:42 am</span></div>
  <div class="col" style="padding-top:12px">
    <div style="display:flex;justify-content:center;margin-bottom:16px">{tiff(52)}</div>
    {box()}
    <div class="sh"><h2 class="h16">Today</h2><span class="q">4 jobs and a task</span><span style="flex:1"></span><a class="lk" href="#">Schedule</a></div>
    {today_rows()}
    <div class="sh"><h2 class="h16">To do</h2><span class="q">9</span><span style="flex:1"></span><a class="lk" href="#">Show all</a></div>
    {todo_rows(4)}
  </div>
</main>
</div>'''


def convo(phone=False):
    me = lambda x, sub="": f'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><div class="msg-me"{" style=max-width:88%" if phone else ""}>{x}</div>{f"<span class=s>{sub}</span>" if sub else ""}</div>'
    tsize = 24 if phone else 28

    def t(body, working=False):
        return f'<div class="msg-t">{tiff(tsize, working)}<div class="bd">{body}</div></div>'
    return "".join([
        me("Just been to Riverview. They want a split in the main bedroom, back to back with the study. Don't have time to quote it now, save that as the brief.", "Spoken, 8:40 am"),
        t('<p>That sounds like Ada Okafor\'s place at 12 River Rd. Is it job 3361?</p><div style="display:flex;gap:8px;flex-wrap:wrap"><span class="bt ink">Yes, 3361 Okafor</span><span class="bt">A new job</span></div>'),
        me("Yes, 3361"),
        t(f'<p>Saved as the brief on 3361 Okafor, Riverview. The quote is waiting in your To do.</p><div class="res">{ico("doc", "ic", "color:#5f6a79")}<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:14px;line-height:20px">Brief, 3361 Okafor</div><div class="s">Split in the main bedroom, back to back with the study</div></div><a class="lk" href="#">Open the quote</a></div><div class="s" style="display:flex;gap:16px"><a class="lk" href="#">Undo</a></div>'),
        me("Also remind me to ring the Hilux dealer at 2"),
        t('<p class="q">Making a task for 2:00 pm</p>', True),
    ])


def desk_convo():
    return f'''<div class="hz" style="width:1440px;height:900px">{MARK_DEFS}
{sidebar(home_on=False, convo_on=True)}
<main class="pg">
  <div class="hdr"><span style="font-weight:600">Riverview brief</span><span style="flex:1"></span><span class="q">Tuesday 13 October, 8:41 am</span></div>
  <div style="flex:1;min-height:0;overflow:hidden">
    <div class="col" style="display:flex;flex-direction:column;gap:24px;padding-top:16px">{convo()}</div>
  </div>
  <div class="col" style="padding-bottom:24px">{box("Reply to Tiff")}</div>
</main>
</div>'''


def phone_top():
    return f'<header class="mt"><span class="ib" aria-label="Menu">{ico("menu")}</span>{mark_svg()}<b style="font-size:16px;font-weight:700">Hey<span style="color:#00E5C0">Tiff</span></b><span style="flex:1"></span><a class="mb" href="#">{ico("plus", "ic i16")}New</a></header>'


def phone_box(ph):
    return f'''<div class="mbox">
  <div style="display:flex;align-items:center;gap:10px;min-height:32px">{tiff(28)}<span style="font-size:16px;line-height:24px;color:#5f6a79">{ph}</span></div>
  <div style="display:flex;align-items:center;gap:8px;margin-top:10px"><span class="bt" style="height:40px">{ico("camera", "ic i16")}Photo</span><span class="mic" style="width:40px;height:40px" aria-label="Talk to Tiff">{ico("mic", "ic i16")}</span><span style="flex:1"></span><span class="bt ink" style="height:40px;padding:0 16px">Send</span></div>
</div>'''


def phone_home():
    return f'''<div class="hz phn">{MARK_DEFS}
{phone_top()}
<div class="mpg">
  <div class="mhdr"><span>Tuesday 13 October</span><span style="flex:1"></span><span class="q">7:42 am</span></div>
  <div class="mbody">
    <div class="sh" style="margin:4px 0 4px"><h2 class="h16">Today</h2><span style="flex:1"></span><a class="lk" href="#">Schedule</a></div>
    {today_rows(4, True)}
    <div class="sh" style="margin:20px 0 4px"><h2 class="h16">To do</h2><span class="q">9</span><span style="flex:1"></span><a class="lk" href="#">Show all</a></div>
    {todo_rows(3)}
  </div>
  {phone_box("What's happening on site?")}
</div>
</div>'''


def phone_convo():
    return f'''<div class="hz phn">{MARK_DEFS}
{phone_top()}
<div class="mpg">
  <div class="mhdr"><span style="font-weight:600">Riverview brief</span><span style="flex:1"></span><span class="q">8:41 am</span></div>
  <div class="mbody" style="display:flex;flex-direction:column;gap:16px;padding-top:4px;justify-content:flex-end">{convo(True)}</div>
  {phone_box("Reply to Tiff")}
</div>
</div>'''


def build(out):
    out["H2-home.dc.html"] = page("Home", 1440, 900, CSS, desk_home())
    out["H2-convo.dc.html"] = page("Home, a conversation going", 1440, 900, CSS, desk_convo())
    out["HP2-home.dc.html"] = page("Home on a phone", 390, 844, CSS, phone_home())
    out["HP2-convo.dc.html"] = page("A conversation on a phone", 390, 844, CSS, phone_convo())
