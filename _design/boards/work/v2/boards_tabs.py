"""Tabs inside the app, Chrome style. The strip sits on the ink above the white
page; the tab you're on is paper and runs into the page with the same curl as
the frame's corner. Desktop only."""
from base import ico, page
from boards_home2 import CSS as HCSS, MARK_DEFS, tiff, mark_svg, box, today_rows, todo_rows

CSS = HCSS + """
.win{flex:1;min-width:0;display:flex;flex-direction:column}
.win .pg{flex:1;min-height:0;border-radius:16px 0 0 16px}
.tstrip{height:50px;flex:none;display:flex;align-items:flex-end;padding:0 16px 0 28px;color:#fff;position:relative}
.ctab{position:relative;height:36px;flex:0 1 224px;min-width:0;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;border-radius:10px 10px 0 0;font-size:13px;line-height:18px;font-weight:500;white-space:nowrap}
.ctab>*{position:relative}
.ctab .ti{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.ctab .ico{width:16px;height:16px;color:rgba(255,255,255,.5)}
.ctab .x{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none;color:rgba(255,255,255,.5)}
.ctab .x .ico{width:14px;height:14px;color:inherit}
.ctab.hov::before{content:"";position:absolute;inset:3px 2px 4px;border-radius:10px;background:rgba(255,255,255,.06)}
.ctab.on{background:#fff;color:#050505;font-weight:600}
.ctab.on .ico,.ctab.on .x{color:#5f6a79}
.ctab.on::before,.ctab.on::after{content:"";position:absolute;bottom:0;width:10px;height:10px}
.ctab.on::before{left:-10px;background:radial-gradient(circle at 0 0,transparent 9.5px,#fff 10px)}
.ctab.on::after{right:-10px;background:radial-gradient(circle at 100% 0,transparent 9.5px,#fff 10px)}
.ctab.nar{flex:0 0 44px;padding:0;justify-content:center}
.ctab.nar.on{flex-basis:160px;justify-content:flex-start;padding:0 8px 0 12px}
.tsep{width:1px;height:20px;margin-bottom:8px;background:rgba(255,255,255,.35);flex:none}
.tsep.hide{background:transparent}
.newtab{height:28px;margin:0 0 4px 8px;padding:0 10px;border-radius:10px;display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:18px;font-weight:500;color:rgba(255,255,255,.5);white-space:nowrap;flex:none}
.newtab .ico{width:14px;height:14px}
.h24{font-size:24px;line-height:32px;font-weight:700;letter-spacing:-.2px;margin:0}
.ghd{height:64px;flex:none;display:flex;align-items:center;gap:12px;padding:0 24px 0 32px;border-bottom:1px solid rgba(5,5,5,.08)}
.dd2{height:32px;padding:0 10px 0 12px;border-radius:10px;display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;white-space:nowrap}
.dd2 .ico{width:14px;height:14px;color:#5f6a79}
.seg2{display:inline-flex;gap:2px;padding:2px;border-radius:10px;background:#F0F2F5}
.seg2 span{height:28px;padding:0 12px;border-radius:8px;display:inline-flex;align-items:center;font-size:13px;font-weight:500;color:#5f6a79}
.seg2 span.on{background:#fff;color:#050505;font-weight:600;box-shadow:0 0 0 1px rgba(5,5,5,.08)}
.cvs{flex:1;min-width:0;position:relative;background-color:#fff;background-image:radial-gradient(rgba(5,5,5,.12) 1px,transparent 1.2px);background-size:24px 24px;overflow:hidden}
.tools{position:absolute;left:50%;top:16px;transform:translateX(-50%);display:flex;gap:2px;padding:4px;border-radius:16px;background:#fff;box-shadow:0 12px 32px rgba(10,12,20,.16);z-index:1}
.tools span{height:32px;padding:0 12px;border-radius:10px;display:inline-flex;align-items:center;font-size:13px;font-weight:500;color:#050505}
.tools span.on{background:rgba(5,5,5,.07);font-weight:600}
.tools i{width:1px;margin:6px 4px;background:rgba(5,5,5,.08)}
.zoom{position:absolute;right:16px;bottom:16px;display:flex;gap:2px;padding:4px;border-radius:12px;background:#fff;border:1px solid rgba(5,5,5,.08)}
.zoom span{height:28px;padding:0 10px;border-radius:8px;display:inline-flex;align-items:center;font-size:13px;font-weight:500}
.sys{width:320px;flex:none;border-left:1px solid rgba(5,5,5,.08);padding:20px 20px;display:flex;flex-direction:column;gap:8px;overflow:hidden}
.sys .card2{border:1px solid rgba(5,5,5,.08);border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.kv2{display:grid;grid-template-columns:96px minmax(0,1fr);gap:6px 12px;font-size:13px;line-height:18px}
.kv2 dt{color:#5f6a79;font-weight:500}
.kv2 dd{margin:0;font-weight:500}
.zr{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid rgba(5,5,5,.08)}
.zr .z{flex:1;font-weight:600}
.num{font-variant-numeric:tabular-nums}
/* job */
.jh{padding:24px 32px 0;display:flex;flex-direction:column;gap:16px}
.crumb2{display:flex;align-items:center;gap:8px;color:#5f6a79;font-weight:500}
.crumb2 b{color:#050505;font-weight:600}
.crumb2 .ico{width:16px;height:16px}
.steps{display:flex;align-items:center;gap:8px;font-size:13px;line-height:18px;font-weight:500;color:#5f6a79;white-space:nowrap}
.steps .on{color:#050505;font-weight:600}
.steps .sep{width:16px;height:1px;background:rgba(5,5,5,.2)}
.utabs{display:flex;gap:24px;border-bottom:1px solid rgba(5,5,5,.08)}
.utabs a{height:40px;display:inline-flex;align-items:center;font-weight:500;color:#5f6a79;border-bottom:2px solid transparent;margin-bottom:-1px}
.hz .utabs a.on{color:#050505;border-color:#050505;font-weight:600}
.bt2{height:36px;padding:0 16px;border-radius:10px;font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(5,5,5,.14);background:#fff;white-space:nowrap;flex:none}
.bt2.ink{background:#050505;color:#fff;border-color:#050505}
.bt2 .ico{width:16px;height:16px}
.info{color:#2554d8}.warn{color:#a44b08}
.gr{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid rgba(5,5,5,.08)}
.gr .ico{color:#5f6a79}
/* schedule */
.lane{display:grid;grid-template-columns:168px minmax(0,1fr);border-bottom:1px solid rgba(5,5,5,.08);height:76px}
.blk{position:absolute;z-index:1;top:10px;bottom:10px;border-radius:10px;color:#fff;padding:7px 10px;overflow:hidden;white-space:nowrap}
.blk b{display:block;font-size:13px;line-height:18px;overflow:hidden;text-overflow:ellipsis}
.blk span{display:block;font-size:12px;line-height:16px;font-weight:500;overflow:hidden;text-overflow:ellipsis}
.av2{width:28px;height:28px;border-radius:50%;background:#F0F2F5;color:#050505;font-size:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex:none}
.cap2{font-size:12px;line-height:16px;font-weight:500;color:#5f6a79}
.nd{border:1px solid rgba(5,5,5,.08);border-radius:16px;padding:12px 14px;margin-bottom:8px}
.xb2{width:32px;height:32px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;color:#050505;flex:none}
/* month */
.mg{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border-left:1px solid rgba(5,5,5,.08)}
.mg .dh{font-size:12px;line-height:16px;font-weight:500;color:#5f6a79;padding:0 10px 8px}
.mc{border-right:1px solid rgba(5,5,5,.08);border-bottom:1px solid rgba(5,5,5,.08);height:122px;padding:8px 8px 6px;display:flex;flex-direction:column;gap:4px;min-width:0;overflow:hidden}
.mc .dn{font-size:13px;line-height:18px;font-weight:600;padding:0 2px 2px}
.mc.out .dn{color:#5f6a79;font-weight:500}
.mc.today .dn span{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:999px;background:#050505;color:#fff;padding:0 6px;margin:-3px 0 -3px -4px}
.sv{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;line-height:18px;font-weight:500;padding:2px 6px 2px 0;border-radius:6px}
.sv .cb{width:3px;align-self:stretch;border-radius:2px;flex:none;background:#2F5FD0}
.sv .tx{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sv .tm{color:#5f6a79;font-variant-numeric:tabular-nums;flex:none}
.sv.done{color:#5f6a79}
.sv.done .cb{background:#B4C5EE}
.sv.np .cb{background:transparent;border:1px dashed #a44b08;width:1px}
.sv .st{font-size:12px;line-height:16px;font-weight:600;flex:none}
/* spec board */
.spec{width:1440px;height:900px;background:#fff;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#050505;font-size:14px;line-height:20px;display:flex;gap:48px;padding:48px 56px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.spec *{box-sizing:border-box}
.spec h2{font-size:16px;line-height:24px;font-weight:600;margin:0}
.spec p{margin:0}
.ex{display:flex;flex-direction:column;gap:8px}
.spec a{color:inherit;text-decoration:none}
.ink{background:#050505;border-radius:16px 16px 0 0;overflow:hidden;position:relative}
.ink .tstrip{padding-left:28px}
.ink .paper{height:24px;background:#fff}
.rules{display:flex;flex-direction:column}
.rl{display:grid;grid-template-columns:150px minmax(0,1fr);gap:16px;padding:12px 0;border-top:1px solid rgba(5,5,5,.08)}
.rl b{font-weight:600}
.menu2{position:absolute;background:#fff;border-radius:16px;box-shadow:0 12px 32px rgba(10,12,20,.16);padding:6px;width:220px;z-index:5}
.menu2 a{display:flex;align-items:center;height:36px;padding:0 12px;border-radius:10px;font-weight:500}
.menu2 a.hv{background:rgba(5,5,5,.07)}
.menu2 i{display:block;height:1px;background:rgba(5,5,5,.08);margin:6px 4px}
.key{display:inline-flex;align-items:center;height:22px;padding:0 6px;border-radius:6px;border:1px solid rgba(5,5,5,.14);font-size:12px;font-weight:600;margin-right:2px}
"""

