import { makerFromModels, makerFromPages } from "../maker";
import type { DataPack } from "@/lib/studio/packs/schema";

/* 24 November 2026: Mitsubishi Electric's SEZ manual had its maker only as a
   logo on the cover, so it sat under No brand; page 10 names it. */
const NAMES = ["Daikin", "Mitsubishi Electric", "Mitsubishi Heavy Industries", "Fujitsu", "LG", "ActronAir", "Temperzone"];

describe("a maker the cover doesn't print", () => {
  it("is the brand the pages name", () => {
    const pages = [
      "SEZ-M25DAL SEZ-M35DAL INSTALLATION MANUAL For use with R32",
      "Warning. It may also be in violation of applicable laws. MITSUBISHI ELECTRIC CORPORATION cannot be held responsible for malfunctions",
    ];
    expect(makerFromPages(pages, NAMES)).toBe("Mitsubishi Electric");
  });

  it("counts a longer name before a shorter one inside it, and spaced or joined the same", () => {
    expect(makerFromPages(["MITSUBISHI HEAVY INDUSTRIES THERMAL SYSTEMS, LTD. Mitsubishi Heavy Industries"], ["Mitsubishi", ...NAMES])).toBe("Mitsubishi Heavy Industries");
    expect(makerFromPages(["Actron Air ESP Platinum service"], NAMES)).toBe("ActronAir");
  });

  it("takes none when two brands are named near as often, or none at all", () => {
    expect(makerFromPages(["Fujitsu adapter for Daikin units. Daikin and Fujitsu"], NAMES)).toBeNull();
    expect(makerFromPages(["Wiring and commissioning"], NAMES)).toBeNull();
    // a word that only contains a short name isn't it
    expect(makerFromPages(["The building's LGA is listed"], NAMES)).toBeNull();
  });

  it("is the brand the data books give the title's model codes", () => {
    const packs = [
      {
        brands: [{ id: "me", name: "Mitsubishi Electric" }],
        outdoor_units: [{ model: "PUZ-ZM100VKA2", brand: "me" }],
        indoor_units: [{ model: "SEZ-M25DAL", brand: "me" }, { model: "SEZ-M35DAL", brand: "me" }],
      },
      { brands: [{ id: "dk", name: "Daikin" }], outdoor_units: [{ model: "RZA60C2V1", brand: "dk" }], indoor_units: [] },
    ] as unknown as DataPack[];
    expect(makerFromModels(packs, "SEZ-M25,M35,M50,M60,M71DAL indoor unit installation manual", NAMES)).toBe("Mitsubishi Electric");
    expect(makerFromModels(packs, "RZA60C2V1 outdoor", NAMES)).toBe("Daikin");
    expect(makerFromModels(packs, "DC fan motor testing", NAMES)).toBeNull();
  });
});
