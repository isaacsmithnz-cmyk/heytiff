"use client";

import { useContext } from "react";
import { Icon } from "@/components/shell/icon";
import { WindowsContext } from "./records-context";

/* THE DOCK — the cards set aside (record-host).

   A row in the dark frame under the page, never over it: the page gives up
   the row while something waits in it and takes it back when nothing does.
   It is on every screen, because a card set aside belongs to no screen —
   set a job aside on Home, go to the Workboard, and it is there to bring
   back over the Schedule.

   Each card is the job's number and its client, the door back to it, and a
   close cross that lets it go. Light: it reads the host's list and nothing
   else, so the frame carries it without the card's code. */

export function RecordDock() {
  const host = useContext(WindowsContext);
  const waiting = host?.windows.filter((w) => w.aside) ?? [];
  if (!host || waiting.length === 0) return null;
  return (
    <nav className="rw-dock" aria-label="Set aside">
      <span className="rw-dkl">Set aside</span>
      {waiting.map((w) => {
        const name = w.row.number ? `Job ${w.row.number}` : "Job";
        return (
          <span key={w.key} className="rw-dk">
            <button type="button" className="rw-dko" onClick={() => host.restore(w.key)}>
              <b>{name}</b>
              {w.row.clientName && (
                <>
                  {" "}
                  <span>{w.row.clientName}</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="rw-dkx"
              aria-label={`Close ${name.toLowerCase()}`}
              onClick={() => host.close(w.key)}
            >
              <Icon name="x" size={14} />
            </button>
          </span>
        );
      })}
    </nav>
  );
}
