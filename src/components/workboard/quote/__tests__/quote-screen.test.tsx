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
/* the builder and the price have suites of their own: here, what the page lays out around them */
let drafted = true;
jest.mock("../../board/job-quote-face", () => ({
  JobQuoteFace: ({ mode, onVersion, onCancel, sm8, children }: { mode: string; onVersion: (v: string | null) => void; onCancel: () => void; sm8: { value: string | null }; children: React.ReactNode }) => {
    useEffect(() => onVersion(drafted ? "v1" : null), [onVersion]);
    return (
      <div>
        <p>{`Builder, ${mode}, ${sm8.value ?? "no value"}`}</p>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        {children}
      </div>
    );
  },
}));
jest.mock("../../board/job-quote-labour", () => ({ JobQuoteLabour: () => <p>Labour</p> }));
jest.mock("../../board/job-quote-price", () => ({ JobQuotePrice: ({ version }: { version: string }) => <p>{`Price block, ${version}`}</p> }));
jest.mock("../../board/job-quote-send", () => ({ JobQuoteSend: () => <p>Send block</p> }));
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

it("lays the quote out full screen: the way back to the job card's Quote, the builder, ServiceM8's quote and the price beside it", async () => {
  render(<QuoteScreen job={JOB} detail={detail} moneyVisible financials />);
  /* the job came from the server: the band is final on first paint */
  expect(screen.getByRole("link", { name: "Job 2905" })).toHaveAttribute("href", `/dashboard/workboard?job=${JOB}&face=quote`);
  expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent(/^Quote$/);
  expect(screen.getByText("Builder, page, $64,790 inc GST")).toBeInTheDocument();
  expect(screen.getByText("Labour")).toBeInTheDocument();
  expect(await screen.findByText("Quote from ServiceM8")).toBeInTheDocument();
  expect(screen.getByText("Sent Tue 1 Sept, $64,790 inc GST")).toBeInTheDocument();
  /* the price reads each version afresh, not remounted */
  await waitFor(() => expect(screen.getByText("Price block, v1")).toBeInTheDocument());
  expect(screen.getByText("Send block")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(push).toHaveBeenCalledWith(`/dashboard/workboard?job=${JOB}&face=quote`);
});

it("shows no money, price or send to someone without the money grants", async () => {
  render(<QuoteScreen job="j-1" detail={detail} moneyVisible={false} financials={false} />);
  expect(screen.getByText("Builder, page, no value")).toBeInTheDocument();
  expect(await screen.findByText("Quote from ServiceM8")).toBeInTheDocument();
  expect(screen.queryByText(/Price block/)).toBeNull();
  expect(screen.queryByText("Send block")).toBeNull();
  expect(readJobRecord).not.toHaveBeenCalled();
});

it("has no column beside the builder on a job ServiceM8 never quoted, until there's a price", async () => {
  drafted = false;
  readJobFiles.mockResolvedValue({ documents: [], photos: [], elsewhere: [] });
  const { container } = render(<QuoteScreen job="j-1" detail={{ ...detail, quoteSentOn: null }} moneyVisible financials />);
  await waitFor(() => expect(readJobFiles).toHaveBeenCalled());
  expect(screen.getByText("Builder, page, $64,790 inc GST")).toBeInTheDocument();
  expect(container.querySelector(".wb2-insp")).toBeNull();
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
