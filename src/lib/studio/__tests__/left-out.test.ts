import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { canLeaveOut, leaveOut, leftOutRooms, putBack } from "../left-out";
import { foundOn } from "../room-edit";

const room = (id: string, name: string, extra: Record<string, unknown> = {}): DesignObject =>
  ({
    id,
    type: "room",
    floorId: "gf",
    systemId: null,
    geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] },
    props: { name, ...extra },
  }) as unknown as DesignObject;

/* 3516 as he had it: four rooms on a multi, a robe and the laundry not air conditioned */
function waitara(): DesignDocument {
  const d = createDesign({ name: "12/8-10 Park Ave", mode: "plan" });
  return {
    ...d,
    floors: [{ id: "gf", name: "Ground floor", level: 0, scaleMmPerUnit: 10, northDeg: 0, northPos: null, plans: [{ id: "sht", imageRef: "org/o/gf.png", pageNumber: null, name: "GF", width: 1000, height: 800, x: 0, y: 0 }] }],
    objects: [room("bed1", "Bed 1"), room("robe", "Robe", { fromReading: true }), room("wm", "WM")],
    systems: [{ id: "s1", name: "System 1", type: "split", brand: "mitsubishi-electric", colour: "#15803D", settings: { roomIds: ["bed1"], zoneIds: ["bed1"] } } as unknown as DesignDocument["systems"][number]],
  };
}

describe("leaving rooms out", () => {
  test("a room no system has comes off the design, kept, and nothing else moves", () => {
    const d = leaveOut(waitara(), ["robe", "wm"]);
    expect(d.objects.map((o) => o.id)).toEqual(["bed1"]);
    expect(leftOutRooms(d).map((o) => o.id)).toEqual(["robe", "wm"]);
  });

  test("a room on a system stays", () => {
    const d = waitara();
    expect(canLeaveOut(d, "bed1")).toBe(false);
    expect(leaveOut(d, ["bed1"])).toBe(d);
  });

  test("put back brings one home as it was", () => {
    const out = leaveOut(waitara(), ["robe", "wm"]);
    const d = putBack(out, ["robe"]);
    expect(d.objects.find((o) => o.id === "robe")).toEqual(waitara().objects.find((o) => o.id === "robe"));
    expect(leftOutRooms(d).map((o) => o.id)).toEqual(["wm"]);
  });

  test("Tiff never offers a room left out again", () => {
    const base = waitara();
    const read = {
      ...base,
      reading: {
        at: "",
        model: "",
        failed: [],
        floors: {
          gf: [
            {
              sheetId: "sht",
              spaces: [{ name: "Robe", named: true, kind: "room" as const, outline: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }], written: "", existing: false, openTo: "", stair: "" }],
              openings: [],
              marks: [],
              furniture: [],
              checklist: [],
              flags: [],
              planUp: "",
            },
          ],
        },
      },
    } as unknown as DesignDocument;
    /* deleted, she offers it again; left out, she doesn't */
    const deleted = { ...read, objects: read.objects.filter((o) => o.id !== "robe") };
    expect(foundOn(deleted, "gf").map((s) => s.name)).toContain("Robe");
    expect(foundOn(leaveOut(read, ["robe"]), "gf").map((s) => s.name)).not.toContain("Robe");
  });
});
