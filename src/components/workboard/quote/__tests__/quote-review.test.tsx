import { fireEvent, render, screen } from "@testing-library/react";
import type { QuoteReview, ReviewFinding } from "@/lib/quotes/review";
import { QuoteActions } from "../quote-actions";
import { ReviewWalk } from "../quote-review";

/* TIFF'S CHECK BEFORE MARK READY TO SEND (Isaac, 26 November 2026, "Yes,
   build it" to https://claude.ai/artifact/5FtXp1LSQWQGpN4gcsCwwk) */

const f = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  id: "a",
  kind: "mismatch",
  option: 0,
  topic: "Unit cooling figures",
  words: "The unit table says the PUMY-SP140VKMD2-A cools 14 kW. Mitsubishi's data says 15.5 kW.",
  put: "14, 8, 2.5 and 2 kW",
  tab: "proposal",
  block: "units-0",
  lineIds: [],
  answers: [{ label: "Use the maker's figures", fix: "Use them." }],
  state: "open",
  picked: null,
  reason: "",
  ...over,
});
const review = (findings: ReviewFinding[]): QuoteReview => ({ at: "", by: "u", stamp: "s", findings, usd: null });

describe("the finding card", () => {
  it("says what's wrong and what's on the quote, with its fix the main button", () => {
    const onAnswer = jest.fn();
    render(<ReviewWalk review={review([f(), f({ id: "b", kind: "look" })])} at={f()} n={1} of={2} busy={false} onAnswer={onAnswer} />);
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(screen.getByText("Doesn't match")).toBeTruthy();
    expect(screen.getByText("On the quote now: 14, 8, 2.5 and 2 kW")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use the maker's figures" }));
    expect(onAnswer).toHaveBeenCalledWith("a", 0, "");
  });

  it("keeps a Doesn't match only with a reason", () => {
    const onAnswer = jest.fn();
    render(<ReviewWalk review={review([f()])} at={f()} n={1} of={1} busy={false} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep as written" }));
    const keep = screen.getByRole("button", { name: "Keep it" }) as HTMLButtonElement;
    expect(keep.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Why it stays, on the quote"), { target: { value: "Budget estimate" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep with this reason" }));
    expect(onAnswer).toHaveBeenCalledWith("a", "keep", "Budget estimate");
  });

  it("keeps a Worth a look with one press", () => {
    const onAnswer = jest.fn();
    const look = f({ kind: "look" });
    render(<ReviewWalk review={review([look])} at={look} n={1} of={1} busy={false} onAnswer={onAnswer} />);
    expect(screen.getByText("Worth a look")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep as written" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onAnswer).toHaveBeenCalledWith("a", "keep", "");
  });
});

describe("the panel's one button", () => {
  const base = {
    money: true,
    lines: 4,
    busy: false,
    paper: false,
    kept: false,
    variation: null,
    approved: false,
    ready: true,
    why: "",
    send: null,
    acceptable: false,
    update: false,
    options: 1,
    at: 0,
    accepted: false,
    onApprove: jest.fn(),
    onUpdate: jest.fn(),
    onAccept: jest.fn(),
    onCheck: jest.fn(),
    onFix: jest.fn(),
  };

  it("checks first: Mark ready to send runs Tiff's check, and says so while she does", () => {
    const { rerender } = render(<QuoteActions {...base} review={{ step: "check", again: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark ready to send" }));
    expect(base.onCheck).toHaveBeenCalled();
    expect(base.onApprove).not.toHaveBeenCalled();
    rerender(<QuoteActions {...base} review={{ step: "check", again: false }} checking />);
    expect((screen.getByRole("button", { name: "Checking the quote" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<QuoteActions {...base} review={{ step: "check", again: true }} />);
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("sends the fixes to Tiff, then marks it once the check is clear", () => {
    const { rerender } = render(<QuoteActions {...base} review={{ step: "fix", fixes: 2 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Fix 2 with Tiff" }));
    expect(base.onFix).toHaveBeenCalled();
    rerender(<QuoteActions {...base} review={{ step: "clear", kept: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark ready to send" }));
    expect(base.onApprove).toHaveBeenCalled();
  });

  /* Isaac, 27 November 2026, on 3610: "make a way to skip it or say that
     you are happy to proceed" */
  it("goes past the check on your word, at every step of it", () => {
    const onProceed = jest.fn();
    const { rerender } = render(<QuoteActions {...base} review={{ step: "check", again: true }} onProceed={onProceed} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip the check" }));
    rerender(<QuoteActions {...base} review={{ step: "fix", fixes: 1 }} onProceed={onProceed} />);
    fireEvent.click(screen.getByRole("button", { name: "Happy to proceed" }));
    expect(onProceed).toHaveBeenCalledTimes(2);
    rerender(<QuoteActions {...base} review={{ step: "check", again: false }} checking onProceed={onProceed} />);
    expect(screen.queryByRole("button", { name: "Skip the check" })).toBeNull();
    rerender(<ReviewWalk review={review([f()])} at={f()} n={1} of={1} busy={false} onAnswer={jest.fn()} onProceed={onProceed} />);
    fireEvent.click(screen.getByRole("button", { name: "Happy to proceed" }));
    expect(onProceed).toHaveBeenCalledTimes(3);
  });

  it("is the finding's card while there's one to go through", () => {
    render(<QuoteActions {...base} review={{ step: "walk", at: f(), n: 1, of: 1 }} walk={<p>the card</p>} />);
    expect(screen.getByText("the card")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark ready to send" })).toBeNull();
  });
});
