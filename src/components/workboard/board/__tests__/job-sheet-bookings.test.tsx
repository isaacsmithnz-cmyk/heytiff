/* THE JOB CARD'S BOOKINGS, ON ITS VISITS FACE (two-way phase 3, PR D):
   D-1, D-5, D-7, D-11, D-14 and D-15, and the two doors that open it.

   The card draws what the server says and nothing of its own: Book in only
   where the record offers it, each booking once — a standing booking of
   ours carries its line and Undo on its own entry, anything else is drawn
   above the list — a leftover's Clear asked in place, and a poll while
   anything is on its way. Where the deployment books nothing the record
   has no `bookings` and the detail no `booked`, and the face is main's. */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BookedEntry, MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobCardRead, JobBookings, JobRecordRead } from "@/app/actions/workboard";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import type { BookingLineResult, BookingStates, VerbView } from "@/app/actions/booking-sm8";
import { BOOKING_WORDS, type BookingState } from "@/lib/integrations/sm8-booking-plan";
import { STALE_DEPLOY_WORDS } from "@/lib/stale-deploy";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";

const readMirrorJob = jest.fn(async (): Promise<JobCardRead> => ({ detail: null, focusRemoteId: null }));
const readJobRecord = jest.fn(async (): Promise<JobRecordRead | null> => null);
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
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
const openRecordByName = jest.fn(async (_words: string) => null as { href: string; label: string; line: string } | null);
jest.mock("@/app/actions/tiff-open", () => ({ openRecordByName: (w: string) => openRecordByName(w) }));
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

const bk = {
  readBookInContext: jest.fn(async (_i: { jobUuid: string; days: string[] }) => ({ ok: false as const, error: "Not in a test." })),
  bookJobIn: jest.fn(async () => ({ ok: false as const, error: "Not in a test." })),
  takeBackBooking: jest.fn(async (_i: { jobUuid: string; rowId: string }): Promise<BookingLineResult> => ({ ok: true, line: null })),
  retryBooking: jest.fn(async (_i: { jobUuid: string; rowId: string }): Promise<BookingLineResult> => ({ ok: true, line: null })),
  clearLeftoverBooking: jest.fn(
    async (_i: { jobUuid: string; activityUuid: string; seen: { staffUuid: string; start: string }; pressId: string }): Promise<BookingLineResult> => ({
      ok: true,
      line: null,
    })
  ),
  readBookingStates: jest.fn(async (_i: { jobUuid: string }): Promise<BookingStates | null> => null),
};
jest.mock("@/app/actions/booking-sm8", () => ({
  readBookInContext: (...a: unknown[]) => bk.readBookInContext(...(a as [never])),
  bookJobIn: (...a: unknown[]) => bk.bookJobIn(...(a as [])),
  takeBackBooking: (...a: unknown[]) => bk.takeBackBooking(...(a as [never])),
  retryBooking: (...a: unknown[]) => bk.retryBooking(...(a as [never])),
  clearLeftoverBooking: (...a: unknown[]) => bk.clearLeftoverBooking(...(a as [never])),
  readBookingStates: (...a: unknown[]) => bk.readBookingStates(...(a as [never])),
}));

import { JobSheet } from "../job-sheet";

const JOB = "0b1e0b1e-0000-4000-8000-00000000d001";
const SAM = "5a0e5a0e-0000-4000-8000-00000000a001";
const ALEX = "5a0e5a0e-0000-4000-8000-00000000a002";
const MINE = "7e7e7e7e-0000-4000-8000-000000000002";
const THEIRS = "7e7e7e7e-0000-4000-8000-000000000001";
const NOT_YET = "7e7e7e7e-0000-4000-8000-000000000009";
const LEFT = "7e7e7e7e-0000-4000-8000-000000000003";

