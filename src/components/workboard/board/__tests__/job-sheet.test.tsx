/* THE CARD IS TABS — slice 2's anatomy, and the laws that survived the move.

   Everything the old single-scroll sheet pinned still holds; it just lives on
   a face now, so a test opens the tab that owns what it asserts. The new
   ground rules pinned here: the tab set is FIXED from first paint (Money
   absent without the grant, Actions absent for a reader with nothing to do),
   the Summary face leads with the scope and wears the stored "Where it's up
   to" with its stamp, the Diary is the story merge rendered, and the summary
   refresh kicks ONCE, only when the story's stamp has left the stored one
   behind. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobDesign, MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { CacheJobFilesResult } from "@/app/actions/workboard-media";
import type { JobCardRead, JobRecordRead } from "@/app/actions/workboard";
import type { ClaimDetailRead } from "@/lib/workboard/all-jobs-query";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import { deriveFamilyMoney, type FamilyMoney } from "@/lib/workboard/job-family";
import { buildJobStory, storyStamp } from "@/lib/workboard/job-story";

const readMirrorJob = jest.fn(
  async (): Promise<JobCardRead> => ({ detail: null, focusRemoteId: null })
);
const readClaim = jest.fn(async (): Promise<ClaimDetailRead | null> => null);
const createProjectFromJob = jest.fn(async () => ({ ok: true as const, id: "p-new" }));
/* A job with no files is the common case and the default here. */
const readJobFiles = jest.fn(async (): Promise<JobMediaGroupsRead | null> => null);
/* Notes always; ledger null for a reader without money — the SERVER decides. */
const readJobRecord = jest.fn(async (): Promise<JobRecordRead | null> => null);
jest.mock("@/app/actions/workboard", () => ({
  readMirrorJob: (...a: unknown[]) => readMirrorJob(...(a as [])),
  readClaim: (...a: unknown[]) => readClaim(...(a as [])),
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
const listJobPicklist = jest.fn(async (): Promise<unknown[]> => []);
const setPicklistItemPicked = jest.fn(async () => {});
const removePicklistItem = jest.fn(async () => {});
const addJobPicklistItem = jest.fn(async (): Promise<unknown> => ({}));
jest.mock("@/app/actions/job-picklist", () => ({
  listJobPicklist: (...a: unknown[]) => listJobPicklist(...(a as [])),
  setPicklistItemPicked: (...a: unknown[]) => setPicklistItemPicked(...(a as [])),
  removePicklistItem: (...a: unknown[]) => removePicklistItem(...(a as [])),
  addJobPicklistItem: (...a: unknown[]) => addJobPicklistItem(...(a as [])),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { JobSheet } from "../job-sheet";

/* The summary refresh posts to a route handler; jsdom has no fetch, and a
   real one would be a network call from a unit test anyway. */
const fetchMock = jest.fn(async () => ({ json: async () => ({ ok: false }) }));

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

/** The detail as the loader would hand it over for #3137's shape. */
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
  dateOn: "2026-08-08",
  dateLabel: "raised",
  visits: [
    { day: "2026-08-14", minutes: 620, crew: ["Alex Lorenz"] },
    { day: "2026-08-13", minutes: 490, crew: ["Callum Vrieze", "Alex Lorenz"] },
  ],
  queue: { name: "Parts on Order", expiry: "2026-08-20", staffName: "Luke Ingold" },
  checklist: [
    { name: "Isolate power", itemType: "Todo", section: null, done: true, doneOn: "2026-08-13", doneAt: "2026-08-13 15:40:00", doneBy: "Callum Vrieze" },
    { name: "Site photos", itemType: "Photo", section: "Handover", done: false, doneOn: null, doneAt: null, doneBy: null },
    { name: "DAS Service Call", itemType: "Form", section: "Handover", done: false, doneOn: null, doneAt: null, doneBy: null },
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
  timezone: null,
  ...over,
});

/** A record read with the new summary field defaulted off. */
const record = (over: Partial<JobRecordRead> = {}): JobRecordRead => ({
  notes: [],
  ledger: null,
  family: null,
  summary: null,
  ...over,
});

beforeEach(() => {
  readMirrorJob.mockReset();
  readClaim.mockReset();
  readClaim.mockResolvedValue(null);
  readJobFiles.mockReset();
  readJobRecord.mockReset();
  cacheJobFiles.mockReset();
  readMirrorJob.mockResolvedValue(card(null));
  readJobFiles.mockResolvedValue(null);
  readJobRecord.mockResolvedValue(null);
  cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 0, media: null, note: null });
  listJobPicklist.mockReset();
  setPicklistItemPicked.mockReset();
  removePicklistItem.mockReset();
  listJobPicklist.mockResolvedValue([]);
  setPicklistItemPicked.mockResolvedValue(undefined);
  removePicklistItem.mockResolvedValue(undefined);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ json: async () => ({ ok: false }) });
  (global as { fetch?: unknown }).fetch = fetchMock;
});

const noop = () => {};
const card = (d: MirrorJobDetail | null, focusRemoteId: string | null = null) => ({
  detail: d,
  focusRemoteId,
});

const props = {
  manage: false,
  moneyVisible: false,
  onClose: noop,
  onCreateAgreement: noop,
  onOpenTracked: noop,
  onToast: noop,
};

/** The band's address is the "detail landed" signal — it fills in on every
    face, where the old suite waited on the Visits heading. */
const detailLanded = () => screen.findByText("Rose Bay NSW 2029");

const openTab = async (name: string) => {
  await userEvent.click(screen.getByRole("tab", { name }));
};

/** Queries scoped to one face's panel. The inactive panels are `hidden` (so
    role queries already skip them) but TEXT queries reach into them — a day
    marker in the hidden Diary would collide with the same date on the
    Visits face without this. */
const face = (key: string) =>
  within(document.querySelector(`#jcsec-${key}`) as HTMLElement);

/* ── the anatomy ── */

describe("the card is tabs", () => {
  it("wears the fixed tab set, Summary first, and lands on it", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} moneyVisible manage />);
    await detailLanded();

    expect(
      screen.getAllByRole("tab").map((t) => t.textContent)
    ).toEqual([
      "Summary",
      "Diary",
      "Money",
      "Visits",
      "Checklist",
      "Photos",
      "Documents",
    ]);
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  /* THE TAB IS THE GATE. Without `workboard_money` the face is ABSENT — no
     lock icon, no greyed stub — because the server never sent what would
     have filled it. */
  it("has no Money tab at all without the grant", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    expect(screen.queryByRole("tab", { name: "Money" })).toBeNull();
  });

  it("has no Actions tab even for a manager — the acts live behind the ⋯", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} manage />);
    await detailLanded();
    expect(screen.queryByRole("tab", { name: "Actions" })).toBeNull();
    expect(screen.getByLabelText("More actions")).toBeInTheDocument();
  });

  it("wears the job type's colour as the band's wash and crown, at fixed alphas", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();

    const sheet = document.querySelector(".wb2-sheet") as HTMLElement;
    expect(sheet.style.getPropertyValue("--jc-crown")).toBe("rgba(231,181,255,0.55)");
    expect(sheet.style.getPropertyValue("--jc-band-a")).toBe("rgba(231,181,255,0.18)");
    // never the whole card's border — the frame stays the money block's
    expect(sheet.style.borderColor).toBe("");
  });

  it("sets no colour vars for a job with no category", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(detail({ categoryName: null, categoryColour: null }))
    );
    render(<JobSheet row={row({ categoryName: null, categoryColour: null })} {...props} />);
    await detailLanded();
    const sheet = document.querySelector(".wb2-sheet") as HTMLElement;
    expect(sheet.style.getPropertyValue("--jc-crown")).toBe("");
  });
});

