/* The ticket that lets a headless browser print one design, and the options
   a browser may ask for. The print page trusts nothing else. */

import { pdfFileName, readPdfOptions, readPdfTicket, signPdfTicket } from "../pdf-request";

const OLD = process.env.AUTH0_SECRET;
beforeAll(() => {
  process.env.AUTH0_SECRET = "test-secret-that-is-long-enough-for-hmac";
});
afterAll(() => {
  process.env.AUTH0_SECRET = OLD;
});

const ticket = () => ({
  orgId: "org_1",
  designId: "dsn_1",
  options: readPdfOptions({ sections: { picklist: false } }, "dsn_1"),
});

describe("the ticket", () => {
  it("reads back what was signed", () => {
    const t = ticket();
    expect(readPdfTicket(signPdfTicket(t))).toEqual(t);
  });

  it("refuses one that was altered", () => {
    const [body, sig] = signPdfTicket(ticket()).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), orgId: "org_2" })
    ).toString("base64url");
    expect(readPdfTicket(`${forged}.${sig}`)).toBeNull();
  });

  it("refuses one past its two minutes", () => {
    const now = Date.now();
    const tok = signPdfTicket(ticket(), now);
    expect(readPdfTicket(tok, now + 60_000)).not.toBeNull();
    expect(readPdfTicket(tok, now + 121_000)).toBeNull();
  });

  it("refuses nothing, junk and a different key", () => {
    expect(readPdfTicket(undefined)).toBeNull();
    expect(readPdfTicket("junk")).toBeNull();
    const tok = signPdfTicket(ticket());
    process.env.AUTH0_SECRET = "another-secret-entirely-for-this-test";
    expect(readPdfTicket(tok)).toBeNull();
    process.env.AUTH0_SECRET = "test-secret-that-is-long-enough-for-hmac";
  });
});

describe("what a browser may ask for", () => {
  it("keeps the ticks and puts the open design first, once", () => {
    const o = readPdfOptions(
      { sections: { picklist: false, lines: false }, variantIds: ["dsn_b", "dsn_1", "dsn_b"], paper: "A3" },
      "dsn_1"
    );
    expect(o.sections).toEqual({ figures: true, systems: true, lines: false, picklist: false });
    expect(o.variantIds).toEqual(["dsn_1", "dsn_b"]);
    expect(o.paper).toBe("A3");
  });

  it("drops anything it doesn't recognise", () => {
    const o = readPdfOptions({ paper: "Letter", orientation: 7, floorIds: [1, "f1", ""] }, "dsn_1");
    expect(o.paper).toBe("A4");
    expect(o.orientation).toBe("portrait");
    expect(o.floorIds).toEqual(["f1"]);
  });

  it("names the file safely", () => {
    expect(pdfFileName('85 West St / "Option B"')).toBe("85 West St Option B .pdf".replace(" .pdf", ".pdf"));
    expect(pdfFileName("")).toBe("Design.pdf");
  });
});
