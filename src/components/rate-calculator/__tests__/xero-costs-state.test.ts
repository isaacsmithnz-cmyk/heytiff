import {
  activeBusinessCosts,
  activeFleetAnnual,
  activeVehicles,
  costsToXeroPatch,
  fleetSourceMixed,
  buildEngineData,
  emptyState,
  hydrateState,
  runEngine,
  snapshotAgeMonths,
  snapshotTotal,
  fleetCosted,
  fleetOnXero,
  mergeSnapshot,
  periodChoiceOf,
  snapshotVehicleTotal,
  sourceSwitchVisible,
  type RateCalcState,
  type XeroCostSnapshot,
} from "../state";
import type { BusinessCost, VehicleRecord } from "../engine";

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

const snapshot = (lines: BusinessCost[], over: Partial<XeroCostSnapshot> = {}): XeroCostSnapshot => ({
  fetchedAt: "2026-07-26T00:00:00.000Z",
  period: { from: "2025-07-01", to: "2026-06-30", label: "FY 2025–26" },
  tenantName: "Acme Air",
  lines,
  excluded: [{ name: "Wages", amount: 220000, reason: "wages" }],
  notes: [],
  sections: ["Less Operating Expenses"],
  dormant: [],
  monthsCovered: 12,
  annualise: true,
  ...over,
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

describe("sourceSwitchVisible — the way back to manual", () => {
  /* The audit's A8: the switch rendered only while CONNECTED, the panel
     rendered whenever the SOURCE was xero — so a dead grant trapped the
     calculator on a frozen snapshot with the exit hidden. */
  it("shows whenever there is a choice: a grant to use, or a snapshot to leave", () => {
    expect(sourceSwitchVisible(true, "manual")).toBe(true);
    expect(sourceSwitchVisible(true, "xero")).toBe(true);
    expect(sourceSwitchVisible(false, "xero")).toBe(true); // the trap, fixed
    expect(sourceSwitchVisible(false, "manual")).toBe(false); // nothing to offer
  });
});

describe("snapshot arithmetic", () => {
  it("totals only the included lines — one number for panel, seed and EOFY", () => {
    const snap = {
      fetchedAt: "2026-01-01T00:00:00Z",
      period: { from: "2025-07-01", to: "2026-06-30", label: "FY 2025–26" },
      tenantName: "HeyTiff",
      lines: [
        { name: "Rent", amount: 24000, allocated_to: "both" },
        { name: "Software", amount: 6000, allocated_to: "both" },
      ],
      excluded: [{ name: "Wages", amount: 400000, reason: "wages" }],
      sections: ["Operating Expenses"],
    } as never;
    expect(snapshotTotal(snap)).toBe(30000);
    expect(snapshotTotal(null)).toBe(0);
  });

  it("scales a known part-year up to a year, everywhere at once", () => {
    const half = snapshot([line("Rent", 12000)], { monthsCovered: 6 });
    // the panel's total, the Simple seed and the EOFY seed all read this
    expect(snapshotTotal(half)).toBe(24000);
    // and so does the pool the engine actually prices from
    expect(activeBusinessCosts(withXero({ xeroCosts: half }))).toEqual([line("Rent", 24000)]);
  });

  it("leaves the figures alone when the user turns scaling off", () => {
    const half = snapshot([line("Rent", 12000)], { monthsCovered: 6, annualise: false });
    expect(snapshotTotal(half)).toBe(12000);
    expect(activeBusinessCosts(withXero({ xeroCosts: half }))).toEqual([line("Rent", 12000)]);
  });

  /* A snapshot written before coverage existed says nothing about how many
     months it covers. Guessing "12" would be luck; guessing anything else
     would silently reprice every rate on the next load. */
  it("never scales a window whose coverage is unknown", () => {
    const legacy = snapshot([line("Rent", 12000)], { monthsCovered: null });
    expect(snapshotTotal(legacy)).toBe(12000);
    const rehydrated = hydrateState(
      JSON.parse(JSON.stringify(withXero({ xeroCosts: snapshot([line("Rent", 12000)]) })))
    );
    // a row saved without the key at all
    const stripped = JSON.parse(JSON.stringify(rehydrated)) as Record<string, never>;
    delete (stripped.xeroCosts as unknown as Record<string, unknown>).monthsCovered;
    expect(hydrateState(stripped).xeroCosts?.monthsCovered).toBeNull();
    expect(snapshotTotal(hydrateState(stripped).xeroCosts)).toBe(12000);
  });

  it("keeps coverage and the scaling choice across a save round-trip", () => {
    const s = withXero({ xeroCosts: snapshot([line("Rent", 12000)], { monthsCovered: 5, annualise: false }) });
    const after = hydrateState(JSON.parse(JSON.stringify(s)));
    expect(after.xeroCosts?.monthsCovered).toBe(5);
    expect(after.xeroCosts?.annualise).toBe(false);
  });

  /* The money that used to fall between two steps: held out of overheads
     because Vehicles "has it", when Vehicles had nothing in it. */
  it("reports what the P&L says the fleet cost, annualised with everything else", () => {
    const snap = snapshot([line("Rent", 12000)], {
      monthsCovered: 6,
      excluded: [
        { name: "Motor Vehicle Expenses", amount: 3000, reason: "vehicle" },
        { name: "Fuel", amount: 1500, reason: "vehicle" },
        { name: "Wages", amount: 90000, reason: "wages" },
      ],
    });
    expect(snapshotVehicleTotal(snap)).toBe(9000); // (3000 + 1500) × 2
    expect(snapshotVehicleTotal(null)).toBe(0);
  });

  it("ages in whole 30-day months, and answers null for garbage", () => {
    const now = Date.parse("2026-07-28T00:00:00Z");
    expect(snapshotAgeMonths("2026-07-01T00:00:00Z", now)).toBe(0);
    expect(snapshotAgeMonths("2026-01-28T00:00:00Z", now)).toBe(6);
    expect(snapshotAgeMonths("not a date", now)).toBeNull();
    expect(snapshotAgeMonths(undefined, now)).toBeNull();
  });
});

/* ── the fleet, sourced from Xero ────────────────────────────────────────

   The rule these pin: a vehicle dollar is in the FLEET total or in the
   OVERHEAD pool, never both and never neither. It is worth testing at the
   engine's own totals rather than at the helpers, because "counted twice" and
   "counted nowhere" both look perfectly healthy one function at a time. */

const fleetSnap = (over: Partial<XeroCostSnapshot> = {}) =>
  snapshot([line("Rent", 24000), line("Insurance", 6000)], {
    excluded: [
      { name: "Motor Vehicle Expenses", amount: 9000, reason: "vehicle" },
      { name: "Wages", amount: 220000, reason: "wages" },
    ],
    ...over,
  });

/** Everything the rate has to recover, however it is bucketed. */
const costBase = (s: RateCalcState) => {
  const c = runEngine(s).calc;
  return c.instLab + c.svcLab + c.adminLab
    + c.instVehicle + c.svcVehicle + c.adminVehicle
    + c.enteredBiz;
};

describe("fleet costs from Xero", () => {
  const onFleet = (over: Partial<RateCalcState> = {}): RateCalcState => ({
    ...emptyState(),
    xeroCosts: fleetSnap(),
    costsSource: "xero",
    vehicleSource: "xero",
    ...over,
  });

  it("carries the vehicle lines into the fleet, and only those", () => {
    expect(activeFleetAnnual(onFleet())).toBe(9000);
    // wages are held for Staff, not handed to the fleet
    expect(activeBusinessCosts(onFleet()).map(l => l.name)).toEqual(["Rent", "Insurance"]);
  });

  it("is null unless Xero is actually the fleet's source", () => {
    expect(activeFleetAnnual(onFleet({ vehicleSource: "manual" }))).toBeNull();
    expect(activeFleetAnnual(emptyState())).toBeNull();
  });

  /* THE INVARIANT. Pressing Include on the Business panel moves a vehicle line
     into the overhead pool; the fleet must give up exactly what overheads
     gained, and the total to recover must not move by a cent. */
  it("hands the money over intact when a vehicle line is included in overheads", () => {
    const held = onFleet();
    const included = onFleet({
      xeroCosts: fleetSnap({
        lines: [line("Rent", 24000), line("Insurance", 6000), line("Motor Vehicle Expenses", 9000)],
        excluded: [{ name: "Wages", amount: 220000, reason: "wages" }],
      }),
    });

    expect(activeFleetAnnual(held)).toBe(9000);
    expect(activeFleetAnnual(included)).toBeNull(); // nothing left in the fleet
    expect(snapshotTotal(included.xeroCosts) - snapshotTotal(held.xeroCosts)).toBe(9000);
    // and the thing that actually matters
    expect(costBase(included)).toBeCloseTo(costBase(held), 6);
  });

  /* The bug that started this: held out of overheads for a step that never
     claimed it. Whichever step owns the dollar, the rate must recover it. */
  it("never loses the money between the two steps", () => {
    const typedIn = {
      ...emptyState(),
      xeroCosts: fleetSnap(),
      costsSource: "xero" as const,
      vehicleSource: "manual" as const,
      // the same 9,000 a year, typed into the three month boxes
      simpleVehicle: { months: [750, 750, 750] },
    };
    expect(costBase(onFleet())).toBeCloseTo(costBase(typedIn), 6);
  });

  it("scales a part-year fleet the same way it scales overheads", () => {
    const half = onFleet({ xeroCosts: fleetSnap({ monthsCovered: 6 }) });
    expect(activeFleetAnnual(half)).toBe(18000); // 9,000 over six months
    expect(activeFleetAnnual(onFleet({ xeroCosts: fleetSnap({ monthsCovered: 6, annualise: false }) }))).toBe(9000);
  });

  /* Xero outranks BOTH typed modes. Letting Detailed quietly win would leave
     someone on Xero reading a fleet cost the rate wasn't using. */
  it("wins over the per-vehicle editor, not just the simple boxes", () => {
    const detailed = onFleet({ mode: { staff: "Simple", business: "Simple", vehicles: "Detailed" } });
    expect(buildEngineData(detailed).simpleVehicleData).toEqual({ months: [], annual: 9000 });
  });

  /* Without this the step reads "not started" forever and the rail never says
     the calculator is ready — pulling real figures IS finishing the step. */
  it("counts as a completed step", () => {
    expect(fleetCosted(onFleet())).toBe(true);
    expect(fleetCosted(onFleet({ vehicleSource: "manual" }))).toBe(false);
  });

  it("survives a round trip, and falls back to manual with no snapshot", () => {
    expect(hydrateState(JSON.parse(JSON.stringify(onFleet()))).vehicleSource).toBe("xero");
    expect(hydrateState({ vehicleSource: "xero" }).vehicleSource).toBe("manual");
  });
});

/* ── the mixed state, and the double count it used to allow ──────────────

   Business costs on Xero with the fleet typed in is the one combination where
   a dollar can be doubled and another dropped in the same breath: the P&L's
   vehicle lines have left the overhead pool with nothing claiming them, while
   the per-vehicle editor still asks for insurance and depreciation the pool is
   already carrying. */

const ute = (over: Partial<VehicleRecord["costs"]> = {}): VehicleRecord => ({
  vehicle_id: "v1",
  vehicle_name: "Hilux",
  allocation: "Install",
  costs: { fuel_per_week: 100, rego: 900, servicing: 1200, ...over },
});

describe("what Xero already covers, the vehicle editor must not re-charge", () => {
  const base = (over: Partial<RateCalcState> = {}): RateCalcState => ({
    ...emptyState(),
    xeroCosts: fleetSnap(),
    costsSource: "xero",
    vehicleSource: "manual",
    mode: { staff: "Simple", business: "Simple", vehicles: "Detailed" },
    vehicles: [ute()],
    ...over,
  });

  /* The whole point: the P&L's Insurance and Depreciation accounts stay in the
     overhead pool, so a figure typed here is the SAME money a second time. */
  it("zeroes only the fields the P&L already pays for", () => {
    const s = base({ vehicles: [ute({ insurance: 2000, replacement_value: 60000, resale_value: 20000, cycle_years: 5 })] });
    const c = activeVehicles(s)[0].costs!;
    expect(c.insurance).toBe(0);
    expect(c.replacement_value).toBe(0);
    expect(c.resale_value).toBe(0);
    // these DID leave the pool as vehicle lines, so they're the editor's job
    expect(c.fuel_per_week).toBe(100);
    expect(c.rego).toBe(900);
    expect(c.servicing).toBe(1200);
    // still needed — it divides fit-out, which nothing else covers
    expect(c.cycle_years).toBe(5);
  });

  /* A greyed input is cosmetic on its own. What proves the fix is that a
     figure typed BEFORE Xero was connected stops reaching the engine. */
  it("stops a pre-existing figure from being charged twice", () => {
    const clean = base();
    const typedBefore = base({ vehicles: [ute({ insurance: 2000 })] });
    expect(costBase(typedBefore)).toBeCloseTo(costBase(clean), 6);
  });

  it("leaves the typed figures in state, so leaving Xero hands them back", () => {
    const s = base({ vehicles: [ute({ insurance: 2000 })] });
    expect(s.vehicles[0].costs!.insurance).toBe(2000);
    expect(activeVehicles({ ...s, costsSource: "manual" })[0].costs!.insurance).toBe(2000);
  });
});

describe("keeping the fleet and the books on the same source", () => {
  const withSnap = (over: Partial<RateCalcState> = {}): RateCalcState => ({
    ...emptyState(),
    xeroCosts: fleetSnap(),
    ...over,
  });

  it("takes the fleet onto Xero too, so the mixed state isn't the default", () => {
    expect(costsToXeroPatch(withSnap())).toEqual({ costsSource: "xero", vehicleSource: "xero" });
  });

  /* Deferring to real work: silently overriding figures somebody entered, to
     close a trap, would be its own trap. */
  it("leaves a hand-costed fleet alone", () => {
    const costed = withSnap({ simpleVehicle: { months: [750, 750, 750] } });
    expect(costsToXeroPatch(costed)).toEqual({ costsSource: "xero" });
    expect(fleetSourceMixed({ ...costed, ...costsToXeroPatch(costed) })).toBe(true);
  });

  it("has nothing to take when the P&L shows no vehicle lines", () => {
    const noVehicleLines = withSnap({
      xeroCosts: fleetSnap({ excluded: [{ name: "Wages", amount: 220000, reason: "wages" }] }),
    });
    expect(costsToXeroPatch(noVehicleLines)).toEqual({ costsSource: "xero" });
  });

  it("only calls it mixed when the books are actually on Xero", () => {
    expect(fleetSourceMixed(withSnap({ costsSource: "xero", vehicleSource: "manual" }))).toBe(true);
    expect(fleetSourceMixed(withSnap({ costsSource: "xero", vehicleSource: "xero" }))).toBe(false);
    expect(fleetSourceMixed(withSnap({ costsSource: "manual", vehicleSource: "manual" }))).toBe(false);
  });
});

/* ── the audit's holes, pinned ───────────────────────────────────────────

   Three ways the first cut of this feature could still lie: a nil Xero fleet
   falling back to stale typed figures, a refresh resetting human judgements,
   and a convenience default overriding an explicit "no vehicles". */

describe("a Xero fleet that reads nil is still the answer", () => {
  /* Every vehicle line Included back into overheads — the user's deliberate
     "price it all as overhead" state. The engine must treat that as fleet
     zero, NOT as an absence that lets older typed figures back in. */
  const allIncluded = (over: Partial<RateCalcState> = {}): RateCalcState => ({
    ...emptyState(),
    costsSource: "xero",
    vehicleSource: "xero",
    xeroCosts: fleetSnap({
      lines: [line("Rent", 24000), line("Insurance", 6000), line("Motor Vehicle Expenses", 9000)],
      excluded: [{ name: "Wages", amount: 220000, reason: "wages" }],
    }),
    ...over,
  });

  it("suppresses stale month boxes instead of falling back to them", () => {
    const s = allIncluded({ simpleVehicle: { months: [750, 750, 750] } });
    expect(buildEngineData(s).simpleVehicleData).toEqual({ months: [], annual: 0 });
    const c = runEngine(s).calc;
    expect(c.instVehicle + c.svcVehicle + c.adminVehicle).toBe(0);
  });

  it("suppresses the per-vehicle editor's typed fuel too", () => {
    const s = allIncluded({
      mode: { staff: "Simple", business: "Simple", vehicles: "Detailed" },
      vehicles: [ute()],
    });
    const c = runEngine(s).calc;
    expect(c.instVehicle + c.svcVehicle + c.adminVehicle).toBe(0);
  });

  /* The conservation law, at the moment the LAST vehicle line moves: fleet
     $9,000 → fleet nil + overheads +$9,000, with stale typed figures present
     on both sides trying to sneak in. */
  it("conserves the cost base when the last vehicle line is included", () => {
    const stale = { simpleVehicle: { months: [400, 400, 400] }, vehicles: [ute()] };
    const held = { ...emptyState(), costsSource: "xero" as const, vehicleSource: "xero" as const, xeroCosts: fleetSnap(), ...stale };
    const includedAll = allIncluded(stale);
    expect(costBase(includedAll)).toBeCloseTo(costBase(held), 6);
  });

  it("counts the step as answered — the money is in overheads, on purpose", () => {
    expect(runEngine(allIncluded()).steps.vehicles.completion).toBe("complete");
  });
});

describe("an explicit 'no vehicles' outranks the Xero conveniences", () => {
  it("is never auto-taken onto Xero by the source switch", () => {
    const s = { ...emptyState(), xeroCosts: fleetSnap(), noVehicles: true };
    expect(costsToXeroPatch(s)).toEqual({ costsSource: "xero" });
  });

  /* A legacy or hand-patched row CAN say both. The predicate is what keeps
     "no vehicles" true everywhere at once — engine, completion, panels. */
  it("silences a vehicleSource the row shouldn't have", () => {
    const s: RateCalcState = {
      ...emptyState(),
      costsSource: "xero",
      vehicleSource: "xero",
      noVehicles: true,
      xeroCosts: fleetSnap(),
    };
    expect(fleetOnXero(s)).toBe(false);
    const run = runEngine(s);
    expect(run.calc.instVehicle + run.calc.svcVehicle + run.calc.adminVehicle).toBe(0);
    // and it is noVehicles doing the answering, not the dead source
    expect(run.steps.vehicles.completion).toBe("complete");
  });
});

describe("mergeSnapshot — a refresh keeps every human judgement", () => {
  /* prev: the user re-allocated Rent, pulled Motor Vehicle Expenses back into
     the pool, threw out Advertising and Insurance, and turned scaling off. */
  const prev = snapshot(
    [line("Rent", 24000, "install"), line("Motor Vehicle Expenses", 9000, "service")],
    {
      excluded: [
        { name: "Advertising", amount: 1000, reason: "user" },
        { name: "Insurance", amount: 5000, reason: "user" },
        { name: "Wages", amount: 220000, reason: "wages" },
      ],
      annualise: false,
    }
  );
  /* fresh: every amount moved, and the mapper — knowing nothing of the user —
     re-imports what they removed and re-excludes what they put back. */
  const fresh = snapshot(
    [line("Rent", 26000), line("Advertising", 1200), line("Insurance", 6000)],
    {
      excluded: [
        { name: "Motor Vehicle Expenses", amount: 9500, reason: "vehicle" },
        { name: "Wages", amount: 230000, reason: "wages" },
      ],
      notes: [{ name: "Insurance", amount: 6000, note: "insurance" }],
      monthsCovered: 6,
    }
  );
  const out = mergeSnapshot(prev, fresh);

  it("keeps allocations by name; amounts are the fresh pull's", () => {
    expect(out.lines).toContainEqual(line("Rent", 26000, "install"));
  });

  it("keeps a user re-exclusion out, at the fresh amount", () => {
    expect(out.excluded).toContainEqual({ name: "Advertising", amount: 1200, reason: "user" });
    expect(out.lines.map(l => l.name)).not.toContain("Advertising");
  });

  it("keeps a user inclusion in — the patterns don't get a second vote", () => {
    expect(out.lines).toContainEqual(line("Motor Vehicle Expenses", 9500, "service"));
  });

  it("keeps the mapper's own exclusions and the fresh coverage", () => {
    expect(out.excluded).toContainEqual({ name: "Wages", amount: 230000, reason: "wages" });
    expect(out.monthsCovered).toBe(6);
  });

  it("keeps the annualise answer — 'is this typical?' is theirs, not per-pull", () => {
    expect(out.annualise).toBe(false);
  });

  it("drops a note whose line didn't stay in the pool", () => {
    expect(out.notes).toEqual([]);
  });

  it("is the fresh pull untouched when there was nothing before", () => {
    expect(mergeSnapshot(null, fresh)).toBe(fresh);
  });
});

describe("periodChoiceOf", () => {
  it("reads the window back off the snapshot, defaulting to last-fy", () => {
    expect(periodChoiceOf(snapshot([], { period: { from: "", to: "", label: "Last 12 months" } }))).toBe("trailing-12");
    expect(periodChoiceOf(snapshot([]))).toBe("last-fy");
    expect(periodChoiceOf(null)).toBe("last-fy");
  });
});
