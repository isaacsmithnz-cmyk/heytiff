import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyLeave, balanceBars } from "../my-leave";
import { WindowsContext } from "@/components/records/records-context";
import { pickDate } from "@/components/ui/__tests__/fixtures/pick-date";
import type { BalanceView, LeaveRequest } from "@/lib/timepay/leave";

/* Asking for leave is choosing a span, and seeing what it costs.

   Ask for leave is a dialog over My leave now (components/making/leave-form,
   the forms board's form 9): the type, From and To, the hours, a note, a
   medical certificate when the span wants one, and the line that says what
   the span spends — its working days, the public holidays inside it given
   back by name, and what's available. The inline month grid it had is gone
   with the board; the holidays it showed are still counted and named. */

const requestLeave = jest.fn(async (..._a: unknown[]) => ({ ok: true as const, id: "new-request" }));
const cancelLeave = jest.fn(async (..._a: unknown[]) => ({ ok: true as const }));

jest.mock("@/app/actions/leave", () => ({
  requestLeave: (...a: unknown[]) => requestLeave(...a),
  cancelLeave: (...a: unknown[]) => cancelLeave(...a),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
/* The certificate picker imports the shared upload client, which reaches a
   server action and pulls auth0 into jsdom — the suite fails to PARSE without
   this, nowhere near the line that caused it. Same trap as every other
   `"use server"` import in a component test. */
const uploadFile = jest.fn(async (..._a: unknown[]) => ({
  ok: true as const,
  file: { documentId: "doc-1", fileName: "certificate.pdf", mimeType: "application/pdf", sizeBytes: 1, previewUrl: null },
}));
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: (...a: unknown[]) => uploadFile(...a) }));

const TODAY = "2026-07-20"; // a Monday
// the first Monday in August — a real one-day-off shape to plan around
const HOLIDAYS = [{ date: "2026-08-03", name: "Picnic Day" }];

const ANNUAL: BalanceView = {
  kind: "annual",
  balanceHours: 152,
  asAt: "2026-07-01",
  source: "manual",
  booked: 0,
  available: 152,
};

const toast = jest.fn();

function setup(over: Partial<React.ComponentProps<typeof MyLeave>> = {}) {
  const view = render(
    <WindowsContext.Provider value={{ toast } as never}>
      <MyLeave
        today={TODAY}
        standard={7.6}
        balances={[ANNUAL]}
        requests={[] as LeaveRequest[]}
        holidays={HOLIDAYS}
        {...over}
      />
    </WindowsContext.Provider>,
  );
  const user = userEvent.setup();
  const form = () => within(screen.getByRole("dialog", { name: "Ask for leave" }));
  const field = (label: string) => form().getByLabelText(label);
  const openForm = () => user.click(screen.getByRole("button", { name: "Ask for leave" }));
  const span = async (from: string, to: string) => {
    await pickDate("From", from, form());
    await pickDate("To", to, form());
  };
  return { ...view, user, form, field, openForm, span };
}

/** The line under the form: what the span costs. */
const meta = () => document.querySelector(".mk-team-line")!.textContent;

beforeEach(() => {
  requestLeave.mockClear();
  cancelLeave.mockClear();
  uploadFile.mockClear();
  toast.mockClear();
});

describe("From and To", () => {
  it("open on today, and a later From carries To along", async () => {
    const { field, openForm } = setup();
    await openForm();
    expect(field("From")).toHaveTextContent("20/07/2026");
    expect(field("To")).toHaveTextContent("20/07/2026");
    await pickDate("From", "2026-07-30", within(screen.getByRole("dialog", { name: "Ask for leave" })));
    expect(field("From")).toHaveTextContent("30/07/2026");
    expect(field("To")).toHaveTextContent("30/07/2026");
  });

  it("refuses days that have already been", async () => {
    const { user, field, openForm } = setup();
    await openForm();
    await user.click(field("From"));
    const pop = within(screen.getByRole("dialog", { name: "Choose a date" }));
    expect(pop.getByRole("button", { name: "Sunday 19 July 2026" })).toBeDisabled();
    expect(pop.getByRole("button", { name: "Monday 20 July 2026" })).toBeEnabled();
  });

  it("keeps the hours a number, its placeholder the suggestion (decision 27)", async () => {
    const { field, openForm, span } = setup();
    await openForm();
    await span("2026-07-22", "2026-07-24");
    expect(field("Hours")).toHaveAttribute("type", "number");
    expect(field("Hours")).toHaveAttribute("placeholder", "22.8");
  });
});

