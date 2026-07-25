/* Reactions — the cheapest way to reply.

   Half of what a noticeboard needs isn't a comment, it's an acknowledgement
   with a tone: seen it, love it, ouch. A read receipt says someone's eyes
   passed over the words; a reaction says what they thought, at the cost of one
   tap.

   ONE PER PERSON, like every messaging app the crew already uses. Picking a
   different one replaces it; picking the same one takes it back. That's a
   primary key in the database, not a rule in the UI, so a double-tap cannot
   leave two.

   A FIXED PALETTE, not free text. Six reactions make a countable row —
   "4 👍 · 1 🙏" — where an open emoji field makes a long tail of one-offs that
   nobody can read at a glance, and puts arbitrary text in a table the whole org
   sees. The database CHECK holds the same list. */

export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export type Reaction = (typeof REACTIONS)[number];

/** Narrow an untrusted value to a reaction, or null. No default: an emoji we
    don't offer is not a reaction, and guessing one would put words in someone's
    mouth. */
export function asReaction(value: unknown): Reaction | null {
  return REACTIONS.includes(value as Reaction) ? (value as Reaction) : null;
}

export type ReactionRow = {
  staffId: string;
  staffName: string;
  emoji: Reaction;
};

export type ReactionTally = {
  emoji: Reaction;
  count: number;
  /** True when the viewer is one of them. */
  mine: boolean;
  /** Everyone who picked it, in name order — hover/expand fodder. */
  names: string[];
};

export type ReactionSummary = {
  /** Only the reactions somebody actually gave, most-used first. */
  tallies: ReactionTally[];
  /** How many people have reacted at all. One each, so this is also the total. */
  total: number;
  /** The viewer's current reaction, or null. */
  mine: Reaction | null;
};

export function tallyReactions(
  rows: readonly ReactionRow[],
  viewerStaffId: string | null,
): ReactionSummary {
  const byEmoji = new Map<Reaction, ReactionRow[]>();
  let mine: Reaction | null = null;
  for (const r of rows) {
    const list = byEmoji.get(r.emoji) ?? [];
    list.push(r);
    byEmoji.set(r.emoji, list);
    if (viewerStaffId && r.staffId === viewerStaffId) mine = r.emoji;
  }

  const tallies = [...byEmoji.entries()]
    .map(([emoji, list]) => ({
      emoji,
      count: list.length,
      mine: mine === emoji,
      names: list.map((r) => r.staffName).sort((a, b) => a.localeCompare(b)),
    }))
    // busiest first, and the palette's own order breaks the tie so the row
    // doesn't reshuffle every time somebody taps
    .sort((a, b) =>
      a.count !== b.count ? b.count - a.count : REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji),
    );

  return { tallies, total: rows.length, mine };
}

/** What a tap means: the same reaction again takes it back, a different one
    replaces it. Null is the retraction the action expects. */
export function nextReaction(current: Reaction | null, tapped: Reaction): Reaction | null {
  return current === tapped ? null : tapped;
}
