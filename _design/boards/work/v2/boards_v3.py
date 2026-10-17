"""The new rule set, and every main screen drawn to it with each part numbered.
Teal discs are review markers, not part of the design: each number is a rule
on the Rules board to confirm."""
from base import ico, page
from boards_home2 import MARK_CSS, MARK_DEFS, mark_svg
from boards_trim import tiff_mono, MONO_DEFS

CSS = MARK_CSS + """
body{margin:0}
.v3,.v3 *,.rl3,.rl3 *{box-sizing:border-box}
.v3,.rl3{--ink:#050505;--q:#5f6a79;--line:rgba(5,5,5,.08);--edge:rgba(5,5,5,.14);--sel:rgba(5,5,5,.07);--hov:rgba(5,5,5,.04);--soft:rgba(5,5,5,.05);
 --red:#EF4444;--red-w:#BE123C;--orange:#F97316;--orange-w:#B45309;--yellow:#FACC15;--yellow-w:#A16207;--green:#22C55E;--green-w:#15803D;
 --blue:#2563EB;--purple:#A855F7;--purple-w:#7E22CE;--pink:#EC4899;--pink-w:#9D174D;--grey:#9CA3AF;
 font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:14px;line-height:20px;color:var(--ink);-webkit-font-smoothing:antialiased}
.v3{display:flex;width:1440px;height:900px;overflow:hidden;position:relative;background:linear-gradient(to bottom,var(--ink) 50%,#fff 50%)}
.v3 a{color:inherit;text-decoration:none}
.v3 p,.v3 h1,.v3 h2,.v3 h3{margin:0}
.v3 .ico{width:18px;height:18px}
.i14{width:14px!important;height:14px!important}
.i16{width:16px!important;height:16px!important}
/* type */
.v3 .t24{font-size:24px;line-height:32px;font-weight:600;letter-spacing:-.2px}
.v3 .t20{font-size:20px;line-height:28px;font-weight:600}
.v3 .t16{font-size:16px;line-height:24px;font-weight:600}
.v3 .r16{font-size:16px;line-height:24px;font-weight:400}
.v3 .l13{font-size:13px;line-height:18px;font-weight:500}
.v3 .c12{font-size:12px;line-height:16px;font-weight:500;color:var(--q)}
.v3 .big{font-size:32px;line-height:40px;font-weight:700;letter-spacing:-.4px;font-variant-numeric:tabular-nums}
.v3 .qq{color:var(--q)}
.v3 .nm{font-variant-numeric:tabular-nums}
/* the frame */
.sd{width:256px;flex:none;color:#fff;display:flex;flex-direction:column;padding:12px 8px 16px;background:var(--ink);border-radius:0 0 40px 0}
.brd{display:flex;align-items:center;gap:8px;height:40px;padding:0 8px;margin-bottom:8px}
.brd b{font-size:16px;font-weight:700;letter-spacing:-.2px}
.sr{display:flex;align-items:center;gap:12px;height:36px;padding:0 8px;border-radius:10px;font-weight:500;white-space:nowrap;color:#fff}
.sr .ico{color:rgba(255,255,255,.6)}
.sr.on{background:rgba(255,255,255,.12);font-weight:600}
.sr.on .ico{color:#fff}
.sr .r{margin-left:auto;font-size:13px;font-weight:600}
.sr .k{margin-left:auto;font-size:12px;font-weight:500;color:rgba(255,255,255,.5)}
.sr .pl{width:24px;height:24px;border-radius:50%;background:#fff;color:var(--ink);display:inline-flex;align-items:center;justify-content:center;margin:0 -3px}
.sr .pl .ico{color:var(--ink);width:14px;height:14px}
.slb{font-size:12px;line-height:16px;font-weight:500;color:rgba(255,255,255,.5);padding:16px 8px 4px}
.rc{display:flex;align-items:center;gap:10px;height:32px;padding:0 8px;border-radius:10px;white-space:nowrap;overflow:hidden;color:#fff}
.rc .tx{flex:1;min-width:0;overflow:hidden;white-space:nowrap;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 24px),transparent)}
.rc .ico{width:16px;height:16px;color:rgba(255,255,255,.6)}
.sd .cwb:has(>.you){margin-top:auto}
.you{margin-top:auto;display:flex;align-items:center;gap:12px;padding:8px;border-radius:10px;color:#fff}
.you .avt{background:#fff;color:var(--ink)}
.pg{flex:1;min-width:0;background:#fff;border-radius:40px 0 0 0;display:flex;flex-direction:column;overflow:hidden;position:relative}
.hd{height:56px;flex:none;display:flex;align-items:center;gap:8px;padding:0 16px 0 40px}
.hd .dd{font-weight:500}
.hd .tm{color:var(--q);font-weight:500;margin-left:4px}
.otabs{display:flex;align-items:center;gap:6px;margin-left:auto}
.otab{height:32px;display:inline-flex;align-items:center;gap:8px;padding:0 8px 0 10px;border:1px solid var(--edge);border-radius:10px;font-size:13px;font-weight:500;color:var(--q);white-space:nowrap}
.otab.on{border-color:var(--ink);color:var(--ink);font-weight:600}
.otab .ico{width:16px;height:16px}
.otab .x .ico{width:14px;height:14px}
.ntb{height:32px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--q);white-space:nowrap;margin-left:auto}
.otabs+.ntb{margin-left:4px}
.ntb .ico{width:14px;height:14px}
.body{flex:1;min-height:0;overflow:hidden}
.ph{padding:8px 40px 0}
/* buttons */
.b{height:36px;padding:0 16px;border-radius:10px;font-size:14px;line-height:20px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;border:1px solid transparent;flex:none;color:var(--ink);background:transparent}
.b.sm{height:32px;padding:0 12px;font-size:13px;line-height:18px}
.b.lg{height:44px;padding:0 20px;font-size:16px;line-height:24px}
.b.go{background:var(--blue);color:#fff}
.b.sec{background:#fff;border-color:var(--edge)}
.b.del{background:#fff;border-color:var(--edge);color:var(--red-w)}
.b.delf{background:var(--red-w);color:#fff}
.b .ico{width:16px;height:16px}
.v3 .lk{text-decoration:underline;text-underline-offset:3px;font-weight:500}
.ib{width:32px;height:32px;border-radius:50%;border:1px solid var(--edge);display:inline-flex;align-items:center;justify-content:center;flex:none;background:#fff}
.ib.bare{border-color:transparent;border-radius:10px}
.ib .ico{width:16px;height:16px}
.ib.lg{width:44px;height:44px}
/* fields */
.fl{display:flex;flex-direction:column;gap:6px;min-width:0}
.fl>span.lb{font-size:13px;line-height:18px;font-weight:500}
.fi{height:36px;border:1px solid var(--edge);border-radius:6px;padding:0 12px;display:flex;align-items:center;gap:8px;background:#fff;white-space:nowrap}
.fi.err{border-color:var(--red-w)}
.fi .ph2{color:var(--q)}
.fi .ico{width:16px;height:16px;color:var(--q)}
.fi.sel2{justify-content:space-between}
.fe{font-size:13px;line-height:18px;color:var(--red-w);font-weight:500}
/* choices */
.chip{height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--edge);font-size:13px;font-weight:500;display:inline-flex;align-items:center;gap:6px;background:#fff;white-space:nowrap}
.chip .c{color:var(--q)}
.chip.on{border-color:var(--ink);background:var(--sel);font-weight:600}
.sg{display:inline-flex;gap:2px;padding:2px;border-radius:10px;border:1px solid var(--edge)}
.sg span{height:26px;padding:0 12px;border-radius:calc(10px - 2px);display:inline-flex;align-items:center;font-size:13px;font-weight:500;color:var(--q)}
.sg span.on{background:var(--sel);color:var(--ink);font-weight:600}
.stb{display:flex;gap:24px;border-bottom:1px solid var(--line)}
.stb a{height:40px;display:inline-flex;align-items:center;font-weight:500;color:var(--q);border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.stb a.on{color:var(--ink);border-color:var(--ink);font-weight:600}
.stb .c{color:var(--q);font-weight:500;margin-left:4px}
.tk{width:18px;height:18px;border:1.5px solid rgba(5,5,5,.3);border-radius:6px;flex:none;display:inline-flex;align-items:center;justify-content:center;background:#fff}
.tk.on{background:var(--blue);border-color:var(--blue);color:#fff}
.tk .ico{width:12px;height:12px;stroke-width:3}
.swt{width:36px;height:20px;border-radius:999px;background:rgba(5,5,5,.2);position:relative;flex:none;display:inline-block}
.swt::after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff}
.swt.on{background:var(--blue)}
.swt.on::after{left:auto;right:2px}
/* marks */
.dt{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}
.st{font-weight:500;white-space:nowrap}
.st.good{color:var(--green-w)}.st.look{color:var(--orange-w)}.st.wrong{color:var(--red-w)}.st.info{color:var(--q)}
.avt{width:32px;height:32px;border-radius:50%;background:var(--soft);color:var(--ink);font-size:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex:none}
.avt.s{width:24px;height:24px}
.nt{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;background:var(--soft);font-size:13px;font-weight:600;vertical-align:1px}
/* rows, cards, groups */
.rw{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.rw .m{flex:1;min-width:0}
.rw .t{font-weight:600;white-space:nowrap;overflow:hidden;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 24px),transparent)}
.rw .s{font-size:13px;line-height:18px;color:var(--q)}
.rw .tm{width:104px;flex:none;font-size:13px;line-height:18px;font-weight:500;color:var(--q);font-variant-numeric:tabular-nums}
.cd{border:1px solid var(--line);border-radius:16px;background:#fff}
.gp{border-top:1px solid var(--line);padding-top:12px}
.ov{background:#fff;border-radius:16px;box-shadow:0 12px 32px rgba(10,12,20,.16)}
.scr{position:absolute;inset:0;background:rgba(10,11,16,.45)}
.toast{position:absolute;left:280px;bottom:24px;background:var(--ink);color:#fff;border-radius:10px;padding:10px 12px 10px 16px;display:flex;gap:16px;align-items:center;box-shadow:0 12px 32px rgba(10,12,20,.16);font-weight:500}
.toast .lk{color:#fff}
.mi{display:flex;align-items:center;gap:12px;height:36px;padding:0 12px;border-radius:10px;font-weight:500}
.mi.on{background:var(--sel)}
.mi .ico{width:16px;height:16px;color:var(--q)}
.mi .r{margin-left:auto;color:var(--q)}
.mdv{height:1px;background:var(--line);margin:6px 4px}
.sk{background:var(--soft);border-radius:6px;height:12px}
.box{border:1px solid var(--edge);border-radius:16px;padding:14px 14px 12px 16px;background:#fff}
.steps{display:flex;align-items:center;gap:8px;font-size:13px;line-height:18px;font-weight:500;color:var(--q);white-space:nowrap}
.steps .on{color:var(--ink);font-weight:600}
.steps .dn{color:var(--ink)}
.steps .sep{width:16px;height:1px;background:rgba(5,5,5,.2)}
.th{display:grid;font-size:13px;line-height:18px;font-weight:500;color:var(--q);padding:8px 0;border-bottom:1px solid var(--line)}
.tr{display:grid;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}
.lane{display:grid;grid-template-columns:150px minmax(0,1fr);height:68px;border-bottom:1px solid var(--line)}
.blk{position:absolute;z-index:1;top:8px;bottom:8px;border-radius:10px;padding:7px 10px;overflow:hidden;white-space:nowrap;font-size:13px;line-height:18px}
.blk b{display:block;font-weight:600;overflow:hidden;white-space:nowrap;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 14px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 14px),transparent)}
.blk span{display:block;font-size:12px;line-height:16px;font-weight:500;overflow:hidden;white-space:nowrap;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 14px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 14px),transparent);opacity:.85}
/* review markers: not part of the design */
.sym{width:22px;height:22px;flex:none;border-radius:6px;background:#fff;border:1px solid var(--edge);display:inline-flex;align-items:center;justify-content:center}
.sym svg{width:14px;height:14px}
.grh{display:flex;align-items:center;gap:8px;padding:16px 0 8px;border-bottom:1px solid var(--line);font-size:13px;line-height:18px}
.grh b{font-size:14px;font-weight:600}
.grh .chev .ico{width:14px;height:14px;color:var(--q)}
.nmd{position:absolute;z-index:5;left:1px;top:53px;width:254px;padding:0 6px 6px;background:var(--ink);color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:16px;box-shadow:0 12px 32px rgba(10,12,20,.16)}
.nmd .mi{color:#fff}
.nmd .mi .ico,.nmd .mi .r{color:rgba(255,255,255,.6)}
.nmd .mi.on{background:rgba(255,255,255,.12)}
.nmd .mdv{background:rgba(255,255,255,.14)}
.nmd .nh{display:flex;align-items:center;gap:12px;height:36px;padding:0 8px;font-weight:600;background:rgba(255,255,255,.12);border-radius:10px;margin-top:6px}
.nmd .nh .pl{width:24px;height:24px;border-radius:50%;background:#fff;display:inline-flex;align-items:center;justify-content:center;margin:0 -3px}
.nmd .nh .pl .ico{width:14px;height:14px;color:var(--ink)}
.nmd .ctx{display:flex;align-items:center;gap:8px;height:36px;padding:0 6px 0 12px;font-weight:600}
.nmd .ctx .x{color:rgba(255,255,255,.5);display:inline-flex;flex:none}
.nmd .ctx .x .ico{width:14px;height:14px}
.nmd .sub{position:absolute;left:calc(100% + 12px);top:-7px;width:200px;padding:6px;background:var(--ink);border:1px solid rgba(255,255,255,.14);border-radius:16px;box-shadow:0 12px 32px rgba(10,12,20,.16)}
.nmf{position:absolute;z-index:5;left:256px;top:54px;width:300px;background:var(--ink);color:#fff;border-radius:0 16px 16px 0;padding:6px 6px 6px 0;box-shadow:0 12px 32px rgba(10,12,20,.16)}
.nmf .band{display:flex;align-items:center;gap:8px;height:36px;padding:0 8px 0 12px;background:rgba(255,255,255,.12);border-radius:0 10px 10px 0;font-weight:600}
.nmf .band .x{margin-left:auto;color:rgba(255,255,255,.5);display:inline-flex;flex:none}
.nmf .band .x .ico{width:14px;height:14px}
.nmf .in{padding-left:6px}
.nmf .band .ico{width:16px;height:16px;color:rgba(255,255,255,.6)}
.nrw{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:10px;color:#fff;white-space:nowrap}
.nrw:first-child{background:rgba(255,255,255,.12)}
.nmf .mi{color:#fff}
.nmf .mi .ico,.nmf .mi .r{color:rgba(255,255,255,.6)}
.nmf .mi.on{background:rgba(255,255,255,.12)}
.nmf .mdv{background:rgba(255,255,255,.14)}
.nmf .sub{position:absolute;left:calc(100% + 12px);top:-6px;width:200px;padding:6px;background:var(--ink);border-radius:16px;box-shadow:0 12px 32px rgba(10,12,20,.16)}
.fade{flex:1;min-width:0;white-space:nowrap;overflow:hidden;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 28px),transparent)}
.vwp{display:inline-flex;gap:4px}
.vwp a{height:32px;padding:0 10px;font-size:13px;line-height:18px;font-weight:500;color:var(--q);display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.vwp a.on{color:var(--ink);font-weight:600}
.vws{display:inline-flex;gap:4px}
.vws a{height:32px;padding:0 12px;border-radius:10px;font-size:13px;line-height:18px;font-weight:500;color:var(--q);display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.vws a.on{background:var(--sel);color:var(--ink);font-weight:600}
.vws a .c{color:var(--q);font-weight:500}
.vsec{width:168px;flex:none;display:flex;flex-direction:column;gap:2px}
.vsec a{height:36px;padding:0 12px;border-radius:10px;display:flex;align-items:center;font-weight:500;color:var(--q)}
.vsec a.on{background:var(--sel);color:var(--ink);font-weight:600}
.sr.parent{background:transparent}
.svs{display:flex;flex-direction:column;gap:2px;margin:2px 0 6px}
.sv{display:flex;align-items:center;height:32px;padding:0 8px 0 38px;border-radius:10px;font-size:13px;line-height:18px;font-weight:500;color:rgba(255,255,255,.75);white-space:nowrap}
.sv .r{margin-left:auto;color:rgba(255,255,255,.5)}
.sv.on{background:rgba(255,255,255,.12);color:#fff;font-weight:600}
.cw{position:relative;display:inline-flex;vertical-align:middle}
.cwb{position:relative}
.cf{position:absolute;top:-10px;right:-10px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#00D1B2;color:#050505;font-size:12px;line-height:20px;font-weight:700;font-style:normal;text-align:center;box-shadow:0 0 0 2px #fff;z-index:30;pointer-events:none;letter-spacing:0}
.sd .cf,.on-ink .cf{box-shadow:0 0 0 2px #050505}
/* rules board */
.rl3{width:1440px;background:#fff;padding:56px 64px 64px}
.rl3 h1{font-size:32px;line-height:40px;font-weight:700;letter-spacing:-.4px;margin:0}
.rl3 .lede{font-size:16px;line-height:24px;color:var(--q);margin:8px 0 0;max-width:900px}
.rl3 h2{font-size:20px;line-height:28px;font-weight:600;margin:40px 0 4px}
.rl3 .ri{display:grid;grid-template-columns:44px 260px minmax(0,1fr) 100px;gap:16px;padding:12px 0;border-top:1px solid var(--line);align-items:baseline}
.rl3 .ri .n{justify-self:start;display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:999px;background:#00D1B2;font-size:12px;font-weight:700}
.rl3 .ri b{font-weight:600}
.rl3 .ri p{margin:0}
.rl3 .ri .why{display:block;color:var(--q);font-size:13px;line-height:18px;margin-top:2px}
.rl3 .yes{color:var(--green-w);font-weight:500}
.rl3 .ask{color:var(--orange-w);font-weight:500}
.rl3 .keep{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 32px;margin-top:12px}
.rl3 .keep div{border-top:1px solid var(--line);padding-top:10px}
.rl3 .keep b{font-weight:600}
.rl3 .keep span{display:block;color:var(--q);font-size:13px;line-height:18px}
"""

