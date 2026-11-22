/* SCALE AND NORTH, ONCE FOR THE SET (setup-panel.tsx): where a floor prints
   no scale and takes the one another floor of its set prints, the panel
   names the sheet that prints it, not the floor's own. */

import { render, screen } from "@testing-library/react";
import { SetupPanel } from "../setup-panel";
import { createDesign, type DesignDocument, type Floor } from "@/lib/studio/document";

const at = { x: 0, y: 0 };
const words = (...t: string[]) => t.map((text) => ({ text, at }));

function set(l1Scale: number | null): DesignDocument {
  const d = createDesign({ name: "Plan job", mode: "plan" });
  const floor = (id: string, name: string, level: number, page: number, scaleMmPerUnit: number | null): Floor => ({
    id,
    name,
    level,
    scaleMmPerUnit,
    northDeg: null,
    northPos: null,
    plans: [{ id: `sht_${id}`, imageRef: `org/o/${id}.png`, pageNumber: page, name: `Page ${page}`, width: 2400, height: 1695, x: 0, y: 0 }],
  });
  return {
    ...d,
    floors: [floor("gf", "Ground floor", 0, 2, null), floor("l1", "Level 1", 1, 3, l1Scale)],
    planImport: {
      sources: [{ ref: "org/o/set.pdf", kind: "pdf" }],
      placed: { 1: "org/o/gf.png", 2: "org/o/l1.png" },
      chosen: [1, 2],
      names: {},
      /* the ground floor's sheet prints 1:50 @ A1; level 1's prints none */
      words: { 1: words("GROUND FLOOR", "CD103", "SCALE:", "1:50 @ A1"), 2: words("FIRST FLOOR", "CD104") },
      /* level 1 measured 2% off it: the ground floor's 1:50 is offered */
      measured: { 2: { mmPerPx: 17.87, from: "the 5000 mm printed on it", sure: true } },
    },
  };
}

const panel = (doc: DesignDocument) => render(<SetupPanel doc={doc} floorId="l1" onMutate={() => {}} onMeasure={() => {}} onTurnNorth={() => {}} onDone={() => {}} />);

describe("the scale a floor takes from its set", () => {
  it("names the sheet that prints it, offered and once taken", () => {
    panel(set(null));
    expect(screen.getByText("CD103's title block, 17.52 mm a pixel")).toBeTruthy();
    expect(screen.queryByText(/CD104/)).toBeNull();
  });

  it("names it once the floor stands on it", () => {
    panel(set((841 / 2400) * 50));
    expect(screen.getByText("1:50 @ A1, CD103's title block")).toBeTruthy();
    expect(screen.queryByText(/CD104/)).toBeNull();
  });

  it("names the floor where its sheet has no title found", () => {
    const d = set(null);
    panel({ ...d, planImport: { ...d.planImport!, words: { ...d.planImport!.words, 1: words("SCALE:", "1:50 @ A1") } } });
    expect(screen.getByText("Ground floor's title block, 17.52 mm a pixel")).toBeTruthy();
  });
});
