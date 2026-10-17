"""Home, Claude style and simple, in five colour schemes, desktop and phone.
One template; each scheme is a set of colour tokens."""
from base import ico, page

SCHEMES = [
    ("light", "Light", dict(side="#F0F2F5", sfg="#050505", sq="#5f6a79", ssel="rgba(5,5,5,.07)", sline="rgba(5,5,5,.08)",
                             bg="#FFFFFF", surf="#FFFFFF", fg="#050505", q="#5f6a79", line="rgba(5,5,5,.08)", ctrl="rgba(5,5,5,.14)",
                             pri="#050505", pfg="#FFFFFF", dot="#050505", dotfg="#FFFFFF", mark="#050505", task="#E6E9EE", taskfg="#2a3342",
                             ok="#196B2D", warn="#a44b08", bad="#c81a41", tick="rgba(5,5,5,.3)", shadow="0 1px 2px rgba(10,12,20,.04)")),
    ("ink", "Ink sidebar", dict(side="#0A0B10", sfg="#FFFFFF", sq="rgba(255,255,255,.55)", ssel="rgba(255,255,255,.12)", sline="rgba(255,255,255,.1)",
                                bg="#FFFFFF", surf="#FFFFFF", fg="#050505", q="#5f6a79", line="rgba(5,5,5,.08)", ctrl="rgba(5,5,5,.14)",
                                pri="#050505", pfg="#FFFFFF", dot="#FFFFFF", dotfg="#050505", mark="#FFFFFF", task="#E6E9EE", taskfg="#2a3342",
                                ok="#196B2D", warn="#a44b08", bad="#c81a41", tick="rgba(5,5,5,.3)", shadow="0 1px 2px rgba(10,12,20,.04)")),
    ("warm", "Warm paper", dict(side="#F1EFE8", sfg="#1F1E1C", sq="#6E6A62", ssel="rgba(31,30,28,.07)", sline="rgba(31,30,28,.09)",
                                bg="#FAF9F6", surf="#FFFFFF", fg="#1F1E1C", q="#6E6A62", line="rgba(31,30,28,.09)", ctrl="rgba(31,30,28,.16)",
                                pri="#1F1E1C", pfg="#FAF9F6", dot="#1F1E1C", dotfg="#FAF9F6", mark="#1F1E1C", task="#ECE9E1", taskfg="#3A3833",
                                ok="#2F6B2A", warn="#9A4A0C", bad="#B4233F", tick="rgba(31,30,28,.3)", shadow="0 1px 3px rgba(31,30,28,.06)")),
    ("teal", "Teal accent", dict(side="#F0F2F5", sfg="#050505", sq="#5f6a79", ssel="rgba(0,163,137,.13)", sline="rgba(5,5,5,.08)",
                                 bg="#FFFFFF", surf="#FFFFFF", fg="#050505", q="#5f6a79", line="rgba(5,5,5,.08)", ctrl="rgba(5,5,5,.14)",
                                 pri="#007A67", pfg="#FFFFFF", dot="#007A67", dotfg="#FFFFFF", mark="#007A67", task="#E6E9EE", taskfg="#2a3342",
                                 ok="#196B2D", warn="#a44b08", bad="#c81a41", tick="rgba(0,122,103,.45)", shadow="0 1px 2px rgba(10,12,20,.04)", selfg="#00594B")),
    ("night", "Night", dict(side="#0A0B10", sfg="#ECEDEF", sq="rgba(236,237,239,.55)", ssel="rgba(255,255,255,.10)", sline="rgba(255,255,255,.08)",
                            bg="#121317", surf="#1A1C21", fg="#ECEDEF", q="#9DA3AD", line="rgba(255,255,255,.08)", ctrl="rgba(255,255,255,.16)",
                            pri="#ECEDEF", pfg="#0A0B10", dot="#ECEDEF", dotfg="#0A0B10", mark="#ECEDEF", task="#2A2D33", taskfg="#D5D8DD",
                            ok="#5BC27A", warn="#F0A431", bad="#FF6B88", tick="rgba(255,255,255,.35)", shadow="none")),
]