/* ── the band ── */

describe("the band", () => {
  it("falls back to the geo line when the job has no written address", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ address: null })));
    render(<JobSheet row={row()} {...props} />);
    expect(await screen.findByText("Rose Bay NSW 2029")).toBeInTheDocument();
  });

  it("always chips the status, and wears the diary's reading when handed one", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(
      <JobSheet
        row={row()}
        {...props}
        scheduleState={{ kind: "late", word: "Nothing recorded yet" }}
      />
    );
    await detailLanded();
    expect(screen.getByText("Work Order")).toBeInTheDocument();
    const chip = screen.getByText("Nothing recorded yet");
    expect(chip).toHaveClass("dan");
    expect(chip.querySelector(".wb2-shbang")).not.toBeNull();
  });

  /* "Raised" is its own fact beside the status; "completed" IS the status,
     so that date rides inside the status chip as one statement. */
  it("chips the raised date beside the status, and folds a completed date into it", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    const { unmount } = render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    expect(screen.getByText("Raised Sat 8 Aug")).toBeInTheDocument();
    expect(screen.getByText("Work Order")).toBeInTheDocument();
    unmount();

    readMirrorJob.mockResolvedValueOnce(
      card(detail({ status: "Completed", dateOn: "2026-08-21", dateLabel: "completed" }))
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    expect(screen.getByText("Completed · Fri 21 Aug")).toBeInTheDocument();
    expect(screen.queryByText(/^Raised /)).toBeNull();
  });

  it("wears the category colour as a dot, never as the chip surface", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    const dot = document.querySelector(".wb2-catdot") as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.background).toBe("rgb(231, 181, 255)");
  });
});

/* ── the Summary face ── */

describe("the Summary face", () => {
  it("leads with the scope, verbatim, and keeps what-was-done beside it", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(detail({ workDone: "Installed and commissioned." }))
    );
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText("Supply and install Daikin multi system")).toBeInTheDocument();
    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.getByText("What was done")).toBeInTheDocument();
    expect(screen.getByText("Installed and commissioned.")).toBeInTheDocument();
  });

  it("renders the stored lead and its points with the stamp — when it changed and why", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        summary: {
          lead: "First fix done across two visits.",
          points: ["The crew returns Thursday", 'One loose thread: "check the gyprock"'],
          stamp: "s-1",
          eventOn: "2026-08-13",
          eventLabel: "Nathan's note",
        },
      })
    );
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText("First fix done across two visits.")).toBeInTheDocument();
    expect(screen.getByText("Where it’s up to")).toBeInTheDocument();
    expect(screen.getByText("Updated Thu 13 Aug · Nathan's note")).toBeInTheDocument();
    /* each point is its own list line, not a clause of the lead */
    const points = document.querySelectorAll(".wb2-jcups-pts li");
    expect([...points].map((p) => p.textContent)).toEqual([
      "The crew returns Thursday",
      'One loose thread: "check the gyprock"',
    ]);
  });

  it("says nothing where a summary hasn't been written yet", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record());
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    expect(screen.queryByText("Where it’s up to")).toBeNull();
  });

  it("renders a contact's email as a mailto link, in Contacts", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} />);

    const link = (await screen.findByText("Email")) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("mailto:josh@lsdb.com.au");
    expect(screen.getByText("Josh")).toBeInTheDocument();
    expect(screen.getByText("property manager")).toBeInTheDocument();
  });

  it("dials a phone number, and refuses a field holding more than one", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
        detail({
          contacts: [
            { name: "Josh", type: "JOB", phone: "0426 719 412", altPhone: null, email: null },
            {
              name: "Karen",
              type: "JOB",
              phone: "0412 345 678 / 9999 a/h",
              altPhone: null,
              email: null,
            },
          ],
        })
      )
    );
    render(<JobSheet row={row()} {...props} />);

    const dialable = await screen.findByText("0426 719 412");
    expect(dialable.closest("a")).toHaveAttribute("href", "tel:0426719412");
    expect(document.body.textContent).toContain("0412 345 678 / 9999 a/h");
    expect(document.querySelector('a[href="tel:04123456789999"]')).toBeNull();
  });

  it("keeps the client's PO with the contacts", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ purchaseOrder: "PO-2214" })));
    render(<JobSheet row={row()} {...props} />);
    expect(await screen.findByText("PO-2214")).toBeInTheDocument();
    expect(screen.getByText("Their PO")).toBeInTheDocument();
  });
});

/* ── the refresh kick ── */

