"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { DateField } from "@/components/ui/date-field";
import {
  castPollVote,
  commentOnNotice,
  deleteComment,
  deleteNotice,
  editNotice,
  markNoticesRead,
  postNotice,
  reactToNotice,
  setNoticeArchived,
  setRsvp,
} from "@/app/actions/dashboard";
import { expiryLabel, partitionNotices } from "@/lib/dashboard/notices";
import {
  cleanPollOptions,
  MAX_POLL_OPTIONS,
  nextSelection,
  POLL_ERROR_TEXT,
  type PollResult,
} from "@/lib/dashboard/polls";
import { eventWhen, isEventTime, rsvpSummary } from "@/lib/dashboard/events";
import {
  nextReaction,
  REACTIONS,
  type Reaction,
  type ReactionSummary,
} from "@/lib/dashboard/reactions";
import {
  commentCount,
  MAX_COMMENT,
  segmentBody,
  type CommentNode,
  type CommentRow,
  type MentionTarget,
} from "@/lib/dashboard/comments";
import { deleteDocument } from "@/app/actions/documents";
import { ALLOWED_TYPES, displayName, fmtBytes, MAX_NOTICE_FILES } from "@/lib/documents/files";
import { uploadFile, type UploadedFile } from "@/lib/documents/upload-client";
import type { StoredDocument } from "@/lib/documents/query";
import type { BoardNotice } from "@/lib/dashboard/board";

/* The noticeboard page — where notices are actually read.

   READING IS PASSIVE, AND DELIBERATE. The dashboard only carries a summary
   card; you have to click into this page to get here. That intent is the read
   signal, so opening the page marks everything on it read — the same bargain a
   messaging app makes when you open a conversation. Nothing to click, and no
   pretending a notice that merely scrolled past the dashboard was read.

   EDITING IS QUIET. A reworded notice carries a small "Edited" label — no
   re-notification, no version number shown to the reader. What moves is the
   AUTHOR's read count: it only counts readers who have seen the current
   wording, so it dips after an edit and recovers as people next open the board.
   That is why the receipt is versioned rather than cleared.

   THE BOARD IS THE PRESENT. Anything past its expiry date, or filed away by
   hand, drops into a collapsed Archived section rather than disappearing.
   Expiry is computed from the server's AU date (passed in), never the
   browser's clock — a phone in another timezone must not see a different
   board. */

function ReadReceipt({ notice }: { notice: BoardNotice }) {
  if (notice.audience === 0) return null;
  const all = notice.readBy >= notice.audience;
  return (
    <span className={`dchip2 ${all ? "ok" : "mute"}`}>
      <Icon name="check" size={12} />
      Read by {notice.readBy} of {notice.audience}
    </span>
  );
}

function fmtWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(new Date(iso));
}

/* A poll's answers.

   The bar behind each answer is the share of the people who have ANSWERED, not
   of the org — "half the crew who replied said Friday" is the number you can
   actually act on, and it doesn't quietly punish a poll for not having heard
   from everyone yet. Who voted for what is shown on request rather than by
   default: it's never a secret (see lib/dashboard/polls), but a wall of names
   under every answer buries the result.

   A closed poll — expired or archived — still renders, and still shows who
   said what. It just stops taking answers: "who's coming Friday" must not keep
   moving after Friday. */
function PollBlock({
  poll,
  closed,
  pending,
  onVote,
}: {
  poll: PollResult;
  closed: boolean;
  pending: boolean;
  onVote: (optionIds: string[]) => void;
}) {
  const [showVoters, setShowVoters] = useState(false);
  const anyVoters = poll.voters > 0;

  return (
    <div className="nb-poll">
      {poll.options.map((o) => (
        <div key={o.id}>
          <button
            type="button"
            className={`nb-opt${o.mine ? " on" : ""}${closed ? " shut" : ""}`}
            disabled={closed || pending}
            aria-pressed={o.mine}
            onClick={() => onVote(nextSelection(poll.myOptionIds, o.id, poll.multi))}
          >
            <span className="nb-optbar" style={{ width: `${o.share}%` }} aria-hidden />
            <span className={`nb-optbox${poll.multi ? " sq" : ""}`}>
              {o.mine && <Icon name="check" size={10} />}
            </span>
            <span className="nb-optlabel">{o.label}</span>
            <span className="nb-optn">{o.votes}</span>
          </button>
          {showVoters && o.voters.length > 0 && (
            <div className="nb-optwho">{o.voters.map((v) => v.name).join(", ")}</div>
          )}
        </div>
      ))}
      <div className="nb-pollfoot">
        <span>
          {closed
            ? "Voting closed"
            : poll.multi
              ? "Pick as many as apply"
              : "Pick one — tap again to take it back"}
          {" · "}
          {poll.voters === 0
            ? "No answers yet"
            : `${poll.voters} ${poll.voters === 1 ? "person has" : "people have"} answered`}
        </span>
        {anyVoters && (
          <button type="button" className="nb-wholink" onClick={() => setShowVoters((v) => !v)}>
            {showVoters ? "Hide who voted" : "Who voted"}
          </button>
        )}
      </div>
    </div>
  );
}

