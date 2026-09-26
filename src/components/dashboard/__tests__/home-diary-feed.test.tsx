import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TiffContext, type TiffApi } from "@/components/tiff/modal/tiff-context";
import { NOT_REACHED } from "@/components/tiff/modal/use-conversation";
import type { DeskArrival } from "@/lib/dashboard/desk-focus";
import { DIARY_LIT_MS, type DeskDiary } from "@/lib/dashboard/diary-doors";
import { diaryFeed } from "@/lib/dashboard/diary-feed";
import type { DiaryEntry } from "@/lib/dashboard/journal";
import { HomeDiaryFeed } from "../home-diary-feed";

/* THE DIARY TAB (H16): the box at the top, "Today" and its entries, then
   everything older with its own date; each entry your initials, "You" and
   when, your words, and under them its doors and quiet lines. The entries
   are the ones his prototype drew from Isaac's real diary.

   The box is the real one (components/tiff/modal/tiff-box) in front of a
   stand-in for the modal's host, so what it asks the modal for is seen and
   nothing opens. Every server action is a stub: nothing here reaches a
   model, ServiceM8 or the database. */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  usePathname: () => "/dashboard",
}));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: jest.fn() }));
/* A conversation's job door opens the desk's card, which with its server
   action cannot load here; the conversations have their own suite. */
jest.mock("@/app/actions/workboard", () => ({ openMirrorJob: jest.fn(async () => null) }));
jest.mock("@/components/workboard/board/job-sheet", () => ({ JobSheet: () => null }));
const keepWords = jest.fn();
const undoNote = jest.fn();
jest.mock("@/app/actions/workboard-notes", () => ({
  keepWords: (...a: unknown[]) => keepWords(...a),
  routeNote: jest.fn(),
  continueNote: jest.fn(),
  fileNote: jest.fn(),
  undoNote: (...a: unknown[]) => undoNote(...a),
  publishNoteKb: jest.fn(),
  dismissNote: jest.fn(),
  applyNote: jest.fn(),
  keepNoteOnJob: jest.fn(),
  keepNoteForMe: jest.fn(),
  answerClarify: jest.fn(),
}));

const TODAY = "2026-09-25";
const ME = "s-isaac";

const entry = (over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: "e1",
  said: "Can you mark Isaac Smith as sick? Today.",
  day: "2026-09-08",
  at: "8:42 pm",
  outcomes: [],
  spoken: true,
  stamp: "2026-09-08 20:42:00",
  routed: true,
  taskFor: {},
  turns: [],
  undo: false,
  undone: false,
  ...over,
});

const TODAYS = entry({
  id: "e-today",
  said: "Order the filters for Bayview before Thursday",
  day: TODAY,
  at: "2:17 pm",
  stamp: `${TODAY} 14:17:00`,
  outcomes: [
    { kind: "todo", text: "Order filters", go: { type: "task", id: "t2" } },
    { kind: "todo", text: "Ring Bayview", go: { type: "task", id: "t3" } },
    { kind: "kept", text: "Isolator sizes for a 7.1 kW", go: { type: "kb", id: "k1" } },
    { kind: "kept", text: "1 line kept", go: { type: "note", id: "n1" } },
    { kind: "todo", text: "Rooftop unit keeps tripping", go: { type: "issue", id: "i1" } },
    { kind: "todo", text: "1 task removed" },
  ],
  taskFor: { t2: "s-luke", t3: "s-luke" },
});
const SICK = entry();
const WIPERS = entry({
  id: "e-wipers",
  said: "The window wipers on my van aren't working, and I will need to get it booked in for a service.",
  day: "2026-08-22",
  at: "11:42 pm",
  stamp: "2026-08-22 23:42:00",
  routed: false,
});

const diary = (entries: DiaryEntry[]): DeskDiary => ({
  feed: diaryFeed({ entries, conversations: [], day: TODAY, mentions: false, entriesCut: false, syncedAt: null }),
  you: "IS",
  names: { "s-luke": "Luke" },
});

const open = jest.fn((_o: unknown) => true);
const tiff = (over: Partial<TiffApi> = {}): TiffApi => ({
  enabled: true,
  open: open as TiffApi["open"],
  openedBy: null,
  isOpen: false,
  landed: null,
  report: () => {},
  ...over,
});

