import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TiffContext, type TiffApi } from "@/components/tiff/modal/tiff-context";
import type { DeskArrival } from "@/lib/dashboard/desk-focus";
import { DIARY_LIT_MS, type DeskDiary } from "@/lib/dashboard/diary-doors";
import { buildConversations, diaryFeed, type MentionNote } from "@/lib/dashboard/diary-feed";
import { DIARY_RECHECK_MS, DIARY_STALE_MS } from "@/lib/dashboard/diary-refresh";
import type { DiaryEntry } from "@/lib/dashboard/journal";
import type { Sm8Person } from "@/lib/workboard/job-notes-query";
import { HomeDiaryFeed } from "../home-diary-feed";
import { DeskJobHost } from "../home-job-sheet";

/* THE DIARY'S CONVERSATIONS (H17): someone who asked you something in a
   ServiceM8 job note, threaded with every answer either way; its job door
   onto the desk's one card, Reply into ServiceM8, the light on his newest
   message, a door from another face, and the diary asking for the page
   again. The people and the jobs are the real ones the design was drawn
   from (Luke's asks of Isaac in September 2026); the replies are
   examples.

   The diary is the real one, inside the desk's real card host; the card
   itself and every server action are stubs, so nothing here reaches a
   model, ServiceM8 or the database. */

