"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/parts/button";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Row, RowList } from "@/components/parts/row";
import { Empty, Wrong } from "@/components/parts/states";
import { ViewTabs } from "@/components/parts/tabs";
import { ToastProvider, useToast } from "@/components/parts/toast";
import { NoteForm } from "@/components/making/note-form";
import { archiveMyNote, deleteMyNote, type NoteResult } from "@/app/actions/my-notes";
import type { MyNote } from "@/lib/notes/my-notes-query";
import { noteTitle } from "@/lib/tiff/conversations";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";

/* NOTES (v2): Your name › Notes, a page of its own like Timesheet (Isaac,
   24 October 2026). Your own notepad: the `staff_notes` rows, scoped by
   every read and write to your own staff id (app/actions/my-notes.ts), so
   nobody else ever sees one. A note about a job belongs on the job's card;
   this is the phone number, the thing to ring back about.

   The title and its one button, New note, which opens New › Note's own
   form; soft tabs for Notes and Archived (rule 29). A note is a row: its
   first line in bold, the rest under it, the day it was written, and Edit
   and Archive. Archive says so in a toast with Undo (rules 37 and 51); an
   archived note comes back with Put back, and goes for good only from
   there, after asking.

   Conversations › Only me showed these same rows and is gone: a note isn't
   a conversation. */

type View = "notes" | "archived";

/** What a row says under its first line: the rest of the note. */
const rest = (body: string) => {
  const lines = body.trim().split("\n");
  const at = lines.findIndex((l) => l.trim());
  return lines
    .slice(at + 1)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
};

function Notes({ notes, archived }: { notes: MyNote[]; archived: MyNote[] }) {
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("notes");
  /* New note, or the note Edit opened, over the page */
  const [form, setForm] = useState<{ note?: MyNote } | null>(null);
  const [confirming, setConfirming] = useState<MyNote | null>(null);

  const run = (fn: () => Promise<NoteResult>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else after?.();
    });

  const archive = (n: MyNote) =>
    run(
      () => archiveMyNote(n.id),
      () => toast({ text: "Note archived", undo: () => run(() => archiveMyNote(n.id, false)) }),
    );

  const day = (n: MyNote) => fmtAuWeekdayDayMonth(auDayOf(n.createdAt));
  const shown = view === "notes" ? notes : archived;

  return (
    <div className="wrap yp">
      <header className="yp-head">
        <h1 className="yp-h1">Notes</h1>
        <Button kind="main" icon="plus" onClick={() => setForm({})}>
          New note
        </Button>
      </header>

      {error && <Wrong word="Not saved" means={error} />}

      <ViewTabs
        ariaLabel="Your notes"
        idPrefix="ntt"
        panelPrefix="ntp"
        current={view}
        onGo={(k) => setView(k as View)}
        items={[
          { key: "notes", label: "Notes" },
          /* no number on the tab (Isaac, 20 October) */
          { key: "archived", label: "Archived" },
        ]}
      />
      {/* No `key` — the list swaps in place, as Team's does; a key remounts
          it and reads as a flash. */}
      <section id={`ntp-${view}`} role="tabpanel" aria-labelledby={`ntt-${view}`} tabIndex={-1}>
        {shown.length === 0 ? (
          view === "notes" ? (
            <Empty what="No notes yet" line="Only you can see your notes." action={null} />
          ) : (
            <Empty what="Nothing archived" line="Archive a note and it lands here." action={null} />
          )
        ) : (
          <RowList label={view === "notes" ? "Your notes" : "Archived notes"}>
            {shown.map((n) => (
              <Row
                key={n.id}
                name={noteTitle(n.body)}
                line={rest(n.body) || undefined}
                end={
                  <span className="nt-end">
                    <span className="nt-day">{day(n)}</span>
                    {view === "notes" ? (
                      <>
                        <Button kind="second" size={32} disabled={busy} aria-label={`Edit note: ${noteTitle(n.body)}`} onClick={() => setForm({ note: n })}>
                          Edit
                        </Button>
                        <Button kind="second" size={32} disabled={busy} aria-label={`Archive note: ${noteTitle(n.body)}`} onClick={() => archive(n)}>
                          Archive
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          kind="second"
                          size={32}
                          disabled={busy}
                          aria-label={`Put back note: ${noteTitle(n.body)}`}
                          onClick={() => run(() => archiveMyNote(n.id, false))}
                        >
                          Put back
                        </Button>
                        <Button kind="delete" size={32} disabled={busy} aria-label={`Delete note: ${noteTitle(n.body)}`} onClick={() => setConfirming(n)}>
                          Delete for good
                        </Button>
                      </>
                    )}
                  </span>
                }
              />
            ))}
          </RowList>
        )}
      </section>

      {form && <NoteForm note={form.note} onClose={() => setForm(null)} />}
      {confirming && (
        <ConfirmDialog
          heading="Delete this note for good?"
          confirm="Delete note"
          busy={busy}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            const id = confirming.id;
            setConfirming(null);
            run(() => deleteMyNote(id));
          }}
        >
          It can&apos;t be put back once it&apos;s gone.
        </ConfirmDialog>
      )}
    </div>
  );
}

export function NotesPage(props: { notes: MyNote[]; archived: MyNote[] }) {
  return (
    <ToastProvider>
      <Notes {...props} />
    </ToastProvider>
  );
}
