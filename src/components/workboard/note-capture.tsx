"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { LevelBars, clockOf, useDictation } from "./dictation";
import { clearRun, markProposal } from "@/lib/voice/timing";
import { useNoteBrain } from "./note-brain-context";
import { SEVERITIES, type NoteProposal, type NoteStaff } from "@/lib/workboard/note-brain";
import { describeJob, matchJob, searchJobs, type JobCandidate } from "@/lib/workboard/note-match";
import {
  answerClarify,
  applyNote,
  dismissNote,
  keepNoteOnJob,
  routeNote,
  type ConfirmedNote,
  type NoteTarget,
} from "@/app/actions/workboard-notes";

/* Say it, then check it — now worn as the PILL (D15, decided 2026-08-01).

   The ENGINE is the shipped one and does not move: the server never applies
   what the model produced, it applies what came back from THIS card; every
   row is editable and droppable; typing is first-class and the mic is an
   enhancement — no microphone, no problem. What changed is the clothes:
   idle is a near-zero pill docked by the page header ("Add note" is the
   text half, never an icon alone), pressing it dims the board under an
   overlay ribbon that names its TARGET out loud ("Against: …" or "General
   note"), and the editable review renders inside that same overlay.

   Nothing from the prototype's wb-voice.js is ported — its word-by-word
   transcript was scripted demo code. This engine transcribes when you stop,
   and the overlay says exactly that. */

type Draft = {
  tasks: {
    on: boolean;
    title: string;
    detail: string;
    assigneeId: string | null;
    dueDate: string;
    hint: string;
    dueHint: string;
  }[];
  bringItems: { on: boolean; text: string }[];
  flags: { on: boolean; message: string; severity: string }[];
  progressBullets: { on: boolean; text: string }[];
  commissioningEntries: { on: boolean; text: string }[];
  issueEntries: { on: boolean; summary: string; equipmentRef: string }[];
};

function toDraft(p: NoteProposal): Draft {
  return {
    tasks: p.tasks.map((t) => ({
      on: true,
      title: t.title,
      detail: t.detail,
      assigneeId: t.assigneeId,
      /* Seeded from the model's resolved day. "Tomorrow" is a date, and
         making someone read the word and then type the date is asking them
         to do the easy half of the job the note already did. */
      dueDate: t.dueDate,
      hint: t.assigneeHint,
      /* What was actually SAID about when — "before Monday's visit (3
         August)". The date box starts empty because that phrase isn't a
         date, but throwing the words away meant the one bit of the note
         that gave a task its urgency never reached the person doing it. */
      dueHint: t.dueHint,
    })),
    bringItems: p.bringItems.map((text) => ({ on: true, text })),
    flags: p.flags.map((f) => ({ on: true, message: f.message, severity: f.severity })),
    progressBullets: p.progressBullets.map((text) => ({ on: true, text })),
    commissioningEntries: p.commissioningEntries.map((e) => ({ on: true, text: e.body })),
    issueEntries: p.issueEntries.map((e) => ({ on: true, summary: e.body, equipmentRef: e.equipmentHint })),
  };
}

function toConfirmed(d: Draft): ConfirmedNote {
  return {
    tasks: d.tasks.filter((t) => t.on && t.title.trim() && t.assigneeId).map((t) => ({
      title: t.title,
      detail: t.detail,
      assigneeId: t.assigneeId,
      dueDate: t.dueDate || null,
    })),
    bringItems: d.bringItems.filter((b) => b.on && b.text.trim()).map((b) => b.text),
    flags: d.flags.filter((f) => f.on && f.message.trim()).map((f) => ({ message: f.message, severity: f.severity })),
    progressBullets: d.progressBullets.filter((b) => b.on && b.text.trim()).map((b) => b.text),
    commissioningEntries: d.commissioningEntries.filter((e) => e.on && e.text.trim()).map((e) => e.text),
    issueEntries: d.issueEntries.filter((e) => e.on && e.summary.trim()).map((e) => ({
      summary: e.summary,
      equipmentRef: e.equipmentRef,
    })),
  };
}

/* Every bucket of a ConfirmedNote is an array, so "nothing is ticked" is just
   "they are all empty". */
const nothingTicked = (d: Draft): boolean =>
  Object.values(toConfirmed(d)).every((bucket) => bucket.length === 0);

