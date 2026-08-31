import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteToken } from "../note-token";
import { NoteScopeProvider } from "../note-context";

/* THE DIARY'S OWN WAY IN.

   Home's record used to carry the debrief bar at its head — the one control
   on the panel, and the wrong one: a debrief asks for the whole day, while
   the thing a record is missing is a way to add ONE line to it from where you
   are reading. This posture is that row, and what matters about it is that it
   is the same capture flow with the debrief flag DROPPED: a single thought
   gets read as a single note, which is what lets it land on a job or ask you
   a question back.

   The mic is a second button rather than a glyph on the first, because it
   does a different thing: `flow.talk()` opens the microphone with the card,
   so speaking is one press instead of a press and then another inside the
   card that just opened. */

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: jest.fn(),
  applyNote: jest.fn(),
  dismissNote: jest.fn(),
  keepNoteOnJob: jest.fn(),
  keepNoteForMe: jest.fn(),
  answerClarify: jest.fn(),
}));

const mount = (voiceEnabled = true) =>
  render(
    <NoteScopeProvider voiceEnabled={voiceEnabled}>
      <NoteToken as="entry" />
    </NoteScopeProvider>,
  );

describe("the diary entry row", () => {
  it("invites a line rather than announcing a debrief", () => {
    mount();
    expect(screen.getByRole("button", { name: /Add to the diary/ })).toBeInTheDocument();
    expect(screen.queryByText("Debrief the day")).toBeNull();
  });

  it("opens the capture card in place, and it is NOT a debrief", async () => {
    /* Same card the debrief opens — `wb2-capcard` carries every fill and
       button skin — but the ribbon says the ordinary thing, because a debrief
       ribbon here would promise a whole-day sort this row never asked for. */
    const user = userEvent.setup();
    const { container } = mount();
    await user.click(screen.getByRole("button", { name: /Add to the diary/ }));

    expect(container.querySelector(".wb2-capcard")).not.toBeNull();
    expect(screen.getByLabelText("Add to the diary")).toBeInTheDocument();
    expect(screen.queryByText("Tasks, knowledge & your notes")).toBeNull();
  });

  it("offers the microphone as its own control", () => {
    mount();
    expect(screen.getByRole("button", { name: "Say it instead" })).toBeInTheDocument();
  });

  it("has no microphone at all where voice is not configured", () => {
    /* The mic is always an enhancement — no key, no permission, no recorder.
       The row is still a control you can type into. */
    mount(false);
    expect(screen.queryByRole("button", { name: "Say it instead" })).toBeNull();
    expect(screen.getByRole("button", { name: /Add to the diary/ })).toBeInTheDocument();
  });
});
