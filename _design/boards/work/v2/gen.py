import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import boards_home

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "canvas", "project")

out = {}
boards_home.build(out)
for mod in ("boards_more", "boards_pay", "boards_claude", "boards_home2", "boards_tabs", "boards_tabs2", "boards_frames", "boards_system", "boards_trim", "boards_v3", "boards_curl", "boards_phcurl", "boards_tiffcolour", "boards_info", "boards_menus", "boards_tabsopt", "boards_newmenu", "boards_wf", "boards_jobconvo", "boards_newadd", "boards_final", "boards_flows", "boards_mobile"):
    try:
        m = __import__(mod)
        m.build(out)
    except ModuleNotFoundError as e:
        if e.name != mod:
            raise
for name, html in out.items():
    with open(os.path.join(OUT, name), "w") as f:
        f.write(html)
    print("wrote", name)
