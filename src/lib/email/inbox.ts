import type { Tone } from "@/components/parts/state";
import { forwardedAt, forwardedWhen } from "@/lib/tiff/conversations";
import type { EmailProposal } from "./proposal";
import { forExistingJob, sureJob, threadTitleOf } from "./proposal";

/* THE INBOX (Isaac, 30 October 2026: "it needs to be called inbox… Inbox
   seems more businessy… you can have inbox and chats as your two sections";
   the mock he said "Build it" to). Every email sent to Tiff by anyone in the
   business, newest first, each a row: what it's about, who it's from and who
   forwarded it, and where it stands as a word (rule 17). Pure: the server
   reads the rows (inbox-server.ts), this says them. */

export type InboxEmailState = "received" | "read" | "made" | "filed" | "not_a_job" | "failed";

export type InboxEmail = {
  id: string;
  /** its subject, without the Fwd: */
  subject: string;
  /** whose email it was: the contact Tiff read, else the company */
  from: string | null;
  /** who forwarded it, by name; null when no one on the team is known */
  by: string | null;
  /** the person looking forwarded it */
  mine: boolean;
  /** when it came in, ms */
  at: number;
  state: InboxEmailState;
  /** the job it was made into or added to */
  jobNumber: string | null;
  /** the job Tiff is sure a read email is for */
  forJob: string | null;
  /** what Tiff read it as: a new job, a job already here, or neither */
  kind: "new" | "existing" | "none";
};

/** What Tiff read an email as. */
export function kindOf(p: EmailProposal | null): InboxEmail["kind"] {
  if (!p) return "none";
  if (forExistingJob(p)) return "existing";
  return p.isJob ? "new" : "none";
}

const contactOf = (p: EmailProposal | null) => [p?.contact?.first, p?.contact?.last].filter(Boolean).join(" ").trim();

/** Whose email it was: the contact Tiff read, else the company. */
export const fromOf = (p: EmailProposal | null): string | null => contactOf(p) || p?.client?.trim() || null;

/** An email row, as read from email_in_messages. */
export type InboxRowIn = {
  id: string;
  subject: string | null;
  received_at: string;
  state: InboxEmailState | "refused";
  proposal: EmailProposal | null;
  sender_sub: string | null;
  jobNumber: string | null;
};

/** The rows, said: a refused email (not from the team) is never shown, and a
    forward that couldn't be read goes once the same email, forwarded again by
    the same person, was (Krui Street, 29 October 2026: the failed read sat
    beside the one that worked, under the same title). */
export function inboxOf(rows: readonly InboxRowIn[], me: string | null, names: ReadonlyMap<string, string>): InboxEmail[] {
  const out = rows
    .filter((r): r is InboxRowIn & { state: InboxEmailState } => r.state !== "refused")
    .map((r): InboxEmail => {
      const p = r.proposal;
      return {
        id: r.id,
        subject: threadTitleOf(r.subject, p),
        from: fromOf(p),
        by: r.sender_sub ? (names.get(r.sender_sub) ?? null) : null,
        mine: Boolean(me && r.sender_sub === me),
        at: Date.parse(r.received_at) || 0,
        state: r.state,
        jobNumber: r.jobNumber,
        forJob: p ? (sureJob(p)?.number ?? null) : null,
        kind: kindOf(p),
      };
    })
    .sort((a, b) => b.at - a.at);
  return out.filter(
    (e) =>
      e.state !== "failed" ||
      !out.some((o) => o.at > e.at && o.state !== "failed" && o.subject === e.subject && o.mine === e.mine && o.by === e.by)
  );
}

/** Where an email stands, as a word in its colour (rule 17). `waiting` is a
    read email nobody has decided on, which turns the Inbox tab amber. */
export function inboxWord(e: InboxEmail): { tone: Tone; word: string; waiting: boolean } {
  switch (e.state) {
    case "received":
      return { tone: "info", word: "Being read", waiting: false };
    case "failed":
      return { tone: "wrong", word: "Couldn't be read", waiting: false };
    case "made":
      return { tone: "good", word: e.jobNumber ? `Job ${e.jobNumber} made` : "Job made", waiting: false };
    case "filed":
      return { tone: "good", word: e.jobNumber ? `Added to job ${e.jobNumber}` : "Added to a job", waiting: false };
    case "not_a_job":
      return { tone: "info", word: "Not a job", waiting: false };
    case "read":
      if (e.kind === "new") return { tone: "look", word: "Not made yet", waiting: true };
      if (e.kind === "existing") return { tone: "look", word: "Not added yet", waiting: true };
      return { tone: "info", word: "Not a job", waiting: false };
  }
}

/** The grey line under an email's subject: From Shaheer Khan, forwarded by
    you yesterday. */
export function inboxLine(e: Pick<InboxEmail, "from" | "by" | "mine" | "at">, now: number): string {
  const by = e.mine ? "you" : e.by;
  const forwarded = `${by ? `forwarded by ${by}` : "forwarded"} ${forwardedWhen(e.at, now)}`;
  return e.from ? `From ${e.from}, ${forwarded}` : `${forwarded[0]!.toUpperCase()}${forwarded.slice(1)}`;
}

/** The grey line under an open email's subject: From Shaheer Khan at JT
    Construct, forwarded by you yesterday at 7:48 pm. */
export function inboxHeadLine(e: Pick<InboxEmail, "by" | "mine" | "at">, p: EmailProposal | null, now: number): string {
  const contact = contactOf(p);
  const client = p?.client?.trim();
  const from = contact && client && client !== contact ? `${contact} at ${client}` : contact || client;
  const by = e.mine ? "you" : e.by;
  const forwarded = `${by ? `forwarded by ${by}` : "forwarded"} ${forwardedAt(e.at, now)}`;
  return from ? `From ${from}, ${forwarded}` : `${forwarded[0]!.toUpperCase()}${forwarded.slice(1)}`;
}

/** The builder's own email out of what was forwarded: the forward's header
    gone (its Date kept, as when it was sent), links and stars out of the
    words, a list's dashes back on their lines, and the hard wraps of a
    plain-text part joined. */
export function emailWords(body: string | null): { words: string; sent: string | null } {
  let text = (body ?? "").replace(/\r/g, "");
  let sent: string | null = null;
  const forward = /^[ \t>]*-{5,}\s*Forwarded message\s*-{5,}[ \t]*\n([\s\S]*?)\n[ \t]*\n/im.exec(text);
  if (forward) {
    sent = /^Date:\s*(.+)$/im.exec(forward[1]!)?.[1]?.trim() ?? null;
    text = text.slice(forward.index + forward[0].length);
  }
  const lines = text
    .replace(/\s*<(?:https?:|mailto:)[^>\s]*>/gi, "")
    .replace(/\*/g, "")
    .replace(/^[ \t]*-[ \t]*\n\s*\n?[ \t]*/gm, "- ")
    .split("\n")
    .map((l) => l.trim());
  const out: string[] = [];
  for (const line of lines) {
    const before = out[out.length - 1];
    /* a line near the wrap's width ran on into this one */
    if (before && line && before.length >= 60 && !/^[-•]/.test(line)) out[out.length - 1] = `${before} ${line}`;
    else out.push(line);
  }
  return { words: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), sent };
}
