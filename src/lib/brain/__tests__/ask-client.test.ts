import { askBrain, movesTo } from "../ask-client";

/* The browser's half of the Tiff modal's follow-up: the conversation so far
   rides with the question, so the route can replay it ahead of it. Without
   it "and the day after?" reaches the brain meaning nothing. The route caps
   and filters what it is sent (ask-route.test); this holds that it is sent,
   and only when there is some. */

const done = { onDelta: () => {}, onTool: () => {}, onError: () => {}, onDone: () => {} };

function stubFetch() {
  // jsdom has no ReadableStream: a reader that ends at once is all this needs
  const body = { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) };
  const fetch = jest.fn(async () => ({ ok: true, body }) as unknown as Response);
  global.fetch = fetch as unknown as typeof global.fetch;
  return fetch;
}

const sent = (fetch: jest.Mock) => JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string);

it("sends the conversation ahead of the question", async () => {
  const fetch = stubFetch();
  await askBrain(
    {
      question: "and the day after?",
      history: [
        { who: "you", text: "who's at 3323 tomorrow?" },
        { who: "tiff", text: "Lyle, from 9:00." },
      ],
    },
    done
  );
  expect(sent(fetch).history).toEqual([
    { who: "you", text: "who's at 3323 tomorrow?" },
    { who: "tiff", text: "Lyle, from 9:00." },
  ]);
});

it("sends no history when there is none", async () => {
  const fetch = stubFetch();
  await askBrain({ question: "who's at 3323 tomorrow?" }, done);
  expect(sent(fetch)).not.toHaveProperty("history");
});

/* ── a move (universal Tiff 1B) ─────────────────────────────────────── */


/** A reader that hands over these NDJSON lines, then ends. */
function streamFetch(lines: object[]) {
  const chunks = [new TextEncoder().encode(lines.map((l) => JSON.stringify(l)).join("\n") + "\n")];
  const body = {
    getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined }) }),
  };
  global.fetch = jest.fn(async () => ({ ok: true, body }) as unknown as Response) as unknown as typeof global.fetch;
}

describe("movesTo — the second lock on where a move may go", () => {
  const origin = "https://heytiff.app";
  it("lets in the dashboard itself and any page inside it", () => {
    expect(movesTo("/dashboard", origin)).toBe("/dashboard");
    expect(movesTo("/dashboard/team/s-1", origin)).toBe("/dashboard/team/s-1");
    expect(movesTo("/dashboard/workboard?job=j-1", origin)).toBe("/dashboard/workboard?job=j-1");
  });
  it("keeps out other hosts, scripts and look-alikes", () => {
    expect(movesTo("javascript:alert(1)", origin)).toBeNull();
    expect(movesTo("//evil.example/dashboard", origin)).toBeNull();
    expect(movesTo("https://evil.example/dashboard", origin)).toBeNull();
    expect(movesTo("/dashboardx", origin)).toBeNull();
    expect(movesTo("/login", origin)).toBeNull();
  });
});

describe("a screen event", () => {
  it("hands over the move, and nothing after it reads as a cut-off", async () => {
    streamFetch([{ t: "delta", text: "Opening the Workboard." }, { t: "screen", href: "/dashboard/workboard", label: "Workboard" }]);
    const onScreen = jest.fn();
    const onError = jest.fn();
    await askBrain({ question: "take me to the workboard" }, { ...done, onScreen, onError });
    expect(onScreen).toHaveBeenCalledWith("/dashboard/workboard", "Workboard");
    expect(onError).not.toHaveBeenCalled();
  });

  it("turns an address it won't go to into an error, and moves nowhere", async () => {
    streamFetch([{ t: "screen", href: "https://evil.example/dashboard", label: "x" }, { t: "done" }]);
    const onScreen = jest.fn();
    const onError = jest.fn();
    await askBrain({ question: "go" }, { ...done, onScreen, onError });
    expect(onScreen).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("That couldn't be opened.");
  });
});
