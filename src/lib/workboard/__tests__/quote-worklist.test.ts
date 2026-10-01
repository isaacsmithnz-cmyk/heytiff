/* The Quotes worklist: which group a quote is in, what to do next, and what
   was quoted — on lines and briefs as they come out of the live account. */
import type { AllJobRow } from "../all-jobs";
import { ageWords, cleanBrief, cleanLineName, quoteWorklist, summariseQuoteLines } from "../quote-worklist";

const row = (over: Partial<AllJobRow>): AllJobRow => ({
  key: `sm8:${over.number ?? "x"}`,
  kind: "sm8",
  id: String(over.number ?? "x"),
  number: "1",
  numberSystem: "sm8",
  clientName: "Client",
  title: null,
  suburb: null,
  categoryName: null,
  categoryColour: null,
  statusLabel: "Quote",
  tone: "",
  date: "2026-09-30",
  dateLabel: "quoted",
  booked: false,
  tracked: null,
  money: null,
  sortOn: "",
  quote: { lines: 0, priced: false, headline: null },
  ...over,
});

describe("what was quoted, from the lines", () => {
  it("names the system the way a person says it", () => {
    expect(cleanLineName("MITSUBISHI ELEC. DUCTED 12.5KW")).toBe("Mitsubishi ducted 12.5 kW");
    expect(cleanLineName("MITSUBISHI ELECTRIC HIGH WALL SPLIT 3.5KW (Indoor and Outdoor)")).toBe("Mitsubishi high wall split 3.5 kW");
    expect(cleanLineName("As Per Quote - 4.2kw High Wall Split")).toBe("4.2 kW high wall split");
    expect(cleanLineName("MITSUBISHI ELEC. 2PCE DUCTED 14KW Indoor and Outdoor 3PH")).toBe("Mitsubishi 2-piece ducted 14 kW indoor and outdoor 3-phase");
  });

  it("takes the system lines, biggest first, and leaves the bookkeeping out", () => {
    const s = summariseQuoteLines([
      { name: "Labour HVAC", quantity: 2, price: 1320 },
      { name: "MITSUBISHI ELECTRIC HIGH WALL SPLIT 2.5KW", quantity: 1, price: 1048 },
      { name: "MITSUBISHI ELECTRIC HIGH WALL SPLIT 4.8KW", quantity: 1, price: 1496 },
      { name: "Partial invoice #1169A", quantity: -1, price: 600 },
      { name: "PAIRED COIL 1/4+1/2", quantity: 7, price: 13.94 },
    ]);
    expect(s).toEqual({ lines: 4, priced: true, headline: "Mitsubishi high wall split 4.8 kW and 2.5 kW" });
  });

  it("says nothing when no line names a system, and knows a quote with no price", () => {
    expect(summariseQuoteLines([{ name: "As Per Quote", quantity: 1, price: 9000 }])).toEqual({ lines: 1, priced: true, headline: null });
    expect(summariseQuoteLines([])).toEqual({ lines: 0, priced: false, headline: null });
    expect(summariseQuoteLines([{ name: "Daikin 10kw multi", quantity: 1, price: 0 }]).priced).toBe(false);
  });
});

describe("what was quoted, from the brief", () => {
  it("takes the forward, the greeting and the contact details off, and keeps a line", () => {
    expect(cleanBrief("Fw: Mitsubishi Electric Australia - Lead accepted: Andrew Kealy 2 story need to discuss")).toBe("2 story need to discuss");
    expect(cleanBrief("Hi Luke (0457 301 636), Hope you're well. We'd like a quote")).toBe("We'd like a quote");
    expect(cleanBrief("Jessica Louise Hardy and 0419 143 037. OPTION 1")).toBe("Jessica Louise Hardy");
    expect(cleanBrief("Supply and Install: 4.2KW high wall split")).toBe("4.2KW high wall split");
    expect(cleanBrief(null)).toBeNull();
    expect(cleanBrief("x".repeat(200))!.length).toBeLessThanOrEqual(91);
  });
});

describe("the groups", () => {
  const today = "2026-10-01";
  const priced = { lines: 6, priced: true, headline: "Mitsubishi ducted 12.5 kW" };
  const w = quoteWorklist(
    [
      row({ number: "1", date: "2026-09-30" }),
      row({ number: "2", date: "2026-09-28", quote: priced }),
      row({ number: "3", date: "2026-09-20", quote: priced }),
      row({ number: "4", date: "2026-09-05", quote: priced }),
      row({ number: "5", date: "2026-07-01", quote: priced }),
      row({ number: "6", date: "2025-01-01", quote: priced }),
      row({ number: "7", date: "2024-05-30" }),
    ],
    today
  );
  const of = (n: string) => Object.values(w.groups).flat().find((i) => i.row.number === n)!;

  it("files each quote by price and age", () => {
    expect(Object.fromEntries(Object.entries(w.groups).map(([k, v]) => [k, v.map((i) => i.row.number)]))).toEqual({
      price: ["1"],
      wait: ["2", "3", "4"],
      cold: ["5"],
      stale: ["6", "7"],
    });
    expect(w.stale).toEqual({ count: 2, oldest: "2024-05-30", neverPriced: 1 });
  });

  it("says what's next: start it, follow up at 7 and 21 days, chase or close", () => {
    expect(of("1").next).toEqual({ word: "Start quote", tone: "info" });
    expect(of("2").next).toEqual({ word: "Follow up", tone: "", on: "2026-10-05" });
    expect(of("3").next).toEqual({ word: "Follow up", tone: "warn" });
    expect(of("4").next).toEqual({ word: "Follow up again", tone: "warn" });
    expect(of("5").next).toEqual({ word: "Chase or close", tone: "warn" });
  });

  it("reads what was quoted off the lines, else the brief", () => {
    expect(of("2").what).toBe("Mitsubishi ducted 12.5 kW");
    expect(quoteWorklist([row({ title: "Fw: RFQ - 27 Milroy Avenue" })], today).groups.price[0]!.what).toBe("RFQ - 27 Milroy Avenue");
  });

  it("counts age in plain words", () => {
    expect([ageWords(0), ageWords(1), ageWords(12)]).toEqual(["Today", "1 day", "12 days"]);
  });
});
