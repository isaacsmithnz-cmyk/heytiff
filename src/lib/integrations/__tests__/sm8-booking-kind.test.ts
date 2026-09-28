/**
 * @jest-environment node
 */

/* Bookings, the third kind of write (two-way phase 3, PR A): the operator's
   switch and the owner's (A-2), Bookings Off and a missing permission (A-3),
   a booking's verdicts (A-4), and the two permissions a booking needs and
   when they are asked for (A-12). Pure: no network, no database. */

import {
  missingScopesFor,
  SM8_SCOPE_LIST,
  SM8_WRITE_KIND_SCOPES,
  SM8_WRITE_SCOPES,
  sm8MissingScopes,
  sm8ScopesWanted,
} from "../providers";
import { BOOKING_WORDS } from "../sm8-booking-words";
import { NOTE_WORDS } from "../sm8-note-words";
import {
  classifyWrite,
  grantedKinds,
  kindCount,
  kindReady,
  kindsSwitchedOff,
  offersSend,
  readOwnerKinds,
  sendHold,
  sendRefusal,
  sm8WriteKindsFrom,
  verdictFor,
  verdictForCheckFailed,
  verdictForGuard,
  verdictForLetGo,
  verdictForUnreadable,
  WRITE_FREE_RETRIES,
  WRITE_MAX_ATTEMPTS,
  WRITE_WORDS,
  type Sm8WriteOp,
  type Sm8WriteState,
  type VerdictContext,
} from "../sm8-write-plan";

const ALL = ["attachment", "note", "booking"] as const;

const state = (over: Partial<Sm8WriteState> = {}): Sm8WriteState => ({
  readable: true,
  kinds: [...ALL],
  deployment: true,
  mode: "live",
  modeStored: "live",
  pausedReason: null,
  pausedAt: null,
  linked: true,
  connected: true,
  tenantId: "vendor-1",
  granted: [...ALL],
  refused: [],
  timezoneName: null,
  ownerKinds: [...ALL],
  ownerKindsRead: true,
  ...over,
});

/* ── A-2 ── */

describe("the deployment's kinds and the owner's", () => {
  it("SM8_WRITES names all three kinds; 1 is still files alone, and files and notes stay two", () => {
    expect(sm8WriteKindsFrom("attachment,note,booking")).toEqual(["attachment", "note", "booking"]);
    expect(sm8WriteKindsFrom("booking, attachment")).toEqual(["booking", "attachment"]);
    expect(sm8WriteKindsFrom("1")).toEqual(["attachment"]);
    expect(sm8WriteKindsFrom("attachment,note")).toEqual(["attachment", "note"]);
  });

  it("the owner's switch keeps booking, and drops what isn't a kind", () => {
    expect(readOwnerKinds(["booking", "x"])).toEqual(["booking"]);
    expect(readOwnerKinds(["attachment", "booking", "booking"])).toEqual(["attachment", "booking"]);
  });
});

/* ── A-3 ── */

