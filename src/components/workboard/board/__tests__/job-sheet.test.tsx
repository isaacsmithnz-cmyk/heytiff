/* The job sheet's new depth — everything here was already IN the mirror and
   rendered nowhere: the checklist with its ticks, recorded time on site, the
   booking's end time, the dispatch queue, contact emails, the category's own
   colour. The sheet is where "we sync it" has to become "you can see it". */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobDesign, MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { CacheJobFilesResult } from "@/app/actions/workboard-media";
import type { JobRecordRead } from "@/app/actions/workboard";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import { deriveFamilyMoney, type FamilyMoney } from "@/lib/workboard/job-family";

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
/* OUR picklist, pushed from a Studio design — the one list on this sheet we
   can actually write. Empty by default, like the files. */
const listJobPicklist = jest.fn(async (): Promise<unknown[]> => []);
const setPicklistItemPicked = jest.fn(async () => {});
const removePicklistItem = jest.fn(async () => {});
jest.mock("@/app/actions/job-picklist", () => ({
  listJobPicklist: (...a: unknown[]) => listJobPicklist(...(a as [])),
  setPicklistItemPicked: (...a: unknown[]) => setPicklistItemPicked(...(a as [])),
  removePicklistItem: (...a: unknown[]) => removePicklistItem(...(a as [])),
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
  visits: [
    { day: "2026-08-14", minutes: 620, crew: ["Alex Lorenz"] },
    { day: "2026-08-13", minutes: 490, crew: ["Callum Vrieze", "Alex Lorenz"] },
  ],
  queue: { name: "Parts on Order", expiry: "2026-08-20", staffName: "Luke Ingold" },
  checklist: [
    { name: "Isolate power", itemType: "Todo", section: null, done: true, doneOn: "2026-08-13", doneBy: "Callum Vrieze" },
    { name: "Site photos", itemType: "Photo", section: "Handover", done: false, doneOn: null, doneBy: null },
    { name: "DAS Service Call", itemType: "Form", section: "Handover", done: false, doneOn: null, doneBy: null },
  ],
  contacts: [
    {
      name: "Josh",
      type: "Property Manager",
      phone: "0426 719 412",
      altPhone: null,
      email: "josh@lsdb.com.au",
    },
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
  listJobPicklist.mockReset();
  setPicklistItemPicked.mockReset();
  removePicklistItem.mockReset();
  listJobPicklist.mockResolvedValue([]);
  setPicklistItemPicked.mockResolvedValue(undefined);
  removePicklistItem.mockResolvedValue(undefined);
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

  /* The sessions used to be summed into one "time on site" figure. The
     question a job card is actually asked is when we were last there and who
     went, so the sessions are kept and the sum is the heading. */
  it("lists every visit with who went, and tallies them in the heading", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText("Visits — 2 · 18h 30m on site")).toBeInTheDocument();
    expect(screen.getByText("Fri 14 Aug")).toBeInTheDocument();
    // the booking tile names him too, so this counts rather than finds
    expect(screen.getAllByText("Alex Lorenz").length).toBe(2);
    expect(screen.getByText("Callum Vrieze, Alex Lorenz")).toBeInTheDocument();
    expect(screen.getByText("10h 20m")).toBeInTheDocument();
  });

  /* Live, one job in ten runs past 12 sessions and the worst runs to 103 —
     the list has to hold its shape without growing a scrollbar of its own. */
  it("shows the last three visits and opens the rest in place", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      day: `2026-08-${String(20 - i).padStart(2, "0")}`,
      minutes: 60,
      crew: ["Alex Lorenz"],
    }));
    readMirrorJob.mockResolvedValueOnce(detail({ visits: many }));
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText("Thu 20 Aug")).toBeInTheDocument();
    expect(screen.queryByText("Sun 16 Aug")).toBeNull();

    await userEvent.click(screen.getByText("All 12 visits"));
    expect(screen.getByText("Sun 16 Aug")).toBeInTheDocument();
    expect(screen.queryByText("All 12 visits")).toBeNull();
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

  it("always chips the status, and wears the diary's reading when handed one", async () => {
    /* the status chip used to appear only when it had a tone, which hid
       exactly the statuses a reader arrives unsure about; and a block opened
       from the Schedule hands the day's reading across, "!" included */
    readMirrorJob.mockResolvedValueOnce(detail());
    render(
      <JobSheet
        row={row()}
        {...props}
        scheduleState={{ kind: "late", word: "Nothing recorded yet" }}
      />
    );
    await screen.findByText("Visits — 2 · 18h 30m on site");
    expect(screen.getByText("Work Order")).toBeInTheDocument();
    const chip = screen.getByText("Nothing recorded yet");
    expect(chip).toHaveClass("dan");
    expect(chip.querySelector(".wb2-shbang")).not.toBeNull();
  });

  it("wears the category colour as a dot, never as the chip surface", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    const { container } = render(<JobSheet row={row()} {...props} />);

    await screen.findByText("Visits — 2 · 18h 30m on site");
    const dot = document.querySelector(".wb2-catdot") as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.background).toBe("rgb(231, 181, 255)");
    expect(container).toBeDefined();
  });
});