const row = (): AllJobRow => ({
  key: `sm8:${JOB}`,
  kind: "sm8",
  id: JOB,
  number: "3342",
  numberSystem: "sm8",
  clientName: "Sample Client Pty Ltd",
  title: "Service the units",
  suburb: "Rose Bay",
  categoryName: "Service",
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

const entry = (over: Partial<BookedEntry> = {}): BookedEntry => ({
  uuid: THEIRS,
  staffUuid: SAM,
  staffName: "Sam Tester",
  staffTitle: null,
  start: "2026-10-07 08:00:00",
  end: "2026-10-07 10:00:00",
  ourRow: null,
  leftover: false,
  ...over,
});

const detail = (over: Partial<MirrorJobDetail> = {}): MirrorJobDetail => ({
  remoteId: JOB,
  jobNumber: "3342",
  status: "Work Order",
  clientName: "Sample Client Pty Ltd",
  description: "Service the units",
  workDone: null,
  address: null,
  suburb: "Rose Bay",
  geoLine: "Rose Bay NSW 2029",
  categoryName: "Service",
  categoryColour: "#e7b5ff",
  purchaseOrder: null,
  date: "2026-10-01 09:00:00",
  quoteDate: null,
  workOrderDate: "2026-10-02 09:00:00",
  completionDate: null,
  nextBooking: { start: "2026-10-07 08:00:00", end: "2026-10-07 10:00:00", staffName: "Sam Tester", staffTitle: null },
  timeOnSite: null,
  dateOn: "2026-10-07",
  dateLabel: "booked",
  visits: [],
  queue: null,
  checklist: [],
  contacts: [],
  money: null,
  designs: [],
  timezone: null,
  ...over,
});

const sentLine: BookingState = { key: "line.sent", text: BOOKING_WORDS.line.sent, tone: "ok", acts: ["undo", "open_in_sm8"] };

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

const record = (b?: JobBookings | null): JobRecordRead => ({
  notes: [],
  ourNotes: [],
  attention: { items: [], total: 0 },
  assignable: [],
  ledger: null,
  family: null,
  summary: null,
  ...(b === undefined ? {} : { bookings: b }),
});

/** Ours, standing: Alex at 1 pm, Booked in ServiceM8, with its press. */
const ourVerb = (state: BookingState = sentLine): VerbView => ({
  verbId: "press-1",
  presses: ["press-1"],
  at: "2026-10-05T21:00:00.000Z",
  status: { rowId: "s-1", state: { key: "line.statusSent", text: BOOKING_WORDS.line.statusSent, tone: "ok", acts: [] } },
  bookings: [
    {
      rowId: "c-2",
      op: "create",
      uuid: MINE,
      staffUuid: ALEX,
      name: "Alex Sample",
      start: "2026-10-07 13:00:00",
      end: "2026-10-07 15:00:00",
      state,
      standing: true,
    },
  ],
});

const noop = () => {};
const props = { manage: true, moneyVisible: false, onClose: noop, onCreateAgreement: noop, onOpenTracked: noop, onToast: jest.fn() };
const visits = () => within(document.querySelector("#jcsec-visits") as HTMLElement);
const open = async (extra: Partial<Parameters<typeof JobSheet>[0]> = {}) => {
  render(<JobSheet row={row()} {...props} {...extra} />);
  await screen.findByText("Rose Bay NSW 2029");
  if (!extra.openBookIn && !extra.openClear) await userEvent.click(screen.getByRole("button", { name: /^Installation/ }));
};

beforeEach(() => {
  readMirrorJob.mockReset().mockResolvedValue({ detail: detail(), focusRemoteId: null });
  readJobRecord.mockReset().mockResolvedValue(record());
  for (const f of Object.values(bk)) f.mockClear();
  bk.readBookingStates.mockReset().mockResolvedValue(null);
  bk.readBookInContext.mockReset().mockResolvedValue({ ok: false, error: "Not in a test." });
  bk.bookJobIn.mockReset().mockResolvedValue({ ok: false, error: "Not in a test." });
  bk.takeBackBooking.mockReset().mockResolvedValue({ ok: true, line: null });
  bk.retryBooking.mockReset().mockResolvedValue({ ok: true, line: null });
  bk.clearLeftoverBooking.mockReset().mockResolvedValue({ ok: true, line: null });
  (global as { fetch?: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ok: false }) }));
});
afterEach(() => jest.useRealTimers());

