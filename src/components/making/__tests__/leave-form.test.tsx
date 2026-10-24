import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaveForm, LEAVE_ASKS, stepLine, type LeaveAsk } from "../leave-form";
import { WindowsContext } from "@/components/records/records-context";
import type { BalanceView } from "@/lib/timepay/leave";

/* A LEAVE REQUEST, PICKED ON A CALENDAR (Isaac, 24 October 2026: "It should
   be annual leave request. And then I want you to show me what happens going
   through the process of selecting those dates. Ideally, a calendar needs to
   be shown"; "Sick day, you should be able to add ones in the past. Or select
   the current day, at least"). His mock's sections 6 and 7, walked press by
   press. */

const requestLeave = jest.fn(async (..._a: unknown[]) => ({ ok: true as const, id: "new-request" }));
const cancelLeave = jest.fn(async (..._a: unknown[]) => ({ ok: true as const }));
jest.mock("@/app/actions/leave", () => ({
  requestLeave: (...a: unknown[]) => requestLeave(...a),
  cancelLeave: (...a: unknown[]) => cancelLeave(...a),
}));
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));
/* the certificate picker imports the shared upload client, which reaches a
   server action and pulls auth0 into jsdom: the suite fails to PARSE
   without this */
const uploadFile = jest.fn(async (..._a: unknown[]) => ({
  ok: true as const,
  file: { documentId: "doc-1", fileName: "certificate.pdf", mimeType: "application/pdf", sizeBytes: 1, previewUrl: null },
}));
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: (...a: unknown[]) => uploadFile(...a) }));

// NSW's, round the turn of 2026
const HOLIDAYS = [
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-26", name: "Boxing Day" },
  { date: "2026-12-28", name: "Boxing Day (additional day)" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-01-26", name: "Australia Day" },
];

const ANNUAL: BalanceView = { kind: "annual", balanceHours: 120, asAt: "2026-07-01", source: "manual", booked: 0, available: 120 };

const toast = jest.fn();
const onClose = jest.fn();

function setup(ask: LeaveAsk, over: Partial<React.ComponentProps<typeof LeaveForm>> = {}) {
  const heading = LEAVE_ASKS.find((a) => a.key === ask)!.heading;
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <LeaveForm ask={ask} today="2026-12-01" standard={8} balances={[]} holidays={HOLIDAYS} onClose={onClose} {...over} />
    </WindowsContext.Provider>,
  );
  const user = userEvent.setup();
  const form = () => within(screen.getByRole("dialog", { name: heading }));
  const day = (name: string) => form().getByRole("button", { name });
  const step = () => document.querySelector(".lv2-ask")!.textContent;
  const sum = () => document.querySelector(".lv2-sum")?.textContent ?? null;
  const send = () => form().getByRole("button", { name: ask === "sick" || ask === "carers" ? "Send" : "Send request" });
  return { user, form, day, step, sum, send };
}

beforeEach(() => {
  requestLeave.mockClear();
  cancelLeave.mockClear();
  uploadFile.mockClear();
  toast.mockClear();
  onClose.mockClear();
  refresh.mockClear();
});

describe("Add's four", () => {
  it("are the menu's words, in its order, each with its kind", () => {
    expect(LEAVE_ASKS.map((a) => [a.heading, a.kind])).toEqual([
      ["Annual leave request", "annual"],
      ["Sick day", "personal"],
      ["Carer's leave", "personal"],
      ["Unpaid leave request", "unpaid"],
    ]);
  });
});