JOB_A = "#6D4FD8"


# ------------------------------------------------------------------ the strip
def tab(icon, title, on=False, hov=False, closable=True, cls=""):
    x = f'<span class="x" aria-label="Close {title}">{ico("x")}</span>' if closable else ""
    t = f'<span class="ti">{title}</span>' if title else ""
    return f'<div class="ctab{" on" if on else ""}{" hov" if hov else ""}{(" " + cls) if cls else ""}" role="tab" aria-selected="{"true" if on else "false"}">{icon}{t}{x}</div>'


def strip(tabs, on, hov=None, newtab=True):
    """tabs: list of (icon_html, title). on: index of the tab you're on."""
    parts = []
    for i, (ic, t) in enumerate(tabs):
        if i:
            hide = on in (i - 1, i) or (hov is not None and hov in (i - 1, i))
            parts.append(f'<i class="tsep{" hide" if hide else ""}"></i>')
        parts.append(tab(ic, t, on=(i == on), hov=(i == hov)))
    nt = f'<span class="newtab">{ico("plus")}New tab</span>' if newtab else ""
    return f'<nav class="tstrip" role="tablist" aria-label="Open tabs">{"".join(parts)}{nt}</nav>'


def I(name):
    return ico(name)


HOME_T = (I("home"), "Home")
DESIGN_T = (I("design"), "Okafor house")
JOB61_T = (I("jobs"), "3361 Okafor, Riverview")
SCHED_T = (I("cal"), "Schedule")
MAINT_T = (I("repeat"), "Maintenance, October")
JOB42_T = (I("jobs"), "3342 Rifkin, Bellevue Hill")


