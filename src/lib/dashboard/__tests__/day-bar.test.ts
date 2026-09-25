import {
  DAY_END_BASIS,
  DAY_END_EXTRA,
  DAY_GAP,
  DAY_GROUP_W,
  DAY_H,
  DAY_SLIVER_W,
  dayCardLabel,
  dayCardPaint,
  dayCardTip,
  dayGroupLabel,
  dayItems,
  dayLiveKey,
  dayPanelFacts,
  dayProgress,
  dayState,
  dayStateWord,
  dayTimeLabel,
  fitDay,
  guessMeasure,
  shortPlace,
  type DayFit,
  type DayFitInput,
  type DayMeasure,
  type DayRailInput,
} from "../day-bar";
import {
  contrastRatio,
  NO_CATEGORY_PAINT,
  rgbOf,
  scheduleBlockPaint,
  TRACKED_PAINT,
  whiteLabelFill,
} from "@/lib/workboard/schedule-colour";
import type { ScheduleBlock } from "@/lib/workboard/schedule";
import type { RailTask } from "../day-rail";

/* YOUR DAY, as arithmetic. The bar's widths were worked out in the browser by
   the prototype as it drew; the port has to agree with it on the day Isaac
   walked, and hold the rules that only show on a busier one: what folds,
   what shrinks, in which order, and whether white reads on every colour. */

const hm = (h: number, m = 0) => h * 60 + m;

const block = (over: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
  key: "a1",
  remoteId: "j1",
  jobNumber: "3342",
  clientName: "Bayview Apartments",
  suburb: "Sydney",
  status: "Work Order",
  categoryName: "Maintenance",
  categoryColour: "#b7e6c8",
  tracked: null,
  onSite: false,
  closure: "open",
  startMin: hm(8),
  endMin: hm(9),
  start: "2026-09-24 08:00:00",
  end: "2026-09-24 09:00:00",
  ...over,
});

const task = (over: Partial<RailTask> = {}): RailTask => ({
  id: "t1",
  title: "Hilux in for its service",
  atMin: hm(7),
  kind: "at",
  overdue: false,
  ...over,
});

const rail = (blocks: ScheduleBlock[], tasks: RailTask[] = [], over: Partial<DayRailInput> = {}): DayRailInput => ({
  blocks,
  tasks,
  jobs: [],
  where: {},
  crew: {},
  ...over,
});

/* HIS REAL THURSDAY (2026-09-24), the prototype's own six bookings: 3342
   twice, and 3342 / 3315 / 1377 overlapping in the evening. */
const THURSDAY = [
  { key: "a", no: "3342", place: "Sydney", from: hm(6, 30), to: hm(9) },
  { key: "b", no: "2313", place: "Darlinghurst", from: hm(9, 15), to: hm(10, 15) },
  { key: "c", no: "2587", place: "Lilli Pilli", from: hm(11, 30), to: hm(12, 30) },
  { key: "d", no: "3342", place: "Sydney", from: hm(16, 45), to: hm(17, 45) },
  { key: "e", no: "3315", place: "Willoughby East", from: hm(17), to: hm(18) },
  { key: "f", no: "1377", place: "Cremorne", from: hm(17, 45), to: hm(18, 45) },
];
const thursday = () =>
  dayItems(
    rail(
      THURSDAY.map((t) =>
        block({ key: t.key, remoteId: `j${t.no}`, jobNumber: t.no, suburb: t.place, startMin: t.from, endMin: t.to })
      )
    )
  );
const FIVE_TO_FIVE = hm(16, 55);

/* The widths of his Thursday's words in Plus Jakarta Sans, measured with
   canvas `measureText` in headless Chrome on 2026-09-25 — the fonts the bar
   draws in (DAY_FONTS). Anything not listed falls to the server's guess. */
const JAKARTA: Record<string, Record<string, number>> = {
  "700/16": { "Job 3342": 69.88, "Job 2313": 65.85, "Job 2587": 68.73, "Job 3315": 66.13, "Job 1377": 64.4 },
  "700/14": { "Job 3342": 61.14, "Job 2313": 57.62, "Job 2587": 60.14, "Job 3315": 57.87, "Job 1377": 56.35 },
  "600/12": {
    Sydney: 43.72,
    Darlinghurst: 70.27,
    "Lilli Pilli": 39.79,
    "Willoughby East": 92.64,
    "Willoughby E": 74.71,
    Cremorne: 58.61,
  },
  "600/13": {
    "6:30–9:00": 68.63,
    "9:15–10:15": 65.55,
    "11:30–12:30": 74.71,
    "4:45–5:45": 66.34,
    "5:00–6:00": 70.19,
    "5:45–6:45": 65.75,
    "6:30": 29.56,
    "9:15": 25.41,
    "11:30": 31.95,
    "4:45": 29.3,
    "5:00": 31.12,
    "5:45": 28.9,
  },
};
const jakarta: DayMeasure = (text, font) =>
  text === "" ? 0 : (JAKARTA[`${font.weight}/${font.px}`]?.[text] ?? guessMeasure(text, font));

