/* THE JOB'S PAGE — the laws the job card pinned, on the page that holds its
   faces now (the card over the screen went on 24 October 2026).

   Everything the card pinned on a face still holds; it just lives in a
   section of the page, so a test opens the section that holds what it
   asserts. Money stays behind its grant (no Billing without it), the
   Overview holds the stages line, the customer and the job's conversation
   (the diary's entries, doors and pen), and the summary refresh kicks ONCE,
   only when the story's stamp has left the stored one behind. */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { STALE_DEPLOY_WORDS } from "@/lib/stale-deploy";
import type { JobDesign, MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { CacheJobFilesResult } from "@/app/actions/workboard-media";
import type { JobCardRead, JobRecordRead } from "@/app/actions/workboard";
import type { ClaimDetailRead } from "@/lib/workboard/all-jobs-query";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import { deriveFamilyMoney, type FamilyMoney } from "@/lib/workboard/job-family";
import { buildJobStory, storyStamp } from "@/lib/workboard/job-story";
import type { JobPaper, JobPapersRead, PaperChoices } from "@/lib/compliance/papers";
import type {
  AddPapersResult,
  EmailDocumentsInput,
  EmailDocumentsResult,
  EmailDraft,
} from "@/app/actions/job-compliance";
import type { JobSm8Read, SendToSm8Input, SendToSm8Result } from "@/app/actions/job-sm8";
import type {
  ConfirmResult,
  FlagResult,
  JobNoteStates,
  NoteStateResult,
  ReplyResult,
  TakeBackNoteResult,
} from "@/app/actions/job-note-sm8";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-words";

const readMirrorJob = jest.fn(
  async (): Promise<JobCardRead> => ({ detail: null, focusRemoteId: null })
);
const readClaim = jest.fn(async (): Promise<ClaimDetailRead | null> => null);
const createProjectFromJob = jest.fn(async () => ({ ok: true as const, id: "p-new" }));
/* A job with no files is the common case and the default here. */
const readJobFiles = jest.fn(async (): Promise<JobMediaGroupsRead | null> => null);
/* Notes always; ledger null for a reader without money — the SERVER decides. */
const readJobRecord = jest.fn(async (): Promise<JobRecordRead | null> => null);
/* The job's page mode draws its conversation, whose Add photo reaches the
   documents actions ("use server", which jsdom can't load). */
jest.mock("@/app/actions/documents", () => ({ deleteDocument: jest.fn(async () => ({ ok: true })) }));
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
const setPicklistItemPicked = jest.fn(async (): Promise<unknown> => null);
const removePicklistItem = jest.fn(async () => {});
const addJobPicklistItem = jest.fn(async (): Promise<unknown> => ({}));
/* Check in / check out — controllable, for the Installation tests below. */
const readMyCheckIn = jest.fn(async (): Promise<unknown> => null);
const checkIn = jest.fn(async (_job: string): Promise<unknown> => null);
const checkOut = jest.fn(async (_job: string): Promise<unknown> => null);
/* The customer dialog — controllable for its tests below. */
const customerEditOffered = jest.fn(async () => false);
const readCustomerForEdit = jest.fn();
const saveCustomer = jest.fn();
jest.mock("@/app/actions/job-deposit", () => ({ setNoDeposit: jest.fn(async (_j: string, on: boolean) => ({ ok: true, noDeposit: on })) }));
/* the Quote section's send to ServiceM8: offered nowhere here */
jest.mock("@/app/actions/quote-sm8", () => ({
  quoteSendOffered: jest.fn(async () => ({ offered: false, trial: false })),
  sendQuoteToSm8: jest.fn(),
}));
jest.mock("@/app/actions/job-customer", () => ({
  customerEditOffered: () => customerEditOffered(),
  readCustomerForEdit: (...a: unknown[]) => readCustomerForEdit(...a),
  saveCustomer: (...a: unknown[]) => saveCustomer(...a),
}));
jest.mock("@/app/actions/job-check-ins", () => ({
  readMyCheckIn: () => readMyCheckIn(),
  checkIn: (j: string) => checkIn(j),
  checkOut: (j: string) => checkOut(j),
}));
jest.mock("@/app/actions/job-picklist", () => ({
  listJobPicklist: (...a: unknown[]) => listJobPicklist(...(a as [])),
  setPicklistItemPicked: (...a: unknown[]) => setPicklistItemPicked(...(a as [])),
  removePicklistItem: (...a: unknown[]) => removePicklistItem(...(a as [])),
  addJobPicklistItem: (...a: unknown[]) => addJobPicklistItem(...(a as [])),
}));
/* The showcase stars — mocked for their content below, and mocked at all for
   the same "use server" reason as the two above. */
const listJobPhotoFavourites = jest.fn(async (): Promise<{ remoteId: string; addedAt: string }[]> => []);
const setJobPhotoFavourite = jest.fn(
  async (
    _job: string,
    _photo: string,
    starred: boolean
  ): Promise<{ ok: boolean; starred: boolean; note: string | null }> => ({
    ok: true,
    starred,
    note: null,
  })
);
/* Opening a job card is what puts its photographs in the searchable bank, so
   the reader is part of the card's own loop now. Mocked here for its content,
   and mocked at all for the "use server" reason as ever. */
/* TYPED, and it has to be: jest transpiles without checking, so a mock whose
   parameters are unstated makes `mock.calls[n][1]` a tuple index that does not
   exist — an error the test run never sees and CI always does. The tier
   argument is the whole point of these assertions, so it must be visible. */
const readJobPhotos = jest.fn(
  async (
    _job: string,
    _tier?: "bank" | "showcase" | "upgrade",
    _attachment?: string
  ): Promise<{ ok: boolean; read: number; remaining: number; note: string | null }> => ({
    ok: true,
    read: 0,
    remaining: 0,
    note: null,
  })
);
jest.mock("@/app/actions/photo-readings", () => ({
  readJobPhotos: (...a: unknown[]) =>
    readJobPhotos(...(a as [string, ("bank" | "showcase" | "upgrade")?, string?])),
}));
jest.mock("@/app/actions/job-photo-favourites", () => ({
  listJobPhotoFavourites: (...a: unknown[]) => listJobPhotoFavourites(...(a as [])),
  setJobPhotoFavourite: (...a: unknown[]) =>
    setJobPhotoFavourite(...(a as [string, string, boolean])),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

/* THE SERVER-ACTION IMPORT TRAP, again: `"use server"` modules pull
   `next/cache`, which needs a `Request` global jsdom hasn't got — so the
   card's own `clearFlag` (workboard-notes) takes the whole suite down at
   import time unless both action modules are mocked here. (The diary's pen
   reached it too, through the capture card's flow, until that went.) */
const routeNote = jest.fn(async () => ({ ok: false, error: "no" }));
const clearFlag = jest.fn(async () => ({ ok: true }));
const openRecordByName = jest.fn(async (_words: string) => null as { href: string; label: string; line: string } | null);
jest.mock("@/app/actions/tiff-open", () => ({ openRecordByName: (w: string) => openRecordByName(w) }));
/* the job page's Overview holds the Tiff modal's conversation, which reads the calendar's line actions */
jest.mock("@/app/actions/calendar", () => ({ fileCalendarLine: jest.fn(), noteOnCalendarEvents: jest.fn(), undoCalendarLine: jest.fn() }));
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: (...a: unknown[]) => routeNote(...(a as [])),
  dismissNote: jest.fn(async () => ({ ok: true, summary: "" })),
  clearFlag: (...a: unknown[]) => clearFlag(...(a as [])),
  restoreFlag: jest.fn(async () => ({ ok: true, summary: "" })),
}));
const addJobNote = jest.fn(async (job: string, body: string) => ({
  id: "our-1",
  text: body,
  at: "2026-08-28T09:00:00.000Z",
  author: "Isaac Smith",
}));
const removeJobNote = jest.fn(async () => {});
const taskFromJobNote = jest.fn(async () => ({ ok: true, taskId: "t-new" }));
const dismissJobNote = jest.fn(async () => {});
/* The Documents face's upload: the shared slot flow, then the row pointed at
   the job. Mocked for their content, and for the "use server" reason as
   ever. */
const uploadFile = jest.fn(async (_file: File, _kind: string) => ({
  ok: true as const,
  file: { documentId: "d-9", fileName: "CoC.pdf", mimeType: "application/pdf", sizeBytes: 8, previewUrl: null },
}));
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...(a as [File, string])),
}));
const attachJobDocument = jest.fn(
  async (_doc: string, _job: string): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true })
);
const removeJobDocument = jest.fn(
  async (_doc: string): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true })
);
jest.mock("@/app/actions/job-documents", () => ({
  attachJobDocument: (...a: unknown[]) => attachJobDocument(...(a as [string, string])),
  removeJobDocument: (...a: unknown[]) => removeJobDocument(...(a as [string])),
}));
jest.mock("@/app/actions/job-notes", () => ({
  addJobNote: (...a: unknown[]) => addJobNote(...(a as [string, string])),
  removeJobNote: (...a: unknown[]) => removeJobNote(...(a as [])),
  taskFromJobNote: (...a: unknown[]) => taskFromJobNote(...(a as [])),
  dismissJobNote: (...a: unknown[]) => dismissJobNote(...(a as [])),
}));
/* Compliance on the job and sending its files — mocked for their content in
   the block that tests them. The default is the setup file's: nothing on the
   job and a viewer who may do nothing with it, so no other test sees a tick. */
const compliance = {
  listJobPapers: jest.fn(async (_job: string): Promise<JobPapersRead | null> => null),
  readComplianceChoices: jest.fn(async (_job: string): Promise<PaperChoices | null> => null),
  addJobPapers: jest.fn(async (_job: string, _keys: string[]): Promise<AddPapersResult> => ({ ok: false, error: "no" })),
  removeJobPaper: jest.fn(async () => ({ ok: true as const })),
  renewJobPaper: jest.fn(async () => ({ ok: true as const })),
  readEmailDraft: jest.fn(async (_job: string): Promise<EmailDraft | null> => null),
  emailJobDocuments: jest.fn(async (_input: EmailDocumentsInput): Promise<EmailDocumentsResult> => ({ ok: false, error: "no" })),
};
jest.mock("@/app/actions/job-compliance", () => ({
  listJobPapers: (...a: unknown[]) => compliance.listJobPapers(...(a as [string])),
  readComplianceChoices: (...a: unknown[]) => compliance.readComplianceChoices(...(a as [string])),
  addJobPapers: (...a: unknown[]) => compliance.addJobPapers(...(a as [string, string[]])),
  removeJobPaper: (...a: unknown[]) => compliance.removeJobPaper(...(a as [])),
  renewJobPaper: (...a: unknown[]) => compliance.renewJobPaper(...(a as [])),
  readEmailDraft: (...a: unknown[]) => compliance.readEmailDraft(...(a as [string])),
  emailJobDocuments: (...a: unknown[]) => compliance.emailJobDocuments(...(a as [EmailDocumentsInput])),
}));
/* Send to ServiceM8 — the same arrangement: nothing offered and nothing sent
   by default, filled in by the tests that are about it. */
const sm8Send = {
  readJobSm8: jest.fn(async (_job: string): Promise<JobSm8Read | null> => null),
  sendJobDocumentsToServiceM8: jest.fn(
    async (_input: SendToSm8Input): Promise<SendToSm8Result> => ({ ok: false, error: "no" })
  ),
};
jest.mock("@/app/actions/job-sm8", () => ({
  readJobSm8: (...a: unknown[]) => sm8Send.readJobSm8(...(a as [string])),
  sendJobDocumentsToServiceM8: (...a: unknown[]) =>
    sm8Send.sendJobDocumentsToServiceM8(...(a as [SendToSm8Input])),
}));
/* Notes to ServiceM8 (two-way phase 2) — the same arrangement: nothing
   offered and nothing sent by default, filled in by the block about them. */
const noteSm8 = {
  replyToJobNote: jest.fn(async (_i: Parameters<typeof import("@/app/actions/job-note-sm8").replyToJobNote>[0]): Promise<ReplyResult> => ({ ok: false, error: "no" })),
  sendJobNoteToServiceM8: jest.fn(async (_i: { jobUuid: string; noteId: string }): Promise<NoteStateResult> => ({ ok: false, error: "no" })),
  takeBackJobNote: jest.fn(async (_i: { jobUuid: string; noteId: string }): Promise<TakeBackNoteResult> => ({ ok: false, error: "no" })),
  markJobNoteDone: jest.fn(async (_i: unknown): Promise<FlagResult> => ({ ok: false, error: "no" })),
  undoJobNoteDone: jest.fn(async (_i: unknown): Promise<FlagResult> => ({ ok: false, error: "no" })),
  confirmMySm8Link: jest.fn(async (_i: { remoteId: string; answer: "yes" | "no" }): Promise<ConfirmResult> => ({ ok: false, error: "no" })),
  readJobNoteStates: jest.fn(async (_i: { jobUuid: string }): Promise<JobNoteStates | null> => null),
};
jest.mock("@/app/actions/job-note-sm8", () => ({
  replyToJobNote: (...a: unknown[]) => noteSm8.replyToJobNote(...(a as [never])),
  sendJobNoteToServiceM8: (...a: unknown[]) => noteSm8.sendJobNoteToServiceM8(...(a as [never])),
  takeBackJobNote: (...a: unknown[]) => noteSm8.takeBackJobNote(...(a as [never])),
  markJobNoteDone: (...a: unknown[]) => noteSm8.markJobNoteDone(...(a as [never])),
  undoJobNoteDone: (...a: unknown[]) => noteSm8.undoJobNoteDone(...(a as [never])),
  confirmMySm8Link: (...a: unknown[]) => noteSm8.confirmMySm8Link(...(a as [never])),
  readJobNoteStates: (...a: unknown[]) => noteSm8.readJobNoteStates(...(a as [never])),
}));


import { useState } from "react";
import { JobSheet, visitLength } from "../job-sheet";
import type { JobSection } from "@/lib/jobs/job-sections";

type JobProps = Omit<Parameters<typeof JobSheet>[0], "page"> & { section?: JobSection };
/** Every section move the page was asked for. */
const onSection = jest.fn();
/** The job's own page, on one section (Overview unless a test says); a move
    to another section draws it, as the page does. */
function Job({ section: first = "overview", ...p }: JobProps) {
  const [section, setSection] = useState<JobSection>(first);
  return (
    <JobSheet
      {...p}
      page={{
        section,
        onSection: (next) => {
          onSection(next);
          setSection(next);
        },
        actions: [],
        onAction: () => {},
      }}
    />
  );
}

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
  /* an install a quote went out for: the quote line */
  quoteSentOn: "2026-08-01",
  workOrderDate: "2026-08-04 09:00:00",
  completionDate: null,
  nextBooking: {
    start: "2026-08-14 07:30:00",
    end: "2026-08-14 15:30:00",
    staffName: "Alex Lomond",
    staffTitle: "Senior HVAC",
  },
  timeOnSite: { minutes: 1110, sessions: 2 },
  dateOn: "2026-08-08",
  dateLabel: "raised",
  visits: [
    { day: "2026-08-14", minutes: 620, crew: [{ name: "Alex Lomond", title: "Senior HVAC" }] },
    {
      day: "2026-08-13",
      minutes: 490,
      crew: [
        { name: "Callum Vallis", title: null },
        { name: "Alex Lomond", title: "Senior HVAC" },
      ],
    },
  ],
  queue: { name: "Parts on Order", expiry: "2026-08-20", staffName: "Lyle Irving" },
  checklist: [
    { name: "Isolate power", itemType: "Todo", section: null, done: true, doneOn: "2026-08-13", doneAt: "2026-08-13 15:40:00", doneBy: "Callum Vallis" },
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
  ourNotes: [],
  attention: { items: [], total: 0 },
  assignable: [],
  ledger: null,
  family: null,
  summary: null,
  ...over,
});

