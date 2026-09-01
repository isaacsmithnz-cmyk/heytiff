/* Which Auth0 domain the MANAGEMENT API is addressed at — which is not, the
   day a custom domain exists, the one people sign in through.

   THE TRAP THIS EXISTS TO DEFUSE. Auth0 is explicit: after enabling a custom
   domain you "continue to use your default tenant domain name (such as
   https://{yourDomain}/api/v2/) instead of your custom domain when specifying
   an audience". So the two names split:

     login          auth.example.com          the custom domain
     management     tenant.us.auth0.com       the canonical one, forever

   Both were read out of one env var. `AUTH0_DOMAIN` is what the SDK uses to
   send people to the login screen, AND what `auth0-management.ts` and
   `scripts/auth0-brand.mts` used to build `audience` and the API base. Point
   that one var at a shiny new custom domain — the obvious thing to do, and
   the thing every custom-domain guide tells you to do — and the Management
   API silently stops working: the sign-in-address change on
   /dashboard/profile, and the script that pushes this whole look, both fail
   with an audience Auth0 will not issue a token for.

   WHY THIS IS NOT A SILENT FALLBACK. `AUTH0_TENANT_DOMAIN` is optional, and
   while no custom domain exists the two names really are the same value, so
   falling back to `AUTH0_DOMAIN` is not a guess — it is the right answer.
   What makes it safe is that the fallback is REFUSED in exactly the case
   where it would be wrong: an `AUTH0_DOMAIN` that is not a canonical Auth0
   name means a custom domain is in play, and then the tenant domain has to
   be stated. The failure names the variable and the reason, at the moment the
   mistake is made, instead of hours later as a 401 nobody can place. */

/** Auth0's canonical tenant domains. `*.auth0.com` covers every region —
    `us`, `eu`, `au`, `jp` — because the region is a label to the left of it
    (`tenant.au.auth0.com`), not a different suffix. */
const CANONICAL = /\.auth0\.com$/i;

export type TenantDomainResult =
  | { ok: true; domain: string }
  | { ok: false; reason: string };

/** Resolve the Management API's host. `env` is passed in rather than read so
    both the app and the CLI script can call this, and so the test can drive
    it without touching process.env. */
export function resolveTenantDomain(
  /* Typed as the index signature `process.env` actually has — naming just the
     two keys makes TS reject `process.env` outright ("no properties in
     common"), which is the one call site that matters. */
  env: Record<string, string | undefined>,
): TenantDomainResult {
  const tenant = env.AUTH0_TENANT_DOMAIN?.trim();
  const login = env.AUTH0_DOMAIN?.trim();

  if (tenant) {
    if (!CANONICAL.test(tenant)) {
      return {
        ok: false,
        reason:
          `AUTH0_TENANT_DOMAIN is "${tenant}", which is not a canonical Auth0 domain. ` +
          `The Management API is always addressed at the tenant's own *.auth0.com name — ` +
          `a custom domain is not accepted as an audience.`,
      };
    }
    return { ok: true, domain: tenant };
  }

  if (!login) return { ok: false, reason: "AUTH0_DOMAIN is not set." };

  /* The whole point of the module: a non-canonical AUTH0_DOMAIN means a
     custom domain is live, and the tenant domain is no longer derivable. */
  if (!CANONICAL.test(login)) {
    return {
      ok: false,
      reason:
        `AUTH0_DOMAIN is "${login}", a custom domain — so it cannot also be the Management API's host. ` +
        `Auth0 keeps the Management API on the canonical tenant domain after a custom domain is enabled. ` +
        `Set AUTH0_TENANT_DOMAIN to the tenant's own *.auth0.com name and leave AUTH0_DOMAIN as the login domain.`,
    };
  }

  return { ok: true, domain: login };
}
