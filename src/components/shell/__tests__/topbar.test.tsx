import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { Topbar } from "../topbar";
import { CommandPaletteProvider } from "../command-palette-context";
import type { ShellUser } from "../sidebar";
import { actionRequiredItems } from "@/app/actions/action-required";
import { myDueReminders, snoozeReminder } from "@/app/actions/reminders";
import { completeTask } from "@/app/actions/dashboard";
import type { ActionChip } from "@/lib/dashboard/chips";
import type { DueReminder } from "@/lib/dashboard/reminders";
import { fmtAuWeekdayDayMonth, todayInAu } from "@/lib/au-dates";

/* The bell.

   It shipped as a `<button>` with no handler wearing a teal dot that pulsed on
   every screen forever — the CSS drew the dot unconditionally, so it never
   meant anything and could never stop meaning it. These tests pin the two
   properties that stop that happening again: the badge is DERIVED from real
   rows, and it is ABSENT when there is nothing to say.

   It then spent a while as a LINK to /dashboard/action-required, which is the
   other half of what these pin now: glancing at what is waiting must not cost
   you the screen you were on. The list opens in place. */

/* The topbar now carries the Tiff button, which reaches the note flow and its
   server actions — and "use server" modules cannot be imported into jsdom.
   Stubbed so this suite stays about the topbar; the button has its own. */
jest.mock("@/components/notes/tiff-button", () => ({
  TiffButton: () => <button aria-label="Ask or tell Tiff" />,
}));

jest.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
jest.mock("@/app/actions/action-required", () => ({ actionRequiredItems: jest.fn() }));

/* The bell reaches two more "use server" modules since reminders joined it —
   same reason as the Tiff button above, and the same fix. The mocks are what
   let the ROWS be tested here; what the actions themselves do is pinned where
   they live. */
jest.mock("@/app/actions/reminders", () => ({
  myDueReminders: jest.fn(async () => []),
  snoozeReminder: jest.fn(async () => ({ ok: true })),
}));
jest.mock("@/app/actions/dashboard", () => ({ completeTask: jest.fn(async () => ({ ok: true })) }));

const itemsMock = actionRequiredItems as jest.MockedFunction<typeof actionRequiredItems>;
const remsMock = myDueReminders as jest.MockedFunction<typeof myDueReminders>;
const snoozeMock = snoozeReminder as jest.MockedFunction<typeof snoozeReminder>;
const doneMock = completeTask as jest.MockedFunction<typeof completeTask>;

/* Enough of a chip to render a row. The shapes themselves are pinned by the
   chips suite; what matters here is how many there are and what a row links to. */
const chip = (n: number, over: Partial<ActionChip> = {}): ActionChip => ({
  key: `k${n}`,
  kind: "rego",
  state: "bad",
  label: `Rego expired ${n} days ago`,
  subject: `Ute ${n}`,
  href: `/dashboard/fleet/${n}`,
  urgency: n,
  ...over,
});

const chips = (n: number) => Array.from({ length: n }, (_, i) => chip(i + 1));

const user: ShellUser = {
  name: "Jordan Mills",
  initials: "JM",
  roleLabel: "Technician",
  role: "staff",
  caps: [],
};

const draw = () =>
  render(
    <CommandPaletteProvider>
      <Topbar user={user} today="2026-08-09" />
    </CommandPaletteProvider>,
  );

const bell = () => document.querySelector(".bell") as HTMLElement;
const panel = () => document.querySelector(".bell-panel") as HTMLElement | null;
const rows = () => Array.from(document.querySelectorAll(".bp-row")) as HTMLAnchorElement[];
const remRows = () => Array.from(document.querySelectorAll(".bp-rem")) as HTMLElement[];

/** One due reminder, as the bell receives it. */
const reminder = (n: number, over: Partial<DueReminder> = {}): DueReminder => ({
  taskId: `t${n}`,
  title: `Check with Luke about quote ${n}`,
  detail: null,
  /* RELATIVE, NOT A LITERAL. This was a fixed timestamp, and the row's own
     copy is relative ("just now" / "20m ago" / "yesterday") — so the day the
     clock passed it the suite started asserting /now|ago/ against
     "yesterday" and every push in the repo was blocked. Half an hour ago is
     the case the assertion is actually about. */
  remindAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  ...over,
});

afterEach(cleanup);
beforeEach(() => {
  itemsMock.mockReset();
  remsMock.mockReset();
  remsMock.mockResolvedValue([]);
  snoozeMock.mockReset();
  snoozeMock.mockResolvedValue({ ok: true });
  doneMock.mockReset();
  doneMock.mockResolvedValue({ ok: true });
});

