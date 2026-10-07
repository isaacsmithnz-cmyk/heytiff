import { pageOfPart, pdfPageCount } from "../send-viewer";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("how many pages a PDF has", () => {
  it("reads the page tree's count — the root's is the largest", () => {
    expect(pdfPageCount(bytes("<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> << /Type /Pages /Count 5 >>"))).toBe(5);
  });

  it("says nothing when the file does not", () => {
    expect(pdfPageCount(bytes("%PDF-1.7 stream x"))).toBeNull();
  });
});

describe("the page a preview opens at", () => {
  it("opens the sheet at the front", () => {
    expect(pageOfPart({ kind: "sheet" }, { total: 6, floors: 2, copies: 1 })).toBe(1);
  });

  it("counts a floor's plan back from the end of the copy, however long the sheet ran", () => {
    // a three-page sheet, then two floors
    expect(pageOfPart({ kind: "plan", index: 0 }, { total: 5, floors: 2, copies: 1 })).toBe(4);
    expect(pageOfPart({ kind: "plan", index: 1 }, { total: 5, floors: 2, copies: 1 })).toBe(5);
    // no sheet ticked: the plans are the whole file
    expect(pageOfPart({ kind: "plan", index: 1 }, { total: 2, floors: 2, copies: 1 })).toBe(2);
  });

  it("lands in the first copy when the design's options go with it", () => {
    // two copies of a two-page sheet and one floor
    expect(pageOfPart({ kind: "plan", index: 0 }, { total: 6, floors: 1, copies: 2 })).toBe(3);
  });

  it("opens at the top when the count is unknown", () => {
    expect(pageOfPart({ kind: "plan", index: 1 }, { total: null, floors: 2, copies: 1 })).toBe(1);
  });
});