# ------------------------------------------------------------------ the sidebar
def sidebar(active):
    nav = [("home", "Home", "3"), ("chat", "Conversations", ""), ("jobs", "Jobs", ""), ("cal", "Schedule", ""), ("doc", "Documents", ""), ("lib", "Library", ""), ("design", "Design", ""), ("team", "Team", "")]
    rows = "".join(f'<a class="sr{" on" if k == active else ""}" href="#">{ico(k)}{n}{f"<span class=r>{c}</span>" if c else ""}</a>' for k, n, c in nav)
    pinned = "".join(f'<a class="rc" href="#"><span class="sq" style="background:{c}"></span><span class="tx">{x}</span></a>' for c, x in [(JOB_A, "3342 Rifkin, Bellevue Hill"), ("#4B5565", "3302 Heuvel, Chatswood")])
    rec_items = [("chat", "Riverview brief"), ("doc", "SWMS, Heuvel roof work"), ("person", "Lyle Irving"), ("jobs", "Northgate Realty, 3323"), ("chat", "Clearing an E6 on a Daikin split")]
    rec = "".join(f'<a class="rc" href="#">{ico(k)}<span class="tx">{x}</span></a>' for k, x in rec_items)
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


def frame(active, tabs, on, body, hov=None):
    return f'''<div class="hz" style="width:1440px;height:900px">{MARK_DEFS}
{sidebar(active)}
<div class="win">
{strip(tabs, on, hov)}
<main class="pg">
{body}
</main>
</div>
</div>'''


