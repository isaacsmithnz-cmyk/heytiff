import * as React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteScopeProvider, NoteScopeScreen } from "@/components/notes/note-context";
import { TiffButton } from "@/components/notes/tiff-button";
import { GATHER_MS } from "@/components/ui/dot-field";
import { KEPT_AS_SAID, WHICH_JOB } from "@/lib/workboard/note-turns";
import { TiffModalProvider, useTiff, useTiffModalSwitch } from "../tiff-host";
import { CLOUD_MS } from "../use-conversation";

/* THE TIFF MODAL, walked as Isaac will walk it: the top bar's button, owner
   switched on, the microphone faked, every server action a stub. Nothing
   here reaches a model, ServiceM8 or the database.

   What these hold is the shape he approved in the prototype (v6–v16):
   opening means listening; Done makes your words a turn and Tiff thinks;
   a plan with nothing unclear files at once with Undo on it; a question
   holds the filing and takes a tap, a typed reply or a spoken one; the
   crosses take rows off; × and Escape leave without routing; and the
   waits have floors so the dots never jump. */

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/dashboard",
}));

const askBrain = jest.fn();
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: (...a: unknown[]) => askBrain(...a) }));

const routeNote = jest.fn();
const continueNote = jest.fn();
const fileNote = jest.fn();
const undoNote = jest.fn();
const keepWords = jest.fn();
const publishNoteKb = jest.fn();
const dismissNote = jest.fn();
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: (...a: unknown[]) => routeNote(...a),
  continueNote: (...a: unknown[]) => continueNote(...a),
  fileNote: (...a: unknown[]) => fileNote(...a),
  undoNote: (...a: unknown[]) => undoNote(...a),
  keepWords: (...a: unknown[]) => keepWords(...a),
  publishNoteKb: (...a: unknown[]) => publishNoteKb(...a),
  dismissNote: (...a: unknown[]) => dismissNote(...a),
  // the capture sheet's, which the button still carries for everyone else
  applyNote: jest.fn(),
  keepNoteOnJob: jest.fn(),
  keepNoteForMe: jest.fn(),
  answerClarify: jest.fn(),
}));

/* THE MICROPHONE, faked so it opens and closes like the real engine, and so
   a test can hand it a transcript the way the recorder does. */
type DictOpts = {
  onTranscript: (text: string, info: { capped: boolean }) => void;
  onError?: (message: string) => void;
};
const engine: { opts: DictOpts | null; interim: string } = { opts: null, interim: "" };
const mic = { start: jest.fn(), stop: jest.fn(), cancel: jest.fn(), restart: jest.fn(), handOver: jest.fn() };
jest.mock("@/components/notes/dictation", () => {
  const actual = jest.requireActual("@/components/notes/dictation");
  return {
    ...actual,
    useDictation: (opts: DictOpts) => {
      const react = jest.requireActual("react") as typeof import("react");
      const [recording, setRecording] = react.useState(false);
      engine.opts = opts;
      return {
        recording,
        arming: false,
        transcribing: false,
        handing: false,
        seconds: 3,
        interim: engine.interim,
        barsRef: react.createRef(),
        start: () => {
          mic.start();
          setRecording(true);
        },
        stop: () => {
          mic.stop();
          setRecording(false);
        },
        handOver: () => {
          mic.handOver();
          setRecording(false);
        },
        cancel: () => {
          mic.cancel();
          setRecording(false);
        },
        restart: mic.restart,
      };
    },
  };
});

