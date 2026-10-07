import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";

/* Isaac, 2026-10-05: "it should have opened up the proper quote screen not a
   section below" */
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const readJobFiles = jest.fn();
const readJobRecord = jest.fn();
const cacheJobFiles = jest.fn();
jest.mock("@/app/actions/workboard", () => ({
  readJobFiles: (...a: unknown[]) => readJobFiles(...a),
  readJobRecord: (...a: unknown[]) => readJobRecord(...a),
}));
jest.mock("@/app/actions/workboard-media", () => ({ cacheJobFiles: (...a: unknown[]) => cacheJobFiles(...a) }));
/* the builder has a suite of its own: here, what the page lays out around it
   and what it hands the builder */
let drafted = true;
jest.mock("../../board/job-quote-face", () => ({
  JobQuoteFace: ({
    mode,
    onVersion,
    onCancel,
    sm8,
    price,
    send,
    actionsEl,
    onOpenPaper,
    onByHand,
  }: {
    mode: string;
    onVersion: (v: string | null) => void;
    onCancel: () => void;
    sm8: { value: string | null; papers: { remoteId: string; name: string }[] };
    price: { ok: boolean } | null | undefined;
    send: React.ReactNode;
    actionsEl: HTMLElement | null;
    onOpenPaper: (p: unknown) => void;
    onByHand?: () => void;
  }) => {
    useEffect(() => onVersion(drafted ? "v1" : null), [onVersion]);
    return (
      <div>
        <p>{`Builder, ${mode}, ${sm8.value ?? "no value"}`}</p>
        <p>{price === undefined ? "No price" : price ? "Priced" : "Price refused"}</p>
        <p>{actionsEl ? "Corner ready" : "No corner"}</p>
        {sm8.papers.map((p) => (
          <button key={p.remoteId} type="button" onClick={() => onOpenPaper(p)}>
            {p.name}
          </button>
        ))}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        {onByHand && (
          <button type="button" onClick={onByHand}>
            Build it by hand
          </button>
        )}
        {send}
      </div>
    );
  },
}));
jest.mock("../quote-lines-face", () => ({
  QuoteLinesFace: ({ price }: { price: unknown }) => <p>{`Lines builder, ${price ? "priced" : "no price"}`}</p>,
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

beforeEach(() => {
  drafted = true;
  push.mockReset();
  readJobFiles.mockReset().mockResolvedValue({ documents: [paper], photos: [], elsewhere: [] });
  readJobRecord.mockReset().mockResolvedValue({ family: null });
  cacheJobFiles.mockReset();
});

it("lays the quote out full screen in Home's frame: the way back to the job card's Quote, the title and its corner, the builder", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ok: true, price: { ok: true, options: [] } }) }));
  const { container } = render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  /* the job came from the server: the band is final on first paint */
  expect(screen.getByRole("link", { name: "Job 2905" })).toHaveAttribute("href", `/dashboard/workboard?job=${JOB}&face=quote`);
  expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent(/^Quote$/);
  expect(container.querySelector(".hd-page")).not.toBeNull();
  expect(screen.getByText("Builder, page, $64,790 inc GST")).toBeInTheDocument();
  expect(screen.getByText("Corner ready")).toBeInTheDocument();
  /* the price is read for the quote's version, and handed to the builder */
  await waitFor(() => expect(screen.getByText("Priced")).toBeInTheDocument());
  expect(screen.getByText("Send block, v1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(push).toHaveBeenCalledWith(`/dashboard/workboard?job=${JOB}&face=quote`);
});

it("reads no price and hands over no send to someone without the money grants", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn();
  render(<QuoteScreen job="j-1" detail={detail} moneyVisible={false} financials={false} />);
  expect(screen.getByText("Builder, page, no value")).toBeInTheDocument();
  expect(screen.getByText("No price")).toBeInTheDocument();
  expect(screen.queryByText(/Send block/)).toBeNull();
  expect(readJobRecord).not.toHaveBeenCalled();
  expect((global as unknown as { fetch: jest.Mock }).fetch).not.toHaveBeenCalled();
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

it("brings a quote Tiff's builder priced across to its kept lines, to edit by hand", async () => {
  const posted: unknown[] = [];
  let engine = "old";
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => ({
    json: async () => {
      if (String(url).startsWith("/api/workboard/quote-lines")) {
        if (init?.body) {
          posted.push(JSON.parse(init.body));
          engine = "lines";
        }
        return { ok: true, engine, lines: [], changes: [], names: {}, me: "u" };
      }
      return { ok: true, price: { ok: true, options: [{ name: "Option 1", rows: 3, unpriced: [], labourFrom: "brief", build: { exGstCents: 1 } }] } };
    },
  }));
  render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit the lines by hand" }));
  expect(await screen.findByText(/Lines builder/)).toBeInTheDocument();
  expect(posted).toContainEqual({ job: JOB, op: "adopt" });
});

/* the engine rebuild, slice 2.3: a quote switched to its kept lines is built by hand */
it("shows a switched quote's lines, and switches a new quote to them from Build it by hand", async () => {
  let engine = "old";
  const fetchMock = jest.fn(async (url: string, init?: { body?: string }) => ({
    json: async () => {
      if (String(url).startsWith("/api/workboard/quote-lines")) {
        if (init?.body) engine = JSON.parse(init.body).engine;
        return { ok: true, engine, lines: [], changes: [], names: {}, me: "u" };
      }
      return { ok: true, price: { ok: true, options: [] } };
    },
  }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  expect(screen.getByText("Builder, page, $64,790 inc GST")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Build it by hand" }));
  expect(await screen.findByText(/Lines builder/)).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/workboard/quote-lines", expect.objectContaining({ method: "POST", body: JSON.stringify({ job: JOB, op: "switch", engine: "lines" }) }));
});

it("opens a quote already switched on its lines", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => ({
    json: async () => (String(url).startsWith("/api/workboard/quote-lines") ? { ok: true, engine: "lines", lines: [], changes: [], names: {}, me: "u" } : { ok: true, price: { ok: true, options: [] } }),
  }));
  render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  expect(await screen.findByText(/Lines builder/)).toBeInTheDocument();
});
