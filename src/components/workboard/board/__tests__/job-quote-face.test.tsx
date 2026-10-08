/* The Quote face: on the quote page, Home's frame (Isaac, 2026-10-06, the
   mock-up he called "much cleaner"): the progress line and its next step,
   Build-up reading down the page (what Tiff read, the questions one at a
   time, what's in it, the labour, the change box) and the proposal on its
   own tab, with the list on the right. An answer saves on the spot with no
   model call; the blocks stand in the skeleton's order with no Copy
   anywhere; the payment terms switch by the kind of job; and a job with no
   draft opens on the box that drafts one. */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { normaliseDraft } from "@/lib/quotes/proposal";
import { PAYMENT_PRESETS } from "@/lib/quotes/payment";
import type { StoredProposal } from "@/lib/quotes/proposal-writer";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";

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

/** The quote page's builder, open from the start. */
const face = (onToast = jest.fn(), price?: QuotePrice | null) =>
  render(<JobQuoteFace mode="page" job="j-1" address={"12 Smith St\nMosman NSW 2088"} visible onToast={onToast} price={price} />);
const openFace = async (onToast = jest.fn(), price?: QuotePrice | null) => face(onToast, price);
/** The proposal, as the client reads it, is its own tab. */
const toProposal = () => fireEvent.click(screen.getByRole("tab", { name: "Proposal" }));

it("reads down the page, then stands the blocks in the skeleton's order on the Proposal tab, with nothing to copy", async () => {
  const { container } = await openFace();
  await screen.findByText("What Tiff read");
  const build = screen.getByRole("tabpanel", { name: "Build-up" });
  expect([...build.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["What Tiff read", "Questions 1", "Labour", "Change the proposal"]);
  /* what Tiff took from the brief, each with its Change; the open one is a question */
  expect(within(build).getByText("Parapet wall, on brackets")).toBeInTheDocument();
  expect(within(build).getByRole("button", { name: "Change Where and how" })).toBeInTheDocument();
  toProposal();
  const paper = screen.getByRole("tabpanel", { name: "Proposal" });
  expect([...paper.querySelectorAll(".wb2-jcdhead b")].map((b) => b.textContent)).toEqual([
    "Proposal",
    "Intro",
    "Option 1: Install client-supplied 6 kW split",
    "Pricing",
    "Payment",
    "Notes for this job",
  ]);
  expect(within(paper).getByText("Air Conditioning Scope – 12 Smith St, Mosman")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  expect(within(paper).getByText("Living room")).toBeInTheDocument();
  expect(within(paper).getByText("Wi-Fi adaptor")).toBeInTheDocument();
  /* the list on the right: what's open, then what's known */
  const list = container.querySelector(".qp-rail") as HTMLElement;
  expect(within(list).getByText("To answer")).toBeInTheDocument();
  expect(within(list).getByText("Known")).toBeInTheDocument();
});

/* Isaac, 2026-10-05: "it should have opened up the proper quote screen not a
   section below" — the card's face is the way into the page, never the builder */
it("shows a draft on the card as Continue quote, a link to the quote page, with what's left to ask", async () => {
  render(
    <JobQuoteFace job="j-1" address={null} visible onToast={jest.fn()}>
      <p>Price block</p>
    </JobQuoteFace>
  );
  const link = await screen.findByRole("link", { name: "Continue quote" });
  expect(link).toHaveAttribute("href", "/dashboard/workboard/quotes/j-1");
  expect(screen.getByText(/Drafted .*, 1 to ask/)).toBeInTheDocument();
  expect(screen.queryByText("What Tiff read")).toBeNull();
  expect(screen.queryByText("Price block")).toBeNull();
});

it("opens the page's builder at once, with its own sections and the quote's version", async () => {
  const onVersion = jest.fn();
  render(
    <JobQuoteFace mode="page" job="j-1" address={null} visible onToast={jest.fn()} onVersion={onVersion}>
      <p>Labour block</p>
    </JobQuoteFace>
  );
  expect(await screen.findByText("What Tiff read")).toBeInTheDocument();
  expect(screen.getByText("Labour block")).toBeInTheDocument();
  expect(onVersion).toHaveBeenLastCalledWith("2026-09-29T08:00:00Z");
});

it("asks the first open question with its usual answers, and saves an answer with no model call", async () => {
  await openFace();
  const asked = await screen.findAllByText("What covers the pipes where they're seen?");
  expect(asked[0]).toHaveClass("wb2-jqask");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Colorbond trunking" }));
  });
  const put = (fetchMock.mock.calls as Call[]).find(([, init]) => init?.method === "PUT");
  expect(put).toBeTruthy();
  const sent = JSON.parse(put![1]!.body!) as { draft: StoredProposal["draft"] };
  expect(sent.draft.checklist.find((i) => i.key === "pipe_covering")).toMatchObject({
    key: "pipe_covering",
    state: "known",
    answer: "Colorbond trunking",
    fresh: true,
  });
  expect((fetchMock.mock.calls as Call[]).some(([, init]) => init?.method === "POST")).toBe(false);
});

/* Isaac, 2026-10-06: "Put them in shouldn't be a button. It's supposed to
   dynamically add in the costs" — an answer moves the price as it's saved,
   and Tiff writes it into the scope by itself at the next pause */
