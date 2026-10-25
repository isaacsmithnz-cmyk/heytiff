"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { StateWord, type Tone } from "@/components/parts/state";
import { Tray, type TrayOption } from "@/components/parts/tabs";
import { Switch } from "@/components/parts/tick";
import { Setting, Wrong } from "@/components/settings/parts";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { logWord, type SendHold, type Sm8WriteKind, type Sm8WriteMode } from "@/lib/integrations/sm8-write-plan";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-words";
import { BOOKING_WORDS } from "@/lib/integrations/sm8-booking-words";
import { LEAVE_WORDS } from "@/lib/integrations/sm8-leave-words";
import { JOB_WORDS } from "@/lib/integrations/sm8-job-words";
import { CUSTOMER_WORDS } from "@/lib/integrations/sm8-customer-words";
import { QUOTE_WORDS } from "@/lib/integrations/sm8-quote-words";
import type { RecentSm8Write } from "@/lib/integrations/sm8-writes";
import {
  retryFailedServiceM8WritesAction,
  setServiceM8QuotesAction,
  setServiceM8WriteKindAction,
  setServiceM8WriteModeAction,
} from "@/app/actions/integrations";
import { Said, useIntegrationAct } from "./int-parts";
import type { Sm8WritesView } from "./types";

/* SENDING TO SERVICEM8, the owner's switches for what HeyTiff writes back,
   on the connection they govern (the mock's "Sending to ServiceM8").

   THREE SETTINGS, AND OFF IS WHERE EVERY BUSINESS STARTS. Paused stops
   everything going and loses nothing: the owner's own "not now", or
   HeyTiff's when more than the hourly cap went in an hour. On asks
   ServiceM8 for the permission each kind needs, at the next reconnect, and
   until it is given the group says so rather than pretending. (Trial run
   was retired 2026-09-28; a workspace still on it reads its line and picks
   one of the three.) Where the deployment sends more than files, each kind
   has its switch, and accepted quotes their own Off, Trial or On (Isaac,
   2026-10-11: "Trial first").

   Each switch saves itself, and the toast says what it did. There is no
   Undo on these: switching a kind off cancels what was waiting, which a
   switch back on can't bring back, and switching on may send at once.

   WHAT WAS DONE TO THEIR SERVICEM8 is one row away, latest first, in the
   state's colour, including what didn't go and why. A write path whose
   owner can't see what it wrote is asking to be trusted. */

const MODES: TrayOption<Sm8WriteMode>[] = [
  { value: "off", label: "Off" },
  { value: "paused", label: "Paused" },
  { value: "live", label: "On" },
];

const MODE_SAID: Record<Sm8WriteMode, string> = {
  off: "Sending to ServiceM8 off",
  paused: "Sending to ServiceM8 paused",
  live: "Sending to ServiceM8 on",
  trial: "Sending to ServiceM8 on a trial run",
};

type QuoteSetting = "off" | "trial" | "live";
const QUOTES: TrayOption<QuoteSetting>[] = [
  { value: "off", label: NOTE_WORDS.card.off },
  { value: "trial", label: "Trial" },
  { value: "live", label: NOTE_WORDS.card.on },
];
const QUOTES_SAID: Record<QuoteSetting, string> = {
  off: "Accepted quotes off",
  trial: "Accepted quotes on a trial run",
  live: "Accepted quotes on",
};

/** A row per kind the deployment allows, in this order, drawn only where
    it allows more than one: its name on the row, and what its switch does
    as the switch's own name, for a screen reader. */
