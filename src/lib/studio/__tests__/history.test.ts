/* Stage-1 lock gate: undo/redo property tests. */

import { History } from "../history";

describe("History", () => {
  it("undo restores the recorded state; redo restores the undone one", () => {
    const h = new History<string>();
    h.record("v1"); // v1 → v2
    h.record("v2"); // v2 → v3
    expect(h.undo("v3")).toBe("v2");
    expect(h.undo("v2")).toBe("v1");
    expect(h.undo("v1")).toBeNull();
    expect(h.redo("v1")).toBe("v2");
    expect(h.redo("v2")).toBe("v3");
    expect(h.redo("v3")).toBeNull();
  });

  it("recording clears the redo branch", () => {
    const h = new History<string>();
    h.record("v1");
    expect(h.undo("v2")).toBe("v1");
    h.record("v1"); // new edit from v1 → v1b
    expect(h.canRedo).toBe(false);
    expect(h.redo("v1b")).toBeNull();
    expect(h.undo("v1b")).toBe("v1");
  });

  it("caps the past at capacity (oldest dropped)", () => {
    const h = new History<number>(3);
    for (let i = 0; i < 10; i++) h.record(i);
    expect(h.undo(10)).toBe(9);
    expect(h.undo(9)).toBe(8);
    expect(h.undo(8)).toBe(7);
    expect(h.undo(7)).toBeNull(); // 0–6 were evicted
  });

  it("property: any undo immediately redone returns to the same state", () => {
    // deterministic pseudo-random walk over record/undo/redo
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

    const h = new History<number>(20);
    let current = 0;
    let next = 1;
    for (let step = 0; step < 500; step++) {
      const r = rnd();
      if (r < 0.5) {
        h.record(current);
        current = next++;
      } else if (r < 0.75) {
        const prev = h.undo(current);
        if (prev !== null) {
          // the invariant: redo must give back exactly what we undid from
          const again = h.redo(prev);
          expect(again).toBe(current);
          // and undoing once more returns to prev — walk back down for variety
          const back = h.undo(again as number);
          expect(back).toBe(prev);
          current = prev;
        }
      } else {
        const nxt = h.redo(current);
        if (nxt !== null) current = nxt;
      }
    }
  });

  it("clear empties both branches", () => {
    const h = new History<number>();
    h.record(1);
    h.undo(2);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