describe("the answers go in by themselves", () => {
  const posts = () => (fetchMock.mock.calls as Call[]).filter(([, init]) => init?.method === "POST");
  const twoAsks = () => {
    const asked = stored();
    asked.draft.checklist = [
      { key: "pipe_covering", state: "ask", answer: "", question: "What covers the pipes on the rear wall?", choices: ["Colorbond trunking"], rank: 1 },
      { key: "drain_to", state: "ask", answer: "", question: "Where does the drain go?", choices: ["Downpipe"], rank: 2 },
    ];
    return asked;
  };
  const answering = (proposal: StoredProposal, post: () => Promise<unknown> = () => respond({ ok: true, proposal: stored() })) =>
    fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") {
        const { draft } = JSON.parse(init.body!) as { draft: StoredProposal["draft"] };
        return respond({ ok: true, proposal: { ...proposal, draft: normaliseDraft(draft) } });
      }
      if (init?.method === "POST") return post();
      return respond({ ok: true, proposal });
    });

  it("with nothing left to ask, puts them in at once, with no button", async () => {
    await openFace();
    await screen.findByText("What Tiff read");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Colorbond trunking" }));
    });
    expect(screen.queryByRole("button", { name: "Put them in" })).toBeNull();
    await waitFor(() => expect(posts()).toHaveLength(1), { timeout: 3000 });
    expect(JSON.parse(posts()[0]![1]!.body!)).toEqual({ job: "j-1", apply: true });
  });

  it("waits for a pause while questions are still being answered, and answering goes on while Tiff writes", async () => {
    answering(twoAsks(), () => new Promise(() => undefined));
    const { container } = face();
    await screen.findByText("What Tiff read");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Colorbond trunking" }));
    });
    /* on to the drain: still answering, so nothing is written yet */
    expect(document.querySelector(".wb2-jqask")).toHaveTextContent("Where does the drain go?");
    await act(() => new Promise((r) => setTimeout(r, 1500)));
    expect(posts()).toHaveLength(0);
    /* stepping away from the questions is the pause */
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(posts()).toHaveLength(1), { timeout: 3000 });
    expect(await screen.findByText("Putting the answers in")).toBeInTheDocument();
    fireEvent.click(within(container.querySelector(".qp-rail") as HTMLElement).getByRole("button", { name: "Answer Where to" }));
    expect(screen.getByRole("button", { name: "Downpipe" })).toBeEnabled();
  });

  it("makes an answer again on the copy that moved on while it was saved", async () => {
    const moved = { ...stored(), updatedAt: "2026-09-29T09:00:00Z" };
    let first = true;
    fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT" && first) {
        first = false;
        return respond({ ok: false, reason: "Someone else changed this proposal while you were working.", proposal: moved });
      }
      if (init?.method === "PUT") {
        const { draft } = JSON.parse(init.body!) as { draft: StoredProposal["draft"] };
        return respond({ ok: true, proposal: { ...moved, draft: normaliseDraft(draft) } });
      }
      return respond({ ok: true, proposal: stored() });
    });
    const onToast = jest.fn();
    await openFace(onToast);
    await screen.findByText("What Tiff read");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Colorbond trunking" }));
    });
    const puts = (fetchMock.mock.calls as Call[]).filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(2);
    const again = JSON.parse(puts[1]![1]!.body!) as { base: string; draft: StoredProposal["draft"] };
    expect(again.base).toBe("2026-09-29T09:00:00Z");
    expect(again.draft.checklist.find((i) => i.key === "pipe_covering")).toMatchObject({ answer: "Colorbond trunking", fresh: true });
    expect(onToast).not.toHaveBeenCalled();
  });

  it("says when they couldn't be put in, tries no more by itself, and tries again when asked", async () => {
    answering(stored(), () => respond({ ok: false, reason: "Tiff is busy. Try again in a minute." }));
    await openFace();
    await screen.findByText("What Tiff read");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Colorbond trunking" }));
    });
    expect(await screen.findByText("The answers aren't in the proposal yet. Tiff is busy. Try again in a minute.", {}, { timeout: 3000 })).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 1500)));
    expect(posts()).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(posts()).toHaveLength(2);
  });
});

/* Isaac's 2905, 2026-10-05: "questions are very vague, hard to understand" */
it("asks Tiff's own question for this job with its answers, the biggest first, and takes Doesn't apply", async () => {
  const asked = stored();
  asked.draft.checklist = [
    { key: "pipe_covering", state: "ask", answer: "", question: "What covers the pipes on the rear wall?", choices: ["Colorbond trunking", "Smart duct"], rank: 2 },
    { key: "pipe_route", state: "ask", answer: "", question: "How do the pipes get from the garage up to Level 3?", choices: ["Riser cupboard", "Inside the walls"], rank: 1 },
  ];
  fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      const { draft } = JSON.parse(init.body!) as { draft: StoredProposal["draft"] };
      return respond({ ok: true, proposal: { ...asked, draft: normaliseDraft(draft) } });
    }
    return respond({ ok: true, proposal: asked });
  });
  await openFace();
  /* rank 1 first, in its own words, with its own answers */
  const first = await screen.findAllByText("How do the pipes get from the garage up to Level 3?");
  expect(first[0]).toHaveClass("wb2-jqask");
  expect(screen.getByRole("button", { name: "Riser cupboard" })).toBeInTheDocument();
  /* typing an answer starts empty */
  fireEvent.click(screen.getByRole("button", { name: "Something else" }));
  expect((screen.getByRole("textbox", { name: "Route" }) as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Doesn’t apply" }));
  });
  const put = (fetchMock.mock.calls as Call[]).filter(([, init]) => init?.method === "PUT").at(-1)!;
  const sent = JSON.parse(put[1]!.body!) as { draft: StoredProposal["draft"] };
  /* settled, it keeps the question it was asked with, for its Change */
  expect(sent.draft.checklist.find((i) => i.key === "pipe_route")).toEqual({
    key: "pipe_route",
    state: "na",
    answer: "Not needed on this job",
    question: "How do the pipes get from the garage up to Level 3?",
    choices: ["Riser cupboard", "Inside the walls"],
  });
});

