"use client";

import { useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/parts/button";
import { ConfirmDialog } from "@/components/parts/dialog";
import { TextArea } from "@/components/parts/field";
import { Initials } from "@/components/parts/initials";
import { Empty, Wrong } from "@/components/parts/states";
import { useToast } from "@/components/parts/toast";
import { appendSpoken, useDictation } from "@/components/notes/dictation";
import { addMyNote, archiveMyNote, deleteMyNote, editMyNote, type NoteResult } from "@/app/actions/my-notes";
import type { MyNote } from "@/lib/notes/my-notes-query";
import { clockOf, dayLabel, noteTitle, threadWhen } from "@/lib/tiff/conversations";
import { CvBox } from "./box";
import { CvList } from "./list";

/* ONLY ME: your private notes (6-revisions.md, decision 18: "private notes
   live in Conversations › Only me"; the feature checklist's F-176). The same
   `staff_notes` rows and the same server actions as Me › Notes
   (app/actions/my-notes.ts), which scope every read and write to your own
   staff id, so nobody else ever sees one.

   Shown the way a conversation is: the list on the left, each note a title
   (its first line) over when you wrote it, and the open note on the right,
   with the box at the foot to write the next one and Save (F-017's "its
   own box and Save"). Edit and Archive are on the open note (the review's
   correction); an archived note comes back with Put back, and goes for
   good only from the archive, after asking. Archive says so in a toast with
   Undo (rules 37 and 51). */

export function NotesList({
  notes,
  archived,
  openId,
  onOpen,
  now,
}: {
  notes: MyNote[];
  archived: MyNote[];
  openId: string | null;
  onOpen: (id: string) => void;
  /** Null until the page is in the browser: the server's clock is not the reader's. */
  now: number | null;
}) {
  const rows = (list: MyNote[]) =>
    list.map((n) => ({ id: n.id, title: noteTitle(n.body), when: now === null ? "" : threadWhen(Date.parse(n.createdAt), now) }));
  /* nothing yet: the pane says so, beside the box that fills it (rule 40) */
  if (notes.length === 0 && archived.length === 0) return null;
  return (
    <>
      {notes.length > 0 && <CvList label="Your notes" rows={rows(notes)} openId={openId} onOpen={onOpen} />}
      {archived.length > 0 && (
        <div className="cv-group">
          <h2 className="cv-group-label">Archived</h2>
          <CvList label="Archived notes" rows={rows(archived)} openId={openId} onOpen={onOpen} />
        </div>
      )}
    </>
  );
}

export function NotePane({
  notes,
  archived,
  openId,
  onOpen,
  draft,
  setDraft,
  you,
  voiceEnabled,
  now,
}: {
  notes: MyNote[];
  archived: MyNote[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  /** The words in the box, kept by the page so a view switch doesn't lose them. */
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  you: string;
  voiceEnabled: boolean;
  now: number | null;
}) {
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirming, setConfirming] = useState<MyNote | null>(null);
  /** Some of the words in the box were said, not typed: the note is kept as dictated. */
  const [spoken, setSpoken] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const [ranOut, setRanOut] = useState(false);
  const dict = useDictation({
    onTranscript: (said, { capped }) => {
      setVoiceErr(null);
      setRanOut(capped);
      setSpoken(true);
      setDraft((prev) => appendSpoken(prev, said));
    },
    onError: setVoiceErr,
  });

  const live = notes.find((n) => n.id === openId) ?? null;
  const put = archived.find((n) => n.id === openId) ?? null;
  const note = live ?? put;

  const run = (fn: () => Promise<NoteResult>, after?: (res: NoteResult) => void, failed?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        failed?.();
        return;
      }
      after?.(res);
    });

  const save = () => {
    const body = draft.trim();
    if (!body) return;
    const source = spoken ? "voice" : "text";
    setDraft("");
    setSpoken(false);
    run(
      () => addMyNote({ body, source }),
      (res) => {
        if (res.ok && res.id) onOpen(res.id);
      },
      () => setDraft(body),
    );
  };

  const saveEdit = () => {
    if (!editing || !editing.text.trim()) return;
    const { id, text } = editing;
    setEditing(null);
    run(() => editMyNote(id, text));
  };

  const archive = (n: MyNote) =>
    run(
      () => archiveMyNote(n.id),
      () => toast({ text: "Note archived", undo: () => run(() => archiveMyNote(n.id, false)) }),
    );

  const created = note ? Date.parse(note.createdAt) : 0;
  const how = note?.source === "voice" ? "Dictated" : note?.source === "routed" ? "Came off a note you sorted" : null;

  return (
    <section className="cv-pane" aria-label={note ? noteTitle(note.body) : "New note"}>
      <div className="cv-pane-head">
        {live && !editing && (
          <>
            <Button kind="second" size={32} icon="edit" disabled={busy} onClick={() => setEditing({ id: live.id, text: live.body })}>
              Edit
            </Button>
            <Button kind="second" size={32} disabled={busy} onClick={() => archive(live)}>
              Archive
            </Button>
          </>
        )}
        {put && (
          <>
            <Button kind="second" size={32} icon="rotate" disabled={busy} onClick={() => run(() => archiveMyNote(put.id, false))}>
              Put back
            </Button>
            <Button kind="delete" size={32} disabled={busy} onClick={() => setConfirming(put)}>
              Delete for good
            </Button>
          </>
        )}
        {note && (
          <Button kind="second" size={32} icon="plus" onClick={() => onOpen(null)}>
            New note
          </Button>
        )}
      </div>
      <div className="cv-scroll">
        {error && (
          <div className="cv-fail">
            <Wrong word="Not saved" means={error} />
          </div>
        )}
        {note ? (
          <div className="cv-msgs">
            <div className="cv-day">
              <span>{now === null ? "" : dayLabel(created, now)}</span>
            </div>
            <article className="cv-msg">
              <span className="cv-avatar">
                <Initials name={you} size={32} beside />
              </span>
              <div className="cv-body">
                <p className="cv-meta">
                  <b>{you}</b>
                  <span>{now === null ? "" : clockOf(created)}</span>
                </p>
                {editing && editing.id === note.id ? (
                  <form
                    className="cv-edit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveEdit();
                    }}
                  >
                    <TextArea
                      rows={4}
                      aria-label="Edit the note"
                      value={editing.text}
                      autoFocus
                      onChange={(e) => setEditing({ id: editing.id, text: e.target.value })}
                    />
                    <span className="cv-edit-acts">
                      <Button kind="second" size={32} onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button kind="main" size={32} type="submit" disabled={busy || !editing.text.trim()}>
                        Save changes
                      </Button>
                    </span>
                  </form>
                ) : (
                  <div className="cv-text cv-text--mine">
                    <p>{note.body}</p>
                  </div>
                )}
                {(how || put) && (
                  <p className="cv-source">
                    <span>{[how, put ? "Archived" : null].filter(Boolean).join(". ")}</span>
                  </p>
                )}
              </div>
            </article>
          </div>
        ) : notes.length === 0 && archived.length === 0 ? (
          <div className="cv-start">
            <Empty what="No notes yet" line="Write one in the box below. Only you can see your notes." action={null} />
          </div>
        ) : null}
      </div>
      <CvBox
        value={draft}
        onChange={setDraft}
        onSubmit={save}
        label="Write a note for yourself"
        placeholder="Write a note for yourself"
        sendWord="Save"
        sendLabel="Save the note"
        waiting={busy}
        dict={voiceEnabled ? dict : null}
        voiceError={voiceErr}
        ranOut={ranOut}
      />
      {confirming && (
        <ConfirmDialog
          heading="Delete this note for good?"
          confirm="Delete note"
          busy={busy}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            const id = confirming.id;
            setConfirming(null);
            run(
              () => deleteMyNote(id),
              () => onOpen(null),
            );
          }}
        >
          It can&apos;t be put back once it&apos;s gone.
        </ConfirmDialog>
      )}
    </section>
  );
}
