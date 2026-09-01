/* THE ONE TOKEN, held still.

   These carry forward what the capture pill's suite pinned — the engine
   contract survives the unification untouched: the server applies what came
   back from the review card, every row is editable, clarify still asks, and
   nothing writes until a person says so — plus the four things that are new:

     · the token is a CAPSULE. Typing is never demoted to an afterthought,
       and the mic half only exists when voice does.
     · TASKS NO LONGER NEED A JOB. Flags, bring-items, progress and issues
       still do. That asymmetry is the cascade, and it is the change most
       likely to be "tidied" back into a blanket rule by someone reading
       `blockers` on its own.
     · MY NOTES is the floor, offered only when nothing above can take it.
     · the STRIP commits instantly. A job card's note row must never make
       somebody wait seven seconds to write down a gate code. */

import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteToken } from "../note-token";
import { NoteScopeProvider, NoteScopeScreen } from "../note-context";
import { TiffButton } from "../tiff-button";
import type { NoteProposal } from "@/lib/workboard/note-brain";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

type AskHandlers = {
  onDelta: (t: string) => void;
  onTool: (l: string) => void;
  onError: (m: string) => void;
  onDone: () => void;
};
const askBrain = jest.fn(async (_input: unknown, h: AskHandlers) => {
  h.onTool("Reading the job's history");
  h.onDelta("Two open tasks, ");
  h.onDelta("oldest from Monday.");
  h.onDone();
});
jest.mock("@/lib/brain/ask-client", () => ({
  askBrain: (i: unknown, h: AskHandlers) => askBrain(i, h),
}));

const routeNote = jest.fn();
const applyNote = jest.fn();
const dismissNote = jest.fn();
const keepNoteOnJob = jest.fn();
const keepNoteForMe = jest.fn();
const answerClarify = jest.fn();
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: (...a: unknown[]) => routeNote(...(a as [])),
  applyNote: (...a: unknown[]) => applyNote(...(a as [])),
  dismissNote: (...a: unknown[]) => dismissNote(...(a as [])),
  keepNoteOnJob: (...a: unknown[]) => keepNoteOnJob(...(a as [])),
  keepNoteForMe: (...a: unknown[]) => keepNoteForMe(...(a as [])),
  answerClarify: (...a: unknown[]) => answerClarify(...(a as [])),
}));

const proposal = (over: Partial<NoteProposal> = {}): NoteProposal => ({
  tasks: [],
  bringItems: [],
  flags: [],
  progressBullets: [],
  commissioningEntries: [],
  issueEntries: [],
  kbEntries: [],
  noteLines: [],
  plainNote: "Middle rooftop unit tripped again.",
  clarify: null,
  ...over,
});

const task = (over = {}) => ({
  title: "Order the grilles",
  detail: "",
  assigneeId: "s-1",
  assigneeHint: "Luke",
  dueHint: "",
  dueDate: "",
  ...over,
});

/* The app's real shape: the layout provides the scope once, and the screen
   underneath REPORTS UP into it. Tests go through the same path, because the
   direction of that relationship is the thing this refactor changed. */
function mount(
  ui: React.ReactElement,
  scope: Partial<React.ComponentProps<typeof NoteScopeScreen>> & { voiceEnabled?: boolean } = {}
) {
  const { voiceEnabled = true, ...screen } = scope;
  return render(
    <NoteScopeProvider voiceEnabled={voiceEnabled}>
      <NoteScopeScreen {...screen} />
      {ui}
    </NoteScopeProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  routeNote.mockResolvedValue({
    ok: true,
    noteId: "n-1",
    proposal: proposal({ flags: [{ message: "Middle rooftop unit tripping", severity: "warn" }] }),
    staff: [{ id: "s-1", fullName: "Luke Mercer" }],
  });
  applyNote.mockResolvedValue({ ok: true, summary: "1 flag raised." });
  dismissNote.mockResolvedValue({ ok: true, summary: "Kept as a note." });
  keepNoteOnJob.mockResolvedValue({ ok: true, summary: "Kept on the job's notes." });
  keepNoteForMe.mockResolvedValue({ ok: true, summary: "Kept in your notes." });
});