/** Reduced motion on or off, as the browser would say it. */
function motion(still: boolean) {
  window.matchMedia = jest.fn().mockImplementation((q: string) => ({
    matches: still && q.includes("reduce"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function Switch({ on }: { on: boolean }) {
  useTiffModalSwitch(on);
  return null;
}

function Harness({ voice = true, on = true, extra }: { voice?: boolean; on?: boolean; extra?: React.ReactNode }) {
  return (
    <NoteScopeProvider voiceEnabled={voice}>
      <TiffModalProvider>
        <Switch on={on} />
        <TiffButton />
        {extra}
      </TiffModalProvider>
    </NoteScopeProvider>
  );
}

const topButton = () => screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!;
const dialog = () => screen.getByRole("dialog", { name: "Tiff" });
const flush = () => act(async () => {});

async function openModal(opts: { voice?: boolean; extra?: React.ReactNode } = {}) {
  const user = userEvent.setup();
  render(<Harness voice={opts.voice} extra={opts.extra} />);
  await user.click(topButton());
  return user;
}

/** Say something into the open microphone and press Done. */
async function say(user: ReturnType<typeof userEvent.setup>, words: string) {
  await user.click(within(dialog()).getByRole("button", { name: "Done" }));
  await act(async () => engine.opts!.onTranscript(words, { capped: false }));
}

const LUKE = { id: "s-luke", fullName: "Luke Ingold" };
const task = (title: string, assigneeId: string | null, extra: Record<string, unknown> = {}) => ({
  title,
  detail: "",
  assigneeId,
  assigneeHint: "",
  dueHint: "",
  dueDate: "",
  remindTime: "",
  remindKind: "at",
  ...extra,
});
const proposal = (p: Record<string, unknown>) => ({
  tasks: [],
  bringItems: [],
  flags: [],
  progressBullets: [],
  commissioningEntries: [],
  issueEntries: [],
  kbEntries: [],
  plainNote: "",
  say: "",
  clarify: null,
  ...p,
});
const turn = (who: "you" | "tiff", text: string) => ({ who, text, at: "2026-09-25T00:00:00.000Z" });
const routed = (p: Record<string, unknown>) => ({
  ok: true,
  noteId: "n1",
  proposal: proposal(p),
  staff: [LUKE],
  dayStart: "07:00",
});
const DONE = "Done. Luke puts the Bellevue Hill head on the ute.";
const filedOk = {
  ok: true,
  summary: "Saved.",
  doors: [{ kind: "tasks", count: 1, label: "1 task filed", ids: ["t1"] }],
  turns: [turn("you", "x"), turn("tiff", "Luke puts the Bellevue Hill head on the ute."), turn("tiff", DONE)],
};

beforeEach(() => {
  jest.clearAllMocks();
  engine.opts = null;
  engine.interim = "";
  motion(true);
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("opening", () => {
  it("opens listening from the top bar: the clock, a clear cross and Done", async () => {
    await openModal();
    const d = dialog();
    expect(mic.start).toHaveBeenCalledTimes(1);
    expect(d.querySelector(".wb2-recdot")).not.toBeNull();
    expect(within(d).getByText("0:03")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Clear what you said" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Done" })).toBeInTheDocument();
    // listening is a plain row: no box to type in yet
    expect(within(d).queryByRole("textbox", { name: "Reply to Tiff" })).toBeNull();
    // the capture sheet is not what opened
    expect(document.querySelector(".wb2-capcard")).toBeNull();
  });

  it("without a microphone it opens on the reply box and no mic runs", async () => {
    await openModal({ voice: false });
    expect(mic.start).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" })).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Done" })).toBeNull();
    // and no Tiff button to listen with, since nothing can hear
    expect(within(dialog()).queryByRole("button", { name: "Talk to Tiff" })).toBeNull();
  });

  it("goes to the reply box, and says why, when the microphone will not open", async () => {
    await openModal();
    await act(async () => engine.opts!.onError?.("Microphone access is blocked for this site."));
    const d = dialog();
    expect(within(d).getByRole("textbox", { name: "Reply to Tiff" })).toBeInTheDocument();
    expect(within(d).getByRole("alert")).toHaveTextContent("Microphone access is blocked for this site.");
    expect(within(d).queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("names where it was opened: the screen, or the job the screen is about", async () => {
    await openModal();
    expect(within(dialog()).getByText("Home")).toBeInTheDocument();
    cleanup();
    await openModal({
      extra: <NoteScopeScreen target={{ kind: "visit", id: "v1" }} targetLabel="Meridian Data, CRACs" />,
    });
    expect(within(dialog()).getByText("Meridian Data, CRACs")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Clear the tag — not about Meridian Data, CRACs" })).toBeInTheDocument();
  });

  it("leaves the crew on the capture sheet: switched off, the button opens what it always has", async () => {
    const user = userEvent.setup();
    render(<Harness on={false} />);
    await user.click(topButton());
    expect(screen.queryByRole("dialog", { name: "Tiff" })).toBeNull();
    expect(document.querySelector(".wb2-capcard")).not.toBeNull();
    expect(mic.start).not.toHaveBeenCalled();
  });
});

describe("talking", () => {
  it("Done makes your words a turn, folds the dock and says Tiff is sorting it out", async () => {
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await say(user, "Luke has the Bellevue Hill head on the ute");

    const d = dialog();
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(within(d).getByText("You")).toBeInTheDocument();
    expect(within(d).getByText("Luke has the Bellevue Hill head on the ute")).toBeInTheDocument();
    expect(d.querySelector(".tm-dock")).toBeNull();
    expect(within(d).getByRole("status")).toHaveTextContent("Tiff is sorting it out");
    expect(routeNote).toHaveBeenCalledWith({
      transcript: "Luke has the Bellevue Hill head on the ute",
      target: { kind: "none" },
      source: "voice",
      room: undefined,
      conversation: true,
    });
  });

  it("files a plan with nothing unclear at once, and says so with Undo", async () => {
    routeNote.mockResolvedValue(
      routed({
        say: "Luke puts the Bellevue Hill head on the ute.",
        tasks: [task("Put the Bellevue Hill head on the ute", LUKE.id, { dueDate: "2026-09-25", remindTime: "07:00" })],
      })
    );
    fileNote.mockResolvedValue(filedOk);
    const user = await openModal();
    await say(user, "Luke has the Bellevue Hill head on the ute");
    await flush();

    expect(fileNote).toHaveBeenCalledWith("n1", { leaveOut: [] });
    const d = dialog();
    expect(within(d).getByText(DONE)).toBeInTheDocument();
    expect(within(d).getByText("1 task filed")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    const row = d.querySelector(".tm-row-plan")!;
    expect(row).toHaveTextContent("Luke, Put the Bellevue Hill head on the ute, Fri 7:00");
    // a filed row has no cross: taking one back is Undo's job
    expect(within(d).queryByRole("button", { name: /^Clear Put the/ })).toBeNull();
    // and the dock is back as the reply box
    expect(within(d).getByRole("textbox", { name: "Reply to Tiff" })).toBeInTheDocument();
  });

  it("asks when something is unclear: the rows, the one that needs an answer, and quick answers", async () => {
    routeNote.mockResolvedValue(
      routed({
        say: "Luke has the head on the ute. Who books 3323 in?",
        tasks: [task("Put the head on the ute", LUKE.id), task("Book 3323 Randwick in", null)],
        clarify: { question: "Who books 3323 in?", options: ["Luke", "Me"] },
      })
    );
    continueNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await say(user, "head on the ute, and 3323 needs booking");
    await flush();

    const d = dialog();
    expect(fileNote).not.toHaveBeenCalled();
    expect(within(d).getByText("Luke has the head on the ute. Who books 3323 in?")).toBeInTheDocument();
    const rows = [...d.querySelectorAll(".tm-row-plan")];
    expect(rows[0]).toHaveTextContent("Luke, Put the head on the ute");
    expect(rows[1]).toHaveTextContent("Who Book 3323 Randwick in");
    expect(rows[1]).toHaveTextContent("Needs an answer");

    await user.click(within(d).getByRole("button", { name: "Luke" }));
    expect(continueNote).toHaveBeenCalledWith("n1", "Luke", []);
  });

  it("files straight past a job question when the answer is a job", async () => {
    routeNote.mockResolvedValue(routed({ say: "A flag on the job.", flags: [{ message: "Isolator loose", severity: "warn" }] }));
    fileNote
      .mockResolvedValueOnce({
        ok: false,
        error: WHICH_JOB,
        ask: { question: WHICH_JOB, options: [{ label: "#3323 Randwick", target: { kind: "job", id: "j1" } }] },
        turns: [turn("you", "x"), turn("tiff", "A flag on the job."), turn("tiff", WHICH_JOB)],
      })
      .mockResolvedValueOnce(filedOk);
    const user = await openModal();
    await say(user, "the isolator is loose");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "#3323 Randwick" }));
    await flush();
    expect(fileNote).toHaveBeenLastCalledWith("n1", { leaveOut: [], retarget: { kind: "job", id: "j1" } });
    expect(continueNote).not.toHaveBeenCalled();
  });

  it("asks the job question with the jobs attached, even when the model asked it", async () => {
    routeNote.mockResolvedValue(
      routed({ say: "Which job?", flags: [{ message: "Isolator loose", severity: "warn" }], clarify: { question: WHICH_JOB, options: [] } })
    );
    fileNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await say(user, "the isolator is loose");
    await flush();
    expect(fileNote).toHaveBeenCalledWith("n1", { leaveOut: [] });
  });

  it("taking the tag off sends the note against nothing", async () => {
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal({
      extra: <NoteScopeScreen target={{ kind: "visit", id: "v1" }} targetLabel="Meridian Data, CRACs" />,
    });
    await user.click(within(dialog()).getByRole("button", { name: "Clear the tag — not about Meridian Data, CRACs" }));
    expect(within(dialog()).queryByText("Meridian Data, CRACs")).toBeNull();
    await say(user, "order the grilles");
    expect(routeNote).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: "none" } }));
  });

  it("keeps the tag on by default: the note lands on what the screen is about", async () => {
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal({
      extra: <NoteScopeScreen target={{ kind: "visit", id: "v1" }} targetLabel="Meridian Data, CRACs" />,
    });
    await say(user, "order the grilles");
    expect(routeNote).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: "visit", id: "v1" } }));
  });

  it("sends a typed reply, and the box's Tiff button listens and then sends", async () => {
    routeNote.mockResolvedValue(
      routed({ say: "Who books it?", tasks: [task("Book 3323 in", null)], clarify: { question: "Who books it?", options: ["Me"] } })
    );
    continueNote.mockResolvedValue(
      routed({ say: "Who books it?", tasks: [task("Book 3323 in", null)], clarify: { question: "Who books it?", options: ["Me"] } })
    );
    const user = await openModal();
    await say(user, "3323 needs booking");
    await flush();

    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "Luke books it{Enter}");
    await flush();
    expect(continueNote).toHaveBeenNthCalledWith(1, "n1", "Luke books it", []);

    await user.click(within(dialog()).getByRole("button", { name: "Talk to Tiff" }));
    expect(mic.start).toHaveBeenCalledTimes(2);
    await say(user, "no, Luke does it Monday");
    await flush();
    expect(continueNote).toHaveBeenNthCalledWith(2, "n1", "no, Luke does it Monday", []);
  });

  it("a row's cross takes it off the plan and names it on the next call", async () => {
    routeNote.mockResolvedValue(
      routed({
        say: "Who books 3323?",
        tasks: [task("Put the head on the ute", LUKE.id), task("Book 3323 in", null)],
        clarify: { question: "Who books 3323?", options: ["Me"] },
      })
    );
    continueNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await say(user, "head on the ute and book 3323");
    await flush();

    await user.click(within(dialog()).getByRole("button", { name: "Clear Put the head on the ute from the plan" }));
    expect(within(dialog()).queryByText(/Put the head on the ute/)).toBeNull();
    // the row that needs an answer has no cross of its own
    expect(within(dialog()).queryByRole("button", { name: "Clear Book 3323 in from the plan" })).toBeNull();

    await user.click(within(dialog()).getByRole("button", { name: "Me" }));
    expect(continueNote).toHaveBeenCalledWith("n1", "Me", ["tasks:0"]);
  });
});