const fit = (over: Partial<DayFitInput> & Pick<DayFitInput, "items">): DayFit =>
  fitDay({
    nowMin: FIVE_TO_FIVE,
    barWidth: 850,
    selectedKey: null,
    hoverKey: null,
    showFinished: false,
    measure: jakarta,
    ...over,
  });

const widths = (f: DayFit) => f.slots.map((s) => s.minWidth);

describe("dayItems — the day, in order", () => {
  it("puts bookings and timed tasks in start order, and gives a task no span", () => {
    const items = dayItems(
      rail([block({ key: "b9", startMin: hm(9), endMin: hm(10) }), block({ key: "b8" })], [task({ atMin: hm(7, 30) })])
    );
    expect(items.map((i) => i.key)).toEqual(["task:t1", "job:b8", "job:b9"]);
    expect(items[0]).toMatchObject({ kind: "task", startMin: hm(7, 30), endMin: hm(7, 30), taskId: "t1", paint: null });
  });

  it("names a job by its number, else its client, else 'Unnamed client'", () => {
    const names = dayItems(
      rail([
        block({ key: "1", jobNumber: "3342" }),
        block({ key: "2", jobNumber: "  ", clientName: "Bayview Apartments" }),
        block({ key: "3", jobNumber: null, clientName: null }),
      ])
    ).map((i) => [i.name, i.jobNumber]);
    expect(names).toEqual([
      ["Job 3342", "3342"],
      ["Bayview Apartments", null],
      ["Unnamed client", null],
    ]);
  });

  it("carries the panel's facts — the description, the street and the crew — for its own job only", () => {
    const [item] = dayItems(
      rail([block({ remoteId: "j1" })], [], {
        jobs: [{ remoteId: "j1", description: "Service AC units" }],
        where: { j1: "Carrington St" },
        crew: { j1: ["Luke"] },
      })
    );
    expect(item).toMatchObject({ summary: "Service AC units", where: "Carrington St", crew: ["Luke"], place: "Sydney" });
    const [alone] = dayItems(rail([block({ remoteId: "j2" })], [], { where: { j1: "Carrington St" } }));
    expect(alone).toMatchObject({ summary: null, where: null, crew: [] });
  });

  it("fills a job with its Workboard colour made safe for white, and a promoted job with the tracked blue", () => {
    const [cat] = dayItems(rail([block({ categoryColour: "#F2EFB8" })]));
    expect(cat.paint).toBe(whiteLabelFill(scheduleBlockPaint("#F2EFB8").bar));
    const [none] = dayItems(rail([block({ categoryColour: null })]));
    expect(none.paint).toBe("rgb(112, 119, 130)");
    const [tracked] = dayItems(rail([block({ tracked: { kind: "project", label: "Harbour View" } })]));
    expect(tracked.paint).toBe(TRACKED_PAINT.bar);
  });

  it("marks a `by` task as a deadline", () => {
    const [by] = dayItems(rail([], [task({ kind: "by" })]));
    expect(by.by).toBe(true);
    expect(dayTimeLabel(by, false)).toBe("By 7:00");
  });
});

describe("dayProgress, dayState and the words for them", () => {
  const [item] = dayItems(rail([block({ startMin: hm(16, 45), endMin: hm(17, 45) })]));

  it("is 0 before, a fraction during and 1 after", () => {
    expect(dayProgress(item, hm(16))).toBe(0);
    expect(dayProgress(item, hm(16, 45))).toBe(0);
    expect(dayProgress(item, hm(17, 15))).toBeCloseTo(0.5, 10);
    expect(dayProgress(item, hm(17, 45))).toBe(1);
    expect(dayProgress(item, hm(20))).toBe(1);
    expect(dayProgress(item, null)).toBe(0);
  });

  it("is finished whatever the clock once the board reads the booking as done", () => {
    const [done] = dayItems(rail([block({ closure: "done", startMin: hm(16, 45), endMin: hm(17, 45) })]));
    expect(dayProgress(done, hm(9))).toBe(1);
    expect(dayProgress(done, null)).toBe(1);
    expect(dayStateWord(done, hm(9))).toBe("Finished");
    // a stale booking is still somebody's run: the clock decides
    const [stale] = dayItems(rail([block({ closure: "stale", startMin: hm(16, 45), endMin: hm(17, 45) })]));
    expect(dayProgress(stale, hm(9))).toBe(0);
  });

  it("says To come, On now with a percentage, and Finished", () => {
    expect(dayStateWord(item, hm(16))).toBe("To come");
    expect(dayStateWord(item, FIVE_TO_FIVE)).toBe("On now, 17%");
    expect(dayStateWord(item, hm(18))).toBe("Finished");
    expect(dayState(item, hm(16, 45))).toBe("live");
  });

  it("never ticks an open task past its time — it is late, not done", () => {
    const [t] = dayItems(rail([], [task({ atMin: hm(7) })]));
    expect(dayProgress(t, hm(9))).toBe(0);
    expect(dayState(t, hm(9))).toBe("late");
    expect(dayStateWord(t, hm(9))).toBe("Late");
    expect(dayStateWord(t, hm(6))).toBe("To come");
    expect(dayStateWord(t, hm(7))).toBe("To come");
  });
});

