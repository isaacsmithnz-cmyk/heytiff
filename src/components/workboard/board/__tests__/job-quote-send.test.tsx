import { act, fireEvent, render, screen } from "@testing-library/react";

const quoteSendOffered = jest.fn(async () => ({ offered: false, trial: false }));
const sendQuoteToSm8 = jest.fn();
jest.mock("@/app/actions/quote-sm8", () => ({
  quoteSendOffered: () => quoteSendOffered(),
  sendQuoteToSm8: (...a: unknown[]) => sendQuoteToSm8(...a),
}));

import { JobQuoteSend } from "../job-quote-send";
import type { SendPlan } from "@/lib/quotes/sm8-send-plan";

/* Isaac, 2026-10-05: "copy the scope and line items to service mate" — shown
   before anything is sent */
const answer = (plan: SendPlan | null) => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => (plan ? { ok: true, plan, editDate: "2026-10-05 09:00:00" } : { ok: false, reason: "no" }) }));
};

it("shows exactly what one press would send: the work order, its description, its lines and what comes off", async () => {
  answer({
    ok: true,
    status: { from: "Quote", to: "Work Order" },
    workDone: "Option 1: 3-head multi\n- Three high walls",
    lines: [{ name: "Option 1: 3-head multi, as per quote", quantity: 1, unitPriceCents: 1_150_000, unitCostCents: 700_000 }],
    remove: [{ uuid: "m-1", name: "As Per Quote" }],
    taxRateUuid: "gst",
    exGstCents: 1_150_000,
  });
  render(<JobQuoteSend job="j-1" visible />);
  expect(await screen.findByText("Becomes a Work Order")).toBeInTheDocument();
  expect(screen.getByText("Option 1: 3-head multi, as per quote")).toBeInTheDocument();
  expect(screen.getByText("1 × $11,500")).toBeInTheDocument();
  expect(screen.getByText("Comes off the job: As Per Quote")).toBeInTheDocument();
});

it("says why it can't go, and shows nothing until an option is accepted", async () => {
  answer({ ok: false, why: "The accepted option has 2 still to price: ServiceM8 must get the whole quote." });
  const { unmount } = render(<JobQuoteSend job="j-1" visible />);
  expect(await screen.findByText("The accepted option has 2 still to price: ServiceM8 must get the whole quote.")).toBeInTheDocument();
  unmount();
  answer({ ok: false, why: "No option is marked accepted." });
  const { container } = render(<JobQuoteSend job="j-1" visible />);
  await new Promise((r) => setTimeout(r, 0));
  expect(container).toBeEmptyDOMElement();
});

it("offers the send where the owner has it on, with the edit date it was reviewed at, and says a trial run sent nothing", async () => {
  quoteSendOffered.mockResolvedValue({ offered: true, trial: true });
  sendQuoteToSm8.mockResolvedValue({ ok: true, trial: true, sent: 0, waiting: 0, failed: [] });
  answer({
    ok: true,
    status: { from: "Quote", to: "Work Order" },
    workDone: "Option 1: 3-head multi\n- Three high walls",
    lines: [{ name: "Option 1: 3-head multi, as per quote", quantity: 1, unitPriceCents: 1_150_000, unitCostCents: 700_000 }],
    remove: [{ uuid: "m-1", name: "As Per Quote" }],
    taxRateUuid: "gst",
    exGstCents: 1_150_000,
  });
  render(<JobQuoteSend job="j-1" visible />);
  const button = await screen.findByRole("button", { name: "Trial send to ServiceM8" });
  await act(async () => {
    fireEvent.click(button);
  });
  expect(sendQuoteToSm8).toHaveBeenCalledWith("j-1", expect.any(String), "2026-10-05 09:00:00");
  expect(await screen.findByText("Trial run: every change was checked and logged, and nothing went to ServiceM8.")).toBeInTheDocument();
});

it("offers no send where the owner hasn't switched it on", async () => {
  quoteSendOffered.mockResolvedValue({ offered: false, trial: false });
  answer({
    ok: true,
    status: { from: "Quote", to: "Work Order" },
    workDone: "Option 1: 3-head multi\n- Three high walls",
    lines: [{ name: "Option 1: 3-head multi, as per quote", quantity: 1, unitPriceCents: 1_150_000, unitCostCents: 700_000 }],
    remove: [{ uuid: "m-1", name: "As Per Quote" }],
    taxRateUuid: "gst",
    exGstCents: 1_150_000,
  });
  render(<JobQuoteSend job="j-1" visible />);
  expect(await screen.findByText("Becomes a Work Order")).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
});
