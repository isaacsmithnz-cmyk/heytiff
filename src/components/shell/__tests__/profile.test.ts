import { esc, profileHtml, type PermissionsCtx } from "../profile";
import type { StaffProfile } from "@/lib/staff/profile";
import { CAPABILITIES, resolve } from "@/lib/permissions";
import type { StaffRow } from "@/lib/staff/types";
import type { VehicleWithFacts } from "@/components/fleet/logic";

const blank: StaffProfile = {
  id: "p1",
  org_id: "o1",
  user_id: "auth0|1",
  first_name: null,
  last_name: null,
  full_name: null,
  preferred_name: null,
  phone: null,
  birthday: null,
  address: null,
  start_date: null,
  employment_type: null,
  job_title: null,
  status: "Active",
  photo_url: null,
  emergency_name: null,
  emergency_phone: null,
  emergency_relationship: null,
  emergency_alt_phone: null,
  work_rights_status: null,
  visa_type: null,
  visa_expiry: null,
  hours_condition: null,
  vevo_checked_at: null,
  work_rights_doc_url: null,
  work_rights_verified_at: null,
  qualifications: null,
};

const staff: StaffRow = {
  id: "9f1d0c2a-0000-4000-8000-000000000001",
  userId: "auth0|jordan",
  orgRole: "staff",
  isMaster: false,
  vehicle: "—",
  initials: "JM",
  name: "Jordan Mills",
  nickname: "Jordy",
  email: "jordan@heytiff.co",
  role: "Lead Installer",
  employmentType: "Full-time",
  started: "Mar 2021",
  years: "3.2",
  licenceCount: 4,
  status: "Active",
  compliance: { label: "ARC expires in 2 weeks", state: "warn", expiresDays: 14 },
};

const ADMIN_SECTIONS = ["payroll", "permissions", "notes"];

describe("profileHtml — self mode (My profile)", () => {
  const html = profileHtml(staff, { mode: "self" });

  it("omits the admin-only sections entirely", () => {
    for (const sec of ADMIN_SECTIONS) {
      expect(html).not.toContain(`data-sec="${sec}"`);
      expect(html).not.toContain(`data-psec="${sec}"`);
    }
  });

  it("drops the Admin-only nav divider and label", () => {
    expect(html).not.toContain("Admin only");
    expect(html).not.toContain("adminrow");
  });

  it("does not leak payroll or permissions copy", () => {
    expect(html).not.toContain("Hourly wage");
    expect(html).not.toContain("Cost-category split");
    expect(html).not.toContain("permrole");
  });

  it("keeps the six self-editable sections", () => {
    for (const sec of ["personal", "emergency", "licences", "workrights", "vehicle", "training"]) {
      expect(html).toContain(`data-psec="${sec}"`);
    }
  });

  it("shows a My profile breadcrumb, not the Team trail", () => {
    expect(html).toContain("<b>My profile</b>");
    expect(html).not.toContain('data-nav="people"');
  });
});

describe("profileHtml — admin mode (Team)", () => {
  /* Admin sections are opt-in per capability now: the caller passes only the
     ones the viewer may see, so a section that isn't rendered can't be a
     section that was rendered-then-hidden. */
  const ownerCtx: PermissionsCtx = {
    role: "staff",
    caps: resolve("staff"),
    settable: new Set(CAPABILITIES),
    canChangeRole: true,
    editable: true,
  };
  const full = profileHtml(staff, {
    mode: "admin",
    sections: { payroll: {}, permissions: ownerCtx, notes: {} },
  });

  it("includes the admin-only sections when the viewer may see them", () => {
    for (const sec of ADMIN_SECTIONS) {
      expect(full).toContain(`data-sec="${sec}"`);
    }
    expect(full).toContain("Admin only");
  });

  it("omits Payroll entirely without `financials` — not rendered then hidden", () => {
    const noPay = profileHtml(staff, {
      mode: "admin",
      sections: { permissions: ownerCtx, notes: {} },
    });
    expect(noPay).not.toContain('data-sec="payroll"');
    expect(noPay).not.toContain("Hourly wage");
    expect(noPay).not.toContain('name="hourly_wage"');
    expect(noPay).toContain('data-sec="permissions"');
  });

  it("omits Notes when looking at your own card", () => {
    const own = profileHtml(staff, { mode: "admin", sections: { permissions: ownerCtx } });
    expect(own).not.toContain('data-sec="notes"');
  });

  it("renders no admin sections at all when none are passed", () => {
    const bare = profileHtml(staff, { mode: "admin" });
    for (const sec of ADMIN_SECTIONS) expect(bare).not.toContain(`data-sec="${sec}"`);
  });

  it("shows the Team breadcrumb", () => {
    expect(full).toContain('data-nav="people"');
    expect(full).toContain("Jordan Mills");
  });
});

