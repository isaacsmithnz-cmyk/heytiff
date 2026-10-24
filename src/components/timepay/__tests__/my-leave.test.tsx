import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LEAVE_STATE, MyLeave } from "../my-leave";
import { WindowsContext } from "@/components/records/records-context";
import type { BalanceView, LeaveRequest } from "@/lib/timepay/leave";

/* LEAVE, A PAGE OF ITS OWN (Isaac's mock of 24 October 2026, section 2).
   The title and Add, one blue button whose white menu holds the four kinds
   ("You need to have a add button instead of ask for leave… the add would
   be leave request, sick day, etc."); what you have as two figures; your
   requests as rows with their state as a word ("Waiting on the office
   should be waiting for approval"); the public holidays coming up. */

const requestLeave = jest.fn(async (..._a: unknown[]) => ({ ok: true as const, id: "new-request" }));
const cancelLeave = jest.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const attachCertificate = jest.fn(async (..._a: unknown[]) => ({ ok: true as const }));
jest.mock("@/app/actions/leave", () => ({
  requestLeave: (...a: unknown[]) => requestLeave(...a),
  cancelLeave: (...a: unknown[]) => cancelLeave(...a),
  attachCertificate: (...a: unknown[]) => attachCertificate(...a),
}));
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));
/* the certificate picker imports the shared upload client, which reaches a
   server action and pulls auth0 into jsdom */
const uploadFile = jest.fn(async (..._a: unknown[]) => ({
  ok: true as const,
  file: { documentId: "doc-1", fileName: "certificate.pdf", mimeType: "application/pdf", sizeBytes: 1, previewUrl: null },
}));
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: (...a: unknown[]) => uploadFile(...a) }));

const TODAY = "2026-10-21"; // a Wednesday
const HOLIDAYS = [
  { date: "2026-10-05", name: "Labour Day" }, // gone: loaded for a sick day put in after, not listed as coming
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-26", name: "Boxing Day" },
  { date: "2026-12-28", name: "Boxing Day (additional day)" },
  { date: "2027-01-01", name: "New Year's Day" },
];
const ANNUAL: BalanceView = { kind: "annual", balanceHours: 152, asAt: "2026-07-01", source: "xero", booked: 56, available: 96 };

const req = (over: Partial<LeaveRequest>): LeaveRequest => ({
  id: "r1",
  staffId: "s1",
  kind: "annual",
  startDate: "2026-12-21",
  endDate: "2027-01-01",
  hours: 56,
  status: "pending",
  ...over,
});

const toast = jest.fn();

function setup(over: Partial<React.ComponentProps<typeof MyLeave>> = {}) {
  const view = render(
    <WindowsContext.Provider value={{ toast } as never}>
      <MyLeave today={TODAY} standard={8} balances={[]} requests={[]} holidays={HOLIDAYS} {...over} />
    </WindowsContext.Provider>,
  );
  const user = userEvent.setup();
  const add = () => screen.getByRole("button", { name: "Add" });
  const pick = async (item: RegExp) => {
    await user.click(add());
    await user.click(screen.getByRole("menuitem", { name: item }));
  };
  return { ...view, user, add, pick };
}

beforeEach(() => {
  requestLeave.mockClear();
  cancelLeave.mockClear();
  attachCertificate.mockClear();
  uploadFile.mockClear();
  toast.mockClear();
  refresh.mockClear();
});

describe("the page", () => {
  it("is titled Leave, with Add the one blue button, and none of the old card's strip or bars", () => {
    const { container, add } = setup();
    expect(screen.getByRole("heading", { level: 1, name: "Leave" })).toBeInTheDocument();
    expect(add()).toHaveClass("pt-btn--main");
    expect(add()).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask for leave" })).toBeNull();
    // the grey header bars and the coloured blocks went with the old card
    expect(container.querySelector(".lv-ch, .lv-baltile, .lv-req, .dchip")).toBeNull();
    expect(container.querySelectorAll(".pt-btn--main")).toHaveLength(1);
  });
});

