"use server";

import { auth0 } from "@/lib/auth0";
import { getViewerName } from "@/lib/staff/query";
import { mintRealtimeToken } from "@/lib/realtime/token";

/* WHO IS LOOKING, FOR LIVE RECORDS (components/records/use-record-presence).

   A signed-in member of a workspace gets an hour's ticket to that
   workspace's record channels, and the name the others see them by. Null
   when the deployment has switched live records off
   (`NEXT_PUBLIC_LIVE_RECORDS=0`), when there is no session, or when it has
   no JWT secret to sign with — a card then simply says nothing about who
   else has it open. */

export type RealtimeTicket = {
  token: string;
  expiresAt: number;
  orgId: string;
  me: { id: string; name: string };
};

export async function realtimeTicket(): Promise<RealtimeTicket | null> {
  if (process.env.NEXT_PUBLIC_LIVE_RECORDS === "0") return null;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  const fallback = (session?.user?.name as string) || "Someone";
  const viewer = await getViewerName(orgId, userId, fallback);
  const { token, expiresAt } = mintRealtimeToken({ userId, orgId }, secret, Date.now());
  return { token, expiresAt, orgId, me: { id: userId, name: viewer.first || viewer.full } };
}
