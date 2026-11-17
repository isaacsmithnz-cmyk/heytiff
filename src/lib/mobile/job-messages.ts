import { clockOf, type CustomerItem, type CustomerSend, type FullMessage, type MessageFile, type SendVia, type ThreadBubble } from "@/lib/jobs/customer-messages";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { plusDays } from "@/lib/workboard/dates";

/* A JOB'S TEXTS AND EMAILS ON THE PHONE (Isaac, 28 October 2026, "Looks
   good" on https://claude.ai/artifact/XaSepXSBuJq5FcAT8ZDE3o): the web's
   own read of them (customer-messages-query), oldest first, as its All feed
   lays them out: a conversation is a thread of bubbles, ServiceM8's own
   sends one line each with the customer's answer on the right. The day is
   said where it changes. Read only: nothing here sends.

   A FILE OPENS AS THE WEB OPENS IT (job-sheet's openFile): from the job's
   own photos and papers, signed; one the job's read doesn't hold opens
   nothing, and an invoice's paper only for someone who sees money. */

export type PhoneMessageFile = MessageFile & { url: string | null };

export type PhoneBubble = Omit<ThreadBubble, "files" | "full"> & {
  files: PhoneMessageFile[];
  full: Omit<ThreadBubble["full"], "files"> & { files: PhoneMessageFile[] };
};

export type PhoneThreadLine = PhoneBubble | { kind: "line"; key: string; words: string; reply: string | null };

export type PhoneMessageItem =
  | { kind: "day"; key: string; label: string }
  | {
      kind: "send";
      key: string;
      icon: "message" | "mail" | "car";
      words: string;
      detail: string | null;
      reply: string | null;
      seen: string | null;
      files: PhoneMessageFile[];
      /** who sent it: the staff member, else the business's short name */
      who: string | null;
      /** how it went */
      via: SendVia;
      /** its words without "texted" or "sent by": "On the way" */
      plain: string;
    }
  | { kind: "thread"; key: string; icon: "message" | "mail"; title: string; subject: string | null; lines: PhoneThreadLine[] };

/** The job page's row: who said the latest thing, the day, and its words. */
export type PhoneLatest = { who: string | null; day: string; words: string };

/* ONE CONVERSATION (Isaac, 17 November 2026, bug 20, "This looks pretty
   messy", then "Yes, all of it" to the mock's Tidied board): everything the business sent
   is a green bubble on the right, ServiceM8's own sends too, its first name
   over it and inside it the way it went; the customer's answers grey on the
   left, a booking's "Yes" among them; one time-ordered run under a heading
   for each day, threads and all. A run is one person's bubbles back to back
   inside an hour: their name over the first, the time (or Seen) under the
   last, and a Seen wherever one was. */

/** A bubble of the conversation. `name` only on the first of a run, `under`
    is the time, or "Seen 2:23 pm", under the last of one (and wherever a
    Seen is); `via` the glyph inside, for a bubble of the business's; `full`
    what opens, null for nothing. */
export type PhoneFlowBubble = {
  kind: "bubble";
  key: string;
  side: "them" | "us";
  name: string | null;
  via: SendVia | null;
  words: string;
  last: boolean;
  under: string | null;
  files: PhoneMessageFile[];
  full: (Omit<FullMessage, "files"> & { files: PhoneMessageFile[] }) | null;
};

export type PhoneFlowItem = { kind: "day"; key: string; label: string } | PhoneFlowBubble;

/** `items` stays for a phone that hasn't updated; `flow` is the conversation. */
export type PhoneMessages = { latest: PhoneLatest | null; items: PhoneMessageItem[]; flow: PhoneFlowItem[] };

/** A business's name as its people say it: "Diamond Air Solutions Pty LTD"
    is "Diamond Air". The legal ending goes, then one word that only says
    what kind of company it is, so long as two words are left. */
