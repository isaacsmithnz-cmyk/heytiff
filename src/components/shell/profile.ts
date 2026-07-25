/* Staff profile — verbatim port of the v3 design's renderer (figma-profile.js).
   Returns an HTML string; interactivity is attached by ProfileBehaviors.
   Header values come from the demo record; form fields render empty (as designed). */

import { iconSvg } from "./icon";
import { formatAuDate, type StaffProfile } from "@/lib/staff/profile";
import type { StaffLicence, StaffRow } from "@/lib/staff/types";
import { licenceStatus } from "@/lib/staff/licence";
import { todayInAu } from "@/lib/au-dates";
import type { Capability } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";
import {
  type VehicleWithFacts,
  displayName,
  fmtKm,
  modelLabel,
  serviceKmLeft,
  vehicleChips,
} from "@/components/fleet/logic";

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

/* Values reach the DOM through dangerouslySetInnerHTML, so everything the user
   typed MUST be escaped here. Applies to the header too — a name is user data
   the moment it comes from staff_profiles rather than the demo fixtures. */
export function esc(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// exported: the organisation settings screen reuses this form vocabulary
export const field = (label: string, inner: string, opts: { req?: boolean; help?: string } = {}) =>
  `<div class="field"><label>${label}${opts.req ? ' <span class="req">*</span>' : ""}</label>${inner}${opts.help ? `<span class="help">${opts.help}</span>` : ""}</div>`;
export const input = (name: string, ph?: string, type?: string, value?: string | null) =>
  `<input class="inp" name="${name}" type="${type || "text"}" placeholder="${esc(ph)}" value="${esc(value)}">`;
export const selectP = (name: string, ph: string, opts: readonly string[], value?: string | null) =>
  `<div class="selwrap"><select class="inp" name="${name}"><option value=""${!value ? " selected" : ""}>${esc(ph)}</option>${opts
    .map((o) => `<option${o === value ? " selected" : ""}>${esc(o)}</option>`)
    .join("")}</select><span class="chev">${ic("chev", 16)}</span></div>`;
export const textarea = (name: string, ph: string, value?: string | null, style?: string) =>
  `<textarea class="inp" name="${name}" placeholder="${esc(ph)}"${style ? ` style="${style}"` : ""}>${esc(value)}</textarea>`;
const pct = (name: string, ph?: string, value?: string | null) =>
  `<div class="suffixwrap"><input class="inp with-suffix"${name ? ` name="${name}"` : ""} type="text" placeholder="${esc(ph)}" value="${esc(value)}"><span class="sfx">%</span></div>`;
const money = (name: string, ph?: string, value?: string | null) =>
  `<div class="suffixwrap"><input class="inp"${name ? ` name="${name}"` : ""} style="padding-left:30px" type="text" placeholder="${esc(ph)}" value="${esc(value)}"><span class="sfx" style="left:14px;right:auto">$</span></div>`;

// ---- licence registry (shared with the add-licence behavior) ----
export type LicType = { name: string; sub?: string; color?: string };
export const LIC_TYPES: LicType[] = [
  { name: "Driver’s licence", sub: "State driver licence", color: "#2E68FF" },
  { name: "ARC licence", sub: "Refrigerant handling", color: "#00A389" },
  { name: "White card", sub: "Construction induction", color: "#8A2BE2" },
  { name: "Contractor licence", sub: "Trade contractor", color: "#F0A431" },
];

function sectionNav(mode: ProfileMode) {
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
  // Payroll / Permissions / Notes are admin-only and exist solely in the
  // admin-gated Team section — never on your own card.
  if (mode === "self") return `<nav class="pnav">${items}</nav>`;
  const admin =
    `<button class="pn adminrow" data-psec="payroll"><span class="pi">${ic("dollar", 17)}</span>Payroll<span class="lock">${ic("lock", 15)}</span></button>` +
    `<button class="pn adminrow" data-psec="permissions"><span class="pi">${ic("usershield", 17)}</span>Permissions<span class="lock">${ic("lock", 15)}</span></button>` +
    `<button class="pn adminrow" data-psec="notes"><span class="pi">${ic("note", 17)}</span>Notes &amp; flags<span class="lock">${ic("lock", 15)}</span></button>`;
  return `<nav class="pnav">${items}<div class="ndiv"></div><div class="ngl">Admin only</div>${admin}</nav>`;
}

function personal(p: StaffProfile | null) {
  const active = (p?.status ?? "Active") === "Active";
  const seg =
    '<div class="seg" data-seg="status">' +
    `<button class="${active ? "on green" : ""}" type="button" data-segval="Active">Active</button>` +
    `<button class="${active ? "" : "on"}" type="button" data-segval="Inactive">Inactive</button>` +
    `<input type="hidden" name="status" value="${active ? "Active" : "Inactive"}"></div>`;
  return (
    '<section class="psec on" data-sec="personal">' +
    `<div class="card2" data-section="personal"><div class="c2h"><span class="ci">${ic("user", 18)}</span><span><b>Personal details</b><em>Identity, contact & employment basics</em></span></div>` +
    /* A name is two fields, not one free-text box: first and last are what we
       store, and full_name is derived from them on save (lib/staff/name.ts). */
    `<div class="frow c2">${field("First name", input("first_name", "e.g. Jordan", "text", p?.first_name), { req: true })}${field("Last name", input("last_name", "e.g. Mills", "text", p?.last_name), { req: true })}</div>` +
    `<div class="frow c2">${field("Preferred / nickname", input("preferred_name", "e.g. Jordy", "text", p?.preferred_name))}${field("Phone", input("phone", "04xx xxx xxx", "tel", p?.phone), { req: true })}</div>` +
    `<div class="frow c2">${field("Birthday", input("birthday", "dd / mm / yyyy", "text", formatAuDate(p?.birthday)))}${field("Start date", input("start_date", "dd / mm / yyyy", "text", formatAuDate(p?.start_date)))}</div>` +
    `<div class="frow">${field("Address", input("address", "Street, suburb, state, postcode", "text", p?.address))}</div>` +
    `<div class="frow c2">${field("Employment type", selectP("employment_type", "Select employment type", ["Full-time", "Part-time", "Casual", "Apprentice", "Subcontractor"], p?.employment_type))}${field("Status", seg)}</div>` +
    `<div class="frow c2">${field("Profile photo", `<div class="drop"><span class="di">${ic("cam", 20)}</span><span class="dk"><b>Upload a photo</b><em>JPG or PNG, square works best</em></span></div>`)}<div></div></div>` +
    "</div></section>"
  );
}

function emergency(p: StaffProfile | null) {
  return (
    '<section class="psec" data-sec="emergency">' +
    `<div class="card2" data-section="emergency"><div class="c2h"><span class="ci">${ic("phone", 18)}</span><span><b>Emergency contact</b><em>Who we call if something happens on site</em></span></div>` +
    `<div class="frow c2">${field("Contact name", input("emergency_name", "e.g. Sarah Mills", "text", p?.emergency_name), { req: true })}${field("Contact phone", input("emergency_phone", "04xx xxx xxx", "tel", p?.emergency_phone), { req: true })}</div>` +
    `<div class="frow c2">${field("Relationship", selectP("emergency_relationship", "Select relationship", ["Partner", "Parent", "Sibling", "Friend", "Other"], p?.emergency_relationship))}${field("Alternate phone", input("emergency_alt_phone", "Optional", "tel", p?.emergency_alt_phone))}</div>` +
    "</div></section>"
  );
}

/* One stored licence, as a fact card with a delete. Editing a licence is
   delete-and-re-add rather than inline: a licence is a small, whole thing
   (type + number + expiry), so re-entering it is simpler — and safer — than an
   inline mini-form saving on every keystroke inside the injected-HTML shell. */
function storedLicence(l: StaffLicence, today: string): string {
  const color = l.color || "#00A389";
  const st = licenceStatus(l.expiryDate, today);
  const toneBg: Record<string, string> = {
    ok: "rgba(0,229,192,.12);color:#00A389",
    warn: "rgba(240,164,49,.16);color:#b45309",
    bad: "rgba(255,51,102,.12);color:#e0264f",
    mute: "#f3f4f6;color:#9ca3af",
  };
  const sub = [l.licenceNumber ? `No. ${esc(l.licenceNumber)}` : "No number", l.expiryDate ? `Expires ${formatAuDate(l.expiryDate)}` : "No expiry date"].join(" · ");
  return (
    `<div class="lic" data-lic-id="${esc(l.id)}"><div class="lh">` +
    `<span class="li" style="background:${color}18;color:${color}">${ic("shield", 18)}</span>` +
    `<span><b>${esc(l.typeName)}</b><em>${sub}</em></span>` +
    `<span class="lstat" style="background:${toneBg[st.tone]}">${st.label}</span>` +
    `<button class="licdel" title="Remove licence" data-licdel data-lic-id="${esc(l.id)}">${ic("x", 15)}</button>` +
    "</div></div>"
  );
}

function licences(p: StaffProfile | null, list: StaffLicence[] = [], today = todayInAu()) {
  const typeOpts =
    LIC_TYPES.map((t) => `<option value="${t.name}" data-color="${t.color ?? ""}">${t.name}</option>`).join("") +
    '<option value="__custom">Custom…</option>';
  const addbar =
    '<div class="licadd">' +
    `<div class="selwrap" style="flex:1; min-width:0"><select class="inp" id="lic-type"><option value="" disabled selected>Choose a licence to add…</option>${typeOpts}</select><span class="chev">${ic("chev", 16)}</span></div>` +
    '<input class="inp" id="lic-custom" placeholder="Name this licence / ticket…" style="flex:1; min-width:0; display:none">' +
    "</div>" +
    '<div class="licadd" style="margin-top:10px">' +
    '<input class="inp" id="lic-number" placeholder="Licence number (optional)" style="flex:1; min-width:0">' +
    '<input class="inp" id="lic-expiry" placeholder="Expiry — dd / mm / yyyy" style="flex:1; min-width:0">' +
    `<button class="pbtn primary" id="lic-add" style="height:46px; flex:0 0 auto">${ic("plus", 16)}Add</button></div>` +
    '<div class="carderr" id="lic-err" style="display:none"></div>';
  const rows = list.map((l) => storedLicence(l, today)).join("");
  const emptyHint = `<div class="ro-empty" id="lic-empty" style="margin-top:18px${list.length ? ";display:none" : ""}"><span class="ei">${ic("shield", 20)}</span><b>No licences added yet</b><em>Pick a type (or name a custom one), add a number and expiry, and it tracks here — and raises a reminder on your dashboard before it lapses.</em></div>`;
  return (
    '<section class="psec" data-sec="licences">' +
    `<div class="card2" data-live><div class="c2h"><span class="ci">${ic("shield", 18)}</span><span><b>Compliance</b><em>Licences &amp; tickets — each one tracks its number and expiry, and warns on your dashboard before it lapses</em></span></div>` +
    addbar +
    `<div class="lics" id="lic-list">${rows}</div>` +
    emptyHint +
    "</div>" +
    `<div class="card2" data-section="licences"><div class="c2h"><span class="ci">${ic("grad", 18)}</span><span><b>Other qualifications</b><em>Free-text list of tickets &amp; courses</em></span></div>` +
    `<div class="frow">${field("Qualifications", textarea("qualifications", "One per line — e.g. EWP ticket, Working at Heights, Confined Spaces…", p?.qualifications))}</div>` +
    "</div></section>"
  );
}

function workrights(p: StaffProfile | null) {
  const WR = [
    "Australian citizen",
    "Permanent resident",
    "Full working rights (visa)",
    "Conditional working rights (visa)",
    "No working rights",
  ];
  const wrSelect =
    `<div class="selwrap"><select class="inp" id="wr-status" name="work_rights_status"><option value="">— Select —</option>` +
    WR.map((o) => `<option${o === p?.work_rights_status ? " selected" : ""}>${esc(o)}</option>`).join("") +
    `</select><span class="chev">${ic("chev", 16)}</span></div>`;
  return (
    '<section class="psec" data-sec="workrights">' +
    `<div class="card2" data-section="workrights"><div class="c2h"><span class="ci">${ic("passport", 18)}</span><span><b>Work rights</b><em>Australian working-rights / visa status</em></span></div>` +
    `<div class="frow c2">${field("Work rights status", wrSelect)}<div></div></div>` +
    '<div id="wr-visa">' +
    `<div class="frow c2">${field("Visa type", input("visa_type", "e.g. 482 TSS, 500 Student, 417 WHM", "text", p?.visa_type))}${field("Visa expiry", input("visa_expiry", "dd / mm / yyyy", "text", formatAuDate(p?.visa_expiry)))}</div>` +
    `<div class="frow c2">${field('Hours condition <span style="color:#9ca3af;font-weight:600">(cap, if any)</span>', input("hours_condition", "e.g. unlimited, 48 hrs/fortnight", "text", p?.hours_condition))}${field(`VEVO last checked <span class="infobtn" tabindex="0">${ic("info", 14)}<span class="tip">VEVO (Visa Entitlement Verification Online) is the Australian Government service that confirms a person’s visa and working-rights conditions. Record the date you last checked it.</span></span>`, input("vevo_checked_at", "dd / mm / yyyy", "text", formatAuDate(p?.vevo_checked_at)))}</div>` +
    "</div>" +
    `<div class="frow">${field(
      "Verification document",
      `<div class="docrow"><span class="docic">${ic("file", 18)}</span><span class="dock"><b>No document uploaded</b><em>Optional — verify manually or attach evidence</em></span><span class="docact"><button class="docbtn ghostbtn docup" data-docupload>${ic("upload", 14)}Upload</button><button class="docbtn verify" data-docverify>${ic("check", 14)}Mark verified</button></span></div>`,
      { help: "Passport, visa or ID — or mark verified if sighted in person" }
    )}</div>` +
    "</div></section>"
  );
}

/* The Assigned-vehicle card. Fleet is the single source of the assignment —
   this card derives, it never stores. The join is async and this module builds
   strings synchronously, so the caller resolves it (lib/fleet/query.ts) and
   passes the result in; absent = no vehicle. */
export type AssignedVehicle = {
  vehicle: VehicleWithFacts;
  openIssues: number;
  lastFuel: { litres?: number; when: string } | null;
};

function vehicle(av: AssignedVehicle | null) {
  const head =
    `<div class="c2h"><span class="ci">${ic("truck", 18)}</span>` +
    "<span><b>Assigned vehicle</b><em>Linked from Fleet — manage in Assets</em></span></div>";
  if (!av) {
    return (
      '<section class="psec" data-sec="vehicle">' +
      `<div class="card2" data-static>${head}` +
      `<div class="ro-empty"><span class="ei">${ic("car", 20)}</span><b>No vehicle assigned</b><em>Assign a vehicle to this staff member from Assets → Fleet to show rego, service status and fuel here.</em></div>` +
      "</div></section>"
    );
  }
  const v = av.vehicle;
  const chips = vehicleChips(v, av.openIssues);
  const chipHtml =
    chips.length === 0
      ? `<span class="dchip ok">${ic("check", 12)}All good</span>`
      : chips
          .map(
            (c) =>
              `<span class="dchip ${c.state}">${ic(c.state === "bad" ? "alert" : "clock", 12)}${c.label}</span>`,
          )
          .join("");
  const left = serviceKmLeft(v);
  const lastFuel = av.lastFuel;
  const fact = (label: string, val: string) => `<span><em>${label}</em><b>${val}</b></span>`;
  return (
    '<section class="psec" data-sec="vehicle">' +
    `<div class="card2" data-static>${head}` +
    '<div class="pveh">' +
    `<div class="pvh"><span class="pvi">${ic("truck", 20)}</span>` +
    `<span><b>${displayName(v)} · ${modelLabel(v)}</b><em>Rego ${v.plate}</em></span></div>` +
    `<div class="pvchips">${chipHtml}</div>` +
    '<div class="pvfacts">' +
    fact("Odometer", `${fmtKm(v.odometer)} km`) +
    fact("Next service", left < 0 ? `${fmtKm(-left)} km overdue` : `in ${fmtKm(left)} km`) +
    fact("Rego", v.regoDays < 0 ? "expired" : `in ${v.regoDays}d`) +
    fact("Last fuel", lastFuel ? `${lastFuel.litres} L · ${lastFuel.when}` : "—") +
    "</div></div>" +
    "</div></section>"
  );
}

function training() {
  return (
    '<section class="psec" data-sec="training">' +
    `<div class="card2" data-static><div class="c2h"><span class="ci">${ic("grad", 18)}</span><span><b>Training progress</b><em>Pathways & sign-offs · read-only</em></span></div>` +
    `<div class="ro-empty"><span class="ei">${ic("grad", 20)}</span><b>No training pathways yet</b><em>Assigned pathways and competency sign-offs will appear here once Training is set up in Admin.</em></div>` +
    "</div></section>"
  );
}

function payroll(p: PayFields | null) {
  /* cost_split is one jsonb column but three sliders. Each carries its own
     name; the save action reassembles them into { install, service, admin }.
     Percentages are stored as whole numbers and must total 100 — the client
     auto-balances as you drag (profile-behaviors), and the action re-checks. */
  const cs = p?.cost_split ?? null;
  const csv = (k: "install" | "service" | "admin", dflt: number) => {
    const v = cs && typeof cs === "object" ? (cs as Record<string, unknown>)[k] : null;
    return typeof v === "number" ? Math.round(v) : dflt;
  };
  const [ins, srv, adm] = [csv("install", 34), csv("service", 33), csv("admin", 33)];
  const off1 = -ins;
  const off2 = -(ins + srv);
  const split =
    '<div class="field" style="grid-column:1/-1"><label>Cost-category split <span class="help" style="font-weight:500;margin-left:4px">— how their cost spreads across work types (must total 100%)</span></label>' +
    '<div class="csgrid">' +
    '<div class="costsplit">' +
    `<div class="csrow"><span class="csdot" style="background:var(--teal)"></span><span class="cslbl">Install</span><div class="cspct"><input class="csrange" name="cost_install" type="range" min="0" max="100" value="${ins}" data-cs="0"><span class="csval">${ins}%</span></div></div>` +
    `<div class="csrow"><span class="csdot" style="background:var(--blue)"></span><span class="cslbl">Service</span><div class="cspct"><input class="csrange" name="cost_service" type="range" min="0" max="100" value="${srv}" data-cs="1"><span class="csval">${srv}%</span></div></div>` +
    `<div class="csrow"><span class="csdot" style="background:#8A2BE2"></span><span class="cslbl">Admin</span><div class="cspct"><input class="csrange" name="cost_admin" type="range" min="0" max="100" value="${adm}" data-cs="2"><span class="csval">${adm}%</span></div></div>` +
    "</div>" +
    '<div class="cspie"><svg viewBox="0 0 36 36"><circle class="csbg" cx="18" cy="18" r="15.915" fill="none" stroke="#eef0f4" stroke-width="4"/>' +
    `<circle class="csseg s0" cx="18" cy="18" r="15.915" fill="none" stroke="var(--teal)" stroke-width="4" stroke-dasharray="${ins} ${100 - ins}" stroke-dashoffset="0" transform="rotate(-90 18 18)"/>` +
    `<circle class="csseg s1" cx="18" cy="18" r="15.915" fill="none" stroke="var(--blue)" stroke-width="4" stroke-dasharray="${srv} ${100 - srv}" stroke-dashoffset="${off1}" transform="rotate(-90 18 18)"/>` +
    `<circle class="csseg s2" cx="18" cy="18" r="15.915" fill="none" stroke="#8A2BE2" stroke-width="4" stroke-dasharray="${adm} ${100 - adm}" stroke-dashoffset="${off2}" transform="rotate(-90 18 18)"/></svg>` +
    '<div class="cstot"><b>100</b><em>%</em></div></div>' +
    "</div></div>";
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return (
    '<section class="psec" data-sec="payroll">' +
    `<div class="card2" data-section="payroll"><div class="c2h"><span class="ci" style="background:rgba(255,51,102,.1);color:#e0264f">${ic("dollar", 18)}</span><span><b>Payroll</b><em>Drives charge-out rate & job costing</em></span><span class="pill2 adminpill">${ic("lock", 11)}Owner only</span></div>` +
    `<div class="frow c2">${field("Hourly wage", money("hourly_wage", "e.g. 45.00", num(p?.hourly_wage)), { req: true })}${field("Employment type", selectP("employment_type", "Select employment type", ["Full-time", "Part-time", "Casual", "Apprentice", "Subcontractor"], p?.employment_type ?? null))}</div>` +
    `<div class="frow c2">${field("Contracted hours / week", input("contracted_hours", "e.g. 38", "text", num(p?.contracted_hours)))}${field(`Default utilisation <span class="infobtn" tabindex="0">${ic("info", 14)}<span class="tip">The share of paid hours that are billable to jobs (vs. admin, travel or downtime). Drives the charge-out rate — e.g. 85% means most of their time is on the tools.</span></span>`, pct("utilisation", "e.g. 85", num(p?.utilisation)))}</div>` +
    // Per-person super / workers-comp — blank means "use the org default" set in
    // the Rate Calculator. These feed the calculator; they're not written there.
    `<div class="frow c2">${field(`Super override <span class="infobtn" tabindex="0">${ic("info", 14)}<span class="tip">Leave blank to use the organisation's default super rate. Set a value only if this person's super differs.</span></span>`, pct("super_override", "Default", num(p?.super_override)))}${field(`Workers-comp override <span class="infobtn" tabindex="0">${ic("info", 14)}<span class="tip">Leave blank to use the organisation's default workers-comp rate.</span></span>`, pct("workers_comp_override", "Default", num(p?.workers_comp_override)))}</div>` +
    `<div class="frow" style="margin-top:18px">${split}</div>` +
    "</div></section>"
  );
}

function permissions(ctx: PermissionsCtx) {
  const ROLES: [Role, string, string, string][] = [
    ["staff", "Staff", "Field worker — own data only", "#00A389"],
    ["admin", "Admin", "Manage the team — approve & assign", "#2E68FF"],
    ["owner", "Owner", "Full access incl. pay & financials", "#8A2BE2"],
  ];
  /* Role is owner-only and never settable on yourself or on the master owner.
     A locked selector still SHOWS the current role — hiding it would leave an
     admin unable to see why someone has the access they have. */
  const roleLocked = !ctx.canChangeRole;
  const roleCards = ROLES.map(
    (r) =>
      `<label class="permrole${r[0] === ctx.role ? " on" : ""}${roleLocked ? " locked" : ""}">` +
      `<input type="radio" name="org_role" value="${r[0]}"${r[0] === ctx.role ? " checked" : ""}${roleLocked ? " disabled" : ""}>` +
      `<span class="prdot" style="background:${r[3]}"></span>` +
      `<span class="prk"><b>${r[1]}</b><em>${r[2]}</em></span>` +
      `<span class="prcheck">${ic("check", 14)}</span></label>`
  ).join("");

  /* Labels say "everyone's" where the capability gates the team-wide view only
     — revoking it never touches the person's own timesheet or own vehicle,
     which are intrinsic. Owner-tier rows render locked for a delegated
     manager, matching what canSetCapability will actually accept. */
  const ACCESS: [Capability, string, string][] = [
    ["toolbox", "Toolbox", "Calculators & references"],
    ["studio", "Design Studio", "Create & edit VRF designs"],
    ["tiff", "Tiff AI", "Assistant & knowledge base"],
    ["team", "Team directory", "View & manage other staff records"],
    ["timepay_all", "Time & Pay — everyone's", "All timesheets, leave & expenses"],
    ["approvals", "Approvals", "Approve hours, leave & expenses"],
    ["assets_all", "Assets — whole register", "Full fleet & equipment"],
    ["financials", "Financials", "Other people's pay, rates & charge-out"],
    ["permissions", "Permissions", "Change other people's access"],
    ["invites", "Invites", "Invite & offboard staff — staff role only"],
  ];
  const accessRows = ACCESS.map(([cap, label, hint]) => {
    const on = ctx.caps.has(cap);
    const locked = !ctx.settable.has(cap);
    return (
      `<div class="togrow${locked ? " locked" : ""}"><div class="tk"><b>${esc(label)}</b>` +
      `<em>${esc(hint)}${locked ? " · owner-granted" : ""}</em></div>` +
      `<div class="toggle${on ? " on" : ""}" data-toggle${locked ? " data-locked" : ""}></div>` +
      `<input type="hidden" name="cap_${cap}" value="${on ? "on" : "off"}"></div>`
    );
  }).join("");

  const note = ctx.lockedReason
    ? `<div class="ro-empty" style="margin-bottom:18px"><span class="ei">${ic("lock", 20)}</span><b>Read-only</b><em>${esc(ctx.lockedReason)}</em></div>`
    : "";

  return (
    '<section class="psec" data-sec="permissions">' +
    `<div class="card2"${ctx.editable ? ' data-section="permissions"' : " data-static"}><div class="c2h"><span class="ci" style="background:rgba(138,43,226,.12);color:#8A2BE2">${ic("usershield", 18)}</span><span><b>Permissions</b><em>Role &amp; what this person can access</em></span><span class="pill2 adminpill">${ic("lock", 11)}Admin only</span></div>` +
    note +
    `<div class="field" style="margin-bottom:20px"><label>Role</label><div class="permroles">${roleCards}</div></div>` +
    `<div class="field"><label>Access <span class="help" style="font-weight:500;margin-left:4px">— fine-tune what the role can reach</span></label><div class="accessgrid">${accessRows}</div></div>` +
    "</div></section>"
  );
}

function notes(p: { notes?: string | null } | null) {
  return (
    '<section class="psec" data-sec="notes">' +
    `<div class="card2" data-section="notes"><div class="c2h"><span class="ci">${ic("note", 18)}</span><span><b>Notes</b><em>Internal — visible to managers & admin</em></span></div>` +
    `<div class="frow">${field("Notes", textarea("notes", "e.g. First-aid officer · prefers north-side jobs · on light duties until June", p?.notes ?? null, "min-height:120px"))}</div>` +
    "</div>" +
    `<div class="card2" data-static><div class="c2h"><span class="ci" style="background:rgba(240,164,49,.14);color:#d98a00">${ic("alert", 18)}</span><span><b>Flags</b><em>Things that need attention</em></span></div>` +
    `<div class="ro-empty"><span class="ei">${ic("check", 20)}</span><b>No active flags</b><em>This staff member is all clear.</em></div>` +
    "</div></section>"
  );
}

/* The hero only needs these — StaffRow satisfies it, so callers pass a real
   row and nothing here depends on the demo fixtures any more. */
export type ProfileHeader = Pick<
  StaffRow,
  "id" | "initials" | "name" | "email" | "role" | "employmentType" | "started" | "years" | "licenceCount" | "status"
> & { nickname?: string };

/** Pay fields — only present when the viewer holds `financials`. */
export type PayFields = {
  hourly_wage?: number | null;
  contracted_hours?: number | null;
  utilisation?: number | null;
  super_override?: number | null;
  workers_comp_override?: number | null;
  cost_split?: unknown;
  employment_type?: string | null;
};

/** Everything the Permissions card needs to render honestly. */
export type PermissionsCtx = {
  /** the target's current role */
  role: Role | null;
  /** the target's resolved capabilities */
  caps: ReadonlySet<Capability>;
  /** which of those the VIEWER may actually change */
  settable: ReadonlySet<Capability>;
  /** may the viewer change this person's role at all */
  canChangeRole: boolean;
  /** false renders the whole card read-only (data-static, no Save) */
  editable: boolean;
  /** shown when the card is locked, so it isn't a mystery */
  lockedReason?: string;
};

/** Which admin-only sections to render. Absent = omit entirely. */
export type ProfileSections = {
  payroll?: PayFields | null;
  permissions?: PermissionsCtx;
  notes?: { notes?: string | null } | null;
};

/** "self" = My profile (own staff card). "admin" = Team viewing someone else. */
export type ProfileMode = "self" | "admin";

export function profileHtml(
  s: ProfileHeader,
  opts: {
    mode?: ProfileMode;
    profile?: StaffProfile | null;
    /* admin mode only. Each key present renders that section; absent omits it
       entirely — that is how `financials` and owner-only gate the Payroll and
       Permissions cards, rather than rendering them disabled. */
    sections?: ProfileSections;
    /** Resolved by the caller — see AssignedVehicle. */
    vehicle?: AssignedVehicle | null;
    /** The person's stored licences, for the Compliance card. */
    licences?: StaffLicence[];
    /** AU calendar date, so licence status labels agree with the dashboard. */
    today?: string;
  } = {}
): string {
  const mode: ProfileMode = opts.mode ?? "admin";
  const p = opts.profile ?? null;
  const nick = s.nickname ? ` <em>“${esc(s.nickname)}”</em>` : "";
  // Per-card edit: the profile opens read-only and each card unlocks on its own
  // Edit (handled in profile-behaviors). No global readonly / Save-all bar.
  const crumb =
    mode === "self"
      ? '<div class="crumb"><b>My profile</b></div>'
      : `<div class="crumb"><a data-nav="people">Team</a><span class="sep">/</span><a data-nav="people">Staff</a><span class="sep">/</span><b>${esc(s.name)}</b></div>`;
  // Admin-only sections are omitted entirely from your own card — not rendered,
  // not in the nav. The server action's allowlist has no such columns either.
  const sec = opts.sections ?? {};
  const adminSections =
    mode === "self"
      ? ""
      : [
          sec.payroll !== undefined ? payroll(sec.payroll) : "",
          sec.permissions ? permissions(sec.permissions) : "",
          sec.notes !== undefined ? notes(sec.notes) : "",
        ].join("");
  return (
    '<div class="prof">' +
    `<div class="pbar">${crumb}</div>` +
    '<div class="phead"><div class="mesh"><i class="m1"></i><i class="m2"></i></div><div class="inner">' +
    `<div class="pphoto"><div class="inn">${esc(s.initials)}</div><span class="cam">${ic("cam", 15)}</span></div>` +
    `<div class="pid"><h1>${esc(s.name)}${nick}</h1>` +
    `<div class="sub"><span>${ic("truck", 14)}${esc(s.role)}</span><span class="dot"></span><span>${esc(s.employmentType)}</span><span class="dot"></span><span>Started ${esc(s.started)}</span></div></div>` +
    `<div class="pquick"><div class="q"><b>${s.licenceCount}</b><em>Licences</em></div><div class="q"><b>${esc(s.years)}</b><em>Years</em></div></div>` +
    `<span class="badge active" style="align-self:flex-start"><span class="d"></span>${esc(s.status)}</span>` +
    "</div></div>" +
    `<div class="pgrid">${sectionNav(mode)}<div class="ppanel">${personal(p)}${emergency(p)}${licences(p, opts.licences ?? [], opts.today ?? todayInAu())}${workrights(p)}${vehicle(opts.vehicle ?? null)}${training()}${adminSections}</div></div>` +
    "</div>"
  );
}
