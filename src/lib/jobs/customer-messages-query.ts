import { supabaseAdmin } from "@/lib/supabase-server";
import {
  customerFeed,
  htmlToText,
  withoutQuoted,
  openingPattern,
  phoneKey,
  templateMarked,
  type CustomerItem,
  type CustomerMessage,
} from "./customer-messages";

/* THE CUSTOMER'S TEXTS AND EMAILS ON ONE JOB (Isaac, 26 October 2026, "Yes
   build"): ServiceM8's job communication history as the sync mirrored it
   (sm8_job_messages, #1271), read only, for the Overview's Activity feed.

   NO SESSION HERE: the conversation read's action established the right to
   ask (`workboard`, the diary's own gate) and that the job is this
   workspace's, and hands in the org.

   The newest 200 messages hung off the job. An email's words are its HTML
   read as text (never drawn), its text part only where that says nothing,
   and a reply's quote of what came before cut off. Names: the team's from
   sm8_staff by who sent it, the customer's from the job's own contacts,
   matched on the number or the address (+61 read as 0), else the job's
   first contact, else the number or address as it came.

   WHICH ARE SERVICEM8'S OWN SENDS, asked of the organisation's history:
   an outbound message whose opening (openingPattern) went out on five or
   more of its jobs, or one carrying ServiceM8's own marks. Each opening is
   asked once, for up to 30 openings a job, and a question that fails says
   "not a template", so a message is never hidden by a read that failed. */

const LIMIT = 200;
const ASK_AT_MOST = 30;
const JOBS_FOR_A_TEMPLATE = 5;

