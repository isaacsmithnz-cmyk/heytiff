"""Each job has its own conversation with Tiff. You type or talk; Tiff turns it
into notes, tasks, visits and variations, says what it did, and asks only when
it has to. A note keeps exactly what was said."""
from base import ico, page
import boards_v3 as v3
from boards_menus import hide
from boards_trim import tiff_mono, MONO_DEFS
import boards_tiffcolour as tc

CSS = v3.CSS + tc.CSS.replace(tc.CSS.split("@keyframes tcCyc")[0], "") + """
.jcw{display:flex;gap:40px;padding:16px 40px 0;height:calc(900px - 268px)}
.jc{flex:1;min-width:0;display:flex;flex-direction:column}
.jt{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;gap:16px;padding-bottom:16px;-webkit-mask-image:linear-gradient(to bottom,transparent,#000 40px);mask-image:linear-gradient(to bottom,transparent,#000 40px)}
.dd2{display:flex;align-items:center;gap:12px;font-size:12px;line-height:16px;font-weight:500;color:var(--q)}
.dd2::before,.dd2::after{content:"";flex:1;height:1px;background:var(--line)}
.msg{display:flex;gap:12px;align-items:flex-start}
.msg .bd{flex:1;min-width:0}
.msg .who{font-size:13px;line-height:18px;display:flex;align-items:center;gap:6px}
.msg .who b{font-weight:600}
.msg .who .qq{font-weight:500}
.msg .who .ico{width:14px;height:14px;color:var(--q)}
.msg p{margin:2px 0 0;font-size:16px;line-height:24px}
.note2{border:1px solid var(--line);border-radius:16px;padding:12px 14px;margin-top:6px;cursor:pointer}
.note2 .lb2{display:flex;align-items:center;gap:6px;font-size:12px;line-height:16px;font-weight:500;color:var(--q)}
.note2 .lb2 .ico{width:14px;height:14px}
.note2 p{margin:4px 0 0}
.note2.open{border-color:var(--ink)}
.act{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-top:8px}
.act .ico{width:16px;height:16px;color:var(--q);flex:none}
.act .m2{flex:1;min-width:0}
.act .m2 b{font-weight:600;display:block}
.act .m2 span{font-size:13px;line-height:18px;color:var(--q)}
.chips2{display:flex;gap:8px;margin-top:10px}
.jbar{border:1px solid var(--edge);border-radius:16px;padding:12px 12px 10px 16px;background:#fff;margin-bottom:16px}
.jbar .row{display:flex;align-items:center;gap:8px;margin-top:8px}
.jside{width:360px;flex:none;display:flex;flex-direction:column;gap:18px;overflow:hidden}
.sheet{position:absolute;z-index:6;right:0;top:0;bottom:0;width:480px;background:#fff;box-shadow:0 12px 32px rgba(10,12,20,.16);padding:24px 28px;display:flex;flex-direction:column;gap:18px;border-left:1px solid var(--line)}
.sheet h2{margin:0;font-size:20px;line-height:28px;font-weight:600}
.sheet .c12{display:block;margin-bottom:6px}
.wave{display:flex;align-items:center;gap:2px;height:28px;flex:1}
.wave i{display:block;width:3px;border-radius:2px;background:rgba(5,5,5,.25)}
.wave i.p{background:var(--ink)}
.said{font-size:16px;line-height:26px}
.said .um{color:var(--q)}
.jcs{width:1440px;height:900px;background:#fff;padding:56px 64px;display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:64px}
.jcs h1{margin:0;font-size:24px;line-height:32px;font-weight:600}
.jcs .ld{margin:8px 0 0;color:var(--q);font-size:16px;line-height:24px}
.jcs .k{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.jcs .k .n{width:24px;height:24px;border-radius:50%;background:var(--soft);font-size:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.jcs .k b{font-weight:600}
.jcs .k p{margin:2px 0 0;color:var(--q);font-size:13px;line-height:18px}
.jcs h3{margin:0 0 8px;font-size:12px;line-height:16px;font-weight:500;color:var(--q)}
.jcs .tk2{display:grid;grid-template-columns:minmax(0,1fr) 150px;padding:8px 0;border-top:1px solid var(--line);font-size:13px;line-height:18px}
.jcs .tk2 span:last-child{color:var(--q)}
"""

