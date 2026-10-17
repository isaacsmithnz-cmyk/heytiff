"""The parts list: every button, the type sizes, and the colours, with where
each is used. Built from docs/design.md and src/app/tokens.css."""
from base import ico, page
from boards_home2 import tiff, MARK_DEFS, MARK_CSS

CSS = MARK_CSS + """
body{margin:0}
.sy,.sy *{box-sizing:border-box}
.sy{width:1440px;background:#fff;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#050505;font-size:14px;line-height:20px;padding:56px 64px 64px;-webkit-font-smoothing:antialiased}
.sy p,.sy h1,.sy h2,.sy h3{margin:0}
.sy a{color:inherit;text-decoration:none}
.sy .ico{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.sy .q{color:#5f6a79}
.t1{font-size:32px;line-height:40px;font-weight:700;letter-spacing:-.4px}
.lede{font-size:16px;line-height:24px;color:#5f6a79;margin-top:8px;max-width:880px}
.sec{margin-top:48px}
.sec>h2{font-size:20px;line-height:28px;font-weight:600}
.sec>.sub{color:#5f6a79;margin-top:4px;max-width:880px}
.rowh{display:grid;grid-template-columns:200px 360px minmax(0,1fr);gap:24px;padding:8px 0;font-size:12px;line-height:16px;font-weight:500;color:#5f6a79;border-bottom:1px solid rgba(5,5,5,.08);margin-top:16px}
.row{display:grid;grid-template-columns:200px 360px minmax(0,1fr);gap:24px;padding:16px 0;border-bottom:1px solid rgba(5,5,5,.08);align-items:center}
.row .nm{font-weight:600}
.row .nm span{display:block;font-size:13px;line-height:18px;font-weight:500;color:#5f6a79;margin-top:2px}
.ex{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.use{color:#050505}
.use .q{display:block;margin-top:2px;font-size:13px;line-height:18px}
/* the buttons themselves */
.b{height:36px;padding:0 16px;border-radius:10px;font-size:14px;line-height:20px;font-weight:600;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;border:1px solid transparent;flex:none}
.b.sm{height:32px;padding:0 12px;font-size:13px;line-height:18px}
.b.lg{height:44px;padding:0 20px;font-size:16px;line-height:24px}
.b.ink{background:#050505;color:#fff}
.b.ink.hov{background:#2a2a2c}
.b.out{background:#fff;border-color:rgba(5,5,5,.14);color:#050505}
.b.out.hov{background:rgba(5,5,5,.04)}
.b.quiet{background:transparent;color:#050505}
.b.quiet.hov{background:rgba(5,5,5,.07)}
.b.del{background:#fff;border-color:rgba(5,5,5,.14);color:#c81a41}
.b.delf{background:#c81a41;color:#fff}
.b.focus{box-shadow:0 0 0 2px #fff,0 0 0 4px #050505}
.b.press{transform:translateY(1px)}
.b.off{background:#fff;border-color:rgba(5,5,5,.08);color:#9aa2ad}
.b .ico{width:16px;height:16px}
.spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;flex:none}
.sy .lk{text-decoration:underline;text-underline-offset:3px;font-weight:500}
.ib{width:32px;height:32px;border-radius:50%;border:1px solid rgba(5,5,5,.14);display:inline-flex;align-items:center;justify-content:center;color:#050505;flex:none}
.ib.sq{border-radius:10px;border-color:transparent}
.chip{height:32px;padding:0 12px;border-radius:10px;border:1px solid rgba(5,5,5,.14);font-size:13px;font-weight:500;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.chip .c{color:#5f6a79}
.chip.on{background:#050505;border-color:#050505;color:#fff}
.chip.on .c{color:rgba(255,255,255,.7)}
.seg{display:inline-flex;gap:2px;padding:2px;border-radius:10px;border:1px solid rgba(5,5,5,.14)}
.seg span{height:26px;padding:0 12px;border-radius:8px;display:inline-flex;align-items:center;font-size:13px;font-weight:500;color:#5f6a79}
.seg span.on{background:rgba(5,5,5,.07);color:#050505;font-weight:600}
.tt{height:32px;display:inline-flex;align-items:center;gap:8px;padding:0 8px 0 10px;border:1px solid rgba(5,5,5,.14);border-radius:10px;font-size:13px;font-weight:500;color:#5f6a79;white-space:nowrap}
.tt.on{border-color:#050505;color:#050505;font-weight:600}
.tt .ico{width:16px;height:16px}
.tt .x .ico{width:14px;height:14px}
.ut{display:inline-flex;gap:20px;border-bottom:1px solid rgba(5,5,5,.08)}
.ut span{height:36px;display:inline-flex;align-items:center;font-weight:500;color:#5f6a79;border-bottom:2px solid transparent;margin-bottom:-1px}
.ut span.on{color:#050505;border-color:#050505;font-weight:600}
.inkbox{background:#050505;border-radius:16px;padding:12px;display:inline-flex;gap:8px;align-items:center}
.newb{display:inline-flex;align-items:center;gap:12px;height:36px;padding:0 10px 0 8px;border-radius:10px;color:#fff;font-weight:500}
.newb .pl{width:24px;height:24px;border-radius:50%;background:#fff;color:#050505;display:inline-flex;align-items:center;justify-content:center}
.field{height:36px;width:200px;border:1px solid rgba(5,5,5,.14);border-radius:6px;padding:0 12px;display:inline-flex;align-items:center;color:#5f6a79}
.tick{width:18px;height:18px;border:1.5px solid rgba(5,5,5,.3);border-radius:6px;flex:none;display:inline-block}
.tick.on{background:#050505;border-color:#050505}
.tg{width:36px;height:20px;border-radius:999px;background:#050505;position:relative;flex:none;display:inline-block}
.tg::after{content:"";position:absolute;right:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff}
.note{margin-top:16px;padding:16px 20px;border:1px solid rgba(5,5,5,.08);border-radius:16px;max-width:960px}
.note b{font-weight:600}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin-top:16px}
/* type */
.trow{display:grid;grid-template-columns:120px 120px minmax(0,1fr) 300px;gap:24px;padding:14px 0;border-bottom:1px solid rgba(5,5,5,.08);align-items:baseline}
.trow .sz{font-weight:600;font-variant-numeric:tabular-nums}
.trow .wt{color:#5f6a79;font-variant-numeric:tabular-nums}
.trow .rl{color:#5f6a79;font-size:13px;line-height:18px}
.chg{font-size:12px;line-height:16px;font-weight:600;color:#2554d8;margin-left:8px}
/* colour */
.sw{display:flex;flex-direction:column;gap:8px;min-width:0}
.sw .chipc{height:64px;border-radius:10px;border:1px solid rgba(5,5,5,.08);display:flex;align-items:flex-end;padding:8px 10px;font-size:13px;line-height:18px;font-weight:600}
.sw .nm{font-weight:600;font-size:13px;line-height:18px}
.sw .vl{font-size:12px;line-height:16px;color:#5f6a79;font-variant-numeric:tabular-nums}
.sws{display:grid;gap:16px;margin-top:16px}
.k4{grid-template-columns:repeat(4,minmax(0,1fr))}
.k6{grid-template-columns:repeat(6,minmax(0,1fr))}
.k7{grid-template-columns:repeat(7,minmax(0,1fr))}
.k8{grid-template-columns:repeat(8,minmax(0,1fr))}
.k9{grid-template-columns:repeat(9,minmax(0,1fr))}
.word{font-weight:500}
"""


