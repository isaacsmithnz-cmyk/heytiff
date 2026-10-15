import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/* Isaac, 2026-10-05: "it should have opened up the proper quote screen not a
   section below"; 2026-10-12, retiring the old builder: every quote is built
   on its lines, one still on the old builder switched to them as it opens */
const readJobFiles = jest.fn();
const readJobRecord = jest.fn();
const cacheJobFiles = jest.fn();
jest.mock("@/app/actions/workboard", () => ({
  readJobFiles: (...a: unknown[]) => readJobFiles(...a),
  readJobRecord: (...a: unknown[]) => readJobRecord(...a),
}));
jest.mock("@/app/actions/workboard-media", () => ({ cacheJobFiles: (...a: unknown[]) => cacheJobFiles(...a) }));
/* the lines have a suite of their own: here, what the page lays out around
   them and what it hands them */
jest.mock("../quote-lines-face", () => ({
  QuoteLinesFace: ({
    price,
    sm8,
    send,
    actionsEl,
    onOpenPaper,
    start,
  }: {
    price: { ok: boolean } | null | undefined;
    sm8: { value: string | null; papers: { remoteId: string; name: string }[] };
    send: React.ReactNode;
    actionsEl: HTMLElement | null;
    onOpenPaper: (p: unknown) => void;
    start?: boolean;
  }) => (
    <div>
      <p>{`Lines, ${sm8.value ?? "no value"}`}</p>
      {start && <p>Starts at the reply box</p>}
      <p>{price === undefined ? "No price" : price ? "Priced" : "Price refused"}</p>
      <p>{actionsEl ? "Corner ready" : "No corner"}</p>
      {sm8.papers.map((p) => (
        <button key={p.remoteId} type="button" onClick={() => onOpenPaper(p)}>
          {p.name}
        </button>
      ))}
      {send}
    </div>
  ),
}));
jest.mock("../../board/job-quote-send", () => ({ JobQuoteSend: ({ version }: { version: string }) => <p>{`Send block, ${version}`}</p> }));
jest.mock("../../board/job-media-viewer", () => ({
  JobMediaViewer: ({ items, onClose }: { items: { name: string }[]; onClose: () => void }) => (
    <div role="dialog" aria-modal="true" aria-label={items[0].name}>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

import { QuoteScreen } from "../quote-screen";

const JOB = "a3539c01-9527-42a6-893b-24376269efbb";
const paper = { remoteId: "att-q", name: "Quote #2905", fileType: ".pdf", kind: "document", origin: "Quote", takenAt: "2026-09-01 10:00:00", url: "https://files.example/q.pdf", width: null, height: null, fromClaim: null };
const detail = { jobNumber: "2905", clientName: "Heuvel Construction", address: "44 Leinster Street\nPaddington NSW 2021", geoLine: null, quoteSentOn: "2026-09-01", money: { valueCents: 6_479_000 } } as unknown as Parameters<typeof QuoteScreen>[0]["detail"];

/* the quote's engine as the route holds it, and whether a switch goes through */
let engine = "lines";
let switches = true;
let fetchMock: jest.Mock;

beforeEach(() => {
  engine = "lines";
  switches = true;
  fetchMock = jest.fn(async (url: string, init?: { body?: string }) => ({
    json: async () => {
      if (String(url).startsWith("/api/workboard/quote-lines")) {
        if (init?.body) {
          if (!switches) return { ok: false, reason: "The quote couldn't be switched. Try again." };
          engine = JSON.parse(init.body).engine;
          return { ok: true };
        }
        return { ok: true, engine, lines: [], changes: [], names: {}, me: "u" };
      }
      return { ok: true, price: { ok: true, options: [] } };
    },
  }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  readJobFiles.mockReset().mockResolvedValue({ documents: [paper], photos: [], elsewhere: [] });
  readJobRecord.mockReset().mockResolvedValue({ family: null });
  cacheJobFiles.mockReset();
});

const posts = () => fetchMock.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === "POST");

it("lays the quote out full screen in Home's frame: the way back to the job card's Quote, the title and its corner, the lines", async () => {
  const { container } = render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  /* the job came from the server: the band is final on first paint */
  expect(screen.getByRole("link", { name: "Job 2905" })).toHaveAttribute("href", `/dashboard/workboard?job=${JOB}&face=quote`);
  expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent(/^Quote$/);
  expect(container.querySelector(".hd-page")).not.toBeNull();
  expect(await screen.findByText("Lines, $64,790 inc GST")).toBeInTheDocument();
  expect(screen.getByText("Corner ready")).toBeInTheDocument();
  /* the price is read for the quote's lines, and handed to them */
  await waitFor(() => expect(screen.getByText("Priced")).toBeInTheDocument());
  expect(screen.getByText("Send block, lines-0")).toBeInTheDocument();
  expect(posts()).toHaveLength(0);
});

it("reads no price and no family value for someone without the money grants", async () => {
  render(<QuoteScreen job="j-1" detail={detail} moneyVisible={false} financials={false} />);
  expect(await screen.findByText("Lines, no value")).toBeInTheDocument();
  expect(screen.getByText("No price")).toBeInTheDocument();
  expect(readJobRecord).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/workboard/quote-price"))).toBe(false);
});

it("brings ServiceM8's quote PDF across by name, not the newest of the job's other files", async () => {
  readJobFiles.mockResolvedValue({ documents: [{ ...paper, url: null }], photos: [], elsewhere: [] });
  cacheJobFiles.mockResolvedValue({ ok: true, cached: 1, remaining: 0, media: { documents: [paper], photos: [], elsewhere: [] }, note: null });
  render(<QuoteScreen job={JOB} detail={detail} moneyVisible={false} financials={false} />);
  await waitFor(() => expect(cacheJobFiles).toHaveBeenCalledWith(JOB, ["att-q"]));
});

it("opens ServiceM8's quote over the whole shell, and Escape closes it", async () => {
  const { container } = render(<QuoteScreen job={JOB} detail={detail} moneyVisible={false} financials={false} />);
  fireEvent.click(await screen.findByRole("button", { name: /Quote #2905/ }));
  const viewer = screen.getByRole("dialog", { name: "Quote #2905" });
  /* portalled to the body, out of the page's own stacking context */
  expect(container.contains(viewer)).toBe(false);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("switches a quote still on the old builder to its lines as it opens", async () => {
  engine = "old";
  render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  expect(screen.getByText("Opening the quote")).toBeInTheDocument();
  expect(await screen.findByText("Lines, $64,790 inc GST")).toBeInTheDocument();
  expect(posts()).toEqual([["/api/workboard/quote-lines", expect.objectContaining({ body: JSON.stringify({ job: JOB, op: "switch", engine: "lines" }) })]]);
});

it("says when the quote couldn't be opened, and Try again opens it", async () => {
  engine = "old";
  switches = false;
  render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  expect(await screen.findByText("The quote couldn’t be opened.")).toBeInTheDocument();
  expect(screen.queryByText(/^Lines,/)).toBeNull();
  switches = true;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Lines, $64,790 inc GST")).toBeInTheDocument();
});

/* the job card's Create a quote links ?start=1 (the chat-first page, 2026-10-13) */
it("hands the lines the start from the job card, and nothing without it", async () => {
  const { unmount } = render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials start />);
  expect(await screen.findByText("Starts at the reply box")).toBeInTheDocument();
  unmount();
  render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  expect(await screen.findByText("Lines, $64,790 inc GST")).toBeInTheDocument();
  expect(screen.queryByText("Starts at the reply box")).toBeNull();
});
