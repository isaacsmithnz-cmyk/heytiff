import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normEmail } from "@/lib/integrations/match";
import { ALLOWED_TYPES, MAX_BYTES } from "@/lib/documents/files";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { addressOf, keptAttachments, nameOf, newEmailToken, senderVouchedFor, textOfEmail } from "./inbound";

/* EMAIL TO TIFF, on the database and at Resend (inbound.ts says why it is
   shaped this way). The address a business forwards to; which business and
   which person an email came from; and the email itself, taken in: fetched
   whole from Resend (the webhook carries no body), its sender checked, its
   words kept, its PDFs and pictures stored under the business's own path in
   the documents bucket until Create job files them on the job. Service
   role; the callers gate. */

const API = "https://api.resend.com";
/** Receiving needs a key with full access; a sending-only key is refused. */
const resendKey = () => process.env.RESEND_RECEIVING_KEY?.trim() || process.env.RESEND_API_KEY?.trim() || null;

export type EmailAddressView = { token: string; madeAt: string };

export async function readEmailAddress(orgId: string): Promise<EmailAddressView | null> {
  const { data } = await supabaseAdmin.from("email_in_addresses").select("token, made_at").eq("org_id", orgId).maybeSingle();
  return data ? { token: data.token as string, madeAt: data.made_at as string } : null;
}

/** A business's address, new: the old one, if any, stops finding it. */
export async function makeEmailAddress(orgId: string, by: string): Promise<EmailAddressView | null> {
  const token = newEmailToken();
  const madeAt = new Date().toISOString();
  const { error } = await supabaseAdmin.from("email_in_addresses").upsert({ org_id: orgId, token, made_by: by, made_at: madeAt }, { onConflict: "org_id" });
  return error ? null : { token, madeAt };
}

