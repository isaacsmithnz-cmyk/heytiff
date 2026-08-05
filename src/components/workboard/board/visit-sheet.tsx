"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import {
  isWeekendISO,
  placementMismatch,
  rollToBusinessDay,
} from "@/lib/workboard/board-status";
import type { VisitTone } from "@/lib/workboard/board-status";
import type { BoardTag, BoardTech, BoardVisit } from "@/lib/workboard/board-query";
import { fromLines, linesEqual, toLines } from "@/lib/workboard/note-lines";
import { NoteToken } from "@/components/notes/note-token";
import {
  assignVisitTech,
  clearVisitPlacement,
  completeVisit,
  createTag,
  placeVisit,
  setVisitNotes,
  setVisitPacked,
  setVisitReadiness,
  setVisitStatus,
  tagAgreement,
  unassignVisitTech,
  untagAgreement,
  updateAgreementMeta,
  addPackingItem,
  removePackingItem,
  type MaintenanceResult,
} from "@/app/actions/workboard-maintenance";
import { TagStrip } from "./tag-strip";
import type { TagTone } from "@/lib/workboard/tags";
import {
  agoLabel,
  cadencePhrase,
  crewLabel,
  gatesOf,
  hoursLabel,
  initialsOf,
  missingOf,
  untilLabel,
} from "./derive";

/* The visit sheet — the editing heart (audit step 2's brief, built whole):
   gates WITHOUT auto-assign (A12: the Crew gate has no tick — it derives
   from assignment, and assignment happens here by name), the day picker
   with the deliberate-weekend choice (B9) and the due/booked mismatch said
   out loud (K4), technician select, the packing list ticking off as the van
   loads (B14's chip finally renders), tags wearing their stored colours,
   notes, and the close-out K1 demanded — date it ran, ACTUAL hours, the
   technician's note. Completing tops the horizon up so the next visit
   exists the moment this one is history.

   Portals to <body>: the page-transition wrapper's will-change breaks
   position:fixed (the house modal rule). The board behind stays put. */