/* ── the money block ──────────────────────────────────────────────────────
   ServiceM8 bills a progress job by cloning it: #2380's deposit is job
   #2380A, its progress claim is #2380B, and the parent is netted down to the
   balance. The block reads the three cards as one job. */

const familyMoney = (over: Partial<FamilyMoney> = {}): FamilyMoney =>
  deriveFamilyMoney({
    members: [
      {
        remoteId: "j-2380",
        jobNumber: "2380",
        totalCents: 626806,
        paidCents: 0,
        lastPaidOn: null,
        lines: null,
        raisedOn: "2026-08-21",
      },
      {
        remoteId: "j-2380a",
        jobNumber: "2380A",
        totalCents: null,
        paidCents: 940211,
        lastPaidOn: "2026-04-02",
        lines: { cents: 854737, taxInclusive: false },
        raisedOn: "2026-03-27",
      },
      {
        remoteId: "j-2380b",
        jobNumber: "2380B",
        totalCents: null,
        paidCents: 1567018,
        lastPaidOn: "2026-04-10",
        lines: { cents: 1424562, taxInclusive: false },
        raisedOn: "2026-04-02",
      },
    ],
    today: "2026-08-26",
    termsDays: null,
    ...over,
  });

describe("the money block", () => {
  it("reads three ServiceM8 cards as one job, with the claims numbered", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger: null, family: familyMoney() });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(await screen.findByText("$31,340.35")).toBeInTheDocument();
    expect(screen.getByText("Job value (inc GST)")).toBeInTheDocument();
    expect(screen.getByText("Payment 1 — Deposit")).toBeInTheDocument();
    expect(screen.getByText("Payment 2 — Progress")).toBeInTheDocument();
    expect(screen.getByText("Payment 3 — Final")).toBeInTheDocument();
    expect(
      screen.getByText("Invoice #2380A · 30% of the job · Raised Fri 27 Mar · Paid Thu 2 Apr")
    ).toBeInTheDocument();
  });

  /* Payments join by uuid and never by family, so the parent used to read
     "Nothing paid yet" with $25,072 already in the bank. */
  it("counts the money that landed on the clones", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger: null, family: familyMoney() });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    await screen.findByText("$31,340.35");
    const head = document.querySelector(".wb2-mline.head") as HTMLElement;
    expect(within(head).getByText("Awaiting payment")).toBeInTheDocument();
    expect(within(head).getByText("$6,268.06")).toBeInTheDocument();
    expect(within(head).getByText("20% of the job")).toBeInTheDocument();
    expect(screen.queryByText("Nothing paid yet")).toBeNull();
  });

  /* The two axes never share a sentence: this line counts INVOICING. */
  it("says what has been invoiced and what is still to bill", async () => {
    const family = familyMoney();
    family.claims[2].state = "not_invoiced";
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({
      notes: [],
      ledger: null,
      family: deriveFamilyMoney({
        members: [
          {
            remoteId: "j-2380",
            jobNumber: "2380",
            totalCents: 626806,
            paidCents: 0,
            lastPaidOn: null,
            lines: null,
            raisedOn: null,
          },
          {
            remoteId: "j-2380a",
            jobNumber: "2380A",
            totalCents: null,
            paidCents: 940211,
            lastPaidOn: "2026-04-02",
            lines: { cents: 854737, taxInclusive: false },
            raisedOn: "2026-03-27",
          },
          {
            remoteId: "j-2380b",
            jobNumber: "2380B",
            totalCents: null,
            paidCents: 1567018,
            lastPaidOn: "2026-04-10",
            lines: { cents: 1424562, taxInclusive: false },
            raisedOn: "2026-04-02",
          },
        ],
        today: "2026-08-26",
        termsDays: null,
      }),
    });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(
      await screen.findByText("$25,072.29 invoiced so far — $6,268.06 to come")
    ).toBeInTheDocument();
    expect(screen.getByText("To come")).toBeInTheDocument();
  });

  /* GST is never derived, so a family whose claims are stated on different
     bases gets no single figure — and says which. */
  it("stands the total down rather than adding ex-GST to inc-GST", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({
      notes: [],
      ledger: null,
      family: deriveFamilyMoney({
        members: [
          {
            remoteId: "j-2380",
            jobNumber: "2380",
            totalCents: 626806,
            paidCents: 0,
            lastPaidOn: null,
            lines: null,
            raisedOn: "2026-08-21",
          },
          {
            remoteId: "j-2380a",
            jobNumber: "2380A",
            totalCents: null,
            paidCents: 0,
            lastPaidOn: null,
            lines: { cents: 854737, taxInclusive: false },
            raisedOn: "2026-03-27",
          },
        ],
        today: "2026-08-26",
        termsDays: null,
      }),
    });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(await screen.findByText(/different tax bases/)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    // no basis is claimed for a figure that isn't there
    expect(screen.getByText("Job value")).toBeInTheDocument();
    expect(screen.queryByText("Job value (inc GST)")).toBeNull();
    // and the ledger is the only answer — no second summary beside it
    expect(screen.queryByText("Part or all paid")).toBeNull();
    expect(screen.queryByText("Nothing paid yet")).toBeNull();
  });

  /* An invoice nobody has raised has no number to name. */
  it("names no invoice number on the part still to bill", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({
      notes: [],
      ledger: null,
      family: deriveFamilyMoney({
        members: [
          {
            remoteId: "j-2380",
            jobNumber: "2380",
            totalCents: 626806,
            paidCents: 0,
            lastPaidOn: null,
            lines: null,
            raisedOn: null,
          },
          {
            remoteId: "j-2380a",
            jobNumber: "2380A",
            totalCents: null,
            paidCents: 940211,
            lastPaidOn: "2026-04-02",
            lines: { cents: 854737, taxInclusive: false },
            raisedOn: "2026-03-27",
          },
        ],
        today: "2026-08-26",
        termsDays: null,
      }),
    });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(await screen.findByText("Not yet invoiced")).toBeInTheDocument();
    expect(screen.queryByText(/Invoice #2380 ·/)).toBeNull();
  });

  /* The category colour frames the money block and NOTHING else — the card
     keeps its neutral hairline. */
  it("wears the job type's colour as the block's edge", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger: null, family: familyMoney() });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    await screen.findByText("$31,340.35");
    const block = document.querySelector(".wb2-jmoney") as HTMLElement;
    expect(block.style.borderColor).toBe("rgb(231, 181, 255)");
    expect((document.querySelector(".wb2-sheet") as HTMLElement).style.borderColor).toBe("");
  });

  /* ServiceM8's own subtraction rows are bookkeeping, not materials. */
  it("keeps the partial-invoice rows out of what went on the job", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({
      notes: [],
      ledger: {
        materials: [
          {
            remoteId: "m-1",
            name: "As Per Quote",
            quantity: 1,
            unitCents: 2796000,
            taxInclusive: false,
            lineCents: 2796000,
          },
          {
            remoteId: "m-2",
            name: "Partial invoice #2380A",
            quantity: -1,
            unitCents: 838800,
            taxInclusive: false,
            lineCents: -838800,
          },
          {
            remoteId: "m-3",
            name: "Discount",
            quantity: -1,
            unitCents: 10000,
            taxInclusive: false,
            lineCents: -10000,
          },
        ],
        payments: [],
      },
      family: null,
    });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(await screen.findByText("As Per Quote")).toBeInTheDocument();
    expect(screen.queryByText("Partial invoice #2380A")).toBeNull();
    // a discount is a real ledger entry that happens to be negative
    expect(screen.getByText("Discount")).toBeInTheDocument();
  });

  /* This sheet's own rule: what fills in was ABSENT, not wrong. A parent
     ServiceM8 has netted reads $6,268 on its own row and $31,340 as a family,
     so the block waits rather than painting the wrong number first. */
  it("shows no figure at all until the family read has landed", async () => {
    let land: (v: JobRecordRead) => void = () => {};
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockReturnValueOnce(
      new Promise<JobRecordRead>((res) => {
        land = res;
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);

    await screen.findByText("Visits — 2 · 18h 30m on site");
    expect(document.querySelector(".wb2-jmoney")).toBeNull();

    land({ notes: [], ledger: null, family: familyMoney() });
    expect(await screen.findByText("$31,340.35")).toBeInTheDocument();
  });
});