COL = {"Red": "var(--red)", "Orange": "var(--orange)", "Yellow": "var(--yellow)", "Green": "var(--green)", "Blue": "var(--blue)", "Purple": "var(--purple)", "Pink": "var(--pink)", "Grey": "var(--grey)"}


def M(n, inner, pos=None, block=False):
    st = f' style="{pos}"' if pos else ""
    if block:
        return f'<div class="cwb">{inner}<i class="cf"{st}>{n}</i></div>'
    return f'<span class="cw">{inner}<i class="cf"{st}>{n}</i></span>'


SYM = {
    "Sick": '<g transform="rotate(-45 8 8)"><rect x="1" y="5.4" width="14" height="5.2" rx="2.6" fill="none" stroke="var(--red-w)" stroke-width="1.2"/><rect x="5.6" y="6" width="4.8" height="4" fill="var(--red)"/></g>',
    "Leave": '<circle cx="8" cy="8" r="3" fill="var(--yellow)" stroke="var(--yellow-w)" stroke-width="1"/>' + "".join(f'<line x1="{8 + 4.9 * c:.2f}" y1="{8 + 4.9 * s_:.2f}" x2="{8 + 6.9 * c:.2f}" y2="{8 + 6.9 * s_:.2f}" stroke="var(--yellow-w)" stroke-width="1.3" stroke-linecap="round"/>' for c, s_ in [(1, 0), (.707, .707), (0, 1), (-.707, .707), (-1, 0), (-.707, -.707), (0, -1), (.707, -.707)]),
    "Plane": '<path d="M8 1.5c.6 0 1 .6 1 1.3V6l5 3v1.4l-5-1.5v3.2l1.5 1.1V14L8 13.3 5.5 14v-.8L7 12.1V8.9L2 10.4V9l5-3V2.8c0-.7.4-1.3 1-1.3z" fill="var(--blue)"/>',
    "Suitcase": '<path d="M6 5V3.3h4V5" fill="none" stroke="var(--blue)" stroke-width="1.4"/><rect x="2" y="5" width="12" height="8.5" rx="1.5" fill="var(--blue)"/><rect x="2" y="8.4" width="12" height="1.1" fill="#fff"/>',
    "Umbrella": '<path d="M1.8 8.2a6.2 6.2 0 0 1 12.4 0z" fill="var(--orange)"/><path d="M8 2v.6M8 8.2v4.6a1.3 1.3 0 0 1-2.6 0" fill="none" stroke="var(--orange-w)" stroke-width="1.3" stroke-linecap="round"/>',
    "Plaster": '<g transform="rotate(-45 8 8)"><rect x="1" y="5.4" width="14" height="5.2" rx="2.6" fill="none" stroke="var(--red-w)" stroke-width="1.2"/><rect x="5.6" y="6" width="4.8" height="4" fill="var(--red)"/></g>',
    "Thermometer": '<rect x="6.4" y="1.5" width="3.2" height="9.5" rx="1.6" fill="none" stroke="var(--red-w)" stroke-width="1.2"/><rect x="7.4" y="5.5" width="1.2" height="6" fill="var(--red)"/><circle cx="8" cy="12.2" r="2.4" fill="var(--red)"/>',
}


