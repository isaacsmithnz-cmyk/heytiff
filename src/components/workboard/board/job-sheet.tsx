"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { ViewTabs, type ViewTab } from "@/components/shell/view-tabs";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import {
  createProjectFromJob,
  readJobFiles,
  readJobRecord,
  readMirrorJob,
  type JobRecordRead,
} from "@/app/actions/workboard";
import type { JobSummaryRead } from "@/lib/workboard/job-summary";
import {
  collectionAgainst,
  fmtQuantity,
  materialsTaxMixed,
  materialsTotalCents,
  paymentsTotalCents,
} from "@/lib/workboard/job-ledger";
import { claimFor, claimTitle, isPartialInvoiceLine } from "@/lib/workboard/job-family";
import { buildJobStory, storyStamp } from "@/lib/workboard/job-story";
import { JobClaimModal } from "./job-claim-modal";
import { JobMoneyBlock } from "./job-money-block";
import { JobSummaryFace } from "./job-summary-face";
import { JobDiaryFace } from "./job-diary-face";
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
import { SwmsWizard } from "@/components/swms/swms-wizard";
import { listSwmsForJob } from "@/app/actions/swms";
import { uploadFile } from "@/lib/documents/upload-client";
import { attachJobDocument, removeJobDocument } from "@/app/actions/job-documents";
import {
  addJobPapers,
  emailJobDocuments,
  listJobPapers,
  readComplianceChoices,
  readEmailDraft,
  removeJobPaper,
  renewJobPaper,
} from "@/app/actions/job-compliance";
import { readJobSm8, sendJobDocumentsToServiceM8, type JobSm8Read } from "@/app/actions/job-sm8";
import { sendFailure, sendToast } from "@/lib/integrations/sm8-write-plan";
import {
  ourDocumentSendKey,
  paperLabel,
  paperSendable,
  paperSendKey,
  theirFileSendKey,
  type JobPaper,
  type JobPapersRead,
} from "@/lib/compliance/papers";
import type { SwmsSummary } from "@/lib/swms/query";
import { andList } from "@/lib/swms/library";
import { fileTypeForMime, type JobMediaItem } from "@/lib/workboard/job-media";
import { todayInAu } from "@/lib/au-dates";
import { JobMediaViewer } from "./job-media-viewer";
import { DocumentsSend } from "./documents-send";
import {
  listJobPhotoFavourites,
  setJobPhotoFavourite,
} from "@/app/actions/job-photo-favourites";
import { JobAttentionStrip } from "./job-attention-strip";
import { useNoteScopeTarget } from "@/components/notes/note-context";
import { addJobNote, dismissJobNote, removeJobNote, taskFromJobNote } from "@/app/actions/job-notes";
import { clearFlag } from "@/app/actions/workboard-notes";
import type { JobAttention } from "@/lib/workboard/job-attention";
import type { OurJobNote } from "@/lib/workboard/job-notes-query";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import {
  fmtMinutesAsHours,
  sm8TimeOf,
  sm8Tone,
  type AllJobRow,
} from "@/lib/workboard/all-jobs";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
import { catTintVars } from "@/lib/workboard/card-tint";
import { syncedAgo, type Sm8Health } from "./sm8-chip";
import { useHydrated } from "@/lib/use-hydrated";
import type { ScheduleJobState } from "./schedule-tab";

/* One ServiceM8 job, read-only — a CARD OF TABS.

   READ-ONLY IS THE WHOLE POSTURE. ServiceM8 is mirrored under a read
   charter; nothing here writes back, and the sheet says so rather than
   offering controls that would lie. What it DOES offer is promotion — the
   Actions tab, last on purpose, where the ⋯ menu retired.

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

/** How many visits the face shows before it offers the rest. Live, the
    median job has 2 sessions, one in ten runs past 12 and the worst runs to
    103 — so the list has to hold its shape without a scrollbar of its own. */
const VISITS_SHOWN = 6;

/** The card's faces. A door that knows which face it wants opens on it
    with `initialTab`. */
export type JobSheetTab =
  | "summary"
  | "diary"
  | "money"
  | "visits"
  | "checklist"
  | "photos"
  | "documents";
type TabKey = JobSheetTab;

/** A SWMS version as a page the card's viewer can hold — the printable
    document, which carries its own Print button and its own version. */
const swmsPaper = (versionId: string): JobMediaItem => ({
  remoteId: `swms:${versionId}`,
  name: "Safe Work Method Statement",
  /* the viewer frames paper by its type; the document is a page, framed the same way */
  fileType: "pdf",
  kind: "document",
  origin: null,
  takenAt: null,
  url: `/swms/${versionId}`,
  width: null,
  height: null,
  fromClaim: null,
});

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