/* A job ServiceM8 never cloned is the common case — 3,015 of 3,493 rows
   live — and it wears the same block with the ledger folded away. */

describe("the money block on a job with no clones", () => {
  const plain = (over: Partial<Parameters<typeof deriveFamilyMoney>[0]["members"][number]> = {}) =>
    deriveFamilyMoney({
      members: [
        {
          remoteId: "j-2968",
          jobNumber: "2968",
          totalCents: 279400,
          paidCents: 0,
          lastPaidOn: null,
          lines: null,
          raisedOn: null,
          ...over,
        },
      ],
      today: "2026-08-26",
      termsDays: null,
    });

  const jobMoney = {
    valueCents: 279400,
    invoiced: null,
    invoicedOn: null,
    quoteSent: null,
    quoteSentOn: null,
    paid: false,
    paidOn: null,
  };

  it("says the value and where collection stands, with no bar to compare", async () => {
    readMirrorJob.mockResolvedValueOnce(detail({ money: jobMoney }));
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger: null, family: plain() });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(await screen.findByText("$2,794")).toBeInTheDocument();
    expect(screen.getByText("Nothing paid yet")).toBeInTheDocument();
    // one segment is a rectangle, not a comparison
    expect(document.querySelector(".wb2-jmbar")).toBeNull();
    // and no payment schedule for a job that has no schedule
    expect(screen.queryByText(/^Payment 1/)).toBeNull();
  });

  it("wears the amber head row once there is something to chase", async () => {
    readMirrorJob.mockResolvedValueOnce(detail({ money: jobMoney }));
    readJobRecord.mockResolvedValueOnce({
      notes: [],
      ledger: null,
      family: plain({ paidCents: 100000, lastPaidOn: "2026-08-07", raisedOn: "2026-08-01" }),
    });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    await screen.findByText("$2,794");
    const head = document.querySelector(".wb2-mline.head") as HTMLElement;
    expect(within(head).getByText("Awaiting payment")).toBeInTheDocument();
    expect(within(head).getByText("$1,794")).toBeInTheDocument();
    expect(document.querySelector(".wb2-jmbar")).not.toBeNull();
    // the head row IS the sentence — never both
    expect(screen.queryByText(/Part paid/)).toBeNull();
  });
});

