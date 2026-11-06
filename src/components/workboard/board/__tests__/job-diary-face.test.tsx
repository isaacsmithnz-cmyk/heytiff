/* A NOTE TALKS BACK (two-way phase 2, PR B) — and, where the deployment
   sends no notes, is exactly what it was.

   The doors only draw: every line's words and every door come from the
   state the server sent (noteState, flagState), and this suite holds that
   the doors are the right ones for whoever is looking, and that the
   question "Is <name> you?" stands where a send would. The Diary face they
   were drawn in is gone; the job's conversation draws them now, so each
   note here is drawn as it does, its words and then NoteDoors. */

import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlsoSm8, NoteDoors, withMentions, type Doors, type NoteEntry } from "../job-diary-face";
import { noteState, NOTE_WORDS, type FlagState, type NoteState, type QueueRowIn } from "@/lib/integrations/sm8-note-plan";
import type { NoteSender } from "@/lib/integrations/links";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: jest.fn() }));
const openRecordByName = jest.fn(async (_words: string) => null as { href: string; label: string; line: string } | null);
jest.mock("@/app/actions/tiff-open", () => ({ openRecordByName: (w: string) => openRecordByName(w) }));
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: jest.fn(),
  dismissNote: jest.fn(),
}));

const ASK = "7e7e7e7e-0000-4000-8000-00000000a5c1";
const FLAG = "7e7e7e7e-0000-4000-8000-00000000f1a9";
const ISAAC_SM8 = "5a1b2c3d-0000-4000-8000-00000000aaaa";
const LYLE_SM8 = "5a1b2c3d-0000-4000-8000-00000000bbbb";
const SENT_AS = "9a9a9a9a-0000-4000-8000-000000000001";

type Note = NoteEntry;

const theirs = (over: Partial<Note> = {}): Note => ({
  kind: "note",
  key: `note:${ASK}`,
  day: "2026-09-20",
  at: "2026-09-20 09:00:00",
  author: "Lyle Irving",
  text: "@isaacsmith can you order the grilles",
  actionRequired: false,
  fromClaim: null,
  origin: "servicem8",
  id: null,
  sm8Uuid: ASK,
  authorSm8Uuid: LYLE_SM8,
  editedAt: "2026-09-20 09:00:00",
  ...over,
});

