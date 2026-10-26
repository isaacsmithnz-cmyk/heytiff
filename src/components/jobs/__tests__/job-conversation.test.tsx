/* A JOB'S OVERVIEW IS ITS CONVERSATION (v2, step 6, the board JC-1).

   The conversation draws what it is handed: the diary's entries, what Tiff
   said back to each note and made from it, and the box's own conversation
   (use-conversation, the Tiff modal's, faked here so the suite holds the
   drawing and the presses, not the router). The router's half has its own
   suites. */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Conversation, ModalTurn } from "@/components/tiff/modal/use-conversation";
import type { StoryEntry } from "@/lib/workboard/job-story";
import type { JobNoteTalk } from "@/lib/jobs/job-conversation";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: jest.fn() }));
jest.mock("@/app/actions/tiff-open", () => ({ openRecordByName: jest.fn(async () => null) }));
jest.mock("@/app/actions/workboard-notes", () => ({ routeNote: jest.fn(), dismissNote: jest.fn() }));
/* Add photo: the expense form's own upload, and the delete a clear makes */
const uploadFile = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: (...a: unknown[]) => uploadFile(...a) }));
const deleteDocument = jest.fn(async (_id: string) => ({ ok: true }));
jest.mock("@/app/actions/documents", () => ({ deleteDocument: (id: string) => deleteDocument(id) }));
const addMyNote = jest.fn(async (..._a: unknown[]) => ({ ok: true, id: "my-1" }) as { ok: boolean; id?: string; error?: string });
const deleteMyNote = jest.fn(async (..._a: unknown[]) => ({ ok: true }));
jest.mock("@/app/actions/my-notes", () => ({
  addMyNote: (...a: unknown[]) => addMyNote(...a),
  deleteMyNote: (...a: unknown[]) => deleteMyNote(...a),
}));

beforeAll(() => {
  /* jsdom has no object URLs */
  URL.revokeObjectURL = jest.fn();
});
beforeEach(() => {
  uploadFile.mockReset();
  deleteDocument.mockClear();
});

import { JobConversation, type ConversationDiary } from "../job-conversation";
import { commsThreads, customerFeed, isMoneySend, type CommsThread, type CustomerItem } from "@/lib/jobs/customer-messages";
import { fixture3372 } from "@/lib/jobs/__fixtures__/customer-3372";

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
    sendWithReceipt: jest.fn(),
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
  customer?: CustomerItem[];
  comms?: CommsThread[];
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
        customer={p.customer}
        comms={p.comms}
      />
    </div>,
  );

/* THE ACTIVITY FEED (Isaac's refined Overview A, 25 October 2026): newest
   first, a grey line between the days, Tiff's box at the head */
it("reads newest first, a line between the days, each message with its person and time", () => {
  draw({
    story: [
      note({ key: "note:b", text: "Second", at: "2026-10-13 10:02:00" }),
      note({ key: "note:a", text: "First", day: "2026-10-09", at: "2026-10-09 15:00:00", author: "Dane Hill" }),
    ],
  });
  const days = screen.getAllByText(/^(Today|Fri 9 Oct)$/).map((d) => d.textContent);
  expect(days).toEqual(["Today", "Fri 9 Oct"]);
  expect(screen.getByText("Today")).toHaveClass("jc-dayname");
  const msgs = screen.getAllByRole("article");
  expect(msgs.map((m) => within(m).getByText(/First|Second/).textContent)).toEqual(["Second", "First"]);
  expect(within(msgs[1]!).getByText("Dane Hill")).toBeInTheDocument();
  expect(within(msgs[1]!).getByText("3:00 pm")).toBeInTheDocument();
  expect(within(msgs[0]!).getByText("10:02 am")).toBeInTheDocument();
});

it("puts a day's entries newest first too, and says Yesterday for yesterday", () => {
  draw({
    story: [
      note({ key: "note:late", text: "Later on", day: "2026-10-12", at: "2026-10-12 16:43:00" }),
      note({ key: "note:early", text: "Early on", day: "2026-10-12", at: "2026-10-12 08:10:00" }),
    ],
  });
  expect(screen.getByText("Yesterday")).toHaveClass("jc-dayname");
  expect(screen.getAllByRole("article").map((m) => within(m).getByText(/on$/).textContent)).toEqual(["Later on", "Early on"]);
});