describe("Bookings Off, and a missing permission", () => {
  it("(F) Bookings Off, while On with both permissions: not ready, not offered, held off, refused in bookings' words", () => {
    const s = state({ ownerKinds: ["attachment", "note"] });
    expect(kindReady(s, "booking")).toBe(false);
    expect(offersSend(s, "booking")).toBe(false);
    expect(sendHold(s, "booking")).toBe("off");
    expect(sendRefusal(s, "booking")).toBe(BOOKING_WORDS.press.kindOff);
    expect(kindsSwitchedOff(s)).toEqual(["booking"]);
    // files and notes go on
    expect(kindReady(s, "attachment")).toBe(true);
    expect(kindReady(s, "note")).toBe(true);
  });

  it("(F) a grant with only one of a booking's two permissions sends no booking", () => {
    /* manage_schedule alone is leave's whole permission, never a booking's */
    expect(grantedKinds("vendor manage_schedule")).toEqual(["leave"]);
    expect(grantedKinds("vendor manage_jobs")).toEqual([]);
    expect(grantedKinds("vendor manage_schedule manage_jobs")).toEqual(["booking", "leave"]);
    expect(grantedKinds("manage_attachments publish_job_notes manage_schedule")).toEqual(["attachment", "note", "leave"]);
    const noJobs = state({ granted: grantedKinds("manage_attachments publish_job_notes manage_schedule") });
    expect(kindReady(noJobs, "booking")).toBe(false);
    expect(sendHold(noJobs, "booking")).toBe("reconnect");
    expect(sendRefusal(noJobs, "booking")).toBe(BOOKING_WORDS.press.scope);
    // a trial run sends nothing, so it needs no permission
    expect(kindReady(state({ mode: "trial", granted: [] }), "booking")).toBe(true);
  });

  it("a deployment that doesn't name booking offers none, whatever the owner's switch says", () => {
    for (const kinds of [["attachment"], ["attachment", "note"]] as const) {
      const s = state({ kinds: [...kinds] });
      expect(offersSend(s, "booking")).toBe(false);
      expect(kindReady(s, "booking")).toBe(false);
      expect(kindsSwitchedOff(s)).toEqual([]);
    }
  });
});

/* ── A-4 ── */

