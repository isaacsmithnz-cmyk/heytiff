import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

/* THE JOB'S PRICE TAB (the job page plan's build 10, 15 November 2026): every
   price on the job as a card, the one open below; the quote's paper with
   Open quote, which opens it in a tab of its own (the Price overhaul, 18
   November 2026), where the tab is the quote alone.
   The quote page's body moved here with it: a quote still on the old builder
   is switched to its lines as it opens (Isaac, 2026-10-12). */

const readClaim = jest.fn();
const readJobBookedVisits = jest.fn(async (..._a: unknown[]) => [] as unknown[]);
jest.mock("@/app/actions/workboard", () => ({ readClaim: (...a: unknown[]) => readClaim(...a), readJobBookedVisits: (...a: unknown[]) => readJobBookedVisits(...a) }));
const sendInvoiceToSm8 = jest.fn();
jest.mock("@/app/actions/invoice-sm8", () => ({ sendInvoiceToSm8: (...a: unknown[]) => sendInvoiceToSm8(...a) }));
/* the lines have a suite of their own: here, what the tab hands them */
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
jest.mock("@/components/shell/open-tabs", () => ({ openInTab: (href: string) => href }));
jest.mock("@/components/workboard/quote/lines-proposal-paper", () => ({ LinesProposalPaper: () => <p>The proposal&rsquo;s paper</p> }));
let quoteView: unknown = { ok: true, lines: [{ id: "l-1", optionIndex: 0 }], variations: [], names: {}, me: null, proposal: null };
jest.mock("@/components/workboard/quote/quote-lines-face", () => ({
  useQuoteLines: () => ({ view: quoteView }),
  QuoteLinesFace: ({ price, sm8, start, views, openAt, update }: { price: unknown; sm8: { value: string | null }; start?: boolean; views?: boolean; openAt?: number | null; update?: boolean }) => (
    <div>
      <p>{`Lines, ${sm8.value ?? "no value"}`}</p>
      {views && <p>Views over the left</p>}
      {start && <p>Starts at the reply box</p>}
      {openAt != null && <p>{`On option ${openAt}`}</p>}
      {update && <p>Update quote asked</p>}
      <p>{price === undefined ? "No price" : price ? "Priced" : "Price refused"}</p>
    </div>
  ),
}));
jest.mock("@/components/workboard/board/job-quote-send", () => ({ JobQuoteSend: () => null, sendVariation: jest.fn() }));

import { JobPriceTab } from "../job-price-tab";

const JOB = "a3539c01-9527-42a6-893b-24376269efbb";
const detail = { jobNumber: "3408", status: "Work Order", clientName: "Sharon Doyle", address: "1 Example St\nManly NSW 2095", geoLine: null, visits: [], workDone: null } as unknown as ComponentProps<typeof JobPriceTab>["detail"];
const facts = (over: Record<string, unknown> = {}) => ({ lines: 3, options: 1, toConfirm: 0, changedAt: null, talked: true, drafted: false, approved: false, version: 1, sent: null, accepted: [], ...over });
const landing = { name: "Return visit", startedAt: null, who: null, approvedBy: null, acceptedAt: null, totalCents: 77_500, money: true, versions: [], variations: [] };

