/**
 * @jest-environment node
 */
/* The ducted airflow guide against real jobs: Mitsubishi Electric's
   PEA-M125HAA (1000 L/s, 150 Pa) on seven Ø250 outlets, four bedrooms and
   a living zone left open, and its PEA-M100HAA (700 L/s, 150 Pa) on eight
   outlets in five zones. Each check says the guide's figure and why. */
jest.mock("server-only", () => ({}));
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { airflowCheck, airflowSaid, ductSizeFor, flexCheck, flexFor, outletCheck, returnCheck, staticBudget, zoningCheck, type AirflowAsk, type AirflowGuide } from "../airflow";
import { latestAirflowGuideDir, loadAirflowGuide } from "../airflow-server";

let g: AirflowGuide;
beforeAll(async () => {
  g = (await loadAirflowGuide())!;
});

describe("the guide, off disk", () => {
  it("is the newest edition installed", async () => {
    expect(await latestAirflowGuideDir()).toMatchObject({ version: "2026.1" });
    expect(g.meta).toMatchObject({ name: "Ducted airflow guide", version: "2026.1" });
    expect(g.flex.rows.map((r) => r.dia_mm)).toEqual([100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500]);
  });

  it("is none where none is installed", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "guides-"));
    expect(await loadAirflowGuide(empty)).toBeNull();
    expect(await loadAirflowGuide(path.join(empty, "nowhere"))).toBeNull();
  });
});

const outlets = (zones: [string, number][], size: string, kind: AirflowAsk["outlets"][number]["kind"] = "round_ceiling_diffuser") =>
  zones.map(([zone, count]) => ({ count, kind, size, zone, room: "", ls_each: null, duct_mm: null, length_m: null, slots: null }));