type Props = {
  diary?: DeskDiary;
  focus?: DeskArrival | null;
  onFocusShown?: () => void;
  onPage?: ReadonlySet<string>;
  onShowThings?: (ids: readonly string[], pointer: boolean) => void;
  /** What the modal's host says: on or off, who opened it, what just landed. */
  tiff?: Partial<TiffApi>;
  /** The Diary is the face on screen (the frame's say). */
  showing?: boolean;
};
/** Every task and issue the entries made has a row on the page. */
const ALL_ON_PAGE: ReadonlySet<string> = new Set(["t2", "t3", "i1"]);
const onShowThings = jest.fn();
const onFocusShown = jest.fn();
/* The face the frame puts the diary in: the one thing on the page that
   scrolls. */
const Face = (p: Props) => (
  <TiffContext.Provider value={tiff(p.tiff)}>
    <section className="hd-face" data-testid="face">
      <HomeDiaryFeed
        diary={p.diary ?? diary([TODAYS, SICK, WIPERS])}
        showing={p.showing ?? true}
        viewerStaffId={ME}
        focus={p.focus ?? null}
        onFocusShown={p.onFocusShown ?? onFocusShown}
        onPage={p.onPage ?? ALL_ON_PAGE}
        onShowThings={p.onShowThings ?? onShowThings}
      />
    </section>
  </TiffContext.Provider>
);
const draw = (p: Props = {}) => render(<Face {...p} />);
const box = () => screen.getByRole("textbox", { name: "Add to the diary" });
const itemOf = (id: string) => document.querySelector<HTMLElement>(`[data-entry="${id}"]`)!;
const lit = (id: string) => itemOf(id).querySelector(".hd-dy-en")!.hasAttribute("data-lit");

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the column", () => {
  it("is the box, then Today and today's entries, then everything older with no more dividers", () => {
    draw();
    expect(box()).toHaveAttribute("placeholder", "Add to the diary…");
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getByRole("heading", { level: 2 })).toHaveClass("hd-dy-day");
    expect(within(today).getAllByRole("listitem").map((li) => li.dataset.entry)).toEqual(["e-today"]);
    const earlier = screen.getByRole("list", { name: "Earlier" });
    expect(within(earlier).getAllByRole("listitem").map((li) => li.dataset.entry)).toEqual(["e1", "e-wipers"]);
    // one divider: Today's, and nothing between the older days
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("says \"Nothing yet.\" under Today when today has nothing, and no older list when there is nothing older", () => {
    draw({ diary: diary([]) });
    expect(within(screen.getByRole("region", { name: "Today" })).getByText("Nothing yet.")).toHaveClass("hd-dy-none");
    expect(screen.queryByRole("list", { name: "Earlier" })).toBeNull();
  });

  it("gives each entry your initials, You and when — the time alone today, its date before — and the words verbatim", () => {
    draw();
    const today = itemOf("e-today");
    expect(today.querySelector(".hd-dy-av")).toHaveTextContent("IS");
    expect(today.querySelector(".hd-dy-av")).toHaveAttribute("aria-hidden", "true");
    expect(today.querySelector(".hd-dy-m")!.textContent).toBe("You, 2:17 pm");
    expect(itemOf("e1").querySelector(".hd-dy-m")!.textContent).toBe("You, Tue 8 Sept, 8:42 pm");
    expect(itemOf("e-wipers").querySelector(".hd-dy-p")!.textContent).toBe(WIPERS.said);
  });
});

