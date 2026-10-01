import { renderToStaticMarkup } from "react-dom/server";
import { CertificatePaper, addressLines, longDay } from "../certificate-paper";
import { buildCertificate, DEFAULT_CERT_ANSWERS, type CertAnswers } from "@/lib/certs/mechanical";
import { signatureSvg } from "@/lib/swms/input";

/* The paper prints what the version froze, in the design sheet's dress. */

const TEST = { pressureKpa: 4150, holdMinutes: 30, vacuumMicrons: 350, manufacturerMicrons: null, refrigerant: "R32", addedKg: 0 };
const ANSWERS: CertAnswers = {
  ...DEFAULT_CERT_ANSWERS,
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
  fans: [{ location: "Bathroom", model: "XF100", qty: 1, airflowLps: 40, airflowKind: "rated", serial: "" }],
};
const brand = { name: "Diamond Air Solutions", logoUrl: null, color: "#436cad", abn: "14603285409", phone: null, email: "service@example.com", website: null };

function render(a: CertAnswers = ANSWERS) {
  return renderToStaticMarkup(
    <CertificatePaper
      content={buildCertificate(a)}
      brand={brand}
      papers={{ licences: ["ARC authorisation AU12345"], insurance: ["Public liability: QBE 08U693177BPK"] }}
      job={{ number: "3326", builder: "Helix Venture Studio Pty Ltd", contact: "Lisa Harper", address: "Lv 3 Suite 4/44-54 Botany Road, Alexandria, NSW, 2015" }}
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
  it("titles itself after what it covers and the street, and addresses the builder", () => {
    const html = render();
    expect(html).toContain("Air conditioning and ventilation compliance certificate");
    expect(html).toContain("<h1>Lv 3 Suite 4/44-54 Botany Road</h1>");
    expect(html).toContain("Attention Lisa Harper");
    expect(html).toContain("ARC authorisation AU12345");
  });

  it("prints the tables, the statements, the sign-off and what isn't covered", () => {
    const html = render();
    expect(html).toContain("Outdoor unit, roof");
    expect(html).toContain("MSZ-AP42VGKD2-A2");
    expect(html).toContain("40 L/s");
    expect(html).toContain("rated");
    expect(html).toContain("Each refrigerant circuit was strength and tightness tested");
    expect(html).toContain("Not covered: electrical work, certified separately under AS/NZS 3000.");
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
  });
});
