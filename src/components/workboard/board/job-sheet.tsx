"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
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
import { claimFor, claimTitle, isPartialInvoiceLine } from "@/lib/workboard/job-family";
import { JobClaimModal } from "./job-claim-modal";
import { JobMoneyBlock } from "./job-money-block";
import { cacheJobFiles } from "@/app/actions/workboard-media";
import {
  listJobPicklist,
  removePicklistItem,
  setPicklistItemPicked,
  type JobPicklistItem,
} from "@/app/actions/job-picklist";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import { JOB_MEDIA_CAP, mediaCountLine } from "@/lib/workboard/job-media";
import {
  fmtMinutesAsHours,
  groupChecklist,
  sm8Tone,
  type AllJobRow,
} from "@/lib/workboard/all-jobs";
import type { ScheduleJobState } from "./schedule-tab";

/* One ServiceM8 job, read-only — and the two ways out of it.

   READ-ONLY IS THE WHOLE POSTURE. ServiceM8 is mirrored under a read charter;
   nothing here writes back, and the sheet says so rather than offering
   controls that would lie. What it DOES offer is promotion: this job becomes
   a project, or the client becomes a maintenance agreement. That is the
   funnel the All jobs side exists for — see an untracked install, put it on a
   board.

   PORTALS TO BODY and reuses `.wb2-sheet`. Both are load-bearing: a dashboard
   modal must portal (`.page.in`'s will-change breaks position:fixed), and
   reusing the class means the portal type-ramp and button restatements apply
   with no new CSS root to keep in step — the bug that made sheet text
   1.17:1 and left ghost buttons unstyled came from exactly that drift.

   OPENS ON WHAT THE ROW ALREADY KNEW, then fills in. A list of 800 rows can't
   carry every description, address and contact, so the row's slim facts paint
   immediately and the detail arrives a beat later. Nothing jumps: the fields
   that fill in were absent, not wrong. */

/** Enough rounds for the busiest job in the live account (a few dozen files
    at six a round), and a hard stop against a server that never converges. */
const MAX_CACHE_ROUNDS = 12;

/** How many visits the card shows before it offers the rest. Live, the median
    job has 2 sessions, one in ten runs past 12 and the worst runs to 103 — so
    the list has to hold its shape without a scrollbar of its own. Three is
    "the last few times we were there", which is the question being asked. */
const VISITS_SHOWN = 3;

const dayOf = (naive: string | null | undefined) =>
  naive && naive.length >= 10 ? naive.slice(0, 10) : null;

/** When a design was last touched. `studio_designs.updated_at` is a real
    timestamptz — a genuine instant, unlike every ServiceM8 stamp on this
    sheet — so it is PARSED and shown in the reader's own zone. The studio's
    contributors card stamps its dates the same way.

    Absolute, not "2 days ago": a relative label needs the clock at render
    time, and `Date.now()` in a render body breaks hydration for the whole
    tree. This block only mounts after the detail fetch, so it would get away
    with it — but the sheet's every other date is absolute anyway. */
const editedOn = (iso: string): string => {
  const d = new Date(iso);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  // through the sheet's own formatter, so this date wears the same shape as
  // every other one beside it ("Fri 14 Aug", not en-AU's "Fri, 14 Aug")
  return fmtAuWeekdayDayMonth(local);
};

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
    is known and lands on the same day. Same approach as the project screen's
    booking label. */
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
    were the contact's. Punctuation a number legitimately wears comes out;
    anything left that isn't a plain international-ish number means the field
    is saying more than one thing, and then it stays text. */
