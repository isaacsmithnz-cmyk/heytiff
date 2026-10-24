import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RecordsContext } from "@/components/records/records-context";
import { arrive, closeTab, tabsSnapshot } from "@/components/shell/open-tabs";

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
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
/* the lines have a suite of their own: here, what the page lays out around
   them and what it hands them */
jest.mock("../quote-lines-face", () => ({
  QuoteLinesFace: ({
    price,
    sm8,
    send,
    onStage,
    onOpenPaper,
    start,
  }: {
    price: { ok: boolean } | null | undefined;
    sm8: { value: string | null; papers: { remoteId: string; name: string }[] };
    send: React.ReactNode;
    onStage: (s: { word: string; settle: boolean }) => void;
    onOpenPaper: (p: unknown) => void;
    start?: boolean;
  }) => (
    <div>
      <p>{`Lines, ${sm8.value ?? "no value"}`}</p>
      {start && <p>Starts at the reply box</p>}
      <p>{price === undefined ? "No price" : price ? "Priced" : "Price refused"}</p>
      <button type="button" onClick={() => onStage({ word: "4 to settle", settle: true })}>
        Settle four
      </button>
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
const detail = { jobNumber: "2905", status: "Work Order", categoryColour: "#2E68FF", clientName: "Heuvel Construction", address: "44 Leinster Street\nPaddington NSW 2021", geoLine: null, quoteSentOn: "2026-09-01", money: { valueCents: 6_479_000 } } as unknown as Parameters<typeof QuoteScreen>[0]["detail"];

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

/* layout C (Isaac, 18 October 2026): above the conversation only the job's
   name, one grey line and the section tabs */
it("heads the page with the job's name, one grey line and the job's section tabs, and no breadcrumb", async () => {
  const { container } = render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  /* the job came from the server: the head is final on first paint */
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Heuvel Construction");
  expect(screen.getByText("Work order, Job 2905, 44 Leinster Street, Paddington NSW 2021.")).toBeInTheDocument();
  /* no way back above the name: the open tab and Jobs in the sidebar say where you are */
  expect(screen.queryByRole("link", { name: "Job 2905" })).toBeNull();
  expect(container.querySelector(".wb2-crumbline, .int-back")).toBeNull();
  /* the job's colour, snapped to the eight, beside its line */
  expect(container.querySelector(".qp-line .pt-dot--blue")).not.toBeNull();
  const tabs = screen.getByRole("tablist", { name: "The job" });
  expect(within(tabs).getAllByRole("tab").map((t) => t.querySelector(".pt-stab-word")!.textContent)).toEqual(["Overview", "Quote", "Visits", "Materials", "Photos", "Documents", "Billing"]);
  expect(within(tabs).getByRole("tab", { name: "Quote" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByText("Lines, $64,790 inc GST")).toBeInTheDocument();
  /* the price is read for the quote's lines, and handed to them */
  await waitFor(() => expect(screen.getByText("Priced")).toBeInTheDocument());
  expect(screen.getByText("Send block, lines-0")).toBeInTheDocument();
  expect(posts()).toHaveLength(0);
});

it("puts the quote's state word at the end of the grey line, orange while something is left to settle", async () => {
  render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  fireEvent.click(await screen.findByRole("button", { name: "Settle four" }));
  const word = screen.getByText("4 to settle");
  expect(word).toHaveClass("qp-stage", "settle");
  expect(word.closest(".qp-line")).not.toBeNull();
});

/* a job is a page now (v2, step 5): each other tab goes to the job's own
   page on that section, not to its card over this page */
it("takes each other tab to the job's page on that section, and stays on Quote", async () => {
  const open = jest.fn();
  render(
    <RecordsContext.Provider value={{ hosted: true, open }}>
      <QuoteScreen job={JOB} detail={detail} moneyVisible financials />
    </RecordsContext.Provider>
  );
  await screen.findByText("Lines, $64,790 inc GST");
  expect(screen.getByRole("tab", { name: "Billing" })).toHaveAttribute("href", `/dashboard/jobs/${JOB}?tab=billing`);
  expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("href", `/dashboard/jobs/${JOB}`);
  expect(screen.getByRole("tab", { name: /Photos/ })).toHaveAttribute("href", `/dashboard/jobs/${JOB}?tab=photos`);
  /* no numbers on the sections (Isaac, 20 October) */
  expect(screen.getByRole("tab", { name: /Documents/ })).toHaveTextContent(/^Documents$/);
  /* the tab you're on goes nowhere */
  expect(screen.getByRole("tab", { name: "Quote" })).not.toHaveAttribute("href");
  fireEvent.click(screen.getByRole("tab", { name: "Quote" }));
  expect(open).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

it("leaves Billing out of the job's tabs for someone without the money", async () => {
  render(<QuoteScreen job={JOB} detail={detail} moneyVisible={false} financials={false} />);
  await screen.findByText("Lines, no value");
  const tabs = screen.getByRole("tablist", { name: "The job" });
  expect(within(tabs).getAllByRole("tab").map((t) => t.querySelector(".pt-stab-word")!.textContent)).toEqual(["Overview", "Quote", "Visits", "Materials", "Photos", "Documents"]);
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

/* Isaac, 21 October 2026, as Design's Open job: "so that you can quickly go
   back to the job if there isn't a tab already open for it" */
it("links back to the job under its name: the tab that holds it, on the section it was left on, else the job's page", async () => {
  render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  const link = screen.getByRole("link", { name: "Open job 2905" });
  expect(link.closest(".qp-line")).not.toBeNull();
  expect(link).toHaveAttribute("href", `/dashboard/jobs/${JOB}`);
  act(() => arrive(`/dashboard/jobs/${JOB}?tab=visits`));
  expect(link).toHaveAttribute("href", `/dashboard/jobs/${JOB}?tab=visits`);
  await screen.findByText("Lines, $64,790 inc GST");
  act(() => {
    for (const t of tabsSnapshot().tabs) closeTab(t.id);
  });
});