describe("the summary refresh", () => {
  /* Everything the kick waits for: detail, record, files and picklist all
     landed — the same inputs the story is merged from. */
  const allLanded = (over: Partial<JobRecordRead> = {}) => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record(over));
    readJobFiles.mockResolvedValueOnce({
      photos: [],
      documents: [],
      elsewhere: [],
      truncated: false,
    });
  };

  it("kicks once when the stored stamp has fallen behind, and swaps the fresh words in", async () => {
    allLanded({
      summary: {
        lead: "Old words.",
        points: [],
        stamp: "stale",
        eventOn: "2026-08-01",
        eventLabel: "a note",
      },
    });
    fetchMock.mockResolvedValue({
      json: async () => ({
        ok: true,
        summary: {
          lead: "Fresh words about the job.",
          points: ["A fresh point"],
          stamp: "fresh",
          eventOn: "2026-08-14",
          eventLabel: "a site visit",
        },
      }),
    });
    render(<JobSheet row={row()} {...props} />);

    /* not asserting the stale words first: the mocked route answers on the
       next tick, so the swap can beat the query — the walked behaviour is
       stored-then-fresh, and the END state plus one POST is what's pinned */
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/workboard/job-summary");
    expect(JSON.parse(String(init.body))).toEqual({ job: "j-1" });

    expect(await screen.findByText("Fresh words about the job.")).toBeInTheDocument();
    expect(screen.getByText("Updated Fri 14 Aug · a site visit")).toBeInTheDocument();
  });

  it("does not kick when the stored stamp matches the story's", async () => {
    /* The stamp the component derives, derived here the same way — the one
       door job-story.ts is. */
    const d = detail();
    const stamp = storyStamp(
      buildJobStory({
        detail: {
          date: d.date,
          quoteDate: d.quoteDate,
          workOrderDate: d.workOrderDate,
          completionDate: d.completionDate,
          visits: d.visits,
          checklist: d.checklist,
          designs: d.designs,
        },
        notes: [],
        ledger: null,
        family: null,
        invoicedOn: null,
        media: [],
        picklist: [],
        timezone: null,
      })
    );
    expect(stamp).not.toBeNull();
    allLanded({
      summary: { lead: "Current words.", points: [], stamp: stamp!, eventOn: "2026-08-14", eventLabel: "a site visit" },
    });
    render(<JobSheet row={row()} {...props} />);

    expect(await screen.findByText("Current words.")).toBeInTheDocument();
    /* give any wrong kick a tick to fire before asserting it didn't */
    await waitFor(() => expect(readJobFiles).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never kicks while the files are still out — the story would be short", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record());
    /* readJobFiles stays at the default null forever */
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ── the Diary face ── */

describe("the Diary face", () => {
  it("reads the job's record newest-first under day markers", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        notes: [
          {
            remoteId: "n-1",
            text: "Units being delivered direct to site",
            writtenOn: "2026-08-12",
            writtenAt: "2026-08-12 09:14:00",
            writtenBy: "Luke Ingold",
            actionRequired: false,
            fromClaim: null,
          },
        ],
      })
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Diary");

    const f = face("diary");
    expect(f.getByText("Diary")).toBeInTheDocument();
    /* since the job was raised — the oldest event on the feed. July is one
       of the three months en-AU genuinely spells in full. */
    expect(f.getByText("Since Thu 30 July")).toBeInTheDocument();
    expect(f.getByText("Units being delivered direct to site")).toBeInTheDocument();
    expect(f.getByText("Luke Ingold")).toBeInTheDocument();
    /* the visits are entries now, with the crew named */
    expect(f.getByText("Site visit — 10h 20m")).toBeInTheDocument();
    expect(f.getByText("Callum Vrieze, Alex Lorenz")).toBeInTheDocument();
    /* the tick echoes in the diary */
    expect(f.getByText("Checked off — Isolate power")).toBeInTheDocument();
    /* and the milestone sinks to its day's end */
    expect(f.getByText("Became a work order")).toBeInTheDocument();
  });

  it("filters down to just the notes", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        notes: [
          {
            remoteId: "n-1",
            text: "Grille sizes to order",
            writtenOn: "2026-08-12",
            writtenAt: "2026-08-12 09:14:00",
            writtenBy: "David Hann",
            actionRequired: false,
            fromClaim: null,
          },
        ],
      })
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Diary");

    await userEvent.click(screen.getByRole("tab", { name: "Notes" }));
    const f = face("diary");
    expect(f.getByText("Grille sizes to order")).toBeInTheDocument();
    expect(f.queryByText(/Site visit/)).toBeNull();
  });

  /* The Money filter is a door to money-shaped entries; without the grant
     the server sent none and the button would open an empty room. */
  it("offers no Money filter without the grant", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record());
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Diary");

    expect(screen.getByRole("tab", { name: "Notes" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Money" })).toBeNull();
  });

  it("badges a claim's note with where it was filed, and flags action required", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        notes: [
          {
            remoteId: "n-1",
            text: "Please make double detection",
            writtenOn: "2026-08-21",
            writtenAt: "2026-08-21 16:00:00",
            writtenBy: "Michael Diamond",
            actionRequired: true,
            fromClaim: "2380A",
          },
        ],
      })
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Diary");

    expect(screen.getByText("Please make double detection")).toBeInTheDocument();
    expect(screen.getByText("Action required")).toBeInTheDocument();
    expect(screen.getByText("#2380A")).toBeInTheDocument();
  });

  it("wears an @mention as a callout inside the note's words", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        notes: [
          {
            remoteId: "n-1",
            text: "@lukeingold still need another day on site",
            writtenOn: "2026-08-12",
            writtenAt: "2026-08-12 09:14:00",
            writtenBy: "David Hann",
            actionRequired: false,
            fromClaim: null,
          },
        ],
      })
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Diary");

    const mention = screen.getByText("@lukeingold");
    expect(mention).toHaveClass("wb2-mention");
  });

  it("clusters a day's photos to four tiles and sends +N to the Photos tab", async () => {
    const photo = (n: number): JobMediaItem => ({
      remoteId: `p-${n}`,
      name: `IMG_${n}.jpg`,
      fileType: ".jpg",
      kind: "photo",
      width: null,
      height: null,
      origin: null,
      takenAt: `2026-08-13 10:0${n}:00`,
      url: null,
      fromClaim: null,
    });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce({
      photos: [photo(1), photo(2), photo(3), photo(4), photo(5), photo(6)],
      documents: [],
      elsewhere: [],
      truncated: false,
    });
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Diary");

    expect(face("diary").getByText("6 photos")).toBeInTheDocument();
    const more = screen.getByRole("button", { name: "+2" });
    await userEvent.click(more);
    expect(screen.getByRole("tab", { name: "Photos" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  /* A money event states what happened and is a DOOR — it opens the claim's
     own modal and never repeats the ledger. */
  it("opens the claim modal from a money event", async () => {
    readClaim.mockResolvedValue({
      ledger: { materials: [], payments: [] },
      notes: [],
      media: { photos: [], documents: [], elsewhere: [], truncated: false },
    });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Diary");

    /* the deposit settled — its door names the invoice */
    await userEvent.click(
      within(document.querySelector("#jcsec-diary") as HTMLElement).getAllByRole("button", {
        name: /Invoice #2380A — open it/,
      })[0]
    );
    expect(
      await screen.findByRole("dialog", { name: /Payment 1 — Deposit/ })
    ).toBeInTheDocument();
  });

  it("names what was checked when the diary is empty", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
        detail({
          date: null,
          workOrderDate: null,
          visits: [],
          checklist: [],
          nextBooking: null,
          queue: null,
          timeOnSite: null,
        })
      )
    );
    readJobRecord.mockResolvedValueOnce(record());
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Diary");

    expect(
      screen.getByText("Nothing in the diary yet. Checked notes, visits, photos and checklists.")
    ).toBeInTheDocument();
  });
});

/* ── the Visits face ── */

