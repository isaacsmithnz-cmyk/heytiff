import { orgSettingsHtml } from "../org-settings";
import type { OrgSettings } from "@/lib/org/settings";

const blank: OrgSettings = {
  id: "o1",
  trading_name: null,
  legal_name: null,
  abn: null,
  acn: null,
  gst_registered: null,
  email: null,
  phone: null,
  website: null,
  address: null,
  suburb: null,
  state: null,
  postcode: null,
  arc_rta: null,
  contractor_licence: null,
  insurer: null,
  insurance_policy: null,
  insurance_expiry: null,
  logo_url: null,
};

describe("orgSettingsHtml — structure", () => {
  const html = orgSettingsHtml(blank);

  it("renders exactly the three editable sections", () => {
    const sections = [...html.matchAll(/data-section="([a-z]+)"/g)].map((m) => m[1]);
    expect(sections.sort()).toEqual(["compliance", "contact", "identity"]);
  });

  it("wraps the cards in .prof so ProfileBehaviors' machinery applies", () => {
    expect(html).toContain('class="prof"');
  });

  it("offers all eight states", () => {
    for (const s of ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"]) {
      expect(html).toContain(`<option>${s}</option>`);
    }
  });

  it("gives the logo dropzone no name — the save collector must ignore it", () => {
    const logoBlock = html.slice(html.indexOf("Upload a logo") - 300, html.indexOf("Upload a logo") + 100);
    expect(logoBlock).not.toContain("name=");
  });

  it("leaves the GST hidden input empty when unset — saving clears, not guesses", () => {
    expect(html).toContain('<input type="hidden" name="gst_registered" value="">');
  });
});

describe("orgSettingsHtml — seeding stored values", () => {
  const org: OrgSettings = {
    ...blank,
    trading_name: "Smith Air Conditioning",
    abn: "51824753556",
    gst_registered: true,
    state: "VIC",
    insurance_expiry: "2027-03-01",
  };
  const html = orgSettingsHtml(org);

  it("fills inputs from the stored row", () => {
    expect(html).toContain('value="Smith Air Conditioning"');
    expect(html).toContain('value="51824753556"');
  });

  it("marks the stored state selected", () => {
    expect(html).toContain("<option selected>VIC</option>");
  });

  it("renders the insurance expiry back as dd/mm/yyyy", () => {
    expect(html).toContain('value="01/03/2027"');
  });

  it("reflects GST=true in both the seg and its hidden input", () => {
    expect(html).toContain('<input type="hidden" name="gst_registered" value="Yes">');
    const inactive = orgSettingsHtml({ ...blank, gst_registered: false });
    expect(inactive).toContain('<input type="hidden" name="gst_registered" value="No">');
  });
});

describe("orgSettingsHtml — escaping (values reach dangerouslySetInnerHTML)", () => {
  it("does not emit a raw script tag from a stored company name", () => {
    const html = orgSettingsHtml({ ...blank, trading_name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not break out of a value attribute with a quote", () => {
    const html = orgSettingsHtml({ ...blank, suburb: '" autofocus onfocus="alert(1)' });
    expect(html).not.toContain('autofocus onfocus="alert(1)"');
    expect(html).toContain("&quot;");
  });

  it("escapes an address containing markup", () => {
    const html = orgSettingsHtml({ ...blank, address: "12 <b>Trade</b> St & Co" });
    expect(html).not.toContain("<b>Trade</b>");
    expect(html).toContain("12 &lt;b&gt;Trade&lt;/b&gt; St &amp; Co");
  });
});
