"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Row, RowList } from "@/components/parts/row";
import { StateWord, type Tone } from "@/components/parts/state";
import { Empty, Loading, Wrong } from "@/components/parts/states";
import { Tick } from "@/components/parts/tick";
import { Icon } from "@/components/shell/icon";
import { auDayOf, fmtAuWeekdayDayMonth, todayInAu } from "@/lib/au-dates";
import { ALLOWED_TYPES } from "@/lib/documents/files";
import { documentGroupOf, opensInCard, type JobMediaItem } from "@/lib/workboard/job-media";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { andList } from "@/lib/swms/library";
import { designHref } from "@/lib/shell/links";
import type { SwmsSummary } from "@/lib/swms/query";
import type { CertSummary } from "@/lib/certs/query";
import {
  ourDocumentSendKey,
  paperRowLine,
  paperRowName,
  paperSendable,
  paperSendKey,
  paperStateLine,
  theirFileSendKey,
  type JobPaper,
  type PaperChoices,
} from "@/lib/compliance/papers";
import { sendLine, type JobSend, type SendHold, type SendLine } from "@/lib/integrations/sm8-write-plan";
import { ComplianceChooser } from "./compliance-chooser";
import { designRowLine } from "./job-design-face";
import { StateLine } from "./state-line";

/* A JOB'S DOCUMENTS (v2; the mock of 25 October 2026, frame 6). One heading,
   no count under it, and one blue Add, whose white menu holds the ways in:
   Upload a file, Licences and insurance, SWMS, Certificate, each only where
   the old buttons were offered. A file dropped anywhere on the section lands
   as Upload does.

   THE PAPER IS GROUPED BY WHAT IT IS, never by which system made it:
   Drawings (the Studio's designs), From the client (emailed in), Files,
   then Compliance (Isaac, 2 October: "compliance is supposed to sit
   underneath files"): the SWMS, the certificate, the business's licences
   and insurance and ServiceM8's own papers known by their names. A group
   with nothing in it doesn't draw. Quotes, invoices and work orders are
   not here: "Stays as quotes. We don't need a money section in the
   documents" (25 October). They are on Quote and on their claim.

   EVERY ROW IS A V2 ROW (rule 39): a tick where this viewer may send it, the
   name, a grey line of facts, and one thing on the right, a state word or a
   button. Pressing it opens the file in the viewer, whose head now carries
   what the rows used to offer beside the name (Remove, Revise, Reissue, Use
   renewal, Delete). A file the viewer can't show still goes to the
   browser; a file with no bytes here has no door.

   WHAT IS TICKED IS SENT from the bar at the page's foot (documents-send).
   A row with nothing to send (a SWMS is a page, a file not brought across
   yet) holds the tick's place empty, so the names still line up.

   ONE OF OURS SAYS WHETHER IT IS IN SERVICEM8 once somebody has sent it
   there: "In ServiceM8", on its way, or why it didn't go. ServiceM8's own
   copy, mirrored back by the next sync, never reaches this list: the server
   leaves every file HeyTiff sent off the job's files (lib/integrations/
   sm8-echo), so a file sent is still one row. */

/* An instant's AU day. The browser's own getters read the UTC date on the
   server's render, and the yard's day on the client's. */
const editedOn = (iso: string): string => fmtAuWeekdayDayMonth(auDayOf(iso));

/** What the file picker offers — the bucket's own list, so it never offers
    a file the upload would then refuse. */
const ACCEPT = Object.keys(ALLOWED_TYPES).join(",");

const TONE: Record<"ok" | "warn" | "bad", Tone> = { ok: "good", warn: "look", bad: "wrong" };
const RANK: Record<Tone, number> = { wrong: 3, look: 2, good: 1, info: 0 };

/** A state as one word on a row's right, and what is left of its sentence
    for the grey line: "Not sent to ServiceM8. ServiceM8 refused the file."
    is the word "Not sent to ServiceM8" and the reason. */