const ours = (over: Partial<Note> = {}): Note => ({
  kind: "note",
  key: "ournote:r1",
  day: "2026-09-20",
  at: "2026-09-20 10:00:00",
  author: "Isaac Smith",
  text: "@lyleirving on my way",
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

/** One note as the conversation draws it: its words, then its doors, with
    the reply box's open or shut held the way a feed holds it. */
function Drawn({ entry, doors, open }: { entry: Note; doors: Doors; open: boolean }) {
  const [replyOpen, setReplyOpen] = useState(open);
  return (
    <div data-note={entry.key}>
      <p data-words>{withMentions(entry.text)}</p>
      <NoteDoors entry={entry} doors={doors} replyOpen={replyOpen} onReplyOpen={setReplyOpen} />
    </div>
  );
}

/** `open` is the note (by key) whose reply box starts open. */
function draw(entries: Note[], props: Partial<Doors> & { open?: string } = {}) {
  const handlers = {
    onReply: jest.fn(async () => null as string | null),
    onSendCopy: jest.fn(),
    onTakeBack: jest.fn(),
    onMarkDone: jest.fn(),
    onUndoDone: jest.fn(),
    onConfirm: jest.fn(async () => null as string | null),
    onRemoveNote: jest.fn(),
  };
  const { open, ...over } = props;
  const doors: Doors = { sender: ready, notesSm8: offered, flags: {}, flagsBusy: new Set(), ...handlers, ...over };
  const view = render(
    <>
      {entries.map((e) => (
        <Drawn key={e.key} entry={e} doors={doors} open={open === e.key} />
      ))}
    </>
  );
  return { ...view, ...handlers };
}

/** The note whose words start so — mentions are spans of their own, so the
    words are read whole. */
const evOf = (start: string) => {
  const note = [...document.querySelectorAll<HTMLElement>("[data-note]")].find((n) =>
    n.querySelector("[data-words]")?.textContent?.startsWith(start)
  );
  if (!note) throw new Error(`no note starting "${start}"`);
  return note;
};

describe("where the deployment sends no notes", () => {
  it("(F) is what it was: Remove on ours, nothing on theirs, and no Reply or line", async () => {
    const view = draw(
      [
        theirs({ actionRequired: true }),
        ours({ key: "ournote:plain", id: "plain", text: "Drain kit still to go on", replyTo: undefined, state: undefined, hasCreate: undefined, mine: undefined, removed: undefined, sm8Uuid: undefined }),
      ],
      { sender: null, notesSm8: null }
    );
    expect(within(evOf("@isaacsmith")).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByText(NOTE_WORDS.door.sendToSm8)).toBeNull();
    // Remove sits straight under the words, as it always did
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove.parentElement).toBe(evOf("Drain kit still to go on"));
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

  it("a reply of ours that went, and mentions you, can be answered too — not by its author", () => {
    const lyle: NoteSender = { state: "ready", staffUuid: LYLE_SM8, remoteId: LYLE_SM8, sm8Name: "Lyle Irving", handle: "lyleirving" };
    const sent = ours({ sm8Uuid: SENT_AS, mine: false, state: lineFor(create({ status: "sent" }), { viewerIsSender: false }) });
    const { unmount } = draw([sent], { sender: lyle });
    expect(within(evOf("@lyleirving")).getByRole("button", { name: "Reply" })).toBeInTheDocument();
    unmount();
    // not yet in ServiceM8: nothing to answer
    draw([{ ...sent, sm8Uuid: null }], { sender: lyle });
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });

  it("(F) one of ours its author took back is never answered, while it is still on its way out of ServiceM8", () => {
    const lyle: NoteSender = { state: "ready", staffUuid: LYLE_SM8, remoteId: LYLE_SM8, sm8Name: "Lyle Irving", handle: "lyleirving" };
    const takingOut: NoteState = { key: "line.takingOut", text: NOTE_WORDS.line.takingOut, tone: null, acts: [] };
    const stillIn: NoteState = { key: "line.stillIn", text: "Still in ServiceM8. Sending notes is switched off.", tone: "bad", acts: [] };
    for (const state of [takingOut, stillIn]) {
      /* its create went, so it still carries the uuid its copy went under */
      const { unmount } = draw([ours({ sm8Uuid: SENT_AS, mine: false, removed: true, state })], { sender: lyle });
      expect(screen.getByText(state.text!)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
      unmount();
    }
    // nor with its box asked open, as the strip's Reply asks
    draw([ours({ sm8Uuid: SENT_AS, mine: false, removed: true, state: takingOut })], { sender: lyle, open: "ournote:r1" });
    expect(screen.queryByPlaceholderText(NOTE_WORDS.door.replyPlaceholder)).toBeNull();
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
    expect(within(evOf("@lyleirving")).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByText(state.text!)).toBeInTheDocument();
    unmount();

    const entry = draw([ours({ key: "ournote:d1", id: "d1", text: "Drain kit still to go on", replyTo: null, state })]);
    expect(within(evOf("Drain kit still to go on")).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    entry.unmount();

    draw([ours({ mine: false, state: { ...state, acts: [] } })]);
    expect(within(evOf("@lyleirving")).queryAllByRole("button")).toHaveLength(0);
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
    expect(within(evOf("@lyleirving")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Undo"]);
  });

  it("an unsure one says look first, with Send again and Undo; a cancelled or refused one, Not sent, with both", () => {
    const { unmount } = draw([ours({ state: lineFor(create({ status: "failed", maybe_landed: true })) })]);
    expect(screen.getByText(NOTE_WORDS.line.unsure)).toBeInTheDocument();
    expect(within(evOf("@lyleirving")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Send again", "Undo"]);
    unmount();
    draw([ours({ state: lineFor(null, { refusal: "unlinked" }) })]);
    expect(screen.getByText(`Not sent to ServiceM8. ${NOTE_WORDS.press.unlinked}`)).toBeInTheDocument();
    expect(within(evOf("@lyleirving")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Send again", "Undo"]);
  });

  it("(F) (verifier r3 3) a saved row holding the question asks it beside Undo; Yes answers for that row, Not me for nobody", async () => {
    const confirm: NoteSender = { state: "confirm", remoteId: ISAAC_SM8, sm8Name: "Isaac Smith", handle: "isaacsmith" };
    const view = draw([ours({ state: lineFor(null, { refusal: "confirm" }) })], { sender: confirm });
    const ev = evOf("@lyleirving");
    expect(within(ev).getAllByText("Is Isaac Smith you?").length).toBeGreaterThan(0);
    expect(within(ev).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    await userEvent.click(within(ev).getByRole("button", { name: NOTE_WORDS.door.yes }));
    expect(view.onConfirm).toHaveBeenLastCalledWith("yes", "r1");
    await userEvent.click(within(ev).getByRole("button", { name: NOTE_WORDS.door.notMe }));
    expect(view.onConfirm).toHaveBeenLastCalledWith("no", undefined);
  });

  it("a row that asked the question offers Send again once you've answered it elsewhere", async () => {
    const view = draw([ours({ state: lineFor(null, { refusal: "confirm" }) })]);
    expect(within(evOf("@lyleirving")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Send again", "Undo"]);
    await userEvent.click(screen.getByRole("button", { name: NOTE_WORDS.door.sendAgain }));
    expect(view.onSendCopy).toHaveBeenCalledWith("r1");
  });

  it("your own entry that stayed in HeyTiff offers Send to ServiceM8 beside Remove; someone else's only Remove", async () => {
    const plain = ours({ key: "ournote:d1", id: "d1", text: "Drain kit still to go on", replyTo: null, hasCreate: false, state: null });
    const view = draw([plain]);
    await userEvent.click(screen.getByRole("button", { name: NOTE_WORDS.door.sendToSm8 }));
    expect(view.onSendCopy).toHaveBeenCalledWith("d1");
    view.unmount();
    draw([{ ...plain, mine: false }]);
    expect(screen.queryByRole("button", { name: NOTE_WORDS.door.sendToSm8 })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
});

describe("a flagged note", () => {
  const flagged = theirs({ key: `note:${FLAG}`, sm8Uuid: FLAG, text: "call the builder", actionRequired: true });

  it("Mark done goes with the edit time it was read at", async () => {
    const view = draw([flagged], { flags: { [FLAG]: { key: "flag.flagged", text: NOTE_WORDS.flag.flagged, tone: "warn", acts: ["mark_done"] } } });
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
  });

  it("(F) while a press on the flag is out, its doors wait for the answer", async () => {
    const acts: [FlagState["acts"][number], string][] = [
      ["mark_done", NOTE_WORDS.door.markDone],
      ["mark_done_again", NOTE_WORDS.door.markDoneAgain],
      ["unmark", NOTE_WORDS.door.undo],
    ];
    for (const [act, door] of acts) {
      const flags = { [FLAG]: { key: "flag.flagged", text: NOTE_WORDS.flag.flagged, tone: "warn", acts: [act] } } as Record<string, FlagState>;
      const view = draw([flagged], { flags, flagsBusy: new Set([FLAG]) });
      const button = screen.getByRole("button", { name: door });
      expect(button).toBeDisabled();
      await userEvent.click(button);
      expect(view.onMarkDone).not.toHaveBeenCalled();
      expect(view.onUndoDone).not.toHaveBeenCalled();
      view.unmount();
      // another flag's press leaves this one's door open
      const other = draw([flagged], { flags, flagsBusy: new Set(["7e7e7e7e-0000-4000-8000-0000000000ee"]) });
      expect(screen.getByRole("button", { name: door })).toBeEnabled();
      other.unmount();
    }
  });
});

describe("Also in ServiceM8", () => {
  it("ticked, it hands the tick on", async () => {
    const onTick = jest.fn();
    render(<AlsoSm8 also={false} onTick={onTick} sender={ready} notesSm8={offered} />);
    await userEvent.click(screen.getByRole("checkbox", { name: NOTE_WORDS.door.alsoInSm8 }));
    expect(onTick).toHaveBeenCalledWith(true);
  });

  it("while you can't send, the box is off and says why — with Link people for an owner", () => {
    render(<AlsoSm8 also={false} onTick={jest.fn()} sender={{ state: "unlinked", noCard: false }} notesSm8={{ ...offered, owner: true }} />);
    expect(screen.getByRole("checkbox", { name: NOTE_WORDS.door.alsoInSm8 })).toBeDisabled();
    expect(screen.getByText(NOTE_WORDS.press.unlinked)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: NOTE_WORDS.door.linkPeople })).toHaveAttribute(
      "href",
      "/dashboard/admin/integrations/servicem8"
    );
  });
});

describe("withMentions", () => {
  it("wears a mention as a callout, and never an @ inside an email address", () => {
    render(<p>{withMentions("@lyleirving sent to josh@lsdb.com.au")}</p>);
    expect([...document.querySelectorAll(".wb2-mention")].map((m) => m.textContent)).toEqual(["@lyleirving"]);
    expect(screen.getByText(/sent to josh@lsdb\.com\.au/)).toBeInTheDocument();
  });
});