it("is a section like the others: the green block, Activity feed, the soft tabs on its right, Tiff's box above the feed", () => {
  draw({ story: [note()] });
  const feed = screen.getByRole("region", { name: "Activity feed" });
  const head = feed.querySelector(".jov-head") as HTMLElement;
  expect(head.querySelector(".hm-blk")).toHaveClass("hm-blk--green");
  expect(within(head).getByRole("heading", { level: 2 })).toHaveTextContent("Activity feed");
  const filter = within(head).getByRole("group", { name: "Show in the feed" });
  expect(within(filter).getAllByRole("button").map((t) => t.textContent)).toEqual(["All", "Comms", "Notes", "Photos"]);
  /* the box comes before the feed */
  const box = screen.getByRole("textbox", { name: "Tell Tiff about this job" });
  const list = feed.querySelector(".jc-feed") as HTMLElement;
  expect(box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  /* Send says its word, blue; Add photo is quiet */
  expect(screen.getByRole("button", { name: "Send to Tiff" })).toHaveTextContent("Send");
  expect(screen.getByRole("button", { name: "Send to Tiff" })).toHaveClass("pt-btn--main");
  expect(screen.getByRole("button", { name: "Add photo" })).toHaveClass("pt-btn--quiet");
});

it("filters what is already read: Photos shows the photos and leaves the notes", async () => {
  const onPhotos = jest.fn();
  draw({
    story: [
      note({ key: "note:b", text: "Second" }),
      { kind: "photos", key: "photos:2026-10-13", day: "2026-10-13", at: null, count: 2, shown: [] },
    ],
    d: diary({ onPhotos }),
  });
  await userEvent.click(screen.getByRole("button", { name: "Photos" }));
  expect(screen.queryByText("Second")).toBeNull();
  expect(screen.getByText("2 photos")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "See all" }));
  expect(onPhotos).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "All" }));
  expect(screen.getByText("Second")).toBeInTheDocument();
});

it("opens the quote from its Quote sent entry, by the job's number", async () => {
  const onQuote = jest.fn();
  draw({
    story: [{ kind: "milestone", key: "milestone:quoted", day: "2026-10-09", at: null, label: "Quote sent" }],
    d: diary({ onQuote, jobNumber: "3385" }),
  });
  await userEvent.click(screen.getByRole("button", { name: "Open quote #3385" }));
  expect(onQuote).toHaveBeenCalled();
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

/* Isaac, 26 October 2026: "Unless it's a private note, you just hit add to
   my notes instead". Send is the job's (Tiff files, and the one tidied note
   goes to ServiceM8 by itself); Add to my notes keeps the words for you
   alone: nothing written on the job, nothing filed, nothing sent. */
it("keeps a private note in My notes, with nothing on the job and nothing to Tiff", async () => {
  addMyNote.mockClear();
  const d = diary();
  const setDraft = jest.fn();
  const send = jest.fn();
  draw({ c: convo({ draft: "  Ask Michael whether the deposit cleared  ", setDraft, send }), d });
  await userEvent.click(screen.getByRole("button", { name: "Add to my notes" }));
  expect(addMyNote).toHaveBeenCalledWith({ body: "Ask Michael whether the deposit cleared", source: "text" });
  await waitFor(() => expect(setDraft).toHaveBeenCalledWith(""));
  expect(send).not.toHaveBeenCalled();
});

it("keeps the words in the box when My notes refused them", async () => {
  addMyNote.mockResolvedValueOnce({ ok: false, error: "Your staff profile isn't set up yet." });
  const setDraft = jest.fn();
  draw({ c: convo({ draft: "Gate code 4471", setDraft }) });
  await userEvent.click(screen.getByRole("button", { name: "Add to my notes" }));
  await waitFor(() => expect(addMyNote).toHaveBeenCalled());
  expect(setDraft).not.toHaveBeenCalled();
});

it("offers Add to my notes only once there are words", () => {
  draw({ c: convo({ draft: "" }) });
  expect(screen.queryByRole("button", { name: "Add to my notes" })).toBeNull();
});

/* the walk of 25 October 2026: the ⓘ went (no hint text); the Also in
   ServiceM8 tick went on 26 October, as a note on the job now goes by
   itself */
it("has no ⓘ and no Also in ServiceM8 tick: Add photo alone in the box's bottom row", () => {
  draw({
    c: convo({ draft: "Grilles are in the van" }),
    d: diary({ notesSm8: { owner: false } as never, sender: { state: "ready" } as never }),
  });
  expect(screen.queryByRole("button", { name: /^What Save/ })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "Also in ServiceM8" })).toBeNull();
  const lead = screen.getByRole("button", { name: "Add photo" }).closest(".jc-lead") as HTMLElement;
  expect(lead.closest(".cv-boxbar")).not.toBeNull();
});

