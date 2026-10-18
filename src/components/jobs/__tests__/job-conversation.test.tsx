/* A JOB'S OVERVIEW IS ITS CONVERSATION (v2, step 6, the board JC-1).

   The conversation draws what it is handed: the diary's entries, what Tiff
   said back to each note and made from it, and the box's own conversation
   (use-conversation, the Tiff modal's, faked here so the suite holds the
   drawing and the presses, not the router). The router's half has its own
   suites. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Conversation, ModalTurn } from "@/components/tiff/modal/use-conversation";
import type { StoryEntry } from "@/lib/workboard/job-story";
import type { JobNoteTalk } from "@/lib/jobs/job-conversation";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: jest.fn() }));
jest.mock("@/app/actions/tiff-open", () => ({ openRecordByName: jest.fn(async () => null) }));
jest.mock("@/app/actions/workboard-notes", () => ({ routeNote: jest.fn(), dismissNote: jest.fn() }));

import { JobConversation, type ConversationDiary } from "../job-conversation";

type Note = Extract<StoryEntry, { kind: "note" }>;

const note = (over: Partial<Note> = {}): Note => ({
  kind: "note",
  key: "note:a",
  day: "2026-10-13",
  at: "2026-10-13 10:02:00",
  author: "Lyle Irving",
  text: "Study head mounted and levelled.",
  actionRequired: false,
  fromClaim: null,
  origin: "servicem8",
  id: null,
  ...over,
});

const talk = (over: Partial<JobNoteTalk> = {}): JobNoteTalk => ({
  id: "n1",
  authorId: "s-isaac",
  authorName: "Isaac Smith",
  said: "Get Lyle to order the grilles before lunch",
  stamp: "2026-10-13 10:05",
  day: "2026-10-13",
  spoken: false,
  replies: [{ who: "tiff", text: "Done. A task for Lyle." }],
  made: [{ key: "task:t1", kind: "task", name: "Order the grilles", line: "Lyle, today by 12:30 pm" }],
  undo: true,
  undone: false,
  ...over,
});

const diary = (over: Partial<ConversationDiary> = {}): ConversationDiary => ({
  onOpenClaim: jest.fn(),
  onPhotos: jest.fn(),
  onWrite: jest.fn(async () => undefined),
  onRemoveNote: jest.fn(),
  sender: null,
  notesSm8: null,
  flags: {},
  flagsBusy: new Set(),
  ...over,
});

const convo = (over: Partial<Conversation> = {}): Conversation =>
  ({
    stage: "editing",
    turns: [] as ModalTurn[],
    draft: "",
    setDraft: jest.fn(),
    send: jest.fn(),
    markSpoken: jest.fn(),
    answer: jest.fn(),
    undo: jest.fn(async () => undefined),
    questionOpen: false,
    ...over,
  }) as unknown as Conversation;

const draw = (p: {
  story?: StoryEntry[];
  talks?: JobNoteTalk[];
  c?: Conversation;
  d?: ConversationDiary;
  onUndoTalk?: (id: string) => Promise<unknown>;
}) =>
  render(
    <div className="fg">
      <JobConversation
        story={p.story ?? []}
        talks={p.talks ?? []}
        today="2026-10-13"
        loading={false}
        moneyVisible
        diary={p.d ?? diary()}
        convo={p.c ?? convo()}
        canSend
        viewerName="Isaac Smith"
        voiceEnabled={false}
        onUndoTalk={p.onUndoTalk}
      />
    </div>,
  );

it("reads oldest first, a line between the days, each message with its person and time", () => {
  draw({
    story: [
      note({ key: "note:b", text: "Second", at: "2026-10-13 10:02:00" }),
      note({ key: "note:a", text: "First", day: "2026-10-09", at: "2026-10-09 15:00:00", author: "Dane Hill" }),
    ],
  });
  const days = screen.getAllByText(/^(Today|Fri 9 Oct)$/).map((d) => d.textContent);
  expect(days).toEqual(["Fri 9 Oct", "Today"]);
  const msgs = screen.getAllByRole("article");
  expect(msgs.map((m) => within(m).getByText(/First|Second/).textContent)).toEqual(["First", "Second"]);
  expect(within(msgs[0]!).getByText("Dane Hill")).toBeInTheDocument();
  expect(within(msgs[0]!).getByText("3:00 pm")).toBeInTheDocument();
  expect(within(msgs[1]!).getByText("10:02 am")).toBeInTheDocument();
});

it("draws a voice note as a card round its words", () => {
  draw({
    story: [note({ key: "ournote:n1", origin: "heytiff", id: "n1", author: "Isaac Smith", text: "Pipe through the robe" })],
    talks: [talk({ spoken: true, replies: [], made: [] })],
  });
  const card = screen.getByText("Note from voice").closest(".jc-voice") as HTMLElement;
  expect(within(card).getByText("Pipe through the robe")).toBeInTheDocument();
});

it("says what Tiff did under the note, with a card per thing she made and Undo", async () => {
  const onUndoTalk = jest.fn(async () => undefined);
  draw({
    story: [note({ key: "ournote:n1", origin: "heytiff", id: "n1", author: "Isaac Smith", text: "Get Lyle to order the grilles before lunch", at: "2026-10-13 10:05:00" })],
    talks: [talk()],
    onUndoTalk,
  });
  expect(screen.getByText("Done. A task for Lyle.")).toBeInTheDocument();
  const card = screen.getByText("Order the grilles").closest("li") as HTMLElement;
  expect(within(card).getByText("Lyle, today by 12:30 pm")).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Undo" }));
  expect(onUndoTalk).toHaveBeenCalledWith("n1");
});

it("offers no Undo where it would be refused", () => {
  draw({
    story: [note({ key: "ournote:n1", origin: "heytiff", id: "n1" })],
    talks: [talk({ undo: false })],
    onUndoTalk: jest.fn(async () => undefined),
  });
  expect(screen.getByText("Order the grilles")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

it("keeps a note Undo took back, with Tiff's line saying so", () => {
  draw({ talks: [talk({ undone: true, undo: false, made: [], replies: [{ who: "tiff", text: "1 task taken back." }] })] });
  expect(screen.getByText("Get Lyle to order the grilles before lunch")).toBeInTheDocument();
  expect(screen.getByText("1 task taken back.")).toBeInTheDocument();
});

it("shows the answers Tiff offers as second buttons, and a press answers her", async () => {
  const answer = jest.fn();
  const turns: ModalTurn[] = [
    { key: "you1", who: "you", text: "Book commissioning for Friday arvo", enter: true },
    {
      key: "tiff2",
      who: "tiff",
      text: "Commissioning on Friday: which time?",
      enter: true,
      noteId: "n5",
      quick: [{ label: "2:00 pm" }, { label: "3:30 pm" }, { label: "Another time" }],
    },
  ];
  draw({ c: convo({ turns, questionOpen: true, answer }) });
  const group = screen.getByRole("group", { name: "Answers" });
  expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["2:00 pm", "3:30 pm", "Another time"]);
  await userEvent.click(within(group).getByRole("button", { name: "3:30 pm" }));
  expect(answer).toHaveBeenCalledWith({ label: "3:30 pm" });
});

it("draws what the box just filed as cards with Undo, from the conversation's own turn", async () => {
  const undo = jest.fn(async () => undefined);
  const turns: ModalTurn[] = [
    { key: "you1", who: "you", text: "Get Lyle to order the grilles", enter: true },
    {
      key: "tiff2",
      who: "tiff",
      text: "Done. A task for Lyle.",
      enter: true,
      noteId: "n7",
      filed: true,
      undo: "ready",
      rows: [{ key: "tasks:0", lane: "tasks", index: 0, lead: "Lyle", join: ", ", text: "Order the grilles, Tue 12:30", needs: false }],
    },
  ];
  draw({ c: convo({ turns, undo }) });
  const card = screen.getByText("Order the grilles, Tue 12:30").closest("li") as HTMLElement;
  await userEvent.click(within(card).getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledWith("tiff2", "n7");
});

it("sends the box's words to Tiff with Send", async () => {
  const send = jest.fn();
  draw({ c: convo({ draft: "Lyle to order the grilles", send }) });
  await userEvent.click(screen.getByRole("button", { name: "Send to Tiff" }));
  expect(send).toHaveBeenCalled();
});

it("keeps the words as typed, a note on the job, with Tiff filing nothing", async () => {
  const d = diary();
  const setDraft = jest.fn();
  const send = jest.fn();
  draw({ c: convo({ draft: "  Grilles are in the van  ", setDraft, send }), d });
  await userEvent.click(screen.getByRole("button", { name: "Keep as typed" }));
  expect(d.onWrite).toHaveBeenCalledWith("Grilles are in the van", false, expect.any(String));
  expect(setDraft).toHaveBeenCalledWith("");
  expect(send).not.toHaveBeenCalled();
});

it("offers Keep as typed only once there are words", () => {
  draw({ c: convo({ draft: "" }) });
  expect(screen.queryByRole("button", { name: "Keep as typed" })).toBeNull();
});

it("keeps the diary's filters, and the diary's other entries as cards in their place", async () => {
  const onOpenClaim = jest.fn();
  draw({
    story: [
      { kind: "claim", key: "claim:c1", day: "2026-10-13", at: null, event: "raised", remoteId: "c1", title: "Deposit invoice", jobNumber: "3342A", amountCents: 48000, isFinal: false },
      note(),
    ],
    d: diary({ onOpenClaim }),
  });
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(onOpenClaim).toHaveBeenCalledWith("c1");
  await userEvent.click(screen.getByRole("tab", { name: "Notes" }));
  expect(screen.queryByText(/Deposit invoice/)).toBeNull();
  expect(screen.getByText("Study head mounted and levelled.")).toBeInTheDocument();
});

it("keeps a note's own doors: Remove on one of ours", async () => {
  const onRemoveNote = jest.fn();
  draw({ story: [note({ key: "ournote:n1", origin: "heytiff", id: "n1", author: "Isaac Smith" })], d: diary({ onRemoveNote }) });
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(onRemoveNote).toHaveBeenCalledWith("n1");
});