describe("after filing", () => {
  async function filed() {
    routeNote.mockResolvedValue(routed({ say: "Luke puts it on the ute.", tasks: [task("Head on the ute", LUKE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    const user = await openModal();
    await say(user, "Luke has the head on the ute");
    await flush();
    return user;
  }

  it("Undo takes it back and says what it took", async () => {
    undoNote.mockResolvedValue({ ok: true, summary: "1 task taken back.", turns: [] });
    const user = await filed();
    await user.click(within(dialog()).getByRole("button", { name: "Undo" }));
    await flush();
    expect(undoNote).toHaveBeenCalledWith("n1");
    expect(within(dialog()).getByText("1 task taken back.")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(within(dialog()).queryByText("1 task filed")).toBeNull();
  });

  it("a refused Undo says why, in its own sentence", async () => {
    const why = "Luke has already ticked off one of those, so nothing was taken back.";
    undoNote.mockResolvedValue({ ok: false, error: why });
    const user = await filed();
    await user.click(within(dialog()).getByRole("button", { name: "Undo" }));
    await flush();
    expect(within(dialog()).getByText(why)).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("a library entry waits for its own press", async () => {
    routeNote.mockResolvedValue(
      routed({ say: "Worth everyone knowing.", kbEntries: [{ title: "E6 clears on the outdoor board", body: "Power it separately." }] })
    );
    fileNote.mockResolvedValue({ ...filedOk, doors: [] });
    publishNoteKb.mockResolvedValue({ ok: true, documentId: "k1", summary: "Added to the Library." });
    const user = await openModal();
    await say(user, "got the E6 clear by powering the outdoor board separately");
    await flush();
    expect(dialog().querySelector(".tm-row-plan")).toHaveTextContent("For everyone, E6 clears on the outdoor board");
    await user.click(within(dialog()).getByRole("button", { name: "Add to the Library" }));
    await flush();
    expect(publishNoteKb).toHaveBeenCalledWith("n1", 0);
    expect(within(dialog()).getByText("In the Library")).toBeInTheDocument();
  });

  it("routing that failed files the words as said, and the page is refreshed on close", async () => {
    routeNote.mockResolvedValue({ ok: false, error: KEPT_AS_SAID, kept: true });
    const user = await openModal();
    await say(user, "something the router choked on");
    await flush();
    expect(within(dialog()).getByText(KEPT_AS_SAID)).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("words the server never got are kept as said", async () => {
    routeNote.mockRejectedValue(new Error("network"));
    keepWords.mockResolvedValue({ ok: true, noteId: "k9" });
    const user = await openModal();
    await say(user, "offline words");
    await flush();
    expect(keepWords).toHaveBeenCalledWith("offline words", undefined);
    expect(within(dialog()).getByText(KEPT_AS_SAID)).toBeInTheDocument();
  });
});

describe("asking", () => {
  it("streams an answer to a question, and a follow-up carries the conversation", async () => {
    askBrain.mockImplementationOnce((_input, h) => {
      h.onDelta("Luke is at 3323 ");
      h.onDelta("from 9:00.");
      h.onDone();
    });
    askBrain.mockImplementationOnce(() => {});
    const user = await openModal({ voice: false });
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "who's at 3323 tomorrow?{Enter}");
    await flush();

    expect(routeNote).not.toHaveBeenCalled();
    expect(askBrain.mock.calls[0][0]).toMatchObject({ question: "who's at 3323 tomorrow?" });
    expect(askBrain.mock.calls[0][0].history ?? []).toEqual([]);
    expect(within(dialog()).getByText("Luke is at 3323 from 9:00.")).toBeInTheDocument();

    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "and the day after?{Enter}");
    await flush();
    expect(askBrain.mock.calls[1][0].history).toEqual([
      { who: "you", text: "who's at 3323 tomorrow?" },
      { who: "tiff", text: "Luke is at 3323 from 9:00." },
    ]);
  });
});

describe("leaving", () => {
  it("Escape while listening bins the recording, routes nothing, and closes only the modal", async () => {
    const sheetHeard = jest.fn();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") sheetHeard();
    };
    document.addEventListener("keydown", onKey);
    const user = await openModal();
    await user.keyboard("{Escape}");
    await flush();
    document.removeEventListener("keydown", onKey);

    expect(mic.cancel).toHaveBeenCalled();
    expect(routeNote).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Tiff" })).toBeNull();
    expect(sheetHeard).not.toHaveBeenCalled();
  });

  it("× while listening does the same", async () => {
    const user = await openModal();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(mic.cancel).toHaveBeenCalled();
    expect(routeNote).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Tiff" })).toBeNull();
  });

  it("gives focus back to the button, and refreshes the page only when something was filed", async () => {
    const user = await openModal();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(topButton()).toHaveFocus();
    expect(refresh).not.toHaveBeenCalled();

    routeNote.mockResolvedValue(routed({ say: "Luke has it.", tasks: [task("Head on the ute", LUKE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    await user.click(topButton());
    await say(user, "Luke has the head");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(topButton()).toHaveFocus();
  });

  it("sets a waiting note aside when you walk away from Tiff's question", async () => {
    routeNote.mockResolvedValue(
      routed({ say: "Who books it?", tasks: [task("Book it", null)], clarify: { question: "Who books it?", options: [] } })
    );
    const user = await openModal();
    await say(user, "3323 needs booking");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(dismissNote).toHaveBeenCalledWith("n1");
    expect(fileNote).not.toHaveBeenCalled();
  });

  it("a transcript that lands after you have gone routes nothing", async () => {
    const user = await openModal();
    const late = () => engine.opts!;
    await user.click(within(dialog()).getByRole("button", { name: "Done" }));
    const opts = late();
    await user.keyboard("{Escape}");
    await flush();
    await act(async () => opts.onTranscript("words from a closed modal", { capped: false }));
    expect(routeNote).not.toHaveBeenCalled();
    expect(askBrain).not.toHaveBeenCalled();
  });

  it("does not set aside a note whose job was picked and is filing as you leave", async () => {
    routeNote.mockResolvedValue(routed({ say: "A flag on the job.", flags: [{ message: "Isolator loose", severity: "warn" }] }));
    let filedLate: (v: unknown) => void = () => {};
    fileNote
      .mockResolvedValueOnce({
        ok: false,
        error: WHICH_JOB,
        ask: { question: WHICH_JOB, options: [{ label: "#3323 Randwick", target: { kind: "job", id: "j1" } }] },
      })
      .mockReturnValueOnce(new Promise((r) => (filedLate = r)));
    const user = await openModal();
    await say(user, "the isolator is loose");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "#3323 Randwick" }));
    await user.keyboard("{Escape}");
    await flush();
    expect(dismissNote).not.toHaveBeenCalled();
    await act(async () => filedLate(filedOk));
    expect(dismissNote).not.toHaveBeenCalled();
  });

  it("sets aside a picked job's note that comes back unfiled after you have gone", async () => {
    routeNote.mockResolvedValue(routed({ say: "A flag on the job.", flags: [{ message: "Isolator loose", severity: "warn" }] }));
    let filedLate: (v: unknown) => void = () => {};
    fileNote
      .mockResolvedValueOnce({
        ok: false,
        error: WHICH_JOB,
        ask: { question: WHICH_JOB, options: [{ label: "#3323 Randwick", target: { kind: "job", id: "j1" } }] },
      })
      .mockReturnValueOnce(new Promise((r) => (filedLate = r)));
    const user = await openModal();
    await say(user, "the isolator is loose");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "#3323 Randwick" }));
    await user.keyboard("{Escape}");
    await flush();
    await act(async () => filedLate({ ok: false, error: "That job isn't on this workspace's board any more." }));
    expect(dismissNote).toHaveBeenCalledWith("n1");
  });

  it("sets aside a note whose answer comes back after you have gone", async () => {
    routeNote.mockResolvedValue(
      routed({ say: "Who books it?", tasks: [task("Book it", null)], clarify: { question: "Who books it?", options: ["Me"] } })
    );
    let answered: (v: unknown) => void = () => {};
    continueNote.mockReturnValue(new Promise((r) => (answered = r)));
    const user = await openModal();
    await say(user, "3323 needs booking");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "Me" }));
    await user.keyboard("{Escape}");
    await flush();
    expect(dismissNote).not.toHaveBeenCalled();
    await act(async () => answered(routed({ say: "You book it.", tasks: [task("Book it", "s-me")] })));
    expect(dismissNote).toHaveBeenCalledWith("n1");
    expect(fileNote).not.toHaveBeenCalled();
  });

  it("files nothing that comes back after you have gone", async () => {
    let answer: (v: unknown) => void = () => {};
    routeNote.mockReturnValue(new Promise((r) => (answer = r)));
    const user = await openModal();
    await say(user, "Luke has the head");
    await user.keyboard("{Escape}");
    await flush();
    await act(async () => answer(routed({ say: "Luke has it.", tasks: [task("Head", LUKE.id)] })));
    expect(fileNote).not.toHaveBeenCalled();
    expect(dismissNote).toHaveBeenCalledWith("n1");
  });
});

/** The host's API, read after each render (never assigned in one). */
const grabbed: { api: ReturnType<typeof useTiff> | null } = { api: null };
function Grab() {
  const api = useTiff();
  React.useEffect(() => {
    grabbed.api = api;
  });
  return null;
}

describe("one at a time", () => {
  it("a second Tiff button cannot open a second modal, and only the first reads as expanded", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        extra={
          <>
            <TiffButton where="sheet" />
            <Grab />
          </>
        }
      />
    );
    const [top, sheet] = screen.getAllByLabelText(/^Ask or tell Tiff/);
    await user.click(top!);
    expect(top).toHaveAttribute("aria-expanded", "true");
    expect(sheet).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      expect(grabbed.api!.open({ from: sheet! })).toBe(false);
    });
    await user.click(sheet!);
    expect(screen.getAllByRole("dialog", { name: "Tiff" })).toHaveLength(1);
    expect(mic.start).toHaveBeenCalledTimes(1);
  });

  it("two presses before a render open the first, not the second", async () => {
    render(
      <Harness
        extra={
          <>
            <TiffButton where="sheet" />
            <Grab />
          </>
        }
      />
    );
    const [top, sheet] = screen.getAllByLabelText(/^Ask or tell Tiff/);
    await act(async () => {
      grabbed.api!.open({ from: top!, id: "first" });
      grabbed.api!.open({ from: sheet!, id: "second" });
    });
    expect(screen.getAllByRole("dialog", { name: "Tiff" })).toHaveLength(1);
    expect(grabbed.api!.openedBy).toBe("first");
  });
});

