"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth, todayInAu } from "@/lib/au-dates";
import { ALLOWED_TYPES } from "@/lib/documents/files";
import { documentGroupOf, opensInCard, type JobMediaItem } from "@/lib/workboard/job-media";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { andList } from "@/lib/swms/library";
import type { SwmsSummary } from "@/lib/swms/query";
import {
  ourDocumentSendKey,
  paperMeta,
  paperSendable,
  paperSendKey,
  paperStateLine,
  theirFileSendKey,
  type JobPaper,
  type PaperChoices,
} from "@/lib/compliance/papers";
import { sendLine, type JobSend, type SendHold, type SendLine } from "@/lib/integrations/sm8-write-plan";
import { ComplianceChooser } from "./compliance-chooser";
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
   gigabytes), so the row says so instead of pretending to play.

   THE BUSINESS'S PAPERS JOIN THE SWMS UNDER COMPLIANCE. Add compliance is
   the third way in: the certificates on the Organisation screen and the
   tickets on the staff cards, put on the job as links to the paper they
   already own (lib/compliance/papers). A paper whose policy has renewed
   since says so, and one press moves it to the renewal.

   AND ANYTHING WITH BYTES CAN BE SENT. For someone who may send, every file
   the face holds carries a tick — ours, theirs and the papers alike — and
   what is ticked is emailed from the card's footer. A row with nothing to
   send (a SWMS is a page, a file not brought across yet) holds the tick's
   place empty, so the names still line up.

   AND ONE OF OURS SAYS WHETHER IT IS IN SERVICEM8, once somebody has sent
   it there from the footer: "In ServiceM8", or on its way, or why it didn't
   go, in the state's colour under its name. ServiceM8's own copy, mirrored
   back by the next sync, never reaches this list: the server leaves every
   file HeyTiff sent off the job's files (lib/integrations/sm8-echo), so a
   file sent is still one row. */

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

/** A line in the state's colour under a row's name — a paper's expiry, a
    file's way to ServiceM8. No tone is the quiet colour. */
function StateLine({ line }: { line: SendLine }) {
  return <em className={line.tone ? `sw-state ${line.tone}` : undefined}>{line.word}</em>;
}