describe("the Visits face", () => {
  it("lists every visit with who went, tallies the heading, and puts the booking first", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Visits");

    const f = face("visits");
    expect(f.getByText("Visits — 2 · 18h 30m on site")).toBeInTheDocument();
    expect(f.getByText("Fri 14 Aug")).toBeInTheDocument();
    expect(f.getByText("Callum Vrieze, Alex Lorenz")).toBeInTheDocument();
    expect(f.getByText("10h 20m")).toBeInTheDocument();
    /* the next booking leads, with its end time */
    expect(f.getByText("Next on site")).toBeInTheDocument();
    expect(f.getByText("7:30am–3:30pm Fri 14 Aug")).toBeInTheDocument();
    /* and the queue keeps its own fact */
    expect(f.getByText("Parts on Order")).toBeInTheDocument();
    expect(f.getByText(/Luke Ingold · until Thu 20 Aug/)).toBeInTheDocument();
  });

  it("shows the recent visits and opens the rest in place", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      day: `2026-08-${String(20 - i).padStart(2, "0")}`,
      minutes: 60,
      crew: ["Alex Lorenz"],
    }));
    readMirrorJob.mockResolvedValueOnce(card(detail({ visits: many })));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Visits");

    const f = face("visits");
    expect(f.getByText("Thu 20 Aug")).toBeInTheDocument();
    expect(f.queryByText("Wed 12 Aug")).toBeNull();

    await userEvent.click(f.getByText("All 12 visits"));
    expect(f.getByText("Wed 12 Aug")).toBeInTheDocument();
    expect(f.queryByText("All 12 visits")).toBeNull();
  });

  it("says so when nobody has been on site and nothing is booked", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(detail({ visits: [], nextBooking: null, queue: null, timeOnSite: null }))
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Visits");
    expect(
      screen.getByText("Nobody's been on site yet, and nothing is booked.")
    ).toBeInTheDocument();
  });
});

/* ── the Checklist face ── */

describe("the Checklist face", () => {
  it("shows the checklist grouped by section, with who ticked what", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Checklist");

    expect(screen.getByText("From ServiceM8 — 1 of 3 done")).toBeInTheDocument();
    expect(screen.getByText("Handover")).toBeInTheDocument();

    const done = screen.getByText("Isolate power").closest(".wb2-ckrow")!;
    expect(done.className).toContain("done");
    expect(within(done as HTMLElement).getByText("Callum Vrieze · Thu 13 Aug")).toBeInTheDocument();

    const form = screen.getByText("DAS Service Call").closest(".wb2-ckrow")!;
    expect(form.className).not.toContain("done");
    expect(within(form as HTMLElement).getByText("Form")).toBeInTheDocument();
  });

  it("stays writable when the job has no list at all", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ checklist: [] })));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Checklist");
    expect(
      screen.getByText("Nothing on the checklist yet — type the first row above.")
    ).toBeInTheDocument();
    /* the composer is the point of the face — it is there even when empty */
    expect(screen.getByLabelText("Add to the list")).toBeInTheDocument();
  });
});

/* ── the money block, now on its own face ── */

type FamilyInput = Parameters<typeof deriveFamilyMoney>[0];

const familyMoney = (over: Partial<FamilyInput> = {}): FamilyMoney =>
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

describe("the Money face", () => {
  const openMoney = async () => {
    await detailLanded();
    await openTab("Money");
  };

  it("reads three ServiceM8 cards as one job, with the claims numbered", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await openMoney();

    expect(await screen.findByText("$31,340.35")).toBeInTheDocument();
    expect(screen.getByText("Job value (inc GST)")).toBeInTheDocument();
    expect(screen.getByText("Payment 1 — Deposit")).toBeInTheDocument();
    expect(screen.getByText("Payment 2 — Progress")).toBeInTheDocument();
    expect(screen.getByText("Payment 3 — Final")).toBeInTheDocument();
    expect(
      screen.getByText("Invoice #2380A · 30% of the job · Raised Fri 27 Mar · Paid Thu 2 Apr")
    ).toBeInTheDocument();
  });

  it("counts the money that landed on the clones", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await openMoney();

    await screen.findByText("$31,340.35");
    const head = document.querySelector(".wb2-mline.head") as HTMLElement;
    expect(within(head).getByText("Awaiting payment")).toBeInTheDocument();
    expect(within(head).getByText("$6,268.06")).toBeInTheDocument();
    expect(within(head).getByText("20% of the job")).toBeInTheDocument();
    expect(screen.queryByText("Nothing paid yet")).toBeNull();
  });

  it("says what has been invoiced and what is still to bill", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        family: familyMoney({
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
        }),
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await openMoney();

    expect(
      await screen.findByText("$25,072.29 invoiced so far — $6,268.06 to come")
    ).toBeInTheDocument();
    expect(screen.getByText("To come")).toBeInTheDocument();
  });

  it("stands the total down rather than adding ex-GST to inc-GST", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        family: familyMoney({
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
        }),
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await openMoney();

    expect(await screen.findByText(/different tax bases/)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Job value")).toBeInTheDocument();
    expect(screen.queryByText("Job value (inc GST)")).toBeNull();
    expect(screen.queryByText("Part or all paid")).toBeNull();
    expect(screen.queryByText("Nothing paid yet")).toBeNull();
  });

  it("names no invoice number on the part still to bill", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        family: familyMoney({
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
        }),
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await openMoney();

    expect(await screen.findByText("Not yet invoiced")).toBeInTheDocument();
    expect(screen.queryByText(/Invoice #2380 ·/)).toBeNull();
  });

  it("wears the job type's colour as the block's edge", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await openMoney();

    await screen.findByText("$31,340.35");
    const block = document.querySelector(".wb2-jmoney") as HTMLElement;
    expect(block.style.borderColor).toBe("rgb(231, 181, 255)");
  });

  it("keeps the partial-invoice rows out of what went on the job", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
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
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await openMoney();

    expect(await screen.findByText("As Per Quote")).toBeInTheDocument();
    expect(screen.queryByText("Partial invoice #2380A")).toBeNull();
    expect(screen.getByText("Discount")).toBeInTheDocument();
  });

  it("shows no figure at all until the family read has landed", async () => {
    let land: (v: JobRecordRead) => void = () => {};
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockReturnValueOnce(
      new Promise<JobRecordRead>((res) => {
        land = res;
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await openMoney();

    expect(document.querySelector(".wb2-jmoney")).toBeNull();
    expect(screen.getByText("Reading the figures…")).toBeInTheDocument();

    land(record({ family: familyMoney() }));
    expect(await screen.findByText("$31,340.35")).toBeInTheDocument();
  });
});

describe("the money block never speaks past what it knows", () => {
  const mixed = () =>
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
          paidCents: 0,
          lastPaidOn: null,
          lines: { cents: 854737, taxInclusive: false },
          raisedOn: "2026-03-27",
        },
      ],
      today: "2026-08-26",
      termsDays: null,
    });

  it("does not resurrect the job row's own total when the family stood one down", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
        detail({
          money: {
            valueCents: 626806,
            invoiced: null,
            invoicedOn: null,
            quoteSent: null,
            quoteSentOn: null,
            paid: false,
            paidOn: null,
          },
        })
      )
    );
    readJobRecord.mockResolvedValueOnce(record({ family: mixed() }));
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    await screen.findByText(/different tax bases/);
    expect(document.querySelector(".wb2-jmbig")!.textContent).toBe("—");
    expect(screen.getByText("Job value")).toBeInTheDocument();
    const claim = screen.getByText("Payment 2 — Final").closest(".wb2-mline")!;
    expect(within(claim as HTMLElement).getByText("$6,268.06")).toBeInTheDocument();
  });

  it("does not call a job paid in full while a claim is still to be billed", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        family: familyMoney({
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
        }),
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await screen.findByText(/invoiced so far/)).toBeInTheDocument();
    expect(screen.queryByText("Paid in full")).toBeNull();
  });

  it("counts the ledger's payments when there is no family to count", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
        detail({
          money: {
            valueCents: 279400,
            invoiced: null,
            invoicedOn: null,
            quoteSent: null,
            quoteSentOn: null,
            paid: false,
            paidOn: null,
          },
        })
      )
    );
    readJobRecord.mockResolvedValueOnce(
      record({
        ledger: {
          materials: [],
          payments: [
            {
              remoteId: "p-1",
              amountCents: 279400,
              method: "Bank Transfer",
              note: null,
              takenOn: "2026-08-07",
              takenAt: "2026-08-07 10:00:00",
              isDeposit: false,
              takenBy: null,
            },
          ],
        },
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await screen.findByText("Paid in full")).toBeInTheDocument();
    expect(screen.queryByText("Nothing paid yet")).toBeNull();
  });
});

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
    readMirrorJob.mockResolvedValueOnce(card(detail({ money: jobMoney })));
    readJobRecord.mockResolvedValueOnce(record({ family: plain() }));
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await screen.findByText("$2,794")).toBeInTheDocument();
    expect(screen.getByText("Nothing paid yet")).toBeInTheDocument();
    expect(document.querySelector(".wb2-jmbar")).toBeNull();
    expect(screen.queryByText(/^Payment 1/)).toBeNull();
  });

  it("wears the amber head row once there is something to chase", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ money: jobMoney })));
    readJobRecord.mockResolvedValueOnce(
      record({
        family: plain({ paidCents: 100000, lastPaidOn: "2026-08-07", raisedOn: "2026-08-01" }),
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    await screen.findByText("$2,794");
    const head = document.querySelector(".wb2-mline.head") as HTMLElement;
    expect(within(head).getByText("Awaiting payment")).toBeInTheDocument();
    expect(within(head).getByText("$1,794")).toBeInTheDocument();
    expect(document.querySelector(".wb2-jmbar")).not.toBeNull();
    expect(screen.queryByText(/Part paid/)).toBeNull();
  });
});