export function VisitSheet({
  visit,
  tone,
  today,
  staff,
  tagPool,
  manage,
  connected,
  startClosing = false,
  onToast,
  onClose,
}: {
  visit: BoardVisit;
  tone: VisitTone;
  today: string;
  staff: BoardTech[];
  tagPool: BoardTag[];
  manage: boolean;
  connected: boolean;
  /** Arriving from an Urgent "Close it out" opens straight onto the form. */
  startClosing?: boolean;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [openGate, setOpenGate] = useState<0 | 1 | 2 | null>(null);
  const [pendingDay, setPendingDay] = useState<string>("");
  const [closing, setClosing] = useState(startClosing);
  /* THE DAY IT RAN IS THE DAY IT WAS BOOKED. It used to default to today,
     which is only right if you close a job out the same afternoon — close
     Tuesday's visit on Thursday and it quietly recorded Thursday. Isaac,
     2026-08-02: "I don't understand the day it ran. I'm closing it out.
     Surely that's just the day that you were booked in to do it." So the
     booked day IS the answer and the form states it rather than asking; the
     input only appears if you say it's wrong. Clamped to today because a
     visit booked for next week can be closed out early, and it cannot have
     run in the future. */
  const [ranOn, setRanOn] = useState(() => {
    const booked = visit.bookedDate ?? (visit.bookedStart ? visit.bookedStart.slice(0, 10) : null);
    return booked && booked <= today ? booked : today;
  });
  const [ranOnOpen, setRanOnOpen] = useState(false);
  const [hoursText, setHoursText] = useState(
    visit.hoursEstimate !== null ? String(visit.hoursEstimate) : ""
  );
  const [closeNote, setCloseNote] = useState("");
  /* Notes are BULLETS — a line each, in the same text column. Once there ARE
     notes the section READS: full wrapped lines you can take in at a glance.
     Editing them is a mode you ask for, and adding one more is its own button
     that opens the mic-and-add row from the note pill. Isaac, 2026-08-04: "I
     can't read the full thing… it should come up as read only once it has been
     put in the first time, and then you can edit the whole notes section if
     you want to." The draft list only exists while editing; `fromLines` puts
     it back together at save time. */
  const [noteLines, setNoteLines] = useState<string[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [notesEditing, setNotesEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [crewOpen, setCrewOpen] = useState(false);
  const [estText, setEstText] = useState(
    visit.hoursEstimate !== null ? String(visit.hoursEstimate) : ""
  );
  const closeRef = useRef<HTMLButtonElement>(null);

  // The parent keys this component by visit id, so drafts start clean per
  // visit; the only mount work is putting focus on Close (B21's lesson).
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

  /** Actions whose effect stays visible in the sheet run silently; ones
      whose subject LEAVES a list (placed, completed, skipped) raise a toast
      carrying their own inverse (B23). */
  const run = (
    fn: () => Promise<MaintenanceResult>,
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

  const undoable = (fn: () => Promise<MaintenanceResult>) => async () => {
    await fn();
    router.refresh();
  };

  const gates = gatesOf(visit);
  const missing = missingOf(visit);
  /** What's actually stored, which is what the read view shows. */
  const savedNotes = useMemo(() => toLines(visit.notes), [visit.notes]);
  const open = visit.status === "upcoming" || visit.status === "booked";
  const isQuote = tone === "quote";
  const rel = untilLabel(visit.dueDate, today);
  const packedCount = visit.packedIds.filter((id) =>
    visit.packing.some((p) => p.id === id)
  ).length;
  const bookedDay = visit.bookedDate ?? (visit.bookedStart ? visit.bookedStart.slice(0, 10) : null);
  const mismatch = bookedDay ? placementMismatch(visit.dueDate, bookedDay) : null;
  const unassigned = useMemo(
    () => staff.filter((s) => !visit.techs.some((t) => t.id === s.id)),
    [staff, visit.techs]
  );

  const toneChip = (() => {
    if (visit.status === "done") return <span className="wb2-chip ok">Completed</span>;
    if (visit.status === "skipped") return <span className="wb2-chip">Skipped</span>;
    if (isQuote) return <span className="wb2-chip">Quote</span>;
    if (tone === "over") return <span className="wb2-chip dan">{rel.t}</span>;
    if (tone === "go") return <span className="wb2-chip ok">Ready to run</span>;
    return <span className={"wb2-chip" + (tone === "flash" ? " dan" : tone === "soon" ? " warn" : "")}>{rel.t}</span>;
  })();

  const place = (day: string) => {
    const from = visit.bookedDate;
    run(
      () => placeVisit(visit.id, day),
      `${from ? "Moved to" : "Placed on"} ${fmtAuWeekdayDayMonth(day)} — ${visit.clientName}`,
      undoable(() => (from ? placeVisit(visit.id, from) : clearVisitPlacement(visit.id)))
    );
  };

  const cancelEstimate = () => {
    setEstText(visit.hoursEstimate !== null ? String(visit.hoursEstimate) : "");
    setHoursOpen(false);
  };

  const saveEstimate = () => {
    const raw = estText.trim();
    setHoursOpen(false);
    if (raw === (visit.hoursEstimate !== null ? String(visit.hoursEstimate) : "")) return;
    run(() =>
      updateAgreementMeta(visit.agreementId, {
        hoursEstimate: raw === "" ? null : Number(raw),
      })
    );
  };

  const saveCrew = (n: number) => {
    setCrewOpen(false);
    if (n === visit.techsNeeded) return;
    run(() => updateAgreementMeta(visit.agreementId, { techsNeeded: n }));
  };

  /** Notes save through here rather than `run` so the section only leaves the
      mode it's in once the write actually landed — a failed save that had
      already thrown the editor away would take the words with it. */
  const saveNotes = (next: string[], after?: () => void) => {
    setErr(null);
    start(async () => {
      const res = await setVisitNotes(visit.id, fromLines(next));
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      after?.();
      router.refresh();
    });
  };

  /* One control, two honest meanings. Adding a note to a list you're only
     READING commits it there and then — nothing is half-entered and there's
     no Save to forget. Adding one while you're editing the whole section
     joins the draft, and leaves with everything else on Save. */
  const commitDraft = () => {
    const line = noteDraft.trim();
    if (!line) return;
    if (notesEditing) {
      setNoteLines([...noteLines, line]);
      setNoteDraft("");
      return;
    }
    saveNotes([...savedNotes, line], () => {
      setNoteDraft("");
      setAdding(true);
    });
  };

  const startEditingNotes = () => {
    setNoteLines(savedNotes);
    setNoteDraft("");
    setAdding(false);
    setNotesEditing(true);
  };

  const cancelEditingNotes = () => {
    setNoteDraft("");
    setNotesEditing(false);
  };

  const addTag = (name: string, colour: TagTone) =>
    run(async () => {
      const made = await createTag(name, colour);
      if (!made.ok || !made.id) return made;
      return tagAgreement(visit.agreementId, made.id);
    });

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
            disabled={busy || !open || isQuote}
            title={on ? "Confirmed — click to reopen" : "Mark confirmed"}
            aria-label={`${label} — ${on ? "confirmed" : "not confirmed"}`}
            onClick={tick}
          >
            <Icon name="check" size={12} />
          </button>
        ) : (
          <span className={"wb2-bx derived" + (on ? " on" : "")} title="Ticks itself when someone is assigned" aria-hidden="true">
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
      {/* `closingout` recedes everything above the footer — Isaac asked for
          "a bit more separation between the close it out card and the
          remainder of the card". Closing out is a one-thing-at-a-time act. */}
      <aside
        className={"wb2-sheet" + (closing ? " closingout" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={`${visit.clientName} — ${visit.label}`}
      >
        {/* The strip says WHAT THIS IS in the words you'd use on the phone:
            the number, then the name you gave the job. It used to lead with
            a "Service visit" chip and hold the name a band lower, which
            meant the first line of the job card was the one thing about it
            that never varies. Chips keep their place beside it. */}
        <div className="wb2-shtop">
          <span className="wb2-shno">{visit.jobNo !== null ? `#${visit.jobNo}` : "—"}</span>
          <h2 className="wb2-shname">{visit.label}</h2>
          <span className="wb2-shchips">
            <span className="wb2-chip blue">Service visit</span>
            {toneChip}
            {visit.jobNumber ? (
              <span className="wb2-chip" title="The job's number in ServiceM8">
                SM8 #{visit.jobNumber}
              </span>
            ) : (
              /* Only worth saying when there's a ServiceM8 to raise it in.
                 Standalone, an agreement visit having no SM8 job is the
                 normal case and not news. */
              connected &&
              open && (
                <span className="wb2-chip" title="Nothing for it in ServiceM8 yet">
                  No ServiceM8 job
                </span>
              )
            )}
            {visit.warn && <span className="wb2-chip dan">Went sideways in ServiceM8</span>}
          </span>
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
          <p>
            {visit.clientName}
            {visit.siteLabel ? ` · ${visit.siteLabel}` : ""}
          </p>
          <div className="wb2-facts">
            <div>
              <span className="wb2-sect">Due</span>
              <b>{fmtAuWeekdayDayMonth(visit.dueDate)}</b>
              <em className={rel.tone === "dan" ? "dan" : undefined}>{rel.t}</em>
            </div>
            {/* The two estimates live on the AGREEMENT — how long one visit of
                this service takes and how many people it takes, both answered
                when the agreement was written. They used to show as one tile
                called "On site", which named neither: it read as a fact about
                THIS visit rather than the service. Isaac, 2026-08-04: "it says
                on site as well, we need to change that to estimated service
                time, and we'll also have estimated crew size — two fields you
                enter when creating the service agreement." Changing either one
                changes it where it lives, for every visit. */}
            <div>
              <span className="wb2-sect">Estimated service time</span>
              {hoursOpen ? (
                <div className="wb2-inline">
                  <input
                    type="number"
                    className="wb2-fi"
                    min={0.5}
                    max={24}
                    step={0.5}
                    autoFocus
                    aria-label="Hours a visit takes"
                    value={estText}
                    onChange={(e) => setEstText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveEstimate();
                      }
                      if (e.key === "Escape") cancelEstimate();
                    }}
                  />
                  <button className="wb2-addgo" disabled={busy} title="Save it" aria-label="Save the estimate" onClick={saveEstimate}>
                    <Icon name="check" size={13} />
                  </button>
                </div>
              ) : (
                <b>{visit.hoursEstimate !== null ? hoursLabel(visit.hoursEstimate) : "Not estimated"}</b>
              )}
              {!hoursOpen &&
                (manage ? (
                  <button
                    className="wb2-colink"
                    aria-label="Change the estimated service time"
                    onClick={() => setHoursOpen(true)}
                  >
                    every visit of this agreement · change
                  </button>
                ) : (
                  <em>every visit of this agreement</em>
                ))}
            </div>
            <div>
              <span className="wb2-sect">Estimated crew size</span>
              {crewOpen ? (
                <div className="wb2-inline">
                  <select
                    className="wb2-sel"
                    autoFocus
                    disabled={busy}
                    aria-label="Technicians a visit takes"
                    value={visit.techsNeeded}
                    onChange={(e) => saveCrew(Number(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setCrewOpen(false);
                    }}
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {crewLabel(n)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <b>{crewLabel(visit.techsNeeded)}</b>
              )}
              {!crewOpen &&
                (manage ? (
                  <button
                    className="wb2-colink"
                    aria-label="Change the estimated crew size"
                    onClick={() => setCrewOpen(true)}
                  >
                    every visit of this agreement · change
                  </button>
                ) : (
                  <em>every visit of this agreement</em>
                ))}
            </div>
          </div>
        </div>

        {err && <p className="wb2-sherr">{err}</p>}

        {open && !isQuote && (
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
                  {visit.packing.length > 0 && (
                    <div className="wb2-shsh sub">
                      <span className="wb2-sect">To bring</span>
                      <span className={"wb2-chip" + (packedCount === visit.packing.length ? " ok" : "")}>
                        {packedCount} of {visit.packing.length} packed
                      </span>
                    </div>
                  )}
                  <div className="wb2-pklist">
                    {visit.packing.map((p) => {
                      const isPacked = visit.packedIds.includes(p.id);
                      return (
                        <div className={"wb2-pk" + (isPacked ? " on" : "")} key={p.id}>
                          <button
                            className="wb2-bx"
                            disabled={busy}
                            aria-label={isPacked ? `${p.label} — packed` : `Mark ${p.label} packed`}
                            onClick={() => run(() => setVisitPacked(visit.id, p.id, !isPacked))}
                          >
                            <Icon name="check" size={11} />
                          </button>
                          <span className="wb2-pkl">{p.label}</span>
                          {manage && (
                            <button
                              className="wb2-pkx"
                              disabled={busy}
                              title="Remove from the list"
                              aria-label={`Remove ${p.label}`}
                              onClick={() => run(() => removePackingItem(p.id))}
                            >
                              <Icon name="x" size={11} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {visit.packing.length === 0 && (
                      <p className="wb2-hint">Nothing on the packing list for this agreement yet.</p>
                    )}
                    {manage && <AddPackRow busy={busy} onAdd={(label) => run(() => addPackingItem(visit.agreementId, label))} />}
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
                      ? `${visit.clientName} knows about this visit`
                      : `${visit.clientName} hasn't been told yet — one phone call covers telling them and getting in`}
                  </li>
                  {visit.accessNotes ? <li>{visit.accessNotes}</li> : <li>No access notes on the agreement.</li>}
                  <li>{bookedDay ? `Booked for ${fmtAuWeekdayDayMonth(bookedDay)}` : "No day booked yet"}</li>
                </ul>
              )}
              {gateRow(
                2,
                "Crew assigned",
                "--wb2-crew",
                gates.crew,
                null,
                visit.techs.length
                  ? `${visit.techs.length} of ${visit.techsNeeded}`
                  : "Nobody yet",
                <div className="wb2-crew">
                  {visit.techs.map((t) => (
                    <div className="wb2-crewrow" key={t.id}>
                      <span className="wb2-av" aria-hidden="true">{initialsOf(t.name)}</span>
                      <b>{t.name}</b>
                      {manage && (
                        <button
                          className="wb2-pkx show"
                          disabled={busy}
                          title="Take them off this visit"
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
                  {visit.techsNeeded > 1 && (
                    <p className="wb2-hint">
                      The agreement estimates {crewLabel(visit.techsNeeded)} — one assigned still
                      opens the gate, the count is information.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ONE section for when this job happens. There used to be two: a
            "Day" tile up in the facts saying the date, and a "Day" card down
            here to change it — the same fact said twice, in two different
            vocabularies, and neither of them said "scheduled". Isaac,
            2026-08-03: "surely we can just have a scheduled section… and just
            incorporate it all to one." */}
        <div className="wb2-shsect">
          <div className="wb2-shsh">
            <span className="wb2-sect">Scheduled</span>
            {open && !isQuote && manage && visit.bookedDate && (
              <button
                className="pbtn ghost"
                disabled={busy}
                onClick={() => run(() => clearVisitPlacement(visit.id))}
              >
                Unschedule it
              </button>
            )}
          </div>

          <div className="wb2-sched">
            <b className={bookedDay ? undefined : "none"}>
              {bookedDay ? fmtAuWeekdayDayMonth(bookedDay) : "No visit scheduled"}
            </b>
            <em className={mismatch?.late ? "dan" : undefined}>
              {bookedDay
                ? mismatch?.late
                  ? `${mismatch.daysAfterDue} ${mismatch.daysAfterDue === 1 ? "day" : "days"} after it was due`
                  : visit.bookedDate
                    ? "placed on the board"
                    : "from the ServiceM8 diary"
                : `Due ${fmtAuWeekdayDayMonth(visit.dueDate)} — putting it on a day is what confirms the time`}
            </em>
          </div>

          {open && !isQuote && manage && (
            <>
              <div className="wb2-dayrow">
                <input
                  type="date"
                  className="wb2-fi"
                  aria-label={bookedDay ? "Move it to another day" : "Pick a day"}
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
                    {visit.bookedDate ? "Move it" : "Schedule it"}
                  </button>
                )}
              </div>
              <p className="wb2-hint">
                Comes round {cadencePhrase(visit.intervalMonths)}. Weekends are allowed on purpose —
                the board just checks you meant it.
              </p>
            </>
          )}
        </div>

        <div className="wb2-shsect">
          <div className="wb2-shsh">
            <span className="wb2-sect">Tags</span>
            <span className="wb2-chip">{visit.tags.length || "none"}</span>
          </div>
          <TagStrip
            tags={visit.tags}
            pool={tagPool}
            manage={manage}
            busy={busy}
            hint="Tags live on the agreement — every visit of it wears them."
            onAdd={addTag}
            onPick={(tagId) => run(() => tagAgreement(visit.agreementId, tagId))}
            onRemove={(tagId) => run(() => untagAgreement(visit.agreementId, tagId))}
          />
        </div>

        <div className="wb2-shsect">
          <div className="wb2-shsh">
            <span className="wb2-sect">Notes for the visit</span>
          </div>
          {/* One note per line, because that's how they're actually said —
              "gate code is 4821", "ask for Dave", "roof ladder won't reach".
              A paragraph made you read all three to find one. Storage didn't
              change: a line IS a bullet, see lib/workboard/note-lines.

              READING is the resting state. The rows used to be single-line
              inputs that clipped anything longer than the column, so a note
              you couldn't finish reading was a note you'd typed. Now the
              stored lines wrap in full, and the two things you might want —
              one more note, or a go at the lot — are two buttons. */}
          {manage && notesEditing ? (
            <>
              {noteLines.length > 0 && (
                <ul className="wb2-blist">
                  {noteLines.map((line, i) => (
                    <li key={i}>
                      <span className="wb2-bdot" aria-hidden="true" />
                      <NoteRow
                        value={line}
                        index={i}
                        onChange={(next) => {
                          const rows = [...noteLines];
                          rows[i] = next;
                          setNoteLines(rows);
                        }}
                        onBlank={() => setNoteLines(noteLines.filter((_, j) => j !== i))}
                      />
                      <button
                        className="wb2-pkx"
                        title="Take it off"
                        aria-label={`Remove note ${i + 1}`}
                        onClick={() => setNoteLines(noteLines.filter((_, j) => j !== i))}
                      >
                        <Icon name="x" size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <NoteToken as="line"
                label="a note for this visit"
                value={noteDraft}
                onChange={setNoteDraft}
                onCommit={commitDraft}
                placeholder={
                  noteLines.length
                    ? "Add another…"
                    : "Gate codes, who to ask for, what to watch out for…"
                }
              />
              <div className="wb2-noteact">
                <button
                  className="pbtn"
                  disabled={busy || linesEqual(noteLines, savedNotes)}
                  onClick={() => saveNotes(noteLines, () => setNotesEditing(false))}
                >
                  Save the notes
                </button>
                <button className="pbtn ghost" disabled={busy} onClick={cancelEditingNotes}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              {savedNotes.length > 0 ? (
                <ul className="wb2-blist read">
                  {savedNotes.map((line, i) => (
                    <li key={i}>
                      <span className="wb2-bdot" aria-hidden="true" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                !manage && <p className="wb2-hint">No notes on this visit.</p>
              )}
              {manage && (
                <>
                  {/* Nothing written yet? Then there's nothing to read and the
                      row you'd type into is the whole section. Once the first
                      note is down, adding another is a button away. */}
                  {(adding || savedNotes.length === 0) && (
                    <NoteToken as="line"
                      label="a note for this visit"
                      value={noteDraft}
                      onChange={setNoteDraft}
                      onCommit={commitDraft}
                      disabled={busy}
                      placeholder={
                        savedNotes.length
                          ? "Add another…"
                          : "Gate codes, who to ask for, what to watch out for…"
                      }
                    />
                  )}
                  {/* "SORT THIS OUT" IS GONE, and its absence is the point.
                      It existed because the box you typed notes into and the
                      thing that could turn notes into tasks were different
                      components, so a button had to carry text between them.
                      The token does both, and offers the review itself when
                      the words look like a job for somebody — see the sniff.
                      A button asking you to decide whether your own sentence
                      was interesting was always the wrong question. */}
                  <div className="wb2-noteact">
                    {savedNotes.length > 0 &&
                      (adding ? (
                        <button
                          className="pbtn ghost"
                          disabled={busy}
                          onClick={() => {
                            setAdding(false);
                            setNoteDraft("");
                          }}
                        >
                          Done adding
                        </button>
                      ) : (
                        <button className="pbtn" disabled={busy} onClick={() => setAdding(true)}>
                          <Icon name="plus" size={15} />
                          Add note
                        </button>
                      ))}
                    {savedNotes.length > 0 && (
                      <button className="pbtn ghost" disabled={busy} onClick={startEditingNotes}>
                        <Icon name="edit" size={15} />
                        Edit notes
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {visit.status === "done" && (
          <div className="wb2-shsect">
            <div className="wb2-shsh">
              <span className="wb2-sect">Closed out</span>
              {visit.completedAt && <span className="wb2-chip ok">ran {agoLabel(visit.completedAt, today)}</span>}
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
                <em>
                  {visit.hoursEstimate !== null ? `booked ${hoursLabel(visit.hoursEstimate)}` : "actual"}
                </em>
              </div>
            </div>
            {visit.completionNote && <p className="wb2-notetext">{visit.completionNote}</p>}
            {manage && (
              <button className="pbtn ghost" disabled={busy} onClick={() => run(() => setVisitStatus(visit.id, "upcoming"))}>
                Reopen the visit
              </button>
            )}
          </div>
        )}

        {open && manage && (
          <div className={"wb2-shft" + (closing ? "" : " end")}>
            {closing ? (
              <div className="wb2-closeout">
                <div className="wb2-shsh">
                  <span className="wb2-sect">Close it out</span>
                  {/* "Not yet" was a button competing with the one that
                      matters. Backing out of a card is an × on the card. */}
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
                      placeholder={visit.hoursEstimate !== null ? String(visit.hoursEstimate) : "e.g. 3"}
                      onChange={(e) => setHoursText(e.target.value)}
                    />
                  </label>
                </div>
                <NoteToken as="field"
                  label="what happened on site"
                  value={closeNote}
                  onChange={setCloseNote}
                  rows={2}
                  placeholder="What happened on site — the Completed screen reads this."
                />
                <div className="wb2-coact">
                  <button
                    className="pbtn"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          completeVisit(visit.id, {
                            ranOn,
                            actualHours: hoursText.trim() === "" ? null : Number(hoursText),
                            note: closeNote,
                          }),
                        `Completed — ${visit.clientName}`,
                        undoable(() => setVisitStatus(visit.id, "upcoming"))
                      )
                    }
                  >
                    <Icon name="check" size={15} />
                    Mark it complete
                  </button>
                </div>
              </div>
            ) : (
              /* One button, on the right, where the close-out card's own
                 primary already sits. "Skip this one" used to sit beside it
                 — Isaac, 2026-08-03: "why would we be skipping it?" There
                 was no answer: a visit that isn't happening today gets moved
                 to the day it IS happening, and one that's never happening
                 means the agreement has changed. Skipping was a third thing
                 that recorded neither. */
              <button className="pbtn" disabled={busy} onClick={() => setClosing(true)}>
                <Icon name="check" size={15} />
                Mark visit complete
              </button>
            )}
          </div>
        )}
      </aside>
    </>,
    document.body
  );
}

/* An editable bullet that shows the WHOLE note. It was an <input>, which
   clips at the column edge — the note you couldn't read was one you'd already
   written. A textarea that sizes itself to its content reads like the bullet
   it's editing, and Enter still commits rather than opening a second line:
   one line is one note, which is the whole point of the list. */
function NoteRow({
  value,
  index,
  onChange,
  onBlank,
}: {
  value: string;
  index: number;
  onChange: (next: string) => void;
  /** Emptying a bullet takes it off the list, same as the ×. */
  onBlank: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="wb2-bin"
      rows={1}
      value={value}
      aria-label={`Note ${index + 1}`}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
      onBlur={() => {
        if (value.trim() === "") onBlank();
      }}
    />
  );
}

function AddPackRow({ busy, onAdd }: { busy: boolean; onAdd: (label: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  if (!editing) {
    return (
      <button className="wb2-pk add" disabled={busy} onClick={() => setEditing(true)}>
        <Icon name="plus" size={12} />
        Add equipment
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