describe("the Tiff button", () => {
  /* It floated bottom-right first and covered the page it sat on. The topbar
     is the only place that is always empty, and within it the order is
     deliberate: the thing you reach for on purpose sits before the thing that
     interrupts you. */
  it("sits in the topbar, immediately left of the bell", async () => {
    itemsMock.mockResolvedValue([]);
    draw();

    const tiff = document.querySelector('[aria-label^="Ask or tell Tiff"]') as HTMLElement;
    expect(tiff).not.toBeNull();
    expect(tiff.closest(".tbr")).not.toBeNull();
    /* Order, not just membership — "left of notifications" is the ask. */
    expect(tiff.compareDocumentPosition(bell()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => {});
  });
});

describe("the bell", () => {
  it("opens the list in place instead of taking you to another screen", async () => {
    itemsMock.mockResolvedValue(chips(2));
    draw();
    await waitFor(() => expect(bell().querySelector(".d")).not.toBeNull());
    /* A link here means glancing at what is waiting costs you the screen you
       were on — that is exactly what the panel replaced. */
    expect(bell().tagName).toBe("BUTTON");
    expect(bell().getAttribute("href")).toBeNull();
    expect(panel()).toBeNull();

    await act(async () => { bell().click(); });
    expect(panel()).not.toBeNull();
    expect(bell().getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toHaveLength(2);
  });

  it("sends each row to the thing that needs doing", async () => {
    itemsMock.mockResolvedValue(chips(1));
    draw();
    await waitFor(() => expect(bell().querySelector(".d")).not.toBeNull());
    await act(async () => { bell().click(); });
    expect(rows()[0].getAttribute("href")).toBe("/dashboard/fleet/1");
  });

  it("closes on Escape", async () => {
    itemsMock.mockResolvedValue(chips(1));
    draw();
    await waitFor(() => expect(bell().querySelector(".d")).not.toBeNull());
    await act(async () => { bell().click(); });
    expect(panel()).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(panel()).toBeNull();
  });

  it("closes when you click outside it", async () => {
    itemsMock.mockResolvedValue(chips(1));
    draw();
    await waitFor(() => expect(bell().querySelector(".d")).not.toBeNull());
    await act(async () => { bell().click(); });
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(panel()).toBeNull();
  });

  it("caps the list and says how much it did not draw", async () => {
    /* The panel scrolls, but an unbounded list is a second copy of the board
       hanging off the chrome. It stops at 20 and hands the rest over. */
    itemsMock.mockResolvedValue(chips(26));
    draw();
    await waitFor(() => expect(bell().querySelector(".d")).not.toBeNull());
    await act(async () => { bell().click(); });
    expect(rows()).toHaveLength(20);
    const more = panel()!.querySelector(".bp-more") as HTMLAnchorElement;
    expect(more.textContent).toContain("6 more");
    expect(more.getAttribute("href")).toBe("/dashboard/action-required");
  });

  it("offers NO way through to the board when it drew everything", async () => {
    // "see all" under a list that already is all of it is a lie about there being more
    itemsMock.mockResolvedValue(chips(3));
    draw();
    await waitFor(() => expect(bell().querySelector(".d")).not.toBeNull());
    await act(async () => { bell().click(); });
    expect(panel()!.querySelector(".bp-more")).toBeNull();
  });

  it("says so when there is nothing, rather than opening an empty box", async () => {
    itemsMock.mockResolvedValue([]);
    draw();
    await waitFor(() => expect(bell().getAttribute("aria-label")).toBe("Nothing needs you"));
    await act(async () => { bell().click(); });
    expect(panel()!.textContent).toContain("Nothing needs you");
    expect(rows()).toHaveLength(0);
  });

  it("wears NO badge while the rows are still in flight", async () => {
    // never guess a number: silence until the real one lands
    let settle: (rows: ActionChip[]) => void = () => {};
    itemsMock.mockReturnValue(new Promise<ActionChip[]>((res) => { settle = res; }));
    draw();
    expect(bell().querySelector(".d")).toBeNull();
    await act(async () => settle(chips(3)));
  });

  it("wears NO badge at zero", async () => {
    itemsMock.mockResolvedValue([]);
    draw();
    // and says so, for anyone who can't see the absence of a dot
    await waitFor(() => expect(bell().getAttribute("aria-label")).toBe("Nothing needs you"));
    expect(bell().querySelector(".d")).toBeNull();
  });

  it("shows the real number once it lands, and says what it means", async () => {
    itemsMock.mockResolvedValue(chips(3));
    draw();
    await waitFor(() => expect(bell().querySelector(".d")?.textContent).toBe("3"));
    expect(bell().getAttribute("aria-label")).toBe("3 things need you");
  });

  it("keeps the badge to two characters", async () => {
    // the badge sits on a 44px control; "12" fits and "9+" is how it says more
    itemsMock.mockResolvedValue(chips(21));
    draw();
    await waitFor(() => expect(bell().querySelector(".d")?.textContent).toBe("9+"));
    // the LABEL still carries the true count — only the pill is abbreviated
    expect(bell().getAttribute("aria-label")).toBe("21 things need you");
  });

  it("reads as singular for exactly one", async () => {
    itemsMock.mockResolvedValue(chips(1));
    draw();
    await waitFor(() => expect(bell().getAttribute("aria-label")).toBe("1 thing needs you"));
  });

  it("stays silent rather than breaking the shell when the read fails", async () => {
    itemsMock.mockRejectedValue(new Error("offline"));
    draw();
    await waitFor(() => expect(itemsMock).toHaveBeenCalled());
    expect(bell().querySelector(".d")).toBeNull();
    expect(screen.getByText("Jordan Mills")).toBeInTheDocument();
  });
});

/* THE CLOCK.

   The date was a teal capsule inside the dashboard hero; it is chrome now, so
   every screen carries it and Home gets the space back. The interesting half
   is the time: a clock rendered into server markup and hydrated a minute later
   is a text mismatch, and a mismatch in a render body fails hydration for the
   whole tree. */
describe("the clock", () => {
  beforeEach(() => itemsMock.mockResolvedValue([]));

  it("takes the day off the LIVE clock once hydrated, not the prop it was given", () => {
    /* The prop here is deliberately ancient. An app left open overnight has to
       roll over rather than insist it is still yesterday, so after hydration
       the date is derived from the same clock as the time — which is also why
       this cannot assert a hard-coded string. It did, once, and broke at
       midnight. The server's use of the prop is pinned by the renderToString
       test below, where `hydrated` is false. */
    render(
      <CommandPaletteProvider>
        <Topbar user={user} today="2020-01-01" />
      </CommandPaletteProvider>,
    );
    const clock = document.querySelector(".tbclock") as HTMLElement;
    expect(clock).not.toBeNull();
    expect(clock.querySelector("em")?.textContent).toBe(fmtAuWeekdayDayMonth(todayInAu()));
    expect(clock.querySelector("em")?.textContent).not.toBe("Wed 1 Jan");
  });

  it("emits NO time on the server — the whole reason it is split", () => {
    /* renderToString is the only place this is observable: `useHydrated`
       reports true on a plain client render, so RTL alone would show a time
       and prove nothing. Asserted as "no h:mm am/pm anywhere in the markup"
       rather than on one element, so moving the clock can't quietly hide a
       regression. */
    const html = renderToString(
      <CommandPaletteProvider>
        <Topbar user={user} today="2026-08-09" />
      </CommandPaletteProvider>,
    );
    expect(html).toContain("Sun 9 Aug");
    expect(html).not.toMatch(/\d{1,2}:\d{2}\s*(am|pm)/i);
  });

  it("fills the time in once there is a browser to own it", async () => {
    draw();
    await waitFor(() =>
      expect(document.querySelector(".tbclock b")?.textContent).toMatch(/^\d{1,2}:\d{2} (am|pm)$/),
    );
  });

  it("is information, not a control — it sits outside the button cluster", () => {
    /* Order is the point: when · do · you. If it drifts in among the controls
       it starts reading as one. */
    draw();
    const clock = document.querySelector(".tbclock") as HTMLElement;
    const tiff = document.querySelector('[aria-label^="Ask or tell Tiff"]') as HTMLElement;
    expect(clock.closest(".tbr")).not.toBeNull();
    expect(clock.compareDocumentPosition(tiff) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(clock.querySelector("button")).toBeNull();
  });
});

/* ── REMINDERS IN THE BELL ────────────────────────────────────────────────

   "Remind me to do that on Monday morning" only means anything if Monday
   morning actually arrives somewhere you are looking. This is that somewhere.

   They are NOT ActionChips and are not tested as if they were: a chip is an
   expiry whose only affordance is a link to the screen that fixes it, and a
   reminder is a thing you asked for that you can finish or put off from where
   it appears. The separation is the design, so it is what these pin. */
describe("reminders in the bell", () => {
  const openPanel = async () => {
    draw();
    await act(async () => {});
    await act(async () => {
      bell().click();
    });
  };

  it("counts toward the badge alongside everything else that needs you", async () => {
    /* Two numbers in the topbar would make a person add them up to answer the
       question the badge exists to answer. */
    itemsMock.mockResolvedValue(chips(2));
    remsMock.mockResolvedValue([reminder(1), reminder(2), reminder(3)]);
    draw();
    await waitFor(() => expect(bell().querySelector(".d")?.textContent).toBe("5"));
  });

  it("shows the badge for a reminder even when nothing is expiring", async () => {
    itemsMock.mockResolvedValue([]);
    remsMock.mockResolvedValue([reminder(1)]);
    draw();
    await waitFor(() => expect(bell().querySelector(".d")?.textContent).toBe("1"));
  });

  it("puts them above the chips — you asked for these, the rego did not", async () => {
    itemsMock.mockResolvedValue(chips(1));
    remsMock.mockResolvedValue([reminder(1)]);
    await openPanel();

    expect(remRows()).toHaveLength(1);
    expect(rows()).toHaveLength(1);
    expect(
      remRows()[0].compareDocumentPosition(rows()[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says what it is and how late it is", async () => {
    remsMock.mockResolvedValue([reminder(1)]);
    itemsMock.mockResolvedValue([]);
    await openPanel();
    expect(remRows()[0].textContent).toContain("Check with Luke about quote 1");
    // the row carries its own lateness rather than a bare timestamp
    expect(remRows()[0].querySelector(".bp-main em")?.textContent).toMatch(/now|ago/);
  });

  it("is never capped or handed off to a board — there isn't one", async () => {
    /* Chips stop at 20 and point at /dashboard/action-required. Reminders have
       nowhere else to be, so every one you have is already here; a "see all"
       under them would point at a screen that does not exist. */
    itemsMock.mockResolvedValue([]);
    remsMock.mockResolvedValue(Array.from({ length: 26 }, (_, i) => reminder(i + 1)));
    await openPanel();
    expect(remRows()).toHaveLength(26);
    expect(document.querySelector(".bp-more")).toBeNull();
  });

  it("finishes one where it appears, and drops it without waiting for the server", async () => {
    itemsMock.mockResolvedValue([]);
    remsMock.mockResolvedValue([reminder(1), reminder(2)]);
    await openPanel();

    const done = remRows()[0].querySelector(".bp-remdo") as HTMLButtonElement;
    /* Named, not "Done" alone — a column of identical buttons is one button to
       anyone reading it out. */
    expect(done.getAttribute("aria-label")).toBe("Mark done — Check with Luke about quote 1");

    remsMock.mockResolvedValue([reminder(2)]);
    await act(async () => {
      done.click();
    });
    expect(doneMock).toHaveBeenCalledWith("t1");
    expect(remRows()).toHaveLength(1);
  });

  it("offers the three ways to put one off, and none of them is a duration you type", async () => {
    itemsMock.mockResolvedValue([]);
    remsMock.mockResolvedValue([reminder(1)]);
    await openPanel();

    // hidden until asked for: three buttons per row would bury the reminder
    expect(document.querySelector(".bp-snooze")).toBeNull();

    const later = remRows()[0].querySelector(".bp-remsnz") as HTMLButtonElement;
    await act(async () => {
      later.click();
    });
    expect(later.getAttribute("aria-expanded")).toBe("true");

    const opts = Array.from(document.querySelectorAll(".bp-snzopt")).map((b) => b.textContent);
    expect(opts).toEqual(["An hour", "Tomorrow", "Next week"]);
  });

  it("moves the nudge to the choice that was pressed", async () => {
    itemsMock.mockResolvedValue([]);
    remsMock.mockResolvedValue([reminder(1)]);
    await openPanel();

    await act(async () => {
      (remRows()[0].querySelector(".bp-remsnz") as HTMLButtonElement).click();
    });
    remsMock.mockResolvedValue([]);
    await act(async () => {
      (document.querySelectorAll(".bp-snzopt")[1] as HTMLButtonElement).click();
    });

    expect(snoozeMock).toHaveBeenCalledWith("t1", "tomorrow");
    expect(remRows()).toHaveLength(0);
  });

  it("still says nothing needs you when neither list has anything", async () => {
    /* The all-clear has to survive a second source arriving beside the first —
       an empty-state that only knows about chips would show a panel with a
       heading and no body the moment reminders existed. */
    itemsMock.mockResolvedValue([]);
    remsMock.mockResolvedValue([]);
    await openPanel();
    expect(document.querySelector(".bp-empty")).not.toBeNull();
  });

  it("does not claim an all-clear while a reminder is showing", async () => {
    itemsMock.mockResolvedValue([]);
    remsMock.mockResolvedValue([reminder(1)]);
    await openPanel();
    expect(document.querySelector(".bp-empty")).toBeNull();
  });
});