/* ── a clone opens the job it is a claim of ── */

describe("a card opened from a progress claim", () => {
  const opened = () => {
    readMirrorJob.mockResolvedValueOnce(card(detail(), "j-2380a"));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
  };

  /* The walked #556 behaviour, kept through the move onto tabs: a clone's
     row lands on the MONEY face with its claim named. */
  it("lands on the Money face with the crumb and the claim named", async () => {
    opened();
    render(<JobSheet row={row({ number: "2380A" })} {...props} moneyVisible />);

    expect(await screen.findByText("$31,340.35")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Money" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByTitle("3 invoices on this job")).toHaveTextContent("#3137");
    expect(document.querySelector(".wb2-shcrumb")).not.toBeNull();
    expect(screen.getByTitle(/Payment 1 — Deposit — open it/)).toHaveTextContent("#2380A");
    expect(screen.getAllByText("Payment 1 — Deposit").length).toBeGreaterThan(0);
  });

  it("marks the claim it was opened for in the ledger", async () => {
    opened();
    render(<JobSheet row={row({ number: "2380A" })} {...props} moneyVisible />);

    await screen.findByText("$31,340.35");
    const here = document.querySelector(".wb2-jmclaim.here") as HTMLElement;
    expect(here).not.toBeNull();
    expect(within(here).getByText("Payment 1 — Deposit")).toBeInTheDocument();
  });

  it("reads the job's own record and files, not the claim's", async () => {
    opened();
    render(<JobSheet row={row({ id: "j-2380a", number: "2380A" })} {...props} moneyVisible />);

    await screen.findByText("$31,340.35");
    expect(readJobRecord).toHaveBeenCalledWith("j-1");
    expect(readJobFiles).toHaveBeenCalledWith("j-1");
    expect(readJobRecord).not.toHaveBeenCalledWith("j-2380a");
  });

  it("shows the job's own day and status, not the claim's", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
        detail({ status: "Completed", dateOn: "2026-08-21", dateLabel: "completed" }),
        "j-2380a"
      )
    );
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(
      <JobSheet
        row={row({ number: "2380A", statusLabel: "Quote", tone: "", date: "2026-03-27 00:00:00", dateLabel: "quoted" })}
        {...props}
        moneyVisible
      />
    );

    await screen.findByText("$31,340.35");
    expect(screen.getByText("Completed · Fri 21 Aug")).toBeInTheDocument();
    expect(screen.queryByText("Quote")).toBeNull();
    expect(screen.queryByText(/^Raised /)).toBeNull();
  });

  it("says nothing about a claim on a job that was never cloned", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record());
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();

    expect(document.querySelector(".wb2-shcrumb")).toBeNull();
    expect(document.querySelector(".wb2-shcar")).toBeNull();
    /* and it stays on Summary — no focus, no jump */
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });
});

describe("the job number lists its claims", () => {
  it("opens the list and addresses each invoice", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await waitFor(() =>
      expect(screen.getByTitle("3 invoices on this job")).toBeInTheDocument()
    );
    await userEvent.click(screen.getByTitle("3 invoices on this job"));

    const pop = document.querySelector(".wb2-shnopop") as HTMLElement;
    expect(within(pop).getByText("#2380A")).toBeInTheDocument();
    expect(within(pop).getByText("#2380B")).toBeInTheDocument();
    expect(within(pop).getByText("Payment 3 — Final")).toBeInTheDocument();
  });
});

