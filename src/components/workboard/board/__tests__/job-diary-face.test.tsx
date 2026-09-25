/* THE DIARY TALKS BACK (two-way phase 2, PR B) — and, where the deployment
   sends no notes, is exactly what it was.

   The face only draws: every line's words and every door come from the
   state the server sent (noteState, flagState), and this suite holds that
   the doors are the right ones for whoever is looking, that a reply sits
   under what it answers (and is never lost when that isn't drawn), and that
   the question "Is <name> you?" stands where a send would. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobDiaryFace } from "../job-diary-face";
import type { StoryEntry } from "@/lib/workboard/job-story";
import { noteState, NOTE_WORDS, type NoteState, type QueueRowIn } from "@/lib/integrations/sm8-note-plan";
import type { NoteSender } from "@/lib/integrations/links";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: jest.fn() }));
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: jest.fn(),
  applyNote: jest.fn(),
  dismissNote: jest.fn(),
  keepNoteOnJob: jest.fn(),
  keepNoteForMe: jest.fn(),
  answerClarify: jest.fn(),
}));

const ASK = "7e7e7e7e-0000-4000-8000-00000000a5c1";
const FLAG = "7e7e7e7e-0000-4000-8000-00000000f1a9";
const ISAAC_SM8 = "5a1b2c3d-0000-4000-8000-00000000aaaa";
const LUKE_SM8 = "5a1b2c3d-0000-4000-8000-00000000bbbb";
const SENT_AS = "9a9a9a9a-0000-4000-8000-000000000001";

type Note = Extract<StoryEntry, { kind: "note" }>;

const theirs = (over: Partial<Note> = {}): Note => ({
  kind: "note",
  key: `note:${ASK}`,
  day: "2026-09-20",
  at: "2026-09-20 09:00:00",
  author: "Luke Ingold",
  text: "@isaacsmith can you order the grilles",
  actionRequired: false,
  fromClaim: null,
  origin: "servicem8",
  id: null,
  sm8Uuid: ASK,
  authorSm8Uuid: LUKE_SM8,
  editedAt: "2026-09-20 09:00:00",
  ...over,
});

const ours = (over: Partial<Note> = {}): Note => ({
  kind: "note",
  key: "ournote:r1",
  day: "2026-09-20",
  at: "2026-09-20 10:00:00",
  author: "Isaac Smith",
  text: "@lukeingold on my way",
  actionRequired: false,
  fromClaim: null,
  origin: "heytiff",
  id: "r1",
  sm8Uuid: null,
  replyTo: ASK,
  state: null,
  hasCreate: true,
  mine: true,
  removed: false,
  ...over,
});

const ready: NoteSender = { state: "ready", staffUuid: ISAAC_SM8, remoteId: ISAAC_SM8, sm8Name: "Isaac Smith", handle: "isaacsmith" };
const offered = { trial: false, hold: null, owner: false } as const;

/** A create row as the line reads it. */
const create = (over: Partial<QueueRowIn> = {}): QueueRowIn => ({
  id: "c1",
  status: "queued",
  remote_uuid: SENT_AS,
  lease_until: null,
  maybe_landed: false,
  verify_uuids: [],
  taken_back_at: null,
  requested_by: "staff-isaac",
  last_error: null,
  attempts: 0,
  ...over,
});

const lineFor = (c: QueueRowIn | null, opts: { refusal?: "confirm" | "unlinked" | null; hold?: "paused" | null; viewerIsSender?: boolean } = {}): NoteState =>
  noteState({
    row: { removed: false, refusal: opts.refusal ?? null },
    create: c,
    takeBack: null,
    hold: opts.hold ?? null,
    offered: true,
    viewerIsSender: opts.viewerIsSender ?? true,
    senderName: "Isaac Smith",
    sm8Name: "Isaac Smith",
  });

function draw(entries: StoryEntry[], props: Partial<React.ComponentProps<typeof JobDiaryFace>> = {}) {
  const handlers = {
    onReply: jest.fn(async () => null as string | null),
    onSendCopy: jest.fn(),
    onTakeBack: jest.fn(),
    onMarkDone: jest.fn(),
    onUndoDone: jest.fn(),
    onConfirm: jest.fn(async () => null as string | null),
    onRemoveNote: jest.fn(),
    onWrite: jest.fn(),
  };
  const view = render(
    <JobDiaryFace
      entries={entries}
      loading={false}
      moneyVisible={false}
      onOpenClaim={jest.fn()}
      onPhotos={jest.fn()}
      sender={ready}
      notesSm8={offered}
      {...handlers}
      {...props}
    />
  );
  return { ...view, ...handlers };
}