PLAY = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>'


def av(a):
    return f'<span class="avt">{a}</span>'


def tiff_av(working=False):
    if working:
        return f'<span style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;flex:none">{tc.mk(26, ra="cyc", rb="cyc2", working=True)}</span>'
    return f'<span style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;flex:none">{tiff_mono(24)}</span>'


def who(name, time, extra=""):
    return f'<div class="who"><b>{name}</b><span class="qq">{time}</span>{extra}</div>'


def act(icon, title, sub, link="Undo"):
    return f'<div class="act">{ico(icon)}<div class="m2"><b>{title}</b><span>{sub}</span></div><a class="lk l13" href="#">{link}</a></div>'


def thread(note_open=False, question=True):
    voice = f'{ico("mic")}<span class="qq">Voice</span>'
    msgs = [
        '<div class="dd2">Yesterday</div>',
        f'<div class="msg">{av("CA")}<div class="bd">{who("Callum Ahn", "3:40 pm")}<p>Customer wants an isolator on the deck as well. <span class="nt">Isaac</span> can you price it?</p></div></div>',
        f'<div class="msg">{tiff_av()}<div class="bd">{who("Tiff", "3:40 pm")}<p>I\'ve drafted a variation for it. It\'s waiting for Isaac before it goes to Julian.</p>{act("doc", "Variation: isolator on the deck", "$480 plus GST, waiting for Isaac", "Open")}</div></div>',
        '<div class="dd2">Today</div>',
        f'''<div class="msg">{av("LI")}<div class="bd">{who("Lyle Irving", "10:02 am")}<div class="note2{" open" if note_open else ""}"><div class="lb2">{ico("mic")}Note from 42 seconds of voice</div><p class="r16">Study head mounted and levelled. Pipe going through the robe, 6 m to the outdoor, so it needs the longer run.</p></div></div></div>''',
        f'<div class="msg">{av("IS")}<div class="bd">{who("Isaac Smith", "10:05 am", voice)}<p>Get Lyle to order the grilles before lunch, and book commissioning for Friday arvo.</p></div></div>',
    ]
    tiff_reply = f'<p>Done: a task for Lyle.</p>{act("task", "Order the grilles", "Lyle, today by 12:30")}'
    if question:
        tiff_reply += '<p style="margin-top:12px">Commissioning on Friday: which time? Lyle\'s free at both.</p><div class="chips2"><span class="b sm sec">2:00 pm</span><span class="b sm sec">3:30 pm</span><span class="b sm sec">Another time</span></div>'
    msgs.append(f'<div class="msg">{tiff_av()}<div class="bd">{who("Tiff", "10:05 am")}{tiff_reply}</div></div>')
    return "".join(msgs)


def bar(text=None, listening=False):
    if listening:
        top = f'<div style="display:flex;align-items:center;gap:10px;min-height:32px">{tc.mk(24, ra="cyc", rb="cyc2", working=True)}<span class="r16">Listening</span><span class="qq nm">0:06</span></div>'
    else:
        top = f'<div class="r16 {"" if text else "qq"}" style="min-height:32px">{text or "Tell Tiff about this job"}</div>'
    return f'''<div class="jbar">{top}<div class="row"><span class="b sm sec">{ico("camera")}Add photo</span><span class="ib">{ico("mic")}</span><span style="flex:1"></span><span class="b sm go">Send</span></div></div>'''


def side():
    todo = f'''<div class="gp"><h2 class="t16" style="margin-bottom:2px">To do on this job</h2>
<div class="rw" style="gap:10px;padding:8px 0;border-top:0"><span class="tk"></span><div class="m"><div class="t">Order the grilles</div><div class="s">Lyle, today by 12:30</div></div></div>
<div class="rw" style="gap:10px;padding:8px 0"><span class="tk"></span><div class="m"><div class="t">Approve the isolator variation</div><div class="s">Isaac</div></div></div></div>'''
    nextv = '<div class="gp"><h2 class="t16" style="margin-bottom:4px">Next visit</h2><p>Friday 16 October, commissioning, Lyle. <span class="st look">Time to confirm</span></p></div>'
    up = '<div class="gp"><h2 class="t16" style="margin-bottom:4px">Where it\'s up to</h2><p>Day 1 of 1. Both heads in, outdoor on the slab, pipe through the robe. Commissioning Friday.</p></div>'
    return f'<aside class="jside">{up}{todo}{nextv}</aside>'


