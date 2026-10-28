import type { CustomerItem, MessageFile, ThreadBubble } from "@/lib/jobs/customer-messages";
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
    }
  | { kind: "thread"; key: string; icon: "message" | "mail"; title: string; subject: string | null; lines: PhoneThreadLine[] };

/** The job page's row: who said the latest thing, the day, and its words. */
export type PhoneLatest = { who: string | null; day: string; words: string };

export type PhoneMessages = { latest: PhoneLatest | null; items: PhoneMessageItem[] };

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
      out.push({ kind: "send", key: item.key, icon: item.icon, words: item.words, detail: item.detail, reply: item.reply, seen: item.seen, files: withUrl(item.files) });
    } else {
      out.push({
        kind: "thread",
        key: item.key,
        icon: item.icon,
        title: item.title,
        subject: item.subject,
        lines: item.lines.map((l) =>
          l.kind === "line" ? l : { ...l, files: withUrl(l.files), full: { ...l.full, files: withUrl(l.full.files) } },
        ),
      });
    }
  }
  return { latest: latestOf(ordered), items: out };
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
