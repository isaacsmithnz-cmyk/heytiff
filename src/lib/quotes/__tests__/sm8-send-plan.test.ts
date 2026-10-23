import { priceBuildUp } from "../buildup";
import { normaliseDraft } from "../proposal";
import { allowedQuoteFields, quoteRows } from "@/lib/integrations/sm8-quote-plan";
import { NOT_APPROVED, optionLines, planKey, quoteDescription, sendAsQuotePlan, sendPlan, usualTaxRate, type ProposalWords } from "../sm8-send-plan";

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

it("folds a loading into the labour, never a line of its own, and still adds up to the total", () => {
  const loaded = priceBuildUp(
    [{ key: "o", group: "Units", name: "MXZ-4F71VGD", code: "MXZ-4F71VGD", supplierKey: "aad", qty: 1, unitBuyCents: 200000, kind: "unit" }],
    [{ stage: "Install", people: 3, days: 1 }],
    settings,
    { pct: 12, reason: "Parapet access" }
  );
  const lines = optionLines(draft, 0, loaded, true);
  expect(lines.map((l) => l.name)).toEqual(["MXZ-4F71VGD", "Labour"]);
  expect(Math.round(lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0))).toBe(loaded.exGstCents);
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
  expect(usualTaxRate(["gst", "gst", "free", null])).toBe("gst");
  expect(usualTaxRate([])).toBeNull();
});

/* Isaac, 2026-10-05: "if it adds wifi, does it specify in the quote?" */
it("says what a unit's order code gives it on the customer's line", () => {
  const withWifi = priceBuildUp(
    [{ key: "i", group: "Units", name: "MSZ-AP25VGD2", code: "MSZ-AP25VGKD2-A2", supplierKey: "aad", qty: 1, unitBuyCents: 40000, kind: "unit", features: ["Wi-Fi built in", "Demand response (DRED) ready"] }],
    [{ stage: "Install", people: 1, days: 1 }],
    settings
  );
  expect(optionLines(draft, 0, withWifi, true)[0]!.name).toBe("MSZ-AP25VGD2, Wi-Fi built in, Demand response (DRED) ready");
});

/* Isaac, 2026-10-15: a unit line is named by what it is, "indoor unit
   study, then model"; ServiceM8's line is all there is of it there */
it("gives a unit named by what it is its model on ServiceM8's line", () => {
  const named = priceBuildUp(
    [
      { key: "o", group: "Units", name: "Outdoor unit", code: "MXZ-3F68VF", supplierKey: "aad", qty: 1, unitBuyCents: 300000, kind: "unit" },
      { key: "i", group: "Units", name: "Indoor unit, Study", code: "MSZ-AP25VGKD2-A2", supplierKey: "aad", qty: 1, unitBuyCents: 40000, kind: "unit", features: ["Wi-Fi built in"] },
    ],
    [{ stage: "Install", people: 1, days: 1 }],
    settings
  );
  expect(optionLines(draft, 0, named, true).slice(0, 2).map((l) => l.name)).toEqual(["Outdoor unit: MXZ-3F68VF", "Indoor unit, Study: MSZ-AP25VGKD2-A2, Wi-Fi built in"]);
});

/* a send goes only as it was shown */
describe("planKey", () => {
  it("is the same for the same plan, and changes with any line", () => {
    const plan = { ok: false as const, why: "There's no quote on this job." };
    expect(planKey(plan)).toBe(planKey({ ...plan }));
    expect(planKey(plan)).not.toBe(planKey({ ok: false, why: "There's no quote on this job!" }));
  });
});

/* Slice 7.3 (Isaac's go 2026-10-11, trial first): the approved quote to
   ServiceM8 as a quote, before it's accepted */