describe("under the words", () => {
  it("groups the tasks by whose they are, keeps the Library's, the note's and the issue's doors, and says the rest", () => {
    draw();
    const under = itemOf("e-today").querySelector<HTMLElement>(".hd-dy-doors")!;
    expect(within(under).getByRole("button", { name: "2 tasks for Luke" })).toHaveClass("hd-dy-door");
    expect(within(under).getByRole("link", { name: "Isolator sizes for a 7.1 kW" })).toHaveAttribute(
      "href",
      "/dashboard/tiff/library?doc=k1",
    );
    expect(within(under).getByRole("link", { name: "1 line kept" })).toHaveAttribute("href", "/dashboard/my-notes");
    expect(within(under).getByRole("button", { name: "Rooftop unit keeps tripping" })).toBeInTheDocument();
    expect(within(under).getByText("1 task removed.")).toHaveClass("hd-dy-note");
    // the task titles are counted, not repeated
    expect(under).not.toHaveTextContent("Order filters");
  });

  it("says \"Nothing filed.\" under what Tiff read and filed nothing from, and nothing under a Save", () => {
    draw();
    expect(within(itemOf("e1")).getByText("Nothing filed.")).toHaveClass("hd-dy-note");
    expect(itemOf("e-wipers").querySelector(".hd-dy-doors")).toBeNull();
  });

  it("hands a task door's every task to the frame, saying whether a pointer pressed it", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "2 tasks for Luke" }));
    expect(onShowThings).toHaveBeenLastCalledWith(["t2", "t3"], true);
    screen.getByRole("button", { name: "Rooftop unit keeps tripping" }).focus();
    await user.keyboard("{Enter}");
    expect(onShowThings).toHaveBeenLastCalledWith(["i1"], false);
  });

  /* A task ticked off long ago, an issue resolved: no row on the page
     holds them, and a door would open on some other row. */
  it("says a task or an issue no row on the page holds, rather than drawing a door to it", () => {
    draw({ onPage: new Set(["t3"]) });
    const under = itemOf("e-today").querySelector<HTMLElement>(".hd-dy-doors")!;
    expect(within(under).getByRole("button", { name: "2 tasks for Luke" })).toBeInTheDocument();
    expect(within(under).queryByRole("button", { name: "Rooftop unit keeps tripping" })).toBeNull();
    expect(within(under).getByText("Rooftop unit keeps tripping.")).toHaveClass("hd-dy-note");
    cleanup();
    draw({ onPage: new Set() });
    const none = itemOf("e-today").querySelector<HTMLElement>(".hd-dy-doors")!;
    expect(within(none).queryByRole("button")).toBeNull();
    expect(within(none).getByText("2 tasks for Luke.")).toHaveClass("hd-dy-note");
    // the Library's and the note's are screens, always there to open
    expect(within(none).getAllByRole("link")).toHaveLength(2);
  });
});

describe("the box", () => {
  it("is the one entry box: the Tiff button when empty, Save and Sort it out once you type", async () => {
    const user = userEvent.setup();
    draw();
    expect(screen.getByRole("button", { name: "Talk to Tiff" })).toBeInTheDocument();
    await user.type(box(), "Filters from Reece");
    expect(screen.queryByRole("button", { name: "Talk to Tiff" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort it out" })).toBeInTheDocument();
  });

  it("opens Tiff listening, in the diary's room, from the Tiff button on an empty box", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Talk to Tiff" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toMatchObject({ room: "diary" });
    expect(open.mock.calls[0]![0]).not.toHaveProperty("words");
  });

  it("takes the words to Tiff on Enter, in the diary's room, and saves nothing", async () => {
    const user = userEvent.setup();
    draw();
    await user.type(box(), "Callum needs the filters from Reece{Enter}");
    expect(open.mock.calls[0]![0]).toMatchObject({ words: "Callum needs the filters from Reece", room: "diary" });
    expect(keepWords).not.toHaveBeenCalled();
    expect(box()).toHaveValue("");
  });

  it("keeps the words as typed on Save, in the diary's room, and empties the box", async () => {
    keepWords.mockResolvedValue({ ok: true, noteId: "e-new" });
    const user = userEvent.setup();
    draw();
    await user.type(box(), "Van booked in for Tuesday");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(keepWords).toHaveBeenCalledWith("Van booked in for Tuesday", "diary");
    expect(open).not.toHaveBeenCalled();
    expect(box()).toHaveValue("");
  });

  it("puts the words back with the reason when the save is refused", async () => {
    keepWords.mockResolvedValue({ ok: false, error: "Couldn't save that." });
    const user = userEvent.setup();
    draw();
    await user.type(box(), "Van booked in for Tuesday");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(box()).toHaveValue("Van booked in for Tuesday");
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save that.");
  });
});

describe("what you just saved", () => {
  /* The action revalidates Home, and the page comes back with the entry in
     it: here, the same diary drawn again with the new entry at the top. */
  const saved = entry({ id: "e-new", said: "Van booked in for Tuesday", day: TODAY, at: "3:05 pm", stamp: `${TODAY} 15:05:00`, routed: false });

  it("lands at the top of Today, lit, saying \"just now\", and Nothing yet. goes", async () => {
    keepWords.mockResolvedValue({ ok: true, noteId: "e-new" });
    const user = userEvent.setup();
    const { rerender } = draw({ diary: diary([SICK]) });
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
    await user.type(box(), "Van booked in for Tuesday");
    await user.click(screen.getByRole("button", { name: "Save" }));
    rerender(<Face diary={diary([saved, SICK])} />);
    expect(screen.queryByText("Nothing yet.")).toBeNull();
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getAllByRole("listitem")[0]).toBe(itemOf("e-new"));
    expect(itemOf("e-new").querySelector(".hd-dy-m")!.textContent).toBe("You, just now");
    expect(lit("e-new")).toBe(true);
    expect(lit("e1")).toBe(false);
  });

  it("stays lit for the wash's seven seconds and then goes out, still \"just now\"", async () => {
    jest.useFakeTimers();
    keepWords.mockResolvedValue({ ok: true, noteId: "e-new" });
    const { rerender } = draw({ diary: diary([SICK]) });
    fireEvent.change(box(), { target: { value: "Van booked in for Tuesday" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    rerender(<Face diary={diary([saved, SICK])} />);
    expect(DIARY_LIT_MS).toBe(7000);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS - 1);
    });
    expect(lit("e-new")).toBe(true);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(lit("e-new")).toBe(false);
    expect(itemOf("e-new").querySelector(".hd-dy-m")!.textContent).toBe("You, just now");
  });

  /* Each light keeps its own clock: a second save neither cuts the first
     one's short nor holds it on. */
  it("keeps each save's light on its own clock", async () => {
    jest.useFakeTimers();
    const a = entry({ id: "e-a", said: "Van booked in", day: TODAY, at: "3:05 pm", stamp: `${TODAY} 15:05:00`, routed: false });
    const b = entry({ id: "e-b", said: "Filters ordered", day: TODAY, at: "3:08 pm", stamp: `${TODAY} 15:08:00`, routed: false });
    const { rerender } = draw({ diary: diary([SICK]) });
    const saveAs = async (id: string, words: string) => {
      keepWords.mockResolvedValueOnce({ ok: true, noteId: id });
      fireEvent.change(box(), { target: { value: words } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
    };
    await saveAs("e-a", "Van booked in");
    rerender(<Face diary={diary([a, SICK])} />);
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    await saveAs("e-b", "Filters ordered");
    rerender(<Face diary={diary([b, a, SICK])} />);
    expect(lit("e-a")).toBe(true);
    expect(lit("e-b")).toBe(true);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS - 3000);
    });
    expect(lit("e-a")).toBe(false);
    expect(lit("e-b")).toBe(true);
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(lit("e-b")).toBe(false);
  });
});

