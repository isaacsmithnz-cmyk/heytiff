"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { ViewTabs, type ViewTab } from "@/components/shell/view-tabs";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import {
  BOARD_DONE_DAYS,
  isWeekendISO,
  placementMismatch,
  rollToBusinessDay,
} from "@/lib/workboard/board-status";
import type { VisitTone } from "@/lib/workboard/board-status";
import type {
  BoardEquipment,
  BoardTag,
  BoardTech,
  BoardVisit,
} from "@/lib/workboard/board-query";
import { fromLines, linesEqual, toLines } from "@/lib/workboard/note-lines";
import { NoteToken } from "@/components/notes/note-token";
import { useNoteScopeTarget } from "@/components/notes/note-context";
import { TiffButton } from "@/components/notes/tiff-button";
import { catTintVars } from "@/lib/workboard/card-tint";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
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
  cadenceLabel,
  crewLabel,
  equipmentLine,
  gatesOf,
  hoursLabel,
  initialsOf,
  missingOf,
  untilLabel,
} from "./derive";
import { DateField } from "@/components/ui/date-field";

/* The visit sheet — the editing heart of the maintenance board, wearing the
   job card's dress.

   A CARD OF TABS, cut from the job card (Isaac, 2026-08-29: "create a
   maintenance one … from that card"): the tinted band up top — the
   agreement category's accent as a wash with the 3px crown, the visit's own
   number and name, the chips — then the folder tabs, then the white body.
   The chrome is the job card's VERBATIM (`.wb2-jcband / .wb2-vtabs /
   .wb2-jcbody / .wb2-jcdhead` — same classes, not lookalikes), because two
   dresses drift and one doesn't.

   THREE FACES, because that is what a visit honestly holds:
   Visit    — the work: the facts, the three gates (packing rides inside
              Equipment, as walked), and the day it lands on.
   Notes    — the visit's own written record, and the agreement's tags.
   History  — what happened the last times this agreement ran: the board's
              own done rows, previously unreachable from this card.

   WHAT DID NOT CHANGE IS THE POINT. Gates without auto-assign (A12: the
   Crew gate has no tick — it derives from assignment), the day picker with
   the deliberate-weekend choice (B9) and the due/booked mismatch said out
   loud (K4), the packing list ticking off as the van loads, notes reading
   by default and editing as a mode, and the close-out K1 demanded — all of
   it verbatim, in the footer band where it always was. Only the room the
   work happens in got the new walls.

   Portals to <body>: the page-transition wrapper's will-change breaks
   position:fixed (the house modal rule). The board behind stays put. */

type TabKey = "visit" | "notes" | "history";