def sym(k):
    return f'<span class="sym"><svg viewBox="0 0 16 16">{SYM[k]}</svg></span>'


def dot(c):
    return f'<span class="dt" style="background:{COL[c]}"></span>'


# ------------------------------------------------------------------ the frame
def sidebar(active="home", mk=False):
    nav = [("home", "Home", "3"), ("chat", "Conversations", ""), ("jobs", "Jobs", ""), ("cal", "Schedule", ""), ("doc", "Documents", ""), ("lib", "Library", ""), ("design", "Design", ""), ("team", "Team", "")]
    rows = ""
    for k, n, c in nav:
        r = f'<a class="sr{" on" if k == active else ""}" href="#">{ico(k)}{n}{f"<span class=r>{c}</span>" if c else ""}</a>'
        if mk and k == active:
            r = M(5, r, "top:-6px;right:-6px", True)
        rows += r
    brand = f'<div class="brd">{mark_svg()}<b>HeyTiff</b><span style="flex:1"></span><span style="color:rgba(255,255,255,.6)">{ico("panel")}</span></div>'
    new = f'<a class="sr" href="#"><span class="pl">{ico("plus")}</span>New</a>'
    search = f'<a class="sr" href="#">{ico("search")}Search<span class="k">⌘K</span></a>'
    pin_lbl = '<div class="slb">Pinned</div>'
    you = '<a class="you" href="#"><span class="avt">IS</span><span style="display:flex;flex-direction:column;min-width:0;flex:1"><span style="font-weight:600">Isaac Smith</span><span style="font-size:12px;line-height:16px;color:rgba(255,255,255,.5)">Owner</span></span><span style="color:rgba(255,255,255,.6)">' + ico("updown") + '</span></a>'
    if mk:
        brand = M(9, brand, "top:4px;right:60px", True)
        new = M(3, new, "top:-6px;right:-6px", True)
        search = M(4, search, "top:-6px;right:-6px", True)
        pin_lbl = M(6, pin_lbl, "top:10px;right:-6px", True)
        you = M(7, you, "top:-6px;right:-6px", True)
    pinned = "".join(f'<a class="rc" href="#">{dot(c)}<span class="tx">{x}</span></a>' for c, x in [("Blue", "3342 Rifkin, Bellevue Hill"), ("Purple", "3302 Heuvel, Chatswood")])
    rec = "".join(f'<a class="rc" href="#">{ico(k)}<span class="tx">{x}</span></a>' for k, x in [("chat", "Riverview brief"), ("doc", "SWMS, Heuvel roof work"), ("person", "Lyle Irving"), ("jobs", "Northgate Realty, 3323")])
    return f'''<aside class="sd">{brand}{new}{search}<div style="height:12px"></div>{rows}{pin_lbl}{pinned}<div class="slb">Recents</div>{rec}{you}</aside>'''


def header(tabs=None, on=None, mk_date=False, mk_tabs=None, mk_new=None, time="10:05 am"):
    date = f'<span class="dd">Tuesday 13 October</span><span class="tm">{time}</span>'
    if mk_date:
        date = M(2, date, "top:-12px;right:-24px")
    t = ""
    if tabs:
        parts = []
        for i, (icon, title) in enumerate(tabs):
            parts.append(f'<span class="otab{" on" if i == on else ""}">{icon}{title}<span class="x">{ico("x")}</span></span>')
        t = f'<span class="otabs">{"".join(parts)}</span>'
        if mk_tabs:
            t = f'<span class="otabs" style="position:relative">{"".join(parts)}<i class="cf">{mk_tabs}</i></span>'
    nt = f'<span class="ntb">{ico("plus")}New tab</span>'
    if mk_new:
        nt = f'<span class="ntb" style="position:relative">{ico("plus")}New tab<i class="cf">{mk_new}</i></span>'
    return f'<header class="hd">{date}{t}{nt}</header>'


def frame(side, head, body, extra="", sweep_marker=False):
    sw = '<i class="cf" style="top:10px;left:10px;right:auto">1</i>' if sweep_marker else ""
    sw2 = '<i class="cf" style="top:auto;bottom:12px;left:266px;right:auto">1</i>' if sweep_marker else ""
    return f'<div class="v3">{MARK_DEFS}{MONO_DEFS}{side}<main class="pg">{sw}{head}<div class="body">{body}</div></main>{sw2}{extra}</div>'


TAB_HOME = (ico("home"), "Home")


def tab_job(c, t):
    return (dot(c), t)


# ------------------------------------------------------------------ Home
def home():
    box = f'''<div class="box">
  <div class="r16 qq" style="min-height:44px">{M(13, "What's happening on site?", "top:-14px;right:-26px")}</div>
  <div style="display:flex;align-items:center;gap:8px"><span class="b sm sec">{ico("camera")}Add photo</span>{M(27, f'<span class="ib">{ico("mic")}</span>')}<span style="flex:1"></span>{M(22, '<span class="b sm go">Send</span>')}</div>
</div>'''
    today = [
        ("7:30 to 8:30", "Green", "Kingsford Bakery, Job 2380", "Service, you", '<span class="st good">Done</span>'),
        ("9:00 to 11:30", "Blue", "Bellevue Hill, Job 3342", "Installation, Lyle and Callum", '<span class="st good">On now</span>'),
        ("By 12:30", None, "Order the grilles", "Task, for Bellevue Hill", ""),
        ("12:45 to 1:45", "Orange", "Riverview, Job 3361", "Quote, Dan", ""),
    ]
    rows = ""
    for i, (tm, c, t, s, r) in enumerate(today):
        lead = dot(c) if c else '<span class="tk"></span>'
        if i == 0:
            lead = M(18, lead, "top:-12px;left:-26px;right:auto")
            r = M(17, r, "top:-14px;right:-18px")
        row = f'<div class="rw"><span class="tm">{tm}</span>{lead}<div class="m"><div class="t">{t}</div><div class="s">{s}</div></div>{r}</div>'
        if i == 1:
            row = M(39, row, "top:4px;left:-34px;right:auto", True)
        rows += row
    todo = [
        ("Red", "Hilux XQG 41B rego", '<span class="st wrong">Runs out today</span>', "Renew"),
        ("Orange", "Lyle asked you: which fans for Rozelle?", '<span class="s">A note on 3348 Ma, Rozelle, 7:40 am</span>', "Reply"),
        ("Orange", "Kingsford Bakery, 2380", '<span class="st look">Finished, ready to invoice</span>', "Invoice"),
        ("Orange", "Timesheets, last week", '<span class="s">4 to approve, 150.5 hours</span>', "Review"),
        ("Grey", "Callum mentioned you on Toolbox talk", '<span class="s">A comment on the notice, Friday</span>', "Open"),
    ]
    td = ""
    for i, (c, t, s, v) in enumerate(todo):
        btn = f'<span class="b sm sec">{v}</span>'
        if i == 0:
            btn = M(23, btn)
        td += f'<div class="rw">{dot(c)}<div class="m"><div class="t">{t}</div><div class="s">{s}</div></div>{btn}</div>'
    body = f'''<div style="max-width:720px;margin:0 auto;padding:4px 32px 0">
  <div style="display:flex;justify-content:center;margin-bottom:16px">{M(8, tiff_mono(48))}</div>
  {box}
  <div style="display:flex;align-items:baseline;gap:12px;margin:32px 0 4px"><h2 class="t16">Today</h2><span class="qq">4 jobs and a task</span><span style="flex:1"></span>{M(26, '<a class="lk l13" href="#">Schedule</a>', "top:-16px;right:-14px")}</div>
  {rows}
  <div style="display:flex;align-items:baseline;gap:12px;margin:28px 0 4px"><h2 class="t16">To do</h2><span class="qq">9</span><span style="flex:1"></span><a class="lk l13" href="#">Show all</a></div>
  {td}
</div>'''
    return frame(sidebar("home", mk=True), header(mk_date=True, mk_new=11), body, sweep_marker=True)


