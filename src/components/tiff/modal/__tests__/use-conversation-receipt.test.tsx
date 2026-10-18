/* A PHOTO SENT WITH THE WORDS (v2 step 6, Add photo on a job's box): the
   conversation hands it to the router as `receiptId`, where the cost lane
   reads it with today's receipt reader. Words with a photo are a note, never
   a question; Send without one is exactly what it was. Every server action
   a stub. */

import { act, renderHook } from "@testing-library/react";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));
const askBrain = jest.fn();
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: (...a: unknown[]) => askBrain(...a) }));
jest.mock("@/app/actions/tiff-open", () => ({ openRecordByName: jest.fn(async () => null) }));
const routeNote = jest.fn();
const continueNote = jest.fn();
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: (...a: unknown[]) => routeNote(...a),
  continueNote: (...a: unknown[]) => continueNote(...a),
  fileNote: jest.fn(),
  undoNote: jest.fn(),
  keepWords: jest.fn(),
  publishNoteKb: jest.fn(),
  dismissNote: jest.fn(),
  answerVisit: jest.fn(),
}));
jest.mock("@/app/actions/calendar", () => ({
  fileCalendarLine: jest.fn(),
  noteOnCalendarEvents: jest.fn(),
  undoCalendarLine: jest.fn(),
}));
jest.mock("@/components/notes/dictation", () => {
  const actual = jest.requireActual("@/components/notes/dictation");
  return {
    ...actual,
    useDictation: () => ({
      recording: false,
      arming: false,
      transcribing: false,
      seconds: 0,
      interim: "",
      barsRef: { current: null },
      bindQuiet: () => {},
      keepListening: () => {},
      start: () => {},
      stop: () => {},
      handOver: () => {},
      cancel: () => {},
      restart: () => {},
    }),
  };
});

import { useConversation, type Opening } from "../use-conversation";

const OPENING: Opening = { origin: null, still: true, at: 0, room: "diary" };

const hook = (target = { kind: "job" as const, id: "j-3342" }) =>
  renderHook(() => useConversation({ opening: OPENING, voiceEnabled: false, target }));

beforeEach(() => {
  routeNote.mockReset();
  askBrain.mockReset();
  /* the router refuses, so the conversation stops there */
  routeNote.mockResolvedValue({ ok: false, error: "Couldn't save that note." });
});

it("sends the photo with the words as the receipt", async () => {
  const { result } = hook();
  act(() => result.current.setDraft("$85 at Reece for fittings"));
  await act(async () => result.current.sendWithReceipt("doc1"));
  expect(routeNote).toHaveBeenCalledTimes(1);
  expect(routeNote.mock.calls[0]![0]).toMatchObject({
    transcript: "$85 at Reece for fittings",
    target: { kind: "job", id: "j-3342" },
    receiptId: "doc1",
  });
});

it("routes words with a photo as a note, even where they read as a question", async () => {
  const { result } = hook();
  act(() => result.current.setDraft("Can you claim this one?"));
  await act(async () => result.current.sendWithReceipt("doc1"));
  expect(askBrain).not.toHaveBeenCalled();
  expect(routeNote.mock.calls[0]![0]).toMatchObject({ receiptId: "doc1" });
});

it("sends no receipt when no photo went with the words", async () => {
  const { result } = hook();
  act(() => result.current.setDraft("Lyle to order the grilles"));
  await act(async () => result.current.send());
  expect(routeNote.mock.calls[0]![0]).not.toHaveProperty("receiptId");
});

it("carries the receipt off any job, as Home's box would, for the cost lane to ask which job", async () => {
  const { result } = renderHook(() => useConversation({ opening: OPENING, voiceEnabled: false, target: { kind: "none" } }));
  act(() => result.current.setDraft("$85 at Reece for fittings"));
  await act(async () => result.current.sendWithReceipt("doc1"));
  expect(routeNote.mock.calls[0]![0]).toMatchObject({ target: { kind: "none" }, receiptId: "doc1" });
});