# ------------------------------------------------------------------ design
def plan_svg():
    O = "#E8590C"
    W = "rgba(5,5,5,.72)"

    def zone(x, y, w, h, fill, name, area, load, extra=""):
        return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"/>'
                f'<text x="{x + 16}" y="{y + 28}" font-size="13" font-weight="600" fill="#050505">{name}</text>'
                f'<text x="{x + 16}" y="{y + 46}" font-size="12" font-weight="500" fill="#5f6a79">{area}</text>'
                f'<text x="{x + 16}" y="{y + 62}" font-size="12" font-weight="500" fill="#5f6a79">{load}</text>{extra}')
    grey = "rgba(5,5,5,.035)"
    z = "".join([
        zone(0, 0, 260, 220, "rgba(232,89,12,.08)", "Main bedroom", "15.6 m²", "Needs about 2.1 kW",
             f'<text x="16" y="80" font-size="12" font-weight="600" fill="{O}">FTXM25 fits</text>'),
        zone(260, 0, 160, 220, grey, "Study", "9.6 m²", "Needs about 1.4 kW"),
        zone(420, 0, 280, 220, grey, "Bed 2", "16.8 m²", "Needs about 2.2 kW"),
        zone(0, 270, 420, 210, grey, "Living", "30.2 m²", "Needs about 4.6 kW"),
    ])
    rooms = (f'<text x="436" y="298" font-size="13" font-weight="500" fill="#5f6a79">Kitchen</text>'
             f'<text x="436" y="428" font-size="13" font-weight="500" fill="#5f6a79">Laundry</text>'
             f'<text x="576" y="428" font-size="13" font-weight="500" fill="#5f6a79">Bath</text>'
             f'<text x="16" y="252" font-size="13" font-weight="500" fill="#5f6a79">Hall</text>')
    walls = (f'<rect x="0" y="0" width="700" height="480" fill="none" stroke="{W}" stroke-width="6"/>'
             f'<path d="M260 0V220M420 0V220M0 220H120M160 220H300M340 220H460M500 220H700M420 270V480M0 270H40M90 270H360M420 270H700M420 400H700M560 400V480" fill="none" stroke="{W}" stroke-width="4"/>')
    unit = (f'<rect x="245" y="62" width="10" height="84" rx="3" fill="{O}"/>'
            f'<path d="M250 62V-30H200" fill="none" stroke="{O}" stroke-width="2.5" stroke-dasharray="6 4"/>'
            f'<rect x="140" y="-52" width="60" height="40" rx="4" fill="#fff" stroke="{O}" stroke-width="2.5"/>'
            f'<text x="170" y="-27" font-size="12" font-weight="600" fill="{O}" text-anchor="middle">RXM25</text>'
            f'<text x="214" y="-38" font-size="12" font-weight="500" fill="#5f6a79">Outdoor, on the north wall</text>')
    return f'<svg viewBox="-20 -80 740 580" width="740" height="580" style="position:absolute;left:50%;top:92px;margin-left:-370px;font-family:Plus Jakarta Sans,system-ui,sans-serif">{z}{walls}{rooms}{unit}</svg>'


