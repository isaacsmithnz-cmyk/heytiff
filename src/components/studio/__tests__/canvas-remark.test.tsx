/* THE ONE-SHOT REQUESTS FROM THE ROOM MODAL — "re-mark walls" and "edit
   shape". The modal does not reach into the canvas; it sets a prop to a room
   id and the canvas consumes it, then calls back so the parent can clear it.

   Written because the re-mark half had NO test at all — not one case passed
   `remarkRoomId` as anything but null — and it was about to be restructured.
   The handoff is the fiddly kind of state to move: it has to fire once per
   REQUEST, and the request is "this id, now", which may well be the same id
   as last time. An implementation that remembers "the last id I acted on"
   passes every obvious test and then silently ignores the second press of the
   same button, which is the case the last test here pins.

   Where the numbers come from: the blank floor (10 mm/unit → grid 100) opens
   at zoom 0.56 with the world origin at screen centre — see canvas.test.tsx. */

import { render } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type Floor,
} from "@/lib/studio/document";

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [],
};

const room = (externalWalls?: number[]): DesignObject => ({
  id: "rm1",
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: {
    kind: "polygon",
    points: [
      { x: -60, y: -60 },
      { x: 120, y: -60 },
      { x: 120, y: 120 },
      { x: -60, y: 120 },
    ],
  },
  plane: "room",
  props: {
    name: "Lounge",
    shape: "rect",
    configured: true,
    ...(externalWalls ? { externalWalls } : {}),
  },
});

function mkDoc(externalWalls?: number[]): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-25T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = [room(externalWalls)];
  return d;
}

function renderCanvas(opts: {
  doc: DesignDocument;
  remarkRoomId?: string | null;
  onRemarkConsumed?: () => void;
  onSelect?: (id: string | null) => void;
}) {
  const utils = render(
    <StudioCanvas
      doc={opts.doc}
      floor={floor}
      tool="select"
      selectedId={null}
      onSelect={opts.onSelect ?? (() => {})}
      onMutate={() => {}}
      onToolDone={() => {}}
      activeSystemId="sys1"
      iduSpec={() => null}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      remarkRoomId={opts.remarkRoomId ?? null}
      onRemarkConsumed={opts.onRemarkConsumed ?? (() => {})}
      reshapeRoomId={null}
      onReshapeConsumed={() => {}}
    />
  );
  return { ...utils, svg: utils.container.querySelector("svg")! };
}

const wallPanel = (c: HTMLElement) => c.querySelector("[aria-label='Mark external walls']");
const litEdges = (svg: Element) => svg.querySelectorAll(".ds-wallsel-edge.on").length;

describe("the modal's re-mark request", () => {
  it("does nothing at all until a room is actually asked for", () => {
    const { container, svg } = renderCanvas({ doc: mkDoc() });
    expect(svg.querySelector(".ds-wallsel")).toBeNull();
    expect(wallPanel(container)).toBeNull();
  });

  it("opens wall-marking on the asked-for room and tells the parent it is consumed", () => {
    const onRemarkConsumed = jest.fn();
    const { container, svg } = renderCanvas({
      doc: mkDoc(),
      remarkRoomId: "rm1",
      onRemarkConsumed,
    });

    expect(svg.querySelector(".ds-wallsel")).not.toBeNull();
    expect(wallPanel(container)).not.toBeNull();
    expect(onRemarkConsumed).toHaveBeenCalled();
  });

  /* The walls already marked have to come BACK lit, or re-marking silently
     starts from nothing and the room loses the walls it had. */
  it("seeds the selection from the walls the room already carries", () => {
    const { svg } = renderCanvas({ doc: mkDoc([0, 2]), remarkRoomId: "rm1" });
    expect(litEdges(svg)).toBe(2);
  });

  it("starts empty when the room has never been marked", () => {
    const { svg } = renderCanvas({ doc: mkDoc(), remarkRoomId: "rm1" });
    expect(svg.querySelector(".ds-wallsel")).not.toBeNull();
    expect(litEdges(svg)).toBe(0);
  });

  it("ignores a request for a room that isn't there", () => {
    const onRemarkConsumed = jest.fn();
    const { svg } = renderCanvas({ doc: mkDoc(), remarkRoomId: "ghost", onRemarkConsumed });
    expect(svg.querySelector(".ds-wallsel")).toBeNull();
    // still consumed — otherwise the parent's id would stick forever
    expect(onRemarkConsumed).toHaveBeenCalled();
  });

  /* THE CASE THAT BREAKS THE OBVIOUS IMPLEMENTATION. The parent clears the id
     as soon as it is consumed, so a second press of "Mark external walls" on
     the SAME room arrives as null → "rm1" again. Anything that keys off "have
     I seen this id before" swallows it, and the button silently stops working
     the second time. */
  it("fires again when the same room is asked for a second time", () => {
    const doc = mkDoc([0, 2]);
    const onRemarkConsumed = jest.fn();
    const { container, svg, rerender } = renderCanvas({
      doc,
      remarkRoomId: "rm1",
      onRemarkConsumed,
    });
    expect(wallPanel(container)).not.toBeNull();

    const paint = (remarkRoomId: string | null) =>
      rerender(
        <StudioCanvas
          doc={doc}
          floor={floor}
          tool="select"
          selectedId={null}
          onSelect={() => {}}
          onMutate={() => {}}
          onToolDone={() => {}}
          activeSystemId="sys1"
          iduSpec={() => null}
          onPlaced={() => {}}
          onRoomCreated={() => {}}
          remarkRoomId={remarkRoomId}
          onRemarkConsumed={onRemarkConsumed}
          reshapeRoomId={null}
          onReshapeConsumed={() => {}}
        />
      );

    // the parent clears it, the user closes wall-marking, then presses again
    paint(null);
    onRemarkConsumed.mockClear();
    paint("rm1");

    expect(onRemarkConsumed).toHaveBeenCalled();
    expect(svg.querySelector(".ds-wallsel")).not.toBeNull();
    expect(litEdges(svg)).toBe(2);
  });
});
