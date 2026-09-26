/**
 * @jest-environment node
 */

/* THE CALENDAR'S READER, ON THE WIRE AND IN ITS SHAPING (H22). What it sends
   the model is read off the request body (the house rule: no test mocks
   `@anthropic-ai/sdk`, so `fetch` is replaced), and what comes back is held
   to what is true: a day that is not a day, a time that is not a time and a
   repeat the calendar cannot count all become nothing, never a guess.
   Nothing here reaches a model. */

import { RECORD_IN_ENGLISH } from "@/lib/lang/policy";
import { LINE_SCHEMA, lineContent, linePrompt, readCalendarLine, shapeLine } from "../line-brain";

type Body = {
  model: string;
  system: string;
  messages: { role: string; content: string }[];
  output_config: { effort: string; format: { type: string; schema: unknown } };
};

const sent: Body[] = [];
const realFetch = globalThis.fetch;
const realKey = process.env.ANTHROPIC_API_KEY;
/** The next answer: the model's JSON, a refusal, or a failed request. */
let reply: Record<string, unknown> | "refusal" | "not json" | null = null;

const CTX = { today: "2026-09-24", windowEnd: "2027-08-31" };

beforeEach(() => {
  sent.length = 0;
  reply = null;
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? "{}")));
    if (!reply) {
      return new Response(
        JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "not in tests" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    const text = reply === "refusal" ? "" : reply === "not json" ? "{not json" : JSON.stringify(reply);
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: reply === "refusal" ? [] : [{ type: "text", text }],
        stop_reason: reply === "refusal" ? "refusal" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = realKey;
});

const TOOLBOX = {
  title: "Toolbox talk",
  title_in_sentence: "toolbox talk",
  kind: "event",
  day: "",
  last_day: "",
  time: "06:45",
  end_time: "",
  repeat: "month",
  repeat_day: "thu",
  repeat_nth: "first",
  where: "",
  who: "",
};

