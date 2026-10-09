import { normaliseDraft } from "@/lib/quotes/proposal";
import { parseTasks, plannedVisits, tasksFromQuote, tasksPrompt, unitTaskName, unitsOf, TASKS_SYSTEM } from "../task-plan";

/* Isaac, 2026-10-06: "create a task list from the TIFF quote… install
   living room unit, install kitchen unit, complete pipe work, take photos of
   wall controller locations" — 2905's VRF, six ducted heads */

const option = normaliseDraft({
  options: [
    {
      name: "Mitsubishi Electric VRF, six ducted units",
      lines: ["Outdoor unit in the garage.", "Two sheet metal ducts to the roof garden."],
      units: [
        { role: "outdoor", room: "Garage", capacity: "22.4 kW", type: "Outdoor unit", model: "PUMY-P200YKMD2-A", qty: 1, system: 1 },
        { role: "indoor", room: "Level 1 Dining/Kitchen", capacity: "7.1 kW", type: "Ducted", model: "PEFY-P63VMX-A", qty: 1, system: 1 },
        { role: "indoor", room: "Level 2 Bedroom 3", capacity: "2.8 kW", type: "Ducted", model: "PEFY-P25VMX-A", qty: 1, system: 1 },
      ],
    },
  ],
})!.options;

const labour = [
  { stage: "Rough-in" as const, people: 2, days: 3 },
  { stage: "Install" as const, people: 2, days: 1 },
  { stage: "Fit-off" as const, people: 2, days: 1.5 },
  { stage: "Commissioning" as const, people: 1, days: 0.5 },
];

describe("the visits the quote plans", () => {
  it("is a visit a day, a part day a visit of its own", () => {
    expect(plannedVisits(labour).map((v) => `${v.n} ${v.stage}`)).toEqual([
      "1 Rough-in",
      "2 Rough-in",
      "3 Rough-in",
      "4 Install",
      "5 Fit-off",
      "6 Fit-off",
      "7 Commissioning",
    ]);
  });

  it("leaves the site measure out, and runs several options' labour stage by stage", () => {
    const two = [
      { stage: "Site measure" as const, people: 1, days: 0.5 },
      { stage: "Rough-in" as const, people: 2, days: 1 },
      { stage: "Install" as const, people: 2, days: 1 },
      { stage: "Rough-in" as const, people: 2, days: 1 },
      { stage: "Install" as const, people: 2, days: 1 },
    ];
    expect(plannedVisits(two).map((v) => v.stage)).toEqual(["Rough-in", "Rough-in", "Install", "Install"]);
  });
});

describe("what Tiff is handed", () => {
  it("names the option's scope, its units numbered, the site's facts and the visits", () => {
    const p = tasksPrompt({ site: "44 Leinster Street\nPaddington NSW 2021", options: option, facts: ["Outdoor unit location: Garage, on a slab"], visits: plannedVisits(labour) });
    expect(p).toContain("Site: 44 Leinster Street, Paddington NSW 2021");
    expect(p).toContain("- Outdoor unit in the garage.");
    expect(p).toContain("3. indoor: Level 2 Bedroom 3, 2.8 kW, Ducted, PEFY-P25VMX-A");
    expect(p).toContain("4. Install, 2 people");
    expect(p).toContain("- Outdoor unit location: Garage, on a slab");
    expect(TASKS_SYSTEM).toContain("exactly one task for each unit listed");
  });

  it("says so when no visits are planned", () => {
    expect(tasksPrompt({ site: null, options: option, facts: [], visits: [] })).toContain("visit is 0 for every task");
  });
});

