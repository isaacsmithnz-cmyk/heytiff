/* The job sheet's new depth — everything here was already IN the mirror and
   rendered nowhere: the checklist with its ticks, recorded time on site, the
   booking's end time, the dispatch queue, contact emails, the category's own
   colour. The sheet is where "we sync it" has to become "you can see it". */

import { render, screen, within } from "@testing-library/react";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { AllJobRow } from "@/lib/workboard/all-jobs";

const readMirrorJob = jest.fn(async (): Promise<MirrorJobDetail | null> => null);
const createProjectFromJob = jest.fn(async () => ({ ok: true as const, id: "p-new" }));
jest.mock("@/app/actions/workboard", () => ({
  readMirrorJob: (...a: unknown[]) => readMirrorJob(...(a as [])),
  createProjectFromJob: (...a: unknown[]) => createProjectFromJob(...(a as [])),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { JobSheet } from "../job-sheet";

const row = (over: Partial<AllJobRow> = {}): AllJobRow => ({
  key: "sm8:j-1",
  kind: "sm8",
  id: "j-1",
  number: "3137",
  numberSystem: "sm8",
  clientName: "Laing + Simmons Double Bay",
  title: "Daikin multi change-over",
  suburb: "Rose Bay",
  categoryName: "Install",
  categoryColour: "#e7b5ff",
  statusLabel: "Work Order",
  tone: "",
  date: "2026-08-08 09:00:00",
  dateLabel: "raised",
  booked: true,
  tracked: null,
  money: null,
  sortOn: "2026-08-08",
  ...over,
});

/** The detail as the loader would hand it over for #3137's shape — the same
    job the derivation was validated against in the live mirror. */
const detail = (over: Partial<MirrorJobDetail> = {}): MirrorJobDetail => ({
  remoteId: "j-1",
  jobNumber: "3137",
  status: "Work Order",
  clientName: "Laing + Simmons Double Bay",
  description: "Supply and install Daikin multi system",
  workDone: null,
  address: null,
  suburb: "Rose Bay",
  geoLine: "Rose Bay NSW 2029",
  categoryName: "Install",
  categoryColour: "#e7b5ff",
  purchaseOrder: null,
  date: "2026-07-30 11:53:00",
  quoteDate: null,
  workOrderDate: "2026-08-04 09:00:00",
  completionDate: null,
  nextBooking: {
    start: "2026-08-14 07:30:00",
    end: "2026-08-14 15:30:00",
    staffName: "Alex Lorenz",
  },
  timeOnSite: { minutes: 1110, sessions: 2 },
  queue: { name: "Parts on Order", expiry: "2026-08-20", staffName: "Luke Ingold" },
  checklist: [
    { name: "Isolate power", itemType: "Todo", section: null, done: true, doneOn: "2026-08-13", doneBy: "Callum Vrieze" },
    { name: "Site photos", itemType: "Photo", section: "Handover", done: false, doneOn: null, doneBy: null },
    { name: "DAS Service Call", itemType: "Form", section: "Handover", done: false, doneOn: null, doneBy: null },
  ],
  contacts: [
    { name: "Josh", type: "Property Manager", phone: "0426 719 412", email: "josh@lsdb.com.au" },
  ],
  money: null,
  ...over,
});

const noop = () => {};
const props = {
  manage: false,
  moneyVisible: false,
  onClose: noop,
  onCreateAgreement: noop,
  onOpenTracked: noop,
  onToast: noop,
};

describe("the sheet renders what the mirror already held", () => {
  it("shows the checklist grouped by section, with who ticked what", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText("Their checklist — 1 of 3 done")).toBeInTheDocument();
    expect(screen.getByText("Handover")).toBeInTheDocument();

    const done = screen.getByText("Isolate power").closest(".wb2-ckrow")!;
    expect(done.className).toContain("done");
    expect(within(done as HTMLElement).getByText("Callum Vrieze · Thu 13 Aug")).toBeInTheDocument();

    const form = screen.getByText("DAS Service Call").closest(".wb2-ckrow")!;
    expect(form.className).not.toContain("done");
    expect(within(form as HTMLElement).getByText("Form")).toBeInTheDocument();
  });

  it("says the recorded time in ServiceM8's own billing shape", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText("18h 30m")).toBeInTheDocument();
    expect(screen.getByText("recorded across 2 visits")).toBeInTheDocument();
  });

  it("gives the next booking its end time and the queue its own fact", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText("7:30am–3:30pm Fri 14 Aug")).toBeInTheDocument();
    expect(screen.getByText("Parts on Order")).toBeInTheDocument();
    expect(screen.getByText("Luke Ingold · until Thu 20 Aug")).toBeInTheDocument();
  });

  it("falls back to the geo line when the job has no written address", async () => {
    readMirrorJob.mockResolvedValueOnce(detail({ address: null }));
    render(<JobSheet row={row()} {...props} />);
    expect(await screen.findByText("Rose Bay NSW 2029")).toBeInTheDocument();
  });

  it("renders a contact's email as a mailto link", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    render(<JobSheet row={row()} {...props} />);

    const link = (await screen.findByText("josh@lsdb.com.au")) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("mailto:josh@lsdb.com.au");
  });

  it("wears the category colour as a dot, never as the chip surface", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    const { container } = render(<JobSheet row={row()} {...props} />);

    await screen.findByText("18h 30m");
    const dot = document.querySelector(".wb2-catdot") as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.background).toBe("rgb(231, 181, 255)");
    expect(container).toBeDefined();
  });
});

describe("money stays behind its grant", () => {
  it("says when the quote went out, for a reader who holds money", async () => {
    readMirrorJob.mockResolvedValueOnce(
      detail({
        money: {
          valueCents: 685000,
          invoiced: false,
          invoicedOn: null,
          quoteSent: true,
          quoteSentOn: "2026-08-03",
          paid: false,
          paidOn: null,
        },
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(await screen.findByText("Quote sent Mon 3 Aug")).toBeInTheDocument();
    expect(screen.getByText("$6,850")).toBeInTheDocument();
  });

  it("renders no money fact at all without the grant, whatever the detail says", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText("18h 30m");
    expect(screen.queryByText("Job value")).toBeNull();
  });
});

describe("the work-order-since fact", () => {
  it("shows for a work order and stays quiet for anything else", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    const { unmount } = render(<JobSheet row={row()} {...props} />);
    expect(await screen.findByText("Work order")).toBeInTheDocument();
    expect(screen.getByText("Tue 4 Aug")).toBeInTheDocument();
    unmount();

    readMirrorJob.mockResolvedValueOnce(detail({ status: "Quote" }));
    render(<JobSheet row={row({ statusLabel: "Quote" })} {...props} />);
    await screen.findByText("18h 30m");
    expect(screen.queryByText("Work order")).toBeNull();
  });
});
