import { airPages, namesSite, pagesWords, plainWords, sheetSize, sortPdf, topicsOf, type PdfPage } from "../take-in";

const A1 = { w: 2384, h: 1684 };
const A3 = { w: 1191, h: 842 };
const A4 = { w: 595, h: 842 };
const page = (size: { w: number; h: number }, text: string): PdfPage => ({ ...size, text });
const OWN = ["Diamond Air Solutions", "Diamond Air"];
const SITE = "7 Cutler Rd\nClontarf NSW 2093";

describe("sortPdf", () => {
  /* the sorts below are the 11 November run on the real files on Isaac's Mac */
  it("knows a set of drawings by its sheets", () => {
    const set = Array.from({ length: 25 }, (_, i) => page(A1, `GROUND FLOOR CD10${i} SCALE: 1:50 @ A1 Watershed Architects`));
    expect(sortPdf(set, { own: OWN, site: SITE })).toEqual({ sort: "drawings", why: "25 sheets at A1" });
  });

  it("knows A4 drawings by the scale in their title blocks", () => {
    const set = [page(A4, "Level 1 floor plan Scale 1:100"), page(A4, "Ground floor Scale 1:100")];
    expect(sortPdf(set, { own: OWN }).sort).toBe("drawings");
  });

  it("calls a scan of big sheets drawings, and a scan of small pages unreadable", () => {
    expect(sortPdf([page(A3, ""), page(A3, " ")], { own: OWN }, )).toEqual({ sort: "drawings", why: "2 sheets at A3, scanned" });
    expect(sortPdf([page(A4, "")], { own: OWN })).toEqual({ sort: "unreadable", why: "A scan with no words to read" });
  });

  it("reads a project's specification, its broken ligatures put back", () => {
    const spec = [
      page(A4, "Tender documentation for the works"),
      page(A4, "0702 Mechanical design and install. Air condi?oning system design. Mechanical Ven6la6on to the subfloor"),
    ];
    const s = sortPdf(spec, { own: OWN, site: SITE, pageCount: 202, title: "250619 Tender Project Specification - 7 Cutler Road, Clontarf" });
    expect(s).toEqual({ sort: "spec", why: "A specification, 202 pages, that names air conditioning, ventilation and mechanical services" });
  });

  it("takes a builder's scope letter that names the job's street", () => {
    const letter = [page(A4, "Re: 7 Cutler Road, Clontarf. Please price ducted air conditioning to both levels and exhaust to the bathrooms.")];
    expect(sortPdf(letter, { own: OWN, site: SITE })).toEqual({ sort: "spec", why: "A scope, 1 page, that names air conditioning and exhaust" });
  });

  it("never takes a maker's brochure or manual as a spec, though it names the air side", () => {
    const brochure = [page(A4, "ME Zone Controller. Specifications. Ducted air conditioning zoning for Mitsubishi Electric systems")];
    expect(sortPdf(brochure, { own: OWN, site: SITE }).sort).toBe("other");
  });

  it("knows our own paperwork by our name, and anything printed from HeyTiff", () => {
    expect(sortPdf([page(A4, "Diamond Air Solutions Tax Invoice #2845A")], { own: OWN })).toEqual({ sort: "ours", why: "Our own paperwork" });
    expect(sortPdf([page(A4, "7 Cutler Rd Ground floor PEA-M125HAA ducted")], { own: OWN, site: SITE, title: "HeyTiff" })).toEqual({ sort: "ours", why: "Printed from HeyTiff" });
  });

  it("leaves a long document that only mentions us alone", () => {
    const spec = Array.from({ length: 30 }, () => page(A4, "Tender specification. Refer A/C system quoted by Diamond Air Solutions. Mechanical ventilation."));
    spec[0] = page(A4, "Tender specification, 7 Cutler Road. Refer A/C system quoted by Diamond Air Solutions.");
    expect(sortPdf(spec, { own: OWN, site: SITE }).sort).toBe("spec");
  });

  it("says why it didn't use the rest", () => {
    expect(sortPdf([page(A4, "Certificate of currency, public liability insurance, policy number 1234")], { own: OWN, site: SITE })).toEqual({ sort: "other", why: "Not drawings, a specification or a scope" });
    expect(sortPdf([], { own: OWN })).toEqual({ sort: "unreadable", why: "It has no pages to read" });
  });
});

describe("the helpers", () => {
  it("names paper sizes by their long side", () => {
    expect([842, 1191, 1684, 2384, 3370].map(sheetSize)).toEqual(["A4", "A3", "A2", "A1", "A0"]);
  });

  it("finds the air side's topics", () => {
    expect(topicsOf("Mechanical ventilation and an exhaust fan; ductwork to AS 4254")).toEqual(["ventilation", "exhaust", "ductwork", "mechanical services"]);
    expect(topicsOf("Wet area waterproofing")).toEqual([]);
  });

  it("finds a job's street in a file's words, by its number and name", () => {
    expect(namesSite("Tender set for 7 Cutler Road, Clontarf", SITE)).toBe(true);
    expect(namesSite("Tender set for 17 Cutler Road", SITE)).toBe(false);
    expect(namesSite("Anything", "")).toBe(false);
  });

  it("puts back a ligature a font lost, and nothing else", () => {
    expect(plainWords("ven?la?on, Ven6la6on, speciﬁcation")).toBe("ventilation, Ventilation, specification");
    expect(plainWords("Model R6 at 1:100, 6 m of pipe")).toBe("Model R6 at 1:100, 6 m of pipe");
  });

  it("picks the spec's air pages and the page after each", () => {
    const texts = ["Contents", "Electrical", "Air conditioning and ventilation", "clause continues", "Painting", "0702 Mechanical design and install"];
    expect(airPages(texts)).toEqual([3, 4, 6]);
  });

  it("says pages in runs", () => {
    expect(pagesWords([178, 179, 180, 185])).toBe("pages 178 to 180 and 185");
    expect(pagesWords([12])).toBe("page 12");
    expect(pagesWords([])).toBe("no pages");
  });
});
