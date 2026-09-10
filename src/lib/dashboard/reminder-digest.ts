import { renderLetter, escapeHtml, type Letter } from "@/lib/brand/auth0/email-shell";
import { brandAssets } from "@/lib/brand/auth0/assets";
import { fmtAuWeekdayDateLong } from "@/lib/au-dates";
import type { ExpiringItem } from "./expiring";

/* The morning reminder email — the letter, pure.

   ONE LETTER A DAY, NOT ONE PER REMINDER. The bell nudges at the minute; the
   email is the morning's list for the person who was not in the app to see
   the bell. A renewal reminder set for 30 days before the rego expires lands
   here the morning it falls due, beside "call the electrician back" if that
   was also today. Anything that came due on an earlier day and was never
   ticked off rides along, marked as such, until it is.

   EVERYTHING VARIABLE WAS TYPED BY SOMEBODY. Titles and details are people's
   own words (or the vehicle's name, which somebody typed), so the body
   escapes them at its edge; the subject is not HTML and goes in plain. Same
   rule as the invitation letter, and the same envelope. */

export type DigestItem = {
  title: string;
  detail: string | null;
  /** The day the nudge was set for, in the workspace's zone. */
  day: string;
  /** Set for a day before today: came due earlier and is still open. */
  overdue: boolean;
};

export type DigestInput = {
  baseUrl: string;
  firstName: string | null;
  /** Today in the workspace's zone, ISO. */
  today: string;
  items: DigestItem[];
  /** What is inside the org's expiry window for this person — the bell's own
      expiry chips, worst first (lib/dashboard/expiring.ts). A status, not a
      reminder: it is here every morning while it is true. Absent or empty
      when the org's email switch is off or nothing is expiring. */
  expiring?: ExpiringItem[];
};

export function reminderDigest(input: DigestInput): { subject: string; html: string } {
  const home = input.baseUrl.replace(/\/+$/, "");
  const n = input.items.length;
  const expiring = input.expiring ?? [];
  const m = expiring.length;
  const dayText = fmtAuWeekdayDateLong(input.today) || input.today;
  const name = input.firstName?.trim() || null;
  const overdue = input.items.filter((i) => i.overdue).length;

  const lines = input.items.map((i) => {
    const since = i.overdue ? ` <i>(from ${escapeHtml(fmtAuWeekdayDateLong(i.day) || i.day)})</i>` : "";
    return `<b>${escapeHtml(i.title)}</b>${i.detail ? ` — ${escapeHtml(i.detail)}` : ""}${since}`;
  });
  /* The expiry lines are the chips' own words — "Rego expires in 5 days",
     "ARC authorisation expired 3 days ago" — with the subject beside them.
     They are generated text, not typed, but they pass through the same
     escape as everything else: a vehicle's name is typed. */
  const expiryLines = expiring.map((e) => `<b>${escapeHtml(e.label)}</b> — ${escapeHtml(e.subject)}`);

  const late =
    overdue === 0
      ? ""
      : overdue === 1
        ? " One of them came due earlier and hasn't been ticked off."
        : ` ${overdue} of them came due earlier and haven't been ticked off.`;

  /* Three letters, one shape. Reminders only reads exactly as it always did.
     Expiries only says what it is. Both leads with the reminders — the
     things somebody asked for — and files the expiries under their own line. */
  const greet = name ? `Hi ${escapeHtml(name)} — ` : "";
  let heading: string;
  let preheader: string;
  let subject: string;
  let body: string[];
  if (m === 0) {
    const opener =
      n === 1 ? "you asked to be reminded about this today." : "here is what you asked to be reminded about today.";
    heading = n === 1 ? "A reminder for today" : `${n} reminders for today`;
    preheader = n === 1 ? input.items[0].title : `${n} things you asked to be reminded about.`;
    subject = n === 1 ? `Reminder: ${input.items[0].title}` : `${n} reminders for ${dayText}`;
    body = [`${greet}${opener}${late}`, ...lines];
  } else if (n === 0) {
    heading = m === 1 ? "Something is expiring" : `${m} things are expiring`;
    preheader = m === 1 ? expiring[0].label : `${m} things inside your expiry window.`;
    subject = m === 1 ? `Expiring: ${expiring[0].label}` : `${m} things expiring — ${dayText}`;
    body = [`${greet}${m === 1 ? "this is inside your expiry window." : "here is what is inside your expiry window."}`, ...expiryLines];
  } else {
    const rWord = n === 1 ? "reminder" : "reminders";
    const eWord = m === 1 ? "expiry" : "expiries";
    heading = `${n + m} things for today`;
    preheader = `${n} ${rWord} and ${m} ${eWord}.`;
    subject = `${n} ${rWord} and ${m} ${eWord} for ${dayText}`;
    body = [`${greet}here is what you asked to be reminded about today.${late}`, ...lines, "<b>Expiring</b>", ...expiryLines];
  }

  const footnotes = [
    ...(n > 0
      ? [
          "Snooze or tick reminders off from the bell in HeyTiff. This email is sent once per reminder, the morning it falls due.",
        ]
      : []),
    ...(m > 0
      ? [
          "Expiring items are listed each morning while they sit inside the warning window set on Organisation → Your business.",
        ]
      : []),
  ];

  const letter: Letter = {
    preheader,
    heading,
    body,
    action: { label: "Open HeyTiff", href: `${home}/dashboard` },
    footnotes,
  };

  return { subject, html: renderLetter(letter, brandAssets(home)) };
}
