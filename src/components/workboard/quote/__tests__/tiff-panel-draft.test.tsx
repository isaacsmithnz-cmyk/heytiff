import { act, fireEvent, render, screen } from "@testing-library/react";
import { TiffPanel } from "../tiff-panel";

/* The quote's reply box keeps what you typed and haven't sent (Isaac,
   2026-10-18: "How can we make it save? The text in the reply box. Before
   sending."): back in the box when you return, written after a pause rather
   than on every key, written at once when you leave, never written over by an
   empty box on load, and gone once sent. */

const thread = { ok: true, on: true, working: false, me: "u-isaac", names: {}, events: [] };
let draft = "";
let puts: { box: string; ref: string; text: string }[] = [];
let releaseDraft: () => void = () => undefined;
let holdDraft = false;

beforeEach(() => {
  jest.useFakeTimers();
  draft = "";
  puts = [];
  holdDraft = false;
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (String(url).startsWith("/api/drafts")) {
      if (init?.method === "PUT") {
        puts.push(JSON.parse(init.body!));
        return { json: async () => ({ ok: true }) };
      }
      if (holdDraft) await new Promise<void>((done) => (releaseDraft = done));
      return { json: async () => ({ ok: true, text: draft }) };
    }
    if (init?.method === "POST") return { json: async () => ({ ok: true, turn: "t1" }) };
    return { json: async () => thread };
  });
});
afterEach(() => jest.useRealTimers());

const settle = () => act(async () => {});
const panel = () => render(<TiffPanel job="job-3209" onChanged={jest.fn()} />);

it("puts the words you left back in the box", async () => {
  draft = "Quote it from Luke's design summary";
  panel();
  await settle();
  await settle();
  expect(screen.getByLabelText("Message Tiff")).toHaveValue("Quote it from Luke's design summary");
  /* coming back writes nothing */
  act(() => jest.advanceTimersByTime(2000));
  expect(puts).toEqual([]);
});

it("never puts a draft over words already typed here", async () => {
  draft = "the old words";
  holdDraft = true;
  panel();
  await settle();
  fireEvent.change(screen.getByLabelText("Message Tiff"), { target: { value: "new words" } });
  await act(async () => releaseDraft());
  await settle();
  expect(screen.getByLabelText("Message Tiff")).toHaveValue("new words");
});

it("writes the draft once the typing stops, not on every key", async () => {
  panel();
  await settle();
  await settle();
  const box = screen.getByLabelText("Message Tiff");
  fireEvent.change(box, { target: { value: "Four heads" } });
  act(() => jest.advanceTimersByTime(300));
  fireEvent.change(box, { target: { value: "Four heads in the joinery" } });
  act(() => jest.advanceTimersByTime(300));
  expect(puts).toEqual([]);
  act(() => jest.advanceTimersByTime(600));
  expect(puts).toEqual([{ box: "quote", ref: "job-3209", text: "Four heads in the joinery" }]);
});

it("writes what's waiting at once when you leave the page", async () => {
  const { unmount } = panel();
  await settle();
  await settle();
  fireEvent.change(screen.getByLabelText("Message Tiff"), { target: { value: "Plus the split" } });
  unmount();
  expect(puts).toEqual([{ box: "quote", ref: "job-3209", text: "Plus the split" }]);
});

it("empties the draft when the words are sent", async () => {
  draft = "Plus the split";
  panel();
  await settle();
  await settle();
  fireEvent.keyDown(screen.getByLabelText("Message Tiff"), { key: "Enter" });
  await settle();
  expect(screen.getByLabelText("Message Tiff")).toHaveValue("");
  act(() => jest.advanceTimersByTime(1000));
  expect(puts).toEqual([{ box: "quote", ref: "job-3209", text: "" }]);
});
