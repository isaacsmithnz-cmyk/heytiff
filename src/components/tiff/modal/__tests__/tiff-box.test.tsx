import * as React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteScopeProvider } from "@/components/notes/note-context";
import type { TiffRoom } from "@/lib/workboard/note-turns";
import { TiffModalProvider, useTiffModalSwitch } from "../tiff-host";
import { SAVE_FAILED, TiffBox, type BoxSaved } from "../tiff-box";
import { TiffContext, type TiffApi } from "../tiff-context";

/* THE ENTRY BOX, in a harness the way a room will hold it: the modal's host
   switched on, the microphone faked, every server action a stub, and each
   room's Save a jest function. Nothing here reaches a model, ServiceM8 or
   the database.

   What these hold is the box Isaac approved (v8): empty, only the Tiff
   button; typing swaps it for Save and Sort it out; Save is the room's own
   writer and asks Tiff nothing; Sort it out, and Enter, open the modal on
   the words; the Tiff button opens it listening, in the box's room. */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
  usePathname: () => "/dashboard",
}));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: jest.fn() }));

const routeNote = jest.fn();
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: (...a: unknown[]) => routeNote(...a),
  continueNote: jest.fn(),
  fileNote: jest.fn(),
  undoNote: jest.fn(),
  keepWords: jest.fn(),
  publishNoteKb: jest.fn(),
  dismissNote: jest.fn(),
  // the capture sheet's, which the button still carries for everyone else
  applyNote: jest.fn(),
  keepNoteOnJob: jest.fn(),
  keepNoteForMe: jest.fn(),
  answerClarify: jest.fn(),
}));
const fileCalendarLine = jest.fn();
jest.mock("@/app/actions/calendar", () => ({
  fileCalendarLine: (...a: unknown[]) => fileCalendarLine(...a),
  noteOnCalendarEvents: jest.fn(),
  undoCalendarLine: jest.fn(),
}));

const mic = { start: jest.fn(), stop: jest.fn(), cancel: jest.fn() };
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
        handing: false,
        seconds: 0,
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
        handOver: () => setRecording(false),
        cancel: () => {
          mic.cancel();
          setRecording(false);
        },
        restart: jest.fn(),
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

const save = jest.fn<Promise<BoxSaved>, [string]>();

function Room({
  on = true,
  room = "diary",
  placeholder = "Add to the diary…",
  day,
  enter,
}: {
  on?: boolean;
  room?: TiffRoom;
  placeholder?: string;
  day?: string;
  enter?: "sort" | "save";
}) {
  return (
    <NoteScopeProvider voiceEnabled>
      <TiffModalProvider>
        <Switch on={on} />
        <TiffBox room={room} placeholder={placeholder} save={save} day={day} enter={enter} />
      </TiffModalProvider>
    </NoteScopeProvider>
  );
}

/** The Calendar's box, as its page holds it (2026-09-26): on a day, and
    Enter is its Save. */
const CalendarRoom = () => <Room room="calendar" placeholder="Add to Thu 1 Oct…" day="2026-10-01" enter="save" />;
const calendarField = () => screen.getByRole("textbox", { name: "Add to Thu 1 Oct" });

const field = () => screen.getByRole("textbox", { name: "Add to the diary" });
const button = (name: string) => screen.queryByRole("button", { name });
const dialog = () => screen.queryByRole("dialog", { name: "Tiff" });
const flush = () => act(async () => {});

/** A save that answers when the test says. */
function held() {
  let answer: (r: BoxSaved) => void = () => {};
  save.mockImplementation(() => new Promise<BoxSaved>((r) => (answer = r)));
  return (r: BoxSaved) => act(async () => answer(r));
}

beforeEach(() => {
  jest.clearAllMocks();
  save.mockReset();
  routeNote.mockReturnValue(new Promise(() => {}));
  motion(true);
});
afterEach(cleanup);

