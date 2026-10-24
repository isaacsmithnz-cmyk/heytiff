/* Billing, ex GST (Isaac, 25 October 2026: "Figures need to be clearly
   excluding GST"). The rule that matters: every ex-GST figure is ServiceM8's
   own ex-GST price, and where one isn't known the section says what it does
   know on its own basis, never a figure divided by 1.1. */

import { deriveFamilyMoney, wholePercents, type FamilyMemberFacts } from "@/lib/workboard/job-family";
import { claimLine, readBilling, variationNumberOf, variationsOf } from "@/lib/workboard/job-billing";
import { variationLineName } from "@/lib/quotes/sm8-variation-plan";

const member = (over: Partial<FamilyMemberFacts> & Pick<FamilyMemberFacts, "remoteId" | "jobNumber">): FamilyMemberFacts => ({
  totalCents: null,
  paidCents: 0,
  lastPaidOn: null,
  lines: null,
  raisedOn: null,
  ...over,
});

/* #3237 as the live mirror holds it */
const chandra = (termsDays: number | null = 14, over: FamilyMemberFacts[] = []) =>
  deriveFamilyMoney({
    members: over.length
      ? over
      : [
          member({ remoteId: "p", jobNumber: "3237", totalCents: 866800, lines: { cents: 788000, taxInclusive: false }, exCents: 788000 }),
          member({ remoteId: "a", jobNumber: "3237A", totalCents: 650100, paidCents: 650100, lastPaidOn: "2026-09-11", lines: { cents: 591000, taxInclusive: false }, exCents: 591000, raisedOn: "2026-08-31" }),
          member({ remoteId: "b", jobNumber: "3237B", totalCents: 650100, lines: { cents: 591000, taxInclusive: false }, exCents: 591000, raisedOn: "2026-09-15" }),
        ],
    today: "2026-10-24",
    termsDays,
  });

const view = (family = chandra(), statusLabel = "Work Order") =>
  readBilling({ family, money: null, ledgerPaidCents: 0, statusLabel });

