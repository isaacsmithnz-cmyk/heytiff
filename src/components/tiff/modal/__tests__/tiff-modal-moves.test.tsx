import * as React from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteScopeProvider } from "@/components/notes/note-context";
import { TiffButton } from "@/components/notes/tiff-button";
import { TiffModalProvider, useTiff } from "../tiff-host";
import { HOLD_MS } from "../tiff-modal";

/* THE MODAL WHILE THE SCREEN MOVES UNDER IT — probe P2 of the universal-Tiff
   plan, kept as a test because Phase 1 builds on it.

   "Take me to the workboard" moves the screen while Tiff's conversation is
   open. That only works if the modal outlives the page: the dashboard shell
   keys its outlet on the pathname (`<main key={pathname}>`, app-shell.tsx),
   so every move remounts everything inside it, and the modal's host sits
   above it in dashboard/layout.tsx. This rebuilds that shape: a top-bar
   button outside a page that remounts on every path, and a box button
   inside it. The conversation has to survive five moves, and closing after
   a move has to work even when the button that opened it went with the
   page it was on. */

let path = "/dashboard";
const refresh = jest.fn();
const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
  usePathname: () => path,
}));

const askBrain = jest.fn();
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: (...a: unknown[]) => askBrain(...a) }));

const routeNote = jest.fn();
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: (...a: unknown[]) => routeNote(...a),
  continueNote: jest.fn(),
  fileNote: jest.fn(),
  undoNote: jest.fn(),
  keepWords: jest.fn(),
  publishNoteKb: jest.fn(),
  dismissNote: jest.fn(),
}));
jest.mock("@/app/actions/calendar", () => ({
  fileCalendarLine: jest.fn(),
  noteOnCalendarEvents: jest.fn(),
  undoCalendarLine: jest.fn(),
}));

