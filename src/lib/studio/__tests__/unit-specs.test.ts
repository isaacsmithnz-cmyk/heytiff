/* Unit spec registry: attribution groups, default columns, sound-range
   formatting, per-device persistence. */

import {
  UNIT_SPECS,
  COLUMN_SPECS,
  DEFAULT_COLUMN_IDS,
  SPEC_GROUP_LABELS,
  formatSoundRange,
  specsInGroup,
  loadColumnIds,
  saveColumnIds,
} from "../unit-specs";

const LS_KEY = "heytiff.studio.unit-columns";

describe("unit-specs registry", () => {
  beforeEach(() => window.localStorage.clear());

  it("every spec id is unique", () => {
    const ids = UNIT_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defaults are capacity + physical size (airflow gated to ducted in the UI)", () => {
    expect(DEFAULT_COLUMN_IDS).toEqual(["capacity", "width", "depth", "height", "airflow"]);
  });

  it("loadColumnIds returns the defaults when nothing is saved", () => {
    expect(loadColumnIds()).toEqual(DEFAULT_COLUMN_IDS);
  });

  it("save then load round-trips the chosen columns", () => {
    saveColumnIds(["capacity", "sound", "weight"]);
    expect(loadColumnIds()).toEqual(["capacity", "sound", "weight"]);
  });

  it("drops ids no longer in the registry", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify(["capacity", "bogus", "weight"]));
    expect(loadColumnIds()).toEqual(["capacity", "weight"]);
  });

  it("falls back to defaults on a corrupt value", () => {
    window.localStorage.setItem(LS_KEY, "not json {");
    expect(loadColumnIds()).toEqual(DEFAULT_COLUMN_IDS);
  });

  it("falls back to defaults when the saved list has no valid ids left", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify(["gone", "also-gone"]));
    expect(loadColumnIds()).toEqual(DEFAULT_COLUMN_IDS);
  });

  it("a pre-overhaul saved choice keeps working — 'sound' still means the indoor rating", () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify(["capacity", "sound"]));
    expect(loadColumnIds()).toEqual(["capacity", "sound"]);
    expect(UNIT_SPECS.find((s) => s.id === "sound")!.group).toBe("idu");
  });
});

describe("attribution groups", () => {
  beforeEach(() => window.localStorage.clear());

  it("every spec carries a valid group", () => {
    for (const s of UNIT_SPECS)
      expect(Object.keys(SPEC_GROUP_LABELS)).toContain(s.group);
  });

  it("the groups partition the registry (nothing lost, nothing doubled)", () => {
    const partitioned = [
      ...specsInGroup("idu"),
      ...specsInGroup("odu"),
      ...specsInGroup("pair"),
    ];
    expect(partitioned).toHaveLength(UNIT_SPECS.length);
  });

  it("outdoor specs exist and are attributed: phase / sound / size / weight / power", () => {
    const oduIds = specsInGroup("odu").map((s) => s.id);
    expect(oduIds).toEqual(
      expect.arrayContaining(["oduPhase", "oduSound", "oduSize", "oduWeight", "oduPower"])
    );
  });

  it("detail-only specs never become columns or defaults", () => {
    expect(COLUMN_SPECS.some((s) => s.detailOnly)).toBe(false);
    for (const id of DEFAULT_COLUMN_IDS)
      expect(UNIT_SPECS.find((s) => s.id === id)!.detailOnly).toBeFalsy();
    // and a saved detail-only id is dropped on load
    window.localStorage.setItem(LS_KEY, JSON.stringify(["capacity", "pipeLift"]));
    expect(loadColumnIds()).toEqual(["capacity"]);
  });
});

describe("formatSoundRange", () => {
  it("renders a range with an en dash", () => {
    expect(formatSoundRange(30, 38)).toBe("30–38 dBA");
  });
  it("renders a single figure when only high is published", () => {
    expect(formatSoundRange(undefined, 58)).toBe("58 dBA");
  });
  it("collapses low == high to one figure", () => {
    expect(formatSoundRange(38, 38)).toBe("38 dBA");
  });
  it("renders an em dash when nothing is published", () => {
    expect(formatSoundRange(undefined, undefined)).toBe("—");
  });
});