# ------------------------------------------------------------------ Jobs
def selfield(label, menu="", width=None):
    w = f";width:{width}px" if width else ""
    op = ";border-color:var(--ink)" if menu else ""
    return f'<span style="position:relative;display:inline-flex"><span class="fi sel2" style="height:32px;gap:12px;font-size:13px;font-weight:500{w}{op}">{label}{ico("down")}</span>{menu}</span>'


VIEWS = [("All", 142), ("To book", 19), ("Quotes", 23), ("To invoice", 8), ("Owed", 11), ("Projects", 6), ("Agreements", 34)]


def jobs(menus=None, views="soft"):
    menus = menus or {}
    tabs = [TAB_HOME, (ico("jobs"), "Jobs"), tab_job("Blue", "3342 Rifkin")]
    chips = '<span class="chip on">All <span class="c">142</span></span>' + "".join(f'<span class="chip">{n} <span class="c">{c}</span></span>' for n, c in VIEWS[1:])
    if views == "chips":
        viewrow = M(29, f'<span style="display:inline-flex;gap:8px">{chips}</span>')
    elif views == "soft":
        viewrow = M(29, '<span class="vws">' + "".join(f'<a class="{"on" if i == 0 else ""}" href="#">{n} <span class="c">{c}</span></a>' for i, (n, c) in enumerate(VIEWS)) + '</span>')
    elif views == "menu":
        viewrow = selfield('<span><span class="qq">Show</span> All jobs <span class="qq">142</span></span>', menus.get("show", ""))
    else:
        viewrow = ""
    cols = "72px minmax(0,1.6fr) 150px minmax(0,1.2fr) 150px 96px 110px"
    data = [
        ("3342", "Rifkin, Julian", "Bellevue Hill", "Blue", "Installation", '<span class="st good">On site</span>', "Today 9:00", ["LI", "CA"], "$9,840"),
        ("3361", "Okafor, Ada", "Riverview", "Orange", "Quote", '<span class="st info">Quote to write</span>', "Brief saved today", ["IS"], ""),
        ("3323", "Northgate Realty", "Ryde", "Blue", "Installation", '<span class="st look">Waiting on a day</span>', "Won 9 October", ["KL"], "$24,600"),
        ("3302", "Heuvel Construction", "Chatswood", "Purple", "Project", '<span class="st good">Rough-in, day 2 of 3</span>', "Today", ["KL", "DW"], "$188,000"),
        ("1042", "Meridian Data", "Alexandria", "Yellow", "Maintenance", '<span class="qq">Booked</span>', "Today 12:45", ["DW"], "$1,120"),
        ("2380", "Kingsford Bakery", "Kingsford", "Green", "Service", '<span class="st look">Ready to invoice</span>', "Done 8:30 am", ["IS"], "$420"),
        ("3250", "Scott Group", "Parramatta", "Blue", "Installation", '<span class="st wrong">Waiting 4 weeks for a day</span>', "Won 14 September", [], "$31,900"),
        ("3294", "Belmont Holdings", "Rozelle", "Orange", "Quote", '<span class="qq">Waiting on an answer</span>', "Sent 2 October", ["IS"], "$3,150"),
    ]
    trs = ""
    rowhtml = {}
    for i, (n, c, s, h, k, st, nx, who, v) in enumerate(data):
        kind = f'<span style="display:inline-flex;align-items:center;gap:8px">{dot(h)}{k}</span>'
        av = "".join(f'<span class="avt s" style="margin-right:-4px;box-shadow:0 0 0 2px #fff">{a}</span>' for a in who) or '<span class="qq">Nobody yet</span>'
        if i == 0:
            kind = M(18, kind)
            st = M(17, st)
            av = M(38, f'<span style="display:inline-flex">{av}</span>')
        rowhtml[n] = f'<div class="tr" style="grid-template-columns:{cols};gap:16px"><span class="nm" style="font-weight:600">{n}</span><span style="min-width:0"><span style="display:block;font-weight:600">{c}</span><span class="l13 qq">{s}</span></span><span>{kind}</span><span>{st}</span><span class="qq">{nx}</span><span>{av}</span><span class="nm" style="text-align:right">{v}</span></div>'
        trs += rowhtml[n]
    if views == "grouped":
        groups = [("To book", 19, ["3323", "3250"]), ("Quotes", 23, ["3361", "3294"]), ("To invoice", 8, ["2380"]), ("Owed", 11, []), ("Booked and on site", 31, ["3342", "3302", "1042"])]
        trs = "".join(f'<div class="grh"><span class="chev">{ico("down" if ids else "right")}</span><b>{g}</b><span class="qq">{cnt}</span><span style="flex:1"></span>{f"<a class=lk href=#>Show all {cnt}</a>" if ids else ""}</div>' + "".join(rowhtml[x] for x in ids) for g, cnt, ids in groups)
    head = "".join(f'<span{" style=text-align:right" if t == "Value" else ""}>{t}</span>' for t in ["Job", "Client and site", "Kind", "Where it's up to", "Next", "Who", "Value"])
    body = f'''<div class="ph">
  <div style="display:flex;align-items:center;gap:12px">{M(12, '<h1 class="t24">Jobs</h1>')}<span class="qq" style="margin-top:4px">142 open</span><span style="flex:1"></span>{M(33, f'<span class="fi" style="width:320px">{ico("search")}<span class="ph2">Search jobs, clients and sites</span></span>')}{M(24, '<span class="b quiet">Export</span>')}</div>
  <div style="display:flex;gap:8px;margin-top:16px;align-items:center">{viewrow}<span style="flex:1"></span>{selfield(f'<span><span class="qq">Who</span> {menus.get("who_label", "Anyone")}</span>', menus.get("who", ""))}{selfield('<span><span class="qq">Sort</span> Next first</span>', menus.get("sort", ""))}</div>
  <div class="th" style="grid-template-columns:{cols};gap:16px;margin-top:16px;position:relative">{head}<i class="cf" style="top:-6px;left:-28px;right:auto">14</i></div>
  {trs}
</div>'''
    side = sidebar("jobs")
    if views == "side":
        sub = "".join(f'<a class="sv{" on" if i == 0 else ""}" href="#">{n}<span class="r">{c}</span></a>' for i, (n, c) in enumerate(VIEWS))
        side = side.replace('<a class="sr on" href="#">', '<a class="sr on parent" href="#">', 1)
        k = side.index('</a>', side.index('class="sr on parent"')) + 4
        side = side[:k] + f'<div class="svs">{sub}</div>' + side[k:]
    return frame(side, header(tabs, 1, mk_tabs=10), body)


# ------------------------------------------------------------------ a job
def job(actions_menu="", sections="counts", tab="Overview", content=None, aside_top="", add_menu=""):
    tabs = [TAB_HOME, (ico("jobs"), "Jobs"), tab_job("Blue", "3342 Rifkin")]
    steps = [("Enquiry", "dn"), ("Quoted", "dn"), ("Accepted", "dn"), ("Booked", "dn"), ("On site", "on"), ("Done", ""), ("Invoiced", ""), ("Paid", "")]
    st = '<span class="sep"></span>'.join(f'<span class="{c}">{n}</span>' for n, c in steps)
    counts = {"Visits": "2", "Checklist": "8 of 14", "Photos": "24", "Documents": "3"} if sections == "counts" else {}
    stabs = "".join(f'<a class="{"on" if t == tab else ""}" href="#">{t}{f"<span class=c>{counts[t]}</span>" if t in counts else ""}</a>' for t in ["Overview", "Quote", "Visits", "Checklist", "Photos", "Documents", "Billing"])
    notes = [
        ("LI", "Lyle Irving", "10:02 am", "Study head mounted and levelled. Running the pipe through the robe now, 6 m to the outdoor."),
        ("CA", "Callum Ahn", "Yesterday 3:40 pm", f'Customer wants an isolator on the deck as well. {M(47, "<span class=nt>Isaac</span>")} can you price it?'),
    ]
    nt = ""
    for i, (a, n, t, x) in enumerate(notes):
        av = f'<span class="avt">{a}</span>'
        nt += f'<div class="gp" style="display:flex;gap:12px;padding:16px 0 4px">{av}<div style="min-width:0"><div class="l13"><b style="font-weight:600">{n}</b> <span class="qq">{t}</span></div><p class="r16" style="margin-top:2px">{x}</p></div></div>'
    var_card = f'''<div class="cd" style="padding:16px;display:flex;flex-direction:column;gap:10px">
  <div style="display:flex;align-items:baseline;gap:8px"><b class="t16">Variation: isolator on the deck</b></div>
  <p class="qq">$480 plus GST, drafted from Callum's note. Julian hasn't seen it yet.</p>
  <div style="display:flex;gap:8px;justify-content:flex-end"><span class="b sm sec">Edit</span><span class="b sm go">Send to Julian</span></div>
</div>'''
    docs = "".join(f'<a class="rw" href="#" style="padding:10px 0">{ico(i)}<span class="m">{n}</span>{s}</a>' for i, n, s in [("shield", "SWMS, split install", '<span class="st look">2 of 3 signed on</span>'), ("doc", "Quote, version 2", '<span class="st good">Accepted</span>'), ("cert", "Commissioning certificate", '<span class="qq">Not made yet</span>')])
    body = f'''<div class="ph">
  <div class="l13 qq" style="display:flex;gap:8px;align-items:center"><a class="lk" href="#" style="color:var(--q)">Jobs</a>{ico("right")}<b style="color:var(--ink);font-weight:600">3342</b></div>
  <div style="display:flex;align-items:flex-start;gap:12px;margin-top:8px">
    <div style="flex:1;min-width:0"><h1 class="t24">Rifkin, Julian</h1><p class="qq" style="margin-top:4px;display:flex;align-items:center;gap:8px">{dot("Blue")}Installation, Job 3342, 41 Victoria Rd, Bellevue Hill. <span class="st good">On site</span></p></div>
    <span class="b sec">Open in ServiceM8</span><span style="position:relative;display:inline-flex"><span class="b sec"{" style=border-color:var(--ink)" if add_menu else ""}>{ico("plus")}Add{ico("down")}</span>{add_menu}</span>{M(34, f'<span style="position:relative;display:inline-flex"><span class="b sec"{" style=border-color:var(--ink)" if actions_menu else ""}>Actions{ico("down")}</span>{actions_menu}</span>')}
  </div>
  <div class="steps" style="margin-top:16px">{st}</div>
  {M(31, f'<nav class="stb" style="margin-top:16px">{stabs}</nav>', "top:2px;left:622px;right:auto", True) if sections in ("under", "counts") else (f'<nav class="vws" style="margin-top:16px;display:flex">{stabs}</nav>' if sections == "soft" else '<div style="height:16px;border-bottom:1px solid var(--line)"></div>')}
</div>
<div style="display:flex;gap:40px;padding:20px 40px 0">{f'<nav class="vsec">{stabs}</nav>' if sections == "side" else ""}
  <section style="flex:1;min-width:0">
    <div class="box"><div class="r16 qq" style="min-height:40px">Write a note on this job</div>
      <div style="display:flex;align-items:center;gap:8px"><span class="ib">{ico("mic")}</span><label class="l13" style="display:inline-flex;align-items:center;gap:8px"><span class="tk on">{ico("check")}</span>Also in ServiceM8</label><span style="flex:1"></span><span class="b sm go">Save note</span></div></div>
    <div style="display:flex;align-items:baseline;gap:12px;margin:24px 0 0"><h2 class="t16">Notes</h2><span class="qq">23 on this job</span><span style="flex:1"></span><a class="lk l13" href="#">All notes</a></div>
    {nt}
  </section>
  <aside style="width:{320 if sections == "side" else 380}px;flex:none;display:flex;flex-direction:column;gap:20px">
    {aside_top}<div class="gp"><h2 class="t16" style="margin-bottom:6px">Where it's up to</h2><p>Day 1 of 1. Both heads in, outdoor on the slab, pipe through the robe.</p></div>
    {M(35, var_card, "top:-10px;right:-10px", True)}
    <div class="gp"><h2 class="t16" style="margin-bottom:2px">Documents on this job</h2>{docs}</div>
  </aside>
</div>'''
    if content is not None:
        body = body[:body.index('<div style="display:flex;gap:40px;padding:20px 40px 0">')] + content
    return frame(sidebar("jobs"), header(tabs, 2), body)


