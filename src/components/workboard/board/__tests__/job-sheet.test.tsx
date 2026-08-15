/* The job sheet's new depth — everything here was already IN the mirror and
   rendered nowhere: the checklist with its ticks, recorded time on site, the
   booking's end time, the dispatch queue, contact emails, the category's own
   colour. The sheet is where "we sync it" has to become "you can see it". */

import { render, screen, waitFor, within } from "@testing-library/react";
import type { JobDesign, MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { CacheJobFilesResult } from "@/app/actions/workboard-media";
import type { JobRecordRead } from "@/app/actions/workboard";
import type { AllJobRow } from "@/lib/workboard/all-jobs";

const readMirrorJob = jest.fn(async (): Promise<MirrorJobDetail | null> => null);
const createProjectFromJob = jest.fn(async () => ({ ok: true as const, id: "p-new" }));
/* A job with no files is the common case and the default here, so every test
   renders the sheet WITHOUT a files section unless it asks for one. */
const readJobFiles = jest.fn(async (): Promise<JobMediaGroupsRead | null> => null);
/* Notes always; ledger null for a reader without money — the SERVER decides. */
const readJobRecord = jest.fn(async (): Promise<JobRecordRead | null> => null);
jest.mock("@/app/actions/workboard", () => ({
  readMirrorJob: (...a: unknown[]) => readMirrorJob(...(a as [])),
  readJobFiles: (...a: unknown[]) => readJobFiles(...(a as [])),
  readJobRecord: (...a: unknown[]) => readJobRecord(...(a as [])),
  createProjectFromJob: (...a: unknown[]) => createProjectFromJob(...(a as [])),
}));
/* Mocked for its CONTENT below, but it would have to be mocked regardless:
   a "use server" module drags next/server into jsdom, where `Request` is
   undefined and the whole suite fails to load. */
const cacheJobFiles = jest.fn(
  async (): Promise<CacheJobFilesResult> => ({
    ok: true,
    cached: 0,
    remaining: 0,
    media: null,
    note: null,
  })
);
jest.mock("@/app/actions/workboard-media", () => ({
  cacheJobFiles: (...a: unknown[]) => cacheJobFiles(...(a as [])),
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
  designs: [],
  ...over,
});

/* Call COUNTS are the assertion in the caching tests, so a leaked count from
   a neighbour would read as a loop that ran too many rounds. */
beforeEach(() => {
  readMirrorJob.mockReset();
  readJobFiles.mockReset();
  readJobRecord.mockReset();
  cacheJobFiles.mockReset();
  readMirrorJob.mockResolvedValue(null);
  readJobFiles.mockResolvedValue(null);
  readJobRecord.mockResolvedValue(null);
  cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 0, media: null, note: null });
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
    expect(screen.queryByText(/Job value/)).toBeNull();
  });

  /* Settled against the live account 2026-08-15: ServiceM8's job total is
     tax-INCLUSIVE. The basis rides the label, because the same figure feeds a
     project's claims and a budget typed on the other basis would misreport
     progress by ten per cent. */
  it("says which basis the figure is on", async () => {
    readMirrorJob.mockResolvedValueOnce(
      detail({
        money: {
          valueCents: 148500,
          invoiced: null,
          invoicedOn: null,
          quoteSent: null,
          quoteSentOn: null,
          paid: false,
          paidOn: null,
        },
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);

    /* Await the FIGURE, not the label: the label renders on the first paint
       (it's gated only on the money grant) while the amount arrives with the
       detail fetch a beat later. */
    expect(await screen.findByText("$1,485")).toBeInTheDocument();
    expect(screen.getByText(/Job value \(inc GST\)/)).toBeInTheDocument();
  });

  /* THE LIE THIS REPLACED. ServiceM8 sends no invoice_sent key on this
     account — every one of 3,455 jobs null — and reading that as `false` put
     "Not invoiced" under a figure nobody had told us anything about. Silence
     is the honest answer; the payments ledger answers properly when it can. */
  it("stays silent about invoicing when ServiceM8 never said", async () => {
    readMirrorJob.mockResolvedValueOnce(
      detail({
        money: {
          valueCents: 148500,
          invoiced: null,
          invoicedOn: null,
          quoteSent: null,
          quoteSentOn: null,
          paid: false,
          paidOn: null,
        },
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);

    await screen.findByText("$1,485");
    expect(screen.queryByText("Not invoiced")).toBeNull();
    expect(screen.queryByText(/awaiting payment/i)).toBeNull();
  });

  it("still says Not invoiced when ServiceM8 actually says so", async () => {
    readMirrorJob.mockResolvedValueOnce(
      detail({
        money: {
          valueCents: 148500,
          invoiced: false,
          invoicedOn: null,
          quoteSent: null,
          quoteSentOn: null,
          paid: false,
          paidOn: null,
        },
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    expect(await screen.findByText("Not invoiced")).toBeInTheDocument();
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

/* The other end of the studio's job link (#385). A design names its job with
   `jobLink.remoteId`; `studio_designs.sm8_job_uuid` mirrors that out so this
   read is an index hit, and the sheet is where the round trip closes. */
describe("designs started from this job", () => {
  const design = (over: Partial<JobDesign> = {}): JobDesign => ({
    id: "dsn_1",
    name: "12/3 Wallace St",
    mode: "plan",
    floorCount: 2,
    systemCount: 3,
    updatedAt: "2026-08-14T02:11:33.000Z",
    ...over,
  });

  it("lists each one as a link that opens THAT design", async () => {
    readMirrorJob.mockResolvedValueOnce(detail({ designs: [design()] }));
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText("Designed in the Studio")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /12\/3 Wallace St/ });
    // …not the studio's front door, which is what every design link did before
    expect(link).toHaveAttribute("href", "/dashboard/studio?design=dsn_1");
    expect(within(link).getByText(/2 floors · 3 systems/)).toBeInTheDocument();
  });

  it("counts the options in the heading when a job has several", async () => {
    readMirrorJob.mockResolvedValueOnce(
      detail({
        designs: [design(), design({ id: "dsn_2", name: "12/3 Wallace St — option B" })],
      })
    );
    render(<JobSheet row={row()} {...props} />);

    expect(
      await screen.findByText("Designed in the Studio — 2 options")
    ).toBeInTheDocument();
    // the contact's mailto is a link too — count the design rows only
    expect(document.querySelectorAll("a.wb2-dsgn")).toHaveLength(2);
  });

  it("says one floor and one system in the singular", async () => {
    readMirrorJob.mockResolvedValueOnce(
      detail({ designs: [design({ floorCount: 1, systemCount: 1 })] })
    );
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText(/1 floor · 1 system/)).toBeInTheDocument();
  });

  /* An empty heading on 800 service calls is a section that means nothing —
     and a reader without `studio` never receives the list at all (the action
     doesn't ask for it), which lands here as the same empty array. */
  it("is absent entirely when nothing has been designed", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText("18h 30m");
    expect(screen.queryByText(/Designed in the Studio/)).toBeNull();
  });

  /* An id is a document id, not a URL fragment — encode it or a design whose
     id ever grows a reserved character silently opens nothing. */
  it("encodes the id it puts in the link", async () => {
    readMirrorJob.mockResolvedValueOnce(
      detail({ designs: [design({ id: "dsn a&b" })] })
    );
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByRole("link", { name: /12\/3 Wallace St/ })).toHaveAttribute(
      "href",
      "/dashboard/studio?design=dsn%20a%26b"
    );
  });
});

/* ── the job's files ── */

describe("files on the job", () => {
  const file = (over: Partial<JobMediaItem> & { remoteId: string }): JobMediaItem => ({
    name: "IMG_4021.jpg",
    fileType: ".jpg",
    kind: "photo",
    origin: null,
    takenAt: "2026-08-01 10:00:00",
    url: null,
    ...over,
  });

  const files = (over: Partial<JobMediaGroupsRead> = {}): JobMediaGroupsRead => ({
    photos: [],
    documents: [],
    elsewhere: [],
    truncated: false,
    ...over,
  });

  it("says nothing at all when a job has no files", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobFiles.mockResolvedValueOnce(files());
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText("18h 30m");
    expect(screen.queryByText(/Files on this job/)).toBeNull();
  });

  it("shows a cached photo as a real image, linked to the full size", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobFiles.mockResolvedValueOnce(
      files({ photos: [file({ remoteId: "p-1", url: "https://signed/p-1.jpg" })] })
    );
    render(<JobSheet row={row()} {...props} />);

    const img = (await screen.findByAltText("IMG_4021.jpg")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://signed/p-1.jpg");
    expect(img.closest("a")!.getAttribute("href")).toBe("https://signed/p-1.jpg");
  });

  /* A photo ServiceM8 has that we haven't fetched is neither hidden nor
     broken: the tile says "there is one here", which is the truth. */
  it("shows a placeholder tile for a photo whose bytes aren't cached", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobFiles.mockResolvedValueOnce(files({ photos: [file({ remoteId: "p-1" })] }));
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText(/Files on this job/);
    expect(screen.queryByAltText("IMG_4021.jpg")).toBeNull();
    expect(document.querySelector(".wb2-mtile.pending")).not.toBeNull();
  });

  it("names the paperwork and links it once it's cached", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobFiles.mockResolvedValueOnce(
      files({
        documents: [
          file({
            remoteId: "d-1",
            name: "Invoice #3137.pdf",
            fileType: ".pdf",
            kind: "document",
            origin: "Invoice",
            url: "https://signed/d-1.pdf",
          }),
        ],
      })
    );
    render(<JobSheet row={row()} {...props} />);

    const link = (await screen.findByText("Invoice #3137.pdf")) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://signed/d-1.pdf");
    expect(screen.getByText("Invoice")).toBeInTheDocument();
  });

  it("chips a document that arrived by email, not just the paperwork", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobFiles.mockResolvedValueOnce(
      files({
        documents: [
          file({
            remoteId: "d-1",
            name: "Site induction.pdf",
            fileType: ".pdf",
            kind: "document",
            origin: "Emailed in",
            url: "https://signed/d-1.pdf",
          }),
        ],
      })
    );
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText("Site induction.pdf");
    expect(screen.getByText("Emailed in")).toBeInTheDocument();
  });

  /* A grid tile has no room for a chip, so the origin rides in the tooltip
     beside the name — a photo the customer emailed is not a photo the tech
     took, and the grid would otherwise flatten the two. */
  it("puts a photo's origin in its tooltip, where the name already is", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobFiles.mockResolvedValueOnce(
      files({ photos: [file({ remoteId: "p-1", origin: "Emailed in" })] })
    );
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText(/Files on this job/);
    const tile = document.querySelector(".wb2-mtile") as HTMLElement;
    expect(tile.getAttribute("title")).toBe("IMG_4021.jpg — emailed in");
  });

  it("counts what stays in ServiceM8 instead of pretending it isn't there", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobFiles.mockResolvedValueOnce(
      files({
        photos: [file({ remoteId: "p-1" }), file({ remoteId: "p-2" })],
        elsewhere: [
          file({ remoteId: "v-1", name: "walkthrough.mp4", fileType: ".mp4", kind: "video" }),
        ],
      })
    );
    render(<JobSheet row={row()} {...props} />);

    expect(
      await screen.findByText("Files on this job — 2 photos and 1 left in ServiceM8")
    ).toBeInTheDocument();
    expect(screen.getByText(/1 file stays in ServiceM8/)).toBeInTheDocument();
  });
});

