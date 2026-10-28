import { after, type NextRequest } from "next/server";
import { signedByResend, tokenFromRecipients } from "@/lib/email/inbound";
import { noteEmailIn, orgForToken, takeEmailIn } from "@/lib/email/inbound-server";

/* Where Resend posts an email sent to Tiff (Isaac, 28 October 2026: "forward
   an email for a builder into tiff to create a job, read scope etc").

   THE PROOF IS THE SIGNATURE. Resend signs every post the Svix way with the
   webhook's secret (RESEND_INBOUND_SECRET); a post that isn't signed, or was
   signed more than five minutes ago, is 401 and nothing is read
   (inbound.ts, signedByResend). Without the secret set, nothing is taken
   here at all: 404.

   THE ADDRESS NAMES THE BUSINESS. The token in tiff-<token>@in.hey-tiff.com
   is looked up; an address that finds no one (made up, or replaced) is 200
   and dropped, so Resend doesn't retry a letter nobody will take.

   ONE ROW AN EMAIL, made before the answer, so a second delivery of the same
   post finds it and does nothing. The email itself is fetched, its sender
   checked and its files kept behind the answer (after()), because a tender
   set can be tens of megabytes and the post shouldn't wait for it. */

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_INBOUND_SECRET?.trim();
  if (!secret) return new Response("Not found", { status: 404 });
  const body = await request.text();
  const signed = signedByResend(body, { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, secret);
  if (!signed) return new Response("Invalid signature", { status: 401 });

  let post: { type?: string; data?: { email_id?: string; from?: string; subject?: string | null; to?: string[]; cc?: string[]; received_for?: string[] } };
  try {
    post = JSON.parse(body);
  } catch {
    return new Response("Bad body", { status: 400 });
  }
  if (post.type !== "email.received" || !post.data?.email_id) return new Response("Ignored", { status: 200 });
  const d = post.data;
  const token = tokenFromRecipients([...(d.to ?? []), ...(d.received_for ?? []), ...(d.cc ?? [])]);
  const orgId = token ? await orgForToken(token) : null;
  if (!orgId) {
    console.log("[email-in] an address that finds no one: dropped");
    return new Response("No such address", { status: 200 });
  }
  const row = await noteEmailIn(orgId, d.email_id!, d.from ?? "", d.subject ?? null);
  if (row === "again") return new Response("Already in", { status: 200 });
  if (!row) return new Response("Couldn't keep it", { status: 503 });
  after(async () => {
    const took = await takeEmailIn(row.id, orgId, d.email_id!);
    console.log(`[email-in] ${took}`);
  });
  return new Response("Taken", { status: 200 });
}
