/* THE JOB'S ADD (docs/design.md, rule 54): Visit, Task, Quote
   (Variation once accepted), Cost, SWMS, Certificate, first in the page
   head's Actions menu ("Add visit"). Each item is a door to the flow the card already has, behind
   that flow's own check, and an item the reader may not use is not there. */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobBookings, JobCardRead, JobRecordRead } from "@/app/actions/workboard";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import type { QuoteFacts } from "@/lib/quotes/quote-card";

const readMirrorJob = jest.fn(async (): Promise<JobCardRead> => ({ detail: null, focusRemoteId: null }));
const readJobRecord = jest.fn(async (): Promise<JobRecordRead | null> => null);
/* The job's page mode draws its conversation, whose Add photo reaches the
   documents actions ("use server", which jsdom can't load). */
jest.mock("@/app/actions/documents", () => ({ deleteDocument: jest.fn(async () => ({ ok: true })) }));
jest.mock("@/app/actions/workboard", () => ({
  readMirrorJob: (...a: unknown[]) => readMirrorJob(...(a as [])),
  readJobRecord: (...a: unknown[]) => readJobRecord(...(a as [])),
  readJobFiles: jest.fn(async () => null),
  readClaim: jest.fn(async () => null),
  createProjectFromJob: jest.fn(async () => ({ ok: true, id: "p" })),
}));
jest.mock("@/app/actions/workboard-media", () => ({
  cacheJobFiles: jest.fn(async () => ({ ok: true, cached: 0, remaining: 0, media: null, note: null })),
}));
jest.mock("@/app/actions/job-deposit", () => ({ setNoDeposit: jest.fn(async (_j: string, on: boolean) => ({ ok: true, noDeposit: on })) }));
jest.mock("@/app/actions/quote-sm8", () => ({
  quoteSendOffered: jest.fn(async () => ({ offered: false, trial: false })),
  sendQuoteToSm8: jest.fn(),
}));
jest.mock("@/app/actions/job-customer", () => ({
  customerEditOffered: jest.fn(async () => false),
  readCustomerForEdit: jest.fn(),
  saveCustomer: jest.fn(),
}));
jest.mock("@/app/actions/job-check-ins", () => ({
  readMyCheckIn: jest.fn(async () => null),
  checkIn: jest.fn(async () => null),
  checkOut: jest.fn(async () => null),
}));
jest.mock("@/app/actions/job-picklist", () => ({
  listJobPicklist: jest.fn(async () => []),
  setPicklistItemPicked: jest.fn(async () => null),
  removePicklistItem: jest.fn(async () => {}),
  addJobPicklistItem: jest.fn(async () => ({})),
}));
jest.mock("@/app/actions/photo-readings", () => ({
  readJobPhotos: jest.fn(async () => ({ ok: true, read: 0, remaining: 0, note: null })),
}));
jest.mock("@/app/actions/job-photo-favourites", () => ({
  listJobPhotoFavourites: jest.fn(async () => []),
  setJobPhotoFavourite: jest.fn(async () => ({ ok: true, starred: false, note: null })),
}));
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
jest.mock("@/app/actions/tiff-open", () => ({ openRecordByName: jest.fn(async () => null) }));
/* the job page's Overview holds the Tiff modal's conversation, which reads the calendar's line actions */
jest.mock("@/app/actions/calendar", () => ({ fileCalendarLine: jest.fn(), noteOnCalendarEvents: jest.fn(), undoCalendarLine: jest.fn() }));
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: jest.fn(async () => ({ ok: false, error: "no" })),
  dismissNote: jest.fn(async () => ({ ok: true, summary: "" })),
  clearFlag: jest.fn(async () => ({ ok: true })),
  restoreFlag: jest.fn(async () => ({ ok: true, summary: "" })),
}));
jest.mock("@/app/actions/job-notes", () => ({
  addJobNote: jest.fn(async () => ({})),
  removeJobNote: jest.fn(async () => {}),
  taskFromJobNote: jest.fn(async () => ({ ok: true, taskId: "t" })),
  dismissJobNote: jest.fn(async () => {}),
}));
/* the wizards are their own suites' business: here, only that Add opens them */
jest.mock("@/components/swms/swms-wizard", () => ({
  SwmsWizard: () => <div role="dialog" aria-label="New SWMS" />,
}));
jest.mock("@/components/certs/cert-wizard", () => ({
  CertWizard: () => <div role="dialog" aria-label="New certificate" />,
}));
/* Add › Cost's form is its own suite's (making/__tests__/expense-form):
   here, that Add opens it over the job, with the job filled in */
