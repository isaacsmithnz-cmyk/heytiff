"use client";

import { useContext, useEffect, useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button, IconButton } from "@/components/parts/button";
import { Field, TextArea } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { WindowsContext } from "@/components/records/records-context";
import { notePeople, sendNote, type NotePeople } from "@/app/actions/shared-notes";
import { JobField, type FormJob } from "./job-field";

/* NEW › NOTE (Isaac, 24 October 2026; the board
   https://claude.ai/artifact/NiPWtzHBwnetSyyiBag3Yp). Three things: what,
   the job it is about (filled in on a job's page, and clearable), and who it
   is to. With no job, To starts on The office, the workspace's owners and
   admins; name people and it goes to them. It lands in their Your feed with
   Reply and Done. With a job it is kept on the job's conversation too, and
   anyone named hears about it. A note is for note taking: work to do is a
   Task. Nothing goes to ServiceM8. */

const OFFICE = "office";

export function NoteForm({ job = null, onClose }: { job?: FormJob | null; onClose: () => void }) {
  const host = useContext(WindowsContext);
  const [words, setWords] = useState("");
  const [forJob, setForJob] = useState<FormJob | null>(job);
  /* who it is to: the office, people by id; the office until you choose */
  const [to, setTo] = useState<string[]>(job ? [] : [OFFICE]);
  const [people, setPeople] = useState<NotePeople | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    void notePeople().then((p) => live && setPeople(p));
    return () => {
      live = false;
    };
  }, []);

  const nameOf = (id: string) => (id === OFFICE ? "The office" : (people?.people.find((p) => p.id === id)?.name ?? "Someone"));
  const left = [
    ...(to.includes(OFFICE) ? [] : [{ value: OFFICE, label: "The office" }]),
    ...(people?.people ?? []).filter((p) => !to.includes(p.id)).map((p) => ({ value: p.id, label: p.name })),
  ];

  async function send() {
    if (!words.trim()) {
      setError("Write the note first.");
      return;
    }
    setSending(true);
    const r = await sendNote({
      text: words,
      jobUuid: forJob?.uuid ?? null,
      to: to.filter((id) => id !== OFFICE),
      toOffice: to.includes(OFFICE),
    }).catch(() => ({ ok: false as const, error: "That didn't send. Try again." }));
    setSending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onClose();
    const named = to.length ? to.map(nameOf).join(", ") : null;
    host?.toast(forJob ? (named ? `Kept on ${forJob.label} and sent to ${named}` : `Kept on ${forJob.label}`) : `Sent to ${named}`);
  }

  return (
    <Dialog
      heading="New note"
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" onClick={() => void send()} disabled={sending}>
            {sending ? "Sending" : "Send"}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Field label="What" error={error}>
          <TextArea
            value={words}
            rows={3}
            invalid={!!error}
            data-autofocus
            onKeyDown={(e) => {
              /* ⌘ or Ctrl with Enter sends; Enter is a new line */
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            onChange={(e) => {
              setWords(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        <JobField job={forJob} onChange={setForJob} placeholder="No job" />
        <Field label="To">
          <div className="mk-to">
            {to.length > 0 && (
              <ul className="mk-tolist">
                {to.map((id) => (
                  <li key={id} className="mk-torow">
                    <span>{nameOf(id)}</span>
                    <IconButton glyph="clear" size={32} label={`Take ${nameOf(id)} off`} onClick={() => setTo((t) => t.filter((x) => x !== id))} />
                  </li>
                ))}
              </ul>
            )}
            {left.length > 0 && (
              <Chooser
                aria-label="Add someone"
                placeholder="Add someone"
                options={left}
                value={null}
                onChange={(id) => setTo((t) => [...t, id])}
              />
            )}
          </div>
        </Field>
      </form>
    </Dialog>
  );
}
