import { buildProgress, planOf } from "../build-progress";

/* Watching her build it (slice 5.2, mock-up screen 2): the parts she
   planned, done, the one she's on, and what's to come. */

const plan = planOf([
  { system: "Downstairs", group: "Units", detail: "PEA-M125HAA under the floor" },
  { system: "Downstairs", group: "Ductwork and grilles", detail: "" },
  { system: "Upstairs", group: "Units", detail: "PEAD-M71" },
  { system: "", group: "Labour", detail: "" },
]);
const line = (system: string, group: string, sell: number) => ({ system, group, sell });

it("keeps a part once, and drops one with no group", () => {
  expect(planOf([{ system: "A", group: "Units" }, { system: "a ", group: "units" }, { system: "B" }, "x"])).toEqual([{ system: "A", group: "Units", detail: "" }]);
});

it("is on the furthest part with lines; every part before it is done", () => {
  const { parts, done } = buildProgress(plan, [line("Downstairs", "Units", 500000), line("downstairs", "Ductwork and grilles", 1000), line("Downstairs", "Ductwork and grilles", 2000)], (l) => l.sell);
  expect(done).toBe(1);
  expect(parts.map((p) => [p.state, p.items, p.sellCents])).toEqual([
    ["done", 1, 500000],
    ["now", 2, 3000],
    ["todo", 0, null],
    ["todo", 0, null],
  ]);
});

it("before any lines, she's on the first", () => {
  const { parts, done } = buildProgress(plan, [], () => 0);
  expect(done).toBe(0);
  expect(parts[0]!.state).toBe("now");
});

it("a part she skipped counts as done once she's past it", () => {
  const { parts } = buildProgress(plan, [line("Upstairs", "Units", 1)], (l) => l.sell);
  expect(parts.map((p) => p.state)).toEqual(["done", "done", "now", "todo"]);
});
