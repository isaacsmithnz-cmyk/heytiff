"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { ALLOWED_TYPES } from "@/lib/documents/files";
import { documentGroupOf, opensInCard, type JobMediaItem } from "@/lib/workboard/job-media";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { andList } from "@/lib/swms/library";
import type { SwmsSummary } from "@/lib/swms/query";
import "@/components/swms/swms.css";

/* THE DOCUMENTS FACE — the job's paper, grouped by what a document IS,
   never by which system made it: Drawings (the Studio's designs — ours),
   Money (invoices, quotes, work orders), From the client (emailed in),
   Video, then the rest. An empty group doesn't render. COMPLIANCE LEADS:
   the SWMS is the one paper HeyTiff writes itself, and the one the crew
   needs before the work starts, so it is filed first. It wears the same row
   as every other document and opens in the same viewer; the head offers to
   create one only while the job has none, because a second press made a
   second SWMS where a revision was meant.

   THE WAYS IN SIT UNDER THE TITLE, the row every face keeps for adding to
   it — the Checklist's form, the Diary's pen. Create SWMS spent a release in
   the title's own line, floating off the count at the far edge. Beside it
   now: an upload, because the paper worth keeping (the certificate, the
   builder's plans) had nowhere to go but ServiceM8. A file dropped anywhere
   on the face lands the same way. Ours live here, never in ServiceM8, so a
   row of ours says who added it and can be taken back off; theirs cannot.

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

/** What the file picker offers — the bucket's own list, so it never offers
    a file the upload would then refuse. */
const ACCEPT = Object.keys(ALLOWED_TYPES).join(",");

