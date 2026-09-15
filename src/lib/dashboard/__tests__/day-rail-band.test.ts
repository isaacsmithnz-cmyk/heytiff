import {
  jobsOnRail,
  packColumns,
  placeRail,
  placeRibbon,
  railBounds,
  ribbonLanes,
  ribbonScale,
  ribbonX,
  type RailItem,
} from "../day-rail";
import type { ScheduleBlock } from "@/lib/workboard/schedule";

/* THE BAND — the day laid across the top of Home, on the rail's own laws.

   What is new is only the axis: pixels per hour come from the band's width,
   a pill is never narrower than its words, and the lanes are packed on the
   width that is actually drawn. Everything the rail decided — the bounds,
   the labels, the span on the card, what earns a place — the band reads off
   the same functions, which is why those are not re-tested here. */

const block = (over: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
  key: "b1",
  remoteId: "j1",
  jobNumber: "1042",
  clientName: "Bayview Apartments",
  suburb: null,
  status: "Work Order",
  categoryName: null,
  categoryColour: null,
  tracked: null,
  onSite: false,
  closure: "open",
  startMin: 8 * 60,
  endMin: 10 * 60,
  start: "",
  end: null,
  ...over,
});
const job = (key: string, startMin: number, endMin: number): RailItem => ({
  kind: "job",
  key,
  startMin,
  endMin,
  job: block({ key, startMin, endMin }),
});
const moment = (key: string, atMin: number): RailItem => ({
  kind: "task",
  key,
  startMin: atMin,
  endMin: atMin,
  task: { id: key, title: "Hilux service", atMin, kind: "at", overdue: false },
});

const DAY = { startMin: 7 * 60, endMin: 17 * 60 };

describe("the scale", () => {
  it("divides the width by the hours — the Schedule tab's 110 an hour on a 1100px band", () => {
    expect(ribbonScale(DAY, 1100)).toBe(110);
    expect(ribbonX(8 * 60, DAY, 110)).toBe(110);
    expect(ribbonX(7 * 60 + 30, DAY, 110)).toBe(55);
  });
});

describe("packColumns", () => {
  it("leaves things that follow each other in one column at full width", () => {
    expect(packColumns([{ start: 0, size: 100 }, { start: 100, size: 50 }])).toEqual([
      { col: 0, cols: 1 },
      { col: 0, cols: 1 },
    ]);
  });

  it("splits when two would be drawn on top of each other", () => {
    expect(packColumns([{ start: 0, size: 100 }, { start: 60, size: 50 }])).toEqual([
      { col: 0, cols: 2 },
      { col: 1, cols: 2 },
    ]);
  });

  it("clusters transitively and re-uses a column the moment it is free", () => {
    // A/B overlap, B/C overlap, A/C do not — C takes A's column back
    const out = packColumns([
      { start: 0, size: 100 },
      { start: 80, size: 100 },
      { start: 150, size: 50 },
    ]);
    expect(out.map((o) => o.col)).toEqual([0, 1, 0]);
    expect(out.every((o) => o.cols === 2)).toBe(true);
  });

  it("is what placeRail packs with — the rail's answers are unchanged", () => {
    const placed = placeRail([job("a", 8 * 60, 10 * 60), job("b", 8 * 60 + 10, 9 * 60)], DAY);
    expect(placed.map((p) => [p.col, p.cols])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });
});

describe("placeRibbon", () => {
  const words = () => 100;

  it("puts a booking at its hour, as wide as its hours", () => {
    const [p] = placeRibbon([job("a", 8 * 60, 10 * 60)], DAY, 110, words);
    expect(p.x).toBe(110);
    expect(p.w).toBe(220);
    expect(p.lane).toBe(0);
  });

  it("never draws a pill narrower than its words", () => {
    // a fifteen-minute call is 27px of axis and its words are 100
    const [p] = placeRibbon([job("a", 11 * 60, 11 * 60 + 15)], DAY, 110, words);
    expect(p.w).toBe(100);
  });

  it("packs on the drawn width, so two short calls that overlap on screen take two lanes", () => {
    // 11:00 and 11:20 do not overlap in time; at 100px of words each they do on screen
    const placed = placeRibbon([job("a", 11 * 60, 11 * 60 + 15), job("b", 11 * 60 + 20, 11 * 60 + 35)], DAY, 110, words);
    expect(placed.map((p) => p.lane)).toEqual([0, 1]);
    expect(ribbonLanes(placed)).toBe(2);
  });

  it("gives a task the width of its words and no span", () => {
    const [p] = placeRibbon([moment("t", 7 * 60 + 30)], DAY, 110, () => 180);
    expect(p.x).toBe(55);
    expect(p.w).toBe(180);
  });

  it("brings a pill that would run off the end back onto the band", () => {
    // 4–5pm on a 1100px band starts at 990; 180px of words would end at 1170
    const [p] = placeRibbon([job("a", 16 * 60, 17 * 60)], DAY, 110, () => 180, 1100);
    expect(p.x).toBe(920);
    expect(p.x + p.w).toBe(1100);
  });

  it("leaves a pill where its minutes put it when no width is given", () => {
    const [p] = placeRibbon([job("a", 16 * 60, 17 * 60)], DAY, 110, () => 180);
    expect(p.x).toBe(990);
  });

  it("reads the measured words when it has them, and the guess when it does not", () => {
    const measured = new Map([["a", 260]]);
    const placed = placeRibbon(
      [job("a", 8 * 60, 9 * 60), job("b", 9 * 60, 10 * 60)],
      DAY,
      110,
      (it) => measured.get(it.key) ?? 90,
    );
    expect(placed[0].w).toBe(260);
    expect(placed[1].w).toBe(110);
    // and the measured width is what decides the lanes: 260 from 110 reaches 370, past b's 220
    expect(placed.map((p) => p.lane)).toEqual([0, 1]);
  });

  it("sorts by start so the lanes read left to right", () => {
    const placed = placeRibbon([job("b", 9 * 60, 10 * 60), job("a", 8 * 60, 9 * 60)], DAY, 110, words);
    expect(placed.map((p) => p.item.key)).toEqual(["a", "b"]);
  });

  it("lays out on the rail's bounds — a day widened to now widens the band", () => {
    const bounds = railBounds([job("a", 8 * 60, 10 * 60)], 18 * 60 + 7);
    expect(bounds).toEqual({ startMin: 7 * 60, endMin: 19 * 60 });
    expect(ribbonScale(bounds, 1200)).toBe(100);
  });
});

describe("jobsOnRail — the rows behind the pills, and only those", () => {
  it("keeps the blocks' jobs in the blocks' order, once each, and nobody else's", () => {
    const jobs = [{ remoteId: "j2" }, { remoteId: "j1" }, { remoteId: "j3" }];
    const blocks = [
      block({ key: "a", remoteId: "j1" }),
      block({ key: "b", remoteId: "j2" }),
      block({ key: "c", remoteId: "j1" }),
    ];
    expect(jobsOnRail(blocks, jobs).map((j) => j.remoteId)).toEqual(["j1", "j2"]);
  });

  it("has nothing for a block whose job did not come", () => {
    expect(jobsOnRail([block({ remoteId: "gone" })], [{ remoteId: "j1" }])).toEqual([]);
  });
});
