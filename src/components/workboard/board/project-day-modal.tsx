"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { daysBetween } from "@/lib/workboard/board-status";
import {
  assignVisitTech,
  clearVisitPlacement,
  placeVisit,
  setVisitReadiness,
  unassignVisitTech,
} from "@/app/actions/workboard-maintenance";
import type { BoardTech } from "@/lib/workboard/board-query";
import type { ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import {
  GATE_FULL,
  GATE_LABEL,
  projectMissingOf,
  projectPlacedDayOf,
  projectToneOf,
  TONE_RANK,
} from "./derive";
import { dayTone } from "@/lib/workboard/board-status";

/* The projects day modal — the maintenance day modal's manners on trips:
   live gate chips, a real crew select, and place/move with its own undo
   carrying the day it came from. Clicking a Saturday cell IS the deliberate
   weekend choice; the modal doesn't second-guess a day someone pointed at. */

export function ProjectDayModal({
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
  visits: ProjectBoardVisit[];
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
        .filter((v) => projectPlacedDayOf(v) === dayISO)
        .sort((a, b) => TONE_RANK[projectToneOf(a, today)] - TONE_RANK[projectToneOf(b, today)]),
    [visits, dayISO, today]
  );

  const candidates = useMemo(() => {
    const open = visits.filter(
      (v) => (v.status === "upcoming" || v.status === "booked") && projectPlacedDayOf(v) !== dayISO
    );
    const unplaced = open
      .filter((v) => !projectPlacedDayOf(v))
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const elsewhere = open
      .filter((v) => !!projectPlacedDayOf(v))
      .sort((a, b) => (projectPlacedDayOf(a)! < projectPlacedDayOf(b)! ? -1 : 1));
    return { unplaced, elsewhere };
  }, [visits, dayISO]);

  const n = daysBetween(today, dayISO);
  const when =
    n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : n < 0 ? `${-n} days ago` : `In ${n} days`;
  const tone = dayTone(
    dayVisits.map((v) => projectToneOf(v, today)),
    n
  );
  const st: Record<string, [string, string]> = {
    go: ["ok", "Ready to run"],
    done: ["ok", "Done and closed"],
    soon: ["warn", "Confirm within the fortnight"],
    flash: ["dan", "Lands this week, not confirmed"],
    over: ["dan", "Overdue"],
    open: ["", "Still to confirm"],
  };
  const [chipTone, chipText] = st[tone] ?? ["", "Nothing placed"];
  const good = dayVisits.filter((v) => v.status === "done" || projectMissingOf(v).length === 0).length;

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

  const placeHere = (v: ProjectBoardVisit) => {
    const from = v.bookedDate;
    run(
      () => placeVisit(v.id, dayISO),
      from
        ? `${v.projectName} · ${v.label} moved to ${fmtAuWeekdayDayMonth(dayISO)}`
        : `${v.projectName} · ${v.label} placed on ${fmtAuWeekdayDayMonth(dayISO)}`,
      undoable(() => (from ? placeVisit(v.id, from) : clearVisitPlacement(v.id)))
    );
  };

  const candidateRow = (v: ProjectBoardVisit) => {
    const placed = projectPlacedDayOf(v);
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
          <b>{v.projectName}</b>
          <em>{v.label}</em>
        </div>
        <button className="pbtn ghost" disabled={busy} onClick={() => placeHere(v)}>
          {placed ? "Move it here" : "Place here"}
        </button>
      </div>
    );
  };

  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      <div
        className="wb2-daymodal"
        role="dialog"
        aria-modal="true"
        aria-label={fmtAuWeekdayDayMonth(dayISO)}
      >
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
                {dayVisits.length} {dayVisits.length === 1 ? "trip" : "trips"}
              </span>
            )}
          </div>
        </div>

        <div className="wb2-dmbody">
          {dayVisits.length === 0 && (
            <div className="wb2-empty">
              <Icon name="calendar" size={20} />
              <b>No trips on this day</b>
              <em>
                {candidates.unplaced.length || candidates.elsewhere.length
                  ? "Place a trip below to start the day."
                  : "Every open trip already has its day."}
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
              Place a trip on this day
            </button>
          )}
          {dayVisits.length > 0 && (
            <span className="wb2-hint" style={{ margin: 0, marginLeft: "auto" }}>
              {good === dayVisits.length
                ? dayVisits.every((v) => v.status === "done")
                  ? "All done and closed"
                  : "Every trip ready to run"
                : `${good} of ${dayVisits.length} good to go`}
            </span>
          )}
        </div>
      </div>
    </>,
    document.body
  );

  function DayCard({ v }: { v: ProjectBoardVisit }) {
    const vTone = projectToneOf(v, today);
    const missing = projectMissingOf(v);
    const openSheet = () => onOpenVisit(v.id);

    if (v.status === "done" || v.status === "skipped" || missing.length === 0) {
      const chip =
        v.status === "done" ? (
          <span className="wb2-chip ok">Done and closed</span>
        ) : v.status === "skipped" ? (
          <span className="wb2-chip">Skipped</span>
        ) : (
          <span className="wb2-chip ok">Ready to run</span>
        );
      return (
        <div
          className="wb2-dc mini can-open"
          data-tone={vTone}
          role="button"
          tabIndex={0}
          aria-label={`Open ${v.projectName} — ${v.label}`}
          onClick={openSheet}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openSheet();
            }
          }}
        >
          <div className="wb2-dch">
            <b>{v.projectName}</b>
            {chip}
          </div>
          <div className="wb2-dcs">
            {v.label}
            {v.techs.length > 0 ? ` · ${v.techs.map((t) => t.name).join(", ")}` : ""}
          </div>
        </div>
      );
    }

    return (
      <div
        className="wb2-dc can-open"
        data-tone={vTone}
        style={{
          "--lead": `var(--wb2-${missing[0] === "equipment" ? "eq" : missing[0] === "access" ? "acc" : "crew"})`,
        } as CSSProperties}
        role="button"
        tabIndex={0}
        aria-label={`Open ${v.projectName} — ${v.label}`}
        onClick={openSheet}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            openSheet();
          }
        }}
      >
        <div className="wb2-dch">
          <b>{v.projectName}</b>
          <span className={"wb2-chip " + (vTone === "soon" ? "warn" : "dan")}>
            {missing.length} to confirm
          </span>
        </div>
        <div className="wb2-dcs">
          {v.label}
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
                  aria-label={`Assign a technician — ${v.projectName}`}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    const staffId = e.target.value;
                    if (!staffId) return;
                    const name = staff.find((s) => s.id === staffId)?.name ?? "Assigned";
                    run(
                      () => assignVisitTech(v.id, staffId),
                      `${name} assigned — ${v.projectName}`,
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
                    `${word} confirmed — ${v.projectName}`,
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
}