it("switches the payment terms by the kind of job", async () => {
  await openFace();
  await screen.findByText("What Tiff read");
  toProposal();
  const terms = screen.getByRole("radiogroup", { name: "Payment terms" });
  expect(within(terms).getByRole("radio", { name: "Home, small job" })).toHaveAttribute("aria-checked", "true");
  await act(async () => {
    fireEvent.click(within(terms).getByRole("radio", { name: "Home, construction" }));
  });
  const put = (fetchMock.mock.calls as Call[]).find(([, init]) => init?.method === "PUT");
  const sent = JSON.parse(put![1]!.body!) as { draft: StoredProposal["draft"] };
  expect(sent.draft.payment).toEqual({ preset: "domestic_construction", stages: PAYMENT_PRESETS.domestic_construction.stages });
});

it("opens the page on the box that drafts one when the job has none, and drafts from it", async () => {
  fetchMock.mockImplementationOnce(() => respond({ ok: true, proposal: null }));
  face();
  expect(await screen.findByText("Create a quote")).toBeInTheDocument();
  const draft = screen.getByRole("button", { name: "Draft proposal" });
  expect(draft).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Own 6 kW split, parapet wall" } });
  await act(async () => {
    fireEvent.click(draft);
  });
  await waitFor(() => expect(screen.getByText("What Tiff read")).toBeInTheDocument());
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
  await screen.findByText("What Tiff read");
});

it("saves on the copy it was made from, and an answer leaves an open editor open", async () => {
  await openFace();
  await screen.findByText("What Tiff read");
  toProposal();
  fireEvent.click(screen.getByRole("button", { name: "Edit Intro" }));
  fireEvent.change(screen.getByDisplayValue(/Here is the scope/), { target: { value: "Hi Jane, half typed" } });
  fireEvent.click(screen.getByRole("tab", { name: "Build-up" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Colorbond trunking" }));
  });
  const put = (fetchMock.mock.calls as Call[]).find(([, init]) => init?.method === "PUT");
  expect(JSON.parse(put![1]!.body!).base).toBe("2026-09-29T08:00:00Z");
  expect(screen.getByDisplayValue("Hi Jane, half typed")).toBeInTheDocument();
});

it("shows the proposal as it stands when someone else saved first", async () => {
  const onToast = jest.fn();
  await openFace(onToast);
  await screen.findByText("What Tiff read");
  const newer = { ...stored(), updatedAt: "2026-09-29T09:00:00Z", draft: normaliseDraft({ ...stored().draft, intro: "Hi Jane,\nNewer words." })! };
  fetchMock.mockImplementationOnce(() => respond({ ok: false, reason: "Someone else changed this proposal", proposal: newer }));
  /* an edit of a person's own, not an answer: an answer is made again on the newer copy */
  toProposal();
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Payment terms" })).getByRole("radio", { name: "Home, construction" }));
  });
  expect(onToast).toHaveBeenCalledWith("Someone else changed this proposal");
  expect(screen.getByText(/Newer words/)).toBeInTheDocument();
});

it("the payment editor opens on the stages the draft holds now", async () => {
  await openFace();
  await screen.findByText("What Tiff read");
  toProposal();
  const terms = screen.getByRole("radiogroup", { name: "Payment terms" });
  await act(async () => {
    fireEvent.click(within(terms).getByRole("radio", { name: "Home, construction" }));
  });
  fireEvent.click(screen.getByRole("button", { name: "Edit Payment" }));
  expect(screen.getAllByRole("textbox", { name: /^Stage \d+$/ })).toHaveLength(PAYMENT_PRESETS.domestic_construction.stages.length);
});

it("marks an option accepted, the job's equipment for its certificate", async () => {
  await openFace();
  await screen.findByText("What Tiff read");
  toProposal();
  const mark = screen.getByRole("button", { name: "Mark accepted" });
  expect(mark).toHaveAttribute("aria-pressed", "false");
  await act(async () => {
    fireEvent.click(mark);
  });
  const put = (fetchMock.mock.calls as Call[]).find(([, init]) => init?.method === "PUT");
  expect(JSON.parse(put![1]!.body!).draft.accepted).toEqual([0]);
  expect(await screen.findByRole("button", { name: "Accepted" })).toHaveAttribute("aria-pressed", "true");
});