describe("profileHtml — payroll card", () => {
  const ctx: PermissionsCtx = {
    role: "staff",
    caps: resolve("staff"),
    settable: new Set(CAPABILITIES),
    canChangeRole: true,
    editable: true,
  };

  it("names its fields so the save collector picks them up", () => {
    const html = profileHtml(staff, {
      mode: "admin",
      sections: { payroll: { hourly_wage: 52.5, contracted_hours: 38, utilisation: 85 }, permissions: ctx },
    });
    expect(html).toContain('name="hourly_wage"');
    expect(html).toContain('value="52.5"');
    expect(html).toContain('name="contracted_hours"');
    expect(html).toContain('name="utilisation"');
    expect(html).toContain('data-section="payroll"');
  });

  it("seeds the three cost sliders from the stored split", () => {
    const html = profileHtml(staff, {
      mode: "admin",
      sections: {
        payroll: { cost_split: { install: 50, service: 30, admin: 20 } },
        permissions: ctx,
      },
    });
    expect(html).toContain('name="cost_install" type="range" min="0" max="100" value="50"');
    expect(html).toContain('name="cost_service" type="range" min="0" max="100" value="30"');
    expect(html).toContain('name="cost_admin" type="range" min="0" max="100" value="20"');
  });

  it("falls back to 34/33/33 when nothing is stored", () => {
    const html = profileHtml(staff, { mode: "admin", sections: { payroll: {}, permissions: ctx } });
    expect(html).toContain('name="cost_install" type="range" min="0" max="100" value="34"');
  });
});

describe("profileHtml — permissions card", () => {
  const base: PermissionsCtx = {
    role: "admin",
    caps: resolve("admin"),
    settable: new Set(CAPABILITIES),
    canChangeRole: true,
    editable: true,
  };
  const render = (over: Partial<PermissionsCtx> = {}) =>
    profileHtml(staff, { mode: "admin", sections: { permissions: { ...base, ...over } } });

  it("checks the target's current role", () => {
    expect(render()).toContain('name="org_role" value="admin" checked');
  });

  it("reflects each capability's real state in a hidden input", () => {
    const html = render();
    expect(html).toContain('name="cap_team" value="on"'); // admin default
    expect(html).toContain('name="cap_financials" value="off"'); // admin default
  });

  it("locks the owner-tier rows for a delegated manager", () => {
    const html = render({
      settable: new Set(CAPABILITIES.filter((c) => c !== "financials" && c !== "permissions")),
    });
    // locked rows carry data-locked and say why
    expect(html).toMatch(/Financials[\s\S]*?owner-granted/);
    expect(html).toContain("data-locked");
  });

  it("renders read-only, with a reason, when the viewer may not edit", () => {
    const html = render({
      editable: false,
      canChangeRole: false,
      lockedReason: "You can't change your own access. Ask another owner.",
    });
    expect(html).toContain("data-static");
    expect(html).not.toContain('data-section="permissions"');
    expect(html).toContain("You can&#39;t change your own access.");
    expect(html).toContain("disabled");
  });
});

