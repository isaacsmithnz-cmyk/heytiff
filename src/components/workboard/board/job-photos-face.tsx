"use client";

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
  onOpen,
}: {
  /** Photos AND video — everything shot on site. */
  photos: readonly JobMediaItem[] | null;
  loading: boolean;
  truncated: boolean;
  mediaNote: string | null;
  visits: readonly JobVisit[];
  /** By id, not by index: the viewer shows only what it can actually
      display, so a position in THIS list is not a position in that one. */
  onOpen: (remoteId: string) => void;
}) {
  const crewOf = new Map(visits.map((v) => [v.day, v.crew.map((c) => c.name)]));
  const days = groupPhotoDays(photos ?? []);
  const videos = (photos ?? []).filter((p) => p.kind === "video").length;
  const stills = (photos ?? []).length - videos;

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
        {photos && photos.length > 0 && <em>{countLine()}</em>}
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
                     than a door that lies. */
                  if (item.kind === "video")
                    return (
                      <span
                        key={item.remoteId}
                        className="wb2-mtile video"
                        style={shape}
                        title={`${label} — the video stays in ServiceM8`}
                      >
                        <i className="wb2-mplay" aria-hidden>
                          ▶
                        </i>
                        <u className="wb2-mvid">Video · in ServiceM8</u>
                        {item.fromClaim && <u className="wb2-mfrom">{item.fromClaim}</u>}
                      </span>
                    );
                  return item.url ? (
                    <button
                      key={item.remoteId}
                      className="wb2-mtile"
                      style={shape}
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
                       image, and beats hiding a photo that exists. */
                    <span key={item.remoteId} className="wb2-mtile pending" style={shape} title={label}>
                      <Icon name="cam" size={16} />
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
