/* The capture pill (D15), held still.

   What these pin: idle is a PILL whose text half is always first-class
   ("Add note", never an icon alone) and whose mic half only exists when
   voice does; the overlay names its target out loud — "Against: …" with a
   sheet open, "General note" otherwise; and the ENGINE contract survives
   the restyle untouched — the server applies what came back from the
   review card, every row editable, clarify still asks, and "Just keep the
   note" still keeps it. Nothing writes until a person says so. */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteCapture, type NoteAttachOption } from "../note-capture";
import type { NoteProposal } from "@/lib/workboard/note-brain";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const routeNote = jest.fn();
const applyNote = jest.fn();
const dismissNote = jest.fn();
const keepNoteOnJob = jest.fn();
const answerClarify = jest.fn();
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: (...a: unknown[]) => routeNote(...(a as [])),
  applyNote: (...a: unknown[]) => applyNote(...(a as [])),
  dismissNote: (...a: unknown[]) => dismissNote(...(a as [])),
  keepNoteOnJob: (...a: unknown[]) => keepNoteOnJob(...(a as [])),
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
  keepNoteOnJob.mockResolvedValue({ ok: true, summary: "Kept on the job's notes." });
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

  /* The routing call takes about seven measured seconds. What the card does
     for those seconds is a feature, not a gap between two screens — before
     this it showed the person their own words greyed out behind a button
     reading "Reading…", which is what a hang looks like too. */
  describe("while the router is thinking", () => {
    /* Hold the action open so the in-flight state can be inspected — every
       other test in this file resolves it before the first assertion, which
       is exactly why none of them covered this. */
    let pending: (() => void) | null = null;

    /* Settle it afterwards even when the test didn't. A transition left
       pending does not die with the component: React keeps it, `isPending`
       stays true, and the NEXT test in this file opens on a card whose Save
       button already says "Saving…". Nine of them failed that way before
       this hook existed. */
    afterEach(async () => {
      const release = pending;
      pending = null;
      if (release) await act(async () => release());
    });

    const holdRouting = () => {
      routeNote.mockImplementation(
        () =>
          new Promise((resolve) => {
            pending = () =>
              resolve({ ok: true, noteId: "n-1", proposal: proposal(), staff: [] });
          })
      );
    };

    const openAndHold = async () => {
      holdRouting();
      render(
        <NoteCapture target={{ kind: "visit", id: "v-1" }} targetLabel="Meridian" voiceEnabled={false} />
      );
      await userEvent.click(screen.getByRole("button", { name: /Add note/ }));
      const overlay = within(screen.getByRole("dialog"));
      await userEvent.type(overlay.getByPlaceholderText(/Tell Luke/), "Grilles for Smith St");
      await userEvent.click(overlay.getByRole("button", { name: "Sort this out" }));
      return { overlay };
    };

    it("says what it is doing, out loud and in the ribbon", async () => {
      const { overlay } = await openAndHold();
      expect(overlay.getByText("Sorting it out")).toBeInTheDocument();
      // a live region, so it reaches a screen reader rather than only an eye
      expect(overlay.getByRole("status")).toHaveAttribute("aria-live", "polite");
    });

    it("shows the note back as words, not trapped in a disabled box", async () => {
      const { overlay } = await openAndHold();
      expect(overlay.getByText("Grilles for Smith St")).toBeInTheDocument();
      expect(overlay.queryByPlaceholderText(/Tell Luke/)).not.toBeInTheDocument();
    });

    /* The rule this file has always had: never claim to be further along
       than you are. Shapes are allowed; a percentage, a step count or a
       named stage would be an invention. */
    it("makes no claim about progress", async () => {
      const { overlay } = await openAndHold();
      expect(overlay.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(overlay.queryByText(/%/)).not.toBeInTheDocument();
      expect(overlay.queryByText(/step \d/i)).not.toBeInTheDocument();
    });

    it("hands over to the review card once the proposal lands", async () => {
      const { overlay } = await openAndHold();
      expect(overlay.getByText("Sorting it out")).toBeInTheDocument();
      const release = pending!;
      pending = null;
      await act(async () => release());
      expect(overlay.queryByText("Sorting it out")).not.toBeInTheDocument();
      expect(overlay.getByText("Check it before it saves")).toBeInTheDocument();
    });
  });

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
      }),
      // no re-target: this note already knew what it was against
      undefined
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

  /* "Just keep the note" used to file the row at `dismissed`, where nothing
     in the app ever reads it — Isaac: "where the hell would the note go?"
     With a job named, the words go ON that job's notes, which the sheet
     shows. The button says which of the two it's about to do. */
  it("puts the words on the job's notes when the note is against one", async () => {
    const overlay = await openAndSort();
    await userEvent.click(overlay.getByRole("button", { name: "Put it on the job's notes" }));
    expect(keepNoteOnJob).toHaveBeenCalledWith("n-1", undefined);
    expect(dismissNote).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  /* Abandoning a parsed note has to settle it too. Left alone the row sits
     at "pending" forever, and nothing in the app reads pending notes — a
     proposal waiting on a review that can never happen. */
  it("walking away from a parsed note dismisses it rather than stranding it", async () => {
    const overlay = await openAndSort();
    await userEvent.click(overlay.getByRole("button", { name: "Discard" }));
    expect(dismissNote).toHaveBeenCalledWith("n-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closing before anything is parsed has nothing to dismiss", async () => {
    render(<NoteCapture target={{ kind: "none" }} voiceEnabled={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Add note/ }));
    // the ribbon's × — the only Discard present before a proposal exists
    await userEvent.click(
      within(screen.getByRole("dialog")).getAllByRole("button", { name: "Discard" })[0]
    );
    expect(dismissNote).not.toHaveBeenCalled();
  });
});

/* THE BLACK HOLE, PINNED SHUT.

   Isaac dictated two tasks and two bring-items from the board header, pressed
   Save, and the database recorded `applied: {}` — nothing was created and the
   pill said "Saved as a note." Both tasks were dropped because neither had a
   person on it; both bring-items were dropped because a general note has no
   job to hang a bring-list off. Every one of those drops was silent, and the
   button was enabled because SOMETHING was ticked.

   These are that exact note. */
describe("nothing is thrown away quietly", () => {
  const kingsford = () =>
    proposal({
      plainNote: "Site visit to Kingsford Medical Centre scheduled for 3 August.",
      tasks: [
        {
          title: "Organise filters for Kingsford Medical Centre",
          detail: "",
          assigneeId: null,
          assigneeHint: "Luke",
          dueHint: "before Monday's visit (3 August)",
          dueDate: "2026-08-03",
        },
        {
          title: "Hire scissor lift for Kingsford Medical Centre",
          detail: "",
          assigneeId: null,
          assigneeHint: "",
          dueHint: "",
          dueDate: "",
        },
      ],
      bringItems: ["2 x 20x20x2 filters", "Scissor lift (hired) for outdoor unit access"],
    });

  const openIt = async (attachOptions: NoteAttachOption[] = []) => {
    routeNote.mockResolvedValue({
      ok: true,
      noteId: "n-1",
      proposal: kingsford(),
      staff: [{ id: "s-1", fullName: "Dane Poulos" }],
    });
    render(
      <NoteCapture target={{ kind: "none" }} voiceEnabled={false} attachOptions={attachOptions} />
    );
    await userEvent.click(screen.getByRole("button", { name: /Add note/ }));
    const overlay = within(screen.getByRole("dialog"));
    /* The words matter here: the matcher runs on what was actually said, and
       this is Isaac's note — including "Center", which is not how the
       agreement spells it. */
    await userEvent.type(
      overlay.getByPlaceholderText(/Tell Luke/),
      "Luke needs to organize some filters for Kingsford Medical Center"
    );
    await userEvent.click(overlay.getByRole("button", { name: "Sort this out" }));
    return overlay;
  };

  it("will not let you save a note whose every row would be dropped", async () => {
    const overlay = await openIt();
    expect(overlay.getByRole("button", { name: "Save these" })).toBeDisabled();
    expect(overlay.getByText(/Every note goes on a job/)).toBeInTheDocument();
    expect(overlay.getByText(/2 tasks still need a person on them/)).toBeInTheDocument();
    expect(applyNote).not.toHaveBeenCalled();
  });

  it("unticking clears the per-row stops, though the job is still required", async () => {
    const overlay = await openIt();
    await userEvent.click(overlay.getByLabelText(/Skip Organise filters/));
    await userEvent.click(overlay.getByLabelText(/Skip Hire scissor lift/));
    expect(overlay.queryByText(/still need a person/)).not.toBeInTheDocument();
    // everything unticked is its own stop — and so is having no job
    expect(overlay.getByRole("button", { name: "Save these" })).toBeDisabled();
  });

  /* Isaac's call, choosing between four ways to give loose notes a home:
     a note must name a job. "Keep the words only" filed them where nothing
     reads them, and no wording makes that a destination. */
  it("won't keep a note on nothing — the words go on a job or they don't go", async () => {
    const overlay = await openIt();
    expect(overlay.getByRole("button", { name: /Put it on the job's notes/ })).toBeDisabled();
    expect(overlay.getByText(/Every note goes on a job/)).toBeInTheDocument();
    expect(keepNoteOnJob).not.toHaveBeenCalled();
  });

  it("assigning the people and saying which job it's against clears every stop", async () => {
    const overlay = await openIt([
      {
        kind: "agreement",
        id: "a-king",
        clientName: "Kingsford Medical Centre",
        label: "Ducted units — quarterly",
        siteLabel: null,
        jobNumber: null,
      },
    ]);
    await userEvent.click(overlay.getByRole("button", { name: /Pick a job|Change/ }));
    await userEvent.click(
      overlay.getByRole("option", { name: /Kingsford Medical Centre — Ducted units/ })
    );
    for (const s of overlay.getAllByRole("combobox")) {
      await userEvent.selectOptions(s, "s-1");
    }
    const save = overlay.getByRole("button", { name: "Save these" });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(applyNote).toHaveBeenCalledWith(
      "n-1",
      expect.objectContaining({
        tasks: [
          expect.objectContaining({ title: "Organise filters for Kingsford Medical Centre" }),
          expect.objectContaining({ title: "Hire scissor lift for Kingsford Medical Centre" }),
        ],
        bringItems: ["2 x 20x20x2 filters", "Scissor lift (hired) for outdoor unit access"],
      }),
      { kind: "agreement", id: "a-king" }
    );
  });

  /* Isaac told it "Dane's supposed to pick them up tomorrow" and the date box
     stayed empty. When the note names a day that can be worked out, the box
     carries it — and when it names one that can't ("before the next visit"),
     the words are shown instead of thrown away. */
  it("fills the date in when the note named a day it could work out", async () => {
    const overlay = await openIt();
    expect(overlay.getByLabelText(/Due date — Organise filters/)).toHaveValue("2026-08-03");
  });

  it("shows what was SAID when the phrase resolves to no date at all", async () => {
    routeNote.mockResolvedValue({
      ok: true,
      noteId: "n-1",
      proposal: proposal({
        tasks: [
          {
            title: "Chase the part",
            detail: "",
            assigneeId: null,
            assigneeHint: "",
            dueHint: "before the next visit",
            dueDate: "",
          },
        ],
      }),
      staff: [{ id: "s-1", fullName: "Dane Poulos" }],
    });
    render(<NoteCapture target={{ kind: "none" }} voiceEnabled={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Add note/ }));
    const overlay = within(screen.getByRole("dialog"));
    await userEvent.type(overlay.getByPlaceholderText(/Tell Luke/), "chase the part");
    await userEvent.click(overlay.getByRole("button", { name: "Sort this out" }));
    expect(overlay.getByText(/said: before the next visit/)).toBeInTheDocument();
    expect(overlay.getByLabelText(/Due date — Chase the part/)).toHaveValue("");
  });

  /* Isaac: "It should also confirm the job number or the job card that you
     are referring to." The note names a client out loud, so the card comes
     back with the job card it thinks that is — number and all — and the
     picker is already on it. Agreeing is a glance, not a search. */
  it("says which job card it thinks you meant, with its job number", async () => {
    const overlay = await openIt([
      {
        kind: "visit",
        id: "v-king",
        clientName: "Kingsford Medical Centre",
        label: "Ducted units — quarterly",
        siteLabel: "Consult wing",
        jobNumber: "1042",
      },
      {
        kind: "visit",
        id: "v-ardex",
        clientName: "Ardex Logistics",
        label: "Rooftop package units",
        siteLabel: "Bay 4",
        jobNumber: "1001",
      },
    ]);
    expect(overlay.getByText(/Sounds like/)).toBeInTheDocument();
    expect(
      overlay.getByText("Kingsford Medical Centre — Ducted units — quarterly · Consult wing · job #1042")
    ).toBeInTheDocument();
    // it's already ON it — the button offers to CHANGE it, not to choose one
    expect(overlay.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("saves against the job it confirmed, without anyone touching the picker", async () => {
    const overlay = await openIt([
      {
        kind: "visit",
        id: "v-king",
        clientName: "Kingsford Medical Centre",
        label: "Ducted units",
        siteLabel: null,
        jobNumber: "1042",
      },
    ]);
    for (const sel of overlay.getAllByRole("combobox")) {
      await userEvent.selectOptions(sel, "s-1");
    }
    await userEvent.click(overlay.getByRole("button", { name: "Save these" }));
    expect(applyNote).toHaveBeenCalledWith("n-1", expect.anything(), {
      kind: "visit",
      id: "v-king",
    });
  });

  it("a guess is a suggestion — setting it back to General note sticks", async () => {
    const overlay = await openIt([
      {
        kind: "visit",
        id: "v-king",
        clientName: "Kingsford Medical Centre",
        label: "Ducted units",
        siteLabel: null,
        jobNumber: "1042",
      },
    ]);
    await userEvent.click(overlay.getByRole("button", { name: "Change" }));
    await userEvent.click(overlay.getByRole("option", { name: /General note/ }));
    // and the stop comes back: every note goes on a job
    expect(overlay.getAllByText(/Every note goes on a job/).length).toBeGreaterThan(0);
    expect(overlay.getByRole("button", { name: "Save these" })).toBeDisabled();
  });

  it("won't guess between two jobs for the same client — it asks", async () => {
    const twin = (id: string, site: string) => ({
      kind: "visit" as const,
      id,
      clientName: "Kingsford Medical Centre",
      label: "Ducted units",
      siteLabel: site,
      jobNumber: null,
    });
    const overlay = await openIt([twin("v-a", "Consult wing"), twin("v-b", "Plant room")]);
    expect(overlay.getByText(/More than one job matches/)).toBeInTheDocument();
    expect(overlay.getByRole("button", { name: "Pick a job" })).toBeInTheDocument();
  });

  /* Isaac: "instead of saying change it above, I'll hit the wrong one. Just
     have a clickable change, which will open up a drop down search for jobs."
     A select is a list you navigate past the answer; this is one you narrow
     onto it. */
  describe("the job search", () => {
    const roster = [
      {
        kind: "visit" as const,
        id: "v-king",
        clientName: "Kingsford Medical Centre",
        label: "Ducted units — quarterly",
        siteLabel: "Consult wing",
        jobNumber: "1042",
      },
      {
        kind: "visit" as const,
        id: "v-ardex",
        clientName: "Ardex Logistics",
        label: "Rooftop package units",
        siteLabel: "Bay 4",
        jobNumber: "1001",
      },
      {
        kind: "agreement" as const,
        id: "a-mer",
        clientName: "Meridian Data",
        label: "Server room CRACs",
        siteLabel: null,
        jobNumber: null,
      },
    ];

    it("narrows the board to what you type, by number as readily as by name", async () => {
      const overlay = await openIt(roster);
      await userEvent.click(overlay.getByRole("button", { name: "Change" }));
      await userEvent.type(overlay.getByLabelText("Search jobs"), "1001");
      // scoped to the job list: the assignee <select>s carry options too
      const jobs = within(overlay.getByRole("listbox", { name: "Jobs" }));
      const shown = jobs.getAllByRole("option").map((o) => o.textContent);
      // General note always survives; only Ardex matches the number
      expect(shown).toHaveLength(2);
      expect(shown[1]).toContain("Ardex Logistics");
    });

    it("says so when nothing matches, rather than showing an empty box", async () => {
      const overlay = await openIt(roster);
      await userEvent.click(overlay.getByRole("button", { name: "Change" }));
      await userEvent.type(overlay.getByLabelText("Search jobs"), "belmont");
      expect(overlay.getByText(/Nothing on the board matches/)).toBeInTheDocument();
    });

    it("picking one closes the search and moves the confirmation onto it", async () => {
      const overlay = await openIt(roster);
      await userEvent.click(overlay.getByRole("button", { name: "Change" }));
      await userEvent.click(overlay.getByRole("option", { name: /Ardex Logistics/ }));
      expect(overlay.queryByLabelText("Search jobs")).not.toBeInTheDocument();
      expect(overlay.getByText(/Going on/)).toBeInTheDocument();
      expect(overlay.getByText(/Ardex Logistics — Rooftop package units · Bay 4 · job #1001/)).toBeInTheDocument();
    });

    /* Escape belongs to the innermost thing that's open. Discarding a whole
       reviewed note because you meant to shut a dropdown would be its own bug. */
    it("Escape closes the search, not the note", async () => {
      const overlay = await openIt(roster);
      await userEvent.click(overlay.getByRole("button", { name: "Change" }));
      await userEvent.keyboard("{Escape}");
      expect(overlay.queryByLabelText("Search jobs")).not.toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(dismissNote).not.toHaveBeenCalled();
      // and a second Escape now closes the note, as it always did
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("General note is always reachable — belonging to nothing is a real answer", async () => {
      const overlay = await openIt(roster);
      await userEvent.click(overlay.getByRole("button", { name: "Change" }));
      await userEvent.type(overlay.getByLabelText("Search jobs"), "zzzz");
      expect(overlay.getByRole("option", { name: /General note/ })).toBeInTheDocument();
    });
  });

  it("offers no picker at all on a board with nothing to attach to", async () => {
    const overlay = await openIt([]);
    expect(overlay.getByText("General note")).toBeInTheDocument();
    expect(overlay.queryByRole("option", { name: /General note — nothing/ })).not.toBeInTheDocument();
  });
});