def wrap(inner, h):
    return f'<div class="sy" style="min-height:{h}px">{MARK_DEFS}{inner}</div>'


# ------------------------------------------------------------------ buttons
def buttons():
    x = ico("x")
    rows = [
        ("Main", "Ink, one per area", f'<span class="b ink">Send</span><span class="b ink sm">Approve</span>',
         "The one thing you most likely press next.", "Send, Save note, Approve, Write the quote, Create. Never two side by side."),
        ("Second", "A hairline round white", f'<span class="b out">{ico("camera")}Add photo</span><span class="b out sm">Decline</span>',
         "Every other action that has a box.", "Decline beside Approve, Edit details, Add a licence, Renew, Cancel in a dialog."),
        ("Quiet", "No edge until you point at it", f'<span class="b quiet">Previous week</span><span class="b quiet sm">Open</span>',
         "Actions inside a list or a toolbar, where boxes would pile up.", "A row's Open, the Studio's tools, Fit and 100%."),
        ("Delete", "Red word, hairline", f'<span class="b del">Delete job</span><span class="b delf">Delete job</span>',
         "Something that can't be undone. The red fill only appears in the dialog that asks you to be sure.", "Delete, Remove from team, Cancel the booking. Never the main button on a page."),
        ("Link", "Ink, underlined", '<a class="lk" href="#">Show all</a><a class="lk" href="#">Schedule</a><a class="lk" href="#">Open the quote</a>',
         "Going somewhere, not doing something.", "Show all, a section's way to its full page, links in Tiff's answers."),
        ("Icon only", "Three, and no more", f'<span class="ib">{x}</span><span class="ib">{ico("mic")}</span><span class="ib sq">{x}</span>',
         "Close, clear, and talking to Tiff. Everything else carries its word.", "A dialog's cross, a search field's clear, a tab's cross, the box's microphone."),
        ("New", "Paper disc on the ink", f'<span class="inkbox"><span class="newb"><span class="pl">{ico("plus")}</span>New</span></span>',
         "The one place things are made.", "Top of the menu. Opens the short New menu."),
        ("Tiff's offers", "Main and second, in the answer", '<span class="b ink sm">Yes, 3361 Okafor</span><span class="b out sm">A new job</span>',
         "When Tiff asks you to pick, the likely answer is the main button.", "Which job, which person, keep or undo."),
    ]
    rh = "".join(f'<div class="row"><div class="nm">{n}<span>{d}</span></div><div class="ex">{ex}</div><div class="use">{w}<span class="q">{u}</span></div></div>' for n, d, ex, w, u in rows)

    choices = [
        ("Filter", "Taps on and off", '<span class="chip on">All <span class="c">142</span></span><span class="chip">To book <span class="c">19</span></span><span class="chip">Quotes <span class="c">23</span></span>',
         "Narrowing a list.", "Jobs' views, Documents' kinds."),
        ("Choice", "One of a few", '<span class="seg"><span class="on">Day</span><span>Week</span><span>Month</span></span>',
         "Changing how the same thing is shown.", "Day, week, month. Design, Schematic, Summary."),
        ("App tabs", "Hairline, ink round the one you're on", f'<span class="tt">{ico("home")}Home<span class="x">{x}</span></span><span class="tt on">{ico("jobs")}3361 Okafor<span class="x">{x}</span></span>',
         "Pages you have open.", "Top right of the header, desktop only."),
        ("Section tabs", "Underlined", '<span class="ut"><span class="on">Overview</span><span>Quote</span><span>Visits</span><span>Photos</span></span>',
         "Parts of one record.", "A job's sections, Team's tabs."),
        ("Tick, switch, field", "Things you set", '<span class="tick on"></span><span class="tick"></span><span class="tg"></span><span class="field">Start 7:00 am</span>',
         "A tick is a checkbox with its word beside it. A switch saves itself.", "Settings rows, a task's tick, the timesheet's fields."),
    ]
    ch = "".join(f'<div class="row"><div class="nm">{n}<span>{d}</span></div><div class="ex">{ex}</div><div class="use">{w}<span class="q">{u}</span></div></div>' for n, d, ex, w, u in choices)

    states = [
        ("Rest", '<span class="b ink">Save note</span>', '<span class="b out">Decline</span>'),
        ("Pointed at", '<span class="b ink hov">Save note</span>', '<span class="b out hov">Decline</span>'),
        ("Keyboard focus", '<span class="b ink focus">Save note</span>', '<span class="b out focus">Decline</span>'),
        ("Pressed", '<span class="b ink press">Save note</span>', '<span class="b out press">Decline</span>'),
        ("Working", '<span class="b ink"><span class="spin"></span>Saving</span>', '<span class="b out" style="color:#5f6a79">Declining</span>'),
        ("Not yet", '<span class="b off">Save note</span>', '<span class="b off">Decline</span>'),
    ]
    st = "".join(f'<div class="sw" style="gap:10px"><div class="nm" style="font-weight:600">{n}</div>{a}{b}</div>' for n, a, b in states)

    sizes = ('<div class="grid3">'
             '<div><div class="ex"><span class="b ink sm">Approve</span><span class="b out sm">Decline</span></div><p style="margin-top:10px"><b style="font-weight:600">Small, 32</b><span class="q">, 13 semibold. In rows, headers and lists, beside a 32 field.</span></p></div>'
             '<div><div class="ex"><span class="b ink">Save note</span><span class="b out">Cancel</span></div><p style="margin-top:10px"><b style="font-weight:600">Regular, 36</b><span class="q">, 14 semibold. Forms and dialogs, beside a 36 field.</span></p></div>'
             '<div><div class="ex"><span class="b ink lg">Send</span><span class="b out lg">Photo</span></div><p style="margin-top:10px"><b style="font-weight:600">Phone, 44</b><span class="q">, 16 semibold. Anything a thumb presses on site.</span></p></div>'
             '</div>')

    inner = f'''<h1 class="t1">Buttons</h1>
<p class="lede">Eight kinds of button and five kinds of choice. Each has one job. A button is a verb and a noun, has no arrow, and has its word unless it's a close, a clear or the microphone.</p>
<div class="sec"><h2>The buttons</h2>
<div class="rowh"><span>Kind</span><span>Looks like</span><span>When</span></div>{rh}</div>
<div class="sec"><h2>Choices</h2><p class="sub">Things you tap to narrow, switch or set, rather than to do.</p>
<div class="rowh"><span>Kind</span><span>Looks like</span><span>When</span></div>{ch}</div>
<div class="sec"><h2>Three sizes</h2><p class="sub">A button and the field beside it are always the same height. All have the 10 corner; a field has the 6.</p>{sizes}</div>
<div class="sec"><h2>How a button behaves</h2><p class="sub">One change when you point at it, a 2px ink ring for the keyboard, and the word says what it's doing while it works. "Not yet" is used rarely: better to let the press happen and say what's missing.</p>
<div class="sws k6" style="margin-top:20px">{st}</div></div>'''
    return wrap(inner, 1940)


