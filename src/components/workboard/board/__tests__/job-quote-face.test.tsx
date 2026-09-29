/* The Quote face: the blocks stand in the Proposal's order, each Copy puts
   that block's own text on the clipboard, a question's Answer goes into the
   change box, and a job with no draft opens on the box that drafts one. */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StoredProposal } from "@/lib/quotes/proposal-writer";

const readQuoteDraft = jest.fn();
const saveQuoteDraft = jest.fn();
jest.mock("@/app/actions/quote-draft", () => ({
  readQuoteDraft: (...a: unknown[]) => readQuoteDraft(...(a as [])),
  saveQuoteDraft: (...a: unknown[]) => saveQuoteDraft(...(a as [])),
}));

import { JobQuoteFace } from "../job-quote-face";

const stored = (): StoredProposal => ({
  cardId: "j-1",
  brief: "Client has his own 6 kW ME split",
  changes: [],
  updatedAt: "2026-09-29T08:00:00Z",
  draft: {
    intro: "Hi Jane,\nHere is the scope.",
    options: [
      {
        name: "Install client-supplied 6 kW split",
        lines: ["Outdoor unit mounted on the parapet wall on brackets.", "Drain run straight outside into the downpipe."],
        pros: [],
        cons: [],
      },
    ],
    pricingMode: "multiple_choice",
    notes: ["roof_access"],
    questions: ["Which model is it?"],
  },
});

const writeText = jest.fn(async () => undefined);
beforeAll(() => {
  Object.assign(navigator, { clipboard: { writeText } });
});
beforeEach(() => jest.clearAllMocks());

const face = (onToast = jest.fn()) =>
  render(<JobQuoteFace job="j-1" address={"12 Smith St\nMosman NSW 2088"} visible onToast={onToast} />);

it("stands the blocks in the Proposal's order under what is still to find out", async () => {
  readQuoteDraft.mockResolvedValueOnce(stored());
  const { container } = face();
  await screen.findByText("Still to find out");
  const heads = [...container.querySelectorAll(".wb2-jcdhead b")].map((b) => b.textContent);
  expect(heads).toEqual([
    "Still to find out",
    "Proposal",
    "Title",
    "Intro",
    "Option 1: Install client-supplied 6 kW split",
    "Pricing",
    "Notes for this job",
    "Change the proposal",
  ]);
  expect(screen.getByText("Air Conditioning Scope – 12 Smith St, Mosman")).toBeInTheDocument();
});

it("copies a block's own text, in the Proposals' shape", async () => {
  readQuoteDraft.mockResolvedValueOnce(stored());
  const onToast = jest.fn();
  face(onToast);
  await screen.findByText("Still to find out");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy Option 1: Install client-supplied 6 kW split" }));
  });
  expect(writeText).toHaveBeenCalledWith(
    "- Outdoor unit mounted on the parapet wall on brackets.\n- Drain run straight outside into the downpipe."
  );
  expect(onToast).toHaveBeenCalledWith("Option 1: Install client-supplied 6 kW split copied");
});

it("puts a question into the change box to be answered", async () => {
  readQuoteDraft.mockResolvedValueOnce(stored());
  face();
  await screen.findByText("Still to find out");
  fireEvent.click(screen.getByRole("button", { name: "Answer: Which model is it?" }));
  expect(screen.getByDisplayValue(/Which model is it\?/)).toBeInTheDocument();
});

it("opens on the box that drafts one when the job has none, and drafts from it", async () => {
  readQuoteDraft.mockResolvedValueOnce(null);
  const fetchMock = jest.fn(async () => ({ json: async () => ({ ok: true, proposal: stored() }) }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  face();
  await screen.findByText("Draft the proposal");
  const draft = screen.getByRole("button", { name: "Draft proposal" });
  expect(draft).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Own 6 kW split, parapet wall" } });
  await act(async () => {
    fireEvent.click(draft);
  });
  await waitFor(() => expect(screen.getByText("Still to find out")).toBeInTheDocument());
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
  expect(JSON.parse(init.body)).toEqual({ job: "j-1", brief: "Own 6 kW split, parapet wall" });
});