beforeEach(() => {
  uploadFile.mockClear();
  attachJobDocument.mockClear();
  removeJobDocument.mockClear();
  readMirrorJob.mockReset();
  readClaim.mockReset();
  readClaim.mockResolvedValue(null);
  readJobFiles.mockReset();
  readJobRecord.mockReset();
  cacheJobFiles.mockReset();
  readMirrorJob.mockResolvedValue(card(null));
  readJobFiles.mockResolvedValue(null);
  sm8Send.readJobSm8.mockReset().mockResolvedValue(null);
  sm8Send.sendJobDocumentsToServiceM8.mockReset().mockResolvedValue({ ok: false, error: "no" });
  readJobRecord.mockResolvedValue(null);
  cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 0, media: null, note: null });
  listJobPicklist.mockReset();
  setPicklistItemPicked.mockReset();
  removePicklistItem.mockReset();
  listJobPicklist.mockResolvedValue([]);
  setPicklistItemPicked.mockResolvedValue(undefined);
  removePicklistItem.mockResolvedValue(undefined);
  readJobPhotos.mockReset();
  onSection.mockReset();
  readJobPhotos.mockResolvedValue({ ok: true, read: 0, remaining: 0, note: null });
  listJobPhotoFavourites.mockReset();
  setJobPhotoFavourite.mockReset();
  listJobPhotoFavourites.mockResolvedValue([]);
  setJobPhotoFavourite.mockImplementation(async (_job, _photo, starred) => ({
    ok: true,
    starred,
    note: null,
  }));
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
  onCreateAgreement: noop,
  onOpenTracked: noop,
  onToast: noop,
};

/** The head's grey line holding the detail's geo line is the "detail
    landed" signal: before it, the line says the row's suburb. */
const detailLanded = () =>
  waitFor(() => expect(document.querySelector(".jp-facts")).toHaveTextContent("Rose Bay NSW 2029"));

/** One of the job's section tabs (a face may hold tabs of its own). */
const jobTab = (name: string) =>
  within(screen.getByRole("tablist", { name: "The job" })).getByRole("tab", { name: new RegExp(`^${name}`) });

/* The card's faces, by the section of the page that holds each: the old face
   names still read here, so a test says what it opens. */
const SECTION: Record<string, string> = {
  Summary: "Overview",
  Diary: "Overview",
  Money: "Billing",
  Compliance: "Documents",
};
const openTab = async (name: string) => {
  await userEvent.click(jobTab(SECTION[name] ?? name));
};

/** The job's conversation, on Overview: the diary's entries, its doors and
    the pen (Save), where the card had its Diary face. */
const convo = () => within(document.querySelector(".jc-convo") as HTMLElement);

/** The page's Actions menu, open. */
const actionsMenu = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Actions" }));
  return screen.findByRole("menu", { name: "Actions on this job" });
};

/** Queries scoped to one face's panel. The inactive panels are `hidden` (so
    role queries already skip them) but TEXT queries reach into them — a day
    marker in the hidden Diary would collide with the same date on the
    Visits face without this. */
const face = (key: string) =>
  within(document.querySelector(`#jcsec-${key}`) as HTMLElement);

/** The layers in <body>, in document order. What opens over the page
    portals to the body (src/app/dashboard/__tests__/sheet-overlay-layers.test.ts),
    and at an equal z-index the LATER element paints on top — so it has to
    render after the page, beside it, never inside it or ahead of it. jsdom
    cannot see a stacking context; this order is the half of it that it can. */
const bodyLayers = () =>
  [...document.body.children]
    .map((el) => (el.getAttribute("class") ?? "").split(" ")[0])
    .filter((c) => c.startsWith("wb2-"));

/* ── the anatomy ── */

describe("the page is a stages line over its sections", () => {
it("lands on Overview, the stages line over the tiles", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} moneyVisible manage />);
    await detailLanded();

    expect(jobTab("Overview")).toHaveAttribute("aria-selected", "true");
    const line = within(screen.getByRole("navigation", { name: "Where the job is up to" }));
    expect(line.getAllByRole("button").map((b) => b.querySelector("b")?.textContent)).toEqual([
      "Enquiry",
      "Quoted",
      "Accepted",
      "Deposit paid",
      "Materials sorted",
      "Installation",
      "Paid",
    ]);
  });

  /* THE TAB IS THE GATE. Without `workboard_money` the face is ABSENT — no
     lock icon, no greyed stub — because the server never sent what would
     have filled it. */
  it("has no Money tab at all without the grant", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    expect(within(screen.getByRole("tablist", { name: "The job" })).queryByRole("tab", { name: /^Billing/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Deposit paid/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Paid/ })).toBeNull();
  });

  /* THE QUOTE IS EVERYONE'S ON THE WORKBOARD, its money only theirs who
     see money (Isaac, 2026-10-12: "the quoting section should still be
     accessible. For techs who are quoting a job"). */
  it("opens the Quote from Quoted without Workboard manage", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await userEvent.click(screen.getByRole("button", { name: /^Quoted/ }));
    expect(jobTab("Quote")).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector("#jcsec-quote")).not.toHaveAttribute("hidden");
    expect(document.querySelector(".jp-over")).toHaveAttribute("hidden");
  });

});

/* ── the band ── */

describe("the head's grey line", () => {
  it("falls back to the geo line when the job has no written address", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ address: null })));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    expect(document.querySelector(".jp-facts")).toHaveTextContent("Work order, Job 3137, Rose Bay NSW 2029.");
  });

});

/* ── the Summary face ── */

describe("the customer, on Overview", () => {

  it("offers Edit on the contacts only where saving customers is on, and edits in a dialog that sends only what changed", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    const { unmount } = render(<Job row={row()} {...props} manage />);
    await detailLanded();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    unmount();

    customerEditOffered.mockResolvedValueOnce(true);
    const form = {
      jobUuid: "j-1",
      company: { uuid: "c-1", name: "Laing + Simmons Double Bay", address: "1 Bay St" },
      billingAddress: "1 Bay St",
      contacts: [{ uuid: "p-1", first: "Josh", last: "", mobile: "0426 719 412", phone: "", email: "josh@lsdb.com.au", type: "Property Manager" }],
    };
    readCustomerForEdit.mockResolvedValueOnce({ ok: true, form, siteAddress: "Rose Bay NSW 2029", billingRead: true });
    saveCustomer.mockResolvedValueOnce({ ok: true, saved: 2, waiting: 0, failed: [] });
    const onToast = jest.fn();
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} manage onToast={onToast} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Edit customer" }));
    expect(await dialog.findByDisplayValue("Josh")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("combobox", { name: "Role" }));
    await userEvent.click(screen.getByRole("option", { name: "Site contact" }));
    await userEvent.click(dialog.getByRole("button", { name: "Same as the site" }));
    await userEvent.click(dialog.getByRole("button", { name: "Save to ServiceM8" }));
    await waitFor(() => expect(saveCustomer).toHaveBeenCalled());
    const sent = saveCustomer.mock.calls[0]![1] as typeof form;
    expect(sent.contacts[0]!.type).toBe("Site Contact");
    expect(sent.billingAddress).toBe("Rose Bay NSW 2029");
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Saved to ServiceM8. The card catches up within a minute."));
  });

  it("Escape in Edit customer closes the dialog, not the page under it", async () => {
    customerEditOffered.mockResolvedValueOnce(true);
    readCustomerForEdit.mockResolvedValueOnce({
      ok: true,
      form: { jobUuid: "j-1", company: null, billingAddress: "", contacts: [] },
      siteAddress: null,
      billingRead: true,
    });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} manage />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog", { name: "Edit customer" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit customer" })).toBeNull());
    /* the page is still there under it */
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Laing + Simmons Double Bay");
  });

  it("puts the customer on Overview: a contact's email as a mailto link, and their role", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);

    const cust = within(await screen.findByRole("region", { name: "Customer" }));
    const link = (await cust.findByText("josh@lsdb.com.au")) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("mailto:josh@lsdb.com.au");
    expect(cust.getByText("Josh")).toBeInTheDocument();
    expect(cust.getByText("Property manager")).toBeInTheDocument();
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
    render(<Job row={row()} {...props} />);

    const dialable = await screen.findByText("0426 719 412");
    expect(dialable.closest("a")).toHaveAttribute("href", "tel:0426719412");
    expect(document.body.textContent).toContain("0412 345 678 / 9999 a/h");
    expect(document.querySelector('a[href="tel:04123456789999"]')).toBeNull();
  });

  it("keeps the client's PO with the contacts", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ purchaseOrder: "PO-2214" })));
    render(<Job row={row()} {...props} />);
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

  it("kicks once when the stored stamp has fallen behind", async () => {
    allLanded({
      summary: {
        lead: "Old words.",
        points: [],
        stamp: "stale",
        eventOn: "2026-08-01",
        eventLabel: "a note",
      },
    });
    render(<Job row={row()} {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/workboard/job-summary");
    expect(JSON.parse(String(init.body))).toEqual({ job: "j-1" });
    /* once: a later render does not ask again */
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
          quoteSentOn: d.quoteSentOn ?? null,
          workOrderDate: d.workOrderDate,
          completionDate: d.completionDate,
          visits: d.visits,
          booked: d.booked,
          checklist: d.checklist,
          designs: d.designs,
        },
        notes: [],
        ourNotes: [],
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
    render(<Job row={row()} {...props} />);

    await detailLanded();
    /* give any wrong kick a tick to fire before asserting it didn't */
    await waitFor(() => expect(readJobFiles).toHaveBeenCalled());
    await waitFor(() => expect(listJobPicklist).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never kicks while the files are still out — the story would be short", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record());
    /* readJobFiles stays at the default null forever */
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ── the Diary face ── */

describe("the job's conversation, on Overview", () => {

it("puts a day's photos in the conversation and sends the reader to the Photos section", async () => {
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
    render(<Job row={row()} {...props} />);
    await detailLanded();

    expect(await convo().findByText("6 photos")).toBeInTheDocument();
    await userEvent.click(convo().getByRole("button", { name: "See the photos" }));
    expect(jobTab("Photos")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Photos" })).toBeVisible();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();

    /* the deposit settled — its card names the invoice, and Open is its door */
    const ev = (await convo().findAllByText("Invoice #2380A"))[0]!.closest(".jc-event") as HTMLElement;
    await userEvent.click(within(ev).getByRole("button", { name: "Open" }));
    expect(
      await screen.findByRole("dialog", { name: /Payment 1 — Deposit/ })
    ).toBeInTheDocument();
  });

});

/* ── the band's two doors, and the flag ── */

describe("Open in ServiceM8", () => {
  /* The fixtures' "j-1" is not an id ServiceM8 would ever send, and the URL
     builder refuses anything that isn't a uuid — so a job with a real one
     is what proves the door. */
  const UUID = "0e0e0e0e-0000-4000-8000-0000000000c5";

  it("opens the PAGE's job — a clone's page is showing its parent", async () => {
    /* The row that was clicked is the clone; readMirrorJob resolved the
       parent, and the parent is what the reader is looking at. */
    readMirrorJob.mockResolvedValueOnce(card(detail({ remoteId: UUID, jobNumber: "2380" })));
    render(<Job row={row({ id: "clone-uuid", number: "2380A" })} {...props} />);
    await detailLanded();

    const open = jest.spyOn(window, "open").mockImplementation(() => null);
    await userEvent.click(within(await actionsMenu()).getByRole("menuitem", { name: "Open in ServiceM8" }));
    expect(open).toHaveBeenCalledWith(`https://go.servicem8.com/OpenJob/${UUID}`, "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
});

describe("the attention strip", () => {
  const flaggedNote = (over: Record<string, unknown> = {}) => ({
    remoteId: "n-1",
    text: "Send a 20% deposit invoice",
    writtenOn: "2026-08-27",
    writtenAt: "2026-08-27 14:44:40",
    writtenBy: "David Hanby",
    actionRequired: true,
    fromClaim: null,
    ...over,
  });

  const sm8flag = {
    kind: "sm8flag" as const,
    key: "sm8flag:n-1",
    noteUuid: "n-1",
    text: "Send a 20% deposit invoice",
    author: "David Hanby",
    at: "2026-08-27 14:44:40",
  };

  const mention = {
    kind: "mention" as const,
    key: "mention:n-2",
    noteUuid: "n-2",
    text: "@lyleirving still need another day on site to finish",
    author: "David Hanby",
    at: "2026-08-26 09:00:00",
    named: [{ name: "Lyle Irving", staffId: null }],
  };

  it("is ABSENT on a quiet job — no header, no empty furniture", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record());
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await waitFor(() => expect(readJobRecord).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Open on this job" })).toBeNull();
  });

  it("says what ServiceM8's flagged note ACTUALLY SAID, and opens the conversation at it", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({ notes: [flaggedNote()], attention: { items: [sm8flag], total: 1 } })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();

    /* The chip this replaced could only say "1 flagged note" — a number. */
    const strip = within(await screen.findByRole("region", { name: "Open on this job" }));
    expect(strip.getByText("“Send a 20% deposit invoice”")).toBeInTheDocument();
    expect(strip.getByText(/Flagged in ServiceM8/)).toBeInTheDocument();

    await userEvent.click(strip.getByRole("button", { name: /Open in the diary/ }));
    expect(jobTab("Overview")).toHaveAttribute("aria-selected", "true");
    const lit = convo().getByText("Send a 20% deposit invoice").closest(".cv-msg");
    expect(lit).toHaveClass("jc-lit");
  });

  it("clears a HeyTiff flag, and the row leaves at once", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        attention: {
          items: [
            {
              kind: "flag",
              key: "flag:f-1",
              id: "f-1",
              message: "Timber needs replacing before the ceiling closes",
              severity: "urgent",
              raised: "2026-08-12T00:00:00.000Z",
            },
          ],
          total: 1,
        },
      })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();

    const strip = within(await screen.findByRole("region", { name: "Open on this job" }));
    await userEvent.click(strip.getByRole("button", { name: "Clear" }));
    expect(clearFlag).toHaveBeenCalledWith("f-1");
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Open on this job" })).toBeNull()
    );
  });

  describe("a mention", () => {
    const withMention = () =>
      record({
        attention: { items: [mention], total: 1 },
        assignable: [{ id: "staff-1", name: "Isaac Smith" }],
      });

    it("only ever SUGGESTS — the form refuses to save until a person is named", async () => {
      readMirrorJob.mockResolvedValueOnce(card(detail()));
      readJobRecord.mockResolvedValueOnce(withMention());
      render(<Job row={row()} {...props} />);
      await detailLanded();

      const strip = within(await screen.findByRole("region", { name: "Open on this job" }));
      await userEvent.click(strip.getByRole("button", { name: "Make it a task" }));

      /* The title is drafted from the note's own words with the handle taken
         out — a mention is addressing, not content. */
      expect(strip.getByLabelText("What needs doing")).toHaveValue(
        "Still need another day on site to finish"
      );
      /* NOTHING IS PREFILLED WHERE THE LINK IS NOT REAL. integration_links
         is the only source, and the live account has none — so the card
         says so instead of guessing a person. */
      expect(strip.getByLabelText("Who the task is for")).toHaveValue("");
      expect(strip.getByText(/isn't linked to a HeyTiff staff card yet/)).toBeInTheDocument();
      expect(strip.getByRole("button", { name: "Save the task" })).toBeDisabled();
      expect(taskFromJobNote).not.toHaveBeenCalled();
    });

    it("saves once somebody says who it is for", async () => {
      readMirrorJob.mockResolvedValueOnce(card(detail()));
      readJobRecord.mockResolvedValueOnce(withMention());
      render(<Job row={row()} {...props} />);
      await detailLanded();

      const strip = within(await screen.findByRole("region", { name: "Open on this job" }));
      await userEvent.click(strip.getByRole("button", { name: "Make it a task" }));
      await userEvent.selectOptions(strip.getByLabelText("Who the task is for"), "staff-1");
      await userEvent.click(strip.getByRole("button", { name: "Save the task" }));

      expect(taskFromJobNote).toHaveBeenCalledWith({
        jobUuid: "j-1",
        noteUuid: "n-2",
        title: "Still need another day on site to finish",
        assigneeId: "staff-1",
        dueDate: null,
      });
    });

    it("stays dismissed when it wasn't work", async () => {
      readMirrorJob.mockResolvedValueOnce(card(detail()));
      readJobRecord.mockResolvedValueOnce(withMention());
      render(<Job row={row()} {...props} />);
      await detailLanded();

      const strip = within(await screen.findByRole("region", { name: "Open on this job" }));
      await userEvent.click(strip.getByRole("button", { name: "Not work" }));
      expect(dismissJobNote).toHaveBeenCalledWith("j-1", "n-2");
      await waitFor(() =>
        expect(screen.queryByRole("region", { name: "Open on this job" })).toBeNull()
      );
    });
  });

  it("leaves a closed job's flagged notes to the conversation alone", async () => {
    /* The open-job rule is the SERVER's now (job-attention.ts owns it and its
       own suite proves it). What this pins is the other half: the record
       stands even when the alarm doesn't. */
    readMirrorJob.mockResolvedValueOnce(card(detail({ status: "Completed" })));
    readJobRecord.mockResolvedValueOnce(record({ notes: [flaggedNote()] }));
    render(<Job row={row({ statusLabel: "Completed", tone: "ok" })} {...props} />);
    await detailLanded();
    await waitFor(() => expect(convo().getByText("Action required")).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Open on this job" })).toBeNull();
  });
});

/* ── the pen: the conversation's Save ── */

/** Words typed in the conversation's box and kept as typed: the pen's write. */
const keepTyped = async (words: string) => {
  await userEvent.type(convo().getByRole("textbox", { name: "Tell Tiff about this job" }), words);
  await userEvent.click(convo().getByRole("button", { name: "Save" }));
};

describe("writing on the job", () => {
  it("lands in the conversation at once, then wears the name only the server knew", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await waitFor(() => expect(readJobRecord).toHaveBeenCalled());

    const f = convo();
    await keepTyped("Drain kit still to go on");

    /* under the pen's own id (two-way phase 2): a double submit is one entry */
    expect(addJobNote).toHaveBeenCalledWith("j-1", "Drain kit still to go on", {
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    });
    /* THE SAVED ROW REPLACES THE OPTIMISTIC ONE. A browser knows its own
       auth id and not the display name behind it — slice 3 shipped that
       defect on the checklist's stamps, and this is the same fix. */
    await waitFor(() => expect(f.getByText("Isaac Smith")).toBeInTheDocument());
    expect(f.getByText("Drain kit still to go on")).toBeInTheDocument();
    expect(f.getByText("In HeyTiff")).toBeInTheDocument();
  });

  it("takes one back off when asked", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        ourNotes: [
          {
            id: "our-9",
            text: "Ring the builder about roof access",
            at: "2026-08-27T23:30:00.000Z",
            author: "Isaac Smith",
          },
        ],
      })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();

    const f = convo();
    await waitFor(() =>
      expect(f.getByText("Ring the builder about roof access")).toBeInTheDocument()
    );
    await userEvent.click(f.getByRole("button", { name: "Remove" }));
    expect(removeJobNote).toHaveBeenCalledWith("our-9");
    await waitFor(() =>
      expect(f.queryByText("Ring the builder about roof access")).toBeNull()
    );
  });

  it("never offers to remove one of ServiceM8's", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        notes: [
          {
            remoteId: "n-1",
            text: "Please make double detection",
            writtenOn: "2026-08-21",
            writtenAt: "2026-08-21 16:02:00",
            writtenBy: "Michael Dixon",
            actionRequired: false,
            fromClaim: null,
          },
        ],
      })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();

    const f = convo();
    await waitFor(() =>
      expect(f.getByText("Please make double detection")).toBeInTheDocument()
    );
    /* The mirror is read-only by charter — offering a Remove we cannot honour
       is worse than not offering one. */
    expect(f.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(f.queryByText("In HeyTiff")).toBeNull();
  });
});

