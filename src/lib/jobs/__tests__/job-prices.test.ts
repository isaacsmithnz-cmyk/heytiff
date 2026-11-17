import { firstCard, invoicePaperOf, priceCards, type QuoteRead } from "../job-prices";
import type { QuoteFacts } from "@/lib/quotes/quote-card";
import type { PaymentRow } from "@/lib/workboard/job-billing";
import type { JobMediaItem } from "@/lib/workboard/job-media";

/* Every price on a job as a card across the top of its Price tab (the job
   page plan's build 10, on the Price Tab mock drawn on 3408) */

const WHEN = { day: (d: string) => `day ${d}`, time: (at: string) => `at ${at}` };
const facts = (over: Partial<QuoteFacts> = {}): QuoteFacts => ({
  lines: 4,
  options: 1,
  toConfirm: 0,
  changedAt: null,
  talked: true,
  drafted: false,
  approved: false,
  version: 1,
  sent: null,
  accepted: [],
  ...over,
});
const quote = (over: Partial<QuoteFacts> = {}, total: number | null = 77_500): QuoteRead => ({
  facts: facts(over),
  landing: { name: "Return visit", startedAt: null, who: null, approvedBy: null, acceptedAt: null, totalCents: total, money: total !== null, versions: [], variations: [] },
});
const row = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  claimId: "j-3408",
  name: "Invoice",
  line: "Invoice #3408, due Wed 25 Nov",
  percent: 100,
  cents: 35_000,
  basis: "ex",
  word: "Awaiting",
  tone: "look",
  ...over,
});
const doc = (over: Partial<JobMediaItem> = {}): JobMediaItem => ({
  remoteId: "d-1",
  name: "Diamond Air Solutions Pty LTD Invoice #3408",
  fileType: ".pdf",
  kind: "document",
  origin: "Invoice",
  takenAt: "2026-11-11 09:00:00",
  url: "https://files.example/3408.pdf",
  width: null,
  height: null,
  fromClaim: null,
  ...over,
});
const none = { papers: [], sentOn: null, value: null };

describe("the cards", () => {
  it("draws 3408 as the mock has it: the quote, then the invoice saying what Billing's row says", () => {
    const cards = priceCards({
      quote: quote({ sent: { at: "2026-11-11T01:00:00Z", trial: false } }),
      sm8: none,
      rows: [row()],
      claims: [{ remoteId: "j-3408", jobNumber: "3408", state: "awaiting" }],
      staged: false,
      when: WHEN,
    });
    expect(cards.map((c) => [c.label, c.name, c.figure, c.state?.word])).toEqual([
      ["Quote", "Return visit", "$775.00 ex GST", "Waiting for the client"],
      /* owed said one way: Billing's figure, ex GST, and its word */
      ["Invoice #3408", "The job's invoice", "$350 ex GST", "Awaiting"],
    ]);
  });

  it("labels an invoice's figure inc GST where ServiceM8 never itemised it, and works nothing out", () => {
    const [card] = priceCards({ quote: null, sm8: none, rows: [row({ cents: 38_500, basis: "inc" })], claims: [{ remoteId: "j-3408", jobNumber: "3408", state: "awaiting" }], staged: false, when: WHEN });
    expect(card!.figure).toBe("$385 inc GST");
  });

  it("shows no invoice without the money, and none for a claim still to come", () => {
    const claims = [
      { remoteId: "c-a", jobNumber: "2380A", state: "paid" as const },
      { remoteId: "c-b", jobNumber: "2380B", state: "not_invoiced" as const },
    ];
    const rows = [row({ claimId: "c-a", name: "Deposit, 30%", word: "Paid Fri 11 Sept", tone: "good" }), row({ claimId: "c-b", name: "Final, 70%", word: "To come", tone: "info" })];
    expect(priceCards({ quote: quote(), sm8: none, rows: null, claims: null, staged: true, when: WHEN }).map((c) => c.kind)).toEqual(["quote"]);
    const staged = priceCards({ quote: quote(), sm8: none, rows, claims, staged: true, when: WHEN });
    expect(staged.map((c) => [c.label, c.name])).toEqual([
      ["Quote", "Return visit"],
      ["Invoice #2380A", "Deposit, 30%"],
    ]);
  });

  it("gives a quote with no figure for whoever doesn't see its money", () => {
    const [card] = priceCards({ quote: quote({}, null), sm8: none, rows: null, claims: null, staged: false, when: WHEN });
    expect(card!.figure).toBeNull();
  });

  it("stands ServiceM8's own quote in for one never built here, with no chat behind it", () => {
    const cards = priceCards({ quote: quote({ lines: 0, talked: false }), sm8: { papers: [doc({ origin: "Quote", name: "Quote #3408" })], sentOn: "2026-11-11", value: "$775 ex GST" }, rows: null, claims: null, staged: false, when: WHEN });
    expect(cards).toEqual([
      { key: "sm8-quote", kind: "sm8-quote", label: "Quote, in ServiceM8", name: "ServiceM8's quote", figure: "$775 ex GST", state: { word: "Sent day 2026-11-11", tone: "info" } },
    ]);
  });

  it("holds a new quote's card while it's briefed, and nothing for a job with no price at all", () => {
    expect(priceCards({ quote: quote({ lines: 0, talked: false }), sm8: none, rows: null, claims: null, staged: false, when: WHEN })).toEqual([]);
    const [card] = priceCards({ quote: quote({ lines: 0, talked: false }), sm8: none, rows: null, claims: null, staged: false, starting: true, when: WHEN });
    expect([card!.name, card!.state?.word]).toEqual(["New quote", "Brief, with Tiff"]);
  });

  it("says an accepted quote is accepted", () => {
    const [card] = priceCards({ quote: quote({ accepted: [0] }), sm8: none, rows: null, claims: null, staged: false, when: WHEN });
    expect(card!.state).toEqual({ word: "Customer accepted", tone: "good" });
  });
});

describe("the card it opens on", () => {
  const cards = priceCards({
    quote: quote(),
    sm8: none,
    rows: [row({ claimId: "c-a" }), row({ claimId: "c-b" })],
    claims: [
      { remoteId: "c-a", jobNumber: "2380A", state: "paid" },
      { remoteId: "c-b", jobNumber: "2380B", state: "awaiting" },
    ],
    staged: true,
    when: WHEN,
  });
  it("opens on the invoice asked for, in any case, else the quote", () => {
    expect(firstCard(cards, "C-B")).toBe("invoice:c-b");
    expect(firstCard(cards, "nobody")).toBe("quote");
    expect(firstCard(cards, null)).toBe("quote");
  });
  it("opens on the newest invoice where there's no quote", () => {
    expect(firstCard(cards.filter((c) => c.kind === "invoice"), null)).toBe("invoice:c-b");
    expect(firstCard([], null)).toBeNull();
  });
});

describe("an invoice's paper", () => {
  it("is the newest PDF ServiceM8 made for it, else one named an invoice, else none", () => {
    const older = doc({ remoteId: "old", takenAt: "2026-11-01 09:00:00" });
    const newer = doc({ remoteId: "new" });
    expect(invoicePaperOf([older, newer])?.remoteId).toBe("new");
    expect(invoicePaperOf([doc({ origin: null, remoteId: "named" })])?.remoteId).toBe("named");
    expect(invoicePaperOf([doc({ origin: null, name: "Site photo", fileType: ".jpg" })])).toBeNull();
  });
});