# ------------------------------------------------------------------ Schedule
def schedule():
    tabs = [TAB_HOME, (ico("cal"), "Schedule"), (ico("repeat"), "Maintenance, October")]
    people = [
        ("Isaac Smith", "IS", [(7.5, 8.5, "Green", "Kingsford", "2380, Service"), (14.75, 16, "Green", "Randwick Dental", "3271, Service")]),
        ("Lyle Irving", "LI", [(9, 11.5, "Blue", "Bellevue Hill", "3342, Installation")]),
        ("Callum Ahn", "CA", [(9, 11.5, "Blue", "Bellevue Hill", "3342, Installation"), (12.5, 15.5, "Purple", "Heuvel, Chatswood", "3302, Project")]),
        ("Dan Walsh", "DW", [(12.75, 13.75, "Orange", "Riverview", "3361, Quote"), (14.25, 16.25, "Yellow", "Ardex Logistics", "2601, Maintenance")]),
        ("Kai Lee", "KL", []),
    ]
    lanes = ""
    first = True
    for name, ini, blocks in people:
        bl = ""
        for s, e, c, t, sub in blocks:
            ink = "#fff" if c == "Blue" else "var(--ink)"
            b = f'<div class="blk" style="left:{(s - 7) / 10 * 100}%;width:{(e - s) / 10 * 100}%;background:{COL[c]};color:{ink}"><b>{t}</b><span>{sub}</span></div>'
            if first and c == "Blue":
                b = b.replace('<b>', '<i class="cf" style="top:-2px;right:-2px">19</i><b>', 1)
                first = False
            bl += b
        if not blocks:
            bl = '<div style="position:absolute;inset:8px 0;display:flex;align-items:center;padding:0 12px" class="qq">On leave, back Thursday</div>'
        lanes += f'<div class="lane"><div style="display:flex;align-items:center;gap:10px;font-weight:600"><span class="avt s">{ini}</span>{name}</div><div style="position:relative">{bl}</div></div>'
    hours = "".join(f'<span class="c12" style="position:absolute;left:{(h - 7) / 10 * 100}%;transform:translateX(-50%)">{h if h <= 12 else h - 12}{"am" if h < 12 else "pm"}</span>' for h in range(8, 17))
    nd = "".join(f'<div class="cd" style="padding:12px 14px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start"><span style="margin-top:6px">{dot(c)}</span><div><div style="font-weight:600">{t}</div><div class="l13 {sc}">{s}</div></div></div>' for c, t, s, sc in [("Blue", "Northgate Realty, 3323", "Installation, about 2 days", "qq"), ("Yellow", "Ardex Logistics, service", "Due today", "st look"), ("Purple", "Heuvel, visit 3: fit-off", "Around 20 October", "qq")])
    pager = f'<span class="ib bare">{ico("left")}</span><span style="font-weight:600">Tuesday 13 October</span><span class="ib bare">{ico("right")}</span>'
    body = f'''<div class="ph" style="display:flex;align-items:center;gap:12px">
  <h1 class="t24">Schedule</h1>{M(30, '<span class="sg" style="margin-left:8px"><span class="on">Day</span><span>Week</span><span>Month</span></span>')}
  <span class="fi sel2" style="width:200px">Show: Everything{ico("down")}</span>
  <span style="flex:1"></span>{M(24, '<span class="b sm quiet">Today</span>')}{M(27, f'<span style="display:inline-flex;align-items:center;gap:4px">{pager}</span>')}
</div>
<div style="display:flex;gap:0;padding-top:16px;height:100%">
  <div style="flex:1;min-width:0;padding:0 24px 0 40px;position:relative">
    <div class="lane" style="height:28px"><div></div><div style="position:relative">{hours}</div></div>
    {lanes}
    <div style="position:absolute;top:28px;height:{68 * 5}px;left:calc(40px + 150px + (100% - 64px - 150px) * .305);width:2px;background:var(--ink)"></div>
  </div>
  <aside style="width:300px;flex:none;border-left:1px solid var(--line);padding:0 20px">
    <h2 class="t16">Not on a day yet</h2><p class="l13 qq" style="margin:2px 0 12px">Drag one onto a lane</p>{nd}
  </aside>
</div>'''
    return frame(sidebar("cal"), header(tabs, 1), body)


# ------------------------------------------------------------------ Settings
def settings():
    groups = [("Yours", ["Sign-in and security", "Emails and alerts"]), ("Company", ["Business", "Licences and insurance", "ServiceM8 and Xero", "Quoting and prices", "Pay and holidays", "Reports"])]
    nav = ""
    for g, items in groups:
        nav += f'<div class="c12" style="padding:16px 12px 4px">{g}</div>'
        nav += "".join(f'<a class="mi{" on" if i == "Pay and holidays" else ""}" href="#">{i}</a>' for i in items)

    def row(t, d, ctl):
        return f'<div class="rw" style="gap:24px;padding:16px 0"><div class="m"><div class="t">{t}</div><div class="s">{d}</div></div>{ctl}</div>'
    down = ico("down")
    rows = "".join([
        row("Pay cycle", "When timesheets close", M(34, f'<span class="fi sel2" style="width:260px">Weekly, Monday to Sunday{down}</span>')),
        f'''<div class="rw" style="gap:24px;padding:16px 0;align-items:flex-start"><div class="m"><div class="t">Normal day</div><div class="s">Each person's own week is on their Team card</div></div>
          <div style="display:flex;gap:12px;width:420px">
            <label class="fl" style="flex:1"><span class="lb">Start</span><span class="fi">7:00 am</span></label>
            <label class="fl" style="flex:1"><span class="lb">Finish</span>{M(33, '<span class="fi err" style="width:132px">6:00 am</span>')}{M(42, '<span class="fe">Finish must be after start</span>', "top:-2px;right:-28px")}</label>
            <label class="fl" style="flex:1"><span class="lb">Break</span><span class="fi">30 min</span></label>
          </div></div>''',
        row("Overtime", "Time and a half, then double", f'<span class="fi sel2" style="width:260px">After 8 hours, then 10{down}</span>'),
        row("Send timesheets for people", "Sunday at 6:00 pm, then lock them", M(32, '<span class="swt on"></span>')),
        row("Ask for a medical certificate", "Personal leave of 2 days or more", '<span class="swt on"></span>'),
        row("Send approved hours to Xero", "Into the next pay run", '<span class="swt"></span>'),
        row("Public holidays", "New South Wales; next is Christmas Day", '<span class="b sm sec">Show all</span>'),
    ])
    body = f'''<div style="display:flex;height:100%">
  <nav style="width:240px;flex:none;padding:8px 8px 0 28px">{nav}</nav>
  <div style="flex:1;min-width:0;padding:8px 40px 0 32px"><div style="max-width:760px">
    <div style="display:flex;align-items:baseline;gap:12px"><h1 class="t24">Pay and holidays</h1><span class="qq">Changes save as you go</span></div>
    <div style="margin-top:12px">{rows}</div>
  </div></div>
</div>'''
    you = sidebar("").replace('<a class="you"', '<a class="you" style="background:rgba(255,255,255,.12)"', 1)
    return frame(you, header(), body)


