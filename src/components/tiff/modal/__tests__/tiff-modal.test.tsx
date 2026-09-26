import * as React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteScopeProvider, NoteScopeScreen } from "@/components/notes/note-context";
import { TiffButton } from "@/components/notes/tiff-button";
import { GATHER_MS } from "@/components/ui/dot-field";
import { KEPT_AS_SAID, WHICH_JOB } from "@/lib/workboard/note-turns";
import { TiffModalProvider, useTiff, useTiffModalSwitch } from "../tiff-host";
import { CLOUD_MS, NOT_REACHED } from "../use-conversation";

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
const fileCalendarLine = jest.fn();
const noteOnCalendarEvents = jest.fn();
const undoCalendarLine = jest.fn();
jest.mock("@/app/actions/calendar", () => ({
  fileCalendarLine: (...a: unknown[]) => fileCalendarLine(...a),
  noteOnCalendarEvents: (...a: unknown[]) => noteOnCalendarEvents(...a),
  undoCalendarLine: (...a: unknown[]) => undoCalendarLine(...a),
}));

/* THE MICROPHONE, faked so it opens and closes like the real engine, and so
   a test can hand it a transcript the way the recorder does. */
type DictOpts = {
  onTranscript: (text: string, info: { capped: boolean }) => void;
  onError?: (message: string) => void;
};
const engine: {
  opts: DictOpts | null;
  interim: string;
  /** Whether start() opens the mic. False is a mic still arming. */
  opens: boolean;
  /** Words arriving while you talk, as the live transport sends them. */
  say: ((words: string) => void) | null;
} = { opts: null, interim: "", opens: true, say: null };
const mic = { start: jest.fn(), stop: jest.fn(), cancel: jest.fn(), restart: jest.fn(), handOver: jest.fn() };
jest.mock("@/components/notes/dictation", () => {
  const actual = jest.requireActual("@/components/notes/dictation");
  return {
    ...actual,
    useDictation: (opts: DictOpts) => {
      const react = jest.requireActual("react") as typeof import("react");
      const [recording, setRecording] = react.useState(false);
      const [interim, setInterim] = react.useState(engine.interim);
      engine.opts = opts;
      engine.say = setInterim;
      return {
        recording,
        arming: false,
        transcribing: false,
        handing: false,
        seconds: 3,
        interim,
        barsRef: react.createRef(),
        start: () => {
          mic.start();
          if (engine.opens) setRecording(true);
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
/** The conversation itself: Tiff's line is also in the status line. */
const convo = () => dialog().querySelector<HTMLElement>(".tm-turns")!;
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
  engine.opens = true;
  engine.say = null;
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
    expect(within(convo()).getByText(DONE)).toBeInTheDocument();
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
    expect(within(convo()).getByText("Luke has the head on the ute. Who books 3323 in?")).toBeInTheDocument();
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
    // with the words you picked, which the note keeps as your turn
    expect(fileNote).toHaveBeenLastCalledWith("n1", {
      leaveOut: [],
      retarget: { kind: "job", id: "j1" },
      answer: "#3323 Randwick",
    });
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
    expect(within(convo()).getByText("1 task taken back.")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(within(dialog()).queryByText("1 task filed")).toBeNull();
  });

  it("a refused Undo says why, in its own sentence", async () => {
    const why = "Luke has already ticked off one of those, so nothing was taken back.";
    undoNote.mockResolvedValue({ ok: false, error: why });
    const user = await filed();
    await user.click(within(dialog()).getByRole("button", { name: "Undo" }));
    await flush();
    expect(within(convo()).getByText(why)).toBeInTheDocument();
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
    expect(within(convo()).getByText(KEPT_AS_SAID)).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  /* Filed as said is filed: the diary lands it lit as the modal closes,
     as it does a note Tiff filed or one kept when the server was out. */
  it("lands a note routing failed on, kept as said, in the diary as the modal closes", async () => {
    routeNote.mockResolvedValue({ ok: false, error: KEPT_AS_SAID, kept: true, noteId: "k7" });
    const user = userEvent.setup();
    render(<Harness extra={<Grab />} />);
    await user.click(topButton());
    await say(user, "something the router choked on");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(grabbed.api!.landed).toEqual({ noteIds: ["k7"], ids: [], keyboard: false });
  });

  /* What lands says where it was said and whether the keyboard drove it,
     so the page underneath brings forward only what is its to, and with
     no slide for a key (law 8). */
  describe("what the landing says of itself", () => {
    const filedThenClosed = async (close: (user: ReturnType<typeof userEvent.setup>) => Promise<void>) => {
      routeNote.mockResolvedValue({ ok: false, error: KEPT_AS_SAID, kept: true, noteId: "k7" });
      const user = userEvent.setup();
      render(<Harness extra={<Grab />} />);
      await user.click(topButton());
      await say(user, "something the router choked on");
      await flush();
      await close(user);
      await flush();
      return grabbed.api!.landed;
    };

    it("was driven by the keyboard when Escape closed it", async () => {
      const landed = await filedThenClosed((user) => user.keyboard("{Escape}"));
      expect(landed).toMatchObject({ noteIds: ["k7"], keyboard: true });
    });

    it("was driven by the keyboard when × was pressed with a key", async () => {
      const landed = await filedThenClosed(async (user) => {
        within(dialog()).getByRole("button", { name: "Close" }).focus();
        await user.keyboard("{Enter}");
      });
      expect(landed).toMatchObject({ noteIds: ["k7"], keyboard: true });
    });

    it("was driven by the keyboard when it was opened with a key, however it closed", async () => {
      routeNote.mockResolvedValue({ ok: false, error: KEPT_AS_SAID, kept: true, noteId: "k7" });
      const user = userEvent.setup();
      render(<Harness voice={false} extra={<Grab />} />);
      await act(async () => {
        grabbed.api!.open({ from: topButton(), words: "the router chokes on this", keyboard: true });
      });
      await flush();
      await user.click(within(dialog()).getByRole("button", { name: "Close" }));
      await flush();
      expect(grabbed.api!.landed).toMatchObject({ noteIds: ["k7"], keyboard: true });
    });

    it("says the room it was had in", async () => {
      routeNote.mockResolvedValue({ ok: false, error: KEPT_AS_SAID, kept: true, noteId: "k7" });
      const user = userEvent.setup();
      render(<Harness voice={false} extra={<Grab />} />);
      await act(async () => {
        grabbed.api!.open({ from: topButton(), words: "toolbox talk every first Thursday", room: "calendar" });
      });
      await flush();
      await user.click(within(dialog()).getByRole("button", { name: "Close" }));
      await flush();
      expect(grabbed.api!.landed).toEqual({ noteIds: ["k7"], ids: [], room: "calendar", keyboard: false });
    });
  });

  it("words the server never got are kept as said", async () => {
    routeNote.mockRejectedValue(new Error("network"));
    keepWords.mockResolvedValue({ ok: true, noteId: "k9" });
    const user = await openModal();
    await say(user, "offline words");
    await flush();
    expect(keepWords).toHaveBeenCalledWith("offline words", undefined);
    expect(within(convo()).getByText(KEPT_AS_SAID)).toBeInTheDocument();
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
    expect(within(convo()).getByText("Luke is at 3323 from 9:00.")).toBeInTheDocument();

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

describe("focus goes back", () => {
  /* Sort it out takes the words out of the entry box and its buttons go
     with them, so the box asks for focus back on itself (tiff-box.tsx). */
  it("to where the opener asked, or to the button pressed when that has gone", async () => {
    const user = userEvent.setup();
    render(<Harness extra={<Grab />} />);
    const back = document.createElement("input");
    document.body.appendChild(back);

    await act(async () => {
      grabbed.api!.open({ from: topButton(), back });
    });
    await user.keyboard("{Escape}");
    await flush();
    expect(screen.queryByRole("dialog", { name: "Tiff" })).toBeNull();
    expect(back).toHaveFocus();

    await act(async () => {
      grabbed.api!.open({ from: topButton(), back });
    });
    back.remove();
    await user.keyboard("{Escape}");
    await flush();
    expect(topButton()).toHaveFocus();
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
    expect(within(convo()).queryByText(DONE)).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(GATHER_MS + CLOUD_MS - 200);
    });
    expect(within(convo()).queryByText(DONE)).toBeNull();
    expect(dialog().querySelector('.dotf[data-stage="cloud"]')).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(within(convo()).getByText(DONE)).toBeInTheDocument();
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
    expect(within(convo()).getByText(DONE)).toBeInTheDocument();
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

  it("opened from the keyboard it only fades, in and out (law 8)", async () => {
    motion(false);
    render(<Harness />);
    await act(async () => {
      fireEvent.click(topButton(), { detail: 0 });
    });
    const m = dialog();
    expect(anims.find((a) => a.el === m)!.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    await userEvent.setup().keyboard("{Escape}");
    expect(anims.filter((a) => a.el === m).at(-1)!.frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
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

/* ── what the first review found, each held by a test that fails without
   its fix ── */

type Proto = { animate?: unknown; getAnimations?: unknown; scrollTo?: unknown };
const proto = HTMLElement.prototype as unknown as Proto;

/** Web Animations, recorded; the dock's fold can be held open. */
function recordAnimations(opts: { holdDockFold?: boolean } = {}) {
  const anims: { el: Element; frames: Keyframe[] }[] = [];
  proto.animate = function (this: Element, frames: Keyframe[]) {
    anims.push({ el: this, frames });
    const folding =
      opts.holdDockFold && (this as HTMLElement).classList.contains("tm-dock") && frames.at(-1)?.height === "0px";
    return { finished: folding ? new Promise<void>(() => {}) : Promise.resolve(), cancel() {} };
  };
  proto.getAnimations = () => [];
  return anims;
}
afterEach(() => {
  delete proto.animate;
  delete proto.getAnimations;
  delete proto.scrollTo;
  delete (HTMLElement.prototype as unknown as { offsetHeight?: unknown }).offsetHeight;
});

const askWho = () =>
  routed({ say: "Who books it?", tasks: [task("Book it", null)], clarify: { question: "Who books it?", options: ["Me"] } });

describe("a filing whose answer was lost", () => {
  it("is never set aside on close: it may have filed", async () => {
    routeNote.mockResolvedValue(routed({ say: "A flag on the job.", flags: [{ message: "Isolator loose", severity: "warn" }] }));
    fileNote
      .mockResolvedValueOnce({
        ok: false,
        error: WHICH_JOB,
        ask: { question: WHICH_JOB, options: [{ label: "#3323 Randwick", target: { kind: "job", id: "j1" } }] },
      })
      .mockRejectedValueOnce(new Error("the answer never came back"));
    const user = await openModal();
    await say(user, "the isolator is loose");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "#3323 Randwick" }));
    await flush();
    expect(within(convo()).getByText(NOT_REACHED)).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(dismissNote).not.toHaveBeenCalled();
  });
});

describe("the dock folding away", () => {
  it("can't be pressed, and a second Done neither closes the modal nor sends twice", async () => {
    motion(false);
    recordAnimations({ holdDockFold: true });
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    const done = within(dialog()).getByRole("button", { name: "Done" });
    await user.click(done);
    expect(dialog().querySelector(".tm-dock")).toHaveAttribute("inert");
    // jsdom does not honour inert, so the press still lands: it must do nothing
    await user.click(done);
    await flush();
    expect(screen.getByRole("dialog", { name: "Tiff" })).toBeInTheDocument();
    await act(async () => engine.opts!.onTranscript("Luke has the head", { capped: false }));
    expect(routeNote).toHaveBeenCalledTimes(1);
  });

  it("its Tiff button does not listen while Tiff thinks", async () => {
    motion(false);
    jest.useFakeTimers();
    recordAnimations({ holdDockFold: true });
    routeNote.mockResolvedValue(askWho());
    continueNote.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<Harness />);
    await user.click(topButton());
    await say(user, "3323 needs booking");
    await act(async () => {
      jest.advanceTimersByTime(GATHER_MS + CLOUD_MS);
    });
    await user.click(within(dialog()).getByRole("button", { name: "Me" }));
    // thinking: the reply box is folding away with its Tiff button still drawn
    const talk = within(dialog()).getByRole("button", { name: "Talk to Tiff" });
    await user.click(talk);
    expect(mic.start).toHaveBeenCalledTimes(1);
    expect(within(dialog()).queryByRole("button", { name: "Done" })).toBeNull();
  });
});

describe("reduced motion", () => {
  it("Done settles your words from the live size to the turn's where motion is allowed", async () => {
    motion(false);
    const anims = recordAnimations();
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await say(user, "Luke has the head");
    const words = within(convo()).getByText("Luke has the head");
    expect(anims.some((a) => a.el === words && a.frames.some((f) => "fontSize" in f))).toBe(true);
  });

  it("your words grow into a new line where motion is allowed", async () => {
    motion(false);
    const anims = recordAnimations();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return (this.textContent ?? "").length;
      },
    });
    await openModal();
    await act(async () => engine.say!("Luke has the head on the ute"));
    const live = dialog().querySelector(".tm-turn.live")!;
    expect(anims.some((a) => a.el === live && a.frames.some((f) => "height" in f))).toBe(true);
  });

  it("under it nothing settles, grows, opens or folds: the modal only fades", async () => {
    const anims = recordAnimations();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return (this.textContent ?? "").length;
      },
    });
    routeNote.mockResolvedValue(askWho());
    const user = await openModal();
    await act(async () => engine.say!("3323 needs booking"));
    await say(user, "3323 needs booking");
    await flush();
    expect(within(convo()).getByText("Who books it?")).toBeInTheDocument();
    const moved = anims.filter((a) => a.el !== dialog() && !(a.el as HTMLElement).classList.contains("tm-scrim"));
    expect(moved.map((a) => (a.el as HTMLElement).className)).toEqual([]);
  });
});

describe("the keyboard", () => {
  it("opened from it with motion allowed, Tiff's answer still waits for the cloud's floor", async () => {
    motion(false);
    jest.useFakeTimers();
    routeNote.mockResolvedValue(routed({ say: "Luke has it.", tasks: [task("Head on the ute", LUKE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<Harness />);
    await act(async () => {
      fireEvent.click(topButton(), { detail: 0 });
    });
    // nothing flew from the button
    expect(dialog().querySelector('.dotf[data-stage="gather"]')).toBeNull();
    await say(user, "Luke has the head");
    await flush();
    expect(fileNote).toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(CLOUD_MS - 200);
    });
    expect(within(convo()).queryByText(DONE)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(within(convo()).getByText(DONE)).toBeInTheDocument();
  });

  it("the reply box's Tiff button, pressed from it, listens with nothing flying from it", async () => {
    motion(false);
    await openModal();
    await act(async () => engine.opts!.onError?.("Microphone access is blocked for this site."));
    const talk = within(dialog()).getByRole("button", { name: "Talk to Tiff" });
    await act(async () => {
      fireEvent.click(talk, { detail: 0 });
    });
    expect(mic.start).toHaveBeenCalledTimes(2);
    expect(dialog().querySelector('.dotf[data-stage="gather"]')).toBeNull();
    expect(dialog().querySelector('.dotf[data-stage="mark"]')).not.toBeNull();
  });

  it("a press from it does not turn the button; a pointer's does", async () => {
    motion(false);
    render(<Harness />);
    await act(async () => {
      fireEvent.click(topButton(), { detail: 0 });
    });
    expect(topButton()).not.toHaveClass("lit");
    await userEvent.setup().keyboard("{Escape}");
    await flush();
    await userEvent.setup().click(topButton());
    expect(topButton()).toHaveClass("lit");
  });

  it("Tab stays inside the modal", async () => {
    const user = await openModal();
    const d = dialog();
    expect(within(d).getByRole("button", { name: "Done" })).toHaveFocus();
    await user.tab();
    expect(within(d).getByRole("button", { name: "Close" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(d).getByRole("button", { name: "Done" })).toHaveFocus();
  });
});

describe("a screen reader", () => {
  it("keeps focus in the modal while Tiff thinks, then hears what she said", async () => {
    let answer: (v: unknown) => void = () => {};
    routeNote.mockReturnValue(new Promise((r) => (answer = r)));
    fileNote.mockResolvedValue(filedOk);
    const user = await openModal();
    await say(user, "Luke has the head");
    expect(dialog()).toHaveFocus();
    expect(within(dialog()).getByRole("status")).toHaveTextContent("Tiff is sorting it out");
    await act(async () => answer(routed({ say: "Luke has it.", tasks: [task("Head on the ute", LUKE.id)] })));
    await flush();
    expect(within(dialog()).getByRole("status")).toHaveTextContent(DONE);
    expect(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" })).toHaveFocus();
  });

  it("hears Tiff's question", async () => {
    routeNote.mockResolvedValue(askWho());
    const user = await openModal();
    await say(user, "3323 needs booking");
    await flush();
    expect(within(dialog()).getByRole("status")).toHaveTextContent("Who books it?");
  });
});

describe("your words, while you say them", () => {
  it("clicked into, stay on screen until the read-back lands, and nothing is typed in front of them", async () => {
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await act(async () => engine.say!("Luke has the head"));
    const words = dialog().querySelector<HTMLElement>(".tm-words")!;
    expect(words).toHaveTextContent("Luke has the head");
    await user.click(words);
    expect(mic.handOver).toHaveBeenCalledTimes(1);

    const box = within(dialog()).getByRole("textbox", { name: "What you said" });
    expect(box).toHaveValue("Luke has the head");
    await user.type(box, "x");
    expect(box).toHaveValue("Luke has the head");
    expect(within(dialog()).getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(box, "{Enter}");
    expect(routeNote).not.toHaveBeenCalled();

    await act(async () => engine.opts!.onTranscript("Luke has the head on the ute", { capped: false }));
    expect(box).toHaveValue("Luke has the head on the ute");
    await user.type(box, " today{Enter}");
    expect(routeNote).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: "Luke has the head on the ute today", source: "voice" })
    );
  });

  it("Clear starts that one again: a fresh take while listening, and back to listening from your words", async () => {
    const user = await openModal();
    await user.click(within(dialog()).getByRole("button", { name: "Clear what you said" }));
    expect(mic.restart).toHaveBeenCalledTimes(1);

    await act(async () => engine.say!("Luke has"));
    await user.click(dialog().querySelector<HTMLElement>(".tm-words")!);
    expect(within(dialog()).getByRole("textbox", { name: "What you said" })).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Clear what you said" }));
    // the read-back in the air is binned, and the mic opens again
    expect(mic.cancel).toHaveBeenCalledTimes(1);
    expect(mic.start).toHaveBeenCalledTimes(2);
    expect(within(dialog()).queryByRole("textbox", { name: "What you said" })).toBeNull();
    expect(within(dialog()).getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("the two-minute ceiling keeps them in your turn to fix and send, and routes nothing", async () => {
    await openModal();
    await act(async () => engine.opts!.onTranscript("a very long note", { capped: true }));
    expect(within(dialog()).getByRole("textbox", { name: "What you said" })).toHaveValue("a very long note");
    expect(within(dialog()).getByRole("button", { name: "Send" })).toBeEnabled();
    expect(routeNote).not.toHaveBeenCalled();
  });

  it("Done before anything was said closes it, and sends nothing", async () => {
    engine.opens = false;
    const user = await openModal();
    await user.click(within(dialog()).getByRole("button", { name: "Done" }));
    await flush();
    expect(screen.queryByRole("dialog", { name: "Tiff" })).toBeNull();
    expect(routeNote).not.toHaveBeenCalled();
  });
});

describe("when the words never reached Tiff", () => {
  it("says so when keeping them as said fails too", async () => {
    routeNote.mockRejectedValue(new Error("offline"));
    keepWords.mockRejectedValue(new Error("offline"));
    const user = await openModal();
    await say(user, "offline words");
    await flush();
    expect(within(convo()).getByText(NOT_REACHED)).toBeInTheDocument();
  });

  it("says so when a reply never arrives, and the next reply still answers her", async () => {
    routeNote.mockResolvedValue(askWho());
    continueNote.mockRejectedValueOnce(new Error("offline")).mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await say(user, "3323 needs booking");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "Me" }));
    await flush();
    expect(within(convo()).getByText(NOT_REACHED)).toBeInTheDocument();
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "Luke{Enter}");
    expect(continueNote).toHaveBeenLastCalledWith("n1", "Luke", []);
  });

  it("says so when a filing never answers", async () => {
    routeNote.mockResolvedValue(routed({ say: "Luke has it.", tasks: [task("Head on the ute", LUKE.id)] }));
    fileNote.mockRejectedValue(new Error("offline"));
    const user = await openModal();
    await say(user, "Luke has the head");
    await flush();
    expect(within(convo()).getByText(NOT_REACHED)).toBeInTheDocument();
  });

  it("says so when Undo never answers, and Undo can be pressed again", async () => {
    routeNote.mockResolvedValue(routed({ say: "Luke has it.", tasks: [task("Head on the ute", LUKE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    undoNote.mockRejectedValue(new Error("offline"));
    const user = await openModal();
    await say(user, "Luke has the head");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "Undo" }));
    await flush();
    expect(within(convo()).getByText(NOT_REACHED)).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Undo" })).toBeEnabled();
  });
});

describe("the conversation", () => {
  it("keeps the newest turn in view", async () => {
    const scrolled: Element[] = [];
    proto.scrollTo = function (this: Element) {
      scrolled.push(this);
    };
    routeNote.mockResolvedValue(askWho());
    const user = await openModal();
    scrolled.length = 0;
    await say(user, "3323 needs booking");
    await flush();
    expect(scrolled).toContain(convo());
  });

  it("opened on typed words, sends them at once as your first turn, and listens to nothing", async () => {
    routeNote.mockReturnValue(new Promise(() => {}));
    render(<Harness extra={<Grab />} />);
    await act(async () => {
      grabbed.api!.open({ from: topButton(), words: "Callum picks up the filters", room: "diary" });
    });
    expect(within(convo()).getByText("Callum picks up the filters")).toBeInTheDocument();
    expect(routeNote).toHaveBeenCalledWith({
      transcript: "Callum picks up the filters",
      target: { kind: "none" },
      source: "text",
      room: "diary",
      conversation: true,
    });
    expect(mic.start).not.toHaveBeenCalled();
  });

  it("a new note after Tiff has filed one is read by the turns before it", async () => {
    routeNote.mockResolvedValueOnce(routed({ say: "Luke puts it on the ute.", tasks: [task("Head on the ute", LUKE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    const user = await openModal({ voice: false });
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "Luke has the Bellevue Hill head on the ute{Enter}");
    await flush();
    routeNote.mockReturnValue(new Promise(() => {}));
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "and the same for Smith St{Enter}");
    // the first note carried nothing before it
    expect(routeNote.mock.calls[0][0]).not.toHaveProperty("before");
    expect(routeNote).toHaveBeenLastCalledWith({
      transcript: "and the same for Smith St",
      target: { kind: "none" },
      source: "text",
      room: undefined,
      conversation: true,
      before: [
        { who: "you", text: "Luke has the Bellevue Hill head on the ute" },
        { who: "tiff", text: DONE },
      ],
    });
  });

  it("\"In the Library\" is a quiet fact, not a warning", async () => {
    routeNote.mockResolvedValue(
      routed({ say: "Worth everyone knowing.", kbEntries: [{ title: "E6 clears on the outdoor board", body: "Power it separately." }] })
    );
    fileNote.mockResolvedValue({ ...filedOk, doors: [] });
    publishNoteKb.mockResolvedValue({ ok: true, documentId: "k1", summary: "Added to the Library." });
    const user = await openModal();
    await say(user, "got the E6 clear by powering the outdoor board separately");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "Add to the Library" }));
    await flush();
    const added = within(dialog()).getByText("In the Library");
    expect(added).toHaveClass("tm-added");
    expect(added).not.toHaveClass("tm-needs");
  });
});

/* ── OPENED AGAIN ON A CONVERSATION (H23): a diary entry's Tiff line opens
   the modal on the conversation the entry came out of. ── */

describe("opened again on a conversation", () => {
  const HAD = [
    { who: "you" as const, text: "Luke has the Bellevue Hill head on the ute" },
    { who: "tiff" as const, text: DONE },
  ];
  /** The diary's door: a button on the page, the conversation, the diary's room. */
  async function reopen(opts: { voice?: boolean } = {}) {
    const user = userEvent.setup();
    render(<Harness voice={opts.voice} extra={<Grab />} />);
    await act(async () => {
      grabbed.api!.open({ from: topButton(), conversation: HAD, room: "diary", id: "hd-dy-tiff-e1" });
    });
    return user;
  }

  it("has what was said on screen, Tiff's face already fallen, in the diary's room", async () => {
    await reopen();
    const turns = within(convo()).getAllByText(/./, { selector: ".tm-tt" }).map((t) => t.textContent);
    expect(turns).toEqual(["Luke has the Bellevue Hill head on the ute", DONE]);
    expect(within(convo()).getAllByText(/^(You|Tiff)$/).map((l) => l.textContent)).toEqual(["You", "Tiff"]);
    // she has already answered: no dots gather, and the header holds her mark
    expect(dialog().querySelector(".tm-face")).toBeNull();
    expect(dialog()).toHaveClass("speaking");
    expect(within(dialog()).getByText("Diary")).toBeInTheDocument();
  });

  it("waits on the reply box: a door to what was said is not a Tiff button, so nothing listens", async () => {
    await reopen();
    const box = within(dialog()).getByRole("textbox", { name: "Reply to Tiff" });
    expect(box).toHaveFocus();
    expect(mic.start).not.toHaveBeenCalled();
    expect(routeNote).not.toHaveBeenCalled();
    expect(askBrain).not.toHaveBeenCalled();
    // the box's own Tiff button is how to talk
    expect(within(dialog()).getByRole("button", { name: "Talk to Tiff" })).toBeInTheDocument();
  });

  it("listens once the box's Tiff button is pressed", async () => {
    const user = await reopen();
    await user.click(within(dialog()).getByRole("button", { name: "Talk to Tiff" }));
    expect(mic.start).toHaveBeenCalledTimes(1);
    expect(within(dialog()).getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("reads what you say next by the conversation, in the diary's room", async () => {
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await reopen({ voice: false });
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "and the same for Smith St{Enter}");
    expect(routeNote).toHaveBeenCalledWith({
      transcript: "and the same for Smith St",
      target: { kind: "none" },
      source: "text",
      room: "diary",
      conversation: true,
      before: HAD,
    });
    expect(within(convo()).getByText("and the same for Smith St")).toBeInTheDocument();
  });

  it("asks a question with the conversation as its history", async () => {
    askBrain.mockImplementationOnce(() => {});
    const user = await reopen({ voice: false });
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "when is Luke at Bellevue Hill?{Enter}");
    expect(askBrain.mock.calls[0][0]).toMatchObject({ question: "when is Luke at Bellevue Hill?", history: HAD });
  });

  it("closes on nothing new without asking the page to read again, and gives focus back to the door", async () => {
    const user = await reopen();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    expect(dismissNote).not.toHaveBeenCalled();
    expect(topButton()).toHaveFocus();
  });

  /* Tiff's face had already fallen when it opened, so the first reply
     brings her cloud up where it sits: no dots fly in from the diary's line
     behind the scrim, and no wait for a gather that was never drawn. */
  it("thinks at once on the first reply, the cloud rising where it sits, nothing flying from the line", async () => {
    motion(false);
    jest.useFakeTimers();
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<Harness voice={false} extra={<Grab />} />);
    await act(async () => {
      grabbed.api!.open({ from: topButton(), conversation: HAD, room: "diary", id: "hd-dy-tiff-e1" });
    });
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "and the same for Smith St{Enter}");
    const field = dialog().querySelector<HTMLElement>(".dotf");
    expect(field).not.toBeNull();
    expect(field).toHaveAttribute("data-stage", "cloud");
    // measured from no button: the dots start where the field is
    expect(field!.style.getPropertyValue("--gox")).toBe("");
  });

  it("lands at its newest turn as it appears, rather than scrolling there in front of you", async () => {
    const calls: ScrollToOptions[] = [];
    proto.scrollTo = function (this: Element, o: ScrollToOptions) {
      if (this === document.querySelector(".tm-turns")) calls.push(o);
    };
    motion(false);
    await reopen();
    expect(calls[0]).toMatchObject({ behavior: "auto" });
  });
});

/* THE CALENDAR'S ROOM (H22): what is said there is a line for the calendar.
   It goes to the calendar's reader and never to the note router; it files at
   once with Undo; "Which day?" takes the answer back with the line; a reply
   after filing is kept on what she filed; a question is still a question;
   and what went on lands on the calendar as the modal closes. */
describe("the calendar's room", () => {
  const LINE = "Toolbox talk first Thursday of the month, 6:45";
  const SAID =
    "Done. Toolbox talk is on the calendar for Thu 1 Oct at 6:45 am, then the first Thursday of every month until Aug 2027.";
  const IDS = ["e1", "e2", "e3"];
  const filedCal = {
    ok: true,
    say: SAID,
    plan: [
      { lead: "Thu 1 Oct", text: "toolbox talk, 6:45 am" },
      { lead: "Every month", text: "the first Thursday, until Aug 2027" },
    ],
    door: "3 events on the calendar",
    ids: IDS,
    about: "the toolbox talk on Thu 1 Oct",
  };

  async function calendar(words?: string, voice = true) {
    const user = userEvent.setup();
    render(<Harness voice={voice} extra={<Grab />} />);
    await act(async () => {
      grabbed.api!.open({ from: topButton(), words, room: "calendar" });
    });
    await flush();
    return user;
  }
  const reply = async (user: ReturnType<typeof userEvent.setup>, words: string) => {
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), `${words}{Enter}`);
    await flush();
  };

  it("sorts the box's words onto the calendar, never through the note router, and files at once with Undo", async () => {
    fileCalendarLine.mockResolvedValue(filedCal);
    await calendar(LINE);
    expect(fileCalendarLine).toHaveBeenCalledWith(LINE, "text", []);
    expect(routeNote).not.toHaveBeenCalled();
    expect(fileNote).not.toHaveBeenCalled();
    const d = dialog();
    expect(within(d).getByText("Calendar")).toBeInTheDocument();
    expect(within(convo()).getByText(SAID)).toBeInTheDocument();
    expect([...d.querySelectorAll(".tm-row-plan")].map((r) => r.textContent)).toEqual([
      "Thu 1 Oct, toolbox talk, 6:45 am",
      "Every month, the first Thursday, until Aug 2027",
    ]);
    expect(within(d).getByText("3 events on the calendar")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    // what is already on the calendar has no cross: taking it off is Undo's job
    expect(within(d).queryByRole("button", { name: /^Clear toolbox talk/ })).toBeNull();
    expect(within(d).getByRole("textbox", { name: "Reply to Tiff" })).toBeInTheDocument();
  });

  it("the calendar's Tiff button listens, and what was said goes on as spoken", async () => {
    fileCalendarLine.mockReturnValue(new Promise(() => {}));
    const user = await calendar();
    expect(mic.start).toHaveBeenCalledTimes(1);
    await say(user, LINE);
    expect(fileCalendarLine).toHaveBeenCalledWith(LINE, "voice", []);
    expect(routeNote).not.toHaveBeenCalled();
  });

  it("asks Which day?, and each answer goes back with the line", async () => {
    fileCalendarLine
      .mockResolvedValueOnce({ ok: false, ask: "Which day?" })
      .mockResolvedValueOnce({ ok: false, ask: "Which day?" })
      .mockResolvedValueOnce(filedCal);
    const user = await calendar("Toolbox talk");
    expect(within(convo()).getByText("Which day?")).toBeInTheDocument();
    await reply(user, "the first Thursday");
    expect(fileCalendarLine).toHaveBeenNthCalledWith(2, "Toolbox talk", "text", ["the first Thursday"]);
    await reply(user, "every month");
    expect(fileCalendarLine).toHaveBeenNthCalledWith(3, "Toolbox talk", "text", ["the first Thursday", "every month"]);
    expect(within(convo()).getByText(SAID)).toBeInTheDocument();
    expect(routeNote).not.toHaveBeenCalled();
  });

  it("keeps a reply after filing on what she filed, and says so", async () => {
    fileCalendarLine.mockResolvedValue(filedCal);
    noteOnCalendarEvents.mockResolvedValue({ ok: true });
    const user = await calendar(LINE);
    await reply(user, "Put it in the yard");
    expect(noteOnCalendarEvents).toHaveBeenCalledWith(IDS, "Put it in the yard");
    expect(fileCalendarLine).toHaveBeenCalledTimes(1);
    expect(within(convo()).getByText("Got it. I have added that to the toolbox talk on Thu 1 Oct.")).toBeInTheDocument();
  });

  it("still answers a question, and files nothing for it", async () => {
    askBrain.mockImplementation(() => {});
    await calendar("is Labour Day a Monday?");
    expect(askBrain).toHaveBeenCalledTimes(1);
    expect(askBrain.mock.calls[0][0]).toMatchObject({ question: "is Labour Day a Monday?" });
    expect(fileCalendarLine).not.toHaveBeenCalled();
  });

  it("Undo takes the events off, and the next words are a new line, not a note on them", async () => {
    fileCalendarLine.mockResolvedValue(filedCal);
    undoCalendarLine.mockResolvedValue({ ok: true, summary: "3 events taken back." });
    const user = await calendar(LINE);
    await user.click(within(dialog()).getByRole("button", { name: "Undo" }));
    await flush();
    expect(undoCalendarLine).toHaveBeenCalledWith(IDS);
    expect(within(convo()).getByText("3 events taken back.")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(within(dialog()).queryByText("3 events on the calendar")).toBeNull();
    fileCalendarLine.mockReturnValue(new Promise(() => {}));
    await reply(user, "Team meeting Monday at 3");
    expect(noteOnCalendarEvents).not.toHaveBeenCalled();
    expect(fileCalendarLine).toHaveBeenLastCalledWith("Team meeting Monday at 3", "text", []);
  });

  /* What Undo took off is not on the calendar, so closing lands nothing. */
  it("says nothing landed when the modal closes after Undo", async () => {
    fileCalendarLine.mockResolvedValue(filedCal);
    undoCalendarLine.mockResolvedValue({ ok: true, summary: "3 events taken back." });
    const user = await calendar(LINE);
    await user.click(within(dialog()).getByRole("button", { name: "Undo" }));
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(grabbed.api!.landed).toBeNull();
  });

  /* Asked "Which day?" and answered, a line then never read is kept with
     the answers: every word said for it, not the line alone. */
  it("keeps the answers with the line when a line asked about is never read", async () => {
    fileCalendarLine
      .mockResolvedValueOnce({ ok: false, ask: "Which day?" })
      .mockResolvedValueOnce({ ok: false, error: "That line couldn't be read just now.", unread: true });
    keepWords.mockResolvedValue({ ok: true, noteId: "k1" });
    const user = await calendar("Toolbox talk");
    await reply(user, "the first Thursday");
    expect(keepWords).toHaveBeenCalledWith("Toolbox talk\nthe first Thursday", "calendar");
  });

  it("keeps a line it could never read in the diary as said, and a line that never arrived too", async () => {
    fileCalendarLine.mockResolvedValue({ ok: false, error: "That line couldn't be read just now.", unread: true });
    keepWords.mockResolvedValue({ ok: true, noteId: "k1" });
    await calendar("Toolbox talk");
    expect(keepWords).toHaveBeenCalledWith("Toolbox talk", "calendar");
    expect(within(convo()).getByText(KEPT_AS_SAID)).toBeInTheDocument();
    cleanup();

    fileCalendarLine.mockRejectedValue(new Error("offline"));
    await calendar("Toolbox talk Friday");
    expect(keepWords).toHaveBeenLastCalledWith("Toolbox talk Friday", "calendar");
  });

  it("says why a line it read went nowhere, and keeps nothing", async () => {
    const why = "The calendar runs to Aug 2027, so I haven't put that on it.";
    fileCalendarLine.mockResolvedValue({ ok: false, error: why });
    await calendar("toolbox talk next September");
    expect(within(convo()).getByText(why)).toBeInTheDocument();
    expect(keepWords).not.toHaveBeenCalled();
  });

  it("says what landed as it closes: the events, with no note, and the page refreshed", async () => {
    fileCalendarLine.mockResolvedValue(filedCal);
    const user = await calendar(LINE);
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(grabbed.api!.landed).toStrictEqual({ noteIds: [], ids: IDS });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("takes off what went on when the modal was closed before she answered, as a note left waiting files nothing", async () => {
    let answer!: (v: unknown) => void;
    fileCalendarLine.mockReturnValue(
      new Promise((r) => {
        answer = r;
      }),
    );
    undoCalendarLine.mockResolvedValue({ ok: true, summary: "3 events taken back." });
    const user = await calendar(LINE);
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    await act(async () => {
      answer(filedCal);
    });
    await flush();
    expect(undoCalendarLine).toHaveBeenCalledWith(IDS);
    // nothing landed, so the page is told nothing and not refreshed for it
    expect(grabbed.api!.landed).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
