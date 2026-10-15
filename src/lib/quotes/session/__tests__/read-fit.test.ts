/* A read of a long quote fits what a tool can hand her, and says what it left
   out (the bench, 15 October: 2043's 175 lines were cut mid-line at 20,000
   characters, so she never saw the half of her own quote). */
import { fitRead, READ_BUDGET, type OptionRead } from "../read-fit";

const line = (i: number, why = "w") => ({ id: `l${i}`, version: 1, system: "Ducted", group: "Ductwork", name: `Item ${i}`, code: null, kind: "material", qty: 1, unit: "each", cost_each_cents: 100, source: "assumed", why });
const option = (n: number, count: number, why?: string): OptionRead => ({ option: n, total_ex_gst_cents: 1000 * (n + 1), still_to_price: [`Grille ${n}`], lines: Array.from({ length: count }, (_, i) => line(i, why)) });
const fits = (v: unknown) => JSON.stringify(v).length <= READ_BUDGET;

describe("a read of the quote that fits", () => {
  it("is the quote as it is when it fits", () => {
    const small = [option(0, 3), option(1, 3)];
    expect(fitRead(small)).toBe(small);
  });

  it("narrows a long quote to one option's lines, every option's total and what's still to price kept", () => {
    const out = fitRead([option(0, 40), option(1, 40)], {}, 10_000);
    expect(out[0]!.lines).toHaveLength(40);
    expect(out[1]).toMatchObject({ total_ex_gst_cents: 2000, still_to_price: ["Grille 1"], lines_not_shown: 40, read_with: { option: 1 } });
    expect(out[1]!.lines).toBeUndefined();
    const second = fitRead([option(0, 40), option(1, 40)], { option: 1 }, 10_000);
    expect(second[1]!.lines).toHaveLength(40);
    expect(second[0]).toMatchObject({ lines_not_shown: 40 });
  });

  it("drops a line's empty fields and shortens its why before it pages", () => {
    const out = fitRead([option(0, 20, "x".repeat(400))], { option: 0 }, 6000);
    const lines = out[0]!.lines as Record<string, unknown>[];
    expect(out[0]!.whys_shortened).toBe(true);
    expect(lines).toHaveLength(20);
    expect((lines[0]!.why as string).length).toBeLessThanOrEqual(80);
    expect(lines[0]).not.toHaveProperty("code");
  });

  it("pages a very long option, each page fitting, every line read once", () => {
    const big = [option(0, 400, "y".repeat(200)), option(1, 5)];
    const seen: string[] = [];
    let from: number | undefined = 0;
    let pages = 0;
    while (from != null && pages < 50) {
      const out = fitRead(big, { option: 0, from });
      expect(fits(out)).toBe(true);
      expect(out[1]).toMatchObject({ lines_not_shown: 5 });
      seen.push(...(out[0]!.lines as { id: string }[]).map((l) => l.id));
      from = out[0]!.read_more_from as number | undefined;
      pages++;
    }
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual(big[0]!.lines.map((l) => l.id));
  });
});
