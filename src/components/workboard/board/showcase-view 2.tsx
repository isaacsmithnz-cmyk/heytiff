"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import {
  countBySubject,
  subjectColour,
  subjectLabel,
  type PhotoSubject,
} from "@/lib/workboard/photo-subjects";
import { listShowcase, type ShowcasePhoto } from "@/app/actions/job-photo-favourites";
import { searchPhotos, type PhotoHit } from "@/app/actions/photo-search";
import { PHOTO_SEARCH_MIN, searchSummary } from "@/lib/workboard/photo-search";

/* THE SHOWCASE — the photos somebody starred, and what they are OF.

   IT SHOWS THE FAVOURITES AND NOTHING ELSE. This is the curated set — what
   somebody decided was worth showing a client or sending to whoever is on
   site next. The BANK is larger: every photo on every job anyone has opened
   has been read, and search spans all of it. Stars are what you would show
   someone; the bank is what you can find.

   THE CATEGORIES COME FROM THE PICTURE, not from the job's paperwork — also
   Isaac's call, and the sharper one. A job's category says Install or Service
   Call; it cannot say that this frame is the dataplate, or the ductwork, or
   the fault someone photographed to explain it. Those are what a showcase
   gets searched by.

   THERE IS NO READER BUTTON HERE ANY MORE. Photographs are read when their
   JOB IS OPENED, not when they are starred — see actions/photo-readings.ts.
   That split matters: the star is a human judgement about what is worth
   showing someone, and reading is just indexing. Tying the two together meant
   a photo had to be curated before it could be found, which is backwards.

   So this screen spends nothing. It reads `job_photo_readings` through the
   showcase query and draws what is already known. A starred photo whose job
   has not finished reading shows as unread rather than as uncategorised —
   absent, not wrong. */

type Filter = { kind: "all" } | { kind: "subject"; subject: string } | { kind: "unread" };

/* TYPING LEAVES THE CURATED SET AND ENTERS THE BANK.

   The showcase is the starred photos; the bank is every photo on every job
   anyone has opened, which is far larger. Search has to span the bank — the
   whole point is finding a photograph nobody thought to star at the time — so
   the grid swaps rather than filtering in place. Clearing the box puts the
   curated set back, untouched, with its filter still where it was.

   That swap is stated on screen rather than left to be inferred: the results
   say how many photographs have been read at all, because "nothing found"
   against a bank of twelve means something completely different from nothing
   found against four thousand. */
const DEBOUNCE_MS = 250;

/* NO `manage` PROP ANY MORE. It gated the reader button, and the reader
   button is gone — this screen only draws. Anyone who can see the Workboard
   can see what the crew kept. */
/** The stretch of transcription around what was typed, so a hit on a model
    number shows the words that found it rather than leaving the reader to
    guess why a photograph of a plate came back. */
export function snippet(text: string, term: string, width = 64): string {
  if (!text) return "";
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return text.slice(0, width);
  const from = Math.max(0, at - Math.floor((width - term.length) / 2));
  const cut = text.slice(from, from + width);
  return `${from > 0 ? "…" : ""}${cut}${from + width < text.length ? "…" : ""}`;
}

