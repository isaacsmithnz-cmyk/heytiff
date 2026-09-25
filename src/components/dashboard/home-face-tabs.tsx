"use client";

import { useRef } from "react";
import { DESK_FACES, FACE_LABEL, stepFace, type DeskFace } from "@/lib/dashboard/desk-focus";
import { KEEPS_DAY } from "./home-day-bar";

/* THE ROW OF TABS, ONE FOR EVERY FACE (Isaac, 2026-09-25: "the diary,
   calendar and tasks tabs shouldn't move positions each time").

   One row, rendered once, above the body that slides — so it is the same
   node, at the same x and y, whichever face is up. His grey words, no
   underline: the chosen one is ink and bold.

   BOLD WITHOUT A NUDGE. A word set in 600 is wider than the same word in
   500, so choosing a tab would push the ones after it along. Each tab holds
   a second copy of its name at the bold weight, with no height and nothing
   to see, and is as wide as that copy from the start — so the tab that is
   on is never wider than it was and nothing beside it moves. The copy is
   hidden from the accessibility tree, so the tab's name is said once.

   Nothing else lives in this row. What belongs to one face — the
   Calendar's box and its 4 weeks / Month / Year — sits in that face's own
   toolbar, so a face can never move the tabs.

   Automatic activation with a roving tabindex: the arrows choose as they
   move, Home and End jump to the ends. No counts on the tabs.

   A face chosen with a key does not slide (law 8: no motion on a keyboard-
   driven action); a tab pressed with a pointer does. */
export function HomeFaceTabs({
  face,
  onGo,
}: {
  face: DeskFace;
  /** `pointer` is false for a choice made from the keyboard. */
  onGo: (face: DeskFace, pointer: boolean) => void;
}) {
  const tabs = useRef(new Map<DeskFace, HTMLButtonElement>());

  const onKeyDown = (e: React.KeyboardEvent) => {
    const next = stepFace(face, e.key);
    if (!next) return;
    e.preventDefault();
    onGo(next, false);
    tabs.current.get(next)?.focus();
  };

  return (
    /* A press here changes the face and leaves the day's open card open. */
    <div className="hd-tabs" role="tablist" aria-label="Home" onKeyDown={onKeyDown} {...KEEPS_DAY}>
      {DESK_FACES.map((f) => {
        const on = f === face;
        return (
          <button
            key={f}
            ref={(el) => {
              if (el) tabs.current.set(f, el);
              else tabs.current.delete(f);
            }}
            type="button"
            role="tab"
            id={`hdtab-${f}`}
            aria-controls={`hdsec-${f}`}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={on ? "hd-tab on" : "hd-tab"}
            onClick={(e) => onGo(f, e.detail > 0)}
          >
            {FACE_LABEL[f]}
            <span className="hd-tabw" aria-hidden="true">
              {FACE_LABEL[f]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