def design_body():
    tools = "".join(f'<span class="{"on" if t == "Select" else ""}">{t}</span>' for t in ["Select", "Erase", "Zone", "Draw", "Component", "Note"]) + '<i></i><span>Undo</span>'
    zones = "".join(f'<div class="zr"><span class="z">{n}</span><span class="s num">{k}</span></div>' for n, k in [("Study", "1.4 kW"), ("Bed 2", "2.2 kW"), ("Living", "4.6 kW")])
    return f'''<div class="ghd">
  <h1 class="h24">Okafor house</h1><span class="q" style="margin-top:4px">Saved</span>
  <a class="lk" href="#" style="margin-top:4px;font-size:14px">For 3361 Okafor, Riverview</a>
  <span style="flex:1"></span>
  <span class="dd2">Ground floor{ico("down")}</span><span class="dd2">Calibrate{ico("down")}</span><span class="dd2">View{ico("down")}</span>
  <span style="width:12px"></span>
  <span class="seg2"><span class="on">Design</span><span>Schematic</span><span>Summary</span></span>
</div>
<div style="flex:1;min-height:0;display:flex">
  <div class="cvs">
    <div class="tools">{tools}</div>
    {plan_svg()}
    <div class="zoom"><span>Fit</span><span class="num">100%</span></div>
  </div>
  <aside class="sys">
    <div style="display:flex;align-items:baseline;gap:12px"><h2 class="h16">Systems</h2><span style="flex:1"></span><a class="lk" href="#">Add a system</a></div>
    <div class="card2">
      <div style="display:flex;align-items:center;gap:10px"><span class="dd" style="background:#E8590C;margin:0"></span><b style="flex:1">Main bedroom</b><span class="s">Split, Daikin</span></div>
      <dl class="kv2" style="margin:0"><dt>Outdoor</dt><dd>RXM25, north wall</dd><dt>Indoor</dt><dd>FTXM25, on the study wall</dd><dt>Cover</dt><dd class="num">2.1 of 2.5 kW</dd></dl>
      <div style="display:flex;gap:8px"><span class="bt">Add zones</span><span class="bt">Edit system</span></div>
    </div>
    <div style="display:flex;align-items:baseline;gap:12px;margin-top:16px"><h2 class="h16">Zones without a system</h2></div>
    {zones}
  </aside>
</div>'''


# ------------------------------------------------------------------ job 3361
def job61_body():
    steps = [("Enquiry", "on"), ("Quoted", ""), ("Accepted", ""), ("Booked", ""), ("On site", ""), ("Done", ""), ("Invoiced", ""), ("Paid", "")]
    st = '<span class="sep"></span>'.join(f'<span class="{c}">{n}</span>' for n, c in steps)
    tabs = "".join(f'<a class="{"on" if t == "Overview" else ""}" href="#">{t}</a>' for t in ["Overview", "Notes", "Quote", "Visits", "Photos", "Documents", "Billing", "Contacts"])
    return f'''<div class="jh">
  <div class="crumb2"><a href="#">Jobs</a>{ico("right")}<b>3361</b></div>
  <div style="display:flex;align-items:flex-start;gap:12px">
    <div style="display:flex;flex-direction:column;gap:4px;min-width:0"><h1 class="h24">Okafor, Ada</h1><p class="q">Job 3361, Quote, 12 River Rd, Riverview. <span class="info" style="font-weight:600">Quote to write</span></p></div>
    <span style="flex:1"></span><a class="bt2" href="#">Open in ServiceM8</a><span class="bt2">Actions{ico("down")}</span>
  </div>
  <div class="steps">{st}</div>
  <nav class="utabs">{tabs}</nav>
</div>
<div style="flex:1;min-height:0;display:flex;gap:32px;padding:24px 32px;overflow:hidden">
  <section style="flex:1;min-width:0;display:flex;flex-direction:column;gap:24px">
    <div>
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:8px"><h2 class="h16">The brief</h2><span class="s">Spoken to Tiff today, 8:40 am</span><span style="flex:1"></span><a class="lk" href="#">Riverview brief</a></div>
      <p style="font-size:24px;line-height:32px;font-weight:400">A split in the main bedroom, back to back with the study.</p>
    </div>
    <div class="box" style="box-shadow:none">
      <div class="ph" style="min-height:44px">Write a note on this job</div>
      <div style="display:flex;align-items:center;gap:8px"><span class="mic" aria-label="Dictate">{ico("mic", "ic i16")}</span><span style="flex:1"></span><span class="bt ink">Save note</span></div>
    </div>
    <div>
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:4px"><h2 class="h16">Notes</h2><span class="s">None yet</span></div>
    </div>
  </section>
  <aside style="width:360px;flex:none;display:flex;flex-direction:column;gap:24px">
    <section><h2 class="h16" style="margin-bottom:8px">Where it's up to</h2><p>The brief is in and the design is started. The quote is next.</p><div style="margin-top:12px"><span class="bt2 ink">Write the quote</span></div></section>
    <section>
      <h2 class="h16" style="margin-bottom:4px">Design</h2>
      <a class="gr" href="#">{ico("design")}<span style="flex:1;font-weight:500">Okafor house</span><span class="s">Open in a tab</span></a>
    </section>
    <section>
      <h2 class="h16" style="margin-bottom:4px">Documents on this job</h2>
      <a class="gr" href="#">{ico("doc")}<span style="flex:1;font-weight:500">Quote</span><span class="s">Not started</span></a>
    </section>
    <section><h2 class="h16" style="margin-bottom:8px">Contacts</h2><p>Ada Okafor, 0413 555 207</p></section>
  </aside>
</div>'''