const mockRouter = { refresh: jest.fn(), push: jest.fn() };
jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/dashboard",
}));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: jest.fn() }));
jest.mock("@/app/actions/workboard-notes", () => ({
  keepWords: jest.fn(),
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
const mockOpenMirrorJob = jest.fn();
jest.mock("@/app/actions/workboard", () => ({ openMirrorJob: (id: string) => mockOpenMirrorJob(id) }));
jest.mock("@/components/workboard/board/job-sheet", () => ({
  JobSheet: (p: { row: { number: string | null; clientName: string | null } }) => (
    <div role="dialog" aria-label={`Job ${p.row.number ?? ""}`}>
      {p.row.clientName}
    </div>
  ),
}));

const TODAY = "2026-09-25";
const ISAAC: Sm8Person = { uuid: "u-isaac", handle: "isaacsmith", name: "Isaac Smith", first: "Isaac" };
const LUKE: Sm8Person = { uuid: "u-luke", handle: "lukeingold", name: "Luke Ingold", first: "Luke" };
const J2041 = "3f2b8c1e-0d4a-4b6f-9a2e-1c5d7e9f0a11";
const J2749 = "7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const JOBS = new Map([
  [J2041, { label: "2041 Wollstonecraft", live: true }],
  [J2749, { label: "2749 Woolloomooloo", live: false }],
]);

const note = (uuid: string, jobUuid: string, author: string, at: string, text: string): MentionNote => ({
  uuid,
  jobUuid,
  author,
  at,
  text,
});
const ASK = note("n-ask", J2041, LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary to discuss");
const HIS_NUMBER = note("n-num", J2041, LUKE.uuid, "2026-09-22 09:42:00", "her number is on the card");
const MINE = note("n-mine", J2041, ISAAC.uuid, "2026-09-22 15:10:00", "@lukeingold calling her this afternoon");
const HIS_ANSWER = note("n-thanks", J2041, LUKE.uuid, `${TODAY} 08:15:00`, "@isaacsmith thanks, she's expecting you");

const SICK: DiaryEntry = {
  id: "e1",
  said: "Can you mark Isaac Smith as sick? Today.",
  day: "2026-09-23",
  at: "8:42 pm",
  outcomes: [],
  spoken: true,
  stamp: "2026-09-23 20:42:00",
  routed: false,
  taskFor: {},
};

/** A sync that finished a minute before the page opened: nothing to ask. */
const justSynced = () => new Date(Date.now() - 60_000).toISOString();

const diaryOf = (
  notes: MentionNote[],
  opts: { syncedAt?: string | null; mentions?: boolean; entries?: DiaryEntry[] } = {},
): DeskDiary => ({
  feed: diaryFeed({
    entries: opts.entries ?? [],
    conversations: buildConversations({
      notes,
      me: { uuid: ISAAC.uuid, handle: ISAAC.handle },
      people: [ISAAC, LUKE],
      jobs: JOBS,
      today: TODAY,
    }),
    day: TODAY,
    mentions: opts.mentions ?? true,
    entriesCut: false,
    syncedAt: opts.syncedAt === undefined ? justSynced() : opts.syncedAt,
  }),
  you: "IS",
  names: {},
});

const tiff = (isOpen: boolean): TiffApi => ({
  enabled: true,
  open: () => true,
  openedBy: null,
  isOpen,
  landed: null,
  report: () => {},
});

const onFocusShown = jest.fn();
type Props = { diary: DeskDiary; focus?: DeskArrival | null; tiffOpen?: boolean; showing?: boolean };
const Face = ({ diary, focus = null, tiffOpen = false, showing = true }: Props) => (
  <TiffContext.Provider value={tiff(tiffOpen)}>
    <DeskJobHost manage={false} moneyVisible={false}>
      <section className="hd-face" data-testid="face" hidden={!showing}>
        <HomeDiaryFeed
          diary={diary}
          viewerStaffId="s-isaac"
          showing={showing}
          focus={focus}
          onFocusShown={onFocusShown}
          onPage={new Set()}
          onShowThings={() => {}}
        />
      </section>
    </DeskJobHost>
  </TiffContext.Provider>
);
const draw = (p: Props) => render(<Face {...p} />);
const talk = () => document.querySelector<HTMLElement>(`[data-conversation="${J2041}:u-luke"]`)!;
const headOf = (li: HTMLElement) => li.querySelector<HTMLElement>(":scope > .hd-dy-en")!;
const thread = (li: HTMLElement) => [...li.querySelectorAll<HTMLElement>(".hd-dy-tr")];
const lit = (el: Element) => el.hasAttribute("data-lit");

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a conversation", () => {
  it("is his ask as his entry: his initials in the grey disc, who asked you and when, his words less the handle", () => {
    draw({ diary: diaryOf([ASK]) });
    const li = talk();
    const disc = headOf(li).querySelector(":scope > .hd-dy-av")!;
    expect(disc).toHaveTextContent("LI");
    expect(disc).toHaveAttribute("data-who", "them");
    expect(disc).toHaveAttribute("aria-hidden", "true");
    expect(headOf(li).querySelector(".hd-dy-m")!.textContent).toBe("Luke Ingold to you, Mon 21 Sept, 1:42 pm");
    expect(within(li).getByText("Please call Mary to discuss")).toHaveClass("hd-dy-p");
    expect(li).not.toHaveTextContent("@isaacsmith");
  });

  it("threads every later message either way under the ask, in time order, each with its own disc", () => {
    draw({ diary: diaryOf([HIS_ANSWER, MINE, ASK, HIS_NUMBER]) });
    const rows = thread(talk());
    expect(rows.map((r) => r.querySelector(".hd-dy-m")!.textContent)).toEqual([
      "Luke Ingold, Tue 22 Sept, 9:42 am",
      "You to Luke, Tue 22 Sept, 3:10 pm",
      "Luke Ingold to you, 8:15 am",
    ]);
    expect(rows.map((r) => r.querySelector(".hd-dy-p")!.textContent)).toEqual([
      "her number is on the card",
      "calling her this afternoon",
      "thanks, she's expecting you",
    ]);
    // his discs grey with his initials, yours ink with yours
    expect(rows.map((r) => [r.querySelector(".hd-dy-av")!.textContent, r.querySelector(".hd-dy-av")!.getAttribute("data-who")])).toEqual([
      ["LI", "them"],
      ["IS", null],
      ["LI", "them"],
    ]);
  });

  it("has no thread while nobody has written since the ask", () => {
    draw({ diary: diaryOf([ASK]) });
    expect(talk().querySelector(".hd-dy-thread")).toBeNull();
  });

  it("stands in the one column with your entries, by the asker's newest message", () => {
    draw({ diary: diaryOf([ASK, MINE], { entries: [SICK] }) });
    const earlier = screen.getByRole("list", { name: "Earlier" });
    // your reply on the 22nd does not move it above your entry of the 23rd
    expect([...earlier.children].map((li) => (li as HTMLElement).dataset.item)).toEqual([
      "entry:e1",
      `mention:${J2041}:u-luke`,
    ]);
  });
});