describe("public holidays inside the span", () => {
  it("counts the working days and says which day it gave back", async () => {
    const { openForm, span } = setup();
    await openForm();
    // Mon 3 Aug – Fri 7 Aug, with the Monday a public holiday
    await span("2026-08-03", "2026-08-07");
    expect(meta()).toContain("4 working days");
    expect(meta()).toContain("1 public holiday skipped (Picnic Day)");
    expect(meta()).toContain("152h available");
  });

  it("counts holidays it cannot name in a line", async () => {
    const { openForm, span } = setup({
      holidays: [
        { date: "2026-08-03", name: "Picnic Day" },
        { date: "2026-08-05", name: "Show Day" },
        { date: "2026-08-07", name: "Cup Day" },
      ],
    });
    await openForm();
    await span("2026-08-03", "2026-08-07");
    expect(meta()).toContain("2 working days");
    expect(meta()).toContain("3 public holidays skipped");
    expect(meta()).not.toContain("Picnic Day");
  });

  it("says nothing about holidays when the span passes none", async () => {
    const { openForm, span } = setup();
    await openForm();
    await span("2026-07-22", "2026-07-23");
    expect(meta()).toBe("2 working days, 152h available.");
  });
});

describe("sending", () => {
  it("sends the dates with the suggested hours, keeps you on your leave, and Undo withdraws it", async () => {
    const { user, form, openForm, span } = setup();
    await openForm();
    await span("2026-07-22", "2026-07-24");
    await user.click(form().getByRole("button", { name: "Send request" }));

    expect(requestLeave).toHaveBeenCalledWith({
      kind: "annual",
      startDate: "2026-07-22",
      endDate: "2026-07-24",
      hours: 22.8, // 3 working days × 7.6
      note: undefined,
    });
    expect(screen.queryByRole("dialog", { name: "Ask for leave" })).toBeNull();
    expect(toast).toHaveBeenCalledWith("Leave requested", expect.any(Function));
    await act(async () => toast.mock.calls[0][1]());
    expect(cancelLeave).toHaveBeenCalledWith("new-request");
  });

  it("still lets the hours be overridden for a part day", async () => {
    const { user, form, field, openForm, span } = setup();
    await openForm();
    await span("2026-07-22", "2026-07-22");
    expect(field("Hours")).toHaveAttribute("placeholder", "7.6");
    await user.type(field("Hours"), "4");
    await user.type(field("Note"), "Dentist");
    await user.click(form().getByRole("button", { name: "Send request" }));

    expect(requestLeave).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-07-22", endDate: "2026-07-22", hours: 4, note: "Dentist" }),
    );
  });

  it("says why the request was refused, and stays open", async () => {
    const { user, form, openForm } = setup();
    await openForm();
    requestLeave.mockResolvedValueOnce({ ok: false, error: "That's 8h more annual leave than you have available." } as never);
    await user.click(form().getByRole("button", { name: "Send request" }));
    expect(form().getByRole("alert")).toHaveTextContent("That's 8h more annual leave than you have available.");
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("the type and the certificate", () => {
  it("asks for a certificate only when this span of personal leave wants one, and sends it with the request", async () => {
    const { user, form, openForm, span } = setup({ certAfterDays: 2 });
    await openForm();
    await span("2026-07-22", "2026-07-24");
    expect(form().queryByText("Medical certificate")).toBeNull();
    await user.click(form().getByRole("radio", { name: "Personal or carer's" }));
    expect(form().getByText("Medical certificate")).toBeInTheDocument();
    const input = screen.getByRole("dialog", { name: "Ask for leave" }).querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File(["x"], "certificate.pdf", { type: "application/pdf" }));
    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "medical_certificate");
    expect(form().getByRole("list", { name: "Medical certificate" })).toHaveTextContent("certificate.pdf");
    expect(form().getByRole("button", { name: "Replace certificate" })).toBeInTheDocument();
    await user.click(form().getByRole("button", { name: "Send request" }));
    expect(requestLeave).toHaveBeenCalledWith(expect.objectContaining({ kind: "personal", certificateDocumentId: "doc-1" }));
  });

  it("never blocks a request on the certificate", async () => {
    const { user, form, openForm, span } = setup({ certAfterDays: 2 });
    await openForm();
    await user.click(form().getByRole("radio", { name: "Personal or carer's" }));
    await span("2026-07-22", "2026-07-24");
    expect(form().getByRole("button", { name: "Send request" })).toBeEnabled();
  });

  it("says nothing about a balance for unpaid leave", async () => {
    const { user, form, openForm } = setup();
    await openForm();
    await user.click(form().getByRole("radio", { name: "Unpaid leave" }));
    expect(meta()).toBe("1 working day.");
  });
});

/* ---- the 2026-07-31 redesign: colour, and buttons that say what they do ---- */

const REQ: LeaveRequest = {
  id: "r1",
  staffId: "s1",
  kind: "annual",
  startDate: "2026-08-10",
  endDate: "2026-08-12",
  hours: 22.8,
  status: "approved",
};

describe("balanceBars", () => {
  it("splits the track into what's left and what's booked", () => {
    expect(balanceBars(100, 75, 25)).toEqual({ avail: 75, booked: 25 });
  });

  it("survives an entitlement of zero rather than dividing by it", () => {
    // an unset balance is 0h — the bar must be empty, not NaN% wide
    expect(balanceBars(0, 0, 0)).toEqual({ avail: 0, booked: 0 });
  });

  it("clamps an over-booked balance instead of overflowing the track", () => {
    // booked more than you had: available goes negative, booked past 100%
    expect(balanceBars(100, -20, 120)).toEqual({ avail: 0, booked: 100 });
  });
});

describe("Ask for leave sits on the card it adds to (rule 52)", () => {
  it("is in the requests card header, not floating in the page header", () => {
    const { container } = setup();
    const head = container.querySelector(".lv-ch.act")!;
    expect(within(head as HTMLElement).getByRole("button", { name: "Ask for leave" })).toBeTruthy();
    // and nothing action-shaped is left stranded in the page heading
    expect(container.querySelector(".v2head button")).toBeNull();
  });

  /* The form opens over the page (rule 51), so the button that opened it
     stays where it was, and Cancel is the one way back. */
  it("opens Ask for leave over the page, and Cancel closes it", async () => {
    const { user, form, openForm } = setup();
    await openForm();
    expect(form().getByRole("heading", { name: "Ask for leave" })).toBeInTheDocument();
    expect(form().getByRole("radiogroup", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Annual leave" })).toHaveAttribute("aria-checked", "true");
    // no native select (rule 34)
    expect(screen.getByRole("dialog", { name: "Ask for leave" }).querySelector("select")).toBeNull();
    await user.click(form().getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Ask for leave" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ask for leave" })).toBeTruthy();
  });
});

describe("cancelling a request", () => {
  it("arms before it fires — one press asks, the next goes through", async () => {
    const { user, container } = setup({ requests: [REQ] });
    const btn = () => container.querySelector<HTMLElement>(".lv-cancel")!;

    await user.click(btn());
    expect(cancelLeave).not.toHaveBeenCalled();
    expect(btn().className).toContain("arm");
    expect(btn().textContent).toContain("Confirm");

    await user.click(btn());
    expect(cancelLeave).toHaveBeenCalledWith("r1");
  });

  it("names the request it would cancel, for anyone not seeing the row", () => {
    setup({ requests: [REQ] });
    // the label names the kind AND the dates — "Cancel" alone tells a screen
    // reader nothing about which of several rows it is sitting on
    expect(
      screen.getByRole("button", { name: /^Cancel Annual leave on 10 Aug.+12 Aug$/ }),
    ).toBeTruthy();
  });
});

describe("leave kinds carry colour without stealing a status hue", () => {
  it("marks the tile and the row with the kind, not the status", () => {
    const { container } = setup({ requests: [REQ] });
    expect(container.querySelector(".lv-baltile.lv-annual")).not.toBeNull();
    expect(container.querySelector(".lv-req.lv-annual")).not.toBeNull();
  });

  it("keeps the status chip as the row's only state signal", () => {
    // the kind is a left bar, the status is the pill — if the kind ever took
    // teal/amber/red the two would collide on one row
    const { container } = setup({ requests: [REQ] });
    const row = container.querySelector(".lv-req")!;
    expect(row.querySelector(".dchip.ok")?.textContent).toBe("Approved");
    expect(row.querySelectorAll(".dchip")).toHaveLength(1);
  });
});
