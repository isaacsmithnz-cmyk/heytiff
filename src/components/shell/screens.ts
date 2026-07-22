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

/* ---------------- tabbed empty-state page (Assets) ---------------- */
function tabPage(title: string, tabs: [string, string, string, string][]) {
  const tabBar = tabs
    .map(
      (t, i) =>
        `<button class="ptab${i === 0 ? " on" : ""}" data-ptab="${i}">${t[0]}</button>`
    )
    .join("");
  const panels = tabs
    .map(
      (t, i) =>
        `<div class="ptabpanel${i === 0 ? " on" : ""}" data-ppanel="${i}">` +
        '<div class="emptybox"><span class="ei">' +
        I(t[1], 24) +
        `</span><b>${t[2]}</b><em>${t[3]}</em></div></div>`
    )
    .join("");
  return (
    '<div class="wrap"><div class="stg">' +
    '<div class="v2head" style="margin-bottom:24px"><div>' +
    `<h1 style="font-size:44px;font-weight:800;letter-spacing:-0.03em;margin:0">${title}</h1></div></div>` +
    `<div class="ptabs">${tabBar}</div>` +
    `<div class="ptabpanels">${panels}</div>` +
    "</div></div>"
  );
}

export function assetsHtml() {
  return tabPage("Assets", [
    ["Fleet", "truck", "No vehicles yet", "Assign vehicles, track service, rego &amp; insurance expiry and fuel."],
    ["Equipment & tools", "box", "No equipment registered", "Register serials, holders and calibration / test-tag dates."],
  ]);
}

/* ---------------- ADMIN — invite card (admin/owner only) ---------------- */
/* Admin landing. The SECTION is admin+ (staff never see it); the ITEMS gate
   individually — invites/users/roles are owner-only, the rate calculator needs
   `financials`. An admin with neither still gets the section, because the
   manager-visible tools the spec puts here (compliance, documents, licences &
   insurances, training) will live in it. Passing a bare boolean here was the
   bug: it collapsed a per-item gate into a whole-section one. */
export function adminHtml(opts: {
  canInvite: boolean;
  canFinancials: boolean;
  /** owner-intrinsic: the organisation profile card */
  canOrgSettings?: boolean;
}) {
  const { canInvite, canFinancials, canOrgSettings = false } = opts;
  const head =
    '<div class="v2head" style="margin-bottom:32px"><div>' +
    '<h1 style="font-size:44px;font-weight:800;letter-spacing:-0.03em;margin:0">Admin</h1></div></div>';

  if (!canInvite && !canFinancials && !canOrgSettings) {
    return (
      '<div class="wrap"><div class="stg">' +
      head +
      '<div style="padding:80px 16px;text-align:center;border:1.5px dashed #e6e8ee;border-radius:24px;background:linear-gradient(180deg,#fafbfc,#fff)">' +
      '<b style="display:block;font-size:16px;font-weight:700;color:#6b7280">Nothing here for you yet</b>' +
      '<em style="font-style:normal;display:block;font-size:13px;color:#9ca3af;margin-top:6px">Compliance, documents, licences &amp; insurances and training will appear here. Invites and financial tools are owner-only.</em></div>' +
      "</div></div>"
    );
  }

  const inviteCard =
    '<a href="/dashboard/admin/invite" class="spot" style="display:block;text-decoration:none;background:#fff;border-radius:24px;border:1px solid #f0f0f2;box-shadow:0 8px 30px rgba(0,0,0,.03);padding:32px;max-width:520px">' +
    '<span class="sglow"></span>' +
    '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">' +
    '<div style="width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:rgba(0,229,192,0.1);border:1px solid rgba(0,229,192,0.3);color:#00A389;flex:0 0 auto">' +
    I("users", 22) +
    "</div>" +
    '<div><div style="font-size:18px;font-weight:800;color:#050505">Invite your team</div>' +
    '<div style="font-size:13px;color:#6b7280;font-weight:500">Send an invite link and assign a role</div></div></div>' +
    '<span style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:12px;background:#050505;color:#fff;font-size:14px;font-weight:700">Invite someone ' +
    I("arrowR", 16) +
    "</span></a>";

  const rateCalcCard =
    '<a href="/dashboard/admin/rate-calculator" class="spot" style="display:block;text-decoration:none;background:#fff;border-radius:24px;border:1px solid #f0f0f2;box-shadow:0 8px 30px rgba(0,0,0,.03);padding:32px;max-width:520px">' +
    '<span class="sglow"></span>' +
    '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">' +
    '<div style="width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:rgba(46,104,255,0.08);border:1px solid rgba(46,104,255,0.25);color:#2E68FF;flex:0 0 auto">' +
    I("calc", 22) +
    "</div>" +
    '<div><div style="font-size:18px;font-weight:800;color:#050505">Rate Calculator</div>' +
    '<div style="font-size:13px;color:#6b7280;font-weight:500">Work out charge-out rates from your true costs</div></div></div>' +
    '<span style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:12px;background:#050505;color:#fff;font-size:14px;font-weight:700">Open calculator ' +
    I("arrowR", 16) +
    "</span></a>";

  const orgCard =
    '<a href="/dashboard/admin/organization" class="spot" style="display:block;text-decoration:none;background:#fff;border-radius:24px;border:1px solid #f0f0f2;box-shadow:0 8px 30px rgba(0,0,0,.03);padding:32px;max-width:520px">' +
    '<span class="sglow"></span>' +
    '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">' +
    '<div style="width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:rgba(138,43,226,0.08);border:1px solid rgba(138,43,226,0.25);color:#8A2BE2;flex:0 0 auto">' +
    I("hexagon", 22) +
    "</div>" +
    '<div><div style="font-size:18px;font-weight:800;color:#050505">Organisation</div>' +
    '<div style="font-size:13px;color:#6b7280;font-weight:500">Company name, ABN, address, licences &amp; insurance</div></div></div>' +
    '<span style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:12px;background:#050505;color:#fff;font-size:14px;font-weight:700">Open settings ' +
    I("arrowR", 16) +
    "</span></a>";

  const group = (label: string, card: string, first: boolean) =>
    `<div style="font-size:11px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#9ca3af;margin:${first ? "0 0 16px" : "32px 0 16px"}">${label}</div>` +
    card;

  const groups: string[] = [];
  if (canOrgSettings) groups.push(group("Business", orgCard, groups.length === 0));
  if (canInvite) groups.push(group("Team", inviteCard, groups.length === 0));
  if (canFinancials) groups.push(group("Tools", rateCalcCard, groups.length === 0));

  return '<div class="wrap"><div class="stg">' + head + groups.join("") + "</div></div>";
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