describe("an annual leave request, step by step", () => {
  it("opens on two months with nothing picked, and Send request waits for a day", () => {
    const { form, step, sum, send } = setup("annual");
    expect(form().getByRole("heading", { name: "Annual leave request" })).toBeInTheDocument();
    expect(form().getByRole("group", { name: "December 2026" })).toBeInTheDocument();
    expect(form().getByRole("group", { name: "January 2027" })).toBeInTheDocument();
    expect(step()).toBe("Pick your first day off");
    expect(sum()).toBeNull();
    expect(send()).toBeDisabled();
  });

  it("walks Pick your first day off, Now your last day off, and the span, and a third press starts again", async () => {
    const { user, day, step, sum } = setup("annual");
    await user.click(day("Mon 21 Dec"));
    expect(step()).toBe("Now your last day off, from Mon 21 Dec");
    await user.click(day("Fri 1 Jan, public holiday"));
    expect(step()).toBe("Mon 21 Dec to Fri 1 Jan, press a day to start again");
    // Christmas, Boxing Day's extra Monday and New Year's Day are left out, and the weekends
    expect(sum()).toContain("7 working days, 56 hours");
    await user.click(day("Mon 11 Jan"));
    expect(step()).toBe("Now your last day off, from Mon 11 Jan");
    expect(sum()).toContain("Mon 11 Jan, 8 hours");
  });

  it("lists the public holidays it leaves out, under the months", () => {
    const { form } = setup("annual");
    expect(form().getByText(/Public holidays, not counted:/).closest("p")).toHaveTextContent(
      "Fri 25 Dec Christmas Day, Sat 26 Dec Boxing Day, Mon 28 Dec Boxing Day (additional day), Fri 1 Jan New Year's Day and Tue 26 Jan Australia Day",
    );
  });

  it("only takes today and later", () => {
    const { day } = setup("annual");
    expect(day("Tue 1 Dec, today")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Earlier month" })).toBeDisabled();
  });

  it("says a balance not set yet goes in as a request, waiting for approval", async () => {
    const { user, day, sum } = setup("annual");
    await user.click(day("Mon 21 Dec"));
    expect(sum()).toContain("Your annual leave balance isn't set yet, so it goes in as a request, waiting for approval.");
  });

  it("says what a balance that is set has left after it", async () => {
    const { user, day, sum } = setup("annual", { balances: [ANNUAL] });
    await user.click(day("Mon 21 Dec"));
    await user.click(day("Fri 1 Jan, public holiday"));
    expect(sum()).toContain("Comes off your annual leave: 120 hours available, 64 after this.");
  });

  it("fills the hours from the roster, and a part day can change them", async () => {
    const { user, form, day, sum, send } = setup("annual");
    await user.click(day("Mon 21 Dec"));
    await user.click(day("Fri 1 Jan, public holiday"));
    const hours = form().getByLabelText("Hours");
    expect(hours).toHaveValue(56);
    await user.click(day("Wed 23 Dec"));
    expect(hours).toHaveValue(8);
    await user.clear(hours);
    await user.type(hours, "4");
    expect(sum()).toContain("Wed 23 Dec, 4 hours");
    await user.type(form().getByLabelText("Note"), "Dentist");
    await user.click(send());
    expect(requestLeave).toHaveBeenCalledWith({ kind: "annual", startDate: "2026-12-23", endDate: "2026-12-23", hours: 4, note: "Dentist" });
  });

  it("counts a part-timer's own days", async () => {
    const { user, day, sum } = setup("annual", { workDays: [0, 1, 3] });
    await user.click(day("Mon 7 Dec"));
    await user.click(day("Fri 11 Dec"));
    expect(sum()).toContain("3 working days, 24 hours");
  });

  it("sends the span with its hours, keeps you on your leave, and Undo withdraws it", async () => {
    const { user, day, send } = setup("annual");
    await user.click(day("Mon 21 Dec"));
    await user.click(day("Fri 1 Jan, public holiday"));
    await user.click(send());
    expect(requestLeave).toHaveBeenCalledWith({ kind: "annual", startDate: "2026-12-21", endDate: "2027-01-01", hours: 56, note: undefined });
    expect(onClose).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Leave request sent", expect.any(Function));
    await act(async () => toast.mock.calls[0][1]());
    expect(cancelLeave).toHaveBeenCalledWith("new-request");
  });

  it("sends one day once a first day is picked", async () => {
    const { user, day, send } = setup("annual");
    await user.click(day("Mon 21 Dec"));
    expect(send()).toBeEnabled();
    await user.click(send());
    expect(requestLeave).toHaveBeenCalledWith(expect.objectContaining({ startDate: "2026-12-21", endDate: "2026-12-21", hours: 8 }));
  });

  it("says why the request was refused, and stays open", async () => {
    const { user, form, day, send } = setup("annual");
    requestLeave.mockResolvedValueOnce({ ok: false, error: "Those dates overlap leave you've already got in — cancel or change that request first." } as never);
    await user.click(day("Mon 21 Dec"));
    await user.click(send());
    expect(form().getByRole("alert")).toHaveTextContent("Those dates overlap leave you've already got in");
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("has no native select (rule 34) and no ink button (rule 22)", () => {
    const { form, send } = setup("annual");
    expect(screen.getByRole("dialog", { name: "Annual leave request" }).querySelector("select")).toBeNull();
    expect(send()).toHaveClass("pt-btn--main");
    expect(form().getByRole("button", { name: "Cancel" })).toHaveClass("pt-btn--second");
  });
});

describe("an unpaid leave request", () => {
  it("is planned the same way, and comes off no balance", async () => {
    const { user, form, day, sum, send } = setup("unpaid");
    expect(form().getByRole("group", { name: "January 2027" })).toBeInTheDocument();
    await user.click(day("Mon 21 Dec"));
    expect(sum()).toContain("Unpaid leave comes off no balance, so it goes in as a request, waiting for approval.");
    await user.click(send());
    expect(requestLeave).toHaveBeenCalledWith(expect.objectContaining({ kind: "unpaid" }));
  });
});

describe("a sick day", () => {
  const SAT = "2026-10-24"; // the day Isaac asked, a Saturday

  it("opens on one month with today picked", () => {
    const { form, day, step } = setup("sick", { today: SAT });
    expect(form().getByRole("heading", { name: "Sick day" })).toBeInTheDocument();
    expect(form().getByRole("group", { name: "October 2026" })).toBeInTheDocument();
    expect(form().queryByRole("group", { name: "November 2026" })).toBeNull();
    expect(day("Sat 24 Oct, today")).toHaveClass("pt-cal-day--picked");
    expect(step()).toBe("Today, Sat 24 Oct, press another day, or a second one for a run of days");
  });

  it("says a day you don't work takes no hours, and why", () => {
    const { sum, send } = setup("sick", { today: SAT });
    expect(sum()).toContain("Sat 24 Oct, no hours");
    expect(sum()).toContain("Saturday isn't one of your working days, so nothing comes off your personal leave. On a working day it's that day's hours, 8.");
    expect(send()).toBeDisabled();
  });

  it("takes a day already gone, and sends it as personal leave", async () => {
    const { user, day, step, sum, send } = setup("sick", { today: SAT });
    await user.click(day("Thu 22 Oct"));
    expect(step()).toBe("Thu 22 Oct, a day already gone, put in after");
    expect(sum()).toContain("Thu 22 Oct, 8 hours");
    expect(sum()).toContain("Your personal leave balance isn't set yet, so it goes in as a request, waiting for approval.");
    await user.click(send());
    expect(requestLeave).toHaveBeenCalledWith({ kind: "personal", startDate: "2026-10-22", endDate: "2026-10-22", hours: 8, note: undefined });
  });

  it("makes a run on a second press", async () => {
    const { user, day, step, sum } = setup("sick", { today: SAT });
    await user.click(day("Mon 19 Oct"));
    await user.click(day("Wed 21 Oct"));
    expect(step()).toBe("Mon 19 Oct to Wed 21 Oct, press a day to start again");
    expect(sum()).toContain("3 working days, 24 hours");
  });

  it("can't be put in for a day still to come, and reaches back a few months", async () => {
    const { user, day } = setup("sick", { today: SAT });
    expect(day("Sun 25 Oct")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Later month" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Earlier month" }));
    expect(screen.getByRole("group", { name: "September 2026" })).toBeInTheDocument();
  });

  it("counts a day already gone against its own holiday", async () => {
    const { user, day, sum } = setup("sick", { today: "2026-10-07", holidays: [{ date: "2026-10-05", name: "Labour Day" }] });
    await user.click(day("Mon 5 Oct, public holiday"));
    expect(sum()).toContain("Mon 5 Oct, no hours");
    expect(sum()).toContain("Labour Day is a public holiday, so nothing comes off your personal leave.");
  });

  it("offers the certificate when the workspace asks, now or later, and sends it", async () => {
    const { user, form, day, send } = setup("sick", { today: SAT, certAfterDays: 1 });
    await user.click(day("Thu 22 Oct"));
    expect(form().getByText("Medical certificate")).toBeInTheDocument();
    expect(form().getByText("Add it now or later")).toBeInTheDocument();
    const input = screen.getByRole("dialog", { name: "Sick day" }).querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File(["x"], "certificate.pdf", { type: "application/pdf" }));
    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "medical_certificate");
    expect(form().getByRole("list", { name: "Medical certificate" })).toHaveTextContent("certificate.pdf");
    await user.click(send());
    expect(requestLeave).toHaveBeenCalledWith(expect.objectContaining({ kind: "personal", certificateDocumentId: "doc-1" }));
  });

  it("never blocks a sick day on the certificate, and asks for none when the workspace doesn't", async () => {
    const { user, form, day, send } = setup("sick", { today: SAT });
    await user.click(day("Thu 22 Oct"));
    expect(form().queryByText("Medical certificate")).toBeNull();
    expect(send()).toBeEnabled();
  });
});

