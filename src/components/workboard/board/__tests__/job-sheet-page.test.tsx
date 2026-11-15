/* THE JOB CARD AS A PAGE (v2, step 5): the job's own page draws the card's
   faces under the page's head (the job's name, one grey line, Open in
   ServiceM8, Add and Actions, the seven section tabs), with no scrim, no
   band, no rail and nothing to close. Each section is the card's own faces:
   Overview the summary and the diary under the stages line, Documents the
   files and compliance, Billing the money. */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobBookings, JobCardRead, JobRecordRead } from "@/app/actions/workboard";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { JobSection } from "@/lib/jobs/job-sections";

const readMirrorJob = jest.fn(async (): Promise<JobCardRead> => ({ detail: null, focusRemoteId: null }));
const readJobRecord = jest.fn(async (): Promise<JobRecordRead | null> => null);
const readJobFiles = jest.fn(async (): Promise<JobMediaGroupsRead | null> => null);
/* The job's page mode draws its conversation, whose Add photo reaches the
   documents actions ("use server", which jsdom can't load). */
jest.mock("@/app/actions/site-notes", () => ({ addSiteNote: jest.fn(), changeSiteNote: jest.fn(), removeSiteNote: jest.fn() }));
jest.mock("@/components/jobs/site-notes-read", () => ({ fetchSiteNoteCount: jest.fn(async () => 0), fetchSiteNotes: jest.fn(async () => null) }));
jest.mock("@/app/actions/documents", () => ({ deleteDocument: jest.fn(async () => ({ ok: true })) }));
jest.mock("@/app/actions/job-plans", () => ({ readPlansOnJob: jest.fn(async () => []), addPlansToJob: jest.fn(async () => ({ ok: true, planIds: [], already: 0 })) }));
jest.mock("@/lib/documents/file-on-job", () => ({ fileOnJob: jest.fn(async () => ({ ok: false, error: "no upload in this test" })) }));
/* the Activity feed's Add to my notes */
jest.mock("@/app/actions/my-notes", () => ({ addMyNote: jest.fn(async () => ({ ok: true, id: "my-1" })), deleteMyNote: jest.fn(async () => ({ ok: true })) }));
jest.mock("@/app/actions/workboard", () => ({
  readMirrorJob: (...a: unknown[]) => readMirrorJob(...(a as [])),
  readJobRecord: (...a: unknown[]) => readJobRecord(...(a as [])),
  readJobFiles: (...a: unknown[]) => readJobFiles(...(a as [])),
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
/* Materials' Bought: nothing bought on these jobs */
jest.mock("@/app/actions/purchases", () => ({ jobBought: async () => ({ lines: [], allowanceCents: null, money: false }) }));
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
jest.mock("@/components/swms/swms-wizard", () => ({
  SwmsWizard: () => <div role="dialog" aria-label="New SWMS" />,
}));
jest.mock("@/components/certs/cert-wizard", () => ({
  CertWizard: () => <div role="dialog" aria-label="New certificate" />,
}));

import { JobSheet, type JobSheetPage } from "../job-sheet";

const JOB = "0b1e0b1e-0000-4000-8000-00000000d054";

const row = (): AllJobRow => ({
  key: `sm8:${JOB}`,
  kind: "sm8",
  id: JOB,
  number: "3209",
  numberSystem: "sm8",
  clientName: "Richards Building",
  title: "Mitsubishi Electric VRF",
  suburb: "North Narrabeen",
  categoryName: "Install",
  categoryColour: "#2E68FF",
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
  jobNumber: "3209",
  status: "Work Order",
  clientName: "Richards Building",
  description: "Mitsubishi Electric VRF",
  workDone: null,
  address: "59 Woorarra Avenue\nNorth Narrabeen",
  suburb: "North Narrabeen",
  geoLine: null,
  categoryName: "Install",
  categoryColour: "#2E68FF",
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

const bookings = (): JobBookings => ({
  offered: true,
  canBook: true,
  canClear: true,
  trial: false,
  hold: null,
  zone: "Australia/Sydney",
  verbs: [],
  lines: {},
});

const record = (): JobRecordRead => ({
  notes: [],
  ourNotes: [],
  attention: { items: [], total: 0 },
  assignable: [],
  ledger: null,
  family: null,
  summary: null,
  bookings: bookings(),
});

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

const fetchMock = jest.fn(async (url: string) => ({
  json: async () => (url.startsWith("/api/workboard/quote-status") ? { ok: false } : { ok: false }),
}));

const noop = () => {};
const onSection = jest.fn();
const onAction = jest.fn();
const onCreateAgreement = jest.fn();

const pageOf = (section: JobSection): JobSheetPage => ({
  section,
  onSection,
  actions: [
    { key: "pin", label: "Pin the job" },
    { key: "link", label: "Copy the link" },
  ],
  onAction,
});

const draw = (section: JobSection, extra: { moneyVisible?: boolean; manage?: boolean; studio?: boolean } = {}) =>
  render(
    <JobSheet
      row={row()}
      manage={extra.manage ?? true}
      moneyVisible={extra.moneyVisible ?? false}
      studio={extra.studio ?? false}
      initialTab="summary"
      page={pageOf(section)}
      onCreateAgreement={onCreateAgreement}
      onOpenTracked={noop}
      onToast={noop}
    />,
  );

/** The page, with the job known. */
const ready = async () => {
  await waitFor(() => expect(readMirrorJob).toHaveBeenCalled());
  await act(async () => {});
  await waitFor(() => expect(readJobRecord).toHaveBeenCalled());
};

/** The head's one menu, open. */
const actionsMenu = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Actions" }));
  return screen.findByRole("menu", { name: "Actions on this job" });
};

/** One of the job's section tabs (a face may hold tabs of its own). */
const jobTab = (name: string | RegExp) => within(screen.getByRole("tablist", { name: "The job" })).getByRole("tab", { name });

const tabWords = () =>
  within(screen.getByRole("tablist", { name: "The job" }))
    .getAllByRole("tab")
    .map((t) => t.querySelector(".pt-stab-word")!.textContent);

beforeEach(() => {
  readMirrorJob.mockReset().mockResolvedValue({ detail: detail(), focusRemoteId: null });
  readJobRecord.mockReset().mockResolvedValue(record());
  readJobFiles.mockReset().mockResolvedValue(null);
  push.mockReset();
  onSection.mockReset();
  onAction.mockReset();
  onCreateAgreement.mockReset();
  fetchMock.mockClear();
  (global as { fetch?: unknown }).fetch = fetchMock;
});

describe("the job's page head", () => {
  /* Isaac's mock of 25 October 2026: the grey line under the name goes */
  it("names the job by its plate: the number in its colour's box, the client beside it, and the way back above (Isaac, 5 and 6 November 2026)", async () => {
    const { container } = draw("on-site");
    await ready();
    const h1 = screen.getByRole("heading", { level: 1 });
    /* the client, as Schedule and Jobs name a job; the address is Site's */
    expect(h1).toHaveTextContent(/^Richards Building$/);
    const plate = container.querySelector(".jp-plate")!;
    expect(plate).toHaveClass("jp-plate--blue");
    expect(plate.querySelector(".jp-num")).toHaveTextContent(/^3209$/);
    expect(container.querySelector(".jp-head")).not.toHaveTextContent(/Woorarra/);
    /* no grey line of stage or kind, and no breadcrumb: one word back */
    expect(container.querySelector(".jp-line, .jp-facts, .jp-stage")).toBeNull();
    expect(container.querySelector(".jp-head")).not.toHaveTextContent(/Work order|Job 3209|Accepted/);
    expect(container.querySelector(".wb2-crumbline, .int-back")).toBeNull();
    /* opened with nowhere to go back to, the way back is Jobs */
    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/dashboard/jobs");
  });

  it("is a page, not a card: no dialog, no scrim, no band, no rail, nothing to close", async () => {
    const { container } = draw("overview");
    await ready();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".wb2-scrim")).toBeNull();
    expect(container.querySelector(".wb2-jcband, .jcl-rail")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    /* the card's band said "ServiceM8, synced"; Open in ServiceM8 is the head's menu's last word */
    const open = jest.spyOn(window, "open").mockImplementation(() => null);
    await userEvent.click(within(await actionsMenu()).getByRole("menuitem", { name: "Open in ServiceM8" }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining(`OpenJob/${JOB}`), "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  /* one menu up top (Isaac, 22 October 2026): what Add made, then what's
     done to the job, then Open in ServiceM8 */
  it("has one second button, Actions, with its chevron, opening Add's items first", async () => {
    draw("overview");
    await ready();
    const actions = screen.getByRole("button", { name: "Actions" });
    expect(actions).toHaveClass("pt-btn--second");
    expect(actions.querySelector(".jp-chev")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open in ServiceM8" })).toBeNull();
    const menu = await actionsMenu();
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Add visit",
      "Add to do",
      "Add task",
      "Add quote",
      "Add cost",
      "Add purchase",
      "Add SWMS",
      "Add certificate",
      "Pin the job",
      "Copy the link",
      "Create a project from this job",
      "Create a maintenance agreement",
      "Open in ServiceM8",
    ]);
    /* Add visit is the Visit form, over the section you're on (rule 51) */
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Add visit" }));
    const form = await screen.findByRole("dialog", { name: "Book a visit" });
    expect(within(form).getByText(/^Job 3209\b/)).toHaveClass("jv-dline");
    expect(onSection).not.toHaveBeenCalledWith("on-site");
  });

  it("puts what's done to the job under Actions: pin, copy the link, then the card's once-per-job acts", async () => {
    draw("overview");
    await ready();
    const menu = await actionsMenu();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Pin the job" }));
    expect(onAction).toHaveBeenCalledWith("pin");
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Create a maintenance agreement" }));
    expect(onCreateAgreement).toHaveBeenCalled();
  });

  it("asks before making a quote a work order, from Actions", async () => {
    readMirrorJob.mockResolvedValue({ detail: detail({ status: "Quote", workOrderDate: null }), focusRemoteId: null });
    draw("overview", { manage: false });
    await ready();
    const menu = await actionsMenu();
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "Make it a work order" })).toBeInTheDocument());
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Make it a work order" }));
    const ask = screen.getByRole("group", { name: "Make it a work order" });
    expect(ask).toHaveTextContent("Make it a Work Order in ServiceM8?");
    expect(within(ask).getByRole("button", { name: "Keep it a quote" })).toBeInTheDocument();
  });
});

describe("the job's sections are the card's faces", () => {
  it("has six tabs with the money, Overview, Scope, Price, On site, Files, Billing, and no Billing without it", async () => {
    const { unmount } = draw("overview", { moneyVisible: true });
    await ready();
    expect(tabWords()).toEqual(["Overview", "Scope", "Price", "On site", "Files", "Billing"]);
    unmount();
    draw("overview");
    await ready();
    expect(tabWords()).toEqual(["Overview", "Scope", "Price", "On site", "Files"]);
  });

  /* Isaac, 13 November 2026: "Give scope its own tab"; mock A, 14 November */
  it("shows a job with no Scope its Summary on the Scope tab, and none on the Overview", async () => {
    const { unmount } = draw("scope");
    await ready();
    expect(jobTab("Scope")).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("region", { name: "Summary" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Where the job is up to" })).toBeNull();
    unmount();
    draw("overview");
    await ready();
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Scope" })).toBeNull();
  });

  /* the job's designs are a group of Files, for whoever holds the Studio (15 November 2026) */
  it("has the job's Designs in Files for whoever holds the Studio, and no Design tab", async () => {
    draw("files", { studio: true });
    await ready();
    expect(tabWords()).toEqual(["Overview", "Scope", "Price", "On site", "Files"]);
    expect(screen.getByRole("region", { name: "Design" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Designs" })).toBeInTheDocument();
    expect(await screen.findByText("No design on this job")).toBeInTheDocument();
  });

  it("has no Designs in Files without the Studio", async () => {
    draw("files");
    await ready();
    expect(screen.queryByRole("region", { name: "Design" })).toBeNull();
    expect(screen.getByRole("region", { name: "Photos" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Documents" })).toBeVisible();
  });

  /* the refined Overview A (Isaac, 25 October 2026): the stages line, the
     strip of facts, then To do beside the Activity feed; the Summary went to
     the Scope tab (13 November 2026) */
  /* mocks C and D (14 November 2026): the stages line beside the name, the
     facts card and To do on the left, the Activity feed on the right */
  it("shows Overview as the facts card beside the Activity feed, To do one of its tabs, the stages line in the head", async () => {
    const { container } = draw("overview", { moneyVisible: true });
    await ready();
    expect(jobTab("Overview")).toHaveAttribute("aria-selected", "true");
    const head = container.querySelector(".jp-head") as HTMLElement;
    expect(within(head).getByRole("navigation", { name: "Where the job is up to" })).toBeVisible();
    const over = container.querySelector(".jov") as HTMLElement;
    const facts = within(screen.getByRole("group", { name: "The job's facts" }));
    expect(facts.getAllByRole("region").map((r) => r.querySelector(".jov-lab")?.firstChild?.textContent)).toEqual(["Next visit", "Site", "Contact"]);
    expect([...over.querySelectorAll(".jov-left .jov-title")].map((h) => h.textContent)).toEqual([]);
    expect([...over.querySelectorAll(".jov-side .jov-title")].map((h) => h.textContent)).toEqual(["Activity feed"]);
    expect(screen.getByRole("region", { name: "Activity feed" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Write a note on this job" })).toBeVisible();
    /* Money and the Job tracker are Billing's now */
    expect(screen.queryByRole("region", { name: "Money" })).toBeNull();
    /* Next visit opens Visits from anywhere on it */
    await userEvent.click(facts.getByRole("button", { name: "Next visit" }));
    expect(onSection).toHaveBeenCalledWith("on-site");
    /* To do is a tab of the feed, with a box of its own (mock D) */
    await userEvent.click(within(screen.getByRole("group", { name: "Show in the feed" })).getByRole("button", { name: /^To do/ }));
    expect(screen.getByRole("textbox", { name: "Add a to do" })).toBeVisible();
  });

  it("draws none of the card's own faces on Overview", async () => {
    draw("overview");
    await ready();
    /* the card's own Summary and Timeline faces are the card's, not the page's */
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Timeline" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Photos" })).toBeNull();
  });

  it("keeps the stages line on Overview only", async () => {
    draw("files");
    await ready();
    expect(screen.queryByRole("navigation", { name: "Where the job is up to" })).toBeNull();
    expect(screen.getByRole("region", { name: "Photos" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
  });

  it("shows Documents as one section, the files and compliance together", async () => {
    draw("files");
    await ready();
    expect(screen.getByRole("region", { name: "Documents" })).toBeVisible();
    expect(document.querySelector("#jcsec-compliance")).toBeNull();
  });

  it("shows Billing as the money face", async () => {
    draw("billing", { moneyVisible: true });
    await ready();
    expect(screen.getByRole("region", { name: "Billing" })).toBeVisible();
  });

  /* walked 24 October 2026: Billing's figures took ten seconds, queued
     behind every hidden section's reads */
  it("(F) draws a section only once it is opened, and keeps it after", async () => {
    const { rerender } = draw("billing", { moneyVisible: true });
    await ready();
    const face = (key: string) => document.getElementById(`jcsec-${key}`)!;
    expect(face("money")).not.toBeEmptyDOMElement();
    for (const key of ["visits", "checklist", "photos", "documents"]) expect(face(key)).toBeEmptyDOMElement();
    expect(document.querySelector(".jp-over")).toBeEmptyDOMElement();
    expect(document.querySelector(".jp-price")).toBeEmptyDOMElement();
    const at = (section: JobSection) => (
      <JobSheet
        row={row()}
        manage
        moneyVisible
        initialTab="summary"
        page={pageOf(section)}
        onCreateAgreement={onCreateAgreement}
        onOpenTracked={noop}
        onToast={noop}
      />
    );
    rerender(at("on-site"));
    expect(face("checklist")).not.toBeEmptyDOMElement();
    rerender(at("billing"));
    expect(face("checklist")).not.toBeEmptyDOMElement();
    expect(face("photos")).toBeEmptyDOMElement();
  });

  it("hands a tab press to the page", async () => {
    draw("overview");
    await ready();
    await userEvent.click(jobTab(/^On site/));
    expect(onSection).toHaveBeenCalledWith("on-site");
  });

  it("puts no numbers on the sections (Isaac, 20 October)", async () => {
    readJobFiles.mockResolvedValue({ photos: [photo(1), photo(2)], documents: [], elsewhere: [], truncated: false });
    draw("overview");
    await ready();
    await waitFor(() => expect(readJobFiles).toHaveBeenCalled());
    expect(jobTab(/^Files/)).toHaveTextContent(/^Files$/);
    expect(jobTab(/^On site/)).toHaveTextContent(/^On site$/);
  });
});
