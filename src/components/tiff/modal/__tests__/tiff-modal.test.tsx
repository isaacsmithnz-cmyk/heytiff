import * as React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteScopeProvider, NoteScopeScreen } from "@/components/notes/note-context";
import { TiffButton } from "@/components/notes/tiff-button";
import { KEPT_AS_SAID, WHICH_JOB } from "@/lib/workboard/note-turns";
import { quietLimit } from "../quiet";
import { TiffModalProvider, useTiff } from "../tiff-host";
import { CLOUD_MS, NOT_REACHED } from "../use-conversation";

/* THE TIFF MODAL, walked as Isaac will walk it: the top bar's button, owner
   switched on, the microphone faked, every server action a stub. Nothing
   here reaches a model, ServiceM8 or the database.

   What these hold is the shape he approved in the prototype (v6–v16),
   docked as a chat like Claude's since 20 October 2026: opening means
   listening; Stop makes your words a turn and Tiff thinks; a plan with
   nothing unclear files at once with Undo on it; a question holds the
   filing and takes a tap, a typed reply or a spoken one; the crosses take
   rows off; × and Escape leave without routing; Minimise keeps the
   conversation for later; and the waits have floors so her answer never
   jumps in. */

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
const answerVisit = jest.fn();
const openRecordByName = jest.fn(async (_words: string) => null as { href: string; label: string; line: string } | null);
jest.mock("@/app/actions/tiff-open", () => ({ openRecordByName: (w: string) => openRecordByName(w) }));
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: (...a: unknown[]) => routeNote(...a),
  continueNote: (...a: unknown[]) => continueNote(...a),
  fileNote: (...a: unknown[]) => fileNote(...a),
  undoNote: (...a: unknown[]) => undoNote(...a),
  keepWords: (...a: unknown[]) => keepWords(...a),
  publishNoteKb: (...a: unknown[]) => publishNoteKb(...a),
  dismissNote: (...a: unknown[]) => dismissNote(...a),
  answerVisit: (...a: unknown[]) => answerVisit(...a),
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
  quietEnd?: (words: string, how: { live: boolean }) => number | null;
  onQuiet?: () => void;
};
const engine: {
  opts: DictOpts | null;
  interim: string;
  /** Whether start() opens the mic. False is a mic still arming. */
  opens: boolean;
  /** Words arriving while you talk, as the live transport sends them. */
  say: ((words: string) => void) | null;
} = { opts: null, interim: "", opens: true, say: null };
const mic = {
  start: jest.fn(),
  stop: jest.fn(),
  cancel: jest.fn(),
  restart: jest.fn(),
  handOver: jest.fn(),
  keepListening: jest.fn(),
};
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
        seconds: 3,
        interim,
        barsRef: react.createRef(),
        bindQuiet: () => {},
        keepListening: mic.keepListening,
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

/* The host is on for everyone it is mounted for: nothing switches it on
   (the HOME_DESK switch went with the old Home, 2026-09-26). */
