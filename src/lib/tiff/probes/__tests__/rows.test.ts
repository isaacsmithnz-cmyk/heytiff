import { compareRows, costOf, percentile, shapeOf } from "../rows";
import type { NoteProposal } from "@/lib/workboard/note-brain";

const plan = (over: Partial<NoteProposal> = {}): NoteProposal => ({
  tasks: [],
  bringItems: [],
  flags: [],
  progressBullets: [],
  commissioningEntries: [],
  issueEntries: [],
  kbEntries: [],
  plainNote: "",
  say: "",
  clarify: null,
  ...over,
});

const task = (assigneeId: string | null, dueDate = "", title = "Order grilles") => ({
  title,
  detail: "",
  assigneeId,
  assigneeHint: "",
  dueHint: "",
  dueDate,
  remindTime: "",
  remindKind: "at" as const,
});

describe("two reads of a note", () => {
  it("agree when the same work lands, however it is worded", () => {
    const a = plan({ tasks: [task("lyle", "2026-08-07", "Order the grilles")], flags: [{ message: "RTU tripped", severity: "warn" }] });
    const b = plan({ tasks: [task("lyle", "2026-08-07", "Lyle to order grilles")], flags: [{ message: "Middle unit trip", severity: "warn" }] });
    expect(compareRows(a, b)).toEqual({ same: true, diffs: [], wrongAssignee: false });
  });

  it("disagree on a different person, and call it a wrong assignee", () => {
    const v = compareRows(plan({ tasks: [task("lyle")] }), plan({ tasks: [task("dane")] }));
    expect(v.same).toBe(false);
    expect(v.wrongAssignee).toBe(true);
  });

  it("disagree when one asks who and the other assigns, without calling it wrong", () => {
    const v = compareRows(plan({ tasks: [task(null)] }), plan({ tasks: [task("dane")] }));
    expect(v.same).toBe(false);
    expect(v.wrongAssignee).toBe(false);
  });

  it("disagree on a date, a flag's urgency, a lane's count or a question back", () => {
    expect(compareRows(plan({ tasks: [task("a", "2026-08-07")] }), plan({ tasks: [task("a", "2026-08-08")] })).same).toBe(false);
    expect(
      compareRows(plan({ flags: [{ message: "x", severity: "warn" }] }), plan({ flags: [{ message: "x", severity: "urgent" }] })).same,
    ).toBe(false);
    expect(compareRows(plan({ bringItems: ["filters"] }), plan()).same).toBe(false);
    expect(compareRows(plan({ clarify: { question: "Which Lyle?", options: [] } }), plan()).same).toBe(false);
  });

  it("report a remark kept by only one side without failing the pair", () => {
    const v = compareRows(plan({ plainNote: "Noise" }), plan());
    expect(v.same).toBe(true);
    expect(v.diffs).toEqual(["only the first keeps a remark"]);
  });

  it("match tasks as a set, not by their order", () => {
    const a = plan({ tasks: [task("a"), task("b")] });
    const b = plan({ tasks: [task("b"), task("a")] });
    expect(shapeOf(a).tasks).toEqual(shapeOf(b).tasks);
    expect(compareRows(a, b).same).toBe(true);
  });
});

describe("percentile", () => {
  it("takes the nearest rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 50)).toBe(0);
  });
});

describe("costOf", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

  it("prices Opus 5 and Opus 5.5 apart, though one name starts with the other", () => {
    expect(costOf("claude-opus-5", usage)).toBeCloseTo(30);
    expect(costOf("claude-opus-5-5", usage)).toBeCloseTo(24);
  });

  it("charges cache writes at 1.25 times input and reads at the cache rate", () => {
    const cached = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 };
    expect(costOf("claude-opus-5", cached)).toBeCloseTo(6.25 + 0.5);
  });

  it("prices an unknown model at nothing rather than a guess", () => {
    expect(costOf("some-other-model", usage)).toBe(0);
  });
});
