/* Version 2 before it's accepted: the approved quote kept as it stood. */
import type { QuoteLine } from "../lines";
import { priceLines } from "../lines-price";
import { versionOf, versionSnapshot } from "../quote-versions";

const line = (o: Partial<QuoteLine>): QuoteLine => ({
  id: "x", version: 1, updatedAt: "", updatedBy: "", optionIndex: 0, system: "", group: "Materials", position: 0, name: "x",
  code: null, supplierKey: null, kind: "material", qty: 1, unit: "", costCents: 0, sellCents: null, source: "by_hand", why: "", duct: false, ...o,
});
const settings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };

describe("the quote kept as a version", () => {
  const lines = [
    line({ id: "u1", group: "Units", name: "FDUA100", code: "FDUA100", kind: "unit", costCents: 400000 }),
    line({ id: "d1", name: "Cone diffuser 200", code: "CD200", qty: 3, costCents: 1000 }),
    line({ id: "k1", name: "Isolator", source: "unknown", why: "Not known yet" }),
    line({ id: "l1", kind: "labour", name: "Install, 2 people", qty: 16, unit: "h" }),
    line({ id: "v1", optionIndex: 1, name: "Variation's diffuser", costCents: 1000 }),
  ];
  const priced = priceLines(lines, ["Ducted, zoned"], settings, { pct: null, labourCostCents: null });

  it("keeps each option's lines with what each came to, and its totals; a variation is left out", () => {
    const kept = versionSnapshot(lines, priced, new Set([1]));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ name: "Ducted, zoned", exGstCents: priced[0]!.build.exGstCents, incGstCents: priced[0]!.build.incGstCents });
    expect(kept[0]!.lines.map((l) => [l.name, l.qty, l.totalCents])).toEqual([
      ["FDUA100", 1, 500000],
      ["Cone diffuser 200", 3, 4200],
      /* nobody knows its price yet: never a $0 line */
      ["Isolator", 1, null],
      /* labour as the visit it's priced as: 16 hours at $140 */
      ["Install, 2 people", 16, 224000],
    ]);
  });

  it("is read back from its row, a broken one as nothing", () => {
    const options = versionSnapshot(lines, priced, new Set([1]));
    const row = { n: 1, what: "Client wants the hallway done too", snapshot: { options }, approved_at: "2026-10-11T01:00:00Z", made_at: "2026-10-11T02:00:00Z" };
    expect(versionOf(row)).toEqual({ n: 1, what: "Client wants the hallway done too", approvedAt: "2026-10-11T01:00:00Z", madeAt: "2026-10-11T02:00:00Z", options });
    expect(versionOf({ n: "x", snapshot: "junk" })).toEqual({ n: 1, what: "", approvedAt: null, madeAt: "", options: [] });
  });
});
