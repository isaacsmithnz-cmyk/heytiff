import { askLine, firstName, lastTiff, planView, tiffSince, whenOf } from "../plan-view";
import type { NoteProposal } from "@/lib/workboard/note-brain";

/* The plan as Tiff says it: who, then what, then when. The words are the
   spec's ("**{First}**, {title}{, Fri 7:00}", "**Who** {title}" with "Needs
   an answer", and each lane named by where it lands); the keys are the
   server's, so a cross names exactly one row. */

const base: NoteProposal = {
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
};
const task = (title: string, assigneeId: string | null, dueDate = "", remindTime = "") => ({
  title,
  detail: "",
  assigneeId,
  assigneeHint: "",
  dueHint: "",
  dueDate,
  remindTime,
  remindKind: "at" as const,
});
const staff = [{ id: "s1", fullName: "Callum  Reid" }];

describe("planView", () => {
  it("leads a task with the first name and ends it with when", () => {
    const rows = planView({ ...base, tasks: [task("The filters from Reece", "s1", "2026-09-25", "07:00")] }, staff, false);
    expect(rows).toEqual([
      {
        key: "tasks:0",
        lane: "tasks",
        index: 0,
        lead: "Callum",
        join: ", ",
        text: "The filters from Reece, Fri 7:00",
        needs: false,
      },
    ]);
  });

  it("asks who, only while Tiff is still asking", () => {
    const p = { ...base, tasks: [task("Book 3323 in", null)] };
    expect(planView(p, staff, true)[0]).toMatchObject({ lead: "Who", join: " ", needs: true });
    expect(planView(p, staff, false)[0]).toMatchObject({ lead: "Who", needs: false });
  });

  it("names every other lane by where it lands, keyed by its place in the plan", () => {
    const rows = planView(
      {
        ...base,
        flags: [{ message: "Isolator loose", severity: "warn" }],
        issueEntries: [{ body: "E6 again", equipmentHint: "" }],
        bringItems: ["3.5 kW head"],
        progressBullets: ["Pipework run"],
        commissioningEntries: [{ body: "Vacuum held", equipmentHint: "" }],
        kbEntries: [{ title: "E6 clears on the outdoor board", body: "b" }],
      },
      staff,
      false
    );
    expect(rows.map((r) => [r.key, r.lead, r.text, r.kb ?? null])).toEqual([
      ["flags:0", "On the board", "Isolator loose", null],
      ["issueEntries:0", "Logged", "E6 again", null],
      ["bringItems:0", "Bring", "3.5 kW head", null],
      ["progressBullets:0", "On the job", "Pipework run", null],
      ["commissioningEntries:0", "On the job", "Vacuum held", null],
      ["kbEntries:0", "For everyone", "E6 clears on the outdoor board", "ready"],
    ]);
  });
});

describe("the words around it", () => {
  it("reads a day as a calendar date, whatever the zone", () => {
    expect(whenOf("2026-09-28", "")).toBe("Mon");
    expect(whenOf("", "16:30")).toBe("16:30");
    expect(whenOf("2026-09-25", "07:05")).toBe("Fri 7:05");
    expect(whenOf("", "")).toBe("");
  });

  it("says the question once", () => {
    expect(askLine("Luke has it. Who books 3323?", "Who books 3323?")).toBe("Luke has it. Who books 3323?");
    expect(askLine("Luke has it.", "Who books 3323?")).toBe("Luke has it. Who books 3323?");
    expect(askLine("", "Who books 3323?")).toBe("Who books 3323?");
  });

  it("reads Tiff's lines off what the server returned", () => {
    const t = (who: "you" | "tiff", text: string) => ({ who, text, at: "" });
    const turns = [t("you", "a"), t("tiff", "Old."), t("you", "b"), t("tiff", "Luke has it."), t("tiff", "Who books it?")];
    expect(tiffSince(turns)).toBe("Luke has it. Who books it?");
    expect(lastTiff(turns)).toBe("Who books it?");
    expect(tiffSince([t("you", "a")])).toBe("");
    expect(lastTiff(undefined)).toBe("");
  });

  it("takes the first name however the name is spaced", () => {
    expect(firstName(staff[0]!.fullName)).toBe("Callum");
  });
});