let status: Record<string, unknown>;
let draft: Record<string, unknown>;
let engine = "lines";
let switches = true;
let fetchMock: jest.Mock;
beforeEach(() => {
  status = { ok: true, facts: facts(), landing };
  draft = {
    ok: true,
    draft: {
      ok: true,
      quoted: false,
      invoiced: false,
      jobNumber: "3221",
      from: { days: ["2026-11-11"], used: 2 },
      lines: [
        { key: "labour:2026-11-11", kind: "labour", name: "Labour, Wed 11 Nov", detail: "Isaac 3.5 h", qty: 3.5, unit: "h", unitSellCents: 14_000, unitCostCents: null, sent: false },
        { key: "used:rexel|uf24|", kind: "material", name: "Ultrafil 24x24x4", detail: "1 used, Wed 11 Nov", qty: 1, unit: null, unitSellCents: 8_894, unitCostCents: 6_353, sent: false },
        { key: "used:|hydrex|", kind: "material", name: "Hydrex tablets", detail: "6 used, Wed 11 Nov", qty: 6, unit: null, unitSellCents: null, unitCostCents: null, sent: false },
      ],
    },
  };
  sendInvoiceToSm8.mockReset().mockResolvedValue({ ok: true, trial: false, sent: 2, lines: 2, waiting: 0, failed: [], said: "2 of 2 lines on job 3221 in ServiceM8." });
  engine = "lines";
  switches = true;
  push.mockReset();
  quoteView = { ok: true, lines: [{ id: "l-1", optionIndex: 0 }], variations: [], names: {}, me: null, proposal: null };
  fetchMock = jest.fn(async (url: string, init?: { body?: string }) => ({
    ok: true,
    json: async () => {
      if (String(url).startsWith("/api/workboard/quote-status")) return status;
      if (String(url).startsWith("/api/workboard/invoice-draft")) return draft;
      if (String(url).startsWith("/api/workboard/job-tracker")) return { ok: true, tracker: { labour: {}, materials: { count: 3 }, equipment: {} } };
      if (String(url).startsWith("/api/workboard/quote-lines")) {
        if (init?.body) {
          if (!switches) return { ok: false };
          engine = JSON.parse(init.body).engine;
          return { ok: true };
        }
        return { ok: true, engine };
      }
      return { ok: true, price: { ok: true, options: [] } };
    },
  }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  readClaim.mockReset().mockResolvedValue({
    ledger: { materials: [{ remoteId: "m-1", name: "Initial Service of Systems", quantity: 1, unitCents: 35_000, taxInclusive: false, lineCents: 35_000, exLineCents: 35_000 }], payments: [] },
    notes: [],
    media: { photos: [], documents: [{ remoteId: "inv", name: "Invoice #3408", fileType: ".pdf", kind: "document", origin: "Invoice", takenAt: null, url: "https://files.example/3408.pdf", width: null, height: null, fromClaim: null }], elsewhere: [], truncated: false },
  });
});

const sm8None = { papers: [], sentOn: null, value: null };
const billing = {
  value: { cents: 35_000, basis: "ex" as const },
  quoted: null,
  segments: null,
  figures: { paid: 0, waiting: 35_000, tocome: 0 },
  staged: false,
  rows: [{ claimId: JOB, name: "Invoice", line: "Invoice #3408, due Wed 25 Nov", percent: 100, cents: 35_000, basis: "ex" as const, word: "Awaiting", tone: "look" as const }],
  overdue: null,
  fact: null,
};
const claims = [{ remoteId: JOB, jobNumber: "3408", index: 1, stage: "Final" as const, amountCents: 38_500, basis: "inc" as const, exCents: 35_000, percent: 100, raisedOn: "2026-11-11", paidCents: 0, paidOn: null, state: "awaiting" as const, dueOn: "2026-11-25", overdueDays: null }];

const draw = (over: Partial<ComponentProps<typeof JobPriceTab>> = {}) =>
  render(
    <JobPriceTab
      job={JOB}
      ready
      moneyVisible
      financials
      detail={detail}
      sm8={sm8None}
      billing={billing}
      claims={claims}
      materials={[]}
      ask={null}
      onOpenPaper={jest.fn()}
      onToast={jest.fn()}
      {...over}
    />
  );
/* QUOTES AND INVOICES: every price on the job as a row (the Price overhaul, C) */
const prices = () => within(screen.getByRole("list", { name: "The job's prices" }));
/** the row whose words match, found once the list is up */
const findRow = async (words: RegExp) => {
  await screen.findByRole("list", { name: "The job's prices" });
  return waitFor(() => {
    const hit = prices().getAllByRole("listitem").find((li) => words.test(li.textContent ?? ""));
    if (!hit) throw new Error(`no row ${words}`);
    return hit;
  });
};
const pick = async (words: RegExp) => userEvent.click(within(await findRow(words)).getByRole("button"));

it("lays the job's prices across the top, the quote's paper under them with Open quote, the invoice beside it", async () => {
  draw();
  const quote = await findRow(/Return visit/);
  expect(quote).toHaveAttribute("aria-current", "true");
  expect(quote).toHaveTextContent("Quote, $775.00 ex GST");
  /* owed said one way, as Billing's row says it */
  const invoice = await findRow(/Invoice #3408/);
  expect(invoice).toHaveTextContent("Invoice #3408, $350 ex GST");
  expect(invoice).toHaveTextContent("Awaiting");
  /* the paper as the customer gets it, read only; the quote opens in a tab of its own (the Price overhaul, 18 November 2026) */
  expect(await screen.findByText("The proposal’s paper")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open quote" })).toHaveAttribute("href", `/dashboard/jobs/${JOB}/quote`);
  expect(screen.queryByText("Views over the left")).toBeNull();
});

it("in the quote's own tab, is the quote alone, with no prices over it", async () => {
  draw({ doc: "quote" });
  expect(await screen.findByText("Views over the left")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "The job's prices" })).toBeNull();
});

it("opens an invoice on its paper, with its figure and word down the right", async () => {
  draw();
  await pick(/Invoice #3408/);
  expect(await findRow(/Invoice #3408/)).toHaveAttribute("aria-current", "true");
  expect(await screen.findByLabelText("Invoice #3408", { selector: "iframe" })).toHaveAttribute("src", "https://files.example/3408.pdf#toolbar=0&navpanes=0&view=FitH");
  const rail = within(screen.getByRole("complementary", { name: "Invoice #3408" }));
  expect(rail.getByText("$350")).toBeInTheDocument();
  /* the job's one invoice is the job itself: its notes aren't written on the invoice (the walk of 15 November 2026) */
  expect(rail.queryByText("Written on it")).toBeNull();
  expect(rail.getByText("Awaiting")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "Line items" }));
  expect(screen.getByText("Initial Service of Systems")).toBeInTheDocument();
});

it("says what the job's invoice was built from: the visits oldest first, the work done, what was used", async () => {
  draw({
    detail: {
      ...detail!,
      visits: [
        { day: "2026-11-11", minutes: 60, crew: [{ name: "Isaac Smith" }] },
        { day: "2026-10-14", minutes: 90, crew: [{ name: "Isaac Smith" }, { name: "Luke Brown" }] },
      ],
      workDone: "Cleaned the existing filters and serviced the outdoor unit. Checked the drains.",
    } as unknown as ComponentProps<typeof JobPriceTab>["detail"],
  });
  await pick(/Invoice #3408/);
  const built = within(await screen.findByRole("region", { name: "Built from" }));
  expect(built.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    "Visit, Wed 14 OctIsaac Smith, Luke Brown, 1h 30m",
    "Visit, Wed 11 NovIsaac Smith, 1h",
    "Work doneCleaned the existing filters and serviced the outdoor unit.",
    "Used3 things",
  ]);
});

it("counts a past booking nobody checked in on that the booking's own read says was a visit, as booked", async () => {
  readJobBookedVisits.mockResolvedValueOnce([{ day: "2026-10-14", who: "Isaac Smith", minutes: 60 }]);
  draw();
  await pick(/Invoice #3408/);
  const built = within(await screen.findByRole("region", { name: "Built from" }));
  expect(await built.findByText("Isaac Smith, booked 1h")).toBeInTheDocument();
  expect(built.getByText("Visit, Wed 14 Oct")).toBeInTheDocument();
  expect(built.queryByText("No time on site recorded")).toBeNull();
});

it("says so when the job's invoice has no visits and no work done", async () => {
  draw();
  await pick(/Invoice #3408/);
  const built = within(await screen.findByRole("region", { name: "Built from" }));
  expect(await built.findByText("3 things")).toBeInTheDocument();
  expect(built.getByText("No time on site recorded")).toBeInTheDocument();
  expect(built.getByText("Nothing written")).toBeInTheDocument();
});

/* AN INVOICE IN A TAB OF ITS OWN (the Price overhaul, decision 6: "1", the
   quote's shape): Breakdown and Invoice across the page, the rest of the
   job's billing beside it, ServiceM8's green to open it there, and the head
   told its word, its name and its number */
it("in an invoice's own tab, lays Breakdown and Invoice across it, and tells the head where it's up to", async () => {
  const onDocStage = jest.fn();
  draw({ doc: "invoice", ask: { invoice: JOB, n: 1 }, onDocStage });
  const tabs = await screen.findByRole("tablist", { name: "The invoice" });
  expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Breakdown", "Invoice"]);
  expect(within(tabs).getByRole("tab", { name: "Invoice" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByLabelText("Invoice #3408", { selector: "iframe" })).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "The job's prices" })).toBeNull();
  const rail = within(screen.getByRole("complementary", { name: "Invoice #3408" }));
  expect(rail.getByRole("region", { name: "Of the job" })).toHaveTextContent("Invoice");
  expect(rail.getByRole("link", { name: "Open in ServiceM8" })).toHaveClass("pt-btn--sm8");
  expect(rail.queryByRole("link", { name: "Open invoice" })).toBeNull();
  await waitFor(() => expect(onDocStage).toHaveBeenLastCalledWith(expect.objectContaining({ word: "Awaiting", tone: "look", label: "Invoice #3408" })));
  await userEvent.click(within(tabs).getByRole("tab", { name: "Breakdown" }));
  expect(await screen.findByText("Initial Service of Systems")).toBeInTheDocument();
});

it("on the Price tab, offers to open an invoice in its own tab", async () => {
  draw();
  await pick(/Invoice #3408/);
  expect(await screen.findByRole("link", { name: "Open invoice" })).toHaveAttribute("href", `/dashboard/jobs/${JOB}/invoice/${JOB}`);
});

it("opens on the invoice a door asked for", async () => {
  draw({ ask: { invoice: JOB.toUpperCase(), n: 1 } });
  expect(await findRow(/Invoice #3408/)).toHaveAttribute("aria-current", "true");
});

it("shows a tech no invoice, and reads no price without the money grants", async () => {
  draw({ moneyVisible: false, financials: false, billing: null });
  expect(await screen.findByText("Open the quote to see its work and talk it through with Tiff.")).toBeInTheDocument();
  expect(screen.queryByText("The proposal’s paper")).toBeNull();
  expect(prices().queryAllByRole("listitem").filter((li) => /Invoice/.test(li.textContent ?? ""))).toHaveLength(0);
  expect(readClaim).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/api/workboard/quote-price"))).toBe(false);
});

it("offers New quote, orange, on a job with no price, and starts it at the reply box", async () => {
  status = { ok: true, facts: facts({ lines: 0, talked: false }), landing: null };
  draw({ billing: null, claims: [] });
  expect(await screen.findByText("No quote on this job yet")).toBeInTheDocument();
  const button = screen.getByRole("button", { name: "New quote" });
  expect(button).toHaveClass("pt-btn--quote");
  await userEvent.click(button);
  /* in a tab of its own, the reply box ready for the brief */
  expect(push).toHaveBeenCalledWith(`/dashboard/jobs/${JOB}/quote?start=1`);
});

it("draws no empty list on a job with no price: New invoice stands with New quote (bug 62)", async () => {
  status = { ok: true, facts: facts({ lines: 0, talked: false }), landing: null };
  draw({ billing: null, claims: [] });
  expect(await screen.findByText("No quote on this job yet")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Quotes and invoices" })).toBeNull();
  expect(screen.getByRole("button", { name: "New invoice" })).toBeInTheDocument();
});

it("opens the quote's own tab on what a door asked: the start, an option, Update quote", async () => {
  status = { ok: true, facts: facts({ lines: 0, talked: false }), landing: null };
  const { unmount } = draw({ ask: { start: true, n: 1 } });
  await waitFor(() => expect(push).toHaveBeenCalledWith(`/dashboard/jobs/${JOB}/quote?start=1`));
  unmount();
  draw({ ask: { option: 2, update: true, n: 1 } });
  await waitFor(() => expect(push).toHaveBeenLastCalledWith(`/dashboard/jobs/${JOB}/quote?option=2&update=1`));
});

/* the list's foot says what can be made now (decision 8): a variation once
   the customer has accepted, never a second quote */
it("offers Add a variation under the list once the quote's accepted, and opens it in the quote's tab", async () => {
  status = { ok: true, facts: facts({ accepted: [0] }), landing };
  draw();
  await userEvent.click(await screen.findByRole("button", { name: "Add a variation" }));
  expect(push).toHaveBeenCalledWith(`/dashboard/jobs/${JOB}/quote?update=1`);
  expect(screen.queryByRole("button", { name: "New quote" })).toBeNull();
});

it("hands the quote in its own tab what the address asked: the start, an option, Update quote", async () => {
  status = { ok: true, facts: facts({ lines: 0, talked: false }), landing: null };
  const { unmount } = draw({ doc: "quote", ask: { start: true, n: 1 } });
  expect(await screen.findByText("Starts at the reply box")).toBeInTheDocument();
  unmount();
  status = { ok: true, facts: facts(), landing };
  draw({ doc: "quote", ask: { option: 2, update: true, n: 1 } });
  expect(await screen.findByText("On option 2")).toBeInTheDocument();
  expect(screen.getByText("Update quote asked")).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});

it("stands ServiceM8's own quote in for one never built here, with Update quote in orange", async () => {
  status = { ok: true, facts: facts({ lines: 0, talked: false }), landing: null };
  const paper = { remoteId: "q", name: "Quote #3408", fileType: ".pdf", kind: "document" as const, origin: "Quote", takenAt: null, url: "https://files.example/q.pdf", width: null, height: null, fromClaim: null };
  draw({ sm8: { papers: [paper], sentOn: "2026-11-11", value: "$775 ex GST" }, billing: null, claims: [] });
  expect(await findRow(/Quote, in ServiceM8/)).toHaveAttribute("aria-current", "true");
  expect(screen.getByLabelText("Quote #3408")).toHaveAttribute("src", "https://files.example/q.pdf#toolbar=0&navpanes=0&view=FitH");
  expect(screen.getByText("Typed in ServiceM8, so there’s no chat with Tiff behind it.")).toBeInTheDocument();
  const update = screen.getByRole("button", { name: "Update quote" });
  expect(update).toHaveClass("pt-btn--quote");
  await userEvent.click(update);
  expect(push).toHaveBeenCalledWith(`/dashboard/jobs/${JOB}/quote?start=1`);
});

it("switches a quote still on the old builder to its lines as it opens", async () => {
  engine = "old";
  draw({ doc: "quote" });
  expect(await screen.findByText("Views over the left")).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === "POST")).toEqual([
    ["/api/workboard/quote-lines", expect.objectContaining({ body: JSON.stringify({ job: JOB, op: "switch", engine: "lines" }) })],
  ]);
});

it("says when the quote couldn't be opened, and Try again opens it", async () => {
  engine = "old";
  switches = false;
  draw({ doc: "quote" });
  expect(await screen.findByText("The quote couldn’t be opened.")).toBeInTheDocument();
  switches = true;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Views over the left")).toBeInTheDocument();
});

it("says when where the quote stands wasn't read, and reads it again", async () => {
  status = { ok: false };
  draw({ billing: null, claims: [] });
  expect(await screen.findByText("The quote wasn't read")).toBeInTheDocument();
  status = { ok: true, facts: facts(), landing };
  await userEvent.click(screen.getByRole("button", { name: "Read the quote again" }));
  expect(await findRow(/Return visit/)).toBeInTheDocument();
});

describe("New invoice", () => {
  it("is offered to whoever sees money and the business's figures, and to nobody else", async () => {
    draw({ moneyVisible: false, financials: false, billing: null });
    await screen.findByText("Open the quote to see its work and talk it through with Tiff.");
    expect(screen.queryByRole("button", { name: "New invoice" })).toBeNull();
  });

  it("offers the hours and what was used, each ticked, and puts only the ticked on the job, by a press", async () => {
    draw({ billing: null, claims: [] });
    await userEvent.click(await screen.findByRole("button", { name: "New invoice" }));
    expect(await findRow(/New invoice/)).toHaveAttribute("aria-current", "true");
    const rail = within(await screen.findByRole("complementary", { name: "New invoice" }));
    expect(await screen.findByText("Labour, Wed 11 Nov")).toBeInTheDocument();
    /* 3.5 h at $140, and the filter at the book's cost and markup */
    expect(rail.getByText("$578.94")).toBeInTheDocument();
    expect(rail.getByText("Wed 11 Nov on site, and 2 things used")).toBeInTheDocument();
    /* the tablets have no price: no tick, and they can't go */
    expect(screen.getByText("No price in the book")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Hydrex/ })).toBeNull();

    await userEvent.click(screen.getByRole("checkbox", { name: "Put Ultrafil 24x24x4 on the job" }));
    expect(rail.getByText("$490")).toBeInTheDocument();
    expect(sendInvoiceToSm8).not.toHaveBeenCalled();

    const send = rail.getByRole("button", { name: "Send to ServiceM8" });
    expect(send).toHaveClass("pt-btn--sm8");
    await userEvent.click(send);
    expect(sendInvoiceToSm8).toHaveBeenCalledWith(JOB, ["labour:2026-11-11"]);
    expect(await rail.findByText("2 of 2 lines on job 3221 in ServiceM8.")).toBeInTheDocument();
  });

  it("previews the invoice ServiceM8 will make: the job's lines, then the ticked ones", async () => {
    const onJob = [{ remoteId: "m-1", name: "Annual Maintenance Service 3hrs", quantity: 1, unitCents: 56_000, taxInclusive: false, lineCents: 56_000, exLineCents: 56_000 }];
    draw({ billing: null, claims: [], materials: onJob });
    await userEvent.click(await screen.findByRole("button", { name: "New invoice" }));
    await userEvent.click(await screen.findByRole("radio", { name: "Preview" }));
    const paper = within(screen.getByRole("article", { name: "The invoice" }));
    expect(paper.getByText("Invoice 3408")).toBeInTheDocument();
    expect(paper.getByText("Annual Maintenance Service 3hrs")).toBeInTheDocument();
    expect(paper.getByText("Labour, Wed 11 Nov")).toBeInTheDocument();
    expect(paper.getByText("$1,138.94")).toBeInTheDocument();
  });

  it("says what to set where the business hasn't priced its hours", async () => {
    draft = { ok: true, draft: { ok: false, why: "Set a charge-out rate in Quoting to price an invoice." } };
    draw({ billing: null, claims: [] });
    await userEvent.click(await screen.findByRole("button", { name: "New invoice" }));
    expect(await screen.findByText("Set a charge-out rate in Quoting to price an invoice.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to ServiceM8" })).toBeDisabled();
  });
});