/* ── notes to ServiceM8 on the page (two-way phase 2, PR B) ── */

describe("notes to ServiceM8 on the page", () => {
  const ASK = "7e7e7e7e-0000-4000-8000-00000000a5c1";
  const ISAAC_SM8 = "5a1b2c3d-0000-4000-8000-00000000aaaa";
  const ready = { state: "ready" as const, staffUuid: ISAAC_SM8, remoteId: ISAAC_SM8, sm8Name: "Isaac Smith", handle: "isaacsmith" };
  const askNote = {
    remoteId: ASK,
    text: "@isaacsmith can you order the grilles",
    writtenOn: "2026-08-26",
    writtenAt: "2026-08-26 09:00:00",
    writtenBy: "Lyle Irving",
    actionRequired: false,
    fromClaim: null,
    editedAt: "2026-08-26 09:00:00",
    authorSm8Uuid: "5a1b2c3d-0000-4000-8000-00000000bbbb",
  };
  const sending = { key: "line.sending" as const, text: NOTE_WORDS.line.sending, tone: null, acts: ["undo" as const] };
  const sent = { key: "line.sent" as const, text: NOTE_WORDS.line.sent, tone: "ok" as const, acts: ["undo" as const] };
  const withNotes = (over: Partial<JobRecordRead> = {}) =>
    record({
      notes: [askNote],
      sender: ready,
      notesSm8: { trial: false, hold: null, owner: false },
      flags: {},
      attention: {
        items: [
          {
            kind: "mention",
            key: `mention:${ASK}`,
            noteUuid: ASK,
            text: askNote.text,
            author: "Lyle Irving",
            at: askNote.writtenAt,
            named: [{ name: "Isaac Smith", staffId: "staff-1" }],
            you: true,
            origin: "sm8",
            rowId: null,
          },
        ],
        total: 1,
      },
      ...over,
    });
  const reply = (over: Partial<import("@/lib/workboard/job-notes-query").OurJobNote> = {}) => ({
    id: "r-1",
    text: "@lyleirving on my way",
    at: "2026-08-26T00:00:00.000Z",
    author: "Isaac Smith",
    authorId: "staff-1",
    replyTo: ASK,
    removed: false,
    state: sending,
    sm8Uuid: null,
    hasCreate: true,
    mine: true,
    ...over,
  });

  beforeEach(() => {
    for (const fn of Object.values(noteSm8)) fn.mockReset();
    noteSm8.readJobNoteStates.mockResolvedValue(null);
    /* the pen's tick is remembered per browser: each test starts unticked */
    localStorage.clear();
    addJobNote.mockClear();
  });

it("(F) the strip's Reply opens the conversation at the note, with its box open; a reply shows at once, sending, with Undo", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(withNotes());
    noteSm8.replyToJobNote.mockResolvedValueOnce({ ok: true, note: reply() });
    render(<Job row={row()} {...props} />);
    await detailLanded();

    const strip = within(await screen.findByRole("region", { name: "Open on this job" }));
    await userEvent.click(strip.getByRole("button", { name: "Reply" }));
    expect(jobTab("Overview")).toHaveAttribute("aria-selected", "true");
    const f = convo();
    /* the note it answers is lit, and its box is open */
    expect(f.getByPlaceholderText(NOTE_WORDS.door.replyPlaceholder).closest(".cv-msg")).toHaveClass("jc-lit");
    await userEvent.type(f.getByPlaceholderText(NOTE_WORDS.door.replyPlaceholder), "on my way");
    await userEvent.click(f.getByRole("button", { name: NOTE_WORDS.door.sendReply }));
    expect(noteSm8.replyToJobNote).toHaveBeenCalledWith(
      expect.objectContaining({ jobUuid: "j-1", sourceNoteUuid: ASK, words: "on my way" })
    );
    // drawn once, with its line and its Undo
    expect(await f.findByText(NOTE_WORDS.line.sending)).toBeInTheDocument();
    expect(f.getAllByText(NOTE_WORDS.line.sending)).toHaveLength(1);
    expect(f.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    // answered: its mention leaves the strip
    expect(screen.queryByRole("region", { name: "Open on this job" })).toBeNull();
  });
it("(F) (verifier r2 12) ticked, the pen sends with the SAVED id — and a second keep while the first is out is no entry and no send", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(withNotes({ attention: { items: [], total: 0 } }));
    let land: (v: unknown) => void = () => {};
    addJobNote.mockImplementationOnce(
      (_job: string, body: string) =>
        new Promise((resolve) => {
          land = () => resolve({ id: "saved-1", text: body, at: "2026-08-28T09:00:00.000Z", author: "Isaac Smith" });
        })
    );
    noteSm8.sendJobNoteToServiceM8.mockResolvedValue({ ok: true, state: sent });
    render(<Job row={row()} {...props} />);
    await detailLanded();
    const f = convo();
    await userEvent.click(await f.findByRole("checkbox", { name: NOTE_WORDS.door.alsoInSm8 }));
    await keepTyped("Drain kit still to go on");
    await userEvent.type(f.getByRole("textbox", { name: "Tell Tiff about this job" }), "Drain kit still to go on");
    /* the first is still being kept: the door waits for it */
    expect(f.getByRole("button", { name: "Saving" })).toBeDisabled();
    await userEvent.click(f.getByRole("button", { name: "Saving" }));
    expect(addJobNote).toHaveBeenCalledTimes(1);
    expect(f.getAllByText("Drain kit still to go on", { ignore: "textarea" })).toHaveLength(1);
    await act(async () => land(null));
    await waitFor(() => expect(noteSm8.sendJobNoteToServiceM8).toHaveBeenCalledTimes(1));
    expect(noteSm8.sendJobNoteToServiceM8).toHaveBeenCalledWith({ jobUuid: "j-1", noteId: "saved-1" });
    expect(await f.findByText(NOTE_WORDS.line.sent)).toBeInTheDocument();
    addJobNote.mockClear();
  });

  it("unticked, the pen sends nothing to ServiceM8", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(withNotes({ attention: { items: [], total: 0 } }));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await convo().findByRole("checkbox", { name: NOTE_WORDS.door.alsoInSm8 });
    await keepTyped("Drain kit");
    await waitFor(() => expect(addJobNote).toHaveBeenCalled());
    expect(noteSm8.sendJobNoteToServiceM8).not.toHaveBeenCalled();
    addJobNote.mockClear();
  });

  it("(F) (verifier r3 3) Yes on a saved row's question confirms, then sends that row; Not me sends nothing", async () => {
    const confirm = { state: "confirm" as const, remoteId: ISAAC_SM8, sm8Name: "Isaac Smith", handle: "isaacsmith" };
    const asking = {
      key: "line.notSent" as const,
      text: "Not sent to ServiceM8. Is Isaac Smith you?",
      tone: "bad" as const,
      acts: ["confirm" as const, "undo" as const],
    };
    readMirrorJob.mockResolvedValue(card(detail()));
    readJobRecord.mockResolvedValue(withNotes({ sender: confirm, ourNotes: [reply({ state: asking })], attention: { items: [], total: 0 } }));
    noteSm8.confirmMySm8Link.mockResolvedValue({ ok: true, sender: ready });
    noteSm8.sendJobNoteToServiceM8.mockResolvedValue({ ok: true, state: sending });
    const { unmount } = render(<Job row={row()} {...props} />);
    await detailLanded();
    const ev = (await convo().findByText("Not sent to ServiceM8. Is Isaac Smith you?")).closest(".cv-msg") as HTMLElement;
    await userEvent.click(within(ev).getByRole("button", { name: NOTE_WORDS.door.yes }));
    expect(noteSm8.confirmMySm8Link).toHaveBeenCalledWith({ remoteId: ISAAC_SM8, answer: "yes" });
    await waitFor(() => expect(noteSm8.sendJobNoteToServiceM8).toHaveBeenCalledWith({ jobUuid: "j-1", noteId: "r-1" }));
    unmount();

    noteSm8.sendJobNoteToServiceM8.mockClear();
    noteSm8.confirmMySm8Link.mockResolvedValue({ ok: true, sender: { ...confirm, state: "denied" } });
    render(<Job row={row()} {...props} />);
    await detailLanded();
    const ev2 = (await convo().findByText("Not sent to ServiceM8. Is Isaac Smith you?")).closest(".cv-msg") as HTMLElement;
    await userEvent.click(within(ev2).getByRole("button", { name: NOTE_WORDS.door.notMe }));
    await waitFor(() => expect(noteSm8.confirmMySm8Link).toHaveBeenLastCalledWith({ remoteId: ISAAC_SM8, answer: "no" }));
    expect(noteSm8.sendJobNoteToServiceM8).not.toHaveBeenCalled();
  });

  it("Undo asks the server and draws what it answers: gone, or still in ServiceM8 with Try again", async () => {
    readMirrorJob.mockResolvedValue(card(detail()));
    readJobRecord.mockResolvedValue(withNotes({ ourNotes: [reply({ state: sent, sm8Uuid: "9a9a9a9a-0000-4000-8000-000000000001" })], attention: { items: [], total: 0 } }));
    noteSm8.takeBackJobNote.mockResolvedValueOnce({
      ok: false,
      error: NOTE_WORDS.press.takeBackOff,
      state: { key: "line.stillIn", text: "Still in ServiceM8. Sending notes is switched off.", tone: "bad", acts: ["take_out_again"] },
    });
    render(<Job row={row()} {...props} />);
    await detailLanded();
    const f = convo();
    await userEvent.click(await f.findByRole("button", { name: "Undo" }));
    expect(noteSm8.takeBackJobNote).toHaveBeenCalledWith({ jobUuid: "j-1", noteId: "r-1" });
    expect(await f.findByText("Still in ServiceM8. Sending notes is switched off.")).toBeInTheDocument();
    noteSm8.takeBackJobNote.mockResolvedValueOnce({ ok: true, gone: true, state: null });
    await userEvent.click(f.getByRole("button", { name: NOTE_WORDS.door.tryAgain }));
    await waitFor(() => expect(f.queryByText("on my way", { exact: false })).toBeNull());
  });

  it("Remove on an entry that went keeps it, taking it out, until it has gone", async () => {
    const entry = reply({ id: "d-1", text: "Drain kit still to go on", replyTo: null, state: null, hasCreate: true });
    readMirrorJob.mockResolvedValue(card(detail()));
    readJobRecord.mockResolvedValue(withNotes({ ourNotes: [entry], attention: { items: [], total: 0 } }));
    removeJobNote.mockResolvedValueOnce({ ok: true, gone: false } as never);
    noteSm8.readJobNoteStates
      .mockResolvedValueOnce({ ours: { "d-1": { key: "line.takingOut", text: NOTE_WORDS.line.takingOut, tone: null, acts: [] } }, flags: {} })
      .mockResolvedValue({ ours: {}, flags: {} });
    render(<Job row={row()} {...props} />);
    await detailLanded();
    const f = convo();
    await userEvent.click(await f.findByRole("button", { name: "Remove" }));
    expect(await f.findByText(NOTE_WORDS.line.takingOut)).toBeInTheDocument();
    expect(f.getByText("Drain kit still to go on")).toBeInTheDocument();
    removeJobNote.mockClear();
  });

  it("(F) Mark done is one press until the server answers: a second click sends nothing, a lost answer's retry is the same press, an answer mints the next", async () => {
    const FLAG = "7e7e7e7e-0000-4000-8000-00000000f1a9";
    const flagNote = { ...askNote, remoteId: FLAG, text: "call the builder", actionRequired: true };
    const flagged = { key: "flag.flagged" as const, text: NOTE_WORDS.flag.flagged, tone: "warn" as const, acts: ["mark_done" as const] };
    const marking = { key: "flag.marking" as const, text: NOTE_WORDS.flag.marking, tone: null, acts: ["unmark" as const] };
    readMirrorJob.mockResolvedValue(card(detail()));
    readJobRecord.mockResolvedValue(withNotes({ notes: [flagNote], flags: { [FLAG]: flagged }, attention: { items: [], total: 0 } }));
    const answers: { resolve: (v: FlagResult) => void; reject: (e: unknown) => void }[] = [];
    const pending = () =>
      new Promise<FlagResult>((resolve, reject) => {
        answers.push({ resolve, reject });
      });
    noteSm8.markJobNoteDone.mockImplementation(pending);
    noteSm8.undoJobNoteDone.mockImplementation(pending);
    render(<Job row={row()} {...props} />);
    await detailLanded();
    const f = convo();
    const pressIdOf = (fn: jest.Mock, n: number) => (fn.mock.calls[n][0] as { pressId: string }).pressId;

    const door = await f.findByRole("button", { name: NOTE_WORDS.door.markDone });
    /* two clicks before the card has drawn the first: the door is still
       open, and the press already out stops the second */
    act(() => {
      door.click();
      door.click();
    });
    expect(noteSm8.markJobNoteDone).toHaveBeenCalledTimes(1);
    await userEvent.click(door);
    expect(noteSm8.markJobNoteDone).toHaveBeenCalledTimes(1);
    expect(door).toBeDisabled();
    const first = pressIdOf(noteSm8.markJobNoteDone, 0);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);

    // the answer was lost: the door opens again, and the retry is the same press
    await act(async () => answers[0].reject(new Error("network")));
    await waitFor(() => expect(door).toBeEnabled());
    await userEvent.click(door);
    expect(noteSm8.markJobNoteDone).toHaveBeenCalledTimes(2);
    expect(pressIdOf(noteSm8.markJobNoteDone, 1)).toBe(first);

    // answered: the next press is a new one
    await act(async () => answers[1].resolve({ ok: false, error: "no", state: flagged }));
    await waitFor(() => expect(door).toBeEnabled());
    await userEvent.click(door);
    expect(noteSm8.markJobNoteDone).toHaveBeenCalledTimes(3);
    const third = pressIdOf(noteSm8.markJobNoteDone, 2);
    expect(third).not.toBe(first);

    // its Undo is a press of its own, never the mark's subject
    await act(async () => answers[2].resolve({ ok: true, state: marking }));
    const undo = await f.findByRole("button", { name: NOTE_WORDS.door.undo });
    await userEvent.click(undo);
    await userEvent.click(undo);
    expect(noteSm8.undoJobNoteDone).toHaveBeenCalledTimes(1);
    expect([first, third]).not.toContain(pressIdOf(noteSm8.undoJobNoteDone, 0));
    await act(async () => answers[3].resolve({ ok: true, state: flagged }));
  });

  it("is not there at all where the deployment sends no notes", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({
        notes: [askNote],
        attention: {
          items: [
            { kind: "mention", key: `mention:${ASK}`, noteUuid: ASK, text: askNote.text, author: "Lyle Irving", at: askNote.writtenAt, named: [{ name: "Isaac Smith", staffId: "staff-1" }] },
          ],
          total: 1,
        },
      })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    const strip = within(await screen.findByRole("region", { name: "Open on this job" }));
    expect(strip.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(strip.getByRole("button", { name: "Make it a task" })).toBeInTheDocument();
    expect(convo().queryByRole("button", { name: "Reply" })).toBeNull();
    expect(convo().queryByRole("checkbox")).toBeNull();
    expect(noteSm8.readJobNoteStates).not.toHaveBeenCalled();
  });
});

