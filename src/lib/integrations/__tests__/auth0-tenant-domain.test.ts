/* The mistake this catches has not been made yet, which is the point.

   The day a custom domain is enabled, every guide says to set AUTH0_DOMAIN to
   it. Doing that silently breaks the Management API — Auth0 keeps that on the
   canonical tenant name — and what breaks is the sign-in-address change on
   /dashboard/profile and the script that pushes the whole sign-in look. Both
   would fail with an audience Auth0 will not issue a token for, hours after
   anyone connected it to the DNS change.

   So the failure is moved forward, to the moment the variable is set. */

import { resolveTenantDomain } from "../auth0-tenant-domain";

const TENANT = "dev-zuqpsxjwzz45pr0u.us.auth0.com";
const CUSTOM = "auth.example.com";

describe("while there is no custom domain", () => {
  it("uses AUTH0_DOMAIN, because the two names are the same thing", () => {
    expect(resolveTenantDomain({ AUTH0_DOMAIN: TENANT })).toEqual({
      ok: true,
      domain: TENANT,
    });
  });

  it("accepts every Auth0 region — the region is a label, not a suffix", () => {
    for (const d of [
      "t.us.auth0.com",
      "t.eu.auth0.com",
      "t.au.auth0.com",
      "t.jp.auth0.com",
      "t.auth0.com",
    ]) {
      expect(resolveTenantDomain({ AUTH0_DOMAIN: d })).toEqual({ ok: true, domain: d });
    }
  });

  it("says so plainly when nothing is configured at all", () => {
    // A local checkout with no tenant is a fine state, not a misconfiguration.
    const r = resolveTenantDomain({});
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringContaining("AUTH0_DOMAIN is not set") });
  });
});

describe("the day the custom domain lands", () => {
  it("refuses to treat a custom AUTH0_DOMAIN as the tenant", () => {
    const r = resolveTenantDomain({ AUTH0_DOMAIN: CUSTOM });
    expect(r.ok).toBe(false);
    // The message has to name the variable to set and why, because the person
    // reading it has just done the thing every custom-domain guide told them to.
    expect(r).toMatchObject({
      reason: expect.stringContaining("AUTH0_TENANT_DOMAIN"),
    });
    if (!r.ok) expect(r.reason).toContain(CUSTOM);
  });

  it("takes AUTH0_TENANT_DOMAIN once it is set, and keeps login separate", () => {
    expect(
      resolveTenantDomain({ AUTH0_DOMAIN: CUSTOM, AUTH0_TENANT_DOMAIN: TENANT }),
    ).toEqual({ ok: true, domain: TENANT });
  });

  it("rejects a custom domain put in AUTH0_TENANT_DOMAIN by mistake", () => {
    // The mirror error: right variable, wrong value. Auth0 will not accept a
    // custom domain as a Management API audience either way.
    const r = resolveTenantDomain({ AUTH0_TENANT_DOMAIN: CUSTOM });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not a canonical Auth0 domain");
  });

  it("is not fooled by a lookalike host", () => {
    // `auth0.com.example.com` ends in neither, and a naive `includes` would
    // have passed it.
    for (const d of ["auth0.com.attacker.test", "notauth0.com", "auth0.com.au"]) {
      expect(resolveTenantDomain({ AUTH0_TENANT_DOMAIN: d }).ok).toBe(false);
    }
  });

  it("ignores surrounding whitespace, which is how env vars arrive", () => {
    expect(resolveTenantDomain({ AUTH0_DOMAIN: ` ${TENANT} ` })).toEqual({
      ok: true,
      domain: TENANT,
    });
  });
});