describe("what Tiff gives back, checked", () => {
  const units = unitsOf(option);
  const visits = plannedVisits(labour);

  it("keeps a task's stage, kind, unit and planned visit", () => {
    const tasks = parseTasks(
      {
        tasks: [
          { name: "- Rough-in pipe and cable, garage to the heads", stage: "Rough-in", kind: "progress", unit: 0, visit: 1 },
          { name: "Hang the Level 2 Bedroom 3 unit", stage: "Install", kind: "unit", unit: 3, visit: 4 },
          { name: "Set the outdoor unit in the garage", stage: "Install", kind: "unit", unit: 1, visit: 4 },
          { name: "Hang the Level 1 Dining/Kitchen unit", stage: "Install", kind: "unit", unit: 2, visit: 4 },
        ],
      },
      units,
      visits
    );
    expect(tasks[0]).toEqual({ name: "Rough-in pipe and cable, garage to the heads", stage: "Rough-in", kind: "progress", unit: null, visit: 1, sort: 0, hours: null });
    expect(tasks[1]).toMatchObject({ kind: "unit", unit: { role: "indoor", room: "Level 2 Bedroom 3", model: "PEFY-P25VMX-A" }, visit: 4 });
    expect(tasks).toHaveLength(4);
  });

  it("refuses a unit that doesn't exist or is taken, a visit not planned, and a stage not on the list", () => {
    const tasks = parseTasks(
      {
        tasks: [
          { name: "Hang a unit nobody quoted", stage: "Install", kind: "unit", unit: 9, visit: 4 },
          { name: "Hang the Level 2 Bedroom 3 unit", stage: "Install", kind: "unit", unit: 3, visit: 40 },
          { name: "Hang it again", stage: "Install", kind: "unit", unit: 3, visit: 4 },
          { name: "Sweep up", stage: "Cleanup", kind: "tick", unit: 0, visit: 7 },
        ],
      },
      units,
      visits
    );
    expect(tasks.slice(0, 4).map((t) => [t.kind, t.unit?.room ?? null, t.visit, t.stage])).toEqual([
      ["tick", null, 4, "Install"],
      ["unit", "Level 2 Bedroom 3", null, "Install"],
      ["tick", null, 4, "Install"],
      ["tick", null, 7, "Install"],
    ]);
  });

  it("gives every unit its own task, on the first install visit, when Tiff left one out", () => {
    const tasks = parseTasks({ tasks: [{ name: "Rough-in", stage: "Rough-in", kind: "progress", unit: 0, visit: 1 }] }, units, visits);
    expect(tasks.filter((t) => t.kind === "unit").map((t) => [t.name, t.visit])).toEqual([
      ["Set the outdoor unit, Garage", 4],
      ["Hang the Level 1 Dining/Kitchen unit", 4],
      ["Hang the Level 2 Bedroom 3 unit", 4],
    ]);
  });

  it("reads nothing from an answer that isn't one", () => {
    expect(parseTasks(null, [], [])).toEqual([]);
    expect(parseTasks({ tasks: [{ name: "  " }] }, [], [])).toEqual([]);
  });

  it("words a unit's task the way the crew says it", () => {
    expect(unitTaskName({ role: "indoor", room: "Bedrooms", capacity: "", type: "", model: "", qty: 2, system: 1, lps: null })).toBe("Hang the Bedrooms units");
    expect(unitTaskName({ role: "fan", room: "Bathroom", capacity: "", type: "", model: "", qty: 1, system: 0, lps: null })).toBe("Fit the Bathroom fan");
  });
});

describe("the quote's own tasks, straight onto the job (slice 8.2)", () => {
  const t = (task: string, hours: number) => ({ task, hours });
  /* 3377: the rough-in and the install, as Tiff and Isaac worked them out */
  const rough = [t("Travel and setup", 5), t("Downstairs indoor", 5), t("Six floor boots", 6), t("Six flex runs", 5), t("Floor return", 2.5), t("Kitchen cores", 2), t("Sandstone core", 6), t("Upstairs indoor", 5), t("Ceiling cut-ins", 4.5), t("Upstairs return", 2), t("Downstairs pipe", 3), t("Upstairs pipe", 6), t("Drains", 3), t("Clean up", 2)];
  const install = [t("Travel and setup", 2), t("Set two outdoors", 3), t("Connect pipe", 3), t("Two circuits", 6), t("Controllers", 2), t("Test and vacuum", 4), t("Commission", 3), t("Clean up", 1)];
  const quote = [
    { stage: "Install" as const, people: 2, days: 1.5, tasks: install },
    { stage: "Rough-in" as const, people: 2, days: 3.5625, tasks: rough },
  ];

  it("puts each visit's tasks on its days in order, on the day most of it falls on, every task keeping its hours", () => {
    const tasks = tasksFromQuote(quote, 8, []);
    expect(plannedVisits(quote)).toHaveLength(6);
    const on = (n: number) => tasks.filter((x) => x.visit === n).map((x) => x.name);
    expect(on(1)).toEqual(["Travel and setup", "Downstairs indoor", "Six floor boots"]);
    expect(on(2)).toEqual(["Six flex runs", "Floor return", "Kitchen cores", "Sandstone core"]);
    expect(on(3)).toEqual(["Upstairs indoor", "Ceiling cut-ins", "Upstairs return", "Downstairs pipe"]);
    expect(on(4)).toEqual(["Upstairs pipe", "Drains", "Clean up"]);
    expect(on(5)).toEqual(["Travel and setup", "Set two outdoors", "Connect pipe", "Two circuits", "Controllers"]);
    expect(on(6)).toEqual(["Test and vacuum", "Commission", "Clean up"]);
    expect(tasks[0]).toEqual({ name: "Travel and setup", stage: "Rough-in", kind: "tick", unit: null, visit: 1, sort: 0, hours: 5 });
    expect(tasks.reduce((n, x) => n + (x.hours ?? 0), 0)).toBe(81);
  });

  it("the units keep their own tasks, for their photos and plates, on the first install visit", () => {
    const tasks = tasksFromQuote(quote, 8, unitsOf(option));
    expect(tasks.filter((x) => x.kind === "unit").map((x) => [x.name, x.visit, x.hours])).toEqual([
      ["Set the outdoor unit, Garage", 5, null],
      ["Hang the Level 1 Dining/Kitchen unit", 5, null],
      ["Hang the Level 2 Bedroom 3 unit", 5, null],
    ]);
  });

  it("with no working day, a visit's tasks all go on its first day; a quote with no tasks hands over none", () => {
    expect(new Set(tasksFromQuote([{ stage: "Install", people: 2, days: 1, tasks: install }], null, []).map((x) => x.visit))).toEqual(new Set([1]));
    expect(tasksFromQuote([{ stage: "Install", people: 2, days: 1, tasks: [] }], 8, unitsOf(option))).toEqual([]);
  });
});
