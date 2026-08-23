"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/shell/icon";
import { FaceSwitch } from "@/components/me/face-switch";
import { NoteToken } from "./note-token";
import { addMyNote, archiveMyNote, deleteMyNote, editMyNote } from "@/app/actions/my-notes";
import type { MyNote } from "@/lib/notes/my-notes-query";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";

/* MY NOTES — the reader that makes the cascade's floor a destination.

   This screen is the entire justification for the `staff_notes` table. A note
   that couldn't be filed against a job or handed to somebody as a task has to
   land somewhere a person actually opens and can edit — the journal shows
   what you SAID and never lets you change it, which is right for a record and
   useless for a note. If this page ever goes, the table should go with it.

   It also dogfoods the token. The add row here is the same `strip` posture
   the job card uses — commit is instant, and the sniff offers the review only
   when the words look like a job for somebody.

   A FACE OF THE ME CARD now, not a page of its own. Archived came out of a
   disclosure row inside a second card and onto the card's tab strip, which was
   right and is not being undone — it has simply moved down one level, onto
   `FaceSwitch`, because the card's strip belongs to Me's five destinations and
   this app does not nest that control. Notes and Archived are still two named
   faces you switch between, with the count on the second. */

export function MyNotesFace({
  notes,
  archived,
}: {
  notes: MyNote[];
  archived: MyNote[];
}) {
  const [busy, start] = useTransition();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [face, setFace] = useState<"notes" | "archived">("notes");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "That didn't work.");
    });

  const commit = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    run(() => addMyNote({ body, source: "text" }));
  };

  const saveEdit = (id: string) => {
    const next = text.trim();
    if (!next) return;
    setEditing(null);
    run(() => editMyNote(id, next));
  };

  /* A plain JSX value, NOT an inner component: an inner component is a new
     type every render, so typing into the token would remount the face and
     drop focus on each keystroke. */
  const notesFace = (
    <>
      <NoteToken
        as="strip"
        label="a note"
        value={draft}
        onChange={setDraft}
        onCommit={commit}
        disabled={busy}
        placeholder="Ring the wholesaler back about the coil pricing…"
      />

      {notes.length === 0 ? (
        <div className="ro-empty" style={{ marginTop: 18 }}>
          <span className="ei">
            <Icon name="note" size={20} />
          </span>
          <b>Nothing here yet</b>
          <em>
            Notes you take that don&apos;t belong to a job — or that nobody else needed to
            action — end up on this page.
          </em>
        </div>
      ) : (
        <ul className="wb2-blist read" style={{ marginTop: 16 }}>
          {notes.map((n) => (
            <li key={n.id} style={{ alignItems: "flex-start" }}>
              <span className="wb2-bdot" aria-hidden="true" />
              {editing === n.id ? (
                <span style={{ flex: 1, display: "grid", gap: 8 }}>
                  <textarea
                    className="wb2-notes"
                    rows={3}
                    value={text}
                    autoFocus
                    aria-label="Edit note"
                    onChange={(e) => setText(e.target.value)}
                  />
                  <span style={{ display: "flex", gap: 7 }}>
                    <button className="pbtn sm" disabled={busy} onClick={() => saveEdit(n.id)}>
                      Save
                    </button>
                    <button
                      className="pbtn ghost sm"
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                  </span>
                </span>
              ) : (
                <>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block" }}>{n.body}</span>
                    <em className="wb2-capsaid" style={{ display: "block", marginTop: 3 }}>
                      {fmtAuWeekdayDayMonth(n.createdAt.slice(0, 10))}
                      {n.source === "routed" && " · came off a note you sorted"}
                      {n.source === "voice" && " · dictated"}
                    </em>
                  </span>
                  <button
                    className="wb2-ico"
                    title="Edit"
                    aria-label={`Edit note: ${n.body.slice(0, 40)}`}
                    disabled={busy}
                    onClick={() => {
                      setEditing(n.id);
                      setText(n.body);
                    }}
                  >
                    <Icon name="edit" size={13} />
                  </button>
                  {/* Archive, not delete. Deleting is offered from the
                      archive only, so nothing is destroyed in one click
                      from the list you read every day — the rule the
                      noticeboard follows now too.

                      ARCHIVE / ARCHIVED / PUT BACK, matching that board
                      (Isaac, 2026-08-12). This screen said "Put it away
                      / Put away / Bring it back" while the noticeboard
                      said "Archive / Archived / Put back" — six words
                      for two states across two screens doing the same
                      thing. Archive won: it is what people expect, and
                      it is shorter on a row of buttons. */}
                  <button
                    className="wb2-ico"
                    title="Archive"
                    aria-label={`Archive note: ${n.body.slice(0, 40)}`}
                    disabled={busy}
                    onClick={() => run(() => archiveMyNote(n.id))}
                  >
                    <Icon name="check" size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const archivedFace =
    archived.length === 0 ? (
      <div className="ro-empty">
        <span className="ei">
          <Icon name="note" size={20} />
        </span>
        <b>Nothing archived</b>
        <em>Archive a note from the list and it lands here.</em>
      </div>
    ) : (
      <ul className="wb2-blist read">
        {archived.map((n) => (
          <li key={n.id} style={{ alignItems: "flex-start", opacity: 0.72 }}>
            <span className="wb2-bdot" aria-hidden="true" />
            <span style={{ flex: 1, minWidth: 0 }}>{n.body}</span>
            <button
              className="wb2-ico"
              title="Put back"
              aria-label={`Put back note: ${n.body.slice(0, 40)}`}
              disabled={busy}
              onClick={() => run(() => archiveMyNote(n.id, false))}
            >
              <Icon name="rotate" size={13} />
            </button>
            <button
              className="wb2-ico"
              title="Delete for good"
              aria-label={`Delete note: ${n.body.slice(0, 40)}`}
              disabled={busy}
              onClick={() => run(() => deleteMyNote(n.id))}
            >
              <Icon name="eraser" size={13} />
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="wb2-card">
      <div className="ppanel2">
        {error && <div className="int-note bad">{error}</div>}
        <FaceSwitch
          ariaLabel="Your notes"
          idPrefix="mynt"
          panelPrefix="mynp"
          active={face}
          onGo={(k) => setFace(k as "notes" | "archived")}
          items={[
            { key: "notes", label: "Notes" },
            {
              key: "archived",
              label: "Archived",
              count: archived.length,
              countLabel: (n) => `${n} put away`,
            },
          ]}
        />
        {/* No `key`, no `.psec2` — the note list swaps in place, like Team's.
            The pair remounts the face and fades it in, which on a list is a
            flash (see me-screen.tsx). */}
        <section id={`mynp-${face}`} role="tabpanel" aria-labelledby={`mynt-${face}`} tabIndex={-1}>
          {face === "notes" ? notesFace : archivedFace}
        </section>
      </div>
    </div>
  );
}
