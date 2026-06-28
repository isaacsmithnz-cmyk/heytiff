/* Staff profile — verbatim port of the v3 design's renderer (figma-profile.js).
   Returns an HTML string; interactivity is attached by ProfileBehaviors.
   Header values come from the demo record; form fields render empty (as designed). */

import { iconSvg } from "./icon";
import type { DemoStaff } from "@/mock/demo";

// profile-specific icons (the rest fall back to the shared icon set)
const EX: Record<string, string> = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M5.5 21a8.38 8.38 0 0 1 13 0"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  phone:
    '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  dollar:
    '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  truck:
    '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  grad:
    '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  note:
    '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v6h6"/>',
  cam:
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  car:
    '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  passport:
    '<path d="M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="10" r="3"/><path d="M9 16h6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  usershield: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  file:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
};

const exSvg = (n: string, s?: number, w?: number) =>
  `<svg class="i" width="${s || 20}" height="${s || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 2}" stroke-linecap="round" stroke-linejoin="round">${EX[n] || ""}</svg>`;
const ic = (n: string, s?: number, w?: number) => (EX[n] ? exSvg(n, s, w) : iconSvg(n, s, w));

/** Profile-aware icon (EX set + shared fallback) — used by ProfileBehaviors. */
export function profileIcon(n: string, s?: number, w?: number): string {
  return ic(n, s, w);
}

// ---- field helpers ----
const field = (label: string, inner: string, opts: { req?: boolean; help?: string } = {}) =>
  `<div class="field"><label>${label}${opts.req ? ' <span class="req">*</span>' : ""}</label>${inner}${opts.help ? `<span class="help">${opts.help}</span>` : ""}</div>`;
const input = (ph?: string, type?: string) => `<input class="inp" type="${type || "text"}" placeholder="${ph || ""}">`;
const selectP = (ph: string, opts: string[]) =>
  `<div class="selwrap"><select class="inp"><option value="" selected>${ph}</option>${opts.map((o) => `<option>${o}</option>`).join("")}</select><span class="chev">${ic("chev", 16)}</span></div>`;
const pct = (ph?: string) =>
  `<div class="suffixwrap"><input class="inp with-suffix" type="text" placeholder="${ph || ""}"><span class="sfx">%</span></div>`;
const money = (ph?: string) =>
  `<div class="suffixwrap"><input class="inp" style="padding-left:30px" type="text" placeholder="${ph || ""}"><span class="sfx" style="left:14px;right:auto">$</span></div>`;

// ---- licence registry (shared with the add-licence behavior) ----
export type LicType = { name: string; sub?: string; color?: string };
export const LIC_TYPES: LicType[] = [
  { name: "Driver’s licence", sub: "State driver licence", color: "#2E68FF" },
  { name: "ARC licence", sub: "Refrigerant handling", color: "#00A389" },
  { name: "White card", sub: "Construction induction", color: "#8A2BE2" },
  { name: "Contractor licence", sub: "Trade contractor", color: "#F0A431" },
];
export function licCard(t: LicType): string {
  const color = t.color || "#00A389";
  const sub = t.sub || "Custom licence / ticket";
  return (
    `<div class="lic"><div class="lh"><span class="li" style="background:${color}18;color:${color}">${ic("shield", 18)}</span>` +
    `<span><b>${t.name}</b><em>${sub}</em></span>` +
    `<span class="lstat">Not set</span><button class="licdel" title="Remove licence" data-licdel>${ic("x", 15)}</button></div>` +
    `<div class="frow c2">${field("Licence number", input("e.g. 1234 5678"))}${field("Expiry date", input("dd / mm / yyyy"))}</div>` +
    `<div class="frow" style="margin-top:14px">${field("Photo / scan", `<div class="drop"><span class="di">${ic("upload", 18)}</span><span class="dk"><b>Upload document</b><em>Front of card or certificate</em></span></div>`)}</div></div>`
  );
}

