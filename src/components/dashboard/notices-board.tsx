"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import {
  deleteNotice,
  editNotice,
  markNoticesRead,
  postNotice,
  setNoticeArchived,
} from "@/app/actions/dashboard";
import { expiryLabel, partitionNotices } from "@/lib/dashboard/notices";
import type { NoticeWithRead } from "@/lib/dashboard/tasks";

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

function ReadReceipt({ notice }: { notice: NoticeWithRead }) {
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

type Acts = {
  pending: boolean;
  canManage: boolean;
  today: string;
  onEdit: (n: NoticeWithRead) => void;
  onArchive: (n: NoticeWithRead) => void;
  onRemove: (id: string) => void;
};

function NoticeCard({ notice: n, acts }: { notice: NoticeWithRead; acts: Acts }) {
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
  notices: NoticeWithRead[];
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
      setOpen(true);
      setError(null);
    },
    onArchive: (n) => run(() => setNoticeArchived(n.id, n.archivedAt === null)),
    onRemove: (id) => run(() => deleteNotice(id)),
  };

  const submit = () =>
    run(
      () =>
        editingId
          ? editNotice({
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
            }),
      reset,
    );

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
              <div className="lv-fnote">
                <label className="mts-f" style={{ flex: 1 }}>
                  <span>Title</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Depot closed Friday"
                  />
                </label>
              </div>
              <div className="lv-fnote">
                <label className="mts-f" style={{ flex: 1 }}>
                  <span>Message (optional)</span>
                  <input
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="The details"
                  />
                </label>
              </div>
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
                  <button
                    className="fl-btn primary"
                    disabled={pending || !title.trim()}
                    onClick={submit}
                  >
                    <Icon name="send" size={14} />
                    {editingId ? "Save changes" : "Post"}
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
