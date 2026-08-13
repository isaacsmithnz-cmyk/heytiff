import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardHome } from "../home";
import type { DashboardData } from "@/lib/dashboard/page-data";
import type { ActionChip } from "@/lib/dashboard/chips";
import type { BoardNotice } from "@/lib/dashboard/board";
import { HOME_NOTICE_ROWS } from "@/lib/dashboard/home-tabs";

/* Home as one card with six faces.

   The debrief control reaches the note flow and its server actions, and
   "use server" modules cannot be imported into jsdom. Stubbed so this suite
   stays about the card; the control has its own suite. */
jest.mock("@/components/notes/note-token", () => ({
  NoteToken: () => <button aria-label="Debrief" />,
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  createTask: jest.fn(),
  reopenTask: jest.fn(),
}));

const TODAY = "2026-08-10";

const chip = (state: "bad" | "warn", key: string): ActionChip => ({
  key,
  kind: "rego",
  state,
  label: state === "bad" ? "Rego expired 4 days ago" : "Rego expires in 2 weeks",
  subject: "Hilux ute",
  href: "/dashboard/assets",
  urgency: state === "bad" ? -4 : 10_014,
});

const data = (over: Partial<DashboardData> = {}): DashboardData => ({
  chips: { self: [], team: [] },
  calendar: { spanStart: "2026-08-03", spanEnd: "2026-11-01", days: [] },
  money: [],
  tasks: { mine: [], team: null, done: [], reported: [] },
  notices: [],
  journal: [],
  assignable: [],
  jobs: [],
  canManage: false,
  viewerStaffId: "s1",
  today: TODAY,
  ...over,
});

const draw = (over: Partial<DashboardData> = {}) => render(<DashboardHome data={data(over)} />);
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const panel = (key: string) => document.getElementById(`hmsec-${key}`)!;

describe("the card", () => {
  it("lands on Journal — the other four say for themselves whether they want you", () => {
    draw();
    expect(tab(/Journal/)).toHaveAttribute("aria-selected", "true");
    expect(panel("journal")).not.toHaveAttribute("hidden");
  });

  it("shows exactly ONE panel at a time", async () => {
    /* THE BUG THIS EXISTS FOR. `.wb2-urbody.twocol` sets `display:grid` and is
       (0,2,0); a plain `.wb2-body[hidden]` is (0,2,0) too and loses on source
       order, so the Tasks panel stayed painted underneath whichever tab was
       open. The stylesheet answers that at (0,3,0); this pins the markup side
       — every non-active panel carries `hidden`, so nothing but CSS
       specificity could ever put two on screen. */
    const user = userEvent.setup();
    const keys = ["journal", "urgent", "attention", "board", "tasks"];
    const shown = () => keys.filter((k) => !panel(k).hasAttribute("hidden"));

    draw({ tasks: { mine: [], team: null, done: [], reported: [] } });
    expect(shown()).toEqual(["journal"]);

    await user.click(tab(/Tasks/));
    expect(shown()).toEqual(["tasks"]);

    await user.click(tab(/Urgent/));
    expect(shown()).toEqual(["urgent"]);
  });

  it("wires each tab to the panel it controls", () => {
    draw();
    for (const k of ["journal", "urgent", "attention", "board", "tasks"]) {
      const t = document.getElementById(`hmtab-${k}`)!;
      expect(t).toHaveAttribute("aria-controls", `hmsec-${k}`);
      expect(panel(k)).toHaveAttribute("aria-labelledby", `hmtab-${k}`);
    }
  });
});

describe("the badges", () => {
  it("carry the counts, so a hidden tab still says whether it wants you", () => {
    /* The whole reason Journal can be the landing tab. A tab hides its content
       by definition; if the number went with it, the glance the counters
       existed for would be gone. */
    draw({
      chips: { self: [chip("bad", "a"), chip("warn", "b")], team: [] },
      tasks: { mine: [], team: null, done: [], reported: [] },
    });
    expect(within(tab(/Urgent/)).getByText("1")).toBeInTheDocument();
    expect(within(tab(/Needs attention/)).getByText("1")).toBeInTheDocument();
  });

  it("say what the number means, for anyone who can't see the tint", () => {
    draw({ chips: { self: [chip("bad", "a")], team: [] } });
    expect(tab(/Urgent/).textContent).toContain("past its date");
  });

  it("are absent on a clear day rather than showing a grey 0", () => {
    draw();
    for (const name of [/Urgent/, /Needs attention/, /Noticeboard/, /Tasks/]) {
      expect(tab(name).querySelector(".wb2-vtn")).toBeNull();
    }
  });
});

describe("the panels", () => {
  it("says what it checked when a view is empty, not just that it is", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(tab(/Urgent/));
    expect(panel("urgent").textContent).toMatch(/Nothing is past its date/);
  });

  it("renders the urgent chips as rows, worst first", async () => {
    const user = userEvent.setup();
    draw({ chips: { self: [chip("warn", "w"), chip("bad", "b")], team: [] } });
    await user.click(tab(/Urgent/));
    // only the bad one — warn belongs to the other tab, and the two split one list
    const rows = panel("urgent").querySelectorAll(".hm-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Rego expired 4 days ago");
    expect(rows[0]).toHaveAttribute("data-sev", "over");
  });
});

/* THE PANEL IS A GLANCE, THE BADGE IS THE COUNT.

   Home used to read 20 notices and the board 100, over the same table with the
   same read-state join, so the "N unread" badge and the board it links to were
   counting different sets of rows. They read one window now (NOTICE_WINDOW) —
   which means the panel has to say when it isn't showing all of it, rather
   than being the whole board on a thin month and a silent truncation on a
   busy one. */
