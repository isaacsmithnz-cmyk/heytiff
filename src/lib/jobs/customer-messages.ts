import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { clock12 } from "@/lib/dashboard/task-record";
import { fmtAud } from "@/lib/workboard/project-money";
import type { StoryEntry } from "@/lib/workboard/job-story";

/* THE CUSTOMER'S TEXTS AND EMAILS IN A JOB'S ACTIVITY FEED (Isaac, 26
   October 2026, "Yes build", the tidied option B, laid out like a phone).
   Pure: what the feed draws from ServiceM8's job communication history
   (sm8_job_messages, mirrored read-only), decided here where a test can
   see it. Nothing here sends, and nothing can be sent from what it makes.

   SERVICEM8'S OWN SENDS ARE ONE ROW EACH. A message is one of its sends
   (a "template") when the read says so: its opening was sent on five or
   more of the organisation's jobs, or it carries one of ServiceM8's own
   marks (an sm8.link link, "Track my arrival", a reply-YES booking). No
   business's wording is built in; how a send reads is told from what is in
   it: a booking's day and time, an arrival's minutes, a quote or an
   invoice. A short reply to a booking ("YES") is said on the booking's own
   row, and an invoice emailed and texted within five minutes is one row.

   THE REST IS A CONVERSATION. The customer's and the team's own messages
   on one day are one thread, oldest first inside: the customer on the
   left, the team on the right, a name only where the speaker changes, the
   time under each, "Seen" where ServiceM8 saw an email opened. ServiceM8's
   sends from the thread's first message to the end of its day sit inside
   it as grey lines. The thread stands in the feed by its latest moment. */

/** One message, as the read hands it over: names resolved, text plain. */
export type CustomerMessage = {
  id: string;
  kind: "sms" | "email";
  /** the customer's, or the team's */
  side: "them" | "us";
  /** "2026-10-06 11:06:49", naive, on the account's clock */
  stamp: string;
  /** who said it, first name: a contact's or a staff member's; null unknown */
  name: string | null;
  subject: string | null;
  /** the words as plain text, never HTML */
  text: string;
  from: string | null;
  to: string | null;
  /** an outbound email ServiceM8 saw opened: when, naive */
  seenStamp: string | null;
  attachments: number;
  /** one of ServiceM8's own sends (the read decides: see templateMarked) */
  template: boolean;
};

export type SendSort = "booking" | "way" | "quote" | "invoice" | "other";

/** ServiceM8's own send, as a row of the feed. */
export type CustomerSend = {
  kind: "send";
  key: string;
  day: string;
  at: string;
  sort: SendSort;
  icon: "message" | "mail" | "car";
  /** bold: "Booking for Wed 14 Oct, 2:00 pm texted" */
  words: string;
  /** grey after the words: "Leonardo, about 23 minutes", "by email and text" */
  detail: string | null;
  /** grey and fading: a send of no known kind, its first words */
  opening: string | null;
  /** what it says inside a thread, as a grey centred line */
  line: string;
  /** a short reply to it, said on its row: "Piero: YES" */
  reply: string | null;
  seen: string | null;
  attachments: number;
};

export type ThreadBubble = {
  kind: "bubble";
  key: string;
  side: "them" | "us";
  /** said only where the speaker changes */
  name: string | null;
  words: string;
  time: string;
  seen: string | null;
  attachments: number;
  full: { subject: string | null; from: string | null; to: string | null; when: string; text: string };
};

export type ThreadLine = ThreadBubble | { kind: "line"; key: string; words: string; reply: string | null };

export type CustomerThread = {
  kind: "thread";
  key: string;
  day: string;
  /** its latest moment, where it stands in the feed */
  at: string;
  icon: "message" | "mail";
  /** "Email with Piero", "Text with Piero", "Email and text with Piero" */
  title: string;
  subject: string | null;
  lines: ThreadLine[];
};

export type CustomerItem = CustomerSend | CustomerThread;