describe("where the deployment books nothing (D-14)", () => {
  it("(F) the Visits face is main's: the next booking as it always was, no Book in, no line, no poll", async () => {
    await open();
    const face = visits();
    expect(face.getByText("Next on site")).toBeInTheDocument();
    expect(face.getByText("8am–10am Wed 7 Oct")).toBeInTheDocument();
    expect(face.queryByRole("button", { name: BOOKING_WORDS.panel.book })).toBeNull();
    expect(face.queryByText(BOOKING_WORDS.line.sent)).toBeNull();
    expect(document.querySelectorAll("#jcsec-visits .wb2-mline")).toHaveLength(0);
    expect(document.querySelectorAll("#jcsec-visits .wb2-jcattsave")).toHaveLength(0);
    expect(bk.readBookingStates).not.toHaveBeenCalled();
    expect(bk.readBookInContext).not.toHaveBeenCalled();
  });
});

describe("Book in on the card (D-1)", () => {
  it("(F) sits above Next on site where the record offers it, and opens the panel in place", async () => {
    readMirrorJob.mockResolvedValue({ detail: detail({ booked: [entry()] }), focusRemoteId: null });
    readJobRecord.mockResolvedValue(record(bookings()));
    await open();
    const book = await visits().findByRole("button", { name: BOOKING_WORDS.panel.book });
    expect(book.compareDocumentPosition(visits().getByText("Next on site")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(book);
    expect(await visits().findByRole("group", { name: "Book in job 3342" })).toBeInTheDocument();
    expect(bk.readBookInContext).toHaveBeenCalledWith(expect.objectContaining({ jobUuid: JOB }));
  });

  it("names nobody on a booking with no person in the words' own fill", async () => {
    readMirrorJob.mockResolvedValue({ detail: detail({ booked: [entry({ staffUuid: null, staffName: null })] }), focusRemoteId: null });
    readJobRecord.mockResolvedValue(record(bookings()));
    await open();
    expect(await visits().findByText(BOOKING_WORDS.fill.person)).toBeInTheDocument();
  });

  it("(F) is absent where the record doesn't offer it", async () => {
    readMirrorJob.mockResolvedValue({ detail: detail({ booked: [entry()] }), focusRemoteId: null });
    readJobRecord.mockResolvedValue(record(bookings({ canBook: false })));
    await open();
    await visits().findByText("Next on site");
    expect(visits().queryByRole("button", { name: BOOKING_WORDS.panel.book })).toBeNull();
  });

  it("opens straight on Visits with the panel open for a door that came to book", async () => {
    readMirrorJob.mockResolvedValue({ detail: detail({ booked: [] }), focusRemoteId: null });
    readJobRecord.mockResolvedValue(record(bookings()));
    await open({ openBookIn: true });
    expect(screen.getByRole("button", { name: /^Installation/ })).toHaveAttribute("aria-pressed", "true");
    expect(await visits().findByRole("group", { name: "Book in job 3342" })).toBeInTheDocument();
  });
});

describe("each booking drawn once (D-15)", () => {
  it("(F) a standing booking of ours carries its line and Undo on its entry, never also above the list", async () => {
    readMirrorJob.mockResolvedValue({
      detail: detail({ booked: [entry(), entry({ uuid: MINE, staffUuid: ALEX, staffName: "Alex Sample", start: "2026-10-07 13:00:00", end: "2026-10-07 15:00:00", ourRow: "c-2" })] }),
      focusRemoteId: null,
    });
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [ourVerb()], lines: { [MINE]: sentLine } })));
    await open();
    const face = visits();
    expect(await face.findAllByText(BOOKING_WORDS.line.sent)).toHaveLength(1);
    expect(face.getAllByRole("button", { name: BOOKING_WORDS.door.undo })).toHaveLength(1);
    expect(face.getAllByText("Wed 7 Oct, 1:00 to 3:00 pm")).toHaveLength(1);
    /* the status change is said once, above */
    expect(face.getAllByText(BOOKING_WORDS.line.statusSent)).toHaveLength(1);
  });

  it("(F) ...and so while it is taken out: Taking it out of ServiceM8 sits on its entry", async () => {
    const taking: BookingState = { key: "line.takingOut", text: BOOKING_WORDS.line.takingOut, tone: null, acts: [] };
    readMirrorJob.mockResolvedValue({
      detail: detail({ booked: [entry({ uuid: MINE, staffUuid: ALEX, staffName: "Alex Sample", start: "2026-10-07 13:00:00", end: "2026-10-07 15:00:00", ourRow: "c-2" })] }),
      focusRemoteId: null,
    });
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [ourVerb(taking)], lines: { [MINE]: taking } })));
    await open();
    const face = visits();
    expect(await face.findAllByText(BOOKING_WORDS.line.takingOut)).toHaveLength(1);
    /* on the Next on site entry itself */
    expect(face.getByText(BOOKING_WORDS.line.takingOut).closest(".wb2-nextv")).not.toBeNull();
  });

  it("(F) a booking pressed after the card loaded — a line of its own, but not on the list yet — is drawn once, above the list", async () => {
    readMirrorJob.mockResolvedValue({ detail: detail({ booked: [entry()] }), focusRemoteId: null });
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [ourVerb()], lines: { [MINE]: sentLine } })));
    await open();
    const face = visits();
    expect(await face.findAllByText(BOOKING_WORDS.line.sent)).toHaveLength(1);
    expect(face.getAllByRole("button", { name: BOOKING_WORDS.door.undo })).toHaveLength(1);
    expect(face.getByText(BOOKING_WORDS.line.sent).compareDocumentPosition(face.getByText("Next on site")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("(F) a booking the list doesn't hold is drawn once, above the list, with its line", async () => {
    const moved: BookingState = { key: "line.keptOther", text: BOOKING_WORDS.line.keptOther, tone: "bad", acts: ["undo", "open_in_sm8"] };
    const v = ourVerb(moved);
    v.bookings[0] = { ...v.bookings[0], uuid: NOT_YET, standing: false };
    readMirrorJob.mockResolvedValue({ detail: detail({ booked: [entry()] }), focusRemoteId: null });
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [v], lines: {} })));
    await open();
    const face = visits();
    expect(await face.findAllByText(BOOKING_WORDS.line.keptOther)).toHaveLength(1);
    const line = face.getByText(BOOKING_WORDS.line.keptOther);
    expect(line).toHaveClass("sw-state", "bad");
    expect(line.compareDocumentPosition(face.getByText("Next on site")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(face.getByRole("link", { name: BOOKING_WORDS.door.openInSm8 })).toHaveAttribute("href", `https://go.servicem8.com/OpenJob/${JOB}`);
  });
});