/* ── the ways out of the job ── */

describe("the promote actions", () => {
  it("live behind the ⋯ menu, not on the card floor", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    render(<JobSheet row={row()} {...props} manage />);

    await screen.findByText("Visits — 2 · 18h 30m on site");
    expect(screen.queryByText("Create a project from this job")).toBeNull();

    await userEvent.click(screen.getByLabelText("More actions"));
    expect(screen.getByText("Create a project from this job")).toBeInTheDocument();
    expect(screen.getByText("Create a maintenance agreement")).toBeInTheDocument();
  });

  it("offers no menu at all to a reader who cannot promote", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText("Visits — 2 · 18h 30m on site");
    expect(screen.queryByLabelText("More actions")).toBeNull();
  });

  it("closes the menu on Escape without closing the sheet", async () => {
    const onClose = jest.fn();
    readMirrorJob.mockResolvedValueOnce(detail());
    render(<JobSheet row={row()} {...props} manage onClose={onClose} />);

    await userEvent.click(await screen.findByLabelText("More actions"));
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByText("Create a maintenance agreement")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("money stays behind its grant", () => {
  /* On a QUOTE the money line is about the quote, not about collection — a
     quote nobody has accepted can't be "awaiting payment", and saying so
     would send somebody chasing money that was never billed. */
  it("says when the quote went out, for a reader who holds money", async () => {
    readMirrorJob.mockResolvedValueOnce(
      detail({
        status: "Quote",
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
    render(<JobSheet row={row({ statusLabel: "Quote" })} {...props} moneyVisible />);

    expect(await screen.findByText("Quote sent Mon 3 Aug")).toBeInTheDocument();
    expect(screen.getByText("$6,850")).toBeInTheDocument();
    expect(screen.queryByText("Nothing paid yet")).toBeNull();
  });

  it("renders no money fact at all without the grant, whatever the detail says", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText("Visits — 2 · 18h 30m on site");
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
    await screen.findByText("Visits — 2 · 18h 30m on site");
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

    await screen.findByText("Visits — 2 · 18h 30m on site");
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

    await screen.findByText("Visits — 2 · 18h 30m on site");
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
    await screen.findByText("Visits — 2 · 18h 30m on site");
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
    await screen.findByText("Visits — 2 · 18h 30m on site");
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
      family: null,
      ledger: null,
    });
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText("What's been written on it")).toBeInTheDocument();
    expect(screen.getByText("Units being delivered direct to site")).toBeInTheDocument();
    expect(screen.getByText("Luke Ingold · Wed 12 Aug")).toBeInTheDocument();
  });

  it("says nothing at all when a job has no notes", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger: null, family: null });
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText("Visits — 2 · 18h 30m on site");
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
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger, family: null });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(await screen.findByText("What went on the job")).toBeInTheDocument();
    expect(screen.getByText("Daikin CTXM35RVMA")).toBeInTheDocument();
    expect(screen.getByText("× 2")).toBeInTheDocument();
    expect(screen.getByText("Total inc GST")).toBeInTheDocument();
  });

  it("shows what's been paid, naming a deposit as one", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger, family: null });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    await screen.findByText("Bank Transfer");
    expect(screen.getByText(/deposit · Sat 1 Aug · Luke Ingold/)).toBeInTheDocument();
  });

  /* The gate is SERVER-side: without the grant the action returns ledger
     null, so there is nothing for the component to hide or leak. */
  it("renders no ledger at all when the server sent none", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({ notes: [], ledger: null, family: null });
    render(<JobSheet row={row()} {...props} />);

    await screen.findByText("Visits — 2 · 18h 30m on site");
    expect(screen.queryByText("What went on the job")).toBeNull();
    expect(screen.queryByText(/What's been paid/)).toBeNull();
  });

  /* Adding an inc-GST line to an ex-GST one and printing one figure would be
     a lie, so the sheet says why there's no total instead of inventing one. */
  it("refuses a total when the lines disagree about tax", async () => {
    readMirrorJob.mockResolvedValueOnce(detail());
    readJobRecord.mockResolvedValueOnce({
      notes: [],
      family: null,
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
      family: null,
      ledger: {
        payments: [],
        materials: [{ ...ledger.materials[0], unitCents: null, lineCents: null }],
      },
    });
    render(<JobSheet row={row()} {...props} moneyVisible />);

    expect(await screen.findByText(/aren't priced, so there's no total/)).toBeInTheDocument();
  });
});