type RowState = { word: string; tone: Tone; more: string | null };
function rowState(line: SendLine | { word: string; tone: "ok" | "warn" | "bad" | null } | null): RowState | null {
  if (!line) return null;
  const at = line.word.indexOf(". ");
  const word = (at < 0 ? line.word : line.word.slice(0, at)).replace(/\.$/, "");
  const more = at < 0 ? null : line.word.slice(at + 2).trim() || null;
  return { word, tone: line.tone ? TONE[line.tone] : "info", more };
}
/** The one state a row says: the worst of what it has to say. */
const worst = (...states: (RowState | null)[]): RowState | null =>
  states.reduce<RowState | null>((w, s) => (s && (!w || RANK[s.tone] > RANK[w.tone]) ? s : w), null);

/** "1 of 3 signed on, waiting on Dane Whitmore and Kai Lindqvist" */
function signedLine(s: SwmsSummary): string {
  const count = `${s.signed} of ${s.total} signed on`;
  if (s.waitingOn.length === 0) return count;
  return `${count}, waiting on ${andList(s.waitingOn)}`;
}

/** "Dane Whitmore raised: no anchor on the rear ridge" */
function issueLine(s: SwmsSummary): string {
  if (s.issues.length === 1) return `${s.issues[0].name} raised: ${s.issues[0].issue}`;
  return `${s.issues.length} issues raised, by ${andList(s.issues.map((i) => i.name))}`;
}

/** A document's grey line: who added one of ours (the answer to "why isn't
    this in ServiceM8?"), where one of theirs came from, and when. */
function docLine(item: JobMediaItem): string {
  const day = item.takenAt ? fmtAuWeekdayDayMonth(item.takenAt.slice(0, 10)) : null;
  return [
    item.documentId ? (item.addedBy ? `Added by ${item.addedBy}` : "Added in HeyTiff") : null,
    item.origin && !item.name.toLowerCase().includes(item.origin.toLowerCase()) ? item.origin : null,
    item.fromClaim && !item.name.includes(`#${item.fromClaim}`) ? `on invoice #${item.fromClaim}` : null,
    day,
  ]
    .filter(Boolean)
    .join(", ");
}

/** The old document row, kept for the quote's rail (quote-rail), which
    still lists ServiceM8's quote papers in it. The Documents section draws
    the v2 Row instead. */
export function DocRow({
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

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="jdoc-group" aria-label={heading}>
      <h3 className="jdoc-gh">{heading}</h3>
      <RowList label={heading}>{children}</RowList>
    </section>
  );
}

/** The right of a row: a state word, or one button. */
const endOf = (state: RowState | null, button?: ReactNode): ReactNode =>
  button ?? (state ? <StateWord tone={state.tone}>{state.word}</StateWord> : undefined);

/** The grey line, with the rest of the state's sentence after it. */
const lineOf = (facts: string, state: RowState | null): string =>
  [facts, state?.more].filter(Boolean).join(". ");