describe("bringing the bytes across", () => {
  const files = (over: Partial<JobMediaGroupsRead> = {}): JobMediaGroupsRead => ({
    photos: [],
    documents: [],
    elsewhere: [],
    truncated: false,
    ...over,
  });

  it("keeps asking while each round makes progress, then stops", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles
      .mockResolvedValueOnce({ ok: true, cached: 6, remaining: 6, media: null, note: null })
      .mockResolvedValueOnce({ ok: true, cached: 6, remaining: 0, media: null, note: null });

    render(<JobSheet row={row()} {...props} />);
    await screen.findByText("18h 30m");
    await waitFor(() => expect(cacheJobFiles).toHaveBeenCalledTimes(2));
  });

  /* The rail that matters: a server reporting work left while caching none
     would otherwise spin until the round cap, hammering ServiceM8 for
     nothing. Progress, not the remaining count, is what earns another round. */
  it("stops immediately when a round caches nothing, even with work left", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 20, media: null, note: null });

    render(<JobSheet row={row()} {...props} />);
    await screen.findByText("18h 30m");
    await waitFor(() => expect(cacheJobFiles).toHaveBeenCalledTimes(1));
  });

  it("says out loud when storage is the thing standing in the way", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles.mockResolvedValueOnce({
      ok: true,
      cached: 0,
      remaining: 12,
      // The files exist — that's WHY there's something to cache and something
      // to complain about; an empty job would have nothing to say.
      media: files({
        photos: [
          {
            remoteId: "p-1",
            name: "IMG_4021.jpg",
            fileType: ".jpg",
            kind: "photo" as const,
            origin: null,
            takenAt: null,
            url: null,
          },
        ],
      }),
      note: "Storage is full — photos can't be brought across until there's room.",
    });

    render(<JobSheet row={row()} {...props} />);
    expect(await screen.findByText(/Storage is full/)).toBeInTheDocument();
  });
});