describe("carer's leave", () => {
  it("opens on today like a sick day, takes a day gone or to come, and goes in as personal leave", async () => {
    const { user, form, day, send } = setup("carers", { today: "2026-10-21" });
    expect(form().getByRole("heading", { name: "Carer's leave" })).toBeInTheDocument();
    expect(day("Wed 21 Oct, today")).toHaveClass("pt-cal-day--picked");
    expect(day("Mon 19 Oct")).toBeEnabled();
    expect(day("Fri 30 Oct")).toBeEnabled();
    await user.click(send());
    expect(requestLeave).toHaveBeenCalledWith(expect.objectContaining({ kind: "personal", startDate: "2026-10-21", endDate: "2026-10-21", hours: 8 }));
  });
});

describe("stepLine", () => {
  it("says what the next press does", () => {
    expect(stepLine("annual", { start: null, end: null }, "2026-12-01")).toEqual({ lead: "Pick your first day off" });
    expect(stepLine("annual", { start: "2026-12-21", end: null }, "2026-12-01")).toEqual({ lead: "Now your last day off", rest: "from Mon 21 Dec" });
    expect(stepLine("annual", { start: "2026-12-21", end: "2027-01-01" }, "2026-12-01")).toEqual({
      lead: "Mon 21 Dec to Fri 1 Jan",
      rest: "press a day to start again",
    });
    expect(stepLine("sick", { start: "2026-10-22", end: null }, "2026-10-24")).toEqual({ lead: "Thu 22 Oct", rest: "a day already gone, put in after" });
  });
});