describe("one claim, opened", () => {
  const openFirstClaim = async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");
    await screen.findByText("$31,340.35");
    await userEvent.click(
      screen.getByRole("button", { name: /Payment 1 — Deposit — open this invoice/ })
    );
  };

  it("shows the invoice's own lines, money and paper — and nothing the job owns", async () => {
    readClaim.mockResolvedValue({
      ledger: {
        materials: [
          {
            remoteId: "m-1",
            name: "Progress payment 30%",
            quantity: 1,
            unitCents: 838800,
            taxInclusive: false,
            lineCents: 838800,
          },
        ],
        payments: [
          {
            remoteId: "pay-1",
            amountCents: 940211,
            method: "Stripe",
            note: null,
            takenOn: "2026-04-02",
            takenAt: "2026-04-02 10:12:00",
            isDeposit: true,
            takenBy: "Luke Ingold",
          },
        ],
      },
      notes: [],
      media: {
        photos: [],
        documents: [
          {
            remoteId: "f-1",
            name: "Partial Invoice #2380A",
            fileType: ".pdf",
            kind: "document" as const,
            width: null,
            height: null,
            origin: "Invoice",
            takenAt: null,
            url: null,
            fromClaim: null,
          },
        ],
        elsewhere: [],
        truncated: false,
      },
    });
    await openFirstClaim();

    const modal = await screen.findByRole("dialog", { name: /Payment 1 — Deposit/ });
    expect(within(modal).getByText("Progress payment 30%")).toBeInTheDocument();
    expect(within(modal).getByText("Stripe")).toBeInTheDocument();
    expect(within(modal).getByText("Partial Invoice #2380A")).toBeInTheDocument();
    expect(within(modal).queryByText(/Visits/)).toBeNull();
    expect(within(modal).queryByText("Who to ring")).toBeNull();
  });

  it("names what was checked when the only note was ServiceM8's own", async () => {
    readClaim.mockResolvedValue({
      ledger: { materials: [], payments: [] },
      notes: [],
      media: { photos: [], documents: [], elsewhere: [], truncated: false },
    });
    await openFirstClaim();

    expect(
      await screen.findByText(/ServiceM8's own note about raising it isn't repeated here/)
    ).toBeInTheDocument();
  });

  it("closes on Escape without closing the card under it", async () => {
    const onClose = jest.fn();
    readClaim.mockResolvedValue({
      ledger: { materials: [], payments: [] },
      notes: [],
      media: { photos: [], documents: [], elsewhere: [], truncated: false },
    });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<JobSheet row={row()} {...props} moneyVisible onClose={onClose} />);
    await detailLanded();
    await openTab("Money");
    await screen.findByText("$31,340.35");
    await userEvent.click(
      screen.getByRole("button", { name: /Payment 2 — Progress — open this invoice/ })
    );
    await screen.findByRole("dialog", { name: /Payment 2 — Progress/ });

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /Payment 2/ })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/* ── the ⋯ menu and the tracked chip — the Actions face retired ── */

describe("the band's once-per-job acts", () => {
  it("holds the promote actions behind the ⋯, manage only", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} manage />);
    await detailLanded();

    await userEvent.click(screen.getByLabelText("More actions"));
    expect(screen.getByText("Create a project from this job")).toBeInTheDocument();
    expect(screen.getByText("Create a maintenance agreement")).toBeInTheDocument();
  });

  it("shows no ⋯ at all without manage", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    expect(screen.queryByLabelText("More actions")).toBeNull();
  });

  it("names the project on the floor and creates it", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} manage />);
    await detailLanded();

    await userEvent.click(screen.getByLabelText("More actions"));
    await userEvent.click(screen.getByText("Create a project from this job"));
    const input = screen.getByLabelText("Name the project");
    await userEvent.clear(input);
    await userEvent.type(input, "Wallace St change-over{Enter}");
    await waitFor(() =>
      expect(createProjectFromJob).toHaveBeenCalledWith("j-1", expect.objectContaining({
        name: "Wallace St change-over",
      }))
    );
  });

  it("Escape in the naming row cancels the naming, not the card", async () => {
    const onClose = jest.fn();
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} manage onClose={onClose} />);
    await detailLanded();

    await userEvent.click(screen.getByLabelText("More actions"));
    await userEvent.click(screen.getByText("Create a project from this job"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("Name the project")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("wears the tracked board as a chip in the band, and the chip is the door", async () => {
    const onOpenTracked = jest.fn();
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(
      <JobSheet
        row={row({ tracked: { kind: "visit", id: "v-1", label: "#1021" } })}
        {...props}
        onOpenTracked={onOpenTracked}
      />
    );
    await detailLanded();

    await userEvent.click(screen.getByTitle("Open #1021"));
    expect(onOpenTracked).toHaveBeenCalledWith({ kind: "visit", id: "v-1", label: "#1021" });
    expect(screen.getByText("On the maintenance board")).toBeInTheDocument();
  });
});

/* ── money stays behind its grant ── */

describe("money stays behind its grant", () => {
  it("says when the quote went out, for a reader who holds money", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
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
      )
    );
    render(<JobSheet row={row({ statusLabel: "Quote" })} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await screen.findByText("Quote sent Mon 3 Aug")).toBeInTheDocument();
    expect(screen.getByText("$6,850")).toBeInTheDocument();
    expect(screen.queryByText("Nothing paid yet")).toBeNull();
  });

  it("keeps the quote's own sentence when a family read produces an awaiting figure", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
        detail({
          money: {
            valueCents: 401500,
            invoiced: null,
            invoicedOn: null,
            quoteSent: true,
            quoteSentOn: "2026-08-03",
            paid: false,
            paidOn: null,
          },
        })
      )
    );
    readJobRecord.mockResolvedValueOnce(
      record({
        family: familyMoney({
          members: [
            {
              remoteId: "j-3169",
              jobNumber: "3169",
              totalCents: 401500,
              paidCents: 0,
              lastPaidOn: null,
              lines: null,
              raisedOn: "2026-08-10",
            },
          ],
        }),
      })
    );
    render(<JobSheet row={row({ statusLabel: "Quote" })} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await screen.findByText("Quote sent Mon 3 Aug")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting payment")).toBeNull();
  });

  it("says the figures didn't load rather than dropping the money block", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockRejectedValueOnce(new Error("boom"));
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(
      await screen.findByText(/ServiceM8's figures didn't load just now/)
    ).toBeInTheDocument();
    expect(document.querySelector(".wb2-jmoney")).not.toBeNull();
    expect(screen.queryByText("$2,794")).toBeNull();
  });

  it("draws the paid-in-full head row when both axes agree", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        family: familyMoney({
          members: [
            {
              remoteId: "j-2380",
              jobNumber: "2380",
              totalCents: 626806,
              paidCents: 626806,
              lastPaidOn: "2026-08-22",
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
        }),
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await screen.findAllByText("$31,340.35")).toHaveLength(2);
    const head = document.querySelector(".wb2-mline.head.ok") as HTMLElement;
    expect(head).not.toBeNull();
    expect(within(head).getByText("Paid in full")).toBeInTheDocument();
    expect(within(head).getByText("$31,340.35")).toBeInTheDocument();
  });

  it("renders no money fact at all without the grant, whatever the detail says", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();

    expect(screen.queryByRole("tab", { name: "Money" })).toBeNull();
    expect(screen.queryByText(/Job value/)).toBeNull();
  });

  it("says which basis the figure is on", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
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
      )
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await screen.findByText("$1,485")).toBeInTheDocument();
    expect(screen.getByText(/Job value \(inc GST\)/)).toBeInTheDocument();
  });

  it("stays silent about invoicing when ServiceM8 never said", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
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
      )
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    await screen.findByText("$1,485");
    expect(screen.queryByText("Not invoiced")).toBeNull();
    expect(screen.queryByText(/awaiting payment/i)).toBeNull();
  });

  it("still says Not invoiced when ServiceM8 actually says so", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
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
      )
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");
    expect(await screen.findByText("Not invoiced")).toBeInTheDocument();
  });
});

