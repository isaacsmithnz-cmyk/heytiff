import { priceBuildUp } from "../buildup";
import { normaliseDraft } from "../proposal";
import { byHandOf, variationInSm8, type Variation } from "../lines-job";
import { allowedQuoteFields, QUOTE_FIELDS } from "@/lib/integrations/sm8-quote-plan";
import { INVOICED, sendPlan } from "../sm8-send-plan";
import { INVOICE_AGAIN, variationLineName, variationLines, variationRows, variationSendPlan, variationSentLine } from "../sm8-variation-plan";

/* Isaac, 2026-10-18, decision 21: an approved variation goes to ServiceM8 as
   extra lines on the original job. Added, never removed; named as the
   variation's; priced as the difference, ex GST; sent once. */

const settings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };
const OUTDOOR = { key: "o", group: "Units", name: "MXZ-4F71VGD", code: "MXZ-4F71VGD", supplierKey: "aad", qty: 1, unitBuyCents: 200000, kind: "unit" as const };
const coil = (qty: number) => ({ key: "c", group: "Install kit", name: "Pair coil 1/4 + 3/8", code: "PC1438", supplierKey: "aad", qty, unitBuyCents: 762, kind: "material" as const });
const GRILLE = { key: "g", group: "Install kit", name: "Return grille, Bed 2", code: null, supplierKey: null, qty: 1, unitBuyCents: 4000, kind: "material" as const };
const crew = (people: number) => [{ stage: "Install" as const, people, days: 1 }];

const base = priceBuildUp([OUTDOOR, coil(8)], crew(3), settings);
const draft = normaliseDraft({
  intro: "",
  options: [
    { name: "3-head multi", lines: [], units: [] },
    { name: "Variation 1", lines: [], units: [] },
  ],
  accepted: [0],
})!;

const v1 = { n: 1, of: 0, option: 1, what: "return grille in Bed 2" };
const lines = (varied: ReturnType<typeof priceBuildUp>, showLines = true, v = v1) => variationLines({ draft, variation: v, base, varied, showLines });
const sum = (ls: readonly { quantity: number; unitPriceCents: number }[]) => Math.round(ls.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0));

describe("the variation's lines, priced as the difference", () => {
  it("adds a part it adds and the extra of a part it has more of, each named as the variation's, and nothing it left alone", () => {
    const varied = priceBuildUp([OUTDOOR, coil(10), GRILLE], crew(3), settings);
    const out = lines(varied);
    expect(out).toEqual([
      { name: "Variation 1: pair coil 1/4 + 3/8", quantity: 2, unitPriceCents: 1067, unitCostCents: 762 },
      { name: "Variation 1: return grille, Bed 2", quantity: 1, unitPriceCents: 5600, unitCostCents: 4000 },
    ]);
    /* the outdoor and the labour are as accepted: no line */
    expect(out.some((l) => /MXZ|Labour/.test(l.name))).toBe(false);
    expect(sum(out)).toBe(varied.exGstCents - base.exGstCents);
  });

  it("credits a part it takes off, at what it was on the accepted quote, and a part it has fewer of", () => {
    const without = priceBuildUp([OUTDOOR], crew(3), settings);
    const off = lines(without);
    expect(off).toEqual([{ name: "Variation 1: pair coil 1/4 + 3/8", quantity: 8, unitPriceCents: -1066.75, unitCostCents: -762 }]);
    expect(sum(off)).toBe(without.exGstCents - base.exGstCents);

    const fewer = priceBuildUp([OUTDOOR, coil(5)], crew(3), settings);
    expect(lines(fewer)).toEqual([{ name: "Variation 1: pair coil 1/4 + 3/8", quantity: 3, unitPriceCents: expect.closeTo(-1066.67, 1), unitCostCents: -762 }]);
  });

  it("adds labour by the person-day it adds, and a line whose price moved at the difference once", () => {
    const more = priceBuildUp([OUTDOOR, coil(8)], crew(4), settings);
    expect(lines(more)).toEqual([{ name: "Variation 1: labour", quantity: 1, unitPriceCents: 112000, unitCostCents: null }]);
    const loaded = priceBuildUp([OUTDOOR, coil(8)], crew(3), settings, { pct: 10, reason: "Ceiling access" });
    const moved = lines(loaded);
    expect(moved).toEqual([{ name: "Variation 1: labour", quantity: 1, unitPriceCents: expect.any(Number), unitCostCents: null }]);
    expect(sum(moved)).toBe(loaded.exGstCents - base.exGstCents);
  });

  it("keeps a model code's capitals in its name", () => {
    expect(variationLineName(2, "MXZ-4F71VGD")).toBe("Variation 2: MXZ-4F71VGD");
    expect(variationLineName(1, "Return grille, Bed 2")).toBe("Variation 1: return grille, Bed 2");
  });

  it("is one line at the difference when the customer sees totals only", () => {
    const varied = priceBuildUp([OUTDOOR, coil(8), GRILLE], crew(3), settings);
    expect(lines(varied, false)).toEqual([
      { name: "Variation 1: return grille in Bed 2", quantity: 1, unitPriceCents: varied.exGstCents - base.exGstCents, unitCostCents: varied.buyCents - base.buyCents },
    ]);
    /* a variation that takes off is a credit, its own pricing producing it */
    const off = priceBuildUp([OUTDOOR], crew(3), settings);
    expect(lines(off, false)[0]!.unitPriceCents).toBeLessThan(0);
  });

  it("is nothing when it changes nothing", () => {
    expect(lines(base)).toEqual([]);
    expect(lines(base, false)).toEqual([]);
  });
});

