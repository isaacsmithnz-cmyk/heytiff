import { supabaseAdmin } from "@/lib/supabase-server";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { emailsByUser } from "@/lib/staff/query";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { remindAtFrom } from "./reminders";
import { reminderDigest, type DigestItem } from "./reminder-digest";

/* The morning reminder email — the run.

   WHAT IT SENDS. For each person in each workspace: one letter listing their
   open reminders whose time falls today (in the workspace's zone) or fell on
   an earlier day without being ticked off — provided that reminder has not
   already been in a letter. Then it stamps `reminder_emailed_at` on the ones
   it sent, which is the only reason it can promise "once per reminder".
   task_reminders.sql reserved that column for exactly this.

   WHY A DIGEST AND NOT A NUDGE PER TASK. The bell already nudges at the
   minute for anyone in the app. Email is for the person who is not, and a
   person who is not in the app at 6:30 does not want six emails by 9; they
   want the morning's list once. Vercel's schedule runs this once a day, in
   the morning for every Australian zone (see api/cron/reminders).

   WHO GETS IT. The address on the person's login profile, falling back to
   the contact address on their staff card. Nobody with neither is emailed,
   and the run says how many that was.

   UNCONFIGURED IS A RESULT. Preview deploys and local runs have no mail key;
   they report `configured: false` and touch nothing — a reminder is never
   stamped as sent because a letter was composed. */

export type DigestRun = {
  configured: boolean;
  /** Workspaces with at least one reminder due today. */
  orgs: number;
  /** People who received a letter. */
  people: number;
  /** Reminders carried in letters that left. */
  tasks: number;
  sent: number;
  failed: number;
  /** People with reminders due and no address to send to. */
  noAddress: number;
};

/** Far enough ahead of a morning run to reach the end of today in any
    Australian zone; the per-workspace filter below does the exact cut. */
const LOOKAHEAD_MS = 18 * 3_600_000;

type Row = Record<string, unknown>;

const groupBy = <T>(rows: T[], key: (r: T) => string): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
};

/** A first name for the greeting, off the staff card; null rather than a guess. */
function firstNameOf(s: Row | undefined): string | null {
  if (!s) return null;
  const preferred = typeof s.preferred_name === "string" ? s.preferred_name.trim() : "";
  const first = typeof s.first_name === "string" ? s.first_name.trim() : "";
  const full = typeof s.full_name === "string" ? s.full_name.trim().split(/\s+/)[0] : "";
  return preferred || first || full || null;
}

export async function sendReminderDigests(baseUrl: string, now: Date = new Date()): Promise<DigestRun> {
  const run: DigestRun = {
    configured: isEmailConfigured(),
    orgs: 0,
    people: 0,
    tasks: 0,
    sent: 0,
    failed: 0,
    noAddress: 0,
  };
  if (!run.configured) return run;

  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("id, org_id, assigned_to, title, detail, remind_at")
    .eq("status", "open")
    .not("remind_at", "is", null)
    .is("reminder_emailed_at", null)
    .lte("remind_at", new Date(now.getTime() + LOOKAHEAD_MS).toISOString())
    .order("remind_at", { ascending: true });
  if (error || !data || data.length === 0) return run;

  for (const [orgId, orgRows] of groupBy(data as Row[], (r) => String(r.org_id))) {
    const tz = await getSm8Timezone(orgId);
    const today = todayInZone(tz, now);
    /* The exact cut: a reminder is today's if its instant falls before the
       workspace's midnight tonight. Composed the way every reminder instant
       is, so the two clocks cannot disagree about where the day ends. */
    const endOfToday = new Date(remindAtFrom(today, "23:59", tz) ?? now.toISOString()).getTime();
    const due = orgRows.filter((r) => new Date(String(r.remind_at)).getTime() <= endOfToday);
    if (due.length === 0) continue;
    run.orgs++;

    const byPerson = groupBy(due, (r) => String(r.assigned_to));
    const { data: staff } = await supabaseAdmin
      .from("staff_profiles")
      .select("id, user_id, contact_email, first_name, last_name, full_name, preferred_name")
      .eq("org_id", orgId)
      .in("id", [...byPerson.keys()]);
    const cards = (staff ?? []) as Row[];
    const logins = await emailsByUser(
      cards.map((c) => c.user_id).filter((u): u is string => typeof u === "string"),
    );

    for (const [staffId, tasks] of byPerson) {
      const card = cards.find((c) => String(c.id) === staffId);
      const login = card && typeof card.user_id === "string" ? logins.get(card.user_id) : undefined;
      const contact = typeof card?.contact_email === "string" && card.contact_email.trim() ? card.contact_email.trim() : null;
      const to = login ?? contact;
      if (!to) {
        run.noAddress++;
        continue;
      }

      const items: DigestItem[] = tasks.map((t) => {
        const day = todayInZone(tz, new Date(String(t.remind_at)));
        return {
          title: String(t.title),
          detail: typeof t.detail === "string" && t.detail ? t.detail : null,
          day,
          overdue: day < today,
        };
      });
      const { subject, html } = reminderDigest({ baseUrl, firstName: firstNameOf(card), today, items });
      const res = await sendEmail({ to, subject, html });
      if (!res.ok) {
        run.failed++;
        // the provider's words go to the log, never to a screen
        if (res.reason === "failed") console.error("Reminder digest failed:", res.detail);
        continue;
      }
      run.people++;
      run.sent++;
      run.tasks += tasks.length;
      await supabaseAdmin
        .from("tasks")
        .update({ reminder_emailed_at: now.toISOString() })
        .in("id", tasks.map((t) => String(t.id)));
    }
  }
  return run;
}
