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
import { DictateBox } from "../dictation";
import { useNoteBrain } from "../note-brain-context";
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
  addPackingItem,
  removePackingItem,
  type MaintenanceResult,
} from "@/app/actions/workboard-maintenance";
import {
  agoLabel,
  cadenceLabel,
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
  const { voiceEnabled, send: sendToBrain } = useNoteBrain();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [openGate, setOpenGate] = useState<0 | 1 | 2 | null>(null);
  const [pendingDay, setPendingDay] = useState<string>("");
  const [addingTag, setAddingTag] = useState(false);
  const [tagText, setTagText] = useState("");
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
  const [notesText, setNotesText] = useState(visit.notes ?? "");
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
  const tagSuggestions = tagPool.filter((t) => !visit.tags.some((x) => x.id === t.id));

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

  const addTag = (raw: string) => {
    const name = raw.trim();
    if (!name) {
      setAddingTag(false);
      return;
    }
    const existing = tagPool.find((t) => t.name.toLowerCase() === name.toLowerCase());
    setTagText("");
    setAddingTag(false);
    run(async () => {
      if (existing) return tagAgreement(visit.agreementId, existing.id);
      const made = await createTag(name);
      if (!made.ok || !made.id) return made;
      return tagAgreement(visit.agreementId, made.id);
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
        <div className="wb2-shtop">
          <span className="wb2-chip blue">Service visit</span>
          {toneChip}
          {visit.warn && <span className="wb2-chip dan">Went sideways in ServiceM8</span>}
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
          <h2>
            {visit.label} — {cadenceLabel(visit.intervalMonths)}
          </h2>
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
            <div>
              <span className="wb2-sect">Day</span>
              <b>{bookedDay ? fmtAuWeekdayDayMonth(bookedDay) : "No day yet"}</b>
              <em className={mismatch?.late ? "dan" : undefined}>
                {bookedDay
                  ? mismatch?.late
                    ? `${mismatch.daysAfterDue} ${mismatch.daysAfterDue === 1 ? "day" : "days"} after it was due`
                    : visit.bookedDate
                      ? "placed on the board"
                      : "from the ServiceM8 diary"
                  : "placement is the time confirmation"}
              </em>
            </div>
            <div>
              <span className="wb2-sect">On site</span>
              <b>{visit.hoursEstimate !== null ? hoursLabel(visit.hoursEstimate) : "—"}</b>
              <em>estimated</em>
            </div>
            <div>
              <span className="wb2-sect">Reference</span>
              <b>{visit.jobNumber ? `#${visit.jobNumber}` : "—"}</b>
              <em>{visit.remoteId ? "linked ServiceM8 job" : connected ? "no job raised yet" : "agreement visit"}</em>
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
                      This service usually takes {visit.techsNeeded} — one assigned still opens the
                      gate, the count is information.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {open && !isQuote && manage && (
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
              Placing a visit on a day IS the time confirmation. Weekends are allowed on purpose —
              the board just checks you meant it.
            </p>
          </div>
        )}

        <div className="wb2-shsect">
          <div className="wb2-shsh">
            <span className="wb2-sect">Tags</span>
            <span className="wb2-chip">{visit.tags.length || "none"}</span>
          </div>
          <div className="wb2-tags">
            {visit.tags.map((t) => (
              <span className={`wb2-tag on t-${t.color}`} key={t.id}>
                {t.name}
                {manage && (
                  <button
                    disabled={busy}
                    title="Remove"
                    aria-label={`Remove ${t.name}`}
                    onClick={() => run(() => untagAgreement(visit.agreementId, t.id))}
                  >
                    <Icon name="x" size={10} />
                  </button>
                )}
              </span>
            ))}
            {manage &&
              (addingTag ? (
                <input
                  className="wb2-tagin"
                  autoFocus
                  placeholder="Type or pick a tag"
                  value={tagText}
                  onChange={(e) => setTagText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag(tagText);
                    }
                    if (e.key === "Escape") {
                      setAddingTag(false);
                      setTagText("");
                    }
                  }}
                  onBlur={() => addTag(tagText)}
                />
              ) : (
                <button className="wb2-tag add" disabled={busy} onClick={() => setAddingTag(true)}>
                  <Icon name="plus" size={11} />
                  Add tag
                </button>
              ))}
          </div>
          {manage && addingTag && tagSuggestions.length > 0 && (
            <div className="wb2-tagsug">
              {tagSuggestions.map((t) => (
                <button
                  key={t.id}
                  className={`wb2-tag sug t-${t.color}`}
                  disabled={busy}
                  // mousedown, not click: the input's blur would unmount this
                  // button before a click could land on it
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setAddingTag(false);
                    setTagText("");
                    run(() => tagAgreement(visit.agreementId, t.id));
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <p className="wb2-hint">Tags live on the agreement — every visit of it wears them.</p>
        </div>

        <div className="wb2-shsect">
          <div className="wb2-shsh">
            <span className="wb2-sect">Notes for the visit</span>
          </div>
          {manage ? (
            <>
              <DictateBox
                label="notes for this visit"
                value={notesText}
                onChange={setNotesText}
                voiceEnabled={voiceEnabled}
                rows={3}
                placeholder="Gate codes, who to ask for, what to watch out for…"
              />
              {/* Two different things you might mean by "note", said plainly.
                  SAVE keeps it on the visit for whoever turns up. SORT IT OUT
                  hands the same words to the note brain, which is what the
                  pill does — a box labelled "notes" that couldn't raise the
                  task it describes was the gap Isaac called out. The pill's
                  target already follows this sheet, so it lands here. */}
              <div className="wb2-noteact">
                {notesText !== (visit.notes ?? "") && (
                  <button
                    className="pbtn"
                    disabled={busy}
                    onClick={() => run(() => setVisitNotes(visit.id, notesText))}
                  >
                    Save the note
                  </button>
                )}
                {sendToBrain && notesText.trim() !== "" && (
                  <button
                    className="pbtn ghost"
                    disabled={busy}
                    title="Pull the tasks, flags and questions out of this"
                    onClick={() => sendToBrain(notesText)}
                  >
                    <Icon name="sparkles" size={15} />
                    Sort this out
                  </button>
                )}
              </div>
            </>
          ) : visit.notes ? (
            <p className="wb2-notetext">{visit.notes}</p>
          ) : (
            <p className="wb2-hint">No notes on this visit.</p>
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
          <div className="wb2-shft">
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
                <DictateBox
                  label="what happened on site"
                  value={closeNote}
                  onChange={setCloseNote}
                  voiceEnabled={voiceEnabled}
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
              <>
                <button className="pbtn" disabled={busy} onClick={() => setClosing(true)}>
                  <Icon name="check" size={15} />
                  Mark visit complete
                </button>
                <button
                  className="pbtn ghost"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => setVisitStatus(visit.id, "skipped"),
                      `Skipped — ${visit.clientName}`,
                      undoable(() => setVisitStatus(visit.id, "upcoming"))
                    )
                  }
                >
                  Skip this one
                </button>
              </>
            )}
          </div>
        )}
      </aside>
    </>,
    document.body
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