describe("under it", () => {
  it("is the job's door, Reply into the job in ServiceM8 in a new tab, and where it came from", () => {
    draw({ diary: diaryOf([ASK]) });
    const under = talk().querySelector<HTMLElement>(".hd-dy-doors")!;
    expect(within(under).getByRole("button", { name: "2041 Wollstonecraft" })).toHaveClass("hd-dy-door");
    const reply = within(under).getByRole("link", { name: "Reply" });
    expect(reply).toHaveClass("hd-dy-door");
    expect(reply).toHaveAttribute("href", `https://go.servicem8.com/OpenJob/${J2041}`);
    expect(reply).toHaveAttribute("target", "_blank");
    expect(reply).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(under).getByText("A job note in ServiceM8.")).toHaveClass("hd-dy-note");
    expect([...under.children].map((c) => c.textContent)).toEqual([
      "2041 Wollstonecraft",
      "Reply",
      "A job note in ServiceM8.",
    ]);
  });

  it("opens the job on the desk's one card", async () => {
    mockOpenMirrorJob.mockResolvedValue({ id: J2041, number: "2041", clientName: "Mary Jones" });
    const user = userEvent.setup();
    draw({ diary: diaryOf([ASK]) });
    await user.click(screen.getByRole("button", { name: "2041 Wollstonecraft" }));
    expect(mockOpenMirrorJob).toHaveBeenCalledWith(J2041);
    expect(await screen.findByRole("dialog", { name: "Job 2041" })).toHaveTextContent("Mary Jones");
  });

  /* #809: nothing goes to a job its business deleted — said in the Diary
     spec's words, verbatim, the card's own for a job that has gone. */
  it("is no door and no Reply on a job ServiceM8 has deleted, and says so", () => {
    draw({ diary: diaryOf([note("n-holly", J2749, LUKE.uuid, "2026-09-09 10:04:00", "@isaacsmith can you advise Holly")]) });
    const li = document.querySelector<HTMLElement>(`[data-conversation="${J2749}:u-luke"]`)!;
    const under = li.querySelector<HTMLElement>(".hd-dy-doors")!;
    expect(within(under).queryByRole("button")).toBeNull();
    expect(within(under).queryByRole("link")).toBeNull();
    expect([...under.children].map((c) => c.textContent)).toEqual([
      "A job note in ServiceM8.",
      "That job isn't in ServiceM8's copy any more.",
    ]);
  });
});

describe("his newest message", () => {
  it("brings the conversation up into Today when he answers you, lit, and the header keeps the ask's date", () => {
    draw({ diary: diaryOf([ASK, MINE, HIS_ANSWER], { entries: [SICK] }) });
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).queryByText("Nothing yet.")).toBeNull();
    expect(within(today).getAllByRole("listitem")[0]).toBe(talk());
    expect(headOf(talk()).querySelector(".hd-dy-m")!.textContent).toBe("Luke Ingold to you, Mon 21 Sept, 1:42 pm");
    expect(thread(talk()).map(lit)).toEqual([false, true]);
    // his reply is lit, not the whole conversation
    expect(lit(headOf(talk()))).toBe(false);
  });

  it("lights the whole conversation when the ask itself is today's", () => {
    draw({ diary: diaryOf([note("n-today", J2041, LUKE.uuid, `${TODAY} 07:00:00`, "@isaacsmith call Mary")]) });
    expect(lit(headOf(talk()))).toBe(true);
  });

  it("is not lit once you have answered it, nor from before today", () => {
    draw({ diary: diaryOf([ASK, MINE, HIS_ANSWER, note("n-done", J2041, ISAAC.uuid, `${TODAY} 09:00:00`, "@lukeingold done")]) });
    expect(thread(talk()).map(lit)).toEqual([false, false, false]);
    expect(lit(headOf(talk()))).toBe(false);
    cleanup();
    draw({ diary: diaryOf([ASK]) });
    expect(lit(headOf(talk()))).toBe(false);
  });

  it("stays lit for the wash's seven seconds and goes out, and a newer one from him lights again", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diaryOf([ASK, MINE, HIS_ANSWER]) });
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS - 1);
    });
    expect(thread(talk()).map(lit)).toEqual([false, true]);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(thread(talk()).map(lit)).toEqual([false, false]);
    // the page comes again with the same message: it stays out
    rerender(<Face diary={diaryOf([ASK, MINE, HIS_ANSWER])} />);
    expect(thread(talk()).map(lit)).toEqual([false, false]);
    // and again with another from him
    const more = note("n-more", J2041, LUKE.uuid, `${TODAY} 10:30:00`, "@isaacsmith she rang back");
    rerender(<Face diary={diaryOf([ASK, MINE, HIS_ANSWER, more])} />);
    expect(thread(talk()).map(lit)).toEqual([false, false, true]);
  });

  /* His reply can come in with the page while Tasks or the Calendar is up.
     A hidden face draws nothing, so its seven seconds wait to be seen, and
     then it has all of them. */
  it("waits to be seen when it comes in while another face is up, then has its whole seven seconds", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diaryOf([ASK, MINE]), showing: false });
    rerender(<Face diary={diaryOf([ASK, MINE, HIS_ANSWER])} showing={false} />);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS * 3);
    });
    expect(thread(talk()).map(lit)).toEqual([false, true]);
    rerender(<Face diary={diaryOf([ASK, MINE, HIS_ANSWER])} showing />);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS - 1);
    });
    expect(thread(talk()).map(lit)).toEqual([false, true]);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(thread(talk()).map(lit)).toEqual([false, false]);
  });

  /* Hidden part way through, the face starts its wash again when it comes
     back, and the light starts its seconds again with it — so the wash
     fades out rather than being cut off in its hold. */
  it("starts its seven seconds again when the face comes back before they were spent", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diaryOf([ASK, MINE, HIS_ANSWER]) });
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS / 2);
    });
    rerender(<Face diary={diaryOf([ASK, MINE, HIS_ANSWER])} showing={false} />);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS);
    });
    rerender(<Face diary={diaryOf([ASK, MINE, HIS_ANSWER])} showing />);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS - 1);
    });
    expect(thread(talk()).map(lit)).toEqual([false, true]);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(thread(talk()).map(lit)).toEqual([false, false]);
  });
});

