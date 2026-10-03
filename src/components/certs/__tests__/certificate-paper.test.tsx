import { renderToStaticMarkup } from "react-dom/server";
import { CertificatePaper } from "../certificate-paper";
import { addressLines, longDay } from "@/lib/certs/mechanical";
import { buildCertificate, DEFAULT_CERT_ANSWERS, type CertAnswers } from "@/lib/certs/mechanical";
import { signatureSvg } from "@/lib/swms/input";

/* The paper prints what the version froze, in the design sheet's dress. */

const TEST = { refrigerant: "R32", addedKg: 0 };
const ANSWERS: CertAnswers = {
  ...DEFAULT_CERT_ANSWERS,
  state: "NSW",
  covers: { ac: true, vent: true },
  building: "office",
  completedOn: "2026-09-25",
  systems: [
    {
      outdoor: { location: "Roof", model: "MUZ-AP42VGD2-A2", qty: 1, capacityKw: 4.2, serial: "" },
      indoors: [{ location: "Office", model: "MSZ-AP42VGKD2-A2", qty: 1, capacityKw: 4.2, serial: "" }],
      test: TEST,
    },
  ],
  fans: [{ location: "Bathroom", model: "XF100", qty: 1, airflowGiven: true, airflowLps: 40, airflowKind: "rated", serial: "" }],
};
const brand = { name: "Diamond Air Solutions", logoUrl: null, color: "#436cad", abn: "14603285409", phone: null, email: "service@example.com", website: null };

function render(a: CertAnswers = ANSWERS) {
  return renderToStaticMarkup(
    <CertificatePaper
      content={buildCertificate(a)}
      brand={brand}
      papers={{ licences: ["ARC authorisation AU12345"] }}
      job={{ number: "3326", builder: "Helix Venture Studio Pty Ltd", address: "Lv 3 Suite 4/44-54 Botany Road, Alexandria, NSW, 2015" }}
      signOff={{
        name: "Isaac Smith",
        signedOn: "2026-10-01",
        signatureSvg: signatureSvg("M10 60 L40 20 L60 70 L90 25")!,
        arc: { name: "ARC licence", number: "L118650", expires: "2028-08-16", current: true },
        contractor: { name: "Contractor licence", number: "315890C", expires: "2027-10-09", current: true },
      }}
      version={1}
    />
  );
}

describe("CertificatePaper", () => {
  it("titles itself after the street and addresses the builder, with no attention line or counts", () => {
    const html = render();
    expect(html).toContain("Mechanical Compliance Certificate");
    expect(html).toContain("<h1>Lv 3 Suite 4/44-54 Botany Road</h1>");
    expect(html).not.toContain("Attention");
    expect(html).not.toMatch(/Certifying|<dt>Fans<\/dt>/);
    expect(html).toContain("ARC authorisation AU12345");
  });

  it("prints the tables, the statements and the sign-off, and no Not covered line nobody typed", () => {
    const html = render();
    expect(html).toContain("Outdoor unit, roof");
    expect(html).toContain("MSZ-AP42VGKD2-A2");
    expect(html).toContain("40 L/s");
    expect(html).toContain("rated");
    expect(html).toContain("Refrigerant circuits were pressure tested, evacuated, charged and commissioned to AS/NZS 5149.2.");
    expect(html).not.toMatch(/kPa|microns/);
    expect(html).not.toContain("Not covered");
    expect(html).toContain("L118650");
    expect(html).toContain("315890C");
    expect(html).toContain('alt="Signature of Isaac Smith"');
    expect(html).toContain("Office (Class 5)");
  });

  it("leaves out a serial column until there is a serial, and the class when none was picked", () => {
    expect(render()).not.toContain("<th>Serial</th>");
    const a: CertAnswers = JSON.parse(JSON.stringify(ANSWERS));
    a.systems[0].outdoor.serial = "SN123";
    a.building = "other";
    const html = render(a);
    expect(html).toContain("<th>Serial</th>");
    expect(html).not.toContain("Building");
  });
});

describe("the paper's words", () => {
  it("dates paper with the year", () => {
    expect(longDay("2026-10-01")).toBe("1 October 2026");
    expect(longDay("")).toBe("");
  });

  it("splits a one-line address at its first comma, and keeps written lines", () => {
    expect(addressLines("Lv 3 Suite 4/44-54 Botany Road, Alexandria, NSW, 2015")).toEqual(["Lv 3 Suite 4/44-54 Botany Road", "Alexandria, NSW, 2015"]);
    expect(addressLines("74/10 Etham Avenue\nDarling Point NSW 2027")).toEqual(["74/10 Etham Avenue", "Darling Point NSW 2027"]);
    expect(addressLines(null)).toEqual([]);
    /* ServiceM8 sometimes leaves a comma at a line's end */
    expect(addressLines("260 Birrell St,\nBondi NSW 2026")).toEqual(["260 Birrell St", "Bondi NSW 2026"]);
  });
});
