"""Shared pieces for the v2 (framework) boards: page wrapper, CSS, icons, sidebar.

Follows docs/design.md: Plus Jakarta Sans only, ink for actions, no accent,
the type scale 12/13/14/16/20/24/32, radii 6/10/16/999, the one hairline,
the one overlay shadow, state as a coloured word, selection as a fill,
buttons carry words (icon-only only for close, clear and dictation).
"""

FONT = ("<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n"
        "<link href=\"https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&amp;display=swap\" rel=\"stylesheet\">")

LINE = "rgba(5,5,5,.08)"
CTRL = "rgba(5,5,5,.14)"

CSS = """
body{margin:0;background:#F0F2F5}
.app,.app *{box-sizing:border-box}
.app{display:flex;width:1440px;height:900px;overflow:hidden;position:relative;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#050505;font-size:14px;line-height:20px;background:#fff;-webkit-font-smoothing:antialiased}
.app a{color:inherit;text-decoration:none}
.app p{margin:0}
.ico{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.i16{width:16px;height:16px}
.q{color:#5f6a79}
.cap{font-size:12px;line-height:16px;font-weight:500;color:#5f6a79}
.lab{font-size:13px;line-height:18px;font-weight:500}
.read{font-size:16px;line-height:24px}
.h16{font-size:16px;line-height:24px;font-weight:600;margin:0}
.h20{font-size:20px;line-height:28px;font-weight:600;margin:0}
.h24{font-size:24px;line-height:32px;font-weight:600;margin:0;letter-spacing:-.2px}
.d32{font-size:32px;line-height:40px;font-weight:600;margin:0;letter-spacing:-.4px}
.app .link{text-decoration:underline;text-underline-offset:3px;font-weight:500}
.side{width:264px;flex:none;background:#F0F2F5;border-right:1px solid rgba(5,5,5,.08);display:flex;flex-direction:column;padding:12px 8px 8px}
.brand{display:flex;align-items:center;gap:8px;height:40px;padding:0 8px;margin-bottom:8px}
.brand b{font-size:16px;font-weight:700;letter-spacing:-.2px}
.xb{width:32px;height:32px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;color:#5f6a79;flex:none}
.srow{display:flex;align-items:center;gap:12px;height:36px;padding:0 8px;border-radius:10px;font-weight:500;white-space:nowrap}
.srow:hover{background:rgba(5,5,5,.04)}
.srow.on{background:rgba(5,5,5,.07)}
.newbtn .pl{width:24px;height:24px;border-radius:50%;background:#050505;color:#fff;display:inline-flex;align-items:center;justify-content:center;margin:0 -3px}
.newbtn.on{background:#fff;box-shadow:0 0 0 1px rgba(5,5,5,.08)}
.srow .r{margin-left:auto;font-size:13px;font-weight:500;color:#5f6a79}
.srow .r.n{color:#050505;font-weight:600}
.slabel{font-size:12px;line-height:16px;font-weight:500;color:#5f6a79;padding:16px 8px 4px}
.rec{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px;border-radius:10px;white-space:nowrap;overflow:hidden}
.rec:hover{background:rgba(5,5,5,.04)}
.rec .tx{overflow:hidden;text-overflow:ellipsis}
.rec .sq{width:8px;height:8px;flex:none}
.rec .ico{width:16px;height:16px;color:#5f6a79}
.me{margin-top:auto;display:flex;align-items:center;gap:12px;padding:8px;border-radius:10px}
.av{width:32px;height:32px;border-radius:50%;background:#050505;color:#fff;font-size:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex:none}
.av.s{width:24px;height:24px;font-size:12px}
.main{flex:1;min-width:0;display:flex;flex-direction:column;background:#fff;position:relative}
.bar{height:56px;flex:none;display:flex;align-items:center;gap:12px;padding:0 24px;border-bottom:1px solid rgba(5,5,5,.08)}
.btn{height:36px;padding:0 16px;border-radius:10px;font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(5,5,5,.14);background:#fff;white-space:nowrap;flex:none}
.btn.ink{background:#050505;color:#fff;border-color:#050505}
.btn.sm{height:32px;padding:0 12px;font-size:13px}
.btn.ghost{border-color:transparent}
.mic{width:32px;height:32px;border-radius:50%;border:1px solid rgba(5,5,5,.14);display:inline-flex;align-items:center;justify-content:center;flex:none}
.seg{display:inline-flex;gap:2px;padding:2px;border-radius:10px;background:#F0F2F5}
.seg span{height:28px;padding:0 12px;border-radius:calc(10px - 2px);display:inline-flex;align-items:center;font-size:13px;font-weight:500;color:#5f6a79}
.seg span.on{background:#fff;color:#050505;font-weight:600;box-shadow:0 0 0 1px rgba(5,5,5,.08)}
.tabs{display:flex;gap:24px;border-bottom:1px solid rgba(5,5,5,.08)}
.tabs a{height:40px;display:inline-flex;align-items:center;font-weight:500;color:#5f6a79;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs a.on{color:#050505;border-color:#050505;font-weight:600}
.filt{height:32px;padding:0 12px;border-radius:10px;border:1px solid rgba(5,5,5,.14);font-size:13px;font-weight:500;display:inline-flex;align-items:center;gap:6px;background:#fff;white-space:nowrap}
.filt.on{background:#050505;color:#fff;border-color:#050505}
.filt .c{color:#5f6a79}.filt.on .c{color:rgba(255,255,255,.7)}
.card{background:#fff;border:1px solid rgba(5,5,5,.08);border-radius:16px}
.grp{border-top:1px solid rgba(5,5,5,.08)}
.dot{width:8px;height:8px;border-radius:50%;flex:none}
.ok{color:#196B2D}.warn{color:#a44b08}.bad{color:#c81a41}.info{color:#2554d8}
.overlay{background:#fff;border-radius:16px;box-shadow:0 12px 32px rgba(10,12,20,.16)}
.scrim{position:absolute;inset:0;background:rgba(10,11,16,.45)}
.field{height:36px;border:1px solid rgba(5,5,5,.14);border-radius:6px;padding:0 12px;display:flex;align-items:center;background:#fff;gap:8px}
.field.tall{height:auto;min-height:88px;align-items:flex-start;padding:8px 12px}
.flabel{font-size:13px;line-height:18px;font-weight:500;margin-bottom:4px;display:block}
.tick{width:18px;height:18px;border:1.5px solid rgba(5,5,5,.3);border-radius:6px;flex:none;background:#fff}
.tick.on{background:#050505;border-color:#050505}
.num{font-variant-numeric:tabular-nums}
.tbl{width:100%;border-collapse:collapse}
.tbl th{text-align:left;font-size:12px;line-height:16px;font-weight:500;color:#5f6a79;padding:8px 12px;border-bottom:1px solid rgba(5,5,5,.08)}
.tbl td{padding:12px;border-bottom:1px solid rgba(5,5,5,.08);vertical-align:middle}
.tbl tr.sel td{background:rgba(5,5,5,.04)}
.crumb{display:flex;align-items:center;gap:8px;color:#5f6a79;font-weight:500}
.crumb b{color:#050505;font-weight:600}
"""