/* ── OUR material picklist ──
   The sheet already shows "Their checklist" straight out of the ServiceM8
   mirror, which is READ-ONLY. This list is the HeyTiff side — pushed here
   from a Studio design — and it is the one that can actually be ticked. The
   distinction is the whole point, so these tests pin it. */
describe("the material picklist", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    name: "MSZ-AP25VGD",
    sub: "wall mounted indoor",
    qty: "3",
    picked: false,
    pickedAt: null,
    pickedBy: null,
    designId: "dsn_1",
    addedAt: "2026-08-16T00:00:00.000Z",
    ...over,
  });

  it("says nothing at all when the job has no picklist", async () => {
    render(<JobSheet row={row()} {...props} />);
    await waitFor(() => expect(listJobPicklist).toHaveBeenCalledWith("j-1"));
    expect(screen.queryByText(/Material picklist/)).not.toBeInTheDocument();
  });

  it("lists what was pushed, and counts what is picked", async () => {
    listJobPicklist.mockResolvedValue([
      item(),
      item({ id: "p2", name: "PUHY-P200YNW-A1", qty: "1", picked: true }),
    ]);
    render(<JobSheet row={row()} {...props} />);
    expect(await screen.findByText(/1 of 2 picked/)).toBeInTheDocument();
    expect(screen.getByText("MSZ-AP25VGD")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("ticking saves, and shows immediately rather than waiting on the server", async () => {
    const user = userEvent.setup();
    /* a promise that never settles: whatever the box looks like after the
       click is the OPTIMISTIC state, not the server's */
    setPicklistItemPicked.mockReturnValue(new Promise(() => {}));
    listJobPicklist.mockResolvedValue([item()]);
    render(<JobSheet row={row()} {...props} />);

    const box = await screen.findByLabelText("Picked: MSZ-AP25VGD");
    await user.click(box);
    expect(setPicklistItemPicked).toHaveBeenCalledWith("p1", true);
    expect(box).toBeChecked();
  });

  it("puts the tick back when the save fails, and says so", async () => {
    const user = userEvent.setup();
    const onToast = jest.fn();
    setPicklistItemPicked.mockRejectedValue(new Error("nope"));
    listJobPicklist.mockResolvedValue([item()]);
    render(<JobSheet row={row()} {...props} onToast={onToast} />);

    const box = await screen.findByLabelText("Picked: MSZ-AP25VGD");
    await user.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(onToast).toHaveBeenCalledWith("Could not save that tick");
  });

  it("only a manager can remove a line", async () => {
    listJobPicklist.mockResolvedValue([item()]);
    const { unmount } = render(<JobSheet row={row()} {...props} />);
    expect(await screen.findByText("MSZ-AP25VGD")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Remove MSZ-AP25VGD")
    ).not.toBeInTheDocument();
    unmount();

    render(<JobSheet row={row()} {...props} manage />);
    expect(
      await screen.findByLabelText("Remove MSZ-AP25VGD")
    ).toBeInTheDocument();
  });

  it("a picklist that will not load never takes the sheet down", async () => {
    listJobPicklist.mockRejectedValue(new Error("offline"));
    render(<JobSheet row={row()} {...props} />);
    // the rest of the sheet still arrives
    expect(await screen.findByText("The job")).toBeInTheDocument();
    expect(screen.queryByText(/Material picklist/)).not.toBeInTheDocument();
  });
});