describe("the capsule", () => {
  it("is two halves — typing is never an afterthought", () => {
    mount(<TiffButton />);
    expect(screen.getByLabelText(/Ask or tell Tiff/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ask or tell Tiff/)).toBeInTheDocument();
  });

  it("loses only the mic where the deployment can't hear you", () => {
    mount(<TiffButton />, { voiceEnabled: false });
    expect(screen.getByLabelText(/Ask or tell Tiff/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/starts listening/)).not.toBeInTheDocument();
  });

  it("names its target out loud when a job is in scope", async () => {
    mount(<TiffButton />, {
      target: { kind: "visit", id: "v-1" },
      targetLabel: "Meridian Data · CRACs",
    });
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    /* The tag says the job and nothing else. It used to read "Against:
       Meridian Data · CRACs", which is a sentence about a setting; a tag is
       the thing itself, and it is now something you can take off. */
    expect(screen.getByText("Meridian Data · CRACs")).toBeInTheDocument();
    expect(screen.getByLabelText(/take the tag off/i)).toBeInTheDocument();
  });

  it("says General note when it's standing on nothing", async () => {
    mount(<TiffButton />);
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    expect(screen.getByText("General note")).toBeInTheDocument();
  });

  it("routes with the scope's target — no caller passes one", async () => {
    mount(<TiffButton />, {
      target: { kind: "visit", id: "v-1" },
      targetLabel: "Meridian Data",
    });
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.type(screen.getByRole("textbox"), "the middle unit tripped again");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    expect(routeNote).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "visit", id: "v-1" }, source: "text" })
    );
  });

  /* ── THE CONTEXT TAG ──
     Standing on a job card is not the same as talking about that job. The tag
     is what makes the button usable everywhere without it quietly filing your
     supplier reminder against whatever site you happened to be looking at. */

  it("takes the tag off, and the note stops landing on the job", async () => {
    mount(<TiffButton />, {
      target: { kind: "visit", id: "v-1" },
      targetLabel: "Meridian Data · CRACs",
    });
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.click(screen.getByLabelText(/take the tag off/i));

    expect(screen.queryByText("Meridian Data · CRACs")).not.toBeInTheDocument();
    expect(screen.getByText("General note")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox"), "chase the supplier about the grilles");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    /* The half that is easy to miss: the chip can come off the ribbon while
       the note still files itself against the job, because two different
       places read the target. They read one now. */
    expect(routeNote).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "none" } })
    );
  });

  it("comes back next time — dropping it is for this note, not a setting", async () => {
    mount(<TiffButton />, {
      target: { kind: "visit", id: "v-1" },
      targetLabel: "Meridian Data · CRACs",
    });
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.click(screen.getByLabelText(/take the tag off/i));
    expect(screen.getByText("General note")).toBeInTheDocument();

    // close it and open it again, exactly as somebody would (the ribbon's
    // × — the idle stage has a Discard button of its own by the same name)
    await userEvent.click(screen.getByTitle("Discard"));
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    expect(screen.getByText("Meridian Data · CRACs")).toBeInTheDocument();
  });

  it("walking away from a parsed note dismisses it rather than stranding it", async () => {
    mount(<TiffButton />, { target: { kind: "visit", id: "v-1" } });
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.type(screen.getByRole("textbox"), "something");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    await screen.findByText("Check it before it saves");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(dismissNote).toHaveBeenCalledWith("n-1");
  });
});