function DocRow({
  item,
  onOpen,
  state = null,
}: {
  item: JobMediaItem;
  onOpen: (item: JobMediaItem) => void;
  /** Where this file stands with ServiceM8, for one of ours. */
  state?: SendLine | null;
}) {
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
        {state && <StateLine line={state} />}
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
  pick,
  state = null,
  onOpen,
  onRemove,
}: {
  item: JobMediaItem;
  /** The row's tick, when the face is sending. */
  pick?: React.ReactNode;
  state?: SendLine | null;
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
        {pick}
        <DocRow item={item} onOpen={onOpen} state={state} />
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

/** A paper the business put on the job — the same row, with its state said
    out loud and the two acts a link has: taking it off (the paper itself
    stays, so the confirm says "Remove from job", not "Delete file"), and,
    once the policy has renewed, moving it to the renewal. */
function PaperRow({
  paper,
  today,
  pick,
  sm8 = null,
  onOpen,
  onRemove,
  onRenew,
}: {
  paper: JobPaper;
  today: string;
  pick?: React.ReactNode;
  /** Where the paper's files stand with ServiceM8. */
  sm8?: SendLine | null;
  onOpen?: (paper: JobPaper) => void;
  onRemove?: (paper: JobPaper) => Promise<string | null>;
  onRenew?: (paper: JobPaper) => Promise<string | null>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"remove" | "renew" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const line = paperStateLine(paper, today);
  /* a ticket's scan opens for `team` and its holder; for anyone else the row
     says it is here and when it runs to, without a door */
  const opens = !!onOpen && paper.files.some((f) => f.url);

  const run = async (what: "remove" | "renew", act: (p: JobPaper) => Promise<string | null>) => {
    setBusy(what);
    setErr(null);
    const why = await act(paper).catch(() => "That didn't work. Try again.");
    /* a row that landed its change is redrawn by the next read; one that
       didn't stays, and says why */
    setBusy(null);
    setAsking(false);
    if (why) setErr(why);
  };

  const inner = (
    <>
      <span className="wb2-doc-ic">
        <Icon name={paper.kind === "company" ? "shield" : "passport"} size={15} />
      </span>
      <span className="wb2-doc-b">
        <b>{paper.name}</b>
        <em>{paperMeta(paper)}</em>
        {line && <StateLine line={line} />}
        {sm8 && <StateLine line={sm8} />}
      </span>
      {opens && (
        <span className="wb2-doc-go">
          <Icon name="chevR" size={15} />
        </span>
      )}
    </>
  );

  return (
    <>
      <div className="wb2-docrow">
        {pick}
        {opens ? (
          <button type="button" className="wb2-doc" onClick={() => onOpen?.(paper)}>
            {inner}
          </button>
        ) : (
          <span className="wb2-doc">{inner}</span>
        )}
        {paper.manage && paper.renewed && onRenew && !asking && (
          <button
            type="button"
            className="pbtn ghost sm"
            disabled={!!busy}
            onClick={() => void run("renew", onRenew)}
          >
            {busy === "renew" ? "Switching…" : "Use renewal"}
          </button>
        )}
        {paper.manage &&
          onRemove &&
          (asking ? (
            <>
              <button type="button" className="pbtn ghost sm" disabled={!!busy} onClick={() => setAsking(false)}>
                Keep
              </button>
              <button
                type="button"
                className="pbtn ghost sm dan"
                disabled={!!busy}
                onClick={() => void run("remove", onRemove)}
              >
                {busy === "remove" ? "Removing…" : "Remove from job"}
              </button>
            </>
          ) : (
            <button type="button" className="pbtn ghost sm" disabled={!!busy} onClick={() => setAsking(true)}>
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
  papers = null,
  papersFailed = false,
  mayAdd = { company: false, staff: false },
  today,
  picked,
  onPick,
  onLoadChoices,
  onAddPapers,
  onOpenPaper,
  onRemovePaper,
  onRenewPaper,
  sends = null,
  sendHold = null,
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
  /** The business's papers on this job; null until the read lands. */
  papers?: readonly JobPaper[] | null;
  /** The read failed — said, rather than an empty group that looks true. */
  papersFailed?: boolean;
  /** Which sides of Add compliance this viewer may add. */
  mayAdd?: { company: boolean; staff: boolean };
  /** yyyy-mm-dd — what "expires in 2 weeks" counts from. */
  today?: string;
  /** What is ticked to send. Absent for someone who may not send, and then
      no row carries a tick at all. */
  picked?: ReadonlySet<string>;
  onPick?: (key: string, on: boolean) => void;
  /** Absent until the card knows which job it is. */
  onLoadChoices?: () => Promise<PaperChoices | null>;
  /** Put ticked papers on the job; null once they are on, or the reason. */
  onAddPapers?: (keys: string[]) => Promise<string | null>;
  onOpenPaper?: (paper: JobPaper) => void;
  onRemovePaper?: (paper: JobPaper) => Promise<string | null>;
  onRenewPaper?: (paper: JobPaper) => Promise<string | null>;
  /** What has been sent to ServiceM8 from this job, by file. */
  sends?: readonly JobSend[] | null;
  /** What is holding the files waiting to go: a pause, or a reconnect. */
  sendHold?: SendHold;
}) {
  const day = today ?? todayInAu();
  /* Add compliance, open under the ways in */
  const [choosing, setChoosing] = useState(false);
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
  const ours = papers ?? [];
  const total = docs.length + designs.length + statements.length + ours.length;

  const offerSwms = !!onCreateSwms && !swmsClosed && swms !== null && statements.length === 0;
  const offerPapers = !!onLoadChoices && !!onAddPapers && (mayAdd.company || mayAdd.staff);

  /* THE TICK A ROW CARRIES while the face is sending: a box for a file with
     bytes to send, and for anything else an empty box-sized gap, so a column
     of names never jumps. No tick at all for someone who may not send. */
  const pickOf = (key: string | null, name: string) => {
    if (!onPick) return undefined;
    if (!key) return <span className="wb2-docpick" aria-hidden="true" />;
    return (
      <label className="wb2-docpick">
        <input
          type="checkbox"
          checked={!!picked?.has(key)}
          onChange={(e) => onPick(key, e.target.checked)}
          aria-label={`Select ${name}`}
        />
      </label>
    );
  };

  return (
    <div className="wb2-jcdoc" data-over={over ? "" : undefined} {...dropProps}>
      <div className="wb2-jcdhead">
        <b>Documents</b>
        {total > 0 && <em>{total === 1 ? "1 file" : `${total} files`}</em>}
      </div>

      {(onUpload || offerSwms || offerPapers) && (
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
          {offerPapers && (
            <button
              type="button"
              className="pbtn ghost"
              aria-expanded={choosing}
              onClick={() => setChoosing((open) => !open)}
            >
              <Icon name="plus" size={15} />
              Add compliance
            </button>
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

      {choosing && offerPapers && (
        <ComplianceChooser
          today={day}
          onLoad={onLoadChoices}
          onAdd={onAddPapers}
          onClose={() => setChoosing(false)}
        />
      )}

      {swmsFailed && <p className="int-hint">Couldn&apos;t read this job&apos;s SWMS. Close the card and open it again.</p>}
      {papersFailed && (
        <p className="int-hint">Couldn&apos;t read this job&apos;s licences and insurance. Close the card and open it again.</p>
      )}

      {statements.length + ours.length > 0 && (
        <div className="wb2-jcsec">
          <span className="wb2-sect">{`Compliance — ${statements.length + ours.length}`}</span>
          {statements.map((s) => (
            <div key={s.swmsId} className="wb2-docrow">
              {pickOf(null, "Safe Work Method Statement")}
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
          {ours.map((p) => (
            <PaperRow
              key={p.id}
              paper={p}
              today={day}
              pick={pickOf(
                paperSendable(p) ? paperSendKey(p.id) : null,
                p.person ? `${p.name}, ${p.person}` : p.name
              )}
              sm8={sends ? sendLine(sends, p.files.map((f) => f.id), sendHold) : null}
              onOpen={onOpenPaper}
              onRemove={onRemovePaper}
              onRenew={onRenewPaper}
            />
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
                <OurRow
                  key={d.remoteId}
                  item={d}
                  pick={pickOf(d.url ? ourDocumentSendKey(d.documentId) : null, d.name)}
                  state={sends ? sendLine(sends, [d.documentId], sendHold) : null}
                  onOpen={onOpen}
                  onRemove={onRemove}
                />
              ) : onPick ? (
                /* theirs, with a tick when there are bytes here to send */
                <div key={d.remoteId} className="wb2-docrow">
                  {pickOf(d.url ? theirFileSendKey(d.remoteId) : null, d.name)}
                  <DocRow item={d} onOpen={onOpen} />
                </div>
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
