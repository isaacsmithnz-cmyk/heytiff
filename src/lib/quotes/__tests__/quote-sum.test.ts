import type { BuildSettings } from "../buildup";
import type { QuoteLine } from "../lines";
import { priceLines } from "../lines-price";
import { quoteParts } from "../quote-sum";

/* The quote card's sums (the chat-first quote page, Isaac, 2026-10-13), on
   3231's own lines as they stood on 12 October (121 Awaba Street: a 10 kW
   Mitsubishi Electric underfloor ducted, five zones), in the order they went
   on, at the business's Quoting settings: 25% on units, 40% on materials,
   $140 an hour, an 8-hour day, a duct contingency of 15% and 3 h. */

const s: BuildSettings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: { pct: 15, hours: 3 } };
let n = 0;
/** [group, code, kind, qty, unit, cost each, sell each, a duct part] */
type Row = [string, string | null, QuoteLine["kind"], number, QuoteLine["unit"], number, number | null, boolean?];
const line = ([group, code, kind, qty, unit, costCents, sellCents, duct = false]: Row): QuoteLine => ({
  id: `l${n}`,
  version: 1,
  updatedAt: "",
  updatedBy: "tiff",
  optionIndex: 0,
  system: "",
  group,
  position: n++,
  name: code ?? group,
  code,
  supplierKey: null,
  kind,
  qty,
  unit,
  costCents,
  sellCents,
  source: "assumed",
  why: "",
  duct,
});
const P = "Pipe, power and controls";
const D = "Ductwork and grilles";
const M = "Mounting and drain";
const lines3231 = (
  [
    [P, "9800008-1", "material", 10, "m", 1369.4, null],
    [P, "ELCAC7504", "material", 10, "m", 180, null],
    [P, "CBT2.5TEWH", "material", 10, "m", 198, null],
    [P, "ERCBO20A", "material", 1, "", 3800, null],
    [P, "3421103-1", "material", 1, "", 1615, null],
    [M, "SXD600", "material", 1, "", 4500, null],
    [M, "9502294-2", "material", 8, "m", 147, null],
    [D, "JH-NOSE", "material", 1, "", 6750, null],
    [D, "VB200", "material", 8, "", 2489, null],
    [D, "MY1088", "material", 4, "", 2128, null],
    [D, "UB901010", "material", 8, "", 3566, null],
    [M, "SH30", "material", 4, "", 2286, null],
    [D, "ECP6040", "material", 1, "", 3893, null],
    [D, "1610098-1", "material", 1, "", 12299, null],
    [P, "PAR-ZM01A-A", "material", 1, "", 25200, null],
    ["Allowances", null, "material", 1, "", 6850, null],
    [P, "PAC-ZC10L240C-A", "material", 1, "", 57820, null],
    [P, "PAR-ZR01R-A", "material", 1, "", 6860, null],
    [P, "PAR-ZR01S-A", "material", 5, "", 5530, null],
    [D, "QZD1024V", "material", 5, "", 4521, null, true],
    ["Units", "PEA-M100HAA", "unit", 1, "", 93660, null],
    ["Units", "PUZ-M100VKA", "unit", 1, "", 221103, null],
    [D, null, "material", 8, "", 0, 5000, true],
    [P, "MAC-588IF-E", "material", 1, "", 6650, null],
    ["Labour", null, "labour", 32, "h", 11200, null],
    ["Labour", null, "labour", 8, "h", 11200, null],
  ] as Row[]
).map(line);

const [o] = priceLines(lines3231, [], s, { pct: 20, labourCostCents: null });
const b = o!.build;
const sum = (rows: { cents: number }[]) => rows.reduce((t, r) => t + r.cents, 0);

it("prices 3231 as the mock-ups read it", () => {
  expect(b.exGstCents).toBe(1419935);
  expect(b.incGstCents).toBe(1561929);
});

it("splits the total into Units, Materials and Labour, the contingency's hours in the labour's 43", () => {
  const parts = quoteParts(b, 40 + 3);
  expect(parts.map((p) => [p.label, p.cents])).toEqual([
    ["Units", 393454],
    ["Materials", 424481],
    ["Labour, 43 h", 602000],
  ]);
  expect(sum(parts)).toBe(b.exGstCents);
});

it("puts a group the kit doesn't build after the kit's, before the labour, and a loading with the labour, still adding up", () => {
  const core = line(["Core holes", null, "material", 1, "", 30000, null]);
  const [x] = priceLines([core, ...lines3231], [], s, { pct: 20, labourCostCents: null }, { 0: { pct: 10, reason: "Parapet access" } });
  /* the loading is labour's, not the materials' */
  const parts = quoteParts(x!.build, 43);
  expect(parts[2]!.cents).toBe(602000 + 56000);
  expect(sum(parts)).toBe(x!.build.exGstCents);
});

