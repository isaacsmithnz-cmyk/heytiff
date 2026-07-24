"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import {
  castPollVote,
  deleteNotice,
  editNotice,
  markNoticesRead,
  postNotice,
  setNoticeArchived,
} from "@/app/actions/dashboard";
import { expiryLabel, partitionNotices } from "@/lib/dashboard/notices";
import {
  cleanPollOptions,
  MAX_POLL_OPTIONS,
  nextSelection,
  POLL_ERROR_TEXT,
  type PollResult,
} from "@/lib/dashboard/polls";
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

type Acts = {
  pending: boolean;
  canManage: boolean;
  today: string;
  onEdit: (n: BoardNotice) => void;
  onArchive: (n: BoardNotice) => void;
  onRemove: (id: string) => void;
  onVote: (noticeId: string, optionIds: string[]) => void;
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
            {n.kind === "poll" && (
              <span className="dchip2 mute" style={{ marginRight: 8 }}>
                Poll
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
          {canFile && (
            <button
              className="fl-btn ghost"
              disabled={acts.pending}
              onClick={() => acts.onRemove(n.id)}
            >
              Remove
            </button>
          )}
        </span>
      </div>
      {n.body && <div className="nb-body">{n.body}</div>}
      {n.poll && (
        <PollBlock
          poll={n.poll}
          closed={filed || expiry?.state === "bad"}
          pending={acts.pending}
          onVote={(ids) => acts.onVote(n.id, ids)}
        />
      )}
      {(expiry || filed) && (
        <div className="nb-foot">
          {filed ? (
            <span className="dchip2 mute">
              <Icon name="folder" size={11} />
              Filed away
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
}: {
  notices: BoardNotice[];
  canManage: boolean;
  canRead: boolean;
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [kind, setKind] = useState<"notice" | "poll">("notice");
  // two empty answers up front: a poll needs two, so ask for two
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multi, setMulti] = useState(false);

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
    setEditingId(null);
    setOpen(false);
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
    onEdit: (n) => {
      setEditingId(n.id);
      setTitle(n.title);
      setBody(n.body ?? "");
      setPinned(n.pinned);
      setExpiresAt(n.expiresAt ?? "");
      setKind(n.kind === "poll" ? "poll" : "notice");
      setOpen(true);
      setError(null);
    },
    onArchive: (n) => run(() => setNoticeArchived(n.id, n.archivedAt === null)),
    onRemove: (id) => run(() => deleteNotice(id)),
    onVote: (noticeId, optionIds) => run(() => castPollVote(noticeId, optionIds)),
  };

  const composingPoll = kind === "poll" && !editingId;

  const submit = () =>
    run(
      () =>
        editingId
          ? // an EDIT only ever reaches the wording — a poll's answers are
            // fixed once people start voting, or the result stops meaning
            // what the early voters agreed to
            editNotice({
              noticeId: editingId,
              title,
              body: body || undefined,
              pinned,
              expiresAt: expiresAt || null,
            })
          : postNotice({
              title,
              body: body || undefined,
              pinned,
              expiresAt: expiresAt || null,
              kind,
              ...(kind === "poll" ? { options, multi } : {}),
            }),
      reset,
    );

  const blocked = !title.trim() || (composingPoll && !draftPoll.ok);

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* same back affordance the other deep pages use */}
              <a
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
                ← Dashboard
              </a>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
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
                  {(["notice", "poll"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`nb-kind${kind === k ? " on" : ""}`}
                      aria-pressed={kind === k}
                      onClick={() => setKind(k)}
                    >
                      {k === "notice" ? "Notice" : "Poll"}
                    </button>
                  ))}
                </div>
              )}
              <div className="lv-fnote">
                <label className="mts-f" style={{ flex: 1 }}>
                  <span>{composingPoll ? "Question" : "Title"}</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={
                      composingPoll ? "e.g. Which day suits for the toolbox talk?" : "e.g. Depot closed Friday"
                    }
                  />
                </label>
              </div>
              <div className="lv-fnote">
                <label className="mts-f" style={{ flex: 1 }}>
                  <span>{composingPoll ? "Any detail (optional)" : "Message (optional)"}</span>
                  <input
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="The details"
                  />
                </label>
              </div>

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

              <div className="lv-fnote">
                <label className="mts-f" style={{ flex: 1 }}>
                  <span>Comes off the board after (optional)</span>
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
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
                  <button className="fl-btn primary" disabled={pending || blocked} onClick={submit}>
                    <Icon name="send" size={14} />
                    {editingId ? "Save changes" : composingPoll ? "Post the poll" : "Post"}
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
