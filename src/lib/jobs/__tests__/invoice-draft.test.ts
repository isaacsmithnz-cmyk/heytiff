import { builtFromWords, invoiceDraft, invoiceRows, lineCents, sendable, usedKey } from "../invoice-draft";

/* The invoice builder behind Price (build 10), on the invoice mock of 3
   November 2026: the hours on site at the business's own charge-out rate, a
   line a day, and what was said used at the book's cost and its markup */

const settings = { chargeOutCents: 14_000, materialMarkupPct: 40 };
const filter = { supplier: "rexel", code: "UF24", name: "Ultrafil 24x24x4", unit: null };
const base = {
  people: [
    { name: "Isaac Smith", days: [{ day: "2026-11-11", minutes: 150 }, { day: "2026-11-11", minutes: 60 }] },
    { name: "Luke Brown", days: [{ day: "2026-11-11", minutes: 210 }, { day: "2026-11-12", minutes: 90 }] },
  ],
  used: [
    { day: "2026-11-11", ...filter, qty: 1 },
    { day: "2026-11-12", ...filter, qty: 1 },
    { day: "2026-11-12", supplier: null, code: null, name: "Hydrex tablets", qty: 6, unit: null },
  ],
  costOf: (u: { code: string | null }) => (u.code === "UF24" ? { costCents: 6_353, name: "ULTRAFIL 24X24X4 FILTER" } : null),
  settings,
  quote: null,
  sent: new Set<string>(),
  invoiced: false,
  jobNumber: "3221",
};

it("charges the hours on site a line a day at the charge-out rate, who was there and for how long", () => {
  const d = invoiceDraft(base);
  if (!d.ok) throw new Error(d.why);
  const labour = d.lines.filter((l) => l.kind === "labour");
  expect(labour.map((l) => [l.name, l.detail, l.qty, l.unitSellCents])).toEqual([
    ["Labour, Wed 11 Nov", "Isaac 3.5 h, Luke 3.5 h", 7, 14_000],
    ["Labour, Thu 12 Nov", "Luke 1.5 h", 1.5, 14_000],
  ]);
  expect(lineCents(labour[0]!)).toBe(98_000);
});

it("sells what was used at the book's cost and the business's markup, added up across its days", () => {
  const d = invoiceDraft(base);
  if (!d.ok) throw new Error(d.why);
  const [filterLine, tablets] = d.lines.filter((l) => l.kind === "material");
  expect([filterLine!.name, filterLine!.detail, filterLine!.qty, filterLine!.unitCostCents, filterLine!.unitSellCents]).toEqual([
    "ULTRAFIL 24X24X4 FILTER",
    "2 used, Wed 11 Nov, Thu 12 Nov",
    2,
    6_353,
    8_894,
  ]);
  /* a thing the book has no price for is offered unpriced, and can't go */
  expect([tablets!.name, tablets!.unitSellCents, sendable(tablets!)]).toEqual(["Hydrex tablets", null, false]);
  expect(d.from).toEqual({ days: ["2026-11-11", "2026-11-12"], used: 2 });
});

it("prices nothing where the business hasn't set its rate or its markup, and says what to set", () => {
  expect(invoiceDraft({ ...base, settings: { chargeOutCents: null, materialMarkupPct: null } })).toEqual({
    ok: false,
    why: "Set a charge-out rate and a markup on materials in Quoting to price an invoice.",
  });
  expect(invoiceDraft({ ...base, settings: { chargeOutCents: 14_000, materialMarkupPct: null } })).toMatchObject({ ok: false, why: "Set a markup on materials in Quoting to price an invoice." });
});

it("invoices a job priced already at its price: no hours, only what was used beyond its own lines", () => {
  const d = invoiceDraft({ ...base, quote: { codes: ["uf24"] } });
  if (!d.ok) throw new Error(d.why);
  expect(d.lines.map((l) => l.name)).toEqual(["Hydrex tablets"]);
  expect(d.quoted).toBe(true);
  expect(builtFromWords(d.from, d.quoted)).toBe("The job's price, and 2 things used beyond it");
});

it("stands a line an earlier press sent as on the job, and never offers it again", () => {
  const d = invoiceDraft({ ...base, sent: new Set(["labour:2026-11-11", usedKey(filter)]) });
  if (!d.ok) throw new Error(d.why);
  expect(d.lines.filter((l) => l.sent).map((l) => l.key)).toEqual(["labour:2026-11-11", usedKey(filter)]);
  expect(d.lines.filter(sendable).map((l) => l.key)).toEqual(["labour:2026-11-12"]);
});

it("says what it was built from", () => {
  expect(builtFromWords({ days: ["2026-11-11", "2026-11-12"], used: 1 }, false)).toBe("Wed 11 Nov and Thu 12 Nov on site, and 1 thing used");
  expect(builtFromWords({ days: [], used: 0 }, false)).toBe("No time on site recorded, and nothing recorded as used");
});

it("queues each line chosen as a line added to the job, ex GST, after the lines already on it", () => {
  const d = invoiceDraft(base);
  if (!d.ok) throw new Error(d.why);
  const rows = invoiceRows(d.lines, { taxRateUuid: "tax-1", after: 2, rowKey: (k) => `k-${k}` });
  /* the unpriced tablets don't go */
  expect(rows.map((r) => [r.object, r.op, r.fields.name, r.fields.quantity, r.fields.price, r.fields.sort_order, r.key])).toEqual([
    ["jobmaterial", "create", "Labour, Wed 11 Nov: Isaac 3.5 h, Luke 3.5 h", "7", "140.0000", "3", "k-labour:2026-11-11"],
    ["jobmaterial", "create", "Labour, Thu 12 Nov: Luke 1.5 h", "1.5", "140.0000", "4", "k-labour:2026-11-12"],
    ["jobmaterial", "create", "ULTRAFIL 24X24X4 FILTER", "2", "88.9400", "5", `k-${usedKey(filter)}`],
  ]);
  expect(rows[2]!.fields).toMatchObject({ cost: "63.5300", displayed_amount_is_tax_inclusive: "0", tax_rate_uuid: "tax-1" });
  expect(rows[0]!.label).toBe("Invoice: line Labour, Wed 11 Nov: Isaac 3.5 h, Luke 3.5 h added");
});