/* ── the Visits face ── */

/** The crew cell of the visit row for a day, read as one string — the names
    are separate spans so the title can wear its own weight, and getByText
    matches per element. */
const crewLine = (f: ReturnType<typeof face>, day: string): string =>
  f.getByText(day).parentElement?.querySelector("em")?.textContent ?? "";


describe("the Visits face", () => {
  it("checks the reader in on this job, and the card reads the job again", async () => {
    readMyCheckIn.mockResolvedValueOnce(null);
    checkIn.mockResolvedValueOnce({ jobUuid: "j-1", jobNumber: "3137", since: "2026-10-02T21:32:00Z" });
    readMirrorJob.mockResolvedValue(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Visits");
    const reads = readMirrorJob.mock.calls.length;
    await userEvent.click(face("visits").getByRole("button", { name: "Check in" }));
    expect(checkIn).toHaveBeenCalledWith("j-1");
    expect(await face("visits").findByText(/^On site since 7:32\sam$/)).toBeInTheDocument();
    expect(face("visits").getByRole("button", { name: "Check out" })).toBeInTheDocument();
    await waitFor(() => expect(readMirrorJob.mock.calls.length).toBe(reads + 1));
    readMirrorJob.mockReset();
  });

  it("offers to check in here when the reader is on another job, and says which", async () => {
    readMyCheckIn.mockResolvedValueOnce({ jobUuid: "j-other", jobNumber: "3225", since: "2026-10-02T21:00:00Z" });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Visits");
    expect(await face("visits").findByText(/^Checked in at #3225 since 7:00\sam$/)).toBeInTheDocument();
    expect(face("visits").getByRole("button", { name: "Check in here" })).toBeInTheDocument();
  });

  it("says who is on site now on the day's card", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(detail({ visits: [{ day: "2026-10-03", minutes: 90, crew: [{ name: "Luke Ingold", title: null, onSite: true }] }] }))
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Visits");
    expect(crewLine(face("visits"), "Sat 3 Oct")).toBe("Luke Ingold, on site now");
  });

  it("names a visit's length by the hours each person spent there", () => {
    const two = [{}, {}];
    expect(visitLength({ minutes: 960, crew: two })).toBe("Full day");
    expect(visitLength({ minutes: 300, crew: two })).toBe("Half day");
    expect(visitLength({ minutes: 20, crew: [{}] })).toBe("Pop-in");
    /* a person who left a check-in open adds no hours, so they don't divide them */
    expect(visitLength({ minutes: 406, crew: [{}, { leftOpen: true }] })).toBe("Full day");
    expect(visitLength({ minutes: 0, crew: [{ leftOpen: true }] })).toBe("");
  });

  it("lists every visit with who went, tallies the heading, and puts the booking first", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Visits");

    const f = face("visits");
    expect(f.getByText("2 visits, 18h 30m on site")).toBeInTheDocument();
    expect(f.getByText("Fri 14 Aug")).toBeInTheDocument();
    /* A NAME PLUS WHAT THEY ARE, and only on this face: the dash separates
       the two people because a comma cannot, once a title is in the line;
       a mate with no title in ServiceM8 keeps just his name. */
    expect(crewLine(f, "Thu 13 Aug")).toBe("Callum Vallis — Alex Lomond, Senior HVAC");
    expect(f.getByText("10h 20m")).toBeInTheDocument();
    /* the next booking leads, with its end time */
    expect(f.getByText("Next on site")).toBeInTheDocument();
    expect(f.getByText("7:30am–3:30pm Fri 14 Aug")).toBeInTheDocument();
    /* and the queue keeps its own fact */
    expect(f.getByText("Parts on Order")).toBeInTheDocument();
    expect(f.getByText(/Lyle Irving, until Thu 20 Aug/)).toBeInTheDocument();
  });

  it("names who left a check-in open, and the hours leave them out", async () => {
    /* #3237's 12 Sep and 31 Aug, off the live mirror (sm8CheckInLeftOpen):
       ServiceM8 counted 54h and 38h 57m; Oleksii's own 6h 46m and
       Michael's 1h 45m are all anyone recorded. */
    readMirrorJob.mockResolvedValueOnce(
      card(
        detail({
          timeOnSite: { minutes: 511, sessions: 2 },
          visits: [
            {
              day: "2026-09-12",
              minutes: 406,
              crew: [
                { name: "Oleksii Khalameida", title: "HVAC" },
                { name: "Louis Jones", title: "HVAC", leftOpen: true },
              ],
            },
            {
              day: "2026-08-31",
              minutes: 0,
              crew: [{ name: "Louis Jones", title: null, leftOpen: true }],
            },
          ],
        })
      )
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Visits");

    const f = face("visits");
    expect(crewLine(f, "Sat 12 Sept")).toBe("Oleksii Khalameida, HVAC — Louis Jones, HVAC, check-in left open");
    expect(f.getByText("6h 46m")).toBeInTheDocument();
    /* a day with nothing believable says no figure, never "0m" */
    expect(crewLine(f, "Mon 31 Aug")).toBe("Louis Jones, check-in left open");
    expect(f.getByText("Mon 31 Aug").parentElement?.lastElementChild?.textContent).toBe("—");
    expect(f.queryByText("0m")).toBeNull();
  });

  it("lays every visit out as a card, oldest first, numbered as visits", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      day: `2026-08-${String(20 - i).padStart(2, "0")}`,
      minutes: 60,
      crew: [{ name: "Alex Lomond", title: null }],
    }));
    readMirrorJob.mockResolvedValueOnce(card(detail({ visits: many })));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Visits");

    const strip = within(screen.getByRole("list", { name: "Visits, oldest first" }));
    const cards = strip.getAllByRole("listitem");
    expect(cards).toHaveLength(12);
    expect(within(cards[0]!).getByText("Visit 1")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("Sun 9 Aug")).toBeInTheDocument();
    expect(within(cards[11]!).getByText("Visit 12")).toBeInTheDocument();
    expect(within(cards[11]!).getByText("Thu 20 Aug")).toBeInTheDocument();
    /* an hour for one person is a pop-in */
    expect(within(cards[0]!).getByText("Pop-in")).toBeInTheDocument();
  });

  it("says so when nobody has been on site and nothing is booked", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(detail({ visits: [], nextBooking: null, queue: null, timeOnSite: null }))
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Visits");
    expect(
      screen.getByText("Nobody's been on site yet, and nothing is booked.")
    ).toBeInTheDocument();
  });
});

/* ── Materials: ServiceM8's own checklist, read-only ── */

