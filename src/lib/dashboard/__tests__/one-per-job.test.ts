import { onePerJob } from "../tasks";

test("the copies of a task given to two people are one row, the first copy kept", () => {
  const rows = [
    { id: "mine", groupId: "g1" },
    { id: "lukes", groupId: "g1" },
    { id: "other", groupId: null },
    { id: "another", groupId: undefined },
  ];
  expect(onePerJob(rows).map((r) => r.id)).toEqual(["mine", "other", "another"]);
});
