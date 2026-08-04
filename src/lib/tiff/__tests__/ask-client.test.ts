/* Reading the answer stream.

   THE SPLITTER IS THE PART THAT MUST NOT BE WRONG. `fetch`'s reader hands over
   whatever arrived, which routinely cuts a JSON object in half — a splitter
   that drops the tail loses a delta silently, and a splitter that emits it
   early throws a parse error in the middle of somebody's answer. Both failures
   look like "Tiff stopped mid-sentence", so the boundaries are pinned here
   rather than discovered live. */

import { askTiff, splitLines, type AskEvent } from "../ask-client";

describe("splitting a chunk into events", () => {
  it("returns whole lines and keeps the unfinished tail back", () => {
    expect(splitLines('{"t":"delta"}\n{"t":"do')).toEqual({
      lines: ['{"t":"delta"}'],
      rest: '{"t":"do',
    });
  });

  it("hands over every event in a chunk that carried several", () => {
    const { lines, rest } = splitLines('{"a":1}\n{"b":2}\n{"c":3}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    expect(rest).toBe("");
  });

  it("a chunk with no newline yet is all tail", () => {
    expect(splitLines('{"t":"del')).toEqual({ lines: [], rest: '{"t":"del' });
  });

  it("drops the blank line a trailing newline always produces", () => {
    expect(splitLines('{"a":1}\n\n{"b":2}\n').lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("rejoins an object split across two reads", () => {
    const first = splitLines('{"t":"delta","text":"he');
    const second = splitLines(`${first.rest}llo"}\n`);
    expect(first.lines).toEqual([]);
    expect(second.lines).toEqual(['{"t":"delta","text":"hello"}']);
  });

  it("nothing in, nothing out", () => {
    expect(splitLines("")).toEqual({ lines: [], rest: "" });
  });
});

/* ── the reader ──────────────────────────────────────────────────────────── */

const encoder = new TextEncoder();

/** A Response whose body yields exactly these byte chunks, in order. */
function streaming(chunks: string[], ok = true) {
  let i = 0;
  return {
    ok,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true },
      }),
    },
  } as unknown as Response;
}

/** Ask with the fetch mock already in place, and keep every event it reported. */
const collect = async (): Promise<AskEvent[]> => {
  const seen: AskEvent[] = [];
  await askTiff({
    question: "why P8?",
    research: true,
    history: [],
    onEvent: (e) => seen.push(e),
  });
  return seen;
};

beforeEach(() => {
  jest.restoreAllMocks();
});

describe("asking", () => {
  it("posts the question, the mode and the history to the ask route", async () => {
    const fetchMock = jest.fn(async () => streaming(['{"t":"done"}\n']));
    global.fetch = fetchMock as unknown as typeof fetch;

    await askTiff({
      question: "why P8?",
      research: true,
      history: [{ role: "user", text: "earlier" }],
      onEvent: () => {},
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tiff/ask");
    expect(JSON.parse(String(init.body))).toEqual({
      question: "why P8?",
      research: true,
      history: [{ role: "user", text: "earlier" }],
    });
  });

  it("reports every event, in order, across arbitrary chunk boundaries", async () => {
    global.fetch = (async () =>
      streaming([
        '{"t":"trace","categories":{},"winners":[],"terms":["P8"]}\n{"t":"del',
        'ta","text":"P8 is "}\n{"t":"delta","text":"a piping fault."}\n',
        '{"t":"done"}\n',
      ])) as unknown as typeof fetch;

    const seen = await collect();
    expect(seen.map((e) => e.t)).toEqual(["trace", "delta", "delta", "done"]);
    expect(seen.filter((e) => e.t === "delta").map((e) => (e as { text: string }).text)).toEqual([
      "P8 is ",
      "a piping fault.",
    ]);
  });

  it("reads a final event that arrived without a trailing newline", async () => {
    global.fetch = (async () => streaming(['{"t":"delta","text":"hi"}\n{"t":"done"}'])) as unknown as typeof fetch;
    expect((await collect()).map((e) => e.t)).toEqual(["delta", "done"]);
  });

  /* A line we can't read is a line we skip: one corrupt frame is not a
     failed answer. */
  it("skips a line that isn't JSON rather than failing the answer", async () => {
    global.fetch = (async () =>
      streaming(['{"t":"delta","text":"a"}\nnot json\n{"t":"done"}\n'])) as unknown as typeof fetch;
    expect((await collect()).map((e) => e.t)).toEqual(["delta", "done"]);
  });

  it("turns an unreachable server into an error event, not a rejection", async () => {
    global.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const seen = await collect();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ t: "err" });
    expect((seen[0] as { message: string }).message).toMatch(/reach Tiff/i);
  });

  it("forwards the sentence a refused request came back with", async () => {
    global.fetch = (async () => ({
      ok: false,
      json: async () => ({ error: "You don't have access to Tiff." }),
    })) as unknown as typeof fetch;

    expect(await collect()).toEqual([{ t: "err", message: "You don't have access to Tiff." }]);
  });

  it("falls back to the ladder when an error response says nothing useful", async () => {
    global.fetch = (async () => ({
      ok: false,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;

    expect((await collect())[0].t).toBe("err");
  });

  /* The caller asked for the abort, so there is nobody to apologise to. */
  it("ends silently when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    global.fetch = (async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;

    const seen: AskEvent[] = [];
    await askTiff({
      question: "q",
      research: false,
      history: [],
      signal: controller.signal,
      onEvent: (e) => seen.push(e),
    });
    expect(seen).toEqual([]);
  });
});
