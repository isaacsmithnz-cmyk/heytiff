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
import { JobMediaViewer } from "./job-media-viewer";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import {
  fmtMinutesAsHours,
  sm8Tone,
  type AllJobRow,
} from "@/lib/workboard/all-jobs";
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

/** Enough rounds for the busiest job in the live account (a few dozen files
    at six a round), and a hard stop against a server that never converges. */
const MAX_CACHE_ROUNDS = 12;

/** How many visits the face shows before it offers the rest. Live, the
    median job has 2 sessions, one in ten runs past 12 and the worst runs to
    103 — so the list has to hold its shape without a scrollbar of its own. */
const VISITS_SHOWN = 6;

type TabKey =
  | "summary"
  | "diary"
  | "money"
  | "visits"
  | "checklist"
  | "photos"
  | "documents";

const dayOf = (naive: string | null | undefined) =>
  naive && naive.length >= 10 ? naive.slice(0, 10) : null;


/** "7:30am" from a naive local string, by slicing — never by parsing a wall
    clock into a Date, which would shift it by the browser's offset. */
function timeOf(naive: string): string | null {
  const hh = Number(naive.slice(11, 13));
  const mm = naive.slice(14, 16);
  if (Number.isNaN(hh) || !/^\d{2}$/.test(mm)) return null;
  const ampm = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm === "00" ? `${h12}${ampm}` : `${h12}:${mm}${ampm}`;
}

/** "7:30am Thu 14 Aug", or "7:30am–3:30pm Thu 14 Aug" when the booking's end
    is known and lands on the same day. */
function bookingLabel(naive: string, end?: string | null): string {
  const date = dayOf(naive);
  const time = timeOf(naive);
  if (!date || !time) return date ? fmtAuWeekdayDayMonth(date) : naive;
  const endTime = end && dayOf(end) === date ? timeOf(end) : null;
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

/** The band's wash, crown and every echo of the job type's colour, as CSS
    custom properties — the stylesheet holds the neutral fallbacks, so a job
    with no category simply doesn't set these and the band stays grey.
    ServiceM8's palette makes no contrast promise, which is why every alpha
    here is fixed and low: the colour is atmosphere, never text ground. */
export function catTintVars(colour: string | null | undefined): React.CSSProperties | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(colour ?? "");
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  const a = (alpha: number) => `rgba(${rgb},${alpha})`;
  return {
    "--jc-band-a": a(0.18),
    "--jc-band-b": a(0.1),
    "--jc-crown": a(0.55),
    "--jc-soft": a(0.35),
    "--jc-a05": a(0.05),
    "--jc-a025": a(0.025),
  } as React.CSSProperties;
}