type Row = { uuid: string; kind: string; direction: string | null; raw: Record<string, unknown> | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || null;

/** to_email comes as a JSON array written as text, or an array, or one address. */
function addresses(v: unknown): string | null {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(", ") || null;
  const s = str(v);
  if (!s) return null;
  try {
    const parsed: unknown = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string").join(", ") || null;
  } catch {
    /* one address, as written */
  }
  return s;
}

function countOf(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  const s = str(v);
  if (!s) return 0;
  try {
    const parsed: unknown = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export async function readCustomerMessages(input: { orgId: string; jobUuid: string; money: boolean }): Promise<CustomerItem[]> {
  const { orgId, jobUuid, money } = input;
  const { data, error } = await supabaseAdmin
    .from("sm8_job_messages")
    .select("uuid, kind, direction, raw")
    .eq("org_id", orgId)
    .eq("related_object_uuid", jobUuid)
    .order("raw->>timestamp", { ascending: false })
    .limit(LIMIT);
  if (error) return [];
  const rows = ((data ?? []) as Row[]).filter((r) => r.raw && (r.kind === "sms" || r.kind === "email"));
  if (rows.length === 0) return [];

  const staffIds = [...new Set(rows.map((r) => str(r.raw!.sent_by_staff_uuid)).filter((x): x is string => !!x))];
  const [contactsRes, staffRes] = await Promise.all([
    supabaseAdmin.from("sm8_job_contacts").select("first, last, mobile, phone, email").eq("org_id", orgId).eq("active", 1).eq("job_uuid", jobUuid),
    staffIds.length
      ? supabaseAdmin.from("sm8_staff").select("uuid, first, last").eq("org_id", orgId).in("uuid", staffIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const contacts = ((contactsRes.data ?? []) as { first: string | null; last: string | null; mobile: string | null; phone: string | null; email: string | null }[]);
  const staff = new Map(
    ((staffRes.data ?? []) as { uuid: string; first: string | null; last: string | null }[]).map((s) => [s.uuid.toLowerCase(), s]),
  );
  const contactFor = (phone: string | null, email: string | null) => {
    const p = phoneKey(phone);
    const e = (email ?? "").trim().toLowerCase();
    return (
      contacts.find((c) => (p && (phoneKey(c.mobile) === p || phoneKey(c.phone) === p)) || (e && (c.email ?? "").trim().toLowerCase() === e)) ?? null
    );
  };
  const anyContact = contacts.find((c) => (c.first ?? "").trim()) ?? null;

  /* the customer as the job knows them, for the thread's head */
  let customer: string | null = null;

  const messages: (CustomerMessage & { staffUuid: string | null; pattern: string | null })[] = rows.map((r) => {
    const raw = r.raw!;
    const kind = r.kind as "sms" | "email";
    const side = (r.direction ?? str(raw.direction)) === "inbound" ? ("them" as const) : ("us" as const);
    const text =
      kind === "sms"
        ? (str(raw.message) ?? "")
        : /* the HTML read as text first: ServiceM8's own text part joins a
             signature's lines; the text part only where there is no HTML,
             or it says nothing. What a reply quotes is cut off either way. */
          withoutQuoted(str(raw.message_html) ? htmlToText(String(raw.message_html)) : "") ||
          withoutQuoted(str(raw.message_text) ?? "");
    const fromPhone = str(raw.from_phone);
    const toPhone = str(raw.to_phone);
    const fromEmail = str(raw.from_email);
    const toEmail = addresses(raw.to_email);
    const staffUuid = str(raw.sent_by_staff_uuid);
    const s = staffUuid ? (staff.get(staffUuid.toLowerCase()) ?? null) : null;
    const theirs = side === "them" ? contactFor(fromPhone, fromEmail) : contactFor(toPhone, toEmail?.split(",")[0] ?? null);
    if (!customer && theirs?.first) customer = firstName(theirs.first);
    const name = side === "us" ? firstName(s?.first) : (firstName(theirs?.first) ?? firstName(anyContact?.first) ?? fromPhone ?? fromEmail);
    const staffName = s ? [s.first, s.last].map((x) => (x ?? "").trim()).filter(Boolean).join(" ") : null;
    return {
      id: r.uuid,
      kind,
      side,
      stamp: str(raw.timestamp) ?? "",
      name,
      subject: kind === "email" ? str(raw.subject) : null,
      text,
      from: side === "us" ? (staffName ?? fromEmail ?? fromPhone) : (fromEmail ?? fromPhone),
      to: kind === "email" ? toEmail : toPhone,
      seenStamp: kind === "email" && side === "us" && raw.opened !== false && raw.opened !== "false" ? str(raw.first_opened_at) : null,
      attachments: countOf(raw.attachment_uuids),
      template: side === "us" && templateMarked(text),
      staffUuid,
      pattern: side === "us" && !templateMarked(text) ? openingPattern(text) : null,
    };
  });

  /* ServiceM8's own sends, by how many of the organisation's jobs their opening went out on */
  const asks = [...new Set(messages.flatMap((m) => (m.pattern ? [`${m.kind}|${m.pattern}`] : [])))].slice(0, ASK_AT_MOST);
  const known = new Map<string, boolean>();
  await Promise.all(
    asks.map(async (ask) => {
      const [kind, pattern] = ask.split("|") as [string, string];
      try {
        const r = await supabaseAdmin
          .from("sm8_job_messages")
          .select("related_object_uuid")
          .eq("org_id", orgId)
          .eq("kind", kind)
          .eq("direction", "outbound")
          .neq("related_object_uuid", jobUuid)
          .ilike(kind === "sms" ? "raw->>message" : "raw->>message_text", pattern)
          .limit(40);
        const jobs = new Set(((r.data ?? []) as { related_object_uuid: string | null }[]).map((x) => x.related_object_uuid));
        known.set(ask, !r.error && jobs.size + 1 >= JOBS_FOR_A_TEMPLATE);
      } catch {
        known.set(ask, false);
      }
    }),
  );
  for (const m of messages) if (m.pattern && known.get(`${m.kind}|${m.pattern}`)) m.template = true;

  const who =
    customer ?? firstName(anyContact?.first) ?? messages.find((m) => m.side === "them")?.from ?? messages.find((m) => m.side === "us")?.to ?? "the customer";
  return customerFeed(
    messages.filter((m) => m.stamp),
    {
      customer: who,
      money,
      staffOf: (m) => {
        const id = (m as { staffUuid?: string | null }).staffUuid;
        return id ? firstName(staff.get(id.toLowerCase())?.first) : null;
      },
    },
  );
}