# ------------------------------------------------------------------ Analytics
def analytics():
    kinds = [("Split", "Blue", 46, "$214,000"), ("Multi", "Orange", 18, "$96,400"), ("Ducted", "Green", 9, "$121,500"), ("VRF", "Purple", 3, "$188,000"), ("Service", "Pink", 64, "$27,300"), ("Maintenance", "Yellow", 41, "$38,900"), ("Ventilation", "Grey", 5, "$11,200")]
    mx = 64
    bars = ""
    for i, (n, c, k, v) in enumerate(kinds):
        bar = f'<span style="height:20px;border-radius:6px;background:{COL[c]};width:{k / mx * 100}%;display:block"></span>'
        bars += f'<div style="display:grid;grid-template-columns:120px minmax(0,1fr) 60px 100px;gap:12px;align-items:center;padding:6px 0"><span style="display:inline-flex;align-items:center;gap:8px;font-weight:500">{dot(c)}{n}</span><span>{bar}</span><span class="nm" style="text-align:right;font-weight:600">{k}</span><span class="nm qq" style="text-align:right">{v}</span></div>'
    bars = M(20, f'<div>{bars}</div>', "top:-16px;right:-16px", True)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"]
    this = [28, 34, 41, 30, 26, 22, 31, 38, 44, 18]
    last = [24, 27, 33, 35, 21, 25, 24, 30, 36, 29]
    cols = "".join(f'<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1"><div style="display:flex;align-items:flex-end;gap:3px;height:180px"><span style="width:14px;height:{l / 46 * 100}%;background:var(--grey);border-radius:4px 4px 0 0"></span><span style="width:14px;height:{t / 46 * 100}%;background:var(--blue);border-radius:4px 4px 0 0"></span></div><span class="c12">{m}</span></div>' for m, t, l in zip(months, this, last))
    body = f'''<div class="ph">
  <div style="display:flex;align-items:center;gap:12px"><h1 class="t24">Analytics</h1><span class="sg" style="margin-left:8px"><span class="on">This year</span><span>Last 12 months</span></span></div>
  <div style="display:flex;gap:48px;margin-top:24px;align-items:flex-end">
    <div>{M(14, '<span class="big">$697,300</span>', "top:-6px;right:-22px")}<div class="qq">won this year, from 186 jobs</div></div>
    <div><span class="t20 nm">38%</span><div class="qq">of quotes won</div></div>
    <div><span class="t20 nm">6.2 days</span><div class="qq">from brief to quote</div></div>
    <div><span class="t20 nm st look">11</span><div class="qq">owed past 30 days</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:32px">
    <section><div style="display:flex;align-items:baseline;gap:12px;margin-bottom:12px"><h2 class="t16">Won, by kind of job</h2><span class="qq">jobs and value</span></div>{bars}</section>
    <section><div style="display:flex;align-items:baseline;gap:12px;margin-bottom:12px"><h2 class="t16">Won, by month</h2><span style="flex:1"></span><span class="l13" style="display:inline-flex;gap:16px"><span style="display:inline-flex;align-items:center;gap:6px">{dot("Blue")}This year</span><span style="display:inline-flex;align-items:center;gap:6px">{dot("Grey")}Last year</span></span></div>
      <div style="display:flex;gap:6px;border-bottom:1px solid var(--line)">{cols}</div></section>
  </div>
</div>'''
    return frame(sidebar(""), header(), body)


# ------------------------------------------------------------------ Team, timesheets
def team():
    stabs = "".join(f'<a class="{"on" if t == "Timesheets" else ""}" href="#">{t}{f"<span class=c>{c}</span>" if c else ""}</a>' for t, c in [("People", ""), ("Notices", "2"), ("Timesheets", "4"), ("Leave", "1"), ("Expenses", "2"), ("Vehicles", "")])
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    def wk(vals):
        out = ""
        for d, (c, h) in zip(days, vals):
            out += f'<span style="display:flex;flex-direction:column;align-items:center;gap:4px;width:52px"><span class="c12">{d}</span><span style="display:inline-flex;align-items:center;gap:6px" class="nm l13">{(sym(c) if c in SYM else dot(c)) if c else "<span class=dt style=background:transparent;box-shadow:inset_0_0_0_1.5px_var(--edge)></span>"}{h}</span></span>'
        return f'<span style="display:inline-flex">{out}</span>'
    people = [
        (True, "LI", "Lyle Irving", [("Purple", "8"), ("Green", "8"), ("Green", "8.5"), ("Orange", "10"), ("Green", "8"), ("Orange", "4"), (None, "")], "38.5 h", '<span class="st look">Thursday 10 hours; Saturday added</span>', ""),
        (True, "DW", "Dan Walsh", [("Purple", "8"), ("Green", "8"), ("Green", "8"), ("Green", "8"), ("Pink", "6"), (None, ""), (None, "")], "38 h", '<span class="st look">Friday short 2 hours</span>', ""),
        (True, "CA", "Callum Ahn", [("Purple", "8"), ("Green", "8"), ("Green", "8"), ("Green", "8"), ("Green", "8"), (None, ""), (None, "")], "40 h", '<span class="qq">His normal week</span>', ""),
        (False, "KL", "Kai Lee", [("Purple", "8"), ("Green", "8"), ("Green", "8"), ("Leave", "7.6"), ("Sick", "7.6"), (None, ""), (None, "")], "24 h", '<span class="st look">Not sent</span>', '<span class="b sm sec">Remind</span>'),
    ]
    rows = ""
    for i, (tk, a, n, vals, tot, note, btn) in enumerate(people):
        tick = f'<span class="tk{" on" if tk else ""}">{ico("check") if tk else ""}</span>'
        w = wk(vals)
        if i == 0:
            tick = M(32, tick, "top:-12px;right:-12px")
            w = M(21, w)
        rows += f'<div class="rw" style="gap:16px">{tick}<span class="avt">{a}</span><div style="width:220px"><div class="t">{n}</div><div class="s">{note}</div></div>{w}<span style="flex:1"></span><span class="nm" style="font-weight:600;width:60px;text-align:right">{tot}</span>{btn or "<span style=width:84px></span>"}</div>'
    key = "".join(f'<span style="display:inline-flex;align-items:center;gap:6px">{sym(c) if c in SYM else dot(c)}{t}</span>' for c, t in [("Green", "Normal day"), ("Orange", "Over hours"), ("Pink", "Under hours"), ("Purple", "Public holiday"), ("Leave", "Leave"), ("Sick", "Sick")])
    body = f'''<div class="ph">
  <h1 class="t24">Team</h1>
  <nav class="stb" style="margin-top:12px">{stabs}</nav>
  <div style="display:flex;align-items:center;gap:12px;margin-top:20px"><p class="r16">Last week, 5 to 11 October. 4 to approve, 150.5 hours.</p><span style="flex:1"></span><span class="b sec">Send back</span><span class="b go">Approve 3</span></div>
  <div style="margin-top:12px">{rows}</div>
  <div class="l13" style="display:flex;align-items:center;gap:20px;margin-top:16px;color:var(--q)">{key}</div>
</div>'''
    return frame(sidebar("team"), header(), body)


# ------------------------------------------------------------------ overlays
def new_menu_dark(ctx=None, doc_open=False, marks=False):
    items = [("jobs", "Job"), ("dollar", "Quote"), ("task", "Task"), ("cal", "Event"), ("receipt", "Expense"), ("sun", "Leave")]
    rows = "".join(f'<a class="mi" href="#">{ico(i)}{t}</a>' for i, t in items)
    c = f'<div class="ctx">{dot("Blue")}<span class="fade">{ctx}</span><span class="x">{ico("x")}</span></div><div class="mdv"></div>' if ctx else ""
    chev = f'<span class="r">{ico("right")}</span>'
    if doc_open:
        sub = "".join(f'<a class="mi" href="#">{ico(i)}{t}</a>' for i, t in [("shield", "SWMS"), ("cert", "Certificate"), ("letter", "Letter")])
        doc = f'<div style="position:relative"><a class="mi on" href="#">{ico("doc")}Document{chev}</a><div class="sub">{sub}{"<i class=cf style=top:-10px;right:-10px>36</i>" if marks else ""}</div></div>'
    else:
        doc = f'<a class="mi" href="#">{ico("doc")}Document{chev}</a>'
    mk = '<i class="cf" style="top:2px;right:-10px">44</i>' if marks else ""
    return f'''<div class="nmd">{mk}<div class="nh"><span class="pl">{ico("plus")}</span>New</div><div class="mdv"></div>{c}{rows}<div class="mdv"></div>{doc}<a class="mi" href="#">{ico("dots")}More{chev}</a></div>'''


def with_new_menu_old(page_html, ctx=None, doc_open=False, marks=False):
    """The New button's highlight runs out of the panel into the dark menu."""
    a = '<a class="sr" href="#"><span class="pl">'
    assert a in page_html
    page_html = page_html.replace(a, '<a class="sr on" href="#" style="border-radius:10px 0 0 10px;margin-right:-8px"><span class="pl">', 1)
    items = [("jobs", "Job"), ("dollar", "Quote"), ("task", "Task"), ("cal", "Event"), ("receipt", "Expense"), ("sun", "Leave")]
    rows = "".join(f'<a class="mi" href="#">{ico(i)}{t}</a>' for i, t in items)
    if ctx:
        band = f'<div class="band">{dot("Blue")}<span class="fade">{ctx}</span><span class="x">{ico("x")}</span></div>'
    else:
        band = '<div class="band"><span class="fade" style="color:rgba(255,255,255,.5);font-weight:500">For a job or client</span></div>'
    chev = f'<span class="r">{ico("right")}</span>'
    if doc_open:
        sub = "".join(f'<a class="mi" href="#">{ico(i)}{t}</a>' for i, t in [("shield", "SWMS"), ("cert", "Certificate"), ("letter", "Letter")])
        doc = f'<div style="position:relative"><a class="mi on" href="#">{ico("doc")}Document{chev}</a><div class="sub">{sub}{"<i class=cf style=top:-10px;right:-10px>36</i>" if marks else ""}</div></div>'
    else:
        doc = f'<a class="mi" href="#">{ico("doc")}Document{chev}</a>'
    mk = '<i class="cf" style="top:-10px;right:-10px">44</i>' if marks else ""
    menu = f'<div class="nmf">{mk}{band}<div class="in"><div class="mdv"></div>{rows}<div class="mdv"></div>{doc}<a class="mi" href="#">{ico("dots")}More{chev}</a></div></div>'
    return page_html.replace("</main>", "</main>" + menu, 1)