# ------------------------------------------------------------------ schedule, day
def schedule_body():
    hours = list(range(7, 18))
    head = "".join(f'<div class="cap2" style="position:absolute;left:{(h - 7) / 10 * 100}%;top:8px;transform:translateX(-50%)">{h if h <= 12 else h - 12}{"am" if h < 12 else "pm"}</div>' for h in hours[1:-1])
    people = [
        ("Isaac Smith", [(7.5, 8.5, "#B4C5EE", "Kingsford", "Job 2380, done", "#43506a"), (14.75, 16, "#8A6A00", "Randwick", "Job 3271", "#fff")]),
        ("Lyle Irving", [(9, 11.5, JOB_A, "Bellevue Hill", "Job 3342", "#fff")]),
        ("Callum Ahn", [(9, 11.5, JOB_A, "Bellevue Hill", "Job 3342", "#fff"), (12.5, 15.5, "#4B5565", "Chatswood", "Job 3302", "#fff")]),
        ("Dan Walsh", [(12.75, 13.75, "#3D8620", "Alexandria", "Job 1042", "#fff"), (14.25, 16.25, "#2F5FD0", "Botany", "Service 2601", "#fff")]),
        ("Kai Lee", []),
    ]
    lanes = ""
    for name, blocks in people:
        bl = "".join(f'<div class="blk" style="left:{(s - 7) / 10 * 100}%;width:{(e - s) / 10 * 100}%;background:{c};color:{tc}"><b>{t}</b><span>{sub}</span></div>' for s, e, c, t, sub, tc in blocks)
        if not blocks:
            bl = '<div style="position:absolute;inset:10px 0;border-radius:10px;background:#F0F2F5;display:flex;align-items:center;padding:0 12px;font-size:13px;font-weight:500;color:#5f6a79">On leave, back Thursday</div>'
        ini = "".join(w[0] for w in name.split())
        lanes += f'<div class="lane"><div style="display:flex;align-items:center;gap:10px;font-weight:600"><span class="av2">{ini}</span>{name}</div><div style="position:relative">{bl}</div></div>'
    now = (10 + 5 / 60 - 7) / 10
    nd = [("Northgate Realty, 3323", "Install, about 2 days", "q"), ("Ardex Logistics, service", "Due today", "warn"), ("Heuvel, visit 3: fit-off", "Job 3302, around 20 October", "q"), ("Grange Microbrewery, 3288", "Install, about 1 day", "q")]
    nds = "".join(f'<div class="nd"><div style="font-weight:600">{t}</div><div class="s {c}">{s}</div></div>' for t, s, c in nd)
    return f'''<div class="ghd">
  <h1 class="h24">Schedule</h1>
  <span class="seg2" style="margin-left:12px"><span class="on">Day</span><span>Week</span><span>Month</span></span>
  <span style="flex:1"></span>
  <span class="bt">Today</span><span class="xb2" aria-label="Previous day">{ico("left")}</span><span style="font-weight:600;font-size:14px">Tuesday 13 October</span><span class="xb2" aria-label="Next day">{ico("right")}</span>
</div>
<div style="flex:1;min-height:0;display:flex">
  <div style="flex:1;min-width:0;padding:8px 24px 0 32px;position:relative">
    <div class="lane" style="height:32px"><div></div><div style="position:relative">{head}</div></div>
    {lanes}
    <div class="s" style="padding:16px 0">Crew today: 4 of 5. 31 of 40 hours booked.</div>
    <div style="position:absolute;top:40px;height:{76 * 5}px;left:calc(32px + 168px + (100% - 32px - 24px - 168px) * {now:.4f});width:2px;background:#050505;border-radius:1px"></div>
  </div>
  <aside style="width:320px;flex:none;border-left:1px solid rgba(5,5,5,.08);padding:20px">
    <h2 class="h16">Not on a day yet</h2><p class="s" style="margin:2px 0 12px">Drag one onto a lane</p>
    {nds}
  </aside>
</div>'''


