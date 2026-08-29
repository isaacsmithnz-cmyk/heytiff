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
import {
  listShowcase,
  readShowcasePhotos,
  type ShowcasePhoto,
} from "@/app/actions/job-photo-favourites";

/* THE SHOWCASE — the photos somebody starred, and what they are OF.

   IT READS THE FAVOURITES AND NOTHING ELSE (Isaac's constraint). This is not
   a browser over the account's 32,000 photographs with a star filter on top;
   it is the starred set, so its size and its cost are the curator's choice.
   That is also what makes reading every picture affordable.

   THE CATEGORIES COME FROM THE PICTURE, not from the job's paperwork — also
   Isaac's call, and the sharper one. A job's category says Install or Service
   Call; it cannot say that this frame is the dataplate, or the ductwork, or
   the fault someone photographed to explain it. Those are what a showcase
   gets searched by.

   THE READER IS A BROWSER LOOP, the same shape the job card's file cacher
   uses: no server-side queue, so this calls again while the outstanding count
   FALLS and stops the moment it doesn't. A reader that keeps being told "6
   left" while reading none would spin forever and spend real money doing it,
   so the falling count is the loop's only permission to continue.

   NOT BADGED AS AI. The strip says what it is doing in the words of the thing
   it produces — "Reading the photos" — because the feature is named after the
   data behind it, never after the machinery. */

type Filter = { kind: "all" } | { kind: "subject"; subject: string } | { kind: "unread" };

const MAX_ROUNDS = 40;

export function ShowcaseView({ manage }: { manage: boolean }) {
  const [photos, setPhotos] = useState<ShowcasePhoto[] | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [note, setNote] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
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

  const unread = (photos ?? []).filter((p) => p.readAt === null && p.url !== null);

  /* THE LOOP, and its brake. `remaining` must fall on every round or this
     stops — the server returning the same number twice means it cannot read
     what is in front of it, and going round again would only cost money. */
  const readAll = async () => {
    if (reading) return;
    setReading(true);
    setNote(null);
    let last = Number.POSITIVE_INFINITY;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await readShowcasePhotos();
      if (!alive.current) return;
      if (res.note) setNote(res.note);
      if (!res.ok || res.read === 0 || res.remaining >= last) break;
      last = res.remaining;
      /* Repaint after every round rather than at the end: a photo that has
         been placed should show its subject while the rest are still being
         looked at. */
      const rows = await listShowcase().catch(() => null);
      if (!alive.current) return;
      if (rows) setPhotos(rows);
      if (res.remaining === 0) break;
    }
    if (alive.current) setReading(false);
  };

  if (photos === null)
    return (
      <div className="wb2-show">
        <p className="int-hint">Opening the showcase…</p>
      </div>
    );

  if (photos.length === 0)
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

  const bySubject = countBySubject(photos);
  const shown = photos.filter((p) =>
    filter.kind === "all"
      ? true
      : filter.kind === "unread"
        ? p.readAt === null
        : p.subject === filter.subject
  );

  return (
    <div className="wb2-show">
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

      {/* THE ONLY PLACE MONEY IS SPENT, and it is behind a button somebody
          presses. Reading happens on demand, never on open: a gallery that
          quietly billed for every photo the moment you looked at it would be
          a surprise on an invoice. */}
      {manage && unread.length > 0 && (
        <div className="wb2-showread">
          {/* `.fg .pbtn` carries no ground of its own — a bare `pbtn` renders as
              plain text (the reset at the top of shell.css strips it). It
              wants a modifier, and `primary` is the honest one here: this is
              the deliberate act of the screen, and the only one that spends. */}
          <button className="pbtn primary" disabled={reading} onClick={() => void readAll()}>
            <Icon name="search" size={15} />
            {reading
              ? "Reading the photos…"
              : unread.length === 1
                ? "Read 1 photo"
                : `Read ${unread.length} photos`}
          </button>
          <em>Tiff looks at each picture and files it by what&apos;s in the frame.</em>
        </div>
      )}
      {note && <p className="int-hint">{note}</p>}

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
