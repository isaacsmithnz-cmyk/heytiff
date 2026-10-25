"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Row, RowList } from "@/components/parts/row";
import { Dot } from "@/components/parts/state";
import { Empty } from "@/components/parts/states";
import { markFieldNoteReviewed, removeFieldNote, type ReviewResult } from "@/app/actions/kb-review";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { FieldNoteRow } from "@/lib/tiff/field-notes";
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