# ------------------------------------------------------------------ schedule, month, maintenance only
def maint_body():
    import datetime as dt
    start = dt.date(2026, 9, 28)
    S = {
        dt.date(2026, 9, 29): [("done", "", "Meridian Data")],
        dt.date(2026, 10, 2): [("done", "", "Belmont Holdings")],
        dt.date(2026, 10, 6): [("done", "", "Grange Microbrewery")],
        dt.date(2026, 10, 7): [("done", "", "Scott Group")],
        dt.date(2026, 10, 9): [("np", "", "Coogee Pavilion", '<span class="st" style="color:#c81a41">Overdue</span>')],
        dt.date(2026, 10, 12): [("done", "", "Hale Street apartments")],
        dt.date(2026, 10, 13): [("", "12:45", "Meridian Data"), ("", "2:45", "Randwick Dental"), ("np", "", "Ardex Logistics", '<span class="st warn">Not placed</span>')],
        dt.date(2026, 10, 15): [("", "8:00", "Northgate Realty")],
        dt.date(2026, 10, 19): [("", "7:00", "Kingsford Bakery")],
        dt.date(2026, 10, 21): [("", "7:30", "Bondi Surf Club")],
        dt.date(2026, 10, 22): [("np", "", "Ryde Library", '<span class="st warn">Not placed</span>')],
        dt.date(2026, 10, 27): [("", "8:00", "Marrickville Medical")],
        dt.date(2026, 10, 29): [("", "9:30", "Rozelle Bowling Club")],
    }
    heads = "".join(f'<div class="dh">{d}</div>' for d in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    cells = ""
    for i in range(35):
        d = start + dt.timedelta(days=i)
        out = d.month != 10
        today = d == dt.date(2026, 10, 13)
        num = f'<span>{d.day}</span>' if today else (f'{d.day} {d.strftime("%b")}' if (d.day == 1 or i == 0) else str(d.day))
        items = ""
        for it in S.get(d, []):
            kind, tm, who = it[0], it[1], it[2]
            extra = it[3] if len(it) > 3 else ""
            tmh = f'<span class="tm">{tm}</span>' if tm else ""
            if kind == "np":
                items += f'<div class="sv np" style="flex-direction:column;align-items:flex-start;gap:0;padding-left:8px;border-left:2px dashed {"#c81a41" if "Overdue" in extra else "#a44b08"};border-radius:0"><span class="tx" style="max-width:100%">{who}</span>{extra}</div>'
            else:
                items += f'<div class="sv{" done" if kind == "done" else ""}"><span class="cb"></span>{tmh}<span class="tx">{who}</span></div>'
        cells += f'<div class="mc{" out" if out else ""}{" today" if today else ""}"><div class="dn">{num}</div>{items}</div>'
    return f'''<div class="ghd">
  <h1 class="h24">Schedule</h1>
  <span class="seg2" style="margin-left:12px"><span>Day</span><span>Week</span><span class="on">Month</span></span>
  <span class="dd2" style="border:1px solid rgba(5,5,5,.14);margin-left:4px">Show: Maintenance{ico("down")}</span>
  <span style="flex:1"></span>
  <span class="bt">Today</span><span class="xb2" aria-label="Previous month">{ico("left")}</span><span style="font-weight:600;font-size:14px">October 2026</span><span class="xb2" aria-label="Next month">{ico("right")}</span>
</div>
<div style="padding:16px 24px 0 32px">
  <p class="q" style="margin-bottom:16px">14 services in October. 3 not on a day yet, 1 of them overdue.</p>
  <div class="mg" style="border-left:0">{heads}</div>
  <div class="mg" style="border-top:1px solid rgba(5,5,5,.08)">{cells}</div>
</div>'''


# ------------------------------------------------------------------ home in a tab
def home_body():
    return f'''<div class="hdr"><span>Tuesday 13 October</span><span style="flex:1"></span><span class="q">10:05 am</span></div>
  <div class="col" style="padding-top:4px">
    <div style="display:flex;justify-content:center;margin-bottom:16px">{tiff(52)}</div>
    {box()}
    <div class="sh"><h2 class="h16">Today</h2><span class="q">4 jobs and a task</span><span style="flex:1"></span><a class="lk" href="#">Schedule</a></div>
    {today_rows()}
  </div>'''


# ------------------------------------------------------------------ how tabs behave
def spec():
    def band(tabs, on, hov=None, extra="", newtab=True, h=None):
        return f'<div class="ink">{strip(tabs, on, hov, newtab)}<div class="paper"></div>{extra}</div>'

    def ex(title, inner):
        return f'<div class="ex"><h2>{title}</h2>{inner}</div>'

    working = (tiff(16, True), "Riverview brief")
    many = [HOME_T, DESIGN_T, JOB61_T, SCHED_T, MAINT_T, JOB42_T, (I("doc"), "SWMS, Heuvel roof work"), (I("person"), "Lyle Irving"), (I("jobs"), "3323 Northgate Realty"), (I("team"), "Team, Timesheets"), (I("lib"), "Library")]
    many_html = []
    for i, (ic, t) in enumerate(many):
        if i:
            many_html.append(f'<i class="tsep{" hide" if i in (2, 3) else ""}"></i>')
        many_html.append(tab(ic, t if i == 2 else "", on=(i == 2), closable=(i == 2), cls="nar"))
    many_strip = f'<div class="ink"><nav class="tstrip">{"".join(many_html)}<span class="newtab">{ico("plus")}New tab</span></nav><div class="paper"></div></div>'

    menu = '''<div class="menu2" style="left:260px;top:46px"><a class="hv" href="#">Close tab</a><a href="#">Close other tabs</a></div>'''

    left = "".join([
        ex("The tab you're on is paper, and runs into the page", band([HOME_T, DESIGN_T, JOB61_T, SCHED_T], 1)),
        ex("Pointing at one lights it; its close button is always there", band([HOME_T, DESIGN_T, JOB61_T, SCHED_T], 1, hov=2)),
        ex("Tiff working in a tab shows the mark there, so you can leave it and come back", band([HOME_T, working, JOB61_T, SCHED_T], 2)),
        ex("Lots open: tabs narrow to their icon; the one you're on keeps its name", many_strip),
        ex("Right-click a tab", f'<div style="position:relative;height:236px">{band([HOME_T, DESIGN_T, JOB61_T, SCHED_T], 1, hov=2)}{menu}</div>'),
    ])
    rules = [
        ("Opening one", 'Hold <span class="key">⌘</span> (<span class="key">Ctrl</span> on Windows) and click anything: a job, a booking, a link in Tiff\'s answer, a row in the menu. Or press New tab, which opens Search there: pick a job, a page or a person.'),
        ("The menu on the left", "Changes the tab you're on, the way a browser's address bar does. It never opens a second one by itself."),
        ("Already open", "Open something that's already in a tab and you go to that tab. Two tabs never show the same page."),
        ("Each tab keeps its place", "Where you'd scrolled to, a note half written, an open dialog. Switching back finds it as you left it."),
        ("Closing", "The cross. Close down to one page and the tabs go away until you open another."),
        ("Tomorrow", "Your tabs are kept on this computer, so they're there when you come back."),
        ("Tiff", "\"This job\" means the tab in front. Ask from the Home tab and Tiff can open what it finds in a new one."),
        ("Keys", 'None of their own: the browser keeps ⌘T, ⌘W, ⌃Tab and ⌘1 to ⌘8 for its tabs. <span class="key">⌘K</span> still opens Search.'),
        ("Where", "Desktop only. A phone keeps one page at a time."),
    ]
    rl = "".join(f'<div class="rl"><b>{a}</b><p>{b}</p></div>' for a, b in rules)
    return f'''<div class="spec">{MARK_DEFS}
  <div style="width:820px;flex:none;display:flex;flex-direction:column;gap:28px">{left}</div>
  <div style="flex:1;min-width:0">
    <h2 style="font-size:24px;line-height:32px;font-weight:700;margin-bottom:16px">How tabs behave</h2>
    <div class="rules">{rl}</div>
  </div>
</div>'''


def build(out):
    out["T-design.dc.html"] = page("Tabs: designing, with the job in the next tab", 1440, 900, CSS,
                                   frame("design", [HOME_T, DESIGN_T, JOB61_T, SCHED_T], 1, design_body()))
    out["T-job.dc.html"] = page("Tabs: the job, one click over", 1440, 900, CSS,
                                frame("jobs", [HOME_T, DESIGN_T, JOB61_T, SCHED_T], 2, job61_body()))
    out["T-schedule.dc.html"] = page("Tabs: the day's schedule", 1440, 900, CSS,
                                     frame("cal", [HOME_T, SCHED_T, MAINT_T, JOB42_T], 1, schedule_body()))
    out["T-maint.dc.html"] = page("Tabs: maintenance for the month", 1440, 900, CSS,
                                  frame("cal", [HOME_T, SCHED_T, MAINT_T, JOB42_T], 2, maint_body()))
    out["T-spec.dc.html"] = page("How tabs behave", 1440, 900, CSS, spec())