/* An event: when, where, and who's coming.

   The RSVP is rendered by the SAME component as a poll's answers, because that
   is what it is — one pick from three, changeable, and public. Building a
   second voting control would have meant two places to get "tap again to take
   it back" wrong. */
function EventBlock({
  event,
  closed,
  pending,
  today,
  onRsvp,
}: {
  event: NonNullable<BoardNotice["event"]>;
  closed: boolean;
  pending: boolean;
  today: string;
  onRsvp: (answer: string | null) => void;
}) {
  const when = eventWhen(event.date, event.time, today);
  const summary = rsvpSummary(event.rsvp);

  return (
    <>
      <div className="nb-when">
        <span className="nb-whenline">
          <Icon name="calendar" size={13} />
          {when.day}
          {when.time && ` · ${when.time}`}
          {when.soon && <span className="dchip2 warn">{when.soon}</span>}
        </span>
        {event.location && (
          <span className="nb-whenline">
            <Icon name="compass" size={13} />
            {event.location}
          </span>
        )}
        {summary && <span className="nb-whensum">{summary}</span>}
      </div>
      <PollBlock
        poll={event.rsvp}
        closed={closed || when.past}
        pending={pending}
        onVote={(ids) => onRsvp(ids[0] ?? null)}
      />
    </>
  );
}

/* The reaction row: what people already said, then a way to say it too.

   Given reactions come first and are always visible; the palette hides behind
   a single button, because six emoji permanently under every notice is a lot
   of colour for a page whose job is to be read. */
function ReactionRow({
  reactions,
  pending,
  onReact,
}: {
  reactions: ReactionSummary;
  pending: boolean;
  onReact: (emoji: Reaction | null) => void;
}) {
  const [picking, setPicking] = useState(false);

  return (
    <div className="nb-reacts">
      {reactions.tallies.map((t) => (
        <button
          key={t.emoji}
          type="button"
          className={`nb-react${t.mine ? " on" : ""}`}
          disabled={pending}
          aria-pressed={t.mine}
          title={t.names.join(", ")}
          onClick={() => onReact(nextReaction(reactions.mine, t.emoji))}
        >
          <span aria-hidden>{t.emoji}</span>
          {t.count}
        </button>
      ))}
      <button
        type="button"
        className="nb-react add"
        aria-label={picking ? "Close the reactions" : "React to this"}
        aria-expanded={picking}
        onClick={() => setPicking((v) => !v)}
      >
        <Icon name={picking ? "x" : "plus"} size={12} />
      </button>
      {picking &&
        REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className={`nb-react pick${reactions.mine === emoji ? " on" : ""}`}
            disabled={pending}
            onClick={() => {
              onReact(nextReaction(reactions.mine, emoji));
              setPicking(false);
            }}
          >
            <span aria-hidden>{emoji}</span>
          </button>
        ))}
    </div>
  );
}

/* Files on a post.

   Photos show as photos — a job is easier to describe with a picture than with
   a paragraph, and a thumbnail you have to click to identify is no better than
   a filename. Anything else is a labelled chip with its size, so nobody
   downloads 8 MB to find out what it was.

   Every URL here is signed and short-lived: the bucket is private, so a link
   somebody keeps stops working rather than quietly staying open. */
