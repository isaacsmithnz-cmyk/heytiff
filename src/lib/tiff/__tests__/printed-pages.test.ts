import { pageSpan, printedPageOffset, printedSpan } from "../printed-pages";

/* bug 85, 24 November 2026: a service manual whose printed numbers run six
   pages behind its file, the header shape as the Library reads it. */
const header = (file: number, printed: number, body: string) =>
  file % 2
    ? { page: file, text: `SiAU282005EA Check Part 6 Service Diagnosis ${printed} ${body}` }
    : { page: file, text: `Check SiAU282005EA ${printed} Part 6 Service Diagnosis ${body}` };

/** Noise a real page carries: steps, temperatures, part counts. */
const noise = (n: number) => `1 Is the fan running? 2 Check 25 °C and ${40 + (n % 30)} kΩ, ${n % 7} screws`;

describe("the book's printed page numbers", () => {
  it("finds the steady difference between the file's pages and the printed ones", () => {
    const pages = Array.from({ length: 40 }, (_, i) => header(240 + i, 234 + i, noise(i)));
    expect(printedPageOffset(pages)).toBe(6);
  });

  it("finds a footer printed as '- 7 -'", () => {
    const pages = Array.from({ length: 20 }, (_, i) => ({ page: 4 + i, text: `[ II Part Names ] - ${1 + i} - HWE1902A GB ${noise(i)}` }));
    expect(printedPageOffset(pages)).toBe(3);
  });

  it("a book numbered as its file is says 0", () => {
    const pages = Array.from({ length: 20 }, (_, i) => ({ page: 1 + i, text: `${noise(i)} ${1 + i}` }));
    expect(printedPageOffset(pages)).toBe(0);
  });

  it("says nothing on too few pages, or where no difference stands out", () => {
    expect(printedPageOffset([])).toBeNull();
    expect(printedPageOffset(Array.from({ length: 5 }, (_, i) => header(240 + i, 234 + i, "")))).toBeNull();
    const unnumbered = Array.from({ length: 30 }, (_, i) => ({ page: 1 + i, text: `Figure ${(i * 7) % 13} shows ${(i * 11) % 17} parts` }));
    expect(printedPageOffset(unnumbered)).toBeNull();
  });

  it("labels the file's pages, and the printed ones only where they differ", () => {
    expect(pageSpan(280, 280)).toBe("280");
    expect(pageSpan(280, 281)).toBe("280–281");
    expect(printedSpan(280, 280, 6)).toBe("274");
    expect(printedSpan(280, 281, 6)).toBe("274–275");
    expect(printedSpan(280, 280, 0)).toBeNull();
    expect(printedSpan(280, 280, null)).toBeNull();
    // the cover and contents, ahead of the book's page 1, have no printed number
    expect(printedSpan(2, 3, 6)).toBeNull();
    expect(printedSpan(5, 8, 6)).toBe("1–2");
  });
});
