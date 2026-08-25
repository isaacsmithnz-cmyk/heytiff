/* The tool hint is guidance for a first draw and noise for a twentieth, so it
   has an off switch — on the hint itself, where the annoyance is, with the way
   back on in the canvas's view controls. What is asserted here is the whole
   contract: the hint shows by default, the × takes it away for good (the
   choice outlives the mount), and the setting is the only thing standing
   between the armed tool and its words.

   The corner it docks into is CSS and jsdom cannot see it — see
   studio.css `.ds-tool-hint`. */

import { render, fireEvent, act } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import { setHintsOn } from "../hints";
import { createDesign, type DesignDocument, type Floor } from "@/lib/studio/document";

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [],
};

function mkDoc(): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-28T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = [];
  return d;
}

function renderCanvas() {
  const doc = mkDoc();
  return render(
    <StudioCanvas
      doc={doc}
      floor={doc.floors[0]}
      tool="room-rect"
      selectedId={null}
      onSelect={() => {}}
      onMutate={() => {}}
      onToolDone={() => {}}
      activeSystemId="sys1"
      component={null}
      iduSpec={() => null}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
    />
  );
}

const hint = (c: HTMLElement) => c.querySelector(".ds-tool-hint");

describe("tool hint", () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => setHintsOn(true));
  });

  it("talks the armed tool through by default", () => {
    const { container } = renderCanvas();
    expect(hint(container)?.textContent).toContain("Drag a rectangle over the room");
  });

  it("the × turns hints off, and they stay off across a remount", () => {
    const first = renderCanvas();
    fireEvent.click(first.container.querySelector(".ds-tool-hint-x")!);
    expect(hint(first.container)).toBeNull();
    first.unmount();

    const second = renderCanvas();
    expect(hint(second.container)).toBeNull();
  });

  it("comes back when the setting is turned on again", () => {
    const { container } = renderCanvas();
    act(() => setHintsOn(false));
    expect(hint(container)).toBeNull();
    act(() => setHintsOn(true));
    expect(hint(container)?.textContent).toContain("Esc to cancel");
  });
});