# ------------------------------------------------------------------ type
def type_board():
    rows = [
        ("40", "700", '<span style="font-size:40px;line-height:48px;font-weight:700;letter-spacing:-.4px">Nothing on today</span>', "Display on a sheet or the sign-in door only", ""),
        ("32", "700", '<span style="font-size:32px;line-height:40px;font-weight:700;letter-spacing:-.4px">$9,840</span>', "A screen's one big figure, at most once", ""),
        ("24", "600", '<span style="font-size:24px;line-height:32px;font-weight:600;letter-spacing:-.2px">Okafor, Ada</span>', "Screen title", "was 700"),
        ("24", "400", '<span style="font-size:24px;line-height:32px;font-weight:400">A split in the main bedroom, back to back with the study.</span>', "The one thing being read: a brief, a task, a notice", ""),
        ("20", "600", '<span style="font-size:20px;line-height:28px;font-weight:600">Pay and holidays</span>', "A section's title", ""),
        ("16", "600", '<span style="font-size:16px;line-height:24px;font-weight:600">Where it\'s up to</span>', "A heading in a card or a list", ""),
        ("16", "400", '<span style="font-size:16px;line-height:24px">Just been to Riverview. They want a split in the main bedroom.</span>', "Anything you read or write: notes, the box, Tiff's answers", "was 14"),
        ("14", "400", '<span style="font-size:14px;line-height:20px">Two Daikin splits, Lyle and Callum. Day 1 of 1.</span>', "Body: lists, details, descriptions", ""),
        ("14", "600", '<span style="font-size:14px;line-height:20px;font-weight:600">Bellevue Hill, Job 3342</span>', "A row's name, a regular button", ""),
        ("14", "500", '<span style="font-size:14px;line-height:20px;font-weight:500;color:#196B2D">On now</span>', "A state word, in its colour", ""),
        ("13", "500", '<span style="font-size:13px;line-height:18px;font-weight:500">Overview&nbsp;&nbsp;&nbsp;Quote&nbsp;&nbsp;&nbsp;Visits&nbsp;&nbsp;&nbsp;7:30 to 8:30</span>', "Labels, tabs, table cells, a small button", ""),
        ("12", "500", '<span style="font-size:12px;line-height:16px;font-weight:500;color:#5f6a79">Spoken, 8:40 am</span>', "Captions; nothing is smaller", ""),
    ]
    tr = "".join(f'<div class="trow"><span class="sz">{s}<span class="q" style="font-weight:500"> px</span></span><span class="wt">{w}</span><span>{x}</span><span class="rl">{r}{f"<span class=chg>{c}</span>" if c else ""}</span></div>' for s, w, x, r, c in rows)
    inner = f'''<h1 class="t1">Type</h1>
<p class="lede">One face, Plus Jakarta Sans, in four weights: 400, 500, 600 and 700. Eight sizes, each with one line height. Two change from today, marked in blue: titles drop to 600, and what you read or write grows to 16, the way Claude sets it.</p>
<div class="sec">
<div class="trow" style="font-size:12px;line-height:16px;font-weight:500;color:#5f6a79;padding:8px 0"><span>Size</span><span>Weight</span><span>Looks like</span><span>Used for</span></div>
{tr}</div>
<div class="sec"><h2>The rules that come with it</h2>
<div class="grid3">
<div class="note" style="margin:0"><b>Sentence case everywhere.</b> <span class="q">No capitals for emphasis, no tracked-out labels. The one thing in capitals is a number plate.</span></div>
<div class="note" style="margin:0"><b>Figures line up.</b> <span class="q">Money, hours and times in columns use tabular figures and carry their unit: 8.5 h, $1,120.</span></div>
<div class="note" style="margin:0"><b>Hierarchy by size and weight.</b> <span class="q">Never by a lighter grey: the one quiet grey is the lightest that reads everywhere.</span></div>
</div></div>'''
    return wrap(inner, 1180)



