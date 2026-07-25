import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyTimesheet } from "../my-timesheet";
import type { PayPeriod } from "../timepay";
import { DEFAULT_SETTINGS, type DayEntry, type Settings, type StaffWeek, type WeekDay } from "../logic";
import type { SheetState } from "@/lib/timepay/query";

const saveDay = jest.fn(async () => ({ ok: true as const }));
const submitWeek = jest.fn(async () => ({ ok: true as const }));
const push = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/timepay", () => ({
  saveDay: (...a: unknown[]) => saveDay(...(a as [])),
  submitWeek: (...a: unknown[]) => submitWeek(...(a as [])),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

/* My timesheet — the original staff design's mechanics in the current theme.

   The load-bearing assertion in this file is that a worked day HAS NO HOURS
   INPUT. Hours are what the times mean, and the screen derives them: that is
   the whole reason for the rebuild, because the old two-fields-plus-a-number
   editor could save a day with both times set and 0.00 hours.

   The standing money check is here too: not a rate, not a gross, not a dollar
   sign — multipliers and hours only. */

const WEEK: WeekDay[] = [
  ["MON", 29, "Jun"],
  ["TUE", 30, "Jun"],
  ["WED", 1, "Jul"],
  ["THU", 2, "Jul"],
  ["FRI", 3, "Jul"],
  ["SAT", 4, "Jul"],
  ["SUN", 5, "Jul"],
];

const PERIODS: PayPeriod[] = [
  { start: "2026-06-29", range: "29 Jun – 5 Jul", year: "2026", live: true, note: "" },
  { start: "2026-06-22", range: "22 – 28 Jun", year: "2026", live: false, note: "Closed period · historical" },
];

const W = (i: string, o: string, h: number): DayEntry => ({ t: "work", in: i, out: o, h });
/* 7:00 AM → 3:00 PM is exactly 8h of span, so with no break configured the
   derived hours and the stored hours agree — and a 30-minute unpaid break
   takes it to a clean 7.5. */
const w8 = W("7:00 AM", "3:00 PM", 8);
const w11 = W("7:00 AM", "6:00 PM", 11);
const EM: DayEntry = { t: "empty" };

/* No rate — the query stopped selecting one. */
const ME: StaffWeek = {
  id: "me",
  name: "Isaac Smith",
  role: "Installer",
  rate: null,
  days: [w8, w8, w11, { t: "sick", h: 8 }, EM, EM, EM],
};

const SHEET = (over: Partial<SheetState> = {}): SheetState => ({
  status: "draft",
  submittedAt: null,
  reviewNote: null,
  reviewedBy: null,
  ...over,
});

const withBreak = (minutes: number, paid: boolean): Settings => ({
  ...DEFAULT_SETTINGS,
  breakMinutes: minutes,
  breakPaid: paid,
});

function renderSheet(over: Partial<React.ComponentProps<typeof MyTimesheet>> = {}) {
  return render(
    <MyTimesheet
      me={ME}
      week={WEEK}
      today={4}
      todayISO="2026-07-03"
      periodStart="2026-06-29"
      periods={PERIODS}
      periodIndex={0}
      settings={DEFAULT_SETTINGS}
      sheet={SHEET()}
      holidays={[]}
      state="NSW"
      {...over}
    />,
  );
}

/** The day-chip strip's button for a day ("MON 29"). */
const chip = (name: string) => screen.getByRole("button", { name });
/** The day row's header button ("Mon 29 Jun"). */
const row = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  [saveDay, submitWeek, push, refresh].forEach((m) => m.mockClear());
});

describe("the period header", () => {
  it("keeps the period nav, the LIVE pill and the status chip", () => {
    renderSheet();
    expect(screen.getByText("My timesheet")).toBeInTheDocument();
    expect(screen.getAllByText("29 Jun – 5 Jul").length).toBeGreaterThan(0);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
  });

  it("period arrows navigate, they don't hold local state", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByLabelText("Previous period"));
    expect(push).toHaveBeenCalledWith("/dashboard/my-timesheet?period=2026-06-22");
  });

  it("a historical period says so in the period pill", () => {
    renderSheet({ periodIndex: 1 });
    expect(screen.getByText("Historical")).toBeInTheDocument();
  });

  it("says nothing about money — not a rate, not a gross, not a dollar sign", () => {
    const { container } = renderSheet();
    expect(container.textContent).not.toMatch(/\$/);
    expect(screen.queryByText("Your rate")).toBeNull();
  });
});

