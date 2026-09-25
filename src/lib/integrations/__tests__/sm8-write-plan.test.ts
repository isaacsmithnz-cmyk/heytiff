/* The write path's decisions, pinned cold: what a ServiceM8 answer makes a
   row, when it goes again, what the card and the owner's list say, and when
   a press is refused. No network, no database — sm8-writes.test.ts covers
   the plumbing that carries these out. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  backgroundBudgetMs,
  capAllows,
  classifyWrite,
  FUNCTION_MAX_MS,
  RUN_BUDGET_MS,
  dedupeKey,
  documentSubject,
  grantedKinds,
  kindReady,
  logWord,
  nextDailyReset,
  offersSend,
  readRemoteError,
  readWriteMode,
  readWriteStatus,
  refusedKinds,
  sendable,
  sendFailure,
  sendHold,
  sendLine,
  sendRefusal,
  sendToast,
  SM8_PER_DAY,
  sm8FileName,
  sm8WriteKindsFrom,
  subjectDocumentId,
  verdictFor,
  verdictForAccountUnknown,
  verdictForDisconnected,
  verdictForLetGo,
  verdictForRenewLate,
  verdictForRenewUnreachable,
  verdictForUnreadable,
  verifyOnRepress,
  VERIFY_KEEP,
  WRITE_DOWNLOAD_TIMEOUT_MS,
  WRITE_FREE_RETRIES,
  WRITE_HOURLY_CAP,
  WRITE_LEASE_MARGIN_MS,
  WRITE_LEASE_MS,
  WRITE_MAX_ATTEMPTS,
  WRITE_READ_TIMEOUT_MS,
  WRITE_RETRY_AFTER_MS,
  WRITE_SEND_BY_MS,
  WRITE_TIMEOUT_MS,
  WRITE_WORDS,
  type JobSend,
  type Sm8WriteState,
} from "../sm8-write-plan";

describe("the switch fails closed", () => {
  it("reads the four settings, and anything else as off", () => {
    expect(readWriteMode("off")).toBe("off");
    expect(readWriteMode("trial")).toBe("trial");
    expect(readWriteMode("live")).toBe("live");
    expect(readWriteMode("paused")).toBe("paused");
    for (const junk of [null, undefined, "", "on", "LIVE", "PAUSED", 1, true]) expect(readWriteMode(junk)).toBe("off");
  });

  it("reads an unknown status as failed, never as sent", () => {
    expect(readWriteStatus("sent")).toBe("sent");
    expect(readWriteStatus("shipped")).toBe("failed");
  });
});

describe("a file's subject", () => {
  it("round-trips the document id, and refuses anything else", () => {
    expect(subjectDocumentId(documentSubject("d-1"))).toBe("d-1");
    expect(subjectDocumentId("note:1")).toBeNull();
  });
});

describe("what an answer means", () => {
  it("classifies ServiceM8's statuses into the decisions they force", () => {
    expect(classifyWrite(200, "u-1")).toEqual({ kind: "created", remoteUuid: "u-1" });
    expect(classifyWrite(201, null)).toEqual({ kind: "created", remoteUuid: null });
    expect(classifyWrite(409, null)).toEqual({ kind: "exists" });
    expect(classifyWrite(401, null)).toEqual({ kind: "unauthorized" });
    expect(classifyWrite(402, null)).toEqual({ kind: "payment_required" });
    expect(classifyWrite(403, null)).toEqual({ kind: "forbidden", scope: false });
    expect(classifyWrite(429, null)).toEqual({ kind: "rate_limited", limit: "minute" });
    expect(classifyWrite(408, null)).toEqual({ kind: "unavailable", status: 408 });
    expect(classifyWrite(400, null)).toEqual({ kind: "rejected", status: 400 });
    expect(classifyWrite(404, null)).toEqual({ kind: "rejected", status: 404 });
    expect(classifyWrite(502, null)).toEqual({ kind: "unavailable", status: 502 });
  });

  it("counts a file ServiceM8 took, or already had under our uuid, as sent", () => {
    expect(verdictFor({ kind: "created", remoteUuid: "u" }, 1)).toMatchObject({ status: "sent", error: null, stop: false });
    expect(verdictFor({ kind: "exists" }, 3)).toMatchObject({ status: "sent" });
  });

  it("holds a file for a reconnect without counting it against the file, and flags the grant", () => {
    expect(verdictFor({ kind: "unauthorized" }, 1)).toMatchObject({
      status: "queued",
      refund: true,
      stop: true,
      reauth: true,
      error: WRITE_WORDS.reauth,
    });
  });

  it("waits out a busy account without blaming the file, and ends the run", () => {
    const busy = verdictFor({ kind: "rate_limited", limit: "minute" }, 2);
    expect(busy).toMatchObject({ status: "queued", refund: true, stop: true, reauth: false, error: WRITE_WORDS.slowDown });
    expect(busy.retryAfterMs).toBe(60_000);
    expect(busy.holdAllMs).toBe(60_000);
  });

  it("a 402 says the account isn't in good standing, and holds every row for 12 hours", () => {
    const unpaid = verdictFor({ kind: "payment_required" }, 1);
    expect(unpaid).toMatchObject({ status: "queued", refund: true, stop: true, error: WRITE_WORDS.billing });
    expect(unpaid.error).toMatch(/isn't in good standing/);
    expect(unpaid.retryAfterMs).toBe(12 * 3_600_000);
    expect(unpaid.holdAllMs).toBe(12 * 3_600_000);
  });

  it("a 403 that names a scope holds the file and its kind for a reconnect, the attempt handed back", () => {
    expect(verdictFor({ kind: "forbidden", scope: true }, 1)).toMatchObject({
      status: "queued",
      refund: true,
      stop: true,
      blockKind: true,
      error: WRITE_WORDS.scopeHeld,
    });
  });

  it("any other 403 fails only that file, and doesn't end the run", () => {
    expect(verdictFor({ kind: "forbidden", scope: false }, 1)).toMatchObject({
      status: "failed",
      stop: false,
      blockKind: false,
      error: WRITE_WORDS.forbidden,
    });
  });

  it("a daily limit waits for the reset, and holds everything with it", () => {
    const now = Date.parse("2026-09-25T13:00:00Z");
    const v = verdictFor({ kind: "rate_limited", limit: "day" }, 1, { now, timezoneName: "Australia/Sydney", freeRetries: 0 });
    expect(v).toMatchObject({ status: "queued", refund: true, stop: true, error: WRITE_WORDS.dailyLimit });
    expect(new Date(now + v.retryAfterMs!).toISOString()).toBe("2026-09-25T14:05:00.000Z");
    expect(v.holdAllMs).toBe(v.retryAfterMs);
  });

  it("HeyTiff's own counter with no room waits a minute, the attempt handed back, and ends the run", () => {
    /* nothing reached ServiceM8: the row did nothing wrong, and the next row
       would be refused the same turn */
    const v = verdictFor({ kind: "rate_limited", limit: "ours", waitMs: 5_000 }, 3);
    expect(v).toMatchObject({
      status: "queued",
      refund: true,
      stop: true,
      reauth: false,
      retryAfterMs: 60_000,
      holdAllMs: 60_000,
      error: WRITE_WORDS.paced,
    });
    expect(WRITE_WORDS.paced).toBe("Waiting for room in ServiceM8's call limit. Trying again in a minute.");
    // a longer wait the counter named is kept, and never shortened
    expect(verdictFor({ kind: "rate_limited", limit: "ours", waitMs: 90_000 }, 1).retryAfterMs).toBe(90_000);
    // no wait named at all is a minute
    expect(verdictFor({ kind: "rate_limited", limit: "ours" }, 1).retryAfterMs).toBe(60_000);
  });

  it("the counter's daily cap, or a daily 429 it recorded, says the daily limit's words", () => {
    const v = verdictFor({ kind: "rate_limited", limit: "ours", waitMs: 3 * 3_600_000 }, 1);
    expect(v).toMatchObject({ status: "queued", refund: true, stop: true, error: WRITE_WORDS.dailyLimit });
    expect(v.retryAfterMs).toBe(3 * 3_600_000);
    expect(v.holdAllMs).toBe(3 * 3_600_000);
  });

  it("a daily refusal says the daily limit's words however little of its wait is left", () => {
    /* ServiceM8's daily 429, recorded 10 s ago, holds for an hour; the
       counter's own day cap waits only until UTC midnight. Either can be
       under an hour, and neither is "a minute". */
    const v = verdictFor({ kind: "rate_limited", limit: "ours", waitMs: 3_590_000, day: true }, 1);
    expect(v).toMatchObject({ status: "queued", refund: true, stop: true, error: WRITE_WORDS.dailyLimit });
    expect(v.retryAfterMs).toBe(3_590_000);
    expect(v.holdAllMs).toBe(3_590_000);
    expect(verdictFor({ kind: "rate_limited", limit: "ours", waitMs: 90_000, day: true }, 1).error).toBe(
      WRITE_WORDS.dailyLimit
    );
    // a per-minute wait stays a minute's words
    expect(verdictFor({ kind: "rate_limited", limit: "ours", waitMs: 20_000, day: false }, 1).error).toBe(
      WRITE_WORDS.paced
    );
  });

  it("a dead record goes again at once under a new uuid, the attempt handed back — twice, then a person", () => {
    const ctx = (freeRetries: number) => ({ now: 0, timezoneName: null, freeRetries });
    expect(verdictFor({ kind: "dead_record" }, 1, ctx(0))).toMatchObject({
      status: "queued",
      retryAfterMs: 0,
      refund: true,
      stop: false,
      freshUuid: true,
      freeRetry: true,
      error: null,
    });
    expect(verdictFor({ kind: "dead_record" }, 1, ctx(WRITE_FREE_RETRIES - 1)).status).toBe("queued");
    expect(verdictFor({ kind: "dead_record" }, 1, ctx(WRITE_FREE_RETRIES))).toMatchObject({
      status: "failed",
      freshUuid: false,
      error: WRITE_WORDS.deadRecordGaveUp,
    });
  });

  it("a send out of time lets go of its row untouched — twice, then a person", () => {
    expect(verdictForLetGo(0)).toMatchObject({ status: "queued", retryAfterMs: 0, refund: true, freeRetry: true, stop: false });
    expect(verdictForLetGo(WRITE_FREE_RETRIES)).toMatchObject({ status: "failed", error: WRITE_WORDS.tooSlowGaveUp });
  });

  it("stops only the file ServiceM8 refused, with a reason that fits", () => {
    expect(verdictFor({ kind: "rejected", status: 404 }, 1)).toMatchObject({ status: "failed", stop: false, error: WRITE_WORDS.noJob });
    expect(verdictFor({ kind: "rejected", status: 413 }, 1).error).toBe(WRITE_WORDS.tooBig);
    expect(verdictFor({ kind: "rejected", status: 409 }, 1).error).toBe(WRITE_WORDS.notThere);
    expect(verdictFor({ kind: "rejected", status: 422 }, 1).error).toBe(WRITE_WORDS.refused);
  });

  it("backs off an unreachable ServiceM8 a step per try, then gives up for a person", () => {
    for (let n = 1; n < WRITE_MAX_ATTEMPTS; n++) {
      const v = verdictFor({ kind: "unavailable", status: 503 }, n);
      expect(v).toMatchObject({ status: "queued", stop: true, refund: false });
      expect(v.retryAfterMs).toBe(WRITE_RETRY_AFTER_MS[n - 1]);
    }
    expect(verdictFor({ kind: "unavailable", status: null }, WRITE_MAX_ATTEMPTS)).toMatchObject({
      status: "failed",
      error: WRITE_WORDS.gaveUp,
    });
  });

  it("retries a file HeyTiff couldn't read with the same patience, without ending the run", () => {
    expect(verdictForUnreadable(1)).toMatchObject({ status: "queued", stop: false, retryAfterMs: WRITE_RETRY_AFTER_MS[0] });
    expect(verdictForUnreadable(WRITE_MAX_ATTEMPTS)).toMatchObject({
      status: "failed",
      error: WRITE_WORDS.unreadableGaveUp,
    });
  });
});