const KIND_ROWS: { kind: Sm8WriteKind; label: string; group: string; consent: string }[] = [
  { kind: "attachment", label: NOTE_WORDS.card.files, group: NOTE_WORDS.card.filesGroup, consent: NOTE_WORDS.card.filesConsent },
  { kind: "note", label: NOTE_WORDS.card.notes, group: NOTE_WORDS.card.notesGroup, consent: NOTE_WORDS.card.notesConsent },
  { kind: "booking", label: BOOKING_WORDS.card.bookings, group: BOOKING_WORDS.card.bookingsGroup, consent: BOOKING_WORDS.card.bookingsConsent },
  { kind: "leave", label: LEAVE_WORDS.card.leave, group: LEAVE_WORDS.card.leaveGroup, consent: LEAVE_WORDS.card.leaveConsent },
  { kind: "job", label: JOB_WORDS.card.jobs, group: JOB_WORDS.card.jobsGroup, consent: JOB_WORDS.card.jobsConsent },
  { kind: "customer", label: CUSTOMER_WORDS.card.customers, group: CUSTOMER_WORDS.card.customersGroup, consent: CUSTOMER_WORDS.card.customersConsent },
  { kind: "quote", label: QUOTE_WORDS.card.quotes, group: QUOTE_WORDS.card.quotesGroup, consent: QUOTE_WORDS.card.quotesConsent },
];

/** How many sends the list draws before it asks. */
const SHOWN = 4;

/** What Paused, or a retired trial run, means right now. Off and On say
    nothing: the tray already does. */
function modeSaid(view: Sm8WritesView, more: boolean): { tone: "look" | "info"; text: string } | null {
  const held = view.waiting > 0 ? ` ${view.waiting} waiting.` : "";
  if (view.mode === "paused" && view.pausedReason === "cap") {
    return {
      tone: "look",
      text: `Paused by HeyTiff, because more than ${view.hourlyCap} went to ServiceM8 within an hour. Nothing waiting is lost.${held}`,
    };
  }
  if (view.mode === "paused") {
    return { tone: "info", text: `Paused. Nothing goes to ServiceM8 until you switch it back on, and nothing waiting is lost.${held}` };
  }
  if (view.mode === "trial") {
    return {
      tone: "info",
      text: more
        ? NOTE_WORDS.card.trialLine
        : "Trial run. The office can press Send to ServiceM8 on a job, and each send is checked and listed here. Nothing reaches ServiceM8.",
    };
  }
  return null;
}

/** "Job 2380, Isaac Smith, Wed 23 Sept": an AU day, not a relative time,
    so the server and the browser write the same words. */
function facts(w: RecentSm8Write): string {
  const day = fmtAuWeekdayDayMonth(auDayOf(w.at));
  return [w.jobNumber ? `Job ${w.jobNumber}` : null, w.by, day].filter(Boolean).join(", ");
}

/** Whether a send's line carries its reason: every one that hasn't gone,
    and a booking that went with a guard's words on it. */
const saysWhy = (w: RecentSm8Write) => !!w.error && (w.status !== "sent" || w.kind === "booking");

const TONE: Record<string, Tone> = { ok: "good", warn: "look", bad: "wrong" };

