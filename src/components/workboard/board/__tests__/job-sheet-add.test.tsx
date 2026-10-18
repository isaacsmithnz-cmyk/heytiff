/* THE JOB CARD'S ADD (docs/design.md, rule 54): Visit, Task, Quote
   (Variation once accepted), Cost, SWMS, Certificate, in a white menu from
   the band. Each item is a door to the flow the card already has, behind
   that flow's own check, and an item the reader may not use is not there. */

import { render, screen, waitFor, within } from "@testing-library/react";
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

import { JobSheet } from "../job-sheet";

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
const props = { manage: true, moneyVisible: false, onClose: noop, onCreateAgreement: noop, onOpenTracked: noop, onToast: noop };

/** The card, open, with the job known: Add is pressable from here. */
const open = async (extra: Partial<Parameters<typeof JobSheet>[0]> = {}) => {
  render(<JobSheet row={row()} {...props} {...extra} />);
  await screen.findByText("Rose Bay NSW 2029");
  await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeEnabled());
};
const addMenu = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  return screen.findByRole("menu", { name: "Add to this job" });
};
const items = (menu: HTMLElement) => within(menu).getAllByRole("menuitem").map((i) => i.textContent);
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

describe("the job card's Add", () => {
  it("is a second button with the word, and opens Visit, Task, Quote, Cost, SWMS, Certificate in that order", async () => {
    await open();
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toHaveClass("pt-btn--second");
    expect(add).toHaveAttribute("aria-haspopup", "menu");
    const menu = await addMenu();
    expect(add).toHaveAttribute("aria-expanded", "true");
    expect(items(menu)).toEqual(["Visit", "Task", "Quote", "Cost", "SWMS", "Certificate"]);
  });

  it("reads Variation once the quote is accepted, and takes you to the quote to start it", async () => {
    quoteAnswer = { ok: true, facts: facts({ accepted: [0] }) };
    await open();
    const menu = await addMenu();
    expect(await within(menu).findByRole("menuitem", { name: "Variation" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Quote" })).toBeNull();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Variation" }));
    expect(push).toHaveBeenCalledWith(`/dashboard/workboard/quotes/${JOB}`);
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
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Quote" }));
    expect(push).toHaveBeenCalledWith(`/dashboard/workboard/quotes/${JOB}?start=1`);
  });

  it("opens the Quote section when where the quote stands couldn't be read", async () => {
    quoteAnswer = { ok: false };
    await open();
    await pick("Quote");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Quoted/ })).toHaveAttribute("aria-pressed", "true");
  });

  describe("hides what the reader may not use", () => {
    it("has no Task without Workboard manage", async () => {
      await open({ manage: false });
      expect(items(await addMenu())).toEqual(["Visit", "Quote", "Cost", "SWMS", "Certificate"]);
    });

    it("has no Visit where Book in isn't offered", async () => {
      readJobRecord.mockResolvedValue(record(bookings({ canBook: false })));
      await open();
      expect(items(await addMenu())).toEqual(["Task", "Quote", "Cost", "SWMS", "Certificate"]);
    });

    it("has no SWMS once ServiceM8 has the job closed, as the Compliance section doesn't", async () => {
      readMirrorJob.mockResolvedValue({ detail: detail({ status: "Completed" }), focusRemoteId: null });
      await open();
      expect(items(await addMenu())).toEqual(["Visit", "Task", "Quote", "Cost", "Certificate"]);
    });
  });

  describe("each item reaches its flow", () => {
    it("Visit opens Installation with Book in's panel", async () => {
      await open();
      await pick("Visit");
      expect(screen.getByRole("button", { name: /^Installation/ })).toHaveAttribute("aria-pressed", "true");
      const visits = within(document.querySelector("#jcsec-visits") as HTMLElement);
      expect(await visits.findByRole("group", { name: "Book in job 3400" })).toBeInTheDocument();
    });

    it("Task opens Installation with Add a task's box ready", async () => {
      await open();
      await pick("Task");
      expect(screen.getByRole("button", { name: /^Installation/ })).toHaveAttribute("aria-pressed", "true");
      const box = await screen.findByRole("textbox", { name: "A new task" });
      await waitFor(() => expect(box).toHaveFocus());
    });

    it("Cost opens the expense claim", async () => {
      await open();
      await pick("Cost");
      expect(push).toHaveBeenCalledWith("/dashboard/my-expenses");
    });

    it("SWMS opens Compliance and the SWMS wizard", async () => {
      await open();
      await pick("SWMS");
      expect(screen.getByRole("tab", { name: "Compliance" })).toHaveAttribute("aria-selected", "true");
      expect(await screen.findByRole("dialog", { name: "New SWMS" })).toBeInTheDocument();
    });

    it("Certificate opens Compliance and the certificate wizard", async () => {
      await open();
      await pick("Certificate");
      expect(screen.getByRole("tab", { name: "Compliance" })).toHaveAttribute("aria-selected", "true");
      expect(await screen.findByRole("dialog", { name: "New certificate" })).toBeInTheDocument();
    });
  });
});
