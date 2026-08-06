import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { currentUnreadCount, partitionNotices } from "@/lib/dashboard/notices";
import type { BoardNotice } from "@/lib/dashboard/board";

/* The dashboard's noticeboard card — a summary and a door, nothing more.

   Deliberately NOT where notices are read: it shows what's waiting and links
   through. Reading (and posting, and editing) all happen on /dashboard/notices,
   because clicking through is an intent signal that something merely scrolling
   into view on the dashboard could never be.

   Only the CURRENT board is summarised. Expired and archived notices exist,
   but the dashboard is a "what needs me today" surface — putting last month's
   announcement in the unread count would make the badge a chore rather than a
   signal. */

export function NoticesCard({ notices, today }: { notices: BoardNotice[]; today: string }) {
  const { active } = partitionNotices(notices, today);
  const unread = currentUnreadCount(notices, today);
  const latest = active.slice(0, 3);
  // being named in a conversation outranks having something to read: someone
  // is waiting on YOU, so it leads the card
  const mentions = active.reduce((n, x) => n + x.mentionsMe, 0);

  return (
    <Link className="card2 dash-card-link" href="/dashboard/notices">
      <div className="c2h">
        <div className="ci">
          {/* `note`, matching the rail row and the hero tile — `bell` now
              belongs to the topbar's action-required count */}
          <Icon name="note" size={19} />
        </div>
        <div>
          <b>Noticeboard</b>
          <em>Announcements for the team</em>
        </div>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {mentions > 0 && (
            <span className="dchip2 warn">
              {mentions === 1 ? "Mentions you" : `${mentions} mentions`}
            </span>
          )}
          {unread > 0 && <span className="dchip2 mute">{unread} unread</span>}
          <span className="dr-chev">
            <Icon name="arrowR" size={16} />
          </span>
        </span>
      </div>

      {active.length === 0 ? (
        <div className="dash-mini">Nothing on the board right now.</div>
      ) : (
        <>
          {latest.map((n) => (
            <div className="dash-row" key={n.id}>
              {n.pinned && (
                <span className="dchip2 warn">
                  <Icon name="alert" size={11} />
                  Pinned
                </span>
              )}
              <span className="dr-subj">{n.title}</span>
              {!n.mine && n.state !== "read" && (
                <span className="dchip2 mute" style={{ marginLeft: "auto" }}>
                  Unread
                </span>
              )}
            </div>
          ))}
          {active.length > latest.length && (
            <div className="dash-mini">
              +{active.length - latest.length} more on the board
            </div>
          )}
        </>
      )}
    </Link>
  );
}