describe("the waits have floors", () => {
  it("holds Tiff's answer until the dots have gathered and the cloud has turned", async () => {
    motion(false);
    jest.useFakeTimers();
    routeNote.mockResolvedValue(routed({ say: "Luke has it.", tasks: [task("Head on the ute", LUKE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<Harness />);
    await user.click(topButton());
    // the dots leave the button: the field is gathering, not simply there
    expect(dialog().querySelector('.dotf[data-stage="gather"]')).not.toBeNull();

    await say(user, "Luke has the head");
    await flush();
    expect(fileNote).toHaveBeenCalled();
    expect(screen.queryByText(DONE)).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(GATHER_MS + CLOUD_MS - 200);
    });
    expect(screen.queryByText(DONE)).toBeNull();
    expect(dialog().querySelector('.dotf[data-stage="cloud"]')).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(screen.getByText(DONE)).toBeInTheDocument();
  });

  it("pressed from the keyboard, nothing flies (law 8)", async () => {
    motion(false);
    render(<Harness />);
    await act(async () => {
      fireEvent.click(topButton(), { detail: 0 });
    });
    expect(dialog().querySelector('.dotf[data-stage="gather"]')).toBeNull();
    expect(dialog().querySelector('.dotf[data-stage="mark"]')).not.toBeNull();
  });

  it("under reduced motion nothing flies and nothing is held", async () => {
    routeNote.mockResolvedValue(routed({ say: "Luke has it.", tasks: [task("Head on the ute", LUKE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    const user = await openModal();
    expect(dialog().querySelector('.dotf[data-stage="gather"]')).toBeNull();
    expect(dialog().querySelector('.dotf[data-stage="mark"]')).not.toBeNull();
    await say(user, "Luke has the head");
    await flush();
    expect(screen.getByText(DONE)).toBeInTheDocument();
  });
});

describe("the blossom", () => {
  const anims: { el: Element; frames: Keyframe[] }[] = [];
  beforeEach(() => {
    anims.length = 0;
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[]) {
      anims.push({ el: this, frames });
      return { finished: Promise.resolve(), cancel() {} };
    };
    (HTMLElement.prototype as unknown as { getAnimations: unknown }).getAnimations = () => [];
  });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    delete (HTMLElement.prototype as unknown as { getAnimations?: unknown }).getAnimations;
  });

  it("grows from the pressed button and folds back toward it", async () => {
    motion(false);
    const user = await openModal();
    const m = dialog();
    expect(m.style.transformOrigin).not.toBe("");
    const grow = anims.find((a) => a.el === m)!;
    expect(grow.frames[0]).toMatchObject({ opacity: 0, transform: "scale(.94)" });
    expect(anims.some((a) => (a.el as HTMLElement).classList.contains("tm-scrim"))).toBe(true);

    await user.click(within(m).getByRole("button", { name: "Close" }));
    const fold = anims.filter((a) => a.el === m).at(-1)!;
    expect(fold.frames.at(-1)).toMatchObject({ opacity: 0, transform: "scale(.97)" });
    await flush();
    expect(screen.queryByRole("dialog", { name: "Tiff" })).toBeNull();
  });

  it("under reduced motion it only fades", async () => {
    await openModal();
    const grow = anims.find((a) => a.el === dialog())!;
    expect(grow.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it("lets go of the microphone the moment you close, not when the fold ends", async () => {
    motion(false);
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[]) {
      anims.push({ el: this, frames });
      return { finished: new Promise(() => {}), cancel() {} };
    };
    const user = await openModal();
    await user.keyboard("{Escape}");
    expect(mic.cancel).toHaveBeenCalled();
    // still folding: the modal is on the page, and nothing in it can be pressed
    expect(document.querySelector(".tm")).not.toBeNull();
    expect(document.querySelector(".tm")).toHaveAttribute("inert");
  });

  it("folds the dock away by its own box while Tiff thinks, and holds it until it has gone", async () => {
    motion(false);
    let fold: () => void = () => {};
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[]) {
      anims.push({ el: this, frames });
      const closing = (this as HTMLElement).classList.contains("tm-dock") && frames.at(-1)?.height === "0px";
      return { finished: closing ? new Promise<void>((r) => (fold = r)) : Promise.resolve(), cancel() {} };
    };
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    const dock = dialog().querySelector(".tm-dock")!;
    await say(user, "Luke has the head");
    const shut = anims.find((a) => a.el === dock && a.frames.at(-1)?.height === "0px");
    expect(shut?.frames.at(-1)).toMatchObject({ opacity: 0, height: "0px", paddingTop: "0px", paddingBottom: "0px" });
    expect(dialog().querySelector(".tm-dock")).toBe(dock);
    await act(async () => fold());
    expect(dialog().querySelector(".tm-dock")).toBeNull();
  });
});