describe("what the reader is sent", () => {
  it("sends the line, the day and the window, held to its schema at low effort, and the record rule", async () => {
    await readCalendarLine("  Toolbox talk first Thursday of the month, 6:45  ", CTX);
    expect(sent).toHaveLength(1);
    const body = sent[0]!;
    expect(body.model).toBe("claude-opus-5");
    expect(body.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: LINE_SCHEMA } });
    expect(body.system).toBe(linePrompt(CTX));
    expect(body.system).toContain("Today is Thursday 2026-09-24.");
    expect(body.system).toContain("The calendar runs to 2027-08-31.");
    expect(body.system).toContain(RECORD_IN_ENGLISH);
    expect(body.messages).toEqual([
      { role: "user", content: "Line:\nToolbox talk first Thursday of the month, 6:45" },
    ]);
  });

  it("sends each answer to Which day? after the line, and asks it read again", () => {
    expect(lineContent("toolbox talk", [" Thursday ", "the 8th"])).toBe(
      "Line:\ntoolbox talk\n\nYou asked: Which day?\nThey answered: Thursday\n\nYou asked: Which day?\nThey answered: the 8th\n\nRead the line again with what they answered.",
    );
  });

  it("asks for every field it reads, and nothing it does not", () => {
    expect(LINE_SCHEMA.required).toEqual(Object.keys(LINE_SCHEMA.properties));
    expect(LINE_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("what comes back", () => {
  it("reads his toolbox talk as a monthly repeat on the first Thursday, at 6:45", async () => {
    reply = TOOLBOX;
    expect(await readCalendarLine("Toolbox talk first Thursday of the month, 6:45", CTX)).toEqual({
      ok: true,
      line: {
        title: "Toolbox talk",
        titleInSentence: "toolbox talk",
        kind: "event",
        day: null,
        lastDay: null,
        time: "06:45",
        endTime: null,
        repeat: { every: "month", day: "thu", nth: 1 },
        where: null,
        who: null,
      },
    });
  });

  it("keeps the words when the reader refuses, answers nonsense or fails, and says so", async () => {
    reply = "refusal";
    expect(await readCalendarLine("x", CTX)).toEqual({ ok: false, error: "That line couldn't be read just now." });
    reply = "not json";
    expect(await readCalendarLine("x", CTX)).toEqual({ ok: false, error: "That line couldn't be read just now." });
    reply = { ...TOOLBOX, title: "  " };
    expect(await readCalendarLine("x", CTX)).toEqual({ ok: false, error: "That line couldn't be read just now." });
    reply = null;
    expect(await readCalendarLine("x", CTX)).toMatchObject({ ok: false });
  });

  it("calls nothing without a key, or without words", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await readCalendarLine("toolbox talk", CTX)).toEqual({
      ok: false,
      error: "Sorting for the calendar isn't switched on yet.",
    });
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(await readCalendarLine("   ", CTX)).toEqual({ ok: false, error: "There was nothing in that line." });
    expect(sent).toHaveLength(0);
  });
});

describe("shaping what the model said into what is true", () => {
  it("keeps a real day, a range's last day after it, and its hours", () => {
    expect(
      shapeLine({ ...TOOLBOX, repeat: "none", day: "2026-12-23", last_day: "2027-01-08", time: "07:30", end_time: "11:30" }),
    ).toMatchObject({ day: "2026-12-23", lastDay: "2027-01-08", time: "07:30", endTime: "11:30", repeat: null });
  });

  it("makes nothing of a day that is not a day, a last day before the first, or a time that is not a time", () => {
    expect(shapeLine({ ...TOOLBOX, repeat: "none", day: "2026-02-30", last_day: "", time: "6:45am" })).toMatchObject({
      day: null,
      time: null,
      endTime: null,
    });
    expect(shapeLine({ ...TOOLBOX, repeat: "none", day: "2026-10-08", last_day: "2026-10-01" })).toMatchObject({
      lastDay: null,
    });
    expect(shapeLine({ ...TOOLBOX, time: "", end_time: "07:15" })).toMatchObject({ time: null, endTime: null });
    expect(shapeLine({ ...TOOLBOX, end_time: "06:30" })).toMatchObject({ time: "06:45", endTime: null });
  });

  it("gives a shutdown no hours and no repeat", () => {
    expect(shapeLine({ ...TOOLBOX, kind: "shutdown", day: "2026-12-23", end_time: "08:00" })).toMatchObject({
      kind: "shutdown",
      time: null,
      endTime: null,
      repeat: null,
    });
  });

  it("refuses a repeat it cannot count, and gives a repeat no range", () => {
    expect(shapeLine({ ...TOOLBOX, repeat_nth: "" })!.repeat).toBeNull();
    expect(shapeLine({ ...TOOLBOX, repeat_day: "" })!.repeat).toBeNull();
    expect(shapeLine({ ...TOOLBOX, repeat: "week", repeat_nth: "" })!.repeat).toEqual({ every: "week", day: "thu" });
    expect(shapeLine({ ...TOOLBOX, day: "2026-11-05", last_day: "2026-11-06" })).toMatchObject({ lastDay: null });
  });

  it("uses the title inside a sentence only when it is the same words", () => {
    expect(shapeLine({ ...TOOLBOX, title_in_sentence: "toolbox  talk" })!.titleInSentence).toBe("toolbox talk");
    expect(shapeLine({ ...TOOLBOX, title_in_sentence: "the monthly meeting" })!.titleInSentence).toBe("Toolbox talk");
    expect(shapeLine({ ...TOOLBOX, title_in_sentence: "" })!.titleInSentence).toBe("Toolbox talk");
  });

  it("keeps to the table's widths, and makes nothing of an empty place or audience", () => {
    const x = shapeLine({ ...TOOLBOX, title: "t".repeat(200), title_in_sentence: "", where: "  ", who: "w".repeat(100) })!;
    expect(x.title).toHaveLength(120);
    expect(x.where).toBeNull();
    expect(x.who).toHaveLength(80);
  });

  it("is no line at all without a title", () => {
    expect(shapeLine({ ...TOOLBOX, title: "" })).toBeNull();
    expect(shapeLine(null)).toBeNull();
  });
});
