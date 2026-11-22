/** @jest-environment node */
jest.mock("server-only", () => ({}));

import sharp from "sharp";
import { frameOf, MEASURED_SCHEMA, nameRooms, overlaySvg, prepareMeasured, readMeasured, REVIEW_SCHEMA, reviewPrompt, type AskMeasured } from "../measured-server";
import { findWalls } from "../measure/walls";

/* a drawing made here, 900×700 at 20 mm a pixel: two rooms side by side,
   walls a grey fill (outside 15 px, the one between 10 px with a door gap) */
const W = 900;
const H = 700;
function house(): Uint8Array {
  const px = new Uint8Array(W * H * 4).fill(255);
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.fill(128, (y * W + x) * 4, (y * W + x) * 4 + 3);
  };
  box(100, 100, 700, 115);
  box(100, 485, 700, 500);
  box(100, 100, 115, 500);
  box(685, 100, 700, 500);
  box(395, 100, 405, 250);
  box(395, 300, 405, 500);
  return px;
}
const page = () => ({ rgba: house(), width: W, height: H, words: [{ text: "LOUNGE", at: { x: 250, y: 300 } }] });
const room = (name: string, corners: string) => ({ name, name_written_on_plan: true, kind: "room", corners, open_to: "", stair: "" });
const LOUNGE = room("Lounge", "x0,y0 x1,y0 x1,y1 x0,y1");
const BED = room("Bed", "x1,y0 x2,y0 x2,y1 x1,y1");

