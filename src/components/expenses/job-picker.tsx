"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { describeJob, searchJobs, type JobCandidate } from "@/lib/workboard/note-match";

/* Search the board's jobs, rather than scroll past them.

   Isaac's objection to the dropdown was exact: "instead of saying change it
   above, I'll hit the wrong one." A select is a list you navigate; this is a
   list you narrow. It opens on the order it is handed, takes any word off
   the card — client, service, site or job number — and every row says its
   number so picking is a read, not a gamble.

   IT WAS BORN ON THE NOTE CAPTURE'S REVIEW CARD, as the job line's picker,
   and moved here with its one user when that card went (2026-09-27): the
   Tiff modal asks "Which job is this for?" with the jobs the words named as
   answers to tap, and the expense form is what is left that picks from the
   whole list. It speaks "kind:id", which `targetOf` (lib/workboard/note-draft)
   reads back, and "" for nothing in particular. */
export function JobPicker({
  options,
  chosenId,
  onPick,
  onClose,
  noneLabel,
}: {
  options: JobCandidate[];
  chosenId: string | null;
  onPick: (value: string) => void;
  onClose: () => void;
  /* What the always-reachable "no job" option says. It names what having no
     job MEANS where the picker stands — an expense with no job is simply not
     against one — so each caller says its own. (The note capture's words,
     "keep it in my notes", were its default until that card went.) */
  noneLabel: string;
}) {
  const [q, setQ] = useState("");
  const found = useMemo(() => searchJobs(q, options), [q, options]);

  return (
    <div className="wb2-jobpick">
      <div className="wb2-jobsearch">
        <Icon name="search" size={14} />
        <input
          autoFocus
          className="wb2-jobq"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search jobs — client, service, site or job number"
          aria-label="Search jobs"
        />
        <button className="wb2-ico" onClick={onClose} title="Close" aria-label="Close the job search">
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="wb2-joblist" role="listbox" aria-label="Jobs">
        {/* Always reachable: a job that turns out to be nothing in particular
            is a real answer, not a dead end. */}
        <button
          type="button"
          role="option"
          aria-selected={!chosenId}
          className={"wb2-jobopt" + (!chosenId ? " on" : "")}
          onClick={() => onPick("")}
        >
          {noneLabel}
        </button>
        {found.map((o) => (
          <button
            type="button"
            role="option"
            key={`${o.kind}:${o.id}`}
            aria-selected={o.id === chosenId}
            className={"wb2-jobopt" + (o.id === chosenId ? " on" : "")}
            onClick={() => onPick(`${o.kind}:${o.id}`)}
          >
            {describeJob(o)}
          </button>
        ))}
        {found.length === 0 && (
          <p className="wb2-hint">Nothing on the board matches &ldquo;{q.trim()}&rdquo;.</p>
        )}
      </div>
    </div>
  );
}
