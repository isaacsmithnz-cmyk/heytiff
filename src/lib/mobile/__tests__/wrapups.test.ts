/* Days owed a wrap-up, kept in HeyTiff (Isaac, 9 November 2026: "Build it",
   after a reinstall lost Friday 6 November's from the phone): the phone's
   own four changes, applied in order and safe to send twice. */

import { applyOps, owedOf, readOps, type WrapOp, type WrapRow } from "../wrapups";

const FRI: WrapRow = { on: "2026-11-06", jobs: ["3488", "3514"], done: [], noted: [], settled: false };
const rows = (...r: WrapRow[]) => new Map(r.map((x) => [x.on, x]));

describe("readOps", () => {
  it("takes the phone's four ops, ids lowercased", () => {
    expect(
      readOps({
        ops: [
          { do: "owe", on: "2026-11-06", jobs: ["3488", " 3514 "] },
          { do: "noted", on: "2026-11-06", job: "AB-1" },
          { do: "wrapped", on: "2026-11-06", job: "AB-1", jobs: ["AB-1", "cd-2"] },
          { do: "settle", on: "2026-11-06" },
        ],
      }),
    ).toEqual([
      { do: "owe", on: "2026-11-06", jobs: ["3488", "3514"], done: [], noted: [] },
      { do: "noted", on: "2026-11-06", job: "ab-1" },
      { do: "wrapped", on: "2026-11-06", job: "ab-1", jobs: ["ab-1", "cd-2"] },
      { do: "settle", on: "2026-11-06" },
    ]);
  });

  it("refuses anything that isn't one", () => {
    expect(readOps(null)).toBeNull();
    expect(readOps({ ops: [{ do: "owe", on: "6 Nov", jobs: [] }] })).toBeNull();
    expect(readOps({ ops: [{ do: "noted", on: "2026-11-06" }] })).toBeNull();
    expect(readOps({ ops: [{ do: "drop", on: "2026-11-06" }] })).toBeNull();
    expect(readOps({ ops: [{ do: "owe", on: "2026-11-06", jobs: "3488" }] })).toBeNull();
  });
});

describe("applyOps", () => {
  it("owes a day, notes and wraps its jobs, and settles it with the last", () => {
    const a = applyOps(rows(), [
      { do: "owe", on: "2026-11-06", jobs: ["3488", "3514"] },
      { do: "noted", on: "2026-11-06", job: "j1" },
      { do: "wrapped", on: "2026-11-06", job: "j1", jobs: ["j1", "j2"] },
    ]);
    expect(a.get("2026-11-06")).toEqual({ ...FRI, done: ["j1"], noted: ["j1"] });
    const b = applyOps(a, [{ do: "wrapped", on: "2026-11-06", job: "j2", jobs: ["j1", "j2"] }]);
    expect(b.get("2026-11-06")?.settled).toBe(true);
  });

  it("is the same sent twice", () => {
    const ops: WrapOp[] = [
      { do: "owe", on: "2026-11-06", jobs: ["3488"] },
      { do: "noted", on: "2026-11-06", job: "j1" },
    ];
    const once = applyOps(rows(), ops);
    expect(applyOps(once, ops)).toEqual(once);
  });

  it("a second Clock off keeps what's wrapped up, and a day settled before is owed afresh", () => {
    const owed = applyOps(rows({ ...FRI, done: ["j1"] }), [{ do: "owe", on: "2026-11-06", jobs: ["3488", "3514", "279"] }]);
    expect(owed.get("2026-11-06")).toMatchObject({ jobs: ["3488", "3514", "279"], done: ["j1"], settled: false });
    const again = applyOps(rows({ ...FRI, done: ["j1"], settled: true }), [{ do: "owe", on: "2026-11-06", jobs: ["3488"] }]);
    expect(again.get("2026-11-06")).toEqual({ on: "2026-11-06", jobs: ["3488"], done: [], noted: [], settled: false });
  });

  it("marks nothing on a day that isn't owed", () => {
    expect(applyOps(rows(), [{ do: "noted", on: "2026-11-06", job: "j1" }]).size).toBe(0);
    expect(applyOps(rows({ ...FRI, settled: true }), [{ do: "wrapped", on: "2026-11-06", job: "j1", jobs: ["j1"] }]).size).toBe(0);
  });

  it("the phone's own list comes up whole on the first send, done and noted with it", () => {
    const a = applyOps(rows(), [{ do: "owe", on: "2026-11-09", jobs: ["1352"], done: ["j9"], noted: ["j9"] }]);
    expect(a.get("2026-11-09")).toEqual({ on: "2026-11-09", jobs: ["1352"], done: ["j9"], noted: ["j9"], settled: false });
  });
});

it("owedOf lists the days still owed, oldest first", () => {
  expect(owedOf([{ ...FRI, on: "2026-11-09" }, FRI, { ...FRI, on: "2026-11-05", settled: true }]).map((o) => o.on)).toEqual(["2026-11-06", "2026-11-09"]);
});