/** The note cards (their words, mentions and all) in a part of the page. */
const cards = (within: ParentNode = document) => [...within.querySelectorAll(".wb2-evcard")] as HTMLElement[];
/** The entry (its frame) whose words start so — mentions are spans of their
    own, so the words are read whole. */
const evOf = (start: string) => {
  const card = cards().find((c) => c.textContent?.startsWith(start));
  if (!card) throw new Error(`no note starting "${start}"`);
  return card.closest(".wb2-ev") as HTMLElement;
};

beforeEach(() => {
  localStorage.clear();
});

describe("where the deployment sends no notes", () => {
  it("(F) is the diary it was: Action required, In HeyTiff and Remove, and no Reply, tick box or line", async () => {
    const view = draw(
      [
        theirs({ actionRequired: true }),
        ours({ key: "ournote:plain", id: "plain", text: "Drain kit still to go on", replyTo: undefined, state: undefined, hasCreate: undefined, mine: undefined, removed: undefined, sm8Uuid: undefined }),
      ],
      { sender: undefined, notesSm8: undefined, flags: undefined }
    );
    expect(screen.getByText("Action required")).toBeInTheDocument();
    expect(screen.getByText("In HeyTiff")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(NOTE_WORDS.door.sendToSm8)).toBeNull();
    // Remove sits straight under the words, as it always did
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove.parentElement).toHaveClass("wb2-evb");
    await userEvent.click(remove);
    expect(view.onRemoveNote).toHaveBeenCalledWith("plain");
  });
});

describe("Reply", () => {
  it("(F) shows only on a mention of you — not on your own note, not for someone not linked", () => {
    const { unmount } = draw([theirs(), theirs({ key: "note:other", sm8Uuid: "7e7e7e7e-0000-4000-8000-00000000a5c9", text: "Filters are in the van" })]);
    expect(screen.getAllByRole("button", { name: "Reply" })).toHaveLength(1);
    expect(within(evOf("Filters are in the van")).queryByRole("button", { name: "Reply" })).toBeNull();
    unmount();

    // your own note that mentions you
    const own = draw([theirs({ authorSm8Uuid: ISAAC_SM8 })]);
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    own.unmount();

    // not linked: no Reply anywhere
    draw([theirs()], { sender: { state: "unlinked", noCard: false } });
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });

  it("is not offered where notes aren't (the owner's Notes Off)", () => {
    draw([theirs()], { notesSm8: null });
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });

  it("opens a box with no Tiff offer, and Send reply hands over the words and the box's own id", async () => {
    const view = draw([theirs()]);
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));
    await userEvent.type(screen.getByPlaceholderText(NOTE_WORDS.door.replyPlaceholder), "on my way");
    await userEvent.click(screen.getByRole("button", { name: NOTE_WORDS.door.sendReply }));
    expect(view.onReply).toHaveBeenCalledWith({
      sourceNoteUuid: ASK,
      words: "on my way",
      spoken: false,
      composeId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    // saved: the box closes
    expect(screen.queryByPlaceholderText(NOTE_WORDS.door.replyPlaceholder)).toBeNull();
  });

  it("a refusal keeps the words in the box and says why", async () => {
    const view = draw([theirs()]);
    view.onReply.mockResolvedValueOnce(NOTE_WORDS.press.jobGone);
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));
    await userEvent.type(screen.getByPlaceholderText(NOTE_WORDS.door.replyPlaceholder), "on my way");
    await userEvent.click(screen.getByRole("button", { name: NOTE_WORDS.door.sendReply }));
    expect(await screen.findByText(NOTE_WORDS.press.jobGone)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(NOTE_WORDS.door.replyPlaceholder)).toHaveValue("on my way");
  });

  it("(F) while you haven't said who you are, the question stands where Send reply would; Yes sends nothing", async () => {
    const view = draw([theirs()], { sender: { state: "confirm", remoteId: ISAAC_SM8, sm8Name: "Isaac Smith", handle: "isaacsmith" } });
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.queryByRole("button", { name: NOTE_WORDS.door.sendReply })).toBeNull();
    expect(screen.getAllByText("Is Isaac Smith you?").length).toBeGreaterThan(0);
    const box = screen.getByPlaceholderText(NOTE_WORDS.door.replyPlaceholder).closest(".wb2-evreply") as HTMLElement;
    await userEvent.click(within(box).getByRole("button", { name: NOTE_WORDS.door.yes }));
    expect(view.onConfirm).toHaveBeenCalledWith("yes", undefined);
    expect(view.onReply).not.toHaveBeenCalled();
  });

  it("opens where the strip's Reply sent the reader", () => {
    draw([theirs()], { replyFor: ASK });
    expect(screen.getByPlaceholderText(NOTE_WORDS.door.replyPlaceholder)).toBeInTheDocument();
  });

  it("a reply of ours that went, and mentions you, can be answered too — not by its author", () => {
    const luke: NoteSender = { state: "ready", staffUuid: LUKE_SM8, remoteId: LUKE_SM8, sm8Name: "Luke Ingold", handle: "lukeingold" };
    const sent = ours({ sm8Uuid: SENT_AS, mine: false, state: lineFor(create({ status: "sent" }), { viewerIsSender: false }) });
    const { unmount } = draw([sent], { sender: luke });
    expect(within(evOf("@lukeingold")).getByRole("button", { name: "Reply" })).toBeInTheDocument();
    unmount();
    // not yet in ServiceM8: nothing to answer
    draw([{ ...sent, sm8Uuid: null }], { sender: luke });
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });
});