describe("empty, the box is the words and the Tiff button", () => {
  it("shows only the Tiff button, labelled for what it does", () => {
    render(<Room />);
    expect(field()).toHaveAttribute("placeholder", "Add to the diary…");
    expect(button("Talk to Tiff")).toBeInTheDocument();
    expect(button("Save")).toBeNull();
    expect(button("Sort it out")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("wears the box's own Tiff button: paper, sized by the box's rule", () => {
    render(<Room />);
    expect(button("Talk to Tiff")).toHaveClass("tiffbtn", "tiffbtn-box");
    expect(button("Talk to Tiff")!.querySelector(".tiffbtn-ly.face path")).toHaveAttribute("stroke", "url(#tiffFacePaper)");
  });

  it("spaces alone are not words: still only the Tiff button", async () => {
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "   ");
    expect(button("Talk to Tiff")).toBeInTheDocument();
    expect(button("Save")).toBeNull();
    await user.keyboard("{Enter}");
    expect(dialog()).toBeNull();
    expect(routeNote).not.toHaveBeenCalled();
  });

  it("the Tiff button opens the modal listening, and what you say is read as said in the box's room", async () => {
    const user = userEvent.setup();
    render(<Room room="tasks" placeholder="Add a task…" />);
    await user.click(button("Talk to Tiff")!);
    const d = dialog()!;
    expect(d).toBeInTheDocument();
    expect(mic.start).toHaveBeenCalledTimes(1);
    expect(within(d).getByText("Tasks")).toBeInTheDocument();
    expect(button("Talk to Tiff")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("typing swaps the button for Save and Sort it out", () => {
  it("shows Save and Sort it out, and the Tiff button steps aside", async () => {
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Callum to grab the filters");
    expect(button("Save")).toBeInTheDocument();
    expect(button("Sort it out")).toBeInTheDocument();
    expect(button("Talk to Tiff")).toBeNull();
  });
});

describe("Save", () => {
  it("files the words through the room's own save, asks Tiff nothing, and empties the box", async () => {
    save.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "  Rang Reece about the filters  ");
    await user.click(button("Save")!);
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("Rang Reece about the filters");
    expect(routeNote).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(field()).toHaveValue("");
    expect(button("Talk to Tiff")).toBeInTheDocument();
    // the button pressed went with the words; the caret is back in the box
    expect(field()).toHaveFocus();
  });

  it("says why when the room would not keep them, and keeps the words", async () => {
    save.mockResolvedValue({ ok: false, error: "Your staff profile isn't set up yet." });
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Rang Reece");
    await user.click(button("Save")!);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Your staff profile isn't set up yet.");
    expect(field()).toHaveValue("Rang Reece");
    expect(field()).toHaveAccessibleDescription("Your staff profile isn't set up yet.");
    // typing again takes the complaint away
    await user.type(field(), " again");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a second try takes the first one's complaint away while it saves", async () => {
    save.mockResolvedValueOnce({ ok: false, error: "Couldn't save that." });
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Rang Reece");
    await user.click(button("Save")!);
    await flush();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    const answer = held();
    await user.click(button("Save")!);
    expect(screen.queryByRole("alert")).toBeNull();
    await answer({ ok: true });
    expect(field()).toHaveValue("");
  });

  it("a complaint about a save goes when the words go to Tiff instead", async () => {
    save.mockResolvedValue({ ok: false, error: "Couldn't save that." });
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Rang Reece");
    await user.click(button("Save")!);
    await flush();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(button("Sort it out")!);
    expect(dialog()).toBeInTheDocument();
    expect(screen.queryByText("Couldn't save that.")).toBeNull();
  });

  it("a save that throws says so rather than failing silently", async () => {
    save.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Rang Reece");
    await user.click(button("Save")!);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(SAVE_FAILED);
    expect(field()).toHaveValue("Rang Reece");
  });

  it("says it is saving, and two presses before it answers save once", async () => {
    const answer = held();
    render(<Room />);
    fireEvent.change(field(), { target: { value: "Rang Reece" } });
    const saveButton = button("Save")!;
    await act(async () => {
      fireEvent.click(saveButton);
      fireEvent.click(saveButton);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(button("Saving…")).toBeDisabled();
    expect(button("Sort it out")).toBeDisabled();
    // Enter is Sort it out, and a save still out is not raced by it
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(dialog()).toBeNull();
    await answer({ ok: true });
    expect(field()).toHaveValue("");
  });

  /* An edit made while it saved kept the saved words in the box, looking
     unsaved, and the next Save filed them again. The words hold still until
     the room answers, so what leaves is what was saved. */
  it("the words hold still while it saves, so the next Save never files them again", async () => {
    const answer = held();
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Rang Reece");
    await user.click(button("Save")!);
    expect(field()).toHaveAttribute("readonly");
    await user.type(field(), ", and the filters");
    expect(field()).toHaveValue("Rang Reece");
    await answer({ ok: true });
    expect(save).toHaveBeenCalledWith("Rang Reece");
    expect(field()).toHaveValue("");
    expect(field()).not.toHaveAttribute("readonly");

    save.mockResolvedValue({ ok: true });
    await user.type(field(), "and the filters");
    await user.click(button("Save")!);
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("and the filters");
  });

  it("a save that fails gives the words back to edit", async () => {
    const answer = held();
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Rang Reece");
    await user.click(button("Save")!);
    await answer({ ok: false, error: "Couldn't save that." });
    expect(field()).not.toHaveAttribute("readonly");
    await user.type(field(), " about the filters");
    expect(field()).toHaveValue("Rang Reece about the filters");
  });
});

describe("Sort it out", () => {
  it("opens the modal on the words, sends them as your first turn in the box's room, and empties the box", async () => {
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Callum to grab the filters from Reece");
    await user.click(button("Sort it out")!);
    const d = dialog()!;
    expect(d).toBeInTheDocument();
    expect(within(d.querySelector<HTMLElement>(".tm-turns")!).getByText("Callum to grab the filters from Reece")).toBeInTheDocument();
    expect(routeNote).toHaveBeenCalledWith({
      transcript: "Callum to grab the filters from Reece",
      target: { kind: "none" },
      source: "text",
      room: "diary",
      conversation: true,
    });
    expect(mic.start).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(field()).toHaveValue("");
  });

  it("Enter is Sort it out", async () => {
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Callum to grab the filters{Enter}");
    expect(dialog()).toBeInTheDocument();
    expect(routeNote).toHaveBeenCalledWith(expect.objectContaining({ transcript: "Callum to grab the filters", room: "diary" }));
    expect(save).not.toHaveBeenCalled();
  });

  it("Enter choosing a word in an input method is not a press", () => {
    render(<Room />);
    fireEvent.change(field(), { target: { value: "東京" } });
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(field(), { key: "Enter", keyCode: 229 });
    expect(dialog()).toBeNull();
    expect(field()).toHaveValue("東京");
  });

  it("grows from the button you pressed: the dots leave it", async () => {
    motion(false);
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Callum to grab the filters");
    await user.click(button("Sort it out")!);
    expect(dialog()!.querySelector('.dotf[data-stage="gather"]')).not.toBeNull();
  });

  it("from the keyboard nothing flies (law 8)", async () => {
    motion(false);
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Callum to grab the filters{Enter}");
    const dots = dialog()!.querySelector<HTMLElement>(".dotf");
    // the words went straight to Tiff: the mark is there, and never flew in
    expect(dots).not.toBeNull();
    expect(dots!.dataset.stage).not.toBe("gather");
  });

  it("closing it puts you back in the box, since the button you pressed left with the words", async () => {
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Callum to grab the filters");
    await user.click(button("Sort it out")!);
    expect(dialog()).toBeInTheDocument();
    await user.click(within(dialog()!).getByRole("button", { name: "Close" }));
    await flush();
    expect(dialog()).toBeNull();
    expect(field()).toHaveFocus();
  });

  it("takes nothing when the modal cannot open: the words stay where they were", async () => {
    const user = userEvent.setup();
    render(<Room on={false} />);
    await user.type(field(), "Callum to grab the filters");
    await user.click(button("Sort it out")!);
    await user.keyboard("{Enter}");
    expect(dialog()).toBeNull();
    expect(field()).toHaveValue("Callum to grab the filters");
    expect(button("Sort it out")).toBeInTheDocument();
  });
});

/* THE CALENDAR'S BOX (Home walk, part 2, 2026-09-26): "simplify it. how
   does a calendar normally add things in?" A calendar's quick add saves on
   Enter, and the box adds to a day it names, which Tiff is told with the
   words. The diary's and Tasks' Enter is still Sort it out. */
describe("a box whose Enter is its Save", () => {
  it("saves on Enter, asks Tiff nothing, keeps the caret for the next, and keeps Sort it out and the Tiff button", async () => {
    save.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<CalendarRoom />);
    expect(button("Talk to Tiff")).toBeInTheDocument();
    await user.type(calendarField(), "Team barbecue");
    expect(button("Sort it out")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await flush();
    expect(save).toHaveBeenCalledWith("Team barbecue");
    expect(dialog()).toBeNull();
    expect(fileCalendarLine).not.toHaveBeenCalled();
    expect(calendarField()).toHaveValue("");
    expect(calendarField()).toHaveFocus();
    // a second, straight after, goes the same way
    await user.type(calendarField(), "Van check{Enter}");
    await flush();
    expect(save).toHaveBeenLastCalledWith("Van check");
  });

  it("saves nothing for spaces, and never mid-word in an input method", async () => {
    const user = userEvent.setup();
    render(<CalendarRoom />);
    await user.type(calendarField(), "   {Enter}");
    fireEvent.change(calendarField(), { target: { value: "東京" } });
    fireEvent.keyDown(calendarField(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(calendarField(), { key: "Enter", keyCode: 229 });
    expect(save).not.toHaveBeenCalled();
  });

  it("still sorts on Enter in the diary's box", async () => {
    const user = userEvent.setup();
    render(<Room />);
    await user.type(field(), "Callum to grab the filters{Enter}");
    expect(dialog()).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("sends Sort it out's words to Tiff with the day it adds to", async () => {
    fileCalendarLine.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<CalendarRoom />);
    await user.type(calendarField(), "Toolbox talk");
    await user.click(button("Sort it out")!);
    expect(dialog()).toBeInTheDocument();
    expect(fileCalendarLine).toHaveBeenCalledWith("Toolbox talk", "text", [], "2026-10-01");
    expect(save).not.toHaveBeenCalled();
  });

  it("hands the day to Tiff from Sort it out and from its Tiff button", async () => {
    const open = jest.fn((_o: Parameters<TiffApi["open"]>[0]) => true);
    const api: TiffApi = { enabled: true, open, openedBy: null, isOpen: false, landed: null, report: () => {} };
    const user = userEvent.setup();
    render(
      <NoteScopeProvider voiceEnabled>
        <TiffContext.Provider value={api}>
          <TiffBox room="calendar" placeholder="Add to Thu 1 Oct…" save={save} day="2026-10-01" enter="save" />
        </TiffContext.Provider>
      </NoteScopeProvider>,
    );
    await user.click(button("Talk to Tiff")!);
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ room: "calendar", day: "2026-10-01" }));
    await user.type(calendarField(), "Toolbox talk");
    await user.click(button("Sort it out")!);
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ words: "Toolbox talk", room: "calendar", day: "2026-10-01" }),
    );
  });
});
