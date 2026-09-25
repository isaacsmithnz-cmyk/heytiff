/* THE HISTORY AHEAD OF THE QUESTION. The Tiff modal asks in a conversation,
   and "and the one at Smith St?" means nothing without the turn before it.
   The loop is never run here (the house rule: no SDK mocks) — what it sends
   first is a pure function, and that is what is pinned. */

// the tools registry reaches Supabase at import; nothing here calls a tool
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { askMessages } from "../ask";

const text = (m: { content: { text: string }[] }) => m.content.map((c) => c.text);

describe("askMessages", () => {
  it("is the question alone, cache-marked, with no history", () => {
    expect(askMessages("what's open?")).toEqual([
      { role: "user", content: [{ type: "text", text: "what's open?", cache_control: { type: "ephemeral" } }] },
    ]);
  });

  it("puts the history ahead of the question, you as the user and Tiff as the assistant", () => {
    const m = askMessages("and the one at Smith St?", [
      { who: "you", text: "what's open at Meridian?" },
      { who: "tiff", text: "Two open tasks, oldest from Monday." },
    ]);
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(m.map(text)).toEqual([
      ["what's open at Meridian?"],
      ["Two open tasks, oldest from Monday."],
      ["and the one at Smith St?"],
    ]);
    // the marker stays on the question, so the history ahead of it is cached with it
    expect(m[0].content[0]).not.toHaveProperty("cache_control");
    expect(m[2].content[0]).toHaveProperty("cache_control", { type: "ephemeral" });
  });

  it("opens on the person, alternates, and joins a question to a turn of their own", () => {
    const m = askMessages("which one?", [
      { who: "tiff", text: "Done. A task for Luke." },
      { who: "you", text: "thanks" },
      { who: "you", text: "and the filters" },
      { who: "tiff", text: "  " },
    ]);
    expect(m.map((x) => x.role)).toEqual(["user"]);
    expect(text(m[0])).toEqual(["thanks", "and the filters", "which one?"]);
  });
});