/* ── the Documents face ── */

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

  it("lists each one under Drawings as a link that opens THAT design", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ designs: [design()] })));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    expect(screen.getByText("Drawings — designed in the Studio")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /12\/3 Wallace St/ });
    expect(link).toHaveAttribute("href", "/dashboard/studio?design=dsn_1");
    expect(within(link).getByText(/2 floors · 3 systems/)).toBeInTheDocument();
  });

  it("counts the options in the heading when a job has several", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
        detail({
          designs: [design(), design({ id: "dsn_2", name: "12/3 Wallace St — option B" })],
        })
      )
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    expect(screen.getByText("Drawings — 2 Studio options")).toBeInTheDocument();
    expect(document.querySelectorAll("a.wb2-dsgn")).toHaveLength(2);
  });

  it("says one floor and one system in the singular", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(detail({ designs: [design({ floorCount: 1, systemCount: 1 })] }))
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    expect(screen.getByText(/1 floor · 1 system/)).toBeInTheDocument();
  });

  it("is absent entirely when nothing has been designed", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    expect(screen.queryByText(/Drawings/)).toBeNull();
  });

  it("encodes the id it puts in the link", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ designs: [design({ id: "dsn a&b" })] })));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    expect(screen.getByRole("link", { name: /12\/3 Wallace St/ })).toHaveAttribute(
      "href",
      "/dashboard/studio?design=dsn%20a%26b"
    );
  });
});

/* ── the Photos and Documents faces read the same files ── */

describe("files on the job", () => {
  const file = (over: Partial<JobMediaItem> & { remoteId: string }): JobMediaItem => ({
    name: "IMG_4021.jpg",
    fileType: ".jpg",
    kind: "photo",
    width: null,
    height: null,
    origin: null,
    fromClaim: null,
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

  it("says so when a job has no photos", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");
    expect(await screen.findByText("No photos on this job.")).toBeInTheDocument();
  });

  it("shows a cached photo as a real image, linked to the full size", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(
      files({ photos: [file({ remoteId: "p-1", url: "https://signed/p-1.jpg" })] })
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");

    /* scoped: the Diary clusters the same photo, so the alt exists twice */
    const img = (await face("photos").findByAltText("IMG_4021.jpg")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://signed/p-1.jpg");
    expect(img.closest("a")!.getAttribute("href")).toBe("https://signed/p-1.jpg");
  });

  it("shows a placeholder tile for a photo whose bytes aren't cached", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files({ photos: [file({ remoteId: "p-1" })] }));
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");

    await waitFor(() => expect(face("photos").getByText("1 photo")).toBeInTheDocument());
    expect(screen.queryByAltText("IMG_4021.jpg")).toBeNull();
    expect(document.querySelector(".wb2-mtile.pending")).not.toBeNull();
  });

  it("names the paperwork and links it once it's cached", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
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
    await detailLanded();
    await openTab("Documents");

    const name = await screen.findByText("Invoice #3137.pdf");
    expect(name.closest("a")!.getAttribute("href")).toBe("https://signed/d-1.pdf");
    /* the name already says "Invoice", so the row does NOT say it again —
       the origin only shows where it adds something (the emailed-in test) */
    expect(screen.queryByText("Invoice")).toBeNull();
  });

  it("chips a document that arrived by email, not just the paperwork", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
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
    await detailLanded();
    await openTab("Documents");

    await screen.findByText("Site induction.pdf");
    expect(screen.getByText("Emailed in")).toBeInTheDocument();
  });

  it("puts a photo's origin in its tooltip, where the name already is", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(
      files({ photos: [file({ remoteId: "p-1", origin: "Emailed in" })] })
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");

    await waitFor(() => expect(face("photos").getByText("1 photo")).toBeInTheDocument());
    const tile = document.querySelector(".wb2-mtile") as HTMLElement;
    expect(tile.getAttribute("title")).toBe("IMG_4021.jpg — emailed in");
  });

  it("counts what stays in ServiceM8 instead of pretending it isn't there", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(
      files({
        photos: [file({ remoteId: "p-1" }), file({ remoteId: "p-2" })],
        elsewhere: [
          file({ remoteId: "v-1", name: "walkthrough.mp4", fileType: ".mp4", kind: "video" }),
        ],
      })
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");
    await waitFor(() => expect(face("photos").getByText("2 photos")).toBeInTheDocument());

    await openTab("Documents");
    expect(face("documents").getByText(/1 file stays in ServiceM8/)).toBeInTheDocument();
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
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles
      .mockResolvedValueOnce({ ok: true, cached: 6, remaining: 6, media: null, note: null })
      .mockResolvedValueOnce({ ok: true, cached: 6, remaining: 0, media: null, note: null });

    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await waitFor(() => expect(cacheJobFiles).toHaveBeenCalledTimes(2));
  });

  it("stops immediately when a round caches nothing, even with work left", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 20, media: null, note: null });

    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await waitFor(() => expect(cacheJobFiles).toHaveBeenCalledTimes(1));
  });

  it("says out loud when storage is the thing standing in the way", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles.mockResolvedValueOnce({
      ok: true,
      cached: 0,
      remaining: 12,
      media: files({
        photos: [
          {
            remoteId: "p-1",
            name: "IMG_4021.jpg",
            fileType: ".jpg",
            kind: "photo" as const,
            width: null,
            height: null,
            origin: null,
            fromClaim: null,
            takenAt: null,
            url: null,
          },
        ],
      }),
      note: "Storage is full — photos can't be brought across until there's room.",
    });

    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");
    expect(await screen.findByText(/Storage is full/)).toBeInTheDocument();
  });
});

/* ── the ledger obeys the money grant ── */

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
        takenAt: "2026-08-01 09:15:00",
        isDeposit: true,
        takenBy: "Luke Ingold",
      },
    ],
  };

  it("shows the lines and their total to a reader who holds money", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ ledger }));
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await screen.findByText("What went on the job")).toBeInTheDocument();
    expect(screen.getByText("Daikin CTXM35RVMA")).toBeInTheDocument();
    expect(screen.getByText("× 2")).toBeInTheDocument();
    expect(screen.getByText("Total inc GST")).toBeInTheDocument();
  });

  it("shows what's been paid, naming a deposit as one", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ ledger }));
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    await screen.findByText("Bank Transfer");
    expect(screen.getByText(/deposit · Sat 1 Aug · Luke Ingold/)).toBeInTheDocument();
  });

  it("renders no ledger at all when the server sent none", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record());
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();

    expect(screen.queryByText("What went on the job")).toBeNull();
    expect(screen.queryByText(/What's been paid/)).toBeNull();
  });

  it("refuses a total when the lines disagree about tax", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        ledger: {
          payments: [],
          materials: [
            { ...ledger.materials[0] },
            { ...ledger.materials[0], remoteId: "m-2", taxInclusive: false },
          ],
        },
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await screen.findByText(/mix tax-inclusive and tax-exclusive/)).toBeInTheDocument();
    expect(screen.queryByText(/^Total/)).toBeNull();
  });

  it("refuses a total when a line couldn't be priced", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        ledger: {
          payments: [],
          materials: [{ ...ledger.materials[0], unitCents: null, lineCents: null }],
        },
      })
    );
    render(<JobSheet row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await screen.findByText(/aren't priced, so there's no total/)).toBeInTheDocument();
  });
});

