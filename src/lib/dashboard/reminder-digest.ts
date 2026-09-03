import { renderLetter, escapeHtml, type Letter } from "@/lib/brand/auth0/email-shell";
import { brandAssets } from "@/lib/brand/auth0/assets";
import { fmtAuWeekdayDateLong } from "@/lib/au-dates";

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
};

export function reminderDigest(input: DigestInput): { subject: string; html: string } {
  const home = input.baseUrl.replace(/\/+$/, "");
  const n = input.items.length;
  const dayText = fmtAuWeekdayDateLong(input.today) || input.today;
  const name = input.firstName?.trim() || null;
  const overdue = input.items.filter((i) => i.overdue).length;

  const lines = input.items.map((i) => {
    const since = i.overdue ? ` <i>(from ${escapeHtml(fmtAuWeekdayDateLong(i.day) || i.day)})</i>` : "";
    return `<b>${escapeHtml(i.title)}</b>${i.detail ? ` — ${escapeHtml(i.detail)}` : ""}${since}`;
  });

  const opener =
    n === 1 ? "you asked to be reminded about this today." : "here is what you asked to be reminded about today.";
  const late =
    overdue === 0
      ? ""
      : overdue === 1
        ? " One of them came due earlier and hasn't been ticked off."
        : ` ${overdue} of them came due earlier and haven't been ticked off.`;

  const letter: Letter = {
    preheader: n === 1 ? input.items[0].title : `${n} things you asked to be reminded about.`,
    heading: n === 1 ? "A reminder for today" : `${n} reminders for today`,
    body: [`${name ? `Hi ${escapeHtml(name)} — ` : ""}${opener}${late}`, ...lines],
    action: { label: "Open HeyTiff", href: `${home}/dashboard` },
    footnotes: [
      "Snooze or tick these off from the bell in HeyTiff. This email is sent once per reminder, the morning it falls due.",
      "A renewal reminder moves with the expiry when the renewal is recorded.",
    ],
  };

  return {
    subject: n === 1 ? `Reminder: ${input.items[0].title}` : `${n} reminders for ${dayText}`,
    html: renderLetter(letter, brandAssets(home)),
  };
}
