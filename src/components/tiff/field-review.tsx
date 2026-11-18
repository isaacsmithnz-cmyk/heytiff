"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Row, RowList } from "@/components/parts/row";
import { Dot } from "@/components/parts/state";
import { Empty, Loading } from "@/components/parts/states";
import { kbNoteWords } from "@/app/actions/kb";
import { markFieldNoteReviewed, removeFieldNote, type ReviewResult } from "@/app/actions/kb-review";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { FieldNoteRow, NoteWords } from "@/lib/tiff/field-notes";
import "./field-review.css";

/* KNOWLEDGE FROM THE FIELD, in the Library (v2, 25 October 2026; it was
   Admin, Knowledge from the field, Isaac: "Knowledge from the field in the
   Library"). The Field notes shelf's second view, for an admin: what the
   crew taught Tiff that nobody has looked over yet.

   THESE ARE ALREADY LIVE. Publish first, review after (Isaac, 2026-08-06):
   a note is in the Library the moment whoever said it ticks it, so this is
   not an approval gate and nothing here reads like one. Two verbs and
   nothing else: agree, or take it down.

   A row per note (rule 39): its title, who said it and when with what they
   said in grey under it, and Looks right on the right. The row opens the
   whole note, where Take it down is, a red word on the second button
   (rule 25): it is the one that can't be undone, so it is pressed with the
   whole note in front of you. */

const said = (e: FieldNoteRow) => `${e.authorName ?? "Someone"}, ${fmtAuWeekdayDayMonth(auDayOf(e.createdAt))}`;

export function FieldReview({ entries, onDone }: { entries: FieldNoteRow[]; onDone: (id: string) => void }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<FieldNoteRow | null>(null);

  const run = (id: string, act: (id: string) => Promise<ReviewResult>) =>
    start(async () => {
      setError(null);
      const res = await act(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(null);
      onDone(id);
    });

  if (entries.length === 0) return <Empty what="Nothing new from the field to look over" action={null} />;

  return (
    <div className="lb2-fr">
      {error && !open && (
        <p className="lb2-fr-wrong" role="alert">
          <Dot hue="red" />
          <span>{error}</span>
        </p>
      )}
      <RowList label="To look over">
        {entries.map((e) => (
          <Row
            key={e.id}
            name={e.title}
            line={`${said(e)}: ${e.body}`}
            lines={2}
            onClick={() => {
              setError(null);
              setOpen(e);
            }}
            end={
              <Button kind="second" size={32} disabled={busy} aria-label={`Looks right: ${e.title}`} onClick={() => run(e.id, markFieldNoteReviewed)}>
                Looks right
              </Button>
            }
          />
        ))}
      </RowList>

      {open && (
        <Dialog
          heading={open.title}
          width={560}
          onClose={() => setOpen(null)}
          foot={
            <>
              <Button kind="delete" disabled={busy} onClick={() => run(open.id, removeFieldNote)}>
                {busy ? "Taking it down" : "Take it down"}
              </Button>
              <Button kind="main" disabled={busy} data-autofocus onClick={() => run(open.id, markFieldNoteReviewed)}>
                Looks right
              </Button>
            </>
          }
        >
          <p className="lb2-fr-said">{open.heading ?? said(open)}</p>
          <p className="lb2-fr-body">{open.body}</p>
          {error && (
            <p className="lb2-fr-wrong" role="alert">
              <Dot hue="red" />
              <span>{error}</span>
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}

/* A FIELD NOTE OPENS AS ITS WORDS (bug 34, Luke, 18 November 2026:
   "Message box doesn't display correctly"). A field note was written from
   somebody's note, so it has no PDF, and searching its one paragraph inside
   a dialog found nothing worth finding: opening its cover on a brand's page
   showed a title, a search box and Close, and never what it says. It opens
   as the note above does, and as the phone's Details sheet shows one: where
   it was learned in grey, what it says at the reading size (rule 13). Its
   words are read when it opens; the Library's list carries titles only. */
export function FieldNote({ doc, onClose }: { doc: { id: string; title: string }; onClose: () => void }) {
  const [read, setRead] = useState<{ id: string; words: NoteWords | null; error: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    void kbNoteWords(doc.id).then((res) => {
      if (live) setRead({ id: doc.id, words: res.ok ? res.words : null, error: res.ok ? null : res.error });
    });
    return () => {
      live = false;
    };
  }, [doc.id]);
  const now = read?.id === doc.id ? read : null;

  return (
    <Dialog
      heading={doc.title}
      width={560}
      onClose={onClose}
      foot={
        <Button kind="quiet" onClick={onClose}>
          Close
        </Button>
      }
    >
      {!now ? (
        <Loading what="Loading the note" />
      ) : now.words ? (
        <>
          {now.words.learned && <p className="lb2-fr-said">{now.words.learned}</p>}
          <p className="lb2-fr-body">{now.words.body}</p>
        </>
      ) : (
        <p className="lb2-fr-wrong" role="alert">
          <Dot hue="red" />
          <span>{now.error}</span>
        </p>
      )}
    </Dialog>
  );
}