/* ── the written record and the ledger ── */

describe("what's been written on the job", () => {
  it("lists notes newest-first with who wrote them and when", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({
      notes: [
        {
          remoteId: "n-1",
          text: "Units being delivered direct to site",
          writtenOn: "2026-08-12",
          writtenBy: "Luke Ingold",
        },
      ],
      ledger: null,
    });
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText("What's been written on it")).toBeInTheDocument();
    expect(screen.getByText("Units being delivered direct to site")).toBeInTheDocument();
    expect(screen.getByText("Luke Ingold · Wed 12 Aug")).toBeInTheDocument();
  });

  it("says nothing at all when a job has no notes", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger: null });
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText("18h 30m");
    expect(screen.queryByText("What's been written on it")).toBeNull();
  });
});

describe("the ledger obeys the money grant", () => {
  const ledger = {
    materials: [
      {
        remoteId: "m-1",
        name: "Daikin CTXM35RVMA",
        quantity: 2,
        unitCents: 110000,
        taxInclusive: true,
        lineCents: 220000,
      },
    ],
    payments: [
      {
        remoteId: "p-1",
        amountCents: 240000,
        method: "Bank Transfer",
        note: null,
        takenOn: "2026-08-01",
        isDeposit: true,
        takenBy: "Luke Ingold",
      },
    ],
  };

  it("shows the lines and their total to a reader who holds money", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(await screen.findByText("What went on the job")).toBeInTheDocument();
    expect(screen.getByText("Daikin CTXM35RVMA")).toBeInTheDocument();
    expect(screen.getByText("× 2")).toBeInTheDocument();
    expect(screen.getByText("Total inc GST")).toBeInTheDocument();
  });

  it("shows what's been paid, naming a deposit as one", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    await screen.findByText("Bank Transfer");
    expect(screen.getByText(/deposit · Sat 1 Aug · Luke Ingold/)).toBeInTheDocument();
  });

  /* The gate is SERVER-side: without the grant the action returns ledger
     null, so there is nothing for the component to hide or leak. */
  it("renders no ledger at all when the server sent none", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger: null });
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText("18h 30m");
    expect(screen.queryByText("What went on the job")).toBeNull();
    expect(screen.queryByText(/What's been paid/)).toBeNull();
  });

  /* Adding an inc-GST line to an ex-GST one and printing one figure would be
     a lie, so the sheet says why there's no total instead of inventing one. */
  it("refuses a total when the lines disagree about tax", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({
      notes: [],
      ledger: {
        payments: [],
        materials: [
          { ...ledger.materials[0] },
          { ...ledger.materials[0], remoteId: "m-2", taxInclusive: false },
        ],
      },
    });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(await screen.findByText(/mix tax-inclusive and tax-exclusive/)).toBeInTheDocument();
    expect(screen.queryByText(/^Total/)).toBeNull();
  });

  it("refuses a total when a line couldn't be priced", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({
      notes: [],
      ledger: {
        payments: [],
        materials: [{ ...ledger.materials[0], unitCents: null, lineCents: null }],
      },
    });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(await screen.findByText(/aren't priced, so there's no total/)).toBeInTheDocument();
  });
});
