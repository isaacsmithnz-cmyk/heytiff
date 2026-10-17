"""New and Add, side by side on a job. New makes what stands alone, the same
three everywhere; a job's Add makes what belongs to the job."""
from base import ico, page
import boards_v3 as v3
from boards_menus import CSS as MCSS, mi
import boards_jobconvo as jc

CSS = jc.CSS + MCSS.replace(v3.CSS, "")


def add_menu():
    groups = [[("cal", "Visit"), ("task", "Task")], [("dollar", "Variation"), ("receipt", "Cost")], [("shield", "SWMS"), ("cert", "Certificate")]]
    body = '<div class="mdv"></div>'.join("".join(mi(i, t) for i, t in g) for g in groups)
    return f'<div class="ov mn" style="top:40px;right:0;width:220px;text-align:left">{body}</div>'


def build(out):
    out["NJ-1.dc.html"] = page("New on a job: Job, Quote, Task, down", 1440, 900, CSS, v3.with_new_menu(jc.job_convo(), layout="list"))
    out["NJ-2.dc.html"] = page("New on a job: Job, Quote, Task, across", 1440, 900, CSS, v3.with_new_menu(jc.job_convo(), layout="row"))
    out["NJ-3.dc.html"] = page("A job's Add", 1440, 900, CSS, jc.job_convo(add_menu=add_menu()))
