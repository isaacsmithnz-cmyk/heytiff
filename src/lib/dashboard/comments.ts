/* Comments and @mentions — the bit that makes a noticeboard a conversation.

   ONE LEVEL OF THREADING. A comment either stands on the notice or replies to
   one that does. Deeper nesting reads badly on a phone and gives people a way
   to bury a conversation three levels down where nobody scrolls, so a reply to
   a reply joins the same thread rather than starting a new indent.

   MENTIONS ARE RESOLVED, NOT SCANNED. The body is plain text with "@Ana" in it,
   but WHO was meant is decided once, server-side, against the org's own staff
   list, and stored as rows. Two consequences worth keeping: renaming somebody
   can never silently re-point an old mention at a different person, and
   highlighting a mention on screen never depends on a name still existing.

   The matcher below is used in both directions — the action runs it to work out
   who to record, the renderer runs it to work out what to paint — so what gets
   highlighted and who gets notified can't drift apart. */

export type MentionTarget = { id: string; name: string };

export type CommentRow = {
  id: string;
  parentId: string | null;
  authorId: string | null;
  authorName: string | null;
  body: string;
  createdAt: string;
  /** Staff ids this comment mentions, as resolved when it was written. */
  mentions: string[];
};

export type CommentNode = CommentRow & {
  /** Only ever one level deep; replies never have replies of their own. */
  replies: CommentRow[];
};

/* --------------- mentions --------------- */

export type MentionHit = {
  /** Index of the "@". */
  start: number;
  /** Index just past the matched name. */
  end: number;
  /** The name as it appears in the text. */
  text: string;
  target: MentionTarget;
};

/* Names can contain spaces ("Ana Smith"), so matching is longest-first: with
   both "Ana" and "Ana Smith" on staff, "@Ana Smith" is one mention of Ana
   Smith and never a mention of Ana followed by the word "Smith". */
function byLengthDesc(a: MentionTarget, b: MentionTarget): number {
  return b.name.length - a.name.length || a.name.localeCompare(b.name);
}

/** Every @mention in a body that resolves to somebody real, left to right. */
export function findMentions(body: string, staff: readonly MentionTarget[]): MentionHit[] {
  const candidates = [...staff].filter((s) => s.name.trim()).sort(byLengthDesc);
  const lower = body.toLowerCase();
  const hits: MentionHit[] = [];

  let i = 0;
  while (i < body.length) {
    const at = body.indexOf("@", i);
    if (at === -1) break;

    // "@" must start a word — an email address is not a mention
    const before = at > 0 ? body[at - 1] : " ";
    if (/[\w@]/.test(before)) {
      i = at + 1;
      continue;
    }

    const match = candidates.find((s) => lower.startsWith(s.name.toLowerCase(), at + 1));
    if (match) {
      const end = at + 1 + match.name.length;
      // and it must END on a boundary too, so "@Ann" never matches "@Anna"
      if (end >= body.length || !/[\w']/.test(body[end])) {
        hits.push({ start: at, end, text: body.slice(at + 1, end), target: match });
        i = end;
        continue;
      }
    }
    i = at + 1;
  }
  return hits;
}

/** The distinct people a body mentions — what the action records. */
export function mentionedIds(body: string, staff: readonly MentionTarget[]): string[] {
  return [...new Set(findMentions(body, staff).map((h) => h.target.id))];
}

export type BodyPart =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; staffId: string; me: boolean };

/* A comment body chopped into plain runs and mention runs, ready to render.
   Doing this as data rather than as HTML keeps the escaping problem where it
   belongs — in React — and keeps the rule testable. */
export function segmentBody(
  body: string,
  staff: readonly MentionTarget[],
  viewerStaffId: string | null,
): BodyPart[] {
  const hits = findMentions(body, staff);
  const parts: BodyPart[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) parts.push({ kind: "text", text: body.slice(cursor, h.start) });
    parts.push({
      kind: "mention",
      text: `@${h.text}`,
      staffId: h.target.id,
      me: viewerStaffId !== null && h.target.id === viewerStaffId,
    });
    cursor = h.end;
  }
  if (cursor < body.length) parts.push({ kind: "text", text: body.slice(cursor) });
  return parts;
}

/* --------------- threading --------------- */

/** Oldest first — a conversation reads down the page, not up it. */
function byOldest(a: CommentRow, b: CommentRow): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id);
}

/* Flat rows into one level of thread. A reply whose parent is missing (deleted
   out from under it, or simply not on this page) is promoted to the top rather
   than dropped — losing someone's words to a dangling id would be worse than
   showing them slightly out of place. */
export function threadComments(rows: readonly CommentRow[]): CommentNode[] {
  const tops = new Map<string, CommentNode>();
  const present = new Set(rows.map((r) => r.id));

  for (const r of [...rows].sort(byOldest)) {
    if (r.parentId === null || !present.has(r.parentId)) {
      tops.set(r.id, { ...r, parentId: null, replies: [] });
    }
  }
  for (const r of [...rows].sort(byOldest)) {
    if (r.parentId === null || !present.has(r.parentId)) continue;
    // a reply to a reply belongs to the thread it's in, not to a third level
    const root = tops.has(r.parentId) ? r.parentId : rootOf(r.parentId, rows, present);
    tops.get(root)?.replies.push(r);
  }
  return [...tops.values()].sort(byOldest);
}

/** Walk up until the comment that stands on the notice itself. */
function rootOf(id: string, rows: readonly CommentRow[], present: ReadonlySet<string>): string {
  const seen = new Set<string>();
  let current = id;
  while (!seen.has(current)) {
    seen.add(current);
    const row = rows.find((r) => r.id === current);
    if (!row || row.parentId === null || !present.has(row.parentId)) return current;
    current = row.parentId;
  }
  return current; // a cycle can't happen, but never loop forever over user data
}

/** Every comment on a notice, replies included. */
export function commentCount(nodes: readonly CommentNode[]): number {
  return nodes.reduce((n, c) => n + 1 + c.replies.length, 0);
}

/** How many of them mention the viewer — the "you're wanted here" signal. */
export function mentionsOf(nodes: readonly CommentNode[], viewerStaffId: string | null): number {
  if (!viewerStaffId) return 0;
  const hit = (c: CommentRow) => (c.mentions.includes(viewerStaffId) ? 1 : 0);
  return nodes.reduce((n, c) => n + hit(c) + c.replies.reduce((m, r) => m + hit(r), 0), 0);
}

/** The most a comment may carry. Long enough for a paragraph, short enough
    that the board stays a board. */
export const MAX_COMMENT = 1000;