function Harness({ voice = true, extra }: { voice?: boolean; extra?: React.ReactNode }) {
  return (
    <NoteScopeProvider voiceEnabled={voice}>
      <TiffModalProvider>
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
/** What a screen reader hears. The Thinking line is a status too, so this is the quiet one. */
const heard = () => dialog().querySelector<HTMLElement>(".sr-only[role='status']")!;
/** "Thinking", in the conversation while she works. */
const thinking = () => dialog().querySelector<HTMLElement>(".tc-think");
const flush = () => act(async () => {});

async function openModal(opts: { voice?: boolean; extra?: React.ReactNode } = {}) {
  const user = userEvent.setup();
  render(<Harness voice={opts.voice} extra={opts.extra} />);
  await user.click(topButton());
  return user;
}

/** Say something into the open microphone and press Stop. */
async function say(user: ReturnType<typeof userEvent.setup>, words: string) {
  await user.click(within(dialog()).getByRole("button", { name: "Stop" }));
  await act(async () => engine.opts!.onTranscript(words, { capped: false }));
}

const LYLE = { id: "s-lyle", fullName: "Lyle Irving" };
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
  visits: [],
  costs: [],
  variations: [],
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
  staff: [LYLE],
});
const DONE = "Done. Lyle puts the Bellevue Hill head on the ute.";
const filedOk = {
  ok: true,
  summary: "Saved.",
  doors: [{ kind: "tasks", count: 1, label: "1 task filed", ids: ["t1"] }],
  turns: [turn("you", "x"), turn("tiff", "Lyle puts the Bellevue Hill head on the ute."), turn("tiff", DONE)],
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
  it("opens listening from the top bar: the red dot, the clock and Stop, in the one box", async () => {
    await openModal();
    const d = dialog();
    expect(mic.start).toHaveBeenCalledTimes(1);
    expect(d.querySelector(".tc-recdot")).not.toBeNull();
    expect(within(d).getByText("0:03")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Stop" })).toBeInTheDocument();
    // the box to type in is there while she listens; the microphone gives way to Stop
    expect(within(d).getByRole("textbox", { name: "Reply to Tiff" })).toHaveValue("");
    expect(within(d).queryByRole("button", { name: "Speak instead of typing" })).toBeNull();
    expect(within(d).getByRole("button", { name: "Send" })).toBeDisabled();
  });

  /* Isaac, live (2026-09-27): "needs to prompt you to talk to it. the 'you' looks a bit vague" */
  it("asks you to talk, and names your turn only once you have said something", async () => {
    await openModal();
    const d = dialog();
    expect(within(d).getByText("Go ahead, I’m listening")).toBeInTheDocument();
    expect(within(d).queryByText("You")).toBeNull();
    await act(async () => engine.say!("the head for Bellevue Hill"));
    expect(within(d).queryByText("Go ahead, I’m listening")).toBeNull();
    expect(within(d).getByText("You")).toBeInTheDocument();
  });

  it("without a microphone it opens on the reply box and no mic runs", async () => {
    await openModal({ voice: false });
    expect(mic.start).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" })).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Stop" })).toBeNull();
    // and no microphone to listen with, since nothing can hear
    expect(within(dialog()).queryByRole("button", { name: "Speak instead of typing" })).toBeNull();
  });

  it("goes to the reply box, and says why, when the microphone will not open", async () => {
    await openModal();
    await act(async () => engine.opts!.onError?.("Microphone access is blocked for this site."));
    const d = dialog();
    expect(within(d).getByRole("textbox", { name: "Reply to Tiff" })).toBeInTheDocument();
    expect(within(d).getByRole("alert")).toHaveTextContent("Microphone access is blocked for this site.");
    expect(within(d).queryByRole("button", { name: "Stop" })).toBeNull();
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

  /* The button holds no state of its own about it: it reads as expanded
     exactly while the conversation it started is open. */
  it("reads the pressed button as expanded while its modal is open, and not once it has closed", async () => {
    const user = await openModal();
    expect(topButton()).toHaveAttribute("aria-expanded", "true");
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(screen.queryByRole("dialog", { name: "Tiff" })).toBeNull();
    expect(topButton()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("talking", () => {
  it("Stop makes your words a turn, and Tiff is thinking: on screen and to a screen reader", async () => {
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await say(user, "Lyle has the Bellevue Hill head on the ute");

    const d = dialog();
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(within(d).getByText("You")).toBeInTheDocument();
    expect(within(d).getByText("Lyle has the Bellevue Hill head on the ute")).toBeInTheDocument();
    expect(thinking()).toHaveTextContent("Thinking");
    // the Thinking line is the status while she works, so nothing is said twice
    expect(thinking()).toHaveAttribute("role", "status");
    expect(heard()).toHaveTextContent("");
    // the box stays while she thinks; it only waits
    expect(within(d).getByRole("textbox", { name: "Reply to Tiff" })).toBeInTheDocument();
    expect(routeNote).toHaveBeenCalledWith({
      transcript: "Lyle has the Bellevue Hill head on the ute",
      target: { kind: "none" },
      source: "voice",
      room: undefined,
    });
  });

  it("a quiet ends your turn as Stop does: the words go, and Tiff is thinking", async () => {
    /* "Having to click done kind of takes away from the conversation flow."
       The policy is ./quiet's; the meter calls onQuiet when it runs out. */
    routeNote.mockReturnValue(new Promise(() => {}));
    await openModal();
    expect(engine.opts!.quietEnd).toBe(quietLimit);
    await act(async () => engine.opts!.onQuiet!());
    expect(mic.stop).toHaveBeenCalledTimes(1);
    await act(async () => engine.opts!.onTranscript("Lyle has the Bellevue Hill head on the ute.", { capped: false }));
    // the Thinking line is the status while she works, so nothing is said twice
    expect(thinking()).toHaveAttribute("role", "status");
    expect(heard()).toHaveTextContent("");
    expect(routeNote).toHaveBeenCalledWith(expect.objectContaining({ transcript: "Lyle has the Bellevue Hill head on the ute." }));
  });

  it("a quiet while you are in the field sends nothing: you clicked in to type or fix", async () => {
    const user = await openModal();
    await user.click(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }));
    await act(async () => engine.opts!.onQuiet!());
    expect(mic.stop).not.toHaveBeenCalled();
    expect(mic.keepListening).toHaveBeenCalled();
  });

  it("files a plan with nothing unclear at once, and says so with Undo", async () => {
    routeNote.mockResolvedValue(
      routed({
        say: "Lyle puts the Bellevue Hill head on the ute.",
        tasks: [task("Put the Bellevue Hill head on the ute", LYLE.id, { dueDate: "2026-09-25", remindTime: "07:00" })],
      })
    );
    fileNote.mockResolvedValue(filedOk);
    const user = await openModal();
    await say(user, "Lyle has the Bellevue Hill head on the ute");
    await flush();

    expect(fileNote).toHaveBeenCalledWith("n1", { leaveOut: [] });
    const d = dialog();
    expect(within(convo()).getByText(DONE)).toBeInTheDocument();
    expect(within(d).getByText("1 task filed")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    const row = d.querySelector(".tm-row-plan")!;
    expect(row).toHaveTextContent("Lyle, Put the Bellevue Hill head on the ute, Fri 7:00");
    // a filed row has no cross: taking one back is Undo's job
    expect(within(d).queryByRole("button", { name: /^Clear Put the/ })).toBeNull();
    // and the dock is back as the reply box
    expect(within(d).getByRole("textbox", { name: "Reply to Tiff" })).toBeInTheDocument();
  });

  /* v2 step 6, the visit lane: a visit with no clear time is asked once the
     rest is filed (decision 13), and a tapped start books it. */
  it("asks which time for a visit once the rest is filed, and a tapped start books it", async () => {
    routeNote.mockResolvedValue(
      routed({
        say: "Lyle orders the grilles.",
        tasks: [task("Order the grilles", LYLE.id, {})],
      })
    );
    fileNote.mockResolvedValue({
      ...filedOk,
      ask: {
        question: "Commissioning on Friday: which time? Lyle's free at both.",
        options: [
          { label: "2:00 pm", visit: { index: 0, start: "14:00" } },
          { label: "3:30 pm", visit: { index: 0, start: "15:30" } },
          { label: "Another time", visit: { index: 0, start: null } },
        ],
      },
    });
    answerVisit.mockResolvedValue({ ok: true, visit: { index: 0 }, turns: [{ who: "tiff", text: "Booked: commissioning, Lyle, Friday 2:00 to 4:00 pm." }] });
    const user = await openModal();
    await say(user, "Get Lyle to order the grilles, and book commissioning for Friday arvo");
    await flush();

    const d = dialog();
    expect(within(convo()).getByText("Commissioning on Friday: which time? Lyle's free at both.")).toBeInTheDocument();
    await user.click(within(d).getByRole("button", { name: "2:00 pm" }));
    await flush();
    expect(answerVisit).toHaveBeenCalledWith("n1", "2:00 pm");
    expect(within(convo()).getByText("Booked: commissioning, Lyle, Friday 2:00 to 4:00 pm.")).toBeInTheDocument();
  });

  it("a read with nothing to file is not filed: the note is set aside and Tiff answers the words", async () => {
    /* "Open up Isaac Smith" missed the move test, and the router read it as
       nothing to file; filing it said "Done." with an Undo over nothing. */
    routeNote.mockResolvedValue(
      routed({ say: "That looks like a request to open a profile rather than a site note, so there's nothing to file." })
    );
    askBrain.mockImplementationOnce((_input, h) => {
      h.onDelta("Opening Isaac Smith.");
      h.onDone();
    });
    const user = await openModal();
    await say(user, "Open up Isaac Smith.");
    await flush();

    expect(fileNote).not.toHaveBeenCalled();
    expect(dismissNote).toHaveBeenCalledWith("n1");
    expect(askBrain.mock.calls[0][0]).toMatchObject({ question: "Open up Isaac Smith." });
    expect(within(convo()).getByText("Opening Isaac Smith.")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("a remark alone is still filed: nothing to file means no row, no remark and no question", async () => {
    routeNote.mockResolvedValue(routed({ say: "Kept as a note.", plainNote: "Long day on the roof." }));
    fileNote.mockResolvedValue({ ...filedOk, doors: [] });
    const user = await openModal();
    await say(user, "long day on the roof");
    await flush();
    expect(fileNote).toHaveBeenCalledWith("n1", { leaveOut: [] });
    expect(askBrain).not.toHaveBeenCalled();
  });

  it("asks when something is unclear: the rows, the one that needs an answer, and quick answers", async () => {
    routeNote.mockResolvedValue(
      routed({
        say: "Lyle has the head on the ute. Who books 3323 in?",
        tasks: [task("Put the head on the ute", LYLE.id), task("Book 3323 Randwick in", null)],
        clarify: { question: "Who books 3323 in?", options: ["Lyle", "Me"] },
      })
    );
    continueNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await say(user, "head on the ute, and 3323 needs booking");
    await flush();

    const d = dialog();
    expect(fileNote).not.toHaveBeenCalled();
    expect(within(convo()).getByText("Lyle has the head on the ute. Who books 3323 in?")).toBeInTheDocument();
    const rows = [...d.querySelectorAll(".tm-row-plan")];
    expect(rows[0]).toHaveTextContent("Lyle, Put the head on the ute");
    expect(rows[1]).toHaveTextContent("Who Book 3323 Randwick in");
    expect(rows[1]).toHaveTextContent("Needs an answer");

    await user.click(within(d).getByRole("button", { name: "Lyle" }));
    expect(continueNote).toHaveBeenCalledWith("n1", "Lyle", []);
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

  /* Isaac (2026-09-27): after words you said, her question is listened
     for, with the box to type in instead; "as soon as you start typing,
     the recording will stop". Typed, she waits at the reply box. */
  it("listens for the answer to her question after words you said; typing stops it, and a typed reply waits at the box", async () => {
    routeNote.mockResolvedValue(
      routed({ say: "Who books it?", tasks: [task("Book 3323 in", null)], clarify: { question: "Who books it?", options: ["Me"] } })
    );
    continueNote.mockResolvedValue(
      routed({ say: "Who books it?", tasks: [task("Book 3323 in", null)], clarify: { question: "Who books it?", options: ["Me"] } })
    );
    const user = await openModal();
    await say(user, "3323 needs booking");
    await flush();

    // she asked, after words you said: she listens, her quick answers still there
    expect(mic.start).toHaveBeenCalledTimes(2);
    expect(within(dialog()).getByText("Go ahead, I’m listening")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Me" })).toBeInTheDocument();
    // the first key stops the recording and is the start of the reply
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "Lyle books it{Enter}");
    expect(mic.cancel).toHaveBeenCalledTimes(1);
    await flush();
    expect(continueNote).toHaveBeenNthCalledWith(1, "n1", "Lyle books it", []);

    // typed, so she waits at the box; its microphone listens
    expect(mic.start).toHaveBeenCalledTimes(2);
    await user.click(within(dialog()).getByRole("button", { name: "Speak instead of typing" }));
    expect(mic.start).toHaveBeenCalledTimes(3);
    await say(user, "no, Lyle does it Monday");
    await flush();
    expect(continueNote).toHaveBeenNthCalledWith(2, "n1", "no, Lyle does it Monday", []);
  });

  it("a row's cross takes it off the plan and names it on the next call", async () => {
    routeNote.mockResolvedValue(
      routed({
        say: "Who books 3323?",
        tasks: [task("Put the head on the ute", LYLE.id), task("Book 3323 in", null)],
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
    routeNote.mockResolvedValue(routed({ say: "Lyle puts it on the ute.", tasks: [task("Head on the ute", LYLE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    const user = await openModal();
    await say(user, "Lyle has the head on the ute");
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
    const why = "Lyle has already ticked off one of those, so nothing was taken back.";
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

    /* Words said to the Calendar are a line for the calendar (H22), so the
       note that lands from its room is one Tiff could not read and kept as
       said: the page is told which room it came from, and brings nothing
       forward over the Calendar for it. */
    it("says the room it was had in", async () => {
      fileCalendarLine.mockResolvedValue({ ok: false, error: "That line couldn't be read just now.", unread: true });
      keepWords.mockResolvedValue({ ok: true, noteId: "k7" });
      const user = userEvent.setup();
      render(<Harness voice={false} extra={<Grab />} />);
      await act(async () => {
        grabbed.api!.open({ from: topButton(), words: "toolbox talk every first Thursday", room: "calendar" });
      });
      await flush();
      expect(keepWords).toHaveBeenCalledWith("toolbox talk every first Thursday", "calendar");
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
      h.onDelta("Lyle is at 3323 ");
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
    expect(within(convo()).getByText("Lyle is at 3323 from 9:00.")).toBeInTheDocument();

    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "and the day after?{Enter}");
    await flush();
    expect(askBrain.mock.calls[1][0].history).toEqual([
      { who: "you", text: "who's at 3323 tomorrow?" },
      { who: "tiff", text: "Lyle is at 3323 from 9:00." },
    ]);
  });

  /* Kept as a conversation once her answer lands (Isaac, 20 October:
     Conversations said "No conversations yet" after a day of talking). */
  it("keeps the chat in Conversations once she has answered", async () => {
    localStorage.clear();
    askBrain.mockImplementationOnce((_input, h) => {
      h.onDelta("Lyle is at 3323 from 9:00.");
      h.onDone();
    });
    const user = await openModal({ voice: false });
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "who's at 3323 tomorrow?{Enter}");
    await flush();
    const kept = JSON.parse(localStorage.getItem("heytiff.tiff.threads.v2") ?? "[]");
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      title: "who's at 3323 tomorrow?",
      messages: [
        { role: "user", text: "who's at 3323 tomorrow?" },
        { role: "tiff", text: "Lyle is at 3323 from 9:00." },
      ],
    });
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

    routeNote.mockResolvedValue(routed({ say: "Lyle has it.", tasks: [task("Head on the ute", LYLE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    await user.click(topButton());
    await say(user, "Lyle has the head");
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
    await user.click(within(dialog()).getByRole("button", { name: "Stop" }));
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
    await say(user, "Lyle has the head");
    await user.keyboard("{Escape}");
    await flush();
    await act(async () => answer(routed({ say: "Lyle has it.", tasks: [task("Head", LYLE.id)] })));
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
  it("holds Tiff's answer until the cloud has turned, with Thinking up meanwhile", async () => {
    motion(false);
    jest.useFakeTimers();
    routeNote.mockResolvedValue(routed({ say: "Lyle has it.", tasks: [task("Head on the ute", LYLE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<Harness />);
    await user.click(topButton());

    await say(user, "Lyle has the head");
    await flush();
    expect(fileNote).toHaveBeenCalled();
    expect(within(convo()).queryByText(DONE)).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(CLOUD_MS - 200);
    });
    expect(within(convo()).queryByText(DONE)).toBeNull();
    expect(thinking()).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(within(convo()).getByText(DONE)).toBeInTheDocument();
    expect(thinking()).toBeNull();
  });

  it("under reduced motion nothing is held", async () => {
    routeNote.mockResolvedValue(routed({ say: "Lyle has it.", tasks: [task("Head on the ute", LYLE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    const user = await openModal();
    await say(user, "Lyle has the head");
    await flush();
    expect(within(convo()).getByText(DONE)).toBeInTheDocument();
  });
});

/* DOCKED, NOT MODAL (Isaac, 20 October 2026: a small chat like Claude's,
   that you can minimise and open up). The page around it stays yours:
   nothing covers it and nothing flies out of the button, its keys are its
   own only while you are in it, and Minimise keeps the conversation. */
describe("docked", () => {
  it("sits beside the page, not over it: no scrim, and nothing flies from the button", async () => {
    motion(false);
    await openModal();
    expect(dialog()).not.toHaveAttribute("aria-modal");
    expect(document.querySelector(".tm-scrim")).toBeNull();
    expect(document.querySelector(".tm-fr-pos")).toBeNull();
  });

  it("leaves Escape pressed on the page around it to the page", async () => {
    const pageHeard = jest.fn();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") pageHeard();
    };
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    document.addEventListener("keydown", onKey);
    try {
      const user = await openModal({ voice: false });
      outside.focus();
      await user.keyboard("{Escape}");
      await flush();
      expect(dialog()).toBeInTheDocument();
      expect(pageHeard).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", onKey);
      outside.remove();
    }
  });

  it("Minimise leaves the Ask Tiff pill, and the pill brings the conversation back as it was", async () => {
    askBrain.mockImplementationOnce((_input, h) => {
      h.onDelta("Lyle is at 3323 from 9:00.");
      h.onDone();
    });
    const user = await openModal({ voice: false });
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "who's at 3323 tomorrow?{Enter}");
    await flush();

    await user.click(within(dialog()).getByRole("button", { name: "Minimise" }));
    // put away, not closed: nothing in it can be reached, and nothing landed
    expect(dialog()).toHaveAttribute("inert");
    expect(refresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ask Tiff" }));

    expect(screen.queryByRole("button", { name: "Ask Tiff" })).toBeNull();
    expect(dialog()).not.toHaveAttribute("inert");
    expect(within(convo()).getByText("who's at 3323 tomorrow?")).toBeInTheDocument();
    expect(within(convo()).getByText("Lyle is at 3323 from 9:00.")).toBeInTheDocument();
    expect(askBrain).toHaveBeenCalledTimes(1);
  });

  it("Send waits for something typed, and Enter on nothing sends nothing", async () => {
    const user = await openModal({ voice: false });
    const box = within(dialog()).getByRole("textbox", { name: "Reply to Tiff" });
    const send = within(dialog()).getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await user.type(box, "   {Enter}");
    expect(send).toBeDisabled();
    expect(askBrain).not.toHaveBeenCalled();
    expect(routeNote).not.toHaveBeenCalled();

    await user.type(box, "who's at 3323 tomorrow?");
    expect(send).toBeEnabled();
    await user.click(send);
    expect(askBrain.mock.calls[0][0]).toMatchObject({ question: "who's at 3323 tomorrow?" });
  });

  /* "Thinking with what she's thinking about" (Isaac, 20 October 2026): the
     label of the tool she picked up last, said small after Thinking. */
  it("says what she is doing while she thinks, once the tool she picked up says", async () => {
    let tool: (label: string) => void = () => {};
    askBrain.mockImplementationOnce((_input, h) => {
      tool = h.onTool;
    });
    const user = await openModal({ voice: false });
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "can a ducted unit fit in the roof void?{Enter}");
    expect(thinking()).toHaveTextContent(/^Thinking$/);
    await act(async () => tool("Reading the design"));
    expect(within(thinking()!).getByText("reading the design")).toBeInTheDocument();
  });
});

/* ── what the first review found, each held by a test that fails without
   its fix ── */

type Proto = { animate?: unknown; getAnimations?: unknown; scrollTo?: unknown };
const proto = HTMLElement.prototype as unknown as Proto;

/** Web Animations, recorded. */
function recordAnimations() {
  const anims: { el: Element; frames: Keyframe[] }[] = [];
  proto.animate = function (this: Element, frames: Keyframe[]) {
    anims.push({ el: this, frames });
    return { finished: Promise.resolve(), cancel() {} };
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

/* WHILE SHE THINKS THE BOX STAYS, AND WAITS. Stop gives way to the
   microphone, and the microphone and Send wait with her, so nothing sends
   twice and nothing listens over her. */
describe("while Tiff thinks", () => {
  it("the box stays, but neither Send nor the microphone can be pressed, and the words go once", async () => {
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await user.click(within(dialog()).getByRole("button", { name: "Stop" }));
    expect(within(dialog()).queryByRole("button", { name: "Stop" })).toBeNull();
    expect(within(dialog()).getByRole("button", { name: "Speak instead of typing" })).toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "Send" })).toBeDisabled();
    await act(async () => engine.opts!.onTranscript("Lyle has the head", { capped: false }));
    expect(routeNote).toHaveBeenCalledTimes(1);
    expect(mic.start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Tiff" })).toBeInTheDocument();
  });

  /* The box no longer folds away while she reads your words back, so what
     you type there meanwhile is your next turn, never the front of this one. */
  it("what you type while your words are read back is not put in front of them", async () => {
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await act(async () => engine.say!("Lyle has the head"));
    await user.click(within(dialog()).getByRole("button", { name: "Stop" }));
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "and the filters");
    await act(async () => engine.opts!.onTranscript("Lyle has the head", { capped: false }));
    expect(routeNote).toHaveBeenCalledWith(expect.objectContaining({ transcript: "Lyle has the head" }));
  });
});

describe("reduced motion", () => {
  it("Stop settles your words from the live size to the turn's where motion is allowed", async () => {
    motion(false);
    const anims = recordAnimations();
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await say(user, "Lyle has the head");
    const words = within(convo()).getByText("Lyle has the head");
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
    await act(async () => engine.say!("Lyle has the head on the ute"));
    const live = dialog().querySelector(".tm-turn.live")!;
    expect(anims.some((a) => a.el === live && a.frames.some((f) => "height" in f))).toBe(true);
  });

  it("under it nothing settles, grows or opens", async () => {
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
    routeNote.mockResolvedValue(routed({ say: "Lyle has it.", tasks: [task("Head on the ute", LYLE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<Harness />);
    await act(async () => {
      fireEvent.click(topButton(), { detail: 0 });
    });
    await say(user, "Lyle has the head");
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

  it("the box's microphone, pressed from it, listens", async () => {
    motion(false);
    await openModal();
    await act(async () => engine.opts!.onError?.("Microphone access is blocked for this site."));
    const talk = within(dialog()).getByRole("button", { name: "Speak instead of typing" });
    await act(async () => {
      fireEvent.click(talk, { detail: 0 });
    });
    expect(mic.start).toHaveBeenCalledTimes(2);
    expect(within(dialog()).getByRole("button", { name: "Stop" })).toBeInTheDocument();
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
});

describe("a screen reader", () => {
  it("keeps focus in Tiff while she thinks, then hears what she said", async () => {
    let answer: (v: unknown) => void = () => {};
    routeNote.mockReturnValue(new Promise((r) => (answer = r)));
    fileNote.mockResolvedValue(filedOk);
    const user = await openModal();
    await say(user, "Lyle has the head");
    expect(dialog()).toHaveFocus();
    // the Thinking line is the status while she works, so nothing is said twice
    expect(thinking()).toHaveAttribute("role", "status");
    expect(heard()).toHaveTextContent("");
    await act(async () => answer(routed({ say: "Lyle has it.", tasks: [task("Head on the ute", LYLE.id)] })));
    await flush();
    expect(heard()).toHaveTextContent(DONE);
    expect(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" })).toHaveFocus();
  });

  it("hears Tiff's question", async () => {
    routeNote.mockResolvedValue(askWho());
    const user = await openModal();
    await say(user, "3323 needs booking");
    await flush();
    expect(heard()).toHaveTextContent("Who books it?");
  });
});

describe("your words, while you say them", () => {
  it("clicked into, stay on screen until the read-back lands, and nothing is typed in front of them", async () => {
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = await openModal();
    await act(async () => engine.say!("Lyle has the head"));
    const words = dialog().querySelector<HTMLElement>(".tm-words")!;
    expect(words).toHaveTextContent("Lyle has the head");
    await user.click(words);
    expect(mic.handOver).toHaveBeenCalledTimes(1);

    const box = within(dialog()).getByRole("textbox", { name: "What you said" });
    expect(box).toHaveValue("Lyle has the head");
    await user.type(box, "x");
    expect(box).toHaveValue("Lyle has the head");
    expect(within(dialog()).getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(box, "{Enter}");
    expect(routeNote).not.toHaveBeenCalled();

    await act(async () => engine.opts!.onTranscript("Lyle has the head on the ute", { capped: false }));
    expect(box).toHaveValue("Lyle has the head on the ute");
    await user.type(box, " today{Enter}");
    expect(routeNote).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: "Lyle has the head on the ute today", source: "voice" })
    );
  });

  /* Talking again from the reply box, mid-conversation: whatever ends the
     take without words is back where you were, her question and all, and
     never the end of the conversation ("done will um, finish the chat"). */
  describe("talking again in a conversation", () => {
    const ASK = "Who books it?";
    /** Words said, and her question listened for; `opens: false` is a mic still arming as you press Stop. */
    async function talkAgain({ opens = true } = {}) {
      routeNote.mockResolvedValue(routed({ say: ASK, tasks: [task("Book 3323 in", null)], clarify: { question: ASK, options: ["Me"] } }));
      const user = await openModal();
      // the first take is already recording; this is the one her question opens
      engine.opens = opens;
      await say(user, "3323 needs booking");
      await flush();
      expect(within(dialog()).getByRole("button", { name: "Stop" })).toBeInTheDocument();
      return user;
    }

    it("a quick answer tapped while she listens drops the take and answers", async () => {
      continueNote.mockReturnValue(new Promise(() => {}));
      const user = await talkAgain();
      await user.click(within(dialog()).getByRole("button", { name: "Me" }));
      expect(mic.cancel).toHaveBeenCalledTimes(1);
      expect(continueNote).toHaveBeenCalledWith("n1", "Me", []);
    });

    it("clicking into the box to type keeps listening; the first key stops it, in the same field", async () => {
      const user = await talkAgain();
      const box = within(dialog()).getByRole("textbox", { name: "Reply to Tiff" });
      await user.click(box);
      expect(mic.cancel).not.toHaveBeenCalled();
      expect(within(dialog()).getByRole("button", { name: "Stop" })).toBeInTheDocument();
      await user.keyboard("L");
      expect(mic.cancel).toHaveBeenCalledTimes(1);
      const reply = within(dialog()).getByRole("textbox", { name: "Reply to Tiff" });
      expect(reply).toBe(box);
      expect(reply).toHaveValue("L");
      expect(reply).toHaveFocus();
    });

    it("with words already said, the first key keeps them for you to fix", async () => {
      const user = await talkAgain();
      await act(async () => engine.say!("Lyle books"));
      await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "x");
      expect(mic.handOver).toHaveBeenCalledTimes(1);
      expect(within(dialog()).getByRole("textbox", { name: "What you said" })).toBeInTheDocument();
    });

    it("Stop with nothing said keeps the conversation open, back at her question", async () => {
      const user = await talkAgain({ opens: false });
      await user.click(within(dialog()).getByRole("button", { name: "Stop" }));
      await flush();
      expect(dialog()).toBeInTheDocument();
      expect(within(convo()).getByText(ASK)).toBeInTheDocument();
      expect(within(dialog()).getByRole("button", { name: "Me" })).toBeInTheDocument();
      expect(within(dialog()).queryByRole("button", { name: "Stop" })).toBeNull();
      expect(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" })).toBeInTheDocument();
      expect(continueNote).not.toHaveBeenCalled();
    });
  });

  /* Isaac, live: pressing Tiff to talk again "goes back to the top of the
     chat". The face opens above the list and gives it less room; the list
     must keep to its newest as it shrinks, unless you scrolled back. */
  it("keeps the list at its newest as it loses room, and leaves it where you scrolled back to", async () => {
    const seen: ResizeObserverCallback[] = [];
    const real = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        seen.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      await openModal();
      const list = convo();
      let top = 0;
      let room = 400;
      Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 900 });
      Object.defineProperty(list, "clientHeight", { configurable: true, get: () => room });
      Object.defineProperty(list, "scrollTop", {
        configurable: true,
        get: () => top,
        set: (v: number) => {
          top = Math.max(0, Math.min(v, 900 - room));
        },
      });
      const resized = () => act(() => seen.forEach((cb) => cb([], {} as ResizeObserver)));
      top = 500;
      room = 220;
      await resized();
      expect(top).toBe(680);

      fireEvent.wheel(list);
      top = 120;
      fireEvent.scroll(list);
      room = 150;
      await resized();
      expect(top).toBe(120);
    } finally {
      globalThis.ResizeObserver = real;
    }
  });

  it("the two-minute ceiling keeps them in your turn to fix and send, and routes nothing", async () => {
    await openModal();
    await act(async () => engine.opts!.onTranscript("a very long note", { capped: true }));
    expect(within(dialog()).getByRole("textbox", { name: "What you said" })).toHaveValue("a very long note");
    expect(within(dialog()).getByRole("button", { name: "Send" })).toBeEnabled();
    expect(routeNote).not.toHaveBeenCalled();
  });

  it("Stop before anything was said closes it, and sends nothing", async () => {
    engine.opens = false;
    const user = await openModal();
    await user.click(within(dialog()).getByRole("button", { name: "Stop" }));
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
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "Lyle{Enter}");
    expect(continueNote).toHaveBeenLastCalledWith("n1", "Lyle", []);
  });

  it("says so when a filing never answers", async () => {
    routeNote.mockResolvedValue(routed({ say: "Lyle has it.", tasks: [task("Head on the ute", LYLE.id)] }));
    fileNote.mockRejectedValue(new Error("offline"));
    const user = await openModal();
    await say(user, "Lyle has the head");
    await flush();
    expect(within(convo()).getByText(NOT_REACHED)).toBeInTheDocument();
  });

  it("says so when Undo never answers, and Undo can be pressed again", async () => {
    routeNote.mockResolvedValue(routed({ say: "Lyle has it.", tasks: [task("Head on the ute", LYLE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    undoNote.mockRejectedValue(new Error("offline"));
    const user = await openModal();
    await say(user, "Lyle has the head");
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
    });
    expect(mic.start).not.toHaveBeenCalled();
  });

  it("a new note after Tiff has filed one is read by the turns before it", async () => {
    routeNote.mockResolvedValueOnce(routed({ say: "Lyle puts it on the ute.", tasks: [task("Head on the ute", LYLE.id)] }));
    fileNote.mockResolvedValue(filedOk);
    const user = await openModal({ voice: false });
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "Lyle has the Bellevue Hill head on the ute{Enter}");
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
      before: [
        { who: "you", text: "Lyle has the Bellevue Hill head on the ute" },
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
    { who: "you" as const, text: "Lyle has the Bellevue Hill head on the ute" },
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

  it("has what was said on screen, in the diary's room", async () => {
    await reopen();
    const turns = within(convo()).getAllByText(/./, { selector: ".tm-tt" }).map((t) => t.textContent);
    expect(turns).toEqual(["Lyle has the Bellevue Hill head on the ute", DONE]);
    expect(within(convo()).getAllByText(/^(You|Tiff)$/).map((l) => l.textContent)).toEqual(["You", "Tiff"]);
    // she has already answered: nothing says she is thinking
    expect(thinking()).toBeNull();
    expect(within(dialog()).getByText("Diary")).toBeInTheDocument();
  });

  it("waits on the reply box: a door to what was said is not a Tiff button, so nothing listens", async () => {
    await reopen();
    const box = within(dialog()).getByRole("textbox", { name: "Reply to Tiff" });
    expect(box).toHaveFocus();
    expect(mic.start).not.toHaveBeenCalled();
    expect(routeNote).not.toHaveBeenCalled();
    expect(askBrain).not.toHaveBeenCalled();
    // the box's microphone is how to talk
    expect(within(dialog()).getByRole("button", { name: "Speak instead of typing" })).toBeInTheDocument();
  });

  it("listens once the box's microphone is pressed", async () => {
    const user = await reopen();
    await user.click(within(dialog()).getByRole("button", { name: "Speak instead of typing" }));
    expect(mic.start).toHaveBeenCalledTimes(1);
    expect(within(dialog()).getByRole("button", { name: "Stop" })).toBeInTheDocument();
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
      before: HAD,
    });
    expect(within(convo()).getByText("and the same for Smith St")).toBeInTheDocument();
  });

  it("asks a question with the conversation as its history", async () => {
    askBrain.mockImplementationOnce(() => {});
    const user = await reopen({ voice: false });
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "when is Lyle at Bellevue Hill?{Enter}");
    expect(askBrain.mock.calls[0][0]).toMatchObject({ question: "when is Lyle at Bellevue Hill?", history: HAD });
  });

  it("closes on nothing new without asking the page to read again, and gives focus back to the door", async () => {
    const user = await reopen();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    expect(dismissNote).not.toHaveBeenCalled();
    expect(topButton()).toHaveFocus();
  });

  /* She had already answered when it opened, so the first reply has her
     thinking at once, under it: no wait for anything to arrive first. */
  it("thinks at once on the first reply, under what you said", async () => {
    motion(false);
    jest.useFakeTimers();
    routeNote.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<Harness voice={false} extra={<Grab />} />);
    await act(async () => {
      grabbed.api!.open({ from: topButton(), conversation: HAD, room: "diary", id: "hd-dy-tiff-e1" });
    });
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "and the same for Smith St{Enter}");
    expect(thinking()).not.toBeNull();
    expect(convo().lastElementChild).toBe(thinking());
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
  const LINE = "Toolbox talk every first Thursday, 6:45";
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

  /** The calendar's room opened, on `words` or listening, and on the day its
      box adds to when one is given (2026-09-26). */
  async function calendar(words?: string, voice = true, day?: string) {
    const user = userEvent.setup();
    render(<Harness voice={voice} extra={<Grab />} />);
    await act(async () => {
      grabbed.api!.open({ from: topButton(), words, room: "calendar", day });
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
    expect(fileCalendarLine).toHaveBeenCalledWith(LINE, "text", [], undefined);
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
    expect(fileCalendarLine).toHaveBeenCalledWith(LINE, "voice", [], undefined);
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
    expect(fileCalendarLine).toHaveBeenNthCalledWith(2, "Toolbox talk", "text", ["the first Thursday"], undefined);
    await reply(user, "every month");
    expect(fileCalendarLine).toHaveBeenNthCalledWith(
      3,
      "Toolbox talk",
      "text",
      ["the first Thursday", "every month"],
      undefined,
    );
    expect(within(convo()).getByText(SAID)).toBeInTheDocument();
    expect(routeNote).not.toHaveBeenCalled();
  });

  /* "simplify it" (Isaac, 2026-09-26): the Calendar's box adds to a day and
     says which, and Tiff is told it with every line — typed, said, or read
     again with an answer — so a line that names no day goes on it (the
     server's to decide, app/actions/calendar `fileCalendarLine`). */
  it("takes the day the box adds to with every line it reads", async () => {
    fileCalendarLine.mockResolvedValueOnce({ ok: false, ask: "Which day?" }).mockReturnValue(new Promise(() => {}));
    const user = await calendar("Toolbox talk", true, "2026-10-01");
    expect(fileCalendarLine).toHaveBeenCalledWith("Toolbox talk", "text", [], "2026-10-01");
    await reply(user, "the first Thursday");
    expect(fileCalendarLine).toHaveBeenLastCalledWith("Toolbox talk", "text", ["the first Thursday"], "2026-10-01");
  });

  it("takes the box's day with what is said to its Tiff button, too", async () => {
    fileCalendarLine.mockReturnValue(new Promise(() => {}));
    const user = await calendar(undefined, true, "2026-10-14");
    await say(user, "Team barbecue");
    expect(fileCalendarLine).toHaveBeenCalledWith("Team barbecue", "voice", [], "2026-10-14");
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
    expect(fileCalendarLine).toHaveBeenLastCalledWith("Team meeting Monday at 3", "text", [], undefined);
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
    expect(grabbed.api!.landed).toStrictEqual({ noteIds: [], ids: IDS, room: "calendar", keyboard: false });
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
