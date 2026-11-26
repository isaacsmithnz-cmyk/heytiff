/**
 * @jest-environment jsdom
 */

/* The one reader: an answer said in pieces as it arrives, the first piece
   small so she starts at once, a table never read, one answer at a time
   page-wide, and, when her voice can't be had, nothing played and the
   answer saying so (Isaac, 27 November 2026: "just have it say that voice
   is unavailable at the moment"). */

import { act, renderHook } from "@testing-library/react";
import { readOut, startReading, stopSpeaking, useVoiceUnavailable } from "../speaker";

let asked: string[] = [];
let played = 0;
let status = 200;
let hold = false;

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value(this: HTMLMediaElement) {
      played++;
      if (!hold) setTimeout(() => this.onended?.(new Event("ended")), 0);
      return Promise.resolve();
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value(this: HTMLMediaElement) {
      this.onpause?.(new Event("pause"));
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => false });
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    asked.push(JSON.parse(String(init?.body)).text);
    return { ok: status === 200, status, blob: async () => ({}), json: async () => ({}) } as unknown as Response;
  }) as typeof fetch;
});

beforeEach(() => {
  asked = [];
  played = 0;
  status = 200;
  hold = false;
});

const tick = () => new Promise((r) => setTimeout(r, 5));

it("says an answer arriving in pieces, the first as soon as there's a sentence", async () => {
  const r = startReading("a1");
  r.feed("Sam and Jordan are both free after one o'clock. Sam fin");
  await tick();
  expect(asked).toEqual(["Sam and Jordan are both free after one o'clock."]);
  r.feed("ishes in Burwood at half past twelve.\n| Who | When |\n| Sam | 1 |\nShall I book Sam?");
  r.finish();
  await r.done;
  expect(asked.join(" ")).toBe(
    "Sam and Jordan are both free after one o'clock. Sam finishes in Burwood at half past twelve. The table's on the screen. Shall I book Sam?"
  );
  expect(played).toBe(asked.length);
});

it("reads one answer at a time: a second stops the first", async () => {
  hold = true;
  const first = readOut("one", "The first answer is quite long, and it goes on.");
  await tick();
  hold = false;
  const second = readOut("two", "The second answer.");
  await first;
  await second;
  expect(asked[asked.length - 1]).toBe("The second answer.");
});

it("with her voice unavailable nothing plays, the answer says so, and the route rests a minute", async () => {
  const { result } = renderHook(() => useVoiceUnavailable("u1"));
  status = 503;
  await act(() => readOut("u1", "One more thing to say."));
  expect(played).toBe(0);
  expect(result.current).toBe(true);
  const before = asked.length;
  await act(() => readOut("u2", "And another."));
  expect(asked.length).toBe(before);
  expect(result.current).toBe(false);
});

it("stops when asked", async () => {
  hold = true;
  const r = readOut("z", "A sentence that is being said right now.");
  await tick();
  stopSpeaking();
  await r;
});