it("still says why your notes can't go to ServiceM8 yet, under the box", () => {
  draw({
    c: convo({ draft: "" }),
    d: diary({ notesSm8: { owner: false } as never, sender: { state: "unlinked", noCard: false } as never }),
  });
  expect(screen.getByText("Link yourself to ServiceM8 first. An owner can do that in Integrations, ServiceM8.")).toBeInTheDocument();
});

it("(F) presses the feed's filter from the keyboard: each word is its own stop, and says whether it is pressed", async () => {
  draw({ story: [note({ key: "note:b", text: "Second" }), { kind: "photos", key: "photos:2026-10-13", day: "2026-10-13", at: null, count: 2, shown: [] }] });
  const notes = screen.getByRole("button", { name: "Notes" });
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  expect(notes).toHaveAttribute("aria-pressed", "false");
  expect(notes).not.toHaveAttribute("tabindex", "-1");
  notes.focus();
  await userEvent.keyboard("{Enter}");
  expect(notes).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("2 photos")).toBeNull();
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
  await userEvent.click(screen.getByRole("button", { name: "Notes" }));
  expect(screen.queryByText(/Deposit invoice/)).toBeNull();
  expect(screen.getByText("Study head mounted and levelled.")).toBeInTheDocument();
});

it("keeps a note's own doors: Remove on one of ours", async () => {
  const onRemoveNote = jest.fn();
  draw({ story: [note({ key: "ournote:n1", origin: "heytiff", id: "n1", author: "Isaac Smith" })], d: diary({ onRemoveNote }) });
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(onRemoveNote).toHaveBeenCalledWith("n1");
});

/* ── Add photo: a receipt that goes with the words ── */

const landed = {
  ok: true,
  file: { documentId: "doc1", fileName: "reece-receipt.jpg", mimeType: "image/jpeg", sizeBytes: 2048, previewUrl: "blob:reece" },
};

const picker = () => document.querySelector("input[type=file]") as HTMLInputElement;
const pickPhoto = () =>
  fireEvent.change(picker(), { target: { files: [new File(["receipt"], "reece-receipt.jpg", { type: "image/jpeg" })] } });
const CHIP = { name: "The photo going with your words" };

it("draws Add photo as the box's second button, and uploads a photo as the expense form uploads a receipt", async () => {
  uploadFile.mockResolvedValue(landed);
  draw({ c: convo({ draft: "$85 at Reece for fittings" }) });
  expect(screen.getByRole("button", { name: "Add photo" })).toBeInTheDocument();
  expect(picker().accept).toContain("image/jpeg");
  pickPhoto();
  expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "receipt");
  expect(await screen.findByText("reece-receipt.jpg")).toBeInTheDocument();
  const chip = screen.getByRole("group", CHIP);
  expect(chip.querySelector("img")?.getAttribute("src")).toBe("blob:reece");
  expect(within(chip).getByRole("button", { name: "Clear the photo" })).toBeInTheDocument();
  /* one photo a note: the button goes while one is in the box */
  expect(screen.queryByRole("button", { name: "Add photo" })).toBeNull();
});

