import { anchorFloating, dodgeSlot } from "../anchor";

/* 800×600 canvas, a 226×148 panel — the calibration card's real shape. */
const box = { w: 800, h: 600 };
const panel = { w: 226, h: 148 };
const at = (x: number, y: number) => anchorFloating({ anchor: { x, y }, panel, box });

describe("anchorFloating", () => {
  it("sits below-right of the anchor when there's room", () => {
    expect(at(100, 100)).toEqual({ left: 114, top: 114 });
  });

  /* the old code shoved the card back to `size.w - 240`, which parked it ON
     the point it was asking about; flipping keeps the anchor visible */
  it("flips to the left of the anchor near the right edge", () => {
    const { left } = at(760, 100);
    expect(left).toBe(760 - 14 - panel.w);
  });

  it("flips above the anchor near the bottom edge", () => {
    const { top } = at(100, 560);
    expect(top).toBe(560 - 14 - panel.h);
  });

  it("flips both ways in the bottom-right corner", () => {
    expect(at(780, 580)).toEqual({
      left: 780 - 14 - panel.w,
      top: 580 - 14 - panel.h,
    });
  });

  /* there was no lower clamp at all before — an anchor near the top-left
     could push the panel off the canvas entirely */
  it("never goes past the top-left margin", () => {
    const { left, top } = at(2, 2);
    expect(left).toBeGreaterThanOrEqual(10);
    expect(top).toBeGreaterThanOrEqual(10);
  });

  it("keeps clear of the reserved chrome at both ends", () => {
    const high = anchorFloating({
      anchor: { x: 400, y: 4 },
      panel,
      box,
      reserveTop: 46,
    });
    expect(high.top).toBeGreaterThanOrEqual(56);

    const low = anchorFloating({
      anchor: { x: 400, y: 596 },
      panel,
      box,
      reserveBottom: 40,
    });
    expect(low.top + panel.h).toBeLessThanOrEqual(box.h - 40);
  });

  /* A note anchors its editor to the LEADER end, which is a short line away
     from the cloud — so every corner around it is within a panel's reach of
     the cloud, and near the paper's edge the flip landed the card square on
     the thing being annotated. The cloud goes in as `avoid`. */
  describe("avoiding the thing it describes", () => {
    /* the real shape: a 264×185 note editor, the leader low and right, the
       cloud up and left of it — bottom-right is the crowded corner */
    const bigBox = { w: 950, h: 645 };
    const editor = { w: 264, h: 185 };
    const cloud = { x0: 316, y0: 257, x1: 505, y1: 390 };
    const place = (avoid?: typeof cloud) =>
      anchorFloating({
        anchor: { x: 734, y: 467 },
        panel: editor,
        box: bigBox,
        reserveTop: 46,
        reserveBottom: 40,
        avoid,
      });

    it("flipped onto the cloud before it was told about it", () => {
      const on = place();
      expect(on.left).toBeLessThan(cloud.x1);
      expect(on.top).toBeLessThan(cloud.y1);
    });

    it("takes the corner that covers none of it", () => {
      const off = place(cloud);
      const covers =
        Math.max(0, Math.min(cloud.x1, off.left + editor.w) - Math.max(cloud.x0, off.left)) *
        Math.max(0, Math.min(cloud.y1, off.top + editor.h) - Math.max(cloud.y0, off.top));
      expect(covers).toBe(0);
    });

    it("stays inside the canvas doing it", () => {
      const off = place(cloud);
      expect(off.left).toBeGreaterThanOrEqual(10);
      expect(off.top).toBeGreaterThanOrEqual(56);
      expect(off.left + editor.w).toBeLessThanOrEqual(bigBox.w - 10);
      expect(off.top + editor.h).toBeLessThanOrEqual(bigBox.h - 50);
    });

    /* nowhere is clear of a cloud that fills the paper — it must still land
       somewhere sane rather than give up and return the preferred corner */
    it("picks the least-covered corner when every corner is covered", () => {
      const off = anchorFloating({
        anchor: { x: 475, y: 322 },
        panel: editor,
        box: bigBox,
        avoid: { x0: 0, y0: 0, x1: 950, y1: 645 },
      });
      expect(off.left).toBeGreaterThanOrEqual(10);
      expect(off.top).toBeGreaterThanOrEqual(10);
    });
  });

  /* a panel with nowhere to fit pins to the top-left rather than being
     centred on nothing — its heading and first control stay reachable */
  it("pins a panel taller than the canvas to the top margin", () => {
    const tall = anchorFloating({ anchor: { x: 400, y: 300 }, panel: { w: 226, h: 900 }, box });
    expect(tall.top).toBe(10);
  });
});

/* the wall-marking / room-sizing panel: 360×176, centred, 22px inset */
describe("dodgeSlot", () => {
  const panel = { w: 360, h: 176 };
  const slot = (rect: { x0: number; y0: number; x1: number; y1: number }) =>
    dodgeSlot({ rect, panel, box });

  it("stays at the bottom when the room is up top", () => {
    expect(slot({ x0: 300, y0: 40, x1: 500, y1: 200 })).toBe("bottom");
  });

  it("moves to the top when the room's bottom edge is under the slot", () => {
    expect(slot({ x0: 300, y0: 300, x1: 500, y1: 580 })).toBe("top");
  });

  /* a room off to one side never sits under a CENTRED panel, so the panel has
     no reason to move */
  it("stays put for a room beside the slot, not under it", () => {
    expect(slot({ x0: 20, y0: 400, x1: 180, y1: 580 })).toBe("bottom");
  });

  /* a room filling the canvas gets covered either way — keep the home slot
     rather than jumping about for no gain */
  it("keeps the bottom when both slots are equally bad", () => {
    expect(slot({ x0: 0, y0: 0, x1: 800, y1: 600 })).toBe("bottom");
  });
});
