import { createHmac } from "node:crypto";

/* A TICKET TO LIVE RECORDS — a short-lived token Supabase Realtime trusts.

   The app reaches the database with the service role, on the server, and
   Auth0 is who signs people in; Supabase has never known who is looking. A
   private Realtime channel has to: it lets someone hear and speak only on
   their own workspace's topics, by a policy on `realtime.messages`
   (docs/migrations/realtime_records.sql) that reads the token.

   So the server, which knows the session, signs one: HS256 with the
   project's JWT secret, the `authenticated` role, an hour long. Its
   workspace rides in a claim of its own, `heytiff_org`, and NOT in
   `org_id`: five tables already have policies that read `org_id`
   (invitations among them), and this token must open nothing but the
   channels. Pure: the clock and the secret are handed in. */

export const REALTIME_TOKEN_SECONDS = 60 * 60;

/** The claim the channel policy reads. */
export const ORG_CLAIM = "heytiff_org";

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

export function mintRealtimeToken(
  who: { userId: string; orgId: string },
  secret: string,
  nowMs: number,
): { token: string; expiresAt: number } {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + REALTIME_TOKEN_SECONDS;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: who.userId,
      role: "authenticated",
      aud: "authenticated",
      iss: "heytiff",
      [ORG_CLAIM]: who.orgId,
      iat,
      exp,
    }),
  );
  const signature = b64url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return { token: `${header}.${payload}.${signature}`, expiresAt: exp * 1000 };
}