/* WHAT WOULD BE THROWN AWAY IF YOU PRESSED SAVE RIGHT NOW.

   This card used to let you press Save with rows on it that could never be
   saved, and then say "Saved as a note." Isaac dictated two tasks and two
   bring-items, pressed Save, and the database recorded `applied: {}` — the
   tasks had no person on them and a general note has no job to hang a
   bring-list off, so all four were dropped without a word.

   `toConfirmed` filtered them out; the button only asked whether ANYTHING was
   ticked, and two doomed bring-items were enough to make it look fine. So the
   question the button asks is now the right one: is there anything ticked
   here that CANNOT be done? */
function blockers(d: Draft, hasTarget: boolean): string[] {
  const out: string[] = [];
  /* A NOTE MUST NAME A JOB (Isaac, 2026-08-02, choosing between four ways to
     give loose notes a home). It used to offer "keep the words only", which
     kept them in a table nothing reads — and no rewording of that button
     makes a drawer nobody opens into a destination. So the card asks for the
     job instead. Discard is still there for words you don't want. */
  if (!hasTarget) {
    out.push("Every note goes on a job — say which one, or discard it.");
  }
  const unassigned = d.tasks.filter((t) => t.on && t.title.trim() && !t.assigneeId).length;
  if (unassigned) {
    out.push(
      unassigned === 1
        ? "One task still needs a person on it — assign it, or untick it."
        : `${unassigned} tasks still need a person on them — assign them, or untick them.`
    );
  }
  return out;
}

/* The stored severities are lowercase keys — `info`, `warn`, `urgent` — and
   showing the key is showing the database to the user. These are what a
   person picks between. */
const SEVERITY_LABEL: Record<(typeof SEVERITIES)[number], string> = {
  info: "Worth seeing",
  warn: "Needs attention",
  urgent: "Urgent — someone is blocked",
};

/** A job card a general note can be pinned to on review. */
export type NoteAttachOption = JobCandidate;

