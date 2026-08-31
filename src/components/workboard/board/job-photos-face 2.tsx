"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { JOB_MEDIA_CAP, type JobMediaItem } from "@/lib/workboard/job-media";
import type { JobVisit } from "@/lib/workboard/all-jobs-query";

/* THE PHOTOS FACE — the justified mosaic, grouped by day, into the shared
   viewer.

   TRUE SHAPES: the mirror has always held every photo's width and height and
   nothing ever read them. Each tile keeps its own aspect ratio via the
   flexbox justified-gallery trick — flex-grow AND flex-basis proportional to
   the ratio, so a row of mixed shapes shares its width the way the photos
   deserve; a trailing spacer stops the last row stretching. ServiceM8 sends
   0 for a dimension it doesn't know — those tiles fall back square.

   GROUPED BY UPLOAD DAY, the visit named beside it: on these jobs the two
   nearly always coincide, so the day heading answers "what did they see"
   rather than "what got uploaded". */

/* THE SHOWCASE IS A FILTER, NOT A SECOND PLACE. Starred photos are the same
   photos in the same mosaic on the same days — a separate "Favourites" list
   beside the gallery would be the same pictures twice, and the day headings
   (who was on site) are exactly the context that makes a starred photo worth
   keeping. So the head carries one switch and the grid narrows. */

const dayOf = (naive: string | null): string | null =>
  typeof naive === "string" && naive.length >= 10 ? naive.slice(0, 10) : null;

type DayGroup = { day: string | null; entries: { item: JobMediaItem; index: number }[] };