CSS = """
body{margin:0}
.hv,.hv *{box-sizing:border-box}
.hv{display:flex;overflow:hidden;position:relative;font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:14px;line-height:20px;color:var(--fg);background:var(--bg);-webkit-font-smoothing:antialiased}
.hv a{color:inherit;text-decoration:none}
.hv p,.hv h1,.hv h2{margin:0}
.ic{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.i16{width:16px;height:16px}
.sd{width:264px;flex:none;background:var(--side);color:var(--sfg);border-right:1px solid var(--sline);display:flex;flex-direction:column;padding:12px 8px 8px}
.br{display:flex;align-items:center;gap:8px;height:40px;padding:0 8px;margin-bottom:8px}
.br b{font-size:16px;font-weight:700;letter-spacing:-.2px}
.br b span{color:#00E5C0}
.sr{display:flex;align-items:center;gap:12px;height:36px;padding:0 8px;border-radius:10px;font-weight:500;white-space:nowrap}
.sr.on{background:var(--ssel);color:var(--selfg,var(--sfg));font-weight:600}
.sr .r{margin-left:auto;font-size:13px;font-weight:600}
.sr .r.q{color:var(--sq);font-weight:500}
.nb .pl{width:24px;height:24px;border-radius:50%;background:var(--dot);color:var(--dotfg);display:inline-flex;align-items:center;justify-content:center;margin:0 -3px}
.sl{font-size:12px;line-height:16px;font-weight:500;color:var(--sq);padding:16px 8px 4px}
.rc{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px;white-space:nowrap;overflow:hidden}
.rc .tx{overflow:hidden;text-overflow:ellipsis}
.rc .sq{width:8px;height:8px;flex:none}
.rc .ic{width:16px;height:16px;color:var(--sq)}
.me{margin-top:auto;display:flex;align-items:center;gap:12px;padding:8px;border-radius:10px}
.av{width:32px;height:32px;border-radius:50%;background:var(--dot);color:var(--dotfg);font-size:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex:none}
.q{color:var(--q)}
.sqq{color:var(--sq)}
.mn{flex:1;min-width:0;overflow:hidden}
.col{max-width:720px;margin:0 auto;padding:72px 32px 24px;display:flex;flex-direction:column}
.d32{font-size:32px;line-height:40px;font-weight:600;letter-spacing:-.4px}
.h16{font-size:16px;line-height:24px;font-weight:600}
.box{background:var(--surf);border:1px solid var(--ctrl);border-radius:16px;padding:16px 16px 12px;box-shadow:var(--shadow)}
.box .ph{font-size:16px;line-height:24px;color:var(--q);min-height:48px}
.bt{height:32px;padding:0 12px;border-radius:10px;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--ctrl);background:var(--surf);color:var(--fg);white-space:nowrap;flex:none}
.bt.pri{background:var(--pri);color:var(--pfg);border-color:var(--pri)}
.mic{width:32px;height:32px;border-radius:50%;border:1px solid var(--ctrl);display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--fg)}
.hd{display:flex;align-items:baseline;gap:12px;margin:40px 0 12px}
.hv .lk{text-decoration:underline;text-underline-offset:3px;font-weight:500;font-size:13px}
.strip{display:flex;gap:4px;height:88px}
.dc{position:relative;min-width:0;border-radius:10px;overflow:hidden;padding:8px 12px 12px;display:flex;flex-direction:column;justify-content:space-between;white-space:nowrap}
.dc .tg{font-size:12px;line-height:16px;font-weight:600;overflow:hidden;text-overflow:ellipsis}
.dc .nm{font-size:14px;line-height:20px;font-weight:700;overflow:hidden;text-overflow:ellipsis}
.dc .tm{font-size:13px;line-height:18px;font-weight:600}
.dc .fill{position:absolute;top:0;bottom:0;left:0;background:#291E52}
.dc .ring{position:absolute;inset:0;border-radius:10px;box-shadow:inset 0 0 0 3px var(--fg)}
.dc .z{position:relative;display:flex;flex-direction:column;justify-content:space-between;height:100%}
.dk{position:absolute;right:8px;top:8px;width:18px;height:18px;border-radius:50%;background:#196B2D;color:#fff;display:grid;place-items:center}
.nr{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.nr .m{flex:1;min-width:0}
.nr .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nr .s{font-size:13px;line-height:18px;color:var(--q)}
.ddot{width:8px;height:8px;border-radius:50%;flex:none;margin:0 5px}
.hv .tick{width:18px;height:18px;border:1.5px solid var(--tick);border-radius:6px;flex:none;background:transparent}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.vtag{position:absolute;right:16px;top:16px;font-size:12px;line-height:16px;font-weight:600;padding:4px 10px;border-radius:999px;background:rgba(127,127,127,.16);color:var(--fg)}
/* phone */
.ph2{width:390px;height:844px;display:flex;flex-direction:column}
.mt{height:56px;flex:none;display:flex;align-items:center;gap:8px;padding:0 12px 0 8px;background:var(--side);color:var(--sfg);border-bottom:1px solid var(--sline)}
.ib{width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px}
.hv a.mb{height:40px;padding:0 14px;border-radius:10px;font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:6px;background:var(--dot);color:var(--dotfg)}
.mscroll{flex:1;min-height:0;overflow:hidden;padding:16px 16px 0}
.mstrip{display:flex;gap:6px;height:84px;margin-right:-16px}
.mstrip .dc{flex:none;width:132px}
.mstrip .dc.on{width:176px}
.mbox{flex:none;margin:8px 12px 12px;background:var(--surf);border:1px solid var(--ctrl);border-radius:20px;padding:12px 12px 10px 16px;box-shadow:var(--shadow)}
"""


