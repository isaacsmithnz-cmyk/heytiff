import { brandOf, imprintPatch, looksLikeFileName, shapeImprint } from "../imprint";

/* What Tiff reads off a cover is kept only when the page says it, and is
   written only where nobody has typed anything. */
const COVER = `MITSUBISHI ELECTRIC
PUMY-SP-VKMD2/YKMD2-A, PUMY-P-YKMD2/YBMD-A
DATA BOOK
M-P0860 (Oct 2022)`;

describe("a document's maker and edition, off its cover", () => {
  it("keeps what is printed", () => {
    expect(shapeImprint({ maker: "Mitsubishi Electric", edition: "M-P0860 (Oct 2022)" }, COVER)).toMatchObject({
      maker: "Mitsubishi Electric",
      edition: "M-P0860 (Oct 2022)",
    });
  });

  it("drops a guess the page doesn't print", () => {
    expect(shapeImprint({ maker: "Daikin", edition: "2025" }, COVER)).toMatchObject({ maker: null, edition: null });
  });

  it("drops a sentence, and an empty answer", () => {
    expect(shapeImprint({ maker: "", edition: "x".repeat(80) }, COVER)).toMatchObject({ maker: null, edition: null });
    expect(shapeImprint(null, COVER)).toMatchObject({ maker: null, edition: null, title: null, shelf: null, issued: null });
  });

  it("writes only into a field nobody has filled", () => {
    const found = { maker: "Mitsubishi Electric", edition: "M-P0860 (Oct 2022)" };
    expect(imprintPatch({ source: null, edition: null }, found)).toEqual({ source: "Mitsubishi Electric", edition: "M-P0860 (Oct 2022)" });
    expect(imprintPatch({ source: "ME Australia", edition: "" }, found)).toEqual({ edition: "M-P0860 (Oct 2022)" });
    expect(imprintPatch({ source: "ME", edition: "2024" }, found)).toEqual({});
  });
});

/* 24 November 2026 ("you cant fix theirs"): what one Library had fixed by hand,
   every Library's reading now does — the title off the cover instead of the
   file name, a maker the cover prints over one it doesn't, the shelf, and the
   date it prints. */
const FUJITSU = `SPLIT TYPE AIR CONDITIONER DUCT TYPE (50Hz) Indoor unit Outdoor unit
ARTC36LCTU ARTC45LCTU ARTC60LCTU AOTD36LATT AOTD45LATT AOTD60LATT
CONTENTS SPECIFICATIONS 1 FUJITSU GENERAL LIMITED 2009.01.15`;

describe("what the document is, off its cover", () => {
  it("keeps a title whose model numbers are all on the page", () => {
    const found = shapeImprint(
      { maker: "Fujitsu", edition: "", title: "ARTC36/45/60LCTU and AOTD36/45/60LATT ducted service manual", shelf: "service", issued: "2009.01.15" },
      FUJITSU
    );
    expect(found.title).toBe("ARTC36/45/60LCTU and AOTD36/45/60LATT ducted service manual");
    expect(found.shelf).toBe("service");
    expect(found.issued).toBe("2009.01.15");
  });

  it("drops a title with a model number the page doesn't print, and a shelf that isn't one", () => {
    const found = shapeImprint({ maker: "", edition: "", title: "ARTC72LCTU ducted service manual", shelf: "manuals", issued: "" }, FUJITSU);
    expect(found.title).toBeNull();
    expect(found.shelf).toBeNull();
  });

  it("knows a title that is still a file name", () => {
    expect(looksLikeFileName("Service Manual artg45 54lhta", "service-manual---artg45_54lhta.pdf")).toBe(true);
    expect(looksLikeFileName("ARTG45_54LHTA SM", null)).toBe(true);
    expect(looksLikeFileName("Fault Code Summary-1434520928", null)).toBe(true);
    expect(looksLikeFileName("artg45_54lhtb-artg60lhta-service-manuale901aeeb348f4fc6", null)).toBe(true);
    expect(looksLikeFileName("Daikin RZA R32 Ducted", "704597318-Service-Manual.pdf")).toBe(false);
  });

  it("writes the cover's title over a file name, never over one somebody wrote", () => {
    const found = { maker: "Fujitsu", edition: null, title: "ARTG45/54LHTA and AOTG45/54LATL ducted service manual", shelf: null, issued: null };
    expect(imprintPatch({ source: "Fujitsu", edition: "x", title: "Service Manual artg45 54lhta", file_name: "service-manual---artg45_54lhta.pdf" }, found, "FUJITSU").title).toBe(
      "ARTG45/54LHTA and AOTG45/54LATL ducted service manual"
    );
    expect(imprintPatch({ source: "Fujitsu", edition: "x", title: "Big ducted unit manual", file_name: "service-manual---artg45_54lhta.pdf" }, found, "FUJITSU").title).toBeUndefined();
  });

  it("puts the maker the cover prints over one it doesn't print at all", () => {
    const found = { maker: "Daikin", edition: null };
    expect(imprintPatch({ source: "Samsung", edition: "x" }, found, "DAIKIN SkyAir VRV malfunction codes").source).toBe("Daikin");
    expect(imprintPatch({ source: "Daikin Australia", edition: "x" }, found, "DAIKIN AUSTRALIA PTY LTD").source).toBeUndefined();
  });

  it("moves the shelf off the file name's guess and off Company SOPs, never onto it", () => {
    const service = { maker: "Fujitsu", edition: null, shelf: "service" as const };
    // "PFC testing.pdf" has no shelf words, so the drawer guessed specs
    expect(imprintPatch({ source: null, edition: null, category: "specs", file_name: "PFC testing.pdf" }, service, "FUJITSU").category).toBe("faults");
    expect(imprintPatch({ source: "Fujitsu", edition: null, category: "sops", file_name: "PFC testing.pdf" }, service, "FUJITSU").category).toBe("faults");
    // somebody chose install for a file the drawer would have called specs: theirs stands
    expect(imprintPatch({ source: null, edition: null, category: "install", file_name: "PFC testing.pdf" }, service, "FUJITSU").category).toBeUndefined();
    // the cover never sends anything to Company SOPs
    expect(imprintPatch({ source: null, edition: null, category: "specs", file_name: "x.pdf" }, { maker: null, edition: null, shelf: "company" }, "").category).toBeUndefined();
  });
});

describe("the brand, not the company", () => {
  it("cuts the company words and writes capitals as a name", () => {
    expect(brandOf("Daikin Industries Czech Republic s.r.o.")).toBe("Daikin");
    expect(brandOf("Mitsubishi Electric Corporation")).toBe("Mitsubishi Electric");
    expect(brandOf("FUJITSU GENERAL LIMITED")).toBe("Fujitsu");
    expect(brandOf("Fujitsu General (Aust.) Pty Ltd")).toBe("Fujitsu");
    expect(brandOf("Daikin Australia Pty Ltd")).toBe("Daikin");
    expect(brandOf("temperzone")).toBe("temperzone");
    expect(brandOf(null)).toBeNull();
  });
});
