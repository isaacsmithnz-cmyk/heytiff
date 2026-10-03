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
  expect(JSON.parse(post![1]!.body!)).toEqual({ job: "j-1", brief: "Own 6 kW split, parapet wall", replace: false });
});

it("a read that fails offers Try again, never the box that would draft over it", async () => {
  fetchMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
  face();
  await screen.findByText("The saved proposal couldn’t be read.");
  expect(screen.queryByRole("button", { name: "Draft proposal" })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  });
  await screen.findByText("Site checklist");
});

it("saves on the copy it was made from, and an answer leaves an open editor open", async () => {
  face();
  await screen.findByText("Site checklist");
  fireEvent.click(screen.getByRole("button", { name: "Edit Intro" }));
  fireEvent.change(screen.getByDisplayValue(/Here is the scope/), { target: { value: "Hi Jane, half typed" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Colorbond trunking" }));
  });
  const put = (fetchMock.mock.calls as Call[]).find(([, init]) => init?.method === "PUT");
  expect(JSON.parse(put![1]!.body!).base).toBe("2026-09-29T08:00:00Z");
  expect(screen.getByDisplayValue("Hi Jane, half typed")).toBeInTheDocument();
});

it("shows the proposal as it stands when someone else saved first", async () => {
  const onToast = jest.fn();
  face(onToast);
  await screen.findByText("Site checklist");
  const newer = { ...stored(), updatedAt: "2026-09-29T09:00:00Z", draft: normaliseDraft({ ...stored().draft, intro: "Hi Jane,\nNewer words." })! };
  fetchMock.mockImplementationOnce(() => respond({ ok: false, reason: "Someone else changed this proposal", proposal: newer }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Colorbond trunking" }));
  });
  expect(onToast).toHaveBeenCalledWith("Someone else changed this proposal");
  expect(screen.getByText(/Newer words/)).toBeInTheDocument();
});

it("the payment editor opens on the stages the draft holds now", async () => {
  face();
  await screen.findByText("Site checklist");
  const terms = screen.getByRole("radiogroup", { name: "Payment terms" });
  await act(async () => {
    fireEvent.click(within(terms).getByRole("radio", { name: "Home, construction" }));
  });
  fireEvent.click(screen.getByRole("button", { name: "Edit Payment" }));
  expect(screen.getAllByRole("textbox", { name: /^Stage \d+$/ })).toHaveLength(PAYMENT_PRESETS.domestic_construction.stages.length);
});

it("marks an option accepted, the job's equipment for its certificate", async () => {
  face();
  const mark = await screen.findByRole("button", { name: "Mark accepted" });
  expect(mark).toHaveAttribute("aria-pressed", "false");
  await act(async () => {
    fireEvent.click(mark);
  });
  const put = (fetchMock.mock.calls as Call[]).find(([, init]) => init?.method === "PUT");
  expect(JSON.parse(put![1]!.body!).draft.accepted).toEqual([0]);
  expect(await screen.findByRole("button", { name: "Accepted" })).toHaveAttribute("aria-pressed", "true");
});

it("shows a unit with no model as not given yet, and edits the equipment row by row", async () => {
  face();
  await screen.findByText("Living room");
  expect(screen.getByText("Model not given yet")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit Option 1: Install client-supplied 6 kW split" }));
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "msz-ap60vgd" } });
  fireEvent.click(screen.getByRole("button", { name: "Add an outdoor unit" }));
  expect(screen.getAllByLabelText("Unit").map((el) => (el as HTMLSelectElement).value)).toEqual(["indoor", "outdoor"]);
  fireEvent.change(screen.getByLabelText("Where outdoor unit 1 goes"), { target: { value: "Parapet wall" } });
  fireEvent.change(screen.getAllByLabelText("Model")[1], { target: { value: "MUZ-AP60VG" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save option" }));
  });
  const put = (fetchMock.mock.calls as Call[]).find(([, init]) => init?.method === "PUT");
  const units = JSON.parse(put![1]!.body!).draft.options[0].units;
  expect(units.map((u: { role: string; model: string; room: string }) => [u.role, u.model, u.room])).toEqual([
    ["indoor", "msz-ap60vgd", "Living room"],
    ["outdoor", "MUZ-AP60VG", "Parapet wall"],
  ]);
  /* stored with the model in its own case, and the indoor on the outdoor */
  expect(await screen.findByText("6 kW, High wall, MSZ-AP60VGD")).toBeInTheDocument();
});