describe("the day-chip strip", () => {
  it("is seven days, with a completion dot only where something is logged", () => {
    const { container } = renderSheet();
    const chips = container.querySelectorAll(".mts2-chip");
    expect(chips).toHaveLength(7);
    // Mon, Tue, Wed worked + Thu sick = four days with an entry
    expect(container.querySelectorAll(".mts2-chip.done")).toHaveLength(4);
    // and the empty Friday is not one of them
    expect(chips[4].className).not.toContain("done");
  });

  it("rings today with ink and marks the weekend as quieter", () => {
    const { container } = renderSheet();
    const chips = container.querySelectorAll(".mts2-chip");
    expect(chips[4].className).toContain("today");
    expect(chips[5].className).toContain("wknd");
    expect(chips[6].className).toContain("wknd");
    expect(chips[0].className).not.toContain("wknd");
  });

  it("clicking a chip expands that day's row — the same selection as the row", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    expect(container.querySelector(".mts2-edit")).toBeNull();

    await user.click(chip("MON 29"));
    expect(container.querySelectorAll(".mts2-edit")).toHaveLength(1);
    expect(container.querySelectorAll(".mts2-row.open")).toHaveLength(1);
    expect(screen.getByLabelText("Start")).toHaveValue("7:00 AM");
  });
});

describe("the day rows", () => {
  it("is one row per weekday, and no weekend rows until you ask", () => {
    const { container } = renderSheet();
    // Mon–Fri only: the empty Saturday and Sunday are offers, not rows
    expect(container.querySelectorAll(".mts2-row")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "Sat 4 Jul" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add Saturday" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Sunday" })).toBeInTheDocument();
  });

  it("a worked weekend day is a row already — the offer is only for empty ones", () => {
    const { container } = renderSheet({
      me: { ...ME, days: [w8, w8, w11, { t: "sick", h: 8 }, EM, w8, EM] },
    });
    expect(container.querySelectorAll(".mts2-row")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Sat 4 Jul" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Saturday" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add Sunday" })).toBeInTheDocument();
  });

  it("Add Saturday materialises the row, already open", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(screen.getByRole("button", { name: "Add Saturday" }));
    expect(container.querySelectorAll(".mts2-row")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Sat 4 Jul" })).toBeInTheDocument();
    expect(container.querySelectorAll(".mts2-edit")).toHaveLength(1);
  });

  it("names the kind and summarises the day on the right", () => {
    const { container } = renderSheet();
    const rows = container.querySelectorAll(".mts2-row");
    expect(within(rows[0] as HTMLElement).getByText("Normal")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("7:00 AM – 3:00 PM · 8h")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("Overtime day")).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getByText("Sick")).toBeInTheDocument();
    // Friday is a past weekday with nothing on it — the one pill that's a to-do
    expect(within(rows[4] as HTMLElement).getByText("Missing")).toBeInTheDocument();
    expect((rows[0] as HTMLElement).className).toContain("has");
    expect((rows[4] as HTMLElement).className).not.toContain("has");
  });

  it("opening a second row closes the first", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(row("Mon 29 Jun"));
    await user.click(row("Wed 1 Jul"));
    expect(container.querySelectorAll(".mts2-edit")).toHaveLength(1);
    expect(screen.getByLabelText("Finish")).toHaveValue("6:00 PM");
  });
});

describe("hours are derived, never typed", () => {
  it("a worked day has no hours input at all — the times are the entry", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(row("Mon 29 Jun"));
    expect(screen.getByLabelText("Start")).toBeInTheDocument();
    expect(screen.getByLabelText("Finish")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hours")).toBeNull();
  });

  it("shows what the times mean, live, as you retype them", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(row("Mon 29 Jun"));
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("7:00 AM – 3:00 PM");
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("8h");

    await user.clear(screen.getByLabelText("Finish"));
    await user.type(screen.getByLabelText("Finish"), "5:30 PM");
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("10.5h");
  });

  it("sends the DERIVED hours in the same {t,in,out,h} payload", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(row("Mon 29 Jun"));
    await user.clear(screen.getByLabelText("Finish"));
    await user.type(screen.getByLabelText("Finish"), "4:00 PM");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 0, {
      t: "work",
      in: "7:00 AM",
      out: "4:00 PM",
      h: 9,
    });
  });

  it("refuses to save times it can't read, rather than writing a zero", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(row("Mon 29 Jun"));
    await user.clear(screen.getByLabelText("Finish"));
    await user.type(screen.getByLabelText("Finish"), "half four");
    expect(container.querySelector(".mts2-derv")?.className).toContain("bad");
    expect(screen.getByText("Save day").closest("button")).toBeDisabled();
    await user.click(screen.getByText("Save day"));
    expect(saveDay).not.toHaveBeenCalled();
  });

  it("Clear day writes the empty entry — the action that deletes the row", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(row("Wed 1 Jul"));
    await user.click(screen.getByText("Clear day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 2, { t: "empty" });
  });

  it("Cancel closes the editor and writes nothing", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(row("Mon 29 Jun"));
    await user.click(screen.getByText("Cancel"));
    expect(container.querySelector(".mts2-edit")).toBeNull();
    expect(saveDay).not.toHaveBeenCalled();
  });

  it("an absence still takes hours directly, seeded with the standard day", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(row("Fri 3 Jul"));
    await user.selectOptions(screen.getByLabelText("Day"), "leave");
    expect(screen.getByLabelText("Hours")).toHaveValue(8);
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 4, { t: "leave", h: 8 });
  });

  it("names the public holiday on a day that is one", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ holidays: [{ date: "2026-07-01", name: "Territory Day" }] });
    await user.click(row("Wed 1 Jul"));
    expect(container.querySelector(".mts2-ehol")?.textContent).toContain("Territory Day");
  });
});

