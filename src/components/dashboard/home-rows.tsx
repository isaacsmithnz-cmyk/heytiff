import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { chipGroup, GROUP_ICON, type ActionChip } from "@/lib/dashboard/chips";
import type { BoardNotice } from "@/lib/dashboard/board";

/* The row views — Urgent, Needs attention, Noticeboard — on the ink card.

   They used to wear the maintenance board's `.wb2-trj`: a five-column grid
   whose last two columns repeated what the page already said ("Overdue", on
   the tab named Urgent, beside a stripe that meant overdue). On ink the row
   is an identity instead: a glyph tile saying WHAT KIND of thing this is,
   the fact in white over who or what it concerns, and the chevron. The
   label's own clause ("expired 4 days ago") carries the age, as it always
   did — the columns that restated it are what's gone.

   THE TILE IS THE ONLY COLOUR. Overdue tints it danger, due-soon tints it
   warning, and `data-sev` still names the state for tests and anyone
   restyling later. The glyphs are `GROUP_ICON`'s — the same truck and shield
   the nav uses for those areas, so the association is pre-taught. */

function ChipRow({ chip, sev }: { chip: ActionChip; sev: "over" | "soon" }) {
  const group = chipGroup(chip.kind);
  return (
    <Link className="hm-row" href={chip.href} data-sev={sev}>
      <span className="hm-rtile">
        <Icon name={GROUP_ICON[group]} size={17} />
      </span>
      <span className="hm-rmain">
        <b>{chip.label}</b>
        <em>
          {chip.subject} · {group}
        </em>
      </span>
      <span className="hm-rowgo">
        <Icon name="arrowR" size={15} />
      </span>
    </Link>
  );
}

/** An empty view says what it checked, not just that it is empty. */
export function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="hm-none">{children}</p>;
}

/* ── action-required chips ────────────────────────────────────────────── */
export function ChipRows({ chips, sev }: { chips: readonly ActionChip[]; sev: "over" | "soon" }) {
  return (
    <>
      {chips.map((c) => (
        <ChipRow key={c.key} chip={c} sev={sev} />
      ))}
    </>
  );
}

/* ── noticeboard ────────────────────────────────────────────────────────
   People talking, not a table. The author's initials lead the row — a post
   is somebody saying something — and the ring goes gradient while it is
   unread, the same live material the topbar avatar and the journal's today
   node wear. Read state is textual in the meta line for anyone who can't
   see the weight change, and "mentions you" is the only warm word: being
   named outranks having something to read, which is the board's own rule. */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function NoticeRows({ notices }: { notices: readonly BoardNotice[] }) {
  return (
    <>
      {notices.map((n) => {
        const unread = !n.mine && n.state !== "read";
        return (
          <Link
            className="hm-row hm-nrow"
            href="/dashboard/notices"
            key={n.id}
            data-unread={unread || undefined}
          >
            <span className="hm-rav">
              <i>{initials(n.postedByName ?? "?")}</i>
            </span>
            <span className="hm-rmain">
              <b>{n.title}</b>
              <em>
                {n.postedByName ?? "Someone"}
                {n.pinned ? " · Pinned" : ""}
                {n.mentionsMe > 0 && (
                  <>
                    {" · "}
                    <b className="hm-warm">Mentions you</b>
                  </>
                )}
                {" · "}
                {unread ? "Unread" : "Read"}
              </em>
            </span>
            <span className="hm-rowgo">
              <Icon name="arrowR" size={15} />
            </span>
          </Link>
        );
      })}
    </>
  );
}