function sectionNav() {
  const items = [
    ["personal", "Personal details", "user"],
    ["emergency", "Emergency contact", "phone"],
    ["licences", "Compliance", "shield"],
    ["workrights", "Work rights", "passport"],
    ["vehicle", "Assigned vehicle", "truck"],
    ["training", "Training", "grad"],
  ]
    .map(
      (n, i) =>
        `<button class="pn${i === 0 ? " on" : ""}" data-psec="${n[0]}"><span class="pi">${ic(n[2], 17)}</span>${n[1]}</button>`
    )
    .join("");
  const admin =
    `<button class="pn adminrow" data-psec="payroll"><span class="pi">${ic("dollar", 17)}</span>Payroll<span class="lock">${ic("lock", 15)}</span></button>` +
    `<button class="pn adminrow" data-psec="permissions"><span class="pi">${ic("usershield", 17)}</span>Permissions<span class="lock">${ic("lock", 15)}</span></button>` +
    `<button class="pn adminrow" data-psec="notes"><span class="pi">${ic("note", 17)}</span>Notes &amp; flags<span class="lock">${ic("lock", 15)}</span></button>`;
  return `<nav class="pnav">${items}<div class="ndiv"></div><div class="ngl">Admin only</div>${admin}</nav>`;
}

function personal(s: DemoStaff) {
  return (
    '<section class="psec on" data-sec="personal">' +
    `<div class="card2"><div class="c2h"><span class="ci">${ic("user", 18)}</span><span><b>Personal details</b><em>Identity, contact & employment basics</em></span></div>` +
    `<div class="frow c2">${field("Full name", input("e.g. Jordan Mills"), { req: true })}${field("Preferred / nickname", input("e.g. Jordy"))}</div>` +
    `<div class="frow c2">${field("Phone", input("04xx xxx xxx", "tel"), { req: true })}${field("Birthday", input("dd / mm / yyyy"))}</div>` +
    `<div class="frow">${field("Address", input("Street, suburb, state, postcode"))}</div>` +
    `<div class="frow c2">${field("Start date", input("dd / mm / yyyy"))}${field("Employment type", selectP("Select employment type", ["Full-time", "Part-time", "Casual", "Apprentice", "Subcontractor"]))}</div>` +
    `<div class="frow c2">${field("Status", '<div class="seg"><button class="on green" type="button">Active</button><button type="button">Inactive</button></div>')}${field("Profile photo", `<div class="drop"><span class="di">${ic("cam", 20)}</span><span class="dk"><b>Upload a photo</b><em>JPG or PNG, square works best</em></span></div>`)}</div>` +
    "</div></section>"
  );
}

function emergency() {
  return (
    '<section class="psec" data-sec="emergency">' +
    `<div class="card2"><div class="c2h"><span class="ci">${ic("phone", 18)}</span><span><b>Emergency contact</b><em>Who we call if something happens on site</em></span></div>` +
    `<div class="frow c2">${field("Contact name", input("e.g. Sarah Mills"), { req: true })}${field("Contact phone", input("04xx xxx xxx", "tel"), { req: true })}</div>` +
    `<div class="frow c2">${field("Relationship", selectP("Select relationship", ["Partner", "Parent", "Sibling", "Friend", "Other"]))}${field("Alternate phone", input("Optional", "tel"))}</div>` +
    "</div></section>"
  );
}

