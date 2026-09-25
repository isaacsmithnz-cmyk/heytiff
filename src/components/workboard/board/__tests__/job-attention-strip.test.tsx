/* The strip's doors for notes to ServiceM8 (two-way phase 2, PR B): Reply on
   a mention of you, Mark done on a flag, and one of HeyTiff's own replies as
   a mention — no task from it, and Not work only for the person it names. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobAttentionStrip, type StripSm8 } from "../job-attention-strip";
import type { AttentionItem } from "@/lib/workboard/job-attention";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-words";

const ASK = "7e7e7e7e-0000-4000-8000-00000000a5c1";
const FLAG = "7e7e7e7e-0000-4000-8000-00000000f1a9";
const SENT_AS = "9a9a9a9a-0000-4000-8000-000000000001";

const theirs: AttentionItem = {
  kind: "mention",
  key: `mention:${ASK}`,
  noteUuid: ASK,
  text: "@isaacsmith can you order the grilles",
  author: "Luke Ingold",
  at: "2026-09-20 09:00:00",
  named: [{ name: "Isaac Smith", staffId: "staff-isaac" }],
  you: true,
  origin: "sm8",
  rowId: null,
};
const ours = (over: Partial<Extract<AttentionItem, { kind: "mention" }>> = {}): AttentionItem => ({
  kind: "mention",
  key: "mention:r1",
  noteUuid: SENT_AS,
  text: "@lukeingold on my way",
  author: "Isaac Smith",
  at: "2026-09-20T01:00:00.000Z",
  named: [{ name: "Luke Ingold", staffId: "staff-luke" }],
  you: true,
  origin: "heytiff",
  rowId: "r1",
  ...over,
});
const flag: AttentionItem = { kind: "sm8flag", key: `sm8flag:${FLAG}`, noteUuid: FLAG, text: "call the builder", author: "Luke Ingold", at: null };

function strip(items: AttentionItem[], sm8: Partial<StripSm8> | null = {}) {
  const h = {
    onClearFlag: jest.fn(),
    onOpenNote: jest.fn(),
    onMakeTask: jest.fn(),
    onDismissNote: jest.fn(),
    onReply: jest.fn(),
    onMarkDone: jest.fn(),
  };
  render(
    <JobAttentionStrip
      attention={{ items, total: items.length }}
      assignable={[]}
      busy={false}
      onClearFlag={h.onClearFlag}
      onOpenNote={h.onOpenNote}
      onMakeTask={h.onMakeTask}
      onDismissNote={h.onDismissNote}
      sm8={
        sm8 === null
          ? null
          : { flags: {}, canReply: true, canMark: true, onReply: h.onReply, onMarkDone: h.onMarkDone, ...sm8 }
      }
    />
  );
  return h;
}

const rowOf = (text: RegExp) => screen.getByText(text).closest(".wb2-jcattrow") as HTMLElement;

describe("a mention of you", () => {
  it("offers Reply beside today's doors, and Reply names the note", async () => {
    const h = strip([theirs]);
    const row = within(rowOf(/order the grilles/));
    expect(row.getAllByRole("button").map((b) => b.textContent)).toEqual(["Reply", "Make it a task", "Not work"]);
    await userEvent.click(row.getByRole("button", { name: "Reply" }));
    expect(h.onReply).toHaveBeenCalledWith(ASK);
  });

  it("offers no Reply to someone who can't send, or where the deployment sends no notes", () => {
    strip([theirs], { canReply: false });
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });

  it("offers none of anybody else's", () => {
    strip([{ ...theirs, you: false } as AttentionItem]);
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });
});

describe("one of HeyTiff's own replies, as a mention", () => {
  it("(F) is never made a task; Not work puts aside its ROW, so it stays aside when it goes under a new uuid", async () => {
    const h = strip([ours()]);
    const row = within(rowOf(/on my way/));
    expect(row.queryByRole("button", { name: "Make it a task" })).toBeNull();
    await userEvent.click(row.getByRole("button", { name: "Not work" }));
    expect(h.onDismissNote).toHaveBeenCalledWith("r1");
  });

  it("offers Reply only once it is in ServiceM8, and nothing at all to someone it doesn't name", () => {
    strip([ours({ noteUuid: null })]);
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.getByRole("button", { name: "Not work" })).toBeInTheDocument();
  });

  it("has no doors for someone it doesn't name", () => {
    strip([ours({ you: false })]);
    expect(within(rowOf(/on my way/)).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("a flag", () => {
  it("offers Mark done, or Mark done again, when its line does and notes are offered", async () => {
    const h = strip([flag], { flags: { [FLAG]: { key: "flag.flagged", text: NOTE_WORDS.flag.flagged, tone: "warn", acts: ["mark_done"] } } });
    await userEvent.click(screen.getByRole("button", { name: NOTE_WORDS.door.markDone }));
    expect(h.onMarkDone).toHaveBeenCalledWith(FLAG);
  });

  it("Mark done again after somebody cleared ours", () => {
    strip([flag], { flags: { [FLAG]: { key: "flag.flagged", text: NOTE_WORDS.flag.flagged, tone: "warn", acts: ["mark_done_again"] } } });
    expect(screen.getByRole("button", { name: NOTE_WORDS.door.markDoneAgain })).toBeInTheDocument();
  });

  it("offers nothing new where notes aren't offered, or the deployment sends none", () => {
    strip([flag], { canMark: false, flags: { [FLAG]: { key: "flag.flagged", text: NOTE_WORDS.flag.flagged, tone: "warn", acts: ["mark_done"] } } });
    expect(screen.queryByRole("button", { name: NOTE_WORDS.door.markDone })).toBeNull();
  });
});

describe("where the deployment sends no notes", () => {
  it("is today's strip", () => {
    const { onDismissNote } = strip([{ ...theirs, you: undefined, origin: undefined, rowId: undefined } as AttentionItem, flag], null);
    expect(within(rowOf(/order the grilles/)).getAllByRole("button").map((b) => b.textContent)).toEqual(["Make it a task", "Not work"]);
    expect(within(rowOf(/call the builder/)).getAllByRole("button").map((b) => b.textContent)).toEqual(["Open in the diary›"]);
    expect(onDismissNote).not.toHaveBeenCalled();
  });
});