describe("a door from another face", () => {
  const door: DeskArrival = { face: "diary", kind: "conversation", ids: ["n-ask"], pointer: false };

  it("brings the conversation a note of it names to 16px under the face's top, lights it whole, and gives it the focus", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diaryOf([ASK, MINE], { entries: [SICK] }) });
    const face = screen.getByTestId("face");
    face.scrollTop = 40;
    face.getBoundingClientRect = () => ({ top: 300 }) as DOMRect;
    talk().getBoundingClientRect = () => ({ top: 820 }) as DOMRect;
    const scrollTo = jest.fn();
    face.scrollTo = scrollTo as unknown as typeof face.scrollTo;

    rerender(<Face diary={diaryOf([ASK, MINE], { entries: [SICK] })} focus={door} />);
    expect(scrollTo).toHaveBeenCalledWith({ top: 40 + 820 - 300 - 16, behavior: "auto" });
    expect(lit(headOf(talk()))).toBe(true);
    expect(document.activeElement).toBe(headOf(talk()));
    // the entry beside it is not what was asked for
    expect(lit(document.querySelector('[data-entry="e1"] .hd-dy-en')!)).toBe(false);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS);
    });
    expect(onFocusShown).toHaveBeenCalledTimes(1);
  });

  it("finds it by a later note of it too", () => {
    const { rerender } = draw({ diary: diaryOf([ASK, MINE]) });
    rerender(<Face diary={diaryOf([ASK, MINE])} focus={{ ...door, ids: ["n-mine"] }} />);
    expect(lit(headOf(talk()))).toBe(true);
  });

  it("lights nothing for a note the diary does not hold, and still hands the door back", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diaryOf([ASK]) });
    rerender(<Face diary={diaryOf([ASK])} focus={{ ...door, ids: ["n-gone"] }} />);
    expect(lit(headOf(talk()))).toBe(false);
    act(() => {
      jest.advanceTimersByTime(DIARY_LIT_MS);
    });
    expect(onFocusShown).toHaveBeenCalledTimes(1);
  });
});

