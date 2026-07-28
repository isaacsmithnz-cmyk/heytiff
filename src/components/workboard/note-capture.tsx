"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { SEVERITIES, type NoteProposal, type NoteStaff } from "@/lib/workboard/note-brain";
import {
  answerClarify,
  applyNote,
  dismissNote,
  routeNote,
  type ConfirmedNote,
  type NoteTarget,
} from "@/app/actions/workboard-notes";

/* Say it, then check it.

   The whole safety model of Smart Notes lives in this component: the server
   never applies what the model produced, it applies what came back from
   THIS card. Every row is editable and every row can be dropped, so a
   misheard word costs a tick rather than a task assigned to the wrong
   person. Nothing is written until "Save these".

   Voice is an enhancement on typing, not a replacement: the textarea is
   always there, and the mic simply fills it in. If transcription is off, or
   the browser won't give us a microphone, the feature still works. */

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

const nothingTicked = (d: Draft): boolean =>
  toConfirmed(d).tasks.length === 0 &&
  toConfirmed(d).bringItems.length === 0 &&
  toConfirmed(d).flags.length === 0 &&
  toConfirmed(d).progressBullets.length === 0 &&
  toConfirmed(d).commissioningEntries.length === 0 &&
  toConfirmed(d).issueEntries.length === 0;

export function NoteCapture({
  target,
  voiceEnabled,
}: {
  target: NoteTarget;
  /** ELEVENLABS_API_KEY is set on this deployment. */
  voiceEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; proposal: NoteProposal; staff: NoteStaff[] } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [answer, setAnswer] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);

  const reset = () => {
    setNote(null);
    setDraft(null);
    setAnswer("");
    setText("");
  };

  const read = (source: "text" | "voice", transcript: string) => {
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
  };

  /* ── voice ── */

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size === 0) return;

        setListening(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "note.webm");
          const res = await fetch("/api/workboard/transcribe", { method: "POST", body: form });
          const body = (await res.json()) as { text?: string; error?: string };
          if (!res.ok || !body.text) {
            setError(body.error ?? "That recording couldn't be read. Type it instead.");
            return;
          }
          setText(body.text);
          read("voice", body.text);
        } catch {
          setError("That recording couldn't be sent. Type it instead.");
        } finally {
          setListening(false);
        }
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError("No microphone available — type the note instead.");
    }
  };

  const stopRecording = () => recorder.current?.stop();

  /* ── the review card ── */

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
      router.refresh();
    });
  };

  const keepAsNote = () => {
    if (!note) return;
    start(async () => {
      const res = await dismissNote(note.id);
      if (res.ok) setDone(res.summary);
      reset();
      router.refresh();
    });
  };

  const sendAnswer = () => {
    if (!note) return;
    setError(null);
    start(async () => {
      const res = await answerClarify(note.id, answer);
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

  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="note" size={19} />
        </span>
        <div>
          <b>Add a note</b>
          <em>
            {voiceEnabled
              ? "Say it or type it — it gets sorted into tasks, notes and flags before anything is saved."
              : "Type it — it gets sorted into tasks, notes and flags before anything is saved."}
          </em>
        </div>
      </div>

      {error && <div className="int-note bad">{error}</div>}
      {done && <div className="int-note ok">{done}</div>}

      {!note && (
        <>
          <textarea
            className="wb-notes"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Tell Luke he needs to order the grilles, and the middle rooftop unit tripped again…"
            disabled={busy || recording || listening}
          />
          <div className="int-act">
            {voiceEnabled &&
              (recording ? (
                <button className="pbtn danger wb-pulse" onClick={stopRecording}>
                  <Icon name="square" size={15} />
                  Stop &amp; read
                </button>
              ) : (
                <button className="pbtn ghost" onClick={startRecording} disabled={busy || listening}>
                  <Icon name="volume" size={15} />
                  {listening ? "Reading…" : "Dictate"}
                </button>
              ))}
            <button
              className="pbtn primary"
              onClick={() => read("text", text)}
              disabled={busy || recording || listening || !text.trim()}
            >
              {busy ? "Reading…" : "Sort this out"}
            </button>
          </div>
        </>
      )}

      {note && draft && (
        <div className="wb-review">
          <p className="wb-notetext">{note.proposal.plainNote || text}</p>

          {note.proposal.clarify && (
            <div className="wb-ask">
              <b>{note.proposal.clarify.question}</b>
              <div className="int-act">
                {note.proposal.clarify.options.map((o) => (
                  <button
                    key={o}
                    className="wb-chip"
                    disabled={busy}
                    onClick={() => {
                      setAnswer(o);
                      start(async () => {
                        const res = await answerClarify(note.id, o);
                        if (!res.ok) return setError(res.error);
                        setNote({ id: res.noteId, proposal: res.proposal, staff: res.staff });
                        setDraft(toDraft(res.proposal));
                      });
                    }}
                  >
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
                <button className="pbtn ghost" onClick={sendAnswer} disabled={busy || !answer.trim()}>
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
                    <option value="">
                      {t.hint ? `${t.hint} — who?` : "Assign to…"}
                    </option>
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

          <div className="fl-foot">
            <button className="pbtn ghost" onClick={keepAsNote} disabled={busy}>
              Just keep the note
            </button>
            <button className="pbtn primary" onClick={confirm} disabled={busy || nothingTicked(draft)}>
              {busy ? "Saving…" : "Save these"}
            </button>
          </div>
        </div>
      )}
    </div>
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