describe("readBilling on #3237", () => {
  it("says the job's value and the three parts ex GST", () => {
    const v = view();
    expect(v.value).toEqual({ cents: 1970000, basis: "ex" });
    expect(v.figures).toEqual({ paid: 591000, waiting: 591000, tocome: 788000 });
    expect(v.segments?.map((s) => [s.key, s.percent])).toEqual([
      ["paid", 30],
      ["waiting", 30],
      ["tocome", 40],
    ]);
    expect(v.staged).toBe(true);
  });

  it("names each claim as the trade does, with one word for where it stands", () => {
    const rows = view().rows.map((r) => [r.name, r.line, r.cents, r.basis, r.word.replace("Sept", "Sep"), r.tone]);
    expect(rows).toEqual([
      ["Deposit, 30%", "Invoice #3237A", 591000, "ex", "Paid Fri 11 Sep", "good"],
      ["Progress, 30%", expect.stringMatching(/^Invoice #3237B, due Tue 29 Sept?$/), 591000, "ex", "25 days overdue", "wrong"],
      ["Final, 40%", "Not invoiced yet", 788000, "ex", "To come", "info"],
    ]);
  });

  it("says Awaiting, with no due date, while the terms are unset", () => {
    const progress = view(chandra(null)).rows[1];
    expect(progress.line).toBe("Invoice #3237B");
    expect([progress.word, progress.tone]).toEqual(["Awaiting", "look"]);
  });

  it("says the claim's own line for its dialog", () => {
    const f = chandra();
    const v = readBilling({ family: f, money: null, ledgerPaidCents: 0, statusLabel: "Work Order" });
    expect(claimLine(f.claims[1], v.rows[1], true)).toMatch(
      /^Invoice #3237B, 30% of the job\. Raised Tue 15 Sept?, due Tue 29 Sept?\.$/
    );
    expect(claimLine(f.claims[0], v.rows[0], true)).toMatch(/^Invoice #3237A, 30% of the job\. Raised Mon 31 Aug, paid Fri 11 Sept?\.$/);
    expect(claimLine(f.claims[2], v.rows[2], true)).toBe("Not invoiced yet.");
  });
});

describe("readBilling when a figure isn't known ex GST", () => {
  it("falls back to the family's own total, on its basis, and labels each row", () => {
    const f = chandra(14, [
      member({ remoteId: "p", jobNumber: "3237", totalCents: 866800 }),
      member({ remoteId: "a", jobNumber: "3237A", totalCents: 650100, paidCents: 650100, lastPaidOn: "2026-09-11", raisedOn: "2026-08-31" }),
    ]);
    const v = view(f);
    expect(v.value).toEqual({ cents: 1516900, basis: "inc" });
    expect(v.rows.map((r) => [r.cents, r.basis])).toEqual([
      [650100, "inc"],
      [866800, "inc"],
    ]);
  });

  it("leaves paid and waiting unknown on a part-paid claim, and draws no bar", () => {
    const f = chandra(null, [
      member({ remoteId: "p", jobNumber: "2968", totalCents: 279400, paidCents: 100000, lines: { cents: 254000, taxInclusive: false }, exCents: 254000, raisedOn: "2026-08-01" }),
    ]);
    const v = view(f);
    expect(v.figures).toEqual({ paid: null, waiting: null, tocome: 0 });
    expect(v.segments).toBeNull();
    expect(v.rows[0]).toMatchObject({ name: "Invoice", line: "Invoice #2968, $1,000 inc GST paid", word: "Part paid", cents: 254000 });
  });

  it("says a quote's own words, not Awaiting, on a quote with an invoice date (#3169)", () => {
    const f = chandra(null, [member({ remoteId: "q", jobNumber: "3169", totalCents: 401500, raisedOn: "2026-08-10" })]);
    const v = readBilling({
      family: f,
      money: { valueCents: 401500, invoiced: null, invoicedOn: null, quoteSent: true, quoteSentOn: "2026-08-03", paid: false, paidOn: null },
      ledgerPaidCents: 0,
      statusLabel: "Quote",
    });
    expect(v.rows[0]).toMatchObject({ line: "Quote sent Mon 3 Aug", word: "To come" });
  });

  it("with no family read, says the job's labelled total and where collection stands", () => {
    const v = readBilling({
      family: null,
      money: { valueCents: 279400, invoiced: null, invoicedOn: null, quoteSent: null, quoteSentOn: null, paid: false, paidOn: null },
      ledgerPaidCents: 100000,
      statusLabel: "Work Order",
    });
    expect(v.value).toEqual({ cents: 279400, basis: "inc" });
    expect(v.rows).toEqual([]);
    expect(v.fact).toBe("Part paid, $1,794 inc GST still out");
  });
});

describe("variations", () => {
  it("reads the name an accepted variation's lines go to ServiceM8 under", () => {
    expect(variationNumberOf(variationLineName(2, "Return grille, Bed 2"))).toBe(2);
    expect(variationNumberOf("Variation 12: extra")).toBe(12);
    expect(variationNumberOf("Variations to come")).toBeNull();
    expect(variationNumberOf("Ac multi and bulkhead")).toBeNull();
  });

  it("sums each variation's lines, and gives up on one it can't price", () => {
    expect(
      variationsOf([
        { name: "Variation 2: b", exLineCents: 86000 },
        { name: "Variation 1: a", exLineCents: 100000 },
        { name: "Variation 1: c", exLineCents: 45000 },
        { name: "Quote", exLineCents: 1970000 },
      ])
    ).toEqual([
      { n: 1, cents: 145000 },
      { n: 2, cents: 86000 },
    ]);
    expect(variationsOf([{ name: "Variation 1: a", exLineCents: null }])).toBeNull();
  });

  it("puts the quote's own figure in the box when the job has variations", () => {
    const v = readBilling({
      family: chandra(),
      money: null,
      ledgerPaidCents: 0,
      statusLabel: "Work Order",
      lines: [{ name: "Variation 1: return grille", exLineCents: 145000 }],
    });
    expect(v.quoted).toEqual({ cents: 1825000, variations: [{ n: 1, cents: 145000 }] });
  });
});

describe("wholePercents", () => {
  it("adds up to 100 by largest remainder", () => {
    expect(wholePercents([1, 1, 1], 3)).toEqual([34, 33, 33]);
    expect(wholePercents([591000, 591000, 788000], 1970000)).toEqual([30, 30, 40]);
    expect(wholePercents([5, null], null)).toEqual([null, null]);
  });
});
