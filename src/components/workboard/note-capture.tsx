"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { LevelBars, clockOf, useDictation } from "./dictation";
import { useNoteBrain } from "./note-brain-context";
import { SEVERITIES, type NoteProposal, type NoteStaff } from "@/lib/workboard/note-brain";
import {
  answerClarify,
  applyNote,
  dismissNote,
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
  tasks: { on: boolean; title: string; detail: string; assigneeId: string | null; dueDate: string; hint: string }[];
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
      dueDate: "",
      hint: t.assigneeHint,
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

export function NoteCapture({
  target,
  targetLabel,
  voiceEnabled,
}: {
  target: NoteTarget;
  /** What the ribbon says the note lands against — "Meridian Data · Server
      room CRACs" with a sheet open, absent = "General note". */
  targetLabel?: string;
  /** ELEVENLABS_API_KEY is set on this deployment. */
  voiceEnabled: boolean;
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

  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const reset = () => {
    setNote(null);
    setDraft(null);
    setAnswer("");
    setText("");
  };

  const read = useCallback(
    (source: "text" | "voice", transcript: string) => {
      setError(null);
      setDone(null);
      start(async () => {
        const res = await routeNote({ transcript, target, source });
        if (!res.ok) {
          setError(res.error);
          router.refresh(); // the note itself was still saved
          return;
        }
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

  const confirm = () => {
    if (!note || !draft) return;
    setError(null);
    start(async () => {
      const res = await applyNote(note.id, toConfirmed(draft));
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

  const keepAsNote = () => {
    if (!note) return;
    start(async () => {
      const res = await dismissNote(note.id);
      if (res.ok) setDone(res.summary);
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
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
                {/* the attachment, visible to the speaker (D15) */}
                <span className={"wb2-chip" + (targetLabel ? " blue" : "")}>
                  {targetLabel ? `Against: ${targetLabel}` : "General note"}
                </span>
                {recording && <span className="wb2-capclock">{clock}</span>}
                <button className="wb2-ico" onClick={close} title="Discard" aria-label="Discard">
                  <Icon name="x" size={14} />
                </button>
              </div>

              {error && <p className="wb2-sherr">{error}</p>}

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
                  <p className="wb2-hint">
                    If the bars don&apos;t move when you talk, nothing is being heard. Words are read
                    back when you stop.
                  </p>
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
                            aria-label={t.on ? "Skip this task" : "Include this task"}
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
                            value={t.dueDate}
                            onChange={(e) => patch((d) => ((d.tasks[i].dueDate = e.target.value), d))}
                          />
                        </div>
                      ))}
                      {draft.tasks.some((t) => t.on && !t.assigneeId) && (
                        <p className="int-hint">A task needs a person before it can be saved.</p>
                      )}
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
                            {s}
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

                  <div className="wb2-capact">
                    <button className="pbtn ghost" onClick={keepAsNote} disabled={busy}>
                      Just keep the note
                    </button>
                    <button className="pbtn" onClick={confirm} disabled={busy || nothingTicked(draft)}>
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