/* A full-screen image viewer. Portalled to <body>, NOT rendered inside the page:
   .page.in carries a will-change that breaks position:fixed, so a lightbox left
   in the tree would anchor to the scroll box instead of the viewport (see the
   dashboard modal-portal rule). Closes on the ✕, a backdrop click, or Escape,
   and restores page scrolling on the way out — a viewer you can't get out of is
   worse than no viewer. */
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="nb-lb" role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className="nb-lb-x" aria-label="Close" onClick={onClose}>
        <Icon name="x" size={22} />
      </button>
      {/* stop the image itself from closing; the backdrop around it does */}
      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
      <a className="nb-lb-open" href={src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        Open original
      </a>
    </div>,
    document.body,
  );
}

function Attachments({ files }: { files: StoredDocument[] }) {
  const [viewing, setViewing] = useState<{ url: string; alt: string } | null>(null);
  if (files.length === 0) return null;
  return (
    <div className="nb-files">
      {files.map((f) =>
        f.image && f.url ? (
          // a thumbnail opens the in-app viewer, not a raw new tab you can't
          // get back from
          <button
            key={f.id}
            type="button"
            className="nb-file img"
            onClick={() => setViewing({ url: f.url as string, alt: displayName(f.fileName) })}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- signed,
                short-lived storage URL: the image optimiser can't cache it */}
            <img src={f.url} alt={displayName(f.fileName)} loading="lazy" />
          </button>
        ) : (
          <a
            key={f.id}
            className="nb-file doc"
            href={f.url ?? "#"}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="file" size={15} />
            <span>
              <b>{displayName(f.fileName)}</b>
              <em>{fmtBytes(f.sizeBytes)}</em>
            </span>
          </a>
        ),
      )}
      {viewing && <Lightbox src={viewing.url} alt={viewing.alt} onClose={() => setViewing(null)} />}
    </div>
  );
}

function fmtStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/* A comment body, with its @mentions painted.

   The segmenting runs over the SAME staff list the server resolved the mention
   against, so a name that highlights here is a name that got recorded. Being
   the one mentioned is called out more strongly than mentioning someone else —
   that's the whole reason to type the @. */
