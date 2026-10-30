"use client";

import { Fade } from "@/components/parts/fade";
import { StateWord, type Tone } from "@/components/parts/state";

/* THE LEFT COLUMN'S ROWS (the board v2-board-conversations): each a title
   in bold over its time in grey (rule 39), the open one on the light fill
   (rule 29's selected fill), no outline and no bar at its edge (law 14).
   A row is one button: it opens the conversation or the note. What is done
   TO one (rename, delete, archive) is on the open one's own head, so a row
   never nests a second control inside its own. An email in the Inbox also
   says where it stands, a word on the right (rule 39). */

export type CvRow = { id: string; title: string; when: string; state?: { tone: Tone; word: string } };

export function CvList({
  rows,
  openId,
  onOpen,
  label,
}: {
  rows: readonly CvRow[];
  openId: string | null;
  onOpen: (id: string) => void;
  /** What the list is, for a screen reader: "Your conversations". */
  label: string;
}) {
  return (
    <ul className="cv-rows" aria-label={label}>
      {rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            className={`cv-row${r.id === openId ? " cv-row--open" : ""}`}
            aria-current={r.id === openId ? "true" : undefined}
            onClick={() => onOpen(r.id)}
          >
            {r.state ? (
              <span className="cv-row-top">
                <Fade className="cv-row-title">{r.title}</Fade>
                <StateWord tone={r.state.tone}>{r.state.word}</StateWord>
              </span>
            ) : (
              <Fade className="cv-row-title">{r.title}</Fade>
            )}
            <span className="cv-row-when">{r.when}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