function licences() {
  const typeOpts =
    LIC_TYPES.map((t) => `<option value="${t.name}">${t.name}</option>`).join("") +
    '<option value="__custom">Custom…</option>';
  const addbar =
    '<div class="licadd">' +
    `<div class="selwrap" style="flex:1; min-width:0"><select class="inp" id="lic-type"><option value="" disabled selected>Choose a licence to add…</option>${typeOpts}</select><span class="chev">${ic("chev", 16)}</span></div>` +
    '<input class="inp" id="lic-custom" placeholder="Name this licence / ticket…" style="flex:1; min-width:0; display:none">' +
    `<button class="pbtn primary" id="lic-add" style="height:46px; flex:0 0 auto">${ic("plus", 16)}Add</button></div>`;
  const emptyHint = `<div class="ro-empty" id="lic-empty" style="margin-top:18px"><span class="ei">${ic("shield", 20)}</span><b>No licences added yet</b><em>Choose a type above (or add a custom one) to generate a card with number, expiry and a document upload.</em></div>`;
  return (
    '<section class="psec" data-sec="licences">' +
    `<div class="card2"><div class="c2h"><span class="ci">${ic("shield", 18)}</span><span><b>Compliance</b><em>Licences &amp; qualifications — add a licence to generate a card tracking number, expiry &amp; a document upload</em></span></div>` +
    addbar +
    '<div class="lics" id="lic-list"></div>' +
    emptyHint +
    "</div>" +
    `<div class="card2"><div class="c2h"><span class="ci">${ic("grad", 18)}</span><span><b>Other qualifications</b><em>Free-text list of tickets &amp; courses</em></span></div>` +
    `<div class="frow">${field("Qualifications", '<textarea class="inp" placeholder="One per line — e.g. EWP ticket, Working at Heights, Confined Spaces…"></textarea>')}</div>` +
    "</div></section>"
  );
}

function workrights() {
  return (
    '<section class="psec" data-sec="workrights">' +
    `<div class="card2"><div class="c2h"><span class="ci">${ic("passport", 18)}</span><span><b>Work rights</b><em>Australian working-rights / visa status</em></span></div>` +
    `<div class="frow c2">${field("Work rights status", `<div class="selwrap"><select class="inp" id="wr-status"><option value="">— Select —</option><option>Australian citizen</option><option>Permanent resident</option><option>Full working rights (visa)</option><option>Conditional working rights (visa)</option><option>No working rights</option></select><span class="chev">${ic("chev", 16)}</span></div>`)}<div></div></div>` +
    '<div id="wr-visa">' +
    `<div class="frow c2">${field("Visa type", input("e.g. 482 TSS, 500 Student, 417 WHM"))}${field("Visa expiry", input("dd / mm / yyyy"))}</div>` +
    `<div class="frow c2">${field('Hours condition <span style="color:#9ca3af;font-weight:600">(cap, if any)</span>', input("e.g. unlimited, 48 hrs/fortnight"))}${field(`VEVO last checked <span class="infobtn" tabindex="0">${ic("info", 14)}<span class="tip">VEVO (Visa Entitlement Verification Online) is the Australian Government service that confirms a person’s visa and working-rights conditions. Record the date you last checked it.</span></span>`, input("dd / mm / yyyy"))}</div>` +
    "</div>" +
    `<div class="frow">${field(
      "Verification document",
      `<div class="docrow"><span class="docic">${ic("file", 18)}</span><span class="dock"><b>No document uploaded</b><em>Optional — verify manually or attach evidence</em></span><span class="docact"><button class="docbtn ghostbtn docup" data-docupload>${ic("upload", 14)}Upload</button><button class="docbtn verify" data-docverify>${ic("check", 14)}Mark verified</button></span></div>`,
      { help: "Passport, visa or ID — or mark verified if sighted in person" }
    )}</div>` +
    "</div></section>"
  );
}

function vehicle() {
  return (
    '<section class="psec" data-sec="vehicle">' +
    `<div class="card2"><div class="c2h"><span class="ci">${ic("truck", 18)}</span><span><b>Assigned vehicle</b><em>Linked from Fleet</em></span></div>` +
    `<div class="ro-empty"><span class="ei">${ic("car", 20)}</span><b>No vehicle assigned</b><em>Assign a vehicle to this staff member from Assets → Fleet to show rego, service status and fuel here.</em></div>` +
    "</div></section>"
  );
}

function training() {
  return (
    '<section class="psec" data-sec="training">' +
    `<div class="card2"><div class="c2h"><span class="ci">${ic("grad", 18)}</span><span><b>Training progress</b><em>Pathways & sign-offs · read-only</em></span></div>` +
    `<div class="ro-empty"><span class="ei">${ic("grad", 20)}</span><b>No training pathways yet</b><em>Assigned pathways and competency sign-offs will appear here once Training is set up in Admin.</em></div>` +
    "</div></section>"
  );
}