def svg_mark(color):
    return (f'<svg width="22" height="22" viewBox="0 0 100 100" aria-hidden="true"><path d="M22 24 L40 24 L62 50 L40 76 L22 76 L44 50 Z" fill="none" stroke="{color}" stroke-width="10" stroke-linejoin="round"></path>'
            f'<path d="M54 24 L72 24 L90 46" fill="none" stroke="{color}" stroke-width="10" stroke-linecap="round" opacity="0.4"></path></svg>')


def i(name, cls="ic", style=""):
    return ico(name, cls, style)


def tokens(t):
    return ";".join(f"--{k}:{v}" for k, v in t.items())


def sidebar(t):
    nav = [("home", "Home", "3"), ("chat", "Conversations", ""), ("jobs", "Jobs", ""), ("cal", "Schedule", ""), ("doc", "Documents", ""), ("lib", "Library", ""), ("design", "Design", ""), ("team", "Team", "")]
    rows = "".join(f'<a class="sr{" on" if k == "home" else ""}" href="#">{i(k)}{n}{f"<span class=r>{c}</span>" if c else ""}</a>' for k, n, c in nav)
    pinned = "".join(f'<a class="rc" href="#"><span class="sq" style="background:{c}"></span><span class="tx">{x}</span></a>' for c, x in [("#6D4FD8", "3342 Rifkin, Bellevue Hill"), ("#4B5565", "3302 Heuvel, Chatswood")])
    rec = "".join(f'<a class="rc" href="#">{i(k)}<span class="tx">{x}</span></a>' for k, x in [("chat", "Riverview brief, split install"), ("doc", "SWMS, Heuvel roof work"), ("person", "Lyle Irving"), ("jobs", "Northgate Realty, 3323"), ("chat", "Clearing an E6 on a Daikin split")])
    return f'''<aside class="sd">
  <div class="br">{svg_mark(t["mark"])}<b>Hey<span>Tiff</span></b><span style="flex:1"></span><span class="sqq">{i("panel")}</span></div>
  <a class="sr nb" href="#"><span class="pl">{i("plus", "ic", "width:14px;height:14px;stroke-width:2.4")}</span>New</a>
  <a class="sr" href="#">{i("search")}Search<span class="r q">⌘K</span></a>
  <div style="height:12px"></div>
  {rows}
  <div class="sl">Pinned</div>{pinned}
  <div class="sl">Recents</div>{rec}
  <a class="me" href="#"><span class="av">IS</span><span style="display:flex;flex-direction:column;min-width:0;flex:1"><span style="font-weight:600">Isaac Smith</span><span class="sqq" style="font-size:12px;line-height:16px">Owner</span></span><span class="sqq">{i("updown")}</span></a>
</aside>'''


def strip(t, phone=False):
    tick = f'<span class="dk">{i("check", "ic", "width:12px;height:12px;stroke-width:3")}</span>'
    cards = [
        ("done", "#B4C5EE", "#43506a", "Kingsford", "Job 2380", "7:30 to 8:30", 132),
        ("on", "#6D4FD8", "#fff", "Bellevue Hill", "Job 3342", "9:00 to 11:30", 230),
        ("task", t["task"], t["taskfg"], "Task", "Order the grilles", "By 12:30", 150),
        ("", "#3D8620", "#fff", "Alexandria", "Job 1042", "12:45 to 1:45", 112),
        ("", "#8A6A00", "#fff", "Randwick", "Job 3271", "2:45 to 4:00", 124),
    ]
    out = []
    for kind, bg, fg, tag, name, tm, flex in cards:
        extra = ""
        if kind == "on":
            extra = '<span class="fill" style="width:56%"></span><span class="ring"></span>'
        style = f"background:{bg};color:{fg}" + ("" if phone else f";flex:{flex} 1 0")
        cls = "dc on" if kind == "on" else "dc"
        out.append(f'<a class="{cls}" href="#" style="{style}">{extra}<span class="z"><span class="tg" style="{"padding-right:24px" if kind == "done" else ""}">{tag}</span><span style="display:flex;flex-direction:column"><span class="nm">{name}</span><span class="tm">{tm}</span></span></span>{tick if kind == "done" else ""}</a>')
    return f'<div class="{"mstrip" if phone else "strip"}">{"".join(out)}</div>'


