import { priceBuildUp, type BuildLine, type BuildSettings } from "../buildup";
import { hourCostOf, profitOf } from "../profit";
import { normaliseQuoteSettings, quoteSettingsRow } from "../settings";

const s: BuildSettings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };
const line = (o: Partial<BuildLine>): BuildLine => ({
  key: "x",
  group: "Units",
  name: "x",
  code: "X",
  supplierKey: "aad",
  qty: 1,
  unitBuyCents: 100_000,
  kind: "unit",
  ...o,
});

describe("an hour's cost", () => {
  it("is the rate less the target, since the rate already carries the profit", () => {
    expect(hourCostOf(14000, 20, null)).toBe(11200);
  });
  it("is the business's own figure when it gives one", () => {
    expect(hourCostOf(14000, 20, 9500)).toBe(9500);
  });
  it("is nothing without a target or a figure: no profit is reckoned on a guess", () => {
    expect(hourCostOf(14000, null, null)).toBeNull();
  });
});

describe("a quote's profit against the target", () => {
  /* a $1,000 unit at 25% and two person-days at $140 an hour */
  const b = priceBuildUp([line({})], [{ stage: "Install", people: 1, days: 2 }], s);

  it("adds the parts at buy and the hours at their cost, and takes it off the price", () => {
    const p = profitOf(b, s, 20, null)!;
    expect(b.exGstCents).toBe(125_000 + 224_000);
    expect(p.costCents).toBe(100_000 + 16 * 11200);
    expect(p.profitCents).toBe(349_000 - 279_200);
    expect(p.pct).toBe(20);
    expect(p.short).toBeNull();
  });

  it("under the target says how far short, and the price that meets it, and changes nothing", () => {
    const cheap = priceBuildUp([line({})], [{ stage: "Install", people: 1, days: 2 }], { ...s, unitMarkupPct: 0 });
    const p = profitOf(cheap, s, 20, null)!;
    expect(p.pct).toBeLessThan(20);
    expect(p.short!.priceCents).toBe(Math.ceil(p.costCents / 0.8));
    expect(p.short!.cents).toBe(p.short!.priceCents - cheap.exGstCents);
    expect(cheap.exGstCents).toBe(100_000 + 224_000);
  });

  it("counts the contingency's hours with the visits'", () => {
    const withHours = priceBuildUp(
      [line({ kind: "material", group: "Ductwork", duct: true, unitBuyCents: 10_000 })],
      [{ stage: "Install", people: 1, days: 1 }],
      { ...s, contingency: { pct: 0, hours: 3 } }
    );
    const p = profitOf(withHours, s, 20, null)!;
    expect(p.costCents).toBe(10_000 + 11 * 11200);
  });

  it("is null with no target and no hour's cost", () => {
    expect(profitOf(b, s, null, null)).toBeNull();
  });

  it("is reckoned against a typed hour's cost with no target, and never short", () => {
    const p = profitOf(b, s, null, 10_000)!;
    expect(p.targetPct).toBeNull();
    expect(p.short).toBeNull();
  });
});

describe("the settings carry the target", () => {
  it("reads it, caps a typo, and writes it back", () => {
    const st = normaliseQuoteSettings({ profit_target_pct: 20, labour_cost_cents: 11200 });
    expect(st.profitTargetPct).toBe(20);
    expect(st.labourCostCents).toBe(11200);
    expect(normaliseQuoteSettings({ profitTargetPct: 400 }).profitTargetPct).toBe(90);
    expect(quoteSettingsRow(st)).toMatchObject({ profit_target_pct: 20, labour_cost_cents: 11200 });
  });
  it("is unset for a new business", () => {
    const st = normaliseQuoteSettings({});
    expect(st.profitTargetPct).toBeNull();
    expect(st.labourCostCents).toBeNull();
  });
});
