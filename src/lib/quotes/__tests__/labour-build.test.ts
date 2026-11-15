import { labourVisitsOf, visitLine } from "../labour-build";

/* The labour, task by task (Isaac, 2026-10-09: "If a new org starts up it
   needs realistic estimates"): visits, their crews, every task's
   person-hours, summed into a line that carries its reasons. */

const install = { stage: "Install", people: 2, tasks: [{ task: "Set up and protect", hours: 1 }, { task: "Mount indoor", hours: 2 }, { task: "Core hole", hours: 0.75 }, { task: "Vacuum and commission", hours: 2 }] };

it("holds visits to what a line can carry, and says what's missing", () => {
  expect(labourVisitsOf([])).toMatch(/visits/);
  expect(labourVisitsOf([{ stage: "Install", people: 0, tasks: install.tasks }])).toMatch(/people/);
  expect(labourVisitsOf([{ stage: "Install", people: 2, tasks: [{ task: "Mount", hours: 0 }] }])).toMatch(/person-hours/);
  expect(labourVisitsOf([{ stage: "Install", people: 2, tasks: [] }])).toMatch(/no tasks/);
  expect(labourVisitsOf([install])).toEqual([install]);
});

it("adds every person's hours, names the crew and its days, and keeps the tasks on the line", () => {
  expect(visitLine(install, 8)).toEqual({
    name: "Install: 2 people, half a day",
    qty: 5.75,
    why: "Worked out task by task",
    visit: { stage: "Install", people: 2, dayHours: 8, tasks: install.tasks.map((t) => ({ ...t, was: null, byHand: false })) },
  });
  expect(visitLine({ stage: "Rough-in", people: 3, tasks: [{ task: "Duct runs", hours: 40 }, { task: "Units", hours: 8 }] }, 8).name).toBe("Rough-in: 3 people, 2 days");
  /* no working day set: the crew alone */
  expect(visitLine(install, null).name).toBe("Install: 2 people");
});

/* 3054 (Isaac, 15 November 2026): the crew and days as given stand, and the tasks are still worked out */
it("a visit's hours as given stand, its tasks shared out over them", () => {
  const day1 = { stage: "Day 1", people: 3, hours: 24, tasks: [{ task: "Lift boards, access panel", hours: 3 }, { task: "Set the indoor under the floor", hours: 6 }, { task: "Duct runs to 5 outlets", hours: 10 }, { task: "Core holes and outdoor", hours: 4 }] };
  expect(labourVisitsOf([day1])).toEqual([day1]);
  const line = visitLine(day1, 8);
  expect(line.qty).toBe(24);
  expect(line.name).toBe("Day 1: 3 people, 1 day");
  expect(line.visit.tasks.map((t) => t.task)).toEqual(day1.tasks.map((t) => t.task));
  expect(line.visit.tasks.reduce((n, t) => n + t.hours, 0)).toBe(24);
  expect(line.why).toMatch(/as given/);
  /* a half day, held, over tasks Tiff thought longer */
  const half = visitLine({ stage: "Day 3", people: 1, hours: 4, tasks: [{ task: "Commission", hours: 3 }, { task: "Fit grilles", hours: 3 }, { task: "Hand over", hours: 1 }] }, 8);
  expect(half.qty).toBe(4);
  expect(half.name).toBe("Day 3: 1 person, half a day");
  expect(half.visit.tasks.every((t) => t.hours >= 0.25)).toBe(true);
  expect(labourVisitsOf([{ ...day1, hours: 0 }])).toMatch(/as given/);
});