const variation = (over: Partial<Variation> = {}): Variation => ({
  n: 1,
  option: 1,
  of: 0,
  what: "return grille in Bed 2",
  startedAt: "2026-10-18T01:00:00.000Z",
  startedBy: "auth0|me",
  approvedAt: "2026-10-18T02:00:00.000Z",
  acceptedAt: "2026-10-18T03:00:00.000Z",
  ...over,
});
const LINES = [
  { name: "Variation 1: return grille, Bed 2", quantity: 1, unitPriceCents: 5600, unitCostCents: 4000 },
  { name: "Variation 1: pair coil 1/4 + 3/8", quantity: 2, unitPriceCents: -1066.8, unitCostCents: -762 },
  { name: "Variation 1: labour", quantity: 0.25, unitPriceCents: 112000, unitCostCents: null },
];
const plan = (over: Partial<Parameters<typeof variationSendPlan>[0]> = {}) =>
  variationSendPlan({
    variation: variation(),
    lines: LINES,
    left: 0,
    job: { status: "Work Order", invoiced: false, number: "3209" },
    existing: 4,
    taxRateUuid: "gst",
    ...over,
  });

describe("what one send adds", () => {
  it("adds the variation's lines on the tax rate the business's lines use, after the job's own", () => {
    const p = plan();
    if (!p.ok) throw new Error(p.why);
    expect(p).toMatchObject({ n: 1, after: 4, taxRateUuid: "gst", invoiced: false, jobNumber: "3209" });
    expect(p.exGstCents).toBe(Math.round(5600 - 2133.6 + 28000));
  });

  it("only adds lines: no job record, nothing taken off, each line under the accepted quote's own fields", () => {
    const p = plan();
    if (!p.ok) throw new Error(p.why);
    const rows = variationRows(p);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).toMatchObject({ object: "jobmaterial", op: "create", uuid: null });
      expect(Object.keys(r.fields).every((k) => QUOTE_FIELDS.jobmaterial.includes(k))).toBe(true);
      /* the sender keeps every field it was given */
      expect(allowedQuoteFields("jobmaterial", r.fields)).toEqual(r.fields);
    }
    expect(rows.map((r) => r.op)).not.toContain("delete");
    expect(rows.map((r) => r.object)).not.toContain("job");
    expect(rows.map((r) => r.key)).toEqual(["add:1", "add:2", "add:3"]);
    expect(rows.map((r) => r.fields.sort_order)).toEqual(["5", "6", "7"]);
  });

  it("names and prices each line ServiceM8's way: ex GST, a credit at a negative price", () => {
    const p = plan();
    if (!p.ok) throw new Error(p.why);
    const [grille, coilOff, labour] = variationRows(p);
    expect(grille!.fields).toEqual({
      name: "Variation 1: return grille, Bed 2",
      quantity: "1",
      price: "56.0000",
      cost: "40.0000",
      displayed_amount: "56.0000",
      displayed_amount_is_tax_inclusive: "0",
      tax_rate_uuid: "gst",
      sort_order: "5",
    });
    expect(coilOff!.fields).toMatchObject({ quantity: "2", price: "-10.6680", cost: "-7.6200" });
    expect(labour!.fields).toMatchObject({ quantity: "0.25", price: "1120.0000" });
    expect(labour!.fields.cost).toBeUndefined();
    expect(grille!.label).toBe("Variation: line Variation 1: return grille, Bed 2 added");
  });

  it("goes once: a variation whose lines all went for real sends nothing again", () => {
    const sent = variation({ sm8: { at: "2026-10-18T03:01:00.000Z", by: "auth0|me", trial: false, jobNumber: "3209", lines: 3, sent: 3, lineUuids: [] } });
    expect(variationInSm8(sent)).toBe(true);
    expect(plan({ variation: sent })).toEqual({ ok: false, why: "Variation 1 is on job 3209 in ServiceM8 already, so nothing goes twice. A further change is a new variation." });
    /* a trial run, or a send part-way, goes again: the queue's key keeps what went from going twice */
    expect(plan({ variation: variation({ sm8: { ...sent.sm8!, trial: true, sent: 0 } }) }).ok).toBe(true);
    expect(plan({ variation: variation({ sm8: { ...sent.sm8!, sent: 2 } }) }).ok).toBe(true);
  });

  it("adds its lines to an invoiced job, and says the invoice goes again from ServiceM8", () => {
    const p = plan({ job: { status: "Completed", invoiced: true, number: "3209" } });
    expect(p.ok && p.invoiced).toBe(true);
    expect(INVOICE_AGAIN).toBe("The job's invoice went before the variation: send it again from ServiceM8 to bill it.");
  });

  it("refuses what can't go yet, in words", () => {
    expect(plan({ variation: null })).toEqual({ ok: false, why: "That option isn't a variation." });
    expect(plan({ variation: variation({ acceptedAt: null }) })).toEqual({ ok: false, why: "Mark variation 1 accepted first: what goes to ServiceM8 is what the client agreed to." });
    expect(plan({ left: 2 })).toEqual({ ok: false, why: "Variation 1 has 2 still to price: ServiceM8 must get all of it." });
    expect(plan({ job: { status: "Quote", invoiced: false, number: "3209" } })).toEqual({
      ok: false,
      why: "The job is still a Quote in ServiceM8. Send the accepted quote first, and the variation's lines go on its work order.",
    });
    expect(plan({ job: { status: "Unsuccessful", invoiced: false, number: "3209" } })).toEqual({ ok: false, why: "The job is a Unsuccessful in ServiceM8, so the variation can't go." });
    expect(plan({ taxRateUuid: null }).ok).toBe(false);
    expect(plan({ lines: [] })).toEqual({ ok: false, why: "Variation 1 changes nothing on the price, so nothing goes to ServiceM8." });
  });
});