ICONS = {
    "info": '<circle cx="12" cy="12" r="9"></circle><path d="M12 16v-5M12 8h.01"></path>',
    "plus": '<path d="M12 5v14M5 12h14"></path>',
    "search": '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
    "home": '<path d="M4 11 12 4l8 7"></path><path d="M6 10v10h12V10"></path>',
    "chat": '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"></path>',
    "jobs": '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
    "cal": '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
    "doc": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5M9 13h6M9 17h4"></path>',
    "lib": '<path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"></path>',
    "design": '<path d="M3 21 21 3"></path><path d="M3 15v6h6"></path><path d="M14 4h6v6"></path><path d="M7 11 4 8l4-4 3 3"></path><path d="m13 17 3 3 4-4-3-3"></path>',
    "team": '<circle cx="9" cy="8" r="4"></circle><path d="M2 21a7 7 0 0 1 14 0"></path><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"></path>',
    "panel": '<rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M9 4v16"></path>',
    "mic": '<rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path>',
    "camera": '<path d="M4 8h3l2-3h6l2 3h3v11H4z"></path><circle cx="12" cy="13" r="3.5"></circle>',
    "x": '<path d="M6 6l12 12M18 6 6 18"></path>',
    "check": '<path d="m5 12 5 5 9-10"></path>',
    "updown": '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"></path>',
    "down": '<path d="m6 9 6 6 6-6"></path>',
    "right": '<path d="m9 6 6 6-6 6"></path>',
    "left": '<path d="m15 6-6 6 6 6"></path>',
    "person": '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
    "task": '<rect x="4" y="4" width="16" height="16" rx="4"></rect><path d="m8 12 3 3 5-6"></path>',
    "shield": '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"></path><path d="m9 12 2 2 4-4"></path>',
    "cert": '<rect x="4" y="3" width="16" height="13" rx="2"></rect><circle cx="12" cy="17" r="3"></circle><path d="M10.5 19.5 9 22M13.5 19.5 15 22M8 7h8M8 10h5"></path>',
    "letter": '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path>',
    "repeat": '<path d="M17 2l3 3-3 3"></path><path d="M4 11V9a4 4 0 0 1 4-4h12"></path><path d="M7 22l-3-3 3-3"></path><path d="M20 13v2a4 4 0 0 1-4 4H4"></path>',
    "stack": '<path d="m12 3 9 5-9 5-9-5z"></path><path d="m3 13 9 5 9-5"></path>',
    "receipt": '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"></path><path d="M9 8h6M9 12h6"></path>',
    "sun": '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"></path>',
    "truck": '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"></path><circle cx="7" cy="17" r="2"></circle><circle cx="17" cy="17" r="2"></circle>',
    "megaphone": '<path d="M3 10v4h4l7 4V6L7 10z"></path><path d="M18 9a4 4 0 0 1 0 6"></path>',
    "upload": '<path d="M12 16V4M7 9l5-5 5 5"></path><path d="M4 20h16"></path>',
    "pin": '<path d="M9 4h6l-1 6 3 3H7l3-3z"></path><path d="M12 13v7"></path>',
    "gear": '<circle cx="12" cy="12" r="3"></circle><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"></path>',
    "clock": '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    "flag": '<path d="M5 21V4h11l-2 4 2 4H5"></path>',
    "photo": '<rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="10" r="2"></circle><path d="m21 16-5-5-8 8"></path>',
    "box": '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"></path><path d="M3 7l9 4 9-4M12 11v10"></path>',
    "dollar": '<path d="M12 3v18M16 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8"></path>',
    "phone": '<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2"></path>',
    "dots": '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
    "menu": '<path d="M4 7h16M4 12h16M4 17h10"></path>',
}