describe("a door from another face", () => {
  const door: DeskArrival = { face: "diary", kind: "entry", ids: ["e-wipers"], pointer: false };

  it("brings the entry to 16px under the face's top, lights it, and hands the door back once its light has gone", () => {
    jest.useFakeTimers();
    const { rerender } = draw();
    const face = screen.getByTestId("face");
    face.scrollTop = 40;
    face.getBoundingClientRect = () => ({ top: 300 }) as DOMRect;
    itemOf("e-wipers").getBoundingClientRect = () => ({ top: 820 }) as DOMRect;
    const scrollTo = jest.fn();
    face.scrollTo = scrollTo as unknown as typeof face.scrollTo;

    rerender(<Face focus={door} />);
    expect(scrollTo).toHaveBeenCalledWith({ top: 40 + 820 - 300 - 16, behavior: "auto" });
    expect(lit("e-wipers")).toBe(true);
    expect(lit("e-today")).toBe(false);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS - 1);
    });
    expect(onFocusShown).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onFocusShown).toHaveBeenCalledTimes(1);
  });

  it("is not this face's when it names a task or rows: nothing moves and nothing lights", () => {
    const { rerender } = draw();
    const face = screen.getByTestId("face");
    const scrollTo = jest.fn();
    face.scrollTo = scrollTo as unknown as typeof face.scrollTo;
    rerender(<Face focus={{ face: "diary", kind: "rows", ids: ["e-wipers"], pointer: true }} />);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(lit("e-wipers")).toBe(false);
  });

  /* The door that was pressed may have gone with its face (Tasks' Open in
     diary hides the Tasks face), so the focus lands on what it named. */
  it("gives the entry it names the focus, without scrolling it a second time", () => {
    const { rerender } = draw();
    const wash = itemOf("e-wipers").querySelector<HTMLElement>(".hd-dy-en")!;
    expect(wash).toHaveAttribute("tabindex", "-1");
    const focus = jest.spyOn(wash, "focus");
    rerender(<Face focus={door} />);
    expect(document.activeElement).toBe(wash);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  describe("where the browser may move", () => {
    const realAnimate = Element.prototype.animate;
    beforeEach(() => {
      Element.prototype.animate = jest.fn() as unknown as typeof Element.prototype.animate;
      window.matchMedia = ((q: string) => ({ matches: !q.includes("reduce") })) as typeof window.matchMedia;
    });
    afterEach(() => {
      Element.prototype.animate = realAnimate;
      delete (window as { matchMedia?: unknown }).matchMedia;
    });

    /* Law 8: no motion on a keyboard-driven action. */
    it("scrolls smoothly for a door a pointer pressed, and at once for one a key pressed", () => {
      const { rerender } = draw();
      const face = screen.getByTestId("face");
      const scrollTo = jest.fn();
      face.scrollTo = scrollTo as unknown as typeof face.scrollTo;
      rerender(<Face focus={{ ...door, pointer: true }} />);
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth" }));
      rerender(<Face focus={{ ...door, pointer: false }} />);
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
    });
  });

  /* The wash is a CSS animation on the entry: a door asking for it again,
     lit or long after, starts it over rather than leaving it faded. */
  it("starts the wash over when the entry is asked for again", () => {
    const run = { currentTime: 5200 as number | null, play: jest.fn() };
    const proto = Element.prototype as { getAnimations?: unknown };
    const real = proto.getAnimations;
    proto.getAnimations = function (this: Element) {
      return this.classList.contains("hd-dy-en") && this.hasAttribute("data-lit") ? [run] : [];
    };
    try {
      const { rerender } = draw();
      rerender(<Face focus={door} />);
      run.currentTime = 6800;
      run.play.mockClear();
      rerender(<Face focus={{ ...door }} />);
      expect(run.currentTime).toBe(0);
      expect(run.play).toHaveBeenCalledTimes(1);
    } finally {
      proto.getAnimations = real;
    }
  });
});