describe("dayLiveKey — the one job on now", () => {
  it("is the booking the clock is inside", () => {
    expect(dayLiveKey(thursday(), FIVE_TO_FIVE)).toBe("job:d");
  });

  it("takes the later start when two bookings are on at once", () => {
    // 5:10 — 3342 runs until 5:45 and 3315 began at 5:00
    expect(dayLiveKey(thursday(), hm(17, 10))).toBe("job:e");
  });

  it("takes the one you have clocked on to over the later start", () => {
    const items = dayItems(
      rail([
        block({ key: "d", onSite: true, startMin: hm(16, 45), endMin: hm(17, 45) }),
        block({ key: "e", startMin: hm(17), endMin: hm(18) }),
      ])
    );
    expect(dayLiveKey(items, hm(17, 10))).toBe("job:d");
  });

  it("is nobody between jobs, before the clock is known, or on a job already closed", () => {
    expect(dayLiveKey(thursday(), hm(14))).toBeNull();
    expect(dayLiveKey(thursday(), null)).toBeNull();
    const [closed] = dayItems(rail([block({ closure: "done" })]));
    expect(dayLiveKey([closed], hm(8, 30))).toBeNull();
  });

  it("is never a task, which is a moment", () => {
    expect(dayLiveKey(dayItems(rail([], [task({ atMin: hm(7) })])), hm(7))).toBeNull();
  });

  it("opens the panel on the live job from the loader's own clock, or on nothing", () => {
    // the initial selection is the live key at rail.nowMin — no browser clock in render
    expect(dayLiveKey(thursday(), FIVE_TO_FIVE)).toBe("job:d");
    expect(dayLiveKey(thursday(), hm(6))).toBeNull();
  });
});

describe("the words on a card", () => {
  const job = (from: number, to: number) => dayItems(rail([block({ startMin: from, endMin: to })]))[0];

  it("writes a span, or its start alone when the bar is compact", () => {
    expect(dayTimeLabel(job(hm(16, 45), hm(17, 45)), false)).toBe("4:45–5:45");
    expect(dayTimeLabel(job(hm(16, 45), hm(17, 45)), true)).toBe("4:45");
    expect(dayTimeLabel(job(hm(11, 30), hm(12, 30)), false)).toBe("11:30–12:30");
  });

  it("writes a task's moment, and a deadline as By", () => {
    const [at, by] = dayItems(rail([], [task({ id: "a" }), task({ id: "b", kind: "by", atMin: hm(19) })]));
    expect(dayTimeLabel(at, false)).toBe("7:00");
    expect(dayTimeLabel(by, true)).toBe("By 7:00");
  });

  it("says 12:00 for a booking clamped at midnight, never 0:00 or 24:00", () => {
    expect(dayTimeLabel(job(hm(23), 24 * 60), false)).toBe("11:00–12:00");
    expect(dayTimeLabel(job(0, 30), false)).toBe("12:00–12:30");
  });

  it("shortens a place the way a street directory does, then cuts it", () => {
    const w = (s: string) => s.length * 6;
    expect(shortPlace("Willoughby East", 100, w)).toBe("Willoughby East");
    expect(shortPlace("Willoughby East", 80, w)).toBe("Willoughby E");
    expect(shortPlace("Willoughby East", 50, w)).toBe("Willoug…");
    expect(shortPlace("MOUNT COLAH", 60, w)).toBe("Mt COLAH");
    expect(shortPlace("North Sydney Heights", 90, w)).toBe("Nth Sydney Hts");
    // never below three letters, however small the cap
    expect(shortPlace("Willoughby East", 1, w)).toBe("Wil…");
  });

  it("names a folded run for a screen reader", () => {
    expect(dayGroupLabel(3)).toBe("Show 3 finished jobs");
  });
});