export function ShowcaseView() {
  const [photos, setPhotos] = useState<ShowcasePhoto[] | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<PhotoHit[] | null>(null);
  const [banked, setBanked] = useState(0);
  const [capped, setCapped] = useState(false);
  const [searching, setSearching] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void listShowcase()
      .then((rows) => {
        if (alive.current) setPhotos(rows);
      })
      .catch(() => {
        if (alive.current) setPhotos([]);
      });
  }, []);

  /* SEARCHING IS AN EVENT, NOT A SYNCHRONISATION. It used to live in an
     effect keyed on the term, which meant every keystroke scheduled work as a
     side effect of rendering — and the lint rule that flagged it was making a
     real point: typing is something the reader DOES, so the debounce hangs
     off the change handler where the intent is.

     DEBOUNCED, AND THE LAST ANSWER WINS. Without the sequence guard a slow
     query for "duct" can land after a fast one for "ductwork" and paint the
     wrong photos under the right word — the classic as-you-type race, and it
     is pinned by a test that was watched failing. */
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const onTerm = (next: string) => {
    setTerm(next);
    if (timer.current) clearTimeout(timer.current);
    const wanted = next.trim();
    /* A too-short term schedules nothing and clears nothing: it bumps the
       sequence so an answer still in flight is discarded, and the render
       simply stops looking at `hits`. */
    const mine = ++seq.current;
    if (wanted.length < PHOTO_SEARCH_MIN) {
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(() => {
      void searchPhotos(wanted)
        .then((res) => {
          if (!alive.current || mine !== seq.current) return;
          setHits(res.hits);
          setBanked(res.banked);
          setCapped(res.capped);
          setSearching(false);
        })
        .catch(() => {
          if (!alive.current || mine !== seq.current) return;
          setHits([]);
          setSearching(false);
        });
    }, DEBOUNCE_MS);
  };

  const unread = (photos ?? []).filter((p) => !p.read);

  if (photos === null)
    return (
      <div className="wb2-show">
        <p className="int-hint">Opening the showcase…</p>
      </div>
    );

  /* THE BOX IS ALWAYS THERE, even with nothing starred — the bank it searches
     is not the starred set, so an empty showcase says nothing about whether
     there is anything to find.

     IT IS THE BOARD'S OWN FIELD, not a new one. `.wb2-find` already dresses
     the Workboard's universal search, down to Esc-clears-rather-than-blurs —
     and the reason that rule exists there is the reason it is right here: the
     field is the way OUT of the results, so "never mind" has to undo the mode
     and not just the focus. A second search box with its own manners would be
     a fourth convention in one app. */
  const box = (
    <label className="wb2-find wb2-showfind">
      <Icon name="search" size={14} />
      <input
        type="search"
        value={term}
        onChange={(e) => onTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && term) {
            e.preventDefault();
            onTerm("");
          }
        }}
        placeholder="Search every photo — a model number, a part, a client"
        aria-label="Search photos"
      />
      {term && (
        <button
          type="button"
          className="wb2-findx"
          onClick={() => onTerm("")}
          aria-label="Clear search"
        >
          <Icon name="x" size={13} />
        </button>
      )}
    </label>
  );

  if (photos.length === 0 && hits === null)
    return (
      <div className="wb2-show">
        {box}
        <div className="wb2-showempty">
          <Icon name="star" size={22} />
          <b>Nothing starred yet</b>
          <p>
            Star a photo on any job&apos;s Photos tab and it lands here — the shots worth
            showing a client, or sending to whoever is on site next.
          </p>
        </div>
      </div>
    );

  const bySubject = countBySubject(photos);
  const shown = photos.filter((p) =>
    filter.kind === "all"
      ? true
      : filter.kind === "unread"
        ? !p.read
        : p.subject === filter.subject
  );

  /* RESULTS REPLACE THE GRID, they do not filter it. The two sets answer
     different questions and mixing them would leave a reader unable to tell
     which one they were looking at.

     DERIVED from the term, never from a cleared state: the moment the box is
     empty this is null again, whatever a slow query does afterwards. */
  const showResults = term.trim().length >= PHOTO_SEARCH_MIN;
  if (showResults && hits !== null)
    return (
      <div className="wb2-show">
        {box}
        <div className="wb2-jcdhead">
          <b>Results</b>
          <em>{searchSummary(hits.length, banked, term.trim())}</em>
        </div>
        {searching && <p className="int-hint">Looking…</p>}
        {hits.length === 0 && !searching && (
          <div className="wb2-showempty">
            <Icon name="search" size={22} />
            <b>{banked === 0 ? "Nothing has been read yet" : "No photo matches that"}</b>
            <p>
              {banked === 0
                ? "Photos are read when their job card is opened. Open a job with photos on it and they land in here."
                : "Only photos on jobs somebody has opened are in the bank — try a model number off a plate, a part, a client or a job number."}
            </p>
          </div>
        )}
        <div className="wb2-showgrid">
          {hits.map((h) => (
            <figure key={h.remoteId} className="wb2-showcard">
              <span className="wb2-showimg">
                {h.url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={h.url} alt={h.caption || h.name} loading="lazy" />
                ) : (
                  <i className="wb2-showpending" aria-hidden>
                    <Icon name="cam" size={18} />
                  </i>
                )}
                {h.subject && (
                  <u className="wb2-showtag" style={{ background: subjectColour(h.subject) }}>
                    {subjectLabel(h.subject)}
                  </u>
                )}
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
                {/* WHY IT MATCHED, when the reason is not the caption. A hit
                    on a model number is invisible otherwise — the picture
                    shows a plate and the words that found it are on it. */}
                {h.match.transcript && (
                  <mark className="wb2-showhit">{snippet(h.ocrText, term.trim())}</mark>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
        {capped && (
          <p className="int-hint">
            Showing the first {hits.length} — narrow it down for the rest.
          </p>
        )}
      </div>
    );

  return (
    <div className="wb2-show">
      {box}
      <div className="wb2-jcdhead">
        <b>Showcase</b>
        <em>
          {photos.length === 1 ? "1 starred photo" : `${photos.length} starred photos`}
        </em>
      </div>

      {/* The filter row IS the categories. Order is the subject list's own, so
          it never reshuffles under the cursor as photos are read. */}
      <div className="wb2-showfilters" role="tablist" aria-label="What the photo is of">
        <button
          role="tab"
          aria-selected={filter.kind === "all"}
          className={`wb2-showchip${filter.kind === "all" ? " on" : ""}`}
          onClick={() => setFilter({ kind: "all" })}
        >
          {`Everything · ${photos.length}`}
        </button>
        {bySubject.map(({ subject, count }) => (
          <button
            key={subject}
            role="tab"
            aria-selected={filter.kind === "subject" && filter.subject === subject}
            className={`wb2-showchip${filter.kind === "subject" && filter.subject === subject ? " on" : ""}`}
            style={{ ["--sc" as string]: subjectColour(subject) }}
            onClick={() => setFilter({ kind: "subject", subject })}
          >
            <i className="wb2-showdot" aria-hidden />
            {`${subjectLabel(subject)} · ${count}`}
          </button>
        ))}
        {unread.length > 0 && (
          <button
            role="tab"
            aria-selected={filter.kind === "unread"}
            className={`wb2-showchip quiet${filter.kind === "unread" ? " on" : ""}`}
            onClick={() => setFilter({ kind: "unread" })}
          >
            {`Not read yet · ${unread.length}`}
          </button>
        )}
      </div>

      {/* Nothing here spends. A starred photo whose job is still being read
          says so, rather than being filed under a subject it hasn't earned —
          the reading happens on the job card and lands on its own clock. */}
      <div className="wb2-showgrid">
        {shown.map((p) => (
          <figure key={p.remoteId} className="wb2-showcard">
            <span className="wb2-showimg">
              {p.url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={p.url} alt={p.caption || p.name} loading="lazy" />
              ) : (
                <i className="wb2-showpending" aria-hidden>
                  <Icon name="cam" size={18} />
                </i>
              )}
              {p.subject && (
                <u className="wb2-showtag" style={{ background: subjectColour(p.subject) }}>
                  {subjectLabel(p.subject)}
                </u>
              )}
            </span>
            <figcaption>
              {/* The caption Claude wrote, when there is one — it says what
                  the picture IS, which the filename never did. */}
              {p.caption && <b>{p.caption}</b>}
              <em>
                {[
                  p.jobNumber ? `#${p.jobNumber}` : null,
                  p.clientName,
                  p.takenAt ? fmtAuWeekdayDayMonth(p.takenAt.slice(0, 10)) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </em>
              {p.tags.length > 0 && (
                <span className="wb2-showtags">
                  {p.tags.map((t) => (
                    <i key={t}>{t}</i>
                  ))}
                </span>
              )}
            </figcaption>
          </figure>
        ))}
      </div>

      {shown.length === 0 && <p className="int-hint">Nothing under that one yet.</p>}
    </div>
  );
}

export type { PhotoSubject };