describe("the engine's contract, unchanged", () => {
  const open = async (scope = {}) => {
    mount(<TiffButton />, scope);
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.type(screen.getByRole("textbox"), "note text");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    await screen.findByText("Check it before it saves");
  };

  it("applies what came back from the card, edits included — never the raw proposal", async () => {
    await open({ target: { kind: "visit", id: "v-1" }, targetLabel: "Meridian" });
    const row = screen.getByDisplayValue("Middle rooftop unit tripping");
    await userEvent.clear(row);
    await userEvent.type(row, "RTU-2 tripping");
    await userEvent.click(screen.getByRole("button", { name: "Save these" }));
    expect(applyNote).toHaveBeenCalledWith(
      "n-1",
      expect.objectContaining({ flags: [{ message: "RTU-2 tripping", severity: "warn" }] }),
      undefined
    );
  });

  it("dropping the only row disables Save — nothing is ever saved unticked", async () => {
    await open({ target: { kind: "visit", id: "v-1" }, targetLabel: "Meridian" });
    await userEvent.click(screen.getByRole("button", { name: /^Skip / }));
    expect(screen.getByRole("button", { name: "Save these" })).toBeDisabled();
  });

  it("clarify still asks, and a chip answer routes back through the brain", async () => {
    routeNote.mockResolvedValue({
      ok: true,
      noteId: "n-1",
      proposal: proposal({ clarify: { question: "Which Luke?", options: ["Luke M", "Luke T"] } }),
      staff: [],
    });
    answerClarify.mockResolvedValue({
      ok: true,
      noteId: "n-1",
      proposal: proposal(),
      staff: [],
    });
    await open({ target: { kind: "visit", id: "v-1" } });
    await userEvent.click(screen.getByRole("button", { name: "Luke M" }));
    expect(answerClarify).toHaveBeenCalledWith("n-1", "Luke M");
  });
});

