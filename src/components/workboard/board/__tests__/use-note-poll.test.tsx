/* The card looks again while a note is on its way, and stops once it has
   landed — or after POLL_MAX looks (two-way phase 2, PR B). */

import { act, render } from "@testing-library/react";
import { useState } from "react";
import { POLL_MAX, POLL_MS, somethingWaiting, useNoteStatePoll } from "../use-note-poll";
import { NOTE_WORDS, type NoteState } from "@/lib/integrations/sm8-note-plan";

const sending: NoteState = { key: "line.sending", text: NOTE_WORDS.line.sending, tone: null, acts: ["undo"] };
const sent: NoteState = { key: "line.sent", text: NOTE_WORDS.line.sent, tone: "ok", acts: ["undo"] };

function Card({ answers, kick = 0 }: { answers: NoteState[]; kick?: number }) {
  const [state, setState] = useState<NoteState>(sending);
  useNoteStatePoll({
    waiting: somethingWaiting([{ state }], {}),
    kick,
    read: async () => {
      read();
      setState(answers.shift() ?? state);
    },
  });
  return <p>{state.text}</p>;
}
const read = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  read.mockClear();
});
afterEach(() => jest.useRealTimers());

const tick = async () => {
  await act(async () => {
    jest.advanceTimersByTime(POLL_MS);
  });
};

describe("the card's poll", () => {
  it("(F) stops once the note is sent", async () => {
    render(<Card answers={[sending, sent]} />);
    await tick();
    await tick();
    expect(read).toHaveBeenCalledTimes(2);
    await tick();
    await tick();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("asks at most POLL_MAX times for one press, and a new press gets its own", async () => {
    const view = render(<Card answers={[]} />);
    for (let i = 0; i < POLL_MAX + 3; i++) await tick();
    expect(read).toHaveBeenCalledTimes(POLL_MAX);
    view.rerender(<Card answers={[]} kick={1} />);
    await tick();
    expect(read).toHaveBeenCalledTimes(POLL_MAX + 1);
  });

  it("never asks when nothing is on its way", async () => {
    expect(somethingWaiting([{ state: sent }, { state: null }], { f: { key: "flag.done", text: "x", tone: "ok", acts: [] } })).toBe(false);
    expect(somethingWaiting([], { f: { key: "flag.marking", text: "x", tone: null, acts: [] } })).toBe(true);
  });
});
