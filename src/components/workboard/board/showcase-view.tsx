"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import {
  countByFamily,
  countBySubject,
  familyOf,
  FAMILY_COLOUR,
  FAMILY_LABEL,
  subjectColour,
  subjectLabel,
  type PhotoFamily,
  type PhotoSubject,
} from "@/lib/workboard/photo-subjects";
import {
  listShowcase,
  setJobPhotoFavourite,
  type ShowcasePhoto,
  type StarPhotoResult,
} from "@/app/actions/job-photo-favourites";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { JobMediaViewer } from "./job-media-viewer";

/* THE GALLERY — the photos somebody starred, and what they are OF.

   IT SHOWS THE FAVOURITES AND NOTHING ELSE. This is the curated set — what
   somebody decided was worth showing a client or sending to whoever is on
   site next. The BANK is larger: every photo on every job anyone has opened
   has been read, and search spans all of it (in the board's one universal
   field, not here). Stars are what you would show someone; the bank is what
   you can find.

   THE ROW ABOVE THE PICTURES IS FIVE TABS, NOT ELEVEN CHIPS. It drew one
   chip per subject and one more for the unread, which wrapped over three
   lines on a real gallery — a paragraph of labels standing between somebody
   and the photographs they came to look at. Isaac: "it shows too many
   labels ... it should be broken down into broader tabs ... have a filter
   button instead of just displaying all tags."

   So the vocabulary is cut twice now, and the two cuts have different jobs:

     THE TABS are the broad move, always visible, one word each. They are the
     FAMILIES (see lib/workboard/photo-subjects), derived from the subject
     rather than stored beside it.

     THE FILTER BUTTON holds the fine move: the ten subjects themselves,
     under their family headings, plus the photos nobody has read yet. It is
     shut by default, which is the whole point — the precision is still there
     for the day somebody wants only dataplates, and it costs nothing on the
     day they don't.

   The two never disagree on screen: choosing a subject in the filter lights
   that subject's tab, because a control that silently contradicts the one
   next to it is worse than either alone.

   THE TAG CHIPS UNDER EACH CARD ARE GONE, and that is the rest of the
   "too many labels". They repeated a model name the caption usually already
   said, in a second typeface, on every card in the grid. Tags were never
   what you filter by — they are what the search reads — so they lost nothing
   by leaving the picture alone.

   This screen spends nothing. It reads `job_photo_readings` through the
   showcase query and draws what is already known. A starred photo whose job
   has not finished reading shows as unread rather than as uncategorised —
   absent, not wrong. */

type Filter =
  | { kind: "all" }
  | { kind: "family"; family: PhotoFamily }
  | { kind: "subject"; subject: string }
  | { kind: "unread" };

/** What the viewer needs to know about a photo, whichever list it came from —
    the gallery's rows and the universal search's hits both carry this. */
export type GalleryMediaSource = Pick<
  ShowcasePhoto,
  "remoteId" | "name" | "caption" | "jobNumber" | "clientName" | "takenAt" | "url"
>;

/** A gallery card as the shared viewer needs to see it. The caption Claude
    wrote leads when there is one — the filename is ServiceM8's, and ServiceM8
    names every photo `Photo`. */
export function showcaseMediaItem(p: GalleryMediaSource): JobMediaItem {
  return {
    remoteId: p.remoteId,
    name: p.caption || p.name,
    fileType: null,
    kind: "photo",
    origin:
      [p.jobNumber ? `#${p.jobNumber}` : null, p.clientName].filter(Boolean).join(" · ") ||
      null,
    takenAt: p.takenAt,
    url: p.url,
    width: null,
    height: null,
    fromClaim: null,
  };
}

/** Which tab is lit for a filter. A subject lights its family's tab — see the
    note above about the two controls agreeing. Unread lights none: it is not
    a family and pretending otherwise would file it under one. */
export function litFamily(filter: Filter): PhotoFamily | null {
  if (filter.kind === "family") return filter.family;
  if (filter.kind === "subject") return familyOf(filter.subject);
  return null;
}

/* THE CARD IS A DOOR. The grid drew as inert figures for one release — the
   only screen in the app where a photograph did not open. Clicking any card
   lands in the same viewer the job card uses, over the same filmstrip, with
   the star live in its top bar.

   The viewer takes a SNAPSHOT of the shown set: unstarring the photo on the
   stage removes it from the gallery behind the scrim, but the roll under
   your feet must not reshuffle while you are standing on it. The grid
   settles the moment the viewer closes. */

