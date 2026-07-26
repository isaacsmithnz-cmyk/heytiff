import {
  activeBusinessCosts,
  buildEngineData,
  emptyState,
  hydrateState,
  runEngine,
  type RateCalcState,
  type XeroCostSnapshot,
} from "../state";
import type { BusinessCost } from "../engine";

/* The two properties that would fail silently:

   1. hydrateState is a WHITELIST merge — a key it doesn't name is dropped on
      the next save round-trip. If costsSource/xeroCosts ever fall out of it,
      the calculator would appear to work and quietly lose the Xero source on
      every save.
   2. Switching source must not touch the other side's figures. A destructive
      switch only shows up when someone switches back and finds their work
      gone — long after the change that caused it. */

const line = (name: string, amount: number, allocated_to = "shared"): BusinessCost => ({
  name,
  amount,
  allocated_to,
});

const snapshot = (lines: BusinessCost[]): XeroCostSnapshot => ({
  fetchedAt: "2026-07-26T00:00:00.000Z",
  period: { from: "2025-07-01", to: "2026-06-30", label: "FY 2025–26" },
  tenantName: "Acme Air",
  lines,
  excluded: [{ name: "Wages", amount: 220000, reason: "wages" }],
  sections: ["Less Operating Expenses"],
});

const withXero = (over: Partial<RateCalcState> = {}): RateCalcState => ({
  ...emptyState(),
  businessCosts: [line("Typed rent", 24000)],
  xeroCosts: snapshot([line("Xero rent", 30000)]),
  costsSource: "xero",
  ...over,
});

describe("hydrateState — the whitelist", () => {
  it("keeps the source and the snapshot across a round trip", () => {
    const before = withXero();
    const after = hydrateState(JSON.parse(JSON.stringify(before)));

    expect(after.costsSource).toBe("xero");
    expect(after.xeroCosts?.lines).toEqual([line("Xero rent", 30000)]);
    expect(after.xeroCosts?.period.label).toBe("FY 2025–26");
    expect(after.xeroCosts?.excluded).toHaveLength(1);
  });

  it("defaults an untouched state to manual entry", () => {
    expect(emptyState().costsSource).toBe("manual");
    expect(emptyState().xeroCosts).toBeNull();
    // a state saved before this feature existed
    expect(hydrateState({ staff: [], settings: {}, mode: {} }).costsSource).toBe("manual");
  });

  /* Without this, the engine would run on an empty cost pool and produce a
     rate with no overheads in it — which looks like a working answer. */
  it("falls back to manual when the source says xero but there is no snapshot", () => {
    const stranded = hydrateState({ staff: [], settings: {}, mode: {}, costsSource: "xero" });
    expect(stranded.costsSource).toBe("manual");
    expect(stranded.xeroCosts).toBeNull();
  });

  it("degrades a malformed snapshot rather than passing junk to the engine", () => {
    const bad = hydrateState({ staff: [], settings: {}, mode: {}, costsSource: "xero", xeroCosts: { lines: "nope" } });
    expect(bad.costsSource).toBe("manual");
    expect(bad.xeroCosts).toBeNull();
  });

  it("repairs a line with an unreadable amount instead of dropping the pull", () => {
    const patched = hydrateState({
      staff: [],
      settings: {},
      mode: {},
      costsSource: "xero",
      xeroCosts: { lines: [{ name: "Rent", amount: "lots" }] },
    });
    expect(patched.xeroCosts?.lines).toEqual([{ name: "Rent", amount: 0, allocated_to: "shared" }]);
  });
});

describe("switching source is non-destructive", () => {
  it("leaves the typed-in list untouched while Xero is the source", () => {
    const s = withXero();
    expect(s.businessCosts).toEqual([line("Typed rent", 24000)]);
    expect(activeBusinessCosts(s)).toEqual([line("Xero rent", 30000)]);
  });

  it("gives the typed-in list straight back on switching to manual", () => {
    const s = withXero({ costsSource: "manual" });
    expect(activeBusinessCosts(s)).toEqual([line("Typed rent", 24000)]);
    // and the snapshot is still there to switch back to
    expect(s.xeroCosts?.lines).toEqual([line("Xero rent", 30000)]);
  });

  it("survives a save round-trip in either position", () => {
    for (const costsSource of ["manual", "xero"] as const) {
      const after = hydrateState(JSON.parse(JSON.stringify(withXero({ costsSource }))));
      expect(after.businessCosts).toEqual([line("Typed rent", 24000)]);
      expect(after.xeroCosts?.lines).toEqual([line("Xero rent", 30000)]);
      expect(after.costsSource).toBe(costsSource);
    }
  });
});

describe("buildEngineData", () => {
  it("feeds the engine the Xero lines when Xero is the source", () => {
    expect(buildEngineData(withXero()).businessCosts).toEqual([line("Xero rent", 30000)]);
  });

  it("feeds it the typed-in list otherwise", () => {
    expect(buildEngineData(withXero({ costsSource: "manual" })).businessCosts).toEqual([
      line("Typed rent", 24000),
    ]);
  });

  /* simpleBusinessData makes the engine use a 3-month average INSTEAD of the
     itemised list — passing both would throw away the figures just fetched. */
  it("never sends the simple 3-month average alongside Xero figures", () => {
    const s = withXero({ mode: { staff: "Simple", business: "Simple", vehicles: "Simple" } });
    expect(buildEngineData(s).simpleBusinessData).toBeUndefined();
  });

  it("still sends it in simple manual mode", () => {
    const s = withXero({
      costsSource: "manual",
      mode: { staff: "Simple", business: "Simple", vehicles: "Simple" },
      simpleBusiness: { months: [1000, 1100, 1200] },
    });
    expect(buildEngineData(s).simpleBusinessData).toEqual({ months: [1000, 1100, 1200] });
  });

  it("falls back to the manual pool if the snapshot vanished", () => {
    const s = withXero({ xeroCosts: null });
    expect(buildEngineData(s).businessCosts).toEqual([line("Typed rent", 24000)]);
  });
});

describe("the Business step counts as done on real Xero figures", () => {
  it("is not 'not_started' once a pull has real amounts", () => {
    const s = withXero({ businessCosts: [], simpleBusiness: { months: [0, 0, 0] } });
    expect(runEngine(s).steps.business.completion).not.toBe("not_started");
  });

  it("stays not-started when the pull found nothing", () => {
    const s = withXero({
      businessCosts: [],
      simpleBusiness: { months: [0, 0, 0] },
      xeroCosts: snapshot([line("Empty account", 0)]),
    });
    expect(runEngine(s).steps.business.completion).toBe("not_started");
  });
});
