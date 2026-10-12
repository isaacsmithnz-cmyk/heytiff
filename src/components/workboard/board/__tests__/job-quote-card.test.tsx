/* The job card's Quote section on the new code (Isaac, 2026-10-12, retiring
   the old builder: the same card; and for techs too, with no money of
   HeyTiff's in it): ServiceM8's quote first, where HeyTiff's stands in a
   line, and the one button into the quote page. */

import { fireEvent, render, screen } from "@testing-library/react";
import type { QuoteFacts } from "@/lib/quotes/quote-card";

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

let fetchMock: jest.Mock;
const answer = (body: unknown) => fetchMock.mockImplementation(() => Promise.resolve({ json: async () => body }));
const none = { papers: [], sentOn: null, value: null };

beforeEach(() => {
  fetchMock = jest.fn();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

it("reads where the quote stands only once the section is opened", async () => {
  answer({ ok: true, facts: facts() });
  const { rerender } = render(<JobQuoteCard job="j-1" visible={false} sm8={none} />);
  expect(fetchMock).not.toHaveBeenCalled();
  rerender(<JobQuoteCard job="j-1" visible sm8={none} />);
  expect(await screen.findByRole("link", { name: "Create a quote" })).toHaveAttribute("href", "/dashboard/workboard/quotes/j-1?start=1");
  expect(fetchMock).toHaveBeenCalledWith("/api/workboard/quote-status?job=j-1");
  expect(screen.queryByText("Quote from ServiceM8")).toBeNull();
});

it("shows a quote on its lines as Continue quote, with where it stands and what's left to confirm", async () => {
  answer({ ok: true, facts: facts({ lines: 14, options: 2, toConfirm: 3, changedAt: "2026-10-12T01:00:00Z" }) });
  render(<JobQuoteCard job="j-1" visible sm8={none} />);
  expect(await screen.findByRole("link", { name: "Continue quote" })).toHaveAttribute("href", "/dashboard/workboard/quotes/j-1");
  expect(screen.getByText("Changed Mon 12 Oct, 2 options, 14 lines, 3 to confirm")).toBeInTheDocument();
});

it("continues a quote only talked through with Tiff, or drafted in the old builder", async () => {
  answer({ ok: true, facts: facts({ talked: true, toConfirm: 2 }) });
  const { unmount } = render(<JobQuoteCard job="j-1" visible sm8={none} />);
  expect(await screen.findByText("Started with Tiff, 2 to confirm")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continue quote" })).toHaveAttribute("href", "/dashboard/workboard/quotes/j-1");
  unmount();
  answer({ ok: true, facts: facts({ drafted: true }) });
  render(<JobQuoteCard job="j-1" visible sm8={none} />);
  expect(await screen.findByText("Drafted")).toBeInTheDocument();
});

it("shows ServiceM8's quote first, its PDF opening there, with Update ServiceM8 quote into the page", async () => {
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
  const onOpenPaper = jest.fn();
  answer({ ok: true, facts: facts() });
  render(<JobQuoteCard job="j-1" visible sm8={{ papers: [paper], sentOn: "2026-10-01", value: "$45,430 inc GST" }} onOpenPaper={onOpenPaper} />);
  expect(screen.getByText("Sent Thu 1 Oct, $45,430 inc GST")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Quote #3386/ }));
  expect(onOpenPaper).toHaveBeenCalledWith(paper);
  expect(await screen.findByRole("link", { name: "Update ServiceM8 quote" })).toHaveAttribute("href", "/dashboard/workboard/quotes/j-1?start=1");
});

it("a read that fails says so and tries again, never offering to start a quote over one it couldn't read", async () => {
  answer({ ok: false, reason: "A quote needs the Workboard." });
  render(<JobQuoteCard job="j-1" visible sm8={none} />);
  expect(await screen.findByText("Where the quote stands couldn’t be read.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Create a quote" })).toBeNull();
  answer({ ok: true, facts: facts({ lines: 1, changedAt: "2026-10-12T01:00:00Z", accepted: [1], toConfirm: 1 }) });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Option 2 accepted, 1 line")).toBeInTheDocument();
});
