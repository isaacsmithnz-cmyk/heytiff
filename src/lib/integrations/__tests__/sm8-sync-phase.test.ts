/* Pause versus fault — the distinction the schema doesn't make.

   `last_error` carries both "somebody is needed" and "this walk is longer than
   one run's budget", and the connection screen used to paint them the same
   alarming colour. The live consequence was a healthy 25,000-row attachment
   backfill reading as a broken integration for days.

   These tests are about the CLASSIFICATION, not the wording, with one
   exception: the pause sentences are asserted as literals precisely because
   they cross a process boundary. The engine writes them into Postgres on one
   run and a later render reads them back, so a wording change that looks local
   would silently reclassify every in-flight backfill as a fault. If one of
   these literals needs to change, the constant and this test move together —
   that is the coupling being pinned, not the prose. */

import {
  isSm8PauseNote,
  sm8ObjectPhase,
  SM8_PAUSE_DAILY_BUDGET,
  SM8_PAUSE_MIDWALK,
  SM8_PAUSE_PAGE_BUDGET,
  SM8_PAUSE_RATE_LIMIT,
} from "../sm8-sync-plan";

describe("isSm8PauseNote", () => {
  it("knows the four sentences that mean the walk carries on", () => {
    expect(isSm8PauseNote(SM8_PAUSE_MIDWALK)).toBe(true);
    expect(isSm8PauseNote(SM8_PAUSE_PAGE_BUDGET)).toBe(true);
    expect(isSm8PauseNote(SM8_PAUSE_DAILY_BUDGET)).toBe(true);
    expect(isSm8PauseNote(SM8_PAUSE_RATE_LIMIT)).toBe(true);
  });

  it("pins the stored wording, because these strings outlive the run that wrote them", () => {
    expect(SM8_PAUSE_MIDWALK).toBe("Paused mid-walk — resuming next sync.");
    expect(SM8_PAUSE_PAGE_BUDGET).toBe("Page budget spent — resuming next sync.");
    expect(SM8_PAUSE_DAILY_BUDGET).toBe("Today's sync budget is spent — resuming tomorrow.");
    expect(SM8_PAUSE_RATE_LIMIT).toBe("ServiceM8's rate limit was hit — resuming next sync.");
  });

  it("treats every real fault as a fault", () => {
    expect(isSm8PauseNote("Reconnect ServiceM8 to grant read_attachments.")).toBe(false);
    expect(isSm8PauseNote("The connection needs reconnecting.")).toBe(false);
    expect(isSm8PauseNote("A page couldn't be stored — resuming next sync.")).toBe(false);
    expect(isSm8PauseNote("ServiceM8 couldn't be reached — resuming next sync.")).toBe(false);
  });

  it("fails toward the warning for a note it has never seen", () => {
    // The safe direction: a pause reason added to the engine without being
    // added here shows up as a warning, rather than a NEW fault hiding behind
    // a reassuring "still going".
    expect(isSm8PauseNote("Some future pause nobody registered.")).toBe(false);
  });

  it("is not fooled by a near-miss of the real sentence", () => {
    expect(isSm8PauseNote("Paused mid-walk - resuming next sync.")).toBe(false); // hyphen, not em dash
    expect(isSm8PauseNote("paused mid-walk — resuming next sync.")).toBe(false);
  });

  it("no note at all is not a pause", () => {
    expect(isSm8PauseNote(null)).toBe(false);
  });
});

describe("sm8ObjectPhase", () => {
  it("reads a fresh object as queued", () => {
    expect(sm8ObjectPhase({ backfillDone: false, rowsPulled: 0, lastError: null })).toBe("queued");
  });

  it("reads a finished backfill as done", () => {
    expect(sm8ObjectPhase({ backfillDone: true, rowsPulled: 6978, lastError: null })).toBe("done");
  });

  it("reads the live attachments row as reading, not blocked", () => {
    // The exact prod row on 2026-08-13, and the whole reason this exists.
    expect(
      sm8ObjectPhase({ backfillDone: false, rowsPulled: 24996, lastError: SM8_PAUSE_MIDWALK })
    ).toBe("reading");
  });

  it("counts rows already landed as reading even with no note", () => {
    expect(sm8ObjectPhase({ backfillDone: false, rowsPulled: 25000, lastError: null })).toBe(
      "reading"
    );
  });

  it("reads a paused walk with nothing landed yet as reading", () => {
    // A budget spent before this object's turn came round: still in flight.
    expect(
      sm8ObjectPhase({ backfillDone: false, rowsPulled: 0, lastError: SM8_PAUSE_PAGE_BUDGET })
    ).toBe("reading");
  });

  it("reads a scope refusal as blocked", () => {
    expect(
      sm8ObjectPhase({
        backfillDone: false,
        rowsPulled: 0,
        lastError: "Reconnect ServiceM8 to grant read_attachments.",
      })
    ).toBe("blocked");
  });

  it("lets a new fault outrank a backfill that was under way", () => {
    // Both are true of the row — mid-backfill AND newly refused. The refusal
    // is the news, because it is the one a human can act on.
    expect(
      sm8ObjectPhase({
        backfillDone: false,
        rowsPulled: 24996,
        lastError: "Reconnect ServiceM8 to grant read_attachments.",
      })
    ).toBe("blocked");
  });

  it("lets a new fault outrank a FINISHED backfill", () => {
    expect(
      sm8ObjectPhase({
        backfillDone: true,
        rowsPulled: 6978,
        lastError: "The connection needs reconnecting.",
      })
    ).toBe("blocked");
  });

  it("lets a finished backfill outrank a stale pause note", () => {
    /* `last_error` is only cleared by the run that COMPLETES a walk, and the
       upsert that sets backfill_done writes both — but a row that somehow
       carries both must read as done, not as forever-reading. */
    expect(
      sm8ObjectPhase({ backfillDone: true, rowsPulled: 6978, lastError: SM8_PAUSE_MIDWALK })
    ).toBe("done");
  });
});