describe("the panel's words", () => {
  const one = (b: Partial<ScheduleBlock> = {}, over: Partial<DayRailInput> = {}) => dayItems(rail([block(b)], [], over))[0]!;

  it("titles a booking by its place, its number beside it, and says the span with the meridiem once", () => {
    const it = one(
      { startMin: hm(16, 45), endMin: hm(17, 45) },
      { jobs: [{ remoteId: "j1", description: "Service AC units " }], where: { j1: "Carrington St, Sydney" } }
    );
    expect(dayPanelFacts(it)).toEqual({
      title: "Sydney",
      number: "Job 3342",
      summary: "Service AC units",
      time: "4:45–5:45pm",
      where: "Carrington St, Sydney",
      with: null,
    });
  });

  it("says who else is on the job, and leaves With out when you are alone", () => {
    const crew = (names: string[]) => dayPanelFacts(one({}, { crew: { j1: names } })).with;
    expect(crew([])).toBeNull();
    expect(crew(["Luke"])).toBe("Luke");
    expect(crew(["Luke", "Callum"])).toBe("Luke and Callum");
    expect(crew(["Luke", "Callum", "Leo"])).toBe("Luke, Callum and Leo");
  });

  it("falls back to the suburb for Where, and to the name for a title when there is no suburb", () => {
    expect(dayPanelFacts(one()).where).toBe("Sydney");
    const bare = dayPanelFacts(one({ suburb: null, jobNumber: null, clientName: "Bayview Apartments" }));
    expect(bare).toMatchObject({ title: "Bayview Apartments", number: null, where: null, summary: null });
  });

  it("gives a task its moment, and a deadline its 'by'", () => {
    const at = dayItems(rail([], [task({ atMin: hm(7) })]))[0]!;
    const by = dayItems(rail([], [task({ atMin: hm(17, 30), kind: "by" })]))[0]!;
    expect(dayPanelFacts(at)).toEqual({
      title: "Hilux in for its service",
      number: "Task",
      summary: null,
      time: "7am",
      where: null,
      with: null,
    });
    expect(dayPanelFacts(by).time).toBe("by 5:30pm");
  });

  it("names a card aloud with everything it shows, whole, and its state", () => {
    const items = thursday();
    const f = fit({ items, barWidth: 1144, selectedKey: "job:d" });
    const live = f.slots.find((s) => s.key === "job:d")!;
    expect(dayCardLabel(live, FIVE_TO_FIVE)).toBe("Sydney, Job 3342, 4:45–5:45pm, On now, 17%");
    const e = f.slots.find((s) => s.key === "job:e")!;
    expect(dayCardLabel(e, FIVE_TO_FIVE)).toBe("Willoughby East, Job 3315, 5–6pm, To come");
    const folded = fit({ items, selectedKey: "job:d" }).slots[0]!;
    expect(dayCardLabel(folded, FIVE_TO_FIVE)).toBe("Show 3 finished jobs");
    const late = fit({ items: dayItems(rail([], [task({ atMin: hm(16), kind: "by" })])) }).slots[0]!;
    expect(dayCardLabel(late, FIVE_TO_FIVE)).toBe("Task, Hilux in for its service, by 4pm, Late");
  });

  it("gives a tooltip only where the card could not say it all", () => {
    const whole = fit({ items: thursday(), barWidth: 1144 });
    expect(whole.slots.map(dayCardTip)).toEqual([null, null, null, null, null, null]);
    // a folded run says how many; a sliver says what it is
    const folded = fit({ items: thursday(), selectedKey: "job:d" });
    expect(dayCardTip(folded.slots[0]!)).toBe("3 finished");
    const sliver = fit({ items: thursday(), barWidth: 670, showFinished: true });
    const first = sliver.slots[0]!;
    expect(first.collapsed).toBe(true);
    expect(dayCardTip(first)).toBe("Sydney, Job 3342, 6:30–9:00");
    // a shortened place gives the whole one back
    const narrow = dayItems(rail([block({ suburb: "Willoughby East North Heights" })]));
    const short = fit({ items: narrow, barWidth: 1144, nowMin: hm(6) }).slots[0]!;
    expect(short.tag).not.toBe("Willoughby East North Heights");
    expect(dayCardTip(short)).toBe("Willoughby East North Heights, Job 3342, 8:00–9:00");
  });

  /* Short names fit their cap whole, but the last step can still take a
     card below the room its words were laid out in, and the sheet cuts
     them with an ellipsis: "Bayview A…" needs its tooltip as much as a
     shortened place does. */
  it("gives a tooltip on every card the last step shrank, though its words were whole", () => {
    const named = (n: number) =>
      dayItems(
        rail(
          Array.from({ length: n }, (_, i) =>
            block({
              key: `s${i}`,
              remoteId: `s${i}`,
              jobNumber: null,
              clientName: "Bayview Apts",
              suburb: "Ryde",
              startMin: hm(7 + i),
              endMin: hm(7 + i, 45),
            })
          )
        )
      );
    for (const [n, barWidth] of [
      [8, 1152],
      [10, 900],
    ] as const) {
      const f = fit({ items: named(n), barWidth, nowMin: hm(6), measure: guessMeasure });
      expect(f.scale).toBeLessThan(1);
      expect(f.slots.map((s) => [s.tag, s.name])).toEqual(Array.from({ length: n }, () => ["Ryde", "Bayview Apts"]));
      expect(f.slots.every((s) => s.shrunk)).toBe(true);
      expect(f.slots.map(dayCardTip)).toEqual(
        Array.from({ length: n }, (_, i) => `Ryde, Bayview Apts, ${dayTimeLabel(f.slots[i]!.items[0]!, false)}`)
      );
    }
    // the open card keeps the room it was laid out in, so its words are whole
    const open = fit({ items: named(8), barWidth: 1152, nowMin: hm(6), measure: guessMeasure, selectedKey: "job:s3" });
    const s3 = open.slots.find((s) => s.key === "job:s3")!;
    expect(open.scale).toBeLessThan(1);
    expect(s3.shrunk).toBe(false);
    expect(dayCardTip(s3)).toBeNull();
    // a bar that fits shrinks nothing
    expect(fit({ items: thursday(), barWidth: 1144 }).slots.some((s) => s.shrunk)).toBe(false);
  });
});