describe("a booking's verdicts", () => {
  const ctx = (op: Sm8WriteOp): VerdictContext => ({ now: 0, timezoneName: null, freeRetries: 0, kind: "booking", op });

  it("(F) a 403 that names the scope holds bookings without stopping the run: files and notes behind it still go", () => {
    expect(verdictFor({ kind: "forbidden", scope: true }, 1, ctx("create"))).toMatchObject({
      status: "queued",
      error: BOOKING_WORDS.row.scopeHeld,
      refund: true,
      blockKind: true,
      stop: false,
      personal: false,
    });
  });

  it("(F) any other 403 fails the row, not as a person's, so it counts towards the two-in-a-row stop", () => {
    for (const op of ["create", "update", "delete"] as const) {
      /* what sm8-writes' run counts: a 403 that neither blocks the kind nor
         is a person's */
      expect(verdictFor({ kind: "forbidden", scope: false }, 1, ctx(op))).toMatchObject({
        status: "failed",
        error: BOOKING_WORDS.row.forbidden,
        personal: false,
        blockKind: false,
        stop: false,
      });
    }
  });

  /* every answer below goes through classifyWrite, as the sender's will:
     the verdict is what ServiceM8's status becomes, not a shape a test
     made up */
  const answer = (status: number, op: Sm8WriteOp) => verdictFor(classifyWrite(status, null), 1, ctx(op));

  it("(F) a 404: gone already on a delete; the job's words on a create; never a verdict the sender takes on an update", () => {
    expect(answer(404, "delete")).toMatchObject({ status: "sent", error: null });
    expect(answer(404, "create")).toMatchObject({ status: "failed", error: WRITE_WORDS.noJob });
    /* the sender cancels an update's 404 itself (row.jobGone); a verdict is
       never `cancelled`, and asked anyway it is the same words, failed */
    expect(answer(404, "update")).toMatchObject({ status: "failed", error: BOOKING_WORDS.row.jobGone });
    for (const op of ["create", "update", "delete"] as const) {
      for (const status of [400, 404, 405, 409, 413, 422]) {
        expect(["sent", "queued", "failed"]).toContain(answer(status, op).status);
      }
    }
  });

  it("(F) a 409 is never sent unread: each op is refused in its own words", () => {
    // classifyWrite reads every 409 as `exists`, which a file's sender confirms before it counts
    expect(classifyWrite(409, null)).toEqual({ kind: "exists" });
    expect(answer(409, "create")).toMatchObject({ status: "failed", error: BOOKING_WORDS.row.refused });
    expect(answer(409, "update")).toMatchObject({ status: "failed", error: BOOKING_WORDS.row.statusRefused });
    expect(answer(409, "delete")).toMatchObject({ status: "failed", error: BOOKING_WORDS.row.removeRefused });
    // a file's 409, which its sender read back first, is sent as it always was
    expect(verdictFor(classifyWrite(409, null), 1)).toMatchObject({ status: "sent" });
  });

  it("(F) any other 4xx fails the row in its op's words", () => {
    for (const status of [400, 405, 422]) {
      expect(answer(status, "create")).toMatchObject({ status: "failed", error: BOOKING_WORDS.row.refused });
      expect(answer(status, "update")).toMatchObject({ status: "failed", error: BOOKING_WORDS.row.statusRefused });
      expect(answer(status, "delete")).toMatchObject({ status: "failed", error: BOOKING_WORDS.row.removeRefused });
    }
    // no op named is a create
    expect(verdictFor(classifyWrite(400, null), 1, { now: 0, timezoneName: null, freeRetries: 0, kind: "booking" }).error).toBe(
      BOOKING_WORDS.row.refused
    );
  });

  it("the account's answers are the account's, whatever the kind", () => {
    const file = (o: Parameters<typeof verdictFor>[0]) => verdictFor(o, 2, { now: 0, timezoneName: null, freeRetries: 0 });
    for (const outcome of [
      { kind: "unauthorized" },
      { kind: "payment_required" },
      { kind: "rate_limited", limit: "minute" },
      { kind: "rate_limited", limit: "ours", waitMs: 5_000 },
      { kind: "unavailable", status: 503 },
    ] as Parameters<typeof verdictFor>[0][]) {
      expect(verdictFor(outcome, 2, ctx("create"))).toEqual(file(outcome));
    }
  });

  it("(F) throws, lets go and a check it couldn't read in bookings' words; a note's and a file's as before", () => {
    expect(verdictForUnreadable(1, "booking")).toMatchObject({ status: "queued", error: BOOKING_WORDS.row.threw });
    expect(verdictForUnreadable(WRITE_MAX_ATTEMPTS, "booking")).toMatchObject({ status: "failed", error: BOOKING_WORDS.row.threwGaveUp });
    expect(verdictForLetGo(WRITE_FREE_RETRIES, "booking")).toMatchObject({ status: "failed", error: BOOKING_WORDS.row.tooSlow });
    expect(verdictForLetGo(0, "booking")).toMatchObject({ status: "queued", refund: true, freeRetry: true });
    expect(verdictForCheckFailed("booking")).toEqual(
      expect.objectContaining({ status: "queued", error: BOOKING_WORDS.row.threw, retryAfterMs: 60_000, refund: true })
    );
    // a note's check, with no kind named or "note", is byte for byte as before
    for (const v of [verdictForCheckFailed(), verdictForCheckFailed("note")]) {
      expect(v).toEqual(verdictForCheckFailedOnMain());
    }
    expect(verdictForUnreadable(1, "note").error).toBe(NOTE_WORDS.row.noteThrew);
    expect(verdictForUnreadable(1).error).toBe(WRITE_WORDS.unreadable);
    expect(verdictForLetGo(WRITE_FREE_RETRIES).error).toBe(WRITE_WORDS.tooSlowGaveUp);
    expect(verdictForLetGo(WRITE_FREE_RETRIES, "note").error).toBe(NOTE_WORDS.row.noteTooSlow);
  });

  it("a guard finishes the row as the sender chose, with its words, and ends the run", () => {
    expect(verdictForGuard("sent", BOOKING_WORDS.row.timeNotKept)).toMatchObject({
      status: "sent",
      error: BOOKING_WORDS.row.timeNotKept,
      stop: true,
      refund: false,
    });
    expect(verdictForGuard("failed", BOOKING_WORDS.row.bookingUnsure)).toMatchObject({ status: "failed", stop: true });
  });
});

