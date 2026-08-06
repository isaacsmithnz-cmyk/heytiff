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
import { NoteScopeProvider } from "../note-context";
import type { NoteProposal } from "@/lib/workboard/note-brain";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

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

function mount(
  ui: React.ReactElement,
  scope: Partial<React.ComponentProps<typeof NoteScopeProvider>> = {}
) {
  return render(
    <NoteScopeProvider voiceEnabled {...scope}>
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
    mount(<NoteToken as="capsule" label="a note" />);
    expect(screen.getByLabelText("Type a note")).toBeInTheDocument();
    expect(screen.getByLabelText("Say a note")).toBeInTheDocument();
  });

  it("loses only the mic where the deployment can't hear you", () => {
    mount(<NoteToken as="capsule" label="a note" />, { voiceEnabled: false });
    expect(screen.getByLabelText("Type a note")).toBeInTheDocument();
    expect(screen.queryByLabelText("Say a note")).not.toBeInTheDocument();
  });

  it("names its target out loud when a job is in scope", async () => {
    mount(<NoteToken as="capsule" label="a note" />, {
      target: { kind: "visit", id: "v-1" },
      targetLabel: "Meridian Data · CRACs",
    });
    await userEvent.click(screen.getByLabelText("Type a note"));
    expect(screen.getByText("Against: Meridian Data · CRACs")).toBeInTheDocument();
  });

  it("says General note when it's standing on nothing", async () => {
    mount(<NoteToken as="capsule" label="a note" />);
    await userEvent.click(screen.getByLabelText("Type a note"));
    expect(screen.getByText("General note")).toBeInTheDocument();
  });

  it("routes with the scope's target — no caller passes one", async () => {
    mount(<NoteToken as="capsule" label="a note" />, {
      target: { kind: "visit", id: "v-1" },
      targetLabel: "Meridian Data",
    });
    await userEvent.click(screen.getByLabelText("Type a note"));
    await userEvent.type(screen.getByRole("textbox"), "the middle unit tripped again");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    expect(routeNote).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "visit", id: "v-1" }, source: "text" })
    );
  });

  it("walking away from a parsed note dismisses it rather than stranding it", async () => {
    mount(<NoteToken as="capsule" label="a note" />, { target: { kind: "visit", id: "v-1" } });
    await userEvent.click(screen.getByLabelText("Type a note"));
    await userEvent.type(screen.getByRole("textbox"), "something");
    await userEvent.click(screen.getByRole("button", { name: "Sort this out" }));
    await screen.findByText("Check it before it saves");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(dismissNote).toHaveBeenCalledWith("n-1");
  });
});

describe("the engine's contract, unchanged", () => {
  const open = async (scope = {}) => {
    mount(<NoteToken as="capsule" label="a note" />, scope);
    await userEvent.click(screen.getByLabelText("Type a note"));
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
    mount(<NoteToken as="capsule" label="a note" />, scope);
    await userEvent.click(screen.getByLabelText("Type a note"));
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
    expect(keepNoteForMe).toHaveBeenCalledWith("n-1");
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