describe("ServiceM8's checklist on Materials", () => {
  it("is a box of grey ticks nobody changes, by section, with who ticked what", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Materials");

    const box = await face("checklist").findByRole("region", { name: "From ServiceM8" });
    expect(within(box).getByText("Handover")).toBeInTheDocument();
    expect(within(box).queryByRole("checkbox")).not.toBeInTheDocument();

    const done = within(box).getByText("Isolate power").closest(".jm-row")!;
    expect(done).toHaveClass("jm-row--done");
    expect(within(done as HTMLElement).getByRole("img", { name: "Done" })).toBeInTheDocument();
    expect(within(done as HTMLElement).getByText("Callum Vallis, Thu 13 Aug")).toBeInTheDocument();

    const form = within(box).getByText("DAS Service Call").closest(".jm-row")!;
    expect(form).not.toHaveClass("jm-row--done");
    expect(within(form as HTMLElement).getByText("Form")).toBeInTheDocument();
  });

  it("stays writable when the job has no list at all", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ checklist: [] })));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Materials");
    expect(await screen.findByText("No materials on this job yet.")).toBeInTheDocument();
    /* the composer is the point of the face: it is there even when empty */
    expect(screen.getByLabelText("Add a material")).toBeInTheDocument();
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
  it("reads as an invoice: bill to, the terms a segment a claim, and the balance due as the hero", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(detail({ contacts: [{ name: "Accounts", type: "BILLING", phone: null, altPhone: null, email: "accounts@lsdb.com.au" }] }))
    );
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();
    const f = face("money");
    expect(await f.findByText("Bill to")).toBeInTheDocument();
    expect(f.getByText("accounts@lsdb.com.au")).toBeInTheDocument();
    expect(f.getByText("Payment terms")).toBeInTheDocument();
    expect(f.getByText("Balance due")).toBeInTheDocument();
    expect(f.getByText("Claim")).toBeInTheDocument();
  });

  const openMoney = async () => {
    await detailLanded();
    await openTab("Money");
  };

  /* ── DUE-NESS, the last unwired half of slice 1 ──
     `deriveFamilyMoney` has taken payment terms since #553 and every caller
     passed null, because the number existed nowhere in the app. It is the
     organisation's own setting now, so a raised claim can finally say when it
     is due — and one that passed that date says so on the head as well.

     #2380's third claim is the unpaid one: raised Fri 21 Aug, today 26 Aug. */

  it("says only when a claim was RAISED while the terms are unset", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    const f = face("money");
    expect(await f.findByText(/Raised Fri 21 Aug/)).toBeInTheDocument();
    /* NEVER an invented fortnight: with no terms there is no due date, and
       nobody is called late against a number the screen made up. */
    expect(f.queryByText(/Due /)).toBeNull();
    expect(f.queryByText(/overdue/)).toBeNull();
  });

  it("names the due date once the organisation has set its terms", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney({ termsDays: 30 }) }));
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    const f = face("money");
    // raised 21 Aug + 30 days, and today (26 Aug) is well inside it
    expect(await f.findByText(/Due Sun 20 Sep/)).toBeInTheDocument();
    expect(f.getByText("Awaiting")).toBeInTheDocument();
    expect(f.queryByText(/overdue/)).toBeNull();
  });

  it("calls it overdue, on the claim and on the head, once the date has passed", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney({ termsDays: 3 }) }));
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    const f = face("money");
    // raised 21 Aug + 3 days = 24 Aug; today is 26 Aug
    expect(await f.findByText(/Due Mon 24 Aug/)).toBeInTheDocument();
    expect(f.getByText("Overdue")).toBeInTheDocument();
    expect(f.getByText("2 days overdue")).toBeInTheDocument();
  });

  it("puts a claim due ON RECEIPT at its raise date — 0 is an answer", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney({ termsDays: 0 }) }));
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    const f = face("money");
    expect(await f.findByText(/Due Fri 21 Aug/)).toBeInTheDocument();
    expect(f.getByText("5 days overdue")).toBeInTheDocument();
  });

  it("reads three ServiceM8 cards as one job, with the claims numbered", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    expect(await face("money").findByText("$31,340.35")).toBeInTheDocument();
    expect(face("money").getByText("Job value (inc GST)")).toBeInTheDocument();
    expect(face("money").getByText("Payment 1 — Deposit")).toBeInTheDocument();
    expect(face("money").getByText("Payment 2 — Progress")).toBeInTheDocument();
    expect(face("money").getByText("Payment 3 — Final")).toBeInTheDocument();
    expect(
      face("money").getByText("Invoice #2380A, 30% of the job, Raised Fri 27 Mar, Paid Thu 2 Apr")
    ).toBeInTheDocument();
  });

  it("counts the money that landed on the clones", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    await face("money").findByText("$31,340.35");
    const head = document.querySelector(".wb2-mline.head") as HTMLElement;
    expect(within(head).getByText("Awaiting payment")).toBeInTheDocument();
    expect(within(head).getByText("$6,268.06")).toBeInTheDocument();
    expect(within(head).getByText("20% of the job")).toBeInTheDocument();
    expect(face("money").queryByText("Nothing paid yet")).toBeNull();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    expect(
      await face("money").findByText("$25,072.29 invoiced so far — $6,268.06 to come")
    ).toBeInTheDocument();
    expect(face("money").getByText("To come")).toBeInTheDocument();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    expect(await face("money").findByText(/different tax bases/)).toBeInTheDocument();
    expect(face("money").getByText("—")).toBeInTheDocument();
    expect(face("money").getByText("Job value")).toBeInTheDocument();
    expect(face("money").queryByText("Job value (inc GST)")).toBeNull();
    expect(face("money").queryByText("Part or all paid")).toBeNull();
    expect(face("money").queryByText("Nothing paid yet")).toBeNull();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    /* the claim still to bill says so in its own line, with no number */
    const toBill = (await face("money").findByText(/Not yet invoiced/)).textContent ?? "";
    expect(toBill).not.toMatch(/Invoice #2380\b/);
    expect(face("money").queryByText(/Invoice #2380 ·/)).toBeNull();
  });

  /* THE EDGE IS INK, NOT THE JOB TYPE'S COLOUR. The block used to take
     ServiceM8's category colour as its border, and a yellow ring around the
     job's figure looked bad (Isaac, 2026-09-10). The category still reaches
     the sheet — the band's tint, the chip's dot — but no colour from the
     data reaches this block: its edge is the stylesheet's, so the row's
     colour must leave no inline style behind at all. */
  it("wears ink as its edge, never the job type's colour", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    await face("money").findByText("$31,340.35");
    const block = document.querySelector(".wb2-jmoney") as HTMLElement;
    expect(block.style.borderColor).toBe("");
    expect(block.getAttribute("style")).toBeNull();
  });

  /* THE FACE IS TWO COLUMNS (Isaac, 2026-09-10): the money on the left — the
     value, its collection row, what's been paid — and what went on the job on
     the right. The block used to run the full width with the figure top-right
     and the sentence bottom-left, over a grid with one column empty on any
     job with nothing paid. */
  const simpleMoney = {
    valueCents: 1905200,
    invoiced: null,
    invoicedOn: null,
    quoteSent: null,
    quoteSentOn: null,
    paid: false,
    paidOn: null,
  };
  const goodsAndPaid = {
    materials: [
      {
        remoteId: "m-1",
        name: "Ducted system",
        quantity: 1,
        unitCents: 1620000,
        taxInclusive: false,
        lineCents: 1620000,
      },
    ],
    payments: [
      {
        remoteId: "p-1",
        amountCents: 500000,
        method: "EFT",
        note: null,
        takenOn: "2026-09-01",
        takenAt: "2026-09-01 09:15:00",
        isDeposit: true,
        takenBy: "Robbie",
      },
    ],
  };

  it("stands the money in the left column and the goods in the right", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ money: simpleMoney })));
    readJobRecord.mockResolvedValueOnce(record({ ledger: goodsAndPaid }));
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    await face("money").findByText("What went on the job");
    const grid = document.querySelector(".wb2-jcgrid.money") as HTMLElement;
    expect(grid.classList.contains("one")).toBe(false);
    expect(grid.children).toHaveLength(2);
    const [left, right] = Array.from(grid.children);
    expect(left.classList.contains("wb2-jcol")).toBe(true);
    expect(left.children[0].classList.contains("wb2-jmoney")).toBe(true);
    expect(left.children[1].textContent).toMatch(/What's been paid/);
    expect(right.textContent).toMatch(/What went on the job/);
  });

  it("keeps a block that has opened its ledger at the full width, above the columns", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(
      record({ family: familyMoney(), ledger: { materials: goodsAndPaid.materials, payments: [] } })
    );
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    await face("money").findByText("$31,340.35");
    // the claim rows are a table, and a table wants the width
    expect(document.querySelector(".wb2-jcgrid .wb2-jmoney")).toBeNull();
    const moneyFace = document.getElementById("jcsec-money") as HTMLElement;
    expect(moneyFace.children[0].classList.contains("wb2-jmoney")).toBe(true);
    // with no payments there is nothing for the goods to stand beside
    const grid = document.querySelector(".wb2-jcgrid.money") as HTMLElement;
    expect(grid.classList.contains("one")).toBe(true);
    expect(grid.children).toHaveLength(1);
    expect(grid.children[0].textContent).toMatch(/What went on the job/);
  });

  it("runs the block full width when there is nothing to stand beside it", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ money: simpleMoney })));
    readJobRecord.mockResolvedValueOnce(record());
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    await face("money").findByText("$19,052");
    const grid = document.querySelector(".wb2-jcgrid.money.one") as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.children).toHaveLength(1);
    expect(grid.children[0].querySelector(".wb2-jmoney")).not.toBeNull();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    expect(await face("money").findByText("As Per Quote")).toBeInTheDocument();
    expect(face("money").queryByText("Partial invoice #2380A")).toBeNull();
    expect(face("money").getByText("Discount")).toBeInTheDocument();
  });

  it("shows no figure at all until the family read has landed", async () => {
    let land: (v: JobRecordRead) => void = () => {};
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockReturnValueOnce(
      new Promise<JobRecordRead>((res) => {
        land = res;
      })
    );
    render(<Job row={row()} {...props} moneyVisible />);
    await openMoney();

    expect(document.querySelector(".wb2-jmoney")).toBeNull();
    expect(face("money").getByText("Reading the figures")).toBeInTheDocument();

    land(record({ family: familyMoney() }));
    expect(await face("money").findByText("$31,340.35")).toBeInTheDocument();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    await face("money").findByText(/different tax bases/);
    expect(document.querySelector(".wb2-jmbig")!.textContent).toBe("—");
    expect(face("money").getByText("Job value")).toBeInTheDocument();
    const claim = face("money").getByText("Payment 2 — Final").closest(".wb2-mline")!;
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
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await face("money").findByText(/invoiced so far/)).toBeInTheDocument();
    expect(face("money").queryByText("Paid in full")).toBeNull();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await face("money").findByText("Paid in full")).toBeInTheDocument();
    expect(face("money").queryByText("Nothing paid yet")).toBeNull();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await face("money").findByText("$2,794")).toBeInTheDocument();
    expect(face("money").getByText("Nothing paid yet")).toBeInTheDocument();
    // …in the head row, not hanging bare under the figure
    expect(face("money").getByText("Nothing paid yet").closest(".wb2-mline.head")).not.toBeNull();
    expect(document.querySelector(".wb2-jmbar")).toBeNull();
    expect(face("money").queryByText(/^Payment 1/)).toBeNull();
  });

  it("wears the amber head row once there is something to chase", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ money: jobMoney })));
    readJobRecord.mockResolvedValueOnce(
      record({
        family: plain({ paidCents: 100000, lastPaidOn: "2026-08-07", raisedOn: "2026-08-01" }),
      })
    );
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    await face("money").findByText("$2,794");
    const head = document.querySelector(".wb2-mline.head") as HTMLElement;
    expect(within(head).getByText("Awaiting payment")).toBeInTheDocument();
    expect(within(head).getByText("$1,794")).toBeInTheDocument();
    expect(document.querySelector(".wb2-jmbar")).not.toBeNull();
    expect(face("money").queryByText(/Part paid/)).toBeNull();
  });
});

/* ── a clone opens the job it is a claim of ── */

describe("a page opened from a progress claim", () => {
  const opened = () => {
    readMirrorJob.mockResolvedValueOnce(card(detail(), "j-2380a"));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
  };

  it("marks the claim it was opened for in the ledger", async () => {
    opened();
    render(<Job row={row({ number: "2380A" })} {...props} moneyVisible section="billing" />);

    await face("money").findByText("$31,340.35");
    const here = document.querySelector(".wb2-jmclaim.here") as HTMLElement;
    expect(here).not.toBeNull();
    expect(within(here).getByText("Payment 1 — Deposit")).toBeInTheDocument();
  });

  it("reads the job's own record and files, not the claim's", async () => {
    opened();
    render(<Job row={row({ id: "j-2380a", number: "2380A" })} {...props} moneyVisible section="billing" />);

    await face("money").findByText("$31,340.35");
    expect(readJobRecord).toHaveBeenCalledWith("j-1");
    expect(readJobFiles).toHaveBeenCalledWith("j-1");
    expect(readJobRecord).not.toHaveBeenCalledWith("j-2380a");
  });

  it("shows the job's own status and number, not the claim's", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
        detail({ status: "Completed", dateOn: "2026-08-21", dateLabel: "completed" }),
        "j-2380a"
      )
    );
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(
      <Job
        row={row({ number: "2380A", statusLabel: "Quote", tone: "", date: "2026-03-27 00:00:00", dateLabel: "quoted" })}
        {...props}
        moneyVisible
        section="billing"
      />
    );

    await face("money").findByText("$31,340.35");
    /* the head's line is the job's: its status and its number, never the claim's */
    expect(document.querySelector(".jp-facts")).toHaveTextContent("Completed, Job 3137, Rose Bay NSW 2029.");
    expect(document.querySelector(".jp-line")).not.toHaveTextContent(/Quote|2380A/);
  });

});

describe("one claim, opened", () => {
  const openFirstClaim = async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<Job row={row()} {...props} moneyVisible />);
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
            takenBy: "Lyle Irving",
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

  it("closes on Escape, leaving the page under it where it was", async () => {
    readClaim.mockResolvedValue({
      ledger: { materials: [], payments: [] },
      notes: [],
      media: { photos: [], documents: [], elsewhere: [], truncated: false },
    });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ family: familyMoney() }));
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");
    await face("money").findByText("$31,340.35");
    await userEvent.click(
      screen.getByRole("button", { name: /Payment 2 — Progress — open this invoice/ })
    );
    await screen.findByRole("dialog", { name: /Payment 2 — Progress/ });

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /Payment 2/ })).toBeNull();
    /* the page under it stays where it was */
    expect(jobTab("Billing")).toHaveAttribute("aria-selected", "true");
  });

it("renders after the page, beside it in the body, which is what paints it on top", async () => {
    readClaim.mockResolvedValue({
      ledger: { materials: [], payments: [] },
      notes: [],
      media: { photos: [], documents: [], elsewhere: [], truncated: false },
    });
    await openFirstClaim();
    await screen.findByRole("dialog", { name: /Payment 1 — Deposit/ });

    /* the page is the body's first child; the claim portals after it */
    expect(document.body.firstElementChild?.querySelector(".jp-sheet")).not.toBeNull();
    expect(bodyLayers()).toEqual(["wb2-clscrim", "wb2-claim"]);
  });
});

/* ── the job's once-per-job acts, under the head's Actions ── */