export async function orgForToken(token: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("email_in_addresses").select("org_id").eq("token", token).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

export type LastEmailIn = { at: string; fromName: string | null; fromAddress: string; subject: string | null; state: string };

export async function lastEmailIn(orgId: string): Promise<LastEmailIn | null> {
  const { data } = await supabaseAdmin
    .from("email_in_messages")
    .select("received_at, from_name, from_address, subject, state")
    .eq("org_id", orgId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data
    ? { at: data.received_at as string, fromName: (data.from_name as string | null) ?? null, fromAddress: data.from_address as string, subject: (data.subject as string | null) ?? null, state: data.state as string }
    : null;
}

export type TeamSender = { sub: string | null; staffId: string | null; name: string | null };

/** The person in the business an address belongs to: the email they sign in
    with, else the one on their card. Compared in code, trimmed and lower
    case, as the invite does (an `_` is a wildcard to ilike). */
export async function teamSender(orgId: string, address: string | null): Promise<TeamSender | null> {
  const want = normEmail(address);
  if (!want) return null;
  const { data: members } = await supabaseAdmin.from("memberships").select("user_id").eq("org_id", orgId);
  const subs = (members ?? []).map((m) => m.user_id as string).filter(Boolean);
  const { data: cards } = await supabaseAdmin.from("staff_profiles").select("id, user_id, contact_email, full_name").eq("org_id", orgId);
  const cardOf = (sub: string | null) => (cards ?? []).find((c) => sub && c.user_id === sub) ?? null;
  if (subs.length) {
    const { data: profs } = await supabaseAdmin.from("profiles").select("user_id, email, name").in("user_id", subs);
    const p = (profs ?? []).find((x) => normEmail(x.email as string | null) === want);
    if (p) {
      const card = cardOf(p.user_id as string);
      return { sub: p.user_id as string, staffId: (card?.id as string | undefined) ?? null, name: ((card?.full_name as string | null) ?? (p.name as string | null)) || null };
    }
  }
  const card = (cards ?? []).find((c) => normEmail(c.contact_email as string | null) === want);
  return card ? { sub: (card.user_id as string | null) ?? null, staffId: card.id as string, name: (card.full_name as string | null) ?? null } : null;
}

/** The email's row, made as it is announced, so a second delivery of the same
    webhook finds it and does nothing. */
export async function noteEmailIn(orgId: string, providerId: string, from: string, subject: string | null): Promise<{ id: string } | "again" | null> {
  const { data, error } = await supabaseAdmin
    .from("email_in_messages")
    .insert({ org_id: orgId, provider_id: providerId, from_address: addressOf(from) ?? from.slice(0, 320), from_name: nameOf(from), subject: subject?.slice(0, 500) ?? null })
    .select("id")
    .maybeSingle();
  if (error) return error.code === "23505" ? "again" : null;
  return data ? { id: data.id as string } : null;
}

type Received = {
  from?: string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  authentication?: { spf?: string | null; dkim?: string | null; dmarc?: string | null } | null;
};
type Attachment = { id: string; filename?: string | null; content_type?: string | null; content_disposition?: string | null; size?: number | null; download_url?: string | null };

async function resend<T>(path: string): Promise<T | null> {
  const key = resendKey();
  if (!key) return null;
  try {
    const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
    if (!r.ok) {
      console.error(`[email-in] resend ${path.split("/").slice(0, 3).join("/")} answered ${r.status}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (err) {
    console.error("[email-in] resend unreachable", err instanceof Error ? err.message : err);
    return null;
  }
}

export type KeptFile = { name: string; contentType: string; size: number; path: string };

/** An email taken in: fetched whole, its sender checked (one of the business's
    own people, vouched for by their mail server, or it is refused and its words
    aren't kept), its words and files kept. What's left for Tiff to read is the
    row. Returns what became of it. */
export async function takeEmailIn(rowId: string, orgId: string, providerId: string): Promise<"received" | "refused" | "failed"> {
  const email = await resend<Received>(`/emails/receiving/${encodeURIComponent(providerId)}`);
  if (!email) {
    await supabaseAdmin.from("email_in_messages").update({ state: "failed", why: "The email couldn't be read from Resend." }).eq("id", rowId);
    return "failed";
  }
  const sender = await teamSender(orgId, addressOf(email.from));
  if (!sender || !senderVouchedFor(email.authentication)) {
    await supabaseAdmin
      .from("email_in_messages")
      .update({ state: "refused", why: sender ? "Its sender's mail server didn't vouch for it." : "It didn't come from anyone on the team." })
      .eq("id", rowId);
    return "refused";
  }
  const listed = await resend<{ data?: Attachment[] }>(`/emails/receiving/${encodeURIComponent(providerId)}/attachments`);
  const { kept, skipped } = keptAttachments(listed?.data ?? [], ALLOWED_TYPES, MAX_BYTES);
  const files: KeptFile[] = [];
  for (const [n, a] of kept.entries()) {
    if (!a.download_url) continue;
    try {
      const r = await fetch(a.download_url, { cache: "no-store" });
      if (!r.ok) {
        skipped.push(a.filename || "a file");
        continue;
      }
      const bytes = Buffer.from(await r.arrayBuffer());
      const path = `org/${orgId}/email_in/${rowId}/${n + 1}.${a.ext}`;
      const stored = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).upload(path, bytes, { contentType: a.content_type ?? undefined, upsert: true });
      if (stored.error) {
        skipped.push(a.filename || "a file");
        continue;
      }
      files.push({ name: (a.filename || `file ${n + 1}.${a.ext}`).slice(0, 200), contentType: (a.content_type ?? "").toLowerCase(), size: bytes.byteLength, path });
    } catch {
      skipped.push(a.filename || "a file");
    }
  }
  const body = textOfEmail(email.text, email.html);
  const { error } = await supabaseAdmin
    .from("email_in_messages")
    .update({
      sender_sub: sender.sub,
      subject: email.subject?.slice(0, 500) ?? null,
      body,
      files,
      state: "received",
      why: skipped.length ? `Not kept: ${skipped.join(", ")}`.slice(0, 1000) : null,
    })
    .eq("id", rowId);
  return error ? "failed" : "received";
}