export function NoteCapture({
  target,
  targetLabel,
  voiceEnabled,
  attachOptions = [],
}: {
  target: NoteTarget;
  /** What the ribbon says the note lands against — "Meridian Data · Server
      room CRACs" with a sheet open, absent = "General note". */
  targetLabel?: string;
  /** ELEVENLABS_API_KEY is set on this deployment. */
  voiceEnabled: boolean;
  /** The board's own job cards, offered when a note was dictated against
      nothing. Speaking a client's name from the board header is the normal
      case, and the note had no way to say who it meant. */
  attachOptions?: NoteAttachOption[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; proposal: NoteProposal; staff: NoteStaff[] } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [answer, setAnswer] = useState("");
  const [done, setDone] = useState<string | null>(null);
  /** Chosen on the review card when the note itself is general. */
  const [attachTo, setAttachTo] = useState<string>("");
  const [picking, setPicking] = useState(false);

  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const reset = () => {
    setNote(null);
    setDraft(null);
    setAnswer("");
    setText("");
    setAttachTo("");
    setTouched(false);
    setPicking(false);
  };

  const read = useCallback(
    (source: "text" | "voice", transcript: string) => {
      setError(null);
      setDone(null);
      start(async () => {
        const res = await routeNote({ transcript, target, source });
        if (!res.ok) {
          setError(res.error);
          clearRun();
          router.refresh(); // the note itself was still saved
          return;
        }
        /* The end of the wait — the card now has something to check. The
           transport only owns the first half of this number. */
        markProposal();
        setNote({ id: res.noteId, proposal: res.proposal, staff: res.staff });
        setDraft(toDraft(res.proposal));
      });
    },
    [target, router, start]
  );

  /* The engine now lives in ./dictation, because it was never specific to
     this component — every box you'd type a paragraph into wants it. */
  const dict = useDictation({
    onTranscript: (transcript) => {
      setText(transcript);
      read("voice", transcript);
    },
    onError: setError,
  });
  const { recording, transcribing: listening } = dict;

  const close = () => {
    dict.cancel();
    /* Walking away from a parsed note means the same thing "Keep as note"
       means: keep the words, apply none of it. Without this the row sits at
       status "pending" forever — nothing in the app reads pending notes, so
       it is a proposal waiting on a review that can never happen. Fire and
       forget: the overlay closes now, the status catches up. */
    if (note) void dismissNote(note.id);
    reset();
    setError(null);
    setOpen(false);
  };

  // the pill's little "saved" confirmation fades on its own
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 4000);
    return () => clearTimeout(t);
  }, [done]);

  /* Any field on the board can hand its text to the brain — the pill is just
     the one that also OWNS it. Registered here so a "Notes for the visit" box
     doesn't need its own copy of the engine or its own review card. */
  const { register } = useNoteBrain();
  const handOff = useCallback(
    (incoming: string) => {
      setOpen(true);
      setText(incoming);
      read("text", incoming);
    },
    [read]
  );
  useEffect(() => {
    register(handOff);
    return () => register(null);
  }, [register, handOff]);

  /* ── the review (the engine's contract, unchanged) ── */

  /* WHICH JOB DID THE NOTE MEAN? The words name a client out loud, so the
     card comes back with the job card it thinks that is — number and all —
     for a person to confirm, rather than making them hunt a dropdown. The
     matching is plain code (lib/workboard/note-match), never the model:
     understanding is probabilistic, effect is deterministic, and nothing here
     happens until Save. */
  const guess = useMemo(
    () => matchJob(text || note?.proposal.plainNote || "", attachOptions),
    [text, note, attachOptions]
  );
  /* The guess is a SUGGESTION, so it seeds the picker and stays overridable —
     `attachTo` wins the moment it's touched, including when it's set back to
     "General note". */
  const [touched, setTouched] = useState(false);
  const picked = touched
    ? attachTo
    : guess.bestId
      ? `${attachOptions.find((o) => o.id === guess.bestId)?.kind}:${guess.bestId}`
      : "";

  const chosen: NoteTarget | null = (() => {
    if (!picked) return null;
    const [kind, id] = picked.split(":");
    return kind === "agreement" || kind === "project" || kind === "visit"
      ? { kind: kind as NoteTarget["kind"], id }
      : null;
  })();
  const chosenOption = chosen ? attachOptions.find((o) => o.id === chosen.id) ?? null : null;
  const hasTarget = (target.kind !== "none" && !!target.id) || !!chosen;
  const stops = draft ? blockers(draft, hasTarget) : [];

  const confirm = () => {
    if (!note || !draft) return;
    setError(null);
    start(async () => {
      const res = await applyNote(note.id, toConfirmed(draft), chosen ?? undefined);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.summary);
      reset();
      setOpen(false);
      router.refresh();
    });
  };

  /* "Just keep the note" now KEEPS IT SOMEWHERE YOU'D FIND IT — on the job's
     own notes, which the sheet shows. Filing it at status `dismissed` put the
     words in a drawer nobody opens (nothing reads workboard_notes), which is
     what made Isaac ask where the note was even going. With no job named
     there's nowhere to put it, so the button says that instead of offering. */
  const keepAsNote = () => {
    if (!note || !hasTarget) return;
    setError(null);
    start(async () => {
      const res = await keepNoteOnJob(note.id, chosen ?? undefined);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.summary);
      reset();
      setOpen(false);
      router.refresh();
    });
  };

  const sendAnswer = (reply: string = answer) => {
    if (!note) return;
    setError(null);
    start(async () => {
      const res = await answerClarify(note.id, reply);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNote({ id: res.noteId, proposal: res.proposal, staff: res.staff });
      setDraft(toDraft(res.proposal));
      setAnswer("");
    });
  };

  const patch = (fn: (d: Draft) => Draft) => setDraft((d) => (d ? fn({ ...d }) : d));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      /* The picker gets the Escape first. Discarding a whole reviewed note
         because you meant to shut a dropdown would be its own bug. */
      if (picking) {
        setPicking(false);
        return;
      }
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, picking]);

  useEffect(() => {
    if (open && !recording && !note) textRef.current?.focus();
  }, [open, recording, note]);

  const clock = clockOf(dict.seconds);

  return (
    <>
      {/* the pill — near-zero idle footprint, typing always first-class */}
      <div className="wb2-pill">
        <button
          type="button"
          className="wb2-pillbtn"
          onClick={() => {
            setOpen(true);
          }}
        >
          <Icon name="keyboard" size={15} />
          Add note
        </button>
        {voiceEnabled && (
          <button
            type="button"
            className="wb2-pillmic"
            title="Push to talk"
            aria-label="Record a note"
            onClick={() => {
              setOpen(true);
              dict.start();
            }}
          >
            <Icon name="mic" size={18} />
          </button>
        )}
        {done && <span className="wb2-chip ok">{done}</span>}
      </div>

      {open &&
        createPortal(
          <>
            <div className="wb2-capdim" onClick={close} />
            <div className="wb2-capcard" role="dialog" aria-modal="true" aria-label="Add a note">
              <div className="wb2-capribbon">
                {recording ? (
                  <span className="wb2-recdot" aria-hidden="true" />
                ) : (
                  <Icon name="note" size={16} />
                )}
                <b>
                  {recording
                    ? "Recording"
                    : listening
                      ? "Reading it back"
                      : note
                        ? "Check it before it saves"
                        : "Add a note"}
                </b>
                {/* The attachment, visible to the speaker (D15) — and, once
                    there's something to save and nothing to save it against,
                    CHANGEABLE. A note dictated from the board header names a
                    client out loud and had no way to point at them. */}
                {targetLabel ? (
                  <span className="wb2-chip blue">Against: {targetLabel}</span>
                ) : (
                  <span className="wb2-chip">
                    {chosenOption ? chosenOption.clientName : "General note"}
                  </span>
                )}
                {recording && <span className="wb2-capclock">{clock}</span>}
                <button className="wb2-ico" onClick={close} title="Discard" aria-label="Discard">
                  <Icon name="x" size={14} />
                </button>
              </div>

              {error && <p className="wb2-sherr">{error}</p>}

              {/* CONFIRM THE JOB, don't just offer a list. The note said a
                  client's name; this says which job card that is and what its
                  job number is, so agreeing is a glance rather than a search. */}
              {note && !targetLabel && attachOptions.length > 0 && (
                <div className={"wb2-capjob" + (chosenOption ? " on" : "")}>
                  <Icon name={chosenOption ? "check" : "alert"} size={14} />
                  <span>
                    {chosenOption ? (
                      <>
                        {touched ? "Going on " : "Sounds like "}
                        <b>{describeJob(chosenOption)}</b>
                      </>
                    ) : guess.ambiguous ? (
                      "More than one job matches what you said."
                    ) : (
                      "Every note goes on a job — say which one."
                    )}
                  </span>
                  {/* The picker lives HERE, on the thing it changes. A select
                      you have to scroll past the right answer in is a way to
                      hit the wrong one (Isaac, 2026-08-02). */}
                  <button
                    type="button"
                    className="wb2-capchange"
                    onClick={() => setPicking((p) => !p)}
                    aria-expanded={picking}
                  >
                    {chosenOption ? "Change" : "Pick a job"}
                  </button>
                </div>
              )}

              {picking && (
                <JobPicker
                  options={guess.ranked}
                  chosenId={chosen?.id ?? null}
                  onPick={(value) => {
                    setTouched(true);
                    setAttachTo(value);
                    setPicking(false);
                  }}
                  onClose={() => setPicking(false)}
                />
              )}

              {!note && !recording && !listening && (
                <>
                  <textarea
                    ref={textRef}
                    className="wb2-notes"
                    rows={3}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Tell Luke he needs to order the grilles, and the middle rooftop unit tripped again…"
                    disabled={busy}
                  />
                  <div className="wb2-capact">
                    <button className="pbtn ghost" onClick={close} disabled={busy}>
                      Discard
                    </button>
                    {voiceEnabled && (
                      <button className="pbtn ghost" onClick={dict.start} disabled={busy}>
                        <Icon name="volume" size={15} />
                        Dictate
                      </button>
                    )}
                    <button
                      className="pbtn"
                      onClick={() => read("text", text)}
                      disabled={busy || !text.trim()}
                    >
                      {busy ? "Reading…" : "Sort this out"}
                    </button>
                  </div>
                </>
              )}

              {recording && (
                <div className="wb2-caprec">
                  <LevelBars innerRef={dict.barsRef} />
                  {/* The card must never claim to be hearing you when it
                      isn't. On the batch transport there is nothing to show
                      until you stop, and the hint says exactly that — the
                      prototype's fake word-by-word transcript is still not
                      coming back. The live transport earns the other line by
                      actually having words. */}
                  {dict.interim ? (
                    <p className="wb2-livetext" aria-live="polite">
                      {dict.interim}
                    </p>
                  ) : (
                    <p className="wb2-hint">
                      If the bars don&apos;t move when you talk, nothing is being heard. Words are
                      read back when you stop.
                    </p>
                  )}
                  <div className="wb2-capact">
                    <button className="pbtn ghost" onClick={close}>
                      Discard
                    </button>
                    <button className="pbtn" onClick={dict.stop}>
                      <Icon name="square" size={15} />
                      Stop &amp; read
                    </button>
                  </div>
                </div>
              )}

              {listening && <p className="wb2-hint">Reading it back…</p>}

              {note && draft && (
                <div className="wb-review" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
                  <p className="wb-notetext">{note.proposal.plainNote || text}</p>

                  {note.proposal.clarify && (
                    <div className="wb-ask">
                      <b>{note.proposal.clarify.question}</b>
                      <div className="int-act">
                        {note.proposal.clarify.options.map((o) => (
                          <button key={o} className="wb-chip" disabled={busy} onClick={() => sendAnswer(o)}>
                            {o}
                          </button>
                        ))}
                      </div>
                      <div className="wb-row">
                        <input
                          className="wb-inline"
                          value={answer}
                          onChange={(e) => setAnswer(e.target.value)}
                          placeholder="…or answer in your own words"
                        />
                        <button
                          className="pbtn ghost"
                          onClick={() => sendAnswer()}
                          disabled={busy || !answer.trim()}
                        >
                          Answer
                        </button>
                      </div>
                    </div>
                  )}

                  {draft.tasks.length > 0 && (
                    <div className="wb-day">
                      <div className="wb-dayhead">Tasks</div>
                      {draft.tasks.map((t, i) => (
                        <div className="wb-row" key={i}>
                          <button
                            className={"wb-tick" + (t.on ? " done" : "")}
                            onClick={() => patch((d) => ((d.tasks[i].on = !d.tasks[i].on), d))}
                            /* Named, not "this task" — three rows all
                               labelled "Skip this task" is three identical
                               buttons to anyone not looking at the screen. */
                            aria-label={(t.on ? "Skip " : "Include ") + t.title}
                          >
                            <Icon name="check" size={13} />
                          </button>
                          <input
                            className="wb-inline"
                            value={t.title}
                            onChange={(e) => patch((d) => ((d.tasks[i].title = e.target.value), d))}
                          />
                          <select
                            className="wb-select"
                            value={t.assigneeId ?? ""}
                            onChange={(e) =>
                              patch((d) => ((d.tasks[i].assigneeId = e.target.value || null), d))
                            }
                          >
                            <option value="">{t.hint ? `${t.hint} — who?` : "Assign to…"}</option>
                            {note.staff.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.fullName}
                              </option>
                            ))}
                          </select>
                          <input
                            className="wb-select"
                            type="date"
                            aria-label={`Due date — ${t.title}`}
                            title={t.dueHint ? `Said: ${t.dueHint}` : undefined}
                            value={t.dueDate}
                            onChange={(e) => patch((d) => ((d.tasks[i].dueDate = e.target.value), d))}
                          />
                          {t.dueHint && !t.dueDate && (
                            <em className="wb2-capsaid">said: {t.dueHint}</em>
                          )}
                        </div>
                      ))}

                    </div>
                  )}

                  <SimpleRows
                    title="Flags for the board"
                    rows={draft.flags.map((f) => ({ on: f.on, text: f.message }))}
                    onToggle={(i) => patch((d) => ((d.flags[i].on = !d.flags[i].on), d))}
                    onEdit={(i, v) => patch((d) => ((d.flags[i].message = v), d))}
                    trailing={(i) => (
                      <select
                        className="wb-select"
                        value={draft.flags[i].severity}
                        onChange={(e) => patch((d) => ((d.flags[i].severity = e.target.value), d))}
                      >
                        {SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {SEVERITY_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    )}
                  />

                  <SimpleRows
                    title="Bring next visit"
                    rows={draft.bringItems.map((b) => ({ on: b.on, text: b.text }))}
                    onToggle={(i) => patch((d) => ((d.bringItems[i].on = !d.bringItems[i].on), d))}
                    onEdit={(i, v) => patch((d) => ((d.bringItems[i].text = v), d))}
                  />

                  <SimpleRows
                    title="Progress"
                    rows={draft.progressBullets.map((b) => ({ on: b.on, text: b.text }))}
                    onToggle={(i) => patch((d) => ((d.progressBullets[i].on = !d.progressBullets[i].on), d))}
                    onEdit={(i, v) => patch((d) => ((d.progressBullets[i].text = v), d))}
                  />

                  <SimpleRows
                    title="Commissioning"
                    rows={draft.commissioningEntries.map((e) => ({ on: e.on, text: e.text }))}
                    onToggle={(i) =>
                      patch((d) => ((d.commissioningEntries[i].on = !d.commissioningEntries[i].on), d))
                    }
                    onEdit={(i, v) => patch((d) => ((d.commissioningEntries[i].text = v), d))}
                  />

                  <SimpleRows
                    title="Issues"
                    rows={draft.issueEntries.map((e) => ({ on: e.on, text: e.summary }))}
                    onToggle={(i) => patch((d) => ((d.issueEntries[i].on = !d.issueEntries[i].on), d))}
                    onEdit={(i, v) => patch((d) => ((d.issueEntries[i].summary = v), d))}
                  />

                  {/* Nothing on this card is thrown away quietly. If a ticked
                      row can't be saved, Save says so and stays off until you
                      either fix it or untick it. */}
                  {stops.map((s) => (
                    <p className="wb2-capstop" key={s}>
                      {s}
                    </p>
                  ))}

                  <div className="wb2-capact">
                    <button
                      className="pbtn ghost"
                      onClick={keepAsNote}
                      disabled={busy || !hasTarget}
                      title="Put the words on the job's notes and apply none of this"
                    >
                      Put it on the job&apos;s notes
                    </button>
                    <button
                      className="pbtn"
                      onClick={confirm}
                      disabled={busy || nothingTicked(draft) || stops.length > 0}
                    >
                      {busy ? "Saving…" : "Save these"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>,
          document.body
        )}
    </>
  );
}

function SimpleRows({
  title,
  rows,
  onToggle,
  onEdit,
  trailing,
}: {
  title: string;
  rows: { on: boolean; text: string }[];
  onToggle: (i: number) => void;
  onEdit: (i: number, value: string) => void;
  trailing?: (i: number) => React.ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="wb-day">
      <div className="wb-dayhead">{title}</div>
      {rows.map((r, i) => (
        <div className="wb-row" key={i}>
          <button
            className={"wb-tick" + (r.on ? " done" : "")}
            onClick={() => onToggle(i)}
            aria-label={r.on ? `Skip ${r.text}` : `Include ${r.text}`}
          >
            <Icon name="check" size={13} />
          </button>
          <input className="wb-inline" value={r.text} onChange={(e) => onEdit(i, e.target.value)} />
          {trailing?.(i)}
        </div>
      ))}
    </div>
  );
}

/* Search the board's jobs, rather than scroll past them.

   Isaac's objection to the dropdown was exact: "instead of saying change it
   above, I'll hit the wrong one." A select is a list you navigate; this is a
   list you narrow. It opens on the matched order (best guess first), takes
   any word off the card — client, service, site or job number — and every
   row says its number so picking is a read, not a gamble. */
function JobPicker({
  options,
  chosenId,
  onPick,
  onClose,
}: {
  options: JobCandidate[];
  chosenId: string | null;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const found = searchJobs(q, options);

  return (
    <div className="wb2-jobpick">
      <div className="wb2-jobsearch">
        <Icon name="search" size={14} />
        <input
          autoFocus
          className="wb2-jobq"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search jobs — client, service, site or job number"
          aria-label="Search jobs"
        />
        <button className="wb2-ico" onClick={onClose} title="Close" aria-label="Close the job search">
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="wb2-joblist" role="listbox" aria-label="Jobs">
        {/* Always reachable: a note that turns out to belong to nothing in
            particular is a real answer, not a dead end. */}
        <button
          type="button"
          role="option"
          aria-selected={!chosenId}
          className={"wb2-jobopt" + (!chosenId ? " on" : "")}
          onClick={() => onPick("")}
        >
          General note — nothing in particular
        </button>
        {found.map((o) => (
          <button
            type="button"
            role="option"
            key={`${o.kind}:${o.id}`}
            aria-selected={o.id === chosenId}
            className={"wb2-jobopt" + (o.id === chosenId ? " on" : "")}
            onClick={() => onPick(`${o.kind}:${o.id}`)}
          >
            {describeJob(o)}
          </button>
        ))}
        {found.length === 0 && (
          <p className="wb2-hint">Nothing on the board matches &ldquo;{q.trim()}&rdquo;.</p>
        )}
      </div>
    </div>
  );
}