export function groupPhotoDays(photos: readonly JobMediaItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  photos.forEach((item, index) => {
    const day = dayOf(item.takenAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push({ item, index });
    else groups.push({ day, entries: [{ item, index }] });
  });
  return groups;
}

const BASE = 120; // px of flex-basis per unit of aspect ratio

export function JobPhotosFace({
  photos,
  loading,
  truncated,
  mediaNote,
  visits,
  favourites,
  onOpen,
  onStar,
}: {
  /** Photos AND video — everything shot on site. */
  photos: readonly JobMediaItem[] | null;
  loading: boolean;
  truncated: boolean;
  mediaNote: string | null;
  visits: readonly JobVisit[];
  /** Starred attachment ids — null until the read lands, so a star is drawn
      absent rather than drawn hollow and wrong. */
  favourites: ReadonlySet<string> | null;
  /** By id, not by index: the viewer shows only what it can actually
      display, so a position in THIS list is not a position in that one. */
  onOpen: (remoteId: string) => void;
  onStar: (remoteId: string) => void;
}) {
  const [onlyStarred, setOnlyStarred] = useState(false);
  const crewOf = new Map(visits.map((v) => [v.day, v.crew.map((c) => c.name)]));
  const all = photos ?? [];
  const starred = all.filter((p) => favourites?.has(p.remoteId));
  /* The switch turns itself off rather than emptying the grid: unstarring the
     last photo while filtered would otherwise leave a face saying nothing. */
  const filtered = onlyStarred && starred.length > 0;
  const shown = filtered ? starred : all;
  const days = groupPhotoDays(shown);
  const videos = shown.filter((p) => p.kind === "video").length;
  const stills = shown.length - videos;

  /* "9 photos and 1 video across 3 days" — video is footage from the same
     visit, so it counts beside the stills rather than hiding in the paper. */
  const countLine = () => {
    const parts: string[] = [];
    if (stills) parts.push(stills === 1 ? "1 photo" : `${stills} photos`);
    if (videos) parts.push(videos === 1 ? "1 video" : `${videos} videos`);
    const what = parts.join(" and ");
    return days.length > 1 ? `${what} across ${days.length} days` : what;
  };

  return (
    <div className="wb2-jcph">
      <div className="wb2-jcdhead">
        <b>Photos</b>
        {shown.length > 0 && <em>{countLine()}</em>}
        {starred.length > 0 && (
          <button
            className={`wb2-mfilt${filtered ? " on" : ""}`}
            onClick={() => setOnlyStarred((v) => !v)}
            aria-pressed={filtered}
          >
            <Icon name="star" size={13} />
            {`Starred · ${starred.length}`}
          </button>
        )}
      </div>

      {photos === null || photos.length === 0 ? (
        <p className="int-hint">
          {loading && photos === null ? "Reading the files…" : "No photos on this job."}
        </p>
      ) : (
        days.map((day) => {
          const crew = day.day ? crewOf.get(day.day) : undefined;
          return (
            <div key={day.day ?? "undated"} className="wb2-jcsec">
              <div className="wb2-mday">
                <b>{day.day ? fmtAuWeekdayDayMonth(day.day) : "Undated"}</b>
                <em>
                  {[crew && crew.length > 0 ? `${crew.join(", ")} on site` : null,
                    `${day.entries.length}`]
                    .filter(Boolean)
                    .join(" · ")}
                </em>
              </div>
              <div className="wb2-mosaic">
                {day.entries.map(({ item }) => {
                  const ar =
                    item.width !== null && item.height !== null && item.height > 0
                      ? item.width / item.height
                      : 1;
                  const shape = {
                    aspectRatio: `${ar}`,
                    flexGrow: ar,
                    flexBasis: `${Math.round(ar * BASE)}px`,
                  };
                  const label = [
                    item.name,
                    item.origin ? item.origin.toLowerCase() : null,
                    item.fromClaim ? `filed against invoice #${item.fromClaim}` : null,
                  ]
                    .filter(Boolean)
                    .join(" — ");
                  /* VIDEO SITS WITH THE PHOTOS — it is footage from the
                     same visit, not paperwork. Its bytes stay in ServiceM8
                     by charter, so the tile is a plate that says so rather
                     than a door that lies. AND IT CANNOT BE STARRED: a
                     showcase entry we do not hold the bytes of is a promise
                     of a picture that never comes. */
                  if (item.kind === "video")
                    return (
                      <span
                        key={item.remoteId}
                        className="wb2-mcell"
                        style={shape}
                        title={`${label} — the video stays in ServiceM8`}
                      >
                        <span className="wb2-mtile video">
                          <i className="wb2-mplay" aria-hidden>
                            ▶
                          </i>
                          <u className="wb2-mvid">Video · in ServiceM8</u>
                          {item.fromClaim && <u className="wb2-mfrom">{item.fromClaim}</u>}
                        </span>
                      </span>
                    );
                  /* THE TILE IS THE DOOR AND THE STAR IS ITS OWN CONTROL, so
                     the cell around them is what carries the mosaic's shape:
                     a button cannot contain a button, and a star that opened
                     the viewer instead of starring would be worse than no
                     star at all. */
                  const star = (
                    <button
                      className={`wb2-mstar${favourites?.has(item.remoteId) ? " on" : ""}`}
                      onClick={() => onStar(item.remoteId)}
                      aria-pressed={favourites?.has(item.remoteId) ?? false}
                      aria-label={
                        favourites?.has(item.remoteId)
                          ? `Unstar ${item.name}`
                          : `Star ${item.name}`
                      }
                      title={
                        favourites?.has(item.remoteId)
                          ? "Starred — in the showcase"
                          : "Star this photo for the showcase"
                      }
                    >
                      <Icon name="star" size={13} />
                    </button>
                  );
                  return (
                    <span key={item.remoteId} className="wb2-mcell" style={shape}>
                      {item.url ? (
                        <button
                          className="wb2-mtile"
                          title={label}
                          aria-label={`Open ${item.name}`}
                          onClick={() => onOpen(item.remoteId)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.url} alt={item.name} loading="lazy" />
                          {item.origin === "Marked up" && <u className="wb2-mmark">✎</u>}
                          {item.fromClaim && <u className="wb2-mfrom">{item.fromClaim}</u>}
                        </button>
                      ) : (
                        /* Not cached yet. A tile that says so beats a broken
                           image, and beats hiding a photo that exists — and
                           it can still be starred: the star is what sends
                           for the bytes. */
                        <span className="wb2-mtile pending" title={label}>
                          <Icon name="cam" size={16} />
                        </span>
                      )}
                      {star}
                    </span>
                  );
                })}
                {/* stops the last row stretching its photos to fill */}
                <i className="wb2-mspace" aria-hidden />
              </div>
            </div>
          );
        })
      )}

      {mediaNote && <p className="int-hint">{mediaNote}</p>}
      {truncated && (
        <p className="int-hint">
          Showing the newest {JOB_MEDIA_CAP} of each kind — this job has more in ServiceM8.
        </p>
      )}
    </div>
  );
}