NEW_ITEMS = [("jobs", "Job"), ("dollar", "Quote"), ("task", "Task")]


def with_new_menu(page_html, layout="list", marks=False):
    """New, the same three everywhere. The panel reaches out from the button,
    square where it leaves the panel; New's highlight runs on into the menu.
    `list`: the three down a short dark menu, the first in the highlight
    (where the keyboard starts). `row`: the three across, in the highlight
    itself, so New's row simply carries on."""
    a = '<a class="sr" href="#"><span class="pl">'
    assert a in page_html
    page_html = page_html.replace(a, '<a class="sr on" href="#" style="border-radius:10px 0 0 10px;margin-right:-8px"><span class="pl">', 1)
    mk = '<i class="cf" style="top:-10px;right:-10px">44</i>' if marks else ""
    if layout == "row":
        items = "".join(f'<a class="nrw" href="#">{ico(i)}{t}</a>' for i, t in NEW_ITEMS)
        menu = f'<div class="nmf" style="width:auto;padding:6px 6px 6px 0">{mk}<div class="band" style="gap:4px;padding:0 4px 0 6px;font-weight:500">{items}</div></div>'
    else:
        first, rest = NEW_ITEMS[0], NEW_ITEMS[1:]
        rows = "".join(f'<a class="mi" href="#">{ico(i)}{t}</a>' for i, t in rest)
        menu = f'<div class="nmf" style="width:220px">{mk}<div class="band" style="gap:12px;font-weight:500">{ico(first[0])}{first[1]}</div><div class="in">{rows}</div></div>'
    return page_html.replace("</main>", "</main>" + menu, 1)


def new_menu():
    return with_new_menu(home().replace('<i class="cf"', '<i class="cf" hidden'), marks=True)


def search():
    rows = [
        ("Jobs", [(dot("Orange"), "3361 Okafor, Riverview", "Quote, brief saved today"), (dot("Blue"), "3355 Riverview Medical", "Installation, done 2 October")]),
        ("Documents", [(ico("doc"), "Brief, 3361 Okafor", "From your conversation, 8:40 am")]),
        ("Conversations", [(ico("chat"), "Riverview brief", "Today 8:40 am")]),
    ]
    body = ""
    for g, items in rows:
        body += f'<div class="c12" style="padding:12px 12px 4px">{g}</div>'
        for i, (lead, t, s) in enumerate(items):
            body += f'<a class="mi{" on" if (g == "Jobs" and i == 0) else ""}" href="#" style="height:auto;padding:8px 12px">{lead}<span style="display:flex;flex-direction:column"><span style="font-weight:600">{t}</span><span class="l13 qq">{s}</span></span></a>'
    ask = f'<div class="mdv"></div><a class="mi" href="#" style="height:44px">{tiff_mono(20)}<span>Ask Tiff about <b style="font-weight:600">riverview</b></span><span class="r l13">Enter</span></a>'
    pal = f'''<div class="scr" style="z-index:4"></div><div class="ov" style="position:absolute;left:calc(256px + (100% - 256px) / 2 - 320px);top:110px;width:640px;padding:8px;z-index:5">
  <div class="fi" style="height:44px;border-color:transparent;font-size:16px">{ico("search")}<span>riverview</span></div><div class="mdv"></div>
  {body}{M(43, ask, "top:6px;right:-12px", True)}
</div>'''
    return job().replace('<i class="cf"', '<i class="cf" hidden').replace("</main>", "</main>" + pal, 1)


def dialog():
    dlg = f'''<div class="scr" style="z-index:4"></div><i class="cf" style="top:290px;left:1058px;right:auto;z-index:31">36</i>
<div class="ov" style="position:absolute;left:calc(256px + (100% - 256px) / 2 - 220px);top:300px;width:440px;padding:24px;z-index:5;display:flex;flex-direction:column;gap:12px">
  <h2 class="t20">Delete Callum's note?</h2>
  <p class="qq">From yesterday, 3:40 pm. It comes out of ServiceM8 too. The variation it started stays.</p>
  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px"><span class="b sec">Cancel</span>{M(25, '<span class="b delf">Delete note</span>')}</div>
</div>
<div class="toast" style="z-index:6">Note saved<a class="lk" href="#">Undo</a><i class="cf">37</i></div>'''
    return job().replace('<i class="cf"', '<i class="cf" hidden').replace("</main>", "</main>" + dlg, 1)


def states():
    sk = "".join('<div class="rw"><span class="sk" style="width:18px;height:18px;border-radius:6px"></span><div class="m" style="display:flex;flex-direction:column;gap:6px"><span class="sk" style="width:60%"></span><span class="sk" style="width:35%;height:10px"></span></div><span class="sk" style="width:72px"></span></div>' for _ in range(4))
    body = f'''<div class="ph"><h1 class="t24">Three states every screen has</h1><p class="qq" style="margin-top:4px">Shown on a job's Documents, the Jobs list and the Schedule.</p></div>
<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;padding:24px 40px">
  {M(40, f'<div class="cd" style="padding:24px;display:flex;flex-direction:column;gap:12px;align-items:flex-start;min-height:280px"><span class="c12">Nothing there yet</span><h2 class="t16">No documents on this job</h2><p class="qq">A SWMS is usually first on an install.</p><span class="b go">Make the SWMS</span></div>', None, True)}
  {M(41, f'<div class="cd" style="padding:24px;min-height:280px"><span class="c12">Loading, after a second</span><h2 class="t16" style="margin:4px 0 8px">Jobs</h2>{sk}</div>', None, True)}
  {M(42, f'<div class="cd" style="padding:24px;display:flex;flex-direction:column;gap:12px;align-items:flex-start;min-height:280px"><span class="c12">Something went wrong</span><p style="display:flex;gap:10px;align-items:flex-start"><span style="margin-top:6px">{dot("Red")}</span><span><b class="st wrong">ServiceM8 didn&#39;t answer.</b> The Schedule is from 9:41 am, so a booking made since may be missing.</span></p><span class="b sec">Try again</span></div>', None, True)}
</div>'''
    return frame(sidebar("jobs"), header(), body)


# ------------------------------------------------------------------ phone
def phone():
    rows = "".join(f'<div class="rw" style="gap:10px"><span class="l13 qq nm" style="width:72px">{tm}</span>{dot(c)}<div class="m"><div class="t">{t}</div><div class="s">{s}</div></div>{r}</div>' for tm, c, t, s, r in [("7:30", "Green", "Kingsford Bakery", "Service, you", '<span class="st good l13">Done</span>'), ("9:00", "Blue", "Bellevue Hill", "Installation, Lyle", '<span class="st good l13">On now</span>'), ("12:45", "Orange", "Riverview", "Quote, Dan", ""), ("2:45", "Green", "Randwick Dental", "Service, you", "")])
    return f'''<div class="v3 on-ink" style="width:390px;height:844px;flex-direction:column">{MARK_DEFS}{MONO_DEFS}
  <div style="height:56px;flex:none;display:flex;align-items:center;gap:8px;padding:0 12px 0 8px;color:#fff"><span class="ib bare lg" style="background:transparent;color:#fff">{ico("menu")}</span>{mark_svg()}<b style="font-size:16px;font-weight:700">HeyTiff</b><span style="flex:1"></span><span class="b" style="height:40px;background:#fff;color:var(--ink)">{ico("plus")}New</span></div>
  {M(48, f"""<div style="flex:1;min-height:0;height:788px;background:#fff;border-radius:40px 0 0 0;display:flex;flex-direction:column;overflow:hidden">
    <div style="height:48px;flex:none;display:flex;align-items:flex-end;padding:0 16px 4px 24px;font-weight:500">Tuesday 13 October<span class="qq" style="margin-left:8px">10:05 am</span></div>
    <div style="flex:1;min-height:0;padding:0 16px;overflow:hidden"><div style="display:flex;align-items:baseline;gap:12px;margin:12px 0 4px"><h2 class="t16">Today</h2><span style="flex:1"></span><a class="lk l13" href="#">Schedule</a></div>{rows}</div>
    <div class="box" style="margin:8px 12px 12px;border-radius:20px;padding:12px">
      <div style="display:flex;align-items:center;gap:10px;min-height:32px">{tiff_mono(26)}<span class="r16 qq">What's happening on site?</span></div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px"><span class="b lg sec" style="padding:0 14px">{ico("camera")}Photo</span><span class="ib lg">{ico("mic")}</span><span style="flex:1"></span>{M(28, '<span class="b lg go">Send</span>')}</div>
    </div>
  </div>""", "top:12px;right:16px;left:auto", True)}
</div>'''