describe("the job's once-per-job acts", () => {
  it("holds the promote actions under Actions, manage only", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} manage />);
    await detailLanded();

    const menu = within(await actionsMenu());
    expect(menu.getByRole("menuitem", { name: "Create a project from this job" })).toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: "Create a maintenance agreement" })).toBeInTheDocument();
  });

  it("offers neither without manage", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    const menu = within(await actionsMenu());
    expect(menu.queryByRole("menuitem", { name: "Create a project from this job" })).toBeNull();
    expect(menu.queryByRole("menuitem", { name: "Create a maintenance agreement" })).toBeNull();
  });

  it("names the project on the floor and creates it", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} manage />);
    await detailLanded();

    await userEvent.click(within(await actionsMenu()).getByRole("menuitem", { name: "Create a project from this job" }));
    const input = screen.getByLabelText("Name the project");
    await userEvent.clear(input);
    await userEvent.type(input, "Wallace St change-over{Enter}");
    await waitFor(() =>
      expect(createProjectFromJob).toHaveBeenCalledWith("j-1", expect.objectContaining({
        name: "Wallace St change-over",
      }))
    );
  });

  it("Escape in the naming row cancels the naming", async () => {
    createProjectFromJob.mockClear();
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} manage />);
    await detailLanded();

    await userEvent.click(within(await actionsMenu()).getByRole("menuitem", { name: "Create a project from this job" }));
    expect(screen.getByLabelText("Name the project")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("Name the project")).toBeNull();
    expect(createProjectFromJob).not.toHaveBeenCalled();
  });

  it("names the board a tracked job is on, beside the customer, and that is the door", async () => {
    const onOpenTracked = jest.fn();
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(
      <Job
        row={row({ tracked: { kind: "visit", id: "v-1", label: "#1021" } })}
        {...props}
        onOpenTracked={onOpenTracked}
      />
    );
    await detailLanded();

    const cust = within(screen.getByRole("region", { name: "The customer" }));
    await userEvent.click(cust.getByRole("button", { name: "Open it on the maintenance board" }));
    expect(onOpenTracked).toHaveBeenCalledWith({ kind: "visit", id: "v-1", label: "#1021" });
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
    render(<Job row={row({ statusLabel: "Quote" })} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await face("money").findByText("Quote sent Mon 3 Aug")).toBeInTheDocument();
    expect(face("money").getByText("$6,850")).toBeInTheDocument();
    expect(face("money").queryByText("Nothing paid yet")).toBeNull();
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
    render(<Job row={row({ statusLabel: "Quote" })} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await face("money").findByText("Quote sent Mon 3 Aug")).toBeInTheDocument();
    expect(face("money").queryByText("Awaiting payment")).toBeNull();
  });

  it("says the figures didn't load rather than dropping the money block", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockRejectedValueOnce(new Error("boom"));
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(
      await face("money").findByText(/ServiceM8's figures didn't load just now/)
    ).toBeInTheDocument();
    expect(document.querySelector(".wb2-jmoney")).not.toBeNull();
    expect(face("money").queryByText("$2,794")).toBeNull();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await face("money").findAllByText("$31,340.35")).toHaveLength(2);
    const head = document.querySelector(".wb2-mline.head.ok") as HTMLElement;
    expect(head).not.toBeNull();
    expect(within(head).getByText("Paid in full")).toBeInTheDocument();
    expect(within(head).getByText("$31,340.35")).toBeInTheDocument();
  });

  it("renders no money fact at all without the grant, whatever the detail says", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();

    expect(within(screen.getByRole("tablist", { name: "The job" })).queryByRole("tab", { name: /^Billing/ })).toBeNull();
    expect(document.querySelector("#jcsec-money")).toBeNull();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await face("money").findByText("$1,485")).toBeInTheDocument();
    expect(face("money").getByText(/Job value \(inc GST\)/)).toBeInTheDocument();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    await face("money").findByText("$1,485");
    expect(face("money").queryByText("Not invoiced")).toBeNull();
    expect(face("money").queryByText(/awaiting payment/i)).toBeNull();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");
    expect(await face("money").findByText("Not invoiced")).toBeInTheDocument();
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
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    expect(screen.getByText("Drawings — designed in the Studio")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /12\/3 Wallace St/ });
    expect(link).toHaveAttribute("href", "/dashboard/studio?design=dsn_1");
    expect(within(link).getByText(/2 floors, 3 systems/)).toBeInTheDocument();
  });

  it("counts the options in the heading when a job has several", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(
        detail({
          designs: [design(), design({ id: "dsn_2", name: "12/3 Wallace St — option B" })],
        })
      )
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    expect(screen.getByText("Drawings — 2 Studio options")).toBeInTheDocument();
    expect(document.querySelectorAll("a.wb2-dsgn")).toHaveLength(2);
  });

  it("says one floor and one system in the singular", async () => {
    readMirrorJob.mockResolvedValueOnce(
      card(detail({ designs: [design({ floorCount: 1, systemCount: 1 })] }))
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    expect(screen.getByText(/1 floor, 1 system/)).toBeInTheDocument();
  });

  it("is absent entirely when nothing has been designed", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    expect(screen.queryByText(/Drawings/)).toBeNull();
  });

  it("encodes the id it puts in the link", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail({ designs: [design({ id: "dsn a&b" })] })));
    render(<Job row={row()} {...props} />);
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
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");
    expect(await screen.findByText("No photos on this job.")).toBeInTheDocument();
  });

  it("shows a cached photo as a real image, opening the viewer over the page", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(
      files({ photos: [file({ remoteId: "p-1", url: "https://signed/p-1.jpg" })] })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");

    /* scoped: the Diary clusters the same photo, so the alt exists twice */
    const img = (await face("photos").findByAltText("IMG_4021.jpg")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://signed/p-1.jpg");
    /* the tile is a BUTTON into the shared viewer now — a raw storage URL
       in a new tab loses the job */
    await userEvent.click(img.closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: "IMG_4021.jpg" });
    expect(within(dialog).getByAltText("IMG_4021.jpg")).toBeInTheDocument();

    /* Escape closes the viewer, and the photo is where it was */
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "IMG_4021.jpg" })).toBeNull();
    expect(face("photos").getByAltText("IMG_4021.jpg")).toBeInTheDocument();
  });

  it("opens the viewer after the page, beside it in the body, which is what paints it on top", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(
      files({ photos: [file({ remoteId: "p-1", url: "https://signed/p-1.jpg" })] })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");
    await userEvent.click((await face("photos").findByAltText("IMG_4021.jpg")).closest("button")!);
    await screen.findByRole("dialog", { name: "IMG_4021.jpg" });

    /* the page is the body's first child; the viewer portals after it */
    expect(document.body.firstElementChild?.querySelector(".jp-sheet")).not.toBeNull();
    expect(bodyLayers()).toEqual(["wb2-mvscrim", "wb2-mv"]);
  });

  it("shows a placeholder tile for a photo whose bytes aren't cached", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files({ photos: [file({ remoteId: "p-1" })] }));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");

    await waitFor(() => expect(face("photos").getByText("1 photo")).toBeInTheDocument());
    /* an uncached tile is not a door */
    expect(screen.queryByAltText("IMG_4021.jpg")).toBeNull();
    expect(document.querySelector(".wb2-mtile.pending")).not.toBeNull();
  });

  it("names the paperwork and opens it over the page once cached", async () => {
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
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    /* an Invoice-sourced PDF files under Money — grouped by what it IS */
    const moneySec = (await screen.findByText("Money — 1")).closest(".wb2-jcsec")!;
    const link = within(moneySec as HTMLElement).getByText("Invoice #3137.pdf");
    /* the name already says "Invoice", so the row does NOT say it again —
       #559's meta law survives the grouping */
    expect(within(moneySec as HTMLElement).queryByText("Invoice")).toBeNull();
    /* a PDF opens IN the card — the shared viewer's iframe, not a new tab */
    await userEvent.click(link);
    const dialog = await screen.findByRole("dialog", { name: "Invoice #3137.pdf" });
    expect(dialog.querySelector("iframe")!.getAttribute("src")).toBe("https://signed/d-1.pdf");
  });

  /* THE SWMS IS PAPER TOO. It opened in a new browser tab that lost the job —
     the exact thing this face's viewer exists to stop. */
  it("opens a SWMS in the page's own viewer, not a new tab", async () => {
    const swmsActions = jest.requireMock("@/app/actions/swms") as { listSwmsForJob: jest.Mock };
    swmsActions.listSwmsForJob.mockResolvedValueOnce([
      { swmsId: "s-1", versionId: "v-2", version: 2, issuedAt: "2026-09-16T07:42:00", responsible: "Alex Lomond", signed: 1, total: 2, waitingOn: ["Callum Vallis"], issues: [], viewerCanSign: false, viewerSigned: false },
    ]);
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Compliance");

    await userEvent.click(await face("compliance").findByRole("button", { name: /Safe Work Method Statement/ }));
    const dialog = await screen.findByRole("dialog", { name: "Safe Work Method Statement" });
    expect(dialog.querySelector("iframe")!.getAttribute("src")).toBe("/swms/v-2");
    /* the job already has its SWMS, so the head doesn't offer a second */
    expect(face("compliance").queryByRole("button", { name: "Create SWMS" })).toBeNull();
  });

  /* a SWMS is signed BEFORE the work: on a job ServiceM8 has finished, the
     wizard promised "asked in their bell" for a bell that would never ring */
  it("offers Create SWMS on a live job, and not on a finished one", async () => {
    /* jest.setup's stub already answers "no SWMS on this job" */
    const swmsActions = jest.requireMock("@/app/actions/swms") as { listSwmsForJob: jest.Mock };
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    const { unmount } = render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Compliance");
    expect(await face("compliance").findByRole("button", { name: "Create SWMS" })).toBeEnabled();
    unmount();

    swmsActions.listSwmsForJob.mockClear();
    readMirrorJob.mockResolvedValueOnce(card(detail({ status: "Completed" })));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Compliance");
    /* not a greyed-out button that says nothing: there is nothing to create */
    await waitFor(() => expect(swmsActions.listSwmsForJob).toHaveBeenCalled());
    await act(async () => {});
    expect(face("compliance").queryByRole("button", { name: "Create SWMS" })).toBeNull();
  });

  /* PAPER WE FILE OURSELVES. The certificate, the builder's plans — they had
     nowhere to go but ServiceM8, whose mirror we only read. */
  const ours = file({
    remoteId: "doc:d-9",
    documentId: "d-9",
    addedBy: "Isaac Smith",
    name: "CoC.pdf",
    fileType: ".pdf",
    kind: "document",
    url: "https://signed/d-9.pdf",
    takenAt: "2026-09-23 10:40",
  });

  it("files an upload on THIS job and shows it on the face", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files()).mockResolvedValueOnce(files({ documents: [ours] }));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    const doc = new File(["%PDF-1.4"], "CoC.pdf", { type: "application/pdf" });
    fireEvent.change(face("documents").getByLabelText("Choose documents to upload"), { target: { files: [doc] } });

    expect(await face("documents").findByText("Added by Isaac Smith, Wed 23 Sept")).toBeInTheDocument();
    expect(uploadFile).toHaveBeenCalledWith(doc, "job_document");
    /* the card's own job — the parent the detail read resolved, never a guess */
    expect(attachJobDocument).toHaveBeenCalledWith("d-9", "j-1");
  });

  it("says why a file couldn't be put on the job", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    attachJobDocument.mockResolvedValueOnce({ ok: false, error: "That job isn't in ServiceM8's copy any more." });
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    fireEvent.change(face("documents").getByLabelText("Choose documents to upload"), {
      target: { files: [new File(["%PDF-1.4"], "CoC.pdf", { type: "application/pdf" })] },
    });

    expect(await face("documents").findByText("That job isn't in ServiceM8's copy any more.")).toBeInTheDocument();
  });

  it("takes one of ours back off the job", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files({ documents: [ours] }));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    await userEvent.click(await face("documents").findByRole("button", { name: "Remove" }));
    await userEvent.click(face("documents").getByRole("button", { name: "Delete file" }));

    expect(removeJobDocument).toHaveBeenCalledWith("d-9");
    await waitFor(() => expect(face("documents").queryByText("CoC.pdf")).toBeNull());
  });

  it("files a document that arrived by email under From the client", async () => {
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
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    const sec = (await screen.findByText("From the client — 1")).closest(".wb2-jcsec")!;
    expect(within(sec as HTMLElement).getByText("Site induction.pdf")).toBeInTheDocument();
  });

  it("names an uncached photo by its name and origin", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(
      files({ photos: [file({ remoteId: "p-1", origin: "Emailed in" })] })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");

    await waitFor(() => expect(face("photos").getByText("1 photo")).toBeInTheDocument());
    /* an uncached tile is not a door */
    const tile = document.querySelector(".wb2-mtile") as HTMLElement;
    expect(tile).not.toHaveAttribute("title");
    expect(tile).toHaveAccessibleName("IMG_4021.jpg — emailed in");
  });

  it("puts a video with the photos, as a plate that says where it lives", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(
      /* the SERVER groups video into the photo lens now — the fixture says
         what readJobMediaGroups would actually send */
      files({
        photos: [
          file({ remoteId: "p-1", url: "https://signed/p-1.jpg" }),
          file({ remoteId: "p-2", name: "IMG_4022.jpg" }),
          file({ remoteId: "v-1", name: "walkthrough.mp4", fileType: ".mp4", kind: "video" }),
        ],
      })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");

    /* VIDEO IS FOOTAGE, NOT PAPERWORK — it sits in the photo lens and is
       counted beside the stills; its bytes stay in ServiceM8 by charter, so
       the tile is a plate that says so, never a door that lies. */
    await waitFor(() =>
      expect(face("photos").getByText("2 photos and 1 video")).toBeInTheDocument()
    );
    const tile = document.querySelector("#jcsec-photos .wb2-mtile.video") as HTMLElement;
    expect(tile).not.toBeNull();
    expect(within(tile).getByText("Video, in ServiceM8")).toBeInTheDocument();
    expect(tile.tagName).not.toBe("BUTTON");

    /* AND IT IS NOT A STOP ON THE ARROW KEYS: two stills and a video read
       "1 / 2", never "1 / 3" — a viewer that could land on the video would
       promise a file that is never coming. */
    await userEvent.click(face("photos").getAllByAltText("IMG_4021.jpg")[0].closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: "IMG_4021.jpg" });
    expect(within(dialog).getByText("1 / 2")).toBeInTheDocument();

    await openTab("Documents");
    expect(face("documents").queryByText("walkthrough.mp4")).toBeNull();
  });

  it("carries the rest of the roll into the viewer, and jumps by thumbnail", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(
      files({
        photos: [
          file({ remoteId: "p-1", name: "one.jpg", url: "https://signed/p-1.jpg" }),
          file({ remoteId: "p-2", name: "two.jpg", url: "https://signed/p-2.jpg" }),
          file({ remoteId: "p-3", name: "three.jpg", url: "https://signed/p-3.jpg" }),
          /* the video is in the lens but never a stop — the strip must not
             offer a thumbnail for a file that is never coming */
          file({ remoteId: "v-1", name: "clip.mp4", fileType: ".mp4", kind: "video" }),
        ],
      })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");

    await userEvent.click((await face("photos").findByAltText("one.jpg")).closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: "one.jpg" });

    /* THE WHOLE ROLL IS IN THE STRIP, not just the neighbours the two
       arrows imply — three stills, no video. */
    const strip = within(dialog).getByRole("tablist", { name: "Photos on this job" });
    expect(within(strip).getAllByRole("tab").map((t) => t.getAttribute("aria-label"))).toEqual([
      "one.jpg",
      "two.jpg",
      "three.jpg",
    ]);
    expect(within(strip).getByRole("tab", { selected: true })).toHaveAttribute(
      "aria-label",
      "one.jpg"
    );

    /* A JUMP, NOT A WALK: the third photo is one click away, where the
       arrows would have taken two. */
    await userEvent.click(within(strip).getByRole("tab", { name: "three.jpg" }));
    const open = await screen.findByRole("dialog", { name: "three.jpg" });
    expect(within(open).getByText("3 / 3")).toBeInTheDocument();
    expect(
      within(within(open).getByRole("tablist")).getByRole("tab", { selected: true })
    ).toHaveAttribute("aria-label", "three.jpg");
  });

  /* ── the showcase: starring a photo for other jobs ── */

  it("stars a photo from the mosaic, and the Starred switch narrows to it", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValue(
      files({
        photos: [
          file({ remoteId: "p-1", name: "one.jpg", url: "https://signed/p-1.jpg" }),
          file({ remoteId: "p-2", name: "two.jpg", url: "https://signed/p-2.jpg" }),
        ],
      })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");

    /* NO SWITCH UNTIL THERE IS SOMETHING TO SWITCH TO — an empty filter is
       furniture. The star on every tile is the affordance that's always
       there. */
    expect(face("photos").queryByRole("button", { name: /Starred/ })).toBeNull();

    await userEvent.click(face("photos").getByRole("button", { name: "Star one.jpg" }));
    expect(setJobPhotoFavourite).toHaveBeenCalledWith(detail().remoteId, "p-1", true);

    /* Optimistic: the star is lit before the server has answered, and the
       switch it unlocks counts one. */
    const unstar = await face("photos").findByRole("button", { name: "Unstar one.jpg" });
    expect(unstar).toHaveAttribute("aria-pressed", "true");
    const filter = face("photos").getByRole("button", { name: /Starred \(1\)/ });

    await userEvent.click(filter);
    expect(face("photos").getByAltText("one.jpg")).toBeInTheDocument();
    expect(face("photos").queryByAltText("two.jpg")).toBeNull();
  });

  it("puts the star back when the write is refused", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValue(
      files({ photos: [file({ remoteId: "p-1", name: "one.jpg", url: "https://signed/p-1.jpg" })] })
    );
    /* THE ACTION RETURNS THE TRUTH, not ok/not-ok: a refused star has to
       settle back to what the server actually holds, or the card shows a
       curation that isn't there. */
    setJobPhotoFavourite.mockResolvedValueOnce({ ok: false, starred: false, note: null });
    const onToast = jest.fn();
    render(<Job row={row()} {...props} onToast={onToast} />);
    await detailLanded();
    await openTab("Photos");

    await userEvent.click(face("photos").getByRole("button", { name: "Star one.jpg" }));
    await waitFor(() =>
      expect(face("photos").getByRole("button", { name: "Star one.jpg" })).toHaveAttribute(
        "aria-pressed",
        "false"
      )
    );
    expect(onToast).toHaveBeenCalledWith("Could not save that star");
    expect(face("photos").queryByRole("button", { name: /Starred/ })).toBeNull();
  });

  it("stars from the viewer, where the photo is big enough to judge", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValue(
      files({
        photos: [
          file({ remoteId: "p-1", name: "one.jpg", url: "https://signed/p-1.jpg" }),
          file({ remoteId: "p-2", name: "two.jpg", url: "https://signed/p-2.jpg" }),
        ],
      })
    );
    listJobPhotoFavourites.mockResolvedValue([{ remoteId: "p-2", addedAt: "2026-08-29" }]);
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");

    await userEvent.click((await face("photos").findByAltText("one.jpg")).closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: "one.jpg" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Star one.jpg" }));
    expect(setJobPhotoFavourite).toHaveBeenCalledWith(detail().remoteId, "p-1", true);
    expect(
      await within(dialog).findByRole("button", { name: "Unstar one.jpg" })
    ).toBeInTheDocument();

    /* The star travels with the photo, not with the frame: stepping to a
       photo starred before this card opened shows it lit. */
    await userEvent.keyboard("{ArrowRight}");
    const next = await screen.findByRole("dialog", { name: "two.jpg" });
    expect(within(next).getByRole("button", { name: "Unstar two.jpg" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("has no star on paper — the showcase is a gallery of the work", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValue(
      files({
        documents: [
          file({
            remoteId: "d-1",
            name: "report.pdf",
            fileType: ".pdf",
            kind: "document",
            url: "https://signed/d-1.pdf",
          }),
        ],
      })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");
    await userEvent.click(await face("documents").findByText("report.pdf"));
    const dialog = await screen.findByRole("dialog", { name: "report.pdf" });
    expect(within(dialog).queryByRole("button", { name: /Star/ })).toBeNull();
  });

  /* ── zoom: the fit is the floor ── */

  it("will not zoom a photo out below the size the stage shows it at", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValue(
      files({ photos: [file({ remoteId: "p-1", name: "one.jpg", url: "https://signed/p-1.jpg" })] })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");
    await userEvent.click((await face("photos").findByAltText("one.jpg")).closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: "one.jpg" });

    const stage = dialog.querySelector(".wb2-mvstage") as HTMLElement;
    const img = within(dialog).getByAltText("one.jpg") as HTMLImageElement;
    /* jsdom reports every box as 0, so the stage and the photo are given
       sizes by hand — the fit here is 800/1600 = 0.5. */
    Object.defineProperty(stage, "clientWidth", { value: 816, configurable: true });
    Object.defineProperty(stage, "clientHeight", { value: 616, configurable: true });
    Object.defineProperty(img, "naturalWidth", { value: 1600, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 1200, configurable: true });
    fireEvent.load(img);

    /* Wheel DOWN hard. The old floor was a 0.05 constant, so this landed the
       photo at a twentieth of its size in a sea of black. */
    for (let i = 0; i < 12; i++)
      fireEvent.wheel(stage, { deltaY: 240, ctrlKey: true, cancelable: true });

    /* At the floor the photo goes back to the CSS fit — no inline width, no
       scroll container with nothing to scroll. */
    expect(stage.className).not.toContain("zoomed");
    expect(img.style.width).toBe("");
  });

  it("zooms in from the fit, and comes back to it", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValue(
      files({ photos: [file({ remoteId: "p-1", name: "one.jpg", url: "https://signed/p-1.jpg" })] })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");
    await userEvent.click((await face("photos").findByAltText("one.jpg")).closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: "one.jpg" });

    const stage = dialog.querySelector(".wb2-mvstage") as HTMLElement;
    const img = within(dialog).getByAltText("one.jpg") as HTMLImageElement;
    Object.defineProperty(stage, "clientWidth", { value: 816, configurable: true });
    Object.defineProperty(stage, "clientHeight", { value: 616, configurable: true });
    Object.defineProperty(img, "naturalWidth", { value: 1600, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 1200, configurable: true });
    fireEvent.load(img);

    fireEvent.wheel(stage, { deltaY: -240, ctrlKey: true, cancelable: true });
    expect(stage.className).toContain("zoomed");
    /* Bigger than the fit's 0.5 × 1600 = 800px. */
    expect(parseFloat(img.style.width)).toBeGreaterThan(800);
  });

  it("keeps the strip out of the way when there is nothing to jump to", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(
      files({ photos: [file({ remoteId: "p-1", url: "https://signed/p-1.jpg" })] })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");
    await userEvent.click((await face("photos").findByAltText("IMG_4021.jpg")).closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: "IMG_4021.jpg" });
    expect(within(dialog).queryByRole("tablist")).toBeNull();
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

  const file = (over: Partial<JobMediaItem> & { remoteId: string }): JobMediaItem => ({
    name: "Photo",
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

  it("keeps asking while each round makes progress, then stops", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles
      .mockResolvedValueOnce({ ok: true, cached: 6, remaining: 6, media: null, note: null })
      .mockResolvedValueOnce({ ok: true, cached: 6, remaining: 0, media: null, note: null });

    render(<Job row={row()} {...props} />);
    await detailLanded();
    await waitFor(() => expect(cacheJobFiles).toHaveBeenCalledTimes(2));
  });

  /* ── and then reading them into the bank ── */

  /* OPENING A JOB IS WHAT INDEXES ITS PHOTOGRAPHS. The bank grows along the
     paths people actually walk — the same lazy rule that keeps the bucket at
     432MB against ~28GB of originals — rather than through a 32,443-photo
     backfill where four in five would never be searched. */
  it("reads the photos into the bank once the bytes have landed", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 0, media: null, note: null });
    readJobPhotos
      .mockResolvedValueOnce({ ok: true, read: 4, remaining: 4, note: null })
      .mockResolvedValueOnce({ ok: true, read: 4, remaining: 0, note: null });

    render(<Job row={row()} {...props} />);
    await detailLanded();
    /* Two BANK rounds. Counting every call would also count the dataplate
       upgrade pass that follows, which is a different question. */
    await waitFor(() =>
      expect(readJobPhotos.mock.calls.filter((c) => c[1] === undefined)).toHaveLength(2)
    );
    expect(readJobPhotos).toHaveBeenCalledWith(detail().remoteId);
  });

  /* THE DATAPLATES ARE READ AGAIN, PROPERLY, AND LAST. Haiku gets every
     subject right but garbles dense small print confidently — two shots of
     one outdoor unit gave `PUZ-M125VKA2-A` and `PUZ-M125VKA-A`. On ductwork
     that costs nothing; on a rating plate it costs the model number. */
  it("re-reads the dataplates after the bank, never before", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 0, media: null, note: null });
    const order: (string | undefined)[] = [];
    readJobPhotos.mockImplementation(async (...a: unknown[]) => {
      order.push(a[1] as string | undefined);
      return { ok: true, read: 1, remaining: 0, note: null };
    });

    render(<Job row={row()} {...props} />);
    await detailLanded();
    await waitFor(() => expect(order).toContain("upgrade"));
    /* The bank first: a photograph nobody has looked at must never wait
       behind one being looked at a second time. */
    expect(order.indexOf(undefined)).toBeLessThan(order.indexOf("upgrade"));
  });

  /* THE CAPS ARE A RUNAWAY GUARD, NOT A BUDGET — and at 12 rounds they were
     acting as one. Reading stopped at exactly 48 photographs on job #683,
     with the parent's 56 consuming the whole allowance, so the claim's 17
     needed a second visit and nothing said so. A real job has to finish in
     one open: the biggest in the account holds 223 files. */
  it("keeps reading past the old 48-photo ceiling", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 0, media: null, note: null });
    /* 60 rounds of four: 240 photographs, more than any live job. */
    let left = 240;
    readJobPhotos.mockImplementation(async () => {
      left = Math.max(0, left - 4);
      return { ok: true, read: 4, remaining: left, note: null };
    });

    render(<Job row={row()} {...props} />);
    await detailLanded();
    await waitFor(() => expect(left).toBe(0), { timeout: 5000 });
    /* 240 / 4 — comfortably past the twelve rounds that used to bind. */
    expect(readJobPhotos.mock.calls.length).toBeGreaterThan(12);
  });

  /* THE FALLING REMAINDER IS THE REAL BRAKE, and raising the cap must not
     have weakened it: a server that reports the same number twice cannot read
     what is in front of it, and going round again would only spend money. */
  it("still stops the moment the outstanding count stops falling", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 0, media: null, note: null });
    readJobPhotos.mockResolvedValue({ ok: true, read: 4, remaining: 40, note: null });

    render(<Job row={row()} {...props} />);
    await detailLanded();
    await waitFor(() => expect(readJobPhotos).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 300));
    /* The BANK pass only. The dataplate upgrade runs its own loop afterwards
       with its own brake, and counting both would test neither. */
    expect(readJobPhotos.mock.calls.filter((c) => c[1] === undefined).length).toBeLessThanOrEqual(2);
  });

  /* AND WHAT IS LEFT IS SAID OUT LOUD. Whatever stops the loop — the cap, a
     refusal, a count that will not fall — there is work outstanding, and the
     silence was the actual defect: a search would miss those photographs and
     look exactly as though they did not exist. */
  it("says how many photos are still to be read when the loop stops short", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValue(
      files({ photos: [file({ remoteId: "p-1", url: "https://signed/p-1.jpg" })] })
    );
    cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 0, media: null, note: null });
    readJobPhotos.mockResolvedValue({ ok: false, read: 0, remaining: 12, note: null });

    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");
    expect(
      await face("photos").findByText(/12 photos still to be read/)
    ).toBeInTheDocument();
  });

  /* A job wholly in the bank says nothing — a line reading "0 still to be
     read" is furniture. */
  it("says nothing when the whole job has been read", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValue(
      files({ photos: [file({ remoteId: "p-1", url: "https://signed/p-1.jpg" })] })
    );
    cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 0, media: null, note: null });
    readJobPhotos.mockResolvedValue({ ok: true, read: 1, remaining: 0, note: null });

    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Photos");
    await waitFor(() => expect(readJobPhotos).toHaveBeenCalled());
    expect(face("photos").queryByText(/still to be read/)).toBeNull();
  });

  /* READING NEVER RACES THE TILES. The caching loop is what somebody is
     watching for their photos to appear; a vision call is seconds and has no
     business inside it. */
  it("does not start reading until the caching has finished", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    let cacheDone = false;
    cacheJobFiles.mockImplementation(async () => {
      cacheDone = true;
      return { ok: true, cached: 0, remaining: 0, media: null, note: null };
    });
    let readAfterCache: boolean | null = null;
    readJobPhotos.mockImplementation(async () => {
      if (readAfterCache === null) readAfterCache = cacheDone;
      return { ok: true, read: 0, remaining: 0, note: null };
    });

    render(<Job row={row()} {...props} />);
    await detailLanded();
    await waitFor(() => expect(readJobPhotos).toHaveBeenCalled());
    expect(readAfterCache).toBe(true);
  });

  /* THE BRAKE, and it is about money. A server reporting the same outstanding
     count twice cannot read what is in front of it; going round again would
     spend without progressing. */
  it("stops reading the moment the outstanding count stops falling", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 0, media: null, note: null });
    readJobPhotos.mockResolvedValue({ ok: true, read: 1, remaining: 9, note: null });

    render(<Job row={row()} {...props} />);
    await detailLanded();
    await waitFor(() => expect(readJobPhotos).toHaveBeenCalled());
    /* One round that made no headway is enough — never a third. */
    await waitFor(() =>
      expect(readJobPhotos.mock.calls.filter((c) => c[1] === undefined).length).toBeLessThanOrEqual(2)
    );
  });


  it("stops immediately when a round caches nothing, even with work left", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobFiles.mockResolvedValueOnce(files());
    cacheJobFiles.mockResolvedValue({ ok: true, cached: 0, remaining: 20, media: null, note: null });

    render(<Job row={row()} {...props} />);
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

    render(<Job row={row()} {...props} />);
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
        takenBy: "Lyle Irving",
      },
    ],
  };

  it("shows the lines and their total to a reader who holds money", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ ledger }));
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await face("money").findByText("What went on the job")).toBeInTheDocument();
    expect(face("money").getByText("Daikin CTXM35RVMA")).toBeInTheDocument();
    expect(face("money").getByText("× 2")).toBeInTheDocument();
    expect(face("money").getByText("Total inc GST")).toBeInTheDocument();
  });

  it("shows what's been paid, naming a deposit as one", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record({ ledger }));
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    await face("money").findByText("Bank Transfer");
    expect(face("money").getByText(/deposit, Sat 1 Aug, Lyle Irving/)).toBeInTheDocument();
  });

  it("renders no ledger at all when the server sent none", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    readJobRecord.mockResolvedValueOnce(record());
    render(<Job row={row()} {...props} />);
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
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await face("money").findByText(/mix tax-inclusive and tax-exclusive/)).toBeInTheDocument();
    expect(face("money").queryByText(/^Total/)).toBeNull();
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
    render(<Job row={row()} {...props} moneyVisible />);
    await detailLanded();
    await openTab("Money");

    expect(await face("money").findByText(/aren't priced, so there's no total/)).toBeInTheDocument();
  });
});