export function shortBusinessName(name: string | null | undefined): string | null {
  let words = (name ?? "").trim().replace(/[.,]+$/, "").split(/\s+/).filter(Boolean);
  const LEGAL = /^(?:pty\.?|proprietary|ltd\.?|limited|p\/l|inc\.?|incorporated|llc|co\.?)$/i;
  while (words.length > 1 && LEGAL.test(words.at(-1)!.replace(/,$/, ""))) words = words.slice(0, -1);
  if (words.length > 2 && /^(?:solutions|services|group|australia|enterprises|holdings|company)$/i.test(words.at(-1)!.replace(/,$/, ""))) words = words.slice(0, -1);
  const out = words.join(" ").replace(/[,&]+$/, "").trim();
  return out || null;
}

const secondsOf = (stamp: string) => {
  const t = Date.parse(`${stamp.slice(0, 19).replace(" ", "T")}Z`);
  return Number.isNaN(t) ? 0 : t / 1000;
};

/** A run of one person's bubbles ends at an hour's quiet. */
const RUN_GAP = 3600;

const firstLine = (words: string) => {
  const line = words.split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.length > 120 ? line.slice(0, 120) : line;
};

/** Where each of the job's files opens, by its ServiceM8 uuid, lower-cased. */
export function fileDoors(media: { photos: JobMediaItem[]; documents: JobMediaItem[] } | null, money: boolean): Map<string, string> {
  const doors = new Map<string, string>();
  if (!media) return doors;
  for (const p of media.photos) if (p.url && p.kind !== "video") doors.set(p.remoteId.toLowerCase(), p.url);
  for (const d of media.documents) {
    /* an invoice's paper is Billing's, and Billing is money's */
    if (!d.url || (d.origin === "Invoice" && !money)) continue;
    doors.set(d.remoteId.toLowerCase(), d.url);
  }
  return doors;
}

export function phoneMessages(items: readonly CustomerItem[], opts: { today: string | null; doors: Map<string, string> }): PhoneMessages {
  const withUrl = (files: MessageFile[]): PhoneMessageFile[] => files.map((f) => ({ ...f, url: opts.doors.get(f.id.toLowerCase()) ?? null }));
  const label = (day: string) =>
    opts.today && day === opts.today ? "Today" : opts.today && day === plusDays(opts.today, -1) ? "Yesterday" : fmtAuWeekdayDayMonth(day) || day;

  const ordered = [...items].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const out: PhoneMessageItem[] = [];
  let lastDay: string | null = null;
  for (const item of ordered) {
    if (item.day !== lastDay) {
      out.push({ kind: "day", key: `day:${item.key}`, label: label(item.day) });
      lastDay = item.day;
    }
    if (item.kind === "send") {
      out.push({
        kind: "send",
        key: item.key,
        icon: item.icon,
        words: item.words,
        detail: item.detail,
        reply: item.reply,
        seen: item.seen,
        files: withUrl(item.files),
        who: item.who ?? null,
        via: viaOf(item),
        plain: item.plain ?? item.words,
      });
    } else {
      out.push({
        kind: "thread",
        key: item.key,
        icon: item.icon,
        title: item.title,
        subject: item.subject,
        lines: item.lines.map((l) =>
          l.kind === "line"
            ? { kind: "line" as const, key: l.key, words: l.words, reply: l.reply }
            : { ...l, files: withUrl(l.files), full: { ...l.full, files: withUrl(l.full.files) } },
        ),
      });
    }
  }
  return { latest: latestOf(ordered), items: out, flow: flowOf(ordered, { label, withUrl }) };
}

const viaOf = (s: CustomerSend): SendVia => s.via ?? (s.icon === "mail" ? "email" : "text");

/** A moment of the conversation before it is laid out. */
type Said = {
  key: string;
  at: string;
  side: "them" | "us";
  who: string | null;
  via: SendVia | null;
  words: string;
  time: string;
  seen: string | null;
  files: MessageFile[];
  full: FullMessage | null;
};

