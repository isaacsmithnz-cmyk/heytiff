import { priceBuildUp } from "../buildup";
import { normaliseDraft } from "../proposal";
import { checkBack, optionLines, sendPlan, sm8Amount, usualTaxRate } from "../sm8-send-plan";

/* Isaac, 2026-10-05: "if a quote is accepted, then it can turn that into the
   work order for service mate… copy the scope and line items" */

const settings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };
const build = priceBuildUp(
  [
    { key: "o", group: "Units", name: "MXZ-4F71VGD", code: "MXZ-4F71VGD", supplierKey: "aad", qty: 1, unitBuyCents: 200000, kind: "unit" },
    { key: "c", group: "Install kit", name: "Pair coil 1/4 + 3/8", code: "PC1438", supplierKey: "aad", qty: 8, unitBuyCents: 762, kind: "material" },
  ],
  [{ stage: "Install", people: 3, days: 1 }],
  settings
);
const draft = normaliseDraft({
  intro: "Hi",
  options: [
    { name: "3-head multi", lines: ["MXZ-4F71 outdoor on wall brackets", "Three high walls"], units: [] },
    { name: "Three splits", lines: ["Three AP25 pairs"], units: [] },
  ],
  accepted: [0],
})!;
const base = { draft, showLines: false, job: { status: "Quote", invoiced: false }, existing: [{ uuid: "m-1", name: "As Per Quote" }], taxRateUuid: "gst" };

it("sends one line at the option's total when the customer sees totals only, and makes the job a work order", () => {
  const p = sendPlan({ ...base, accepted: [{ index: 0, build, left: 0 }] });
  if (!p.ok) throw new Error(p.why);
  expect(p.status).toEqual({ from: "Quote", to: "Work Order" });
  expect(p.workDone).toBe("Option 1: 3-head multi\n- MXZ-4F71 outdoor on wall brackets\n- Three high walls");
  expect(p.lines).toEqual([{ name: "Option 1: 3-head multi, as per quote", quantity: 1, unitPriceCents: build.exGstCents, unitCostCents: build.buyCents }]);
  expect(p.remove).toEqual([{ uuid: "m-1", name: "As Per Quote" }]);
  expect(p.exGstCents).toBe(build.exGstCents);
});

it("sends every line, labour by the person-day, when the customer sees line items — adding up to the same total", () => {
  const lines = optionLines(draft, 0, build, true);
  expect(lines.map((l) => [l.name, l.quantity])).toEqual([
    ["MXZ-4F71VGD", 1],
    ["Pair coil 1/4 + 3/8", 8],
    ["Labour", 3],
  ]);
  /* a person-day is the rate times the business's own day: $140 × 8 */
  expect(lines.at(-1)!.unitPriceCents).toBe(112000);
  const sum = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
  expect(Math.round(sum)).toBe(build.exGstCents);
});

it("refuses what ServiceM8 mustn't get: nothing accepted, a part-priced option, an invoiced job, a job past work order", () => {
  expect(sendPlan({ ...base, accepted: [] })).toEqual({ ok: false, why: "No option is marked accepted." });
  expect(sendPlan({ ...base, accepted: [{ index: 0, build, left: 2 }] })).toEqual({ ok: false, why: "The accepted option has 2 still to price: ServiceM8 must get the whole quote." });
  expect(sendPlan({ ...base, accepted: [{ index: 0, build, left: 0 }], job: { status: "Work Order", invoiced: true } }).ok).toBe(false);
  expect(sendPlan({ ...base, accepted: [{ index: 0, build, left: 0 }], job: { status: "Completed", invoiced: false } }).ok).toBe(false);
  expect(sendPlan({ ...base, accepted: [{ index: 0, build, left: 0 }], taxRateUuid: null }).ok).toBe(false);
  /* a work order not yet invoiced can be sent again (a variation before invoicing) */
  const again = sendPlan({ ...base, accepted: [{ index: 0, build, left: 0 }], job: { status: "Work Order", invoiced: false } });
  expect(again.ok && again.status).toBeNull();
});

it("puts amounts ServiceM8's way, takes the business's usual tax rate, and checks the total back", () => {
  expect(sm8Amount(1150000)).toBe("11500.0000");
  expect(sm8Amount(762.5)).toBe("7.6250");
  expect(usualTaxRate(["gst", "gst", "free", null])).toBe("gst");
  expect(usualTaxRate([])).toBeNull();
  expect(checkBack([{ quantity: 1, unitPrice: 11500 }], 1150000)).toEqual({ sm8Cents: 1150000, gapCents: 0, matches: true });
  expect(checkBack([{ quantity: 1, unitPrice: 11000 }], 1150000).matches).toBe(false);
});
