import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyTimesheet } from "../my-timesheet";
import type { PayPeriod } from "../timepay";
import { DEFAULT_SETTINGS, type DayEntry, type StaffWeek, type WeekDay } from "../logic";
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

/* My timesheet — your own week, in the Time & Pay day language. The whole
   screen is hours: the assertions below include a standing check that not one
   dollar figure can reach it. */

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
const w8 = W("7:00 AM", "3:30 PM", 8);
const EM: DayEntry = { t: "empty" };

/* No rate — the query stopped selecting one. */
const ME: StaffWeek = {
  id: "me",
  name: "Isaac Smith",
  role: "Installer",
  rate: null,
  days: [w8, w8, W("7:00 AM", "6:00 PM", 11), { t: "sick", h: 8 }, EM, EM, EM],
};

const SHEET = (over: Partial<SheetState> = {}): SheetState => ({
  status: "draft",
  submittedAt: null,
  reviewNote: null,
  reviewedBy: null,
  ...over,
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
      {...over}
    />,
  );
}

const tile = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  [saveDay, submitWeek, push, refresh].forEach((m) => m.mockClear());
});

describe("My timesheet, in the review language", () => {
  it("renders the period nav and the day tiles, not a list of rows", () => {
    const { container } = renderSheet();
    expect(screen.getByText("My timesheet")).toBeInTheDocument();
    expect(screen.getByText("29 Jun – 5 Jul")).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(container.querySelectorAll(".tiles .tile")).toHaveLength(7);
    expect(container.querySelector(".mts-day")).toBeNull(); // the old row list
  });

  it("the legend names the missing days — the one colour that is a to-do", () => {
    const { container } = renderSheet();
    const legend = container.querySelector(".legend") as HTMLElement;
    expect(legend.querySelector(".sw.miss")).not.toBeNull();
    expect(within(legend).getByText("Missing")).toBeInTheDocument();
    // and the tiles it explains say the same word
    expect(container.querySelectorAll(".tile.miss").length).toBeGreaterThan(0);
  });

  it("says nothing about money — not a rate, not a gross, not a dollar sign", () => {
    const { container } = renderSheet();
    expect(container.textContent).not.toMatch(/\$\s*\d/);
    expect(screen.queryByText("Your rate")).toBeNull();
  });

  it("counts hours, overtime and paid absence", () => {
    const { container } = renderSheet();
    const stats = container.querySelector(".stats") as HTMLElement;
    expect(stats.className).toContain("n3");
    expect(stats.textContent).toContain("27h"); // 8 + 8 + 11 worked
    expect(stats.textContent).toContain("3h"); // 11h Wednesday, 3 over standard
    expect(stats.textContent).toContain("8h"); // the sick day
  });

  it("period arrows navigate, they don't hold local state", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByLabelText("Previous period"));
    expect(push).toHaveBeenCalledWith("/dashboard/my-timesheet?period=2026-06-22");
  });
});

describe("editing a day", () => {
  it("clicking a tile opens one editor, seeded from that day", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    expect(container.querySelector(".dayedit")).toBeNull();

    await user.click(tile("MON 29 Jun"));
    expect(container.querySelectorAll(".dayedit")).toHaveLength(1);
    expect(screen.getByText("Mon 29 Jun")).toBeInTheDocument();
    expect(screen.getByLabelText("Start")).toHaveValue("7:00 AM");
    expect(screen.getByLabelText("Finish")).toHaveValue("3:30 PM");
    expect(screen.getByLabelText("Hours")).toHaveValue(8);
  });

  it("picking another day re-seeds the same single editor", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tile("MON 29 Jun"));
    await user.click(tile("WED 1 Jul"));
    expect(container.querySelectorAll(".dayedit")).toHaveLength(1);
    expect(screen.getByLabelText("Finish")).toHaveValue("6:00 PM");
    expect(screen.getByLabelText("Hours")).toHaveValue(11);
  });

  it("the selected tile is marked, and only that one", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tile("TUE 30 Jun"));
    const sel = container.querySelectorAll(".tile.sel");
    expect(sel).toHaveLength(1);
    expect(sel[0].textContent).toContain("30");
  });

  it("saving sends the period, the day index and the entry", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tile("MON 29 Jun"));
    await user.clear(screen.getByLabelText("Hours"));
    await user.type(screen.getByLabelText("Hours"), "9");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 0, {
      t: "work",
      in: "7:00 AM",
      out: "3:30 PM",
      h: 9,
    });
  });

  it("a non-work kind drops the times and keeps the hours", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tile("FRI 3 Jul"));
    await user.selectOptions(screen.getByLabelText("Day"), "leave");
    await user.type(screen.getByLabelText("Hours"), "8");
    await user.click(screen.getByText("Save day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 4, { t: "leave", h: 8 });
  });

  it("Clear day writes the empty entry — the action that deletes the row", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(tile("WED 1 Jul"));
    await user.click(screen.getByText("Clear day"));
    expect(saveDay).toHaveBeenCalledWith("2026-06-29", 2, { t: "empty" });
  });

  it("Cancel closes the editor and writes nothing", async () => {
    const user = userEvent.setup();
    const { container } = renderSheet();
    await user.click(tile("MON 29 Jun"));
    await user.click(screen.getByText("Cancel"));
    expect(container.querySelector(".dayedit")).toBeNull();
    expect(saveDay).not.toHaveBeenCalled();
  });

  it("names the public holiday on a day that is one", async () => {
    const user = userEvent.setup();
    renderSheet({ holidays: [{ date: "2026-07-01", name: "Territory Day" }] });
    await user.click(tile("WED 1 Jul"));
    expect(screen.getByText("Territory Day")).toBeInTheDocument();
  });
});

describe("when the week is closed to you", () => {
  it.each([
    ["submitted", { sheet: SHEET({ status: "submitted" }) }],
    ["approved", { sheet: SHEET({ status: "approved" }) }],
    ["historical", { periodIndex: 1 }],
  ])("%s: the tiles are not buttons and nothing opens", async (_label, over) => {
    const { container } = renderSheet(over as Partial<React.ComponentProps<typeof MyTimesheet>>);
    expect(container.querySelector(".tpr")?.className).toContain("locked");
    expect(container.querySelectorAll(".tiles button")).toHaveLength(0);
    expect(container.querySelector(".dayedit")).toBeNull();
    expect(screen.queryByText("Submit week")).toBeNull();
  });

  it("a historical period says so in the period pill", () => {
    renderSheet({ periodIndex: 1 });
    expect(screen.getByText("Historical")).toBeInTheDocument();
  });
});

describe("submitting", () => {
  it("submits the period", async () => {
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