it("shows a unit with no model as not given yet, and edits the equipment row by row", async () => {
  await openFace();
  await screen.findByText("Living room");
  toProposal();
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

/* Isaac, 2026-10-03: "if a quote has been generated in sm8 it should show
   on our quote page" — #3386 opened on an empty "Draft the proposal" */
describe("a quote ServiceM8 generated", () => {
  const paper = {
    remoteId: "att-q",
    name: "Diamond Air Solutions Pty LTD Quote #3386",
    fileType: ".pdf",
    kind: "document" as const,
    origin: "Quote",
    takenAt: "2026-10-01 14:25:35",
    url: "https://files.example/q.pdf",
    width: null,
    height: null,
    fromClaim: null,
  };
  const sm8 = { papers: [paper], sentOn: "2026-10-01", value: "$45,430 inc GST" };

  beforeEach(() => {
    fetchMock.mockImplementation(() => respond({ ok: true, proposal: null }));
  });

  it("shows ServiceM8's quote on the card, its PDF opening there, with Update ServiceM8 quote into the page", async () => {
    const onOpenPaper = jest.fn();
    render(<JobQuoteFace job="j-1" address={null} visible onToast={jest.fn()} sm8={sm8} onOpenPaper={onOpenPaper} />);
    expect(await screen.findByText("Quote from ServiceM8")).toBeInTheDocument();
    expect(screen.getByText("Sent Thu 1 Oct, $45,430 inc GST")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Diamond Air Solutions Pty LTD Quote #3386/ }));
    expect(onOpenPaper).toHaveBeenCalledWith(paper);
    expect(screen.getByRole("link", { name: "Update ServiceM8 quote" })).toHaveAttribute("href", "/dashboard/workboard/quotes/j-1");
  });

  it("opens the page on the box that drafts one, from what ServiceM8's quote says; Cancel goes back", async () => {
    fetchMock.mockImplementation(() =>
      respond({ ok: true, proposal: null, sm8Brief: "As quoted in ServiceM8:\n1 x MXZ-5F100 outdoor\n\nIts line items:\n- Condensate pump" })
    );
    const onCancel = jest.fn();
    render(<JobQuoteFace mode="page" job="j-1" address={null} visible onToast={jest.fn()} sm8={sm8} onCancel={onCancel} />);
    expect(await screen.findByText("Update ServiceM8 quote")).toBeInTheDocument();
    /* ServiceM8's quote heads the list on the right, beside the box */
    expect(within(screen.getByRole("complementary")).getByText("Quote from ServiceM8")).toBeInTheDocument();
    /* filled once the draft read says there's no draft */
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
        "As quoted in ServiceM8:\n1 x MXZ-5F100 outdoor\n\nIts line items:\n- Condensate pump"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("fills the box from ServiceM8's quote when the quote's PDF lands after the draft read, never over words typed", async () => {
    const BRIEF = "As quoted in ServiceM8:\n1 x MXZ-5F100 outdoor";
    fetchMock.mockImplementation(() => respond({ ok: true, proposal: null, sm8Brief: BRIEF }));
    const none = { papers: [], sentOn: null, value: null };
    const { rerender } = render(<JobQuoteFace mode="page" job="j-1" address={null} visible onToast={jest.fn()} sm8={none} />);
    expect(await screen.findByText("Create a quote")).toBeInTheDocument();
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("");
    rerender(<JobQuoteFace mode="page" job="j-1" address={null} visible onToast={jest.fn()} sm8={sm8} />);
    expect(await screen.findByText("Update ServiceM8 quote")).toBeInTheDocument();
    await waitFor(() => expect(box.value).toBe(BRIEF));

  });

  it("keeps words typed before ServiceM8's quote is known", async () => {
    fetchMock.mockImplementation(() => respond({ ok: true, proposal: null, sm8Brief: "As quoted in ServiceM8:\n1 x MXZ-5F100 outdoor" }));
    const none = { papers: [], sentOn: null, value: null };
    const { rerender } = render(<JobQuoteFace mode="page" job="j-1" address={null} visible onToast={jest.fn()} sm8={none} />);
    expect(await screen.findByText("Create a quote")).toBeInTheDocument();
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Ducted for the whole house" } });
    rerender(<JobQuoteFace mode="page" job="j-1" address={null} visible onToast={jest.fn()} sm8={sm8} />);
    expect(await screen.findByText("Update ServiceM8 quote")).toBeInTheDocument();
    expect(box.value).toBe("Ducted for the whole house");
  });

  /* the engine rebuild: a quote built by hand on its kept lines */
  it("a quote built by hand shows on the card as Continue quote, with how many lines it holds", async () => {
    fetchMock.mockImplementation(() => respond({ ok: true, proposal: null, byHand: { lines: 12 } }));
    render(<JobQuoteFace job="j-1" address={null} visible onToast={jest.fn()} sm8={{ papers: [], sentOn: null, value: null }} />);
    expect(await screen.findByRole("link", { name: "Continue quote" })).toBeInTheDocument();
    expect(screen.getByText("Built by hand, 12 lines")).toBeInTheDocument();
  });

  it("a quote brought across shows its lines, not the proposal underneath, with the option accepted", async () => {
    const proposal = { cardId: "j-1", draft: normaliseDraft({ options: [{ name: "Old", lines: ["A split."] }] }), brief: "", changes: [], updatedAt: "2026-10-01T00:00:00Z" };
    fetchMock.mockImplementation(() => respond({ ok: true, proposal, byHand: { lines: 3, accepted: [1] } }));
    render(<JobQuoteFace job="j-1" address={null} visible onToast={jest.fn()} sm8={{ papers: [], sentOn: null, value: null }} />);
    expect(await screen.findByText("Built by hand, 3 lines, Option 2 accepted")).toBeInTheDocument();
    expect(screen.queryByText(/^Drafted/)).toBeNull();
  });

  it("a job ServiceM8 never quoted shows Create a quote on the card", async () => {
    render(<JobQuoteFace job="j-1" address={null} visible onToast={jest.fn()} sm8={{ papers: [], sentOn: null, value: null }} />);
    expect(await screen.findByRole("link", { name: "Create a quote" })).toBeInTheDocument();
    expect(screen.queryByText("Quote from ServiceM8")).toBeNull();
  });
});

/* Isaac, 2026-10-05: "the customer should be able to see the total for each
   option… you should not have to manually enter it in" */
const pricedAs = (options: { cents: number; labour: number; unpriced: { name: string; qty: string; why: string }[] }[]): QuotePrice =>
  ({
    ok: true,
    options: options.map((o, i) => ({
      name: `Option ${i + 1}`,
      build: { exGstCents: o.cents, incGstCents: Math.round(o.cents * 1.1), gstCents: Math.round(o.cents * 0.1), buyCents: 0, groups: [], contingency: null, labour: { sellCents: o.labour, personDays: 2, hours: 0, visits: [] } },
      unpriced: o.unpriced,
      rows: 3,
      labourFrom: "brief",
    })),
  }) as unknown as QuotePrice;

it("shows each option's total from its Price block, ex and inc GST, with nothing typed", async () => {
  await openFace(jest.fn(), pricedAs([{ cents: 812_500, labour: 224_000, unpriced: [] }]));
  await screen.findByText("What Tiff read");
  toProposal();
  const paper = screen.getByRole("tabpanel", { name: "Proposal" });
  expect(within(paper).getByText("$8,125 + GST")).toBeInTheDocument();
  expect(within(paper).getByText("$8,937.50 inc GST")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit Pricing" }));
  expect(screen.queryByRole("button", { name: "Take the priced total" })).toBeNull();
  expect(screen.queryByLabelText(/price, dollars ex GST/)).toBeNull();
});

it("never shows a total so far as an option's price", async () => {
  await openFace(jest.fn(), pricedAs([{ cents: 6_572, labour: 0, unpriced: [{ name: "Drain socket", qty: "1", why: "Not in your price book" }] }]));
  await screen.findByText("What Tiff read");
  toProposal();
  const paper = screen.getByRole("tabpanel", { name: "Proposal" });
  expect(within(paper).getByText("2 still to price")).toBeInTheDocument();
  expect(screen.queryByText("$65.72 + GST")).toBeNull();
});

/* Isaac, 2026-10-05: "it can just show you a comparison of what was already
   quoted versus the new quote" */
it("stands each option's total beside what ServiceM8 quoted, on ServiceM8's basis", async () => {
  render(
    <JobQuoteFace
      mode="page"
      job="j-1"
      address={null}
      visible
      onToast={jest.fn()}
      price={pricedAs([{ cents: 1_200_000, labour: 224_000, unpriced: [] }])}
      sm8={{ papers: [], sentOn: "2026-09-22", value: "$12,650 inc GST", quoted: { cents: 1_265_000, basis: "inc" } }}
    />
  );
  /* $12,000 ex is $13,200 inc: $550 more than the $12,650 inc quoted */
  expect(await screen.findByText("ServiceM8 quoted $12,650 inc GST: $550 more")).toBeInTheDocument();
});

it("says what the customer sees, the business's default until the quote says otherwise", async () => {
  const route = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) =>
    !init?.method && url.startsWith("/api/workboard/quote-draft") ? respond({ ok: true, proposal: stored(), showLines: false }) : route(url, init)
  );
  await openFace();
  expect(await screen.findByText("The customer sees each option's total")).toBeInTheDocument();
  toProposal();
  fireEvent.click(screen.getByRole("button", { name: "Edit Pricing" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show line items to the customer" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save pricing" }));
  });
  const put = (fetchMock.mock.calls as Call[]).filter(([, init]) => init?.method === "PUT").at(-1)!;
  expect(JSON.parse(put[1]!.body!).draft.showLines).toBe(true);
});

it("puts an option's materials on the job's list when it's marked accepted", async () => {
  const route = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) =>
    init?.method === "POST" && JSON.parse(init.body!).toJob === true ? respond({ ok: true, added: 9, removed: 0 }) : route(url, init)
  );
  const onToast = jest.fn();
  const onJobMaterials = jest.fn();
  render(<JobQuoteFace mode="page" job="j-1" address={null} visible onToast={onToast} onJobMaterials={onJobMaterials} />);
  await screen.findByText("What Tiff read");
  toProposal();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Mark accepted" }));
  });
  await waitFor(() => expect(onJobMaterials).toHaveBeenCalled());
  expect(onToast).toHaveBeenCalledWith("The accepted option's materials are on the job's list");
});

