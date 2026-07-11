/* Unit spec registry: default columns + per-device persistence. */

import {
  UNIT_SPECS,
  DEFAULT_COLUMN_IDS,
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
});