export function ShowcaseView({
  load = listShowcase,
  star = setJobPhotoFavourite,
}: {
  /** Injectable for the harness and tests — the defaults are the real
      server actions, and nothing else ever passes these. */
  load?: () => Promise<ShowcasePhoto[]>;
  star?: (
    jobUuid: string,
    attachmentUuid: string,
    starred: boolean
  ) => Promise<StarPhotoResult>;
} = {}) {
  const [photos, setPhotos] = useState<ShowcasePhoto[] | null>(null);
  /* The stars, held apart from the rows: a toggle flips this set
     optimistically and settles to what the server answers. */
  const [starred, setStarred] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<{ items: ShowcasePhoto[]; index: number } | null>(null);
  const alive = useRef(true);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void load()
      .then((rows) => {
        if (!alive.current) return;
        setPhotos(rows);
        setStarred(new Set(rows.map((r) => r.remoteId)));
      })
      .catch(() => {
        if (alive.current) setPhotos([]);
      });
    // `load` is a stable default or a harness stub — never a re-created prop.
  }, [load]);

  /* Escape closes the viewer. On the job card the sheet's own keydown chain
     does this; the gallery has no sheet, so the listener is its own — and it
     binds only while the viewer is up, so the rest of the time this
     component holds no key at all. */
  const viewOpen = view !== null;
  useEffect(() => {
    if (!viewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setView(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewOpen]);

  /* The filter menu shuts on Escape or on a click that lands anywhere else —
     the two ways anybody expects to dismiss a popover. It is NOT portalled:
     it is absolutely positioned inside the card, so the `.fg` trap that
     catches fixed children never applies to it. */
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [menuOpen]);

  const toggleStar = (remoteId: string) => {
    const jobUuid = photos?.find((p) => p.remoteId === remoteId)?.jobUuid;
    if (!jobUuid) return;
    const on = !starred.has(remoteId);
    const paint = (next: boolean) =>
      setStarred((cur) => {
        const set = new Set(cur);
        if (next) set.add(remoteId);
        else set.delete(remoteId);
        return set;
      });
    paint(on);
    void star(jobUuid, remoteId, on)
      .then((res) => {
        /* The action answers with the TRUTH, not ok/not-ok — the star
           settles back to what the server holds either way. */
        if (alive.current && !res.ok) paint(res.starred);
      })
      .catch(() => {
        if (alive.current) paint(!on);
      });
  };

  if (photos === null)
    return (
      <div className="wb2-show">
        <p className="int-hint">Opening the gallery…</p>
      </div>
    );

  /* An unstar takes effect here the moment it happens — the set below is the
     live truth — but the viewer walks its own snapshot, so the settling is
     only ever seen behind the scrim or after closing. */
  const kept = photos.filter((p) => starred.has(p.remoteId));

  if (kept.length === 0)
    return (
      <div className="wb2-show">
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

  const families = countByFamily(kept);
  const bySubject = countBySubject(kept);
  const unread = kept.filter((p) => !p.read);
  const lit = litFamily(filter);
  const shown = kept.filter((p) =>
    filter.kind === "all"
      ? true
      : filter.kind === "unread"
        ? !p.read
        : filter.kind === "family"
          ? familyOf(p.subject) === filter.family
          : p.subject === filter.subject
  );

  /* The button says what the FINE cut is, when there is one. A family needs
     no saying — its tab is lit two inches to the left, and repeating it here
     would be the same word twice on one row. */
  const fine =
    filter.kind === "subject"
      ? subjectLabel(filter.subject)
      : filter.kind === "unread"
        ? "Not read yet"
        : null;

  const pick = (next: Filter) => {
    setFilter(next);
    setMenuOpen(false);
  };

  return (
    <div className="wb2-show">
      <div className="wb2-jcdhead">
        <b>Gallery</b>
        <em>{kept.length === 1 ? "1 starred photo" : `${kept.length} starred photos`}</em>
      </div>

      <div className="wb2-showbar">
        {/* THE TABS — the broad move. Order is the family list's own, and
            empty families are absent rather than drawn dead, so the row
            never reshuffles under the cursor as photos are read. */}
        <div className="wb2-showfilters" role="tablist" aria-label="What the photo is of">
          <button
            role="tab"
            aria-selected={filter.kind === "all"}
            className={`wb2-showchip${filter.kind === "all" ? " on" : ""}`}
            onClick={() => pick({ kind: "all" })}
          >
            {`Everything · ${kept.length}`}
          </button>
          {families.map(({ family, count }) => (
            <button
              key={family}
              role="tab"
              aria-selected={lit === family}
              className={`wb2-showchip${lit === family ? " on" : ""}`}
              style={{ ["--sc" as string]: FAMILY_COLOUR[family] }}
              onClick={() => pick({ kind: "family", family })}
            >
              <i className="wb2-showdot" aria-hidden />
              {`${FAMILY_LABEL[family]} · ${count}`}
            </button>
          ))}
        </div>

        {/* THE FILTER — the fine move, shut until asked for. */}
        <div className="wb2-showfilt" ref={menuRef}>
          <button
            type="button"
            className={`wb2-showfiltb${fine ? " on" : ""}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Icon name="settings2" size={14} />
            {fine ?? "Filter"}
          </button>
          {fine && (
            <button
              type="button"
              className="wb2-showfiltx"
              onClick={() => pick({ kind: "all" })}
              aria-label={`Clear the ${fine} filter`}
            >
              <Icon name="x" size={12} />
            </button>
          )}

          {menuOpen && (
            <div className="wb2-showmenu" role="menu" aria-label="Filter by subject">
              <button
                role="menuitemradio"
                aria-checked={filter.kind === "all"}
                className={`wb2-showmi${filter.kind === "all" ? " on" : ""}`}
                onClick={() => pick({ kind: "all" })}
              >
                Everything
                <em>{kept.length}</em>
              </button>

              {/* Grouped under the family headings, so the menu teaches the
                  tabs rather than presenting a second, flatter vocabulary. */}
              {families.map(({ family }) => (
                <div key={family} className="wb2-showmgrp">
                  <div className="wb2-showmsect">{FAMILY_LABEL[family]}</div>
                  {bySubject
                    .filter((s) => familyOf(s.subject) === family)
                    .map(({ subject, count }) => (
                      <button
                        key={subject}
                        role="menuitemradio"
                        aria-checked={filter.kind === "subject" && filter.subject === subject}
                        className={`wb2-showmi${filter.kind === "subject" && filter.subject === subject ? " on" : ""}`}
                        onClick={() => pick({ kind: "subject", subject })}
                      >
                        <i
                          className="wb2-showdot"
                          aria-hidden
                          style={{ ["--sc" as string]: subjectColour(subject) }}
                        />
                        {subjectLabel(subject)}
                        <em>{count}</em>
                      </button>
                    ))}
                </div>
              ))}

              {/* Not a subject and never filed as one — a photo nobody has
                  looked at yet has no answer, which is its own way in. */}
              {unread.length > 0 && (
                <div className="wb2-showmgrp">
                  <button
                    role="menuitemradio"
                    aria-checked={filter.kind === "unread"}
                    className={`wb2-showmi${filter.kind === "unread" ? " on" : ""}`}
                    onClick={() => pick({ kind: "unread" })}
                  >
                    Not read yet
                    <em>{unread.length}</em>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Nothing here spends. A starred photo whose job is still being read
          says so, rather than being filed under a subject it hasn't earned —
          the reading happens on the job card and lands on its own clock. */}
      <div className="wb2-showgrid">
        {shown.map((p, i) => (
          <figure key={p.remoteId} className="wb2-showcard">
            <span className="wb2-showimg">
              <button
                type="button"
                className="wb2-showopen"
                onClick={() => {
                  setMenuOpen(false);
                  setView({ items: shown, index: i });
                }}
                aria-label={`Open ${p.caption || p.name}`}
              >
                {p.url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={p.url} alt={p.caption || p.name} loading="lazy" />
                ) : (
                  <i className="wb2-showpending" aria-hidden>
                    <Icon name="cam" size={18} />
                  </i>
                )}
              </button>
              {p.subject && (
                <u className="wb2-showtag" style={{ background: subjectColour(p.subject) }}>
                  {subjectLabel(p.subject)}
                </u>
              )}
              {/* THE STAR IS ON THE PICTURE, LIT (Isaac: "it should also show
                  that these are starred on display"). Everything in here is
                  starred by definition, which is exactly why its absence was
                  odd: the gallery is the one place the mark had gone quiet.
                  It doubles as the way OUT — a photograph you no longer want
                  shown is unstarred where you noticed it, not by finding its
                  job again. Its own button, outside the door: a button
                  cannot contain a button, and a star that opened the viewer
                  would be worse than no star. */}
              <button
                type="button"
                className={`wb2-showstar${starred.has(p.remoteId) ? " on" : ""}`}
                onClick={() => toggleStar(p.remoteId)}
                aria-pressed={starred.has(p.remoteId)}
                aria-label={`Unstar ${p.caption || p.name}`}
                title="Starred — click to take it out of the gallery"
              >
                <Icon name="star" size={13} />
              </button>
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
            </figcaption>
          </figure>
        ))}
      </div>

      {shown.length === 0 && <p className="int-hint">Nothing under that one yet.</p>}

      {/* PORTALLED TO BODY, unlike the job card's viewer, which rides the
          sheet's portal. This tab has no sheet — and the board sits inside
          the page's own stacking context, where a fixed overlay would be
          trapped under the shell (the `.fg` law). */}
      {view &&
        createPortal(
          <JobMediaViewer
            items={view.items.map(showcaseMediaItem)}
            index={view.index}
            favourites={starred}
            onNav={(index) => setView((cur) => (cur ? { ...cur, index } : cur))}
            onStar={toggleStar}
            onClose={() => setView(null)}
          />,
          document.body
        )}
    </div>
  );
}

export type { PhotoSubject };