/* ── telling ServiceM8's sends ── */

const LINK = /\bsm8\.link\//i;
const ARRIVAL = /track\s+my\s+arrival/i;
const YES_TO_CONFIRM = /\byes\b['"’]?\s+to\s+confirm|\breply\s+(?:with\s+)?['"’]?yes\b/i;

/** Carries one of ServiceM8's own marks. */
export function templateMarked(text: string): boolean {
  return LINK.test(text) || ARRIVAL.test(text) || YES_TO_CONFIRM.test(text);
}

/** The opening a template is known by: the greeting line ("Hi Piero,")
    dropped, and the first forty characters or so of the rest, cut at a
    word, as an ilike pattern of its words, so a name, a number or a line
    break between them never hides the same send. Null when there is too
    little to know it by. */
export function openingPattern(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines[0]!.length <= 32 && /[,!]$/.test(lines[0]!)) lines.shift();
  const rest = lines.join(" ").replace(/\s+/g, " ").trim();
  if (rest.length < 24) return null;
  const cut = rest.slice(0, 44);
  const head = rest.length > 44 ? cut.slice(0, Math.max(cut.lastIndexOf(" "), 24)) : cut;
  const words = head.split(/[^A-Za-z]+/).filter((w) => w.length > 0);
  if (words.length < 4) return null;
  return `%${words.join("%")}%`;
}

/** A send's opening for the eye: its words after the greeting. */
function openingWords(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines[0]!.length <= 32 && /[,!]$/.test(lines[0]!)) lines.shift();
  return lines.join(" ").replace(/\s+/g, " ").trim().slice(0, 120);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The day and time a booking text offers: "2:00 PM on Wednesday 14th
    October 2026", "7:30am Fri 16 Oct", "16/10/2026 at 7:30 AM". Null when
    either can't be read. `year` is the message's own, for a day without one. */
export function bookingWhen(text: string, year: number): { day: string; minutes: number } | null {
  const t = /\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s?m\b\.?/i.exec(text);
  if (!t) return null;
  let h = Number(t[1]);
  const min = Number(t[2] ?? 0);
  if (h < 1 || h > 12 || min > 59) return null;
  if (t[3]!.toLowerCase() === "p" && h !== 12) h += 12;
  if (t[3]!.toLowerCase() === "a" && h === 12) h = 0;
  let d: number | null = null;
  let m: number | null = null;
  let y = year;
  const named = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?/i.exec(text);
  const numeric = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(text);
  if (named) {
    d = Number(named[1]);
    m = MONTHS.indexOf(named[2]!.toLowerCase().slice(0, 3)) + 1;
    if (named[3]) y = Number(named[3]);
  } else if (numeric) {
    d = Number(numeric[1]);
    m = Number(numeric[2]);
    y = Number(numeric[3]!.length === 2 ? `20${numeric[3]}` : numeric[3]);
  }
  if (!d || !m || m < 1 || m > 12 || d > 31) return null;
  const day = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (!fmtAuWeekdayDayMonth(day)) return null;
  return { day, minutes: h * 60 + min };
}

/** "about 23 minutes", where an arrival text says how long. */
function arrivalMinutes(text: string): string | null {
  const m = /\b(\d{1,3})\s*(?:min|mins|minutes)\b/i.exec(text);
  return m ? `about ${Number(m[1])} minutes` : null;
}

/** An amount an invoice states: "$13200.00", "$13,200". */
function amountCents(text: string): number | null {
  const m = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/.exec(text);
  if (!m) return null;
  return Number(m[1]!.replace(/,/g, "")) * 100 + Number(m[2] ?? 0);
}

