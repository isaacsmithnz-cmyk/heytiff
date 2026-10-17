"""'For your information' once blue is the main button: four ways to say it."""
from base import page
import boards_v3 as v3

CSS = v3.CSS + """
.rl3 .qq{color:var(--q)}
.ifh .t16{font-size:16px;line-height:24px}
.ifg{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px}
.ifp{border:1px solid var(--line);border-radius:16px;padding:24px}
.ifp h3{margin:0;font-size:16px;line-height:24px;font-weight:600}
.ifp h3 .pk{margin-left:8px;font-size:12px;font-weight:600;color:var(--blue)}
.ifp>p{margin:4px 0 0;color:var(--q);min-height:40px}
.ifh{display:flex;align-items:center;gap:12px;margin-top:20px;padding-bottom:12px}
.ift{display:grid;grid-template-columns:56px minmax(0,1fr) 210px;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
.ift .n{font-weight:600;font-variant-numeric:tabular-nums}
.ift b{font-weight:600}
.o-blue .st.info{color:var(--blue)} .o-blue .dt.info{background:var(--blue)}
.o-grey .st.info{color:var(--q)} .o-grey .dt.info{background:var(--grey)}
.o-ink .st.info{color:var(--ink)} .o-ink .dt.info{background:var(--ink)}
.o-purple .st.info{color:var(--purple-w)} .o-purple .dt.info{background:var(--purple)}
"""

JOBS = [("3342", "Rifkin, Julian", '<span class="st good">On site</span>'),
        ("3361", "Okafor, Ada", '<span class="st info">Quote to write</span>'),
        ("3323", "Northgate Realty", '<span class="st look">Waiting on a day</span>'),
        ("3401", "Tran, Mai", '<span class="st info">New enquiry</span>'),
        ("3250", "Scott Group", '<span class="st wrong">Waiting 4 weeks for a day</span>'),
        ("1042", "Meridian Data", '<span class="qq">Booked</span>')]
TODO = [("wrong", "Hilux XQG 41B rego", '<span class="st wrong">Runs out today</span>', "Renew"),
        ("look", "Kingsford Bakery, 2380", '<span class="st look">Finished, ready to invoice</span>', "Invoice"),
        ("info", "Lyle Irving", '<span class="st info">On leave from Monday</span>', ""),
        ("info", "Meridian Data, 1042", '<span class="st info">Customer changed the time to 12:45</span>', "")]
DOT = {"wrong": "background:var(--red)", "look": "background:var(--orange)"}


def panel(cls, title, desc, pick=False):
    jobs = "".join(f'<div class="ift"><span class="n">{n}</span><b>{c}</b>{s}</div>' for n, c, s in JOBS)
    todo = "".join(f'<div class="rw" style="gap:10px"><span class="dt{" info" if k == "info" else ""}"{f" style={DOT[k]}" if k in DOT else ""}></span><div class="m"><div class="t">{t}</div><div class="s">{s}</div></div>{f"<span class=\'b sm sec\'>{b}</span>" if b else ""}</div>' for k, t, s, b in TODO)
    return f'''<div class="ifp {cls}"><h3>{title}{"<span class=pk>Chosen</span>" if pick else ""}</h3><p>{desc}</p>
<div class="ifh"><span class="t16" style="font-weight:600">Jobs</span><span class="qq">State column</span><span style="flex:1"></span><span class="b sm go">Book a day</span></div>
{jobs}
<div class="ifh" style="margin-top:12px"><span class="t16" style="font-weight:600">To do</span><span class="qq">With dots</span></div>
{todo}
</div>'''


def board():
    return f'''<div class="rl3">
<h1>"For your information", now blue is the main button</h1>
<p class="lede">Old law 2 says a state colour is never the colour you press. Blue is now the main button, so the information state needs another way to speak. The other three states keep their colours. The same jobs and To do in each.</p>
<div class="ifg">
{panel("o-blue", "Now: blue", "The same blue as the main button beside it. 'Quote to write' and 'New enquiry' read like links or something to press.")}
{panel("o-grey", "Grey word, grey dot", "Said quietly, like 'Booked'. Three states keep their colour, and blue only ever means 'press here'. Information sits with plain text, which is what it is.", True)}
{panel("o-ink", "Black word, black dot", "Stands out from plain grey text without a colour. Close to the bold names beside it, so it can read as a heading.")}
{panel("o-purple", "Purple word, purple dot", "Keeps a fourth colour for information. Purple is also a job colour (Projects here) and public holidays on timesheets.")}
</div></div>'''


def build(out):
    out["IF-info.dc.html"] = page("For your information", 1440, 1740, CSS, board())
