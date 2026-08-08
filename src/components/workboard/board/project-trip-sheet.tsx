"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { NoteToken } from "@/components/notes/note-token";
import { useNoteScopeTarget } from "@/components/notes/note-context";
import { TiffButton } from "@/components/notes/tiff-button";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import {
  isWeekendISO,
  placementMismatch,
  rollToBusinessDay,
} from "@/lib/workboard/board-status";
import { sm8BookingMismatch } from "@/lib/workboard/project-rules";
import type { BoardTech } from "@/lib/workboard/board-query";
import type { ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import {
  assignVisitTech,
  clearVisitPlacement,
  completeVisit,
  linkVisitJob,
  placeVisit,
  setVisitNotes,
  setVisitReadiness,
  setVisitStatus,
  unassignVisitTech,
  unlinkVisitJob,
  type MaintenanceResult,
} from "@/app/actions/workboard-maintenance";
import {
  addVisitBringItem,
  carryVisitBringItems,
  deleteProjectVisit,
  removeVisitBringItem,
  setProjectVisitLabel,
  setVisitBringPacked,
  type ProjectsResult,
} from "@/app/actions/workboard-projects";
import { agoLabel, hoursLabel, initialsOf, projectGatesOf, projectMissingOf, untilLabel } from "./derive";

/* The trip sheet — the visit sheet's discipline on a hand-made trip.

   Same spine: gates without auto-assign (Crew derives from assignment), the
   day picker with the deliberate-weekend choice and the due/booked mismatch
   said out loud, and the close-out that records the day it ran, the ACTUAL
   hours (the project's hour-burn reads these) and the note.

   What's different is honest to the model: the bring list belongs to THE
   TRIP (no agreement template behind it), so leftovers can carry to the
   next trip in one press — "what to bring next time" was the spec's own
   sentence. A linked ServiceM8 booking renders as garnish with a mismatch
   chip; nothing auto-writes in either direction.

   Portals to <body>: the page-transition wrapper's will-change breaks
   position:fixed (the house modal rule). */

type Result = MaintenanceResult | ProjectsResult;

export function ProjectTripSheet({
  visit,
  today,
  staff,
  manage,
  connected,
  nextTrip,
  startClosing = false,
  onToast,
  onClose,
}: {
  visit: ProjectBoardVisit;
  today: string;
  staff: BoardTech[];
  manage: boolean;
  connected: boolean;
  /** The project's next open trip after this one — the carry target. */
  nextTrip: { id: string; label: string } | null;
  startClosing?: boolean;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [openGate, setOpenGate] = useState<0 | 1 | 2 | null>(null);
  const [pendingDay, setPendingDay] = useState("");
  const [closing, setClosing] = useState(startClosing);
  /* Same law as the visit sheet: the day it ran is the day it was BOOKED,
     clamped to today. Defaulting to today silently recorded the day you got
     round to the paperwork. */
  const [ranOn, setRanOn] = useState(() => {
    const booked = visit.bookedDate ?? (visit.bookedStart ? visit.bookedStart.slice(0, 10) : null);
    return booked && booked <= today ? booked : today;
  });
  const [ranOnOpen, setRanOnOpen] = useState(false);
  const [hoursText, setHoursText] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [carry, setCarry] = useState(true);
  const [notesText, setNotesText] = useState(visit.notes ?? "");
  const [renaming, setRenaming] = useState(false);
  const [labelText, setLabelText] = useState(visit.label);

  /* WHAT THIS SHEET IS ABOUT, reported up so anything that captures while it
     is open lands on this trip rather than on the project behind it. This is
     the `focus` slot note-context grew for exactly this, and it replaces the
     `onCaptureTarget` callback the BOARD used to pass down and mirror into
     its own state — the widget should never need its caller to know how
     routing works. */
  useNoteScopeTarget({ kind: "visit", id: visit.id }, visit.label);
  const [linking, setLinking] = useState(false);
  const [jobText, setJobText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  const run = (
    fn: () => Promise<Result>,
    toastMsg?: string,
    undo?: () => void | Promise<void>
  ) => {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setErr(res.error);
      else if (toastMsg) onToast(toastMsg, undo);
      router.refresh();
    });
  };

  const undoable = (fn: () => Promise<Result>) => async () => {
    await fn();
    router.refresh();
  };

  const gates = projectGatesOf(visit);
  const missing = projectMissingOf(visit);
  const open = visit.status === "upcoming" || visit.status === "booked";
  const rel = untilLabel(visit.dueDate, today);
  const bookedDay = visit.bookedDate ?? (visit.bookedStart ? visit.bookedStart.slice(0, 10) : null);
  const mismatch = bookedDay ? placementMismatch(visit.dueDate, bookedDay) : null;
  const diary = sm8BookingMismatch(visit.bookedDate, visit.mirrorNextStart);
  const packed = visit.bringList.filter((i) => i.packed).length;
  const unpacked = visit.bringList.filter((i) => !i.packed);
  const unassigned = useMemo(
    () => staff.filter((s) => !visit.techs.some((t) => t.id === s.id)),
    [staff, visit.techs]
  );

  const toneChip = (() => {
    if (visit.status === "done") return <span className="wb2-chip ok">Completed</span>;
    if (visit.status === "skipped") return <span className="wb2-chip">Skipped</span>;
    if (visit.dueDate < today) return <span className="wb2-chip dan">{rel.t}</span>;
    if (missing.length === 0) return <span className="wb2-chip ok">Ready to run</span>;
    return (
      <span className={"wb2-chip" + (rel.tone === "dan" ? " dan" : rel.tone === "warn" ? " warn" : "")}>
        {rel.t}
      </span>
    );
  })();

  const place = (day: string) => {
    const from = visit.bookedDate;
    run(
      () => placeVisit(visit.id, day),
      `${from ? "Moved to" : "Placed on"} ${fmtAuWeekdayDayMonth(day)} — ${visit.label}`,
      undoable(() => (from ? placeVisit(visit.id, from) : clearVisitPlacement(visit.id)))
    );
  };

  const complete = () => {
    const hours = hoursText.trim() === "" ? null : Number(hoursText);
    setErr(null);
    start(async () => {
      const res = await completeVisit(visit.id, { ranOn, actualHours: hours, note: closeNote });
      if (!res.ok) {
        setErr(res.error);
        router.refresh();
        return;
      }
      if (carry && nextTrip && unpacked.length > 0) {
        await carryVisitBringItems(visit.id, nextTrip.id);
      }
      onToast(
        `Trip closed — ${visit.projectName}`,
        undoable(() => setVisitStatus(visit.id, "upcoming"))
      );
      router.refresh();
    });
  };

  const gateRow = (
    i: 0 | 1 | 2,
    label: string,
    tokenVar: string,
    on: boolean,
    tick: (() => void) | null,
    state: string,
    body: React.ReactNode
  ) => (
    <div className={"wb2-gate" + (on ? " on" : "") + (openGate === i ? " open" : "")}>
      <div className="wb2-gck">
        {tick ? (
          <button
            className="wb2-bx"
            disabled={busy || !open}
            title={on ? "Confirmed — click to reopen" : "Mark confirmed"}
            aria-label={`${label} — ${on ? "confirmed" : "not confirmed"}`}
            onClick={tick}
          >
            <Icon name="check" size={12} />
          </button>
        ) : (
          <span
            className={"wb2-bx derived" + (on ? " on" : "")}
            title="Ticks itself when someone is assigned"
            aria-hidden="true"
          >
            <Icon name="check" size={12} />
          </span>
        )}
        <span className="wb2-as" style={{ background: `var(${tokenVar})` }} aria-hidden="true" />
        <button
          className="wb2-gckl"
          aria-expanded={openGate === i}
          onClick={() => setOpenGate(openGate === i ? null : i)}
        >
          {label}
        </button>
        <em>{state}</em>
        <span className={"wb2-chev" + (openGate === i ? " up" : "")} aria-hidden="true">
          <Icon name="chevD" size={14} />
        </span>
      </div>
      {openGate === i && <div className="wb2-gbody">{body}</div>}
    </div>
  );

  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      <aside
        className={"wb2-sheet" + (closing ? " closingout" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={`${visit.projectName} — ${visit.label}`}
      >
        <div className="wb2-shtop">
          <span className="wb2-chip blue">Project trip</span>
          {toneChip}
          {visit.warn && <span className="wb2-chip dan">Went sideways in ServiceM8</span>}
          {diary === "differs" && (
            <span className="wb2-chip warn">ServiceM8 diary says another day</span>
          )}
          {/* ON THE SHEET, because nothing outside its scrim can be clicked
              — the topbar's button is unreachable the moment this opens, and
              the context tag could never do the one job it exists for. The
              sheet already says what it is about (below), so this arrives
              pointed at the right thing without being told. */}
          <TiffButton where="sheet" />
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
          {renaming && manage ? (
            <input
              className="wb2-fi"
              autoFocus
              value={labelText}
              aria-label="Trip name"
              onChange={(e) => setLabelText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setRenaming(false);
                  if (labelText.trim() && labelText !== visit.label) {
                    run(() => setProjectVisitLabel(visit.id, labelText));
                  }
                }
                if (e.key === "Escape") {
                  setRenaming(false);
                  setLabelText(visit.label);
                }
              }}
              onBlur={() => {
                setRenaming(false);
                if (labelText.trim() && labelText !== visit.label) {
                  run(() => setProjectVisitLabel(visit.id, labelText));
                }
              }}
            />
          ) : (
            <h2 onDoubleClick={manage ? () => setRenaming(true) : undefined}>{visit.label}</h2>
          )}
          <p>
            <Link href={`/dashboard/workboard/projects/${visit.projectId}`} className="ro-link">
              {visit.projectName}
            </Link>
            {visit.clientName ? ` · ${visit.clientName}` : ""}
            {visit.siteLabel ? ` · ${visit.siteLabel}` : ""}
          </p>
          <div className="wb2-facts">
            <div>
              <span className="wb2-sect">Around</span>
              <b>{fmtAuWeekdayDayMonth(visit.dueDate)}</b>
              <em className={rel.tone === "dan" ? "dan" : undefined}>{rel.t}</em>
            </div>
            <div>
              <span className="wb2-sect">Day</span>
              <b>{bookedDay ? fmtAuWeekdayDayMonth(bookedDay) : "No day yet"}</b>
              <em className={mismatch?.late ? "dan" : undefined}>
                {bookedDay
                  ? mismatch?.late
                    ? `${mismatch.daysAfterDue} ${mismatch.daysAfterDue === 1 ? "day" : "days"} after its target`
                    : visit.bookedDate
                      ? "placed on the board"
                      : "from the ServiceM8 diary"
                  : "placement is the time confirmation"}
              </em>
            </div>
            <div>
              <span className="wb2-sect">Bring list</span>
              <b>
                {visit.bringList.length
                  ? `${packed} of ${visit.bringList.length} packed`
                  : "—"}
              </b>
              <em>{visit.bringList.length ? "for this trip" : "nothing listed yet"}</em>
            </div>
            <div>
              <span className="wb2-sect">Reference</span>
              <b>{visit.jobNumber ? `#${visit.jobNumber}` : "—"}</b>
              <em>
                {visit.remoteId
                  ? "linked ServiceM8 job"
                  : connected
                    ? "no job linked"
                    : "standalone trip"}
              </em>
            </div>
          </div>
        </div>

        {err && <p className="wb2-sherr">{err}</p>}

        {open && (
          <div className="wb2-shsect">
            <div className="wb2-shsh">
              <span className="wb2-sect">Ready to run</span>
              <span className={"wb2-chip" + (missing.length ? " warn" : " ok")}>
                {missing.length
                  ? `${3 - missing.length} of 3 · waiting on ${missing
                      .map((g) => (g === "equipment" ? "equipment" : g === "access" ? "access" : "crew"))
                      .join(", ")}`
                  : "All three confirmed"}
              </span>
            </div>
            <div className="wb2-gates">
              {gateRow(
                0,
                "Equipment ready",
                "--wb2-eq",
                gates.equipment,
                () => run(() => setVisitReadiness(visit.id, "equipment_ready", !gates.equipment)),
                gates.equipment ? "Confirmed" : "Not yet",
                <>
                  {visit.bringList.length > 0 && (
                    <div className="wb2-shsh sub">
                      <span className="wb2-sect">To bring</span>
                      <span className={"wb2-chip" + (packed === visit.bringList.length ? " ok" : "")}>
                        {packed} of {visit.bringList.length} packed
                      </span>
                    </div>
                  )}
                  <div className="wb2-pklist">
                    {visit.bringList.map((i) => (
                      <div className={"wb2-pk" + (i.packed ? " on" : "")} key={i.id}>
                        <button
                          className="wb2-bx"
                          disabled={busy}
                          aria-label={i.packed ? `${i.label} — packed` : `Mark ${i.label} packed`}
                          onClick={() => run(() => setVisitBringPacked(i.id, !i.packed))}
                        >
                          <Icon name="check" size={11} />
                        </button>
                        <span className="wb2-pkl">{i.label}</span>
                        <button
                          className="wb2-pkx"
                          disabled={busy}
                          title="Take it off the list"
                          aria-label={`Remove ${i.label}`}
                          onClick={() => run(() => removeVisitBringItem(i.id))}
                        >
                          <Icon name="x" size={11} />
                        </button>
                      </div>
                    ))}
                    {visit.bringList.length === 0 && (
                      <p className="wb2-hint">
                        Nothing on this trip&apos;s list yet — closing the previous trip can carry
                        its leftovers here.
                      </p>
                    )}
                    <AddBringRow busy={busy} onAdd={(label) => run(() => addVisitBringItem(visit.id, label))} />
                  </div>
                </>
              )}
              {gateRow(
                1,
                "Access confirmed",
                "--wb2-acc",
                gates.access,
                () => run(() => setVisitReadiness(visit.id, "access_confirmed", !gates.access)),
                gates.access ? "Confirmed" : "Not yet",
                <ul className="wb2-ul">
                  <li>
                    {gates.access
                      ? "The site knows this trip is coming"
                      : "The site hasn't been told yet — one call covers telling them and getting in"}
                  </li>
                  <li>{bookedDay ? `Booked for ${fmtAuWeekdayDayMonth(bookedDay)}` : "No day booked yet"}</li>
                </ul>
              )}
              {gateRow(
                2,
                "Crew assigned",
                "--wb2-crew",
                gates.crew,
                null,
                visit.techs.length ? `${visit.techs.length} on it` : "Nobody yet",
                <div className="wb2-crew">
                  {visit.techs.map((t) => (
                    <div className="wb2-crewrow" key={t.id}>
                      <span className="wb2-av" aria-hidden="true">
                        {initialsOf(t.name)}
                      </span>
                      <b>{t.name}</b>
                      {manage && (
                        <button
                          className="wb2-pkx show"
                          disabled={busy}
                          title="Take them off this trip"
                          aria-label={`Unassign ${t.name}`}
                          onClick={() => run(() => unassignVisitTech(visit.id, t.id))}
                        >
                          <Icon name="x" size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                  {visit.techs.length === 0 && (
                    <p className="wb2-hint">
                      The gate ticks itself when someone is assigned — it is never ticked by hand.
                    </p>
                  )}
                  {manage && unassigned.length > 0 && (
                    <select
                      className="wb2-sel"
                      disabled={busy}
                      value=""
                      aria-label="Assign a technician"
                      onChange={(e) => {
                        const id = e.target.value;
                        if (id) run(() => assignVisitTech(visit.id, id));
                      }}
                    >
                      <option value="">
                        {visit.techs.length ? "Add another…" : "Nobody yet — pick one"}
                      </option>
                      {unassigned.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {open && manage && (
          <div className="wb2-shsect">
            <div className="wb2-shsh">
              <span className="wb2-sect">Day</span>
              {visit.bookedDate && (
                <button
                  className="pbtn ghost"
                  disabled={busy}
                  onClick={() => run(() => clearVisitPlacement(visit.id))}
                >
                  Take it off the day
                </button>
              )}
            </div>
            {diary === "differs" && visit.mirrorNextStart && (
              <p className="wb2-hint dan">
                The linked job&apos;s ServiceM8 diary says{" "}
                {fmtAuWeekdayDayMonth(visit.mirrorNextStart.slice(0, 10))} — the board says{" "}
                {visit.bookedDate ? fmtAuWeekdayDayMonth(visit.bookedDate) : "nothing"}. Neither
                writes to the other; square it up wherever the truth is.
              </p>
            )}
            {diary === "diary_only" && visit.mirrorNextStart && (
              <p className="wb2-hint">
                The linked job is booked {fmtAuWeekdayDayMonth(visit.mirrorNextStart.slice(0, 10))}{" "}
                in ServiceM8 — place the trip there too if that&apos;s the plan.
              </p>
            )}
            <div className="wb2-dayrow">
              <input
                type="date"
                className="wb2-fi"
                aria-label="Pick a day"
                value={pendingDay}
                onChange={(e) => setPendingDay(e.target.value)}
              />
              {pendingDay && isWeekendISO(pendingDay) ? (
                <>
                  <button
                    className="pbtn"
                    disabled={busy}
                    onClick={() => {
                      const day = rollToBusinessDay(pendingDay);
                      setPendingDay("");
                      place(day);
                    }}
                  >
                    Roll to {fmtAuWeekdayDayMonth(rollToBusinessDay(pendingDay))}
                  </button>
                  <button
                    className="pbtn ghost"
                    disabled={busy}
                    onClick={() => {
                      const day = pendingDay;
                      setPendingDay("");
                      place(day);
                    }}
                  >
                    Keep the {new Date(`${pendingDay}T12:00:00Z`).getUTCDay() === 6 ? "Saturday" : "Sunday"}
                  </button>
                </>
              ) : (
                <button
                  className="pbtn"
                  disabled={busy || !pendingDay}
                  onClick={() => {
                    const day = pendingDay;
                    setPendingDay("");
                    place(day);
                  }}
                >
                  {visit.bookedDate ? "Move it" : "Place it"}
                </button>
              )}
            </div>
            <p className="wb2-hint">
              Placing a trip on a day IS the time confirmation. Weekends are allowed on purpose —
              the board just checks you meant it.
            </p>
          </div>
        )}

        {manage && (
          <div className="wb2-shsect">
            <div className="wb2-shsh">
              <span className="wb2-sect">ServiceM8 job</span>
              {visit.remoteId || visit.jobNumber ? (
                <button
                  className="pbtn ghost"
                  disabled={busy}
                  onClick={() => run(() => unlinkVisitJob(visit.id))}
                >
                  Unlink
                </button>
              ) : (
                !linking && (
                  <button className="pbtn ghost" disabled={busy} onClick={() => setLinking(true)}>
                    Link a job
                  </button>
                )
              )}
            </div>
            {visit.jobNumber ? (
              <p className="wb2-hint">
                #{visit.jobNumber}
                {visit.mirrorStatus ? ` · ${visit.mirrorStatus} in ServiceM8` : ""} — the diary and
                completion flow back as garnish, never as writes.
              </p>
            ) : linking ? (
              <div className="wb2-dayrow">
                <input
                  className="wb2-fi"
                  autoFocus
                  placeholder="Job number"
                  value={jobText}
                  onChange={(e) => setJobText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const n = jobText.trim();
                      setLinking(false);
                      setJobText("");
                      if (n) run(() => linkVisitJob(visit.id, { jobNumber: n }));
                    }
                    if (e.key === "Escape") {
                      setLinking(false);
                      setJobText("");
                    }
                  }}
                />
                <button
                  className="pbtn"
                  disabled={busy || !jobText.trim()}
                  onClick={() => {
                    const n = jobText.trim();
                    setLinking(false);
                    setJobText("");
                    if (n) run(() => linkVisitJob(visit.id, { jobNumber: n }));
                  }}
                >
                  Link it
                </button>
              </div>
            ) : (
              <p className="wb2-hint">
                {connected
                  ? "Linking the raised job pulls its diary and completion through as garnish."
                  : "Type the job number if one exists — the trip works fine without."}
              </p>
            )}
          </div>
        )}

        <div className="wb2-shsect">
          <div className="wb2-shsh">
            <span className="wb2-sect">Notes for the trip</span>
          </div>
          <NoteToken as="field"
            label="notes for this trip"
            value={notesText}
            onChange={setNotesText}
            rows={3}
            placeholder="Gate codes, who to ask for, what to watch out for…"
          />
          {/* Save keeps it on the trip; Sort this out hands the same words to
              the note brain, which is what the pill does. */}
          <div className="wb2-noteact">
            {notesText !== (visit.notes ?? "") && manage && (
              <button
                className="pbtn"
                disabled={busy}
                onClick={() => run(() => setVisitNotes(visit.id, notesText))}
              >
                Save the note
              </button>
            )}
            {/* The "Sort this out" bridge is gone here for the same reason it
                went from the visit sheet: the field itself now offers the
                review when the words look actionable, so nobody has to be
                asked whether their own note was worth reading. */}
          </div>
        </div>

        {visit.status === "done" && (
          <div className="wb2-shsect">
            <div className="wb2-shsh">
              <span className="wb2-sect">Closed out</span>
              {visit.completedAt && (
                <span className="wb2-chip ok">ran {agoLabel(visit.completedAt, today)}</span>
              )}
            </div>
            <div className="wb2-facts">
              <div>
                <span className="wb2-sect">Ran on</span>
                <b>{visit.completedAt ? fmtAuWeekdayDayMonth(visit.completedAt) : "—"}</b>
                <em>{visit.completedSource === "servicem8" ? "closed from ServiceM8" : "closed manually"}</em>
              </div>
              <div>
                <span className="wb2-sect">On site</span>
                <b>{visit.actualHours !== null ? hoursLabel(visit.actualHours) : "—"}</b>
                <em>counts toward the hours budget</em>
              </div>
            </div>
            {visit.completionNote && <p className="wb2-notetext">{visit.completionNote}</p>}
            {manage && (
              <button
                className="pbtn ghost"
                disabled={busy}
                onClick={() => run(() => setVisitStatus(visit.id, "upcoming"))}
              >
                Reopen the trip
              </button>
            )}
          </div>
        )}

        {open && manage && (
          <div className="wb2-shft">
            {closing ? (
              <div className="wb2-closeout">
                <div className="wb2-shsh">
                  <span className="wb2-sect">Close it out</span>
                  <button
                    className="wb2-ico"
                    disabled={busy}
                    onClick={() => setClosing(false)}
                    title="Not yet"
                    aria-label="Not yet — leave it open"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <div className="wb2-corow">
                  <div className="wb2-coday">
                    <span className="wb2-sect">Day it ran</span>
                    {ranOnOpen ? (
                      <input
                        type="date"
                        className="wb2-fi"
                        aria-label="Day it ran"
                        max={today}
                        autoFocus
                        value={ranOn}
                        onChange={(e) => setRanOn(e.target.value)}
                      />
                    ) : (
                      <>
                        <b>{fmtAuWeekdayDayMonth(ranOn)}</b>
                        <button className="wb2-colink" onClick={() => setRanOnOpen(true)}>
                          {ranOn === bookedDay ? "the day it was booked · pick another" : "pick another"}
                        </button>
                      </>
                    )}
                  </div>
                  <label className="wb2-fl">
                    Hours on site
                    <input
                      type="number"
                      className="wb2-fi"
                      min={0.5}
                      max={24}
                      step={0.5}
                      value={hoursText}
                      placeholder="rough is fine"
                      onChange={(e) => setHoursText(e.target.value)}
                    />
                  </label>
                </div>
                <NoteToken as="field"
                  label="what happened on site"
                  value={closeNote}
                  onChange={setCloseNote}
                  rows={2}
                  placeholder="What happened on site — the project's story reads this."
                />
                {nextTrip && unpacked.length > 0 && (
                  <label className="wb2-carry">
                    <input
                      type="checkbox"
                      checked={carry}
                      onChange={(e) => setCarry(e.target.checked)}
                    />
                    Carry the {unpacked.length} unpacked{" "}
                    {unpacked.length === 1 ? "item" : "items"} to “{nextTrip.label}”
                  </label>
                )}
                <div className="wb2-coact">
                  <button className="pbtn" disabled={busy} onClick={complete}>
                    <Icon name="check" size={15} />
                    Mark the trip complete
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button className="pbtn" disabled={busy} onClick={() => setClosing(true)}>
                  <Icon name="check" size={15} />
                  Mark trip complete
                </button>
                <button
                  className="pbtn ghost"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => setVisitStatus(visit.id, "skipped"),
                      `Skipped — ${visit.label}`,
                      undoable(() => setVisitStatus(visit.id, "upcoming"))
                    )
                  }
                >
                  Skip this one
                </button>
                {confirmDelete ? (
                  <button
                    className="pbtn ghost dan"
                    disabled={busy}
                    onClick={() => {
                      run(() => deleteProjectVisit(visit.id), `Trip deleted — ${visit.label}`);
                      onClose();
                    }}
                  >
                    Really delete it
                  </button>
                ) : (
                  <button
                    className="pbtn ghost"
                    disabled={busy}
                    style={{ marginLeft: "auto" }}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete the trip
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </aside>
    </>,
    document.body
  );
}

function AddBringRow({ busy, onAdd }: { busy: boolean; onAdd: (label: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  if (!editing) {
    return (
      <button className="wb2-pk add" disabled={busy} onClick={() => setEditing(true)}>
        <Icon name="plus" size={12} />
        Add to the list
      </button>
    );
  }
  const commit = () => {
    const label = text.trim();
    setEditing(false);
    setText("");
    if (label) onAdd(label);
  };
  return (
    <input
      className="wb2-fi"
      autoFocus
      placeholder="What needs to come"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          setEditing(false);
          setText("");
        }
      }}
      onBlur={commit}
    />
  );
}
