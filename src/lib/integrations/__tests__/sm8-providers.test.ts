/* Pins the ServiceM8 ask — the same contract providers.test.ts holds Xero to.

   ServiceM8's scope families make the read-only charter mechanically
   checkable: read_* reads; manage_*, create_* and publish_* write. Everything
   we ask for must be a read (plus `vendor`, the account-identity scope), and
   the writing families are banned BY SHAPE so a future addition can't slip
   one in without failing here first. */

import {
  missingScopes,
  missingScopesFor,
  PROVIDERS,
  SM8_SCOPE_LIST,
  SM8_SCOPES,
  sm8MissingScopes,
  XERO_SCOPE_LIST,
} from "../providers";

describe("the ServiceM8 ask is exactly the read set", () => {
  it("is these sixteen scopes and nothing else", () => {
    // Set equality, not contains: an extra scope is as much a failure as a
    // missing one — a consent screen that over-asks is over-asking on trust.
    // The last six are the 2026-08-13 job-media expansion, bundled into ONE
    // re-consent by the owner's decision.
    expect([...SM8_SCOPE_LIST].sort()).toEqual(
      [
        "vendor",
        "read_jobs",
        "read_customers",
        "read_customer_contacts",
        "read_job_contacts",
        "read_schedule",
        "read_job_checklists",
        "read_job_categories",
        "read_job_queues",
        "read_staff",
        "read_job_attachments",
        "read_attachments",
        "read_job_photos",
        "read_job_notes",
        "read_job_materials",
        "read_job_payments",
      ].sort()
    );
  });

  it("carries BOTH attachment scope names, because their API and their consent docs disagree", () => {
    /* The full story, so nobody "simplifies" this to one name from either doc:
       the authentication doc's scope table offers `read_job_attachments` and
       has no `read_attachments`; we asked for the table's names, ServiceM8's
       token response granted all of them — and attachment.json still refused:

         insufficient_scope: "read_attachments" scope required to complete this request

       (live 403 body, 2026-08-13). So the endpoint enforces the name the
       consent table doesn't list. Both ride until one proves dead against the
       live mirror; drop the loser with its own PR and update this story. */
    expect(SM8_SCOPE_LIST).toContain("read_job_attachments");
    expect(SM8_SCOPE_LIST).toContain("read_attachments");
    expect(SM8_SCOPE_LIST).toContain("read_job_photos");
  });

  it("asks for nothing that can write to ServiceM8", () => {
    const writers = SM8_SCOPE_LIST.filter((s) => !/^read_/.test(s) && s !== "vendor");
    expect(writers).toEqual([]);
  });

  it("never asks for the writing families, by name as well as by shape", () => {
    /* manage_badges is the notable one: it is the ONLY scope over job badges
       — ServiceM8 ships no read-only badge scope — so badges stay out of the
       integration entirely rather than smuggling a write grant in for a
       display feature. Workboard readiness tags are HeyTiff-owned anyway. */
    for (const banned of [
      "manage_badges",
      "manage_jobs",
      "create_jobs",
      "manage_customers",
      "manage_schedule",
      "publish_sms",
      "publish_email",
    ]) {
      expect(SM8_SCOPE_LIST).not.toContain(banned);
    }
  });

  it("asks for no read its features don't perform — the Xero audit lesson", () => {
    /* Each of these is a real read_* scope ServiceM8 offers, still unbought:
       assets waits for the maintenance equipment import, locations is staff
       GPS adjacent, the rest have no surface. Payments, notes, photos and
       attachments LEFT this list on 2026-08-13 with the job-media track —
       see the charter comment in providers.ts for the one deliberate
       grant-ahead-of-feature exception that bundling forced. */
    for (const unearned of [
      "read_assets",
      "read_locations",
      "read_inventory",
      "read_inbox",
      "read_messages",
      "read_tasks",
      "read_forms",
      "read_feedback",
      "read_tax_rates",
      "read_security_roles",
    ]) {
      expect(SM8_SCOPE_LIST).not.toContain(unearned);
    }
  });

  it("gives every scope a sentence a business owner would accept", () => {
    for (const s of SM8_SCOPES) {
      expect(s.why.trim().length).toBeGreaterThan(0);
    }
  });

  it("holds no duplicates", () => {
    expect(new Set(SM8_SCOPE_LIST).size).toBe(SM8_SCOPE_LIST.length);
  });

  it("registers the provider row the index renders", () => {
    const p = PROVIDERS.find((x) => x.id === "servicem8");
    expect(p).toBeDefined();
    expect(p!.icon).toBe("servicem8");
    expect(p!.uses.length).toBeGreaterThan(0);
  });
});

describe("missing scopes are judged per provider", () => {
  const sm8Granted = SM8_SCOPE_LIST.join(" ");
  const xeroGranted = XERO_SCOPE_LIST.join(" ");

  it("a full ServiceM8 grant reads as complete", () => {
    expect(sm8MissingScopes(sm8Granted)).toEqual([]);
    expect(missingScopesFor("servicem8", sm8Granted)).toEqual([]);
  });

  it("a ServiceM8 grant is never judged with Xero's yardstick", () => {
    // The bug this dispatch exists to prevent: a complete SM8 grant measured
    // against XERO_SCOPE_LIST would prompt "reconnect to finish" forever.
    expect(missingScopesFor("servicem8", sm8Granted)).toEqual([]);
    expect(missingScopesFor("xero", xeroGranted)).toEqual(missingScopes(xeroGranted));
  });

  it("names exactly what a pre-scope grant lacks", () => {
    const withoutSchedule = SM8_SCOPE_LIST.filter((s) => s !== "read_schedule").join(" ");
    expect(sm8MissingScopes(withoutSchedule)).toEqual(["read_schedule"]);
  });

  it("an unknown provider misses nothing rather than everything", () => {
    expect(missingScopesFor("someday-crm", "whatever")).toEqual([]);
  });
});
