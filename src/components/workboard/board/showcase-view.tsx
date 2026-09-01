"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import {
  countBySubject,
  subjectColour,
  subjectLabel,
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
   has been read, and search spans all of it. Stars are what you would show
   someone; the bank is what you can find.

   THERE IS NO SEARCH BOX HERE ANY MORE. This tab carried its own field for
   one release, sitting directly under the board's universal search — two
   boxes a hand's width apart, each answering a different question with the
   same face. The bank search now lives in the ONE field the whole Workboard
   already has (see overview-screen), which is also the only way "find a
   photo" works from any side rather than only from this tab. What is left
   here is purely the curation.

   THE CATEGORIES COME FROM THE PICTURE, not from the job's paperwork — also
   Isaac's call, and the sharper one. A job's category says Install or Service
   Call; it cannot say that this frame is the dataplate, or the ductwork, or
   the fault someone photographed to explain it. Those are what the chips
   filter by.

   So this screen spends nothing. It reads `job_photo_readings` through the
   showcase query and draws what is already known. A starred photo whose job
   has not finished reading shows as unread rather than as uncategorised —
   absent, not wrong. */

type Filter = { kind: "all" } | { kind: "subject"; subject: string } | { kind: "unread" };

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

/* THE CARD IS A DOOR NOW. The grid drew as inert figures for one release —
   the only screen in the app where a photograph did not open. Clicking any
   card lands in the same viewer the job card uses, over the same filmstrip,
   with the star live in its top bar.

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
  /* The stars, held apart from the rows: a toggle in the viewer flips this
     set optimistically and settles to what the server answers, while the
     rows themselves stay put until the viewer closes. */
  const [starred, setStarred] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [view, setView] = useState<{ items: ShowcasePhoto[]; index: number } | null>(null);
  const alive = useRef(true);

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

  const bySubject = countBySubject(kept);
  const unread = kept.filter((p) => !p.read);
  const shown = kept.filter((p) =>
    filter.kind === "all"
      ? true
      : filter.kind === "unread"
        ? !p.read
        : p.subject === filter.subject
  );

  return (
    <div className="wb2-show">
      <div className="wb2-jcdhead">
        <b>Gallery</b>
        <em>{kept.length === 1 ? "1 starred photo" : `${kept.length} starred photos`}</em>
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
          {`Everything · ${kept.length}`}
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
        {shown.map((p, i) => (
          <figure key={p.remoteId} className="wb2-showcard">
            <button
              type="button"
              className="wb2-showopen"
              onClick={() => setView({ items: shown, index: i })}
              aria-label={`Open ${p.caption || p.name}`}
            >
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
            </button>
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
