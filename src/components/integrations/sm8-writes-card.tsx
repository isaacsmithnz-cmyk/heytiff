"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import {
  logWord,
  type SendHold,
  type Sm8PausedReason,
  type Sm8WriteKind,
  type Sm8WriteMode,
} from "@/lib/integrations/sm8-write-plan";
import { fillWords, NOTE_WORDS } from "@/lib/integrations/sm8-note-words";
import { BOOKING_WORDS } from "@/lib/integrations/sm8-booking-words";
import { LEAVE_WORDS } from "@/lib/integrations/sm8-leave-words";
import type { RecentSm8Write } from "@/lib/integrations/sm8-writes";
import {
  retryFailedServiceM8WritesAction,
  setServiceM8WriteKindAction,
  setServiceM8WriteModeAction,
} from "@/app/actions/integrations";

/* SENDING FILES TO SERVICEM8 — the owner's switch for the first thing
   HeyTiff writes back, on the connection it governs.

   THREE SETTINGS, AND OFF IS WHERE EVERY BUSINESS STARTS. (There were
   four: Trial run was retired 2026-09-28, once notes and bookings had gone
   for real. A workspace still on it reads its line below and picks one of
   the three.) Trial run let
   the office press Send to ServiceM8 on a job and see each send checked and
   listed here, with nothing reaching ServiceM8: the way to watch it work on
   a live account before it touches one. Paused stops everything going and
   loses nothing — the owner's own "not now", or HeyTiff's when more than the
   hourly cap went in an hour. On asks ServiceM8 for the one permission it
   needs, at the next reconnect, and until that is given the card says so
   rather than pretending.

   THE LIST IS WHAT WAS DONE TO THEIR SERVICEM8, latest first, in the state's
   colour — including what didn't go and why, and every file still waiting
   or failed however old. A write path whose owner can't see what it wrote is
   asking to be trusted. */

/** Null on a deployment that can't write (SM8_WRITES unset): the card isn't
    drawn at all there, because a setting that can't be set is a roadmap. */
export type Sm8WritesView = {
  mode: Sm8WriteMode;
  /** Who paused it, while paused. */
  pausedReason: Sm8PausedReason | null;
  /** What is holding the files waiting to go, as the list says it. */
  hold: SendHold;
  /** The kinds whose permission the grant holds. */
  granted: Sm8WriteKind[];
  /** The kinds ServiceM8 refused for permission since the last connect. */
  refused: Sm8WriteKind[];
  /** Files sent in the last 30 days; null when it couldn't be counted. */
  sentLately: number | null;
  /** Files waiting to go. */
  waiting: number;
  /** Files that didn't go and wait for a person. */
  failed: number;
  recent: RecentSm8Write[];
  /** Files one ServiceM8 account may take in an hour before sending pauses. */
  hourlyCap: number;
  /** The kinds this deployment sends (SM8_WRITES). With files alone the card
      is word for word as it always was; with more than one kind it carries
      the owner's switch per kind. Absent: files alone. */
  kinds?: Sm8WriteKind[];
  /** The kinds the owner has switched on. */
  ownerKinds?: Sm8WriteKind[];
  /** What holds each kind's waiting writes (the list says it per row). */
  holds?: Partial<Record<Sm8WriteKind, SendHold>>;
};

const MODES: { id: Sm8WriteMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "paused", label: "Paused" },
  { id: "live", label: "On" },
];

/** How many rows the list draws before it asks: the latest few, beside the
    mirror, and the rest one press away. */
const SHOWN = 4;

/** The owner's switch per kind, in this order, a row for each kind the
    deployment allows — drawn only where it allows more than one. */
const KIND_ROWS: { kind: Sm8WriteKind; label: string; group: string }[] = [
  { kind: "attachment", label: NOTE_WORDS.card.files, group: NOTE_WORDS.card.filesGroup },
  { kind: "note", label: NOTE_WORDS.card.notes, group: NOTE_WORDS.card.notesGroup },
  { kind: "booking", label: BOOKING_WORDS.card.bookings, group: BOOKING_WORDS.card.bookingsGroup },
  { kind: "leave", label: LEAVE_WORDS.card.leave, group: LEAVE_WORDS.card.leaveGroup },
];

