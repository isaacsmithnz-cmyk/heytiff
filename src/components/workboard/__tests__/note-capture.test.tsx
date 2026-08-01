/* The capture pill (D15), held still.

   What these pin: idle is a PILL whose text half is always first-class
   ("Add note", never an icon alone) and whose mic half only exists when
   voice does; the overlay names its target out loud — "Against: …" with a
   sheet open, "General note" otherwise; and the ENGINE contract survives
   the restyle untouched — the server applies what came back from the
   review card, every row editable, clarify still asks, and "Just keep the
   note" still keeps it. Nothing writes until a person says so. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteCapture } from "../note-capture";
import type { NoteProposal } from "@/lib/workboard/note-brain";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const routeNote = jest.fn();
const applyNote = jest.fn();
const dismissNote = jest.fn();
const answerClarify = jest.fn();
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: (...a: unknown[]) => routeNote(...(a as [])),
  applyNote: (...a: unknown[]) => applyNote(...(a as [])),
  dismissNote: (...a: unknown[]) => dismissNote(...(a as [])),
  answerClarify: (...a: unknown[]) => answerClarify(...(a as [])),
}));

const proposal = (over: Partial<NoteProposal> = {}): NoteProposal => ({
  tasks: [],
  bringItems: [],
  flags: [],
  progressBullets: [],
  commissioningEntries: [],
  issueEntries: [],
  plainNote: "Middle rooftop unit tripped again.",
  clarify: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  routeNote.mockResolvedValue({
    ok: true,
    noteId: "n-1",
    proposal: proposal({
      flags: [{ message: "Middle rooftop unit tripping", severity: "warn" }],
    }),
    staff: [{ id: "s-1", fullName: "Dane Poulos" }],
  });
  applyNote.mockResolvedValue({ ok: true, summary: "1 flag raised." });
  dismissNote.mockResolvedValue({ ok: true, summary: "Kept as a note." });
});

describe("the pill", () => {
  it("typing is first-class; the mic half only exists when voice does", () => {
    const { rerender } = render(<NoteCapture target={{ kind: "none" }} voiceEnabled={false} />);
    expect(screen.getByRole("button", { name: /Add note/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record a note" })).not.toBeInTheDocument();

    rerender(<NoteCapture target={{ kind: "none" }} voiceEnabled />);
    expect(screen.getByRole("button", { name: "Record a note" })).toBeInTheDocument();
  });

  it("opens the overlay saying General note when nothing is in front of you", async () => {
    render(<NoteCapture target={{ kind: "none" }} voiceEnabled={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Add note/ }));
    const overlay = within(screen.getByRole("dialog"));
    expect(overlay.getByText("General note")).toBeInTheDocument();
  });

  it("names its target out loud when a sheet is open (D15's ribbon chip)", async () => {
    render(
      <NoteCapture
        target={{ kind: "visit", id: "v-1" }}
        targetLabel="Meridian Data · Server room CRACs"
        voiceEnabled={false}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Add note/ }));
    expect(screen.getByText("Against: Meridian Data · Server room CRACs")).toBeInTheDocument();
  });

  it("Escape discards — nothing routed, overlay gone", async () => {
    render(<NoteCapture target={{ kind: "none" }} voiceEnabled={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Add note/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(routeNote).not.toHaveBeenCalled();
  });
});

describe("the engine, through the new clothes", () => {
  const openAndSort = async () => {
    render(
      <NoteCapture target={{ kind: "visit", id: "v-1" }} targetLabel="Meridian" voiceEnabled={false} />
    );
    await userEvent.click(screen.getByRole("button", { name: /Add note/ }));
    const overlay = within(screen.getByRole("dialog"));
    await userEvent.type(
      overlay.getByPlaceholderText(/Tell Luke/),
      "Middle rooftop unit tripped again"
    );
    await userEvent.click(overlay.getByRole("button", { name: "Sort this out" }));
    return overlay;
  };

  it("routes with the target and renders the editable review in the overlay", async () => {
    const overlay = await openAndSort();
    expect(routeNote).toHaveBeenCalledWith({
      transcript: "Middle rooftop unit tripped again",
      target: { kind: "visit", id: "v-1" },
      source: "text",
    });
    expect(overlay.getByText("Flags for the board")).toBeInTheDocument();
    expect(overlay.getByDisplayValue("Middle rooftop unit tripping")).toBeInTheDocument();
  });

  it("applies what came back from the card — edits included, never the raw proposal", async () => {
    const overlay = await openAndSort();
    const flagInput = overlay.getByDisplayValue("Middle rooftop unit tripping");
    await userEvent.clear(flagInput);
    await userEvent.type(flagInput, "Middle RTU tripping on start");
    await userEvent.click(overlay.getByRole("button", { name: "Save these" }));
    expect(applyNote).toHaveBeenCalledWith(
      "n-1",
      expect.objectContaining({
        flags: [{ message: "Middle RTU tripping on start", severity: "warn" }],
      })
    );
    // saved → overlay closes, the pill wears the summary for a moment
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("1 flag raised.")).toBeInTheDocument();
  });

  it("dropping the only row disables Save — nothing is ever saved unticked", async () => {
    const overlay = await openAndSort();
    await userEvent.click(overlay.getByLabelText(/Skip Middle rooftop unit tripping/));
    expect(overlay.getByRole("button", { name: "Save these" })).toBeDisabled();
  });

  it("clarify still asks, and a chip answer routes back through the brain", async () => {
    routeNote.mockResolvedValueOnce({
      ok: true,
      noteId: "n-1",
      proposal: proposal({
        clarify: { question: "Which Dane?", options: ["Dane Poulos", "Dane Smith"] },
      }),
      staff: [],
    });
    answerClarify.mockResolvedValue({
      ok: true,
      noteId: "n-1",
      proposal: proposal({ flags: [{ message: "Sorted", severity: "info" }] }),
      staff: [],
    });
    const overlay = await openAndSort();
    expect(overlay.getByText("Which Dane?")).toBeInTheDocument();
    await userEvent.click(overlay.getByRole("button", { name: "Dane Poulos" }));
    expect(answerClarify).toHaveBeenCalledWith("n-1", "Dane Poulos");
  });

  it("Just keep the note keeps it", async () => {
    const overlay = await openAndSort();
    await userEvent.click(overlay.getByRole("button", { name: "Just keep the note" }));
    expect(dismissNote).toHaveBeenCalledWith("n-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