describe("Add", () => {
  it("opens a white menu of the four kinds", async () => {
    const { user, add } = setup();
    await user.click(add());
    const menu = screen.getByRole("menu", { name: "Add leave" });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Annual leave request",
      "Sick dayPersonal leave",
      "Carer's leavePersonal leave",
      "Unpaid leave request",
    ]);
    expect(menu.closest(".pt-menu")).not.toHaveClass("pt-menu--ink");
  });

  it.each([
    [/^Annual leave request/, "Annual leave request", "annual", "Send request"],
    [/^Sick day/, "Sick day", "personal", "Send"],
    [/^Carer's leave/, "Carer's leave", "personal", "Send"],
    [/^Unpaid leave request/, "Unpaid leave request", "unpaid", "Send request"],
  ])("opens %s as the form with its heading, and sends its kind", async (item, heading, kind, sendWord) => {
    const { user, pick } = setup();
    await pick(item);
    const form = within(screen.getByRole("dialog", { name: heading }));
    expect(form.getByRole("heading", { name: heading })).toBeInTheDocument();
    // a request is planned from a first day; a sick day and carer's leave open on today
    if (sendWord === "Send request") await user.click(form.getByRole("button", { name: "Thu 22 Oct" }));
    else expect(form.getByRole("button", { name: "Wed 21 Oct, today" })).toHaveClass("pt-cal-day--picked");
    await user.click(form.getByRole("button", { name: sendWord }));
    expect(requestLeave).toHaveBeenCalledWith(expect.objectContaining({ kind }));
    expect(screen.queryByRole("dialog", { name: heading })).toBeNull();
    expect(toast).toHaveBeenCalledWith("Leave request sent", expect.any(Function));
  });

  it("closes the form on Cancel and leaves the page as it was", async () => {
    const { user, pick } = setup();
    await pick(/^Sick day/);
    await user.click(within(screen.getByRole("dialog", { name: "Sick day" })).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requestLeave).not.toHaveBeenCalled();
  });
});

describe("What you have", () => {
  it("shows a dash and says not set yet for a balance nobody has set", () => {
    setup();
    const figs = document.querySelector(".lv2-figs")!;
    expect(within(figs as HTMLElement).getByText("Annual leave, not set yet").nextSibling).toHaveTextContent("—");
    expect(within(figs as HTMLElement).getByText("Personal / carer's, not set yet")).toBeInTheDocument();
  });

  it("shows a balance that is set as its hours available, with what's booked and where it came from", () => {
    setup({ balances: [ANNUAL] });
    const caption = screen.getByText("Annual leave, 56 h booked, synced from Xero");
    expect(caption.nextSibling).toHaveTextContent("96 h");
  });
});

