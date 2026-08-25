"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { daysBetween } from "@/lib/workboard/board-status";
import { plusDays } from "@/lib/workboard/dates";
import {
  assignVisitTech,
  clearVisitPlacement,
  placeVisit,
  setVisitReadiness,
  unassignVisitTech,
} from "@/app/actions/workboard-maintenance";
import type { BoardTech, BoardVisit } from "@/lib/workboard/board-query";
import {
  calendarToneFor,
  cadenceLabel,
  GATE_FULL,
  GATE_LABEL,
  hoursLabel,
  missingOf,
  placedDayOf,
  TONE_RANK,
  toneOf,
} from "./derive";

/** How far beyond a day a visit can still be offered for placing on it. Four
    weeks — the same window the Calendar tab shows, so what you can place
    matches what you can see. */
const PLACEABLE_AHEAD_DAYS = 28;

/* The day modal — the list behind a day's colour, now LIVE (A3's fix): the
   gate chips on each card are the real ticks, assignment is a real select
   (never a tick — A12), and the footer's "Place a service on this day" is
   finally wired (K8) as the home of placing AND rescheduling (A5): moving a
   visit here from another day is one press, with its own undo carrying the
   day it came from (B23).

   Clicking the Saturday cell IS the deliberate weekend choice (B9) — the
   modal doesn't second-guess a day someone pointed at. */

