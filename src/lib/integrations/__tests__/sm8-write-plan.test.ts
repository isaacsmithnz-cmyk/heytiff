/* The write path's decisions, pinned cold: what a ServiceM8 answer makes a
   row, when it goes again, what the card and the owner's list say, and when
   a press is refused. No network, no database — sm8-writes.test.ts covers
   the plumbing that carries these out. */

import {
  classifyWrite,
  documentSubject,
  logWord,
  offersSend,
  readWriteMode,
  readWriteStatus,
  sendable,
  sendFailure,
  sendLine,
  sendRefusal,
  sendToast,
  sm8FileName,
  subjectDocumentId,
  twinsToHide,
  verdictFor,
  verdictForUnreadable,
  WRITE_MAX_ATTEMPTS,
  WRITE_RETRY_AFTER_MS,
  WRITE_WORDS,
  type JobSend,
  type Sm8WriteState,
} from "../sm8-write-plan";

describe("the switch fails closed", () => {
  it("reads the three settings, and anything else as off", () => {
    expect(readWriteMode("off")).toBe("off");
    expect(readWriteMode("trial")).toBe("trial");
    expect(readWriteMode("live")).toBe("live");
    for (const junk of [null, undefined, "", "on", "LIVE", 1, true]) expect(readWriteMode(junk)).toBe("off");
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
    expect(classifyWrite(403, null)).toEqual({ kind: "forbidden" });
    expect(classifyWrite(429, null)).toEqual({ kind: "rate_limited" });
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

  it("waits out a busy or unpaid account without blaming the file, and ends the run", () => {
    const busy = verdictFor({ kind: "rate_limited" }, 2);
    expect(busy).toMatchObject({ status: "queued", refund: true, stop: true, reauth: false });
    expect(busy.retryAfterMs).toBe(60_000);
    const unpaid = verdictFor({ kind: "payment_required" }, 1);
    expect(unpaid).toMatchObject({ status: "queued", refund: true, stop: true });
    expect(unpaid.retryAfterMs).toBe(12 * 3_600_000);
  });

  it("stops the file and the run on a permission ServiceM8 refuses — a person has to look", () => {
    expect(verdictFor({ kind: "forbidden" }, 1)).toMatchObject({
      status: "failed",
      stop: true,
      error: WRITE_WORDS.forbidden,
    });
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

describe("the twin", () => {
  it("hides ServiceM8's copy of a file we sent while our row shows it", () => {
    expect([...twinsToHide([send({ remoteUuid: "r1" })], ["d1"])]).toEqual(["r1"]);
  });

  it("shows the copy as ServiceM8's once our row is gone — a file taken off the job, or a paper moved on", () => {
    expect(twinsToHide([send({ remoteUuid: "r1" })], ["d9"]).size).toBe(0);
  });

  it("hides nothing that didn't go", () => {
    expect(twinsToHide([send({ status: "failed" }), send({ status: "trial" })], ["d1"]).size).toBe(0);
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
});

const state = (over: Partial<Sm8WriteState> = {}): Sm8WriteState => ({
  deployment: true,
  mode: "live",
  connected: true,
  tenantId: "v1",
  granted: true,
  ...over,
});

describe("a press is taken, or says why not", () => {
  it("takes it when all three say yes", () => {
    expect(sendRefusal(state())).toBeNull();
    // a trial run sends nothing, so it needs no permission
    expect(sendRefusal(state({ mode: "trial", granted: false }))).toBeNull();
  });

  it("names the first thing to fix, in the order they must be fixed", () => {
    expect(sendRefusal(state({ deployment: false, mode: "off" }))).toBe("Sending to ServiceM8 isn't available yet.");
    expect(sendRefusal(state({ tenantId: null }))).toBe("ServiceM8 isn't connected.");
    expect(sendRefusal(state({ mode: "off", granted: false }))).toMatch(/^Sending to ServiceM8 is switched off/);
    expect(sendRefusal(state({ connected: false }))).toMatch(/^ServiceM8 needs reconnecting/);
    expect(sendRefusal(state({ granted: false }))).toMatch(/permission to add files/);
  });

  it("offers the button only where an owner switched it on", () => {
    expect(offersSend(state())).toBe(true);
    expect(offersSend(state({ mode: "trial" }))).toBe(true);
    expect(offersSend(state({ mode: "off" }))).toBe(false);
    expect(offersSend(state({ deployment: false }))).toBe(false);
    // a lapsed grant keeps the button; the press says what's wrong
    expect(offersSend(state({ connected: false, granted: false }))).toBe(true);
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