export function JobSheet({
  row,
  manage,
  moneyVisible,
  scheduleState = null,
  onClose,
  onCreateAgreement,
  onOpenTracked,
  onToast,
}: {
  row: AllJobRow;
  manage: boolean;
  moneyVisible: boolean;
  /** What today's diary says the job is doing — set only when a schedule
      block opened this sheet, so the header carries the same reading the rail
      drew (the "!" and the hollow cap, in words). */
  scheduleState?: ScheduleJobState | null;
  onClose: () => void;
  /** Hands this job to the existing new-agreement modal, prefilled. */
  onCreateAgreement: (row: AllJobRow, detail: MirrorJobDetail | null) => void;
  /** Follows the tracked chip to the board that already holds this job. */
  onOpenTracked: (tracked: NonNullable<AllJobRow["tracked"]>) => void;
  onToast: (message: string) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<MirrorJobDetail | null>(null);
  const [media, setMedia] = useState<JobMediaGroupsRead | null>(null);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  /* UNDEFINED until the record read lands, null when it lands empty. The
     distinction is load-bearing for the money block: a job ServiceM8 bills
     across three cards reads as $6,268 until the family arrives and $31,340
     after, and painting the wrong number first breaks this sheet's own rule
     that what fills in was ABSENT, not wrong. */
  const [record, setRecord] = useState<JobRecordRead | null | undefined>(undefined);
  const [recordFailed, setRecordFailed] = useState(false);
  const [picklist, setPicklist] = useState<JobPicklistItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("summary");
  const [naming, setNaming] = useState(false);
  const [allVisits, setAllVisits] = useState(false);
  /* The claim this card was opened FOR, when a clone's row was clicked. It
     names the row in the ledger — the card is always the job. */
  const [focus, setFocus] = useState<string | null>(null);
  /* Which claim's modal is open, and whether the number's list is showing. */
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [numbersOpen, setNumbersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /* The shared viewer: a photo (by its place in the photos lens) or one
     PDF's paper. Closing it lands the reader exactly where they were. */
  const [viewer, setViewer] = useState<
    { kind: "photos"; index: number } | { kind: "paper"; id: string } | null
  >(null);
  /* Only a REFRESHED paragraph lives in state; the stored one rides the
     record read, so "fresh ?? stored" needs no state mirroring. */
  const [freshSummary, setFreshSummary] = useState<JobSummaryRead | null>(null);
  const [name, setName] = useState("");
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /* Whether the reader has chosen a tab themselves — the one thing that
     outranks the clone-open landing on Money. */
  const touchedTab = useRef(false);
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
         is the classic nested-dismiss bug. */
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
  }, [onClose, numbersOpen, openClaim, menuOpen, viewer]);

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
    void readJobFiles(cardId).then((m) => {
      if (live) setMedia(m);
    });
    return () => {
      live = false;
    };
  }, [cardId]);

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
        if (live) setRecord(r);
      })
      .catch(() => {
        if (live) setRecordFailed(true);
      });
    return () => {
      live = false;
    };
  }, [cardId]);

  /* Bringing the bytes across, a few per round, with the BROWSER as the loop.
     Two rails: a hard round cap, and STOP ON NO PROGRESS. */
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
        if (!res.ok || res.cached === 0 || res.remaining === 0) return;
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
        ledger: record?.ledger ?? null,
        family,
        invoicedOn: family?.isFamily ? null : (money?.invoicedOn ?? null),
        media: media ? [...media.photos, ...media.documents, ...media.elsewhere] : null,
        picklist,
        timezone: detail?.timezone ?? null,
      }),
    [detail, record, family, money, media, picklist]
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
    void setPicklistItemPicked(id, next).catch(() => {
      setPicklist((cur) =>
        (cur ?? []).map((p) =>
          p.id === id ? { ...p, picked: !next, pickedAt: null, pickedBy: null } : p
        )
      );
      onToast("Could not save that tick");
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
              <span
                className="wb2-chip"
                title="ServiceM8 owns this job — HeyTiff only reads it. Edit it over there and the change follows here on the next sync."
              >
                ServiceM8 job
              </span>
              {cardStatus && (
                <span className={"wb2-chip" + (cardTone ? ` ${cardTone}` : "")}>
                  {cardStatus}
                  {!dateStandsAlone && cardDate ? ` · ${fmtAuWeekdayDayMonth(cardDate)}` : ""}
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
            <JobSummaryFace loading={loading} detail={detail} row={row} summary={summary} />
          )}

          {panel(
            "diary",
            <JobDiaryFace
              entries={story}
              loading={loading && !detail}
              moneyVisible={moneyVisible}
              onOpenClaim={setOpenClaim}
              onPhotos={() => go("photos")}
            />
          )}

          {moneyVisible &&
            panel(
              "money",
              <>
                {/* MONEY READS ONCE, and it reads here. The block waits for
                    the family read so a family-billed parent never paints its
                    netted total and then corrects itself. */}
                {record !== undefined || recordFailed ? (
                  <JobMoneyBlock
                    family={family}
                    unavailable={recordFailed}
                    money={money}
                    ledgerPaidCents={
                      record?.ledger ? paymentsTotalCents(record.ledger.payments) : 0
                    }
                    statusLabel={row.statusLabel}
                    categoryColour={categoryColour}
                    focusRemoteId={focus}
                    onOpenClaim={setOpenClaim}
                  />
                ) : (
                  <p className="int-hint">Reading the figures…</p>
                )}

                <div className="wb2-jcgrid">
                  {/* PARTIAL-INVOICE ROWS LEAVE THIS LIST. "Partial invoice
                      #2380A × −1" is ServiceM8 subtracting one of its own
                      clones out of the parent — bookkeeping, not something
                      that went on the job. It belongs to the block above,
                      where it IS a claim. */}
                  {materials.length > 0 && (
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
                  )}

                  {record?.ledger && record.ledger.payments.length > 0 && (
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
                              .join(" · ")}
                          </em>
                          <span>{p.amountCents !== null ? fmtAud(p.amountCents) : "—"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
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
                  <em>{detail.nextBooking.staffName ?? "Nobody named"}</em>
                </div>
              )}
              {detail?.queue && (
                <div className="wb2-jcsec">
                  <span className="wb2-sect">In queue</span>
                  <p className="wb2-shtext">
                    <b>{detail.queue.name}</b>
                    {" · "}
                    {[
                      detail.queue.staffName,
                      detail.queue.expiry
                        ? `until ${fmtAuWeekdayDayMonth(detail.queue.expiry)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "waiting"}
                  </p>
                </div>
              )}
              {detail && detail.visits.length > 0 ? (
                <div className="wb2-jcsec">
                  <span className="wb2-sect">
                    {`Visits — ${detail.visits.length}`}
                    {detail.timeOnSite
                      ? ` · ${fmtMinutesAsHours(detail.timeOnSite.minutes)} on site`
                      : ""}
                  </span>
                  {(allVisits ? detail.visits : detail.visits.slice(0, VISITS_SHOWN)).map((v) => (
                    <div className="wb2-mline visit" key={v.day}>
                      <b>{fmtAuWeekdayDayMonth(v.day)}</b>
                      <em>{v.crew.join(", ") || "Nobody named"}</em>
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
              onOpen={(index) => setViewer({ kind: "photos", index })}
            />
          )}

          {panel(
            "documents",
            <JobDocumentsFace
              documents={media ? media.documents : null}
              elsewhere={media ? media.elsewhere : null}
              designs={detail?.designs ?? []}
              loading={media === null}
              truncated={!!media?.truncated}
              onOpen={(item) => setViewer({ kind: "paper", id: item.remoteId })}
            />
          )}

          {/* No Actions face. The once-per-job acts live behind the band's
              ⋯; the naming row below is the only floor furniture, and only
              while a project is being named. */}
        </div>

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

      {/* The shared viewer — same portal, same law as the claim modal. */}
      {viewer && media && (
        <JobMediaViewer
          items={
            viewer.kind === "photos"
              ? media.photos
              : media.documents.filter((d) => d.remoteId === viewer.id)
          }
          index={
            viewer.kind === "photos"
              ? Math.min(viewer.index, Math.max(0, media.photos.length - 1))
              : 0
          }
          onNav={(i) => setViewer(viewer.kind === "photos" ? { kind: "photos", index: i } : viewer)}
          onClose={() => setViewer(null)}
        />
      )}
    </>,
    document.body
  );
}