function DocRow({ item, onOpen }: { item: JobMediaItem; onOpen: (item: JobMediaItem) => void }) {
  const day = item.takenAt ? fmtAuWeekdayDayMonth(item.takenAt.slice(0, 10)) : null;
  /* One dress for every document — #559's law, kept through the grouping:
     the same row the design list wears, and the meta says only what the
     NAME doesn't already say. Ours says who added it: it is the answer to
     "why isn't this in ServiceM8?". */
  const meta = [
    item.documentId ? (item.addedBy ? `Added by ${item.addedBy}` : "Added in HeyTiff") : null,
    item.origin && !item.name.toLowerCase().includes(item.origin.toLowerCase())
      ? item.origin
      : null,
    item.fromClaim && !item.name.includes(`#${item.fromClaim}`)
      ? `on invoice #${item.fromClaim}`
      : null,
    day,
    !item.url && !item.documentId ? "not brought across yet" : null,
  ]
    .filter(Boolean)
    .join(", ");
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
  /* A PDF opens IN the card — the shared viewer's iframe — and so does an
     image of ours. Anything else with bytes keeps the browser handoff; no
     bytes, no door. */
  if (item.url && opensInCard(item.fileType))
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

/** A row of OURS: the same row, with the one act ServiceM8's never get —
    taking it back off. Two presses, and the second names what it does,
    because the bytes go with the row and nothing brings them back. */
function OurRow({
  item,
  onOpen,
  onRemove,
}: {
  item: JobMediaItem;
  onOpen: (item: JobMediaItem) => void;
  onRemove?: (item: JobMediaItem) => Promise<string | null>;
}) {
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const remove = async () => {
    if (!onRemove) return;
    setRemoving(true);
    setErr(null);
    const why = await onRemove(item);
    /* a row that landed its removal is gone with the next read; one that
       didn't stays, and says why */
    setRemoving(false);
    if (why) {
      setErr(why);
      setAsking(false);
    }
  };
  return (
    <>
      <div className="wb2-docrow">
        <DocRow item={item} onOpen={onOpen} />
        {onRemove &&
          (asking ? (
            <>
              <button type="button" className="pbtn ghost sm" disabled={removing} onClick={() => setAsking(false)}>
                Keep
              </button>
              <button type="button" className="pbtn ghost sm dan" disabled={removing} onClick={() => void remove()}>
                {removing ? "Deleting…" : "Delete file"}
              </button>
            </>
          ) : (
            <button type="button" className="pbtn ghost sm" onClick={() => setAsking(true)}>
              Remove
            </button>
          ))}
      </div>
      {err && <p className="wb2-sherr">{err}</p>}
    </>
  );
}

const GROUPS: { key: "money" | "client" | "files"; label: string }[] = [
  { key: "money", label: "Money" },
  { key: "client", label: "From the client" },
  { key: "files", label: "Files" },
];

/** "1 of 3 signed on, waiting on Dane Whitmore and Kai Lindqvist" */
function signedLine(s: SwmsSummary): string {
  const count = `${s.signed} of ${s.total} signed on`;
  if (s.waitingOn.length === 0) return count;
  const names =
    s.waitingOn.length === 1
      ? s.waitingOn[0]
      : `${s.waitingOn.slice(0, -1).join(", ")} and ${s.waitingOn[s.waitingOn.length - 1]}`;
  return `${count}, waiting on ${names}`;
}

/** "Dane Whitmore raised: no anchor on the rear ridge" */
function issueLine(s: SwmsSummary): string {
  if (s.issues.length === 1) return `${s.issues[0].name} raised: ${s.issues[0].issue}`;
  return `${s.issues.length} issues raised, by ${andList(s.issues.map((i) => i.name))}`;
}

export function JobDocumentsFace({
  documents,
  elsewhere,
  designs,
  swms = null,
  swmsFailed = false,
  canCreateSwms = false,
  swmsClosed = false,
  loading,
  truncated,
  onOpen,
  onUpload,
  onRemove,
  onCreateSwms,
  onOpenSwms,
  onReviseSwms,
}: {
  documents: readonly JobMediaItem[] | null;
  elsewhere: readonly JobMediaItem[] | null;
  /** Absent for a reader without `studio` — the action doesn't fetch it. */
  designs: MirrorJobDetail["designs"];
  /** The job's SWMS at their latest versions; null until the read lands. */
  swms?: readonly SwmsSummary[] | null;
  /** The read failed. Saying so beats an empty Compliance group with a
      Create button — pressing it made a SECOND SWMS on a job that had one. */
  swmsFailed?: boolean;
  /** False until the card knows which job it is. */
  canCreateSwms?: boolean;
  /** ServiceM8 has finished the job: nobody would be asked to sign a new SWMS
      and the bell would never ring, so there is no Create to offer. */
  swmsClosed?: boolean;
  loading: boolean;
  truncated: boolean;
  onOpen: (item: JobMediaItem) => void;
  /** Put one file on the job. Resolves null once it has landed, or with the
      reason it didn't, in words. Absent until the card knows which job it
      is — the upload waits rather than filing somewhere it has to guess. */
  onUpload?: (file: File) => Promise<string | null>;
  /** Take one of OUR files back off the job; the same answer shape. */
  onRemove?: (item: JobMediaItem) => Promise<string | null>;
  onCreateSwms?: () => void;
  onOpenSwms?: (swms: SwmsSummary) => void;
  onReviseSwms?: (versionId: string) => void;
}) {
  const picker = useRef<HTMLInputElement | null>(null);
  /* How far through a batch the upload is — null when none is running. */
  const [sending, setSending] = useState<{ at: number; of: number } | null>(null);
  const [refused, setRefused] = useState<string[]>([]);
  /* A file is being dragged over the face. */
  const [over, setOver] = useState(false);

  const upload = async (files: readonly File[]) => {
    if (!onUpload || files.length === 0 || sending) return;
    const why: string[] = [];
    setRefused([]);
    for (let i = 0; i < files.length; i++) {
      setSending({ at: i + 1, of: files.length });
      const err = await onUpload(files[i]);
      if (err) why.push(files.length === 1 ? err : `${files[i].name}: ${err}`);
    }
    setSending(null);
    setRefused(why);
  };

  /* A FILE DROPPED A FEW PIXELS WIDE WOULD LOSE THE CARD. The browser's own
     answer to a file dropped on a page is to open it in the tab, so a miss
     by a margin would swap the job for the PDF. While the card can take a
     file, a drop anywhere else does nothing instead. */
  useEffect(() => {
    if (!onUpload) return;
    const hold = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", hold);
    window.addEventListener("drop", hold);
    return () => {
      window.removeEventListener("dragover", hold);
      window.removeEventListener("drop", hold);
    };
  }, [onUpload]);

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const dropProps = onUpload
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!over) setOver(true);
        },
        onDragLeave: (e: React.DragEvent) => {
          /* leaving for a child is not leaving */
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        },
        onDrop: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setOver(false);
          void upload(Array.from(e.dataTransfer.files));
        },
      }
    : {};

  const docs = documents ?? [];
  /* Video went where it belongs — the Photos face, with the rest of what
     was shot on site. What is left here is genuinely unshowable. */
  const unshowable = (elsewhere ?? []).length;
  const byGroup = new Map<string, JobMediaItem[]>();
  for (const d of docs) {
    const g = documentGroupOf(d);
    byGroup.set(g, [...(byGroup.get(g) ?? []), d]);
  }
  const statements = swms ?? [];
  const total = docs.length + designs.length + statements.length;

  const offerSwms = !!onCreateSwms && !swmsClosed && swms !== null && statements.length === 0;

  return (
    <div className="wb2-jcdoc" data-over={over ? "" : undefined} {...dropProps}>
      <div className="wb2-jcdhead">
        <b>Documents</b>
        {total > 0 && <em>{total === 1 ? "1 file" : `${total} files`}</em>}
      </div>

      {(onUpload || offerSwms) && (
        <div className="wb2-jcdadd">
          {onUpload && (
            <>
              <button
                type="button"
                className="pbtn ghost"
                disabled={!!sending}
                onClick={() => picker.current?.click()}
              >
                <Icon name="upload" size={15} />
                {sending
                  ? sending.of === 1
                    ? "Uploading…"
                    : `Uploading ${sending.at} of ${sending.of}…`
                  : over
                    ? "Drop to upload"
                    : "Upload a document"}
              </button>
              <input
                ref={picker}
                type="file"
                multiple
                accept={ACCEPT}
                hidden
                aria-label="Choose documents to upload"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  /* cleared now, so choosing the same file again still fires */
                  e.target.value = "";
                  void upload(files);
                }}
              />
            </>
          )}
          {offerSwms && (
            <button type="button" className="pbtn ghost" disabled={!canCreateSwms} onClick={onCreateSwms}>
              <Icon name="shield" size={15} />
              Create SWMS
            </button>
          )}
        </div>
      )}
      {refused.map((why) => (
        <p key={why} className="wb2-sherr">
          {why}
        </p>
      ))}

      {swmsFailed && <p className="int-hint">Couldn&apos;t read this job&apos;s SWMS. Close the card and open it again.</p>}

      {statements.length > 0 && (
        <div className="wb2-jcsec">
          <span className="wb2-sect">{`Compliance — ${statements.length}`}</span>
          {statements.map((s) => (
            <div key={s.swmsId} className="wb2-docrow">
              <button type="button" className="wb2-doc" onClick={() => onOpenSwms?.(s)}>
                <span className="wb2-doc-ic">
                  <Icon name="shield" size={15} />
                </span>
                {/* no version number: someone new to the job never saw version 1 —
                    "Revised" says there was one, and the paper keeps the count */}
                <span className="wb2-doc-b">
                  <b>Safe Work Method Statement</b>
                  <em>{`${s.version > 1 ? "Revised" : "Issued"} ${editedOn(s.issuedAt)}, ${s.responsible} in charge. ${signedLine(s)}`}</em>
                  {/* what someone wrote at sign-on, where the office looks */}
                  {s.issues.length > 0 && <em className="sw-state warn">{issueLine(s)}</em>}
                </span>
                <span className="wb2-doc-go">
                  <Icon name="chevR" size={15} />
                </span>
              </button>
              {/* Sign on only for someone with something to sign here —
                  anyone else would land on a page with nothing to do */}
              {/* what is left for a reader who has already signed is signing
                  somebody else on, and the door should say so */}
              {s.viewerCanSign ? (
                <Link className="pbtn ghost sm" href={`/dashboard/swms/${s.versionId}`}>
                  {s.viewerSigned ? "Sign them on" : "Sign on"}
                </Link>
              ) : (
                /* the row names an issue nobody has answered and, once
                   everyone has signed, gave nothing to press */
                s.issues.length > 0 && (
                  <Link className="pbtn ghost sm" href={`/dashboard/swms/${s.versionId}`}>
                    Open the issue
                  </Link>
                )
              )}
              {onReviseSwms && (
                <button type="button" className="pbtn ghost sm" onClick={() => onReviseSwms(s.versionId)}>
                  Revise
                </button>
              )}
            </div>
          ))}
        </div>
      )}

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
                  {`${d.floorCount} ${d.floorCount === 1 ? "floor" : "floors"}, ` +
                    `${d.systemCount} ${d.systemCount === 1 ? "system" : "systems"}, ` +
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
            {items.map((d) =>
              d.documentId ? (
                <OurRow key={d.remoteId} item={d} onOpen={onOpen} onRemove={onRemove} />
              ) : (
                <DocRow key={d.remoteId} item={d} onOpen={onOpen} />
              )
            )}
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