/* ── OUR checklist — writable, two sections, stamped ticks ── */

describe("the job's own checklist", () => {
  beforeEach(() => {
    readMirrorJob.mockResolvedValue(card(detail()));
  });

  const item = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    name: "MSZ-AP25VGD",
    sub: "wall mounted indoor",
    qty: "3",
    kind: "material",
    picked: false,
    pickedAt: null,
    pickedBy: null,
    addedBy: null,
    designId: "dsn_1",
    addedAt: "2026-08-16T00:00:00.000Z",
    ...over,
  });

  it("draws the two fixed sections, materials under their own head", async () => {
    listJobPicklist.mockResolvedValue([
      item(),
      item({ id: "p2", name: "Pressure test new lineset", kind: "todo", qty: "", designId: null, addedBy: "Jake Thompson" }),
    ]);
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Checklist");

    const ck = face("checklist");
    expect(await ck.findByText("Materials")).toBeInTheDocument();
    /* "To do" is also the composer's seg button — ask for the section head */
    expect(ck.getByText("To do", { selector: ".wb2-sect" })).toBeInTheDocument();
    const materials = ck.getByText("Materials", { selector: ".wb2-sect" }).closest(".wb2-jcsec")!;
    expect(within(materials as HTMLElement).getByText("MSZ-AP25VGD")).toBeInTheDocument();
    const todos = ck.getByText("To do", { selector: ".wb2-sect" }).closest(".wb2-jcsec")!;
    expect(within(todos as HTMLElement).getByText("Pressure test new lineset")).toBeInTheDocument();
    /* the head counts BOTH lists — ours (2 open) and ServiceM8's (2 open, 1 done) */
    expect(ck.getByText("4 open · 1 done")).toBeInTheDocument();
  });

  it("a ticked row STAYS, stamped who and when to the minute", async () => {
    listJobPicklist.mockResolvedValue([
      item({
        id: "p3",
        name: "Isolate old unit",
        kind: "todo",
        qty: "",
        designId: null,
        picked: true,
        /* 01:52Z = 11:52am in Sydney winter */
        pickedAt: "2026-08-14T01:52:00.000Z",
        pickedBy: "Jake Thompson",
      }),
    ]);
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Checklist");

    const rowEl = (await screen.findByText("Isolate old unit")).closest(".wb2-pkrow")!;
    expect(rowEl.className).toContain("done");
    expect(
      within(rowEl as HTMLElement).getByText("Jake Thompson · 11:52am Fri 14 Aug")
    ).toBeInTheDocument();
  });

  it("ticking saves, and shows immediately rather than waiting on the server", async () => {
    const user = userEvent.setup();
    setPicklistItemPicked.mockReturnValue(new Promise(() => {}));
    listJobPicklist.mockResolvedValue([item()]);
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Checklist");

    const box = await screen.findByLabelText("Done: MSZ-AP25VGD");
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
    await detailLanded();
    await openTab("Checklist");

    const box = await screen.findByLabelText("Done: MSZ-AP25VGD");
    await user.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(onToast).toHaveBeenCalledWith("Could not save that tick");
  });

  it("types a row onto the list and swaps in the saved one", async () => {
    const user = userEvent.setup();
    listJobPicklist.mockResolvedValue([]);
    addJobPicklistItem.mockResolvedValue(
      item({ id: "srv-1", name: "Order PAR-40 controller", kind: "todo", qty: "", designId: null, addedBy: "Isaac Smith" })
    );
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Checklist");

    await user.type(screen.getByLabelText("Add to the list"), "Order PAR-40 controller");
    await user.click(screen.getByRole("button", { name: "Add" }));

    /* optimistic first — the row is on the list before the server answers */
    expect(screen.getByText("Order PAR-40 controller")).toBeInTheDocument();
    await waitFor(() =>
      expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", {
        kind: "todo",
        name: "Order PAR-40 controller",
        qty: "",
      })
    );
  });

  it("a material row asks for a quantity; a to-do never does", async () => {
    const user = userEvent.setup();
    listJobPicklist.mockResolvedValue([]);
    render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Checklist");

    expect(screen.queryByLabelText("Quantity")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Material" }));
    await user.type(screen.getByLabelText("Add to the list"), "Linear bar grille");
    await user.type(screen.getByLabelText("Quantity"), "2");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", {
        kind: "material",
        name: "Linear bar grille",
        qty: "2",
      })
    );
  });

  it("takes the typed row back off the list when the save fails", async () => {
    const user = userEvent.setup();
    const onToast = jest.fn();
    listJobPicklist.mockResolvedValue([]);
    addJobPicklistItem.mockRejectedValue(new Error("offline"));
    render(<JobSheet row={row()} {...props} onToast={onToast} />);
    await detailLanded();
    await openTab("Checklist");

    await user.type(screen.getByLabelText("Add to the list"), "Ghost row");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByText("Ghost row")).not.toBeInTheDocument());
    expect(onToast).toHaveBeenCalledWith("Could not add that row");
  });

  it("only a manager can remove a line", async () => {
    listJobPicklist.mockResolvedValue([item()]);
    const { unmount } = render(<JobSheet row={row()} {...props} />);
    await detailLanded();
    await openTab("Checklist");
    expect(await screen.findByText("MSZ-AP25VGD")).toBeInTheDocument();
    expect(screen.queryByLabelText("Remove MSZ-AP25VGD")).not.toBeInTheDocument();
    unmount();

    render(<JobSheet row={row()} {...props} manage />);
    await detailLanded();
    await openTab("Checklist");
    expect(await screen.findByLabelText("Remove MSZ-AP25VGD")).toBeInTheDocument();
  });

  it("a checklist that will not load never takes the sheet down", async () => {
    listJobPicklist.mockRejectedValue(new Error("offline"));
    render(<JobSheet row={row()} {...props} />);
    expect(await screen.findByText("Scope")).toBeInTheDocument();
    await openTab("Checklist");
    expect(screen.queryByText("Materials")).not.toBeInTheDocument();
  });
});