describe("the server's measure", () => {
  it("over-estimates every word of his Thursday in the real font, so a first paint can only fold early", () => {
    for (const [face, words] of Object.entries(JAKARTA)) {
      const [weight, px] = face.split("/").map(Number);
      for (const [text, real] of Object.entries(words)) {
        expect(guessMeasure(text, { weight, px })).toBeGreaterThanOrEqual(real);
      }
    }
  });
});

describe("fitDay on his Thursday", () => {
  it("at 4:55pm on an 850px bar: folds the morning into one block, keeps every label whole", () => {
    /* The three finished morning jobs fold, as the prototype draws them at his
       width (specshots/home.png); nothing else has to give. */
    const f = fit({ items: thursday(), selectedKey: dayLiveKey(thursday(), FIVE_TO_FIVE) });
    expect(f).toMatchObject({ crowded: true, merged: true, compact: false, scale: 1 });
    expect(f.slots.map((s) => s.kind)).toEqual(["group", "job", "job", "job"]);
    expect(f.slots[0]).toMatchObject({ name: "3 finished", collapsed: true, grow: 0, shrink: 0 });
    expect(f.slots[0].items.map((i) => i.key)).toEqual(["job:a", "job:b", "job:c"]);
    expect(widths(f)).toEqual([144, 180, 159, 205]);
    expect(f.slots.map((s) => [s.tag, s.name, s.time])).toEqual([
      ["", "3 finished", ""],
      ["Sydney", "Job 3342", "4:45–5:45"],
      ["Willoughby East", "Job 3315", "5:00–6:00"],
      ["Cremorne", "Job 1377", "5:45–6:45"],
    ]);
  });

  it("runs the Trace round the live card and nothing else", () => {
    const f = fit({ items: thursday() });
    expect(f.slots.filter((s) => s.live).map((s) => s.key)).toEqual(["job:d"]);
  });

  it("draws the whole day, unfolded, on a bar with room for it", () => {
    const f = fit({ items: thursday(), barWidth: 1144, selectedKey: "job:d" });
    expect(f).toMatchObject({ crowded: false, merged: false, compact: false, scale: 1 });
    expect(widths(f)).toEqual([200, 137, 125, 180, 159, 205]);
    expect(f.slots.every((s) => !s.collapsed)).toBe(true);
  });

  /* THE PORT AGAINST THE PROTOTYPE. These are `build2.mjs`'s own numbers —
     its ydRender run in headless Chrome at each width, flex and min-width
     read back off the cards — at its own 6px gap. The app snaps the gap to
     4; everything else is the same arithmetic. */
  describe("matches the prototype's own numbers at its 6px gap", () => {
    const proto = (over: Partial<DayFitInput>) => fit({ items: thursday(), gap: 6, ...over });

    it("850px, the live job selected", () => {
      const f = proto({ selectedKey: "job:d" });
      expect(widths(f)).toEqual([144, 180, 159, 205]);
      expect(f.slots.map((s) => [s.grow, s.shrink, s.basis])).toEqual([
        [0, 0, 144],
        [expect.closeTo(3.24, 10), 1, 0],
        [1.35, 1, 0],
        [1.35, 1, 44],
      ]);
    });

    it("850px, nothing selected", () => {
      expect(widths(proto({}))).toEqual([144, 120, 159, 205]);
    });

    it("850px, the finished jobs shown", () => {
      const f = proto({ selectedKey: "job:d", showFinished: true });
      expect(f.merged).toBe(false);
      expect(widths(f)).toEqual([128, 48, 48, 180, 159, 205]);
      expect(f.slots.slice(0, 3).every((s) => s.collapsed && s.kind === "job")).toBe(true);
    });

    it("850px, a finished job hovered — it stays whole and splits the run", () => {
      const f = proto({ selectedKey: "job:d", hoverKey: "job:b" });
      expect(f.slots.map((s) => s.key)).toEqual(["job:a", "job:b", "job:c", "job:d", "job:e", "job:f"]);
      expect(widths(f)).toEqual([128, 137, 48, 180, 159, 205]);
      expect(f.slots[1]).toMatchObject({ hovered: true, collapsed: false, grow: 1.35 });
    });

    it("670px, the finished jobs shown — compact, then shrunk", () => {
      const f = proto({ selectedKey: "job:d", showFinished: true, barWidth: 670 });
      expect(f.compact).toBe(true);
      expect(widths(f)).toEqual([128, 48, 48, 172, 145, 186]);
      expect(f.slots.map((s) => s.time)).toEqual(["6:30", "9:15", "11:30", "4:45", "5:00", "5:45"]);
    });

    it("500px, folded — compact and shrunk, the selected card kept", () => {
      const f = proto({ selectedKey: "job:d", barWidth: 500 });
      expect(f.compact).toBe(true);
      expect(widths(f)).toEqual([144, 172, 110, 143]);
    });

    it("1144px, the whole day", () => {
      const f = proto({ selectedKey: "job:d", barWidth: 1144 });
      expect(widths(f)).toEqual([200, 137, 125, 180, 159, 205]);
      expect(f.slots.map((s) => s.grow)).toEqual([1.875, 1.35, 1.35, expect.closeTo(3.24, 10), 1.35, 1.35]);
    });
  });
});