/** verdictForCheckFailed as main has it: the note's words, a minute, handed back. */
const verdictForCheckFailedOnMain = () => ({
  status: "queued",
  error: "HeyTiff couldn't send the note. Trying again shortly.",
  retryAfterMs: 60_000,
  refund: true,
  stop: false,
  reauth: false,
  blockKind: false,
  holdAllMs: null,
  freshUuid: false,
  freeRetry: false,
  personal: false,
});

describe("counting three kinds", () => {
  it("says each kind there is, two joined as files and notes are, three as a list", () => {
    expect(kindCount({ attachment: 0, note: 0, booking: 1 })).toBe("1 booking");
    expect(kindCount({ attachment: 0, note: 0, booking: 3 })).toBe("3 bookings");
    expect(kindCount({ attachment: 1, note: 0, booking: 1 })).toBe("1 file and 1 booking");
    expect(kindCount({ attachment: 0, note: 2, booking: 1 })).toBe("2 notes and 1 booking");
    expect(kindCount({ attachment: 1, note: 2, booking: 1 })).toBe("1 file, 2 notes and 1 booking");
    expect(kindCount({ attachment: 2, note: 1, booking: 4 })).toBe("2 files, 1 note and 4 bookings");
  });
});

/* ── A-12 ── */

describe("the two permissions a booking needs", () => {
  const reads = SM8_SCOPE_LIST.join(" ");

  it("each says the scope's whole reach, and what HeyTiff does with it", () => {
    expect(SM8_WRITE_KIND_SCOPES.booking).toEqual(["manage_schedule", "manage_jobs"]);
    const why = (scope: string) => SM8_WRITE_SCOPES.find((s) => s.scope === scope)!;
    expect(why("manage_schedule")).toEqual({ scope: "manage_schedule", area: "Workboard", why: BOOKING_WORDS.scope.schedule });
    expect(why("manage_jobs")).toEqual({ scope: "manage_jobs", area: "Workboard", why: BOOKING_WORDS.scope.jobs });
  });

  it("(F) with SM8_WRITES=1, or files and notes, neither is ever asked for or missing", () => {
    for (const kinds of [["attachment"], ["attachment", "note"]]) {
      for (const mode of ["off", "trial", "live", "paused"]) {
        expect(sm8ScopesWanted(mode, kinds)).not.toContain("manage_schedule");
        expect(sm8ScopesWanted(mode, kinds)).not.toContain("manage_jobs");
        const missing = missingScopesFor("servicem8", reads, mode, kinds);
        expect(missing.filter((s) => s === "manage_schedule" || s === "manage_jobs")).toEqual([]);
      }
    }
  });

  it("(F) with bookings allowed and Bookings On, both are missing until granted", () => {
    const kinds = ["attachment", "note", "booking"];
    expect(missingScopesFor("servicem8", `${reads} manage_attachments publish_job_notes`, "live", kinds)).toEqual([
      "manage_schedule",
      "manage_jobs",
    ]);
    expect(missingScopesFor("servicem8", `${reads} manage_attachments publish_job_notes manage_schedule`, "live", kinds)).toEqual([
      "manage_jobs",
    ]);
    expect(
      missingScopesFor("servicem8", `${reads} manage_attachments publish_job_notes manage_schedule manage_jobs`, "live", kinds)
    ).toEqual([]);
  });

  it("asks for them only while sending is On or Paused, never in a trial run or Off", () => {
    expect(sm8ScopesWanted("live", ["booking"])).toEqual([...SM8_SCOPE_LIST, "manage_schedule", "manage_jobs"]);
    expect(sm8ScopesWanted("paused", ["booking"])).toEqual([...SM8_SCOPE_LIST, "manage_schedule", "manage_jobs"]);
    expect(sm8ScopesWanted("trial", ["booking"])).toEqual(SM8_SCOPE_LIST);
    expect(sm8ScopesWanted("off", ["booking"])).toEqual(SM8_SCOPE_LIST);
    expect(sm8MissingScopes(reads, "trial", ["booking"])).toEqual([]);
  });
});