describe("a floor read by measure", () => {
  it("shows her the plan with the walls' lines numbered, and sets her rooms on the walls", async () => {
    const asked: { pictures: Buffer[]; text: string; schema: unknown }[] = [];
    const ask: AskMeasured = async (pictures, text, schema) => {
      asked.push({ pictures, text, schema });
      return asked.length === 1 ? { rooms: [LOUNGE, BED] } : { right_as_drawn: true, rooms: [] };
    };
    const out = (await readMeasured(page(), 1, { floorName: "Ground floor", mmPerPx: 20, ask }))!;
    expect(out.rounds).toBe(1);
    expect(out.problems).toEqual([]);
    expect(out.walls.grid).toEqual({ x: [107, 399.5, 692], y: [107, 492] });
    /* inside the walls: half of 15 in from the outside, half of 10 from the wall between */
    expect(out.spaces.map((s) => [s.name, s.outline[0], s.outline[2]])).toEqual([
      ["Lounge", { x: 115, y: 115 }, { x: 395, y: 485 }],
      ["Bed", { x: 405, y: 115 }, { x: 685, y: 485 }],
    ]);
    /* asked twice: to name the rooms, then to look at them drawn over the plan */
    expect(asked.map((a) => a.schema)).toEqual([MEASURED_SCHEMA, REVIEW_SCHEMA]);
    expect(asked[0].text).toContain("x0 to x2");
    expect(asked[0].text).toContain("y0 to y1");
    expect(asked[1].text).toContain("with the rooms you named drawn over it");
    const meta = await sharp(asked[0].pictures[0]).metadata();
    const f = frameOf(out.walls, W, H);
    expect([meta.format, meta.width, meta.height]).toEqual(["png", f.ow, f.oh]);
  });

  it("tells her what the checks found, and takes her second answer when it checks no worse", async () => {
    let n = 0;
    let second = "";
    const ask: AskMeasured = async (_p, text) => {
      if (++n === 1) return { rooms: [room("Lounge", "x0,y0 x2,y0 x2,y1 x0,y1"), BED] };
      second = text;
      return { right_as_drawn: false, rooms: [LOUNGE, BED] };
    };
    const out = (await readMeasured(page(), 1, { floorName: "Ground floor", mmPerPx: 20, ask }))!;
    expect(second).toContain("- Lounge and Bed overlap. One of them is between the wrong lines.");
    expect(out.rounds).toBe(2);
    expect(out.problems).toEqual([]);
    expect(out.spaces[0].outline[2]).toEqual({ x: 395, y: 485 });
  });

  it("keeps her first answer when the second is worse, or the second look fails", async () => {
    let n = 0;
    const worse: AskMeasured = async () => (++n === 1 ? { rooms: [LOUNGE, BED] } : { right_as_drawn: false, rooms: [room("Lounge", "x0,y0 x2,y0 x2,y1 x0,y1"), BED] });
    expect((await readMeasured(page(), 1, { floorName: "g", mmPerPx: 20, ask: worse }))!.rounds).toBe(1);
    n = 0;
    const broke: AskMeasured = async () => {
      if (++n === 1) return { rooms: [LOUNGE, BED] };
      throw new Error("busy");
    };
    const out = (await readMeasured(page(), 1, { floorName: "g", mmPerPx: 20, ask: broke }))!;
    expect(out.spaces).toHaveLength(2);
  });

  it("keeps her first answer when a look again leaves out a room no check found fault with, and takes one that renames a room", async () => {
    let n = 0;
    /* the store's corners aren't corners: dropping it and the bed reads as fewer problems */
    const dropped: AskMeasured = async () => (++n === 1 ? { rooms: [LOUNGE, BED, room("Store", "nowhere")] } : { right_as_drawn: false, rooms: [LOUNGE] });
    const kept = (await readMeasured(page(), 1, { floorName: "g", mmPerPx: 20, ask: dropped }))!;
    expect([kept.rounds, kept.spaces.map((s) => s.name)]).toEqual([1, ["Lounge", "Bed"]]);
    n = 0;
    const renamed: AskMeasured = async () => (++n === 1 ? { rooms: [room("Lounge", "x0,y0 x2,y0 x2,y1 x0,y1"), BED] } : { right_as_drawn: false, rooms: [room("Living", "x0,y0 x1,y0 x1,y1 x0,y1"), BED] });
    const fixed = (await readMeasured(page(), 1, { floorName: "g", mmPerPx: 20, ask: renamed }))!;
    expect([fixed.rounds, fixed.spaces.map((s) => s.name)]).toEqual([2, ["Living", "Bed"]]);
  });

  it("doesn't count a problem on Bed 2 against Bed: a look again that drops Bed is not taken", async () => {
    let n = 0;
    const ask: AskMeasured = async () => (++n === 1 ? { rooms: [LOUNGE, BED, room("Bed 2", "nowhere")] } : { right_as_drawn: false, rooms: [LOUNGE] });
    const kept = (await readMeasured(page(), 1, { floorName: "g", mmPerPx: 20, ask }))!;
    expect([kept.rounds, kept.spaces.map((s) => s.name)]).toEqual([1, ["Lounge", "Bed"]]);
  });

  it("looks a third time when the second answer still fails a check, and not when its time is spent", async () => {
    const OVER = room("Lounge", "x0,y0 x2,y0 x2,y1 x0,y1");
    const answers = [{ rooms: [OVER, BED, room("Robe", "x0,y0 x1,y0 x1,y1 x0,y1")] }, { right_as_drawn: false, rooms: [OVER, BED] }, { right_as_drawn: false, rooms: [LOUNGE, BED] }];
    let n = 0;
    const ask: AskMeasured = async () => answers[n++];
    const out = (await readMeasured(page(), 1, { floorName: "g", mmPerPx: 20, ask }))!;
    expect([n, out.rounds, out.problems.length]).toEqual([3, 3, 0]);
    n = 0;
    const hurried = (await readMeasured(page(), 1, { floorName: "g", mmPerPx: 20, ask, budgetMs: -1 }))!;
    expect([n, hurried.rounds, hurried.problems.length]).toEqual([2, 2, 1]);
  });

  it("gives up a naming that runs past its time, and keeps its answer when a look would", async () => {
    /* the clock is the test's own, so a busy machine can't change the answer */
    let clock = 1_000_000;
    const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const m = (await prepareMeasured(page(), 1, 20))!;
      const never: AskMeasured = () => new Promise(() => {});
      await expect(nameRooms(m, { floorName: "g", ask: never, deadline: clock - 1 })).rejects.toThrow("Naming its rooms took too long");
      /* named in 40 s with 15 s then left: no time to look, so the first answer stands, unasked about */
      let n = 0;
      const slow: AskMeasured = async () => {
        n++;
        clock += 40_000;
        return { rooms: [LOUNGE, BED] };
      };
      const out = (await nameRooms(m, { floorName: "g", ask: slow, deadline: clock + 55_000 }))!;
      expect([n, out.rounds, out.spaces.length]).toEqual([1, 1, 2]);
      /* a look still running when the time runs out is left, and the answer before it stands */
      n = 0;
      const hangs: AskMeasured = () => {
        if (n++ > 0) return new Promise(() => {});
        clock += 10;
        return Promise.resolve({ rooms: [LOUNGE, BED] });
      };
      const kept = (await nameRooms(m, { floorName: "g", ask: hangs, deadline: clock + 17 }))!;
      expect([n, kept.rounds, kept.spaces.length]).toEqual([2, 1, 2]);
    } finally {
      now.mockRestore();
    }
  });

  it("holds none of the sheet's pixels once its walls are measured, and says what part of the sheet she was shown", async () => {
    const m = (await prepareMeasured(page(), 1, 20))!;
    expect(Object.values(m).some((v) => v instanceof Uint8ClampedArray || v instanceof Uint8Array && !Buffer.isBuffer(v))).toBe(false);
    expect(m.base.length).toBeLessThan(W * H);
    const out = (await nameRooms(m, { floorName: "g", ask: async () => ({ rooms: [LOUNGE, BED] }) }))!;
    expect(out.frame.left + out.frame.width).toBeGreaterThanOrEqual(735);
    expect(out.frame.left).toBeLessThanOrEqual(64);
  });

  it("comes back in the sheet's own pixels when the floor was drawn finer to measure", async () => {
    const ask: AskMeasured = async (_p, _t, schema) => (schema === MEASURED_SCHEMA ? { rooms: [LOUNGE] } : { right_as_drawn: true, rooms: [] });
    const out = (await readMeasured(page(), 2, { floorName: "g", mmPerPx: 40, ask }))!;
    expect(out.spaces[0].outline[0]).toEqual({ x: 58, y: 58 });
    expect(out.walls.grid.x).toEqual([53.5, 199.8, 346]);
  });

  it("is nothing on a drawing with no walls to measure, and asks nothing", async () => {
    const ask = jest.fn();
    const blank = { rgba: new Uint8Array(W * H * 4).fill(255), width: W, height: H, words: [] };
    expect(await readMeasured(blank, 1, { floorName: "g", mmPerPx: 20, ask })).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("the picture she is shown", () => {
  const walls = findWalls(house(), W, H, 20)!;
  it("frames the building with room round it, never a tight crop", () => {
    const f = frameOf(walls, W, H);
    /* the walls run 100 to 700 across and 100 to 500 down: 36 px (4% of the page's long side) clear all round */
    expect(f.left).toBeLessThanOrEqual(64);
    expect(f.top).toBeLessThanOrEqual(64);
    expect(f.left + f.width).toBeGreaterThanOrEqual(735);
    expect(f.top + f.height).toBeGreaterThanOrEqual(535);
    /* a small building on a big sheet still gets 45% of the page each way */
    const small = frameOf({ ...walls, segs: [{ dir: "h", c: 300, a: 400, b: 440, t: 10 }, { dir: "v", c: 400, a: 300, b: 340, t: 10 }] }, W, H);
    expect(small.width).toBeGreaterThanOrEqual(W * 0.45);
    expect(small.height).toBeGreaterThanOrEqual(H * 0.45);
  });
  it("numbers every line at both ends, and names any room drawn", () => {
    const svg = overlaySvg(frameOf(walls, W, H), walls, [{ name: "Bed <1>", named: true, kind: "room", outline: [{ x: 115, y: 115 }, { x: 395, y: 115 }, { x: 395, y: 485 }], written: "", existing: false, openTo: "", stair: "" }]);
    expect(svg.match(/data-text="x\d"/g)).toHaveLength(6);
    expect(svg.match(/data-text="y\d"/g)).toHaveLength(4);
    /* the room by its number, its name left to the question's words */
    expect(svg).toContain('data-text="1"');
    expect(svg).not.toContain("Bed");
    expect(svg).toContain("<polygon");
  });
  it("draws no type: nothing in it needs a font, so a server with none draws the same", () => {
    const svg = overlaySvg(frameOf(walls, W, H), walls, [{ name: "Bed 1", named: true, kind: "room", outline: [{ x: 115, y: 115 }, { x: 395, y: 115 }, { x: 395, y: 485 }], written: "", existing: false, openTo: "", stair: "" }]);
    expect(svg).not.toMatch(/<text|font-family/);
  });
  it("tells her the rooms' names against their numbers when she looks again", () => {
    expect(reviewPrompt("ground", 100, 100, [], ["Kitchen", "Bed 1"])).toContain("1 Kitchen\n2 Bed 1");
  });
});