describe("fitDay on a busy day", () => {
  /* Ten 45-minute bookings on the hour, 7am to 4pm; at 12:30 the first five
     are finished and the sixth is on. */
  const ten = () =>
    dayItems(
      rail(
        Array.from({ length: 10 }, (_, i) =>
          block({
            key: `k${i}`,
            remoteId: `j${i}`,
            jobNumber: String(1000 + i),
            suburb: "Ryde",
            startMin: hm(7 + i),
            endMin: hm(7 + i, 45),
          })
        )
      )
    );
  const key = (i: number) => `job:k${i}`;
  const busy = (over: Partial<DayFitInput> = {}) =>
    fit({ items: ten(), nowMin: hm(12, 30), measure: guessMeasure, ...over });

  it("folds consecutive finished cards into one block: 64px, or the end card's 144", () => {
    const f = busy();
    expect(f.merged).toBe(true);
    expect(f.slots).toHaveLength(6);
    expect(f.slots[0]).toMatchObject({ kind: "group", collapsed: true, minWidth: DAY_GROUP_W + DAY_END_EXTRA });
    expect(f.slots[0].items.map((i) => i.key)).toEqual([0, 1, 2, 3, 4].map(key));
    // inside the bar, the block is 64px exactly
    const inner = busy({ selectedKey: key(0) });
    expect(inner.slots.map((s) => s.kind)).toEqual(["job", "group", "job", "job", "job", "job", "job"]);
    expect(inner.slots[1]).toMatchObject({ minWidth: DAY_GROUP_W, basis: DAY_GROUP_W, grow: 0 });
  });

  it("never folds the selected or the hovered card — each splits the run it sits in", () => {
    const f = busy({ selectedKey: key(2) });
    expect(f.slots.map((s) => s.key)).toEqual([`group:${key(0)}`, key(2), `group:${key(3)}`, ...[5, 6, 7, 8, 9].map(key)]);
    // and every block folds, not only the first
    for (const g of f.slots.filter((s) => s.kind === "group")) {
      expect(g).toMatchObject({ collapsed: true, minWidth: DAY_GROUP_W + (g.end ? DAY_END_EXTRA : 0) });
    }
    const h = busy({ hoverKey: key(1) });
    expect(h.slots.map((s) => s.key)).toEqual([key(0), key(1), `group:${key(2)}`, ...[5, 6, 7, 8, 9].map(key)]);
    expect(h.slots[1]).toMatchObject({ hovered: true, collapsed: false });
  });

  it("never makes a group of one — a lone finished card is a sliver", () => {
    const f = busy({ nowMin: hm(8) });
    expect(f.slots.some((s) => s.kind === "group")).toBe(false);
    expect(f.slots[0]).toMatchObject({ key: key(0), collapsed: true, minWidth: DAY_SLIVER_W + DAY_END_EXTRA });
    // nor from a run a selection and a hover chop into singles
    const chopped = busy({ selectedKey: key(1), hoverKey: key(3) });
    expect(chopped.merged).toBe(false);
    expect(chopped.slots.filter((s) => s.collapsed).map((s) => s.key)).toEqual([0, 2, 4].map(key));
  });

  it("unfolds when the block is pressed, and folds again when that is let go", () => {
    expect(busy({ showFinished: true }).slots).toHaveLength(10);
    expect(busy({ showFinished: true }).merged).toBe(false);
    expect(busy({ showFinished: false }).slots).toHaveLength(6);
  });

  it("gives up slivers, then compact labels, then width — in that order, and never the selected card's", () => {
    const stage = (f: DayFit) => (f.scale < 1 ? 3 : f.compact ? 2 : f.slots.some((s) => s.collapsed) ? 1 : 0);
    const at = (barWidth: number) => busy({ showFinished: true, selectedKey: key(7), barWidth });
    const seen: number[] = [];
    const selectedWidths = new Set<number>();
    // down to the width where the kept cards alone fill the bar
    for (let w = 2000; w >= 500; w -= 10) {
      const f = at(w);
      const s = stage(f);
      if (seen.length) expect(s).toBeGreaterThanOrEqual(seen[seen.length - 1]);
      seen.push(s);
      if (s >= 2) selectedWidths.add(f.slots[7].minWidth);
      if (s >= 1) {
        // every finished card but the selected one is a sliver from here on
        expect(f.slots.slice(0, 5).map((x) => x.minWidth)).toEqual([DAY_SLIVER_W + DAY_END_EXTRA, 48, 48, 48, 48]);
      }
      if (s === 3) {
        // it fits: the shrunk cards fill what the fixed ones leave, to the pixel
        const avail = w + DAY_H - DAY_GAP * 9;
        const sum = f.slots.reduce((a, x) => a + x.minWidth, 0);
        expect(sum).toBeLessThanOrEqual(avail);
        expect(sum).toBeGreaterThan(avail - 10);
      }
    }
    expect([...new Set(seen)]).toEqual([0, 1, 2, 3]);
    // compact or shrunk, the selected card keeps its own width
    expect(selectedWidths.size).toBe(1);
    // and ten bookings at 670 need every step
    expect(stage(at(670))).toBe(3);
  });

  it("grows by the hour, and the selected card harder; the end cards start wider", () => {
    const items = dayItems(
      rail([
        block({ key: "x", startMin: hm(7), endMin: hm(8) }),
        block({ key: "y", startMin: hm(9), endMin: hm(11, 30) }),
        block({ key: "z", startMin: hm(13), endMin: hm(13, 30) }),
      ])
    );
    const f = fit({ items, nowMin: hm(6), barWidth: 2000, selectedKey: "job:y", measure: () => 10 });
    // the words need max(10, 10 + 16, 10) = 26, and the slant 50 more
    expect(f.slots.map((s) => [s.minWidth, s.basis, s.grow])).toEqual([
      [26 + 50 + DAY_END_EXTRA, DAY_END_BASIS, 1.35],
      [26 + 50 + 60, 0, expect.closeTo((1 + 2.5 * 0.35) * 2.4, 10)],
      [26 + 50 + DAY_END_EXTRA, DAY_END_BASIS, expect.closeTo(1 + 0.5 * 0.35, 10)],
    ]);
    expect(f.slots.map((s) => s.end)).toEqual([true, false, true]);
  });

  it("gives a selected card the wider cap for its place", () => {
    const items = dayItems(
      rail([
        block({ key: "p", suburb: "Kangaroo Point Heights North" }),
        block({ key: "q", suburb: "Kangaroo Point Heights North", startMin: hm(10), endMin: hm(11) }),
      ])
    );
    const f = fit({ items, nowMin: hm(6), barWidth: 2000, selectedKey: "job:q", measure: guessMeasure });
    const tagW = (s: string) => guessMeasure(s, { px: 12, weight: 600 });
    expect(tagW(f.slots[0].tag)).toBeLessThanOrEqual(150);
    expect(tagW(f.slots[1].tag)).toBeLessThanOrEqual(220);
    expect(f.slots[1].tag.length).toBeGreaterThan(f.slots[0].tag.length);
  });

  it("never folds a late task in with finished work", () => {
    const items = dayItems(
      rail(
        Array.from({ length: 6 }, (_, i) =>
          block({ key: `k${i}`, jobNumber: String(1000 + i), startMin: hm(7 + i), endMin: hm(7 + i, 45) })
        ),
        [task({ atMin: hm(8, 50) })]
      )
    );
    const f = fit({ items, nowMin: hm(15), barWidth: 400, measure: guessMeasure });
    const t = f.slots.find((s) => s.kind === "task")!;
    expect(t).toMatchObject({ collapsed: false, p: 0, tag: "Task", time: "8:50" });
    expect(f.slots.map((s) => s.kind)).toEqual(["group", "task", "group"]);
  });
});