describe("the page coming again", () => {
  const stale = () => new Date(Date.now() - DIARY_STALE_MS - 60_000).toISOString();

  it("is asked for once, a minute after the diary opens on a stale copy of ServiceM8", () => {
    jest.useFakeTimers();
    draw({ diary: diaryOf([ASK], { syncedAt: stale() }) });
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS - 1);
    });
    expect(mockRouter.refresh).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS * 10);
    });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps its minute when the page draws again in it", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diaryOf([ASK], { syncedAt: stale() }) });
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS / 2);
    });
    rerender(<Face diary={diaryOf([ASK, MINE], { syncedAt: stale() })} />);
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS / 2);
    });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("is not asked for on a copy synced in the last ten minutes, nor for a diary that reads no ServiceM8", () => {
    jest.useFakeTimers();
    draw({ diary: diaryOf([ASK]) });
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS * 2);
    });
    cleanup();
    draw({ diary: diaryOf([], { mentions: false, syncedAt: null, entries: [SICK] }) });
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS * 2);
    });
    document.dispatchEvent(new Event("visibilitychange"));
    act(() => {
      jest.advanceTimersByTime(DIARY_STALE_MS * 2);
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockRouter.refresh).not.toHaveBeenCalled();
  });

  it("is asked for when you come back to the tab to a page more than ten minutes old, once, and not sooner", () => {
    jest.useFakeTimers();
    draw({ diary: diaryOf([ASK]) });
    act(() => {
      jest.advanceTimersByTime(DIARY_STALE_MS);
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockRouter.refresh).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  });

  /* Ten minutes from the page on screen: one that came in two minutes ago
     (a save's, or the diary's own minute) is not stale, however old the
     first page is. */
  it("counts its ten minutes from the newest page, not the first", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diaryOf([ASK]) });
    act(() => {
      jest.advanceTimersByTime(DIARY_STALE_MS - 60_000);
    });
    rerender(<Face diary={diaryOf([ASK, MINE])} />);
    act(() => {
      jest.advanceTimersByTime(120_000);
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockRouter.refresh).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(DIARY_STALE_MS);
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  });

  /* Away more than ten minutes, the copy is stale too, and the page the
     return asks for is drawn from it before the sync that page sets off
     has run: so a minute later it is asked for once more, and no more
     than once for one return, even when the sync never lands. */
  const backAfterTen = () => {
    act(() => {
      jest.advanceTimersByTime(DIARY_STALE_MS + 1);
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  };

  it("is asked for once more a minute after a return brings a page drawn from a stale copy", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diaryOf([ASK]) });
    backAfterTen();
    rerender(<Face diary={diaryOf([ASK], { syncedAt: stale() })} />);
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS - 1);
    });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(2);
    // what that brings is still stale: nothing more for the one return
    rerender(<Face diary={diaryOf([ASK, MINE], { syncedAt: stale() })} />);
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS * 10);
    });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(2);
  });

  it("is not asked for again when the page a return brings is drawn from a fresh copy", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diaryOf([ASK]) });
    backAfterTen();
    rerender(<Face diary={diaryOf([ASK, HIS_ANSWER])} />);
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS * 10);
    });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the return's minute when another page comes in it, and asks nothing for a page no return asked for", () => {
    jest.useFakeTimers();
    const { rerender } = draw({ diary: diaryOf([ASK]) });
    // a page no return asked for, stale or not, sets nothing going
    rerender(<Face diary={diaryOf([ASK, MINE], { syncedAt: stale() })} />);
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS * 2);
    });
    expect(mockRouter.refresh).not.toHaveBeenCalled();
    backAfterTen();
    rerender(<Face diary={diaryOf([ASK], { syncedAt: stale() })} />);
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS / 2);
    });
    rerender(<Face diary={diaryOf([ASK, MINE], { syncedAt: stale() })} />);
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS / 2);
    });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(2);
  });

  it("asks nothing once the diary has gone", () => {
    jest.useFakeTimers();
    const { rerender, unmount } = draw({ diary: diaryOf([ASK]) });
    backAfterTen();
    rerender(<Face diary={diaryOf([ASK], { syncedAt: stale() })} />);
    unmount();
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS * 2);
    });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("is not asked for while the tab is hidden", () => {
    jest.useFakeTimers();
    const state = jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      draw({ diary: diaryOf([ASK]) });
      act(() => {
        jest.advanceTimersByTime(DIARY_STALE_MS * 2);
      });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(mockRouter.refresh).not.toHaveBeenCalled();
    } finally {
      state.mockRestore();
    }
  });

  it("waits while Tiff is open, and is asked for as soon as she closes", () => {
    jest.useFakeTimers();
    const diary = diaryOf([ASK], { syncedAt: stale() });
    const { rerender } = draw({ diary, tiffOpen: true });
    act(() => {
      jest.advanceTimersByTime(DIARY_RECHECK_MS * 2);
    });
    expect(mockRouter.refresh).not.toHaveBeenCalled();
    rerender(<Face diary={diary} tiffOpen={false} />);
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
    rerender(<Face diary={diary} tiffOpen={true} />);
    rerender(<Face diary={diary} tiffOpen={false} />);
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  });
});