describe("our own notes' lines and doors", () => {
  const cases: [string, NoteState][] = [
    ["waiting", lineFor(create())],
    ["held", lineFor(create(), { hold: "paused" })],
    ["retrying", lineFor(create({ attempts: 2 }))],
    ["sending", lineFor(create({ status: "sending", lease_until: new Date(Date.now() + 60_000).toISOString() }))],
    ["refused", lineFor(null, { refusal: "unlinked" })],
    ["failed", lineFor(create({ status: "failed", last_error: NOTE_WORDS.row.noteRefused }))],
    ["cancelled", lineFor(create({ status: "cancelled", last_error: NOTE_WORDS.row.notesSwitchedOff }))],
    ["removed there", lineFor(create({ status: "cancelled", last_error: NOTE_WORDS.row.noteGone }))],
    ["sent", lineFor(create({ status: "sent" }))],
    ["unsure", lineFor(create({ status: "failed", maybe_landed: true, last_error: NOTE_WORDS.row.noteUnsure }))],
    ["trial", lineFor(create({ status: "trial" }))],
  ];

  it.each(cases)("(F) (verifier r3 1) %s: your reply offers Undo, your diary entry Remove, and nobody else's anything", (_name, state) => {
    const { unmount } = draw([ours({ state })]);
    expect(within(evOf("@lukeingold")).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByText(state.text!)).toBeInTheDocument();
    expect(screen.queryByText("In HeyTiff")).toBeNull();
    unmount();

    const entry = draw([ours({ key: "ournote:d1", id: "d1", text: "Drain kit still to go on", replyTo: null, state })]);
    expect(within(evOf("Drain kit still to go on")).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    entry.unmount();

    draw([ours({ mine: false, state: { ...state, acts: [] } })]);
    expect(within(evOf("@lukeingold")).queryAllByRole("button")).toHaveLength(0);
  });

  it("a failed reply says why, with Send again and Undo", async () => {
    const view = draw([ours({ state: lineFor(create({ status: "failed", last_error: NOTE_WORDS.row.noteRefused })) })]);
    expect(screen.getByText(`Not sent to ServiceM8. ${NOTE_WORDS.row.noteRefused}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: NOTE_WORDS.door.sendAgain }));
    expect(view.onSendCopy).toHaveBeenCalledWith("r1");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(view.onTakeBack).toHaveBeenCalledWith("r1");
  });

  it("one removed in ServiceM8 reads so, with only Undo (Remove on an entry)", () => {
    draw([ours({ state: lineFor(create({ status: "cancelled", last_error: NOTE_WORDS.row.noteGone })) })]);
    expect(screen.getByText(NOTE_WORDS.line.removedThere)).toBeInTheDocument();
    expect(within(evOf("@lukeingold")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Undo"]);
  });

  it("an unsure one says look first, with Send again and Undo; a cancelled or refused one, Not sent, with both", () => {
    const { unmount } = draw([ours({ state: lineFor(create({ status: "failed", maybe_landed: true })) })]);
    expect(screen.getByText(NOTE_WORDS.line.unsure)).toBeInTheDocument();
    expect(within(evOf("@lukeingold")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Send again", "Undo"]);
    unmount();
    draw([ours({ state: lineFor(null, { refusal: "unlinked" }) })]);
    expect(screen.getByText(`Not sent to ServiceM8. ${NOTE_WORDS.press.unlinked}`)).toBeInTheDocument();
    expect(within(evOf("@lukeingold")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Send again", "Undo"]);
  });

  it("(F) (verifier r3 3) a saved row holding the question asks it beside Undo; Yes answers for that row, Not me for nobody", async () => {
    const confirm: NoteSender = { state: "confirm", remoteId: ISAAC_SM8, sm8Name: "Isaac Smith", handle: "isaacsmith" };
    const view = draw([ours({ state: lineFor(null, { refusal: "confirm" }) })], { sender: confirm });
    const ev = evOf("@lukeingold");
    expect(within(ev).getAllByText("Is Isaac Smith you?").length).toBeGreaterThan(0);
    expect(within(ev).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    await userEvent.click(within(ev).getByRole("button", { name: NOTE_WORDS.door.yes }));
    expect(view.onConfirm).toHaveBeenLastCalledWith("yes", "r1");
    await userEvent.click(within(ev).getByRole("button", { name: NOTE_WORDS.door.notMe }));
    expect(view.onConfirm).toHaveBeenLastCalledWith("no", undefined);
  });

  it("your own entry that stayed in HeyTiff offers Send to ServiceM8 beside Remove; someone else's only Remove", async () => {
    const plain = ours({ key: "ournote:d1", id: "d1", text: "Drain kit still to go on", replyTo: null, hasCreate: false, state: null });
    const view = draw([plain]);
    await userEvent.click(screen.getByRole("button", { name: NOTE_WORDS.door.sendToSm8 }));
    expect(view.onSendCopy).toHaveBeenCalledWith("d1");
    expect(screen.getByText("In HeyTiff")).toBeInTheDocument();
    view.unmount();
    draw([{ ...plain, mine: false }]);
    expect(screen.queryByRole("button", { name: NOTE_WORDS.door.sendToSm8 })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
});

describe("where a reply is drawn (verifier 14)", () => {
  it("(F) under the note it answers; a reply to one of ours under ours; one whose source isn't drawn in the day — never missing", () => {
    const isaacReply = ours({ sm8Uuid: SENT_AS, state: lineFor(create({ status: "sent" })) });
    const lukeReply = ours({ key: "ournote:r2", id: "r2", text: "@isaacsmith cheers", replyTo: SENT_AS, author: "Luke Ingold", at: "2026-09-20 11:00:00", mine: false });
    const orphan = ours({ key: "ournote:r3", id: "r3", text: "@lukeingold done that", replyTo: "7e7e7e7e-0000-4000-8000-0000000000ff", at: "2026-09-20 12:00:00" });
    draw([orphan, lukeReply, isaacReply, theirs()]);
    const ask = evOf("@isaacsmith can you order the grilles");
    const thread = ask.querySelector(".wb2-evthread") as HTMLElement;
    expect(cards(thread).map((c) => c.textContent)).toContain("@lukeingold on my way");
    // Luke's reply to Isaac's reply sits under Isaac's
    const isaac = evOf("@lukeingold on my way");
    expect(cards(isaac.querySelector(".wb2-evthread") as HTMLElement).map((c) => c.textContent)).toEqual(["@isaacsmith cheers"]);
    // the one whose note isn't drawn stands in the day, on its own
    const alone = evOf("@lukeingold done that");
    expect(alone.closest(".wb2-evthread")).toBeNull();
    // all four are there, each once
    expect(cards().map((c) => c.textContent).sort()).toEqual(
      ["@isaacsmith can you order the grilles", "@lukeingold on my way", "@isaacsmith cheers", "@lukeingold done that"].sort()
    );
  });
});

describe("a flagged note", () => {
  const flagged = theirs({ key: `note:${FLAG}`, sm8Uuid: FLAG, text: "call the builder", actionRequired: true });

  it("says where it stands in place of Action required, and Mark done goes with the edit time it was read at", async () => {
    const view = draw([flagged], { flags: { [FLAG]: { key: "flag.flagged", text: NOTE_WORDS.flag.flagged, tone: "warn", acts: ["mark_done"] } } });
    expect(screen.queryByText("Action required")).toBeNull();
    expect(screen.getByText(NOTE_WORDS.flag.flagged)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: NOTE_WORDS.door.markDone }));
    expect(view.onMarkDone).toHaveBeenCalledWith(FLAG, "2026-09-20 09:00:00");
  });

  it("Mark done again once somebody cleared ours; Undo only to the one who marked it, and no Mark done where notes aren't offered", async () => {
    const view = draw([flagged], { flags: { [FLAG]: { key: "flag.flagged", text: NOTE_WORDS.flag.flagged, tone: "warn", acts: ["mark_done_again"] } } });
    expect(screen.getByRole("button", { name: NOTE_WORDS.door.markDoneAgain })).toBeInTheDocument();
    view.unmount();
    const undo = draw([flagged], { flags: { [FLAG]: { key: "flag.marking", text: NOTE_WORDS.flag.marking, tone: null, acts: ["unmark"] } } });
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo.onUndoDone).toHaveBeenCalledWith(FLAG);
    undo.unmount();
    draw([flagged], { notesSm8: null, flags: { [FLAG]: { key: "flag.flagged", text: NOTE_WORDS.flag.flagged, tone: "warn", acts: ["mark_done"] } } });
    expect(screen.queryByRole("button", { name: NOTE_WORDS.door.markDone })).toBeNull();
    expect(screen.getByText(NOTE_WORDS.flag.flagged)).toBeInTheDocument();
  });
});

describe("the pen", () => {
  it("(F) ticked, it writes with Also in ServiceM8 and the pen's own id; the same words twice are the same id", async () => {
    const view = draw([]);
    /* the save hasn't landed yet */
    view.onWrite.mockImplementation(() => new Promise(() => {}));
    await userEvent.click(screen.getByRole("checkbox", { name: NOTE_WORDS.door.alsoInSm8 }));
    const box = screen.getByLabelText("a note on this job");
    await userEvent.type(box, "Drain kit still to go on{Enter}");
    expect(view.onWrite).toHaveBeenCalledWith("Drain kit still to go on", true, expect.stringMatching(/^[0-9a-f-]{36}$/));
    const first = view.onWrite.mock.calls[0][2];
    await userEvent.type(box, "Drain kit still to go on{Enter}");
    // the first save hasn't landed: the same words are the same entry
    expect(view.onWrite.mock.calls[1][2]).toBe(first);
    // different words are a different note
    await userEvent.type(box, "Coil pricing{Enter}");
    expect(view.onWrite.mock.calls[2][2]).not.toBe(first);
    // and the tick is remembered
    expect(localStorage.getItem("heytiff.diary.alsoSm8")).toBe("1");
  });

  it("unticked, nothing goes to ServiceM8", async () => {
    const view = draw([]);
    await userEvent.type(screen.getByLabelText("a note on this job"), "Drain kit{Enter}");
    expect(view.onWrite).toHaveBeenCalledWith("Drain kit", false, expect.any(String));
  });

  it("while you can't send, the box is off and says why — with Link people for an owner", () => {
    draw([], { sender: { state: "unlinked", noCard: false }, notesSm8: { ...offered, owner: true } });
    expect(screen.getByRole("checkbox", { name: NOTE_WORDS.door.alsoInSm8 })).toBeDisabled();
    expect(screen.getByText(NOTE_WORDS.press.unlinked)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: NOTE_WORDS.door.linkPeople })).toHaveAttribute(
      "href",
      "/dashboard/admin/integrations/servicem8"
    );
  });
});