export function JobSheet({
  row,
  manage,
  moneyVisible,
  sm8 = null,
  scheduleState = null,
  initialTab,
  onClose,
  onCreateAgreement,
  onOpenTracked,
  onToast,
}: {
  row: AllJobRow;
  manage: boolean;
  moneyVisible: boolean;
  /** The mirror's own health — the same object the board's chip reads, so
      the card and the board can never disagree about how fresh this is. */
  sm8?: Sm8Health | null;
  /** What today's diary says the job is doing — set only when a schedule
      block opened this sheet, so the header carries the same reading the rail
      drew (the "!" and the hollow cap, in words). */
  scheduleState?: ScheduleJobState | null;
  /** The face to open on, for a door that knows what it came for — a
      mention opens the job's Diary. Summary otherwise, and Summary for Money
      without the grant, because that face is absent. */
  initialTab?: JobSheetTab;
  onClose: () => void;
  /** Hands this job to the existing new-agreement modal, prefilled. */
  onCreateAgreement: (row: AllJobRow, detail: MirrorJobDetail | null) => void;
  /** Follows the tracked chip to the board that already holds this job. */
  onOpenTracked: (tracked: NonNullable<AllJobRow["tracked"]>) => void;
  onToast: (message: string) => void;
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
  const [ourNotes, setOurNotes] = useState<OurJobNote[] | null>(null);
  const [attention, setAttention] = useState<JobAttention | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>(() =>
    initialTab && (initialTab !== "money" || moneyVisible) ? initialTab : "summary"
  );
  const [naming, setNaming] = useState(false);
  const [allVisits, setAllVisits] = useState(false);
  /* The claim this card was opened FOR, when a clone's row was clicked. It
     names the row in the ledger — the card is always the job. */
  const [focus, setFocus] = useState<string | null>(null);
  /* Which claim's modal is open, and whether the number's list is showing. */
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [numbersOpen, setNumbersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /* THE JOB'S SWMS, and the wizard when it is open — a new one, or the next
     version of one (`revise` names the version it replaces). Null until the
     read lands, like the files. */
  const [swms, setSwms] = useState<SwmsSummary[] | null>(null);
  const [swmsFailed, setSwmsFailed] = useState(false);
  const [swmsWizard, setSwmsWizard] = useState<{ revise: string | null } | null>(null);
  /* THE BUSINESS'S PAPERS ON THIS JOB, and what this viewer may do with them
     — its own read on its own clock, like the SWMS. */
  const [papers, setPapers] = useState<JobPapersRead | null>(null);
  const [papersFailed, setPapersFailed] = useState(false);
  /* WHAT IS TICKED TO SEND, by send key (lib/compliance/papers), and whether
     the email is open in the footer. The card holds both: the ticks live on
     the Documents face and the letter in the footer below it. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [writing, setWriting] = useState(false);
  /* SERVICEM8, THE OTHER DOOR: what has gone from this job and whether this
     viewer gets the button, and why the last press left files behind. */
  const [sm8Read, setSm8Read] = useState<JobSm8Read | null>(null);
  const [sm8Note, setSm8Note] = useState<string | null>(null);
  /* ONE ROW PER FILE. A file we sent comes back as ServiceM8's own once the
     next sync mirrors it; the server leaves that copy off every face and the
     story (lib/integrations/sm8-echo), by the uuid we sent it under. */
  const media = mediaRead;
  /* The shared viewer: a photo (by its place in the photos lens) or one
     PDF's paper. Closing it lands the reader exactly where they were. */
  const [viewer, setViewer] = useState<
    | { kind: "photos"; id: string }
    | { kind: "paper"; id: string }
    /* a SWMS is paper HeyTiff writes, so it opens in the same viewer as the
       job's other paper instead of a new tab that loses the card */
    | { kind: "swms"; id: string }
    /* a licence or certificate on the job — its pages, by where the arrows are */
    | { kind: "papers"; id: string; index: number }
    | null
  >(null);
  /* Only a REFRESHED paragraph lives in state; the stored one rides the
     record read, so "fresh ?? stored" needs no state mirroring. */
  const [freshSummary, setFreshSummary] = useState<JobSummaryRead | null>(null);
  /* The refresh kick ANSWERED (words or not) — the one input to the summary
     slot's skeleton that a render can't derive from what has landed. */
  const [kickAnswered, setKickAnswered] = useState(false);
  /* The files read ANSWERED — even empty-handed. `media` alone can't say:
     a failed read leaves it null forever, exactly like one still in flight. */
  const [filesAnswered, setFilesAnswered] = useState(false);
  const [name, setName] = useState("");
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /* Whether the reader has chosen a tab themselves — the one thing that
     outranks the clone-open landing on Money. A face the door asked for is
     that choice made on the reader's behalf, and outranks it the same way. */
  const touchedTab = useRef(initialTab !== undefined);
  const alive = useRef(true);

  useEffect(() => {
    /* Set on the way IN, not only initialised: Strict Mode mounts, cleans
       up and mounts again, and a ref survives that round trip — without
       this line the second mount inherited `false` and the summary refresh
       threw its own answer away. */
    alive.current = true;
    closeRef.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      /* INNERMOST FIRST. Closing the whole card out from under an open claim
         is the classic nested-dismiss bug. The SWMS wizard answers its own
         Escape — it asks before throwing choices away. */
      if (swmsWizard) return;
      if (viewer) {
        setViewer(null);
        return;
      }
      if (openClaim) {
        setOpenClaim(null);
        return;
      }
      if (numbersOpen) {
        setNumbersOpen(false);
        return;
      }
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, numbersOpen, openClaim, menuOpen, viewer, swmsWizard]);

  useEffect(() => {
    if (!numbersOpen) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement)?.closest?.(".wb2-shnos")) setNumbersOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [numbersOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement)?.closest?.(".wb2-shmenu")) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [menuOpen]);

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

  /* A CLONE'S ROW OPENS ITS PARENT, landing on the Money face with that
     claim's ledger row named — the walked #556 behaviour, kept through the
     move onto tabs. Only until the reader chooses a tab themselves. */
  useEffect(() => {
    if (focus && moneyVisible && !touchedTab.current) setTab("money");
  }, [focus, moneyVisible]);

  /* THE COMPANION READS FOLLOW THE CARD, not the row that was clicked. A
     clone's row opens its parent, so asking for the clone's files, ledger or
     picklist would fetch a different job's answers into this card. */
  const cardId = detail?.remoteId ?? null;

  useEffect(() => {
    if (!cardId) return;
    let live = true;
    void readJobFiles(cardId)
      .then((m) => {
        if (live) {
          setMedia(m);
          setFilesAnswered(true);
        }
      })
      .catch(() => {
        /* an answered failure still ANSWERS — the summary slot's skeleton
           must not wait on a derive that can no longer come */
        if (live) setFilesAnswered(true);
      });
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

  /* The job's SWMS — ours, written by the wizard. Its own clock like the
     files; a read that fails reads as none rather than taking the card down,
     and the wizard can still be opened. */
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    void listSwmsForJob(cardId)
      .then((list) => {
        if (!live) return;
        setSwms(list);
        setSwmsFailed(false);
      })
      .catch(() => {
        /* NOT an empty list: that offered Create SWMS on a job that may
           already have one, and a second press was a second SWMS */
        if (live) setSwmsFailed(true);
      });
    return () => {
      live = false;
    };
  }, [cardId]);

  /* PAPER WE FILE OURSELVES — the Documents face's upload. The bytes take the
     shared slot flow, the row is pointed at this job, and the files are read
     again so the row is on the face by the time its button says it's done.
     The face runs a batch one file at a time and says which of them didn't
     land. */
  const uploadDocument = async (file: File): Promise<string | null> => {
    if (!cardId) return "This card doesn't know its job yet.";
    try {
      const up = await uploadFile(file, "job_document");
      if (!up.ok) return up.error;
      if (up.file.previewUrl) URL.revokeObjectURL(up.file.previewUrl);
      /* a file that lands on no job is taken back out by the server */
      const put = await attachJobDocument(up.file.documentId, cardId);
      if (!put.ok) return put.error;
      const fresh = await readJobFiles(cardId).catch(() => null);
      if (alive.current && fresh) setMedia(fresh);
      return null;
    } catch {
      return "That upload didn't finish.";
    }
  };

  /* One of OURS off the job. Off the face at once — the read would only
     confirm what the answer already said. */
  const removeDocument = async (item: JobMediaItem): Promise<string | null> => {
    if (!item.documentId) return "ServiceM8's files stay in ServiceM8.";
    try {
      const res = await removeJobDocument(item.documentId);
      if (!res.ok) return res.error;
      if (alive.current)
        setMedia((m) =>
          m ? { ...m, documents: m.documents.filter((d) => d.remoteId !== item.remoteId) } : m
        );
      return null;
    } catch {
      return "Couldn't remove that file.";
    }
  };

  const reloadSwms = () => {
    if (!cardId) return;
    void listSwmsForJob(cardId)
      .then((list) => {
        if (!alive.current) return;
        setSwms(list);
        setSwmsFailed(false);
      })
      .catch(() => {
        if (alive.current) setSwmsFailed(true);
      });
  };

  /* The job's licences and insurance — ours, put on it from the Documents
     face. A read that fails says so on the face rather than drawing an empty
     Compliance group that looks true. */
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    void listJobPapers(cardId)
      .then((read) => {
        if (!live) return;
        setPapers(read);
        setPapersFailed(false);
      })
      .catch(() => {
        if (live) setPapersFailed(true);
      });
    /* what has gone to ServiceM8 from here; a read that fails leaves the
       rows without their ServiceM8 words and the footer without the door */
    void readJobSm8(cardId)
      .then((read) => {
        if (live) setSm8Read(read);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cardId]);

  const reloadPapers = async (): Promise<JobPapersRead | null> => {
    if (!cardId) return null;
    const read = await listJobPapers(cardId).catch(() => null);
    if (alive.current && read) {
      setPapers(read);
      setPapersFailed(false);
    }
    return read;
  };

  const tick = (key: string, on: boolean) => {
    /* the footer's "wasn't sent" was about the ticks as they were */
    setSm8Note(null);
    setPicked((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  /* Put ticked papers on the job. What was just added is most often what is
     about to be sent, so it arrives ticked — the footer's Email documents is
     the next press, not a hunt back down the list. */
  const addPapers = async (keys: string[]): Promise<string | null> => {
    if (!cardId) return "This card doesn't know its job yet.";
    const res = await addJobPapers(cardId, keys).catch(() => ({
      ok: false as const,
      error: "Couldn't add them to the job.",
    }));
    if (!res.ok) return res.error;
    const fresh = await reloadPapers();
    if (alive.current && fresh?.may.send && res.added.length > 0)
      setPicked((cur) => new Set([...cur, ...res.added.map(paperSendKey)]));
    return null;
  };

  /* Off the face at once — the read would only confirm what the answer said. */
  const removePaper = async (paper: JobPaper): Promise<string | null> => {
    const res = await removeJobPaper(paper.id).catch(() => ({
      ok: false as const,
      error: "Couldn't take that off the job.",
    }));
    if (!res.ok) return res.error;
    if (alive.current) {
      setPapers((cur) => (cur ? { ...cur, papers: cur.papers.filter((p) => p.id !== paper.id) } : cur));
      tick(paperSendKey(paper.id), false);
    }
    return null;
  };

  const renewPaper = async (paper: JobPaper): Promise<string | null> => {
    const res = await renewJobPaper(paper.id).catch(() => ({
      ok: false as const,
      error: "Couldn't switch to the renewal.",
    }));
    if (!res.ok) return res.error;
    await reloadPapers();
    return null;
  };

  /* THE TICKS AS THE LETTER WILL NAME THEM — read off what the face holds
     now, so a paper taken off or a file that went away is simply not sent
     rather than sent as a name with nothing behind it. */
  const pickedList = useMemo(() => {
    const out: { key: string; name: string }[] = [];
    for (const p of papers?.papers ?? []) {
      const key = paperSendKey(p.id);
      if (picked.has(key) && paperSendable(p)) out.push({ key, name: paperLabel(p) });
    }
    for (const d of media?.documents ?? []) {
      const key = d.documentId ? ourDocumentSendKey(d.documentId) : theirFileSendKey(d.remoteId);
      if (picked.has(key) && d.url) out.push({ key, name: d.name });
    }
    return out;
  }, [picked, papers, media]);

  const sendDocuments = async (input: { to: string[]; subject: string; message: string }): Promise<string | null> => {
    if (!cardId) return "This card doesn't know its job yet.";
    const res = await emailJobDocuments({
      jobUuid: cardId,
      keys: pickedList.map((p) => p.key),
      ...input,
    }).catch(() => ({ ok: false as const, error: "The email didn't send. Try again in a minute." }));
    if (!res.ok) return res.error;
    if (alive.current) {
      setPicked(new Set());
      setWriting(false);
      /* the diary says what went, the moment it went */
      const note = res.note;
      if (note) setOurNotes((cur) => [note, ...(cur ?? [])]);
      onToast(`Email sent to ${andList(res.to)}`);
    }
    return null;
  };

  /* SEND TO SERVICEM8. The press waits for its files; what went is unticked
     and said in a toast, and what didn't keeps its tick and says why in the
     footer — pressing again tries it again. Every row's words come from the
     sends the answer carries, so the face is true the moment it returns. */
  const sendToServiceM8 = async (): Promise<void> => {
    if (!cardId) return;
    setSm8Note(null);
    const names = new Map(pickedList.map((p) => [p.key, p.name]));
    const res = await sendJobDocumentsToServiceM8({
      jobUuid: cardId,
      keys: pickedList.map((p) => p.key),
    }).catch(() => ({ ok: false as const, error: "Couldn't reach HeyTiff. Try again." }));
    if (!alive.current) return;
    if (!res.ok) {
      setSm8Note(res.error);
      return;
    }
    setSm8Read((cur) => (cur ? { ...cur, sends: res.sends } : cur));
    const stay = new Set(res.failed.map((f) => f.key));
    setPicked((cur) => new Set([...cur].filter((k) => stay.has(k))));
    const nameOf = (key: string) => names.get(key) ?? "A document";
    const toast = sendToast(res, nameOf);
    if (toast) onToast(toast);
    setSm8Note(sendFailure(res.failed, nameOf));
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
      })
      .catch(() => {
        if (live) setRecordFailed(true);
      });
    return () => {
      live = false;
    };
  }, [cardId]);

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

  const summary = freshSummary ?? record?.summary ?? null;
  const money = moneyVisible ? (detail?.money ?? null) : null;
  const materials = (record?.ledger?.materials ?? []).filter((m) => !isPartialInvoiceLine(m));
  const family = record?.family ?? null;
  /* The card's own number — the PARENT's, even when a claim's row opened it. */
  const cardNumber = detail?.jobNumber ?? row.number ?? null;
  const focusClaim = claimFor(family, focus);
  /* Every header fact follows the CARD once the detail lands; until then the
     row's own facts paint, which is what was clicked. */
  const cardDate = detail ? detail.dateOn : dayOf(row.date);
  const cardDateLabel = detail?.dateLabel ?? row.dateLabel;
  const cardStatus = detail?.status ?? row.statusLabel;
  const cardTone = detail ? sm8Tone(detail.status) : row.tone;
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

  /* The door back to ServiceM8, and the card's own freshness in the same
     chip — the board's chip says this behind the scrim, and the card is
     what you are actually reading. The clock is CLIENT-ONLY for the reason
     sm8-chip.tsx spells out: `syncedAgo` reads Date.now(), and a server that
     rendered "just now" against a client that renders "1 min ago" is a
     hydration failure that takes the whole tree down. */
  const hydrated = useHydrated();
  const sm8Href = sm8JobUrl(cardId ?? row.id);
  const sm8Line = !sm8
    ? "Open in ServiceM8"
    : sm8.attention
      ? "ServiceM8 needs attention"
      : sm8.running
        ? "ServiceM8 syncing…"
        : hydrated
          ? `ServiceM8, synced ${syncedAgo(sm8.syncedAt)}`
          : "ServiceM8";
  const categoryColour = detail?.categoryColour ?? row.categoryColour ?? null;
  const categoryName = detail?.categoryName ?? row.categoryName ?? null;

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
              workOrderDate: detail.workOrderDate,
              completionDate: detail.completionDate,
              visits: detail.visits,
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
     story's stamp has left the stored summary behind. The route re-derives
     and re-compares server-side, so a confused client costs queries, never a
     second model call. */
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
      .then((r) => r.json())
      .then((res: { ok?: boolean; summary?: JobSummaryRead | null }) => {
        if (alive.current && res?.ok && res.summary) setFreshSummary(res.summary);
      })
      .catch(() => {
        /* a summary that won't refresh keeps its stored words */
      })
      .finally(() => {
        if (alive.current) setKickAnswered(true);
      });
  }, [cardId, detail, record, recordFailed, media, picklist, story]);

  /* WHETHER THE SUMMARY SLOT STILL WAITS — derived at render, mirroring the
     kick's own gates, because every branch but one is knowable from what has
     already landed. The one fact a render can't derive is whether the kick
     has answered; that is the only state (`kickAnswered`, set async above —
     the compiler's no-sync-setState-in-effects rule is why this is not an
     effect writing a `settled` flag). */
  const summaryPending = (() => {
    if (recordFailed || summary !== null) return false;
    if (record === undefined) return true; // the record read is still out
    if (record === null) return false; // landed empty — nothing is coming
    if (media === null || picklist === null) {
      /* companions still out — unless the files read answered EMPTY-HANDED,
         which never unblocks the kick's gate (the picklist's catch lands
         [], so null there always means "not yet") */
      return !filesAnswered || picklist === null;
    }
    const stamp = storyStamp(story);
    if (!stamp || record.summary?.stamp === stamp) return false; // nothing to derive
    return !kickAnswered; // the kick is out — words or nothing, shortly
  })();

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
      router.push(`/dashboard/workboard/projects/${res.id}`);
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
      .catch(() => {
        setPicklist((cur) =>
          (cur ?? []).map((p) =>
            p.id === id ? { ...p, picked: !next, pickedAt: null, pickedBy: null } : p
          )
        );
        onToast("Could not save that tick");
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
    void dismissJobNote(cardId, noteUuid).catch(() => {
      setAttention(before);
      onToast("Could not put that aside");
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
      .catch(() => {
        setAttention(before);
        onToast("Could not save that task");
      });
  };

  /* THE PEN. A note typed at the diary's head is a diary entry the moment it
     lands — no round trip to look at first, which is what makes it a diary
     rather than a form. The SAVED row replaces the optimistic one because
     the browser knows its own auth id and not the display name behind it;
     slice 3 shipped that defect on the checklist's stamps and this is the
     same fix, applied before it could happen twice. */
  const writeNote = (body: string) => {
    if (!cardId) return;
    const text = body.trim();
    if (!text) return;
    const temp: OurJobNote = {
      id: `tmp-${Date.now()}`,
      text,
      at: new Date().toISOString(),
      author: null,
    };
    setOurNotes((cur) => [temp, ...(cur ?? [])]);
    void addJobNote(cardId, text)
      .then((saved) => {
        setOurNotes((cur) => (cur ?? []).map((n) => (n.id === temp.id ? saved : n)));
      })
      .catch(() => {
        setOurNotes((cur) => (cur ?? []).filter((n) => n.id !== temp.id));
        onToast("Could not save that note");
      });
  };

  const unwriteNote = (id: string) => {
    const before = ourNotes;
    setOurNotes((cur) => (cur ?? []).filter((n) => n.id !== id));
    void removeJobNote(id).catch(() => {
      setOurNotes(before);
      onToast("Could not remove that note");
    });
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
      .catch(() => {
        if (!alive.current) return;
        paint(!on);
        onToast("Could not save that star");
      });
  };

  const removeChecklistItem = (id: string) => {
    setPicklist((cur) => (cur ?? []).filter((p) => p.id !== id));
    void removePicklistItem(id).catch(() => onToast("Could not remove that line"));
  };

  const addChecklistItem = (input: { kind: "material" | "todo"; name: string; qty: string }) => {
    if (!cardId) return;
    const temp: JobPicklistItem = {
      id: `tmp-${Date.now()}`,
      name: input.name,
      sub: "",
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
      .catch(() => {
        setPicklist((cur) => (cur ?? []).filter((p) => p.id !== temp.id));
        onToast("Could not add that row");
      });
  };

  /* THE TAB SET IS FIXED FROM FIRST PAINT — the money grant is known at
     open, so no face pops in as a read lands and the thumb never jumps.
     Once-per-job acts live behind the band's ⋯, not on a face: two buttons
     never earned one. */
  const tabs: ViewTab[] = [
    { key: "summary", label: "Summary" },
    { key: "diary", label: "Diary" },
    ...(moneyVisible ? [{ key: "money", label: "Money" }] : []),
    { key: "visits", label: "Visits" },
    { key: "checklist", label: "Checklist" },
    { key: "photos", label: "Photos" },
    { key: "documents", label: "Documents" },
  ];

  const go = (key: string) => {
    touchedTab.current = true;
    if (key !== "diary") setFlagFocus(false);
    setTab(key as TabKey);
  };

  const panel = (key: TabKey, body: React.ReactNode) => (
    <section
      className="wb2-jcface"
      id={`jcsec-${key}`}
      role="tabpanel"
      aria-labelledby={`jctab-${key}`}
      hidden={tab !== key}
    >
      {body}
    </section>
  );

  /* The band's date chip. When the date's meaning IS the status ("completed",
     "quoted", "closed") it rides inside the status chip as one statement;
     "raised" and "booked" are their own facts and wear their own chip. */
  const dateStandsAlone = cardDateLabel === "raised" || cardDateLabel === "booked";

  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      <aside
        className="wb2-sheet jc"
        role="dialog"
        aria-modal="true"
        aria-label={`${row.clientName ?? "Job"}${row.number ? ` — job ${row.number}` : ""}`}
        style={catTintVars(categoryColour)}
      >
        <div className="wb2-jcband">
          <div className="wb2-shtop">
            {/* THE NUMBER IS THE NAVIGATION. A job ServiceM8 billed in stages
                wears a caret that lists its claims; a card opened FROM a claim
                wears the crumb "#2380 › #2380A". */}
            <span className="wb2-shnos">
              {family && family.isFamily && family.claims.length > 1 ? (
                <button
                  className="wb2-shno open"
                  onClick={() => setNumbersOpen((v) => !v)}
                  aria-expanded={numbersOpen}
                  title={`${family.claims.length} invoices on this job`}
                >
                  {cardNumber ? `#${cardNumber}` : "—"}
                  <i className="wb2-shcar" aria-hidden>
                    ▾
                  </i>
                </button>
              ) : (
                <span className="wb2-shno">{cardNumber ? `#${cardNumber}` : "—"}</span>
              )}
              {focusClaim && (
                <>
                  <i className="wb2-shcrumb" aria-hidden>
                    ›
                  </i>
                  <button
                    className="wb2-shno here"
                    onClick={() => setOpenClaim(focusClaim.remoteId)}
                    title={`${claimTitle(focusClaim)} — open it`}
                  >
                    {focusClaim.jobNumber ? `#${focusClaim.jobNumber}` : "—"}
                  </button>
                </>
              )}
              {numbersOpen && family && (
                <span className="wb2-shnopop">
                  {family.claims.map((c) => (
                    <button
                      key={c.remoteId}
                      className={c.remoteId === focus ? "on" : undefined}
                      onClick={() => {
                        setNumbersOpen(false);
                        setOpenClaim(c.remoteId);
                      }}
                    >
                      <span className="n">{c.jobNumber ? `#${c.jobNumber}` : "—"}</span>
                      <span className="t">{claimTitle(c)}</span>
                      <span className="a">
                        {c.amountCents !== null ? fmtAud(c.amountCents) : "—"}
                      </span>
                    </button>
                  ))}
                </span>
              )}
            </span>
            <span className="wb2-jcid">
              <h2 className="wb2-shname">
                {detail?.clientName ?? row.clientName ?? "Unnamed client"}
              </h2>
              <p className="wb2-jcaddr">
                {detail?.address ?? detail?.geoLine ?? row.suburb ?? "No address on the job"}
              </p>
            </span>
            <span className="wb2-shchips">
              {focusClaim && <span className="wb2-chip cat">{claimTitle(focusClaim)}</span>}
              {/* THE CHIP IS THE DOOR — the shape the tracked chip proved.
                  It used to read "ServiceM8 job", which is a fact the reader
                  already had (every job on this board is one); it says how
                  fresh the card is instead, and opens the job over there.
                  NOT in the ⋯: that menu renders only for someone who can
                  create projects, and getting back to ServiceM8 is not a
                  manager's action. */}
              {sm8Href ? (
                <a
                  className={"wb2-chip door" + (sm8?.attention ? " dan" : "")}
                  href={sm8Href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="ServiceM8 owns this job — HeyTiff only reads it. Edit it over there and the change follows here on the next sync. Opens the job in ServiceM8."
                >
                  {sm8Line}
                  <Icon name="arrowUR" size={12} />
                </a>
              ) : (
                <span
                  className="wb2-chip"
                  title="ServiceM8 owns this job — HeyTiff only reads it. Edit it over there and the change follows here on the next sync."
                >
                  {sm8Line}
                </span>
              )}
              {cardStatus && (
                <span className={"wb2-chip" + (cardTone ? ` ${cardTone}` : "")}>
                  {cardStatus}
                  {!dateStandsAlone && cardDate ? `, ${fmtAuWeekdayDayMonth(cardDate)}` : ""}
                </span>
              )}
              {dateStandsAlone && cardDate && (
                <span className="wb2-chip">
                  {`${cardDateLabel === "booked" ? "Booked" : "Raised"} ${fmtAuWeekdayDayMonth(cardDate)}`}
                </span>
              )}
              {scheduleState && (
                <span className={"wb2-chip" + (scheduleState.kind === "late" ? " dan" : "")}>
                  {scheduleState.kind === "late" && (
                    <i className="wb2-shbang" aria-hidden="true">
                      !
                    </i>
                  )}
                  {scheduleState.word}
                </span>
              )}
              {categoryName && (
                <span className="wb2-chip">
                  {categoryColour && (
                    <i className="wb2-catdot" style={{ background: categoryColour }} aria-hidden />
                  )}
                  {categoryName}
                </span>
              )}
              {/* A TRACKED JOB WEARS ITS BOARD. The door used to hide on the
                  Actions face; a fact this useful belongs where the chips
                  are, and the chip IS the door. */}
              {row.tracked && (
                <button
                  className="wb2-chip blue"
                  onClick={() => onOpenTracked(row.tracked!)}
                  title={`Open ${row.tracked.label}`}
                >
                  {row.tracked.kind === "visit"
                    ? "On the maintenance board"
                    : "On the projects board"}
                  <i className="wb2-shcar" aria-hidden>
                    ›
                  </i>
                </button>
              )}
            </span>
            {/* THE WAYS OUT OF THIS JOB, back behind the ⋯. They spent one
                release as an Actions face — two ghost buttons alone on a
                page — and a face that sparse reads as broken. A disclosure,
                not an ARIA menu widget: role="menu" promises arrow-key
                navigation, and promising it without implementing it is worse
                for a screen reader than two plain buttons. */}
            {manage && (
              <span className="wb2-shmenu">
                <button
                  className="wb2-ico"
                  onClick={() => setMenuOpen((v) => !v)}
                  title="More"
                  aria-label="More actions"
                  aria-expanded={menuOpen}
                >
                  <Icon name="dots" size={14} />
                </button>
                {menuOpen && (
                  <span className="wb2-shmpop">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setMenuOpen(false);
                        setName(row.clientName ?? "");
                        setNaming(true);
                      }}
                    >
                      <Icon name="plus" size={14} />
                      Create a project from this job
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setMenuOpen(false);
                        onCreateAgreement(row, detail);
                      }}
                    >
                      <Icon name="file" size={14} />
                      Create a maintenance agreement
                    </button>
                  </span>
                )}
              </span>
            )}
            <button
              ref={closeRef}
              className="wb2-ico"
              onClick={onClose}
              title="Close"
              aria-label="Close"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          {/* ABOVE THE TABS, ON EVERY FACE. The strip outranks the row for
              the same reason it outranks the summary: what needs you beats
              where it's up to. It draws nothing at all on a quiet job. */}
          {attention && (
            <JobAttentionStrip
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
            />
          )}

          <ViewTabs
            items={tabs}
            active={tab}
            onGo={go}
            ariaLabel="Job card"
            idPrefix="jctab"
            panelPrefix="jcsec"
          />
        </div>

        <div className="wb2-jcbody">
          {err && <div className="wb2-sherr">{err}</div>}

          {panel(
            "summary",
            <JobSummaryFace
              loading={loading}
              detail={detail}
              row={row}
              summary={summary}
              pending={summaryPending}
            />
          )}

          {panel(
            "diary",
            <JobDiaryFace
              focusFlagged={flagFocus}
              entries={story}
              loading={loading && !detail}
              moneyVisible={moneyVisible}
              onOpenClaim={setOpenClaim}
              onPhotos={() => go("photos")}
              /* The pen waits for the card to know WHICH job it is — a note
                 saved against a guess is worse than a note that waits a
                 beat. */
              onWrite={cardId ? writeNote : undefined}
              onRemoveNote={unwriteNote}
            />
          )}

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
                    />
                  ) : (
                    <p className="int-hint">Reading the figures…</p>
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

          {panel(
            "visits",
            <>
              {/* SITE VISITS IS ONE SECTION — the next booking FIRST, in the
                  accent, then every past visit under the same roof. */}
              {detail?.nextBooking && (
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
              {detail && detail.visits.length > 0 ? (
                <div className="wb2-jcsec">
                  {/* Every single-list face wears the same head — a real
                      title with its fact at the right. Visits was the one
                      still dressed as a small-caps eyebrow. */}
                  <div className="wb2-jcdhead">
                    <b>Visits</b>
                    <em>
                      {`${detail.visits.length} visit${detail.visits.length === 1 ? "" : "s"}`}
                      {detail.timeOnSite
                        ? `, ${fmtMinutesAsHours(detail.timeOnSite.minutes)} on site`
                        : ""}
                    </em>
                  </div>
                  {(allVisits ? detail.visits : detail.visits.slice(0, VISITS_SHOWN)).map((v) => (
                    <div className="wb2-mline visit" key={v.day}>
                      <b>{fmtAuWeekdayDayMonth(v.day)}</b>
                      {/* A NAME PLUS WHAT THEY ARE — the only place on the
                          card a title appears, because this is the only
                          place the card is introducing people rather than
                          naming them: an apprentice day and a senior tech
                          day are different days. */}
                      <em>
                        {v.crew.length === 0
                          ? "Nobody named"
                          : v.crew.map((c, i) => (
                              <span key={c.name}>
                                {/* A comma separates two bare names; once a
                                    title is in the line a comma cannot say
                                    where one person ends, so the pair takes
                                    a dash instead. The dot before a title is
                                    REAL TEXT, not a CSS ::before — jest
                                    never loads the stylesheet, so a
                                    separator that lives only in CSS is one
                                    nothing here can see fail. */}
                                {i > 0 ? (v.crew.some((m) => m.title) ? " — " : ", ") : ""}
                                {c.name}
                                {c.title && (
                                  <i className="wb2-jcrole">{`, ${c.title}`}</i>
                                )}
                              </span>
                            ))}
                      </em>
                      <span>{fmtMinutesAsHours(v.minutes)}</span>
                    </div>
                  ))}
                  {!allVisits && detail.visits.length > VISITS_SHOWN && (
                    <button className="wb2-shmore" onClick={() => setAllVisits(true)}>
                      {`All ${detail.visits.length} visits`}
                      <Icon name="chevR" size={14} />
                    </button>
                  )}
                </div>
              ) : (
                !detail?.nextBooking &&
                !detail?.queue && (
                  <p className="int-hint">
                    {loading && !detail
                      ? "Reading it from the mirror…"
                      : "Nobody's been on site yet, and nothing is booked."}
                  </p>
                )
              )}
            </>
          )}

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

          {panel(
            "documents",
            <JobDocumentsFace
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
              onOpenSwms={(s) => setViewer({ kind: "swms", id: s.versionId })}
              onReviseSwms={(versionId) => setSwmsWizard({ revise: versionId })}
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

          {/* No Actions face. The once-per-job acts live behind the band's
              ⋯; the naming row below is the only floor furniture, and only
              while a project is being named — and the send row, only while
              the Documents face has something ticked. */}
        </div>

        {/* SENDING WHAT'S TICKED — the card's footer, under the scrolling body,
            so the list keeps scrolling above it. Only on the face the ticks
            are on, and never over the naming row. */}
        {tab === "documents" && !naming && cardId && papers?.may.send && (pickedList.length > 0 || writing) && (
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
                  /* Cancels the naming, not the card — without this the
                     document listener closes the whole sheet. */
                  e.stopPropagation();
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
      </aside>

      {/* Over the card, inside the SAME portal — a modal on a modal that
          portals separately is how a scrim ends up above the thing it dims. */}
      {openClaimRow && (
        <JobClaimModal
          key={openClaimRow.remoteId}
          claim={openClaimRow}
          parentNumber={cardNumber}
          onClose={() => setOpenClaim(null)}
        />
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
            setViewer({ kind: "swms", id: versionId });
          }}
          onSignOn={(versionId) => router.push(`/dashboard/swms/${versionId}`)}
        />
      )}

      {viewer?.kind === "swms" && (
        <JobMediaViewer
          items={[swmsPaper(viewer.id)]}
          index={0}
          favourites={null}
          onNav={() => {}}
          onClose={() => setViewer(null)}
        />
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
        viewer.kind !== "swms" &&
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
    </>,
    document.body
  );
}