NEEDS = [
    ("dot", "bad", "Hilux XQG 41B rego", "Runs out today", "Renew"),
    ("dot", "warnd", "Kingsford Bakery, 2380", "Finished, ready to invoice", "Invoice"),
    ("dot", "warnd", "Timesheets, last week", "4 to approve, 150.5 hours", "Review"),
    ("dot", "info", "Quote to write: Riverview", "Brief saved yesterday, 8:40 am", "Quote"),
    ("task", "", "Ring the Hilux dealer", "From your note yesterday", None),
]
DOTS = {"bad": "#e0264f", "warnd": "#F0A431", "info": "#2554d8"}


def needs(n=5):
    rows = []
    for kind, c, title, sub, verb in NEEDS[:n]:
        lead = '<span class="tick"></span>' if kind == "task" else f'<span class="ddot" style="background:{DOTS[c]}"></span>'
        sc = ' bad' if c == "bad" else ''
        v = f'<a class="bt" href="#">{verb}</a>' if verb else ""
        rows.append(f'<div class="nr">{lead}<div class="m"><div class="t">{title}</div><div class="s{sc}">{sub}</div></div>{v}</div>')
    return "".join(rows)


def desktop(key, name, t):
    return f'''<div class="hv" style="width:1440px;height:900px;{tokens(t)}">
{sidebar(t)}
<main class="mn">
  <div class="col">
    <h1 class="d32">Morning, Isaac</h1>
    <p class="q" style="margin-top:4px">Tuesday 13 October</p>
    <div class="box" style="margin-top:24px">
      <div class="ph">What's happening on site?</div>
      <div style="display:flex;align-items:center;gap:8px"><span class="bt">{i("camera", "ic i16")}Add photo</span><span class="mic" aria-label="Talk to Tiff">{i("mic", "ic i16")}</span><span style="flex:1"></span><span class="bt pri">Send</span></div>
    </div>
    <div class="hd"><h2 class="h16">Your day</h2><span class="q">4 jobs and a task, 7:30 to 4:00</span><span style="flex:1"></span><a class="lk" href="#">Schedule</a></div>
    {strip(t)}
    <div class="hd"><h2 class="h16">To do</h2><span class="q">9</span><span style="flex:1"></span><a class="lk" href="#">Show all</a></div>
    <div>{needs()}</div>
  </div>
</main>
<span class="vtag">{name}</span>
</div>'''


def phone(key, name, t):
    return f'''<div class="hv ph2" style="{tokens(t)}">
<header class="mt"><span class="ib" aria-label="Menu">{i("menu")}</span>{svg_mark(t["mark"])}<b style="font-size:16px;font-weight:700">Hey<span style="color:#00E5C0">Tiff</span></b><span style="flex:1"></span><a class="mb" href="#">{i("plus", "ic i16")}New</a></header>
<div class="mscroll">
  <h1 style="font-size:24px;line-height:32px;font-weight:600;letter-spacing:-.2px">Morning, Isaac</h1>
  <p class="q">Tuesday 13 October. 4 jobs and a task.</p>
  <div style="margin-top:16px">{strip(t, True)}</div>
  <div class="hd" style="margin:24px 0 4px"><h2 class="h16">To do</h2><span class="q">9</span><span style="flex:1"></span><a class="lk" href="#">Show all</a></div>
  <div>{needs(4)}</div>
</div>
<div class="mbox">
  <div style="font-size:16px;line-height:24px;color:var(--q);min-height:28px">What's happening on site?</div>
  <div style="display:flex;align-items:center;gap:8px;margin-top:8px"><span class="bt" style="height:40px">{i("camera", "ic i16")}Photo</span><span class="mic" style="width:40px;height:40px" aria-label="Talk to Tiff">{i("mic", "ic i16")}</span><span style="flex:1"></span><span class="bt pri" style="height:40px;padding:0 16px">Send</span></div>
</div>
</div>'''


def build(out):
    for key, name, t in SCHEMES:
        out[f"H-{key}.dc.html"] = page(f"Home, {name}", 1440, 900, CSS, desktop(key, name, t))
        out[f"HP-{key}.dc.html"] = page(f"Home on a phone, {name}", 390, 844, CSS, phone(key, name, t))