describe("escaping — values reach the DOM via dangerouslySetInnerHTML", () => {
  it("escapes the five dangerous characters", () => {
    expect(esc(`<script>"x"&'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;"
    );
  });

  it("escapes &amp; first so entities aren't double-broken", () => {
    expect(esc("Tom & Jerry")).toBe("Tom &amp; Jerry");
    expect(esc("<")).toBe("&lt;");
  });

  it("passes null and undefined through as an empty string", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });

  it("does not emit a raw script tag from a stored field value", () => {
    const html = profileHtml(staff, {
      mode: "self",
      profile: { ...blank, first_name: '<script>alert(1)</script>', address: '"><img onerror=x>' },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('"><img');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not break out of the value attribute with a quote", () => {
    const html = profileHtml(staff, {
      mode: "self",
      profile: { ...blank, phone: '" autofocus onfocus="alert(1)' },
    });
    expect(html).not.toContain('autofocus onfocus="alert(1)"');
    expect(html).toContain("&quot;");
  });

  it("escapes the header name, which is user data once it comes from the card", () => {
    const html = profileHtml(
      { ...staff, name: "<b>Jordan</b>", nickname: "<i>J</i>" },
      { mode: "admin" }
    );
    expect(html).not.toContain("<b>Jordan</b>");
    expect(html).toContain("&lt;b&gt;Jordan&lt;/b&gt;");
  });

  it("escapes a textarea value", () => {
    const html = profileHtml(staff, {
      mode: "self",
      profile: { ...blank, qualifications: "</textarea><script>x</script>" },
    });
    expect(html).not.toContain("</textarea><script>");
  });
});

describe("seeding stored values into the form", () => {
  it("renders empty fields when there is no stored card", () => {
    const html = profileHtml(staff, { mode: "self", profile: null });
    expect(html).toContain('name="first_name" type="text" placeholder="e.g. Jordan" value=""');
    expect(html).toContain('name="last_name" type="text" placeholder="e.g. Mills" value=""');
  });

  it("fills inputs from the stored card", () => {
    const html = profileHtml(staff, {
      mode: "self",
      profile: { ...blank, first_name: "Jordan", last_name: "Mills", phone: "0400 000 000" },
    });
    expect(html).toContain('value="Jordan"');
    expect(html).toContain('value="Mills"');
    expect(html).toContain('value="0400 000 000"');
  });

  it("edits a name as two fields, and never as one free-text box", () => {
    const html = profileHtml(staff, { mode: "self", profile: blank });
    expect(html).toContain("<label>First name");
    expect(html).toContain("<label>Last name");
    // full_name is derived on save — there is nothing to type it into
    expect(html).not.toContain('name="full_name"');
  });

  it("renders stored dates back as dd/mm/yyyy", () => {
    const html = profileHtml(staff, {
      mode: "self",
      profile: { ...blank, start_date: "2020-06-01", birthday: "1990-12-25" },
    });
    expect(html).toContain('value="01/06/2020"');
    expect(html).toContain('value="25/12/1990"');
  });

  it("marks the stored select option selected", () => {
    const html = profileHtml(staff, {
      mode: "self",
      profile: { ...blank, employment_type: "Casual", work_rights_status: "Permanent resident" },
    });
    expect(html).toContain("<option selected>Casual</option>");
    expect(html).toContain("<option selected>Permanent resident</option>");
  });

  it("carries status in a hidden input matching the segmented control", () => {
    const active = profileHtml(staff, { mode: "self", profile: { ...blank, status: "Active" } });
    expect(active).toContain('<input type="hidden" name="status" value="Active">');
    const inactive = profileHtml(staff, {
      mode: "self",
      profile: { ...blank, status: "Inactive" },
    });
    expect(inactive).toContain('<input type="hidden" name="status" value="Inactive">');
  });

  it("gives payroll fields no name, so the save collector ignores them", () => {
    const html = profileHtml(staff, { mode: "admin" });
    expect(html).not.toContain('name="hourly_wage"');
    expect(html).not.toContain('name="cost_split"');
  });
});

describe("read-only cards", () => {
  it("marks Assigned vehicle and Training static in both modes", () => {
    // Both are read-only facts with no editable fields at all.
    for (const mode of ["self", "admin"] as const) {
      const html = profileHtml(staff, { mode });
      expect(html.match(/class="card2" data-static/g)).toHaveLength(2);
    }
  });

  /* The assigned-vehicle card is composed as an HTML string, so the plate that
     lands on it goes through plateHtml rather than <Plate>. Everything a person
     typed about that vehicle — its name, its make and model, its plate — is
     read here by their manager, which is exactly the reach the dashboard hero's
     stored XSS had. */
  const assigned = (over: Partial<VehicleWithFacts> = {}) => ({
    vehicle: {
      id: "vrf-04",
      name: "VRF-04",
      make: "Toyota",
      model: "Hiace ZR",
      year: 2022,
      plate: "mkt482",
      plateState: "vic",
      status: "active" as const,
      odometer: 84120,
      regoDays: 21,
      insuranceDays: 200,
      serviceIntervalKm: 10000,
      lastServiceOdo: 75500,
      ...over,
    },
    openIssues: 0,
    lastFuel: null,
  });

  it("renders the assigned vehicle's rego as a plate, uppercased with its state", () => {
    const html = profileHtml(staff, { mode: "self", vehicle: assigned() });
    expect(html).toContain('<span class="au-plate">MKT482<span class="st">VIC</span></span>');
    expect(html).not.toContain("Rego mkt482"); // the old plain-text label is gone
  });

  it("escapes the vehicle name, model and plate on the way into the card", () => {
    const payload = `<img src=x onerror="alert(1)">`;
    const html = profileHtml(staff, {
      mode: "admin",
      vehicle: assigned({ name: payload, model: payload, plate: payload }),
    });
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;IMG"); // the plate, uppercased then escaped
    expect(html).toContain("&lt;img"); // the name and model
  });

  it("marks the Compliance card data-live — no edit cycle, its own add/delete", () => {
    // Licences are added and removed directly, so the card is never locked and
    // never gets a Save button; it must not carry data-static (which would lock
    // it) nor data-section (which would route it through the flat save).
    const html = profileHtml(staff, { mode: "self" });
    expect(html).toContain('class="card2" data-live');
    expect(html).toContain('id="lic-add"');
  });

  it("renders stored licences with a delete handle and a status pill", () => {
    const html = profileHtml(staff, {
      mode: "self",
      today: "2026-07-24",
      licences: [
        { id: "L1", typeName: "ARC licence", licenceNumber: "AU123", expiryDate: "2026-08-07", color: "#00A389" },
        { id: "L2", typeName: "White card", licenceNumber: null, expiryDate: null, color: null },
      ],
    });
    // the licence is on the card, with an id-bearing delete and its warn status
    expect(html).toContain('data-lic-id="L1"');
    expect(html).toContain("ARC licence");
    expect(html).toContain("No. AU123");
    expect(html).toContain("Expires in 2 weeks");
    expect(html).toContain('data-licdel data-lic-id="L1"');
    // the empty hint is hidden once there's at least one
    expect(html).toContain('id="lic-empty" style="margin-top:18px;display:none"');
  });

  it("shows the empty hint when there are no licences", () => {
    const html = profileHtml(staff, { mode: "self", licences: [] });
    expect(html).not.toContain("data-lic-id=");
    expect(html).toContain('id="lic-empty" style="margin-top:18px"');
  });

  it("gives every persisted card a data-section", () => {
    const html = profileHtml(staff, { mode: "self" });
    const sections = [...html.matchAll(/data-section="([a-z]+)"/g)].map((m) => m[1]);
    expect(sections.sort()).toEqual(["emergency", "licences", "personal", "workrights"]);
  });

  it("never gives an admin-only card a data-section", () => {
    const html = profileHtml(staff, { mode: "admin" });
    for (const sec of ADMIN_SECTIONS) {
      expect(html).not.toContain(`data-section="${sec}"`);
    }
  });
});