/** A send, as the business's bubble, and the customer's short answer to it as theirs. */
function sendSaid(s: CustomerSend): Said[] {
  const out: Said[] = [
    { key: s.key, at: s.at, side: "us", who: s.who ?? null, via: viaOf(s), words: s.plain ?? s.words, time: s.time ?? clockOf(s.at), seen: s.seen, files: s.files, full: s.full ?? null },
  ];
  /* a feed from before answers were their own: "Simon: Yes" read apart */
  const old = !s.answer && s.reply ? /^([^:]*):\s*([\s\S]+)$/.exec(s.reply) : null;
  const answer = s.answer ?? (old ? { who: old[1]!.trim(), words: old[2]!.trim(), time: "", at: s.at } : null);
  if (answer) {
    out.push({ key: `${s.key}:answer`, at: answer.at, side: "them", who: answer.who || null, via: null, words: answer.words, time: answer.time, seen: null, files: [], full: null });
  }
  return out;
}

function flowOf(
  ordered: readonly CustomerItem[],
  opts: { label: (day: string) => string; withUrl: (files: MessageFile[]) => PhoneMessageFile[] },
): PhoneFlowItem[] {
  const said: Said[] = [];
  for (const item of ordered) {
    if (item.kind === "send") {
      said.push(...sendSaid(item));
      continue;
    }
    /* a bubble's speaker, from the top of its run where a feed from before `who` names only that */
    const last: Record<"them" | "us", string | null> = { them: null, us: null };
    for (const l of item.lines) {
      if (l.kind === "line") {
        if (l.send) said.push(...sendSaid(l.send));
        else said.push({ key: l.key, at: item.at, side: "us", who: null, via: null, words: l.words, time: "", seen: null, files: [], full: null });
        continue;
      }
      const who = l.who ?? l.name ?? last[l.side];
      last[l.side] = who;
      said.push({
        key: l.key,
        at: l.at ?? item.at,
        side: l.side,
        who,
        via: l.via ?? (l.email ? "email" : "text"),
        words: l.words,
        time: l.time,
        seen: l.seen,
        files: l.files,
        full: l.full,
      });
    }
  }
  /* one time-ordered run: a send inside a thread and outside it alike */
  said.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const flow: PhoneFlowItem[] = [];
  const sameRun = (a: Said | undefined, b: Said | undefined) =>
    !!a && !!b && a.side === b.side && (a.who ?? "") === (b.who ?? "") && a.at.slice(0, 10) === b.at.slice(0, 10) && Math.abs(secondsOf(b.at) - secondsOf(a.at)) <= RUN_GAP;
  let lastDay: string | null = null;
  said.forEach((s, i) => {
    const day = s.at.slice(0, 10);
    if (day !== lastDay) {
      flow.push({ kind: "day", key: `day:${s.key}`, label: opts.label(day) });
      lastDay = day;
    }
    const first = !sameRun(said[i - 1], s);
    const last = !sameRun(s, said[i + 1]);
    const when = s.seen ?? (s.time || null);
    flow.push({
      kind: "bubble",
      key: s.key,
      side: s.side,
      name: first ? (s.who ?? null) : null,
      via: s.side === "us" ? s.via : null,
      words: s.words,
      last,
      under: last ? when : s.seen,
      files: opts.withUrl(s.files),
      full: s.full ? { ...s.full, files: opts.withUrl(s.full.files) } : null,
    });
  });
  return flow;
}

/** The latest thing said: a send's answer ("Jay: YES") or the send itself,
    or a thread's last message with the name of whoever said it. */
function latestOf(ordered: readonly CustomerItem[]): PhoneLatest | null {
  const last = ordered.at(-1);
  if (!last) return null;
  if (last.kind === "send") {
    const reply = last.reply ? /^([^:]*):\s*([\s\S]+)$/.exec(last.reply) : null;
    return reply ? { who: reply[1]!.trim() || null, day: last.day, words: firstLine(reply[2]!) } : { who: null, day: last.day, words: last.words };
  }
  const lines = last.lines;
  const end = lines.at(-1);
  if (!end) return null;
  if (end.kind === "line") return { who: null, day: last.day, words: end.words };
  let who: string | null = null;
  for (let i = lines.length - 1; i >= 0 && who === null; i--) {
    const l = lines[i]!;
    if (l.kind === "line") break;
    who = l.name;
  }
  return { who, day: last.day, words: firstLine(end.words) };
}
