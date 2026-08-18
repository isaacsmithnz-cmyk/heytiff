"use client";

import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { SEARCH_MIN, type WorkHit, type WorkSearchResult } from "@/lib/workboard/work-search";

/* THE UNIVERSAL SEARCH — the field, and what it puts on the card.

   THE FIELD rides at the right end of the tab row, next to the ServiceM8
   health chip, which puts it just above the white card on every side and
   every tab. It is owned by the PAGE, not by a board: the boards unmount each
   other when you switch sides, and a search that emptied itself the moment
   you crossed to the side holding the answer would be a search you couldn't
   use. Passed down through each board's existing `tools` slot rather than
   rendered three times.

   THE PANEL replaces the card's content while a query is live, on whichever
   side you're standing. Not a dropdown: the answers are rows of real work
   with numbers, sites and dates on them, and a floating list wide enough to
   carry that is a card with extra steps. Not a filter of the tab underneath
   either — that was the old design, and it could only ever find what the tab
   already held. The tab row stays lit behind it, so where you'll land back
   is never in doubt.

   Every row is the ledger idiom the rest of the board uses — number, who,
   what, where, when — so a result reads as the same software as the list it
   came from. Rows carry their own colour from the status law, never one this
   file invents. */

export function WorkSearchField({
  query,
  onQuery,
  onClear,
}: {
  query: string;
  onQuery: (q: string) => void;
  onClear: () => void;
}) {
  return (
    <label className="wb2-find">
      <Icon name="search" size={14} />
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          // Esc clears rather than blurs: the field is the way OUT of the
          // results panel, so the key that means "never mind" has to undo the
          // mode, not just the focus.
          if (e.key === "Escape" && query) {
            e.preventDefault();
            onClear();
          }
        }}
        placeholder="Search all work"
        aria-label="Search the whole workboard"
      />
      {query && (
        <button type="button" className="wb2-findx" onClick={onClear} aria-label="Clear search">
          <Icon name="x" size={13} />
        </button>
      )}
    </label>
  );
}

function Hit({ hit, onOpen }: { hit: WorkHit; onOpen: (hit: WorkHit) => void }) {
  return (
    <button
      className="wb2-ajr as-btn"
      onClick={() => onOpen(hit)}
      aria-label={`Open ${hit.title}${hit.number ? ` — ${hit.number}` : ""}`}
    >
      <span className="wb2-ajnum">
        {hit.number ? (
          <>
            <b>#{hit.number}</b>
            <em>{hit.numberSystem === "sm8" ? "ServiceM8" : "HeyTiff"}</em>
          </>
        ) : (
          <em>—</em>
        )}
      </span>

      <div className="wb2-trt">
        <b>{hit.title}</b>
        <em>{hit.sub ?? "No description"}</em>
      </div>

      <span className="wb2-ajmeta">{hit.where && <em>{hit.where}</em>}</span>

      <div className="wb2-trd">
        {hit.date ? (
          <>
            <b>{fmtAuWeekdayDayMonth(hit.date)}</b>
            <em>{hit.dateLabel}</em>
          </>
        ) : (
          <em>{hit.dateLabel}</em>
        )}
      </div>

      <span className="wb2-ajchips">
        <i className={`wb2-chip${hit.tone ? ` ${hit.tone}` : ""}`}>{hit.statusLabel}</i>
      </span>
    </button>
  );
}

export function WorkSearchPanel({
  query,
  result,
  searching,
  connected,
  onOpen,
  onClear,
}: {
  query: string;
  result: WorkSearchResult;
  /** The mirror's older half is still being asked — see all-jobs' own note. */
  searching: boolean;
  connected: boolean;
  onOpen: (hit: WorkHit) => void;
  onClear: () => void;
}) {
  const typed = query.trim();
  const short = typed.length < SEARCH_MIN;

  return (
    <div className="wb2-panel" role="region" aria-label="Search results" aria-busy={searching}>
      <div className="wb2-chd">
        <span className="wb2-ci blue">
          <Icon name="search" size={19} />
        </span>
        {/* THE COUNT IS THE LIVE REGION, not the panel. Announcing the whole
            card would read every row back on every keystroke; the headline is
            the one sentence that has actually changed, and it names both the
            query and how much it found. */}
        <div aria-live="polite">
          <b>{short ? "Keep typing" : `${result.total} ${result.total === 1 ? "match" : "matches"} for “${typed}”`}</b>
          <em>
            {short
              ? "Two letters is where a search starts — one is a keystroke on the way to one."
              : "Every side of the board at once — jobs, visits, agreements, projects and trips."}
          </em>
        </div>
        <button className="pbtn ghost" onClick={onClear}>
          <Icon name="x" size={15} />
          Clear
        </button>
      </div>

      {short ? null : result.total === 0 && !searching ? (
        <div className="wb2-empty">
          <Icon name="search" size={20} />
          <b>Nothing matches “{typed}”</b>
          <em>
            Search reads job numbers, clients, sites, tags and the words on the work itself
            {connected ? ", right back through ServiceM8" : ""}.
          </em>
        </div>
      ) : (
        result.groups.map((g) => (
          <div className="wb2-fgrp" key={g.key}>
            <div className="wb2-sect">
              {g.label}
              <em>
                {g.found > g.hits.length
                  ? `${g.hits.length} of ${g.found} shown — narrow it with another word`
                  : g.note}
              </em>
            </div>
            {g.hits.map((h) => (
              <Hit key={h.key} hit={h} onOpen={onOpen} />
            ))}
          </div>
        ))
      )}

      {/* The local half answers on the keystroke; the mirror's older half is a
          round trip. Saying so is the difference between "still looking" and
          "that's all there is" — the two things an empty tail can mean. */}
      {!short && searching && <p className="int-hint">Looking through the rest of ServiceM8…</p>}
    </div>
  );
}
