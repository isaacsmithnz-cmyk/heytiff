import { freeLine, homeDays, teamDayOf, teamLine } from "../team-day";
import { edgeOf, farOnes, fitView, grouped, panned, pixelOf, zoomedToward, type LatLng } from "../day-map";
import type { ScheduleBlock, ScheduleLane } from "@/lib/workboard/schedule";

/* HOME'S SCHEDULE, the pure half: a day's jobs, each once, from the
   Schedule's lanes; and the map's geometry. */

const block = (over: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
  key: "act-1",
  remoteId: "job-3479",
  jobNumber: "3479",
  clientName: "Dan Brad",
  suburb: "Glebe",
  status: "Work Order",
  categoryName: "Install",
  categoryColour: null,
  tracked: null,
  onSite: false,
  closure: "open",
  startMin: 420,
  endMin: 930,
  start: "2026-11-17 07:00:00",
  end: "2026-11-17 15:30:00",
  ...over,
});
const lane = (staffUuid: string, name: string, blocks: ScheduleBlock[]): ScheduleLane => ({ staffUuid, name, blocks, away: [], rows: [blocks], minutes: 0 });

describe("teamDayOf", () => {
  const lanes = [
    lane("s-alex", "Alex Morozoff", [block({ onSite: true })]),
    lane("s-leo", "Leo Watanabe", [block({ key: "act-2" })]),
    lane("s-michael", "Michael Diamond", [
      block({ key: "act-3", remoteId: "job-3432", jobNumber: "3432", clientName: "Sutcliffe, Will", suburb: "Paddington", closure: "done", startMin: 420, endMin: 480 }),
      block({ key: "act-4", remoteId: "job-3538", jobNumber: "3538", clientName: "Halliday, Jo", suburb: "Clovelly", startMin: 780, endMin: 840 }),
    ]),
    lane("s-isaac", "Isaac Smith", [block({ key: "act-5", remoteId: "job-2359", jobNumber: "2359", clientName: "Dryridge Estate", suburb: "Megalong Valley", categoryName: "Service Call", startMin: 720, endMin: 900 })]),
    lane("s-alexl", "Alex Lorenz", [block({ key: "act-6", remoteId: "job-3392", jobNumber: "3392", status: "Unsuccessful", suburb: "Bondi Beach", startMin: 660, endMin: 720 })]),
  ];
  const day = teamDayOf(
    { lanes },
    { dayISO: "2026-11-17", today: true, nowMin: 748, mine: "S-ISAAC", places: { "job-3479": { lat: -33.88, lng: 151.186 } }, free: ["Nathan Bell", "Mia Grant"] },
  );

  it("(F) has each job once, in start order, with everyone booked on it by first name and the viewer as you", () => {
    expect(day.jobs.map((j) => j.number)).toEqual(["3432", "3479", "3392", "2359", "3538"]);
    const glebe = day.jobs.find((j) => j.number === "3479")!;
    expect(glebe.people).toEqual(["Alex", "Leo"]);
    expect(glebe.time).toBe("7:00");
    expect(glebe.at).toEqual({ lat: -33.88, lng: 151.186 });
    expect(glebe.href).toBe("/dashboard/jobs/job-3479");
    const mine = day.jobs.find((j) => j.number === "2359")!;
    expect(mine.people).toEqual(["you"]);
    expect(mine.mine).toBe(true);
    expect(day.jobs.filter((j) => j.mine)).toHaveLength(1);
    expect(day.linked).toBe(true);
  });

  it("(F) says where each is up to: On site with who's there, Done, Didn't go ahead, On now, Booked", () => {
    const of = (n: string) => day.jobs.find((j) => j.number === n)!;
    expect(of("3479").state).toEqual({ tone: "good", word: "On site" });
    expect(of("3479").here).toEqual(["Alex"]);
    expect(of("3432").state).toEqual({ tone: "good", word: "Done" });
    expect(of("3432").done).toBe(true);
    expect(of("3392").state).toEqual({ tone: "wrong", word: "Didn't go ahead" });
    expect(of("3392").done).toBe(false);
    expect(of("2359").state).toEqual({ tone: "info", word: "On now" });
    expect(of("3538").state).toEqual({ tone: "info", word: "Booked" });
  });

  it("(F) says nothing of where a day ahead is up to, and puts nobody on site", () => {
    const ahead = teamDayOf({ lanes }, { dayISO: "2026-11-18", today: false, nowMin: 748, mine: null });
    const glebe = ahead.jobs.find((j) => j.number === "3479")!;
    expect(glebe.state).toBeNull();
    expect(glebe.here).toEqual([]);
    expect(ahead.jobs.find((j) => j.number === "2359")!.people).toEqual(["Isaac"]);
    expect(ahead.linked).toBe(false);
  });

  it("(F) names the free by first name, and says it once", () => {
    expect(day.free).toEqual(["Nathan", "Mia"]);
    expect(freeLine(day.free)).toBe("Nathan and Mia are free all day.");
    expect(freeLine(["Ross"])).toBe("Ross is free all day.");
    expect(freeLine(["you", "Ross"])).toBe("You and Ross are free all day.");
    expect(freeLine(["you"])).toBe("You are free all day.");
    expect(freeLine([])).toBeNull();
  });

  it("writes a job's line: the suburb and who's on it; on You, the kind and the suburb", () => {
    const glebe = day.jobs.find((j) => j.number === "3479")!;
    expect(teamLine(glebe, "team")).toBe("Glebe, with Alex and Leo");
    expect(teamLine(glebe, "you")).toBe("Install, Glebe");
    expect(teamLine({ ...glebe, people: [] }, "team")).toBe("Glebe, nobody booked");
  });
});

