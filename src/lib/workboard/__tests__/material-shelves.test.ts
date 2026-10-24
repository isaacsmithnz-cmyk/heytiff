import { CATEGORIES } from "@/lib/quotes/categories";
import { ICON_PATHS } from "@/components/shell/icon";
import { SHELF_LOOK, codeOf, onShelves, shelfOf } from "../material-shelves";

/* A job's materials on the price book's own shelves (Isaac, 25 October
   2026), each shelf with one icon in one colour. */

const row = (name: string, sub = "", designId: string | null = null) => ({ name, sub, designId });

describe("which shelf a job's row is on", () => {
  it("reads a price-book pick's code from its line, and a design's unit from its model", () => {
    expect(codeOf(row("ISOLATOR 20A", "WPS120, Rexel"))).toBe("WPS120");
    expect(codeOf(row("MSZ-AP25VGKD2-A2", "Wall mounted indoor unit, 2.5/3.2 kW"))).toBe("MSZ-AP25VGKD2-A2");
    expect(codeOf(row("Copper, 3/8\" and 5/8\""))).toBe("");
  });

  it("files a row as the price book does, by its name and code", () => {
    expect(shelfOf(row("PEAD-M71JAAD"))).toBe("units");
    expect(shelfOf(row("ISOLATOR 20A", "WPS120, Rexel"))).toBe("electrical");
    expect(shelfOf(row("Round supply grille, 250 mm"))).toBe("grilles");
    expect(shelfOf(row("Condensate pump"))).toBe("drainage");
  });

  it("reads a row's line when its name alone says nothing, and a design's undescribed unit is a unit", () => {
    expect(shelfOf(row("FTXM25R", "Hi wall indoor unit, 2.5/3.2 kW", "dsn_1"))).toBe("units");
    expect(shelfOf(row("FTXM25R", "Unit", "dsn_1"))).toBe("units");
    expect(shelfOf(row("FTXM25R", "Unit"))).toBe("other");
  });

  it("puts what it can't place under Miscellaneous", () => {
    expect(shelfOf(row("Thing nobody can place"))).toBe("other");
    expect(CATEGORIES.find((c) => c.key === "other")?.label).toBe("Miscellaneous");
  });
});

describe("the shelves on a job", () => {
  it("are the book's, in its order, only those with something on them, rows kept in list order", () => {
    const shelves = onShelves([
      row("Condensate pump"),
      row("PEAD-M71JAAD"),
      row("Thing nobody can place"),
      row("SUZ-M71VAD2-A"),
    ]);
    expect(shelves.map((s) => s.label)).toEqual(["Units", "Drainage", "Miscellaneous"]);
    expect(shelves[0].items.map((r) => r.name)).toEqual(["PEAD-M71JAAD", "SUZ-M71VAD2-A"]);
    expect(shelves[0]).toMatchObject({ icon: "unit", hue: "purple" });
  });

  it("give every shelf an icon that exists, never in red or blue", () => {
    for (const c of CATEGORIES) {
      const look = SHELF_LOOK[c.key];
      expect(ICON_PATHS[look.icon]).toBeTruthy();
      expect(["red", "blue"]).not.toContain(look.hue);
    }
  });
});