function CommentBody({
  body,
  staff,
  viewerStaffId,
}: {
  body: string;
  staff: MentionTarget[];
  viewerStaffId: string | null;
}) {
  return (
    <div className="nb-cbody">
      {segmentBody(body, staff, viewerStaffId).map((part, i) =>
        part.kind === "mention" ? (
          <span key={i} className={`nb-at${part.me ? " me" : ""}`}>
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </div>
  );
}

function CommentLine({
  comment,
  staff,
  viewerStaffId,
  canManage,
  pending,
  onReply,
  onDelete,
}: {
  comment: CommentRow;
  staff: MentionTarget[];
  viewerStaffId: string | null;
  canManage: boolean;
  pending: boolean;
  onReply: (() => void) | null;
  onDelete: () => void;
}) {
  const mine = viewerStaffId !== null && comment.authorId === viewerStaffId;
  const atMe = viewerStaffId !== null && comment.mentions.includes(viewerStaffId);

  return (
    <div className={`nb-c${atMe ? " atme" : ""}`}>
      <div className="nb-chead">
        <b>{mine ? "You" : comment.authorName ?? "Someone"}</b>
        <span>{fmtStamp(comment.createdAt)}</span>
        {onReply && (
          <button type="button" className="nb-clink" disabled={pending} onClick={onReply}>
            Reply
          </button>
        )}
        {(mine || canManage) && (
          <button type="button" className="nb-clink" disabled={pending} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
      <CommentBody body={comment.body} staff={staff} viewerStaffId={viewerStaffId} />
    </div>
  );
}

/* The conversation under a post.

   Collapsed by default once there's more than a couple, because a board of
   twenty notices each with a thread open is unreadable — EXCEPT when one of
   them mentions you, which is exactly the case where you want it in front of
   you without hunting. */
function CommentThread({
  notice,
  staff,
  viewerStaffId,
  canManage,
  canWrite,
  pending,
  onComment,
  onDelete,
}: {
  notice: BoardNotice;
  staff: MentionTarget[];
  viewerStaffId: string | null;
  canManage: boolean;
  canWrite: boolean;
  pending: boolean;
  onComment: (body: string, parentId: string | null) => void;
  onDelete: (commentId: string) => void;
}) {
  const total = commentCount(notice.comments);
  const [open, setOpen] = useState(total > 0 && (total <= 2 || notice.mentionsMe > 0));
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    onComment(body, replyTo);
    setDraft("");
    setReplyTo(null);
  };

  const line = (c: CommentRow, canReply: boolean) => (
    <CommentLine
      key={c.id}
      comment={c}
      staff={staff}
      viewerStaffId={viewerStaffId}
      canManage={canManage}
      pending={pending}
      onReply={canWrite && canReply ? () => setReplyTo(c.id) : null}
      onDelete={() => onDelete(c.id)}
    />
  );

  return (
    <div className="nb-thread">
      <div className="nb-threadhead">
        <button type="button" className="nb-clink" onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? "chevD" : "chevR"} size={12} />
          {total === 0 ? "Add a comment" : total === 1 ? "1 comment" : `${total} comments`}
        </button>
        {notice.mentionsMe > 0 && (
          <span className="dchip2 warn">
            <Icon name="alert" size={11} />
            {notice.mentionsMe === 1 ? "Mentions you" : `Mentions you ×${notice.mentionsMe}`}
          </span>
        )}
      </div>

      {open && (
        <>
          {notice.comments.map((c: CommentNode) => (
            <div key={c.id}>
              {line(c, true)}
              {c.replies.length > 0 && (
                <div className="nb-creplies">{c.replies.map((r) => line(r, true))}</div>
              )}
            </div>
          ))}

          {canWrite && (
            <div className="nb-cform">
              {replyTo && (
                <div className="nb-creplyto">
                  Replying to that comment
                  <button type="button" className="nb-clink" onClick={() => setReplyTo(null)}>
                    Cancel
                  </button>
                </div>
              )}
              <div className="nb-crow">
                <input
                  value={draft}
                  maxLength={MAX_COMMENT}
                  placeholder="Say something — @ someone to get their attention"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <button
                  type="button"
                  className="fl-btn primary"
                  disabled={pending || !draft.trim()}
                  onClick={send}
                >
                  <Icon name="send" size={13} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Acts = {
  pending: boolean;
  canManage: boolean;
  today: string;
  staff: MentionTarget[];
  viewerStaffId: string | null;
  canRead: boolean;
  onEdit: (n: BoardNotice) => void;
  onArchive: (n: BoardNotice) => void;
  onRemove: (id: string) => void;
  /** Which filed notice has its delete armed — one at a time, board-wide. */
  armedRemove: string | null;
  onArmRemove: (id: string | null) => void;
  onVote: (noticeId: string, optionIds: string[]) => void;
  onRsvp: (noticeId: string, answer: string | null) => void;
  onReact: (noticeId: string, emoji: string | null) => void;
  onComment: (noticeId: string, body: string, parentId: string | null) => void;
  onDeleteComment: (commentId: string) => void;
};

function NoticeCard({ notice: n, acts }: { notice: BoardNotice; acts: Acts }) {
  const expiry = expiryLabel(n.expiresAt, acts.today);
  const filed = n.archivedAt !== null;
  const canFile = n.mine || acts.canManage;

  return (
    <div className="card2 nb-item">
      <div className="nb-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="nb-title">
            {n.pinned && !filed && (
              <span className="dchip2 warn" style={{ marginRight: 8 }}>
                <Icon name="alert" size={11} />
                Pinned
              </span>
            )}
            {(n.kind === "poll" || n.kind === "event") && (
              <span className="dchip2 mute" style={{ marginRight: 8 }}>
                {n.kind === "poll" ? "Poll" : "Event"}
              </span>
            )}
            {n.title}
          </div>
          <div className="nb-meta">
            {n.mine ? "Posted by you" : n.postedByName ? `Posted by ${n.postedByName}` : ""}
            {` · ${fmtWhen(n.createdAt)}`}
            {n.editedAt && <span style={{ fontStyle: "italic" }}> · Edited</span>}
          </div>
        </div>
        <span style={{ display: "flex", gap: 8, alignItems: "center", flex: "0 0 auto" }}>
          {n.mine && <ReadReceipt notice={n} />}
          {n.mine && !filed && (
            <button className="fl-btn ghost" disabled={acts.pending} onClick={() => acts.onEdit(n)}>
              Edit
            </button>
          )}
          {canFile && (
            <button
              className="fl-btn ghost"
              disabled={acts.pending}
              onClick={() => acts.onArchive(n)}
            >
              {filed ? "Put back" : "Archive"}
            </button>
          )}
          {/* DELETE IS OFFERED FROM THE ARCHIVE ONLY.

              This used to sit here on every live notice as a ghost button
              beside Archive, and one click destroyed the post, its comments,
              its poll votes, its RSVPs and its files with no confirm and no
              undo. Two controls that look the same and differ by "recoverable"
              is the wrong pair to put a millimetre apart.

              It is My Notes' rule, which already says it out loud: "Deleting is
              offered from the archive only, so nothing is destroyed in one
              click from the list you read every day." Archive first, then
              delete — and it still asks twice, the way Revoke and Deactivate
              do. A typo is a job for Edit. */}
          {canFile && filed && (
            <button
              className={`fl-btn tiny danger${acts.armedRemove === n.id ? " arm" : ""}`}
              disabled={acts.pending}
              onBlur={() => acts.onArmRemove(null)}
              onClick={() => {
                if (acts.armedRemove !== n.id) return acts.onArmRemove(n.id);
                acts.onArmRemove(null);
                acts.onRemove(n.id);
              }}
            >
              {acts.armedRemove === n.id ? "Confirm delete" : "Delete for good"}
            </button>
          )}
        </span>
      </div>
      {n.body && <div className="nb-body">{n.body}</div>}
      <Attachments files={n.attachments} />
      {n.poll && (
        <PollBlock
          poll={n.poll}
          closed={filed || expiry?.state === "bad"}
          pending={acts.pending}
          onVote={(ids) => acts.onVote(n.id, ids)}
        />
      )}
      {n.event && (
        /* an event's expiry is normally its own date, so expiry must NOT close
           the RSVP — it would shut the list on the morning of the thing */
        <EventBlock
          event={n.event}
          closed={filed}
          pending={acts.pending}
          today={acts.today}
          onRsvp={(answer) => acts.onRsvp(n.id, answer)}
        />
      )}
      <ReactionRow
        reactions={n.reactions}
        pending={acts.pending}
        onReact={(emoji) => acts.onReact(n.id, emoji)}
      />
      <CommentThread
        notice={n}
        staff={acts.staff}
        viewerStaffId={acts.viewerStaffId}
        canManage={acts.canManage}
        /* filed away means the conversation is closed too — the notice is no
           longer something anyone is being asked to act on */
        canWrite={acts.canRead && !filed}
        pending={acts.pending}
        onComment={(body, parentId) => acts.onComment(n.id, body, parentId)}
        onDelete={acts.onDeleteComment}
      />
      {(expiry || filed) && (
        <div className="nb-foot">
          {filed ? (
            /* "Archived", because the button says Archive and the section
               below says Archived. This chip said "Filed away", which made
               three words for one state on a single screen. */
            <span className="dchip2 mute">
              <Icon name="folder" size={11} />
              Archived
            </span>
          ) : (
            expiry && (
              <span className={`dchip2 ${expiry.state}`}>
                <Icon name="clock" size={11} />
                {expiry.label}
              </span>
            )
          )}
          {filed && expiry && <span className="nb-footnote">{expiry.label}</span>}
        </div>
      )}
    </div>
  );
}

export function NoticesBoard({
  notices,
  canManage,
  canRead,
  today,
  staff,
  viewerStaffId,
}: {
  notices: BoardNotice[];
  canManage: boolean;
  canRead: boolean;
  today: string;
  staff: MentionTarget[];
  viewerStaffId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  // one armed delete at a time — see NoticeCard's delete button
  const [armedRemove, setArmedRemove] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [kind, setKind] = useState<"notice" | "poll" | "event">("notice");
  // two empty answers up front: a poll needs two, so ask for two
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multi, setMulti] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  // files land in storage as they're picked, BEFORE the notice exists; posting
  // is what claims them. An abandoned composer therefore leaves rows nobody can
  // see rather than a half-attached notice.
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const draftPoll = useMemo(() => cleanPollOptions(options), [options]);

  const { active, archived } = useMemo(() => partitionNotices(notices, today), [notices, today]);

  /* Opening the board is the read event. Fire once per mount for whatever is
     still outstanding; deliberately NOT awaited into a transition and with no
     refresh, so receipts never re-render the page under the reader. Only the
     current board counts — nobody is behind on last month's expired notice. */
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || !canRead) return;
    marked.current = true;
    const outstanding = active.filter((n) => !n.mine && n.state !== "read").map((n) => n.id);
    if (outstanding.length > 0) void markNoticesRead(outstanding);
  }, [canRead, active]);

  const reset = () => {
    setTitle("");
    setBody("");
    setPinned(false);
    setExpiresAt("");
    setKind("notice");
    setOptions(["", ""]);
    setMulti(false);
    setEventDate("");
    setEventTime("");
    setEventLocation("");
    for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    setFiles([]);
    setEditingId(null);
    setOpen(false);
  };

  /* Picking files uploads them straight away — the notice they'll hang off
     doesn't exist yet, and won't until Post. One failure doesn't cancel the
     rest of the selection; it just says which one didn't make it. */
  const pickFiles = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setError(null);
    setUploading(true);
    let room = MAX_NOTICE_FILES - files.length;
    for (const file of Array.from(picked)) {
      if (room <= 0) {
        setError(`You can attach up to ${MAX_NOTICE_FILES} files.`);
        break;
      }
      const res = await uploadFile(file, "notice_attachment");
      if (!res.ok) {
        setError(`${displayName(file.name)}: ${res.error}`);
        continue;
      }
      room -= 1;
      setFiles((prev) => [...prev, res.file]);
    }
    setUploading(false);
  };

  const dropFile = (documentId: string) => {
    const going = files.find((f) => f.documentId === documentId);
    if (going?.previewUrl) URL.revokeObjectURL(going.previewUrl);
    setFiles((prev) => prev.filter((f) => f.documentId !== documentId));
    // it was already in storage, so taking it out of the composer has to take
    // it out of the bucket too — otherwise it's billable and invisible
    void deleteDocument(documentId);
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else {
        after?.();
        router.refresh();
      }
    });
  };

  const acts: Acts = {
    pending,
    canManage,
    today,
    staff,
    viewerStaffId,
    canRead,
    onEdit: (n) => {
      setEditingId(n.id);
      setTitle(n.title);
      setBody(n.body ?? "");
      setPinned(n.pinned);
      setExpiresAt(n.expiresAt ?? "");
      setKind(n.kind);
      setEventDate(n.event?.date ?? "");
      setEventTime(n.event?.time ?? "");
      setEventLocation(n.event?.location ?? "");
      setOpen(true);
      setError(null);
    },
    onArchive: (n) => run(() => setNoticeArchived(n.id, n.archivedAt === null)),
    onRemove: (id) => run(() => deleteNotice(id)),
    armedRemove,
    onArmRemove: setArmedRemove,
    onVote: (noticeId, optionIds) => run(() => castPollVote(noticeId, optionIds)),
    onRsvp: (noticeId, answer) => run(() => setRsvp(noticeId, answer)),
    onReact: (noticeId, emoji) => run(() => reactToNotice(noticeId, emoji)),
    onComment: (noticeId, body, parentId) =>
      run(() => commentOnNotice({ noticeId, body, parentId })),
    onDeleteComment: (commentId) => run(() => deleteComment(commentId)),
  };

  const composingPoll = kind === "poll" && !editingId;
  // an event's when/where stays editable after posting — plans move
  const showingEvent = kind === "event";

  const submit = () =>
    run(
      () =>
        editingId
          ? // an EDIT reaches the wording, and an event's when/where — but
            // never a poll's answers, which are fixed once people start voting
            // or the result stops meaning what the early voters agreed to
            editNotice({
              noticeId: editingId,
              title,
              body: body || undefined,
              pinned,
              expiresAt: expiresAt || null,
              documentIds: files.map((f) => f.documentId),
              ...(showingEvent
                ? { eventDate, eventTime: eventTime || undefined, eventLocation }
                : {}),
            })
          : postNotice({
              title,
              body: body || undefined,
              pinned,
              expiresAt: expiresAt || null,
              kind,
              documentIds: files.map((f) => f.documentId),
              ...(kind === "poll" ? { options, multi } : {}),
              ...(showingEvent
                ? { eventDate, eventTime: eventTime || undefined, eventLocation }
                : {}),
            }),
      reset,
    );

  const blocked =
    !title.trim() ||
    (composingPoll && !draftPoll.ok) ||
    (showingEvent && (!eventDate || (!!eventTime && !isEventTime(eventTime))));

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* same back affordance the other deep pages use */}
              <Link
                href="/dashboard"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#9ca3af",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  marginBottom: 12,
                }}
              >
                ← Home
              </Link>
              <h1>
                Noticeboard
              </h1>
            </div>
            {canManage && !editingId && (
              <button
                className="fl-btn primary"
                disabled={pending}
                onClick={() => (open ? reset() : setOpen(true))}
              >
                <Icon name="plus" size={14} />
                Post a notice
              </button>
            )}
          </div>

          {error && <div className="tp-err">{error}</div>}

          {open && (
            <div className="lv-form">
              {!editingId && (
                <div className="nb-kinds" role="group" aria-label="What are you posting">
                  {(["notice", "poll", "event"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`nb-kind${kind === k ? " on" : ""}`}
                      aria-pressed={kind === k}
                      onClick={() => setKind(k)}
                    >
                      {k === "notice" ? "Notice" : k === "poll" ? "Poll" : "Event"}
                    </button>
                  ))}
                </div>
              )}
              <div className="lv-fnote">
                <label className="mts-f" style={{ flex: 1 }}>
                  <span>{composingPoll ? "Question" : showingEvent ? "What's on" : "Title"}</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={
                      composingPoll
                        ? "e.g. Which day suits for the toolbox talk?"
                        : showingEvent
                          ? "e.g. Toolbox talk"
                          : "e.g. Depot closed Friday"
                    }
                  />
                </label>
              </div>
              <div className="lv-fnote">
                <label className="mts-f" style={{ flex: 1 }}>
                  <span>{composingPoll ? "Any detail (optional)" : "Message (optional)"}</span>
                  {/* A TEXTAREA, because this is the announcement. It was a
                      one-line `<input>`: "Depot closed Friday — the yard is
                      being resurfaced, park on Mills St, and take the
                      compressor home Thursday night" had to be typed into a
                      box that scrolls sideways and can never hold a paragraph
                      break. `.nb-body` already renders the stored text with
                      pre-wrap, so the newlines survive the round trip; nothing
                      but the composer was stopping anyone writing them. */}
                  <textarea
                    className="nb-bodyin"
                    rows={3}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="The details — as many lines as it takes"
                  />
                </label>
              </div>

              {showingEvent && (
                <div className="lv-fnote" style={{ gap: 12, flexWrap: "wrap" }}>
                  <label className="mts-f" style={{ flex: "1 1 180px" }}>
                    <span>Day</span>
                    <DateField
                      value={eventDate || null}
                      today={today}
                      onChange={(iso) => setEventDate(iso ?? "")}
                    />
                  </label>
                  <label className="mts-f" style={{ flex: "0 1 140px" }}>
                    <span>Start (optional)</span>
                    <input
                      type="time"
                      value={eventTime}
                      onChange={(e) => setEventTime(e.target.value)}
                    />
                  </label>
                  <label className="mts-f" style={{ flex: "1 1 220px" }}>
                    <span>Where (optional)</span>
                    <input
                      value={eventLocation}
                      onChange={(e) => setEventLocation(e.target.value)}
                      placeholder="e.g. The depot"
                    />
                  </label>
                </div>
              )}

              {composingPoll && (
                <div className="nb-optedit">
                  <span className="nb-optedith">Answers</span>
                  {options.map((o, i) => (
                    <div className="nb-optrow" key={i}>
                      <input
                        value={o}
                        placeholder={`Answer ${i + 1}`}
                        onChange={(e) =>
                          setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                        }
                      />
                      {options.length > 2 && (
                        <button
                          type="button"
                          className="nb-optdrop"
                          aria-label={`Remove answer ${i + 1}`}
                          onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                        >
                          <Icon name="x" size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                  {options.length < MAX_POLL_OPTIONS && (
                    <button
                      type="button"
                      className="fl-btn ghost"
                      onClick={() => setOptions((prev) => [...prev, ""])}
                    >
                      <Icon name="plus" size={13} />
                      Add an answer
                    </button>
                  )}
                  <label
                    className="mts-f"
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}
                  >
                    <input
                      type="checkbox"
                      checked={multi}
                      onChange={(e) => setMulti(e.target.checked)}
                      style={{ width: "auto" }}
                    />
                    <span style={{ margin: 0 }}>Allow more than one answer</span>
                  </label>
                  {/* only nag once there's something to nag about */}
                  {!draftPoll.ok && options.some((o) => o.trim()) && (
                    <div className="dash-mini">{POLL_ERROR_TEXT[draftPoll.error]}</div>
                  )}
                </div>
              )}

              <div className="nb-optedit">
                <span className="nb-optedith">Photos & files</span>
                {files.length > 0 && (
                  <div className="nb-files">
                    {files.map((f) => (
                      <div className="nb-pending" key={f.documentId}>
                        {f.previewUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element --
                             an in-memory object URL; there is nothing to optimise */
                          <img src={f.previewUrl} alt={displayName(f.fileName)} />
                        ) : (
                          <span className="nb-pendingdoc">
                            <Icon name="file" size={16} />
                          </span>
                        )}
                        <span className="nb-pendingname">
                          <b>{displayName(f.fileName)}</b>
                          <em>{fmtBytes(f.sizeBytes)}</em>
                        </span>
                        <button
                          type="button"
                          className="nb-optdrop"
                          aria-label={`Remove ${displayName(f.fileName)}`}
                          onClick={() => dropFile(f.documentId)}
                        >
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {files.length < MAX_NOTICE_FILES && (
                  <label className="fl-btn ghost" style={{ cursor: "pointer" }}>
                    <Icon name="plus" size={13} />
                    {uploading ? "Uploading…" : "Attach a photo or file"}
                    <input
                      type="file"
                      multiple
                      accept={Object.keys(ALLOWED_TYPES).join(",")}
                      disabled={uploading}
                      style={{ display: "none" }}
                      onChange={(e) => {
                        void pickFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
                <div className="dash-mini">
                  Photos and PDFs, up to {MAX_NOTICE_FILES} of them. Only people in your
                  organisation can open them.
                </div>
              </div>

              <div className="lv-fnote">
                <label className="mts-f" style={{ flex: 1 }}>
                  <span>
                    {showingEvent
                      ? "Comes off the board after (defaults to the day itself)"
                      : "Comes off the board after (optional)"}
                  </span>
                  <DateField
                    value={expiresAt || null}
                    today={today}
                    clearable
                    placeholder="No date"
                    onChange={(iso) => setExpiresAt(iso ?? "")}
                  />
                </label>
              </div>
              <div className="lv-fmeta">
                <label className="mts-f" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(e) => setPinned(e.target.checked)}
                    style={{ width: "auto" }}
                  />
                  <span style={{ margin: 0 }}>Pin to the top</span>
                </label>
                <div className="mts-facts">
                  <button
                    className="fl-btn primary"
                    disabled={pending || uploading || blocked}
                    onClick={submit}
                  >
                    <Icon name="send" size={14} />
                    {editingId
                      ? "Save changes"
                      : composingPoll
                        ? "Post the poll"
                        : showingEvent
                          ? "Post the event"
                          : "Post"}
                  </button>
                  <button className="fl-btn ghost" onClick={reset}>
                    Cancel
                  </button>
                </div>
              </div>
              {editingId && (
                <div className="dash-mini">
                  Rewording marks it Edited. Anyone who only saw the old version drops out of your
                  read count until they next open the board.
                  {kind === "poll" && " A poll's answers can't be changed once it's up."}
                  {showingEvent &&
                    " Moving the day, time or place counts as rewording it — everyone keeps their RSVP, but they'll see the change."}
                </div>
              )}
            </div>
          )}

          {active.length === 0 ? (
            <div className="emptybox">
              <div className="ei">
                <Icon name="bell" size={22} />
              </div>
              <b>Nothing on the board</b>
              <em>
                {canManage
                  ? "Post a notice and everyone will see it here."
                  : "Announcements from your team will appear here."}
              </em>
            </div>
          ) : (
            active.map((n) => <NoticeCard key={n.id} notice={n} acts={acts} />)
          )}

          {archived.length > 0 && (
            <>
              <button
                type="button"
                className="nb-archtoggle"
                aria-expanded={showArchive}
                onClick={() => setShowArchive((v) => !v)}
              >
                <Icon name={showArchive ? "chevD" : "chevR"} size={14} />
                Archived · {archived.length}
              </button>
              {showArchive && archived.map((n) => <NoticeCard key={n.id} notice={n} acts={acts} />)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