const costForm = jest.fn();
jest.mock("@/components/making/expense-form", () => ({
  ExpenseForm: (p: { job: unknown; onClose: () => void }) => {
    costForm(p);
    return (
      <div role="dialog" aria-label="Add a cost">
        <button type="button" onClick={p.onClose}>
          Cancel
        </button>
      </div>
    );
  },
}));

import { useState } from "react";
import { JobSheet, type JobSheetPage } from "../job-sheet";
import type { JobSection } from "@/lib/jobs/job-sections";

type JobProps = Omit<Parameters<typeof JobSheet>[0], "page"> & { section?: JobSection; add?: JobSheetPage["add"] };
/** The job's page on one section; a move to another section draws it, as the page does. */
function Job({ section: first = "overview", add, ...p }: JobProps) {
  const [section, setSection] = useState<JobSection>(first);
  return <JobSheet {...p} page={{ section, onSection: setSection, actions: [], onAction: () => {}, add }} />;
}

const JOB = "0b1e0b1e-0000-4000-8000-00000000d054";

const row = (): AllJobRow => ({
  key: `sm8:${JOB}`,
  kind: "sm8",
  id: JOB,
  number: "3400",
  numberSystem: "sm8",
  clientName: "Sample Client Pty Ltd",
  title: "Install a split",
  suburb: "Rose Bay",
  categoryName: "Install",
  categoryColour: "#e7b5ff",
  statusLabel: "Work Order",
  tone: "",
  date: "2026-10-01 09:00:00",
  dateLabel: "raised",
  booked: true,
  tracked: null,
  money: null,
  sortOn: "2026-10-01",
});

const detail = (over: Partial<MirrorJobDetail> = {}): MirrorJobDetail => ({
  remoteId: JOB,
  jobNumber: "3400",
  status: "Work Order",
  clientName: "Sample Client Pty Ltd",
  description: "Install a split",
  workDone: null,
  address: null,
  suburb: "Rose Bay",
  geoLine: "Rose Bay NSW 2029",
  categoryName: "Install",
  categoryColour: "#e7b5ff",
  purchaseOrder: null,
  date: "2026-10-01 09:00:00",
  quoteDate: null,
  quoteSentOn: "2026-09-20",
  workOrderDate: "2026-10-02 09:00:00",
  completionDate: null,
  nextBooking: null,
  timeOnSite: null,
  dateOn: "2026-10-01",
  dateLabel: "raised",
  visits: [],
  queue: null,
  checklist: [],
  contacts: [],
  money: null,
  designs: [],
  timezone: null,
  booked: [],
  ...over,
});

const bookings = (over: Partial<JobBookings> = {}): JobBookings => ({
  offered: true,
  canBook: true,
  canClear: true,
  trial: false,
  hold: null,
  zone: "Australia/Sydney",
  verbs: [],
  lines: {},
  ...over,
});

const record = (b: JobBookings | null = bookings()): JobRecordRead => ({
  notes: [],
  ourNotes: [],
  attention: { items: [], total: 0 },
  assignable: [],
  ledger: null,
  family: null,
  summary: null,
  ...(b ? { bookings: b } : {}),
});

const facts = (over: Partial<QuoteFacts> = {}): QuoteFacts => ({
  lines: 12,
  options: 1,
  toConfirm: 0,
  changedAt: "2026-10-10T01:00:00.000Z",
  talked: true,
  drafted: false,
  approved: true,
  version: 1,
  sent: { at: "2026-10-11T01:00:00.000Z", trial: false },
  accepted: [],
  ...over,
});

