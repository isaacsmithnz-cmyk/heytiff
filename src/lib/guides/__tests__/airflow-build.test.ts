/**
 * @jest-environment node
 */
/* The ducted airflow guide is its evidence, averaged the same way every time
   (Isaac, 2026-10-15: "Anyone using it should get the same
   recommendations"): the committed tables are what the evidence rebuilds,
   every figure names sources the guide lists, the medians are the
   research's own, and a rule's number is its source's own words. */
import fs from "node:fs";
import path from "node:path";
import { buildAirflowGuide, EVIDENCE_FILES, FLEX_RULES, formatGuideJson, GUIDE_FILES, NOT_AVERAGED, TAKEOFF_RULES, type Evidence, type From } from "../airflow-build";
import { installedPacks } from "@/lib/studio/packs/server";

const DIR = path.join(process.cwd(), "data", "guides", "airflow@2026.1");
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
const evidence = Object.fromEntries(Object.entries(EVIDENCE_FILES).map(([key, file]) => [key, read(path.join("evidence", file))])) as Evidence;
const built = buildAirflowGuide(evidence);

describe("the tables are what the evidence rebuilds", () => {
  it.each(GUIDE_FILES)("%s, byte for byte (npm run guide:airflow rewrites it)", (file) => {
    expect(fs.readFileSync(path.join(DIR, file), "utf8")).toBe(formatGuideJson(built[file]));
  });

  it("the same evidence builds the same guide twice", () => {
    expect(JSON.stringify(buildAirflowGuide(JSON.parse(JSON.stringify(evidence))))).toBe(JSON.stringify(built));
  });
});

/** Every `from` in a table, wherever it sits. */
function froms(x: unknown, out: From[] = []): From[] {
  if (Array.isArray(x)) x.forEach((y) => froms(y, out));
  else if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (Array.isArray(o.from)) out.push(...(o.from as From[]));
    Object.values(o).forEach((y) => froms(y, out));
  }
  return out;
}

