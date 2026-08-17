"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import {
  jobSubtitle,
  streetLine,
  type StudioJobHit,
} from "@/lib/studio/job-link";

/* The ServiceM8 job picker — the search field and its dropdown, shared by the
   two places that pick a job: the new-design step (naming a design after the
   job it's for) and the Summary sheet's letterhead (attaching a job to a
   design that already exists).

   ONE component because it is one behaviour, and the awkward parts are the
   parts you only get right once: out-of-order answers, click-away that
   doesn't lose what you typed, and Escape that closes the panel without
   cancelling whatever wizard is underneath. Written twice, the second copy
   would be the one missing the sequence guard. */

export type JobSearch = (q: string) => Promise<StudioJobHit[]>;

export function JobSearchField({
  onPick,
  placeholder = "Find the ServiceM8 job — number, client or address",
  search,
  autoFocus = false,
}: {
  onPick: (hit: StudioJobHit) => void;
  placeholder?: string;
  search: JobSearch;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudioJobHit[]>([]);
  const [searching, setSearching] = useState(false);
  /* Open is its OWN state, not "is there a query": the panel covers what sits
     beneath it, so clicking away has to put that back within reach without
     throwing away what was typed to find the job. */
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  /* Every keystroke fires a search and answers arrive out of order — a slow
     "26" landing after a fast "26 East" would replace the right list with a
     stale one. Only the newest request may write. */
  const seq = useRef(0);

  /* Click away to close — `mousedown` against the container's own subtree,
     never a blur, because a <button> that doesn't take focus on click
     (Safari) would close the panel out from under the click it was about to
     receive. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const run = useCallback(
    async (q: string) => {
      setQuery(q);
      const mine = ++seq.current;
      if (q.trim().length < 2) {
        setHits([]);
        setSearching(false);
        setOpen(false);
        return;
      }
      setSearching(true);
      setOpen(true);
      try {
        const found = await search(q);
        if (mine !== seq.current) return;
        setHits(found);
      } catch {
        /* offline, or the action is unreachable — an empty list and "nothing
           matches" is the honest reading */
        if (mine !== seq.current) return;
        setHits([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    },
    [search]
  );

  const pick = (hit: StudioJobHit) => {
    setQuery("");
    setHits([]);
    setSearching(false);
    setOpen(false);
    seq.current++;
    onPick(hit);
  };

  return (
    <div className="ds-sm8-field" ref={dropRef}>
      <label className="ds-sm8-search">
        <Icon name="search" size={15} />
        <input
          type="search"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => void run(e.target.value)}
          onFocus={() => {
            if (query.trim().length >= 2) setOpen(true);
          }}
          onKeyDown={(e) => {
            /* Escape puts the results away; it does NOT cancel whatever is
               underneath, which is what the same key does there. */
            if (e.key === "Escape" && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          aria-label="Find the ServiceM8 job"
        />
      </label>
      {/* A DROPDOWN, not a list that pushes the page: it overlays what's
          beneath so the button below never travels out from under the cursor
          while you're reading. */}
      {open && query.trim().length >= 2 && (
        <div className="ds-sm8-drop" role="listbox" aria-label="ServiceM8 jobs">
          {hits.map((h) => (
            <button
              type="button"
              role="option"
              aria-selected={false}
              key={h.remoteId}
              className="ds-sm8-opt"
              onClick={() => pick(h)}
            >
              <span className="ds-sm8-no">
                {h.jobNumber ? `#${h.jobNumber}` : "—"}
              </span>
              <span className="ds-sm8-b">
                <span className="ds-sm8-t">
                  {streetLine(h.address) || h.clientName || "Job with no address"}
                </span>
                <span className="ds-sm8-s">{jobSubtitle(h)}</span>
                {h.description && <span className="ds-sm8-d">{h.description}</span>}
              </span>
            </button>
          ))}
          {hits.length === 0 && (
            <p className="ds-sm8-none">
              {searching
                ? "Searching ServiceM8…"
                : `No ServiceM8 job matches “${query.trim()}”.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
