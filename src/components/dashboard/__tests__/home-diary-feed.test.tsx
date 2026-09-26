import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TiffContext, type TiffApi } from "@/components/tiff/modal/tiff-context";
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
jest.mock("@/app/actions/workboard-notes", () => ({
  keepWords: (...a: unknown[]) => keepWords(...a),
  routeNote: jest.fn(),
  continueNote: jest.fn(),
  fileNote: jest.fn(),
  undoNote: jest.fn(),
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
const tiff = (): TiffApi => ({
  enabled: true,
  open: open as TiffApi["open"],
  openedBy: null,
  isOpen: false,
  landed: null,
  report: () => {},
});

type Props = {
  diary?: DeskDiary;
  focus?: DeskArrival | null;
  onFocusShown?: () => void;
  onPage?: ReadonlySet<string>;
  onShowThings?: (ids: readonly string[], pointer: boolean) => void;
};
/** Every task and issue the entries made has a row on the page. */
const ALL_ON_PAGE: ReadonlySet<string> = new Set(["t2", "t3", "i1"]);
const onShowThings = jest.fn();
const onFocusShown = jest.fn();
/* The face the frame puts the diary in: the one thing on the page that
   scrolls. */
const Face = (p: Props) => (
  <TiffContext.Provider value={tiff()}>
    <section className="hd-face" data-testid="face">
      <HomeDiaryFeed
        diary={p.diary ?? diary([TODAYS, SICK, WIPERS])}
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