/* what the routes answer: where the quote stands, and the job's tasks */
let quoteAnswer: unknown = { ok: true, facts: facts() };
const tasksAnswer = {
  ok: true,
  tasks: [],
  updates: [],
  photos: [],
  today: "2026-10-18",
  booked: [],
  quoted: null,
  dayHours: null,
  canMake: false,
  manage: true,
  note: null,
};
const fetchMock = jest.fn(async (url: string) => ({
  json: async () =>
    url.startsWith("/api/workboard/quote-status") ? quoteAnswer : url.startsWith("/api/workboard/job-tasks") ? tasksAnswer : { ok: false },
}));

const noop = () => {};
const props = { manage: true, moneyVisible: false, onCreateAgreement: noop, onOpenTracked: noop, onToast: noop };

/** The job's page, with the job known: Add's items are pressable from here. */
const open = async (extra: Partial<JobProps> = {}) => {
  render(<Job row={row()} {...props} {...extra} />);
  await waitFor(() => expect(document.querySelector(".jp-facts")).toHaveTextContent("Rose Bay NSW 2029"));
  await waitFor(() => expect(readJobRecord).toHaveBeenCalled());
};
/** The head's Actions menu, open: Add's items lead it. */
const addMenu = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Actions" }));
  return screen.findByRole("menu", { name: "Actions on this job" });
};
/** Add's items, as the menu words them. */
const items = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole("menuitem")
    .map((i) => i.textContent ?? "")
    .filter((t) => t.startsWith("Add "));
/** One of the job's section tabs. */
const jobTab = (name: string) => within(screen.getByRole("tablist", { name: "The job" })).getByRole("tab", { name: new RegExp(`^${name}`) });
const pick = async (name: string) => {
  const menu = await addMenu();
  await userEvent.click(within(menu).getByRole("menuitem", { name }));
};

beforeEach(() => {
  readMirrorJob.mockReset().mockResolvedValue({ detail: detail(), focusRemoteId: null });
  readJobRecord.mockReset().mockResolvedValue(record());
  push.mockReset();
  quoteAnswer = { ok: true, facts: facts() };
  fetchMock.mockClear();
  (global as { fetch?: unknown }).fetch = fetchMock;
});

