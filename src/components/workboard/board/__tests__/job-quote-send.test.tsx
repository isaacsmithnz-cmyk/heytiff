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
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => (plan ? { ok: true, plan, editDate: "2026-10-05 09:00:00", key: "k-1" } : { ok: false, reason: "no" }) }));
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
  const { rerender } = render(<JobQuoteSend job="j-1" visible version="v1" />);
  const button = await screen.findByRole("button", { name: "Trial send to ServiceM8" });
  await act(async () => {
    fireEvent.click(button);
  });
  /* with the plan it was shown, for the server to check against */
  expect(sendQuoteToSm8).toHaveBeenCalledWith("j-1", expect.any(String), "2026-10-05 09:00:00", "k-1");
  const said = "Trial run: every change was checked and logged, and nothing went to ServiceM8.";
  expect(await screen.findByText(said)).toBeInTheDocument();
  /* the quote changed: what the send said was about the version before */
  await act(async () => {
    rerender(<JobQuoteSend job="j-1" visible version="v2" />);
  });
  expect(screen.queryByText(said)).toBeNull();
});

it("can't send while the plan on screen was read for an older version of the quote", async () => {
  quoteSendOffered.mockResolvedValue({ offered: true, trial: false });
  answer({
    ok: true,
    status: { from: "Quote", to: "Work Order" },
    workDone: "Option 1: 3-head multi",
    lines: [{ name: "Option 1: 3-head multi, as per quote", quantity: 1, unitPriceCents: 1_150_000, unitCostCents: 700_000 }],
    remove: [],
    taxRateUuid: "gst",
    exGstCents: 1_150_000,
  });
  const { rerender } = render(<JobQuoteSend job="j-1" visible version="v1" />);
  const button = await screen.findByRole("button", { name: "Send to ServiceM8 as a work order" });
  expect(button).toBeEnabled();
  /* the re-read for v2 never answers */
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() => new Promise(() => undefined));
  rerender(<JobQuoteSend job="j-1" visible version="v2" />);
  expect(screen.getByRole("button", { name: "Send to ServiceM8 as a work order" })).toBeDisabled();
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
