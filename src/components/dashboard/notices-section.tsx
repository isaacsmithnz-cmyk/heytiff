"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { ackNotice, postNotice } from "@/app/actions/dashboard";
import type { NoticeWithRead } from "@/lib/dashboard/tasks";

/* The noticeboard. Everyone reads and acknowledges; `team` holders can post.
   Acknowledging is your own read, so it needs no capability — but it does need
   a staff record, which `canAck` reflects. */

function NoticeRow({
  notice,
  canAck,
  onAck,
  pending,
}: {
  notice: NoticeWithRead;
  canAck: boolean;
  onAck: (id: string) => void;
  pending: boolean;
}) {
  return (
    <div className="dash-row" style={{ alignItems: "flex-start" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="dr-subj">
          {notice.pinned && (
            <span className="dchip2 warn" style={{ marginRight: 8 }}>
              <Icon name="alert" size={11} />
              Pinned
            </span>
          )}
          {notice.title}
        </div>
        {notice.body && <div className="dr-detail" style={{ marginTop: 4 }}>{notice.body}</div>}
        {notice.postedByName && <div className="dr-detail" style={{ marginTop: 4 }}>Posted by {notice.postedByName}</div>}
      </div>
      {notice.read ? (
        <span className="dchip2 ok">
          <Icon name="check" size={12} />
          Read
        </span>
      ) : canAck ? (
        <button className="fl-btn ghost" disabled={pending} onClick={() => onAck(notice.id)}>
          Got it
        </button>
      ) : null}
    </div>
  );
}

export function NoticesSection({
  notices,
  canManage,
  canAck,
}: {
  notices: NoticeWithRead[];
  canManage: boolean;
  canAck: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);

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

  const ack = (id: string) => run(() => ackNotice(id));

  const post = () =>
    run(
      () => postNotice({ title, body: body || undefined, pinned }),
      () => {
        setTitle("");
        setBody("");
        setPinned(false);
        setOpen(false);
      },
    );

  return (
    <div className="card2">
      <div className="c2h">
        <div className="ci">
          <Icon name="bell" size={19} />
        </div>
        <div>
          <b>Noticeboard</b>
          <em>Announcements for the team</em>
        </div>
        {canManage && (
          <button className="fl-btn primary" style={{ marginLeft: "auto" }} disabled={pending} onClick={() => setOpen((v) => !v)}>
            <Icon name="plus" size={14} />
            Post a notice
          </button>
        )}
      </div>

      {error && <div className="tp-err">{error}</div>}

      {canManage && open && (
        <div className="lv-form">
          <div className="lv-fnote">
            <label className="mts-f" style={{ flex: 1 }}>
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Depot closed Friday" />
            </label>
          </div>
          <div className="lv-fnote">
            <label className="mts-f" style={{ flex: 1 }}>
              <span>Message (optional)</span>
              <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="The details" />
            </label>
          </div>
          <div className="lv-fmeta">
            <label className="mts-f" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} style={{ width: "auto" }} />
              <span style={{ margin: 0 }}>Pin to the top</span>
            </label>
            <div className="mts-facts">
              <button className="fl-btn primary" disabled={pending || !title.trim()} onClick={post}>
                <Icon name="send" size={14} />
                Post
              </button>
              <button className="fl-btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {notices.length === 0 ? (
        <div className="dash-mini">Nothing on the board right now.</div>
      ) : (
        notices.map((n) => <NoticeRow key={n.id} notice={n} canAck={canAck} onAck={ack} pending={pending} />)
      )}
    </div>
  );
}
