import { esc, profileHtml } from "../profile";
import type { StaffProfile } from "@/lib/staff/profile";
import type { DemoStaff } from "@/mock/demo";

const blank: StaffProfile = {
  id: "p1",
  org_id: "o1",
  user_id: "auth0|1",
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

const staff: DemoStaff = {
  id: "jordan-mills",
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
  vehicle: "VRF-04",
  compliance: { label: "ARC expires 14d", state: "warn", expiresDays: 14 },
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
  const html = profileHtml(staff, { mode: "admin" });

  it("includes the admin-only sections", () => {
    for (const sec of ADMIN_SECTIONS) {
      expect(html).toContain(`data-sec="${sec}"`);
    }
    expect(html).toContain("Admin only");
  });

  it("defaults to admin mode when no option is given", () => {
    expect(profileHtml(staff)).toBe(html);
  });

  it("shows the Team breadcrumb", () => {
    expect(html).toContain('data-nav="people"');
    expect(html).toContain("Jordan Mills");
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
      profile: { ...blank, full_name: '<script>alert(1)</script>', address: '"><img onerror=x>' },
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
    expect(html).toContain('name="full_name" type="text" placeholder="e.g. Jordan Mills" value=""');
  });

  it("fills inputs from the stored card", () => {
    const html = profileHtml(staff, {
      mode: "self",
      profile: { ...blank, full_name: "Jordan Mills", phone: "0400 000 000" },
    });
    expect(html).toContain('value="Jordan Mills"');
    expect(html).toContain('value="0400 000 000"');
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
  it("marks the three no-edit cards static in both modes", () => {
    // Compliance (licences are added directly, not via edit mode),
    // Assigned vehicle and Training have no editable persisted fields.
    for (const mode of ["self", "admin"] as const) {
      const html = profileHtml(staff, { mode });
      expect(html.match(/class="card2" data-static/g)).toHaveLength(3);
    }
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