function sortOf(m: CustomerMessage): SendSort {
  const said = `${m.subject ?? ""}\n${m.text}`;
  if (YES_TO_CONFIRM.test(m.text)) return "booking";
  if (ARRIVAL.test(m.text) || /\bon\s+the\s+way\b/i.test(m.text)) return "way";
  /* a quote or an invoice goes WITH something: the paper attached, or
     ServiceM8's link to it. A follow-up that only names the quote is not
     the quote going out */
  const carries = m.attachments > 0 || LINK.test(m.text);
  if (carries && /\binvoice\b/i.test(said)) return "invoice";
  if (carries && /\bquot(?:e|ation)\b/i.test(said)) return "quote";
  return "other";
}

/* ── the clock ── */

const dayOf = (stamp: string) => stamp.slice(0, 10);
const minutesOf = (stamp: string) => {
  const m = /[ T](\d{2}):(\d{2})/.exec(stamp);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** "11:53 am" off a naive stamp; "" without a clock. */
export const clockOf = (stamp: string) => {
  const m = minutesOf(stamp);
  return m === null ? "" : clock12(m);
};
/** Seconds since 2000, for the gaps between messages: naive stamps on one clock. */
const secondsOf = (stamp: string) => {
  const t = Date.parse(`${stamp.slice(0, 19).replace(" ", "T")}Z`);
  return Number.isNaN(t) ? 0 : t / 1000;
};

/** "Seen 9:56 am", or with its day when it was seen another day. */
function seenWords(m: CustomerMessage): string | null {
  if (m.kind !== "email" || m.side !== "us" || !m.seenStamp) return null;
  const clock = clockOf(m.seenStamp);
  if (!clock) return null;
  return dayOf(m.seenStamp) === dayOf(m.stamp) ? `Seen ${clock}` : `Seen ${fmtAuWeekdayDayMonth(dayOf(m.seenStamp))}, ${clock}`;
}

/** A subject said once: Re: and Fwd: off its front. */
export function bareSubject(subject: string | null): string | null {
  const s = (subject ?? "").replace(/^(?:\s*(?:re|fw|fwd)\s*:\s*)+/i, "").trim();
  return s || null;
}

/* ── the feed ── */

type Draft = { msgs: CustomerMessage[]; sort: SendSort; reply: string | null };

export function customerFeed(
  messages: readonly CustomerMessage[],
  opts: { customer: string; money: boolean; staffOf?: (m: CustomerMessage) => string | null },
): CustomerItem[] {
  const all = [...messages].sort((a, b) => (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : 0));
  /* A TEMPLATE THE CUSTOMER ANSWERED starts the conversation (the walk of
     26 October 2026: Piero's 10:03 reply opened a thread whose first half
     was missing). An email of ServiceM8's is answered when an email of the
     customer's comes back to it: under its subject, Re: and Fwd: aside,
     within the week, or as the next email they sent that day. It is then the team's first
     bubble, named for who sent it, with its Seen. Templates nobody answered
     stay as rows. */
  const answered = new Set<CustomerMessage>();
  for (const t of all) {
    if (!(t.side === "us" && t.template && t.kind === "email")) continue;
    const subject = bareSubject(t.subject)?.toLowerCase() ?? null;
    const at = secondsOf(t.stamp);
    const back = all.some(
      (m) =>
        m.side === "them" &&
        m.kind === "email" &&
        m.stamp > t.stamp &&
        /* under its subject within the week, or the next email they sent that day */
        ((subject !== null && bareSubject(m.subject)?.toLowerCase() === subject && secondsOf(m.stamp) - at <= 7 * 86_400) ||
          dayOf(m.stamp) === dayOf(t.stamp)),
    );
    if (back) answered.add(t);
  }
  const sends: Draft[] = [];
  const real: CustomerMessage[] = [];
  for (const m of all) {
    if (m.side === "us" && m.template && !answered.has(m)) sends.push({ msgs: [m], sort: sortOf(m), reply: null });
    else real.push(m);
  }

  /* A SHORT REPLY TO A BOOKING ("YES") is said on the booking's row: the
     latest booking before it, within a day, that has no answer yet */
  const talk: CustomerMessage[] = [];
  for (const m of real) {
    const words = m.text.trim();
    if (m.side === "them" && words.length > 0 && words.length <= 12) {
      const at = secondsOf(m.stamp);
      const booking = [...sends]
        .reverse()
        .find((s) => s.sort === "booking" && !s.reply && s.msgs[0]!.stamp <= m.stamp && at - secondsOf(s.msgs[0]!.stamp) <= 86_400);
      if (booking) {
        booking.reply = `${m.name ?? opts.customer}: ${words}`;
        continue;
      }
    }
    talk.push(m);
  }

  /* ONE INVOICE, EMAILED AND TEXTED within five minutes, is one row */
  const merged: Draft[] = [];
  for (const s of sends) {
    const prev = merged.at(-1);
    const m = s.msgs[0]!;
    const pair =
      prev &&
      (s.sort === "invoice" || s.sort === "quote") &&
      prev.sort === s.sort &&
      prev.msgs.length === 1 &&
      prev.msgs[0]!.kind !== m.kind &&
      secondsOf(m.stamp) - secondsOf(prev.msgs[0]!.stamp) <= 300;
    if (pair) prev.msgs.push(m);
    else merged.push(s);
  }

  const sendOf = (s: Draft): CustomerSend => {
    const first = s.msgs[0]!;
    const last = s.msgs.at(-1)!;
    const kinds = new Set(s.msgs.map((m) => m.kind));
    const both = kinds.size > 1;
    const verb = both ? "sent" : first.kind === "sms" ? "texted" : "emailed";
    const by = both ? "by email and text" : null;
    const email = s.msgs.find((m) => m.kind === "email") ?? null;
    const seen = email ? seenWords(email) : null;
    const attachments = s.msgs.reduce((n, m) => n + m.attachments, 0);
    let words: string;
    let detail: string | null = by;
    let opening: string | null = null;
    let line: string;
    let icon: CustomerSend["icon"] = first.kind === "sms" ? "message" : "mail";
    if (s.sort === "booking") {
      const when = bookingWhen(first.text, Number(first.stamp.slice(0, 4)));
      words = when ? `Booking for ${fmtAuWeekdayDayMonth(when.day)}, ${clock12(when.minutes)} ${verb}` : `Booking request ${verb}`;
      line = when
        ? when.day === dayOf(first.stamp)
          ? `Booking for ${clock12(when.minutes)} ${verb}`
          : words
        : words;
    } else if (s.sort === "way") {
      icon = "car";
      words = `On the way ${verb}`;
      const mins = arrivalMinutes(first.text);
      detail = [opts.staffOf?.(first) ?? null, mins].filter(Boolean).join(", ") || null;
      line = mins ? `${words}, ${mins}` : words;
    } else if (s.sort === "quote") {
      words = `Quote ${verb}`;
      line = by ? `${words} ${by}` : words;
    } else if (s.sort === "invoice") {
      const cents = opts.money ? (s.msgs.map((m) => amountCents(m.text)).find((c) => c !== null) ?? null) : null;
      words = cents !== null ? `Invoice ${verb}, ${fmtAud(cents)}` : `Invoice ${verb}`;
      line = by ? `${words} ${by}` : words;
    } else {
      words = verb === "texted" ? "Texted" : verb === "emailed" ? "Emailed" : "Sent";
      opening = openingWords(first.text) || null;
      line = opening ? `${words}: ${opening}` : words;
    }
    return {
      kind: "send",
      key: `send:${first.id}`,
      day: dayOf(first.stamp),
      at: last.stamp,
      sort: s.sort,
      icon,
      words,
      detail,
      opening,
      line,
      reply: s.reply,
      seen,
      attachments,
    };
  };

  /* THE THREADS: the day's own messages, and ServiceM8's sends from the
     first of them to the end of the day */
  const items: CustomerItem[] = [];
  const byDay = new Map<string, CustomerMessage[]>();
  for (const m of talk) byDay.set(dayOf(m.stamp), [...(byDay.get(dayOf(m.stamp)) ?? []), m]);
  const inside = new Set<Draft>();
  for (const [day, msgs] of byDay) {
    const start = msgs[0]!.stamp;
    const within = merged.filter((s) => dayOf(s.msgs[0]!.stamp) === day && s.msgs[0]!.stamp >= start);
    within.forEach((s) => inside.add(s));
    const moments = [
      ...msgs.map((m) => ({ at: m.stamp, msg: m, send: null as Draft | null })),
      ...within.map((s) => ({ at: s.msgs[0]!.stamp, msg: null as CustomerMessage | null, send: s })),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const lines: ThreadLine[] = [];
    let speaker: string | null = null;
    for (const mo of moments) {
      if (mo.send) {
        const send = sendOf(mo.send);
        lines.push({ kind: "line", key: send.key, words: send.line, reply: send.reply });
        speaker = null;
        continue;
      }
      const m = mo.msg!;
      const who = `${m.side}:${m.name ?? ""}`;
      lines.push({
        kind: "bubble",
        key: `msg:${m.id}`,
        side: m.side,
        name: who === speaker ? null : (m.name ?? (m.side === "them" ? opts.customer : "ServiceM8")),
        /* a bubble reads as a text does: the paragraphs' blank lines closed up */
        words: m.text.trim().replace(/\n\s*\n+/g, "\n"),
        time: clockOf(m.stamp),
        seen: seenWords(m),
        attachments: m.attachments,
        full: { subject: m.subject, from: m.from, to: m.to, when: `${fmtAuWeekdayDayMonth(day)}, ${clockOf(m.stamp)}`, text: m.text.trim() },
      });
      speaker = who;
    }
    const kinds = new Set(msgs.map((m) => m.kind));
    const how = kinds.size > 1 ? "Email and text" : kinds.has("email") ? "Email" : "Text";
    const latest = moments.at(-1)!;
    const subject = bareSubject(msgs.find((m) => m.kind === "email" && m.subject)?.subject ?? null);
    items.push({
      kind: "thread",
      key: `thread:${day}`,
      day,
      at: latest.send ? latest.send.msgs.at(-1)!.stamp : latest.at,
      icon: kinds.has("email") ? "mail" : "message",
      title: `${how} with ${opts.customer}`,
      subject,
      lines,
    });
  }
  for (const s of merged) if (!inside.has(s)) items.push(sendOf(s));
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** The feed's own rows ServiceM8's sends already say: a "Quote sent" or an
    "Invoice raised" on a day a quote or an invoice went out, so the job
    reads one row, not two. */
export function withoutEchoes(story: readonly StoryEntry[], customer: readonly CustomerItem[]): StoryEntry[] {
  const sent = new Set<string>();
  const walk = (s: CustomerSend) => {
    if (s.sort === "quote") sent.add(`Quote sent:${s.day}`);
    if (s.sort === "invoice") sent.add(`Invoice raised:${s.day}`);
  };
  for (const c of customer) if (c.kind === "send") walk(c);
  /* a send inside a thread still went out: its line names the sort */
  for (const c of customer) {
    if (c.kind !== "thread") continue;
    for (const l of c.lines) {
      if (l.kind !== "line") continue;
      if (/^Quote\b/.test(l.words)) sent.add(`Quote sent:${c.day}`);
      if (/^Invoice\b/.test(l.words)) sent.add(`Invoice raised:${c.day}`);
    }
  }
  if (sent.size === 0) return [...story];
  return story.filter((e) => !(e.kind === "milestone" && sent.has(`${e.label}:${e.day}`)));
}

/** An email's HTML as plain text, for the rare one ServiceM8 sent with no
    text part: tags out, breaks kept, the common entities read. Never drawn
    as HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A phone as the contacts write it, for matching: +61 4… is 04…. */
export function phoneKey(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("61") && d.length === 11) return `0${d.slice(2)}`;
  return d;
}