describe("the method", () => {
  const sources = built["sources.json"].sources;
  const ids = new Set(sources.map((s) => s.id));

  it("cites only sources it lists, and never one it doesn't average", () => {
    const cited = GUIDE_FILES.filter((f) => f !== "sources.json").flatMap((f) => froms(built[f]));
    expect(cited.length).toBeGreaterThan(300);
    expect(cited.filter((f) => !ids.has(f.source))).toEqual([]);
    expect(cited.filter((f) => NOT_AVERAGED[f.source])).toEqual([]);
    /* a trade blog is read and kept, marked, so nobody adds it back unknowing */
    expect(sources.find((s) => s.id === "hvacrschool-bruner")).toMatchObject({ not_averaged: "A trade blog." });
  });

  it("counts a copy once: ActronAir's reprint of Advantage Air's flex table is the most, never a figure in the median", () => {
    const flex = built["flex_duct.json"].rows;
    expect(flex.flatMap((r) => r.from).some((f) => f.source === "actronair-db0817")).toBe(false);
    expect(flex.find((r) => r.dia_mm === 250)).toMatchObject({ most_ls: 170, most_from: "advantage-air-tech-specs" });
    expect(flex.find((r) => r.dia_mm === 100)).toMatchObject({ most_ls: 22, most_from: "actronair-db0817" });
  });

  it("takes one value a publisher: ActronAir's two documents are one figure", () => {
    const open = built["return_air.json"].grille_velocity_ms.no_filter_free_area;
    expect(open.from.filter((f) => f.source.startsWith("actronair")).map((f) => f.value)).toEqual([2.5, 2.25]);
    /* ActronAir, Brivis, CCC, ASHRAE, ACCA, Hart & Cooley */
    expect(open.n).toBe(6);
  });

  it("recommends the research's own medians for the outlets (its summary_excluding_rules)", () => {
    const research = (evidence.outlets as unknown as { summary_excluding_rules: { outlet: string; size: string; level: string; n: number; median_ls: number }[] }).summary_excluding_rules.filter((s) => s.outlet !== "linear_slot");
    expect(research.length).toBeGreaterThan(60);
    for (const s of research) {
      const row = built["supply_outlets.json"].rows.find((r) => r.kind === s.outlet && r.size === s.size)!;
      const at = s.level === "~NC/NR25" ? row.at_nc25 : row.at_nc30;
      /* the research rounded to a tenth, the guide to a whole L/s */
      expect([s.outlet, s.size, s.level, at.n, Math.abs(at.value - s.median_ls) <= 0.5]).toEqual([s.outlet, s.size, s.level, s.n, true]);
    }
  });

  it("never recommends more than its most", () => {
    for (const r of built["flex_duct.json"].rows) expect(r.recommended_ls).toBeLessThanOrEqual(r.most_ls);
    for (const r of built["supply_outlets.json"].rows) expect(r.recommended_ls).toBeLessThanOrEqual(r.most_ls);
    for (const r of built["ducts.json"].rigid_round_ls.rows) expect(r.recommended_ls).toBeLessThanOrEqual(r.most_ls);
    /* where the publishers' median is over the published maximum, the maximum it is, said so */
    expect(built["flex_duct.json"].rows.find((r) => r.dia_mm === 175)).toMatchObject({ recommended_ls: 65, median_ls: 72, capped: expect.stringContaining("over the published maximum") });
  });

  it("marks what it worked out rather than read", () => {
    expect(built["return_air.json"].grille_ls_by_size.derived).toMatch(/^Worked, not published/);
    expect(built["return_air.json"].grille_velocity_ms.no_filter_gross_eggcrate.derived).toMatch(/× an eggcrate's 90% free/);
    expect(built["return_air.json"].return_duct.by_dia.derived).toBeTruthy();
  });
});

describe("its rules are its sources' own words", () => {
  const sources = built["sources.json"].sources;
  /** Everything the evidence says of a source: its entry and its rows' notes. */
  const words = (id: string) => {
    const s = sources.find((x) => x.id === id)!;
    return s.evidence
      .map((ref) => {
        const [file, eid] = ref.split("#") as [string, string];
        const key = (Object.keys(EVIDENCE_FILES) as (keyof Evidence)[]).find((k) => EVIDENCE_FILES[k] === file)!;
        const entry = (evidence[key].sources as { id: string }[]).find((x) => x.id === eid);
        const rows = [...(evidence[key].values as Record<string, unknown>[]), ...((evidence[key] as { extras?: Record<string, unknown>[] }).extras ?? [])].filter((x) => x.source === eid);
        return JSON.stringify([entry, rows.map((x) => [x.notes, x.note])]);
      })
      .join(" ");
  };
  it.each([...FLEX_RULES, ...TAKEOFF_RULES].filter((r) => r.value != null).map((r) => [r.rule, r.value!, r.sources[0]!] as const))("%s (%s, from %s)", (_rule, value, source) => {
    expect(words(source)).toContain(String(value));
  });
});

describe("a guide is not a maker", () => {
  it("lives under data/guides, and the packs never list it", async () => {
    expect(fs.existsSync(path.join(process.cwd(), "data", "packs", "airflow@2026.1"))).toBe(false);
    const makers = (await installedPacks()).map((p) => p.brand);
    expect(makers.length).toBeGreaterThan(0);
    expect(makers.some((m) => /airflow|guide/.test(m))).toBe(false);
  });

  it("says what it is, how it was made, and that every figure can be changed", () => {
    expect(read("meta.json")).toMatchObject({
      name: "Ducted airflow guide",
      version: "2026.1",
      scope: "Residential and light-commercial ducted, Australia",
      method: "For each figure, one value per independent publisher (copies counted once), the median as the recommendation, with the mean, low, high and how many publishers.",
      recommendation: expect.stringContaining("a recommendation a person can change on a quote"),
    });
  });
});