describe("a line's doors (D-5)", () => {
  it("(F) Undo takes the booking back by its row, and the card reads its lines again", async () => {
    readMirrorJob.mockResolvedValue({
      detail: detail({ booked: [entry({ uuid: MINE, staffUuid: ALEX, staffName: "Alex Sample", ourRow: "c-2" })] }),
      focusRemoteId: null,
    });
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [ourVerb()], lines: { [MINE]: sentLine } })));
    await open();
    await userEvent.click(await visits().findByRole("button", { name: BOOKING_WORDS.door.undo }));
    expect(bk.takeBackBooking).toHaveBeenCalledWith({ jobUuid: JOB, rowId: "c-2" });
    await waitFor(() => expect(bk.readBookingStates).toHaveBeenCalledWith({ jobUuid: JOB }));
  });

  it("(F) Try again goes again by its row; Look again opens the panel on the booking", async () => {
    const failed: BookingState = { key: "line.notSent", text: "Not booked. ServiceM8 refused the booking.", tone: "bad", acts: ["try_again", "cancel"] };
    const look: BookingState = { key: "line.notSent", text: "Not booked. Changed in ServiceM8. Look again.", tone: null, acts: ["look_again"] };
    const v = ourVerb(failed);
    v.bookings[0] = { ...v.bookings[0], uuid: NOT_YET, standing: false };
    v.bookings.push({ ...v.bookings[0], rowId: "c-3", uuid: LEFT, start: "2026-10-08 11:00:00", end: "2026-10-08 14:00:00", state: look });
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [v] })));
    await open();
    await userEvent.click(await visits().findByRole("button", { name: BOOKING_WORDS.door.tryAgain }));
    expect(bk.retryBooking).toHaveBeenCalledWith({ jobUuid: JOB, rowId: "c-2" });
    await userEvent.click(visits().getByRole("button", { name: BOOKING_WORDS.door.cancel }));
    expect(bk.takeBackBooking).toHaveBeenCalledWith({ jobUuid: JOB, rowId: "c-2" });
    await userEvent.click(visits().getByRole("button", { name: BOOKING_WORDS.door.lookAgain }));
    await visits().findByRole("group", { name: "Book in job 3342" });
    expect(bk.readBookInContext).toHaveBeenCalledWith({ jobUuid: JOB, days: ["2026-10-08"] });
  });

  /* The walk of 2026-09-28: a tab open across a deploy pressed Cancel, the
     server had no such action any more, and the card said "couldn't queue
     it. Try again", which no try could make true. */
  it("(F) a Cancel from a tab older than the deploy says to reload, never to try again", async () => {
    const failed: BookingState = { key: "line.notSent", text: "Not booked. ServiceM8 refused the booking.", tone: "bad", acts: ["try_again", "cancel"] };
    const v = ourVerb(failed);
    v.bookings[0] = { ...v.bookings[0], uuid: NOT_YET, standing: false };
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [v] })));
    bk.takeBackBooking.mockRejectedValue(
      new UnrecognizedActionError('Server Action "7f00" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action')
    );
    const onToast = jest.fn();
    await open({ onToast });
    await userEvent.click(await visits().findByRole("button", { name: BOOKING_WORDS.door.cancel }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(STALE_DEPLOY_WORDS));
    expect(onToast).not.toHaveBeenCalledWith(BOOKING_WORDS.press.unqueued);
  });

  it("a Cancel that fails any other way still says it couldn't queue it", async () => {
    const failed: BookingState = { key: "line.notSent", text: "Not booked. ServiceM8 refused the booking.", tone: "bad", acts: ["try_again", "cancel"] };
    const v = ourVerb(failed);
    v.bookings[0] = { ...v.bookings[0], uuid: NOT_YET, standing: false };
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [v] })));
    bk.takeBackBooking.mockRejectedValue(new Error("fetch failed"));
    const onToast = jest.fn();
    await open({ onToast });
    await userEvent.click(await visits().findByRole("button", { name: BOOKING_WORDS.door.cancel }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(BOOKING_WORDS.press.unqueued));
    expect(onToast).not.toHaveBeenCalledWith(STALE_DEPLOY_WORDS);
  });

  it("a refused press says why, and a Try again answered Look again opens the panel", async () => {
    const failed: BookingState = { key: "line.notSent", text: "Not booked. ServiceM8 refused the booking.", tone: "bad", acts: ["try_again"] };
    const v = ourVerb(failed);
    v.bookings[0] = { ...v.bookings[0], uuid: NOT_YET, standing: false };
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [v] })));
    bk.retryBooking.mockResolvedValue({ ok: false, error: BOOKING_WORDS.press.tooSoon, lookAgain: true });
    await open();
    await userEvent.click(await visits().findByRole("button", { name: BOOKING_WORDS.door.tryAgain }));
    await waitFor(() => expect(props.onToast).toHaveBeenCalledWith(BOOKING_WORDS.press.tooSoon));
    expect(await visits().findByRole("group", { name: "Book in job 3342" })).toBeInTheDocument();
  });
});