function payroll() {
  const split =
    '<div class="field" style="grid-column:1/-1"><label>Cost-category split <span class="help" style="font-weight:500;margin-left:4px">— how their cost spreads across work types (must total 100%)</span></label>' +
    '<div class="csgrid">' +
    '<div class="costsplit">' +
    '<div class="csrow"><span class="csdot" style="background:var(--teal)"></span><span class="cslbl">Install</span><div class="cspct"><input class="csrange" type="range" min="0" max="100" value="34" data-cs="0"><span class="csval">34%</span></div></div>' +
    '<div class="csrow"><span class="csdot" style="background:var(--blue)"></span><span class="cslbl">Service</span><div class="cspct"><input class="csrange" type="range" min="0" max="100" value="33" data-cs="1"><span class="csval">33%</span></div></div>' +
    '<div class="csrow"><span class="csdot" style="background:#8A2BE2"></span><span class="cslbl">Admin</span><div class="cspct"><input class="csrange" type="range" min="0" max="100" value="33" data-cs="2"><span class="csval">33%</span></div></div>' +
    "</div>" +
    '<div class="cspie"><svg viewBox="0 0 36 36"><circle class="csbg" cx="18" cy="18" r="15.915" fill="none" stroke="#eef0f4" stroke-width="4"/>' +
    '<circle class="csseg s0" cx="18" cy="18" r="15.915" fill="none" stroke="var(--teal)" stroke-width="4" stroke-dasharray="34 66" stroke-dashoffset="0" transform="rotate(-90 18 18)"/>' +
    '<circle class="csseg s1" cx="18" cy="18" r="15.915" fill="none" stroke="var(--blue)" stroke-width="4" stroke-dasharray="33 67" stroke-dashoffset="-34" transform="rotate(-90 18 18)"/>' +
    '<circle class="csseg s2" cx="18" cy="18" r="15.915" fill="none" stroke="#8A2BE2" stroke-width="4" stroke-dasharray="33 67" stroke-dashoffset="-67" transform="rotate(-90 18 18)"/></svg>' +
    '<div class="cstot"><b>100</b><em>%</em></div></div>' +
    "</div></div>";
  return (
    '<section class="psec" data-sec="payroll">' +
    `<div class="card2"><div class="c2h"><span class="ci" style="background:rgba(255,51,102,.1);color:#e0264f">${ic("dollar", 18)}</span><span><b>Payroll</b><em>Drives charge-out rate & job costing</em></span><span class="pill2 adminpill">${ic("lock", 11)}Admin only</span></div>` +
    `<div class="frow c2">${field("Hourly wage", money("e.g. 45.00"), { req: true })}${field("Employment type", selectP("Select employment type", ["Full-time", "Part-time", "Casual", "Apprentice", "Subcontractor"]))}</div>` +
    `<div class="frow c2">${field("Contracted hours / week", input("e.g. 38"))}${field(`Default utilisation <span class="infobtn" tabindex="0">${ic("info", 14)}<span class="tip">The share of paid hours that are billable to jobs (vs. admin, travel or downtime). Drives the charge-out rate — e.g. 85% means most of their time is on the tools.</span></span>`, pct("e.g. 85"))}</div>` +
    `<div class="frow" style="margin-top:18px">${split}</div>` +
    "</div></section>"
  );
}

