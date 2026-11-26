/**
 * @jest-environment jsdom
 */

/* The one reader: an answer said in pieces as it arrives, the first piece
   small so she starts at once, a table never read, one answer at a time
   page-wide, and the device's voice once the route says hers can't be had. */

import { readOut, startReading, stopSpeaking } from "../speaker";

type Utt = { text: string; onend: (() => void) | null; onerror: (() => void) | null; voice?: unknown; lang?: string; rate?: number };
let spoken: string[] = [];
let asked: string[] = [];
let hold = false;
const queue: Utt[] = [];

beforeAll(() => {
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = function (this: Utt, text: string) {
    this.text = text;
    this.onend = null;
    this.onerror = null;
  };
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      speaking: false,
      getVoices: () => [],
      speak: (u: Utt) => {
        if (!u.text) return;
        spoken.push(u.text);
        if (hold) queue.push(u);
        else setTimeout(() => u.onend?.(), 0);
      },
      cancel: () => {
        for (const u of queue.splice(0)) u.onend?.();
      },
    },
  });
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    const { text } = JSON.parse(String(init?.body));
    asked.push(text);
    return { ok: false, status: 503, json: async () => ({ fallback: true, say: text }) } as unknown as Response;
  }) as typeof fetch;
});

beforeEach(() => {
  spoken = [];
  asked = [];
  hold = false;
});

const tick = () => new Promise((r) => setTimeout(r, 5));

it("says an answer arriving in pieces, the first as soon as there's a sentence", async () => {
  const r = startReading("a1");
  r.feed("Sam and Jordan are both free after one o'clock. Sam fin");
  await tick();
  expect(spoken).toEqual(["Sam and Jordan are both free after one o'clock."]);
  r.feed("ishes in Burwood at half past twelve.\n| Who | When |\n| Sam | 1 |\nShall I book Sam?");
  r.finish();
  await r.done;
  expect(spoken.join(" ")).toBe(
    "Sam and Jordan are both free after one o'clock. Sam finishes in Burwood at half past twelve. The table's on the screen. Shall I book Sam?"
  );
});

it("reads one answer at a time: a second stops the first", async () => {
  hold = true;
  const first = readOut("one", "The first answer is quite long, and it goes on.");
  await tick();
  hold = false;
  const second = readOut("two", "The second answer.");
  await first;
  await second;
  expect(spoken[spoken.length - 1]).toBe("The second answer.");
});

it("after the route says no voice, the device's voice is used without asking again", async () => {
  await readOut("x", "One more thing to say.");
  const before = asked.length;
  await readOut("y", "And another.");
  expect(asked.length).toBe(before);
  expect(spoken[spoken.length - 1]).toBe("And another.");
});

it("stops when asked", async () => {
  hold = true;
  const r = readOut("z", "A sentence that is being said right now.");
  await tick();
  stopSpeaking();
  await r;
});