describe("where the team is now", () => {
  const lanes = [
    lane("s-alex", "Alex Morozoff", [block({ onSite: true })]),
    lane("s-leo", "Leo Watanabe", [block({ key: "act-2", onSite: true })]),
  ];
  const live = [{ name: "Alex Morozoff", sm8: "S-ALEX", at: { lat: -33.9, lng: 151.2 }, mins: 2 }];

  it("(F) shows someone where their phone says, and not beside the job as well", () => {
    const day = teamDayOf({ lanes }, { dayISO: "2026-11-17", today: true, nowMin: 600, mine: null, live });
    expect(day.live).toEqual([{ name: "Alex", at: { lat: -33.9, lng: 151.2 }, mins: 2 }]);
    expect(day.jobs[0]!.here).toEqual(["Leo"]);
  });

  it("(F) says nothing of where anyone is on a day ahead", () => {
    const day = teamDayOf({ lanes }, { dayISO: "2026-11-18", today: false, nowMin: 600, mine: null, live });
    expect(day.live).toEqual([]);
  });
});

describe("homeDays", () => {
  it("(F) is today, then the next four working days by name and date", () => {
    expect(homeDays("2026-11-19")).toEqual([
      { day: "2026-11-19", label: "Today" },
      { day: "2026-11-20", label: "Fri 20" },
      { day: "2026-11-23", label: "Mon 23" },
      { day: "2026-11-24", label: "Tue 24" },
      { day: "2026-11-25", label: "Wed 25" },
    ]);
  });
});

describe("the map's geometry", () => {
  const glebe: LatLng = { lat: -33.88, lng: 151.186 };
  const coogee: LatLng = { lat: -33.92, lng: 151.255 };
  const cremorne: LatLng = { lat: -33.829, lng: 151.227 };
  const megalong: LatLng = { lat: -33.726, lng: 150.238 };

  it("(F) sets a job far from the rest aside, and none on a day of only far ones", () => {
    expect(farOnes([glebe, coogee, cremorne, megalong])).toEqual([false, false, false, true]);
    expect(farOnes([megalong])).toEqual([false]);
  });

  it("(F) fits the near jobs on the map with room to spare, as close in as that allows", () => {
    const v = fitView([glebe, coogee, cremorne], 640, 368);
    expect(v.zoom).toBe(12);
    for (const p of [glebe, coogee, cremorne]) {
      const at = pixelOf(v, p, 640, 368);
      expect(at.x).toBeGreaterThanOrEqual(32);
      expect(at.x).toBeLessThanOrEqual(608);
      expect(at.y).toBeGreaterThanOrEqual(36 - 0.5);
      expect(at.y).toBeLessThanOrEqual(368 - 8 + 0.5);
    }
    expect(fitView([glebe, coogee, cremorne, megalong], 640, 368).zoom).toBeLessThan(12);
  });

  it("(F) puts a job off the map on the edge facing it", () => {
    const v = fitView([glebe, coogee, cremorne], 640, 368);
    const far = pixelOf(v, megalong, 640, 368);
    expect(far.x).toBeLessThan(0);
    expect(edgeOf(far, 640, 368).edge).toBe("left");
  });

  it("moves the view with a drag: what was under the hand stays under it", () => {
    const v = fitView([glebe, coogee, cremorne], 640, 360);
    const before = pixelOf(v, glebe, 640, 360);
    const after = pixelOf(panned(v, 100, -40), glebe, 640, 360);
    expect(Math.round(after.x - before.x)).toBe(100);
    expect(Math.round(after.y - before.y)).toBe(-40);
  });

  it("(F) closes in on the jobs: after Show all, + keeps the day's jobs on the map, never the empty country in its middle", () => {
    const all = [glebe, coogee, cremorne, megalong];
    let v = fitView(all, 640, 368);
    for (let i = 0; i < 2; i++) v = zoomedToward(v, 1, all, 640, 368);
    for (const p of [glebe, coogee, cremorne]) {
      const at = pixelOf(v, p, 640, 368);
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.x).toBeLessThanOrEqual(640);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeLessThanOrEqual(368);
    }
  });

  it("closes in on all the jobs when none is on the map, and goes out where it is", () => {
    const away = { lat: -34.5, lng: 150.0, zoom: 11 };
    const v = zoomedToward(away, 1, [glebe, coogee, cremorne], 640, 368);
    expect(v.zoom).toBe(12);
    const at = pixelOf(v, coogee, 640, 368);
    expect(at.x).toBeGreaterThan(0);
    expect(at.x).toBeLessThan(640);
    expect(zoomedToward(away, -1, [glebe], 640, 368)).toEqual({ ...away, zoom: 10 });
  });

  it("joins jobs too close to read into one", () => {
    const g = grouped([{ x: 10, y: 10 }, { x: 30, y: 20 }, { x: 200, y: 200 }], (p) => p, 40);
    expect(g.map((x) => x.items.length)).toEqual([2, 1]);
  });
});