def ico(name, cls="ico", style=""):
    st = f' style="{style}"' if style else ""
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true"{st}>{ICONS[name]}</svg>'


MARK = ('<svg width="22" height="22" viewBox="0 0 100 100" aria-hidden="true">'
        '<path d="M22 24 L40 24 L62 50 L40 76 L22 76 L44 50 Z" fill="none" stroke="#050505" stroke-width="10" stroke-linejoin="round"></path>'
        '<path d="M54 24 L72 24 L90 46" fill="none" stroke="#050505" stroke-width="10" stroke-linecap="round" opacity="0.4"></path></svg>')

NAV = [
    ("home", "Home", "home", "3"),
    ("conversations", "Conversations", "chat", ""),
    ("jobs", "Jobs", "jobs", ""),
    ("schedule", "Schedule", "cal", ""),
    ("documents", "Documents", "doc", ""),
    ("library", "Library", "lib", ""),
    ("design", "Design", "design", ""),
    ("team", "Team", "team", ""),
]

HREF = {
    "home": "N-Home.dc.html", "conversations": "N-Convos.dc.html", "jobs": "N-Jobs.dc.html",
    "schedule": "N-Schedule.dc.html", "documents": "N-Documents.dc.html", "library": "N-Library.dc.html",
    "design": "N-Design.dc.html", "team": "N-Team.dc.html",
}

PINNED = [("#6D4FD8", "3342 Rifkin, Bellevue Hill", "N-Job.dc.html"), ("#4B5565", "3302 Heuvel, Chatswood", "N-Project.dc.html")]
RECENTS = [
    ("chat", "Bellevue Hill wrap-up and isolator", "N-Convos.dc.html"),
    ("doc", "SWMS, Heuvel roof work", "N-Documents.dc.html"),
    ("person", "Lyle Irving", "N-Team.dc.html"),
    ("jobs", "Northgate Realty, 3323", "N-Jobs.dc.html"),
    ("chat", "Clearing an E6 on a Daikin split", "N-Convos.dc.html"),
    ("doc", "Certificate, Kingsford Bakery", "N-Documents.dc.html"),
]


def sidebar(active, new_on=False):
    rows = []
    rows.append(f'<a class="srow newbtn{" on" if new_on else ""}" href="N-New.dc.html"><span class="pl">{ico("plus", "ico", "width:14px;height:14px;stroke-width:2.4")}</span>New</a>')
    rows.append(f'<a class="srow" href="#">{ico("search")}Search<span class="r">⌘K</span></a>')
    nav = []
    for key, label, icon, count in NAV:
        cls = " on" if key == active else ""
        r = f'<span class="r n">{count}</span>' if count else ""
        nav.append(f'<a class="srow{cls}" href="{HREF[key]}">{ico(icon)}{label}{r}</a>')
    pinned = "".join(f'<a class="rec" href="{h}"><span class="sq" style="background:{c}"></span><span class="tx">{t}</span></a>' for c, t, h in PINNED)
    recents = "".join(f'<a class="rec" href="{h}">{ico(i)}<span class="tx">{t}</span></a>' for i, t, h in RECENTS)
    return f'''<aside class="side" aria-label="Menu">
  <div class="brand">{MARK}<b>HeyTiff</b><span style="flex:1"></span><span class="xb" aria-label="Close the menu">{ico("panel")}</span></div>
  {"".join(rows)}
  <div style="height:12px"></div>
  {"".join(nav)}
  <div class="slabel">Pinned</div>
  {pinned}
  <div class="slabel">Recents</div>
  {recents}
  <a class="me" href="N-You.dc.html"><span class="av">IS</span><span style="display:flex;flex-direction:column;min-width:0;flex:1"><span style="font-weight:600">Isaac Smith</span><span class="cap">Owner</span></span>{ico("updown", "ico q")}</a>
</aside>'''


def page(title, w, h, css, body):
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
{FONT}
<style>
{CSS}
{css}
</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
  renderVals() {{
    return {{}};
  }}
}}
</script>
</body>
</html>
'''
