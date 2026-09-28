/**
 * @jest-environment node
 */

/* The owner's one line about live updates from ServiceM8 (two-way phase 4,
   PR F, the spec's decision D2): nothing while they work, and for each way
   they don't, one sentence that names the records, says what that means,
   and says what to press. */

import { HOOK_WORDS, sm8LiveUpdatesLine } from "../sm8-hook-words";
import { sm8HooksHealth, type HookObjectsState } from "../sm8-hook-plan";

const NOW = Date.parse("2026-10-05T01:00:00Z");
const ALL: HookObjectsState = {
  jobs: { active: true },
  job_activities: { active: true },
  job_payments: { active: true },
  job_notes: { active: true },
  companies: { active: true },
  attachments: { active: true },
};

describe("the line", () => {
  it("says nothing while live updates work, or when there is nothing to go on", () => {
    expect(sm8LiveUpdatesLine({ state: "ok" })).toBeNull();
    expect(sm8LiveUpdatesLine(null)).toBeNull();
    /* the plan's own ok, from six active and a ping this morning */
    const ok = sm8HooksHealth({ objects: ALL, subscribedAt: NOW - 86_400_000 * 3, lastPingAt: NOW - 3_600_000, editedSince: 40, now: NOW });
    expect(ok).toEqual({ state: "ok" });
    expect(sm8LiveUpdatesLine(ok)).toBeNull();
  });

  it("none: nothing is subscribed", () => {
    expect(sm8LiveUpdatesLine({ state: "none" })).toBe(
      "ServiceM8 isn't sending live updates, so changes wait for the next sync. Press Reconnect."
    );
  });

  it("partial: names the records as the mirror's list does, in its order", () => {
    expect(sm8LiveUpdatesLine({ state: "partial", missing: ["job_notes"], errors: [] })).toBe(
      "ServiceM8 isn't sending live updates for Job notes, so those wait for the next sync."
    );
    expect(sm8LiveUpdatesLine({ state: "partial", missing: ["attachments"], errors: ["job_activities"] })).toBe(
      "ServiceM8 isn't sending live updates for Schedule and Attachments, so those wait for the next sync."
    );
    expect(
      sm8LiveUpdatesLine({ state: "partial", missing: ["job_notes", "jobs", "companies", "job_payments"], errors: ["jobs"] })
    ).toBe("ServiceM8 isn't sending live updates for Clients, Jobs and 2 more, so those wait for the next sync.");
  });

  it("deactivated: ServiceM8's reason and day, its UTC stamp read on the AU clock", () => {
    expect(
      sm8LiveUpdatesLine({ state: "deactivated", object: "job_notes", reason: "Webhook request failed for over 12 hours", at: "2026-10-03 04:12:00" })
    ).toBe("ServiceM8 turned off live updates for Job notes on Sat 3 Oct: Webhook request failed for over 12 hours. Press Reconnect.");
    /* 14:30 UTC on the 2nd is the 3rd in Sydney */
    expect(sm8LiveUpdatesLine({ state: "deactivated", object: "jobs", reason: "Too many failures.", at: "2026-10-02 14:30:00" })).toBe(
      "ServiceM8 turned off live updates for Jobs on Sat 3 Oct: Too many failures. Press Reconnect."
    );
    expect(sm8LiveUpdatesLine({ state: "deactivated", object: "jobs", reason: "Gone", at: "2026-10-02T14:30:00+00:00" })).toBe(
      "ServiceM8 turned off live updates for Jobs on Sat 3 Oct: Gone. Press Reconnect."
    );
  });

  it("deactivated with no day it can read: the reason alone", () => {
    for (const at of [null, "yesterday"]) {
      expect(sm8LiveUpdatesLine({ state: "deactivated", object: "attachments", reason: "Failed", at })).toBe(
        "ServiceM8 turned off live updates for Attachments: Failed. Press Reconnect."
      );
    }
  });

  it("deactivated with a reason that carries an address, a path or a redaction: the plain line, never the raw words", () => {
    for (const reason of [
      "POST to https://app.test/api/integrations/servicem8/webhook/[hook] timed out",
      "Callback www.example.test unreachable",
      "Failed calling /api/integrations/servicem8/webhook/[hook]",
      "Failed calling api/integrations/servicem8",
      "Failed: [hook]",
      "Failed: [address]",
      "Failed at https%3A%2F%2Fapp.test",
      "  .  ",
    ]) {
      expect([reason, sm8LiveUpdatesLine({ state: "deactivated", object: "job_notes", reason, at: "2026-10-03 04:12:00" })]).toEqual([
        reason,
        "ServiceM8 turned off live updates for Job notes. Press Reconnect.",
      ]);
    }
  });

  it("quiet: the day the pings stopped", () => {
    expect(sm8LiveUpdatesLine({ state: "quiet", since: Date.parse("2026-10-02T23:10:00Z") })).toBe(
      "ServiceM8 hasn't sent a live update since Sat 3 Oct, so changes wait for the next sync."
    );
  });

  it("every line says what happened, with no stock phrasing", () => {
    for (const words of Object.values(HOOK_WORDS)) {
      expect(words.startsWith("ServiceM8 ")).toBe(true);
      expect(words).not.toMatch(/attention|action required|needs you|\bAI\b|successfully|!|\.\.\.|webhook/i);
    }
  });

  it("asks for Reconnect only where a Reconnect is the fix: nothing subscribed, or one turned off", () => {
    for (const k of ["none", "deactivated", "deactivatedUndated", "deactivatedPlain"] as const) {
      expect([k, HOOK_WORDS[k].endsWith(" Press Reconnect.")]).toEqual([k, true]);
    }
    for (const k of ["partial", "quiet"] as const) {
      expect([k, HOOK_WORDS[k]]).toEqual([k, expect.not.stringMatching(/Reconnect|Press/)]);
      expect(HOOK_WORDS[k]).toMatch(/wait for the next sync\.$/);
    }
  });
});