/* Isaac, 2026-10-05: "api call can recommend a labour amount to use if none
   is provided in the brief"; "typical labour hours for this type of job is
   32 hours. And click apply" — each option's labour under its scope */
describe("an option's labour", () => {
  const withOption = (patch: Record<string, unknown>, labour: unknown = null) => {
    const p = stored();
    const draft = normaliseDraft({ ...p.draft, options: [{ ...p.draft.options[0], ...patch }] })!;
    fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (!init || !init.method) return respond({ ok: true, proposal: { ...p, draft }, labour });
      if (init.method === "PUT") {
        const { draft: next } = JSON.parse(init.body!) as { draft: StoredProposal["draft"] };
        return respond({ ok: true, proposal: { ...p, draft: normaliseDraft(next) } });
      }
      return respond({ ok: true, proposal: { ...p, draft } });
    });
  };
  const sent = (method: string) =>
    (fetchMock.mock.calls as Call[]).filter(([, init]) => init?.method === method).map(([, init]) => JSON.parse(init!.body!));
  const suggestion = { visits: [{ stage: "Rough-in", people: 2, days: 2 }, { stage: "Fit-off", people: 2, days: 1 }], why: "Six ducted heads over two levels." };

  it("shows the brief's labour, with the words it was read from", async () => {
    withOption({}, { brief: { visits: [{ stage: "Install", people: 3, days: 1, hours: 24 }], personHours: 24, personDays: 3, said: ["3 x pax for 1 day"] }, typical: null, dayHours: 8 });
    face();
    expect(await screen.findByText("From the brief: “3 x pax for 1 day”")).toBeInTheDocument();
    expect(screen.getByText("3 people, 1 day")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Apply Tiff's labour/ })).toBeNull();
  });

  it("shows Tiff's suggestion and its reason, priced only once Apply is pressed", async () => {
    withOption({ suggestion }, { brief: null, typical: null, dayHours: 8 });
    face();
    expect(await screen.findByText("Not in the brief. Tiff suggests:")).toBeInTheDocument();
    expect(screen.getByText("Six ducted heads over two levels.")).toBeInTheDocument();
    expect(screen.getByText("2 people, 2 days")).toBeInTheDocument();
    expect(sent("PUT")).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply Tiff's labour to Option 1: Install client-supplied 6 kW split" }));
    });
    expect(sent("PUT")[0].draft.options[0].labour).toEqual({ visits: suggestion.visits, from: "tiff" });
    expect(await screen.findByText("Tiff's suggestion, applied")).toBeInTheDocument();
  });

  it("shows what the business's reviewed jobs typically take beside it", async () => {
    withOption({ suggestion }, { brief: null, typical: { kind: "vrf", hours: 64, jobs: 3, words: "Typical VRF jobs: 64 hrs, from 3 reviewed jobs." }, dayHours: 8 });
    face();
    expect(await screen.findByText("Typical VRF jobs: 64 hrs, from 3 reviewed jobs.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Apply your typical labour/ }));
    });
    expect(sent("PUT")[0].draft.options[0].labour).toEqual({ visits: [{ stage: "Install", people: 1, days: 8 }], from: "typical" });
  });

  it("asks Tiff for a suggestion on a draft written before Tiff made one", async () => {
    withOption({}, { brief: null, typical: null, dayHours: 8 });
    face();
    const ask = await screen.findByRole("button", { name: /^Suggest labour for/ });
    await act(async () => {
      fireEvent.click(ask);
    });
    expect(sent("POST")).toEqual([{ job: "j-1", suggestLabour: true }]);
  });

  it("sets labour by hand, each visit whole, and saves it as set on the quote", async () => {
    withOption({}, { brief: null, typical: null, dayHours: 8 });
    face();
    fireEvent.click(await screen.findByRole("button", { name: "Set labour for Option 1: Install client-supplied 6 kW split" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a visit" }));
    fireEvent.change(screen.getByLabelText("People"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save labour" }));
    expect(screen.getByText("Each visit needs how many people and how many days.")).toBeInTheDocument();
    expect(sent("PUT")).toEqual([]);
    fireEvent.change(screen.getByLabelText("Days"), { target: { value: "2.5" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save labour" }));
    });
    expect(sent("PUT")[0].draft.options[0].labour).toEqual({ visits: [{ stage: "Install", people: 2, days: 2.5 }], from: "you" });
    expect(await screen.findByText("Set on the quote")).toBeInTheDocument();
  });

  it("opens Change on the brief's own labour in days, and saving it unchanged prices the same hours", async () => {
    withOption({}, { brief: { visits: [{ stage: "Install", people: 1, days: null, hours: 3 }], personHours: 3, personDays: null, said: ["Allowance 3 HRS x 1 PAX"] }, typical: null, dayHours: 8 });
    face();
    fireEvent.click(await screen.findByRole("button", { name: /^Change labour for/ }));
    expect(screen.getByLabelText("Days")).toHaveValue("0.375");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save labour" }));
    });
    expect(sent("PUT")[0].draft.options[0].labour).toEqual({ visits: [{ stage: "Install", people: 1, days: 0.375 }], from: "you" });
  });

  it("reads the brief's labour again with a new draft", async () => {
    const p = stored();
    fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (!init || !init.method) return respond({ ok: true, proposal: null, labour: { brief: null, typical: null, dayHours: 8 } });
      if (init.method === "POST")
        return respond({
          ok: true,
          proposal: p,
          labour: { brief: { visits: [{ stage: "Install", people: 2, days: 3, hours: 24 }], personHours: 48, personDays: 6, said: ["2 pax for 3 days"] }, typical: null, dayHours: 8 },
        });
      return respond({ ok: false, reason: "no" });
    });
    face();
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Split in the living room, 2 pax for 3 days" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Draft proposal" }));
    });
    expect(await screen.findByText("From the brief: “2 pax for 3 days”")).toBeInTheDocument();
  });

  it("says why a suggestion couldn't be had under the option that asked, and clears it once labour is set", async () => {
    const p = stored();
    const two = normaliseDraft({ ...p.draft, options: [p.draft.options[0], { ...p.draft.options[0], name: "Ducted" }] })!;
    fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (!init || !init.method) return respond({ ok: true, proposal: { ...p, draft: two }, labour: { brief: null, typical: null, dayHours: 8 } });
      if (init.method === "PUT") {
        const { draft: next } = JSON.parse(init.body!) as { draft: StoredProposal["draft"] };
        return respond({ ok: true, proposal: { ...p, draft: normaliseDraft(next) } });
      }
      return respond({ ok: false, reason: "Tiff couldn't suggest labour for this one. Set it yourself." });
    });
    face();
    const ask = await screen.findByRole("button", { name: "Suggest labour for Option 2: Ducted" });
    await act(async () => {
      fireEvent.click(ask);
    });
    expect(screen.getAllByText("Tiff couldn't suggest labour for this one. Set it yourself.")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Set labour for Option 2: Ducted" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a visit" }));
    fireEvent.change(screen.getByLabelText("People"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Days"), { target: { value: "1" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save labour" }));
    });
    expect(screen.queryByText("Tiff couldn't suggest labour for this one. Set it yourself.")).toBeNull();
  });
});

