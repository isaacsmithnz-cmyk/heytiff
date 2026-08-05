/**
 * @jest-environment node
 *
 * The parts of the answer call that don't need a network.
 *
 * The three system prompts are the whole difference between "here's what I
 * know" and "here's what your manual says" — a research answer that quietly
 * falls back on general knowledge is the failure this feature must not have,
 * so the instruction that prevents it is pinned rather than assumed. The rest
 * is shaping: a history window that begins on an assistant turn is a 400 in
 * the middle of somebody's follow-up.
 */

import { documentTitleOf, historyMessages, streamAnswer, systemPromptFor } from "../answer";

describe("the three instructions", () => {
  const general = systemPromptFor("general");
  const research = systemPromptFor("research");
  const miss = systemPromptFor("miss");

  it.each([
    ["general", general],
    ["research", research],
    ["miss", miss],
  ])("%s writes for an Australian trade audience", (_label, prompt) => {
    expect(prompt).toMatch(/Australian/);
  });

  /* The screen renders four things — paragraphs, bullets, numbered steps and
     pipe tables — and anything else arrives as literal characters in front of
     the reader. These assertions are the contract between this prompt and
     `answerBlocks`: loosen one and the other has to move with it. */
  it.each([
    ["general", general],
    ["research", research],
    ["miss", miss],
  ])("%s forbids the markup the screen can't render", (_label, prompt) => {
    // the prompt is line-wrapped, so a rule can straddle a newline
    expect(prompt).toMatch(/no\s+headings/i);
    expect(prompt).toMatch(/code\s+fences/i);
    expect(prompt).toMatch(/no\s+bold\s+or\s+italic/i);
  });

  it.each([
    ["general", general],
    ["research", research],
    ["miss", miss],
  ])("%s teaches the table syntax the renderer parses", (_label, prompt) => {
    // the header row and the rule beneath it are what answerBlocks looks for
    expect(prompt).toMatch(/\|\s*---\s*\|/);
    expect(prompt).toMatch(/numbered steps/i);
    expect(prompt).toMatch(/four columns or fewer/i);
  });

  it("research answers ONLY from the excerpts, and cites them", () => {
    expect(research).toMatch(/ONLY from them/);
    expect(research).toMatch(/cite the excerpt behind every factual claim/);
    expect(research).toMatch(/do not pad the gap with general knowledge/i);
  });

  it("general never pretends to be quoting a document", () => {
    expect(general).toMatch(/never write as though\s*\n?you are quoting one/);
    expect(general).not.toMatch(/excerpt/i);
  });

  /* State 2 of the brief's answer-quality states: the miss is said out loud,
     by the answer itself, so the banner and the words can't disagree. */
  it("a miss opens by saying the library had nothing, and names what would cover it", () => {
    expect(miss).toMatch(/nothing in it matched/);
    expect(miss).toMatch(/Open with one sentence saying exactly that/);
    expect(miss).toMatch(/name the kind of document/);
  });
});

describe("labelling an excerpt", () => {
  it("names one page", () => {
    expect(documentTitleOf({ title: "Fault book", pageFrom: 41, pageTo: 41 })).toBe("Fault book — p.41");
  });

  it("names a range when a chunk spans a page break", () => {
    expect(documentTitleOf({ title: "Install manual", pageFrom: 12, pageTo: 14 })).toBe(
      "Install manual — p.12–14"
    );
  });
});

describe("replaying prior turns", () => {
  it("keeps the window in order, with the roles the API takes", () => {
    expect(
      historyMessages([
        { role: "user", text: "why P8?" },
        { role: "assistant", text: "A piping fault." },
      ])
    ).toEqual([
      { role: "user", content: "why P8?" },
      { role: "assistant", content: "A piping fault." },
    ]);
  });

  /* A window of the last few turns can begin anywhere, and a conversation
     that opens on an assistant turn is a 400 rather than a bad answer. */
  it("drops leading assistant turns rather than opening on one", () => {
    expect(
      historyMessages([
        { role: "assistant", text: "…as I was saying" },
        { role: "user", text: "and in heating?" },
      ])
    ).toEqual([{ role: "user", content: "and in heating?" }]);
  });

  it("drops an empty turn and trims the rest", () => {
    expect(historyMessages([{ role: "user", text: "   " }, { role: "user", text: "  hi  " }])).toEqual([
      { role: "user", content: "hi" },
    ]);
  });

  it("nothing in, nothing out", () => {
    expect(historyMessages([])).toEqual([]);
  });
});

describe("with no key configured", () => {
  const key = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = key;
  });

  it("says so as an error event rather than throwing at the caller", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const events = [];
    for await (const event of streamAnswer({ question: "why P8?", history: [], documents: [], mode: "general" })) {
      events.push(event);
    }
    expect(events).toEqual([{ type: "error", message: expect.stringMatching(/isn't switched on/) }]);
  });

  it("an empty question is nothing at all, not an error", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const events = [];
    for await (const event of streamAnswer({ question: "  ", history: [], documents: [], mode: "general" })) {
      events.push(event);
    }
    expect(events).toEqual([]);
  });
});