/* ── WHAT TIFF MADE OF IT (H23): her line under your words, the door back
   into the conversation, and Undo. ── */

describe("what Tiff made of it", () => {
  const DONE = "Done. A task for Luke: the filters from Reece, before 1398 Waterloo at 7:00 tomorrow.";
  const TALKED = entry({
    id: "e-talked",
    said: "Luke needs the filters from Reece before 1398 Waterloo tomorrow",
    day: TODAY,
    at: "3:12 pm",
    stamp: `${TODAY} 15:12:00`,
    outcomes: [{ kind: "todo", text: "Filters from Reece", go: { type: "task", id: "t9" } }],
    taskFor: { t9: "s-luke" },
    turns: [
      { who: "you", text: "Luke needs the filters from Reece before 1398 Waterloo tomorrow" },
      { who: "tiff", text: DONE },
    ],
    undo: true,
  });
  const onPage = new Set(["t9"]);
  /** Her line's name, as a browser reads it. jsdom spaces the bold name
      off its colon ("Tiff : Done."), where a browser runs inline words
      together, so the space is taken out before comparing. */
  const named = (text: string) => (name: string) => name.replace(/^Tiff :/, "Tiff:") === text;
  const under = () => itemOf("e-talked").querySelector<HTMLElement>(".hd-dy-bd")!;
  const line = () => within(under()).getByRole("button", { name: named(`Tiff: ${DONE}`) });
  const at = "2026-09-25T05:13:00.000Z";
  const takenBack = {
    ok: true,
    summary: "1 task taken back.",
    turns: [
      { who: "you", text: TALKED.said, at },
      { who: "tiff", text: "A task for Luke: the filters from Reece, before 1398 Waterloo at 7:00 tomorrow.", at },
      { who: "tiff", text: DONE, at },
      { who: "tiff", text: "1 task taken back.", at },
    ],
  };

  it("says her last word under yours, after Tiff, and before what it made", () => {
    draw({ diary: diary([TALKED, SICK]), onPage });
    const theLine = line();
    expect(theLine).toHaveClass("hd-dy-tiff");
    expect(theLine.querySelector("b")).toHaveTextContent(/^Tiff$/);
    // under the words, over the doors
    expect(under().querySelector(".hd-dy-p")!.nextElementSibling).toBe(theLine);
    expect(theLine.nextElementSibling).toHaveClass("hd-dy-doors");
    // nothing where she never answered: a Save, an entry from before her
    expect(itemOf("e1").querySelector(".hd-dy-tiff")).toBeNull();
  });

  it("opens the conversation again from her line, in the diary's room, growing from the line", async () => {
    const user = userEvent.setup();
    draw({ diary: diary([TALKED]), onPage });
    const theLine = line();
    expect(theLine).toHaveAttribute("aria-haspopup", "dialog");
    expect(theLine).toHaveAttribute("aria-expanded", "false");
    await user.click(theLine);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toEqual({
      from: theLine,
      conversation: TALKED.turns,
      room: "diary",
      id: "hd-dy-tiff-e-talked",
      keyboard: false,
    });
  });

  it("opens it from the keyboard with nothing flying from the line (law 8), and reads as open while it is", async () => {
    const user = userEvent.setup();
    const { rerender } = draw({ diary: diary([TALKED]), onPage });
    line().focus();
    await user.keyboard("{Enter}");
    expect(open.mock.calls[0]![0]).toMatchObject({ keyboard: true });
    rerender(<Face diary={diary([TALKED])} onPage={onPage} tiff={{ openedBy: "hd-dy-tiff-e-talked", isOpen: true }} />);
    expect(line()).toHaveAttribute("aria-expanded", "true");
  });

  it("is her words and no door where this viewer has no modal", () => {
    draw({ diary: diary([TALKED]), onPage, tiff: { enabled: false } });
    expect(within(under()).queryByRole("button", { name: /^Tiff:/ })).toBeNull();
    const theLine = under().querySelector(".hd-dy-tiff")!;
    expect(theLine.tagName).toBe("P");
    expect(theLine.textContent).toBe(`Tiff: ${DONE}`);
  });

  it("offers Undo at the end of what it made, and only where it can take something back", () => {
    draw({ diary: diary([TALKED, SICK, WIPERS]), onPage });
    const doors = itemOf("e-talked").querySelector<HTMLElement>(".hd-dy-doors")!;
    const undo = within(doors).getByRole("button", { name: "Undo" });
    expect(undo).toHaveClass("hd-dy-undo");
    // the last thing it made says, then Undo, then the place its sentence
    // will be written into: there, and empty, before anything is said
    expect(undo.previousElementSibling).toHaveTextContent("1 task for Luke");
    expect(undo.nextElementSibling).toBe(doors.lastElementChild);
    expect(doors.lastElementChild).toHaveAttribute("role", "status");
    expect(doors.lastElementChild).toBeEmptyDOMElement();
    expect(within(itemOf("e1")).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(within(itemOf("e-wipers")).queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("takes it back: Tiff's line says what went, and what it made and Undo go with it", async () => {
    undoNote.mockResolvedValue(takenBack);
    const user = userEvent.setup();
    draw({ diary: diary([TALKED]), onPage });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undoNote).toHaveBeenCalledWith("e-talked");
    expect(within(under()).getByRole("button", { name: named("Tiff: 1 task taken back.") })).toBeInTheDocument();
    expect(within(under()).queryByRole("button", { name: "1 task for Luke" })).toBeNull();
    expect(within(under()).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(under().querySelector(".hd-dy-doors")).toBeNull();
    // your words stay
    expect(under().querySelector(".hd-dy-p")!.textContent).toBe(TALKED.said);
  });

  it("opens the conversation it took back as the modal said it, the taking back included", async () => {
    undoNote.mockResolvedValue(takenBack);
    const user = userEvent.setup();
    draw({ diary: diary([TALKED]), onPage });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(within(under()).getByRole("button", { name: named("Tiff: 1 task taken back.") }));
    expect(open.mock.calls[0]![0]).toMatchObject({
      conversation: [
        { who: "you", text: TALKED.said },
        { who: "tiff", text: DONE },
        { who: "tiff", text: "1 task taken back." },
      ],
    });
  });

  it("puts a refusal in Undo's place, for good, and leaves what it made where it is", async () => {
    const refusal = "Luke has already ticked off one of those, so nothing was taken back.";
    undoNote.mockResolvedValue({ ok: false, error: refusal });
    const user = userEvent.setup();
    draw({ diary: diary([TALKED]), onPage });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(under()).getByRole("status")).toHaveTextContent(refusal);
    expect(within(under()).getByRole("status")).toHaveClass("hd-dy-note");
    expect(within(under()).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(within(under()).getByRole("button", { name: "1 task for Luke" })).toBeInTheDocument();
    expect(line()).toBeInTheDocument();
  });

  it("says so when Undo's answer never comes, and can be pressed again", async () => {
    undoNote.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(takenBack);
    const user = userEvent.setup();
    draw({ diary: diary([TALKED]), onPage });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(under()).getByRole("status")).toHaveTextContent(NOT_REACHED);
    const again = within(under()).getByRole("button", { name: "Undo" });
    expect(again).toBeEnabled();
    await user.click(again);
    expect(undoNote).toHaveBeenCalledTimes(2);
    expect(within(under()).queryByRole("status")).toBeNull();
    expect(within(under()).getByRole("button", { name: named("Tiff: 1 task taken back.") })).toBeInTheDocument();
  });

  it("is one press while it is out", async () => {
    let answer: (v: unknown) => void = () => {};
    undoNote.mockReturnValue(new Promise((r) => (answer = r)));
    draw({ diary: diary([TALKED]), onPage });
    const undo = screen.getByRole("button", { name: "Undo" });
    await act(async () => {
      fireEvent.click(undo);
      fireEvent.click(undo);
    });
    expect(undoNote).toHaveBeenCalledTimes(1);
    // held, not disabled: a disabled button drops the keyboard to the page
    expect(undo).toHaveAttribute("aria-disabled", "true");
    expect(undo).toBeEnabled();
    await act(async () => answer(takenBack));
    expect(within(under()).getByRole("button", { name: named("Tiff: 1 task taken back.") })).toBeInTheDocument();
  });

  /* The first press landed and its answer was lost; pressed again, the
     server says it was taken back already, with the conversation as it
     stands. The entry says what went, rather than a refusal beside doors to
     tasks that have gone. */
  it("is taken back when a press after a lost answer finds it taken back already", async () => {
    undoNote.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({
      ok: false,
      error: "That was already taken back.",
      turns: takenBack.turns,
    });
    const user = userEvent.setup();
    draw({ diary: diary([TALKED]), onPage });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(within(under()).getByRole("button", { name: "Undo" }));
    expect(undoNote).toHaveBeenCalledTimes(2);
    expect(within(under()).getByRole("button", { name: named("Tiff: 1 task taken back.") })).toBeInTheDocument();
    expect(within(under()).queryByRole("button", { name: "1 task for Luke" })).toBeNull();
    expect(under().querySelector(".hd-dy-doors")).toBeNull();
    expect(under()).not.toHaveTextContent("That was already taken back.");
  });

  /* Pressed in two places at once (a second tab, the office PC): the press
     that loses the claim is answered with the conversation as it stands,
     and this entry says what went, the same as the one that won. */
  it("is taken back when somebody else's press took it back a moment first", async () => {
    undoNote.mockResolvedValueOnce({ ok: false, error: "That was already taken back.", turns: takenBack.turns });
    const user = userEvent.setup();
    draw({ diary: diary([TALKED]), onPage });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undoNote).toHaveBeenCalledTimes(1);
    expect(within(under()).getByRole("button", { name: named("Tiff: 1 task taken back.") })).toBeInTheDocument();
    expect(within(under()).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(under().querySelector(".hd-dy-doors")).toBeNull();
    expect(under()).not.toHaveTextContent("That was already taken back.");
  });

  describe("from the keyboard", () => {
    /* The Undo you pressed goes, or goes quiet, so the keyboard is put on
       what answered rather than dropped to the top of the page. */
    it("stays on Undo while it is out, and lands on Tiff's line, saying what went, when it worked", async () => {
      let answer: (v: unknown) => void = () => {};
      undoNote.mockReturnValue(new Promise((r) => (answer = r)));
      const user = userEvent.setup();
      draw({ diary: diary([TALKED]), onPage });
      const undo = screen.getByRole("button", { name: "Undo" });
      undo.focus();
      await user.keyboard("{Enter}");
      expect(undo).toHaveFocus();
      await act(async () => answer(takenBack));
      const back = within(under()).getByRole("button", { name: named("Tiff: 1 task taken back.") });
      expect(back).toHaveFocus();
    });

    it("lands on the entry when it was refused, with the sentence in the place kept for it", async () => {
      const refusal = "Someone has already acted on one of those, so nothing was taken back.";
      undoNote.mockResolvedValue({ ok: false, error: refusal });
      const user = userEvent.setup();
      draw({ diary: diary([TALKED]), onPage });
      const said = within(under()).getByRole("status");
      screen.getByRole("button", { name: "Undo" }).focus();
      await user.keyboard("{Enter}");
      expect(itemOf("e-talked").querySelector(".hd-dy-en")).toHaveFocus();
      // the same live region, written into rather than mounted with its words
      expect(within(under()).getByRole("status")).toBe(said);
      expect(said).toHaveTextContent(refusal);
    });

    it("stays on Undo when the answer never came, to press again", async () => {
      undoNote.mockRejectedValueOnce(new Error("offline"));
      const user = userEvent.setup();
      draw({ diary: diary([TALKED]), onPage });
      const said = within(under()).getByRole("status");
      screen.getByRole("button", { name: "Undo" }).focus();
      await user.keyboard("{Enter}");
      expect(within(under()).getByRole("button", { name: "Undo" })).toHaveFocus();
      expect(within(under()).getByRole("status")).toBe(said);
      expect(said).toHaveTextContent(NOT_REACHED);
    });

    it("leaves the keyboard where you took it while the answer was out", async () => {
      let answer: (v: unknown) => void = () => {};
      undoNote.mockReturnValue(new Promise((r) => (answer = r)));
      const user = userEvent.setup();
      draw({ diary: diary([TALKED]), onPage });
      screen.getByRole("button", { name: "Undo" }).focus();
      await user.keyboard("{Enter}");
      box().focus();
      await act(async () => answer(takenBack));
      expect(box()).toHaveFocus();
    });
  });

  it("keeps an entry the page reads as taken back: your words, Tiff's line, and nothing under them", () => {
    const back = entry({
      ...TALKED,
      outcomes: [],
      taskFor: {},
      turns: [...TALKED.turns, { who: "tiff", text: "1 task taken back." }],
      undo: false,
      undone: true,
    });
    draw({ diary: diary([back]), onPage });
    expect(within(under()).getByRole("button", { name: named("Tiff: 1 task taken back.") })).toBeInTheDocument();
    expect(under().querySelector(".hd-dy-doors")).toBeNull();
    expect(within(under()).queryByText("Nothing filed.")).toBeNull();
  });

  /* The modal says what it filed for two seconds after it closes; its notes
     are entries here once the page has read them again. */
  /* The modal's notes are lit as it closes, and reach the page one read
     later. His wash (held for three quarters of seven seconds, then faded)
     starts drawing when the entry appears, so its seven seconds start then
     too, or it would be cut short and snap off. */
  it("starts the wash's seven seconds when the page brings the entry, not when the modal closed", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diary([SICK]) });
    rerender(<Face diary={diary([SICK])} tiff={{ landed: { noteIds: ["e-talked"], ids: ["t9"] } }} />);
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    // the read comes round three seconds later
    rerender(<Face diary={diary([TALKED, SICK])} onPage={onPage} tiff={{ landed: null }} />);
    expect(lit("e-talked")).toBe(true);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(lit("e-talked")).toBe(true);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS - 5000);
    });
    expect(lit("e-talked")).toBe(false);
  });

  it("holds the wash of an entry that lands behind another face until the Diary is up", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diary([SICK]), showing: false });
    rerender(<Face diary={diary([SICK])} showing={false} tiff={{ landed: { noteIds: ["e-talked"], ids: ["t9"] } }} />);
    rerender(<Face diary={diary([TALKED, SICK])} onPage={onPage} showing={false} tiff={{ landed: null }} />);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS + 1000);
    });
    expect(lit("e-talked")).toBe(true);
    rerender(<Face diary={diary([TALKED, SICK])} onPage={onPage} showing tiff={{ landed: null }} />);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS - 1);
    });
    expect(lit("e-talked")).toBe(true);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(lit("e-talked")).toBe(false);
  });

  it("lights what the modal filed as it closes, \"just now\", for the wash's seven seconds", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diary([SICK]) });
    rerender(<Face diary={diary([SICK])} tiff={{ landed: { noteIds: ["e-talked"], ids: ["t9"] } }} />);
    // the page comes round with the entry in it
    rerender(<Face diary={diary([TALKED, SICK])} onPage={onPage} tiff={{ landed: null }} />);
    expect(itemOf("e-talked").querySelector(".hd-dy-m")!.textContent).toBe("You, just now");
    expect(lit("e-talked")).toBe(true);
    expect(lit("e1")).toBe(false);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS);
    });
    expect(lit("e-talked")).toBe(false);
    expect(itemOf("e-talked").querySelector(".hd-dy-m")!.textContent).toBe("You, just now");
  });
});