export function telHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const bare = raw.replace(/[\s()\-.]/g, "");
  return /^\+?\d{6,15}$/.test(bare) ? `tel:${bare}` : null;
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
  const [naming, setNaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [allVisits, setAllVisits] = useState(false);
  /* The claim this card was opened FOR, when a clone's row was clicked. It
     only names the row in the ledger — the card is always the job. */
  const [focus, setFocus] = useState<string | null>(null);
  /* Which claim's modal is open, and whether the number's list is showing. */
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [numbersOpen, setNumbersOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      /* INNERMOST FIRST. Closing the whole card out from under an open claim
         is the classic nested-dismiss bug, and there are three things that
         can now be open over it. */
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
  }, [onClose, menuOpen, numbersOpen, openClaim]);

  /* A menu that only closes on its own items is a menu you have to fight.
     Pointerdown rather than click, so it goes before whatever was aimed at. */
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement)?.closest?.(".wb2-shmenu")) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [menuOpen]);

  useEffect(() => {
    if (!numbersOpen) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement)?.closest?.(".wb2-shnos")) setNumbersOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [numbersOpen]);

  /* No setLoading(true) here: the sheet is KEYED BY JOB, so a different job
     is a different component with `loading` already true. Resetting it in the
     effect would be state written during an effect for a case that can't
     happen — and the same "keyed by id, never reset by effect" rule the visit
     sheet follows for its drafts. */
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

  /* The files arrive on their own clock. They cost a storage round trip that
     the rest of the sheet shouldn't wait behind, and a job with none is the
     common case — so this renders nothing at all until it has something to
     say, rather than a spinner over an empty shelf. */
  /* THE COMPANION READS FOLLOW THE CARD, not the row that was clicked. A
     clone's row opens its parent, so asking for the clone's files, ledger or
     picklist would fetch a different job's answers into this card. They wait
     one beat for the resolution, which they were already doing — every one of
     them lands after the detail anyway. */
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

  /* Our OWN material picklist — pushed here from a Studio design. Distinct
     from "Their checklist" above it, which is ServiceM8's and read-only. On
     its own clock like the files; a job with none renders nothing. */
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
     component never has numbers it must remember to hide. */
  /* A REJECTION IS ITS OWN ANSWER, and it needs saying. The money block waits
     for `record` so a family-billed parent never paints its netted total and
     then corrects itself — but with no catch, a rejected read left `record`
     at undefined forever and the whole Job value section simply never
     appeared, indistinguishable from a reader with no money grant. Falling
     back to null would be worse than either: that IS the netted total this
     feature exists to stop showing. So the failure is recorded as a failure
     and the block says the figures didn't load. */
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    /* No reset: the sheet is KEYED BY JOB, so a different job is a different
       component with this flag already false — the same rule the record's
       own loading state follows. */
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

  /* Bringing the bytes across, a few per round, with the BROWSER as the loop
     — there is no server queue, the same reason the knowledge-base backfill
     is driven from here. Two rails, both load-bearing: a hard round cap so a
     pathological job can't spin forever, and STOP ON NO PROGRESS, because a
     server that keeps saying "6 left" while caching none is a bug, not a
     backlog. */
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

  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      <aside
        className="wb2-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${row.clientName ?? "Job"}${row.number ? ` — job ${row.number}` : ""}`}
      >
        <div className="wb2-shtop">
          {/* THE NUMBER IS THE NAVIGATION. A job ServiceM8 billed in stages
              wears a caret that lists its claims; a card opened FROM a claim
              wears the crumb "#2380 › #2380A" and tapping the parent drops
              it. Four characters do the work of a back button. */}
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
          <h2 className="wb2-shname">{detail?.clientName ?? row.clientName ?? "Unnamed client"}</h2>
          <span className="wb2-shchips">
            {focusClaim && (
              <span className="wb2-chip cat">{claimTitle(focusClaim)}</span>
            )}
            {/* WAS A WHOLE SECTION AT THE FOOT OF THE CARD — a heading, a
                paragraph and a border to say one thing nobody had asked. The
                fact belongs to the badge that already names ServiceM8. */}
            <span
              className="wb2-chip"
              title="ServiceM8 owns this job — HeyTiff only reads it. Edit it over there and the change follows here on the next sync."
            >
              ServiceM8 job
            </span>
            {/* THE STATUS ALWAYS SHOWS. It used to appear only when it had a
                tone, which hid exactly the statuses a reader arrives unsure
                about — a Quote wore its dashed edge on the rail and then
                nothing up here. Neutral statuses wear the plain chip. */}
            {cardStatus && (
              <span className={"wb2-chip" + (cardTone ? ` ${cardTone}` : "")}>
                {cardStatus}
              </span>
            )}
            {/* what today's diary said, when a schedule block opened this —
                the rail's marks in words, the "!" kept for the one state
                that is actually wrong */}
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
            {row.categoryName && (
              <span className="wb2-chip">
                {row.categoryColour && (
                  <i className="wb2-catdot" style={{ background: row.categoryColour }} aria-hidden />
                )}
                {row.categoryName}
              </span>
            )}
          </span>
          {/* THE WAYS OUT OF THIS JOB, off the card floor. They used to be two
              full-width buttons under everything — the loudest controls on a
              sheet whose daily job is to be READ. Promotion is a once-per-job
              act; it belongs behind the ⋯ where a once-per-job act lives. */}
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
              {/* A DISCLOSURE, not an ARIA menu widget: role="menu" promises
                  arrow-key navigation between menuitems, and promising it
                  without implementing it is worse for a screen reader than two
                  plain buttons that behave exactly as they look. */}
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

        <div className="wb2-shhd">
          <p>{detail?.address ?? detail?.geoLine ?? row.suburb ?? "No address on the job"}</p>
          <div className="wb2-facts">
            {/* THE CARD'S OWN DAY, not the row's. A clone opens its parent,
                and the clone's "completed Fri 27 Mar" is a different job's
                date — derived server-side, where the account's clock is. */}
            <div>
              <span className="wb2-sect">{cardDateLabel === "raised" ? "Raised" : "When"}</span>
              <b>{cardDate ? fmtAuWeekdayDayMonth(cardDate) : "—"}</b>
              <em>{cardDateLabel}</em>
            </div>
            {detail?.workOrderDate && row.statusLabel === "Work Order" && (
              <div>
                <span className="wb2-sect">Work order</span>
                <b>{dayOf(detail.workOrderDate) ? fmtAuWeekdayDayMonth(dayOf(detail.workOrderDate)!) : "—"}</b>
                <em>since</em>
              </div>
            )}
            {detail?.nextBooking && (
              <div>
                <span className="wb2-sect">Next on site</span>
                <b>{bookingLabel(detail.nextBooking.start, detail.nextBooking.end)}</b>
                <em>{detail.nextBooking.staffName ?? "Nobody named"}</em>
              </div>
            )}
            {detail?.queue && (
              <div>
                <span className="wb2-sect">In queue</span>
                <b>{detail.queue.name}</b>
                <em>
                  {[
                    detail.queue.staffName,
                    detail.queue.expiry ? `until ${fmtAuWeekdayDayMonth(detail.queue.expiry)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "waiting"}
                </em>
              </div>
            )}
            {detail?.purchaseOrder && (
              <div>
                <span className="wb2-sect">Their PO</span>
                <b>{detail.purchaseOrder}</b>
              </div>
            )}
          </div>
        </div>

        {/* MONEY READS ONCE, and it reads here. The fact tile this replaces
            could say one sentence about a job ServiceM8 bills across three
            cards; the block says what the job is worth, what has been claimed
            against it, and what is still out — and it counts collection
            across the FAMILY, which is the difference between "Nothing paid
            yet" and $9,402 in the bank. */}
        {moneyVisible && (record !== undefined || recordFailed) && (
          <JobMoneyBlock
            family={family}
            unavailable={recordFailed}
            money={money}
            ledgerPaidCents={
              record?.ledger ? paymentsTotalCents(record.ledger.payments) : 0
            }
            statusLabel={row.statusLabel}
            categoryColour={detail?.categoryColour ?? row.categoryColour ?? null}
            focusRemoteId={focus}
            onOpenClaim={setOpenClaim}
          />
        )}

        {/* EVERY TIME SOMEBODY WAS THERE, and who went. These sessions were
            already being fetched and summed into a single "time on site"
            figure that answered nobody's question — the question is when we
            were last there and who it was. */}
        {detail && detail.visits.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">
              {`Visits — ${detail.visits.length}`}
              {detail.timeOnSite
                ? ` · ${fmtMinutesAsHours(detail.timeOnSite.minutes)} on site`
                : ""}
            </span>
            {(allVisits ? detail.visits : detail.visits.slice(0, VISITS_SHOWN)).map((v) => (
              <div className="wb2-mline" key={v.day}>
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
        )}

        {row.tracked && (
          <div className="wb2-shsect">
            <span className="wb2-sect">Already tracked</span>
            <p className="int-hint">
              This job is on the{" "}
              {row.tracked.kind === "visit" ? "maintenance board" : "projects board"}.
            </p>
            <button className="pbtn ghost" onClick={() => onOpenTracked(row.tracked!)}>
              <Icon name="send" size={15} />
              {row.tracked.kind === "visit"
                ? `Open ${row.tracked.label}`
                : `Open ${row.tracked.label}`}
            </button>
          </div>
        )}

        <div className="wb2-shsect">
          <span className="wb2-sect">The job</span>
          {loading && !detail ? (
            <p className="int-hint">Reading it from the mirror…</p>
          ) : (
            <p className="wb2-shtext">
              {detail?.description ?? row.title ?? "Nothing written on the job."}
            </p>
          )}
          {detail?.workDone && (
            <>
              <span className="wb2-sect" style={{ marginTop: 10 }}>
                What was done
              </span>
              <p className="wb2-shtext">{detail.workDone}</p>
            </>
          )}
        </div>

        {detail && detail.checklist.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">
              Their checklist —{" "}
              {`${detail.checklist.filter((c) => c.done).length} of ${detail.checklist.length} done`}
            </span>
            {groupChecklist(detail.checklist).map((group, gi) => (
              <div key={`${group.section ?? "-"}-${gi}`} className="wb2-ckgroup">
                {group.section && <span className="wb2-sect wb2-cksec">{group.section}</span>}
                {group.items.map((item, i) => (
                  <div key={`${item.name}-${i}`} className={`wb2-ckrow${item.done ? " done" : ""}`}>
                    <i className="wb2-ckdot" aria-hidden />
                    <span className="wb2-ckname">{item.name}</span>
                    {item.itemType && item.itemType !== "Todo" && (
                      <i className="wb2-chip">{item.itemType}</i>
                    )}
                    <em>
                      {item.done
                        ? [item.doneBy, item.doneOn ? fmtAuWeekdayDayMonth(item.doneOn) : null]
                            .filter(Boolean)
                            .join(" · ") || "done"
                        : ""}
                    </em>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {record && record.notes.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">What&apos;s been written on it</span>
            {record.notes.map((n) => (
              <div className="wb2-jnote" key={n.remoteId}>
                <p className="wb2-shtext">{n.text}</p>
                <em>
                  {[n.writtenBy, n.writtenOn ? fmtAuWeekdayDayMonth(n.writtenOn) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </em>
              </div>
            ))}
          </div>
        )}

        {/* Materials and payments arrive null without `workboard_money`, so
            there is nothing here to hide — the server never sent it. */}
        {/* PARTIAL-INVOICE ROWS LEAVE THIS LIST. "Partial invoice #2380A × −1"
            is ServiceM8 subtracting one of its own clones out of the parent —
            bookkeeping, not something that went on the job. It belongs to the
            money block above, where it IS a claim. */}
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
              /* No total when a line couldn't be read, and none when the
                 lines disagree about tax — adding an inc-GST line to an
                 ex-GST one and printing one figure would be a lie. */
              if (mixed)
                return (
                  <p className="int-hint">
                    These lines mix tax-inclusive and tax-exclusive prices, so they don&apos;t add
                    up to one figure here — ServiceM8&apos;s invoice is the total.
                  </p>
                );
              if (total === null)
                return <p className="int-hint">Some lines aren&apos;t priced, so there&apos;s no total to show.</p>;
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
                /* COLLECTION IS SAID ONCE, and the block above says it. This
                   figure is measured against THIS row's own total — the
                   parent's, net of its partial invoices — so on a family it
                   could print "paid in full" directly under a block printing
                   "Awaiting payment". These are this job's own payments; the
                   verdict belongs to whoever can see all of them. */
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

        {media && media.photos.length + media.documents.length + media.elsewhere.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">Files on this job — {mediaCountLine(media)}</span>

            {media.photos.length > 0 && (
              <div className="wb2-mgrid">
                {media.photos.map((p) =>
                  p.url ? (
                    <a
                      key={p.remoteId}
                      className="wb2-mtile"
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      /* A grid tile has no room for a chip, but a photo that
                         was EMAILED IN is a different thing from one taken on
                         site — so the origin rides in the tooltip, where the
                         name already is. */
                      title={[
                        p.name,
                        p.origin ? p.origin.toLowerCase() : null,
                        p.fromClaim ? `filed against invoice #${p.fromClaim}` : null,
                      ]
                        .filter(Boolean)
                        .join(" — ")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.name} loading="lazy" />
                      {/* WHERE IT CAME FROM. A photo taken on site lands on
                          whichever progress invoice happened to be open, and
                          it belongs to the job — but a tile that says which
                          claim it arrived on is also how anyone would ever
                          notice one filed against the wrong invoice. */}
                      {p.fromClaim && <u className="wb2-mfrom">{p.fromClaim}</u>}
                    </a>
                  ) : (
                    /* Not cached yet. A tile that says so beats a broken
                       image, and beats hiding a photo that genuinely
                       exists. */
                    <span
                      key={p.remoteId}
                      className="wb2-mtile pending"
                      title={p.origin ? `${p.name} — ${p.origin.toLowerCase()}` : p.name}
                    >
                      <Icon name="cam" size={16} />
                    </span>
                  )
                )}
              </div>
            )}

            {media.documents.map((d) => (
              <p className="wb2-shtext" key={d.remoteId}>
                {d.url ? (
                  <a className="wb2-colink" href={d.url} target="_blank" rel="noreferrer">
                    {d.name}
                  </a>
                ) : (
                  <b>{d.name}</b>
                )}
                {d.origin ? <i className="wb2-chip">{d.origin}</i> : null}
                {d.fromClaim ? <i className="wb2-chip cat">{`#${d.fromClaim}`}</i> : null}
              </p>
            ))}

            {media.elsewhere.length > 0 && (
              <p className="int-hint">
                {media.elsewhere.length === 1
                  ? "1 file stays in ServiceM8"
                  : `${media.elsewhere.length} files stay in ServiceM8`}{" "}
                — video and file types this screen can&apos;t show.
              </p>
            )}

            {mediaNote && <p className="int-hint">{mediaNote}</p>}

            {media.truncated && (
              <p className="int-hint">
                Showing the newest {JOB_MEDIA_CAP} files — this job has more in ServiceM8.
              </p>
            )}
          </div>
        )}

        {detail && detail.contacts.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">Who to ring</span>
            {/* A PHONE NUMBER ON A JOB CARD IS A BUTTON. It was plain text,
                and the second number was dropped on the floor by a `||`. */}
            {detail.contacts.map((c, i) => (
              <p className="wb2-shtext" key={`${c.name}-${i}`}>
                <b>{c.name || "Unnamed"}</b>
                {c.type ? ` · ${c.type.toLowerCase()}` : ""}
                {c.phone ? (
                  <>
                    {" · "}
                    {telHref(c.phone) ? (
                      <a className="wb2-colink" href={telHref(c.phone)!}>
                        {c.phone}
                      </a>
                    ) : (
                      c.phone
                    )}
                  </>
                ) : null}
                {c.altPhone ? (
                  <>
                    {" · "}
                    {telHref(c.altPhone) ? (
                      <a className="wb2-colink" href={telHref(c.altPhone)!}>
                        {c.altPhone}
                      </a>
                    ) : (
                      c.altPhone
                    )}
                  </>
                ) : null}
                {c.email ? (
                  <>
                    {" · "}
                    <a className="wb2-colink" href={`mailto:${c.email}`}>
                      {c.email}
                    </a>
                  </>
                ) : null}
              </p>
            ))}
          </div>
        )}

        {/* OUR picklist, pushed from a Studio design — distinct from "Their
            checklist" above, which is ServiceM8's and read-only. This is the
            one we can write, so this is the one that ticks. */}
        {picklist && picklist.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">
              Material picklist —{" "}
              {`${picklist.filter((p) => p.picked).length} of ${picklist.length} picked`}
            </span>
            {picklist.map((item) => (
              <div
                key={item.id}
                className={`wb2-pkrow${item.picked ? " done" : ""}`}
              >
                <label className="wb2-pkbox">
                  <input
                    type="checkbox"
                    checked={item.picked}
                    aria-label={`Picked: ${item.name}`}
                    onChange={(e) => {
                      const next = e.target.checked;
                      /* optimistic: a warehouse ticking down a list must not
                         wait on a round trip per line */
                      setPicklist((cur) =>
                        (cur ?? []).map((p) =>
                          p.id === item.id ? { ...p, picked: next } : p
                        )
                      );
                      void setPicklistItemPicked(item.id, next).catch(() => {
                        setPicklist((cur) =>
                          (cur ?? []).map((p) =>
                            p.id === item.id ? { ...p, picked: !next } : p
                          )
                        );
                        onToast("Could not save that tick");
                      });
                    }}
                  />
                </label>
                <span className="wb2-pkname">{item.name}</span>
                {item.sub && <em className="wb2-pksub">{item.sub}</em>}
                <span className="wb2-pkqty">{item.qty}</span>
                {manage && (
                  <button
                    className="wb2-pkdel"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => {
                      setPicklist((cur) =>
                        (cur ?? []).filter((p) => p.id !== item.id)
                      );
                      void removePicklistItem(item.id).catch(() =>
                        onToast("Could not remove that line")
                      );
                    }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* The other end of the studio's job link. Absent for a reader
            without `studio` (the action doesn't fetch it), and absent when
            nobody has designed this job — an empty "Designs" heading on 800
            service calls would be a section that means nothing. */}
        {detail && detail.designs.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">
              {detail.designs.length === 1
                ? "Designed in the Studio"
                : `Designed in the Studio — ${detail.designs.length} options`}
            </span>
            {detail.designs.map((d) => (
              <Link
                key={d.id}
                className="wb2-dsgn"
                href={`/dashboard/studio?design=${encodeURIComponent(d.id)}`}
              >
                <span className="wb2-dsgn-ic">
                  <Icon name={d.mode === "plan" ? "file" : "square"} size={15} />
                </span>
                <span className="wb2-dsgn-b">
                  <b>{d.name}</b>
                  <em>
                    {`${d.floorCount} ${d.floorCount === 1 ? "floor" : "floors"} · ` +
                      `${d.systemCount} ${d.systemCount === 1 ? "system" : "systems"} · ` +
                      `edited ${editedOn(d.updatedAt)}`}
                  </em>
                </span>
                {/* its own wrapper because <Icon> renders <span><svg/></span>:
                    a `.wb2-dsgn > svg` rule would be valid CSS matching
                    nothing at all */}
                <span className="wb2-dsgn-go">
                  <Icon name="chevR" size={15} />
                </span>
              </Link>
            ))}
          </div>
        )}

        {err && <div className="wb2-sherr">{err}</div>}

        {/* The floor is EMPTY until something is being typed on it. Its two
            promote buttons moved into the ⋯ menu at the top right. */}
        {manage && naming && (
          <div className="wb2-shft">
            {(
              <>
                <input
                  className="wb2-fi"
                  autoFocus
                  value={name}
                  placeholder={row.clientName ?? "Project name"}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") makeProject();
                    if (e.key === "Escape") setNaming(false);
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
              </>
            )}
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
    </>,
    document.body
  );
}