describe("dayCardPaint — every pair measured", () => {
  const WHITE: [number, number, number] = [255, 255, 255];
  const ratio = (a: string, b: string) => contrastRatio(rgbOf(a)!, rgbOf(b)!);
  const hex = (h: number, s: number, l: number) => {
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(v * 255).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  /* Every hue ServiceM8 can hand us, at the wash's saturation, plus the two
     paints that are not a category. */
  const PAINTS = [
    ...Array.from({ length: 360 }, (_, h) => dayItems(rail([block({ categoryColour: hex(h, 0.55, 0.85) })]))[0].paint!),
    dayItems(rail([block({ categoryColour: null })]))[0].paint!,
    dayItems(rail([block({ tracked: { kind: "visit", label: "Quarterly" } })]))[0].paint!,
  ];

  it("writes white at 4.5:1 or better on every fill, and on the darker shade the job on now fills with", () => {
    for (const paint of PAINTS) {
      for (const p of [0, 0.17, 0.99]) {
        const c = dayCardPaint({ kind: "job", paint }, p);
        expect(c.text).toBe("rgb(255, 255, 255)");
        expect(contrastRatio(rgbOf(c.bg)!, WHITE)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(rgbOf(c.fill)!, WHITE)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the quiet grey at 4.5:1 on every pale finished card", () => {
    for (const paint of PAINTS) {
      const c = dayCardPaint({ kind: "job", paint }, 1);
      expect(c.text).toBe("rgb(91, 100, 114)");
      expect(ratio(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps a selected or hovered finished card, and its panel, legible", () => {
    for (const paint of PAINTS) {
      for (const opts of [{ selected: true }, { hovered: true }]) {
        const c = dayCardPaint({ kind: "job", paint }, 1, opts);
        expect(ratio(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c.title, c.bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c.sub, c.bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("mixes exactly as the browser's color-mix does — his green, step by step", () => {
    const green = whiteLabelFill("rgb(71, 157, 37)"); // rgb(61, 134, 32)
    expect(dayCardPaint({ kind: "job", paint: green }, 0.5)).toMatchObject({
      bg: "rgb(61, 134, 32)",
      fill: "rgb(38, 83, 20)", // 62% with black
    });
    expect(dayCardPaint({ kind: "job", paint: green }, 1, { selected: true })).toMatchObject({
      bg: "rgb(201, 221, 193)", // 28% with white
      text: "rgb(38, 83, 20)",
      title: "rgb(21, 26, 36)",
      swatch: "rgb(61, 134, 32)",
    });
    expect(dayCardPaint({ kind: "job", paint: green }, 1).bg).toBe("rgb(228, 238, 224)"); // the tint, 50% with white
  });

  it("paints a task and the folded block in his greys, legibly", () => {
    const t = dayCardPaint({ kind: "task", paint: null }, 0);
    expect(t).toMatchObject({ bg: "rgb(238, 240, 243)", text: "rgb(57, 70, 90)" });
    expect(ratio(t.text, t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t.title, t.bg)).toBeGreaterThanOrEqual(4.5);
    const g = dayCardPaint({ kind: "group", paint: null }, 1);
    expect(g).toMatchObject({ bg: "rgb(241, 243, 247)", text: "rgb(91, 100, 114)" });
    expect(ratio(g.text, g.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("falls back to the grey's fill for a job with no readable paint, rather than to nothing", () => {
    expect(dayCardPaint({ kind: "job", paint: null }, 0).bg).toBe(whiteLabelFill(NO_CATEGORY_PAINT.bar));
  });
});