function permissions() {
  const ROLES: [string, string, string][] = [
    ["Staff", "Field worker — own data only", "#00A389"],
    ["Admin", "Manage the team — approve & assign", "#2E68FF"],
    ["Owner", "Full access incl. pay & financials", "#8A2BE2"],
  ];
  const roleCards = ROLES.map(
    (r, i) =>
      `<label class="permrole${i === 1 ? " on" : ""}"><input type="radio" name="permrole"${i === 1 ? " checked" : ""}><span class="prdot" style="background:${r[2]}"></span><span class="prk"><b>${r[0]}</b><em>${r[1]}</em></span><span class="prcheck">${ic("check", 14)}</span></label>`
  ).join("");
  const ACCESS: [string, string, boolean][] = [
    ["Toolbox", "Calculators & references", true],
    ["Design Studio", "Create & edit VRF designs", true],
    ["Tiff AI", "Assistant & knowledge base", true],
    ["Team directory", "View other staff records", false],
    ["Time & Pay", "Timesheets, leave & expenses", true],
    ["Approvals", "Approve hours, leave & expenses", false],
    ["Assets", "Fleet & equipment", false],
    ["Financials", "Pay rates & charge-out — admin", false],
  ];
  const accessRows = ACCESS.map(
    (a) =>
      `<div class="togrow"><div class="tk"><b>${a[0]}</b><em>${a[1]}</em></div><div class="toggle${a[2] ? " on" : ""}" data-toggle></div></div>`
  ).join("");
  return (
    '<section class="psec" data-sec="permissions">' +
    `<div class="card2"><div class="c2h"><span class="ci" style="background:rgba(138,43,226,.12);color:#8A2BE2">${ic("usershield", 18)}</span><span><b>Permissions</b><em>Role &amp; what this person can access</em></span><span class="pill2 adminpill">${ic("lock", 11)}Admin only</span></div>` +
    `<div class="field" style="margin-bottom:20px"><label>Role</label><div class="permroles">${roleCards}</div></div>` +
    `<div class="field"><label>Access <span class="help" style="font-weight:500;margin-left:4px">— fine-tune what the role can reach</span></label><div class="accessgrid">${accessRows}</div></div>` +
    "</div></section>"
  );
}

function notes() {
  return (
    '<section class="psec" data-sec="notes">' +
    `<div class="card2"><div class="c2h"><span class="ci">${ic("note", 18)}</span><span><b>Notes</b><em>Internal — visible to managers & admin</em></span></div>` +
    `<div class="frow">${field("Notes", '<textarea class="inp" placeholder="e.g. First-aid officer · prefers north-side jobs · on light duties until June" style="min-height:120px"></textarea>')}</div>` +
    "</div>" +
    `<div class="card2"><div class="c2h"><span class="ci" style="background:rgba(240,164,49,.14);color:#d98a00">${ic("alert", 18)}</span><span><b>Flags</b><em>Things that need attention</em></span><button class="pbtn ghost pill2" style="height:36px">${ic("plus", 15)}Add flag</button></div>` +
    `<div class="ro-empty"><span class="ei">${ic("check", 20)}</span><b>No active flags</b><em>This staff member is all clear.</em></div>` +
    "</div></section>"
  );
}

export function profileHtml(s: DemoStaff): string {
  const nick = s.nickname ? ` <em>“${s.nickname}”</em>` : "";
  // Per-card edit: the profile opens read-only and each card unlocks on its own
  // Edit (handled in profile-behaviors). No global readonly / Save-all bar.
  return (
    '<div class="prof">' +
    `<div class="pbar"><div class="crumb"><a data-nav="people">Team</a><span class="sep">/</span><a data-nav="people">Staff</a><span class="sep">/</span><b>${s.name}</b></div></div>` +
    '<div class="phead"><div class="mesh"><i class="m1"></i><i class="m2"></i></div><div class="inner">' +
    `<div class="pphoto"><div class="inn">${s.initials}</div><span class="cam">${ic("cam", 15)}</span></div>` +
    `<div class="pid"><h1>${s.name}${nick}</h1>` +
    `<div class="sub"><span>${ic("truck", 14)}${s.role}</span><span class="dot"></span><span>${s.employmentType}</span><span class="dot"></span><span>Started ${s.started}</span></div></div>` +
    `<div class="pquick"><div class="q"><b>${s.licenceCount}</b><em>Licences</em></div><div class="q"><b>${s.years}</b><em>Years</em></div></div>` +
    `<span class="badge active" style="align-self:flex-start"><span class="d"></span>${s.status}</span>` +
    "</div></div>" +
    `<div class="pgrid">${sectionNav()}<div class="ppanel">${personal(s)}${emergency()}${licences()}${workrights()}${vehicle()}${training()}${payroll()}${permissions()}${notes()}</div></div>` +
    "</div>"
  );
}