/* Isaac, 2026-10-06: "You should still be able to manually approve" — the
   page's corner is the quote's next step: Approve, Mark sent, then Mark
   accepted, each by hand, with the last one marked taken back by Undo */
describe("the quote's next step, by hand", () => {
  let corner: HTMLDivElement;
  beforeEach(() => {
    corner = document.createElement("div");
    document.body.appendChild(corner);
  });
  afterEach(() => corner.remove());
  const page = () => render(<JobQuoteFace mode="page" job="j-1" address={null} visible onToast={jest.fn()} actionsEl={corner} />);
  const lastPut = () => JSON.parse((fetchMock.mock.calls as Call[]).filter(([, init]) => init?.method === "PUT").at(-1)![1]!.body!) as { draft: StoredProposal["draft"] };

  it("approves, then marks it sent, each on the progress line, and Undo takes the last one back", async () => {
    page();
    await screen.findByText("What Tiff read");
    const line = screen.getByRole("list", { name: "Where the quote is" });
    expect(line.querySelector('[aria-current="step"]')).toHaveTextContent("ApprovedNot yet");
    await act(async () => {
      fireEvent.click(within(corner).getByRole("button", { name: "Approve" }));
    });
    expect(lastPut().draft.status?.approvedAt).toEqual(expect.any(String));
    expect(await within(corner).findByRole("button", { name: "Mark sent" })).toBeInTheDocument();
    expect(line).toHaveTextContent(/Approved \w{3}, \d+ \w+/);
    await act(async () => {
      fireEvent.click(within(corner).getByRole("button", { name: "Mark sent" }));
    });
    expect(lastPut().draft.status).toEqual({ approvedAt: expect.any(String), sentAt: expect.any(String) });
    /* sent: the next step is the client's yes */
    expect(await within(corner).findByRole("button", { name: "Mark accepted" })).toHaveClass("primary");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo sent" }));
    });
    expect(lastPut().draft.status).toEqual({ approvedAt: expect.any(String), sentAt: null });
  });

  it("waits to approve until the answers are in the proposal", async () => {
    page();
    await screen.findByText("What Tiff read");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Colorbond trunking" }));
    });
    expect(within(corner).getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("takes an approval back when the quote changes after it", async () => {
    page();
    await screen.findByText("What Tiff read");
    await act(async () => {
      fireEvent.click(within(corner).getByRole("button", { name: "Approve" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Colorbond trunking" }));
    });
    expect(lastPut().draft.status ?? null).toBeNull();
  });

  it("marks a one-option quote accepted from the corner, whatever came before", async () => {
    page();
    await screen.findByText("What Tiff read");
    await act(async () => {
      fireEvent.click(within(corner).getByRole("button", { name: "Mark accepted" }));
    });
    expect(lastPut().draft.accepted).toEqual([0]);
  });

  it("keeps the line where the quote is while it's started again", async () => {
    page();
    await screen.findByText("What Tiff read");
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(screen.getByRole("heading", { name: "Start the proposal again" })).toBeInTheDocument();
    const line = screen.getByRole("list", { name: "Where the quote is" });
    expect(line).toHaveTextContent(/Drafted/);
    expect(line).not.toHaveTextContent("Not drafted yet");
  });
});

describe("the list on the right", () => {
  it("opens a question from To answer, and a known topic from What Tiff read", async () => {
    const asked = stored();
    asked.draft.checklist = [
      { key: "pipe_covering", state: "ask", answer: "", question: "What covers the pipes on the rear wall?", choices: ["Colorbond trunking"], rank: 1 },
      { key: "drain_to", state: "ask", answer: "", question: "Where does the drain go from the bedroom?", choices: ["Downpipe"], rank: 2 },
      { key: "outdoor_location", state: "known", answer: "Parapet wall, on brackets" },
    ];
    fetchMock.mockImplementation(() => respond({ ok: true, proposal: asked }));
    const { container } = face();
    await screen.findByText("What Tiff read");
    const list = container.querySelector(".qp-rail") as HTMLElement;
    expect(within(list).getByText("2")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Answer Where to" }));
    expect(screen.getAllByText("Where does the drain go from the bedroom?")[0]).toHaveClass("wb2-jqask");
    fireEvent.click(screen.getByRole("button", { name: "Change Where and how" }));
    expect(screen.getByText("Where does the outdoor unit go, and on what?")).toHaveClass("wb2-jqask");
    /* a topic opened to change it says what it holds now */
    expect(screen.getAllByText("Parapet wall, on brackets").find((e) => e.classList.contains("wb2-jqhas"))).toBeDefined();
  });

  it("holds no question open from the last draft once a new one lands", async () => {
    face();
    await screen.findByText("What Tiff read");
    fireEvent.click(screen.getByRole("button", { name: "Change Where and how" }));
    expect(screen.getByText("Where does the outdoor unit go, and on what?")).toHaveClass("wb2-jqask");
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Draft proposal" }));
    });
    await screen.findByText("What Tiff read");
    expect(screen.queryByText("Where does the outdoor unit go, and on what?")).toBeNull();
    expect(document.querySelector(".wb2-jqask")).toHaveTextContent("What covers the pipes where they're seen?");
  });

  it("from the Proposal, scrolls to the question once the Build-up shows", async () => {
    const asked = stored();
    asked.draft.checklist = [{ key: "drain_to", state: "ask", answer: "", question: "Where does the drain go?", choices: [], rank: 1 }];
    fetchMock.mockImplementation(() => respond({ ok: true, proposal: asked }));
    const shown: boolean[] = [];
    const was = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      shown.push(!this.closest("[role=tabpanel]")?.hasAttribute("hidden"));
    };
    try {
      const { container } = face();
      await screen.findByText("What Tiff read");
      toProposal();
      fireEvent.click(within(container.querySelector(".qp-rail") as HTMLElement).getByRole("button", { name: "Answer Where to" }));
      expect(screen.getByRole("tab", { name: "Build-up" })).toHaveAttribute("aria-selected", "true");
      expect(shown).toEqual([true]);
    } finally {
      Element.prototype.scrollIntoView = was;
    }
  });

  it("names six known topics, then says how many more", async () => {
    const known = stored();
    known.draft.checklist = (["model", "indoor_type", "indoor_position", "outdoor_location", "pipe_route", "drain_to", "power_supply", "power_phase"] as const).map((key) => ({
      key,
      state: "known" as const,
      answer: "Said",
    }));
    fetchMock.mockImplementation(() => respond({ ok: true, proposal: known }));
    const { container } = face();
    await screen.findByText("What Tiff read");
    expect(container.querySelector(".qp-known")).toHaveTextContent(/^Model, Type, Where, Where and how, Route, Where to and 2 more$/);
  });

  it("prices the option being read, and lists what's still to price in the late red", async () => {
    const price = {
      ok: true,
      options: [
        {
          name: "Split",
          build: {
            exGstCents: 300_000,
            incGstCents: 330_000,
            gstCents: 30_000,
            buyCents: 120_000,
            contingency: null,
            groups: [{ name: "Units", buyCents: 100_000, sellCents: 125_000, lines: [{ key: "u1", group: "Units", name: "MSZ-AP25", code: "X", supplierKey: "aad", qty: 1, unitBuyCents: 100_000, kind: "unit", buyCents: 100_000, sellCents: 125_000 }] }],
            labour: { sellCents: 0, personDays: 0, hours: 0, visits: [] },
          },
          unpriced: [{ name: "Wall bracket", qty: "1", why: "Not in your price book" }],
          rows: 2,
          labourFrom: "none",
        },
      ],
    } as unknown as QuotePrice;
    const { container } = face(jest.fn(), price);
    await screen.findByText("What Tiff read");
    const list = container.querySelector(".qp-rail") as HTMLElement;
    expect(within(list).getByText("$3,000")).toBeInTheDocument();
    expect(within(list).getByText("Option 1: Install client-supplied 6 kW split, ex GST, so far")).toBeInTheDocument();
    /* labour nothing gives is still to price, never a $0 line */
    expect(within(list).queryByText("$0")).toBeNull();
    expect(within(list).getByText("Still to price", { selector: "h2 *, h2" })).toBeInTheDocument();
    expect(within(list).getByText("Not in your price book")).toBeInTheDocument();
    /* and down the page, what the option is made of */
    expect(screen.getByRole("heading", { name: "What’s in it" })).toBeInTheDocument();
    expect(screen.getByText("MSZ-AP25")).toBeInTheDocument();
  });
});
