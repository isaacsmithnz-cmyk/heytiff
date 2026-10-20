/* The Quote tab's landing, "Quotes" (Isaac, 2026-10-18; mock-ups
   v2-land-first, v2-land-progress, v2-land-accepted): the job's one quote
   in one of three states, then ServiceM8's own quote under "Already in
   ServiceM8". Every door is the quote page; money only where the server
   sent it. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { QuoteFacts } from "@/lib/quotes/quote-card";
import type { QuoteLanding } from "@/lib/quotes/quote-landing";

import { JobQuoteCard } from "../job-quote-card";

const facts = (o: Partial<QuoteFacts> = {}): QuoteFacts => ({
  lines: 0,
  options: 0,
  toConfirm: 0,
  changedAt: null,
  talked: false,
  drafted: false,
  approved: false,
  version: 1,
  sent: null,
  accepted: [],
  ...o,
});

const landing = (o: Partial<QuoteLanding> = {}): QuoteLanding => ({
  name: "Mitsubishi Electric VRF, 4 concealed heads",
  startedAt: "2026-10-17T02:00:00Z",
  who: { name: "Isaac Smith", at: "2026-10-17T11:24:00Z", now: false },
  approvedBy: null,
  acceptedAt: null,
  totalCents: 2457463,
  money: true,
  versions: [],
  variations: [],
  ...o,
});

let fetchMock: jest.Mock;
const answer = (body: unknown) => fetchMock.mockImplementation(() => Promise.resolve({ json: async () => body }));
const none = { papers: [], sentOn: null, value: null };
const paper = {
  remoteId: "att-q",
  name: "Quote #3386",
  fileType: ".pdf",
  kind: "document" as const,
  origin: "Quote",
  takenAt: "2026-10-01 14:25:35",
  url: "https://files.example/q.pdf",
  width: null,
  height: null,
  fromClaim: null,
};
const PAGE = "/dashboard/workboard/quotes/j-1";
const isMain = (el: HTMLElement) => el.classList.contains("pt-btn--main");

beforeEach(() => {
  fetchMock = jest.fn();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

it("reads where the quote stands, for the landing, only once the tab is opened", async () => {
  answer({ ok: true, facts: facts(), landing: landing() });
  const { rerender } = render(<JobQuoteCard job="j-1" visible={false} sm8={none} />);
  expect(fetchMock).not.toHaveBeenCalled();
  rerender(<JobQuoteCard job="j-1" visible sm8={none} />);
  expect(await screen.findByRole("heading", { name: "Quotes" })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/workboard/quote-status?job=j-1&landing=1");
});

describe("nothing yet", () => {
  it("leads with Create a quote, the main button, into the reply box; no ServiceM8 quote, no Update", async () => {
    answer({ ok: true, facts: facts(), landing: landing({ who: null, totalCents: null }) });
    render(<JobQuoteCard job="j-1" visible sm8={none} />);
    expect(await screen.findByText("No quote in HeyTiff yet")).toBeInTheDocument();
    const create = screen.getByRole("link", { name: "Create a quote" });
    expect(create).toHaveAttribute("href", `${PAGE}?start=1`);
    expect(isMain(create)).toBe(true);
    expect(screen.queryByRole("link", { name: "Update ServiceM8’s quote" })).toBeNull();
    expect(screen.queryByText("Already in ServiceM8")).toBeNull();
    expect(screen.queryByRole("link", { name: "New quote" })).toBeNull();
  });

  it("offers Update ServiceM8's quote, a second button, with ServiceM8's quote and its PDF below", async () => {
    const onOpenPaper = jest.fn();
    answer({ ok: true, facts: facts(), landing: landing({ who: null }) });
    render(<JobQuoteCard job="j-1" visible sm8={{ papers: [paper], sentOn: "2026-10-01", value: "$45,430 inc GST" }} onOpenPaper={onOpenPaper} />);
    const update = await screen.findByRole("link", { name: "Update ServiceM8’s quote" });
    expect(update).toHaveAttribute("href", `${PAGE}?start=1`);
    expect(isMain(update)).toBe(false);
    const sm8 = screen.getByRole("region", { name: "Already in ServiceM8" });
    expect(within(sm8).getByText("ServiceM8's quote")).toBeInTheDocument();
    expect(within(sm8).getByText("Sent to the client Thu 1 Oct")).toBeInTheDocument();
    expect(within(sm8).getByText("$45,430 inc GST")).toBeInTheDocument();
    fireEvent.click(within(sm8).getByRole("button", { name: /Open the PDF/ }));
    expect(onOpenPaper).toHaveBeenCalledWith(paper);
  });
});

describe("in progress", () => {
  it("is one card: its name, version and day begun, total so far, state word, who's on it with Tiff and when, and Continue", async () => {
    answer({ ok: true, facts: facts({ lines: 14, options: 1, toConfirm: 4, talked: true, changedAt: "2026-10-17T11:00:00Z" }), landing: landing() });
    render(<JobQuoteCard job="j-1" visible sm8={none} />);
    const card = await screen.findByRole("article", { name: "Mitsubishi Electric VRF, 4 concealed heads" });
    expect(within(card).getByText("Version 1, started Sat 17 Oct")).toBeInTheDocument();
    expect(within(card).getByText("$24,574.63")).toBeInTheDocument();
    expect(within(card).getByText("ex GST, so far")).toBeInTheDocument();
    expect(within(card).getByText("Scope, 4 to settle").closest(".pt-state")).toHaveClass("pt-state--look");
    expect(within(card).getByText("Isaac Smith, with Tiff, last Sat 17 Oct at 10:24 pm")).toBeInTheDocument();
    const go = within(card).getByRole("link", { name: "Continue" });
    expect(go).toHaveAttribute("href", PAGE);
    expect(isMain(go)).toBe(true);
    expect(screen.queryByText("No quote in HeyTiff yet")).toBeNull();
  });

  it("shows no total to a reader the server sent none, and the when alone where no one is named", async () => {
    answer({ ok: true, facts: facts({ lines: 3, talked: true }), landing: landing({ totalCents: null, money: false, who: { name: null, at: "2026-10-17T11:24:00Z", now: false } }) });
    render(<JobQuoteCard job="j-1" visible sm8={none} />);
    expect(await screen.findByText("With Tiff, last Sat 17 Oct at 10:24 pm")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByText(/ex GST/)).toBeNull();
  });

  it("says who is in it now while Tiff works, and waits on the client once it's sent", async () => {
    answer({
      ok: true,
      facts: facts({ lines: 3, talked: true, approved: true, sent: { at: "2026-10-12T21:30:00Z", trial: false } }),
      landing: landing({ who: { name: "Luke Ingold", at: "2026-10-17T11:24:00Z", now: true } }),
    });
    render(<JobQuoteCard job="j-1" visible sm8={none} />);
    expect(await screen.findByText("Luke Ingold, with Tiff, now")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the client").closest(".pt-state")).toHaveClass("pt-state--look");
    expect(screen.getByText(", sent Tue 13 Oct")).toBeInTheDocument();
    expect(screen.getByText("ex GST")).toBeInTheDocument();
  });
});

describe("accepted", () => {
  const accepted = landing({
    acceptedAt: "2026-10-21T22:00:00Z",
    approvedBy: "Isaac Smith",
    versions: [{ n: 1, approvedAt: "2026-10-19T22:00:00Z", madeAt: "2026-10-20T01:00:00Z", by: "Isaac Smith", cents: 2380036 }],
    variations: [{ n: 1, what: "return grille in Bed 2", startedAt: "2026-10-22T01:00:00Z", by: "Luke Ingold", approvedAt: "2026-10-22T02:00:00Z", acceptedAt: null, cents: 41200 }],
  });

  it("lists the variations and versions newest first: Continue on the open one, Open on the rest, then Start a variation", async () => {
    answer({ ok: true, facts: facts({ lines: 14, talked: true, approved: true, version: 2, accepted: [0] }), landing: accepted });
    render(<JobQuoteCard job="j-1" visible sm8={none} />);
    const card = await screen.findByRole("article", { name: "Mitsubishi Electric VRF, 4 concealed heads" });
    expect(within(card).getByText("Thu 22 Oct, version 2")).toBeInTheDocument();
    const rows = within(within(card).getByRole("list", { name: "Versions and variations" })).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".pt-row-name")?.textContent)).toEqual(["Variation 1", "Version 2", "Version 1"]);

    expect(within(rows[0]!).getByText("Waiting for the client").closest(".pt-state")).toHaveClass("pt-state--look");
    expect(within(rows[0]!).getByText("+$412.00")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Luke Ingold")).toBeInTheDocument();
    const go = within(rows[0]!).getByRole("link", { name: "Continue variation 1" });
    expect(go).toHaveAttribute("href", PAGE);
    expect(isMain(go)).toBe(true);

    expect(within(rows[1]!).getByText("Accepted").closest(".pt-state")).toHaveClass("pt-state--good");
    expect(within(rows[1]!).getByText("$24,574.63")).toBeInTheDocument();
    expect(isMain(within(rows[1]!).getByRole("link", { name: "Open version 2" }))).toBe(false);

    expect(within(rows[2]!).getByText("Replaced").closest(".pt-state")).toHaveClass("pt-state--info");
    expect(within(rows[2]!).getByText(", approved Tue 20 Oct")).toBeInTheDocument();
    expect(within(rows[2]!).getByRole("link", { name: "Open version 1" })).toHaveAttribute("href", PAGE);

    const start = within(card).getByRole("link", { name: "Start a variation" });
    expect(start).toHaveAttribute("href", PAGE);
    expect(isMain(start)).toBe(false);
    /* one main button in the area */
    expect(card.querySelectorAll(".pt-btn--main")).toHaveLength(1);
  });

  it("makes Start a variation the main button when no variation is open", async () => {
    answer({ ok: true, facts: facts({ lines: 14, approved: true, version: 2, accepted: [0] }), landing: { ...accepted, variations: [] } });
    render(<JobQuoteCard job="j-1" visible sm8={none} />);
    expect(isMain(await screen.findByRole("link", { name: "Start a variation" }))).toBe(true);
  });

  it("keeps the money and Start a variation from a reader without money access", async () => {
    const hidden = {
      ...accepted,
      money: false,
      totalCents: null,
      versions: accepted.versions.map((v) => ({ ...v, cents: null })),
      variations: accepted.variations.map((v) => ({ ...v, cents: null })),
    };
    answer({ ok: true, facts: facts({ lines: 14, approved: true, version: 2, accepted: [0] }), landing: hidden });
    render(<JobQuoteCard job="j-1" visible sm8={none} />);
    expect(await screen.findByRole("link", { name: "Continue variation 1" })).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Start a variation" })).toBeNull();
  });
});

it("a read that fails says so and reads again, never offering to start a quote over one it couldn't read", async () => {
  answer({ ok: false, reason: "A quote needs the Workboard." });
  render(<JobQuoteCard job="j-1" visible sm8={none} />);
  expect(await screen.findByText("Where the quote stands couldn’t be read.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Create a quote" })).toBeNull();
  answer({ ok: true, facts: facts({ lines: 1, talked: true }), landing: landing() });
  fireEvent.click(screen.getByRole("button", { name: "Read the quote again" }));
  expect(await screen.findByRole("link", { name: "Continue" })).toHaveAttribute("href", PAGE);
});