def job_convo(note_open=False, question=True, bar_html=None, add_menu=""):
    content = f'<div class="jcw"><section class="jc"><div class="jt">{thread(note_open, question)}</div>{bar_html or bar()}</section>{side()}</div>'
    return hide(v3.job(content=content, add_menu=add_menu))


def note_sheet():
    bars = "".join(f'<i class="{"p" if k < 14 else ""}" style="height:{h}px"></i>' for k, h in enumerate([8, 14, 20, 12, 24, 18, 10, 22, 26, 16, 12, 20, 14, 8, 18, 24, 12, 20, 26, 14, 10, 18, 22, 12, 8, 16, 20, 14, 10, 18, 24, 16, 12, 8, 14, 20, 12, 18, 10, 8]))
    said = ('<span class="um">Okay, so, um,</span> study head\'s mounted, it\'s level, I\'ve checked it twice. '
            '<span class="um">Uh,</span> now I\'m running the pipe through the robe. It\'s about six metres out to the outdoor, '
            'so we\'ll need the longer run, not the five metre kit. Callum\'s on the slab doing the outdoor. '
            '<span class="um">Yeah, that\'s it.</span>')
    return f'''<div class="sheet">
<div style="display:flex;align-items:center;gap:12px"><h2>Note</h2><span style="flex:1"></span><span class="ib bare">{ico("x")}</span></div>
<div style="display:flex;align-items:center;gap:10px">{av("LI")}<div><div style="font-weight:600">Lyle Irving</div><div class="l13 qq">Today 10:02 am, on site</div></div></div>
<div><span class="c12">Tiff's summary</span><p class="r16" style="margin:0">Study head mounted and levelled. Pipe going through the robe, 6 m to the outdoor, so it needs the longer run.</p></div>
<div style="display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:16px;padding:10px 14px"><span class="ib" style="background:var(--ink);color:#fff;border-color:var(--ink)">{PLAY}</span><div class="wave">{bars}</div><span class="l13 qq nm">0:15 of 0:42</span></div>
<div><span class="c12">What Lyle said, word for word</span><p class="said" style="margin:0">{said}</p></div>
<div class="l13 qq" style="display:flex;align-items:center;gap:8px"><span class="tk on">{ico("check")}</span>In ServiceM8 since 10:02 am</div>
<div style="display:flex;gap:8px;margin-top:auto"><span class="b sec">Edit the summary</span></div>
</div>'''


def phone():
    msgs = (f'<div class="msg">{av("IS")}<div class="bd">{who("Isaac Smith", "10:05")}<p style="font-size:15px;line-height:22px">Get Lyle to order the grilles before lunch.</p></div></div>'
            f'<div class="msg">{tiff_av()}<div class="bd">{who("Tiff", "10:05")}{act("task", "Order the grilles", "You, today by 12:30")}</div></div>'
            f'<div class="msg">{av("LI")}<div class="bd">{who("You", "10:31")}<div class="note2"><div class="lb2">{ico("mic")}Note from 20 seconds of voice</div><p style="font-size:15px;line-height:22px">Grilles ordered from Reece, pick up at 2. Two 600 square, white.</p></div></div></div>'
            + f'<div class="msg">{tiff_av()}<div class="bd">{who("Tiff", "10:31")}<p style="font-size:15px;line-height:22px">Ticked off the grilles, and put the pick-up in your day.</p>{act("cal", "Pick up grilles, Reece Alexandria", "You, today 2:00")}</div></div>')
    return f'''<div class="v3 on-ink" style="width:390px;height:844px;flex-direction:column">{v3.MARK_DEFS}{MONO_DEFS}{tc.DEFS}
  <div style="height:56px;flex:none;display:flex;align-items:center;gap:8px;padding:0 12px 0 8px;color:#fff"><span class="ib bare lg" style="background:transparent;color:#fff">{ico("menu")}</span>{v3.mark_svg()}<b style="font-size:16px;font-weight:700">HeyTiff</b><span style="flex:1"></span><span class="b" style="height:40px;background:#fff;color:var(--ink)">{ico("plus")}New</span></div>
  <div style="flex:1;min-height:0;background:#fff;border-radius:40px 0 0 0;display:flex;flex-direction:column;overflow:hidden">
    <div style="padding:20px 16px 0 24px"><a class="lk l13 qq" href="#">Jobs</a><h1 class="t20" style="margin-top:4px">Rifkin, Julian</h1><p class="l13 qq" style="display:flex;align-items:center;gap:6px">{v3.dot("Blue")}3342, Bellevue Hill. <span class="st good">On site</span></p></div>
    <nav class="stb" style="margin:12px 0 0;padding:0 16px;overflow:hidden"><a class="on" href="#">Overview</a><a href="#">Quote</a><a href="#">Visits<span class="c">2</span></a><a href="#">Checklist</a></nav>
    <div style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;gap:14px;padding:12px 16px;-webkit-mask-image:linear-gradient(to bottom,transparent,#000 32px);mask-image:linear-gradient(to bottom,transparent,#000 32px)">{msgs}</div>
    <div class="jbar" style="margin:0 12px 12px">
      <div style="display:flex;align-items:center;gap:10px;min-height:32px">{tc.mk(24, ra="cyc", rb="cyc2", working=True)}<span class="r16">Listening</span><span class="qq nm">0:06</span></div>
      <div class="row"><span class="b lg sec" style="padding:0 14px">{ico("camera")}Photo</span><span class="ib lg" style="background:var(--ink);color:#fff;border-color:var(--ink)">{ico("mic")}</span><span style="flex:1"></span><span class="b lg go">Send</span></div>
    </div>
  </div>
</div>'''