export function Sm8Sending({ view }: { view: Sm8WritesView }) {
  const act = useIntegrationAct();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);

  const kinds = view.kinds ?? ["attachment"];
  const more = kinds.length > 1;
  const ownerKinds = view.ownerKinds ?? ["attachment"];
  const heading = more ? NOTE_WORDS.card.heading : NOTE_WORDS.card.filesGroup;

  const choose = (mode: Sm8WriteMode) => {
    if (mode === view.mode) return;
    act.run("mode", () => setServiceM8WriteModeAction(mode), (note) => note ?? MODE_SAID[mode]);
  };
  const switchKind = (kind: Sm8WriteKind, label: string, on: boolean) => {
    if (ownerKinds.includes(kind) === on) return;
    act.run(kind, () => setServiceM8WriteKindAction(kind, on), (note) => note ?? `${label} ${on ? "on" : "off"}`);
  };
  const switchQuotes = (setting: QuoteSetting) =>
    act.run("quote", () => setServiceM8QuotesAction(setting), (note) => note ?? QUOTES_SAID[setting]);
  const retry = () => act.run("retry", () => retryFailedServiceM8WritesAction(), (note) => note ?? null);

  /* Asked for while On or Paused (a pause keeps the permission), and said
     until ServiceM8 gives it, or while ServiceM8 has refused it since. With
     more than one kind, said for each kind switched on that isn't held. */
  const unheld = (k: Sm8WriteKind) => !view.granted.includes(k) || view.refused.includes(k);
  const consentFor =
    view.mode === "live" || view.mode === "paused"
      ? more
        ? KIND_ROWS.filter((r) => kinds.includes(r.kind) && ownerKinds.includes(r.kind) && unheld(r.kind))
        : unheld("attachment")
          ? KIND_ROWS.slice(0, 1)
          : []
      : [];
  const holdOf = (w: RecentSm8Write): SendHold => (more ? view.holds?.[w.kind] ?? view.hold : view.hold);
  const said = modeSaid(view, more);
  const sent = view.sentLately && view.sentLately > 0 ? `${view.sentLately} sent in the last 30 days` : null;
  const shown = all ? view.recent : view.recent.slice(0, SHOWN);

  return (
    <>
      <div className="st2-int-sub">
        <h3>{heading}</h3>
        <Tray ariaLabel={heading} options={MODES} value={view.mode} disabled={act.busy} onChange={choose} />
      </div>
      {said && <Said tone={said.tone}>{said.text}</Said>}

      {more &&
        KIND_ROWS.filter((r) => kinds.includes(r.kind)).map(({ kind: k, label, group }) => {
          const on = ownerKinds.includes(k);
          if (k === "quote") {
            return (
              <Setting key={k} name={label}>
                <Tray
                  ariaLabel={group}
                  options={QUOTES}
                  value={!on ? "off" : view.quotesTrial !== false ? "trial" : "live"}
                  disabled={act.busy}
                  onChange={switchQuotes}
                />
              </Setting>
            );
          }
          return (
            /* a new job may be charged for: said where it's switched on */
            <Setting key={k} name={label} line={k === "job" ? JOB_WORDS.card.charges : undefined}>
              <Switch
                label={<span className="sr-only">{group}</span>}
                checked={on}
                disabled={act.busy}
                onChange={(next) => switchKind(k, label, next)}
              />
            </Setting>
          );
        })}

      {consentFor.map((r) => (
        <Said tone="look" key={r.kind}>
          {r.consent}
        </Said>
      ))}

      {view.failed > 0 && (
        <Setting name={`${view.failed} ${view.failed === 1 ? "file" : "files"} didn't go`} line={sent ?? undefined}>
          <span className="st2-rowend">
            <StateWord tone="wrong" className="st2-int-word">
              Didn&apos;t go
            </StateWord>
            <Button kind="second" size={32} disabled={act.busy} onClick={retry}>
              {act.pending === "retry" ? "Sending the files again" : "Retry the files"}
            </Button>
          </span>
        </Setting>
      )}
      {(view.recent.length > 0 || (sent && view.failed === 0)) && (
        <Setting name="Recent sends" line={view.failed > 0 ? undefined : sent ?? undefined}>
          {view.recent.length > 0 && (
            <Button kind="quiet" size={32} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "Hide them" : "Show each"}
            </Button>
          )}
        </Setting>
      )}
      {open && view.recent.length > 0 && (
        <div className="st2-int-open">
          {shown.map((w) => {
            const word = logWord(w.status, w.attempts, holdOf(w));
            return (
              <Setting key={w.id} name={w.name} line={saysWhy(w) ? `${facts(w)}. ${w.error}` : facts(w)}>
                <StateWord tone={word.tone ? TONE[word.tone] ?? "info" : "info"} className="st2-int-word">
                  {word.word}
                </StateWord>
              </Setting>
            );
          })}
          {!all && view.recent.length > SHOWN && (
            <div className="st2-int-more">
              <Button kind="quiet" size={32} onClick={() => setAll(true)}>
                {`Show all ${view.recent.length}`}
              </Button>
            </div>
          )}
        </div>
      )}
      {act.error && <Wrong>{act.error}</Wrong>}
    </>
  );
}
