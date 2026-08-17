import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimePay, type PayPeriod } from "../timepay";
import { DEFAULT_SETTINGS, type DayEntry, type StaffWeek, type WeekDay } from "../logic";
import type { SheetState } from "@/lib/timepay/query";

const approveWeek = jest.fn(async () => ({ ok: true as const }));
const sendBackWeek = jest.fn(async () => ({ ok: true as const }));
const savePaySettings = jest.fn(async () => ({ ok: true as const }));
const push = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/timepay", () => ({
  approveWeek: (...a: unknown[]) => approveWeek(...(a as [])),
  sendBackWeek: (...a: unknown[]) => sendBackWeek(...(a as [])),
  savePaySettings: (...a: unknown[]) => savePaySettings(...(a as [])),
}));
// the gear's holiday section pulls these in; the real module drags next/cache
// into jsdom, so mock like every other action import
jest.mock("@/app/actions/holidays", () => ({
  addHoliday: jest.fn(async () => ({ ok: true })),
  removeHoliday: jest.fn(async () => ({ ok: true })),
  restoreHoliday: jest.fn(async () => ({ ok: true })),
  getHolidayManagerData: jest.fn(async () => ({
    holidays: [],
    orgState: "NSW",
    today: "2026-07-25",
  })),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

/* Fixtures are local now — the demo roster went with Stage 5. */

const W = (i: string, o: string, h: number): DayEntry => ({ t: "work", in: i, out: o, h });
const w8 = W("07:00", "15:00", 8);
const EM: DayEntry = { t: "empty" };

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

/** Overtime on Wednesday — lands in "Need review". */
const OVERTIME: StaffWeek = {
  id: "staff-ot",
  name: "Boston Hayes",
  role: "Installer",
  rate: 42,
  days: [w8, w8, W("07:00", "18:00", 11), w8, w8, EM, EM],
};

/** Five clean 8h days — lands in "Ready to approve". */
const CLEAN: StaffWeek = {
  id: "staff-clean",
  name: "Marcus Webb",
  role: "Apprentice",
  rate: 28,
  days: [w8, w8, w8, w8, w8, EM, EM],
};

function renderTimePay(over: Partial<React.ComponentProps<typeof TimePay>> = {}) {
  return render(
    <TimePay
      staff={[OVERTIME, CLEAN]}
      week={WEEK}
      today={6}
      through={6}
      periods={PERIODS}
      periodIndex={0}
      settings={DEFAULT_SETTINGS}
      configured
      sheets={{}}
      canApprove
      financials
      canHolidays={false}
      {...over}
    />,
  );
}

const section = (title: string) => {
  const st = screen.getByText(title, { selector: ".st" });
  return st.closest(".sectwrap") as HTMLElement;
};

beforeEach(() => {
  [approveWeek, sendBackWeek, savePaySettings, push, refresh].forEach((m) => m.mockClear());
});

describe("TimePay screen", () => {
  it("sorts people into review and ready by what derive() flags", () => {
    renderTimePay();
    expect(within(section("Need review")).getByText("Boston Hayes")).toBeInTheDocument();
    expect(within(section("Ready to approve")).getByText("Marcus Webb")).toBeInTheDocument();
  });

  it("a stored decision overrides the derived status", () => {
    const sheets: Record<string, SheetState> = {
      "staff-clean": { status: "approved", submittedAt: null, reviewNote: null, reviewedBy: null },
      "staff-ot": { status: "sent_back", submittedAt: null, reviewNote: "why the OT?", reviewedBy: null },
    };
    renderTimePay({ sheets });
    expect(within(section("Approved")).getByText("Marcus Webb")).toBeInTheDocument();
    expect(screen.getByText("Sent back · awaiting reply")).toBeInTheDocument();
  });

  /* WHOSE MOVE IT IS. A sent-back sheet sat inside "Need review" and counted
     towards its "Action required" — but the question has already been asked
     and the answer is the staff member's to give. An approver reading their
     own queue was reading a number that included the cards they had already
     dealt with, and the only thing saying otherwise was a tag on the card. */
  it("files a sent-back week under the person it is waiting on, not the approver", () => {
    const sheets: Record<string, SheetState> = {
      "staff-ot": { status: "sent_back", submittedAt: null, reviewNote: "why the OT?", reviewedBy: null },
    };
    renderTimePay({ sheets });
    expect(within(section("Waiting on them")).getByText("Boston Hayes")).toBeInTheDocument();
    expect(screen.queryByText("Need review", { selector: ".st" })).toBeNull();
  });

  /* APPROVED IS NOT THE SAME AS FINISHED WITH. The tile counted
     `ready + approved` under "Normal · No action needed", so people still
     waiting on one tap from this very screen were filed as needing nothing —
     directly above a section headed "Ready to approve" with an Approve all
     button in it.

     IT IS A RATIO NOW, and its sub-line is finally rendered. `.stat .ss` was
     `display:none` from the port onward, so the fix that made this tile name
     what was still waiting had shipped invisible; and a bare count of the
     approved was the same word and the same number as the section heading
     forty pixels below it. "1 of 4" is the thing neither the heading nor the
     card can say. */
  it("reads approval as progress, and names what is still waiting", () => {
    /* Nobody approved, one person ready. The old tile read "1 · Normal · No
       action needed" for exactly this data — while the section below it
       offered an Approve button for that same person. */
    const { container } = renderTimePay();
    const tile = container.querySelector(".stat.normal") as HTMLElement;
    expect(within(tile).getByText("Approved")).toBeInTheDocument();
    expect(tile.querySelector(".sv")?.textContent).toBe("0 of 2");
    expect(within(tile).getByText("1 to review · 1 ready")).toBeInTheDocument();
    expect(within(tile).queryByText("No action needed")).toBeNull();
    expect(within(section("Ready to approve")).getByText("Marcus Webb")).toBeInTheDocument();
  });

  /* THE STRIP STOPPED COUNTING THE SECTIONS UNDERNEATH IT. Two of its four
     tiles read "2 · NEED REVIEW" and "1 · APPROVED" directly above two section
     headings reading the same word and the same number — and the headings are
     the ones that have to stay, because they group the cards. */
  it("says nothing in the strip that a section heading below it already says", () => {
    const { container } = renderTimePay();
    const strip = container.querySelector(".stats") as HTMLElement;
    expect(within(strip).queryByText("Need review")).toBeNull();
    // the labels it does carry are the figures no card or heading states
    expect(within(strip).getByText("Payroll hours")).toBeInTheDocument();
    expect(within(strip).getByText("Overtime")).toBeInTheDocument();
  });

  it("totals the period's payroll hours across everyone", () => {
    // Boston 40 + 3×1.5 = 44.5;  Marcus a clean 40
    const { container } = renderTimePay();
    const tile = container.querySelector(".stat.hrs") as HTMLElement;
    expect(within(tile).getByText("84.5h")).toBeInTheDocument();
    expect(within(tile).getByText("2 people")).toBeInTheDocument();
  });

  /* A MONEY BUG, found while threading certificates through this same line.

     The loader resolves `holidayDays` for every person — an interstate worker
     gets their own state's calendar — and this screen rebuilt each row's
     context WITHOUT it. `splitDay` never saw the `publicHoliday` flag, so a
     worked public holiday was priced at ordinary rates here while My timesheet
     priced the same day at 2×. On the default settings that is 8h at $50: $800
     on the person's screen, $400 on their approver's. The bullet whose whole
     job is to make sure that day reaches a human never fired either. */
  it("prices a worked public holiday through the person's OWN calendar", () => {
    const worked = W("7:00 AM", "3:00 PM", 8);
    const onHoliday: StaffWeek = {
      id: "staff-ph",
      name: "Kira Novak",
      role: "Installer",
      rate: 50,
      days: [worked, w8, w8, w8, w8, EM, EM],
      holidayDays: [0], // Monday is a gazetted holiday for this person
    };
    const { container } = renderTimePay({ staff: [onHoliday] });

    // 2x all day, per the default public-holiday rule
    const card = container.querySelector(".card.flag") as HTMLElement;
    expect(within(card).getByText(/worked the public holiday/)).toBeInTheDocument();
    expect(within(card).getByText(/at public-holiday rates/)).toBeInTheDocument();
    // and the day is coloured as a holiday, not as an ordinary one
    expect(container.querySelector(".tile.ph")).not.toBeNull();
  });

  it("names the period the overtime is for, in the cycle's own noun", () => {
    const { container } = renderTimePay({
      settings: { ...DEFAULT_SETTINGS, cycle: "Monthly" },
    });
    // "This week" was hard-coded, over a total covering a month
    expect((container.querySelector(".stat.ot") as HTMLElement).textContent).toContain("This month");
  });

  it("the daily breakdown says which way it will go", async () => {
    const user = userEvent.setup();
    renderTimePay();
    const open = screen.getAllByText("View daily breakdown")[0];
    expect(open.closest("button")).toHaveAttribute("aria-expanded", "false");
    await user.click(open);
    expect(screen.getByText("Hide daily breakdown").closest("button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  /* THE BREAKDOWN IS THE DAYS, AND ONLY THE DAYS.

     It used to end with a "category totals" band — Weighted hours, Regular,
     Time and a half, Double time, Sick, Leave — every one of which but the
     first is a row of `.cs-buckets` in the panel above, same label, same rate
     chip, same figure, 250px apart. The one figure it carried alone has moved
     to the foot of the buckets it is the sum of. */
  it("the breakdown adds the times, not the buckets a second time", async () => {
    const user = userEvent.setup();
    const { container } = renderTimePay();
    await user.click(screen.getAllByText("View daily breakdown")[0]);
    const detail = container.querySelector(".detail") as HTMLElement;
    expect(within(detail).getByText("07:00 – 18:00")).toBeInTheDocument(); // the new fact
    expect(detail.querySelector(".totals")).toBeNull();
    expect(within(detail).queryByText("Time and a half")).toBeNull();
    expect(within(detail).queryByText("Weighted hours")).toBeNull();
  });

  /* ONE NAME FOR ONE FIGURE, across the screen and the screen it reviews. The
     weighted total was "Weighted hours" here and "Payroll hrs" on the person's
     own sheet — and here it was behind a fold, which is a strange place for
     the number being signed off. */
  it("totals the buckets under the same name the person's own sheet uses", () => {
    const { container } = renderTimePay();
    const panel = container.querySelector(".card.flag .cside") as HTMLElement;
    // Boston: 40 regular + 3 at 1.5 = 44.5
    expect(within(panel).getByText("Actual worked")).toBeInTheDocument();
    expect(within(panel).getByText("Payroll hrs")).toBeInTheDocument();
    expect(panel.querySelector(".bkt.total .bv")?.textContent).toBe("44.5h");
  });

  /* SEVEN ANONYMOUS COLOUR BARS. `MiniTile` rendered an empty span, so the row
     an approver taps Approve from said which days were unusual only by hue,
     readable one at a time by hovering.

     The initial goes ABOVE the fill rather than in it — white on `--red` is
     3.55:1, and nothing legible clears 4.5 inside that square. So the label is
     `.mtd` on the row's white and `.mt` stays a pure swatch. */
  it("names the days on a compact row instead of drawing bare colour", () => {
    const { container } = renderTimePay();
    const mini = container.querySelector(".crow .mini") as HTMLElement;
    expect([...mini.querySelectorAll(".mtd")].map((c) => c.textContent)).toEqual([
      "M", "T", "W", "T", "F", "S", "S",
    ]);
    // the swatch itself carries no text, so no ink lands on a brand fill
    for (const sw of mini.querySelectorAll(".mt")) expect(sw.textContent).toBe("");
  });

  it("approving calls the action with the staff id and the period", async () => {
    const user = userEvent.setup();
    renderTimePay();
    await user.click(within(section("Ready to approve")).getAllByText("Approve")[0]);
    // keyed by id, not by name — two people can share a name
    expect(approveWeek).toHaveBeenCalledWith("staff-clean", "2026-06-29");
  });

  it("send back won't send without a question", async () => {
    const user = userEvent.setup();
    renderTimePay();
    const card = screen.getByText("Boston Hayes").closest(".card") as HTMLElement;
    await user.click(within(card).getByText("Send back"));
    const send = within(card).getByText("Send", { selector: "button.qsend" });
    expect(send).toBeDisabled(); // a sent-back sheet with no reason is a dead end

    await user.type(within(card).getByRole("textbox"), "Confirm the overtime");
    await user.click(send);
    expect(sendBackWeek).toHaveBeenCalledWith("staff-ot", "2026-06-29", "Confirm the overtime");
  });

  it("approve all approves each sheet as its own decision", async () => {
    const user = userEvent.setup();
    renderTimePay();
    await user.click(screen.getByText("Approve all"));
    expect(approveWeek).toHaveBeenCalledTimes(1);
    expect(approveWeek).toHaveBeenCalledWith("staff-clean", "2026-06-29");
  });

  it("period navigation is a real navigation, not local state", async () => {
    const user = userEvent.setup();
    renderTimePay();
    await user.click(screen.getByLabelText("Previous period"));
    expect(push).toHaveBeenCalledWith("/dashboard/timepay?period=2026-06-22");
  });

  it("renders a historical period as locked", () => {
    renderTimePay({ periodIndex: 1 });
    expect(screen.getByText("Historical")).toBeInTheDocument();
    expect(document.querySelector(".tpr")?.className).toContain("locked");
  });
});

describe("capability gating on the screen", () => {
  it("without `approvals` there is nothing to approve or send back", () => {
    renderTimePay({ canApprove: false });
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Send back")).toBeNull();
    expect(screen.getByText("Boston Hayes")).toBeInTheDocument(); // still readable
  });

  it("without `financials` (and not an admin) the settings gear is absent", () => {
    renderTimePay({ financials: false });
    expect(screen.queryByLabelText("Settings")).toBeNull();
  });

  it("an admin without `financials` still gets the gear — holidays only, no pay controls", async () => {
    const user = userEvent.setup();
    renderTimePay({
      financials: false,
      canHolidays: true,
    });
    await user.click(screen.getByLabelText("Settings"));
    expect(screen.getByText("Public holidays")).toBeInTheDocument();
    expect(screen.queryByText("Pay cycle")).toBeNull();
    expect(screen.queryByText("Re-run setup")).toBeNull();
    // holiday edits apply immediately — no draft Save, just a way out
    expect(screen.queryByText("Save")).toBeNull();
    expect(screen.getByText("Close")).toBeInTheDocument();
  });

  it("with both `financials` and admin, the gear carries holidays AND pay controls", async () => {
    const user = userEvent.setup();
    renderTimePay({ canHolidays: true });
    await user.click(screen.getByLabelText("Settings"));
    // "Public holidays" appears as the manager section and as the rate rule
    expect(screen.getAllByText("Public holidays").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Pay cycle")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("an hours-only payload renders no dollar figure anywhere", () => {
    // this is what the query produces without `financials`: the rate is
    // stripped for everyone, the viewer's own row included
    const hoursOnly = [
      { ...OVERTIME, rate: null },
      { ...CLEAN, rate: null },
    ];
    const { container } = renderTimePay({ staff: hoursOnly, financials: false });
    expect(container.textContent).not.toMatch(/\$\s*\d/);
  });
});

describe("pay settings", () => {
  it("saving the wizard persists through the action, not localStorage", async () => {
    const user = userEvent.setup();
    renderTimePay({ configured: false });
    await user.click(screen.getByLabelText("Settings"));
    expect(screen.getByText("Setup · step 1 of 7")).toBeInTheDocument();
    for (let i = 0; i < 6; i++) await user.click(screen.getByText("Next"));
    await user.click(screen.getByText("Save settings"));
    expect(savePaySettings).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("ht_tp_set")).toBeNull();
  });

  it("settings drive the derivation — a longer standard day flags clean weeks", () => {
    renderTimePay({ settings: { ...DEFAULT_SETTINGS, standard: 8.5 } });
    // every 8h day is now an under day, so nobody is ready
    expect(screen.queryByText("Ready to approve", { selector: ".st" })).toBeNull();
    expect(within(section("Need review")).getByText("Marcus Webb")).toBeInTheDocument();
  });
});
