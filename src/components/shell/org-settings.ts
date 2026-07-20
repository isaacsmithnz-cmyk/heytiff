/* Organisation settings — the company profile behind "HeyTiff × your business".
   Same card language and per-card edit model as the staff profile: HTML string
   rendered by ProfileBehaviors, each .card2 carries data-section and unlocks
   on its own Edit; Save posts that card's [name] fields to saveOrgSection.
   Wrapped in .prof so the shared behaviours (cardactions injection, seg
   toggle, is-empty styling) apply. All values pass through the profile
   helpers, which escape them — same rule as the staff card. */

import { field, input, profileIcon as ic, selectP } from "./profile";
import { formatAuDate } from "@/lib/au-dates";
import { AU_STATES, type OrgSettings } from "@/lib/org/settings";

function identity(o: OrgSettings) {
  const gst = o.gst_registered;
  const seg =
    '<div class="seg" data-seg="gst_registered">' +
    `<button class="${gst === true ? "on green" : ""}" type="button" data-segval="Yes">Yes</button>` +
    `<button class="${gst === false ? "on" : ""}" type="button" data-segval="No">No</button>` +
    `<input type="hidden" name="gst_registered" value="${gst === true ? "Yes" : gst === false ? "No" : ""}"></div>`;
  return (
    `<div class="card2" data-section="identity"><div class="c2h"><span class="ci">${ic("hexagon", 18)}</span><span><b>Company identity</b><em>Who the business is on paper</em></span></div>` +
    `<div class="frow c2">${field("Trading name", input("trading_name", "e.g. Smith Air Conditioning", "text", o.trading_name), { help: "Shown across HeyTiff — including under the logo" })}${field("Legal name", input("legal_name", "e.g. Smith Air Pty Ltd", "text", o.legal_name))}</div>` +
    `<div class="frow c2">${field("ABN", input("abn", "e.g. 51 824 753 556", "text", o.abn), { help: "Checked against the ATO checksum on save" })}${field("ACN", input("acn", "9 digits — companies only", "text", o.acn))}</div>` +
    `<div class="frow c2">${field("GST registered", seg)}${field("Website", input("website", "e.g. smithair.com.au", "text", o.website))}</div>` +
    `<div class="frow">${field("Logo", `<div class="drop"><span class="di">${ic("cam", 20)}</span><span class="dk"><b>Upload a logo</b><em>Coming soon — needs document storage</em></span></div>`)}</div>` +
    "</div>"
  );
}

function contact(o: OrgSettings) {
  return (
    `<div class="card2" data-section="contact"><div class="c2h"><span class="ci">${ic("phone", 18)}</span><span><b>Contact &amp; address</b><em>Where the business lives &amp; how to reach it</em></span></div>` +
    `<div class="frow c2">${field("Email", input("email", "e.g. office@smithair.com.au", "email", o.email))}${field("Phone", input("phone", "e.g. (03) 9000 0000", "tel", o.phone))}</div>` +
    `<div class="frow">${field("Street address", input("address", "e.g. 12 Trade Street", "text", o.address))}</div>` +
    `<div class="frow c3">${field("Suburb", input("suburb", "e.g. Ringwood", "text", o.suburb))}${field("State", selectP("state", "Select state", AU_STATES, o.state), { help: "Also sets your public-holiday calendar" })}${field("Postcode", input("postcode", "e.g. 3134", "text", o.postcode))}</div>` +
    "</div>"
  );
}

function compliance(o: OrgSettings) {
  return (
    `<div class="card2" data-section="compliance"><div class="c2h"><span class="ci">${ic("shield", 18)}</span><span><b>Licences &amp; insurance</b><em>What lets the business trade</em></span></div>` +
    `<div class="frow c2">${field("ARC refrigerant trading authorisation", input("arc_rta", "e.g. AU12345", "text", o.arc_rta), { help: "The business authorisation — staff ARC licences live on their cards" })}${field("Contractor licence", input("contractor_licence", "State-issued licence number", "text", o.contractor_licence))}</div>` +
    `<div class="frow c3">${field("Public liability insurer", input("insurer", "e.g. QBE", "text", o.insurer))}${field("Policy number", input("insurance_policy", "", "text", o.insurance_policy))}${field("Policy expiry", input("insurance_expiry", "dd / mm / yyyy", "text", formatAuDate(o.insurance_expiry)))}</div>` +
    "</div>"
  );
}

export function orgSettingsHtml(o: OrgSettings): string {
  return (
    '<div class="wrap"><div class="stg">' +
    '<div class="v2head" style="margin-bottom:8px"><div><h1 style="font-size:44px;font-weight:800;letter-spacing:-0.03em;margin:0">Organisation</h1></div></div>' +
    '<p style="font-size:14px;font-weight:500;color:#6b7280;margin:0 0 28px">Your company details — they appear on the sidebar, and later on exports and documents. Owner-only.</p>' +
    '<div class="prof" style="max-width:860px">' +
    identity(o) +
    contact(o) +
    compliance(o) +
    "</div></div></div>"
  );
}