/* The microphone, faked so it opens and closes like the real engine. */
const mic = { start: jest.fn(), stop: jest.fn(), cancel: jest.fn(), restart: jest.fn(), handOver: jest.fn() };
jest.mock("@/components/notes/dictation", () => {
  const actual = jest.requireActual("@/components/notes/dictation");
  return {
    ...actual,
    useDictation: () => {
      const react = jest.requireActual("react") as typeof import("react");
      const [recording, setRecording] = react.useState(false);
      return {
        recording,
        arming: false,
        transcribing: false,
        seconds: 3,
        interim: "",
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

/** The page under the modal: remounted on every path, as the outlet is. */
function Page({ at }: { at: string }) {
  return (
    <main className="outlet">
      <p>{`Screen ${at}`}</p>
      <TiffButton where="box" room="calendar" />
    </main>
  );
}

function Shell({ at }: { at: string }) {
  return (
    <NoteScopeProvider voiceEnabled={false}>
      <TiffModalProvider>
        <TiffButton />
        <Page key={at} at={at} />
      </TiffModalProvider>
    </NoteScopeProvider>
  );
}

const dialog = () => screen.getByRole("dialog", { name: "Tiff" });
const convo = () => dialog().querySelector<HTMLElement>(".tm-turns")!;
const flush = () => act(async () => {});
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const SCREENS = ["/dashboard/workboard", "/dashboard/team", "/dashboard/my-leave", "/dashboard/assets", "/dashboard"];

beforeEach(() => {
  jest.clearAllMocks();
  path = "/dashboard";
  window.matchMedia = jest.fn().mockImplementation((q: string) => ({
    matches: q.includes("reduce"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  askBrain.mockImplementation((_input, h) => {
    h.onDelta("Lyle has 20 open tasks.");
    h.onDone();
  });
});
afterEach(() => cleanup());

async function askFromTopBar() {
  const user = userEvent.setup();
  const view = render(<Shell at={path} />);
  await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
  await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "who's carrying the most?{Enter}");
  await flush();
  return { user, view };
}

describe("the modal while the screen moves under it", () => {
  it("keeps the conversation open through five moves, and the page under it really remounts", async () => {
    const { view } = await askFromTopBar();
    expect(within(convo()).getByText("Lyle has 20 open tasks.")).toBeInTheDocument();

    for (const at of SCREENS) {
      const before = screen.getByText(/^Screen /);
      path = at;
      view.rerender(<Shell at={at} />);
      await flush();
      expect(before.isConnected).toBe(false);
      expect(screen.getByText(`Screen ${at}`)).toBeInTheDocument();
      expect(within(convo()).getByText("who's carrying the most?")).toBeInTheDocument();
      expect(within(convo()).getByText("Lyle has 20 open tasks.")).toBeInTheDocument();
    }
    expect(mic.cancel).not.toHaveBeenCalled();
  });

  it("carries on the same conversation after a move: the next question brings the earlier turns", async () => {
    const { user, view } = await askFromTopBar();
    path = "/dashboard/team";
    view.rerender(<Shell at={path} />);
    await flush();

    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "and Dane?{Enter}");
    await flush();
    expect(askBrain.mock.calls[1][0].history).toEqual([
      { who: "you", text: "who's carrying the most?" },
      { who: "tiff", text: "Lyle has 20 open tasks." },
    ]);
  });

  it("closes after a move even when the button that opened it went with the page", async () => {
    const user = userEvent.setup();
    const view = render(<Shell at={path} />);
    const box = screen.getByLabelText("Talk to Tiff");
    await user.click(box);
    expect(dialog()).toBeInTheDocument();

    path = "/dashboard/workboard";
    view.rerender(<Shell at={path} />);
    await flush();
    expect(box.isConnected).toBe(false);

    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    expect(screen.queryByRole("dialog", { name: "Tiff" })).toBeNull();
  });
});

/* ── Tiff moves the screen (universal Tiff 1B) ─────────────────────────── */

describe("a move", () => {
  it("shows her line, closes, and only then moves the page", async () => {
    askBrain.mockImplementationOnce((_input, h) => {
      h.onDelta("Opening the Workboard.");
      h.onScreen("/dashboard/workboard", "Workboard");
      h.onDone();
    });
    const user = userEvent.setup();
    render(<Shell at={path} />);
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "take me to the workboard?{Enter}");
    await flush();
    // her line holds first (1F), and the page hasn't moved yet
    expect(within(convo()).getByText("Opening the Workboard.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await wait(HOLD_MS + 100);
    expect(screen.queryByRole("dialog", { name: "Tiff" })).toBeNull();
    expect(push).toHaveBeenCalledWith("/dashboard/workboard");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("moves nothing when the move arrives after the modal was closed", async () => {
    let late: { onScreen: (href: string, label: string) => void; onDelta: (t: string) => void; onDone: () => void } | null = null;
    askBrain.mockImplementationOnce((_input, h) => {
      late = h;
    });
    const user = userEvent.setup();
    render(<Shell at={path} />);
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "take me to the workboard?{Enter}");
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    act(() => {
      late?.onDelta("Opening the Workboard.");
      late?.onScreen("/dashboard/workboard", "Workboard");
      late?.onDone();
    });
    await flush();
    expect(push).not.toHaveBeenCalled();
  });

  it("sends the answer to her question back to her, rather than filing it as a note", async () => {
    askBrain.mockImplementationOnce((_input, h) => {
      h.onDelta("Which Dane: Dane Porter or Dane Ito?");
      h.onDone();
    });
    askBrain.mockImplementationOnce((_input, h) => {
      h.onDelta("Opening Dane Porter's card.");
      h.onScreen("/dashboard/team/s-1", "Dane Porter's card");
      h.onDone();
    });
    const user = userEvent.setup();
    render(<Shell at={path} />);
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "open Dane's card?{Enter}");
    await flush();
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "Dane Porter{Enter}");
    await flush();
    await wait(HOLD_MS + 100);
    expect(routeNote).not.toHaveBeenCalled();
    expect(askBrain).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith("/dashboard/team/s-1");
  });
});

/* ── "take me to…" is never filed (universal Tiff 1C) ─────────────────── */

describe("a move request without a question mark", () => {
  it("goes to Tiff as a move, not to the note router", async () => {
    const user = userEvent.setup();
    render(<Shell at={path} />);
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "Take me to the workboard{Enter}");
    await flush();
    expect(routeNote).not.toHaveBeenCalled();
    expect(askBrain.mock.calls.at(-1)?.[0]).toMatchObject({ question: "Take me to the workboard", intent: "move" });
  });

  it("leaves a site instruction that starts the same way to the note router", async () => {
    routeNote.mockResolvedValue({ ok: false, error: "x" });
    const user = userEvent.setup();
    render(<Shell at={path} />);
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    await user.type(
      within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }),
      "go to Smith St and pick up the grilles{Enter}"
    );
    await flush();
    expect(routeNote).toHaveBeenCalled();
    expect(askBrain).not.toHaveBeenCalled();
  });
});

/* ── carrying on after a move (universal Tiff 1F, interim) ───────────── */

function Forget() {
  const tiff = useTiff();
  return (
    <button type="button" onClick={() => tiff.forget?.()}>
      Switch workspace
    </button>
  );
}

async function moveFromTopBar(user: ReturnType<typeof userEvent.setup>) {
  askBrain.mockImplementationOnce((_input, h) => {
    h.onDelta("Opening the Workboard.");
    h.onScreen("/dashboard/workboard", "Workboard");
    h.onDone();
  });
  await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
  await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "take me to the workboard?{Enter}");
  await flush();
  await wait(HOLD_MS + 100);
  expect(screen.queryByRole("dialog", { name: "Tiff" })).toBeNull();
}

describe("after she moves you", () => {
  it("a press in the modal during the hold keeps it open and moves nothing", async () => {
    askBrain.mockImplementationOnce((_input, h) => {
      h.onDelta("Opening the Workboard.");
      h.onScreen("/dashboard/workboard", "Workboard");
      h.onDone();
    });
    const user = userEvent.setup();
    render(<Shell at={path} />);
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "take me to the workboard?{Enter}");
    await flush();
    await user.click(within(convo()).getByText("Opening the Workboard."));
    await wait(HOLD_MS + 100);
    expect(dialog()).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("the next bare press carries on the same conversation, and a question after it brings those turns", async () => {
    const user = userEvent.setup();
    render(<Shell at={path} />);
    await moveFromTopBar(user);
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    expect(within(convo()).getByText("take me to the workboard?")).toBeInTheDocument();
    expect(within(convo()).getByText("Opening the Workboard.")).toBeInTheDocument();
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "and who's on it?{Enter}");
    await flush();
    expect(askBrain.mock.calls.at(-1)?.[0].history).toEqual([
      { who: "you", text: "take me to the workboard?" },
      { who: "tiff", text: "Opening the Workboard." },
    ]);
  });

  it("any other way in opens as it always has, and drops what was kept", async () => {
    const user = userEvent.setup();
    render(<Shell at={path} />);
    await moveFromTopBar(user);
    await user.click(screen.getByLabelText("Talk to Tiff"));
    expect(within(convo()).queryByText("Opening the Workboard.")).toBeNull();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    expect(within(convo()).queryByText("Opening the Workboard.")).toBeNull();
  });

  it("keeps nothing after ten minutes", async () => {
    const user = userEvent.setup();
    render(<Shell at={path} />);
    await moveFromTopBar(user);
    const now = Date.now();
    const spy = jest.spyOn(Date, "now").mockReturnValue(now + 10 * 60 * 1000 + 1);
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    spy.mockRestore();
    expect(within(convo()).queryByText("Opening the Workboard.")).toBeNull();
  });

  it("keeps nothing when you close it yourself", async () => {
    askBrain.mockImplementationOnce((_input, h) => {
      h.onDelta("Lyle has 20 open tasks.");
      h.onDone();
    });
    const user = userEvent.setup();
    render(<Shell at={path} />);
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    await user.type(within(dialog()).getByRole("textbox", { name: "Reply to Tiff" }), "who's busiest?{Enter}");
    await flush();
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    await flush();
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    expect(within(convo()).queryByText("Lyle has 20 open tasks.")).toBeNull();
  });

  it("forget drops it, so another workspace starts fresh", async () => {
    const user = userEvent.setup();
    render(
      <NoteScopeProvider voiceEnabled={false}>
        <TiffModalProvider>
          <TiffButton />
          <Forget />
          <Page key={path} at={path} />
        </TiffModalProvider>
      </NoteScopeProvider>
    );
    await moveFromTopBar(user);
    await user.click(screen.getByRole("button", { name: "Switch workspace" }));
    await user.click(screen.getAllByLabelText(/^Ask or tell Tiff/)[0]!);
    expect(within(convo()).queryByText("Opening the Workboard.")).toBeNull();
  });
});