def spec():
    ks = [
        ("One conversation per job.", "Everyone on the job writes in it; it's one of Tiff's conversations, so it also shows under Conversations with the job's name."),
        ("Type or talk.", "Tiff works out what it is: a note, a task, a visit, a variation, a cost, a photo for the job."),
        ("Clear: Tiff just does it.", "She says what she made in one line, with the thing itself and Undo. It also appears where it lives: the task in To do, the visit on the Schedule."),
        ("Unclear: Tiff asks.", "One question, with answers to tap, like the quote's To confirm. Nothing waits silently."),
        ("A note keeps what was said.", "Tiff's summary is what you read; tap the note for the words exactly as spoken, and to play it back."),
        ("Some things Tiff never does alone.", "Anything sent to the customer, any change to a price, anything deleted: she drafts it and asks first."),
        ("Forms still work.", "The job's Add button opens Visit, Task, Variation, Cost, SWMS or Certificate by hand. Manual entry always works."),
    ]
    k = "".join(f'<div class="k"><span class="n">{i + 1}</span><div><b>{a}</b><p>{b}</p></div></div>' for i, (a, b) in enumerate(ks))
    ex = [("\"Running the pipe through the robe, six metres\"", "A note"), ("\"Get Lyle to order the grilles before lunch\"", "A task for Lyle, today by 12:30"), ("\"Book commissioning for Friday arvo\"", "A visit, after asking the time"), ("\"Julian wants an isolator on the deck\"", "A variation, drafted, waiting for approval"), ("A photo of a Reece invoice", "A cost on the job"), ("\"Send Julian the variation\"", "Asks first: it goes to the customer")]
    e = "".join(f'<div class="tk2"><span>{a}</span><span>{b}</span></div>' for a, b in ex)
    return f'''<div class="v3" style="display:block;background:#fff"><div class="jcs">
<div><h1>The job's conversation</h1><p class="ld">Type or talk to the job. Tiff turns it into the right thing, says what she did, and asks only when she has to.</p><div style="margin-top:20px">{k}</div></div>
<div><h3>What you say, and what Tiff makes</h3>{e}</div>
</div></div>'''


def build(out):
    out["JC-0.dc.html"] = page("The job's conversation", 1440, 900, CSS, spec())
    out["JC-1.dc.html"] = page("A job, its conversation", 1440, 900, CSS, job_convo())
    out["JC-2.dc.html"] = page("A note, exactly as said", 1440, 900, CSS, job_convo(note_open=True).replace("</main>", "</main>" + note_sheet(), 1))
    out["JC-3.dc.html"] = page("Talking to the job on site", 390, 844, CSS, phone())