describe("the name a file goes under", () => {
  it("keeps the extension ServiceM8 reads the type from", () => {
    expect(sm8FileName("Public liability.pdf")).toBe("Public liability.pdf");
  });

  it("drops what a file name can't hold", () => {
    expect(sm8FileName('ARC: "licence" / Dane\nWhitmore.jpg')).toBe("ARC licence Dane Whitmore.jpg");
    expect(sm8FileName("   ")).toBe("Document");
  });

  it("shortens a long name without losing the extension", () => {
    const long = `${"a".repeat(200)}.pdf`;
    const out = sm8FileName(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

const send = (over: Partial<JobSend> = {}): JobSend => ({
  documentId: "d1",
  status: "sent",
  error: null,
  attempts: 1,
  remoteUuid: "r1",
  ...over,
});

describe("what one of our rows says", () => {
  it("says nothing for a file never sent, a trial run or a cancelled send", () => {
    expect(sendLine([], ["d1"])).toBeNull();
    expect(sendLine([send({ status: "trial" })], ["d1"])).toBeNull();
    expect(sendLine([send({ status: "cancelled" })], ["d1"])).toBeNull();
    expect(sendLine([send()], [])).toBeNull();
  });

  it("says In ServiceM8 only when every file the row holds went", () => {
    expect(sendLine([send()], ["d1"])).toEqual({ word: "In ServiceM8", tone: "ok" });
    // a licence's front went and its back didn't: not in ServiceM8 yet
    expect(sendLine([send()], ["d1", "d2"])).toBeNull();
  });

  it("puts a failure first, with its reason", () => {
    const line = sendLine([send(), send({ documentId: "d2", status: "failed", error: WRITE_WORDS.tooBig })], ["d1", "d2"]);
    expect(line).toEqual({ word: `Not sent to ServiceM8. ${WRITE_WORDS.tooBig}`, tone: "bad" });
  });

  it("says what holds a waiting file, a pause or a reconnect", () => {
    expect(sendLine([send({ status: "queued", attempts: 0 })], ["d1"], "paused")).toEqual({
      word: "Not in ServiceM8 yet. Sending is paused.",
      tone: null,
    });
    expect(sendLine([send({ status: "queued", attempts: 1 })], ["d1"], "reconnect")).toEqual({
      word: "Not in ServiceM8 yet. ServiceM8 needs reconnecting.",
      tone: "warn",
    });
    // what went, went
    expect(sendLine([send()], ["d1"], "paused")).toEqual({ word: "In ServiceM8", tone: "ok" });
  });

  it("says why the sender put a file back, however few tries it has had", () => {
    /* a 402 or a daily limit hands the attempt back, so a file held for 12
       hours can read attempts 0 — it must not say "Sending…" */
    expect(sendLine([send({ status: "queued", attempts: 0, error: WRITE_WORDS.billing })], ["d1"])).toEqual({
      word: `Not in ServiceM8 yet. ${WRITE_WORDS.billing}`,
      tone: "warn",
    });
    expect(sendLine([send({ status: "queued", attempts: 0, error: WRITE_WORDS.dailyLimit })], ["d1"])).toEqual({
      word: `Not in ServiceM8 yet. ${WRITE_WORDS.dailyLimit}`,
      tone: "warn",
    });
    expect(sendLine([send({ status: "queued", attempts: 2, error: WRITE_WORDS.unreachable })], ["d1"])).toEqual({
      word: `Not in ServiceM8 yet. ${WRITE_WORDS.unreachable}`,
      tone: "warn",
    });
    // a pause still says it's paused, and a failure still comes first
    expect(sendLine([send({ status: "queued", error: WRITE_WORDS.billing })], ["d1"], "paused")?.word).toBe(
      "Not in ServiceM8 yet. Sending is paused."
    );
  });

  it("says a first send quietly, and a retry in the warning colour", () => {
    expect(sendLine([send({ status: "sending", attempts: 1 })], ["d1"])).toEqual({ word: "Sending to ServiceM8…", tone: null });
    expect(sendLine([send({ status: "queued", attempts: 0 })], ["d1"])).toEqual({ word: "Sending to ServiceM8…", tone: null });
    expect(sendLine([send({ status: "queued", attempts: 2 })], ["d1"])).toEqual({
      word: "Not in ServiceM8 yet. Trying again shortly.",
      tone: "warn",
    });
  });

  it("lets a file go again only when the last try came to nothing", () => {
    expect(sendable(undefined)).toBe(true);
    expect(sendable(send({ status: "failed" }))).toBe(true);
    expect(sendable(send({ status: "trial" }))).toBe(true);
    expect(sendable(send({ status: "sent" }))).toBe(false);
    expect(sendable(send({ status: "queued" }))).toBe(false);
  });
});

describe("the owner's list", () => {
  it("says each state in its colour", () => {
    expect(logWord("sent", 1)).toEqual({ word: "Sent", tone: "ok" });
    expect(logWord("failed", 3)).toEqual({ word: "Not sent", tone: "bad" });
    expect(logWord("trial", 0)).toEqual({ word: "Trial run, not sent", tone: null });
    expect(logWord("queued", 0)).toEqual({ word: "Waiting to send", tone: null });
    expect(logWord("queued", 2)).toEqual({ word: "Trying again", tone: "warn" });
    expect(logWord("cancelled", 0)).toEqual({ word: "Cancelled", tone: null });
  });

  it("says what a waiting file is held by", () => {
    expect(logWord("queued", 0, "paused")).toEqual({ word: "Held while paused", tone: null });
    expect(logWord("queued", 2, "reconnect")).toEqual({ word: "Waiting for a reconnect", tone: "warn" });
    // what has gone, or failed, is said as it is
    expect(logWord("sent", 1, "paused")).toEqual({ word: "Sent", tone: "ok" });
    expect(logWord("failed", 1, "reconnect")).toEqual({ word: "Not sent", tone: "bad" });
  });
});

const state = (over: Partial<Sm8WriteState> = {}): Sm8WriteState => ({
  readable: true,
  kinds: ["attachment"],
  deployment: true,
  mode: "live",
  modeStored: "live",
  pausedReason: null,
  pausedAt: null,
  linked: true,
  connected: true,
  tenantId: "v1",
  granted: ["attachment"],
  refused: [],
  timezoneName: null,
  ownerKinds: ["attachment"],
  ownerKindsRead: true,
  ...over,
});

describe("a press is taken, or says why not", () => {
  it("takes it when all three say yes", () => {
    expect(sendRefusal(state())).toBeNull();
    // a trial run sends nothing, so it needs no permission
    expect(sendRefusal(state({ mode: "trial", granted: [] }))).toBeNull();
  });

  it("names the first thing to fix, in the order they must be fixed", () => {
    expect(sendRefusal(state({ kinds: [], deployment: false, mode: "off" }))).toBe("Sending to ServiceM8 isn't available yet.");
    expect(sendRefusal(state({ readable: false }))).toBe(WRITE_WORDS.settingsUnread);
    expect(sendRefusal(state({ tenantId: null }))).toBe("ServiceM8 isn't connected.");
    expect(sendRefusal(state({ mode: "off", granted: [] }))).toMatch(/^Sending to ServiceM8 is switched off/);
    expect(sendRefusal(state({ mode: "paused", connected: false }))).toBe(
      "Sending to ServiceM8 is paused. An owner can change that in Integrations, ServiceM8."
    );
    expect(sendRefusal(state({ connected: false }))).toMatch(/^ServiceM8 needs reconnecting/);
    expect(sendRefusal(state({ granted: [] }))).toMatch(/permission to add files/);
    expect(sendRefusal(state({ refused: ["attachment"] }))).toMatch(/permission to add files/);
  });

  it("offers the button only where an owner switched it on", () => {
    expect(offersSend(state())).toBe(true);
    expect(offersSend(state({ mode: "trial" }))).toBe(true);
    // paused keeps the button; the press says it is paused
    expect(offersSend(state({ mode: "paused" }))).toBe(true);
    expect(offersSend(state({ mode: "off" }))).toBe(false);
    expect(offersSend(state({ kinds: [], deployment: false }))).toBe(false);
    expect(offersSend(state({ readable: false }))).toBe(false);
    // a lapsed grant keeps the button; the press says what's wrong
    expect(offersSend(state({ connected: false, granted: [] }))).toBe(true);
  });

  it("says what holds the files waiting to go", () => {
    expect(sendHold(state())).toBeNull();
    expect(sendHold(state({ mode: "paused" }))).toBe("paused");
    expect(sendHold(state({ connected: false }))).toBe("reconnect");
    expect(sendHold(state({ refused: ["attachment"] }))).toBe("reconnect");
    // a trial run needs no grant, so nothing holds it
    expect(sendHold(state({ mode: "trial", connected: false }))).toBeNull();
  });
});

describe("kinds", () => {
  it("reads the operator's allow-list: 1 is files, a comma list names kinds, and nothing is nothing", () => {
    expect(sm8WriteKindsFrom("1")).toEqual(["attachment"]);
    expect(sm8WriteKindsFrom("attachment")).toEqual(["attachment"]);
    expect(sm8WriteKindsFrom(" attachment ,x")).toEqual(["attachment"]);
    expect(sm8WriteKindsFrom("")).toEqual([]);
    expect(sm8WriteKindsFrom("0")).toEqual([]);
    expect(sm8WriteKindsFrom(undefined)).toEqual([]);
    // notes are the second kind (two-way phase 2); anything else is still nothing
    expect(sm8WriteKindsFrom("note")).toEqual(["note"]);
    expect(sm8WriteKindsFrom("attachment,note")).toEqual(["attachment", "note"]);
    expect(sm8WriteKindsFrom("booking")).toEqual([]);
  });

  it("a kind is granted only when the grant holds every scope it needs", () => {
    expect(grantedKinds("vendor read_jobs manage_attachments")).toEqual(["attachment"]);
    expect(grantedKinds("vendor read_jobs")).toEqual([]);
    expect(grantedKinds(null)).toEqual([]);
  });

  it("a refusal counts only since the last connect, and junk refuses nothing", () => {
    const connectedAt = "2026-09-25T00:00:00.000Z";
    expect(refusedKinds({ attachment: "2026-09-25T01:00:00.000Z" }, connectedAt)).toEqual(["attachment"]);
    // refused under the grant before this one: a reconnect cleared it
    expect(refusedKinds({ attachment: "2026-09-24T23:00:00.000Z" }, connectedAt)).toEqual([]);
    expect(refusedKinds("nope", connectedAt)).toEqual([]);
    expect(refusedKinds({ attachment: "not a date", banana: connectedAt }, connectedAt)).toEqual([]);
    expect(refusedKinds(null, connectedAt)).toEqual([]);
  });

  it("a kind is ready by the deployment, and when On by the grant", () => {
    expect(kindReady(state(), "attachment")).toBe(true);
    expect(kindReady(state({ kinds: [] }), "attachment")).toBe(false);
    expect(kindReady(state({ granted: [] }), "attachment")).toBe(false);
    expect(kindReady(state({ mode: "trial", granted: [] }), "attachment")).toBe(true);
  });
});

describe("what ServiceM8 said", () => {
  it("keeps a JSON body's code and message", () => {
    expect(
      readRemoteError('{"errorCode": 1000, "message": "An error occurred completing your request"}', "application/json")
    ).toEqual({ code: "1000", message: "An error occurred completing your request" });
  });

  it("keeps a plain-text body as the message, whitespace collapsed", () => {
    expect(readRemoteError("Number of allowed API requests\n  per day exceeded ", "text/plain")).toEqual({
      code: null,
      message: "Number of allowed API requests per day exceeded",
    });
  });

  it("keeps nothing of an HTML error page", () => {
    expect(readRemoteError("<html><body>502 Bad Gateway</body></html>", "text/html")).toEqual({ code: null, message: null });
    expect(readRemoteError("<!doctype html><p>x</p>", null)).toEqual({ code: null, message: null });
  });

  it("caps what it keeps", () => {
    const long = readRemoteError("x".repeat(1000), "text/plain");
    expect(long.message).toHaveLength(300);
    expect(readRemoteError(JSON.stringify({ errorCode: "y".repeat(50), message: "m" }), "application/json").code).toHaveLength(20);
  });

  it("tells a scope refusal from any other 403, and a daily limit from the per-minute one", () => {
    const scope = readRemoteError('insufficient_scope: "manage_attachments" scope required', "text/plain");
    expect(classifyWrite(403, null, scope)).toEqual({ kind: "forbidden", scope: true });
    const generic = readRemoteError(
      '{"errorCode": "403", "message": "Access forbidden. You don\'t have permission to access this resource."}',
      "application/json"
    );
    expect(classifyWrite(403, null, generic)).toEqual({ kind: "forbidden", scope: false });
    const daily = readRemoteError('{"errorCode": 429, "message": "Number of allowed API requests per day exceeded"}', "application/json");
    expect(classifyWrite(429, null, daily)).toEqual({ kind: "rate_limited", limit: "day" });
    const minute = readRemoteError("Number of allowed API requests per minute exceeded", "text/plain");
    expect(classifyWrite(429, null, minute)).toEqual({ kind: "rate_limited", limit: "minute" });
    expect(SM8_PER_DAY.test("per day")).toBe(true);
  });
});

describe("when a daily limit resets", () => {
  it("tries at the earlier of the account's midnight and UTC's, a few minutes after", () => {
    const now = Date.parse("2026-09-25T13:00:00Z");
    // 23:00 in Sydney (AEST, +10): its midnight is 14:00 UTC
    expect(new Date(nextDailyReset(now, "Australia/Sydney")).toISOString()).toBe("2026-09-25T14:05:00.000Z");
    expect(new Date(nextDailyReset(now, null)).toISOString()).toBe("2026-09-26T00:05:00.000Z");
    expect(new Date(nextDailyReset(now, "Not/AZone")).toISOString()).toBe("2026-09-26T00:05:00.000Z");
  });

  it("finds the local midnight across a daylight-saving change", () => {
    // Sydney springs forward at 02:00 on Sunday 4 October 2026: midnight
    // that morning is still +10, midnight the next is +11
    const sat = Date.parse("2026-10-03T13:30:00Z"); // 23:30 Saturday
    expect(new Date(nextDailyReset(sat, "Australia/Sydney")).toISOString()).toBe("2026-10-03T14:05:00.000Z");
    const sun = Date.parse("2026-10-04T12:30:00Z"); // 23:30 Sunday, +11
    expect(new Date(nextDailyReset(sun, "Australia/Sydney")).toISOString()).toBe("2026-10-04T13:05:00.000Z");
  });
});

describe("a file asked for again", () => {
  const row = (over: Partial<Parameters<typeof verifyOnRepress>[0]> = {}) => ({
    remote_uuid: "old",
    maybe_landed: false as boolean | null,
    verify_uuids: [] as string[] | null,
    ...over,
  });

  it("checks the uuid it leaves when an upload under it may have landed", () => {
    expect(verifyOnRepress(row({ maybe_landed: true }))).toEqual(["old"]);
  });

  it("checks nothing when nothing under it went out unanswered", () => {
    expect(verifyOnRepress(row())).toEqual([]);
    expect(verifyOnRepress(row({ maybe_landed: null, verify_uuids: null }))).toEqual([]);
  });

  it("never drops a uuid still waiting for its check for a newer one", () => {
    /* U1's upload was lost and the row cancelled; a re-press made U2 and
       kept U1 to check. A trial run, or a check of U1 that couldn't be
       read, uploaded nothing under U2 — so the next press checks U1 still,
       and not U2 */
    expect(verifyOnRepress(row({ remote_uuid: "U2", verify_uuids: ["U1"] }))).toEqual(["U1"]);
    // and a uuid of its own that may have landed joins it, never replaces it
    expect(verifyOnRepress(row({ remote_uuid: "U2", maybe_landed: true, verify_uuids: ["U1"] }))).toEqual(["U1", "U2"]);
    expect(verifyOnRepress(row({ remote_uuid: "U1", maybe_landed: true, verify_uuids: ["U1"] }))).toEqual(["U1"]);
  });

  it("keeps the last few", () => {
    expect(
      verifyOnRepress(row({ remote_uuid: "U4", maybe_landed: true, verify_uuids: ["U1", "U2", "U3"] }))
    ).toEqual(["U2", "U3", "U4"]);
    expect(VERIFY_KEEP).toBe(3);
  });
});

describe("a run nobody waits on fits in its function", () => {
  it("claims for RUN_BUDGET_MS, or until a lease and a margin before the function ends", () => {
    const t0 = 1_000_000;
    // early on: the whole budget
    expect(backgroundBudgetMs(t0, t0)).toBe(RUN_BUDGET_MS);
    // 150 s in: the last claim must be by 165 s (300 − 120 − 15)
    expect(backgroundBudgetMs(t0, t0 + 150_000)).toBe(15_000);
    expect(FUNCTION_MAX_MS - WRITE_LEASE_MS - WRITE_LEASE_MARGIN_MS).toBe(165_000);
    // past it: none
    expect(backgroundBudgetMs(t0, t0 + 170_000)).toBeLessThanOrEqual(0);
    // a route with its own maxDuration
    expect(backgroundBudgetMs(t0, t0, 60_000)).toBeLessThanOrEqual(0);
  });
});

describe("one row per thing", () => {
  it("keys a thing by kind, job and subject — a job or none", () => {
    expect(dedupeKey("attachment", "job-1", "document:d1")).toBe("attachment:job-1:document:d1");
    expect(dedupeKey("attachment", null, "document:d1")).toBe("attachment::document:d1");
  });

  it("is the migration's generated column, character for character", () => {
    const sql = readFileSync(join(process.cwd(), "docs/migrations/sm8_writes_safety.sql"), "utf8");
    expect(sql).toContain("generated always as (kind || ':' || coalesce(sm8_job_uuid, '') || ':' || subject) stored");
    expect(sql).toMatch(/create unique index if not exists sm8_writes_dedupe_uniq\s+on public\.sm8_writes \(org_id, dedupe_key\)/);
  });
});

describe("the hourly cap", () => {
  it("allows up to 60 an hour, and not one more", () => {
    expect(WRITE_HOURLY_CAP).toBe(60);
    expect(capAllows(60, 0)).toBe(true);
    expect(capAllows(59, 1)).toBe(true);
    expect(capAllows(60, 1)).toBe(false);
  });
});

describe("the clocks under one claim", () => {
  it("fit inside the lease: the file, a check first, the upload, a read-back and the margin", () => {
    expect(
      WRITE_DOWNLOAD_TIMEOUT_MS + WRITE_READ_TIMEOUT_MS + WRITE_TIMEOUT_MS + WRITE_READ_TIMEOUT_MS + WRITE_LEASE_MARGIN_MS
    ).toBeLessThanOrEqual(WRITE_LEASE_MS);
  });

  it("an upload started at the last moment still ends inside the lease", () => {
    expect(WRITE_SEND_BY_MS).toBe(35_000);
    expect(WRITE_SEND_BY_MS + WRITE_TIMEOUT_MS + WRITE_READ_TIMEOUT_MS + WRITE_LEASE_MARGIN_MS).toBeLessThanOrEqual(
      WRITE_LEASE_MS
    );
  });
});

describe("what a press says", () => {
  const names: Record<string, string> = { a: "Public liability", b: "Plan.pdf", c: "ARC licence", d: "Workers comp" };
  const nameOf = (k: string) => names[k];

  it("names what went, noun and verb", () => {
    expect(sendToast({ trial: false, sent: ["a"], waiting: [], already: [] }, nameOf)).toBe("Public liability sent to ServiceM8");
    expect(sendToast({ trial: false, sent: ["a", "b"], waiting: [], already: [] }, nameOf)).toBe(
      "Public liability and Plan.pdf sent to ServiceM8"
    );
    expect(sendToast({ trial: false, sent: ["a", "b", "c"], waiting: [], already: [] }, nameOf)).toBe(
      "3 documents sent to ServiceM8"
    );
  });

  it("says what is still to follow, and what was there already", () => {
    expect(sendToast({ trial: false, sent: ["a"], waiting: ["b"], already: [] }, nameOf)).toBe(
      "Public liability sent to ServiceM8. Plan.pdf will follow"
    );
    expect(sendToast({ trial: false, sent: [], waiting: ["b"], already: [] }, nameOf)).toBe(
      "Plan.pdf will go to ServiceM8 once it answers"
    );
    expect(sendToast({ trial: false, sent: [], waiting: [], already: ["a", "d"] }, nameOf)).toBe(
      "Public liability and Workers comp are already in ServiceM8"
    );
  });

  it("says plainly that a trial run sent nothing", () => {
    expect(sendToast({ trial: true, sent: ["a"], waiting: [], already: [] }, nameOf)).toBe(
      "Trial run: Public liability would have gone to ServiceM8. Nothing was sent"
    );
  });

  it("leaves failures to the footer", () => {
    expect(sendToast({ trial: false, sent: [], waiting: [], already: [] }, nameOf)).toBeNull();
    expect(sendFailure([], nameOf)).toBeNull();
    expect(sendFailure([{ key: "a", error: WRITE_WORDS.tooBig }], nameOf)).toBe(
      `Public liability wasn't sent. ${WRITE_WORDS.tooBig}`
    );
    expect(
      sendFailure(
        [
          { key: "a", error: WRITE_WORDS.refused },
          { key: "b", error: WRITE_WORDS.refused },
          { key: "c", error: WRITE_WORDS.refused },
        ],
        nameOf
      )
    ).toBe(`Public liability wasn't sent. ${WRITE_WORDS.refused} 2 more didn't go either.`);
  });
});

describe("a refused token, renewed", () => {
  it("a renewal that couldn't reach ServiceM8 waits a minute, hands the attempt back and stops — never a reconnect", () => {
    expect(verdictForRenewUnreachable()).toMatchObject({
      status: "queued",
      error: WRITE_WORDS.unreachable,
      retryAfterMs: 60_000,
      refund: true,
      stop: true,
      reauth: false,
    });
  });

  it("a connection gone mid-run leaves the row for the next run to cancel, and stops", () => {
    expect(verdictForDisconnected()).toMatchObject({
      status: "queued",
      error: WRITE_WORDS.disconnected,
      refund: true,
      stop: true,
      reauth: false,
    });
  });

  it("a token whose connection names no account waits, hands the attempt back and stops — never cancelled, never sent", () => {
    expect(verdictForAccountUnknown()).toMatchObject({
      status: "queued",
      error: WRITE_WORDS.accountUnknown,
      retryAfterMs: 60_000,
      refund: true,
      stop: true,
      reauth: false,
    });
  });

  it("renewed too late for the claim, the row goes back as it was, due at once", () => {
    expect(verdictForRenewLate()).toMatchObject({
      status: "queued",
      error: null,
      retryAfterMs: 0,
      refund: true,
      stop: false,
      reauth: false,
    });
  });

  it("a second try started before the cut-off ends inside the lease", () => {
    // the upload's own 60 s timeout, and a 10 s read-back after a 409
    expect(WRITE_SEND_BY_MS + 60_000 + 10_000).toBeLessThan(WRITE_LEASE_MS);
  });
});
