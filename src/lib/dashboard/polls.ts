/* Polls on the noticeboard — the counting, purely.

   A poll is a notice with answers. The question is the notice's own title, so
   it sorts, expires, archives and is read like anything else on the board; only
   the tally lives here.

   VOTES ARE ATTRIBUTABLE. A work poll is "who's coming Friday", not a secret
   ballot, and the answer is only useful if you can see who said what — the same
   bargain the read receipts already make. So every option carries its voters by
   name, and the UI is free to show them.

   SHARE IS OF PEOPLE, NOT OF VOTES. Each bar is the fraction of everyone who
   has answered at all, which is the number a reader actually wants ("half the
   crew said Friday"). On a multi-select poll the bars therefore sum past 100%,
   and that is the honest reading — three of four people picking two options
   each is not twelve twelfths of anything. */

export type PollOptionRow = {
  id: string;
  label: string;
  position: number;
};

export type PollVoteRow = {
  optionId: string;
  staffId: string;
  staffName: string;
};

export type PollVoter = { id: string; name: string };

export type PollOptionResult = {
  id: string;
  label: string;
  votes: number;
  /** Percentage of the people who have answered, rounded. 0 when nobody has. */
  share: number;
  /** Joint-highest, and only once somebody has actually voted. */
  leading: boolean;
  /** Everyone who picked this, in name order. */
  voters: PollVoter[];
  /** True when the viewer picked this one. */
  mine: boolean;
};

export type PollResult = {
  /** More than one answer allowed. */
  multi: boolean;
  options: PollOptionResult[];
  /** Distinct people who have answered at all — the denominator of every bar. */
  voters: number;
  /** True when the viewer has cast any vote. */
  voted: boolean;
  /** The viewer's current picks, for the UI's selected state. */
  myOptionIds: string[];
};

/** The empty poll — a question nobody can answer yet, or a notice that isn't
    one. Kept here so callers never hand-roll a half-shaped result. */
export function emptyPoll(multi = false): PollResult {
  return { multi, options: [], voters: 0, voted: false, myOptionIds: [] };
}

export function tallyPoll(input: {
  options: readonly PollOptionRow[];
  votes: readonly PollVoteRow[];
  multi: boolean;
  viewerStaffId: string | null;
}): PollResult {
  const { multi, viewerStaffId } = input;

  const byOption = new Map<string, PollVoter[]>();
  const people = new Set<string>();
  const mine = new Set<string>();
  for (const v of input.votes) {
    const list = byOption.get(v.optionId) ?? [];
    list.push({ id: v.staffId, name: v.staffName });
    byOption.set(v.optionId, list);
    people.add(v.staffId);
    if (viewerStaffId && v.staffId === viewerStaffId) mine.add(v.optionId);
  }

  // author's order, never vote order — a poll that reshuffles as people answer
  // is unreadable, and makes early voters look like they changed their minds
  const ordered = [...input.options].sort((a, b) =>
    a.position !== b.position ? a.position - b.position : a.id < b.id ? -1 : 1,
  );

  const counts = ordered.map((o) => (byOption.get(o.id) ?? []).length);
  const top = counts.reduce((m, n) => Math.max(m, n), 0);
  const voters = people.size;

  const options = ordered.map((o, i) => ({
    id: o.id,
    label: o.label,
    votes: counts[i],
    share: voters === 0 ? 0 : Math.round((counts[i] / voters) * 100),
    leading: top > 0 && counts[i] === top,
    voters: (byOption.get(o.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    mine: mine.has(o.id),
  }));

  return { multi, options, voters, voted: mine.size > 0, myOptionIds: [...mine] };
}

/** How many answers a poll may carry. Two is the point of asking; ten is the
    point at which nobody reads the list. */
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;

export type PollDraftError =
  | "too-few"
  | "too-many"
  | "duplicate";

/* Validate a set of typed-in answers, and hand back the cleaned list. Shared
   by the composer (to disable Post) and by the action (which decides for real
   — the UI is never the control). */
export function cleanPollOptions(
  raw: readonly string[],
): { ok: true; options: string[] } | { ok: false; error: PollDraftError } {
  const options = raw.map((s) => s.trim().slice(0, 120)).filter(Boolean);
  if (options.length < MIN_POLL_OPTIONS) return { ok: false, error: "too-few" };
  if (options.length > MAX_POLL_OPTIONS) return { ok: false, error: "too-many" };
  const seen = new Set(options.map((s) => s.toLowerCase()));
  if (seen.size !== options.length) return { ok: false, error: "duplicate" };
  return { ok: true, options };
}

export const POLL_ERROR_TEXT: Record<PollDraftError, string> = {
  "too-few": `Give the poll at least ${MIN_POLL_OPTIONS} answers.`,
  "too-many": `A poll can have at most ${MAX_POLL_OPTIONS} answers.`,
  duplicate: "Two answers say the same thing.",
};

/* What the viewer's click means. Single-choice polls behave like a radio that
   can be cleared (tapping your own answer retracts it); multi-select toggles.
   Pure, so the "can I change my mind" rule is one testable function rather
   than scattered through the component. */
export function nextSelection(
  current: readonly string[],
  optionId: string,
  multi: boolean,
): string[] {
  const has = current.includes(optionId);
  if (!multi) return has ? [] : [optionId];
  return has ? current.filter((id) => id !== optionId) : [...current, optionId];
}
