import path from "node:path";
import { loadInstalledPack } from "@/lib/studio/packs/server";
import { differing, matchUnits, modelStem, squash } from "../unit-specs";

/* Against the real Mitsubishi Electric pack, so a figure here is a figure
   the Studio designs with: the PUMY-SP140 pair Isaac's board shows. */
const BASE = path.join(process.cwd(), "data/packs");

describe("a model looked up in the Library", () => {
  it("finds a model however it is typed, outdoors first, with the book it came from", async () => {
    const { pack } = await loadInstalledPack("mitsubishi-electric", "2026.1", BASE);
    const units = matchUnits([pack], "pumy sp140");
    expect(units.map((u) => u.model)).toEqual(["PUMY-SP140VKMD2-A", "PUMY-SP140YKMD2-A"]);
    const [v] = units;
    expect(v).toMatchObject({
      side: "outdoor",
      brand: "Mitsubishi Electric",
      cooling: "15.5 kW",
      heating: "16.5 kW",
      power: "Single phase",
      breaker: "32 A",
      pipes: "9.52 liquid, 15.88 gas",
      size: "1050 x 330 x 981 mm",
      weight: "93 kg",
    });
    expect(v.source).toContain("M-P0860");
  });

  it("says in amber only what differs between the two", async () => {
    const { pack } = await loadInstalledPack("mitsubishi-electric", "2026.1", BASE);
    const diff = differing(matchUnits([pack], "PUMY-SP140"));
    expect([...diff].sort()).toEqual(["breaker", "power", "weight"]);
  });

  it("lists nothing for fewer than three characters, and squashes spacing and dashes", () => {
    expect(matchUnits([], "PU")).toEqual([]);
    expect(squash(" pumy-sp 140 ")).toBe("PUMYSP140");
  });

  it("names a model's family for the documents that cover it", () => {
    expect(modelStem("PUMY-SP140")).toBe("PUMYSP");
    expect(modelStem("pead m100")).toBe("PEADM");
    expect(modelStem("ducted")).toBeNull();
  });
});