export function DayModal({
  dayISO,
  visits,
  today,
  staff,
  manage,
  onOpenVisit,
  onToast,
  onClose,
}: {
  dayISO: string;
  visits: BoardVisit[];
  today: string;
  staff: BoardTech[];
  manage: boolean;
  onOpenVisit: (visitId: string) => void;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [placing, setPlacing] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dayVisits = useMemo(
    () =>
      visits
        .filter((v) => placedDayOf(v) === dayISO)
        .sort((a, b) => TONE_RANK[toneOf(a, today)] - TONE_RANK[toneOf(b, today)]),
    [visits, dayISO, today]
  );

  /** Candidates for this day: OPEN visits sitting elsewhere — the unplaced
      first (most overdue leading), then booked-another-day rows, which
      moving here reschedules.

      SCOPED TO WHAT THIS DAY COULD PLAUSIBLY TAKE. Every agreement carries
      13 months of generated visits, so "every unplaced visit" meant a
      six-clients book offered ~30 rows here, most of them due next year —
      you'd be invited to put a September 2027 service on next Tuesday. A
      visit belongs in this list when it's already due, or comes due inside
      the four weeks after the day you're looking at; anything further out
      isn't work you're scheduling, it's a typo waiting to happen. */
  const candidates = useMemo(() => {
    const horizon = plusDays(dayISO, PLACEABLE_AHEAD_DAYS);
    const open = visits.filter(
      (v) =>
        (v.status === "upcoming" || v.status === "booked") &&
        placedDayOf(v) !== dayISO
    );
    const all = open.filter((v) => !placedDayOf(v)).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const unplaced = all.filter((v) => v.dueDate <= horizon);
    const elsewhere = open
      .filter((v) => !!placedDayOf(v))
      .sort((a, b) => (placedDayOf(a)! < placedDayOf(b)! ? -1 : 1));
    // never silently truncate: say what the window is holding back
    return { unplaced, elsewhere, hiddenAhead: all.length - unplaced.length };
  }, [visits, dayISO]);

  const n = daysBetween(today, dayISO);
  const when =
    n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : n < 0 ? `${-n} days ago` : `In ${n} days`;
  const tone = calendarToneFor(dayVisits, dayISO, today);
  const st: Record<string, [string, string]> = {
    go: ["ok", "Ready to run"],
    done: ["ok", "Done and closed"],
    quote: ["", "Quote only"],
    soon: ["warn", "Confirm within the fortnight"],
    flash: ["dan", "Lands this week, not confirmed"],
    over: ["dan", "Overdue"],
    open: ["", "Still to confirm"],
  };
  const [chipTone, chipText] = st[tone] ?? ["", "Nothing placed"];
  const totalHours = dayVisits.reduce((t, v) => t + (v.hoursEstimate ?? 0), 0);
  const good = dayVisits.filter((v) => v.status === "done" || missingOf(v).length === 0).length;

  const run = (fn: () => Promise<unknown>, message: string, undo?: () => void | Promise<void>) => {
    start(async () => {
      await fn();
      onToast(message, undo);
      router.refresh();
    });
  };

  const undoable = (fn: () => Promise<unknown>) => async () => {
    await fn();
    router.refresh();
  };

  const placeHere = (v: BoardVisit) => {
    const from = v.bookedDate;
    run(
      () => placeVisit(v.id, dayISO),
      from
        ? `${v.clientName} moved to ${fmtAuWeekdayDayMonth(dayISO)}`
        : `${v.clientName} placed on ${fmtAuWeekdayDayMonth(dayISO)}`,
      undoable(() => (from ? placeVisit(v.id, from) : clearVisitPlacement(v.id)))
    );
  };

  const candidateRow = (v: BoardVisit) => {
    const placed = placedDayOf(v);
    const over = v.dueDate < today;
    return (
      <div className="wb2-lpr" key={v.id}>
        <span className={"wb2-chip " + (over ? "dan" : placed ? "" : "warn")}>
          {placed
            ? fmtAuWeekdayDayMonth(placed)
            : over
              ? `${daysBetween(v.dueDate, today)} days over`
              : "No day yet"}
        </span>
        <div className="wb2-trt">
          <b>{v.clientName}</b>
          <em>
            {v.label} — {cadenceLabel(v.intervalMonths)}
            {v.hoursEstimate !== null ? ` · ${hoursLabel(v.hoursEstimate)}` : ""}
          </em>
        </div>
        <button className="pbtn ghost" disabled={busy} onClick={() => placeHere(v)}>
          {placed ? "Move it here" : "Place here"}
        </button>
      </div>
    );
  };

  function DayCard({ v }: { v: BoardVisit }) {
    const vTone = toneOf(v, today);
    const missing = missingOf(v);
    const openSheet = () => onOpenVisit(v.id);

    if (v.status === "done" || vTone === "quote" || missing.length === 0) {
      const chip =
        v.status === "done" ? (
          <span className="wb2-chip ok">Done and closed</span>
        ) : vTone === "quote" ? (
          <span className="wb2-chip">Quote</span>
        ) : (
          <span className="wb2-chip ok">Ready to run</span>
        );
      return (
        <div
          className="wb2-dc mini can-open"
          data-tone={vTone}
          role="button"
          tabIndex={0}
          aria-label={`Open ${v.clientName} — ${v.label}`}
          onClick={openSheet}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openSheet();
            }
          }}
        >
          <div className="wb2-dch">
            <b>{v.clientName}</b>
            {chip}
          </div>
          <div className="wb2-dcs">
            {v.label} — {cadenceLabel(v.intervalMonths)}
            {v.hoursEstimate !== null ? ` · ${hoursLabel(v.hoursEstimate)}` : ""}
            {v.techs.length > 0 ? ` · ${v.techs.map((t) => t.name).join(", ")}` : ""}
          </div>
        </div>
      );
    }

    return (
      <div
        className="wb2-dc can-open"
        data-tone={vTone}
        style={{ "--lead": `var(--wb2-${missing[0] === "equipment" ? "eq" : missing[0] === "access" ? "acc" : "crew"})` } as CSSProperties}
        role="button"
        tabIndex={0}
        aria-label={`Open ${v.clientName} — ${v.label}`}
        onClick={openSheet}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            openSheet();
          }
        }}
      >
        <div className="wb2-dch">
          <b>{v.clientName}</b>
          <span className={"wb2-chip " + (vTone === "soon" ? "warn" : "dan")}>
            {missing.length} to confirm
          </span>
          {v.hoursEstimate !== null && <em>{hoursLabel(v.hoursEstimate)}</em>}
        </div>
        <div className="wb2-dcs">
          {v.label} — {cadenceLabel(v.intervalMonths)}
          {v.siteLabel ? ` · ${v.siteLabel}` : ""}
          {v.jobNumber ? ` · #${v.jobNumber}` : ""}
        </div>
        <div className="wb2-dcck" data-cols={missing.length}>
          {missing.map((g) =>
            g === "crew" ? (
              manage ? (
                <select
                  key={g}
                  className="wb2-sel"
                  disabled={busy}
                  value=""
                  aria-label={`Assign a technician — ${v.clientName}`}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    const staffId = e.target.value;
                    if (!staffId) return;
                    const name = staff.find((s) => s.id === staffId)?.name ?? "Assigned";
                    run(
                      () => assignVisitTech(v.id, staffId),
                      `${name} assigned — ${v.clientName}`,
                      undoable(() => unassignVisitTech(v.id, staffId))
                    );
                  }}
                >
                  <option value="">Crew — assign…</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span key={g} className="wb2-ck" style={{ "--as": "var(--wb2-crew)" } as CSSProperties}>
                  <i /> <span>{GATE_LABEL[g]}</span>
                </span>
              )
            ) : (
              <button
                key={g}
                className="wb2-ck"
                style={{ "--as": `var(--wb2-${g === "equipment" ? "eq" : "acc"})` } as CSSProperties}
                disabled={busy}
                title={`${GATE_FULL[g]} — not confirmed. Press to confirm.`}
                onClick={(e) => {
                  e.stopPropagation();
                  const key = g === "equipment" ? "equipment_ready" : "access_confirmed";
                  const word = g === "equipment" ? "Equipment" : "Access";
                  run(
                    () => setVisitReadiness(v.id, key, true),
                    `${word} confirmed — ${v.clientName}`,
                    undoable(() => setVisitReadiness(v.id, key, false))
                  );
                }}
              >
                <i />
                <span>{GATE_LABEL[g]}</span>
              </button>
            )
          )}
        </div>
      </div>
    );
  }

  /* THE RETURN IS LAST, under the components it renders, and has to stay
     there: a hoisted `function` declaration after a `return` is unreachable
     code, which React Compiler 1.0 refuses to compile past — it gives up on
     the whole component. */
  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      <div className="wb2-daymodal" role="dialog" aria-modal="true" aria-label={fmtAuWeekdayDayMonth(dayISO)}>
        <div className="wb2-dmhd" data-tone={tone}>
          <div className="wb2-dmtop">
            <span className="wb2-sect">{when}</span>
            <button ref={closeRef} className="wb2-ico" onClick={onClose} title="Close" aria-label="Close">
              <Icon name="x" size={14} />
            </button>
          </div>
          <h2>{fmtAuWeekdayDayMonth(dayISO)}</h2>
          <div className="wb2-dmchips">
            <span className={"wb2-chip" + (chipTone ? ` ${chipTone}` : "")}>{chipText}</span>
            {dayVisits.length > 0 && (
              <span className="wb2-chip">
                {dayVisits.length} {dayVisits.length === 1 ? "service" : "services"}
                {totalHours > 0 ? ` · ${hoursLabel(totalHours)}` : ""}
              </span>
            )}
          </div>
        </div>

        <div className="wb2-dmbody">
          {dayVisits.length === 0 && (
            <div className="wb2-empty">
              <Icon name="calendar" size={20} />
              <b>Nothing placed on this day</b>
              <em>
                {candidates.unplaced.length || candidates.elsewhere.length
                  ? "Place a service below to start the day."
                  : "Every open visit already has its day."}
              </em>
            </div>
          )}

          {dayVisits.map((v) => (
            <DayCard key={v.id} v={v} />
          ))}

          {(placing || dayVisits.length === 0) &&
            (candidates.unplaced.length > 0 || candidates.elsewhere.length > 0) && (
              <div className="wb2-dmgrp">
                {candidates.unplaced.length > 0 && (
                  <>
                    <span className="wb2-sect">Not placed yet</span>
                    {candidates.unplaced.map(candidateRow)}
                  </>
                )}
                {candidates.hiddenAhead > 0 && (
                  <p className="wb2-hint">
                    {candidates.hiddenAhead === 1
                      ? "1 more visit isn't due"
                      : `${candidates.hiddenAhead} more visits aren't due`}{" "}
                    within four weeks of this day — place those from their own week.
                  </p>
                )}
                {candidates.elsewhere.length > 0 && (
                  <>
                    <span className="wb2-sect">Booked another day — moving one reschedules it</span>
                    {candidates.elsewhere.map(candidateRow)}
                  </>
                )}
              </div>
            )}
        </div>

        <div className="wb2-dmft">
          {manage && (
            <button className="pbtn" disabled={busy} onClick={() => setPlacing((p) => !p)}>
              <Icon name="plus" size={15} />
              Place a service on this day
            </button>
          )}
          {dayVisits.length > 0 && (
            <span className="wb2-hint" style={{ margin: 0, marginLeft: "auto" }}>
              {good === dayVisits.length
                ? dayVisits.every((v) => v.status === "done")
                  ? "All done and closed"
                  : "Every service ready to run"
                : `${good} of ${dayVisits.length} good to go`}
            </span>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