describe("the job's Add", () => {
  it("leads the Actions menu with Visit, Task, Quote, Cost, SWMS, Certificate in that order", async () => {
    await open();
    const add = screen.getByRole("button", { name: "Actions" });
    expect(add).toHaveClass("pt-btn--second");
    expect(add).toHaveAttribute("aria-haspopup", "menu");
    const menu = await addMenu();
    expect(add).toHaveAttribute("aria-expanded", "true");
    expect(items(menu)).toEqual(["Add visit", "Add task", "Add quote", "Add cost", "Add SWMS", "Add certificate"]);
    /* Add's items come first */
    expect(within(menu).getAllByRole("menuitem")[0]).toHaveTextContent("Add visit");
  });

  it("reads Variation once the quote is accepted, and takes you to the quote to start it", async () => {
    quoteAnswer = { ok: true, facts: facts({ accepted: [0] }) };
    await open();
    const menu = await addMenu();
    expect(await within(menu).findByRole("menuitem", { name: "Add variation" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Add quote" })).toBeNull();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Add variation" }));
    expect(push).toHaveBeenCalledWith(`/dashboard/jobs/${JOB}/quote`);
  });

  it("reads where the quote stands once, from the Quote section's own route", async () => {
    await open();
    await addMenu();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/workboard/quote-status?job=${JOB}`));
    await userEvent.keyboard("{Escape}");
    await addMenu();
    expect(fetchMock.mock.calls.filter(([u]) => u.startsWith("/api/workboard/quote-status"))).toHaveLength(1);
  });

  it("starts a quote not begun yet with Tiff, as the Quote section's Create a quote does", async () => {
    quoteAnswer = { ok: true, facts: facts({ lines: 0, talked: false, approved: false, sent: null }) };
    await open();
    const menu = await addMenu();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/workboard/quote-status?job=${JOB}`));
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Add quote" }));
    expect(push).toHaveBeenCalledWith(`/dashboard/jobs/${JOB}/quote?start=1`);
  });

  it("opens the Quote section when where the quote stands couldn't be read", async () => {
    quoteAnswer = { ok: false };
    await open();
    await pick("Add quote");
    expect(push).not.toHaveBeenCalled();
    expect(jobTab("Quote")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Quote" })).toBeVisible();
  });

  describe("hides what the reader may not use", () => {
    it("has no Task without Workboard manage", async () => {
      await open({ manage: false });
      expect(items(await addMenu())).toEqual(["Add visit", "Add quote", "Add cost", "Add SWMS", "Add certificate"]);
    });

    it("has no Visit where Book in isn't offered", async () => {
      readJobRecord.mockResolvedValue(record(bookings({ canBook: false })));
      await open();
      expect(items(await addMenu())).toEqual(["Add task", "Add quote", "Add cost", "Add SWMS", "Add certificate"]);
    });

    it("has no SWMS once ServiceM8 has the job closed, as the Compliance section doesn't", async () => {
      readMirrorJob.mockResolvedValue({ detail: detail({ status: "Completed" }), focusRemoteId: null });
      await open();
      expect(items(await addMenu())).toEqual(["Add visit", "Add task", "Add quote", "Add cost", "Add certificate"]);
    });
  });

  describe("each item reaches its flow", () => {
    it("Visit opens the Visit form over the page, the job filled in (rules 51 and 54)", async () => {
      await open();
      await pick("Add visit");
      const form = await screen.findByRole("dialog", { name: "Book a visit" });
      expect(within(form).getByText(/^Job 3400\b/)).toBeInTheDocument();
      expect(within(form).getByRole("button", { name: "Clear the job" })).toBeInTheDocument();
    });

    it("Task opens Visits with Add a task's box ready", async () => {
      await open();
      await pick("Add task");
      expect(jobTab("Visits")).toHaveAttribute("aria-selected", "true");
      const box = await screen.findByRole("textbox", { name: "A new task" });
      await waitFor(() => expect(box).toHaveFocus());
    });

    it("Cost opens Add a cost over the job, the ServiceM8 job filled in to be named in its words", async () => {
      await open();
      await pick("Add cost");
      expect(await screen.findByRole("dialog", { name: "Add a cost" })).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
      expect(costForm).toHaveBeenLastCalledWith(
        expect.objectContaining({ job: { kind: "sm8", id: JOB, label: "Job 3400, Sample Client Pty Ltd, Rose Bay" } }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "Add a cost" })).toBeNull();
    });

    it("SWMS opens Documents, where Compliance is, and the SWMS wizard", async () => {
      await open();
      await pick("Add SWMS");
      expect(jobTab("Documents")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("region", { name: "Compliance" })).toBeVisible();
      expect(await screen.findByRole("dialog", { name: "New SWMS" })).toBeInTheDocument();
    });

    it("Certificate opens Documents, where Compliance is, and the certificate wizard", async () => {
      await open();
      await pick("Add certificate");
      expect(jobTab("Documents")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("region", { name: "Compliance" })).toBeVisible();
      expect(await screen.findByRole("dialog", { name: "New certificate" })).toBeInTheDocument();
    });
  });
});

/* Documents' Make a document lands on the job's page asking for one (v2) */
describe("a page that arrives asking for a SWMS or a certificate", () => {

  it("opens the SWMS wizard once the job's papers are read, as Add › SWMS does", async () => {
    render(<Job row={row()} {...props} section="documents" add="swms" />);
    expect(await screen.findByRole("dialog", { name: "New SWMS" })).toBeInTheDocument();
  });

  it("opens the certificate wizard, as Add › Certificate does", async () => {
    render(<Job row={row()} {...props} section="documents" add="certificate" />);
    expect(await screen.findByRole("dialog", { name: "New certificate" })).toBeInTheDocument();
  });

  it("opens no SWMS once ServiceM8 has the job closed, as Add offers none", async () => {
    readMirrorJob.mockResolvedValue({ detail: detail({ status: "Completed" }), focusRemoteId: null });
    const { listSwmsForJob } = jest.requireMock("@/app/actions/swms") as { listSwmsForJob: jest.Mock };
    render(<Job row={row()} {...props} section="documents" add="swms" />);
    await waitFor(() => expect(readMirrorJob).toHaveBeenCalled());
    await waitFor(() => expect(listSwmsForJob).toHaveBeenCalledWith(JOB));
    /* both reads answered, and the page rendered again with them */
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole("dialog", { name: "New SWMS" })).toBeNull();
  });
});
