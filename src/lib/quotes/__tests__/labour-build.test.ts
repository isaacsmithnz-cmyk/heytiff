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

it("adds every person's hours, names the crew and its days, and keeps the tasks as the reason", () => {
  expect(visitLine(install, 8)).toEqual({ name: "Install: 2 people, half a day", qty: 6, why: "Set up and protect 1 h; Mount indoor 2 h; Core hole 1 h; Vacuum and commission 2 h" });
  expect(visitLine({ stage: "Rough-in", people: 3, tasks: [{ task: "Duct runs", hours: 40 }, { task: "Units", hours: 8 }] }, 8).name).toBe("Rough-in: 3 people, 2 days");
  /* no working day set: the crew alone */
  expect(visitLine(install, null).name).toBe("Install: 2 people");
});
