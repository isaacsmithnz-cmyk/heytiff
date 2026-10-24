import { teamDay, timeWord } from "../month-team";
import { capacityWindow, type CapacityAllocation } from "@/lib/workboard/capacity";

/* The month's Team filter (Isaac, 24 October 2026): who's off and why, the
   public holiday by name, events; and capacity less whoever is off. */

const names = new Map([
  ["cv", "Callum Vrieze"],
  ["dh", "David Hann"],
  ["lm", "Leonardo Martins"],
]);
const DAY = "2026-10-28";
const away = (staffUuid: string, name: string, start: string, end: string) => ({ uuid: `${staffUuid}${start}`, staffUuid, name, start, end });

describe("a day of the month's Team", () => {
  it("says who's off and why, part days with their hours, a person once", () => {
    const t = teamDay({
      dayISO: DAY,
      away: [
        away("dh", "WAREHOUSE", `${DAY} 07:00:00`, `${DAY} 09:00:00`),
        away("lm", "HOLIDAYS", `${DAY} 00:00:00`, `${DAY} 23:59:59`),
        away("lm", "HOLIDAY", `${DAY} 00:00:00`, `${DAY} 23:59:59`),
        away("cv", "TAFE", "2026-10-26 00:00:00", "2026-10-30 23:59:59"),
      ],
      closed: [],
      names,
      events: [],
      notices: [],
    });
    expect(t.off.map((o) => [o.name, o.why, o.part])).toEqual([
      ["Callum Vrieze", "TAFE", null],
      ["Leonardo Martins", "HOLIDAYS", null],
      ["David Hann", "WAREHOUSE", "7 to 9"],
    ]);
    expect(t.off.find((o) => o.staffUuid === "dh")?.minutes).toBe(120);
    expect(t.holiday).toBeNull();
  });

  it("names the public holiday, and an event on its day with its time and place", () => {
    const t = teamDay({
      dayISO: "2026-10-05",
      away: [],
      closed: [{ uuid: "h", kind: "holiday", name: "Labour Day", start: "2026-10-05 00:00:00", end: "2026-10-05 23:59:59" }],
      names,
      events: [{ id: "e1", kind: "event", title: "Toolbox talk", startsOn: "2026-10-05", endsOn: "2026-10-05", startsAt: "07:00", endsAt: null, location: "The workshop", audience: null, note: null, seriesId: null, repeat: null, createdBy: null, createdAt: null }],
      notices: [{ id: "n1", title: "Christmas party", date: "2026-12-11", time: null, location: null }],
    });
    expect(t.holiday).toBe("Labour Day");
    expect(t.events).toEqual([{ id: "event:e1", title: "Toolbox talk", when: "7 am", where: "The workshop" }]);
  });

  it("reads a clock time as words", () => {
    expect(timeWord("13:30:00")).toBe("1:30 pm");
    expect(timeWord(null)).toBeNull();
  });
});

describe("capacity less whoever is off", () => {
  const crew: CapacityAllocation[] = [
    { staffUuid: "cv", name: "Callum Vrieze", included: true, dailyMinutes: 480 },
    { staffUuid: "dh", name: "David Hann", included: true, dailyMinutes: 480 },
  ];
  it("takes a whole day off a person's hours, a part day only its minutes, and scores a shut day as nothing", () => {
    const off = new Map([["2026-10-28", new Map([["cv", 510], ["dh", 120]])]]);
    const days = capacityWindow({
      days: ["2026-10-27", "2026-10-28", "2026-10-05"],
      activities: [],
      allocation: crew,
      offMinutes: (d, u) => off.get(d)?.get(u) ?? 0,
      closed: new Set(["2026-10-05"]),
    });
    expect(days.map((d) => d.capacityMinutes)).toEqual([960, 360, 0]);
    expect(days[2].fillPct).toBeNull();
  });
});