/* ── OUR checklist — writable, two sections, stamped ticks ── */

describe("the job's materials", () => {
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
  const shelf = (name: string) => face("checklist").getByRole("region", { name });

  it("puts each row on the price book's shelf, in the book's order, a box each", async () => {
    listJobPicklist.mockResolvedValue([
      item({ id: "p2", name: "Isolator 20A", sub: "WPS120, Rexel", qty: "1", designId: null }),
      item(),
      item({ id: "p3", name: "Thing nobody can place", sub: "", qty: "", designId: null }),
    ]);
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Materials");

    expect(await face("checklist").findByText("Thing nobody can place")).toBeInTheDocument();
    expect(face("checklist").getByRole("heading", { name: "Materials", level: 3 })).toBeInTheDocument();
    /* no count line under the title, and no To do anywhere */
    expect(face("checklist").queryByText(/open, .* done/)).not.toBeInTheDocument();
    expect(face("checklist").queryByText("To do")).not.toBeInTheDocument();
    expect(face("checklist").getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "Units",
      "Electrical",
      "Miscellaneous",
      "From ServiceM8",
    ]);
    expect(within(shelf("Units")).getByText("MSZ-AP25VGD")).toBeInTheDocument();
    expect(within(shelf("Electrical")).getByText("Isolator 20A")).toBeInTheDocument();
    expect(within(shelf("Miscellaneous")).getByText("Thing nobody can place")).toBeInTheDocument();
  });

  it("draws a row on one line: the name, its line beside it, the quantity on the right", async () => {
    listJobPicklist.mockResolvedValue([item()]);
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Materials");

    const rowEl = (await face("checklist").findByText("MSZ-AP25VGD")).closest(".jm-row") as HTMLElement;
    expect(within(rowEl).getByText("wall mounted indoor")).toHaveClass("jm-sub");
    expect(rowEl.lastElementChild).toHaveClass("jm-qty");
    expect(rowEl.lastElementChild).toHaveTextContent("3");
  });

  it("a ticked row STAYS, greyed and stamped who and when", async () => {
    listJobPicklist.mockResolvedValue([
      item({
        id: "p3",
        name: "Isolate old unit",
        qty: "",
        designId: null,
        picked: true,
        /* a day gone by says the day */
        pickedAt: "2026-08-14T01:52:00.000Z",
        pickedBy: "Jake Thompson",
      }),
    ]);
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Materials");

    const rowEl = (await screen.findByText("Isolate old unit")).closest(".jm-row")!;
    expect(rowEl).toHaveClass("jm-row--done");
    expect(within(rowEl as HTMLElement).getByText("Jake Thompson, Fri 14 Aug")).toBeInTheDocument();
  });

  it("ticking saves, and shows immediately rather than waiting on the server", async () => {
    const user = userEvent.setup();
    setPicklistItemPicked.mockReturnValue(new Promise(() => {}));
    listJobPicklist.mockResolvedValue([item()]);
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Materials");

    const box = await screen.findByLabelText("Loaded: MSZ-AP25VGD");
    await user.click(box);
    expect(setPicklistItemPicked).toHaveBeenCalledWith("p1", true);
    expect(box).toBeChecked();
  });

  it("names who ticked it the moment it is ticked, to the minute on the day", async () => {
    /* WALK-FOUND: the optimistic flip cannot know the display name behind
       its own auth id, so the stamp read "9:11pm" with nobody's name until
       the card was reopened. The action returns the saved row now. */
    const user = userEvent.setup();
    listJobPicklist.mockResolvedValue([item({ id: "p1" })]);
    setPicklistItemPicked.mockResolvedValue(
      item({ id: "p1", picked: true, pickedAt: new Date().toISOString(), pickedBy: "Isaac Smith" })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Materials");

    await user.click(await screen.findByLabelText("Loaded: MSZ-AP25VGD"));
    const row_ = (await screen.findByText("MSZ-AP25VGD")).closest(".jm-row")!;
    await waitFor(() =>
      expect(within(row_ as HTMLElement).getByText(/^Isaac Smith, \d{1,2}:\d{2}(am|pm)$/)).toBeInTheDocument()
    );
  });

  it("puts the tick back when the save fails, and says so", async () => {
    const user = userEvent.setup();
    const onToast = jest.fn();
    setPicklistItemPicked.mockRejectedValue(new Error("nope"));
    listJobPicklist.mockResolvedValue([item()]);
    render(<Job row={row()} {...props} onToast={onToast} />);
    await detailLanded();
    await openTab("Materials");

    const box = await screen.findByLabelText("Loaded: MSZ-AP25VGD");
    await user.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(onToast).toHaveBeenCalledWith("Could not save that tick");
  });

  it("(F) a tick from a tab older than the deploy puts the tick back and says to reload", async () => {
    const user = userEvent.setup();
    const onToast = jest.fn();
    setPicklistItemPicked.mockRejectedValue(
      new UnrecognizedActionError('Server Action "7f00" was not found on the server.')
    );
    listJobPicklist.mockResolvedValue([item()]);
    render(<Job row={row()} {...props} onToast={onToast} />);
    await detailLanded();
    await openTab("Materials");

    const box = await screen.findByLabelText("Loaded: MSZ-AP25VGD");
    await user.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(onToast).toHaveBeenCalledWith(STALE_DEPLOY_WORDS);
    expect(onToast).not.toHaveBeenCalledWith("Could not save that tick");
  });

  it("types a material onto the list, with its quantity, and swaps in the saved one", async () => {
    const user = userEvent.setup();
    listJobPicklist.mockResolvedValue([]);
    addJobPicklistItem.mockResolvedValue(
      item({ id: "srv-1", name: "Linear bar grille", qty: "2", designId: null, addedBy: "Isaac Smith" })
    );
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Materials");

    /* one kind now: no To do / Material tray */
    expect(face("checklist").queryByRole("button", { name: "Material" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Add a material"), "Linear bar grille");
    await user.type(screen.getByLabelText("Quantity"), "2");
    await user.click(face("checklist").getByRole("button", { name: "Add" }));

    /* optimistic first: the row is on the list before the server answers */
    expect(screen.getByText("Linear bar grille")).toBeInTheDocument();
    await waitFor(() =>
      expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", {
        kind: "material",
        name: "Linear bar grille",
        qty: "2",
        sub: "",
      })
    );
  });

  it("takes the typed row back off the list when the save fails", async () => {
    const user = userEvent.setup();
    const onToast = jest.fn();
    listJobPicklist.mockResolvedValue([]);
    addJobPicklistItem.mockRejectedValue(new Error("offline"));
    render(<Job row={row()} {...props} onToast={onToast} />);
    await detailLanded();
    await openTab("Materials");

    await user.type(screen.getByLabelText("Add a material"), "Ghost row");
    await user.click(face("checklist").getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByText("Ghost row")).not.toBeInTheDocument());
    expect(onToast).toHaveBeenCalledWith("Could not add that row");
  });

  it("only a manager can remove a line, with a quiet Remove on the row", async () => {
    const user = userEvent.setup();
    listJobPicklist.mockResolvedValue([item()]);
    const { unmount } = render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Materials");
    expect(await screen.findByText("MSZ-AP25VGD")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove MSZ-AP25VGD" })).not.toBeInTheDocument();
    unmount();

    render(<Job row={row()} {...props} manage />);
    await detailLanded();
    await openTab("Materials");
    const remove = await screen.findByRole("button", { name: "Remove MSZ-AP25VGD" });
    expect(remove).toHaveTextContent("Remove");
    expect(remove).toHaveClass("pt-btn--quiet");
    await user.click(remove);
    await waitFor(() => expect(screen.queryByText("MSZ-AP25VGD")).not.toBeInTheDocument());
    expect(removePicklistItem).toHaveBeenCalledWith("p1");
  });

  it("a list that will not load never takes the page down", async () => {
    listJobPicklist.mockRejectedValue(new Error("offline"));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Materials");
    expect(await face("checklist").findByRole("region", { name: "From ServiceM8" })).toBeInTheDocument();
    expect(face("checklist").queryByRole("region", { name: "Units" })).not.toBeInTheDocument();
  });
});

/* ── compliance on the page, and sending what's ticked ── */

describe("compliance on the page", () => {
  const may = { company: true, staff: true, send: true };
  const pl: JobPaper = {
    id: "p1",
    kind: "company",
    name: "Public liability",
    person: null,
    issuer: "QBE",
    expiresOn: "2027-06-30",
    state: "ok",
    renewed: false,
    files: [{ id: "d1", fileName: "coc.pdf", mimeType: "application/pdf", sizeBytes: 1000, url: "https://signed/coc.pdf" }],
    addedBy: "Isaac Smith",
    addedAt: "2026-09-23T00:00:00Z",
    manage: true,
  };
  const draft: EmailDraft = {
    contacts: [{ name: "Josh", email: "josh@lsdb.com.au", role: "Property manager" }],
    subject: "Documents for job 3137",
    message: "Hi,\n\nPlease find our documents for this job attached.",
    ready: true,
  };

  beforeEach(() => {
    for (const fn of Object.values(compliance)) fn.mockClear();
    compliance.listJobPapers.mockResolvedValue({ papers: [pl], may });
    compliance.readEmailDraft.mockResolvedValue(draft);
  });

  it("files the business's papers under Compliance, and sends what's ticked from the page's own footer", async () => {
    const onToast = jest.fn();
    compliance.emailJobDocuments.mockResolvedValue({
      ok: true,
      to: ["josh@lsdb.com.au"],
      note: { id: "n-1", text: "Emailed Public liability to josh@lsdb.com.au.", at: "2026-09-23T02:00:00Z", author: "Isaac Smith" },
    });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} onToast={onToast} />);
    await detailLanded();
    await openTab("Compliance");

    expect(await face("compliance").findByText("Public liability")).toBeInTheDocument();
    expect(compliance.listJobPapers).toHaveBeenCalledWith("j-1");
    /* nothing ticked, no footer */
    expect(screen.queryByRole("button", { name: "Email documents" })).toBeNull();

    await userEvent.click(face("compliance").getByRole("checkbox", { name: "Select Public liability" }));
    const bar = screen.getByText("1 document ticked").closest(".wb2-shft") as HTMLElement;
    /* THE PAGE'S FOOTER, under the body — not inside it */
    expect(bar.parentElement).toHaveClass("wb2-sheet");
    /* no ServiceM8 door until an owner switches sending on */
    expect(within(bar).queryByRole("button", { name: "Send to ServiceM8" })).toBeNull();

    await userEvent.click(within(bar).getByRole("button", { name: "Email documents" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /Josh/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send email" }));
    expect(compliance.emailJobDocuments).toHaveBeenCalledWith({
      jobUuid: "j-1",
      keys: ["p:p1"],
      to: ["josh@lsdb.com.au"],
      subject: "Documents for job 3137",
      message: "Hi,\n\nPlease find our documents for this job attached.",
    });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Email sent to josh@lsdb.com.au"));
    /* sent: the ticks clear and the footer goes with them */
    expect(screen.queryByText("1 document ticked")).toBeNull();
    expect(face("compliance").getByRole("checkbox", { name: "Select Public liability" })).not.toBeChecked();

    /* and the conversation says what went, without a reload */
    await openTab("Diary");
    expect(await convo().findByText("Emailed Public liability to josh@lsdb.com.au.")).toBeInTheDocument();
  });

  it("adds papers from IN the face, and what was just added arrives ticked ready to send", async () => {
    compliance.listJobPapers.mockResolvedValueOnce({ papers: [], may }).mockResolvedValueOnce({ papers: [pl], may });
    compliance.readComplianceChoices.mockResolvedValue({
      company: [
        { key: "c:pl", kind: "company", name: "Public liability", person: null, issuer: "QBE", expiresOn: "2027-06-30", state: "ok", files: 1, booked: false, onJob: false },
      ],
      staff: null,
    });
    compliance.addJobPapers.mockResolvedValue({ ok: true, added: ["p1"] });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Compliance");

    await userEvent.click(await face("compliance").findByRole("button", { name: "Add compliance" }));
    const chooser = await face("compliance").findByRole("group", { name: "Add compliance" });
    await userEvent.click(await within(chooser).findByRole("checkbox", { name: /Public liability/ }));
    await userEvent.click(within(chooser).getByRole("button", { name: "Add to job" }));

    expect(compliance.addJobPapers).toHaveBeenCalledWith("j-1", ["c:pl"]);
    expect(await face("compliance").findByRole("checkbox", { name: "Select Public liability" })).toBeChecked();
    expect(screen.getByText("1 document ticked")).toBeInTheDocument();
    expect(face("compliance").queryByRole("group", { name: "Add compliance" })).toBeNull();
  });

  it("keeps compliance in its own section, and the files in theirs", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Compliance");
    expect(await face("compliance").findByText("Public liability")).toBeInTheDocument();
    expect(face("compliance").queryByRole("button", { name: "Upload a document" })).toBeNull();
    await openTab("Documents");
    expect(face("documents").queryByText("Public liability")).toBeNull();
    expect(face("documents").queryByRole("button", { name: "Add compliance" })).toBeNull();
  });

  it("keeps the footer to the face the ticks are on", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Compliance");
    await userEvent.click(await face("compliance").findByRole("checkbox", { name: "Select Public liability" }));
    expect(screen.getByText("1 document ticked")).toBeInTheDocument();
    await openTab("Summary");
    expect(screen.queryByText("1 document ticked")).toBeNull();
    await openTab("Compliance");
    expect(screen.getByText("1 document ticked")).toBeInTheDocument();
  });

  it("opens a paper in the page's own viewer", async () => {
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Compliance");
    await userEvent.click(await face("compliance").findByRole("button", { name: /Public liability/ }));
    expect(await screen.findByTitle("Public liability")).toHaveAttribute("src", "https://signed/coc.pdf");
  });

  /* ── the footer's other door ── */

  const sent = (documentId: string, status: "sent" | "failed", error: string | null = null) => ({
    documentId,
    status,
    error,
    attempts: 1,
    remoteUuid: `r-${documentId}`,
  });

  it("sends what's ticked to ServiceM8 where an owner switched it on, and the row says it's there", async () => {
    const onToast = jest.fn();
    sm8Send.readJobSm8.mockResolvedValue({ send: "live", sends: [], hold: null });
    sm8Send.sendJobDocumentsToServiceM8.mockResolvedValue({
      ok: true,
      trial: false,
      sent: ["p:p1"],
      waiting: [],
      failed: [],
      already: [],
      sends: [sent("d1", "sent")],
    });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} onToast={onToast} />);
    await detailLanded();
    await openTab("Compliance");

    await userEvent.click(await face("compliance").findByRole("checkbox", { name: "Select Public liability" }));
    const bar = screen.getByText("1 document ticked").closest(".wb2-shft") as HTMLElement;
    await userEvent.click(within(bar).getByRole("button", { name: "Send to ServiceM8" }));

    expect(sm8Send.sendJobDocumentsToServiceM8).toHaveBeenCalledWith({ jobUuid: "j-1", keys: ["p:p1"] });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Public liability sent to ServiceM8"));
    /* it went: the tick clears, the footer with it, and the row says so */
    expect(screen.queryByText("1 document ticked")).toBeNull();
    expect(face("compliance").getByText("In ServiceM8")).toBeInTheDocument();
  });

  it("keeps a file that didn't go ticked, and says why in the footer until the ticks change", async () => {
    sm8Send.readJobSm8.mockResolvedValue({ send: "live", sends: [], hold: null });
    sm8Send.sendJobDocumentsToServiceM8.mockResolvedValue({
      ok: true,
      trial: false,
      sent: [],
      waiting: [],
      failed: [{ key: "p:p1", error: "ServiceM8 said the file is too big." }],
      already: [],
      sends: [sent("d1", "failed", "ServiceM8 said the file is too big.")],
    });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Compliance");

    const tick = await face("compliance").findByRole("checkbox", { name: "Select Public liability" });
    await userEvent.click(tick);
    await userEvent.click(screen.getByRole("button", { name: "Send to ServiceM8" }));

    expect(
      await screen.findByText("Public liability wasn't sent. ServiceM8 said the file is too big.")
    ).toBeInTheDocument();
    expect(tick).toBeChecked();
    expect(face("compliance").getByText("Not sent to ServiceM8. ServiceM8 said the file is too big.")).toBeInTheDocument();

    await userEvent.click(tick);
    await userEvent.click(tick);
    expect(screen.queryByText(/wasn't sent/)).toBeNull();
    expect(screen.getByText("1 document ticked")).toBeInTheDocument();
  });

  it("says a file waiting behind a pause is held by it, not on its way", async () => {
    sm8Send.readJobSm8.mockResolvedValue({
      send: "live",
      sends: [{ documentId: "d1", status: "queued", error: null, attempts: 0, remoteUuid: "r-d1" }],
      hold: "paused",
    });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Compliance");
    expect(await face("compliance").findByText("Not in ServiceM8 yet. Sending is paused.")).toBeInTheDocument();
    expect(face("compliance").queryByText("Sending to ServiceM8…")).toBeNull();
  });

  /* The copy ServiceM8's mirror brings back is left off on the SERVER, by
     the uuid it was sent under (lib/integrations/sm8-echo, pinned in
     job-media-query.test) — the read the card gets never holds it, so the
     card draws exactly what it is handed. */
  it("shows a file we sent once, in the state it went: our row, saying so", async () => {
    const doc = (over: Partial<JobMediaItem> & { remoteId: string }): JobMediaItem => ({
      name: "CoC.pdf",
      fileType: ".pdf",
      kind: "document",
      origin: null,
      takenAt: "2026-09-23 10:40",
      url: "https://signed/coc.pdf",
      width: null,
      height: null,
      fromClaim: null,
      ...over,
    });
    compliance.listJobPapers.mockResolvedValue({ papers: [], may });
    sm8Send.readJobSm8.mockResolvedValue({ send: null, sends: [sent("d-9", "sent")], hold: null });
    readJobFiles.mockResolvedValue({
      photos: [],
      documents: [
        doc({ remoteId: "doc:d-9", documentId: "d-9", addedBy: "Isaac Smith" }),
        doc({ remoteId: "sm8-other", name: "Quote #3137", origin: "Quote" }),
      ],
      elsewhere: [],
      truncated: false,
    });
    readMirrorJob.mockResolvedValueOnce(card(detail()));
    render(<Job row={row()} {...props} />);
    await detailLanded();
    await openTab("Documents");

    expect(await face("documents").findByText("In ServiceM8")).toBeInTheDocument();
    expect(face("documents").getAllByText("CoC.pdf")).toHaveLength(1);
    expect(face("documents").getByText("Quote #3137")).toBeInTheDocument();
  });
});