export function JobDocumentsFace({
  documents,
  elsewhere,
  designs,
  swms = null,
  swmsFailed = false,
  canCreateSwms = false,
  swmsClosed = false,
  loading,
  onOpen,
  onUpload,
  onCreateSwms,
  onOpenSwms,
  certificates = null,
  certificatesFailed = false,
  onCreateCertificate,
  onOpenCertificate,
  papers = null,
  papersFailed = false,
  mayAdd = { company: false, staff: false },
  today,
  picked,
  onPick,
  onLoadChoices,
  onAddPapers,
  onOpenPaper,
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
      SWMS in Add — pressing it made a SECOND SWMS on a job that had one. */
  swmsFailed?: boolean;
  /** False until the page knows which job it is. */
  canCreateSwms?: boolean;
  /** ServiceM8 has finished the job: nobody would be asked to sign a new SWMS
      and the bell would never ring, so Add offers none. */
  swmsClosed?: boolean;
  loading: boolean;
  /** Open one of the job's files in the viewer. */
  onOpen: (item: JobMediaItem) => void;
  /** Put one file on the job. Resolves null once it has landed, or with the
      reason it didn't, in words. Absent until the page knows which job it
      is — the upload waits rather than filing somewhere it has to guess. */
  onUpload?: (file: File) => Promise<string | null>;
  onCreateSwms?: () => void;
  onOpenSwms?: (swms: SwmsSummary) => void;
  /** The job's certificates at their latest versions; null until the read lands. */
  certificates?: readonly CertSummary[] | null;
  /** The read failed — said, rather than a Certificate in Add that may make a second one. */
  certificatesFailed?: boolean;
  /** Absent until the page knows which job it is. */
  onCreateCertificate?: () => void;
  onOpenCertificate?: (cert: CertSummary) => void;
  /** The business's papers on this job; null until the read lands. */
  papers?: readonly JobPaper[] | null;
  /** The read failed — said, rather than an empty group that looks true. */
  papersFailed?: boolean;
  /** Which sides of Licences and insurance this viewer may add. */
  mayAdd?: { company: boolean; staff: boolean };
  /** yyyy-mm-dd — what "expires in 2 weeks" counts from. */
  today?: string;
  /** What is ticked to send. Absent for someone who may not send, and then
      no row carries a tick at all. */
  picked?: ReadonlySet<string>;
  onPick?: (key: string, on: boolean) => void;
  /** Absent until the page knows which job it is. */
  onLoadChoices?: () => Promise<PaperChoices | null>;
  /** Put ticked papers on the job; null once they are on, or the reason. */
  onAddPapers?: (keys: string[]) => Promise<string | null>;
  onOpenPaper?: (paper: JobPaper) => void;
  /** What has been sent to ServiceM8 from this job, by file. */
  sends?: readonly JobSend[] | null;
  /** What is holding the files waiting to go: a pause, or a reconnect. */
  sendHold?: SendHold;
}) {
  const day = today ?? todayInAu();
  /* Licences and insurance, open over the page */
  const [choosing, setChoosing] = useState(false);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  /* How far through a batch the upload is — null when none is running. */
  const [sending, setSending] = useState<{ at: number; of: number } | null>(null);
  const [refused, setRefused] = useState<string[]>([]);
  /* A file is being dragged over the section. */
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

  /* A FILE DROPPED A FEW PIXELS WIDE WOULD LOSE THE PAGE. The browser's own
     answer to a file dropped on a page is to open it in the tab, so a miss
     by a margin would swap the job for the PDF. While the section can take
     a file, a drop anywhere else does nothing instead. */
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
  /* What is genuinely unshowable here stays in ServiceM8; video went to
     Photos, with the rest of what was shot on site. */
  const unshowable = (elsewhere ?? []).length;
  const byGroup = new Map<string, JobMediaItem[]>();
  for (const d of docs) {
    const g = documentGroupOf(d);
    byGroup.set(g, [...(byGroup.get(g) ?? []), d]);
  }
  const statements = swms ?? [];
  const certs = certificates ?? [];
  const ours = papers ?? [];
  /* ServiceM8's own insurance and licence papers, known by their names */
  const attachedPapers = byGroup.get("compliance") ?? [];
  const client = byGroup.get("client") ?? [];
  const files = byGroup.get("files") ?? [];
  const compliance = statements.length + certs.length + ours.length + attachedPapers.length;
  const total = designs.length + client.length + files.length + compliance;

  const offerSwms = !!onCreateSwms && !swmsClosed && swms !== null && statements.length === 0;
  /* one per job: a later one is a reissue of the first */
  const offerCertificate = !!onCreateCertificate && certificates !== null && certs.length === 0;
  const offerPapers = !!onLoadChoices && !!onAddPapers && (mayAdd.company || mayAdd.staff);

  const addItems: MenuItem[] = [
    ...(onUpload ? [{ key: "upload", label: "Upload a file", disabled: !!sending }] : []),
    ...(offerPapers ? [{ key: "papers", label: "Licences and insurance" }] : []),
    ...(offerSwms ? [{ key: "swms", label: "SWMS", disabled: !canCreateSwms }] : []),
    ...(offerCertificate ? [{ key: "certificate", label: "Certificate" }] : []),
  ];
  const addPick = (key: string) => {
    setAdding(false);
    if (key === "upload") picker.current?.click();
    else if (key === "papers") setChoosing(true);
    else if (key === "swms") onCreateSwms?.();
    else if (key === "certificate") onCreateCertificate?.();
  };

  /* THE TICK A ROW CARRIES while the viewer may send: a box for a file with
     bytes to send, and for anything else an empty box-sized gap, so a column
     of names never jumps. No tick at all for someone who may not send. */
  const pickOf = (key: string | null, name: string): ReactNode => {
    if (!onPick) return undefined;
    if (!key) return <span className="jdoc-tick" aria-hidden="true" />;
    return (
      <Tick
        className="jdoc-tick"
        checked={!!picked?.has(key)}
        onChange={(on) => onPick(key, on)}
        label={<span className="sr-only">{`Select ${name}`}</span>}
      />
    );
  };

  /** One document's row: a tick when there are bytes here to send, and the
      viewer, the browser or nothing as its door. */
  const docRowOf = (d: JobMediaItem) => {
    const sendKey = d.url ? (d.documentId ? ourDocumentSendKey(d.documentId) : theirFileSendKey(d.remoteId)) : null;
    const state =
      d.documentId && sends
        ? rowState(sendLine(sends, [d.documentId], sendHold))
        : !d.url && !d.documentId
          ? { word: "Not brought across yet", tone: "info" as const, more: null }
          : null;
    const url = d.url;
    const open = url
      ? opensInCard(d.fileType)
        ? () => onOpen(d)
        : () => void window.open(url, "_blank", "noopener,noreferrer")
      : undefined;
    return (
      <Row
        key={d.remoteId}
        lead={pickOf(sendKey, d.name)}
        name={d.name}
        line={lineOf(docLine(d), state) || undefined}
        end={endOf(state)}
        onClick={open}
      />
    );
  };

  const swmsRowOf = (s: SwmsSummary) => {
    /* no version number: someone new to the job never saw version 1 —
       "Revised" says there was one, and the paper keeps the count */
    const facts = `${s.version > 1 ? "Revised" : "Issued"} ${editedOn(s.issuedAt)}, ${s.responsible} in charge, ${signedLine(s)}`;
    /* Sign on only for someone with something to sign here; what is left for
       a reader who has already signed is signing somebody else on, and the
       door says so. Once everyone has signed, an issue nobody answered is
       the door. */
    const door = s.viewerCanSign ? (
      <Button size={32} href={`/dashboard/swms/${s.versionId}`}>
        {s.viewerSigned ? "Sign them on" : "Sign on"}
      </Button>
    ) : s.issues.length > 0 ? (
      <Button size={32} href={`/dashboard/swms/${s.versionId}`}>
        Open the issue
      </Button>
    ) : undefined;
    return (
      <Row
        key={s.swmsId}
        lead={pickOf(null, "Safe Work Method Statement")}
        name="Safe Work Method Statement"
        line={
          s.issues.length > 0 ? (
            <>
              {`${facts}. `}
              {/* what someone wrote at sign-on, where the office looks */}
              <span className="jdoc-look">{issueLine(s)}</span>
            </>
          ) : (
            facts
          )
        }
        end={endOf(null, door)}
        onClick={onOpenSwms ? () => onOpenSwms(s) : undefined}
      />
    );
  };

  const certRowOf = (c: CertSummary) => {
    const state = c.documentId && sends ? rowState(sendLine(sends, [c.documentId], sendHold)) : null;
    return (
      <Row
        key={c.certificateId}
        lead={pickOf(c.documentId ? ourDocumentSendKey(c.documentId) : null, c.title)}
        name={c.title}
        line={lineOf(`${c.version > 1 ? "Reissued" : "Issued"} ${editedOn(c.issuedAt)}, signed by ${c.issuedBy}`, state)}
        end={endOf(state)}
        onClick={onOpenCertificate ? () => onOpenCertificate(c) : undefined}
      />
    );
  };

  const paperRowOf = (p: JobPaper) => {
    /* its own state (expired, renewed, running out) and where its files
       stand with ServiceM8: the row says the worse of the two */
    const own = paperStateLine(p, day);
    const sm8 = sends ? rowState(sendLine(sends, p.files.map((f) => f.id), sendHold)) : null;
    const state = worst(own ? { word: own.word, tone: TONE[own.tone], more: null } : null, sm8);
    /* a ticket's scan opens for `team` and its holder; for anyone else the
       row says it is here and when it runs to, without a door */
    const opens = !!onOpenPaper && p.files.some((f) => f.url);
    const name = paperRowName(p);
    return (
      <Row
        key={p.id}
        lead={pickOf(paperSendable(p) ? paperSendKey(p.id) : null, name)}
        name={name}
        line={lineOf(paperRowLine(p), state) || undefined}
        end={endOf(state)}
        onClick={opens ? () => onOpenPaper?.(p) : undefined}
      />
    );
  };

  const failed = [
    swmsFailed ? "SWMS" : null,
    certificatesFailed ? "certificates" : null,
    papersFailed ? "licences and insurance" : null,
  ].filter((f): f is string => f !== null);
  const reading = loading && documents === null;

  return (
    <div className="jdoc" data-over={over ? "" : undefined} {...dropProps}>
      <div className="jdoc-head">
        <h2 className="jdoc-h">Documents</h2>
        {addItems.length > 0 && (
          <>
            <Button
              ref={addRef}
              kind="main"
              icon="plus"
              aria-haspopup="menu"
              aria-expanded={adding}
              onClick={() => setAdding((a) => !a)}
            >
              Add
              <span className="jdoc-chev" aria-hidden="true">
                <Icon name="chevD" size={16} />
              </span>
            </Button>
            <Menu
              open={adding}
              anchor={addRef}
              onClose={() => setAdding(false)}
              onSelect={addPick}
              items={addItems}
              label="Add to the job's documents"
              align="end"
            />
          </>
        )}
        {onUpload && (
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
        )}
      </div>

      {(sending || over) && (
        <p className="jdoc-busy" role="status">
          {sending
            ? sending.of === 1
              ? "Uploading the file"
              : `Uploading ${sending.at} of ${sending.of}`
            : "Drop to upload"}
        </p>
      )}
      {refused.map((why) => (
        <p key={why} className="jdoc-err">
          {why}
        </p>
      ))}

      {failed.length > 0 && (
        <Wrong word={`Couldn't read this job's ${andList(failed)}`} means="Open the job again to see them." />
      )}

      {designs.length > 0 && (
        <Group heading="Drawings">
          {designs.map((d) => (
            <Row
              key={d.id}
              lead={onPick ? <span className="jdoc-tick" aria-hidden="true" /> : undefined}
              name={d.name}
              line={designRowLine(d)}
              href={designHref(d.id)}
            />
          ))}
        </Group>
      )}

      {client.length > 0 && <Group heading="From the client">{client.map(docRowOf)}</Group>}
      {files.length > 0 && <Group heading="Files">{files.map(docRowOf)}</Group>}

      {compliance > 0 && (
        <Group heading="Compliance">
          {statements.map(swmsRowOf)}
          {certs.map(certRowOf)}
          {ours.map(paperRowOf)}
          {attachedPapers.map(docRowOf)}
        </Group>
      )}

      {total === 0 &&
        failed.length === 0 &&
        (reading ? <Loading what="Reading the documents" /> : <Empty what="No documents on this job" action={null} />)}

      {unshowable > 0 && (
        <p className="jdoc-fact">{unshowable === 1 ? "1 file stays in ServiceM8" : `${unshowable} files stay in ServiceM8`}</p>
      )}

      {choosing && offerPapers && onLoadChoices && onAddPapers && (
        <ComplianceChooser today={day} onLoad={onLoadChoices} onAdd={onAddPapers} onClose={() => setChoosing(false)} />
      )}
    </div>
  );
}