describe("sent as a quote", () => {
  const quote = { draft, job: { status: "Quote", invoiced: false }, existing: [{ uuid: "m-1", name: "Old line" }], taxRateUuid: "gst" };

  it("puts the scope in the job's description and one As Per Quote line at its price, the job left a Quote", () => {
    const p = sendAsQuotePlan({ ...quote, approved: true, options: [{ index: 0, build, left: 0 }] });
    if (!p.ok) throw new Error(p.why);
    expect(p.status).toBeNull();
    expect(p.jobDescription).toBe("Option 1: 3-head multi\n- MXZ-4F71 outdoor on wall brackets\n- Three high walls");
    expect(p.lines).toEqual([{ name: "As Per Quote", quantity: 1, unitPriceCents: build.exGstCents, unitCostCents: build.buyCents }]);
    expect(p.remove).toEqual([{ uuid: "m-1", name: "Old line" }]);
  });

  it("gives each option its line where there are several", () => {
    const p = sendAsQuotePlan({ ...quote, approved: true, options: [{ index: 0, build, left: 0 }, { index: 1, build, left: 0 }] });
    if (!p.ok) throw new Error(p.why);
    expect(p.lines.map((l) => l.name)).toEqual(["Option 1: 3-head multi, as per quote", "Option 2: Three splits, as per quote"]);
  });

  it("queues the job's description and its lines, never its status", () => {
    const p = sendAsQuotePlan({ ...quote, approved: true, options: [{ index: 0, build, left: 0 }] });
    if (!p.ok) throw new Error(p.why);
    const [job, off, add] = quoteRows("job-1", p);
    expect(job).toMatchObject({ object: "job", op: "update", fields: { job_description: p.jobDescription }, label: "Quote: the job's description" });
    expect(job!.fields).not.toHaveProperty("status");
    expect(off).toMatchObject({ op: "delete", label: "Quote: line Old line taken off" });
    expect(add).toMatchObject({ op: "create", fields: { name: "As Per Quote", quantity: "1" }, label: "Quote: line As Per Quote added" });
    expect(allowedQuoteFields("job", { job_description: "x", status: "Quote" })).toEqual({ job_description: "x" });
  });

  /* 3446 (2026-10-21): the approved proposal never reached ServiceM8, only the option's name */
  const proposal: ProposalWords = {
    title: "Air conditioning: master bedroom, kitchen and bedroom",
    intro: "We'll supply and install three Mitsubishi Electric AP series high wall units.",
    options: [
      {
        summary: "A 2.5 kW split for the master, and a multi for the kitchen and bedroom.",
        areas: [
          { name: "Master", items: ["2.5 kW indoor and outdoor unit", "Pipe, cable, drain and wall bracket"] },
          { name: "Commissioning", items: ["Pressure test, vacuum, commissioning and handover"] },
        ],
        included: ["Supply and installation of all units listed"],
      },
      { summary: "Three splits.", areas: [], included: [] },
    ],
    notIncluded: ["Mains power to the outdoor units, run by your electrician"],
    payment: { preset: "domestic_small", stages: [{ when: "Deposit, on accepting", percent: 10 }, { when: "Balance, within 7 days of finishing", percent: 90 }] },
  };

  it("puts the approved proposal's words in the job's description", () => {
    const p = sendAsQuotePlan({ ...quote, approved: true, options: [{ index: 0, build, left: 0 }], proposal });
    if (!p.ok) throw new Error(p.why);
    expect(p.jobDescription).toBe(
      [
        "Air conditioning: master bedroom, kitchen and bedroom",
        "We'll supply and install three Mitsubishi Electric AP series high wall units.",
        "Option 1: 3-head multi",
        "A 2.5 kW split for the master, and a multi for the kitchen and bedroom.",
        "Master:\n- 2.5 kW indoor and outdoor unit\n- Pipe, cable, drain and wall bracket\n\nCommissioning:\n- Pressure test, vacuum, commissioning and handover",
        "Included:\n- Supply and installation of all units listed",
        "Not included:\n- Mains power to the outdoor units, run by your electrician",
        "Payment:\n- Deposit, on accepting: 10%\n- Balance, within 7 days of finishing: 90%",
      ].join("\n\n")
    );
    // the lines are as before: one As Per Quote at its price
    expect(p.lines).toEqual([{ name: "As Per Quote", quantity: 1, unitPriceCents: build.exGstCents, unitCostCents: build.buyCents }]);
  });

  it("gives every option its own scope, and leaves out what the proposal doesn't say", () => {
    const text = quoteDescription(draft, [0, 1], { ...proposal, intro: "", notIncluded: [], payment: { preset: "domestic_small", stages: [] } });
    expect(text).toContain("Option 2: Three splits\n\nThree splits.");
    expect(text).not.toContain("Not included");
    expect(text).not.toContain("Payment");
    // with no proposal, the draft's lines as before
    expect(quoteDescription(draft, [0])).toBe("Option 1: 3-head multi\n- MXZ-4F71 outdoor on wall brackets\n- Three high walls");
  });

  it("an accepted quote's work done is its option in the proposal's words", () => {
    const p = sendPlan({ ...base, accepted: [{ index: 0, build, left: 0 }], proposal });
    if (!p.ok) throw new Error(p.why);
    expect(p.workDone).toBe(
      "Option 1: 3-head multi\n\nA 2.5 kW split for the master, and a multi for the kitchen and bedroom.\n\nMaster:\n- 2.5 kW indoor and outdoor unit\n- Pipe, cable, drain and wall bracket\n\nCommissioning:\n- Pressure test, vacuum, commissioning and handover\n\nIncluded:\n- Supply and installation of all units listed"
    );
  });

  it("goes only approved, only on a Quote, and only whole", () => {
    expect(sendAsQuotePlan({ ...quote, approved: false, options: [{ index: 0, build, left: 0 }] })).toEqual({ ok: false, why: NOT_APPROVED });
    expect(sendAsQuotePlan({ ...quote, approved: true, job: { status: "Work Order", invoiced: false }, options: [{ index: 0, build, left: 0 }] })).toMatchObject({ ok: false, why: "The job is a Work Order in ServiceM8: only a Quote is sent as a quote." });
    expect(sendAsQuotePlan({ ...quote, approved: true, options: [{ index: 0, build, left: 2 }] })).toMatchObject({ ok: false, why: "2 still to price: ServiceM8 must get the whole quote." });
  });
});