describe("what the rail says went", () => {
  const s = { at: "2026-10-18T03:01:00.000Z", by: "auth0|me", trial: false, jobNumber: "3209", lines: 3, sent: 3, lineUuids: [] };
  it("says how many lines went on which job", () => {
    expect(variationSentLine({ sm8: s })).toBe("Sent to ServiceM8 as 3 lines on job 3209.");
    expect(variationSentLine({ sm8: { ...s, lines: 1, sent: 1 } })).toBe("Sent to ServiceM8 as 1 line on job 3209.");
    expect(variationSentLine({ sm8: { ...s, sent: 2 } })).toBe("2 of 3 lines on job 3209 in ServiceM8 so far.");
    expect(variationSentLine({ sm8: { ...s, trial: true, sent: 0 } })).toBe("Trial run: 3 lines for job 3209 checked, and nothing went to ServiceM8.");
    expect(variationSentLine({ sm8: null })).toBeNull();
  });

  it("keeps what went on the variation, read back as it was written", () => {
    const uuid = "0000000a-0000-4000-8000-000000000001";
    const b = byHandOf({ byHand: { accepted: [0], variations: [{ ...variation(), sm8: { ...s, lineUuids: [uuid, "not a uuid"] } }] } });
    expect(b.variations[0]!.sm8).toEqual({ ...s, lineUuids: [uuid] });
    expect(byHandOf({ byHand: { variations: [{ ...variation(), sm8: { by: "x" } }] } }).variations[0]!.sm8).toBeUndefined();
  });
});

describe("the accepted quote's send, after decision 21", () => {
  it("says a change on an invoiced job is a variation, added to this job", () => {
    const build = priceBuildUp([OUTDOOR], crew(3), settings);
    expect(sendPlan({ draft, accepted: [{ index: 0, build, left: 0 }], showLines: false, job: { status: "Work Order", invoiced: true }, existing: [], taxRateUuid: "gst" })).toEqual({ ok: false, why: INVOICED });
    expect(INVOICED).toBe("The job is invoiced in ServiceM8, so the accepted quote isn't sent again. A change now is a variation: its lines are added to this job.");
    expect(INVOICED).not.toMatch(/its own job/);
  });
});