describe("the Noticeboard panel", () => {
  const notice = (i: number, over: Partial<BoardNotice> = {}): BoardNotice =>
    ({
      id: `n${i}`,
      title: `Notice ${i}`,
      body: null,
      pinned: false,
      postedById: "s2",
      postedByName: "Dane Whitely",
      createdAt: `2026-08-0${(i % 9) + 1}T00:00:00Z`,
      revision: 1,
      editedAt: null,
      kind: "notice",
      expiresAt: null,
      archivedAt: null,
      ackedRevision: null,
      state: "unread",
      mine: false,
      readBy: 0,
      audience: 3,
      poll: null,
      event: null,
      reactions: { counts: [], mine: null },
      comments: [],
      mentionsMe: 0,
      attachments: [],
      ...over,
    }) as BoardNotice;

  const many = (n: number) => Array.from({ length: n }, (_, i) => notice(i));

  it("caps its rows and says how many are behind the door", async () => {
    const user = userEvent.setup();
    draw({ notices: many(HOME_NOTICE_ROWS + 4) });
    await user.click(tab(/Noticeboard/));
    expect(panel("board").querySelectorAll(".hm-row")).toHaveLength(HOME_NOTICE_ROWS);
    expect(panel("board").textContent).toContain("4 more");
  });

  it("says only 'Open the board' when there is nothing behind it", async () => {
    const user = userEvent.setup();
    draw({ notices: many(2) });
    await user.click(tab(/Noticeboard/));
    expect(panel("board").querySelectorAll(".hm-row")).toHaveLength(2);
    expect(panel("board").textContent).not.toMatch(/\bmore\b/);
  });

  /* The badge counts the WINDOW, not the panel. A truncated panel that also
     truncated the count would be the original bug wearing a cap. */
  it("badges every unread in the window, not just the rows on show", async () => {
    draw({ notices: many(HOME_NOTICE_ROWS + 4) });
    expect(within(tab(/Noticeboard/)).getByText(String(HOME_NOTICE_ROWS + 4))).toBeInTheDocument();
  });
});

describe("the page head", () => {
  it("names the screen — Home was the only one that didn't", () => {
    /* The hero was deleted in #321 and nothing replaced it, so the page
       opened on a tab strip with no name while every other screen has a
       heading. */
    draw();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Home");
  });

  it("carries the date from the loader, never the client clock", () => {
    /* It formats the SERVER's `today` (fmtAuWeekdayDateLong), because a
       Date.now() in a render body is the hydration failure
       project_hydration_clock_trap documents. TODAY is 2026-08-10, a Monday. */
    draw();
    const head = document.querySelector(".hm-phead")!;
    expect(head.textContent).toContain("Monday 10 August");
  });

  it("says the date ONCE — the journal's header gave it up to the head", () => {
    /* The date lived in the card's header for one round. With a page head
       carrying it, that row plus the record's own "Today ·" divider would
       have made three statements of one date on one screen. */
    draw();
    expect(document.querySelector(".hm-head")!.textContent).not.toContain("Monday");
    expect(screen.queryByText("Say the day")).toBeNull();
  });

  it("puts the tab strip INSIDE the card — the join cannot be glass", () => {
    /* The board's strip welds the active tab's thumb to the card's top edge,
       which only works while both are opaque: translucent, the 1px weld
       double-paints into a dark band, the corner flares cannot carry the
       card's blur, and the card's top border cuts the seam. One sheet of
       glass with the tabs on it is the fix; if the strip escapes the card,
       the three-materials-at-one-join problem is back. */
    draw();
    const card = document.querySelector(".hm-card")!;
    expect(card.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it("keeps the card as the material, not a band inside a band", () => {
    /* `.hm-comp` was the ink console inset in the white card. The card itself
       is ink glass now; if this class reappears, that doubling is back. */
    draw();
    expect(document.querySelector(".hm-comp")).toBeNull();
  });
});

describe("Tiff", () => {
  it("has no button of its own — the frame's is the same control, one press away", () => {
    /* One sat in the tab row's right cap so a debrief was "one press from every
       face". The topbar's is one press from every SCREEN, and the two were
       identical 44px glass circles 167px apart in the same corner. If a
       `.wb2-vtcap` reappears here, that duplicate is back. */
    draw();
    expect(document.querySelector(".wb2-vtcap")).toBeNull();
    expect(screen.queryByLabelText("Ask or tell Tiff")).toBeNull();
  });

  it("keeps the debrief control, inside the Journal panel", () => {
    draw();
    expect(within(panel("journal")).getByLabelText("Debrief")).toBeInTheDocument();
  });
});

describe("the strip under the card", () => {
  it("is absent without `financials`, which is the only thing left in it", () => {
    /* "Who's about today" shared this strip and is gone — it spent half the
       page's width to say "Everyone's in today", and the office closure it
       carried moved onto the Calendar tab. An empty shell is worse than none. */
    draw();
    expect(document.querySelector(".hm-strip")).toBeNull();
    expect(screen.queryByText(/Who.s about today/)).toBeNull();
  });

  it("appears when there is payroll in it", () => {
    draw({ money: [{ key: "run", label: "Pay run", detail: "Due Tuesday", href: "/x", state: "warn" }] });
    expect(document.querySelector(".hm-strip")).not.toBeNull();
    expect(screen.getByText("Pay run")).toBeInTheDocument();
  });
});
