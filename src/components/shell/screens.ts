/* v3 screen markup, ported verbatim from the design. Each builder returns an
   HTML string (the screens are static placeholders — no per-element React needed).
   Pages render these via dangerouslySetInnerHTML inside the shell's .page wrapper. */

import { iconSvg as I } from "./icon";

/* ---------------- DASHBOARD (home) — greeting hero ---------------- */
export function homeHtml(opts: { greeting: string; firstName: string; date: string }) {
  return (
    '<div class="wrap"><div class="stg">' +
    '<div class="hero"><div class="mesh"><i class="m1"></i><i class="m2"></i><i class="m3"></i></div>' +
    '<div class="hrow"><div class="hlead">' +
    '<div class="pill">' +
    I("activity", 12) +
    opts.date +
    "</div>" +
    `<h1>${opts.greeting},<br><span>${opts.firstName}.</span></h1>` +
    '<p class="lede">Welcome back. Your workspace is ready.</p>' +
    "</div></div></div>" +
    "</div></div>"
  );
}

/* small inline empty-state hint (no extra CSS needed) */
function hint(text: string) {
  return (
    '<div style="padding:22px;text-align:center;color:#9ca3af;font-size:13px;font-weight:600;' +
    'border:1.5px dashed #e6e8ee;border-radius:16px;background:linear-gradient(180deg,#fafbfc,#fff)">' +
    text +
    "</div>"
  );
}

/* ---------------- TOOLBOX — 4 category cards, no tools yet ---------------- */
export function toolboxHtml() {
  const cats: [string, string, string, string][] = [
    ["Calculators", "calc", "#00E5C0", "Precise field calculations"],
    ["Troubleshooting", "alert", "#FF3366", "Diagnose & resolve"],
    ["Design Tools", "layers", "#2E68FF", "System design & layout"],
    ["Reference Library", "library", "#8A2BE2", "Specs & standards"],
  ];
  const card = (c: [string, string, string, string]) =>
    '<div class="catwrap"><div class="cat spot" style="--sc:' +
    c[2] +
    '1f"><span class="sglow"></span>' +
    '<div class="ctop" style="background:' +
    c[2] +
    '"></div>' +
    '<div class="cin"><div class="chd"><div class="cic" style="background:' +
    c[2] +
    "15;border:1px solid " +
    c[2] +
    '30">' +
    I(c[1], 24) +
    "</div>" +
    '<div><div class="cht">' +
    c[0] +
    '</div><div class="chs">' +
    c[3] +
    "</div></div></div>" +
    hint("No tools yet") +
    "</div></div></div>";
  return (
    '<div class="wrap"><div class="tbx-head"><div class="stg"><div class="tbx-eb">Field Tools &amp; Reference</div><h1>Toolbox</h1></div>' +
    '<div class="tbx-search">' +
    I("search", 18) +
    '<input placeholder="Search tools..."></div></div>' +
    '<div class="tbx-grid stgp">' +
    cats.map(card).join("") +
    "</div></div>"
  );
}

/* ---------------- TIFF AI — hero + icon suggestions + empty threads ---------------- */
export function tiffHtml() {
  const S: [string, string, string][] = [
    ["wrench", "#00E5C0", "rgba(0,229,192,0.1)"],
    ["zap", "#2E68FF", "rgba(46,104,255,0.1)"],
    ["alert", "#FF3366", "rgba(255,51,102,0.1)"],
    ["file", "#8A2BE2", "rgba(138,43,226,0.1)"],
  ];
  const cards = S.map(
    (s) =>
      '<button class="tsugg"><span class="tsg" style="background:' +
      s[1] +
      '"></span>' +
      '<div class="tsh"><div class="tsi" style="background:' +
      s[2] +
      '">' +
      I(s[0], 18) +
      "</div></div></button>"
  ).join("");
  return (
    '<div class="tiff"><div class="tmain"><div class="thero"><div class="o1"></div><div class="o2"></div>' +
    '<div class="trow"><div class="tbot"><div class="tb">' +
    I("bot", 40, 1.5) +
    '</div><div class="tst"><i></i></div></div>' +
    '<div class="tlead"><div class="pill">' +
    I("fingerprint", 12) +
    "Tiff AI</div>" +
    "<h2>What are we building today?</h2></div></div></div>" +
    '<div class="tsgrid stgp">' +
    cards +
    "</div>" +
    '<div class="tinput"><div class="tib"></div><div class="tin"><div class="tic">' +
    I("sparkles", 20) +
    '</div>' +
    '<input placeholder="Message Tiff AI..."><button class="tsend">' +
    I("send", 18) +
    "</button></div></div></div>" +
    '<div class="tside"><div><div class="tsl"><span>Recent Threads</span></div>' +
    '<div style="padding:40px 16px;text-align:center"><b style="display:block;font-size:14px;font-weight:700;color:#9ca3af">Nothing to see here</b>' +
    '<em style="font-style:normal;display:block;font-size:12.5px;color:#d1d5db;margin-top:4px">Your conversations will show up here.</em></div></div></div></div>'
  );
}

/* ---------------- generic titled empty screen (Team / Studio / Admin) ---------------- */
export function blankHtml(title: string) {
  return (
    '<div class="wrap"><div class="stg">' +
    '<div class="v2head" style="margin-bottom:32px"><div><h1 style="font-size:44px;font-weight:800;letter-spacing:-0.03em;margin:0">' +
    title +
    "</h1></div></div>" +
    '<div style="padding:80px 16px;text-align:center;border:1.5px dashed #e6e8ee;border-radius:24px;background:linear-gradient(180deg,#fafbfc,#fff)">' +
    '<b style="display:block;font-size:16px;font-weight:700;color:#6b7280">' +
    title +
    "</b>" +
    '<em style="font-style:normal;display:block;font-size:13px;color:#9ca3af;margin-top:6px">Nothing here yet.</em></div>' +
    "</div></div>"
  );
}
