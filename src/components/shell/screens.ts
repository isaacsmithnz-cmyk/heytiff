/* v3 screen markup, ported verbatim from the design. Each builder returns an
   HTML string (the screens are static placeholders — no per-element React needed).
   Pages render these via dangerouslySetInnerHTML inside the shell's .page wrapper. */

import { iconSvg as I } from "./icon";
/* The one escaper, straight from lib — components/shell/profile.ts used to
   re-export it as `esc` for the string screens, and that module is gone now
   that the Organisation page is React. Same function, one hop fewer. */
import { escapeHtml as esc } from "@/lib/format/html";

/* ---------------- DASHBOARD (home) — greeting hero ----------------
   heroHtml is just the hero block; the React dashboard (which renders live
   chips/roster/payroll sections beneath it) reuses it so the greeting stays
   byte-identical to the original. homeHtml wraps it for anything still rendering
   the static screen. */
export function heroHtml(opts: {
  greeting: string;
  firstName: string;
  date: string;
  /* The hero's right-hand column: four counters (urgent / tasks / needs
     attention / notifications), each a door into the screen that owns it.
     Derived in lib/dashboard/hero-stats. Omitted → the hero is the greeting
     alone, which is what the static screen still renders. */
  stats?: readonly {
    key: string;
    icon: string;
    label: string;
    count: number;
    href: string;
    tone: string;
  }[];
}) {
  /* Everything below reaches the DOM through dangerouslySetInnerHTML, so every
     value that came from a person MUST be escaped — the same rule profile.ts
     and the organisation settings screen already follow. What's left that a
     person typed is the viewer's own name; the counters are counts and their
     labels are ours. The action band used to carry the sharp edge (a chip's
     label and subject: a licence type, a vehicle's plate, the insurer, all
     user-entered) and it is gone, but the escaping stays either way. */

  /* A tile with nothing in it is deliberately DIM (`.zero`): the four counters
     are a "does anything need me" glance, so a clear day should read as calm
     rather than as four lit-up badges all saying nothing.

     And when EVERY counter is zero the tiles go away entirely — four zeroes are
     still four things to read. The column says it once, in words. */
  const clear = !!opts.stats?.length && opts.stats.every((s) => s.count === 0);
  const tiles = clear
    ? '<div class="hclear">' +
      `<span class="hc-ic">${I("check", 22)}</span>` +
      '<b class="hc-t">All clear</b>' +
      '<em class="hc-s">Nothing needs you right now</em>' +
      "</div>"
    : (opts.stats ?? [])
        .map(
          (s) =>
            `<a class="hstat ${esc(s.tone)}${s.count === 0 ? " zero" : ""}" href="${esc(s.href)}">` +
            `<span class="hs-ic">${I(s.icon, 17)}</span>` +
            `<b class="hs-n">${s.count}</b>` +
            `<em class="hs-l">${esc(s.label)}</em>` +
            "</a>",
        )
        .join("");
  const stats = opts.stats?.length
    ? `<div class="hstats${clear ? " clear" : ""}">` + tiles + "</div>"
    : "";

  return (
    '<div class="hero"><div class="mesh"><i class="m1"></i><i class="m2"></i><i class="m3"></i></div>' +
    '<div class="hrow"><div class="hlead">' +
    '<div class="pill">' +
    I("activity", 12) +
    esc(opts.date) +
    "</div>" +
    `<h1>${esc(opts.greeting)},<br><span>${esc(opts.firstName)}.</span></h1>` +
    '<p class="lede">Welcome back. Your workspace is ready.</p>' +
    "</div>" +
    stats +
    "</div>" +
    "</div>"
  );
}

export function homeHtml(opts: { greeting: string; firstName: string; date: string }) {
  return '<div class="wrap"><div class="stg">' + heroHtml(opts) + "</div></div>";
}

/* ---------------- TOOLBOX ----------------
   The Toolbox screen is no longer a static builder — it lives in
   src/components/toolbox/toolbox-screen.tsx (React: tool links + live search)
   with its tool registry in src/components/toolbox/tools.ts. */

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

/* ---------------- ASSETS ----------------
   The Assets screen is no longer a static builder — it lives in
   src/components/fleet/assets-screen.tsx (React: Fleet register / My-vehicle
   lens + Equipment tab) with its pure logic in src/components/fleet/logic.ts. */

/* ---------------- ADMIN ----------------
   The Admin landing is no longer a static builder — it lives in
   src/components/admin/admin-index.tsx (React: a grouped settings index whose
   rows come from a SECTIONS config). */

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