describe("the cascade", () => {
  const openWith = async (over: Partial<NoteProposal>, scope = {}) => {
    routeNote.mockResolvedValue({
      ok: true,
      noteId: "n-1",
      proposal: proposal(over),
      staff: [{ id: "s-1", fullName: "Luke Mercer" }],
    });
    mount(<TiffButton />, scope);
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.type(screen.getByRole("textbox"), "note text");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    await screen.findByText("Check it before it saves");
  };

  it("A TASK NEEDS NO JOB — this is the whole change, and it must not regress", async () => {
    await openWith({ tasks: [task()], flags: [] });
    /* No target in scope, no job picked, one assigned task. Nothing here
       wants a job, so Save is live. Before the cascade this was refused
       outright with "every note goes on a job". */
    expect(screen.getByRole("button", { name: "Save these" })).toBeEnabled();
    expect(screen.queryByText(/hang off a job/)).not.toBeInTheDocument();
  });

  it("but a flag still does — it would render a dead end on the board", async () => {
    await openWith({ flags: [{ message: "unit tripping", severity: "warn" }] });
    expect(screen.getByText(/hang off a job/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save these" })).toBeDisabled();
  });

  it("an unassigned task is still refused, job or no job", async () => {
    await openWith({ tasks: [task({ assigneeId: null })] });
    expect(screen.getByText(/needs a person on it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save these" })).toBeDisabled();
  });

  it("offers MY NOTES as the floor when nothing above can take it", async () => {
    await openWith({ flags: [] });
    expect(screen.getByRole("button", { name: /Keep it in my notes/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Keep it in my notes/ }));
    /* No rows on this card, so there are no kept lines — the server falls
       back to the raw transcript, which is what "keep the note" always meant
       for a note that never grew rows. */
    expect(keepNoteForMe).toHaveBeenCalledWith("n-1", []);
  });

  it("and offers the JOB instead the moment there is one", async () => {
    await openWith({ flags: [] }, { target: { kind: "visit", id: "v-1" }, targetLabel: "Meridian" });
    expect(screen.getByRole("button", { name: /on the job's notes/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Keep it in my notes/ })).not.toBeInTheDocument();
  });

  it("says where the note is going, in the order it was aimed", async () => {
    await openWith({ tasks: [task()] }, { target: { kind: "visit", id: "v-1" }, targetLabel: "Meridian" });
    expect(screen.getByText(/Going on/)).toBeInTheDocument();
    expect(screen.getByText(/1 task/)).toBeInTheDocument();
  });
});

/* THE PICKER RIDES THE ROUTE (Isaac, 2026-08-08). A fault note dictated from
   the Tiff AI page came back as flags and readings — job-bound rows — with
   "say which one" as the advice and NO way to say it: the picker read the
   scope's job list, and only board screens pushed one. The roster now comes
   back with the routed note, so pinning works from every screen, or the
   ticked rows demote honestly into your own notes. */
describe("the picker rides the route", () => {
  const kingsford = {
    kind: "visit" as const,
    id: "v-9",
    clientName: "Kingsford Medical",
    label: "Quarterly service",
    siteLabel: null,
    jobNumber: "1042",
  };

  const openJobless = async (over: Partial<NoteProposal>, jobs: unknown[] = [kingsford], words = "note text") => {
    routeNote.mockResolvedValue({
      ok: true,
      noteId: "n-1",
      proposal: proposal(over),
      staff: [],
      jobs,
    });
    /* No scope at all — the shape of every screen without a board behind it. */
    mount(<TiffButton />);
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.type(screen.getByRole("textbox"), words);
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    await screen.findByText("Check it before it saves");
  };

  it("a job-bound note from a boardless screen can now SAY WHICH ONE", async () => {
    await openJobless(
      { plainNote: "", flags: [{ message: "Fuel pressure fault unresolved", severity: "warn" }] },
      [kingsford],
      "the unit will not regulate fuel pressure"
    );
    /* Still blocked — a jobless flag is a dead end on the board — but the
       advice is followable now: the picker is right there. */
    expect(screen.getByText(/hang off a job/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save these" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Pick a job" }));
    await userEvent.click(screen.getByRole("option", { name: /Kingsford Medical/ }));
    expect(screen.getByText(/Sounds like/)).toBeInTheDocument();
    expect(screen.queryByText(/hang off a job/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save these" }));
    expect(applyNote).toHaveBeenCalledWith("n-1", expect.anything(), { kind: "visit", id: "v-9" });
  });

  it("comes back already pointing at the job the words named", async () => {
    await openJobless(
      { plainNote: "", flags: [{ message: "Unit tripping", severity: "warn" }] },
      [kingsford],
      "Kingsford unit is playing up again"
    );
    /* Matching is plain code over the served roster — the card proposes,
       NUMBER AND ALL, and a person confirms. The full job line appears twice
       by design: the "Sounds like" confirm row, and the cascade's "Going on"
       destination at the foot. */
    expect(screen.getByText(/Sounds like/)).toBeInTheDocument();
    expect(screen.getByText(/Going on/)).toBeInTheDocument();
    expect(screen.getAllByText(/Quarterly service · job #1042/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Save these" })).toBeEnabled();
  });

  it("without candidates there is still no picker — nothing to pick from", async () => {
    await openJobless({ plainNote: "", flags: [{ message: "x", severity: "warn" }] }, []);
    expect(screen.queryByRole("button", { name: "Pick a job" })).not.toBeInTheDocument();
    expect(screen.getByText(/hang off a job/)).toBeInTheDocument();
  });

  it("KEEP IT IN MY NOTES keeps the ticked rows, edits included — the honest demotion", async () => {
    await openJobless({
      plainNote: "Unit still will not regulate.",
      flags: [{ message: "Fuel fault unresolved", severity: "warn" }],
      progressBullets: ["Checked the regulator", "Start-up ran 4.5 then dropped to 0.8"],
    });

    /* One row unticked, one row edited — what's kept must be what was
       REVIEWED, never what the model produced. */
    await userEvent.click(
      screen.getByRole("button", { name: "Skip Start-up ran 4.5 then dropped to 0.8" })
    );
    const flagRow = screen.getByDisplayValue("Fuel fault unresolved");
    await userEvent.clear(flagRow);
    await userEvent.type(flagRow, "Fuel regulation fault");

    await userEvent.click(screen.getByRole("button", { name: /Keep it in my notes/ }));
    expect(keepNoteForMe).toHaveBeenCalledWith("n-1", [
      "Unit still will not regulate.",
      "Fuel regulation fault",
      "Checked the regulator",
    ]);
  });
});

describe("the strip — a job card's note row", () => {
  function Harness() {
    const [v, setV] = useState("");
    const committed = useRef<string[]>([]);
    return (
      <>
        <NoteToken
          as="strip"
          label="a note for this visit"
          value={v}
          onChange={setV}
          onCommit={() => {
            committed.current.push(v);
            setV("");
          }}
        />
        <output data-testid="committed">{committed.current.join("|")}</output>
      </>
    );
  }

  it("COMMITS INSTANTLY — writing a gate code must never cost a routing call", async () => {
    mount(<Harness />);
    await userEvent.type(screen.getByLabelText("a note for this visit"), "Gate code 4417");
    await userEvent.click(screen.getByLabelText("Add a note for this visit"));
    expect(routeNote).not.toHaveBeenCalled();
    expect(screen.getByTestId("committed")).toHaveTextContent("Gate code 4417");
  });

  it("Enter commits too, and still doesn't route", async () => {
    mount(<Harness />);
    await userEvent.type(screen.getByLabelText("a note for this visit"), "Roof key at the desk{Enter}");
    expect(routeNote).not.toHaveBeenCalled();
  });

  it("offers the review only once the words look like a job for somebody", async () => {
    mount(<Harness />, { staffFirstNames: ["Luke"] });
    await userEvent.type(
      screen.getByLabelText("a note for this visit"),
      "Tell Luke he needs to order the grilles before Monday{Enter}"
    );
    expect(await screen.findByText(/something to do in this/)).toBeInTheDocument();
    /* Still nothing routed — the offer is an offer. */
    expect(routeNote).not.toHaveBeenCalled();
  });

  it("ignoring the offer costs nothing and leaves nothing behind", async () => {
    mount(<Harness />, { staffFirstNames: ["Luke"] });
    await userEvent.type(
      screen.getByLabelText("a note for this visit"),
      "Tell Luke he needs to order the grilles before Monday{Enter}"
    );
    await screen.findByText(/something to do in this/);
    await userEvent.click(screen.getByLabelText(/Ignore that/));
    expect(screen.queryByText(/something to do in this/)).not.toBeInTheDocument();
    expect(routeNote).not.toHaveBeenCalled();
  });

  it("taking the offer routes the committed words", async () => {
    mount(<Harness />, { staffFirstNames: ["Luke"] });
    await userEvent.type(
      screen.getByLabelText("a note for this visit"),
      "Tell Luke he needs to order the grilles before Monday{Enter}"
    );
    await screen.findByText(/something to do in this/);
    await userEvent.click(screen.getByRole("button", { name: "Have a look" }));
    expect(routeNote).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: "Tell Luke he needs to order the grilles before Monday",
      })
    );
  });
});

describe("the field", () => {
  function FieldHarness() {
    const [v, setV] = useState("");
    return <NoteToken as="field" label="access notes" value={v} onChange={setV} />;
  }

  it("is a plain box you can type into, mic or no mic", async () => {
    mount(<FieldHarness />, { voiceEnabled: false });
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "Gate code 4417");
    expect(box).toHaveValue("Gate code 4417");
    expect(screen.queryByLabelText(/Dictate/)).not.toBeInTheDocument();
  });

  it("says nothing about typed words — the sieve is for dictation", async () => {
    mount(<FieldHarness />, { staffFirstNames: ["Luke"] });
    await userEvent.type(
      screen.getByRole("textbox"),
      "Tell Luke he needs to order the grilles before Monday"
    );
    expect(screen.queryByText(/something to do in this/)).not.toBeInTheDocument();
  });
});

describe("the debrief", () => {
  const openDebrief = async (
    over: Partial<NoteProposal>,
    { jobs = [] as unknown[], words = "everything on my mind" } = {}
  ) => {
    routeNote.mockResolvedValue({
      ok: true,
      noteId: "n-1",
      proposal: proposal({ plainNote: "", ...over }),
      staff: [{ id: "s-1", fullName: "Luke Mercer" }],
      jobs,
    });
    mount(<NoteToken as="debrief" />);
    await userEvent.click(screen.getByRole("button", { name: "Debrief" }));
    await userEvent.type(screen.getByRole("textbox"), words);
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    await screen.findByText("Check it before it saves");
  };

  it("is a labelled button with a mic half — never an icon alone", () => {
    mount(<NoteToken as="debrief" />);
    expect(screen.getByRole("button", { name: "Debrief" })).toBeInTheDocument();
    expect(screen.getByLabelText("Start the debrief by talking")).toBeInTheDocument();
  });

  it("routes with the debrief flag — the brain is asked a different question", async () => {
    await openDebrief({ noteLines: ["chase the coil pricing"] });
    expect(routeNote).toHaveBeenCalledWith(expect.objectContaining({ debrief: true }));
  });

  it("leftovers review as 'Keeping in your notes', each line droppable", async () => {
    await openDebrief({ noteLines: ["chase the coil pricing", "long day tomorrow"] });
    expect(screen.getByText("Keeping in your notes")).toBeInTheDocument();
    expect(screen.getByDisplayValue("chase the coil pricing")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Skip long day tomorrow" }));
    expect(screen.getByRole("button", { name: "Include long day tomorrow" })).toBeInTheDocument();
  });

  it("saves the ticked lines through the confirmed payload", async () => {
    await openDebrief({ noteLines: ["chase the coil pricing"] });
    await userEvent.click(screen.getByRole("button", { name: "Save these" }));
    expect(applyNote).toHaveBeenCalledWith(
      "n-1",
      expect.objectContaining({ noteLines: ["chase the coil pricing"] }),
      undefined
    );
  });

  /* THE ONE THAT CAN'T BE TAKEN BACK. Everything else the debrief hides is
     hidden in the open — no picker drawn, no job named. Pinning is different:
     it is a WRITE, applyNote rewrites target_kind/target_id from whatever the
     card hands it, and jobHistory reads those rows back into the routing
     prompt. A day's braindump that mentions a client in passing would land on
     that client's card, invisibly, and there is no screen on which to notice
     it, let alone undo it. The roster only started reaching debriefs when the
     route began carrying it — before that this fired on nothing. */
  it("never pins itself to a job the words merely mentioned", async () => {
    await openDebrief(
      { noteLines: ["chase the coil pricing before Monday"] },
      {
        jobs: [
          {
            id: "v-9",
            kind: "visit",
            clientName: "Kingsford Medical",
            label: "Quarterly service",
            siteLabel: null,
            jobNumber: "1042",
          },
        ],
        words: "kingsford unit is playing up again, chase the coil pricing before monday",
      }
    );

    await userEvent.click(screen.getByRole("button", { name: "Save these" }));
    expect(applyNote).toHaveBeenCalledWith("n-1", expect.anything(), undefined);
  });

  it("offers no job picker and no keep-elsewhere door — Save is the one path", async () => {
    await openDebrief({ noteLines: ["a line"] });
    expect(screen.queryByRole("button", { name: /Pick a job/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Keep it in my notes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /on the job's notes/ })).not.toBeInTheDocument();
  });
});

describe("the LEARN lane on the review card", () => {
  const openWithKb = async () => {
    routeNote.mockResolvedValue({
      ok: true,
      noteId: "n-1",
      proposal: proposal({
        kbEntries: [
          { title: "Clearing an E6", body: "Power the outdoor board separately." },
        ],
      }),
      staff: [],
    });
    mount(<TiffButton />, {
      target: { kind: "visit", id: "v-1" },
      targetLabel: "Meridian",
    });
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.type(screen.getByRole("textbox"), "learned a trick");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    await screen.findByText("Check it before it saves");
  };

  it("shows the entry under 'Worth teaching everyone' with title and method editable", async () => {
    await openWithKb();
    expect(screen.getByText("Worth teaching everyone")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Clearing an E6")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Power the outdoor board separately.")).toBeInTheDocument();
    expect(screen.getByText(/your name and today/)).toBeInTheDocument();
  });

  it("publishes what came back from the card — edits included", async () => {
    await openWithKb();
    const body = screen.getByDisplayValue("Power the outdoor board separately.");
    await userEvent.clear(body);
    await userEvent.type(body, "Isolate the outdoor board first, then reset.");
    await userEvent.click(screen.getByRole("button", { name: "Save these" }));
    expect(applyNote).toHaveBeenCalledWith(
      "n-1",
      expect.objectContaining({
        kbEntries: [{ title: "Clearing an E6", body: "Isolate the outdoor board first, then reset." }],
      }),
      undefined
    );
  });

  it("unticking the only entry leaves nothing to save — Save goes dark, nothing publishes", async () => {
    await openWithKb();
    await userEvent.click(screen.getByRole("button", { name: "Don't publish Clearing an E6" }));
    expect(screen.getByRole("button", { name: "Save these" })).toBeDisabled();
    expect(applyNote).not.toHaveBeenCalled();
  });
});

describe("ask-mode — the same token answers questions", () => {
  it("a question streams an answer and never routes a note", async () => {
    mount(<TiffButton />, {
      target: { kind: "visit", id: "v-1" },
      targetLabel: "Meridian Data",
    });
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.type(screen.getByRole("textbox"), "what's outstanding here");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));

    expect(await screen.findByText("Two open tasks, oldest from Monday.")).toBeInTheDocument();
    /* The honest progress: the chip names a read that actually happened. */
    expect(screen.getByText("Reading the job's history")).toBeInTheDocument();
    /* The question stays visible above its answer. */
    expect(screen.getByText("what's outstanding here")).toBeInTheDocument();
    expect(routeNote).not.toHaveBeenCalled();
    /* And the loop was aimed at the job the token was standing on. */
    expect(askBrain.mock.calls[0][0]).toMatchObject({
      target: { kind: "visit", id: "v-1" },
      targetLabel: "Meridian Data",
    });
  });

  it("a note is still a note — no question, no ask", async () => {
    mount(<TiffButton />, { target: { kind: "visit", id: "v-1" } });
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.type(screen.getByRole("textbox"), "the middle unit tripped again");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    await screen.findByText("Check it before it saves");
    expect(askBrain).not.toHaveBeenCalled();
  });

  it("a debrief NEVER asks — a braindump is capture by definition", async () => {
    mount(<NoteToken as="debrief" />);
    await userEvent.click(screen.getByRole("button", { name: /Debrief/ }));
    await userEvent.type(screen.getByRole("textbox"), "what's left at Meridian");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    await screen.findByText("Check it before it saves");
    expect(askBrain).not.toHaveBeenCalled();
    expect(routeNote).toHaveBeenCalled();
  });

  it("an answer error lands as a sentence, not a dead sheet", async () => {
    askBrain.mockImplementationOnce(async (_i: unknown, h: AskHandlers) => {
      h.onError("Too busy right now — try again in a minute.");
    });
    mount(<TiffButton />);
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.type(screen.getByRole("textbox"), "what's open?");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    expect(
      await screen.findByText("Too busy right now — try again in a minute.")
    ).toBeInTheDocument();
  });

  it("Ask another clears the answer and returns to the box", async () => {
    mount(<TiffButton />);
    await userEvent.click(screen.getByLabelText(/Ask or tell Tiff/));
    await userEvent.type(screen.getByRole("textbox"), "what's open?");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    await screen.findByText(/oldest from Monday/);
    await userEvent.click(screen.getByRole("button", { name: "Ask another" }));
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByText(/oldest from Monday/)).not.toBeInTheDocument();
  });
});
