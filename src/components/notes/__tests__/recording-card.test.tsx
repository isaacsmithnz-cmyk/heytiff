import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import type { DictationState } from "../dictation";
import { RecordingCard } from "../recording-card";

/* THE RECORDING CARD, ON ITS OWN.

   It stands in one place now, Tiff's ask bar (the capture sheet it was
   written for went with the old capture UI, 2026-09-27), and that bar's
   tests fake an engine whose buttons it never presses. So its contract is
   held here, against the card itself: the three ways out are the engine's
   own, wired one to one, and a wiring swapped for `stop` would read
   correctly on every label while it ended a recording somebody meant to
   redo or finish by typing. */

const engine = (): DictationState => ({
  recording: true,
  arming: false,
  transcribing: false,
  seconds: 3,
  interim: "",
  barsRef: createRef(),
  start: jest.fn(),
  stop: jest.fn(),
  handOver: jest.fn(),
  cancel: jest.fn(),
  restart: jest.fn(),
});

afterEach(cleanup);

it("starts again with the engine's restart, and does not end the recording", async () => {
  const user = userEvent.setup();
  const dict = engine();
  render(<RecordingCard dict={dict} text="" />);

  await user.click(screen.getByRole("button", { name: /start again/i }));

  expect(dict.restart).toHaveBeenCalledTimes(1);
  // the recovery, not the commit
  expect(dict.stop).not.toHaveBeenCalled();
  expect(dict.handOver).not.toHaveBeenCalled();
});

it("hands over to the keyboard with the engine's handOver", async () => {
  const user = userEvent.setup();
  const dict = engine();
  render(<RecordingCard dict={dict} text="" />);

  await user.click(screen.getByRole("button", { name: /type instead/i }));

  expect(dict.handOver).toHaveBeenCalledTimes(1);
  expect(dict.stop).not.toHaveBeenCalled();
});

/* DONE, NOT GO, AND NO SQUARE: the word says the microphone is closing, so a
   stop mark beside it would say it twice (Isaac, 2026-08-10). */
it("ends the recording with Done, which carries no glyph", async () => {
  const user = userEvent.setup();
  const dict = engine();
  render(<RecordingCard dict={dict} text="" />);

  const done = screen.getByRole("button", { name: "Done" });
  expect(done.querySelector("svg")).toBeNull();
  await user.click(done);

  expect(dict.stop).toHaveBeenCalledTimes(1);
  expect(dict.restart).not.toHaveBeenCalled();
  expect(dict.handOver).not.toHaveBeenCalled();
});

/* A FIRST leg has nothing to show, and an empty box in that space would put
   back the hole the 2026-08-10 audit closed. */
it("shows no words on a first recording into an empty box", () => {
  render(<RecordingCard dict={engine()} text="" />);

  expect(screen.queryByLabelText(/what you have said so far/i)).not.toBeInTheDocument();
});

/* A SECOND leg must not look like a first one (Isaac, 2026-08-10: "it looks
   like you're starting again because it doesn't show you what text it's
   already got on there"). What is shown is a record in ink, not a box to
   type into mid-sentence. */
it("shows the words already in the box while a second leg records", () => {
  render(<RecordingCard dict={engine()} text="middle rooftop unit tripped again" />);

  const said = screen.getByLabelText(/what you have said so far/i);
  expect(said).toHaveTextContent("middle rooftop unit tripped again");
  expect(said.tagName).toBe("P");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
