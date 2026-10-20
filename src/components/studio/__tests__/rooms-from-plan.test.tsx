/* The Rooms page: Tiff's rooms over the plan, picked, adjusted and named on
   one page, then made the Studio's rooms. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoomsFromPlan } from "../rooms-from-plan";
import { createDesign, type DesignObject, type Floor } from "@/lib/studio/document";
import type { PlanImages } from "@/lib/studio/plans";
import type { SheetReading } from "@/lib/studio/reading";

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const space = (name: string, kind: "room" | "wet" | "cupboard", outline: { x: number; y: number }[]) => ({
  name,
  named: true,
  kind,
  outline,
  written: "",
  existing: false,
  openTo: "",
  stair: "",
});

const floor: Floor = {
  id: "f1",
  name: "Ground floor",
  level: 0,
  scaleMmPerUnit: 14,
  northDeg: null,
  northPos: null,
  plans: [{ id: "s1", imageRef: "org/o/p.png", pageNumber: 6, name: "Page 6", width: 1000, height: 700, x: 0, y: 0 }],
};
const sheets: SheetReading[] = [
  {
    sheetId: "s1",
    planUp: "N",
    spaces: [
      space("Bed 4", "room", rect(0, 0, 300, 250)),
      space("Robe", "cupboard", rect(0, 260, 300, 60)),
      space("Bathroom", "wet", rect(320, 0, 150, 250)),
      space("Living", "room", rect(500, 0, 400, 400)),
    ],
    openings: [{ kind: "window", tag: "W3", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, widthMm: 2400, room: "Bed 4", external: true, facing: "N" }],
    marks: [],
    furniture: [],
    checklist: [],
    flags: [{ kind: "label_inside", text: "WC", at: { x: 400, y: 100 }, room: "Bathroom" }],
  },
];
const images: PlanImages = {
  upload: async () => "",
  uploadSource: async () => "",
  sourceFile: async () => new File([], "x"),
  url: async () => "data:image/png;base64,iVBORw0KGgo=",
  remove: async () => {},
};

function open(onDone = jest.fn()) {
  const doc = { ...createDesign({ name: "Frogmore", mode: "plan" }), floors: [floor, { ...floor, id: "f2", name: "Level 1", level: 1, plans: [] }] };
  render(<RoomsFromPlan doc={doc} floor={floor} sheets={sheets} planImages={images} onDone={onDone} onClose={jest.fn()} />);
  return { onDone, list: () => within(screen.getByRole("complementary", { name: "Rooms" })) };
}

const polygonOf = (name: string) => {
  const label = [...document.querySelectorAll("text.ds2-rm-label")].find((t) => t.textContent === name)!;
  const i = [...document.querySelectorAll("text.ds2-rm-label")].indexOf(label);
  return document.querySelectorAll("polygon.ds2-rm-room")[i];
};

describe("the Rooms page", () => {
  it("comes with the rooms an air conditioner serves ticked, and the rest left out", () => {
    const { list } = open();
    expect(screen.getByRole("dialog", { name: "Rooms Tiff found, Ground floor" })).toBeInTheDocument();
    expect(list().getByRole("checkbox", { name: "Keep Bed 4" })).toHaveAttribute("aria-checked", "true");
    expect(list().getByRole("checkbox", { name: "Keep Living" })).toHaveAttribute("aria-checked", "true");
    expect(list().getByRole("checkbox", { name: "Keep Bathroom" })).toHaveAttribute("aria-checked", "false");
    expect(list().getByRole("checkbox", { name: "Keep Robe" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Done, 2 rooms" })).toBeEnabled();
  });

  it("the picked room shows its area, glass, facing and load beside the plan", () => {
    open();
    // Bed 4: 300 x 250 units at 14 mm a unit is 4.2 m x 3.5 m
    expect(screen.getByText("14.7 m², 4 corners")).toBeInTheDocument();
    expect(screen.getByText("2.9 m², moderate")).toBeInTheDocument();
    expect(screen.getByText("N")).toBeInTheDocument();
    expect(screen.getByText(/kW$/)).toBeInTheDocument();
  });

  it("clicking a room left out on the plan brings it in and picks it, with what the plan says about it", () => {
    open();
    fireEvent.click(polygonOf("Bathroom"));
    expect(screen.getByRole("checkbox", { name: "Keep Bathroom" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText('"WC" is written inside Bathroom: a space of its own?')).toBeInTheDocument();
  });

  it("Join with puts a room and its robe into one, named as the room", async () => {
    const user = userEvent.setup();
    const { onDone } = open();
    await user.click(screen.getByRole("button", { name: "Join with another room" }));
    fireEvent.click(polygonOf("Robe"));
    expect(screen.queryByRole("checkbox", { name: "Keep Robe" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Done, 2 rooms" }));
    const rooms = onDone.mock.calls[0][0] as DesignObject[];
    const bed = rooms.find((r) => r.props.name === "Bed 4")!;
    expect(bed.geometry.kind === "polygon" && bed.geometry.points).toHaveLength(4);
    const ys = bed.geometry.kind === "polygon" ? bed.geometry.points.map((p) => p.y) : [];
    expect(Math.max(...ys)).toBe(320);
  });

  it("renames against the room itself, and Done makes the kept ones the Studio's rooms with their load inputs", async () => {
    const user = userEvent.setup();
    const { onDone } = open();
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Guest bed");
    expect([...document.querySelectorAll("text.ds2-rm-label")].map((t) => t.textContent)).toContain("Guest bed");
    await user.click(screen.getByRole("button", { name: "Done, 2 rooms" }));
    const rooms = onDone.mock.calls[0][0] as DesignObject[];
    expect(rooms.map((r) => r.props.name)).toEqual(["Guest bed", "Living"]);
    expect(rooms[0]).toMatchObject({ type: "room", floorId: "f1" });
    // Level 1 is over it, so no roof
    expect(rooms[0].props).toMatchObject({ glazing: "moderate", orientation: "N", roomAbove: true, fromReading: true });
  });
});