/** The setting as a sentence, with the one figure worth having. With more
    than one kind it speaks of sends, not files (`more`). */
function modeLine(view: Sm8WritesView, more: boolean): string {
  const { mode, sentLately, waiting } = view;
  if (mode === "off") return "Off. Nothing HeyTiff does changes your ServiceM8.";
  if (mode === "trial") {
    return more
      ? NOTE_WORDS.card.trialLine
      : "Trial run. The office can press Send to ServiceM8 on a job, and each send is checked and listed here. Nothing reaches ServiceM8.";
  }
  if (more && mode === "live") {
    return sentLately && sentLately > 0 ? fillWords(NOTE_WORDS.card.onLine, { n: sentLately }) : NOTE_WORDS.card.onLineNone;
  }
  if (mode === "paused") {
    const held = waiting > 0 ? ` ${waiting} waiting.` : "";
    return view.pausedReason === "cap"
      ? `Paused by HeyTiff, because more than ${view.hourlyCap} went to ServiceM8 within an hour. Nothing waiting is lost.${held}`
      : `Paused. Nothing goes to ServiceM8 until you switch it back on, and nothing waiting is lost.${held}`;
  }
  const lately = sentLately && sentLately > 0 ? ` ${sentLately} in the last 30 days.` : "";
  return `On. Files sent from a job's Documents tab are added to the same job in ServiceM8.${lately}`;
}

/** "Job 2380, Isaac Smith, Wed 23 Sept" — an AU day, not a relative time, so
    the server and the browser write the same words (see MirrorCard). */
function facts(w: RecentSm8Write): string {
  const day = fmtAuWeekdayDayMonth(auDayOf(w.at));
  return [w.jobNumber ? `Job ${w.jobNumber}` : null, w.by, day].filter(Boolean).join(", ");
}

/** Whether a write's line carries its reason: every write that hasn't gone,
    and a booking that went with a guard's words on it (it landed at another
    time, or on someone else, or changed more than the job's status). */
const saysWhy = (w: RecentSm8Write) => !!w.error && (w.status !== "sent" || w.kind === "booking");

