"use client";

import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { SEARCH_MIN, type WorkHit, type WorkSearchResult } from "@/lib/workboard/work-search";
import { searchSummary, snippet } from "@/lib/workboard/photo-search";
import { subjectColour, subjectLabel } from "@/lib/workboard/photo-subjects";
import type { PhotoHit } from "@/app/actions/photo-search";

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

   AND THE PHOTOS ANSWER HERE TOO. The bank — every photo on every job
   anyone has opened — had a second search box of its own on the gallery tab,
   a hand's width under this field, with the same face and different reach.
   Two boxes is one too many: this is the box, so this is where a model
   number off a plate comes back. Photo hits keep their own dress (a
   photograph is answered by looking, not by a ledger row) but they arrive in
   the same panel, under the same headline.

   Every work row is the ledger idiom the rest of the board uses — number,
   who, what, where, when — so a result reads as the same software as the
   list it came from. Rows carry their own colour from the status law, never
   one this file invents. */

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
        placeholder="Search work and photos"
        aria-label="Search the whole workboard, including photos"
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

/** The photo bank's half of the answers — see overview-screen for the ask. */
export type PhotoSearchState = {
  /** Null until the first answer for the current query lands. */
  hits: PhotoHit[] | null;
  banked: number;
  capped: boolean;
  searching: boolean;
};

export function WorkSearchPanel({
  query,
  result,
  searching,
  connected,
  photos,
  starred,
  onOpen,
  onOpenPhoto,
  onStarPhoto,
  onClear,
}: {
  query: string;
  result: WorkSearchResult;
  /** The mirror's older half is still being asked — see all-jobs' own note. */
  searching: boolean;
  connected: boolean;
  photos: PhotoSearchState;
  /** Which hits are already in the gallery. Seeded from what each hit
      reports and then owned by the page, so a star toggled here stays
      toggled while the results are still on screen. */
  starred: ReadonlySet<string>;
  onOpen: (hit: WorkHit) => void;
  /** By position in the hit list — the viewer walks the same list. */
  onOpenPhoto: (index: number) => void;
  onStarPhoto: (remoteId: string) => void;
  onClear: () => void;
}) {
  const typed = query.trim();
  const short = typed.length < SEARCH_MIN;
  const photoHits = photos.hits ?? [];
  const total = result.total + photoHits.length;
  /* "Nothing matches" may only be said once BOTH halves have answered — the
     photos arrive a debounce later than the local rows, and an empty state
     that flashes before they land reads as a search that missed. */
  const settled = !searching && !photos.searching && photos.hits !== null;

  return (
    <div className="wb2-panel" role="region" aria-label="Search results" aria-busy={searching || photos.searching}>
      <div className="wb2-chd">
        <span className="wb2-ci blue">
          <Icon name="search" size={19} />
        </span>
        {/* THE COUNT IS THE LIVE REGION, not the panel. Announcing the whole
            card would read every row back on every keystroke; the headline is
            the one sentence that has actually changed, and it names both the
            query and how much it found. */}
        <div aria-live="polite">
          <b>{short ? "Keep typing" : `${total} ${total === 1 ? "match" : "matches"} for “${typed}”`}</b>
          <em>
            {short
              ? "Two letters is where a search starts — one is a keystroke on the way to one."
              : "Every side of the board at once — jobs, visits, agreements, projects, trips and photos."}
          </em>
        </div>
        <button className="pbtn ghost" onClick={onClear}>
          <Icon name="x" size={15} />
          Clear
        </button>
      </div>

      {short ? null : total === 0 && settled ? (
        <div className="wb2-empty">
          <Icon name="search" size={20} />
          <b>Nothing matches “{typed}”</b>
          <em>
            Search reads job numbers, clients, sites, tags and the words on the work itself
            {connected ? ", right back through ServiceM8" : ""} — and{" "}
            {photos.banked === 0
              ? "no photos have been read yet: they land in the bank as job cards are opened"
              : `the ${photos.banked === 1 ? "1 photo" : `${photos.banked} photos`} read so far`}
            .
          </em>
        </div>
      ) : (
        <>
          {result.groups.map((g) => (
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
          ))}

          {/* THE PHOTOS, dressed as photographs. The summary line carries the
              bank's size because "nothing found" against a bank of twelve
              means something completely different from nothing found against
              four thousand — and only this line can say which. */}
          {!short && photoHits.length > 0 && (
            <div className="wb2-fgrp">
              <div className="wb2-sect">
                Photos
                <em>{searchSummary(photoHits.length, photos.banked, typed)}</em>
              </div>
              <div className="wb2-showgrid wb2-findgrid">
                {photoHits.map((h, i) => (
                  <figure key={h.remoteId} className="wb2-showcard">
                    <span className="wb2-showimg">
                      <button
                        type="button"
                        className="wb2-showopen"
                        onClick={() => onOpenPhoto(i)}
                        aria-label={`Open ${h.caption || h.name}`}
                      >
                        {h.url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={h.url} alt={h.caption || h.name} loading="lazy" />
                        ) : (
                          <i className="wb2-showpending" aria-hidden>
                            <Icon name="cam" size={18} />
                          </i>
                        )}
                      </button>
                      {h.subject && (
                        <u
                          className="wb2-showtag"
                          style={{ background: subjectColour(h.subject) }}
                        >
                          {subjectLabel(h.subject)}
                        </u>
                      )}
                      {/* THE STAR SAYS WHETHER THIS IS ALREADY IN THE GALLERY,
                          and here — unlike the gallery, where everything is
                          starred by definition — it genuinely varies. It is
                          the reason the search can end in a decision: the
                          photo you were hunting for is kept without opening
                          anything. */}
                      <button
                        type="button"
                        className={`wb2-showstar${starred.has(h.remoteId) ? " on" : ""}`}
                        onClick={() => onStarPhoto(h.remoteId)}
                        aria-pressed={starred.has(h.remoteId)}
                        aria-label={`${starred.has(h.remoteId) ? "Unstar" : "Star"} ${h.caption || h.name}`}
                        title={
                          starred.has(h.remoteId)
                            ? "Starred — click to take it out of the gallery"
                            : "Star this photo for the gallery"
                        }
                      >
                        <Icon name="star" size={13} />
                      </button>
                    </span>
                    <figcaption>
                      {h.caption && <b>{h.caption}</b>}
                      <em>
                        {[
                          h.jobNumber ? `#${h.jobNumber}` : null,
                          h.clientName,
                          h.takenAt ? fmtAuWeekdayDayMonth(h.takenAt.slice(0, 10)) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </em>
                      {/* WHY IT MATCHED, when the reason is not the caption.
                          A hit on a model number is invisible otherwise — the
                          picture shows a plate and the words that found it
                          are on it. */}
                      {h.match.transcript && (
                        <mark className="wb2-showhit">{snippet(h.ocrText, typed)}</mark>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
              {photos.capped && (
                <p className="int-hint">
                  Showing the first {photoHits.length} — narrow it down for the rest.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* The local half answers on the keystroke; the mirror's older half and
          the photo bank are round trips. Saying so is the difference between
          "still looking" and "that's all there is" — the two things an empty
          tail can mean. */}
      {!short && searching && <p className="int-hint">Looking through the rest of ServiceM8…</p>}
      {!short && photos.searching && <p className="int-hint">Looking through the photo bank…</p>}
    </div>
  );
}