describe("a leftover (D-7)", () => {
  const leftover = (status: string) => {
    readMirrorJob.mockResolvedValue({
      detail: detail({ status, booked: [entry(), entry({ uuid: LEFT, start: "2026-10-08 09:00:00", end: "2026-10-08 11:00:00", leftover: true })] }),
      focusRemoteId: null,
    });
  };

  it("(F) says it is finished but still booked, with Clear booking, asked in place with the focus on Keep", async () => {
    leftover("Completed");
    readJobRecord.mockResolvedValue(record(bookings({ canBook: false })));
    await open();
    const face = visits();
    expect(await face.findByText(BOOKING_WORDS.line.leftover)).toBeInTheDocument();
    await userEvent.click(face.getByRole("button", { name: BOOKING_WORDS.door.clearBooking }));
    const question = "Take Sam Tester's booking on Thu 8 Oct, 9:00 am off job 3342 in ServiceM8? The job is Completed. HeyTiff can't put it back.";
    expect(face.getByRole("group", { name: question })).toBeInTheDocument();
    expect(face.getByRole("button", { name: BOOKING_WORDS.door.keep })).toHaveFocus();
    await userEvent.click(face.getByRole("button", { name: BOOKING_WORDS.door.clearBooking }));
    expect(bk.clearLeftoverBooking).toHaveBeenCalledWith({
      jobUuid: JOB,
      activityUuid: LEFT,
      seen: { staffUuid: SAM, start: "2026-10-08 09:00:00" },
      pressId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("(F) on an Unsuccessful job too, in its words", async () => {
    leftover("Unsuccessful");
    readJobRecord.mockResolvedValue(record(bookings({ canBook: false })));
    await open();
    expect(await visits().findByText(BOOKING_WORDS.line.leftoverUnsuccessful)).toBeInTheDocument();
    expect(visits().getByRole("button", { name: BOOKING_WORDS.door.clearBooking })).toBeInTheDocument();
  });

  it("(F) offers no Clear to a viewer who may not press", async () => {
    leftover("Completed");
    readJobRecord.mockResolvedValue(record(bookings({ canBook: false, canClear: false })));
    await open();
    expect(await visits().findByText(BOOKING_WORDS.line.leftover)).toBeInTheDocument();
    expect(visits().queryByRole("button", { name: BOOKING_WORDS.door.clearBooking })).toBeNull();
  });

  /** A Clear of the leftover, above the list, with its line. */
  const clearVerb = (state: BookingState): VerbView => ({
    verbId: "press-clear",
    presses: ["press-clear"],
    at: "2026-10-05T21:30:00.000Z",
    status: null,
    bookings: [
      { rowId: "d-1", op: "clear", uuid: LEFT, staffUuid: SAM, name: "Sam Tester", start: "2026-10-08 09:00:00", end: "2026-10-08 11:00:00", state, standing: false },
    ],
  });
  const clearDoors = () => visits().queryAllByRole("button", { name: BOOKING_WORDS.door.clearBooking });

  it.each([
    ["a trial", { key: "line.clearTrial", text: BOOKING_WORDS.line.clearTrial, tone: null, acts: [] }, 1],
    ["one that asks for a fresh look", { key: "line.notCleared", text: "Not cleared. Changed in ServiceM8. Look again.", tone: null, acts: ["look_again"] }, 1],
    ["one on its way", { key: "line.clearing", text: BOOKING_WORDS.line.clearing, tone: null, acts: [] }, 0],
    ["one waiting", { key: "line.clearWaiting", text: "Not cleared yet. Sending is paused.", tone: null, acts: [] }, 0],
    ["one with its own Try again", { key: "line.notCleared", text: "Not cleared. ServiceM8 refused to remove the booking.", tone: "bad", acts: ["try_again"] }, 0],
  ] as const)("(F) after %s, the leftover's own Clear door is there %i time(s)", async (_what, state, doors) => {
    leftover("Completed");
    readJobRecord.mockResolvedValue(record(bookings({ canBook: false, verbs: [clearVerb({ ...state, acts: [...state.acts] })] })));
    await open();
    await visits().findByText(BOOKING_WORDS.line.leftover);
    expect(clearDoors()).toHaveLength(doors);
  });

  it("(F) Look again on a Clear reads the card again and asks again while it is still a leftover", async () => {
    leftover("Completed");
    const look: BookingState = { key: "line.notCleared", text: "Not cleared. Changed in ServiceM8. Look again.", tone: null, acts: ["look_again"] };
    readJobRecord.mockResolvedValue(record(bookings({ canBook: false, verbs: [clearVerb(look)] })));
    await open();
    const reads = readMirrorJob.mock.calls.length;
    await userEvent.click(await visits().findByRole("button", { name: BOOKING_WORDS.door.lookAgain }));
    expect(await visits().findByRole("button", { name: BOOKING_WORDS.door.keep })).toHaveFocus();
    expect(readMirrorJob.mock.calls.length).toBe(reads + 1);
  });

  it("Keep backs out; a door that came to clear opens with the question asked", async () => {
    leftover("Completed");
    readJobRecord.mockResolvedValue(record(bookings({ canBook: false })));
    await open({ openClear: LEFT.toUpperCase() });
    const keep = await visits().findByRole("button", { name: BOOKING_WORDS.door.keep });
    await userEvent.click(keep);
    expect(visits().queryByRole("button", { name: BOOKING_WORDS.door.keep })).toBeNull();
    expect(bk.clearLeftoverBooking).not.toHaveBeenCalled();
  });
});

describe("the poll (D-11)", () => {
  it("(F) asks every 10 s while a line is on its way, at most 6 times, and hides a booking a read says we took out", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
    const sending: BookingState = { key: "line.sending", text: BOOKING_WORDS.line.sending, tone: null, acts: ["cancel"] };
    const v = ourVerb(sending);
    v.bookings[0] = { ...v.bookings[0], uuid: NOT_YET, standing: false };
    readMirrorJob.mockResolvedValue({ detail: detail({ booked: [entry()] }), focusRemoteId: null });
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [v] })));
    bk.readBookingStates.mockResolvedValue({ verbs: [v], lines: {}, gone: [THEIRS.toUpperCase()] });
    render(<JobSheet row={row()} {...props} initialTab="visits" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(visits().getByText(BOOKING_WORDS.line.sending)).toBeInTheDocument();
    expect(visits().getByText("Next on site")).toBeInTheDocument();
    expect(bk.readBookingStates).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(bk.readBookingStates).toHaveBeenCalledTimes(1);
    /* the one we took out leaves the list */
    expect(visits().queryByText("Next on site")).toBeNull();

    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
    }
    expect(bk.readBookingStates).toHaveBeenCalledTimes(6);
  });

  it("(F) stops once nothing is waiting", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
    const sending: BookingState = { key: "line.sending", text: BOOKING_WORDS.line.sending, tone: null, acts: [] };
    const v = ourVerb(sending);
    v.bookings[0] = { ...v.bookings[0], uuid: NOT_YET, standing: false };
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [v] })));
    bk.readBookingStates.mockResolvedValue({ verbs: [ourVerb()], lines: {}, gone: [] });
    render(<JobSheet row={row()} {...props} initialTab="visits" />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(bk.readBookingStates).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
    }
    expect(bk.readBookingStates).toHaveBeenCalledTimes(1);
  });

  it("(F) a trial Book in that makes a Quote a Work Order stops asking once a read has answered", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    /* a trial's status change has no line to say; its booking says Trial run */
    const trial: VerbView = {
      ...ourVerb({ key: "line.trial", text: BOOKING_WORDS.line.trial, tone: null, acts: ["cancel"] }),
      status: null,
    };
    trial.bookings[0] = { ...trial.bookings[0], uuid: NOT_YET, standing: false };
    readMirrorJob.mockResolvedValue({ detail: detail({ booked: [] }), focusRemoteId: null });
    readJobRecord.mockResolvedValue(record(bookings()));
    bk.readBookInContext.mockResolvedValue({
      ok: true,
      offered: true,
      trial: true,
      hold: null,
      zone: "Australia/Sydney",
      today: "2026-10-06",
      job: { uuid: JOB, number: "3342", status: "Quote", editDate: "2026-10-01 10:00:00" },
      bookings: [],
      days: { "2026-10-07": [] },
      jobNumbers: {},
      staff: [{ uuid: SAM, name: "Sam Tester", you: true, linked: true }],
      readAt: "2026-10-05T22:00:00.000Z",
    } as never);
    bk.bookJobIn.mockResolvedValue({ ok: true, verb: trial, rowIds: ["s-1", "c-2"] } as never);
    bk.readBookingStates.mockResolvedValue({ verbs: [trial], lines: {}, gone: [] });
    render(<JobSheet row={row()} {...props} openBookIn />);
    const who = await screen.findByRole("combobox", { name: BOOKING_WORDS.panel.who });
    await waitFor(() => expect((who as HTMLSelectElement).options.length).toBe(2));
    await user.selectOptions(who, SAM);
    await user.click(screen.getByRole("button", { name: BOOKING_WORDS.panel.book }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(bk.bookJobIn).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
    }
    expect(bk.readBookingStates).toHaveBeenCalledTimes(1);
  });

  it("(F) asks nothing where nothing is on its way", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
    readJobRecord.mockResolvedValue(record(bookings({ verbs: [ourVerb()] })));
    render(<JobSheet row={row()} {...props} initialTab="visits" />);
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
    }
    expect(bk.readBookingStates).not.toHaveBeenCalled();
  });
});