it("holds Send while the photo is still going up, and says so", async () => {
  uploadFile.mockReturnValue(new Promise(() => undefined));
  draw({ c: convo({ draft: "$85 at Reece" }) });
  pickPhoto();
  expect(await screen.findByText("Uploading the photo")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send to Tiff" })).toBeDisabled();
});

it("sends the photo with the words as the receipt", async () => {
  uploadFile.mockResolvedValue(landed);
  const c = convo({ draft: "$85 at Reece for fittings" });
  draw({ c });
  pickPhoto();
  await screen.findByText("reece-receipt.jpg");
  await userEvent.click(screen.getByRole("button", { name: "Send to Tiff" }));
  expect(c.sendWithReceipt).toHaveBeenCalledWith("doc1");
  expect(c.send).not.toHaveBeenCalled();
  /* the claim adopts it: the chip goes and the upload stays */
  expect(screen.queryByRole("group", CHIP)).toBeNull();
  expect(deleteDocument).not.toHaveBeenCalled();
});

it("clears the photo: the chip and its upload go, and Send sends the words alone", async () => {
  uploadFile.mockResolvedValue(landed);
  const c = convo({ draft: "Fittings from Reece" });
  draw({ c });
  pickPhoto();
  await screen.findByText("reece-receipt.jpg");
  await userEvent.click(within(screen.getByRole("group", CHIP)).getByRole("button", { name: "Clear the photo" }));
  expect(screen.queryByRole("group", CHIP)).toBeNull();
  expect(deleteDocument).toHaveBeenCalledWith("doc1");
  expect(screen.getByRole("button", { name: "Add photo" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Send to Tiff" }));
  expect(c.send).toHaveBeenCalled();
  expect(c.sendWithReceipt).not.toHaveBeenCalled();
});

it("says why a photo didn't upload, in its place", async () => {
  uploadFile.mockResolvedValue({ ok: false, error: "That file is too big." });
  draw({ c: convo({ draft: "$85 at Reece" }) });
  pickPhoto();
  expect(await screen.findByRole("alert")).toHaveTextContent("That file is too big.");
});

/* ── the customer, in the feed (Isaac, 26 October 2026, "Yes build") ── */

const customer = () => customerFeed(fixture3372(), { customer: "Marco", money: true, staffOf: (m) => m.name });

it("draws ServiceM8's sends as rows and the conversation as a thread, oldest first inside it", () => {
  draw({ customer: customer() });
  expect(screen.getByText("Booking for Wed 14 Oct, 2:00 pm texted")).toBeInTheDocument();
  const reply = screen.getAllByText("Marco: YES")[0]!;
  expect(reply.tagName).toBe("B");
  const thread = screen.getByText("Email with Marco").closest(".jc-thread") as HTMLElement;
  const bubbles = [...thread.querySelectorAll(".jc-bm")].map((b) => b.querySelector(".jc-bmtime")?.textContent);
  expect(bubbles).toEqual(["9:31 amSeen 9:56 am", "10:03 am", "11:06 am", "11:51 amSeen 11:56 am"]);
  expect(within(thread).getByText("Booking for 2:00 pm texted").closest(".jc-thline")).toHaveTextContent("Marco: Yes");
  /* the newest day first: the invoice's day over the first quote's */
  const days = screen.getAllByText(/^(Tue 20 Oct|Tue 29 Sept?)$/).map((d) => d.textContent);
  expect(days).toEqual(["Tue 20 Oct", expect.stringMatching(/^Tue 29 Sept?$/)]);
});

/* COMMS (Isaac, 26 October 2026, "Yes, build the Comms tab as mocked") */
const comms = (money = true) => commsThreads(money ? fixture3372() : fixture3372().filter((m) => !isMoneySend(m)), { customer: "Marco", today: "2026-10-22" });

it("shows in Comms every message and nothing else, oldest first, ServiceM8's own as bubbles", async () => {
  draw({ story: [note({ key: "note:b", text: "Second" })], customer: customer(), comms: comms() });
  await userEvent.click(screen.getByRole("button", { name: "Comms" }));
  expect(screen.getByRole("button", { name: "Comms" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("Second")).toBeNull();
  /* no rows: the sends are bubbles, and a YES its own */
  expect(document.querySelector(".jc-send")).toBeNull();
  const bubbles = [...document.querySelectorAll(".jc-comms .jc-bubble")].map((b) => b.textContent ?? "");
  expect(bubbles).toHaveLength(17);
  expect(bubbles[0]).toMatch(/^Dear Marco,/);
  expect(bubbles.filter((b) => /^yes$/i.test(b))).toHaveLength(3);
  expect(bubbles.at(-1)).toMatch(/^Filters have been ordered/);
  await userEvent.click(screen.getByRole("button", { name: "Notes" }));
  expect(document.querySelector(".jc-comms")).toBeNull();
  expect(screen.getByText("Second")).toBeInTheDocument();
});

it("keeps ServiceM8's sends as rows in All", () => {
  draw({ customer: customer(), comms: comms() });
  expect(document.querySelector(".jc-comms")).toBeNull();
  expect(screen.getByText("Booking for Wed 14 Oct, 2:00 pm texted")).toBeInTheDocument();
});

it("starts a thread where the channel or the subject changes, each under its hairline, and says the day once where it changes", async () => {
  draw({ comms: comms() });
  await userEvent.click(screen.getByRole("button", { name: "Comms" }));
  const threads = [...document.querySelectorAll(".jc-comthread")] as HTMLElement[];
  const heads = threads.map((t) => t.querySelector(".jc-comhead")!.textContent);
  expect(heads.slice(0, 5)).toEqual([
    "EmailRequest for Air Conditioning Quote – 1 Example Street",
    "EmailYour Quote from Acme Air (Ref #3372)",
    "Text",
    "EmailYour Quote from Acme Air (Ref #3372)",
    "Text",
  ]);
  const days = [...document.querySelectorAll(".jc-comday")].map((d) => d.textContent);
  expect(days).toEqual(["Tue 29 Sept", "Tue 6 Oct", "Wed 7 Oct", "Mon 12 Oct", "Wed 14 Oct", "Fri 16 Oct", "Tue 20 Oct"].map((d) => expect.stringMatching(new RegExp(`^${d.replace("Sept", "Sept?")}$`))));
  /* 6 October's later threads say no day: it hasn't changed */
  expect(threads[2]!.querySelector(".jc-comday")).toBeNull();
});

it("brings the newest message into view when Comms opens, through the page's own scroller", async () => {
  const seen: Element[] = [];
  const into = jest.fn(function (this: Element) {
    seen.push(this);
  });
  const was = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = into;
  try {
    draw({ comms: comms() });
    expect(into).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Comms" }));
    expect(into).toHaveBeenCalledWith({ block: "end" });
    expect(seen.at(-1)).toHaveTextContent(/Filters have been ordered/);
    expect(seen.at(-1)).toHaveClass("jc-bm");
  } finally {
    Element.prototype.scrollIntoView = was;
  }
});

it("leaves ServiceM8's quotes and invoices out of Comms for whoever can't see money", async () => {
  draw({ comms: comms(false) });
  await userEvent.click(screen.getByRole("button", { name: "Comms" }));
  const bubbles = [...document.querySelectorAll(".jc-comms .jc-bubble")].map((b) => b.textContent ?? "");
  expect(bubbles.some((b) => /\$13200|invoice|quotation/i.test(b))).toBe(false);
  /* the team's own words about the quote stay */
  expect(bubbles.some((b) => /follow up on the quote/.test(b))).toBe(true);
});

it("says a quote sent once, as ServiceM8's send, which keeps the Quote sent row's door after its Seen", async () => {
  const onQuote = jest.fn();
  draw({
    story: [{ kind: "milestone", key: "milestone:quoted", day: "2026-09-29", at: null, label: "Quote sent" }],
    customer: customer(),
    d: diary({ onQuote, jobNumber: "3372" }),
  });
  expect(screen.queryByText("Quote sent")).toBeNull();
  const door = screen.getByRole("button", { name: "Open quote #3372" });
  const end = door.closest(".jc-sendend") as HTMLElement;
  expect(end.closest(".jc-send")).toHaveTextContent("Quote emailed");
  expect([...end.children].map((c) => c.textContent)).toEqual(["Seen 9:45 am", "Open quote #3372"]);
  /* only the send that stands in for the row: the 12 October quote has none */
  expect(screen.getAllByRole("button", { name: /^Open quote/ })).toHaveLength(1);
  await userEvent.click(door);
  expect(onQuote).toHaveBeenCalled();
});

it("draws a send nobody answered as Emailed, its first words after it, apart", () => {
  draw({ customer: customerFeed([fixture3372()[1]!], { customer: "Marco", money: true }) });
  const words = screen.getByText("Emailed");
  const text = words.closest(".jc-sendtext") as HTMLElement;
  expect(text.children[0]).toContainElement(words);
  expect(text.children[1]).toHaveClass("jc-sendopen");
  expect(text.children[1]).toHaveTextContent(/^I hope you've been well/);
});

/* THE WORDS' HEIGHT, as a browser would measure it: jsdom lays nothing
   out, so a message is "long" here by its words, as Fade's own tests stub
   the measure. A bubble's words over 16 lines of 22 are clamped. */
const LONG = "LONG:";
const measured = () => {
  const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("jc-bubwords") && (this.textContent ?? "").startsWith(LONG) ? 22 * 20 : 22 * 3;
    },
  });
  return () => {
    if (was) Object.defineProperty(HTMLElement.prototype, "scrollHeight", was);
  };
};

/* Isaac, 26 October 2026: "that whole thing should probably show in the
   thread. Anything longer than that, I would say have the dots" */
it("shows a message that fits in sixteen lines whole, with no dots", () => {
  const undo = measured();
  try {
    draw({ customer: customer() });
    expect(document.querySelector(".jc-bubwords--clamped")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the whole message" })).toBeNull();
    /* the bubble isn't a button: its words are words */
    expect(screen.getByText("Thanks, Dana, just got the text re 2pm visit.").closest("button")).toBeNull();
  } finally {
    undo();
  }
});

it("clamps a longer one, and its dots open the whole message, read only, as plain text", async () => {
  const undo = measured();
  try {
    const f = fixture3372();
    const long = `${LONG} ${"The rest of a long email. ".repeat(40)}`;
    draw({ customer: customerFeed([{ ...f[4]!, text: long }], { customer: "Marco", money: true }) });
    const words = document.querySelector(".jc-bubwords") as HTMLElement;
    expect(words).toHaveClass("jc-bubwords--clamped");
    const dots = screen.getByRole("button", { name: "Show the whole message" });
    expect(dots).toHaveTextContent("•••");
    expect(dots.closest(".jc-bubble")).not.toBeNull();
    await userEvent.click(dots);
    const dialog = screen.getByRole("dialog", { name: "Re: Your Quote from Acme Air (Ref #3372)" });
    expect(within(dialog).getByText(/^LONG: The rest of a long email/).closest(".cmsg-words")).not.toBeNull();
    expect(within(dialog).getByText("Tue 6 Oct, 11:06 am")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  } finally {
    undo();
  }
});

it("makes a web address in a bubble a link, its full stop outside it, and leaves javascript: and mailto: as words", () => {
  const f = fixture3372();
  draw({
    customer: customerFeed([{ ...f[4]!, text: "Pay it at https://sm8.link/fa2w. Not javascript:alert(1) or mailto:marco@example.com" }], { customer: "Marco", money: true }),
  });
  const link = screen.getByRole("link", { name: "https://sm8.link/fa2w" });
  expect(link).toHaveAttribute("href", "https://sm8.link/fa2w");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(link.nextSibling?.textContent).toMatch(/^\. Not javascript/);
  expect(screen.getAllByRole("link")).toHaveLength(1);
});

/* Isaac, 26 October 2026: "It says that there's one attachment, but you can't actually click it" */
it("lists what came with a message, a row each, and opens it where the job's documents open", async () => {
  const f = fixture3372();
  const opened: string[] = [];
  draw({
    customer: customerFeed(
      [
        {
          ...f[6]!,
          files: [
            { id: "f-1", name: "Acme Air Quote #3372", type: ".pdf" },
            { id: "f-2", name: "Site photo", type: ".jpg" },
            { id: "f-3", name: null, type: null },
          ],
        },
      ],
      { customer: "Marco", money: true },
    ),
    d: diary({ openFile: (id) => (id === "f-3" ? null : () => opened.push(id)) }),
  });
  const rows = within(screen.getByRole("list", { name: "Attachments" })).getAllByRole("listitem");
  expect(rows.map((r) => r.textContent)).toEqual(["Acme Air Quote #3372PDF", "Site photoJPG", "AttachmentNot synced yet"]);
  await userEvent.click(within(rows[0]!).getByRole("button"));
  await userEvent.click(within(rows[1]!).getByRole("button"));
  expect(opened).toEqual(["f-1", "f-2"]);
  /* not mirrored yet: greyed, and nothing to press */
  expect(within(rows[2]!).queryByRole("button")).toBeNull();
  expect(rows[2]!.querySelector(".jc-file--off")).not.toBeNull();
});

/* filled and grouped like iMessage (Isaac, 26 October 2026: "Deep green with white") */
it("fills each side's bubbles its own way, and says a run's name once above it and its time once under it", async () => {
  const f = fixture3372();
  draw({
    customer: customerFeed(
      [
        { ...f[2]!, id: "a", stamp: "2026-10-06 10:00:00", text: "First" },
        { ...f[2]!, id: "b", stamp: "2026-10-06 10:01:00", text: "Second" },
        { ...f[6]!, id: "c", stamp: "2026-10-06 10:02:00", text: "Third", seenStamp: "2026-10-06 10:05:00" },
      ],
      { customer: "Marco", money: true },
    ),
  });
  const run = [...document.querySelectorAll(".jc-bm")] as HTMLElement[];
  expect(run.map((b) => b.className)).toEqual([
    "jc-bm jc-bm--them jc-bm--first",
    "jc-bm jc-bm--them jc-bm--last",
    "jc-bm jc-bm--us jc-bm--first jc-bm--last",
  ]);
  expect(run.map((b) => b.querySelector(".jc-bmname")?.textContent ?? null)).toEqual(["Marco", null, "Dana"]);
  expect(run.map((b) => b.querySelector(".jc-bmtime")?.textContent ?? null)).toEqual([null, "10:01 am", "10:02 amSeen 10:05 am"]);
});

/* the walk of 26 October 2026: the 20 October invoice showed twice */
it("says an invoice once: ServiceM8's send, with the claim's name and its Open after Seen", async () => {
  const onOpenClaim = jest.fn();
  draw({
    story: [
      { kind: "claim", key: "claim:c2:raised", day: "2026-10-20", at: null, event: "raised", remoteId: "c2", title: "Payment 2, Final", jobNumber: "3372", amountCents: 1320000, isFinal: true },
    ],
    customer: customer(),
    d: diary({ onOpenClaim }),
  });
  expect(screen.queryByText(/Payment 2, Final raised/)).toBeNull();
  const row = screen.getByText("Invoice sent, $13,200").closest(".jc-send") as HTMLElement;
  expect(row).toHaveTextContent("Payment 2, Final, by email and text");
  const end = row.querySelector(".jc-sendend") as HTMLElement;
  expect([...end.children].map((c) => c.textContent)).toEqual(["Seen 12:58 pm", "Open"]);
  await userEvent.click(within(end).getByRole("button", { name: "Open" }));
  expect(onOpenClaim).toHaveBeenCalledWith("c2");
});

it("leaves the claim's own row where it isn't the invoice that went out", () => {
  draw({
    story: [
      { kind: "claim", key: "claim:c3:raised", day: "2026-10-20", at: null, event: "raised", remoteId: "c3", title: "Payment 1, Deposit", jobNumber: "3372A", amountCents: 400000, isFinal: false },
    ],
    customer: customer(),
  });
  expect(screen.getByText(/Payment 1, Deposit raised/)).toBeInTheDocument();
  expect(screen.getByText("Invoice sent, $13,200").closest(".jc-send")).not.toHaveTextContent("Payment 1");
});
