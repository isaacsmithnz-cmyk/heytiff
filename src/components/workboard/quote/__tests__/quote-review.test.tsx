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

  /* advice, not a gate (Isaac, 27 November 2026) */
  it("marks it ready straight away, with Check with Tiff beside it", () => {
    const onApprove = jest.fn();
    const onCheck = jest.fn();
    const { rerender } = render(<QuoteActions {...base} onApprove={onApprove} onCheck={onCheck} review={{ step: "check", again: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark ready to send" }));
    expect(onApprove).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check with Tiff" }));
    expect(onCheck).toHaveBeenCalled();
    rerender(<QuoteActions {...base} review={{ step: "check", again: false }} checking />);
    expect((screen.getByRole("button", { name: "Checking the quote" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<QuoteActions {...base} review={{ step: "check", again: true }} />);
    expect(screen.getByRole("button", { name: "Check with Tiff again" })).toBeTruthy();
  });

  it("offers the fixes to Tiff beside Mark ready to send", () => {
    const onFix = jest.fn();
    const onApprove = jest.fn();
    render(<QuoteActions {...base} onFix={onFix} onApprove={onApprove} review={{ step: "fix", fixes: 2 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Fix 2 with Tiff" }));
    expect(onFix).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mark ready to send" }));
    expect(onApprove).toHaveBeenCalled();
  });

  it("shows the finding's card over Mark ready to send, and Ignore puts it away", () => {
    render(<QuoteActions {...base} review={{ step: "walk", at: f(), n: 1, of: 1 }} walk={<p>the card</p>} />);
    expect(screen.getByText("the card")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark ready to send" })).toBeTruthy();
    const onIgnore = jest.fn();
    render(<ReviewWalk review={review([f()])} at={f()} n={1} of={1} busy={false} onAnswer={jest.fn()} onIgnore={onIgnore} />);
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(onIgnore).toHaveBeenCalled();
  });
});
