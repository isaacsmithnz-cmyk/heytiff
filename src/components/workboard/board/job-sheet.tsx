"use client";

import { projectHref } from "@/lib/shell/links";
import { Fragment, Suspense, lazy, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { Button } from "@/components/parts/button";
import type { MenuItem } from "@/components/parts/menu";
import { quoteStarted, type QuoteFacts } from "@/lib/quotes/quote-card";
import { fmtAuTime, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import {
  createProjectFromJob,
  readJobFiles,
  readJobRecord,
  readMirrorJob,
  type JobRecordRead,
} from "@/app/actions/workboard";
import {
  collectionAgainst,
  fmtQuantity,
  materialsTaxMixed,
  materialsTotalCents,
  paymentsTotalCents,
} from "@/lib/workboard/job-ledger";
import { claimFor, isPartialInvoiceLine } from "@/lib/workboard/job-family";
import { buildJobStory, storyStamp } from "@/lib/workboard/job-story";
import { JobClaimModal } from "./job-claim-modal";
import { JobMoneyBlock, JobMoneyGlance } from "./job-money-block";
import { cacheJobFiles } from "@/app/actions/workboard-media";
import { readJobPhotos } from "@/app/actions/photo-readings";
import {
  addJobPicklistItem,
  listJobPicklist,
  removePicklistItem,
  setPicklistItemPicked,
  type JobPicklistItem,
} from "@/app/actions/job-picklist";
import { JobChecklistFace } from "./job-checklist-face";
import { JobPhotosFace } from "./job-photos-face";
import { JobDocumentsFace } from "./job-documents-face";
import { JobQuoteCard } from "./job-quote-card";
import { JobVisitTasks, type VisitDay } from "./job-visit-tasks";
import { sm8QuoteOf } from "../quote/sm8-quote-of";
import { JobProgressLine } from "./job-progress-line";
import { JobCustomer } from "./job-customer";
import { JobCustomerDialog } from "./job-customer-dialog";
import { customerEditOffered } from "@/app/actions/job-customer";
import { setNoDeposit } from "@/app/actions/job-deposit";
import { checkIn, checkOut, readMyCheckIn, type MyCheckIn } from "@/app/actions/job-check-ins";
import { jobSteps, type StepKey } from "@/lib/workboard/job-steps";
import { SwmsWizard } from "@/components/swms/swms-wizard";
import { CertWizard } from "@/components/certs/cert-wizard";
import { CERT_TITLE } from "@/lib/certs/mechanical";
import { readComplianceChoices, readEmailDraft } from "@/app/actions/job-compliance";
import { ourDocumentSendKey, paperLabel, type JobPaper } from "@/lib/compliance/papers";
import { fileTypeForMime, type JobMediaItem } from "@/lib/workboard/job-media";
import { todayInAu } from "@/lib/au-dates";
import { JobMediaViewer } from "./job-media-viewer";
import { DocumentsSend } from "./documents-send";
import {
  listJobPhotoFavourites,
  setJobPhotoFavourite,
} from "@/app/actions/job-photo-favourites";
import { JobAttentionStrip } from "./job-attention-strip";
import { StateLine } from "./state-line";
import { useNoteScopeTarget } from "@/components/notes/note-context";
import { dismissJobNote, taskFromJobNote } from "@/app/actions/job-notes";
import { clearFlag } from "@/app/actions/workboard-notes";
import type { JobAttention } from "@/lib/workboard/job-attention";
import { mintPressId } from "@/lib/workboard/press-id";
import { thrownWords } from "@/lib/stale-deploy";
import { useNoteStatePoll } from "./use-note-poll";
import { useJobDiary } from "./use-job-diary";
import { hereSaid, useRecordPresence } from "@/components/records/use-record-presence";
import { useJobPapers } from "./use-job-papers";
import {
  clearLeftoverBooking,
  makeWorkOrder,
  readBookingStates,
  retryBooking,
  takeBackBooking,
  type BookingLineResult,
  type VerbLine,
  type VerbView,
} from "@/app/actions/booking-sm8";
import { BOOKING_WORDS, type BookingAct, type BookingState } from "@/lib/integrations/sm8-booking-plan";
import { BookingEntryLine, BookingStateLine, ClearConfirm, bookingsWaiting, leftoverWords } from "./book-in-panel";
import type { BookInSeed } from "@/components/making/book-in";
import { VisitForm, visitJobLabel } from "@/components/making/visit-form";
import type { BookedEntry, MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import {
  sm8TimeOf,
  type AllJobRow,
} from "@/lib/workboard/all-jobs";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
import { useHydrated } from "@/lib/use-hydrated";
import { JobPageHead } from "@/components/jobs/job-page-head";
import { JobOverview } from "@/components/jobs/job-overview";
import { jobHue } from "@/lib/workboard/job-hue";
import { SECTION_FACES, SECTION_LABEL, sectionOfFace, sectionsFor, stageWord, type JobSection } from "@/lib/jobs/job-sections";

/* One ServiceM8 job — a CARD OF TABS.

   The card writes to ServiceM8 only through a person's press: Send (files),
   notes, Book in, Undo and Clear. Each goes through the queue and its
   sender, which read ServiceM8 before anything goes; the card itself never
   writes the mirror, and offers no control that would lie. What it also
   offers is promotion — the Actions tab, last on purpose, where the ⋯ menu
   retired.

   THE CARD IS TABS (Isaac, 2026-08-28): the two-zone anatomy is dead. One
   card, eight faces — Summary · Diary · Money · Visits · Checklist ·
   Photos · Documents · Actions — wearing the workboard's own folder-tab
   chrome: `.wb2-vtabs / .wb2-vt / .wb2-vslide` borrowed VERBATIM, the way
   the Org and Me cards already do. Legal on a modal because the sheet IS
   its own card; nothing nests. The band above the tabs holds the identity
   and wears the JOB TYPE'S COLOUR as a wash — a fixed low alpha over the
   neutral, because ServiceM8's palette makes no contrast promise: the
   colour is atmosphere, never the ground text has to survive on. No counts
   on the tabs (Isaac's call); each face says its own counts inside.

   THE MONEY TAB IS THE GATE. Without `workboard_money` the tab is ABSENT —
   no lock icon, no greyed stub — because the server never sent what would
   have filled it. The tab set is otherwise FIXED from first paint: money
   and manage are known at open, so faces never pop in as reads land.

   PORTALS TO BODY and reuses `.wb2-sheet`. Both are load-bearing: a
   dashboard modal must portal (`.page.in`'s will-change breaks
   position:fixed), and reusing the class keeps the portal type-ramp and
   button restatements without a new CSS root to keep in step.

   OPENS ON WHAT THE ROW ALREADY KNEW, then fills in. Nothing jumps: the
   fields that fill in were absent, not wrong. */

/* THE ROUND CAPS ARE A RUNAWAY GUARD, NOT A BUDGET — and sized as a budget
   they quietly decided how much of a job got indexed.

   Both were 12. At six files a round that capped caching at 72 and reading at
   48, and the walk of job #683 hit both: its family holds 73 photos, caching
   stopped at 63 on the first open, and reading stopped at EXACTLY 48 with the
   parent's 56 consuming the whole allowance — so the claim's 17 photographs
   needed a second visit to be looked at, and NOTHING ON SCREEN SAID SO. Open
   a big job once and never return and its tail stays unsearchable forever.

   The real protection was never the count. It is the FALLING-REMAINDER brake
   below: a server that reports the same outstanding number twice cannot read
   what is in front of it, and the loop stops on the spot. These caps only
   have to be larger than any real job — the biggest in the live account holds
   223 files — so that they never decide anything, and the brake does.

   A job that still exceeds them says so on the face rather than stopping in
   silence. */
const MAX_CACHE_ROUNDS = 60;
const MAX_READ_ROUNDS = 70;

/** A visit's length in the words the crew use (Isaac, 2026-10-02: a visit
    can be a full day or "a 20-minute pop-in"), by the hours each person who
    recorded time spent there. A day nobody's time can be believed has none. */
export function visitLength(v: { minutes: number; crew: { leftOpen?: true }[] }): string {
  const counted = v.crew.filter((c) => !c.leftOpen).length;
  if (v.minutes <= 0 || counted === 0) return "";
  const each = v.minutes / counted;
  return each >= 300 ? "Full day" : each >= 120 ? "Half day" : "Pop-in";
}

/** The card's faces. A door that knows which face it wants opens on it
    with `initialTab`. */
export type JobSheetTab =
  | "summary"
  | "diary"
  | "quote"
  | "money"
  | "visits"
  | "checklist"
  | "photos"
  | "documents"
  | "compliance";
type TabKey = JobSheetTab;

/** A face's name, for the faces a step opens rather than the rail. */
const FACE_NAME: Record<TabKey, string> = {
  summary: "Summary",
  diary: "Timeline",
  quote: "Quote",
  money: "Billing",
  visits: "Visits",
  checklist: "Checklist",
  photos: "Photos",
  documents: "Files",
  compliance: "Compliance",
};

/** Paper HeyTiff writes, as a page the card's viewer can hold: a SWMS or a
    certificate version, the printable document with its own Print button
    and its own version (a certificate's PDF printed at issue is on the job
    too). */
const paperPage = (remoteId: string, name: string, url: string): JobMediaItem => ({
  remoteId,
  name,
  /* the viewer frames paper by its type; the document is a page, framed the same way */
  fileType: "pdf",
  kind: "document",
  origin: null,
  takenAt: null,
  url,
  width: null,
  height: null,
  fromClaim: null,
});
const swmsPaper = (versionId: string) => paperPage(`swms:${versionId}`, "Safe Work Method Statement", `/swms/${versionId}`);
const certPaper = (versionId: string) => paperPage(`cert:${versionId}`, CERT_TITLE, `/certificates/${versionId}`);

/** A paper's files as pages the card's viewer can hold — a licence's two
    sides are two stops on its arrow keys. Only what this viewer may open. */
const paperPages = (paper: JobPaper): JobMediaItem[] =>
  paper.files
    .filter((f) => f.url)
    .map((f) => ({
      remoteId: `paper:${paper.id}:${f.id}`,
      name: paperLabel(paper),
      fileType: fileTypeForMime(f.mimeType),
      kind: "document" as const,
      origin: null,
      takenAt: null,
      url: f.url,
      width: null,
      height: null,
      fromClaim: null,
    }));

/** Jobs ServiceM8 has closed out — the same two the bell and the card's
    sign-on door already stand down for. */
const SWMS_CLOSED = new Set(["Completed", "Unsuccessful"]);

/* ADD › COST (rule 54) opens Claim an expense over the job as "Add a cost"
   (components/making/expense-form): a job's cost is an expense claim. Loaded
   when it is first asked for, as the form's readers and actions are its own. */
const ExpenseForm = lazy(() => import("@/components/making/expense-form").then((m) => ({ default: m.ExpenseForm })));

/** Where a quote is made, as the Quote section's own link goes: a quote
    not started yet starts with Tiff. */
const quotePage = (job: string, started: boolean) =>
  `/dashboard/workboard/quotes/${encodeURIComponent(job)}${started ? "" : "?start=1"}`;

const dayOf = (naive: string | null | undefined) =>
  naive && naive.length >= 10 ? naive.slice(0, 10) : null;


/** "7:30am Thu 14 Aug", or "7:30am–3:30pm Thu 14 Aug" when the booking's end
    is known and lands on the same day. The time itself is the shared
    `sm8TimeOf` — the project card's day window says it the same way. */
function bookingLabel(naive: string, end?: string | null): string {
  const date = dayOf(naive);
  const time = sm8TimeOf(naive);
  if (!date || !time) return date ? fmtAuWeekdayDayMonth(date) : naive;
  const endTime = end && dayOf(end) === date ? sm8TimeOf(end) : null;
  return `${endTime ? `${time}–${endTime}` : time} ${fmtAuWeekdayDayMonth(date)}`;
}

/** A dialable href, or null when the field isn't one number.

    SERVICEM8'S PHONE FIELD IS FREE TEXT. Stripping everything that isn't a
    digit assumes it holds exactly one number, so "0412 345 678 / 9999 a/h"
    becomes tel:04123456789999 — a number that is nobody's, offered as if it
    were the contact's. */
export function telHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const bare = raw.replace(/[\s()\-.]/g, "");
  return /^\+?\d{6,15}$/.test(bare) ? `tel:${bare}` : null;
}

/* The band's wash lives in lib/workboard/card-tint.ts — the dress has three
   wearers now, and importing a sheet for a pure helper drags its server
   actions into every jsdom suite that renders the borrower. */

/** THE JOB AS A PAGE (v2, step 5): the card's own faces, under the page's
    head instead of the card's band and rail. The page holds which section
    is open (its `?tab=`); a door inside the card that moves to a face moves
    the page to that face's section. */
export type JobSheetPage = {
  section: JobSection;
  onSection: (section: JobSection) => void;
  /** what the page itself does to the job, in Actions after its stage: pin
      it, copy the link (rule 53) */
  actions: readonly MenuItem[];
  onAction: (key: string) => void;
  /** Arrived from Documents' Make a document (`?add=`): do what Add › SWMS
      or Add › Certificate does, once the job's papers are read. */
  add?: "swms" | "certificate" | null;
};

export function JobSheet({
  row,
  manage,
  moneyVisible,
  initialTab,
  onCreateAgreement,
  onOpenTracked,
  onToast,
  page,
}: {
  /** The job's own page: its head, the section's faces under it (the
      card over the screen went on 24 October 2026). */
  page: JobSheetPage;
  row: AllJobRow;
  manage: boolean;
  moneyVisible: boolean;
  /** The face to open on, for a door that knows what it came for — a
      mention opens the job's Diary. Summary otherwise, and Summary for Money
      without the grant, because that face is absent. */
  initialTab?: JobSheetTab;
  /** Hands this job to the existing new-agreement modal, prefilled. */
  onCreateAgreement: (row: AllJobRow, detail: MirrorJobDetail | null) => void;
  /** Follows the tracked chip to the board that already holds this job. */
  onOpenTracked: (tracked: NonNullable<AllJobRow["tracked"]>) => void;
  /** A few words, and an Undo where what was done can be put back. */
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<MirrorJobDetail | null>(null);
  /* The job's files AS READ. What the faces show is `media`, below: this,
     less ServiceM8's copies of files we sent that our own rows show. */
  const [mediaRead, setMedia] = useState<JobMediaGroupsRead | null>(null);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  /* Photos cached but not yet looked at. Null until a read reports; 0 once the
     job is fully in the bank. */
  const [photosUnread, setPhotosUnread] = useState<number | null>(null);
  /* UNDEFINED until the record read lands, null when it lands empty. The
     distinction is load-bearing for the money block: a job ServiceM8 bills
     across three cards reads as $6,268 until the family arrives and $31,340
     after, and painting the wrong number first breaks this sheet's own rule
     that what fills in was ABSENT, not wrong. */
  const [record, setRecord] = useState<JobRecordRead | null | undefined>(undefined);
  const [recordFailed, setRecordFailed] = useState(false);
  const [picklist, setPicklist] = useState<JobPicklistItem[] | null>(null);
  /* bumped when the Quote section's Rooms adds a pair, so the Materials
     list and the Price read it again */
  /* WHICH OF THIS JOB'S PHOTOS ARE STARRED. Its own read on its own clock,
     like the files — a set of attachment ids, because that is the only
     question the card asks of it. Null until it lands: an empty Set would
     draw every star hollow for a moment on a job whose photos are all
     starred, which is the picture being wrong rather than absent. */
  const [favourites, setFavourites] = useState<Set<string> | null>(null);
  /* OUR OWN WRITING, and what the job still wants — both arrive on the
     record read and both are then LOCAL, because a note typed at the diary's
     head and a suggestion just answered have to leave the screen at once.
     Seeded from the read rather than derived from it for exactly that
     reason: derived state can't be edited. */
  const [attention, setAttention] = useState<JobAttention | null>(null);
  /* the note the strip's Reply sent the reader to, by its ServiceM8 uuid */
  const [replyFor, setReplyFor] = useState<string | null>(null);
  /* BOOKINGS TO SERVICEM8 (two-way phase 3), seeded from the record read
     and then local, the notes' way: every press on the job as a verb, the
     line on each standing booking of ours (by lower-case uuid), the job's
     bookings we took out, and the rows a Book in queued that no read has
     shown yet — the poll runs while any of them waits. All empty where the
     deployment books nothing. */
  const [bkVerbs, setBkVerbs] = useState<VerbView[]>([]);
  const [bkLines, setBkLines] = useState<Record<string, BookingState>>({});
  const [bkGone, setBkGone] = useState<ReadonlySet<string>>(() => new Set());
  const [bkPending, setBkPending] = useState<ReadonlySet<string>>(() => new Set());
  const [bkKick, setBkKick] = useState(0);
  /* the Visit form (Book in), keyed so a Look again opens a fresh one */
  const [bookIn, setBookIn] = useState<{ n: number; seed: BookInSeed | null } | null>(null);
  /* the leftover whose Clear is being asked, by lower-case uuid */
  const [clearAsk, setClearAsk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /* THE STEP whose part is open below, when the progress line opened it;
     null otherwise. A door that came back from the quote page opens
     on Quoted. */
  const [step, setStep] = useState<StepKey | null>(() =>
    initialTab === "quote" ? "quoted" : null
  );
  const [naming, setNaming] = useState(false);
  /* EDIT CUSTOMER (customer details to ServiceM8): offered only where the
     deployment saves them, the reader runs the board and the owner has them
     on — asked once, for a manager, and never anywhere else */
  const [customerEdit, setCustomerEdit] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  /* WHERE THE READER IS CHECKED IN, if anywhere — undefined until read */
  const [mine, setMine] = useState<MyCheckIn | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  /* The claim this card was opened FOR, when a clone's row was clicked. It
     names the row in the ledger — the card is always the job. */
  const [focus, setFocus] = useState<string | null>(null);
  /* Which claim's modal is open, and whether the number's list is showing. */
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  /* ADD (rule 54): what belongs to the job, each item a door to the flow the
     card already has for it. `taskAsk` is bumped by Add > Task, which opens
     the Visits face's own Add a task. */
  const [taskAsk, setTaskAsk] = useState(0);
  /* Add › Cost's form, open over the job */
  const [costing, setCosting] = useState(false);
  /* WHERE THE QUOTE STANDS, for Add's Quote, which reads Variation once a
     quote is accepted: the Quote section's own read, asked the first time
     the reader reaches for Add. Undefined until it lands, null when it
     failed, and then Quote opens the Quote section, which says it. */
  const [quoteFacts, setQuoteFacts] = useState<QuoteFacts | null | undefined>(undefined);
  const quoteAsked = useRef<string | null>(null);
  /* THE SWMS WIZARD when it is open — a new one, or the next version of one
     (`revise` names the version it replaces) — and the certificates' —
     `reissue` the same. What they write is the papers' (use-job-papers). */
  const [swmsWizard, setSwmsWizard] = useState<{ revise: string | null } | null>(null);
  const [certWizard, setCertWizard] = useState<{ reissue: string | null } | null>(null);
  /* ONE ROW PER FILE. A file we sent comes back as ServiceM8's own once the
     next sync mirrors it; the server leaves that copy off every face and the
     story (lib/integrations/sm8-echo), by the uuid we sent it under. */
  const media = mediaRead;
  /* The shared viewer: a photo (by its place in the photos lens) or one
     PDF's paper. Closing it lands the reader exactly where they were. */
  const [viewer, setViewer] = useState<
    | { kind: "photos"; id: string }
    | { kind: "paper"; id: string }
    /* a SWMS or a certificate is paper HeyTiff writes, so it opens in the
       same viewer as the job's other paper instead of a new tab that loses
       the card */
    | { kind: "page"; item: JobMediaItem }
    /* a licence or certificate on the job — its pages, by where the arrows are */
    | { kind: "papers"; id: string; index: number }
    | null
  >(null);
  const [name, setName] = useState("");
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    /* Set on the way IN, not only initialised: Strict Mode mounts, cleans
       up and mounts again, and a ref survives that round trip — without
       this line the second mount inherited `false` and the summary refresh
       threw its own answer away. */
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* No setLoading(true) here: the sheet is KEYED BY JOB, so a different job
     is a different component with `loading` already true. */
  useEffect(() => {
    let live = true;
    void readMirrorJob(row.id).then((res) => {
      if (!live) return;
      setDetail(res.detail);
      setFocus(res.focusRemoteId);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [row.id]);

  useEffect(() => {
    if (!manage) return;
    let live = true;
    void customerEditOffered()
      .then((on) => live && setCustomerEdit(on))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [manage]);

  useEffect(() => {
    let live = true;
    void readMyCheckIn()
      .then((m) => live && setMine(m))
      .catch(() => live && setMine(null));
    return () => {
      live = false;
    };
  }, []);

  /* THE COMPANION READS FOLLOW THE CARD, not the row that was clicked. A
     clone's row opens its parent, so asking for the clone's files, ledger or
     picklist would fetch a different job's answers into this card. */
  const cardId = detail?.remoteId ?? null;

  /* WHO ELSE HAS THIS JOB OPEN (use-record-presence), and word when one of
     them writes in its diary, which this card then reads again. Says
     nothing where the deployment has live records off. */
  const live = useRecordPresence(cardId ? { kind: "job", id: cardId } : null);
  const here = hereSaid(live.others);

  /* THE DIARY'S OWN STATE AND DOORS (use-job-diary): our notes, who the
     viewer sends to ServiceM8 as, the flags' lines, and every press on
     them. Seeded from the record read below, then local. */
  const {
    ourNotes,
    setOurNotes,
    sender,
    setSender,
    flags,
    setFlags,
    flagsBusy,
    notesSm8,
    writeNote,
    unwriteNote,
    replyNote,
    sendCopy,
    takeBack,
    markDone,
    undoDone,
    confirmLink,
  } = useJobDiary({
    cardId,
    record,
    onToast,
    setAttention,
    dropAttention: (key) => dropAttention(key),
    reloadRecord: () => void reloadRecord(),
    onWrote: () => live.announce("diary"),
  });

  /* THE JOB'S PAPERS AND WHAT GOES OUT (use-job-papers): its SWMS, its
     certificates, the business's papers on it, its files, what is ticked to
     send, and the two doors out — the email and ServiceM8. */
  const {
    swms,
    swmsFailed,
    certs,
    certsFailed,
    papers,
    papersFailed,
    picked,
    writing,
    setWriting,
    sm8Read,
    sm8Note,
    uploadDocument,
    removeDocument,
    removeCertificate,
    reloadSwms,
    tick,
    addPapers,
    removePaper,
    renewPaper,
    pickedList,
    sendDocuments,
    sendKeysToServiceM8,
    sendToServiceM8,
    certIssued,
    certSettled,
  } = useJobPapers({
    cardId,
    media: mediaRead,
    setMedia,
    onToast,
    onNoteSent: (note) => setOurNotes((cur) => [note, ...(cur ?? [])]),
  });

  useEffect(() => {
    if (!cardId) return;
    let live = true;
    void readJobFiles(cardId)
      .then((m) => {
        if (live) setMedia(m);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cardId]);

  /* The stars on this job's photos. Ours, not ServiceM8's — see
     docs/migrations/job_photo_favourites.sql. A read that fails leaves the
     set EMPTY rather than null: the stars go hollow, which is honest, and
     the tiles stay clickable. */
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    void listJobPhotoFavourites(cardId)
      .then((rows) => {
        if (live) setFavourites(new Set(rows.map((r) => r.remoteId)));
      })
      .catch(() => {
        if (live) setFavourites(new Set());
      });
    return () => {
      live = false;
    };
  }, [cardId]);

  /* After Issue, Email to the builder: the card's own letter, with the PDF
     ticked, whose draft starts with the job's contact — the builder. */
  const emailCertificate = async (documentId: string) => {
    /* the letter names what the face holds, so the PDF must be on it first */
    await certSettled();
    if (!alive.current) return;
    setCertWizard(null);
    go("documents");
    tick(ourDocumentSendKey(documentId), true);
    setWriting(true);
  };

  /* After Issue, Send to ServiceM8: this one file, through the card's own door. */
  const sendCertificateToSm8 = async (documentId: string, fileName: string) => {
    await certSettled();
    if (!alive.current) return;
    setCertWizard(null);
    go("documents");
    await sendKeysToServiceM8([ourDocumentSendKey(documentId)], () => fileName);
  };

  /* Our OWN material picklist — pushed here from a Studio design. On its own
     clock like the files; a job with none renders nothing. */
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    void listJobPicklist(cardId)
      .then((p) => {
        if (live) setPicklist(p);
      })
      .catch(() => {
        /* a picklist that won't load must not take the sheet down with it */
        if (live) setPicklist([]);
      });
    return () => {
      live = false;
    };
  }, [cardId]);

  /* Notes and the ledger, on their own clock like the files. `ledger` comes
     back null for a reader without money — the gate is server-side, so this
     component never has numbers it must remember to hide.
     A REJECTION IS ITS OWN ANSWER: a rejected read is recorded as a failure
     and the money face says the figures didn't load — never the netted
     fallback, which is the exact number this feature exists to stop. */
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    void readJobRecord(cardId)
      .then((r) => {
        if (!live) return;
        setRecord(r);
        setOurNotes(r?.ourNotes ?? []);
        setAttention(r?.attention ?? null);
        setSender(r?.sender ?? null);
        setFlags(r?.flags ?? {});
        setBkVerbs(r?.bookings?.verbs ?? []);
        setBkLines(r?.bookings?.lines ?? {});
      })
      .catch(() => {
        if (live) setRecordFailed(true);
      });
    return () => {
      live = false;
    };
  }, [cardId, setOurNotes, setSender, setFlags]);

  /* Bringing the bytes across, a few per round, with the BROWSER as the loop.
     Two rails: a hard round cap, and STOP ON NO PROGRESS.

     AND THEN READING WHAT LANDED. Opening a job is what puts its photographs
     in the searchable bank — the same lazy rule that keeps the bucket at
     432MB instead of 28GB, applied to the index. Deliberately AFTER the
     caching drains rather than inside it: this loop is what a reader is
     waiting on for their tiles to appear, and a vision call is seconds. The
     reading is nobody's foreground.

     PAID FOR ONCE. `job_photo_readings` is unique per photo, so a job opened
     twenty times is read once. Nothing is spent on a job nobody opens. */
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    let rounds = 0;
    const pump = async () => {
      while (live && rounds < MAX_CACHE_ROUNDS) {
        rounds += 1;
        const res = await cacheJobFiles(cardId);
        if (!live) return;
        if (res.media) setMedia(res.media);
        if (res.note) setMediaNote(res.note);
        if (!res.ok || res.cached === 0 || res.remaining === 0) break;
      }
      /* Same brake as every other loop here: the outstanding count must FALL
         or this stops. A server reporting the same number twice cannot read
         what is in front of it, and going round again would only spend. */
      let last = Number.POSITIVE_INFINITY;
      for (let round = 0; live && round < MAX_READ_ROUNDS; round++) {
        const res = await readJobPhotos(cardId);
        if (!live) return;
        /* WHAT IS LEFT IS SAID OUT LOUD. The loop can stop for three honest
           reasons — the cap, a refusal, or a count that would not fall — and
           in every one of them there is work outstanding that the next open
           will pick up. Reporting it is the difference between "this job is
           indexed" and "this job is indexed as far as anyone bothered". */
        setPhotosUnread(res.remaining);
        if (!res.ok || res.read === 0 || res.remaining >= last) break;
        last = res.remaining;
        if (res.remaining === 0) break;
      }

      /* AND THEN THE DATAPLATES, AGAIN, PROPERLY. The cheap model reads every
         photograph well enough to find it, but it garbles dense small print
         confidently — `AS/NZS 4755 SELV DC Power DRM1` came back as
         `ASICS 4793 BBV L2 DUNet 90` off the same plate Opus read correctly.
         On ductwork that costs nothing. A dataplate is small print end to
         end, and a confidently wrong serial is worse than a missing one.
         (An earlier version of this comment blamed a garbled MODEL number;
         see photo-readings.ts — that turned out to be two different units.)

         LAST, and deliberately: it is the only pass that re-reads work
         already done, so it must never delay a photograph that has not been
         looked at at all. Rare enough to afford — 5.7% of the bank. */
      let plates = Number.POSITIVE_INFINITY;
      for (let round = 0; live && round < MAX_READ_ROUNDS; round++) {
        const res = await readJobPhotos(cardId, "upgrade");
        if (!live) return;
        if (!res.ok || res.read === 0 || res.remaining >= plates) break;
        plates = res.remaining;
        if (res.remaining === 0) break;
      }
    };
    void pump();
    return () => {
      live = false;
    };
  }, [cardId]);

  const money = moneyVisible ? (detail?.money ?? null) : null;
  const materials = (record?.ledger?.materials ?? []).filter((m) => !isPartialInvoiceLine(m));
  const family = record?.family ?? null;
  /* NO DEPOSIT, ticked on Billing: the press's answer stands over the
     record's until the record is read again */
  const [depositTick, setDepositTick] = useState<{ card: string; on: boolean } | null>(null);
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const noDeposit = depositTick && depositTick.card === cardId ? depositTick.on : record?.noDeposit === true;
  const tickNoDeposit = async (on: boolean) => {
    if (!cardId) return;
    setDepositBusy(true);
    setDepositError(null);
    const a = await setNoDeposit(cardId, on).catch(() => ({ ok: false as const, error: "That didn't save. Try again." }));
    setDepositBusy(false);
    if (a.ok) setDepositTick({ card: cardId, on: a.noDeposit });
    else setDepositError(a.error);
  };
  const steps = useMemo(
    () =>
      jobSteps(
        {
          status: detail?.status ?? null,
          date: detail?.date ?? null,
          quoteSentOn: detail?.quoteSentOn ?? null,
          workOrderDate: detail?.workOrderDate ?? null,
          completionDate: detail?.completionDate ?? null,
          visitDays: (detail?.visits ?? []).map((v) => v.day),
          nextBookingDay: detail?.nextBooking?.start.slice(0, 10) ?? null,
          materials: picklist
            ? (() => {
                const m = picklist.filter((p) => p.kind === "material");
                return { total: m.length, in: m.filter((p) => p.picked).length };
              })()
            : null,
          family,
          noDeposit,
          leftover: (detail?.booked ?? []).some((b) => b.leftover),
        },
        moneyVisible
      ),
    [detail, picklist, family, noDeposit, moneyVisible]
  );
  /* The card's own number — the PARENT's, even when a claim's row opened it. */
  const cardNumber = detail?.jobNumber ?? row.number ?? null;
  /* Every header fact follows the CARD once the detail lands; until then the
     row's own facts paint, which is what was clicked. */
  const cardStatus = detail?.status ?? row.statusLabel;
  const openClaimRow = claimFor(family, openClaim);

  /* THE OPEN-JOB RULE MOVED TO THE SERVER with the rest of the strip.
     ServiceM8's "action required" is a bookmark somebody left on a note and
     nobody ever clears it — closing the job is how it clears — so on a
     Completed job it is history and the diary's own chip keeps it there.
     `readJobRecord` decides that now, beside the flags and the tasks, which
     is why this component no longer counts anything itself.

     Set by an attention row, cleared the moment the reader picks a tab
     themselves: the diary lights its flagged notes and scrolls to the
     first, and after that it is just the diary again. */
  const [flagFocus, setFlagFocus] = useState(false);

  /* THE JOB IS A CAPTURE SCOPE. Every other sheet on this board has been one
     since the token was rebuilt; the job card could not be, because
     `NoteTarget` had no "job" kind — a note dictated with this card open
     landed on nothing in particular. It does now, and it lands in the diary.

     Pushed against the CARD's id, not the row's: a clone opens its parent,
     and a note about the work belongs to the job, never to one of its
     invoices. Null until the detail lands, which the scope reads as "not
     aimed yet" rather than as a target. */
  useNoteScopeTarget(
    { kind: "job", id: cardId },
    cardNumber
      ? `#${cardNumber}${detail?.clientName ?? row.clientName ? ` — ${detail?.clientName ?? row.clientName}` : ""}`
      : undefined
  );

  /* The dialogs portal to <body> only once the page has hydrated; and the
     door back to ServiceM8. */
  const hydrated = useHydrated();
  const sm8Href = sm8JobUrl(cardId ?? row.id);
  const categoryColour = detail?.categoryColour ?? row.categoryColour ?? null;

  /* THE STORY — one merge of everything the sheet holds, built here and
     read by two faces (the diary renders it; the summary's staleness check
     stamps it). Pieces land on their own clocks and the memo re-merges. */
  const story = useMemo(
    () =>
      buildJobStory({
        detail: detail
          ? {
              date: detail.date,
              quoteDate: detail.quoteDate,
              quoteSentOn: detail.quoteSentOn ?? null,
              workOrderDate: detail.workOrderDate,
              completionDate: detail.completionDate,
              visits: detail.visits,
              booked: detail.booked,
              checklist: detail.checklist,
              designs: detail.designs,
            }
          : null,
        notes: record?.notes ?? null,
        ourNotes,
        ledger: record?.ledger ?? null,
        family,
        invoicedOn: family?.isFamily ? null : (money?.invoicedOn ?? null),
        media: media ? [...media.photos, ...media.documents, ...media.elsewhere] : null,
        picklist,
        timezone: detail?.timezone ?? null,
      }),
    [detail, record, ourNotes, family, money, media, picklist]
  );

  /* THE REFRESH KICK — once, after every read has landed, and only when the
     story's stamp has left the stored summary behind: the route re-derives
     it and stores it, for the page's Where it's up to. The route re-compares
     server-side, so a confused client costs queries, never a second model
     call. */
  const kicked = useRef(false);
  useEffect(() => {
    if (kicked.current) return;
    if (!cardId || !detail || record === undefined || record === null || recordFailed) return;
    if (media === null || picklist === null) return;
    const stamp = storyStamp(story);
    if (!stamp) return;
    if (record.summary?.stamp === stamp) return;
    kicked.current = true;
    void fetch("/api/workboard/job-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job: cardId }),
    })
      .catch(() => {
        /* a summary that won't refresh keeps its stored words */
      });
  }, [cardId, detail, record, recordFailed, media, picklist, story]);

  const makeProject = () => {
    setErr(null);
    start(async () => {
      const res = await createProjectFromJob(cardId ?? row.id, {
        name: name.trim() || row.clientName || undefined,
        clientName: row.clientName ?? undefined,
        siteLabel: row.suburb ?? undefined,
        siteAddress: detail?.address ?? undefined,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      onToast("Project created from this job");
      if (res.id) router.push(projectHref(res.id));
    });
  };

  /* Checklist writes, optimistic — a crew ticking down a list must not wait
     on a round trip per line. Reverted with a toast on failure. */
  const tickChecklistItem = (id: string, next: boolean) => {
    const stamp = next ? new Date().toISOString() : null;
    setPicklist((cur) =>
      (cur ?? []).map((p) =>
        p.id === id
          ? { ...p, picked: next, pickedAt: stamp, pickedBy: next ? p.pickedBy : null }
          : p
      )
    );
    void setPicklistItemPicked(id, next)
      .then((saved) => {
        /* The SAVED row carries the resolved display name — the client can
           flip a checkbox but cannot know the name behind its own auth id,
           and "who ticked it" is the stamp's whole point. */
        if (saved) setPicklist((cur) => (cur ?? []).map((p) => (p.id === id ? saved : p)));
      })
      .catch((e: unknown) => {
        setPicklist((cur) =>
          (cur ?? []).map((p) =>
            p.id === id ? { ...p, picked: !next, pickedAt: null, pickedBy: null } : p
          )
        );
        onToast(thrownWords(e, "Could not save that tick"));
      });
  };

  /* THE STRIP'S ANSWERS. Every one of them takes the row off the strip
     first and asks the server second — the strip is about what is still
     open, and a row you have just dealt with is not. A failure puts it back
     with a toast, the same law the checklist's ticks follow. */
  const dropAttention = (key: string) =>
    setAttention((cur) =>
      cur ? { items: cur.items.filter((i) => i.key !== key), total: Math.max(0, cur.total - 1) } : cur
    );

  const clearJobFlag = (id: string) => {
    const before = attention;
    dropAttention(`flag:${id}`);
    void clearFlag(id).then((res) => {
      if (res.ok) return;
      setAttention(before);
      onToast(res.error);
    });
  };

  const answerNote = (noteUuid: string) => {
    if (!cardId) return;
    const before = attention;
    dropAttention(`mention:${noteUuid}`);
    void dismissJobNote(cardId, noteUuid).catch((e: unknown) => {
      setAttention(before);
      onToast(thrownWords(e, "Could not put that aside"));
    });
  };

  const makeTaskFromNote = (input: {
    noteUuid: string;
    title: string;
    assigneeId: string;
    dueDate: string | null;
  }) => {
    if (!cardId) return;
    const before = attention;
    dropAttention(`mention:${input.noteUuid}`);
    void taskFromJobNote({ jobUuid: cardId, ...input })
      .then((res) => {
        if (res.ok) {
          onToast("Task saved");
          return;
        }
        setAttention(before);
        onToast(res.error);
      })
      .catch((e: unknown) => {
        setAttention(before);
        onToast(thrownWords(e, "Could not save that task"));
      });
  };

  /** The whole record again — after a flag somebody changed in ServiceM8. */
  const reloadRecord = async () => {
    if (!cardId) return;
    const r = await readJobRecord(cardId).catch(() => null);
    if (!r || !alive.current) return;
    setRecord(r);
    setOurNotes(r.ourNotes);
    setAttention(r.attention);
    setSender(r.sender ?? null);
    setFlags(r.flags ?? {});
    setBkVerbs(r.bookings?.verbs ?? []);
    setBkLines(r.bookings?.lines ?? {});
  };

  /* A diary written in by someone else with the card open: read it again. */
  const diaryHeard = live.heard?.what === "diary" ? live.heard.n : 0;
  const readAgain = useEffectEvent(() => void reloadRecord());
  useEffect(() => {
    if (diaryHeard) readAgain();
  }, [diaryHeard]);

  /* ── BOOKINGS TO SERVICEM8 (two-way phase 3): every door asks the server
     and the card draws what the next read says ── */

  const bookings = record?.bookings ?? null;
  /* EACH BOOKING IS DRAWN ONCE. The standing list is the detail's (the
     mirror's, less what we took out, plus what we sent that it doesn't hold
     yet), less what a later read says we took out; a press's booking is
     drawn above the list unless the list holds it AND the read gave it a
     line of its own, which it then carries on its entry. */
  const standing: BookedEntry[] | null = detail?.booked
    ? detail.booked.filter((b) => !bkGone.has(b.uuid.trim().toLowerCase()))
    : null;
  /* ONE VISIT, ITS CREW (#3256, 10-03): ServiceM8 books each person as
     their own booking, and three people at 7am on the 7th read as "Louis
     Jones" next on site with the other two as separate rows. Everyone at
     the same start and end is one visit; each keeps its own line state. */
  const visitsAhead: { key: string; start: string; end: string | null; crew: BookedEntry[] }[] = [];
  for (const b of standing ?? []) {
    const key = `${b.start}|${b.end ?? ""}`;
    const v = visitsAhead.find((x) => x.key === key);
    if (v) v.crew.push(b);
    else visitsAhead.push({ key, start: b.start, end: b.end, crew: [b] });
  }
  const crewOf = (crew: readonly BookedEntry[]) =>
    crew.map((b, i) => (
      <Fragment key={b.uuid}>
        {i > 0 && <br />}
        {b.staffName ?? BOOKING_WORDS.fill.person}
        {b.staffName && b.staffTitle && <i className="wb2-jcrole">{`, ${b.staffTitle}`}</i>}
      </Fragment>
    ));
  /* A day on site's crew, as the visit cards have always drawn it. A comma
     separates two bare names; once a title (or a check-in left open) is in
     the line a comma cannot say where one person ends, so the pair takes a
     dash instead. The separators are REAL TEXT, not CSS — jest never loads
     the stylesheet, so a separator that lives only in CSS is one nothing
     here can see fail. */
  const visitCrew = (v: NonNullable<typeof detail>["visits"][number]): ReactNode =>
    v.crew.length === 0
      ? "Nobody named"
      : v.crew.map((c, i) => (
          <span key={c.name}>
            {i > 0 ? (v.crew.some((m) => m.title || m.leftOpen) ? " — " : ", ") : ""}
            {c.name}
            {c.title && <i className="wb2-jcrole">{`, ${c.title}`}</i>}
            {/* on site, time unknown: the hours leave this person out, so the line says why */}
            {c.leftOpen && <i className="wb2-jcrole">, check-in left open</i>}
            {c.onSite && <i className="wb2-jcrole">, on site now</i>}
          </span>
        ));
  /* the days booked ahead; who's booked is said once, in the bookings
     above the visits, so their cards don't repeat it */
  const daysAhead: VisitDay[] = [
    ...new Set([...(standing ?? []).map((b) => b.start), ...(!standing && detail?.nextBooking ? [detail.nextBooking.start] : [])].map((s) => s.slice(0, 10))),
  ].map((day) => ({ day, crewNode: null, minutes: 0, length: null, onSite: false }));
  const listed = new Set((standing ?? []).map((b) => b.uuid.trim().toLowerCase()));
  const above = bkVerbs
    .map((v) => ({ ...v, bookings: v.bookings.filter((b) => !(listed.has(b.uuid) && bkLines[b.uuid])) }))
    .filter((v) => !!v.status?.state.text || v.bookings.some((b) => !!b.state.text));
  const verbLineOf = (uuid: string, op: VerbLine["op"]) =>
    bkVerbs.flatMap((v) => v.bookings).find((b) => b.uuid === uuid && b.op === op) ?? null;
  /** A Clear of this leftover holds its entry's door: one on its way, or
      one that didn't go and offers its own Try again. A trial, or one that
      asks for a fresh look, leaves the door to be pressed again. */
  const clearHolds = (uuid: string) => {
    const c = verbLineOf(uuid, "clear");
    return !!c && (c.state.key === "line.clearing" || c.state.key === "line.clearWaiting" || c.state.acts.includes("try_again"));
  };

  /** Where every booking line on the card stands: the poll, and after each
      press. */
  const refreshBookings = async () => {
    if (!cardId) return;
    const s = await readBookingStates({ jobUuid: cardId });
    if (!s || !alive.current) return;
    setBkVerbs(s.verbs);
    setBkLines(s.lines);
    setBkGone(new Set(s.gone.map((u) => u.trim().toLowerCase())));
    /* a read that answered is the truth about what a press queued: from
       here the lines alone say whether anything waits. A row with no line
       to say (a trial's status change) never keeps the card asking */
    setBkPending((cur) => (cur.size === 0 ? cur : new Set()));
  };
  useNoteStatePoll({
    waiting: !!bookings && (bookingsWaiting(bkVerbs, bkLines) || bkPending.size > 0),
    kick: bkKick,
    read: refreshBookings,
  });

  /* ONE PRESS PER LINE. While a press on a line is out its doors are off:
     the ref is the guard (two clicks in one tick see it), the state only
     draws it. */
  const bkOut = useRef(new Set<string>());
  const [bkBusy, setBkBusy] = useState<ReadonlySet<string>>(() => new Set());
  const clearPressIds = useRef(new Map<string, string>());

  const openPanel = (seed: BookInSeed | null) => setBookIn((cur) => ({ n: (cur?.n ?? 0) + 1, seed }));

  const bkPress = (key: string, run: () => Promise<BookingLineResult>, seed: BookInSeed | null, answered?: () => void) => {
    if (bkOut.current.has(key)) return;
    bkOut.current.add(key);
    setBkBusy(new Set(bkOut.current));
    const done = () => {
      bkOut.current.delete(key);
      if (alive.current) setBkBusy(new Set(bkOut.current));
    };
    void run().then(
      (res) => {
        done();
        answered?.();
        if (!res.ok) {
          onToast(res.error);
          if (res.lookAgain && bookings?.canBook) openPanel(seed);
        }
        void refreshBookings();
        setBkKick((k) => k + 1);
      },
      (e: unknown) => {
        done();
        onToast(thrownWords(e, BOOKING_WORDS.press.unqueued));
      }
    );
  };

  /** A door on one of our bookings' lines (or a Clear's). */
  const bookingAct = (act: BookingAct, line: { rowId: string; op: VerbLine["op"]; uuid: string; seed: BookInSeed | null }) => {
    if (!cardId) return;
    const jobUuid = cardId;
    if (act === "undo" || act === "cancel") {
      bkPress(line.rowId, () => takeBackBooking({ jobUuid, rowId: line.rowId }), line.seed);
    } else if (act === "try_again" || act === "take_out_again") {
      bkPress(line.rowId, () => retryBooking({ jobUuid, rowId: line.rowId }), line.seed);
    } else if (act === "look_again" || act === "book_again") {
      /* a fresh read: the panel with the booking in it, or — for a Clear,
         or where Book in isn't offered — the card read again */
      if (line.op === "create" && bookings?.canBook) openPanel(line.seed);
      else if (line.op === "clear") {
        /* a Clear's fresh look: read again, and ask again while it is
           still a leftover */
        const u = line.uuid.trim().toLowerCase();
        void reloadVisits().then((d) => {
          if (alive.current && d?.booked?.some((b) => b.leftover && b.uuid.trim().toLowerCase() === u)) setClearAsk(u);
        });
      } else void reloadVisits();
    }
  };

  /** Clear a leftover, as its confirm showed it. One press id per booking
      until it is answered, so a retry after a lost answer is one Clear. */
  const clearBooking = (b: BookedEntry) => {
    if (!cardId) return;
    const jobUuid = cardId;
    const key = b.uuid.trim().toLowerCase();
    const pressId = clearPressIds.current.get(key) ?? mintPressId();
    clearPressIds.current.set(key, pressId);
    bkPress(
      `clear:${key}`,
      () => clearLeftoverBooking({ jobUuid, activityUuid: b.uuid, seen: { staffUuid: b.staffUuid ?? "", start: b.start }, pressId }),
      null,
      () => {
        clearPressIds.current.delete(key);
        setClearAsk(null);
      }
    );
  };

  /** Book in went: its lines join the card, and the poll looks for its rows. */
  const bookedIn = (verb: VerbView, rowIds: string[]) => {
    setBkVerbs((cur) => [verb, ...cur.filter((v) => v.verbId !== verb.verbId)]);
    setBkPending((cur) => new Set([...cur, ...rowIds]));
    setBkKick((k) => k + 1);
  };

  /** The Visits face read again: the job's bookings and every line. */
  const reloadVisits = async (): Promise<MirrorJobDetail | null> => {
    const res = await readMirrorJob(row.id).catch(() => null);
    if (res && alive.current) setDetail(res.detail);
    await reloadRecord();
    await refreshBookings();
    return res?.detail ?? null;
  };

  /* MAKE IT A WORK ORDER (Isaac, 2026-10-03): "do and charge" decided on
     site, before anyone is booked. Asked once, then pressed; one press id
     for the card's life, so a second press is the same change. */
  const [woPressId] = useState(() => mintPressId());
  const [wo, setWo] = useState<"ask" | "busy" | "done" | null>(null);
  const offerWorkOrder =
    !!cardId && !!bookings?.canBook && (detail?.status ?? "").trim().toLowerCase() === "quote" && wo !== "done";
  const pressWorkOrder = async () => {
    if (!cardId) return;
    setWo("busy");
    const a = await makeWorkOrder({ jobUuid: cardId, pressId: woPressId }).catch(() => ({ ok: false as const, error: BOOKING_WORDS.press.unqueued }));
    if (!alive.current) return;
    if (!a.ok) {
      setWo(null);
      onToast(a.error);
      return;
    }
    setWo("done");
    onToast(
      a.state === "sent"
        ? "Made a Work Order in ServiceM8."
        : a.state === "trial"
          ? "Trial run: nothing went to ServiceM8."
          : "Making it a Work Order in ServiceM8."
    );
    void reloadVisits();
  };

  const seedOf = (b: { staffUuid: string | null; start: string | null; end: string | null }): BookInSeed => ({
    staffUuid: b.staffUuid,
    start: b.start,
    end: b.end,
  });
  const sm8Url = sm8JobUrl(cardId);

  /** What a standing booking says on its own entry: our line and its doors,
      or a leftover's words and Clear booking — asked in place. */
  const entryState = (b: BookedEntry) => {
    const u = b.uuid.trim().toLowerCase();
    const line = bkLines[u];
    if (line) {
      const rowId = b.ourRow ?? verbLineOf(u, "create")?.rowId ?? null;
      return (
        <BookingStateLine
          state={rowId ? line : { ...line, acts: line.acts.filter((a) => a === "open_in_sm8") }}
          sm8Url={sm8Url}
          busy={!!rowId && bkBusy.has(rowId)}
          canPanel={!!bookings?.canBook}
          onAct={(act) => rowId && bookingAct(act, { rowId, op: "create", uuid: u, seed: seedOf(b) })}
        />
      );
    }
    if (!b.leftover) return null;
    if (clearAsk === u && bookings?.canClear && !clearHolds(u)) {
      return (
        <ClearConfirm
          name={b.staffName}
          start={b.start}
          number={detail?.jobNumber ?? row.number ?? null}
          status={detail?.status ?? null}
          busy={bkBusy.has(`clear:${u}`)}
          onClear={() => clearBooking(b)}
          onKeep={() => setClearAsk(null)}
        />
      );
    }
    return (
      <div className="wb2-jcattsave">
        <span className="wb2-evmeta">{leftoverWords(detail?.status ?? null)}</span>
        {bookings?.canClear && !clearHolds(u) && (
          <button type="button" className="wb2-evdoor" onClick={() => setClearAsk(u)}>
            {BOOKING_WORDS.door.clearBooking}
          </button>
        )}
      </div>
    );
  };

  /* STARRING IS OPTIMISTIC AND REVERSIBLE. The star is a curator's gesture,
     not a save — it must land the instant it is clicked. A refused write puts
     the star back where the server says it is, which is why the action
     returns the truth rather than an ok/not-ok.

     AND IT MAY MAKE A PICTURE APPEAR. Starring an uncached photo triggers the
     bytes fetch server-side, so the files are re-read on the way back: the
     showcase's whole point is the picture, and a star that leaves a grey
     plate behind has done half its job. */
  const toggleFavourite = (remoteId: string) => {
    if (!cardId) return;
    const on = !(favourites?.has(remoteId) ?? false);
    const paint = (starred: boolean) =>
      setFavourites((cur) => {
        const next = new Set(cur ?? []);
        if (starred) next.add(remoteId);
        else next.delete(remoteId);
        return next;
      });
    paint(on);
    void setJobPhotoFavourite(cardId, remoteId, on)
      .then((res) => {
        if (!alive.current) return;
        if (!res.ok) {
          paint(res.starred);
          onToast("Could not save that star");
          return;
        }
        if (res.note) onToast(res.note);
        if (on)
          void readJobFiles(cardId).then((m) => {
            if (alive.current && m) setMedia(m);
          });
      })
      .catch((e: unknown) => {
        if (!alive.current) return;
        paint(!on);
        onToast(thrownWords(e, "Could not save that star"));
      });
  };

  /* CHECK IN / CHECK OUT — the reader, on this job. The card reads the job
     again after, so the day's card shows them on site (or their hours). */
  const pressCheck = (out: boolean) => {
    if (!cardId || checking) return;
    setChecking(true);
    void (out ? checkOut(cardId) : checkIn(cardId))
      .then((m) => {
        if (!alive.current) return;
        setMine(m);
        void readMirrorJob(row.id).then((res) => alive.current && res.detail && setDetail(res.detail));
      })
      .catch((e: unknown) => alive.current && onToast(thrownWords(e, out ? "Could not check you out" : "Could not check you in")))
      .finally(() => alive.current && setChecking(false));
  };

  const removeChecklistItem = (id: string) => {
    setPicklist((cur) => (cur ?? []).filter((p) => p.id !== id));
    void removePicklistItem(id).catch((e: unknown) => onToast(thrownWords(e, "Could not remove that line")));
  };

  const addChecklistItem = (input: { kind: "material" | "todo"; name: string; qty: string; sub?: string }) => {
    if (!cardId) return;
    const temp: JobPicklistItem = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: input.name,
      sub: input.sub ?? "",
      qty: input.qty,
      kind: input.kind,
      picked: false,
      pickedAt: null,
      pickedBy: null,
      addedBy: null,
      designId: null,
      addedAt: new Date().toISOString(),
    };
    setPicklist((cur) => [...(cur ?? []), temp]);
    void addJobPicklistItem(cardId, input)
      .then((item) => {
        setPicklist((cur) => (cur ?? []).map((p) => (p.id === temp.id ? item : p)));
      })
      .catch((e: unknown) => {
        setPicklist((cur) => (cur ?? []).filter((p) => p.id !== temp.id));
        onToast(thrownWords(e, "Could not add that row"));
      });
  };

  /* What each step opens. The quote is everyone's on the Workboard, its
     money only theirs who see money (Isaac, 2026-10-12: "the quoting section
     should still be accessible. For techs who are quoting a job"). */
  /* ACCEPTED opens the quote only while the job is still a Quote: on an
     accepted job it opened "Draft the proposal" over work already under way
     (Isaac, 2026-10-03). The work-order line's steps open what they're
     about — the visits, or the bill. */
  const stillAQuote = (detail?.status ?? row.statusLabel ?? "").trim().toLowerCase() === "quote";
  const faceOf = (k: StepKey): TabKey =>
    k === "quoted" || (k === "accepted" && stillAQuote)
      ? "quote"
      : k === "deposit" || k === "paid" || k === "invoiced"
        ? "money"
        : k === "materials"
          ? "checklist"
          : k === "installation" || k === "booked" || k === "onsite"
            ? "visits"
            : "summary";

  /* WHICH FACES ARE SHOWING: the page's section's. */
  const faceOn = (k: TabKey) => SECTION_FACES[page.section].includes(k);

  const go = (key: string) => {
    if (key !== "diary") {
      setFlagFocus(false);
      setReplyFor(null);
    }
    setStep(null);
    /* a face is reached by its section */
    const to = sectionOfFace(key as TabKey);
    if (to !== page.section) page.onSection(to);
  };

  const openStep = (k: StepKey) => {
    go(faceOf(k));
    setStep(k);
  };

  /* ADD (rule 54): Visit, Task, Quote (Variation once accepted), Cost, SWMS,
     Certificate. Each is a door to what the card already does, behind the
     same check that card's own door has, and an item the reader may not use
     isn't there. It waits, as the diary's pen does, for the card to know
     which job it is. */
  const askQuote = () => {
    const job = cardId;
    if (!job || quoteAsked.current === job) return;
    quoteAsked.current = job;
    void Promise.resolve()
      .then(() => fetch(`/api/workboard/quote-status?job=${encodeURIComponent(job)}`))
      .then((r) => r.json() as Promise<{ ok: boolean; facts?: QuoteFacts }>)
      .then((a) => {
        if (!alive.current) return;
        if (!a.ok || !a.facts) quoteAsked.current = null;
        setQuoteFacts(a.ok && a.facts ? a.facts : null);
      })
      .catch(() => {
        quoteAsked.current = null;
        if (alive.current) setQuoteFacts(null);
      });
  };
  /* a variation is made on an accepted quote, and only there (startVariation) */
  const variation = !!quoteFacts && quoteFacts.accepted.length > 0;
  const addItems: MenuItem[] = [
    /* Book in, where the deployment books and the reader may */
    ...(bookings?.canBook ? [{ key: "visit", label: "Visit" }] : []),
    /* the Visits face's Add a task is a manager's (workboard_manage) */
    ...(manage && detail ? [{ key: "task", label: "Task" }] : []),
    /* the quote is everyone's on the Workboard; its money is not in it */
    { key: "quote", label: variation ? "Variation" : "Quote" },
    /* a cost on a job is an expense claim, and anyone may claim one */
    { key: "cost", label: "Cost" },
    /* a SWMS is a before-work paper: none is made once ServiceM8 has the job closed */
    ...(SWMS_CLOSED.has(detail?.status ?? "") ? [] : [{ key: "swms", label: "SWMS" }]),
    { key: "certificate", label: "Certificate" },
  ];
  const addPick = (key: string) => {
    const job = cardId ?? row.id;
    switch (key) {
      case "visit":
        /* the Visit form, over the page you're on (rule 51) */
        openPanel(null);
        return;
      case "task":
        openStep("installation");
        setTaskAsk((n) => n + 1);
        return;
      case "quote":
        /* until the card knows where the quote stands, the Quote section
           does, and holds its own Create or Continue */
        if (quoteFacts) router.push(quotePage(job, variation || quoteStarted(quoteFacts)));
        else openStep("quoted");
        return;
      case "cost":
        setCosting(true);
        return;
      case "swms":
        go("compliance");
        /* one SWMS a job: a later one is a revision, on its own row */
        if (swms !== null && swms.length === 0) setSwmsWizard({ revise: null });
        return;
      case "certificate":
        go("compliance");
        /* one certificate a job: a later one is a reissue */
        if (certs !== null && certs.length === 0) setCertWizard({ reissue: null });
        return;
    }
  };

  /* MAKE A DOCUMENT, FROM DOCUMENTS (v2): the page arrives on Documents
     asking for a SWMS or a certificate, and once the job's papers are read
     it does what Add does: the wizard for the job's first, its row (with
     Revise or Reissue) when it has one, and no SWMS once ServiceM8 has the
     job closed, as Add offers none then. Asked once, while rendering, the
     way a prop's change is taken in, so no effect sets state. */
  const [addAsked, setAddAsked] = useState<"swms" | "certificate" | null>(page.add ?? null);
  if (addAsked === "swms" && swms !== null && detail !== null) {
    setAddAsked(null);
    if (swms.length === 0 && !SWMS_CLOSED.has(detail.status ?? "")) setSwmsWizard({ revise: null });
  } else if (addAsked === "certificate" && certs !== null) {
    setAddAsked(null);
    if (certs.length === 0) setCertWizard({ reissue: null });
  }

  /* Every face is a region of its section, named by itself: the section's
     tab labels the whole body, not one face of it. */
  const panel = (key: TabKey, body: React.ReactNode) => (
    <section
      className="wb2-jcface"
      id={`jcsec-${key}`}
      role="region"
      aria-label={FACE_NAME[key]}
      hidden={!faceOn(key)}
    >
      {body}
    </section>
  );

  /* THE FACES, each drawn once, under the page's head. */
  const faceMoney = (
    <>
          {moneyVisible &&
            panel(
              "money",
              (() => {
                /* MONEY READS ONCE, and it reads here. The block waits for
                   the family read so a family-billed parent never paints its
                   netted total and then corrects itself. */
                const block =
                  record !== undefined || recordFailed ? (
                    <JobMoneyBlock
                      family={family}
                      unavailable={recordFailed}
                      money={money}
                      ledgerPaidCents={
                        record?.ledger ? paymentsTotalCents(record.ledger.payments) : 0
                      }
                      statusLabel={row.statusLabel}
                      focusRemoteId={focus}
                      onOpenClaim={setOpenClaim}
                      deposit={(() => {
                        const status = (detail?.status ?? "").trim().toLowerCase();
                        const started = (detail?.visits.length ?? 0) > 0 || status === "completed";
                        /* asked while a deposit could still be wanted: no
                           deposit invoice, work not started, not declined */
                        const ask = !!family && family.claims[0]?.stage !== "Deposit" && !started && status !== "unsuccessful";
                        return noDeposit || ask
                          ? { noDeposit, busy: depositBusy, error: depositError, onSet: (on: boolean) => void tickNoDeposit(on) }
                          : null;
                      })()}
                      billTo={(() => {
                        const name = detail?.clientName ?? row.clientName;
                        if (!name) return null;
                        const c = detail?.contacts.find((x) => (x.type ?? "").trim().toLowerCase() === "billing");
                        return { name, contact: c ? { name: c.name, email: c.email } : null };
                      })()}
                    />
                  ) : (
                    <p className="int-hint">Reading the figures</p>
                  );

                /* A BLOCK THAT HAS OPENED ITS LEDGER KEEPS THE FULL WIDTH.
                   The claim rows are a table — name, what it says about
                   itself, amount, chip — and in the left column each one
                   wrapped to four lines. The same test the block itself
                   applies before it opens the ledger. */
                const ledgerOpen = family !== null && family.isFamily && family.claims.length > 1;

                const paidSection =
                  record?.ledger && record.ledger.payments.length > 0 ? (
                    <div className="wb2-shsect">
                      <span className="wb2-sect">
                        What&apos;s been paid —{" "}
                        {(() => {
                          const paid = paymentsTotalCents(record.ledger.payments);
                          /* COLLECTION IS SAID ONCE, and the block above says
                             it. On a family this figure is measured against
                             THIS row's own netted total, so no verdict. */
                          if (record.family?.isFamily) return fmtAud(paid);
                          const state = collectionAgainst(paid, money?.valueCents ?? null);
                          if (state === "paid") return `${fmtAud(paid)}, paid in full`;
                          if (state === "part")
                            return `${fmtAud(paid)} of ${fmtAud(money!.valueCents!)}`;
                          return fmtAud(paid);
                        })()}
                      </span>
                      {record.ledger.payments.map((p) => (
                        <div className="wb2-mline" key={p.remoteId}>
                          <b>{p.method ?? "Payment"}</b>
                          <em>
                            {[
                              p.isDeposit ? "deposit" : null,
                              p.takenOn ? fmtAuWeekdayDayMonth(p.takenOn) : null,
                              p.takenBy,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </em>
                          <span>{p.amountCents !== null ? fmtAud(p.amountCents) : "—"}</span>
                        </div>
                      ))}
                    </div>
                  ) : null;

                /* PARTIAL-INVOICE ROWS LEAVE THIS LIST. "Partial invoice
                   #2380A × −1" is ServiceM8 subtracting one of its own
                   clones out of the parent — bookkeeping, not something
                   that went on the job. It belongs to the block above,
                   where it IS a claim. */
                const goodsSection =
                  materials.length > 0 ? (
                    <div className="wb2-shsect">
                      <span className="wb2-sect">What went on the job</span>
                      {materials.map((m) => (
                        <div className="wb2-mline" key={m.remoteId}>
                          <b>{m.name}</b>
                          <em>{m.quantity !== null ? `× ${fmtQuantity(m.quantity)}` : ""}</em>
                          <span>{m.lineCents !== null ? fmtAud(m.lineCents) : "—"}</span>
                        </div>
                      ))}
                      {(() => {
                        const total = materialsTotalCents(materials);
                        const mixed = materialsTaxMixed(materials);
                        /* No total when a line couldn't be read, and none
                           when the lines disagree about tax. */
                        if (mixed)
                          return (
                            <p className="int-hint">
                              These lines mix tax-inclusive and tax-exclusive prices, so they
                              don&apos;t add up to one figure here — ServiceM8&apos;s invoice is
                              the total.
                            </p>
                          );
                        if (total === null)
                          return (
                            <p className="int-hint">
                              Some lines aren&apos;t priced, so there&apos;s no total to show.
                            </p>
                          );
                        return (
                          <div className="wb2-mline total">
                            <b>{materials[0].taxInclusive ? "Total inc GST" : "Total ex GST"}</b>
                            <em />
                            <span>{fmtAud(total)}</span>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null;

                /* THE FACE IS TWO COLUMNS (Isaac, 2026-09-10): the money on
                   the left — the value, its collection row, what's been paid
                   — and what went on the job on the right. The block used to
                   run the full width with the figure top-right and the
                   sentence bottom-left, over a grid with one column empty on
                   any job with nothing paid. With nothing to stand beside,
                   whichever column is there runs the full width rather than
                   leaving the other half blank, which was the fault. */
                const left = !ledgerOpen || paidSection !== null;
                const twoUp = left && goodsSection !== null;
                return (
                  <>
                    {ledgerOpen && block}
                    {(left || goodsSection !== null) && (
                      <div className={"wb2-jcgrid money" + (twoUp ? "" : " one")}>
                        {left && (
                          <div className="wb2-jcol">
                            {!ledgerOpen && block}
                            {paidSection}
                          </div>
                        )}
                        {goodsSection}
                      </div>
                    )}
                  </>
                );
              })()
            )}
    </>
  );
  const faceVisits = (
    <>
          {panel(
            "visits",
            <>
              {/* CHECK IN / CHECK OUT (Isaac, 2026-10-02): the record of who
                  was on site, over ServiceM8's check-ins, which miss most
                  days. One press; checking in here checks out of anywhere
                  else. */}
              {cardId && mine !== undefined && (
                <div className={"jcl-check" + (mine?.jobUuid === cardId ? " on" : mine ? "" : " bare")}>
                  {mine?.jobUuid === cardId ? (
                    <>
                      <span>{`On site since ${fmtAuTime(new Date(mine.since))}`}</span>
                      <button type="button" className="pbtn" disabled={checking} onClick={() => pressCheck(true)}>
                        Check out
                      </button>
                    </>
                  ) : (
                    <>
                      {mine && (
                        <span>{`Checked in at ${mine.jobNumber ? `#${mine.jobNumber}` : "another job"} since ${fmtAuTime(new Date(mine.since))}`}</span>
                      )}
                      <button type="button" className="pbtn" disabled={checking} onClick={() => pressCheck(false)}>
                        {mine ? "Check in here" : "Check in"}
                      </button>
                    </>
                  )}
                </div>
              )}
              {/* BOOK IN (two-way phase 3): the door, or its panel in place,
                  then every press on the job whose booking isn't standing
                  on the list below — newest first, a status change said
                  once above its bookings. Nothing of it where the
                  deployment books nothing. */}
              {bookings?.canBook && cardId && (
                <div className="wb2-jcattsave">
                  <button type="button" className="pbtn" onClick={() => openPanel(null)}>
                    {BOOKING_WORDS.panel.book}
                  </button>
                </div>
              )}
              {above.length > 0 && (
                <div className="wb2-jcsec">
                  {above.map((v) => (
                    <Fragment key={v.verbId}>
                      {v.status?.state.text && (
                        <div className="wb2-evmeta">
                          <StateLine as="span" line={{ word: v.status.state.text, tone: v.status.state.tone }} />
                        </div>
                      )}
                      {v.bookings.map((b) => (
                        <Fragment key={b.rowId}>
                          {b.start && (
                            <BookingEntryLine start={b.start} end={b.end} name={b.name} startOnly={b.op === "clear"} />
                          )}
                          <BookingStateLine
                            state={b.state}
                            sm8Url={sm8Url}
                            busy={bkBusy.has(b.rowId)}
                            canPanel={b.op === "clear" || !!bookings?.canBook}
                            onAct={(act) => bookingAct(act, { rowId: b.rowId, op: b.op, uuid: b.uuid, seed: seedOf(b) })}
                          />
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </div>
              )}
              {standing ? (
                visitsAhead[0] && (
                  <div className="wb2-nextv">
                    <span className="wb2-sect">Next on site</span>
                    <b>{bookingLabel(visitsAhead[0].start, visitsAhead[0].end)}</b>
                    <em>{crewOf(visitsAhead[0].crew)}</em>
                    {visitsAhead[0].crew.map((b) => (
                      <Fragment key={b.uuid}>{entryState(b)}</Fragment>
                    ))}
                  </div>
                )
              ) : null}
              {visitsAhead.length > 1 && (
                <div className="wb2-jcsec">
                  {visitsAhead.slice(1).map((v) => (
                    <Fragment key={v.key}>
                      <BookingEntryLine
                        start={v.start}
                        end={v.end}
                        name={v.crew.map((b) => b.staffName ?? BOOKING_WORDS.fill.person).join(", ")}
                        title={v.crew.length === 1 ? v.crew[0]!.staffTitle : null}
                      />
                      {v.crew.map((b) => (
                        <Fragment key={b.uuid}>{entryState(b)}</Fragment>
                      ))}
                    </Fragment>
                  ))}
                </div>
              )}
              {/* SITE VISITS IS ONE SECTION — the next booking FIRST, in the
                  accent, then every past visit under the same roof. */}
              {!standing && detail?.nextBooking && (
                <div className="wb2-nextv">
                  <span className="wb2-sect">Next on site</span>
                  <b>{bookingLabel(detail.nextBooking.start, detail.nextBooking.end)}</b>
                  <em>
                    {detail.nextBooking.staffName ?? "Nobody named"}
                    {detail.nextBooking.staffName && detail.nextBooking.staffTitle && (
                      <i className="wb2-jcrole">{`, ${detail.nextBooking.staffTitle}`}</i>
                    )}
                  </em>
                </div>
              )}
              {detail?.queue && (
                <div className="wb2-jcsec">
                  <span className="wb2-sect">In queue</span>
                  <p className="wb2-shtext">
                    <b>{detail.queue.name}</b>
                    {", "}
                    {[
                      detail.queue.staffName,
                      detail.queue.expiry
                        ? `until ${fmtAuWeekdayDayMonth(detail.queue.expiry)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "waiting"}
                  </p>
                </div>
              )}
              {detail ? (
                <JobVisitTasks
                  job={cardId ?? row.id}
                  visible={faceOn("visits")}
                  onSite={detail.visits.map((v) => ({
                    day: v.day,
                    crewNode: visitCrew(v),
                    length: visitLength(v),
                    minutes: v.minutes,
                    onSite: v.crew.some((c) => c.onSite),
                  }))}
                  ahead={daysAhead}
                  workOrderDate={detail.workOrderDate}
                  onSiteMinutes={detail.timeOnSite?.minutes ?? null}
                  askAdd={taskAsk}
                  onBook={bookings?.canBook && cardId ? () => openPanel(null) : undefined}
                  emptyWords={above.length > 0 || detail.queue ? "" : "Nobody's been on site yet, and nothing is booked."}
                />
              ) : (
                <p className="int-hint">{loading ? "Reading the visits from the mirror" : "Nobody's been on site yet, and nothing is booked."}</p>
              )}
            </>
          )}
    </>
  );
  const faceChecklist = (
    <>
          {panel(
            "checklist",
            <JobChecklistFace
              loading={loading}
              sm8={detail?.checklist ?? []}
              items={picklist}
              timezone={detail?.timezone ?? null}
              manage={manage}
              ready={!!cardId}
              onTick={tickChecklistItem}
              onRemove={removeChecklistItem}
              onAdd={addChecklistItem}
            />
          )}
    </>
  );
  const facePhotos = (
    <>
          {panel(
            "photos",
            <JobPhotosFace
              photos={media ? media.photos : null}
              loading={media === null}
              truncated={!!media?.truncated}
              mediaNote={mediaNote}
              visits={detail?.visits ?? []}
              unread={photosUnread}
              favourites={favourites}
              onOpen={(id) => setViewer({ kind: "photos", id })}
              onStar={toggleFavourite}
            />
          )}
    </>
  );
  const faceQuote = (
    <>
          {panel(
            "quote",
            /* the card keeps a small Quote face: ServiceM8's quote, where
               HeyTiff's stands, and the way into the quote page (Isaac,
               2026-10-05: "it should have opened up the proper quote screen
               not a section below"); for everyone on the Workboard */
            <JobQuoteCard
              job={cardId ?? row.id}
              visible={faceOn("quote")}
              sm8={sm8QuoteOf({
                documents: media?.documents ?? null,
                sentOn: detail?.quoteSentOn ?? null,
                moneyVisible,
                family,
                rowValueCents: money?.valueCents ?? null,
              })}
              onOpenPaper={(item) => setViewer({ kind: "paper", id: item.remoteId })}
            />
          )}
    </>
  );
  const faceDocuments = (
    <>
          {/* FILES AND COMPLIANCE, TWO SECTIONS ON THE RAIL (Isaac,
              2026-10-02: "compliance is supposed to sit underneath files").
              One face, told which part it holds; a tick to send carries
              across both. */}
          {(["documents", "compliance"] as const).map((key) => (
            <Fragment key={key}>
              {panel(
                key,
                <JobDocumentsFace
                  part={key === "documents" ? "files" : "compliance"}
                  documents={media ? media.documents : null}
                  elsewhere={media ? media.elsewhere : null}
                  designs={detail?.designs ?? []}
                  swms={swms}
                  swmsFailed={swmsFailed}
                  canCreateSwms={!!cardId}
                  /* a SWMS is a before-work document: once ServiceM8 has the job
                     finished, nobody is asked to sign one and the bell won't ring */
                  swmsClosed={SWMS_CLOSED.has(detail?.status ?? "")}
                  loading={media === null}
                  truncated={!!media?.truncated}
                  onOpen={(item) => setViewer({ kind: "paper", id: item.remoteId })}
                  onUpload={cardId ? uploadDocument : undefined}
                  onRemove={removeDocument}
                  onCreateSwms={() => setSwmsWizard({ revise: null })}
                  onOpenSwms={(s) => setViewer({ kind: "page", item: swmsPaper(s.versionId) })}
                  onReviseSwms={(versionId) => setSwmsWizard({ revise: versionId })}
                  certificates={certs}
                  certificatesFailed={certsFailed}
                  onCreateCertificate={cardId ? () => setCertWizard({ reissue: null }) : undefined}
                  onOpenCertificate={(c) => setViewer({ kind: "page", item: certPaper(c.versionId) })}
                  onReissueCertificate={(versionId) => setCertWizard({ reissue: versionId })}
                  onDeleteCertificate={removeCertificate}
                  papers={papers ? papers.papers : null}
                  papersFailed={papersFailed}
                  mayAdd={{ company: !!papers?.may.company, staff: !!papers?.may.staff }}
                  today={todayInAu()}
                  picked={papers?.may.send ? picked : undefined}
                  onPick={papers?.may.send ? tick : undefined}
                  onLoadChoices={cardId ? () => readComplianceChoices(cardId) : undefined}
                  onAddPapers={cardId ? addPapers : undefined}
                  onOpenPaper={(p) => setViewer({ kind: "papers", id: p.id, index: 0 })}
                  onRemovePaper={removePaper}
                  onRenewPaper={renewPaper}
                  sends={sm8Read?.sends ?? null}
                  sendHold={sm8Read?.hold ?? null}
            />
              )}
            </Fragment>
          ))}
    </>
  );

  /* What sits under the faces: the send row, and the naming row while a
     project is being named. */
  const footer = (
    <>
        {/* SENDING WHAT'S TICKED — the card's footer, under the scrolling body,
            so the list keeps scrolling above it. Only on the face the ticks
            are on, and never over the naming row. */}
        {(faceOn("documents") || faceOn("compliance")) && !naming && cardId && papers?.may.send && (pickedList.length > 0 || writing) && (
          <DocumentsSend
            picked={pickedList}
            writing={writing}
            onWriting={setWriting}
            onLoadDraft={() => readEmailDraft(cardId)}
            onSend={sendDocuments}
            sm8={sm8Read?.send ?? null}
            sm8Note={sm8Note}
            onSendToSm8={sendToServiceM8}
          />
        )}

        {manage && naming && (
          <div className="wb2-shft">
            <input
              className="wb2-fi"
              autoFocus
              value={name}
              placeholder={row.clientName ?? "Project name"}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") makeProject();
                if (e.key === "Escape") {
                  /* Cancels the naming. */
                  e.preventDefault();
                  setNaming(false);
                }
              }}
              aria-label="Name the project"
            />
            <button className="pbtn" disabled={busy} onClick={makeProject}>
              <Icon name="check" size={15} />
              Create it
            </button>
            <button className="pbtn ghost" disabled={busy} onClick={() => setNaming(false)}>
              Cancel
            </button>
          </div>
        )}
    </>
  );

  /* The dialogs over the job, in a portal of their own. */
  const dialogs = (
    <>
      {/* BOOK IN, the Visit form (two-way phase 3): Add › Visit, the Visits
          section's Book in, a line's Look again and Book again, and a door
          that came to book. The job is this one, clearable; a visit booked
          on it joins the card's lines, and Undo takes them back out. */}
      {bookIn && bookings?.canBook && cardId && (
        <VisitForm
          key={bookIn.n}
          job={{ uuid: cardId, label: visitJobLabel({ number: detail?.jobNumber ?? row.number ?? null, clientName: row.clientName, suburb: row.suburb }) }}
          zone={bookings.zone}
          seed={bookIn.seed}
          onClose={() => setBookIn(null)}
          onBooked={(jobUuid, verb, rowIds) => {
            if (jobUuid === cardId) bookedIn(verb, rowIds);
          }}
          onUndone={(jobUuid) => {
            if (jobUuid === cardId) void refreshBookings();
          }}
          toast={onToast}
        />
      )}
      {/* Over the card, inside the SAME portal — a modal on a modal that
          portals separately is how a scrim ends up above the thing it dims. */}
      {editingCustomer && cardId && (
        <JobCustomerDialog jobUuid={cardId} onClose={() => setEditingCustomer(false)} onSaved={onToast} />
      )}
      {openClaimRow && (
        <JobClaimModal
          key={openClaimRow.remoteId}
          claim={openClaimRow}
          parentNumber={cardNumber}
          onClose={() => setOpenClaim(null)}
        />
      )}

      {/* Add › Cost: the expense claim, with this job filled in. A claim
          links a project, a visit or an agreement, never a ServiceM8 job, so
          the job is named in the claim's words, as the cost lane names it
          (lib/workboard/note-cost-file, `costDescription`). */}
      {costing && (
        <Suspense fallback={null}>
          <ExpenseForm
            job={{
              /* a visit or a project row links; a ServiceM8 job is named */
              kind: row.kind === "sm8" ? "sm8" : row.kind,
              id: row.kind === "sm8" ? (cardId ?? row.id) : row.id,
              label: [cardNumber ? `Job ${cardNumber}` : "Job", detail?.clientName ?? row.clientName, detail?.suburb ?? row.suburb]
                .filter(Boolean)
                .join(", "),
            }}
            onClose={() => setCosting(false)}
          />
        </Suspense>
      )}

      {/* The SWMS wizard — same portal, over the card. Keyed by what it opened
          for, so a revision never inherits a new SWMS's half-made choices. */}
      {swmsWizard && cardId && (
        <SwmsWizard
          key={`${cardId}:${swmsWizard.revise ?? "new"}`}
          jobUuid={cardId}
          reviseVersionId={swmsWizard.revise}
          onClose={() => setSwmsWizard(null)}
          onIssued={reloadSwms}
          onOpen={(versionId) => {
            setSwmsWizard(null);
            setViewer({ kind: "page", item: swmsPaper(versionId) });
          }}
          onSignOn={(versionId) => router.push(`/dashboard/swms/${versionId}`)}
        />
      )}

      {/* The certificate wizard — the same portal, over the card, keyed like
          the SWMS's so a reissue never inherits a new one's half-made answers. */}
      {certWizard && cardId && (
        <CertWizard
          key={`${cardId}:${certWizard.reissue ?? "new"}`}
          jobUuid={cardId}
          reviseVersionId={certWizard.reissue}
          onClose={() => setCertWizard(null)}
          onIssued={certIssued}
          onEmail={(documentId) => void emailCertificate(documentId)}
          onSendToSm8={(documentId, fileName) => void sendCertificateToSm8(documentId, fileName)}
          onOpen={(versionId) => {
            setCertWizard(null);
            setViewer({ kind: "page", item: certPaper(versionId) });
          }}
          canSend={!!papers?.may.send}
          onFilesChanged={() =>
            void readJobFiles(cardId)
              .then((fresh) => {
                if (alive.current && fresh) setMedia(fresh);
              })
              .catch(() => {})
          }
        />
      )}

      {viewer?.kind === "page" && (
        <JobMediaViewer items={[viewer.item]} index={0} favourites={null} onNav={() => {}} onClose={() => setViewer(null)} />
      )}

      {/* A licence or certificate on the job — its own pages, in the same
          viewer as the job's other paper. */}
      {viewer?.kind === "papers" &&
        (() => {
          const paper = papers?.papers.find((p) => p.id === viewer.id);
          const pages = paper ? paperPages(paper) : [];
          if (pages.length === 0) return null;
          return (
            <JobMediaViewer
              items={pages}
              index={Math.min(viewer.index, pages.length - 1)}
              favourites={null}
              onNav={(i) => setViewer({ kind: "papers", id: viewer.id, index: i })}
              onClose={() => setViewer(null)}
            />
          );
        })()}

      {/* The shared viewer — same portal, same law as the claim modal. */}
      {viewer &&
        viewer.kind !== "page" &&
        viewer.kind !== "papers" &&
        media &&
        (() => {
          /* THE VIEWER CARRIES ONLY WHAT IT CAN SHOW. A video's bytes stay
             in ServiceM8 by charter, so it is a plate in the mosaic and not
             a stop on the arrow keys — otherwise "next" lands on a frame
             promising a file that is never coming. */
          const items =
            viewer.kind === "photos"
              ? media.photos.filter((p) => p.kind !== "video")
              : media.documents.filter((d) => d.remoteId === viewer.id);
          const index = items.findIndex((i) => i.remoteId === viewer.id);
          if (index < 0) return null;
          return (
            <JobMediaViewer
              items={items}
              index={index}
              /* Paper has no star: the showcase is a gallery of the work. */
              favourites={viewer.kind === "photos" ? favourites : null}
              onStar={viewer.kind === "photos" ? toggleFavourite : undefined}
              onNav={(i) =>
                setViewer({ kind: viewer.kind, id: items[i]?.remoteId ?? viewer.id })
              }
              onClose={() => setViewer(null)}
            />
          );
        })()}
    </>
  );

  /* ABOVE THE FACES, ON EVERY ONE. The strip outranks the row for the same
     reason it outranks the summary: what needs you beats where it's up to.
     It draws nothing at all on a quiet job. */
  const attentionStripOf = (bare: boolean) =>
    attention ? (
            <JobAttentionStrip
              bare={bare}
              attention={attention}
              assignable={record?.assignable ?? []}
              busy={busy}
              onClearFlag={clearJobFlag}
              onOpenNote={() => {
                setFlagFocus(true);
                go("diary");
              }}
              onMakeTask={makeTaskFromNote}
              onDismissNote={answerNote}
              sm8={
                record?.flags
                  ? {
                      flags,
                      canReply: !!notesSm8 && (sender?.state === "ready" || sender?.state === "confirm"),
                      canMark: !!notesSm8,
                      onReply: (noteUuid) => {
                        setReplyFor(noteUuid);
                        go("diary");
                      },
                      onMarkDone: (noteUuid) => markDone(noteUuid),
                      marking: flagsBusy,
                    }
                  : null
              }
            />
    ) : null;

  /* THE JOB'S PAGE (v2, step 5): the head, then the section's faces. */
  const address = (detail?.address ?? detail?.geoLine ?? row.suburb ?? "")
    .split(/\s*\n\s*/)
    .filter(Boolean)
    .join(", ");
  const status = (cardStatus ?? "").trim();
  /* "Work Order" as a sentence says it: "Work order" */
  const kind = status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : "";
  const facts = [kind, cardNumber ? `Job ${cardNumber}` : "", address].filter(Boolean).join(", ");
  /* no numbers on the sections (rule 31, Isaac, 20 October) */
  const sections = sectionsFor(moneyVisible).map((key) => ({ key, label: SECTION_LABEL[key] }));
  /* ACTIONS (rule 53): only what's done to the job itself. Its stage
     first, then what the page does (pin it, copy the link), then the
     card's own two once-per-job acts for a manager. Nothing here ends a
     job: ServiceM8 does that. */
  const actionItems: MenuItem[] = [
    ...(offerWorkOrder && wo === null ? [{ key: "work-order", label: "Make it a work order" }] : []),
    ...page.actions,
    ...(manage
      ? [
          { key: "project", label: "Create a project from this job", disabled: busy },
          { key: "agreement", label: "Create a maintenance agreement", disabled: busy },
        ]
      : []),
  ];
  const actionPick = (key: string) => {
    if (key === "work-order") setWo("ask");
    else if (key === "project") {
      setName(row.clientName ?? "");
      setNaming(true);
    } else if (key === "agreement") onCreateAgreement(row, detail);
    else page.onAction(key);
  };
  return (
    <>
      <div className="wb2-sheet jc jp-sheet">
        <JobPageHead
          name={detail?.clientName ?? row.clientName ?? "Unnamed client"}
          hue={jobHue(categoryColour, status.toLowerCase() === "unsuccessful")}
          facts={facts}
          /* not until the job is read: before it, the steps are a quote's
             with nothing done, and the head said "Enquiry" on any job; and
             not on Overview, where the stages line and Money say it */
          stage={detail && page.section !== "overview" ? stageWord(steps) : null}
          sm8Href={sm8Href}
          add={{ items: addItems, onPick: addPick, disabled: !cardId, onReach: askQuote }}
          actions={{ items: actionItems, onPick: actionPick }}
          sections={sections}
          section={page.section}
          onSection={(key) => go(SECTION_FACES[key as JobSection][0]!)}
        />
        {offerWorkOrder && (wo === "ask" || wo === "busy") && (
          <div className="jp-ask" role="group" aria-label="Make it a work order">
            <span>Make it a Work Order in ServiceM8?</span>
            <Button kind="main" size={32} disabled={wo === "busy"} onClick={() => void pressWorkOrder()}>
              {wo === "busy" ? "Making it a work order" : "Make it a work order"}
            </Button>
            {wo === "ask" && (
              <Button kind="second" size={32} onClick={() => setWo(null)}>
                Keep it a quote
              </Button>
            )}
          </div>
        )}
        {here && <p className="wb2-here">{here}</p>}
        <div className="wb2-jcbody jp-body" role="tabpanel" aria-labelledby={`jp-tab-${page.section}`}>
          {err && <div className="wb2-sherr">{err}</div>}
          {/* OVERVIEW: the stages line (6-revisions: it lives on Overview
              only) over the four tiles, the customer under them, and the
              job's conversation beside them (four tiles, Isaac, 22 October
              2026). What's open on the job is the Overview's, not every
              tab's (Isaac, 20 October), and it is To do's: an ask in a
              note is a thing to do (the mock's "To do is the job's open
              asks") */}
          <div className="jp-over" hidden={page.section !== "overview"}>
            <JobOverview
              cardId={cardId}
              label={[cardNumber, detail?.clientName ?? row.clientName].filter(Boolean).join(" ") || undefined}
              story={story}
              loading={loading && !detail}
              moneyVisible={moneyVisible}
              detail={detail}
              fallbackWhat={row.title}
              head={<JobProgressLine steps={steps} open={step} onOpen={openStep} />}
              tiles={{
                onVisits: () => go("visits"),
                onBook: bookings?.canBook ? () => addPick("visit") : undefined,
                money: moneyVisible ? (
                  record !== undefined || recordFailed ? (
                    <JobMoneyGlance
                      family={family}
                      money={money}
                      ledgerPaidCents={record?.ledger ? paymentsTotalCents(record.ledger.payments) : 0}
                      statusLabel={row.statusLabel}
                      unavailable={recordFailed}
                    />
                  ) : (
                    <p className="jt-cap">Reading the figures</p>
                  )
                ) : undefined,
                onMoney: moneyVisible ? () => go("money") : undefined,
                onAddTask: manage && detail ? () => addPick("task") : undefined,
                open: attentionStripOf(true),
                openCount: attention?.total ?? 0,
              }}
              diary={{
                onOpenClaim: setOpenClaim,
                onPhotos: () => go("photos"),
                onWrite: cardId ? writeNote : undefined,
                onRemoveNote: unwriteNote,
                sender,
                notesSm8,
                flags,
                flagsBusy,
                focusFlagged: flagFocus,
                replyFor,
                onReplyShown: () => setReplyFor(null),
                onReply: replyNote,
                onSendCopy: sendCopy,
                onTakeBack: takeBack,
                onMarkDone: markDone,
                onUndoDone: undoDone,
                onConfirm: confirmLink,
              }}
              onToast={onToast}
              aside={
                <section className="jc-cust" aria-label="The customer">
                  <JobCustomer detail={detail} onEdit={customerEdit && cardId ? () => setEditingCustomer(true) : undefined} />
                  {/* a tracked job wears its board, as the card's chip did */}
                  {row.tracked && (
                    <Button kind="quiet" size={32} onClick={() => onOpenTracked(row.tracked!)}>
                      {row.tracked.kind === "visit" ? "Open it on the maintenance board" : "Open it on the projects board"}
                    </Button>
                  )}
                </section>
              }
            />
          </div>
          {faceMoney}
          {faceVisits}
          {faceChecklist}
          {facePhotos}
          {faceQuote}
          {faceDocuments}
        </div>
        {footer}
      </div>
      {/* the dialogs portal, as the card's do: the page's own stacking
          context would trap a fixed layer under the frame */}
      {hydrated && createPortal(dialogs, document.body)}
    </>
  );
}
