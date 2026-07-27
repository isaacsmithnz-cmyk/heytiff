import { countDrifting, countUnreadable, driftNote, MAX_AGE_HOURS, needsRecompute, planSweep } from "../drift";
import { authorised, bearerToken, secretMatches } from "../cron-auth";
import type { WageDrift } from "../wage";

/* The sweep exists because Xero publishes no payroll webhook, so nothing tells
   us a wage moved. Two things have to hold: it must be CHEAP on a quiet week
   (or a weekly schedule is unaffordable), and it must not lose a standing
   difference nobody has adopted yet (or the flag disappears while the problem
   doesn't). */

const NOW = Date.parse("2026-07-27T06:00:00.000Z");

describe("planSweep", () => {
  it("looks at everyone the first time", () => {
    expect(planSweep(null, NOW)).toEqual({ kind: "full", reason: "never-checked" });
  });

  /* The cheap path, and the usual one: ask Xero what moved since last time. */
  it("asks only for what changed since the last look", () => {
    const week = new Date(NOW - 7 * 86_400_000).toISOString();
    expect(planSweep(week, NOW)).toEqual({ kind: "since", since: new Date(Date.parse(week)) });
  });

  /* Belt for the webhook we never had: a Xero-side change that doesn't move
     updatedDateUtc would otherwise leave a stale count forever. */
  it("falls back to a full look once the last one is too old to trust", () => {
    const ancient = new Date(NOW - (MAX_AGE_HOURS + 1) * 3_600_000).toISOString();
    expect(planSweep(ancient, NOW)).toEqual({ kind: "full", reason: "stale" });
  });

  it("treats an unreadable timestamp as never checked", () => {
    expect(planSweep("not a date", NOW)).toMatchObject({ kind: "full" });
  });
});

describe("needsRecompute", () => {
  it("does nothing when Xero says nothing moved — the one-call week", () => {
    expect(needsRecompute([])).toBe(false);
  });

  /* Which employee changed, and why, isn't worth deducing: the recompute that
     follows is the same either way. */
  it("recomputes as soon as anything moved", () => {
    expect(needsRecompute(["x1"])).toBe(true);
  });
});

describe("countDrifting", () => {
  const differs: WageDrift = { kind: "differs", here: 58, xero: 61.5, delta: 3.5 };
  const match: WageDrift = { kind: "match", rate: 58 };
  const salary: WageDrift = { kind: "salary", annual: 95_000, hoursPerWeek: null, here: 58 };
  const none: WageDrift = { kind: "none", note: null };

  it("counts only real hourly disagreements", () => {
    expect(countDrifting([differs, match, salary, none, differs])).toBe(2);
  });

  /* Flagging an unconvertible salary every week would train people to ignore
     the flag — and there is no number for them to disagree with anyway. */
  it("never counts a salary with no stated hours", () => {
    expect(countDrifting([salary, salary])).toBe(0);
  });

  it("is zero for an empty payroll", () => {
    expect(countDrifting([])).toBe(0);
  });
});

describe("driftNote", () => {
  /* Silence is the common case and is the point: seeing the line at all has to
     mean something. */
  it("says nothing when wages agree, or when nothing has been swept", () => {
    expect(driftNote({ count: 0, checkedAt: "2026-07-27T00:00:00Z" })).toBeNull();
    expect(driftNote({ count: null, checkedAt: null })).toBeNull();
  });

  it("reads naturally for one person and for several", () => {
    expect(driftNote({ count: 1, checkedAt: null })).toBe("One person's pay rate differs from Xero.");
    expect(driftNote({ count: 3, checkedAt: null })).toBe("3 people's pay rates differ from Xero.");
  });
});

/* The cron route runs as nobody — no session, no capability, service-role
   access to every workspace. The secret is not an extra layer, it IS the
   layer. */
describe("cron auth", () => {
  it("reads a bearer token, however it's spaced or cased", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer   abc123  ")).toBe("abc123");
    expect(bearerToken("Basic abc123")).toBe("");
    expect(bearerToken(null)).toBe("");
  });

  /* An unset secret must refuse everything. Otherwise "none configured" and
     "none supplied" are the same state — an open endpoint that walks the whole
     customer list. */
  it("fails closed when no secret is configured", () => {
    expect(secretMatches("anything", undefined)).toBe(false);
    expect(secretMatches("", undefined)).toBe(false);
    expect(authorised("Bearer anything", undefined)).toBe(false);
  });

  it("accepts only the exact secret", () => {
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
    expect(secretMatches("s3cre", "s3cret")).toBe(false);
    expect(secretMatches("s3crets", "s3cret")).toBe(false);
    expect(secretMatches("S3CRET", "s3cret")).toBe(false);
    expect(secretMatches("", "s3cret")).toBe(false);
  });

  it("authorises a well-formed header carrying the right secret", () => {
    expect(authorised("Bearer s3cret", "s3cret")).toBe(true);
    expect(authorised("s3cret", "s3cret")).toBe(false); // no Bearer prefix
  });
});

describe("countUnreadable", () => {
  it("counts only the reads that failed", () => {
    const drifts: WageDrift[] = [
      { kind: "match", rate: 58 },
      { kind: "unreadable" },
      { kind: "none", note: null },
      { kind: "unreadable" },
    ];
    expect(countUnreadable(drifts)).toBe(2);
    // and a failed read is never a drift
    expect(countDrifting(drifts)).toBe(0);
  });
});

describe("driftNote says when it last looked", () => {
  /* A count with no age reads as live truth, and this one can be a week old. */
  it("carries the last-looked date when there is one", () => {
    expect(driftNote({ count: 2, checkedAt: "2026-07-27T06:00:00Z" })).toBe(
      "2 people's pay rates differ from Xero (last looked 27 July).",
    );
  });
});