export function Sm8WritesCard({ view }: { view: Sm8WritesView }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const choose = (mode: Sm8WriteMode) => {
    if (mode === view.mode || busy) return;
    setError(null);
    setNote(null);
    start(async () => {
      const res = await setServiceM8WriteModeAction(mode);
      if (res.ok) {
        if (res.note) setNote(res.note);
        router.refresh();
      } else setError(res.error);
    });
  };

  const retry = () => {
    if (busy) return;
    setError(null);
    setNote(null);
    start(async () => {
      const res = await retryFailedServiceM8WritesAction();
      if (res.ok) {
        if (res.note) setNote(res.note);
        router.refresh();
      } else setError(res.error);
    });
  };

  /* FILES, NOTES AND BOOKINGS: more than one kind allowed, and the owner
     switches each. */
  const kinds = view.kinds ?? ["attachment"];
  const more = kinds.length > 1;
  const ownerKinds = view.ownerKinds ?? ["attachment"];
  const switchKind = (kind: Sm8WriteKind, on: boolean) => {
    if (busy || ownerKinds.includes(kind) === on) return;
    setError(null);
    setNote(null);
    start(async () => {
      const res = await setServiceM8WriteKindAction(kind, on);
      if (res.ok) {
        if (res.note) setNote(res.note);
        router.refresh();
      } else setError(res.error);
    });
  };

  /* Asked for while On or Paused (a pause keeps the permission), and said
     until ServiceM8 gives it — or while ServiceM8 has refused it since. With
     more than one kind, said for each kind switched on whose permission is
     missing. */
  const unheldKind = (k: Sm8WriteKind) => !view.granted.includes(k) || view.refused.includes(k);
  const unheld = unheldKind("attachment");
  const consentFor: Sm8WriteKind[] = more ? kinds.filter((k) => ownerKinds.includes(k) && unheldKind(k)) : unheld ? ["attachment"] : [];
  const shown = all ? view.recent : view.recent.slice(0, SHOWN);
  const holdOf = (w: RecentSm8Write): SendHold => (more ? view.holds?.[w.kind] ?? view.hold : view.hold);
  const heading = more ? NOTE_WORDS.card.heading : "Sending files to ServiceM8";

  /* One card beside the mirror (2026-09-28): the setting sits in the
     heading's row, the kinds share one row, and the list is one line a
     write — what, where and who, and its state. */
  return (
    <div className="card2 int-wcard">
      <div className="c2h">
        <div style={{ minWidth: 0, flex: 1 }}>
          <b>{heading}</b>
          <em>{modeLine(view, more)}</em>
        </div>
        <div className="wb2-ckseg" role="radiogroup" aria-label={heading}>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={view.mode === m.id}
              className={view.mode === m.id ? "on" : undefined}
              disabled={busy}
              onClick={() => choose(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {more && (
        <div className="int-kinds">
          {KIND_ROWS.filter((r) => kinds.includes(r.kind)).map(({ kind: k, label, group }) => {
            const on = ownerKinds.includes(k);
            return (
              <div className="int-kind" key={k}>
                <b>{label}</b>
                <div className="wb2-ckseg" role="radiogroup" aria-label={group}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!on}
                    className={!on ? "on" : undefined}
                    disabled={busy}
                    onClick={() => switchKind(k, false)}
                  >
                    {NOTE_WORDS.card.off}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={on ? "on" : undefined}
                    disabled={busy}
                    onClick={() => switchKind(k, true)}
                  >
                    {NOTE_WORDS.card.on}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {error && <div className="int-note bad">{error}</div>}
      {note && <div className="int-note ok">{note}</div>}

      {(view.mode === "live" || view.mode === "paused") &&
        consentFor.map((k) => (
          <div className="int-consent" key={k}>
            <Icon name="alert" size={15} />
            <p>
              {k === "note" ? (
                NOTE_WORDS.card.notesConsent
              ) : k === "booking" ? (
                BOOKING_WORDS.card.bookingsConsent
              ) : k === "leave" ? (
                LEAVE_WORDS.card.leaveConsent
              ) : (
                <>
                  ServiceM8 hasn&apos;t given HeyTiff permission to add files yet, so nothing can go. Reconnect
                  ServiceM8 above and approve it on ServiceM8&apos;s screen.
                </>
              )}
            </p>
          </div>
        ))}

      {shown.length > 0 && (
        <ul className="int-writes">
          {shown.map((w) => {
            const word = logWord(w.status, w.attempts, holdOf(w));
            return (
              <li key={w.id}>
                <b className="int-wname">{w.name}</b>
                <p>{saysWhy(w) ? `${facts(w)}. ${w.error}` : facts(w)}</p>
                <span className={word.tone ? `int-tag ${word.tone}` : "int-tag"}>{word.word}</span>
              </li>
            );
          })}
        </ul>
      )}
      {/* the list's foot: the rest of it, and what didn't go with the way to
          send it again — one row, under the rows it is about */}
      {((!all && view.recent.length > SHOWN) || view.failed > 0) && (
        <div className="int-wfoot">
          {!all && view.recent.length > SHOWN && (
            <button type="button" className="int-more" onClick={() => setAll(true)}>
              Show all {view.recent.length}
            </button>
          )}
          {view.failed > 0 && (
            <div className="int-failed">
              <b>{view.failed === 1 ? "1 didn't go." : `${view.failed} didn't go.`}</b>
              <button type="button" className="pbtn ghost" disabled={busy} onClick={retry}>
                Retry failed files
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
