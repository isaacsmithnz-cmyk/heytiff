"use client";

import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { documentGroupOf, type JobMediaItem } from "@/lib/workboard/job-media";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";

/* THE DOCUMENTS FACE — the job's paper, grouped by what a document IS,
   never by which system made it: Drawings (the Studio's designs — ours),
   Money (invoices, quotes, work orders), From the client (emailed in),
   Video, then the rest. An empty group doesn't render; Compliance joins
   the day HeyTiff generates its first document worth the name.

   A PDF opens IN THE CARD, in the shared viewer's iframe — today every
   file was a new browser tab that lost the job. Files whose bytes aren't
   cached yet are named without a door. Videos are finally NAMED — their
   rows were loaded and thrown away for a bare count — but their bytes stay
   in ServiceM8 by charter (a job's worth of mp4 against a bucket sized in
   gigabytes), so the row says so instead of pretending to play. */

const editedOn = (iso: string): string => {
  const d = new Date(iso);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return fmtAuWeekdayDayMonth(local);
};

const isPdf = (item: JobMediaItem): boolean =>
  (item.fileType ?? "").toLowerCase().endsWith("pdf");

function DocRow({ item, onOpen }: { item: JobMediaItem; onOpen: (item: JobMediaItem) => void }) {
  const day = item.takenAt ? fmtAuWeekdayDayMonth(item.takenAt.slice(0, 10)) : null;
  /* One dress for every document — #559's law, kept through the grouping:
     the same row the design list wears, and the meta says only what the
     NAME doesn't already say. */
  const meta = [
    item.origin && !item.name.toLowerCase().includes(item.origin.toLowerCase())
      ? item.origin
      : null,
    item.fromClaim && !item.name.includes(`#${item.fromClaim}`)
      ? `on invoice #${item.fromClaim}`
      : null,
    day,
    !item.url ? "not brought across yet" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const inner = (
    <>
      <span className="wb2-doc-ic">
        <Icon name="file" size={15} />
      </span>
      <span className="wb2-doc-b">
        <b>{item.name}</b>
        {meta && <em>{meta}</em>}
      </span>
      {item.url && (
        <span className="wb2-doc-go">
          <Icon name="chevR" size={15} />
        </span>
      )}
    </>
  );
  /* A PDF opens IN the card — the shared viewer's iframe. Anything else
     with bytes keeps the browser handoff; no bytes, no door. */
  if (item.url && isPdf(item))
    return (
      <button className="wb2-doc" onClick={() => onOpen(item)}>
        {inner}
      </button>
    );
  if (item.url)
    return (
      <a className="wb2-doc" href={item.url} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  return <span className="wb2-doc">{inner}</span>;
}

const GROUPS: { key: "money" | "client" | "files"; label: string }[] = [
  { key: "money", label: "Money" },
  { key: "client", label: "From the client" },
  { key: "files", label: "Files" },
];

export function JobDocumentsFace({
  documents,
  elsewhere,
  designs,
  loading,
  truncated,
  onOpen,
}: {
  documents: readonly JobMediaItem[] | null;
  elsewhere: readonly JobMediaItem[] | null;
  /** Absent for a reader without `studio` — the action doesn't fetch it. */
  designs: MirrorJobDetail["designs"];
  loading: boolean;
  truncated: boolean;
  onOpen: (item: JobMediaItem) => void;
}) {
  const docs = documents ?? [];
  /* Video went where it belongs — the Photos face, with the rest of what
     was shot on site. What is left here is genuinely unshowable. */
  const unshowable = (elsewhere ?? []).length;
  const byGroup = new Map<string, JobMediaItem[]>();
  for (const d of docs) {
    const g = documentGroupOf(d);
    byGroup.set(g, [...(byGroup.get(g) ?? []), d]);
  }
  const total = docs.length + designs.length;

  return (
    <div className="wb2-jcdoc">
      <div className="wb2-jcdhead">
        <b>Documents</b>
        {total > 0 && <em>{total === 1 ? "1 file" : `${total} files`}</em>}
      </div>

      {designs.length > 0 && (
        <div className="wb2-jcsec">
          <span className="wb2-sect">
            {designs.length === 1
              ? "Drawings — designed in the Studio"
              : `Drawings — ${designs.length} Studio options`}
          </span>
          {designs.map((d) => (
            <Link
              key={d.id}
              className="wb2-dsgn"
              href={`/dashboard/studio?design=${encodeURIComponent(d.id)}`}
            >
              <span className="wb2-dsgn-ic">
                <Icon name={d.mode === "plan" ? "file" : "square"} size={15} />
              </span>
              <span className="wb2-dsgn-b">
                <b>{d.name}</b>
                <em>
                  {`${d.floorCount} ${d.floorCount === 1 ? "floor" : "floors"} · ` +
                    `${d.systemCount} ${d.systemCount === 1 ? "system" : "systems"} · ` +
                    `edited ${editedOn(d.updatedAt)}`}
                </em>
              </span>
              {/* its own wrapper because <Icon> renders <span><svg/></span> */}
              <span className="wb2-dsgn-go">
                <Icon name="chevR" size={15} />
              </span>
            </Link>
          ))}
        </div>
      )}

      {GROUPS.map(({ key, label }) => {
        const items = byGroup.get(key) ?? [];
        if (items.length === 0) return null;
        return (
          <div key={key} className="wb2-jcsec">
            <span className="wb2-sect">{`${label} — ${items.length}`}</span>
            {items.map((d) => (
              <DocRow key={d.remoteId} item={d} onOpen={onOpen} />
            ))}
          </div>
        );
      })}

      {total === 0 && (
        <p className="int-hint">
          {loading && documents === null ? "Reading the files…" : "No documents on this job."}
        </p>
      )}

      {unshowable > 0 && (
        <p className="int-hint">
          {unshowable === 1
            ? "1 file stays in ServiceM8"
            : `${unshowable} files stay in ServiceM8`}{" "}
          — file types this screen can&apos;t show.
        </p>
      )}
      {truncated && (
        <p className="int-hint">
          Showing the newest of each kind — this job has more in ServiceM8.
        </p>
      )}
    </div>
  );
}
