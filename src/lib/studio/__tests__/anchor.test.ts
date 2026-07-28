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