export function VisitSheet({
  visit,
  tone,
  today,
  staff,
  tagPool,
  manage,
  connected,
  history = [],
  lastDone = null,
  siteRequirements = null,
  equipment = [],
  startClosing = false,
  onOpenAgreement,
  onOpenVisit,
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
  /** This agreement's OTHER closed-out visits, from the board's own done
      window — the History face. The board filters; the sheet only sorts. */
  history?: BoardVisit[];
  /** When this agreement last ran, from the agreement's own uncapped query —
      an annual service's answer is always outside the board's done window. */
  lastDone?: string | null;
  /** The agreement's standing "before you go" facts — inductions, PPE,
      white cards. The Summary reads them out loud. */
  siteRequirements?: string | null;
  /** The units on this site, from the agreement's register — what the
      visit is actually there to service. */
  equipment?: BoardEquipment[];
  /** Arriving from an Urgent "Close it out" opens straight onto the form. */
  startClosing?: boolean;
  /** Opens the service agreement behind this visit — the band's chip door. */
  onOpenAgreement: (agreementId: string) => void;
  /** Opens another visit of this agreement — a History row is a door. */
  onOpenVisit: (visitId: string) => void;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("visit");
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
  /* WHAT THIS SHEET IS ABOUT, reported up so anything that captures while it
     is open lands on this visit. It replaces an `onCaptureTarget` callback
     that the BOARD passed down and mirrored into its own state — the widget
     should never need its caller to know how routing works, and this is the
     `focus` slot that note-context grew for exactly this. */
  useNoteScopeTarget({ kind: "visit", id: visit.id }, visit.label);

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
  /* WORTH KNOWING — the Summary's answer to "is there anything I need to
     know before I'm standing at the gate": how to get in (the agreement's
     access notes), what the site demands (inductions, PPE), and whatever
     the crew wrote on this visit. Absent when quiet — an empty warnings box
     is noise pretending to be diligence. The Notes tab stays the writing
     surface; this is the read. */
  const worthKnowing = useMemo(
    () => [...toLines(visit.accessNotes), ...toLines(siteRequirements), ...savedNotes],
    [visit.accessNotes, siteRequirements, savedNotes]
  );
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
  /* Newest first — a history reads backwards. Sorted here so the board can
     hand over its rows unordered. */
  const pastVisits = useMemo(
    () =>
      [...history].sort((a, b) =>
        (b.completedAt ?? b.dueDate).localeCompare(a.completedAt ?? a.dueDate)
      ),
    [history]
  );

  const toneChip = (() => {
    if (visit.status === "done") return <span className="wb2-chip ok">Completed</span>;
    if (visit.status === "skipped") return <span className="wb2-chip">Skipped</span>;
    if (isQuote) return <span className="wb2-chip">Quote</span>;
    if (tone === "over") return <span className="wb2-chip dan">{rel.t}</span>;
    if (tone === "go") return <span className="wb2-chip ok">Ready to run</span>;
    return <span className={"wb2-chip" + (tone === "flash" ? " dan" : tone === "soon" ? " warn" : "")}>{rel.t}</span>;
  })();

  /* The linked ServiceM8 job's chip is a DOOR when the mirror knows its
     uuid — the shape the job card's chips settled. The builder refuses a
     non-uuid, so a fixture's "j-1" quietly stays a plain chip. */
  const sm8Href = visit.remoteId ? sm8JobUrl(visit.remoteId) : null;

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

  /* THE TAB SET IS FIXED FROM FIRST PAINT — every face exists for every
     visit, so the thumb never jumps as reads land. No counts on the tabs
     (the job card's law); each face says its own counts inside. */
  const tabs: ViewTab[] = [
    /* "Summary", not "Visit" — the landing face is the card's overview, and
       the family lands on Summary everywhere (Isaac, on the harness: "theres
       no summary on maintenances card"). On a working card the overview and
       the work share the face; the label says what you LAND on. */
    { key: "visit", label: "Summary" },
    { key: "notes", label: "Notes" },
    { key: "history", label: "History" },
  ];

  const panel = (key: TabKey, body: React.ReactNode) => (
    <section
      className="wb2-jcface"
      id={`mvsec-${key}`}
      role="tabpanel"
      aria-labelledby={`mvtab-${key}`}
      hidden={tab !== key}
    >
      {body}
    </section>
  );

  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      {/* `closingout` recedes the body under the footer — Isaac asked for
          "a bit more separation between the close it out card and the
          remainder of the card". Closing out is a one-thing-at-a-time act;
          the band stays crisp so you can still see WHICH visit it is. */}
      <aside
        className={"wb2-sheet jc mv" + (closing ? " closingout" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={`${visit.clientName} — ${visit.label}`}
        style={catTintVars(visit.category?.accent)}
      >
        <div className="wb2-jcband">
          <div className="wb2-shtop">
            {/* OUR number first, then the name you gave the service — the two
                things you'd say on the phone (#258's law, kept through the
                move onto the band). The client and site ride underneath, the
                way the job card carries its address. */}
            <span className="wb2-shno">{visit.jobNo !== null ? `#${visit.jobNo}` : "—"}</span>
            <span className="wb2-jcid">
              <h2 className="wb2-shname">{visit.label}</h2>
              <p className="wb2-jcaddr">
                {visit.clientName}
                {visit.siteLabel ? ` · ${visit.siteLabel}` : ""}
              </p>
            </span>
            <span className="wb2-shchips">
              {toneChip}
              <span className="wb2-chip" title="How often this service comes round">
                {cadenceLabel(visit.intervalMonths)}
              </span>
              {visit.category && (
                <span className="wb2-chip">
                  <i className="wb2-catdot" style={{ background: visit.category.accent }} aria-hidden />
                  {visit.category.name}
                </span>
              )}
              {/* THE AGREEMENT IS A CHIP DOOR — the shape the job card's
                  tracked chip proved. This card never had a route to the
                  agreement standing behind it; now the standing service is
                  one click sideways. */}
              <button
                className="wb2-chip blue"
                onClick={() => onOpenAgreement(visit.agreementId)}
                title="Open the service agreement behind this visit"
              >
                Service agreement
                <i className="wb2-shcar" aria-hidden>
                  ›
                </i>
              </button>
              {visit.jobNumber ? (
                sm8Href ? (
                  <a
                    className="wb2-chip door"
                    href={sm8Href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="ServiceM8 raised this job — opens it over there"
                  >
                    {`SM8 #${visit.jobNumber}`}
                    <Icon name="arrowUR" size={12} />
                  </a>
                ) : (
                  <span className="wb2-chip" title="The job's number in ServiceM8">
                    SM8 #{visit.jobNumber}
                  </span>
                )
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
            {/* ON THE SHEET, because nothing outside its scrim can be clicked
                — the topbar's button is unreachable the moment this opens.
                Pinned beside the ✕ the way the job card pins its ⋯. */}
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

          <ViewTabs
            items={tabs}
            active={tab}
            onGo={(key) => setTab(key as TabKey)}
            ariaLabel="Visit card"
            idPrefix="mvtab"
            panelPrefix="mvsec"
          />
        </div>

        {/* OUTSIDE the body on purpose: closing out blurs the body, and a
            failed "Mark it complete" must not paint its one line of feedback
            at 42% opacity behind the very form the reader is looking at. */}
        {err && <p className="wb2-sherr">{err}</p>}

        <div className="wb2-jcbody">
          {panel(
            "visit",
            <>
              <div className="wb2-facts">
                <div>
                  <span className="wb2-sect">Due</span>
                  <b>{fmtAuWeekdayDayMonth(visit.dueDate)}</b>
                  {/* Urgency is for a visit still on the table. A completed
                      visit's "86 days over" is history shouted as an alarm —
                      the Closed out section says what actually happened. */}
                  {open && <em className={rel.tone === "dan" ? "dan" : undefined}>{rel.t}</em>}
                </div>
                {/* The one History fact the overview owes: when this service
                    last ran. The face itself keeps the rows. */}
                {lastDone && (
                  <div>
                    <span className="wb2-sect">Last done</span>
                    <b>{fmtAuWeekdayDayMonth(lastDone)}</b>
                    <em>ran {agoLabel(lastDone, today)}</em>
                  </div>
                )}
                {/* The two estimates live on the AGREEMENT — how long one
                    visit of this service takes and how many people it takes,
                    both answered when the agreement was written. Isaac,
                    2026-08-04: "estimated service time, and we'll also have
                    estimated crew size". Changing either one changes it where
                    it lives, for every visit. */}
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

              {worthKnowing.length > 0 && (
                <div className="wb2-jcsec">
                  <div className="wb2-jcdhead">
                    <b>Worth knowing</b>
                  </div>
                  <ul className="wb2-ul">
                    {worthKnowing.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}

              {open && !isQuote && (
                <div className="wb2-jcsec">
                  <div className="wb2-jcdhead">
                    <b>Ready to run</b>
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
                            The agreement estimates {crewLabel(visit.techsNeeded)}.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ONE section for when this job happens — the fact tile shape
                  with the picker underneath (Isaac, 2026-08-03: "surely we
                  can just have a scheduled section… and just incorporate it
                  all to one"). */}
              <div className="wb2-jcsec">
                <div className="wb2-jcdhead">
                  <b>Scheduled</b>
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
                  <div className="wb2-dayrow">
                    <DateField
                      className="wb2-fi"
                      aria-label={bookedDay ? "Move it to another day" : "Pick a day"}
                      today={today}
                      value={pendingDay || null}
                      onChange={(iso) => setPendingDay(iso ?? "")}
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
                )}
              </div>

              {equipment.length > 0 && (
                <div className="wb2-jcsec">
                  {/* WHAT THE VISIT IS THERE TO SERVICE — the agreement's
                      register, read-only here; the agreement sheet owns the
                      editing. One dress per unit line, both sheets. */}
                  <div className="wb2-jcdhead">
                    <b>Equipment on site</b>
                    <em>{equipment.length === 1 ? "One unit" : `${equipment.length} units`}</em>
                  </div>
                  {equipment.map((e) => (
                    <div className="wb2-mline" key={e.id}>
                      <b>{e.description}</b>
                      <em>{equipmentLine(e)}</em>
                      <span />
                    </div>
                  ))}
                </div>
              )}

              {visit.status === "done" && (
                <div className="wb2-jcsec">
                  <div className="wb2-jcdhead">
                    <b>Closed out</b>
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
                    <div className="wb2-noteact">
                      <button className="pbtn ghost" disabled={busy} onClick={() => run(() => setVisitStatus(visit.id, "upcoming"))}>
                        Reopen the visit
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {panel(
            "notes",
            <>
              <div className="wb2-jcsec">
                <div className="wb2-jcdhead">
                  <b>Notes for the visit</b>
                  {savedNotes.length > 0 && (
                    <em>{savedNotes.length === 1 ? "One note" : `${savedNotes.length} notes`}</em>
                  )}
                </div>
                {/* One note per line, because that's how they're actually said —
                    "gate code is 4821", "ask for Dave", "roof ladder won't
                    reach". Storage didn't change: a line IS a bullet, see
                    lib/workboard/note-lines. READING is the resting state;
                    editing is a mode you ask for. */}
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
                        {/* Nothing written yet? Then there's nothing to read and
                            the row you'd type into is the whole section. Once the
                            first note is down, adding another is a button away. */}
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

              <div className="wb2-jcsec">
                <div className="wb2-jcdhead">
                  <b>Tags</b>
                  {/* The scope warning matters MOST at zero tags — the first
                      one someone adds meaning "this visit only" lands on
                      every future visit of the service. Said always. */}
                  <em>On every visit of this agreement</em>
                </div>
                <TagStrip
                  tags={visit.tags}
                  pool={tagPool}
                  manage={manage}
                  busy={busy}
                  onAdd={addTag}
                  onPick={(tagId) => run(() => tagAgreement(visit.agreementId, tagId))}
                  onRemove={(tagId) => run(() => untagAgreement(visit.agreementId, tagId))}
                />
              </div>
            </>
          )}

          {panel(
            "history",
            <div className="wb2-jcsec">
              <div className="wb2-jcdhead">
                <b>Past visits</b>
                {lastDone && <em>Last done {fmtAuWeekdayDayMonth(lastDone)}</em>}
              </div>
              {pastVisits.length > 0 ? (
                pastVisits.map((v) => (
                  <button
                    key={v.id}
                    className="wb2-mline visit"
                    onClick={() => onOpenVisit(v.id)}
                    title="Open that visit"
                  >
                    <b>{fmtAuWeekdayDayMonth(v.completedAt ?? v.dueDate)}</b>
                    <em>
                      {v.completionNote ??
                        (v.completedSource === "servicem8" ? "Closed from ServiceM8" : "Closed manually")}
                    </em>
                    <span>{v.actualHours !== null ? hoursLabel(v.actualHours) : "—"}</span>
                  </button>
                ))
              ) : (
                <p className="wb2-hint">
                  {/* "OTHER", because the head's Last done may be THIS visit —
                      the one closed-out row an agreement has is the one this
                      card is standing on. The window is the board's own
                      constant, never a hand-typed "8". */}
                  {lastDone
                    ? `No other visits closed out in the last ${BOARD_DONE_DAYS / 7} weeks.`
                    : "This agreement hasn't been serviced yet."}
                </p>
              )}
            </div>
          )}
        </div>

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
                      <DateField
                        className="wb2-fi"
                        aria-label="Day it ran"
                        max={today}
                        today={today}
                        value={ranOn || null}
                        onChange={(iso) => setRanOn(iso ?? "")}
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
