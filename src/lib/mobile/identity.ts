import { checkMobileToken, KEYS_UNREACHABLE, mobileIssuers, tenantKeys, tokenIssuerHost, type KeyLookup } from "./token";
import { UNSIGNED } from "./auth";

/* WHO THE PHONE IS, BEFORE THEY BELONG ANYWHERE (bug 101, 26 November 2026:
   sign-up and onboarding on the phone). requireMobile answers "who, and for
   which workspace", and refuses someone with no workspace. The phone's first
   run is exactly that someone: they have just signed in, and the question is
   whether an invitation is waiting for them or they're starting a business.

   So this door asks only WHO, and with which address. The token is checked
   exactly as requireMobile checks it; the address comes from Auth0's own
   /userinfo, called with that same token (the phone asks for `openid email`,
   so the token is good there too). An invitation is matched on the address
   only when Auth0 says the address is VERIFIED: a database sign-up that never
   clicked its email has typed an address, not proved one, and an invitation
   is bound to whoever can read that inbox. */

export type MobileIdentity = {
  userId: string;
  /** Lowercased, and only when Auth0 has verified it; null otherwise. */
  email: string | null;
  /** What Auth0 holds, verified or not, for saying who they're signed in as. */
  shownEmail: string | null;
  /** The provider's name for them, when it isn't just the address again. */
  name: string | null;
};

const json = (status: number, error: string): Response =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function requireMobileIdentity(
  request: Request,
  opts: { keyFor?: KeyLookup; now?: number; fetcher?: typeof fetch } = {}
): Promise<MobileIdentity | Response> {
  const domain = process.env.AUTH0_DOMAIN;
  if (!domain) return UNSIGNED();
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!bearer) return UNSIGNED();
  const check = await checkMobileToken(bearer[1]!, { domain, issuers: mobileIssuers(process.env), keyFor: opts.keyFor ?? tenantKeys(domain), now: opts.now });
  if (!check.ok) return check.reason === KEYS_UNREACHABLE ? json(503, "HeyTiff couldn't check your sign-in just now. Try again.") : UNSIGNED();

  /* Asked of the name that signed the token: a token from the tenant's own
     name is for its /userinfo, one from login.hey-tiff.com for that one's. */
  const userinfoHost = tokenIssuerHost(bearer[1]!) ?? domain;
  let info: Record<string, unknown> | null = null;
  try {
    const r = await (opts.fetcher ?? fetch)(`https://${userinfoHost}/userinfo`, {
      headers: { authorization: `Bearer ${bearer[1]}` },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) info = (await r.json()) as Record<string, unknown>;
  } catch {
    info = null;
  }
  if (!info || info.sub !== check.sub) return json(503, "HeyTiff couldn't check your sign-in just now. Try again.");

  const raw = typeof info.email === "string" ? info.email.trim().toLowerCase() : "";
  const name = typeof info.name === "string" && info.name.trim() && !info.name.includes("@") ? info.name.trim() : null;
  return {
    userId: check.sub,
    email: raw && info.email_verified === true ? raw : null,
    shownEmail: raw || null,
    name,
  };
}