describe("PEA-M125HAA: 1000 L/s, 150 Pa, 7 × Ø250, master, bed 1–3 and a living zone left open", () => {
  const ask: AirflowAsk = {
    unit: { airflow_ls: 1000, static_pa: 150, low_airflow_ls: null, capacity_kw: 12.5 },
    outlets: outlets([["Master", 1], ["Bed 1", 1], ["Bed 2", 1], ["Bed 3", 1], ["Living", 3]], "250"),
    takeoffs: [],
    zones: [{ name: "Master", stays_open: false }, { name: "Bed 1", stays_open: false }, { name: "Bed 2", stays_open: false }, { name: "Bed 3", stays_open: false }, { name: "Living", stays_open: true }],
    ret: { filtered: true, pleated: false, w_mm: null, h_mm: null, count: null, duct_mm: 400, ducts: 2 },
    run: { rigid_m: null, flex_m: 6, flex_mm: 250, flex_ls: 143, bends: 2, balancing: false },
  };

  it("143 L/s each through Ø250 runs at 2.9 m/s, within the 169 L/s the guide recommends, and the outlet within its 182", () => {
    expect(flexCheck(g, 250, 1000 / 7)).toMatchObject({ fit: "within", velocity_ms: 2.91, recommended_ls: 169, most_ls: 170, reason: "143 L/s through Ø250 flex runs at 2.9 m/s: within the 169 L/s the guide recommends." });
    expect(outletCheck(g, { kind: "round_ceiling_diffuser", size: "Ø250", ls: 1000 / 7 })).toMatchObject({
      fit: "within",
      recommended_ls: 182,
      most_ls: 215,
      n: 8,
      reason: "143 L/s through a round ceiling diffuser 250, its neck at 2.9 m/s: within the 182 L/s (about NC/NR 25, 8 makers) the guide recommends.",
    });
  });

  it("left open, the living zone carries the unit's least airflow with any one bedroom", () => {
    const z = zoningCheck(g, ask.unit, ask.zones.map((zn) => ({ ...zn, outlets: ask.outlets.filter((o) => o.zone === zn.name) })));
    expect(z).toMatchObject({ least_ls: 286, fit: "enough", worst: { zones: ["Living", "Master"], outlets: 4, carries_ls: 728, carries_most_ls: 860 } });
    expect(z.reason).toBe(
      "The unit's least airflow is 28.6% of its 1000 L/s, the guide's least for an inverter fan (2 makers; its own low fan isn't known). The least that can run is Master with Living left open: 4 outlets carry 728 L/s at the guide's recommendation, enough."
    );
    /* a one-outlet bedroom is a small zone */
    expect(z.notes).toEqual(["Master is 14% of the outlets: the guide puts no zone under about 25% of the airflow."]);
  });

  it("its two Ø400 return spigots run at 4.0 m/s: over the recommendation, within the most", () => {
    const out = airflowCheck(g, ask);
    const ret = out.checks.find((c) => c.check === "Return ducts, 2 × Ø400")!;
    expect(ret).toMatchObject({ fit: "over", reason: "500 L/s in each of 2 Ø400 return ducts runs at 4.0 m/s: over the 418 L/s (3.3 m/s) the guide recommends, within its most of 503 L/s (4.0 m/s)." });
    expect(out.checks.find((c) => c.check === "Return grille")!.reason).toBe("1000 L/s needs 0.68 m² of face as a filter grille at 1.5 m/s: a 1200x600 or bigger.");
    expect(out.recommendations).toEqual(expect.arrayContaining(["Ø450 return ducts for 500 L/s each.", "A 1200x600 filter grille or bigger (0.68 m² of face at 1.5 m/s)."]));
  });

  it("fits its 150 Pa: what the filter, an outlet, the grille and the zone damper leave covers the run", () => {
    const s = staticBudget(g, { static_pa: 150, filtered: true, zoned: true, flex_m: 6, flex_mm: 250, flex_ls: 143, bends: 2 });
    expect(s).toMatchObject({ fit: "fits", for_duct_pa: 50.6, run_pa: 16.8, left_pa: 33.8 });
    expect(s.reason).toBe(
      "Of the unit's 150 Pa, a clean filter 50 Pa, the return grille 7.5 Pa, an outlet and its box 17 Pa, an open zone damper 25 Pa take 99 Pa, leaving 51 Pa for the duct; the index run, 6 m of Ø250 flex at 143 L/s (0.7 Pa/m), counted 2 times, 2 bends at 4.2 Pa each, takes 17 Pa: it fits, 34 Pa to spare."
    );
  });

  it("checks all of it at once, every check with the guide's figure and its reason", () => {
    const out = airflowCheck(g, ask);
    expect(out.guide).toBe("Ducted airflow guide 2026.1");
    expect(out.air).toBe("1000 L/s over 7 outlets: 143 L/s each, shared evenly at full airflow.");
    expect(out.checks.map((c) => [c.check, c.fit])).toEqual([
      ["1 × round ceiling diffuser 250, Master", "within"],
      ["1 × Ø250 flex run, Master", "within"],
      ["1 × round ceiling diffuser 250, Bed 1", "within"],
      ["1 × Ø250 flex run, Bed 1", "within"],
      ["1 × round ceiling diffuser 250, Bed 2", "within"],
      ["1 × Ø250 flex run, Bed 2", "within"],
      ["1 × round ceiling diffuser 250, Bed 3", "within"],
      ["1 × Ø250 flex run, Bed 3", "within"],
      ["3 × round ceiling diffuser 250, Living", "within"],
      ["3 × Ø250 flex runs, Living", "within"],
      ["Return grille", "sized"],
      ["Return ducts, 2 × Ø400", "over"],
      ["Zoning: what can be left running", "enough"],
      ["External static", "fits"],
    ]);
    expect(out.checks.every((c) => c.reason.length > 20)).toBe(true);
    expect(airflowSaid(out)).toBe("13 of 14 within the guide, 1 to look at");
    expect(out.note).toMatch(/recommendations.*The brief, a plan or the person's word overrides it/);
  });
});

describe("PEA-M100HAA: 700 L/s, 150 Pa, 8 outlets, 5 zones", () => {
  const ask: AirflowAsk = {
    unit: { airflow_ls: 700, static_pa: 150, low_airflow_ls: null, capacity_kw: 10 },
    outlets: outlets([["Living", 2], ["Dining", 2], ["Master", 2], ["Bed 2", 1], ["Bed 3", 1]], "200"),
    takeoffs: [{ count: 2, dia_mm: 350, ls_each: null, rigid: false }],
    zones: ["Living", "Dining", "Master", "Bed 2", "Bed 3"].map((name) => ({ name, stays_open: false })),
    ret: null,
    run: null,
  };

  it("88 L/s each: Ø200 flex at 2.8 m/s and a 200 outlet, both within", () => {
    expect(flexFor(g, 87.5)).toMatchObject({ dia_mm: 200, recommended_ls: 92 });
    expect(flexCheck(g, 200, 87.5)!.reason).toBe("88 L/s through Ø200 flex runs at 2.8 m/s: within the 92 L/s the guide recommends.");
    expect(outletCheck(g, { kind: "round_ceiling_diffuser", size: "200", ls: 87.5 })).toMatchObject({ fit: "within", recommended_ls: 120 });
  });

  it("with no zone left open, one bedroom alone can't carry its least airflow: it needs a common zone or spill, a bypass last", () => {
    const out = airflowCheck(g, ask);
    const z = out.checks.find((c) => c.check === "Zoning: what can be left running")!;
    expect(z.fit).toBe("short");
    expect(z.reason).toBe(
      "The unit's least airflow is 28.6% of its 700 L/s, the guide's least for an inverter fan (2 makers; its own low fan isn't known). The least that can run is Bed 2 alone: its 1 outlet carries 120 L/s at the guide's recommendation, short: it needs a common zone that's always open, or spill zones that open as others close, and a bypass last. Bed 2 has 1 outlet open: the guide's least is 2 at once. Bed 2 is 13% of the outlets: the guide puts no zone under about 25% of the airflow."
    );
    expect(out.recommendations).toContain("Zoning: a zone left open (a common zone, not a bedroom), or spill zones, so at least 200 L/s always has somewhere to go; a bypass last.");
  });

  it("with the living zone left open, a bedroom and the living carry it", () => {
    const zones = ask.zones.map((zn) => ({ ...zn, stays_open: zn.name === "Living", outlets: ask.outlets.filter((o) => o.zone === zn.name) }));
    expect(zoningCheck(g, ask.unit, zones)).toMatchObject({ fit: "enough", worst: { zones: ["Living", "Bed 2"], outlets: 3, carries_ls: 360 } });
  });

  it("its two Ø350 takeoffs carry 350 L/s each, over the 337 recommended, within the 385 most", () => {
    const t = airflowCheck(g, ask).checks.find((c) => c.check === "2 × Ø350 takeoffs")!;
    expect(t).toMatchObject({ fit: "over", reason: "350 L/s through Ø350 flex runs at 3.6 m/s: over the 337 L/s the guide recommends, within its most of 385 L/s; Ø400 carries it at 2.8 m/s." });
  });

  it("with no run given, says what's left of its static for the duct", () => {
    expect(staticBudget(g, { static_pa: 150, filtered: true, zoned: true })).toMatchObject({
      fit: "unknown",
      for_duct_pa: 50.6,
      reason: "Of the unit's 150 Pa, a clean filter 50 Pa, the return grille 7.5 Pa, an outlet and its box 17 Pa, an open zone damper 25 Pa take 99 Pa, leaving 51 Pa for the duct: the index run's lengths are needed to check it.",
    });
  });
});

describe("each check alone", () => {
  it("an outlet over the recommendation says the size that takes it", () => {
    expect(outletCheck(g, { kind: "round_ceiling_diffuser", size: "200", ls: 130 })).toMatchObject({ fit: "over", fits_it: "250" });
    expect(outletCheck(g, { kind: "floor_grille", size: "100 x 300", ls: 60 })).toMatchObject({ size: "300x100", fit: "within", recommended_ls: 82 });
    expect(outletCheck(g, { kind: "floor_grille", size: "500x100", ls: 60 })).toMatchObject({ fit: null, reason: expect.stringMatching(/^The guide has no floor grille 500x100: its floor grilles are 300x50, 250x100/) });
  });

  it("a linear slot is held a metre a slot", () => {
    expect(outletCheck(g, { kind: "linear_slot", size: "2 slot", ls: 90, length_m: 1.2 })).toMatchObject({ size: "2-slot", fit: "within", reason: expect.stringMatching(/^90 L\/s through 1.2 m of 2-slot linear slot is 38 L\/s a metre a slot: within the 40 L\/s a metre a slot/) });
    expect(outletCheck(g, { kind: "linear_slot", size: "2-slot", ls: 90 }).reason).toMatch(/its length is needed/);
  });

  it("a return grille: the face it needs, and a size against it", () => {
    expect(returnCheck(g, { ls: 700, filtered: false })).toMatchObject({ velocity_ms: 2.29, smallest_size: "800x400" });
    expect(returnCheck(g, { ls: 700, filtered: true, w_mm: 900, h_mm: 500 })).toMatchObject({
      fit: "over",
      carries_ls: 657,
      reason: "A 900x500 filter grille carries 657 L/s at 1.5 m/s on its face; 700 L/s needs 0.48 m² of face as a filter grille at 1.5 m/s: over it, within the guide's most (1.8 m/s, 815 L/s); a 1139x539 takes it.",
    });
  });

  it("a duct for an airflow, flex or rigid, and none past the biggest", () => {
    expect(ductSizeFor(g, 300, "flex")).toMatchObject({ dia_mm: 350, velocity_ms: 3.12 });
    expect(ductSizeFor(g, 300, "rigid")).toMatchObject({ dia_mm: 300, recommended_ls: 320 });
    expect(flexFor(g, 900)).toBeNull();
    expect(flexCheck(g, 500, 900)!.reason).toMatch(/over the most the guide gives, 785 L\/s; it's more than one flex run should carry: split it\.$/);
  });

  it("its own low fan, where its data gives it, over the guide's share", () => {
    expect(zoningCheck(g, { airflow_ls: 1000, low_airflow_ls: 400 }, [{ name: "A", outlets: [{ kind: "round_ceiling_diffuser", size: "250", count: 2 }] }, { name: "B", outlets: [{ kind: "round_ceiling_diffuser", size: "250", count: 2 }] }])).toMatchObject({
      least_ls: 400,
      least_from: "its own low fan, 400 L/s",
      fit: "louder",
    });
  });
});