describe("Your requests", () => {
  it("says so when there are none", () => {
    setup();
    expect(screen.getByText("Nothing requested yet.")).toBeInTheDocument();
  });

  it("draws each as a row: a dot, the kind, the dates and hours, and where it's up to", () => {
    setup({ requests: [req({})] });
    const row = within(screen.getByRole("list", { name: "Your requests" })).getAllByRole("listitem")[0]!;
    expect(row.querySelector(".pt-row-name")).toHaveTextContent("Annual leave");
    expect(row.querySelector(".pt-row-line")).toHaveTextContent("Mon 21 Dec – Fri 1 Jan, 7 days, 56 h");
    expect(row.querySelector(".pt-dot")).toHaveClass("pt-dot--orange");
    expect(row.querySelector(".lv2-word")).toHaveTextContent("Waiting for approval");
    expect(row.querySelector(".lv2-word")).toHaveClass("lv2-word--look");
  });

  it("says Waiting for approval, never Pending, wherever you see a request still waiting", async () => {
    const { user, container } = setup({ requests: [req({})] });
    expect(LEAVE_STATE.pending.word).toBe("Waiting for approval");
    expect(container).not.toHaveTextContent(/pending/i);
    await user.click(screen.getByRole("button", { name: "Annual leave" }));
    expect(within(screen.getByRole("dialog", { name: "Annual leave" })).getByText("Waiting for approval")).toBeInTheDocument();
  });

  it("says each state as a word in its colour", () => {
    setup({
      requests: [
        req({ id: "a", status: "approved" }),
        req({ id: "d", status: "declined", reviewNote: "Short-staffed over Christmas" }),
        req({ id: "c", status: "cancelled", kind: "unpaid", startDate: "2026-10-01", endDate: "2026-10-06", hours: 24 }),
      ],
    });
    const words = [...document.querySelectorAll(".lv2-word")].map((w) => [w.textContent, w.className]);
    expect(words).toEqual([
      ["Approved", "lv2-word lv2-word--good"],
      ["Declined", "lv2-word lv2-word--wrong"],
      ["Cancelled", "lv2-word lv2-word--info"],
    ]);
    expect(screen.getByText("Thu 1 Oct – Tue 6 Oct, 3 days, 24 h")).toBeInTheDocument();
  });

  it("opens a request, and Cancel request withdraws one still waiting", async () => {
    const { user } = setup({ requests: [req({ note: "Family in Perth" })] });
    await user.click(screen.getByRole("button", { name: "Annual leave" }));
    const dialog = within(screen.getByRole("dialog", { name: "Annual leave" }));
    expect(dialog.getByText("Mon 21 Dec to Fri 1 Jan")).toBeInTheDocument();
    expect(dialog.getByText("Family in Perth")).toBeInTheDocument();
    const cancel = dialog.getByRole("button", { name: "Cancel request" });
    expect(cancel).toHaveClass("pt-btn--delete");
    await user.click(cancel);
    expect(cancelLeave).toHaveBeenCalledWith("r1");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toast).toHaveBeenCalledWith("Leave request cancelled");
  });

  it("offers no Cancel request once approved leave has started, or for a request already closed", async () => {
    const { user } = setup({
      requests: [req({ id: "a", status: "approved", startDate: "2026-10-19", endDate: "2026-10-23", hours: 40 }), req({ id: "d", status: "declined", reviewNote: "Short-staffed" })],
    });
    const [started, declined] = screen.getAllByRole("button", { name: "Annual leave" });
    await user.click(started!);
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Cancel request" })).toBeNull();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await user.click(declined!);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Why it was declined")).toBeInTheDocument();
    expect(dialog.getByText("Short-staffed")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Cancel request" })).toBeNull();
  });

  it("says when a sick day is still waiting on its certificate, and takes it afterwards", async () => {
    const { user } = setup({
      requests: [req({ kind: "personal", startDate: "2026-10-19", endDate: "2026-10-20", hours: 16, status: "approved", certExpected: true })],
    });
    expect(screen.getByText("Mon 19 Oct – Tue 20 Oct, 2 days, 16 h, no certificate yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Personal / carer's" }));
    const dialog = screen.getByRole("dialog", { name: "Personal / carer's" });
    expect(within(dialog).getByText("No certificate yet")).toBeInTheDocument();
    await user.upload(dialog.querySelector<HTMLInputElement>('input[type="file"]')!, new File(["x"], "certificate.pdf", { type: "application/pdf" }));
    expect(attachCertificate).toHaveBeenCalledWith("r1", "doc-1");
  });
});

describe("Public holidays coming up", () => {
  it("lists the ones still to come, the date in bold and the name", () => {
    setup();
    const list = screen.getByRole("list", { name: "Public holidays coming up" });
    expect([...list.querySelectorAll("li")].map((li) => [li.querySelector("b")?.textContent, li.querySelector("span")?.textContent])).toEqual([
      ["Fri 25 Dec", "Christmas Day"],
      ["Sat 26 Dec", "Boxing Day"],
      ["Mon 28 Dec", "Boxing Day (additional day)"],
      ["Fri 1 Jan", "New Year's Day"],
    ]);
  });

  it("says when none are loaded", () => {
    setup({ holidays: [] });
    expect(screen.getByText("No public holidays loaded for your state yet.")).toBeInTheDocument();
  });
});
