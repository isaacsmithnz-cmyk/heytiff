/* keptLines is the client half of the honest demotion: what "Keep it in my
   notes" actually keeps. The rules that matter are the ones that would be
   quietly wrong if regressed — unticked rows stay out, edits travel, an
   UNASSIGNED task's words still survive (toConfirmed would drop it), and a
   card with no rows keeps nothing so the server falls back to the raw
   transcript. */

import { keptLines, toDraft } from "../review-card";
import type { NoteProposal } from "@/lib/workboard/note-brain";

const proposal = (over: Partial<NoteProposal> = {}): NoteProposal => ({
  tasks: [],
  bringItems: [],
  flags: [],
  progressBullets: [],
  commissioningEntries: [],
  issueEntries: [],
  kbEntries: [],
  noteLines: [],
  plainNote: "",
  clarify: null,
  ...over,
});

it("keeps nothing when the card grew no rows — the transcript is the floor", () => {
  const d = toDraft(proposal({ plainNote: "Nice dog on site." }));
  expect(keptLines(d, "Nice dog on site.")).toEqual([]);
});

it("keeps the ticked rows in card order, with the plain remark first", () => {
  const d = toDraft(
    proposal({
      plainNote: "Unit still will not regulate.",
      flags: [{ message: "Fuel fault unresolved", severity: "warn" }],
      progressBullets: ["Checked the regulator"],
      commissioningEntries: [{ body: "25.5 static both sides", equipmentHint: "" }],
      issueEntries: [{ body: "Will not regulate fuel pressure", equipmentHint: "" }],
    })
  );
  expect(keptLines(d, "Unit still will not regulate.")).toEqual([
    "Unit still will not regulate.",
    "Fuel fault unresolved",
    "Checked the regulator",
    "25.5 static both sides",
    "Will not regulate fuel pressure",
  ]);
});

it("an unticked row stays out — kept means reviewed and left ticked", () => {
  const d = toDraft(proposal({ progressBullets: ["kept", "skipped"] }));
  d.progressBullets[1].on = false;
  expect(keptLines(d, "")).toEqual(["kept"]);
});

it("keeps an UNASSIGNED task's words — unapplyable is not unkeepable", () => {
  const d = toDraft(
    proposal({
      tasks: [
        {
          title: "Ring the wholesaler",
          detail: "about the coil pricing",
          assigneeId: null,
          assigneeHint: "someone",
          dueHint: "",
          dueDate: "",
        },
      ],
    })
  );
  expect(keptLines(d, "")).toEqual(["Ring the wholesaler — about the coil pricing"]);
});

it("bring-items say what they are once they stop being a bring-list", () => {
  const d = toDraft(proposal({ bringItems: ["2 × 595 filters"] }));
  expect(keptLines(d, "")).toEqual(["Bring next visit: 2 × 595 filters"]);
});
