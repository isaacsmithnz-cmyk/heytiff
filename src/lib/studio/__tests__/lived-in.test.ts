import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { livedIn } from "../lived-in";
import { claimZone, livedInZones, newSystem, zoneIdsOf } from "../zones";

/* 3570's own names (22 November 2026), as its plans spell them */
describe("the rooms people live in, by name", () => {
  it.each([
    "Kitchen / Family Room / Banquet Room",
    "Dinning Room",
    "Game Room",
    "Mahjong",
    "East Lounge",
    "Study",
    "Bed 6",
    "BED 3",
    "SITTING",
    "GYM",
    "Master Bed 1",
    "Living / Dining / Kitchen",
  ])("%s is lived in", (name) => expect(livedIn(name)).toBe(true));

  it.each([
    "Bed 8 ensuite",
    "Bed 8 hall",
    "Bed 8 cupboard",
    "Bed 8 stair landing",
    "ROBE (Bed 4)",
    "WIR (Bed 1)",
    "ENSUITE (Bed 2)",
    "East Corridor / Robe strip (unnamed)",
    "Grand Hall",
    "OVAL HALL",
    "Storage (west of Grand Hall)",
    "Laundry",
    "Poeder",
    "PWD",
    "LIFT",
    "CELLAR",
    "Service Room",
    "Wet Bar Area",
    "Hallway",
  ])("%s isn't", (name) => expect(livedIn(name)).toBe(false));
});

function plan(): { doc: DesignDocument; ground: string; upper: string } {
  const doc = createDesign({ name: "plan", mode: "blank" });
  const ground = doc.floors[0].id;
  const upper = "upper";
  doc.floors.push({ ...doc.floors[0], id: upper, name: "Level 1" });
  const zone = (id: string, name: string, floorId: string) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] },
      props: { name },
    } as DesignObject);
  zone("living", "Living", ground);
  zone("bed6", "Bed 6", ground);
  zone("ens6", "Ensuite (Bed 6)", ground);
  zone("laundry", "Laundry", ground);
  zone("bed1", "BED 1", upper);
  return { doc, ground, upper };
}

describe("a new system starts with the lived-in rooms on the floor you're on (Build A, 22 November 2026)", () => {
  it("switches on that floor's lived-in zones and nothing else", () => {
    const { doc, ground } = plan();
    const made = newSystem(doc, "v1", "", ground);
    const sys = made.doc.systems.find((s) => s.id === made.systemId)!;
    expect(zoneIdsOf(sys)).toEqual(["living", "bed6"]);
  });

  it("leaves out the zones another system already has", () => {
    const { doc, ground } = plan();
    const first = newSystem(doc, "v1");
    const taken = claimZone(first.doc, first.systemId, "living");
    expect(livedInZones(taken, ground)).toEqual(["bed6"]);
  });

  it("starts empty with no floor given, as before", () => {
    const { doc } = plan();
    const made = newSystem(doc, "v1");
    expect(zoneIdsOf(made.doc.systems.find((s) => s.id === made.systemId)!)).toEqual([]);
  });
});
