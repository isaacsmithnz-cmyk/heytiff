import { normaliseDraft, statusAfterChange, type ProposalDraft } from "../proposal";
import { acceptedWords, linesSteps, quoteSteps, type PriceState } from "../quote-steps";

/* Isaac, 2026-10-06: the progress line where Home has "Your day", and
   "You should still be able to manually approve" */

const draft = (more: Record<string, unknown> = {}): ProposalDraft =>
  normaliseDraft({
    intro: "Hi",
    options: [{ name: "Split", lines: ["Install"] }, { name: "Ducted", lines: ["Install"] }],
    pricingMode: "multiple_choice",
    checklist: [
      { key: "drain_to", state: "ask", answer: "" },
      { key: "pipe_colour", state: "known", answer: "White" },
    ],
    ...more,
  })!;
const when = (iso: string) => iso.slice(0, 10);
const words = (d: ProposalDraft | null, price: PriceState = { kind: "priced", left: 0 }) =>
  quoteSteps({ draft: d, drafted: d ? { at: "2026-10-06T01:00:00Z", changed: false } : null, price, when });

it("starts at the brief when nothing is drafted", () => {
  const { steps, next } = words(null);
  expect(steps.map((s) => [s.key, s.state])).toEqual([
    ["brief", "next"],
    ["questions", "todo"],
    ["buildup", "todo"],
    ["approved", "todo"],
    ["sent", "todo"],
    ["accepted", "todo"],
  ]);
  expect(next).toBeNull();
});

it("says what's open, then puts Approve next", () => {
  const { steps, next } = words(draft(), { kind: "priced", left: 3 });
  expect(steps.map((s) => `${s.label}: ${s.state}, ${s.words}`)).toEqual([
    "Brief: done, Drafted 2026-10-06",
    "Questions: due, 1 to answer",
    "Build-up: due, 3 still to price",
    "Approved: next, Not yet",
    "Sent: todo, Not yet",
    "Accepted: todo, Not yet",
  ]);
  expect(next).toBe("approve");
});

it("moves on to Mark sent, then to the client's yes", () => {
  const approved = draft({ status: { approvedAt: "2026-10-06T02:00:00Z", sentAt: null } });
  expect(words(approved).next).toBe("sent");
  expect(words(approved).steps[3]).toMatchObject({ state: "done", words: "Approved 2026-10-06" });
  const sent = draft({ status: { approvedAt: "2026-10-06T02:00:00Z", sentAt: "2026-10-07T02:00:00Z" } });
  expect(words(sent).next).toBe("accepted");
  expect(words(sent).steps[5]).toMatchObject({ state: "next" });
});

it("takes a yes by phone at any point, the steps before it left unmarked", () => {
  const { steps, next } = words(draft({ accepted: [1] }));
  expect(next).toBeNull();
  expect(steps.slice(3).map((s) => [s.state, s.words])).toEqual([
    ["todo", "Not marked"],
    ["todo", "Not marked"],
    ["done", "Option 2"],
  ]);
});

it("says the questions are answered, or that answers wait to be put in", () => {
  const answered = draft({ checklist: [{ key: "drain_to", state: "known", answer: "Downpipe", fresh: true }] });
  expect(words(answered).steps[1]).toMatchObject({ state: "due", words: "Putting the answers in" });
  const done = draft({ checklist: [{ key: "drain_to", state: "known", answer: "Downpipe" }] });
  expect(words(done).steps[1]).toMatchObject({ state: "done", words: "Answered" });
});

it("says why the build-up isn't priced, and nothing to someone without money access", () => {
  const d = draft();
  expect(words(d, { kind: "unset" }).steps[2]).toMatchObject({ state: "due", words: "Quoting isn't set" });
  expect(words(d, { kind: "empty" }).steps[2]).toMatchObject({ state: "due", words: "Nothing to price yet" });
  expect(words(d, { kind: "hidden" }).steps[2]).toMatchObject({ state: "todo", words: "" });
  expect(words(d).steps[2]).toMatchObject({ state: "done", words: "Every line priced" });
});

it("words the options accepted", () => {
  expect(acceptedWords([0])).toBe("Option 1");
  expect(acceptedWords([0, 2])).toBe("Options 1 and 3");
  expect(acceptedWords([0, 1, 2])).toBe("Options 1, 2 and 3");
});

it("keeps a status only when it says something, and a change keeps the day it was sent", () => {
  expect(draft({ status: { approvedAt: "not a date", sentAt: null } }).status).toBeNull();
  expect(draft({ status: { approvedAt: "2026-10-06T02:00:00Z" } }).status).toEqual({ approvedAt: "2026-10-06T02:00:00Z", sentAt: null });
  expect(statusAfterChange({ approvedAt: "2026-10-06T02:00:00Z", sentAt: null })).toBeNull();
  expect(statusAfterChange({ approvedAt: "2026-10-06T02:00:00Z", sentAt: "2026-10-07T02:00:00Z" })).toEqual({ approvedAt: null, sentAt: "2026-10-07T02:00:00Z" });
});

describe("a quote built on its kept lines", () => {
  it("is waiting on its first line", () => {
    expect(linesSteps({ lines: 0, unknown: 0, price: { kind: "empty" } }).map((s) => [s.key, s.state, s.words])).toEqual([
      ["brief", "next", "By hand"],
      ["questions", "todo", ""],
      ["buildup", "next", "No lines yet"],
      ["approved", "todo", ""],
      ["sent", "todo", ""],
      ["accepted", "todo", ""],
    ]);
  });
  it("says what's unknown and what's left to price, then that every line is priced", () => {
    const due = linesSteps({ lines: 40, unknown: 2, price: { kind: "priced", left: 2 } });
    expect(due[1]).toMatchObject({ state: "due", words: "2 to confirm" });
    expect(due[2]).toMatchObject({ state: "due", words: "2 to price" });
    const done = linesSteps({ lines: 40, unknown: 0, price: { kind: "priced", left: 0 } });
    expect(done[1]).toMatchObject({ state: "done", words: "None" });
    expect(done[2]).toMatchObject({ state: "done", words: "Every line priced" });
  });
  it("asks for Quoting when the business hasn't set what pricing needs", () => {
    expect(linesSteps({ lines: 3, unknown: 0, price: { kind: "unset" } })[2]).toMatchObject({ state: "due", words: "Set Quoting to price it" });
  });
  it("shows the option a person marked accepted", () => {
    expect(linesSteps({ lines: 3, unknown: 0, price: { kind: "priced", left: 0 }, accepted: [1] })[5]).toMatchObject({ key: "accepted", state: "done", words: "Option 2" });
  });
});
