import { act, fireEvent, render, screen } from "@testing-library/react";
import { VariationSm8 } from "../variation-sm8";
import type { Variation } from "@/lib/quotes/lines-job";

/* Isaac, 2026-10-18, decision 21: an accepted variation goes to ServiceM8 as
   extra lines on the original job. The rail says what went. */

const variation = (over: Partial<Variation> = {}): Variation => ({
  n: 1,
  option: 1,
  of: 0,
  what: "return grille in Bed 2",
  startedAt: "2026-10-18T01:00:00.000Z",
  startedBy: "auth0|me",
  approvedAt: "2026-10-18T02:00:00.000Z",
  acceptedAt: "2026-10-18T03:00:00.000Z",
  ...over,
});
const SENT = { at: "2026-10-18T03:01:00.000Z", by: "auth0|me", trial: false, jobNumber: "3209", lines: 3, sent: 3, lineUuids: [] };

it("says what went, on which job, and offers nothing more: nothing goes twice", () => {
  render(<VariationSm8 variation={variation({ sm8: SENT })} error={null} onSend={jest.fn()} />);
  expect(screen.getByText("Sent to ServiceM8 as 3 lines on job 3209.")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("offers the send again for an accepted variation that hasn't all gone, with why the last one didn't", async () => {
  const onSend = jest.fn(async () => undefined);
  render(<VariationSm8 variation={variation()} error="Sending accepted quotes to ServiceM8 is switched off." onSend={onSend} />);
  expect(screen.getByText("Sending accepted quotes to ServiceM8 is switched off.")).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send variation 1 to ServiceM8" }));
  });
  expect(onSend).toHaveBeenCalledTimes(1);
});

it("shows nothing for a variation not yet accepted", () => {
  const { container } = render(<VariationSm8 variation={variation({ acceptedAt: null })} error={null} onSend={jest.fn()} />);
  expect(container.textContent).toBe("");
});