describe("the break", () => {
  it("says nothing when the workspace hasn't configured one", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(row("Mon 29 Jun"));
    expect(screen.queryByText(/^Break:/)).toBeNull();
    expect(screen.queryByLabelText("Shorter break")).toBeNull();
  });

  /** A fresh Friday, logged 7:00 AM – 3:00 PM. */
  async function logFriday(user: ReturnType<typeof userEvent.setup>) {
    await user.click(row("Fri 3 Jul"));
    await user.selectOptions(screen.getByLabelText("Day"), "work");
    await user.clear(screen.getByLabelText("Finish"));
    await user.type(screen.getByLabelText("Finish"), "3:00 PM");
  }

  it("an unpaid break comes off the span of a new day", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: withBreak(30, false) });
    await logFriday(user);
    expect(screen.getByText("Break: 30 min · unpaid")).toBeInTheDocument();
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("7.5h");

    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 4, {
      t: "work",
      in: "7:00 AM",
      out: "3:00 PM",
      h: 7.5,
    });
  });

  it("a day can deviate from the standard break", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: withBreak(30, false) });
    await logFriday(user);
    await user.click(screen.getByLabelText("Shorter break"));
    await user.click(screen.getByLabelText("Shorter break"));
    expect(screen.getByText("Break: 20 min · unpaid")).toBeInTheDocument();
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("7.67h");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 4, {
      t: "work",
      in: "7:00 AM",
      out: "3:00 PM",
      h: 7.67,
    });
  });

  it("reopening a saved day shows the break it was saved with, not the org's", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({
      settings: withBreak(30, false),
      me: { ...ME, days: [W("7:00 AM", "3:00 PM", 7.25), w8, w11, { t: "sick", h: 8 }, EM, EM, EM] },
    });
    await user.click(row("Mon 29 Jun"));
    // 8h of span stored as 7.25 means 45 minutes were taken, whatever the
    // org's standard is — a per-day break has no column, so it is read back
    // out of the entry rather than guessed
    expect(screen.getByText("Break: 45 min · unpaid")).toBeInTheDocument();
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("7.25h");
  });

  it("does not retroactively shorten days logged before the break existed", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: withBreak(30, false) });
    // Monday's 8h were saved as the full span; turning a break on later must
    // not silently rewrite them
    await user.click(row("Mon 29 Jun"));
    expect(screen.getByText("Break: 0 min · unpaid")).toBeInTheDocument();
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("8h");
  });

  it("a PAID break deducts nothing and offers no per-day control", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({ settings: withBreak(30, true) });
    await user.click(row("Mon 29 Jun"));
    expect(screen.getByText("Break: 30 min · paid")).toBeInTheDocument();
    expect(screen.queryByLabelText("Shorter break")).toBeNull();
    expect(container.querySelector(".mts2-derv")?.textContent).toContain("8h");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 0, {
      t: "work",
      in: "7:00 AM",
      out: "3:00 PM",
      h: 8,
    });
  });
});

describe("the payroll line", () => {
  it("states a plain day as hours × one", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(row("Mon 29 Jun"));
    expect(container.querySelector(".mts2-paych")?.textContent).toBe("8h ×1.0 = 8h");
  });

  it("splits an overtime day the way the pay run does — never a dollar", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(row("Wed 1 Jul"));
    // 11h on a Wednesday: 8 at 1×, 3 at 1.5× → 12.5 payroll hours
    expect(container.querySelector(".mts2-paych")?.textContent).toBe("8h ×1.0 + 3h ×1.5 = 12.5h");
    expect(container.querySelector(".mts2-paych")?.textContent).not.toContain("$");
  });
});

