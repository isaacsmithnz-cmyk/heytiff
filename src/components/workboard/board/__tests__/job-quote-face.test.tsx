/* The Quote face: the site checklist stands first and asks one question at
   a time; an answer saves on the spot with no model call; the blocks stand
   in the skeleton's order with no Copy anywhere; the payment terms switch by
   the kind of job; and a job with no draft opens on the box that drafts
   one. */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { normaliseDraft } from "@/lib/quotes/proposal";
import { PAYMENT_PRESETS } from "@/lib/quotes/payment";
import type { StoredProposal } from "@/lib/quotes/proposal-writer";

import { JobQuoteFace } from "../job-quote-face";

const stored = (): StoredProposal => ({
  cardId: "j-1",
  brief: "Client has his own 6 kW ME split",
  changes: [],
  updatedAt: "2026-09-29T08:00:00Z",
  draft: normaliseDraft({
    intro: "Hi Jane,\nHere is the scope.",
    why: "",
    options: [
      {
        name: "Install client-supplied 6 kW split",
        lines: ["Outdoor unit mounted on the parapet wall on brackets."],
        units: [{ room: "Living room", capacity: "6 kW", type: "High wall" }],
      },
    ],
    extras: [{ name: "Wi-Fi adaptor", detail: "Control it from your phone" }],
    notes: ["roof_access"],
    checklist: [
      { key: "outdoor_location", state: "known", answer: "Parapet wall, on brackets" },
      { key: "pipe_covering", state: "ask", answer: "" },
      { key: "drain_to", state: "known", answer: "Downpipe" },
    ],
  })!,
});

type Call = [string, { method?: string; body?: string } | undefined];
let fetchMock: jest.Mock;
const respond = (body: unknown) => Promise.resolve({ json: async () => body });

beforeEach(() => {
  fetchMock = jest.fn((url: string, init?: { method?: string; body?: string }) => {
    if (!init || !init.method) return respond({ ok: true, proposal: stored() });
    if (init.method === "PUT") {
      const { draft } = JSON.parse(init.body!) as { draft: StoredProposal["draft"] };
      return respond({ ok: true, proposal: { ...stored(), draft: normaliseDraft(draft) } });
    }
    return respond({ ok: true, proposal: stored() });
  });
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

const face = (onToast = jest.fn()) =>
  render(<JobQuoteFace job="j-1" address={"12 Smith St\nMosman NSW 2088"} visible onToast={onToast} />);

it("stands the checklist first and the blocks in the skeleton's order, with nothing to copy", async () => {
  const { container } = face();
  await screen.findByText("Site checklist");
  const heads = [...container.querySelectorAll(".wb2-jcdhead b")].map((b) => b.textContent);
  expect(heads).toEqual([
    "Site checklist",
    "Proposal",
    "Intro",
    "Option 1: Install client-supplied 6 kW split",
    "Pricing",
    "Payment",
    "Notes for this job",
    "Change the proposal",
  ]);
  expect(screen.getByText("Air Conditioning Scope – 12 Smith St, Mosman")).toBeInTheDocument();
  expect(screen.getByText("2 known, 1 to ask")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  expect(screen.getByText("Living room")).toBeInTheDocument();
  expect(screen.getByText("Wi-Fi adaptor")).toBeInTheDocument();
});

it("asks the first open question with its usual answers, and saves an answer with no model call", async () => {
  face();
  const asked = await screen.findAllByText("What covers the pipes where they're seen?");
  expect(asked[0]).toHaveClass("wb2-jqask");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Colorbond trunking" }));
  });
  const put = (fetchMock.mock.calls as Call[]).find(([, init]) => init?.method === "PUT");
  expect(put).toBeTruthy();
  const sent = JSON.parse(put![1]!.body!) as { draft: StoredProposal["draft"] };
  expect(sent.draft.checklist.find((i) => i.key === "pipe_covering")).toEqual({
    key: "pipe_covering",
    state: "known",
    answer: "Colorbond trunking",
    fresh: true,
  });
  expect((fetchMock.mock.calls as Call[]).some(([, init]) => init?.method === "POST")).toBe(false);
  await screen.findByText("1 answer isn't in the proposal yet");
  expect(screen.getByRole("button", { name: "Put them in" })).toBeInTheDocument();
});

it("switches the payment terms by the kind of job", async () => {
  face();
  await screen.findByText("Site checklist");
  const terms = screen.getByRole("radiogroup", { name: "Payment terms" });
  expect(within(terms).getByRole("radio", { name: "Home, small job" })).toHaveAttribute("aria-checked", "true");
  await act(async () => {
    fireEvent.click(within(terms).getByRole("radio", { name: "Home, construction" }));
  });
  const put = (fetchMock.mock.calls as Call[]).find(([, init]) => init?.method === "PUT");
  const sent = JSON.parse(put![1]!.body!) as { draft: StoredProposal["draft"] };
  expect(sent.draft.payment).toEqual({ preset: "domestic_construction", stages: PAYMENT_PRESETS.domestic_construction.stages });
});

it("opens on the box that drafts one when the job has none, and drafts from it", async () => {
  fetchMock.mockImplementationOnce(() => respond({ ok: true, proposal: null }));
  face();
  await screen.findByText("Draft the proposal");
  const draft = screen.getByRole("button", { name: "Draft proposal" });
  expect(draft).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Own 6 kW split, parapet wall" } });
  await act(async () => {
    fireEvent.click(draft);
  });
  await waitFor(() => expect(screen.getByText("Site checklist")).toBeInTheDocument());
  const post = (fetchMock.mock.calls as Call[]).find(([, init]) => init?.method === "POST");
  expect(JSON.parse(post![1]!.body!)).toEqual({ job: "j-1", brief: "Own 6 kW split, parapet wall" });
});
