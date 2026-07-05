import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimePay } from "../timepay";
import {
  demoTimepayPeriods,
  demoTimepayStaff,
  demoTimepayToday,
  demoTimepayWeek,
} from "@/mock/demo";

function renderTimePay() {
  return render(
    <TimePay
      staff={demoTimepayStaff}
      week={demoTimepayWeek}
      today={demoTimepayToday}
      periods={demoTimepayPeriods}
    />
  );
}

const section = (title: string) => {
  const st = screen.getByText(title, { selector: ".st" });
  return st.closest(".sectwrap") as HTMLElement;
};

beforeEach(() => localStorage.clear());

describe("TimePay screen", () => {
  it("sorts demo staff into review and ready sections with matching stats", () => {
    renderTimePay();
    // 5 flagged (Boston/Priya/Jordan OT, Hannah sick, Sophie leave), 2 clean
    expect(within(section("Need review")).getAllByText("Approve")).toHaveLength(5);
    expect(within(section("Ready to approve")).getAllByText("Approve")).toHaveLength(2);
    expect(screen.queryByText("Approved", { selector: ".st" })).toBeNull();
    const stats = document.querySelectorAll(".stat .sv");
    // OT stat sums 1.5x and 2x hours: Boston 2 + Priya 3.5 + Jordan 5.5
    expect([...stats].map((s) => s.textContent)).toEqual(["5", "2", "11h", "$0"]);
  });

  it("shows the live pill and the auto-submit note built from settings", () => {
    renderTimePay();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText("Open · auto-submits Sun 3:00 PM · then locks")).toBeInTheDocument();
  });

  it("approving moves a person to Approved and persists the action", async () => {
    const user = userEvent.setup();
    renderTimePay();
    const ready = section("Ready to approve");
    await user.click(within(ready).getAllByText("Approve")[0]);
    expect(within(section("Approved")).getByText("Marcus Webb")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("ht_tp_actions") || "{}")).toEqual({
      "Marcus Webb": "approved",
    });
  });

  it("approve all clears the ready section", async () => {
    const user = userEvent.setup();
    renderTimePay();
    await user.click(screen.getByText("Approve all"));
    expect(screen.queryByText("Ready to approve", { selector: ".st" })).toBeNull();
    const approved = section("Approved");
    expect(within(approved).getByText("Marcus Webb")).toBeInTheDocument();
    expect(within(approved).getByText("Dylan Reyes")).toBeInTheDocument();
  });

  it("send back replaces the card actions with a persistent tag", async () => {
    const user = userEvent.setup();
    renderTimePay();
    const card = screen.getByText("Boston Hayes").closest(".card") as HTMLElement;
    await user.click(within(card).getByText("Send back"));
    expect(card.className).toContain("sending");
    await user.click(within(card).getByText("Send", { selector: "button.qsend" }));
    expect(within(card).getByText("Sent back · awaiting reply")).toBeInTheDocument();
    expect(within(card).queryByText("Approve")).toBeNull();
    expect(JSON.parse(localStorage.getItem("ht_tp_actions") || "{}")).toEqual({
      "Boston Hayes": "sent",
    });
  });

  it("restores persisted actions on mount (sent tag survives reload)", () => {
    localStorage.setItem("ht_tp_actions", JSON.stringify({ "Boston Hayes": "sent" }));
    renderTimePay();
    expect(screen.getByText("Sent back · awaiting reply")).toBeInTheDocument();
  });

  it("navigating back renders a locked historical period", async () => {
    const user = userEvent.setup();
    renderTimePay();
    await user.click(screen.getByLabelText("Previous period"));
    expect(screen.getByText("Historical")).toBeInTheDocument();
    expect(screen.getByText("22 – 28 Jun")).toBeInTheDocument();
    expect(screen.getByText("Closed · submitted 29 Jun")).toBeInTheDocument();
    expect(document.querySelector(".tpr")?.className).toContain("locked");
    await user.click(screen.getByLabelText("Next period"));
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("expanding a review card shows the daily breakdown and totals band", async () => {
    const user = userEvent.setup();
    renderTimePay();
    const card = screen.getByText("Boston Hayes").closest(".card") as HTMLElement;
    await user.click(within(card).getByText(/View daily breakdown/));
    expect(within(card).getByText("Weighted hours")).toBeInTheDocument();
    expect(within(card).getByText("43h")).toBeInTheDocument();
    expect(within(card).getAllByText("07:00 – 16:00")).toHaveLength(2); // Mon & Wed 9h shifts
    // once in the pay panel, once in the expanded totals band
    expect(within(card).getAllByText("Time and a half")).toHaveLength(2);
  });

  it("first gear click opens the setup wizard; after save it opens the menu", async () => {
    const user = userEvent.setup();
    const { unmount } = renderTimePay();
    await user.click(screen.getByLabelText("Pay settings"));
    expect(screen.getByText("Setup · step 1 of 7")).toBeInTheDocument();
    // walk to the review step and save
    for (let i = 0; i < 6; i++) await user.click(screen.getByText("Next"));
    expect(screen.getByText("Review")).toBeInTheDocument();
    await user.click(screen.getByText("Save settings"));
    expect(screen.queryByText("Setup · step 1 of 7")).toBeNull();
    unmount();

    renderTimePay();
    await user.click(screen.getByLabelText("Pay settings"));
    expect(screen.getByText("Pay settings", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText(/Export 29 Jun – 5 Jul 2026 \(PDF\)/)).toBeInTheDocument();
  });

  it("raising the standard day in the wizard recomputes statuses", async () => {
    const user = userEvent.setup();
    renderTimePay();
    // Marcus (5×8h) is ready by default
    expect(within(section("Ready to approve")).getByText("Marcus Webb")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Pay settings"));
    await user.click(screen.getByText("Next")); // step 2
    await user.click(screen.getByText("Next")); // step 3: standard working day
    await user.click(screen.getByLabelText("Increase")); // 8h -> 8.5h: every 8h day is now under
    for (let i = 0; i < 4; i++) await user.click(screen.getByText("Next"));
    await user.click(screen.getByText("Save settings"));
    // every 8h day is an under day; nothing is ready
    expect(screen.queryByText("Ready to approve", { selector: ".st" })).toBeNull();
    expect(within(section("Need review")).getByText("Marcus Webb")).toBeInTheDocument();
  });
});