describe("the rail", () => {
  it("separates what you worked from what payroll counts", () => {
    const { container } = renderSheet();
    const card = container.querySelector(".mts2-card") as HTMLElement;
    expect(within(card).getByText("My week")).toBeInTheDocument();
    // worked 8 + 8 + 11 = 27; payroll 24×1 + 3×1.5 + 8 sick = 36.5
    expect(within(card).getByText("27h")).toBeInTheDocument();
    expect(within(card).getByText("36.5h")).toBeInTheDocument();
    expect(within(card).getByText("Actual worked")).toBeInTheDocument();
    expect(within(card).getByText("Payroll hrs")).toBeInTheDocument();
  });

  it("chips the multiplier buckets and omits the empty ones", () => {
    const { container } = renderSheet();
    const chips = [...container.querySelectorAll(".mts2-bkc")].map((c) => c.textContent);
    expect(chips).toEqual(["32h ×1.0", "3h ×1.5"]); // no 2× hours this week
  });

  it("names the cycle it is totalling", () => {
    renderSheet({ settings: { ...DEFAULT_SETTINGS, cycle: "Fortnightly" } });
    expect(screen.getByText("My fortnight")).toBeInTheDocument();
  });

  it("footnotes the rules that produced those numbers", () => {
    const { container } = renderSheet({ settings: withBreak(30, false) });
    const rules = container.querySelector(".mts2-rules")?.textContent ?? "";
    expect(rules).toContain("Normal 8h day");
    expect(rules).toContain("OT after 8h/day");
    expect(rules).toContain("30 min break · unpaid");
    expect(rules).toContain("auto-submits Sun 3:00 PM");
    expect(rules).not.toContain("$");
  });
});

describe("the month's public holidays", () => {
  it("says so plainly when the month has none", () => {
    renderSheet();
    expect(screen.getByText("Public holidays — July 2026")).toBeInTheDocument();
    expect(screen.getByText("No public holidays this month")).toBeInTheDocument();
  });

  it("lists this month's, and only this month's", () => {
    renderSheet({
      holidays: [
        { date: "2026-06-08", name: "A June Thing" },
        { date: "2026-07-01", name: "Territory Day" },
      ],
    });
    expect(screen.getByText("Territory Day")).toBeInTheDocument();
    expect(screen.queryByText("A June Thing")).toBeNull();
    expect(screen.queryByText("No public holidays this month")).toBeNull();
  });

  it("expands the full year on request, named for the staff member's state", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet({
      holidays: [{ date: "2026-12-25", name: "Christmas Day" }],
    });
    expect(container.querySelector(".mts-hols")).toBeNull();
    await user.click(screen.getByRole("button", { name: /All NSW public holidays/ }));
    expect(container.querySelector(".mts-hols")).not.toBeNull();
    expect(screen.getByText("Christmas Day")).toBeInTheDocument();
  });
});

describe("when the week is closed to you", () => {
  it.each([
    ["submitted", { sheet: SHEET({ status: "submitted" }) }],
    ["approved", { sheet: SHEET({ status: "approved" }) }],
    ["historical", { periodIndex: 1 }],
  ])("%s: nothing opens and nothing can be added", async (_label, over) => {
    const { container } = renderSheet(over as Partial<React.ComponentProps<typeof MyTimesheet>>);
    expect(container.querySelector(".tpr")?.className).toContain("locked");
    expect(container.querySelectorAll("button.mts2-chip")).toHaveLength(0);
    expect(container.querySelector(".mts2-edit")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Saturday" })).toBeNull();
    expect(screen.queryByText("Submit week")).toBeNull();
    // and the days are still readable
    expect(container.querySelectorAll(".mts2-chip")).toHaveLength(7);
    expect(container.querySelectorAll(".mts2-row").length).toBeGreaterThan(0);
  });
});

describe("submitting", () => {
  it("submits the period from the rail", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByText("Submit week"));
    expect(submitWeek).toHaveBeenCalledWith("2026-06-29");
  });

  it("a sent-back week shows the manager's question and asks again", () => {
    renderSheet({ sheet: SHEET({ status: "sent_back", reviewNote: "Why the Wednesday overtime?" }) });
    expect(screen.getByText("Sent back with a question")).toBeInTheDocument();
    expect(screen.getByText("Why the Wednesday overtime?")).toBeInTheDocument();
    expect(screen.getByText("Submit again")).toBeInTheDocument();
    expect(screen.queryByText("Submit week")).toBeNull();
  });

  it("an empty week has nothing to send", () => {
    renderSheet({ me: { ...ME, days: [EM, EM, EM, EM, EM, EM, EM] } });
    expect(screen.getByText("Submit week").closest("button")).toBeDisabled();
  });
});