# ------------------------------------------------------------------ colour
def _lum(rgb):
    def ch(c):
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def _cr(a, b):
    x, y = sorted([_lum(a), _lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)


def _hsl(hexs):
    import colorsys
    r, g, b = (int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h, s, l


def _rgb(h, s, l):
    import colorsys
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return (round(r * 255), round(g * 255), round(b * 255))


def paint(hexs):
    """The Schedule's paint for a ServiceM8 category colour, as
    src/lib/workboard/schedule-colour.ts makes it: a wash, a chip, and a cap
    walked down until it holds 3:1 on the wash."""
    h, s, l = _hsl(hexs)
    fill = _rgb(h, .55, .94)
    chip = _rgb(h, .5, .86)
    L = .46
    bar = _rgb(h, .62, L)
    while _cr(bar, fill) < 3 and L > .05:
        L -= .01
        bar = _rgb(h, .62, L)
    return fill, chip, bar


def rgbs(t):
    return f"rgb({t[0]},{t[1]},{t[2]})"


def colour():
    def sw(bg, name, val, use, ink="#050505", border=True):
        return (f'<div class="sw"><div class="chipc" style="background:{bg};color:{ink};{"" if border else "border-color:transparent"}"></div>'
                f'<div><div class="nm">{name}</div><div class="vl">{val}</div><div class="vl" style="color:#050505;margin-top:2px">{use}</div></div></div>')

    ui = "".join([
        sw("#050505", "Ink", "#050505, 20:1", "Text, the main button, the focus ring, links"),
        sw("#5f6a79", "Quiet", "#5f6a79, 5.5:1", "Second line, labels, times"),
        sw("#ffffff", "Paper", "#ffffff", "The page and everything on it"),
        sw("#F0F2F5", "Ground", "#F0F2F5", "Your own bubble in a conversation, a track"),
        sw("rgba(5,5,5,.08)", "Line", "ink at 8%", "The one hairline: rows, cards"),
        sw("rgba(5,5,5,.14)", "Edge", "ink at 14%", "Buttons, fields, tabs"),
        sw("rgba(5,5,5,.07)", "Selected", "ink at 7%", "The row or choice you're on"),
        sw("rgba(5,5,5,.04)", "Pointed at", "ink at 4%", "Hover, one change only"),
    ])
    dark = "".join([
        sw("#050505", "Ink frame", "#050505", "The sidebar", border=False),
        sw("#ffffff", "White on ink", "#ffffff", "Menu labels, the New disc"),
        sw("rgba(255,255,255,.5)", "Quiet on ink", "white at 50%, 5.3:1", "Section labels, ⌘K", ink="#fff"),
        sw("rgba(255,255,255,.12)", "Selected on ink", "white at 12%", "The menu row you're on"),
        sw("rgba(255,255,255,.06)", "Pointed at on ink", "white at 6%", "Hover in the menu"),
    ])
    dark = dark.replace('class="chipc" style="background:rgba(255,255,255', 'class="chipc" style="box-shadow:inset 0 0 0 999px #050505;background:rgba(255,255,255')
    # composite white-alpha swatches over ink so they show as they would on the frame
    for a in (".5", ".12", ".06"):
        v = round(5 + (255 - 5) * float(a))
        dark = dark.replace(f'box-shadow:inset 0 0 0 999px #050505;background:rgba(255,255,255,{a})', f'background:rgb({v},{v},{v})')

    def state(word, text, fill, tint, ratio, eg):
        return (f'<div class="sw"><div class="chipc" style="background:{tint};align-items:center;gap:8px;padding:0 14px">'
                f'<span style="width:8px;height:8px;border-radius:50%;background:{fill}"></span><span style="color:{text};font-weight:500;font-size:14px">{eg}</span></div>'
                f'<div><div class="nm">{word}</div><div class="vl">Word {text}, {ratio}; dot {fill}</div></div></div>')
    states = "".join([
        state("Good", "#196B2D", "#196B2D", "rgba(25,107,45,.08)", "6.6:1", "Done"),
        state("Needs a look", "#a44b08", "#F0A431", "rgba(240,164,49,.13)", "5.9:1", "Due today"),
        state("Wrong or late", "#c81a41", "#e0264f", "rgba(224,38,79,.08)", "5.7:1", "Overdue"),
        state("For your information", "#2554d8", "#2554d8", "rgba(37,84,216,.08)", "6.3:1", "Quote to write"),
    ])

    cats = [("Installation", "#2F80ED"), ("Service", "#27AE60"), ("Quote", "#F2994A"), ("Warranty", "#9B51E0"), ("Breakdown", "#EB5757")]
    blocks = ""
    for name, hx in cats:
        fill, chip, bar = paint(hx)
        blocks += (f'<div class="sw"><div style="height:64px;border-radius:10px;background:{rgbs(fill)};display:flex;overflow:hidden">'
                   f'<span style="width:4px;background:{rgbs(bar)}"></span><span style="padding:8px 10px;display:flex;flex-direction:column;gap:4px;min-width:0">'
                   f'<b style="font-size:13px;line-height:18px">Randwick Dental</b><span style="align-self:flex-start;font-size:12px;line-height:16px;font-weight:600;padding:0 6px;border-radius:6px;background:{rgbs(chip)}">3271</span></span></div>'
                   f'<div><div class="nm">{name}</div><div class="vl">ServiceM8 {hx.lower()}</div><div class="vl">cap {rgbs(bar)}</div></div></div>')
    fixed = [("No category", (244, 245, 247), (226, 228, 233), (122, 129, 140)), ("Project or maintenance", (231, 244, 248), (201, 228, 237), (0, 106, 140))]
    for name, fill, chip, bar in fixed:
        blocks += (f'<div class="sw"><div style="height:64px;border-radius:10px;background:{rgbs(fill)};display:flex;overflow:hidden">'
                   f'<span style="width:4px;background:{rgbs(bar)}"></span><span style="padding:8px 10px;display:flex;flex-direction:column;gap:4px;min-width:0">'
                   f'<b style="font-size:13px;line-height:18px">Heuvel, Chatswood</b><span style="align-self:flex-start;font-size:12px;line-height:16px;font-weight:600;padding:0 6px;border-radius:6px;background:{rgbs(chip)}">3302</span></span></div>'
                   f'<div><div class="nm">{name}</div><div class="vl">Fixed in HeyTiff</div><div class="vl">cap {rgbs(bar)}</div></div></div>')

    kinds = [("Split", "#2a78d6", "4.4"), ("Multi", "#eb6834", "3.2"), ("Ducted", "#1baf7a", "2.8"), ("VRF", "#4a3aa7", "8.6"), ("Service", "#e87ba4", "2.7"), ("Maintenance", "#eda100", "2.2"), ("Ventilation", "#008300", "5.0")]
    kh = "".join(sw(c, n, f"{c}, {r}:1", "", border=False) for n, c, r in kinds)
    seq = "".join(sw(c, n, c, "", border=False) for n, c in [("Lightest", "#86b6ef"), ("", "#5598e7"), ("", "#2a78d6"), ("Darkest", "#1c5cab")])
    days = [("Normal day", "#2EC351"), ("Over hours", "#F0A431"), ("Under hours", "#f472b6"), ("Leave", "#2E68FF"), ("Sick", "#FF3366"), ("Public holiday", "#8A2BE2"), ("Day off", "#5f6a79"), ("Nothing in", "#d8dbe1")]
    dh = "".join(sw(c, n, c, "", border=False) for n, c in days)
    pipes = ["#1f6fd1", "#7a3fd6", "#c2338a", "#b35c00", "#0b7285", "#8a5a2b", "#3b4cc0", "#4a5260"]
    ph = "".join(sw(c, f"Size {i + 1}", c, "", border=False) for i, c in enumerate(pipes))
    brand = (sw("#00E5C0", "Wordmark teal", "#00E5C0", "The “Tiff” in HeyTiff, nowhere else", border=False)
             + f'<div class="sw"><div class="chipc" style="background:#050505;align-items:center;justify-content:center;border-color:transparent">{tiff(40)}</div><div><div class="nm">Tiff’s mark</div><div class="vl">#00A389 to #2E68FF</div><div class="vl" style="color:#050505;margin-top:2px">Only on the mark itself</div></div></div>')

    inner = f'''<h1 class="t1">Colour</h1>
<p class="lede">The interface is ink and paper. Colour appears only where it means something: a state, a job's own colour from ServiceM8, or a chart or plan read against its key.</p>

<div class="sec"><h2>The interface</h2><p class="sub">Everything you press, read and type, on the white page.</p><div class="sws k8">{ui}</div></div>
<div class="sec"><h2>On the ink sidebar</h2><div class="sws k8">{dark}</div></div>

<div class="sec"><h2>State: four colours, always as a word</h2><p class="sub">A state is a word in its colour at 14 medium, with a dot where a list needs one. Never a pill, never a fill behind text.</p><div class="sws k4">{states}</div></div>

<div class="sec"><h2>A job's own colour comes from ServiceM8</h2><p class="sub">Each business sets its categories' colours in ServiceM8. HeyTiff never shows them raw: it makes a pale wash to sit behind the words, a deeper patch for the job number, and a cap strong enough to read (3:1 on the wash). So any colour a business picks stays readable. These five are examples; the last two are HeyTiff's own.</p><div class="sws k7">{blocks}</div>
<div class="note"><b>Where it shows today:</b> <span class="q">Schedule blocks, Home's Today list, and the band on a job card.</span> <b>Suggested:</b> <span class="q">also a small square beside a job's name in Jobs, Pinned, Search and its tab, so a job looks the same everywhere. The purple and grey in my mock-ups were made up; the real ones come from ServiceM8.</span></div></div>

<div class="sec"><h2>Kinds of job, in charts</h2><p class="sub">Analytics' seven series, always in this order so a kind keeps its colour from chart to chart, checked as a set for colour-blind readers. Three are under 3:1 on white, so a mark always has its figure or name beside it. A chart colour never means good or bad.</p><div class="sws k7">{kh}</div>
<p class="sub" style="margin-top:20px">One blue in four steps, for groups that have an order: price bands, days to quote.</p><div class="sws k8" style="grid-template-columns:repeat(4,minmax(0,160px))">{seq}</div></div>

<div class="sec"><h2>Keys on their own screens</h2><p class="sub">Each set lives on one screen, beside its key, and nowhere else.</p>
<p style="font-weight:600;margin-top:16px">Timesheet days, in Team</p><div class="sws k8">{dh}</div>
<p style="font-weight:600;margin-top:24px">Pipe sizes, in Design</p><div class="sws k8">{ph}</div></div>

<div class="sec"><h2>Brand</h2><div class="sws k8" style="grid-template-columns:repeat(4,minmax(0,1fr))">{brand}</div></div>

<div class="sec"><h2>Worth knowing</h2>
<div class="grid3">
<div class="note" style="margin:0"><b>Two colours for one job.</b> <span class="q">A split install is blue in Analytics (its kind) but wears its ServiceM8 category's colour on the Schedule. They never sit side by side, so I'd keep both: charts need a set checked together, and the Schedule should match ServiceM8.</span></div>
<div class="note" style="margin:0"><b>A red category.</b> <span class="q">A business can pick red for a category. Its cap would look like Overdue. HeyTiff could nudge reds away from the state red when it makes the paint.</span></div>
<div class="note" style="margin:0"><b>A blank swatch today.</b> <span class="q">The maintenance calendar's "Ready to run" key uses a colour that isn't defined, so it shows nothing. Queued as a small fix.</span></div>
</div></div>'''
    return wrap(inner, 2580)


def build(out):
    out["SYS-buttons.dc.html"] = page("Buttons", 1440, 1940, CSS, buttons())
    out["SYS-type.dc.html"] = page("Type", 1440, 1180, CSS, type_board())
    out["SYS-colour.dc.html"] = page("Colour", 1440, 2580, CSS, colour())

