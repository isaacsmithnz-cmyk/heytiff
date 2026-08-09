import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { chipGroup, type ActionChip } from "@/lib/dashboard/chips";
import type { BoardNotice } from "@/lib/dashboard/board";

/* The row views — Urgent, Needs attention, Noticeboard.

   All three wear the maintenance board's row, `.wb2-trj`: a severity stripe
   down the left edge, a baseline-aligned grid, and the lift on hover. Home used
   to invent its own row for each of these; the board's already answers the
   question they all ask, which is "what, about what, and by when".

   THE STRIPE IS THE ONLY COLOUR. No chips, no tinted glyph tiles — the tab
   badge above already said how many and in what tone, so repeating it on every
   row is the noise this redesign exists to remove. */

function Row({
  href,
  sev,
  title,
  sub,
  subject,
  group,
  when,
  note,
  danger,
}: {
  href: string;
  /** "over" past its date · "soon" inside the warning window · "" neither */
  sev: "over" | "soon" | "";
  title: string;
  sub?: string;
  subject: string;
  group: string;
  when: string;
  note?: string;
  danger?: boolean;
}) {
  return (
    <Link className="wb2-trj hm-row" href={href} data-sev={sev}>
      <span className="wb2-trt">
        <b>{title}</b>
        {sub && <em>{sub}</em>}
      </span>
      <span className="wb2-trref">{subject}</span>
      <em className="wb2-trcad">{group}</em>
      <span className="wb2-trd">
        <b>{when}</b>
        {note && <em className={danger ? "dan" : undefined}>{note}</em>}
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

/* ── action-required chips ──────────────────────────────────────────────
   `label` is already a written sentence ("Rego expired 4 days ago"), and
   `subject` is who or what it concerns. The chip carries no separate due date,
   so the label's own clause does that column's job rather than a second,
   invented one. */
export function ChipRows({ chips, sev }: { chips: readonly ActionChip[]; sev: "over" | "soon" }) {
  return (
    <>
      {chips.map((c) => (
        <Row
          key={c.key}
          href={c.href}
          sev={sev}
          title={c.label}
          subject={c.subject}
          group={chipGroup(c.kind)}
          when={sev === "over" ? "Overdue" : "Coming up"}
          danger={sev === "over"}
        />
      ))}
    </>
  );
}

/* ── noticeboard ────────────────────────────────────────────────────────
   Unread leads and reads follow, because the board's own rule is that being
   named outranks having something to read. A read notice keeps its row but
   loses its stripe — weight and the stripe carry the state, so no chip. */
export function NoticeRows({ notices }: { notices: readonly BoardNotice[] }) {
  return (
    <>
      {notices.map((n) => {
        const unread = !n.mine && n.state !== "read";
        return (
          <Row
            key={n.id}
            href="/dashboard/notices"
            sev={n.mentionsMe > 0 ? "soon" : ""}
            title={n.title}
            subject={n.postedByName ?? ""}
            group={n.pinned ? "Pinned" : "Notice"}
            when={unread ? "Unread" : "Read"}
            note={n.mentionsMe > 0 ? "Mentions you" : undefined}
          />
        );
      })}
    </>
  );
}