# ------------------------------------------------------------------ the rules
RULES = [
    ("The frame", [
        (1, "The page and its two curves", "Ink sidebar; a plain white page. The page curls into the ink at its top left, and the ink curls back into the page at its foot: 40 each, square everywhere else.", True),
        (2, "The header", "The date and the time together on the left of every page; open tabs on the right.", True),
        (3, "New", "At the top of the sidebar, a white disc and the word. Job, Quote and Task are made here (rule 44); what belongs to a record comes from its Add (rule 54).", True),
        (4, "Search", "Under New, with ⌘K beside it. Finds any record; its last row asks Tiff.", True),
        (5, "The eight places", "Home, Conversations, Jobs, Schedule, Documents, Library, Design, Team. The one you're on is white at 12% with its label in bold.", True),
        (6, "Pinned and Recents", "Stay in the sidebar under the places; a job shows its colour dot.", True),
        (7, "Your name", "At the bottom: your card, timesheet, leave, expense claims, Reports and Settings.", True),
        (8, "Tiff's mark", "Black and white at rest: black on the page, white on the ink, turning slowly. While Tiff listens or works, it speeds up and its rings run through the eight. Colour on the mark means Tiff is busy.", True),
        (9, "The wordmark", "HeyTiff in one colour. The teal leaves the app.", True),
    ]),
    ("Tabs, desktop only", [
        (10, "Open tabs", "A thin outline round each; the one you're on outlined in ink. A cross on each. Tabs replace today's dock of set-aside cards.", True),
        (11, "New tab", "Shows when one page is open; opens Search in a new tab. Two tabs never show the same page.", True),
    ]),
    ("Type", [
        (12, "Screen titles", "24, semibold (600, down from 700).", True),
        (13, "Reading and writing", "16 for anything you read or type: notes, the box, Tiff's answers.", True),
        (14, "Everything else", "Body 14, labels 13, captions 12 (the floor). Figures in columns line up. One big figure (32) per screen at most.", True),
    ]),
    ("Colour", [
        (15, "The eight", "Red, orange, yellow, green, blue, purple, pink and grey, each with a bright value and a darker one for words. Plus ink, white and one quiet grey: 19 values in all.", True),
        (16, "Red only means wrong", "Overdue, failed, unsuccessful. A job ServiceM8 marks red is unsuccessful, so it keeps its red. No chart or pipe is red.", True),
        (17, "State is a word", "Good in green, needs a look in orange, wrong or late in red: a word in its colour, a dot where a list wants one. For your information is a grey word and a grey dot, so blue only ever means press. Never a pill or a fill.", True),
        (18, "A job's colour", "Its ServiceM8 colour snapped to the nearest of the eight, as a dot beside its name everywhere. No washes, no edge lines.", True),
        (19, "Schedule blocks", "Solid blocks in the job's colour, black words, white on blue.", True),
        (20, "Charts", "The kinds of job in the eight, in a fixed order; ventilation grey. A coloured mark always has its figure or name beside it.", True),
        (21, "Timesheet days", "A dot and the hours for a day worked. A day away is a small white card with a symbol: a plaster for sick, a sun for leave. The key underneath. No bars or tints.", True),
    ]),
    ("Buttons", [
        (22, "The main button", "Blue with white words: the one you most likely press, one per area. No black buttons.", True),
        (23, "The second button", "White with a thin outline. Every other action that needs a box.", True),
        (24, "The quiet button", "No edge until you point at it. Toolbars and rows.", True),
        (25, "Delete", "A red word on the second button; a red block only in the dialog that asks you to be sure.", True),
        (26, "Links", "Ink, underlined. Going somewhere, not doing something.", True),
        (27, "Icon-only", "Close, clear, the microphone, and the ‹ › of a date. Everything else has its word.", True),
        (28, "Three sizes", "32 in rows and lists, 36 in forms and dialogs, 44 on a phone. A field and the button beside it match.", True),
    ]),
    ("Choices and fields", [
        (29, "Views of a list", "Soft tabs under the title: words with their counts in grey, the one you're on in a light fill. No outlines.", True),
        (30, "One of a few", "Day, Week, Month in a thin tray; the chosen one filled light.", True),
        (31, "Section tabs", "Underlined, each with what's in it in grey: Visits 2, Photos 24. A job has seven: Overview, Quote, Visits, Checklist, Photos, Documents, Billing.", True),
        (32, "Ticks and switches", "Blue when on. A switch saves itself.", True),
        (33, "Fields", "36 tall, a 6 corner, the label above. A wrong field gets a red edge and says why underneath.", True),
        (34, "Menus to choose from", "A field with a chevron; opens a menu. A time opens a wheel: the hour, minutes in fives, am or pm. Nothing types a clock time.", True),
    ]),
    ("Surfaces", [
        (35, "Card or group", "A card (outline, 16 corner) is something you act on; everything else is a group under a thin line.", True),
        (36, "Menus and dialogs", "White, 16 corner, the one shadow. A dialog darkens the page behind it.", True),
        (37, "Toasts", "Ink, bottom left, a few words and Undo.", True),
        (38, "People", "Initials on a light grey disc.", True),
    ]),
    ("Patterns", [
        (39, "A row", "Time or tick, dot, name in bold, a line under it in grey, then a state word or one button on the right.", True),
        (40, "Nothing there yet", "Says what's missing and leads with the action.", True),
        (41, "Loading", "Nothing for half a second, then a skeleton shaped like what's coming.", True),
        (42, "When something goes wrong", "A red dot and word, what it means for you, and what to do.", True),
        (43, "Search", "Results by kind; the last row asks Tiff, with Enter.", True),
        (44, "The New menu", "Job, Quote, Task: the same three on every page, and it never fills anything in. The panel reaches out from the New button, dark, square where it leaves the panel.", True),
    ]),
    ("Motion, shape and the rest", [
        (45, "Three speeds", "120 ms for pointing, 200 for something moving, and a new 280 for a panel sliding across.", True),
        (46, "Corners", "6 fields, 10 buttons and tabs, 16 cards and dialogs, 40 the page's two curves, round for discs.", True),
        (47, "Pills", "Only for a person's name in a note. Never for a state.", True),
        (48, "On a phone", "The ink is a bar across the top and the page curls into it at its top left (40), square elsewhere. The menu is the sidebar itself, curling at its foot. Controls 44; the box at the bottom.", True),
        (49, "Words", "Sentence case, a verb and a noun on every button, no exclamation marks, no 'successfully', waits that say what they're doing.", True),
        (50, "Text that doesn't fit", "Fades out at its end, as Claude does. Never cut with a '…'.", True),
    ]),
    ("Making and doing", [
        (51, "The form", "Opens over the page you're on. The record it's for is a field, filled in, that you can change or clear. Saving keeps you where you were, with a toast and Undo. A document opens in its own tab.", True),
        (52, "Other doors", "A section's own button, like Book a visit, opens the same form with the record filled in. Tiff reads the same page.", True),
        (53, "Actions", "Only what's done to the record itself: its stage, pin, copy the link, print, then what ends it in red. Making is Add's job.", True),
        (54, "Add, on a record", "Makes what belongs to that record. On a job: Visit, Task, Quote (Variation once accepted), Cost, SWMS, Certificate. Opens white, like every menu from the page.", True),
    ]),
]

KEEP = [("Spacing", "2, 4, 8, 12, 16, 24, 32, 48"), ("Layers", "Six, named: base, raised, sticky, overlay, modal, toast"), ("One shadow", "Only on things that float"),
        ("Focus", "A 2px ink ring with white between, on every ground"), ("Flat", "No gradients, glass, glow or texture"), ("No eyebrows", "No capitals or tracked labels; a title stands alone"),
        ("One font", "Plus Jakarta Sans, four weights"), ("Counted", "Every numbered rule gets a counter in the design test, held from day one"), ("One home", "Each rule is written once, in one short file; the history moves to a log")]


def rules():
    sec = ""
    for title, items in RULES:
        rows = "".join(f'<div class="ri"><span class="n">{n}</span><b>{t}</b><p>{d}</p><span class="{"yes" if done else "ask"}">{"Decided" if done else "Your call"}</span></div>' for n, t, d, done in items)
        sec += f"<h2>{title}</h2>{rows}"
    keep = "".join(f"<div><b>{a}</b><span>{b}</span></div>" for a, b in KEEP)
    asks = sum(1 for _, items in RULES for *_x, d in items if not d)
    return f'''<div class="rl3">
<h1>The new rules</h1>
<p class="lede">Fifty-four parts, each numbered. The same numbers sit in teal on the screens beside this board, on the part they describe. {f'{asks} say "Your call": a yes, a no or a change from you settles each. The rest you\'ve already decided.' if asks else "All fifty-four are decided."}</p>
{sec}
<h2>Kept from today, unchanged</h2>
<div class="keep">{keep}</div>
</div>'''


def build(out):
    out["V3-rules.dc.html"] = page("The new rules", 1440, 4027, CSS, rules())
    out["V3-home.dc.html"] = page("Home, to the new rules", 1440, 900, CSS, home())
    out["V3-jobs.dc.html"] = page("Jobs, to the new rules", 1440, 900, CSS, jobs())
    out["V3-job.dc.html"] = page("A job, to the new rules", 1440, 900, CSS, job())
    out["V3-schedule.dc.html"] = page("Schedule, to the new rules", 1440, 900, CSS, schedule())
    out["V3-settings.dc.html"] = page("Settings, to the new rules", 1440, 900, CSS, settings())
    out["V3-analytics.dc.html"] = page("Analytics, to the new rules", 1440, 900, CSS, analytics())
    out["V3-team.dc.html"] = page("Team timesheets, to the new rules", 1440, 900, CSS, team())
    out["V3-new.dc.html"] = page("The New menu, to the new rules", 1440, 900, CSS, new_menu())
    out["V3-search.dc.html"] = page("Search, to the new rules", 1440, 900, CSS, search())
    out["V3-dialog.dc.html"] = page("A dialog and a toast, to the new rules", 1440, 900, CSS, dialog())
    out["V3-states.dc.html"] = page("Empty, loading and wrong, to the new rules", 1440, 900, CSS, states())
    out["V3-phone.dc.html"] = page("Home on a phone, to the new rules", 390, 844, CSS, phone())
