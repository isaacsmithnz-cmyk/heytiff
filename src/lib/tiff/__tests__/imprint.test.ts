import { imprintPatch, shapeImprint } from "../imprint";

/* What Tiff reads off a cover is kept only when the page says it, and is
   written only where nobody has typed anything. */
const COVER = `MITSUBISHI ELECTRIC
PUMY-SP-VKMD2/YKMD2-A, PUMY-P-YKMD2/YBMD-A
DATA BOOK
M-P0860 (Oct 2022)`;

describe("a document's maker and edition, off its cover", () => {
  it("keeps what is printed", () => {
    expect(shapeImprint({ maker: "Mitsubishi Electric", edition: "M-P0860 (Oct 2022)" }, COVER)).toEqual({
      maker: "Mitsubishi Electric",
      edition: "M-P0860 (Oct 2022)",
    });
  });

  it("drops a guess the page doesn't print", () => {
    expect(shapeImprint({ maker: "Daikin", edition: "2025" }, COVER)).toEqual({ maker: null, edition: null });
  });

  it("drops a sentence, and an empty answer", () => {
    expect(shapeImprint({ maker: "", edition: "x".repeat(80) }, COVER)).toEqual({ maker: null, edition: null });
    expect(shapeImprint(null, COVER)).toEqual({ maker: null, edition: null });
  });

  it("writes only into a field nobody has filled", () => {
    const found = { maker: "Mitsubishi Electric", edition: "M-P0860 (Oct 2022)" };
    expect(imprintPatch({ source: null, edition: null }, found)).toEqual({ source: "Mitsubishi Electric", edition: "M-P0860 (Oct 2022)" });
    expect(imprintPatch({ source: "ME Australia", edition: "" }, found)).toEqual({ edition: "M-P0860 (Oct 2022)" });
    expect(imprintPatch({ source: "ME", edition: "2024" }, found)).toEqual({});
  });
});
