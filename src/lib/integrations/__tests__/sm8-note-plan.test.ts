/**
 * @jest-environment node
 */

/* Notes to ServiceM8 — the pure decisions (two-way phase 2, PR A): the
   subjects, the words, what an Undo does, whether a flag is ours, and what
   every note's line says. Also the write plan's second kind: the owner's
   switch per kind, a note's verdicts, and its clocks. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deleteTargets,
  doneText,
  FLAG_UNDO_AFTER_SENT,
  flagHeldByUs,
  flagState,
  mayHaveLanded,
  NOTE_WORDS,
  noteLabel,
  noteState,
  noteSubject,
  noteWords,
  parseNoteSubject,
  READBACK_SEES_INACTIVE,
  replyText,
  STORED_REFUSALS,
  undoPlan,
  type FlagOp,
  type QueueRowIn,
} from "../sm8-note-plan";
import {
  DONE_TTL_MS,
  kindCount,
  kindReady,
  kindsSwitchedOff,
  NOTE_READ_BY_MS,
  NOTE_SEND_BY_MS,
  offersSend,
  readOwnerKinds,
  sendHold,
  sendLine,
  sendRefusal,
  sm8WriteKindsFrom,
  verdictFor,
  verdictForLetGo,
  verdictForLoginUnchecked,
  verdictForUnreadable,
  WRITE_LEASE_MARGIN_MS,
  WRITE_LEASE_MS,
  WRITE_NOTE_TIMEOUT_MS,
  WRITE_READ_TIMEOUT_MS,
  WRITE_WORDS,
  type Sm8WriteState,
} from "../sm8-write-plan";

const NOW = Date.parse("2026-09-25T01:00:00.000Z");
const LATER = new Date(NOW + 60_000).toISOString();
const EARLIER = new Date(NOW - 60_000).toISOString();

const state = (over: Partial<Sm8WriteState> = {}): Sm8WriteState => ({
  readable: true,
  kinds: ["attachment", "note"],
  deployment: true,
  mode: "live",
  modeStored: "live",
  pausedReason: null,
  pausedAt: null,
  linked: true,
  connected: true,
  tenantId: "vendor-1",
  granted: ["attachment", "note"],
  refused: [],
  timezoneName: null,
  ownerKinds: ["attachment", "note"],
  ownerKindsRead: true,
  ...over,
});

describe("the deployment's kinds and the owner's", () => {
  it("SM8_WRITES names notes beside files; 1 is still files alone", () => {
    expect(sm8WriteKindsFrom("attachment,note")).toEqual(["attachment", "note"]);
    expect(sm8WriteKindsFrom("1")).toEqual(["attachment"]);
  });

  it("reads the owner's switch: anything but an array is files, junk kinds drop", () => {
    expect(readOwnerKinds(null)).toEqual(["attachment"]);
    expect(readOwnerKinds(undefined)).toEqual(["attachment"]);
    expect(readOwnerKinds(["note", "x"])).toEqual(["note"]);
    expect(readOwnerKinds([])).toEqual([]);
    expect(kindsSwitchedOff(state({ ownerKinds: ["attachment"], ownerKindsRead: false }))).toEqual([]);
    expect(kindsSwitchedOff(state({ ownerKinds: ["attachment"] }))).toEqual(["note"]);
  });

  it("Notes Off, while On with the permission: not ready, not offered, held off — never 'reconnect'", () => {
    const s = state({ ownerKinds: ["attachment"] });
    expect(kindReady(s, "note")).toBe(false);
    expect(offersSend(s, "note")).toBe(false);
    expect(sendHold(s, "note")).toBe("off");
    expect(sendRefusal(s, "note")).toBe(NOTE_WORDS.press.kindOff);
    // files go on
    expect(kindReady(s, "attachment")).toBe(true);
    expect(sendHold(s, "attachment")).toBeNull();
    // and Notes Off even without the permission: still "off", not "reconnect"
    expect(sendHold(state({ ownerKinds: ["attachment"], granted: ["attachment"] }), "note")).toBe("off");
  });

  it("a missing notes permission answers in notes' words; files keep theirs", () => {
    const s = state({ granted: ["attachment"] });
    expect(sendRefusal(s, "note")).toBe(NOTE_WORDS.press.notesScope);
    expect(sendHold(s, "note")).toBe("reconnect");
    expect(sendRefusal(state({ granted: [] }), "attachment")).toBe(
      "ServiceM8 hasn't given HeyTiff permission to add files yet. An owner can change that in Integrations, ServiceM8."
    );
  });

  it("a files-only deployment reads exactly as before", () => {
    const s = state({ kinds: ["attachment"], ownerKinds: ["attachment"], granted: ["attachment"] });
    expect(offersSend(s, "attachment")).toBe(true);
    expect(sendHold(s, "attachment")).toBeNull();
    expect(offersSend(s, "note")).toBe(false);
    expect(kindsSwitchedOff(s)).toEqual([]);
  });

  it("a file waiting behind Files Off says so in files' words", () => {
    const line = sendLine(
      [{ documentId: "d1", status: "queued", error: null, attempts: 0, remoteUuid: "u" }],
      ["d1"],
      "off"
    );
    expect(line).toEqual({ word: "Not in ServiceM8 yet. Sending files is switched off.", tone: null });
  });

  it("counts files and notes apart, and says nothing new with no notes", () => {
    expect(kindCount({ attachment: 1, note: 0 })).toBe("1 file");
    expect(kindCount({ attachment: 3, note: 0 })).toBe("3 files");
    expect(kindCount({ attachment: 0, note: 3 })).toBe("3 notes");
    expect(kindCount({ attachment: 1, note: 2 })).toBe("1 file and 2 notes");
    expect(kindCount({ attachment: 2, note: 1 })).toBe("2 files and 1 note");
  });
});

describe("a note's verdicts", () => {
  const ctx = (op: "create" | "update" | "delete") => ({ now: NOW, timezoneName: null, freeRetries: 0, kind: "note" as const, op });

  it("a scope 403 holds notes and blocks the kind, without stopping the run; any other 403 is the person's", () => {
    const scope = verdictFor({ kind: "forbidden", scope: true }, 1, ctx("create"));
    expect(scope).toMatchObject({ status: "queued", error: NOTE_WORDS.row.scopeHeldNote, blockKind: true, stop: false, refund: true });
    const person = verdictFor({ kind: "forbidden", scope: false }, 1, ctx("create"));
    expect(person).toMatchObject({ status: "failed", error: NOTE_WORDS.row.personForbidden, personal: true, stop: false });
    // a file's 403 is as it always was
    expect(verdictFor({ kind: "forbidden", scope: false }, 1).personal).toBe(false);
    expect(verdictFor({ kind: "forbidden", scope: true }, 1).stop).toBe(true);
  });

  it("a 404: gone already on a delete; the job on a create; never a verdict of `cancelled`", () => {
    expect(verdictFor({ kind: "rejected", status: 404 }, 1, ctx("delete")).status).toBe("sent");
    expect(verdictFor({ kind: "rejected", status: 404 }, 1, ctx("create"))).toMatchObject({
      status: "failed",
      error: WRITE_WORDS.noJob,
    });
    for (const op of ["create", "update", "delete"] as const) {
      for (const status of [400, 404, 409, 413, 422]) {
        expect(["sent", "queued", "failed"]).toContain(verdictFor({ kind: "rejected", status }, 1, ctx(op)).status);
      }
    }
    expect(verdictFor({ kind: "rejected", status: 413 }, 1, ctx("create")).error).toBe(NOTE_WORDS.row.noteTooLong);
    expect(verdictFor({ kind: "rejected", status: 422 }, 1, ctx("create")).error).toBe(NOTE_WORDS.row.noteRefused);
  });

  it("a note's clocks all fit inside one lease", () => {
    expect(NOTE_SEND_BY_MS + WRITE_NOTE_TIMEOUT_MS + WRITE_READ_TIMEOUT_MS + WRITE_LEASE_MARGIN_MS).toBeLessThanOrEqual(
      WRITE_LEASE_MS
    );
    expect(NOTE_READ_BY_MS).toBe(95_000);
    expect(NOTE_SEND_BY_MS).toBe(75_000);
    expect(DONE_TTL_MS).toBe(86_400_000);
  });

  it("lets go, throws and can't check a login in notes' words, handing the attempt back where it should", () => {
    expect(verdictForLetGo(2, "note").error).toBe(NOTE_WORDS.row.noteTooSlow);
    expect(verdictForLetGo(2).error).toBe(WRITE_WORDS.tooSlowGaveUp);
    expect(verdictForUnreadable(1, "note").error).toBe(NOTE_WORDS.row.noteThrew);
    expect(verdictForUnreadable(9, "note").error).toBe(NOTE_WORDS.row.noteThrewGaveUp);
    expect(verdictForLoginUnchecked()).toMatchObject({ status: "queued", refund: true, stop: false, retryAfterMs: 60_000 });
  });
});

describe("subjects, labels and words", () => {
  it("every subject round-trips", () => {
    expect(parseNoteSubject(noteSubject.create("n1"))).toEqual({ via: "note", noteId: "n1" });
    expect(parseNoteSubject(noteSubject.done("t1", "n1"))).toEqual({ via: "done", taskId: "t1", noteId: "n1" });
    expect(noteSubject.done(null, "n1")).toBe("task:none:done:n1");
    expect(parseNoteSubject(noteSubject.done(null, "n1"))).toEqual({ via: "done", taskId: null, noteId: "n1" });
    expect(parseNoteSubject(noteSubject.flag("u1", "p1"))).toEqual({ via: "flag", noteUuid: "u1", pressId: "p1" });
    expect(parseNoteSubject(noteSubject.undo("w1"))).toEqual({ via: "undo", createRowId: "w1" });
    expect(parseNoteSubject("document:d1")).toBeNull();
    // two replies are two keys; a second Done of one task is a new key
    expect(noteSubject.create("n1")).not.toBe(noteSubject.create("n2"));
    expect(noteSubject.done("t1", "n1")).not.toBe(noteSubject.done("t1", "n2"));
    // and the old prefix still finds every Done of a task
    expect(noteSubject.done("t1", "n2").startsWith("task:t1:done")).toBe(true);
  });

  it("names a note by its label, never its words", () => {
    expect(noteLabel("reply")).toBe("Reply");
    expect(noteLabel("done")).toBe("Done.");
    expect(noteLabel("take_back")).toBe("Note taken out of ServiceM8");
  });

  it("a reply keeps the @handle; a Done addresses the asker unless it is the sender or unknown", () => {
    expect(replyText("lukeingold", " on my way ")).toBe("@lukeingold on my way");
    expect(replyText(null, "on my way")).toBe("on my way");
    expect(replyText("LukeIngold", "tôi đang đến")).toBe("@lukeingold tôi đang đến");
    expect(doneText({ handle: "LukeIngold", sm8Uuid: "a" }, "b")).toBe("@lukeingold Done.");
    expect(doneText({ handle: "isaacsmith", sm8Uuid: "a" }, "a")).toBe("Done.");
    expect(doneText(null, "b")).toBe("Done.");
    expect(doneText({ handle: null, sm8Uuid: "a" }, "b")).toBe("Done.");
  });

  it("the words come from the row: sm8Text first, then the kept words, trimmed and capped", () => {
    expect(noteWords({ jobNotes: ["english"], sm8Text: "@luke tiếng việt" })).toBe("@luke tiếng việt");
    expect(noteWords({ jobNotes: [" one ", "two"] })).toBe("one\n\ntwo");
    expect(noteWords({ jobNotes: ["x".repeat(5000)] })).toHaveLength(4000);
    expect(noteWords({ jobNotes: [" "], sm8Text: "  " })).toBeNull();
    expect(noteWords(null)).toBeNull();
  });

  it("copies WRITE_WORDS' two sentences exactly", () => {
    expect(NOTE_WORDS.press.capped).toBe(WRITE_WORDS.paused);
    expect(NOTE_WORDS.press.unreadable).toBe(WRITE_WORDS.settingsUnread);
  });

  it("keeps both live-test switches off until their tests pass", () => {
    expect(READBACK_SEES_INACTIVE).toBe(false);
    expect(FLAG_UNDO_AFTER_SENT).toBe(false);
  });
});

/* ── Undo ── */

const create = (over: Partial<QueueRowIn> = {}): QueueRowIn => ({
  id: "c1",
  status: "queued",
  remote_uuid: "u-own",
  lease_until: null,
  maybe_landed: false,
  verify_uuids: [],
  taken_back_at: null,
  requested_by: "staff-isaac",
  last_error: null,
  attempts: 0,
  ...over,
});

describe("what an Undo does", () => {
  it("follows the table for every status and landing", () => {
    expect(undoPlan(null, NOW)).toBe("nothing");
    expect(undoPlan(create({ status: "cancelled" }), NOW)).toBe("nothing");
    expect(undoPlan(create({ status: "cancelled", maybe_landed: true }), NOW)).toBe("delete");
    for (const status of ["queued", "failed", "trial"]) {
      expect(undoPlan(create({ status }), NOW)).toBe("cancel");
      expect(undoPlan(create({ status, maybe_landed: true }), NOW)).toBe("cancel_and_delete");
      expect(undoPlan(create({ status, verify_uuids: ["u-old"] }), NOW)).toBe("cancel_and_delete");
    }
    expect(undoPlan(create({ status: "sending", lease_until: EARLIER }), NOW)).toBe("cancel");
    expect(undoPlan(create({ status: "sending", lease_until: EARLIER, maybe_landed: true }), NOW)).toBe("cancel_and_delete");
    expect(undoPlan(create({ status: "sending", lease_until: LATER, maybe_landed: true }), NOW)).toBe("delete");
    expect(undoPlan(create({ status: "sent" }), NOW)).toBe("delete");
  });

  it("takes out exactly what may be there", () => {
    expect(deleteTargets(create({ status: "sent", verify_uuids: [] }))).toEqual(["u-own"]);
    expect(deleteTargets(create({ status: "failed", maybe_landed: true, verify_uuids: ["u-old", "u-own"] }))).toEqual([
      "u-own",
      "u-old",
    ]);
    expect(deleteTargets(create({ status: "cancelled", verify_uuids: ["u-old"] }))).toEqual(["u-old"]);
    expect(deleteTargets(create({ status: "cancelled" }))).toEqual([]);
    expect(mayHaveLanded(create({ verify_uuids: ["x"] }))).toBe(true);
  });
});

/* ── flags ── */

const op = (over: Partial<FlagOp> = {}): FlagOp => ({
  id: "f1",
  status: "queued",
  flag_done: true,
  seen_edit_date: "2026-09-20 10:00:00",
  landed_edit_date: null,
  requested_by: "staff-isaac",
  created_at: "2026-09-25T00:00:00.000Z",
  ...over,
});

describe("whether a flag is ours", () => {
  it("a waiting or going mark holds it; a trial mark only while the mode is still Trial run", () => {
    expect(flagHeldByUs({ editDate: null }, [op()], false)).toBe(true);
    expect(flagHeldByUs({ editDate: null }, [op({ status: "sending" })], false)).toBe(true);
    expect(flagHeldByUs({ editDate: null }, [op({ status: "trial" })], true)).toBe(true);
    expect(flagHeldByUs({ editDate: null }, [op({ status: "trial" })], false)).toBe(false);
    expect(flagHeldByUs({ editDate: null }, [op({ status: "failed" })], false)).toBe(false);
    expect(flagHeldByUs({ editDate: null }, [], false)).toBe(false);
  });

  it("a mark that went holds it only while the note's edit time is the one it saw or left", () => {
    const sent = op({ status: "sent", landed_edit_date: "2026-09-25 11:00:00" });
    expect(flagHeldByUs({ editDate: "2026-09-25 11:00:00" }, [sent], false)).toBe(true);
    expect(flagHeldByUs({ editDate: "2026-09-20 10:00:00" }, [sent], false)).toBe(true);
    // somebody changed it after us: open again
    expect(flagHeldByUs({ editDate: "2026-09-25 12:30:00" }, [sent], false)).toBe(false);
    // the zero date and "" read as null, and two nulls are equal
    expect(flagHeldByUs({ editDate: "0000-00-00 00:00:00" }, [op({ status: "sent", seen_edit_date: "" })], false)).toBe(true);
  });

  it("offers Mark done again once somebody reopened our sent mark, and Mark done again after a trial", () => {
    const sent = op({ status: "sent", landed_edit_date: "2026-09-25 11:00:00" });
    const reopened = flagState({
      mirror: { flagged: true, completedByName: null, editDate: "2026-09-25 12:30:00" },
      ops: [sent],
      hold: null,
      trialNow: false,
      viewerStaffId: "staff-luke",
    });
    expect(reopened.acts).toEqual(["mark_done_again"]);
    const afterTrial = flagState({
      mirror: { flagged: true, completedByName: null, editDate: "2026-09-20 10:00:00" },
      ops: [op({ status: "trial" })],
      hold: null,
      trialNow: false,
      viewerStaffId: "staff-isaac",
    });
    expect(afterTrial.key).toBe("flag.flagged");
    expect(afterTrial.acts).toEqual(["mark_done"]);
  });

  it("offers Undo only to whoever pressed the latest mark, and to nobody with no staff card", () => {
    const input = (viewerStaffId: string | null) =>
      flagState({
        mirror: { flagged: true, completedByName: null, editDate: "2026-09-20 10:00:00" },
        ops: [op()],
        hold: null,
        trialNow: false,
        viewerStaffId,
      });
    expect(input("staff-isaac").acts).toEqual(["unmark"]);
    expect(input("staff-luke").acts).toEqual([]);
    expect(input(null).acts).toEqual([]);
    // a sent mark: no Undo until live test 5 flips the switch
    const sent = flagState({
      mirror: { flagged: true, completedByName: "Isaac Smith", completedBy: "u", editDate: "2026-09-20 10:00:00" },
      ops: [op({ status: "sent" })],
      hold: null,
      trialNow: false,
      viewerStaffId: "staff-isaac",
    });
    expect(sent).toMatchObject({ key: "flag.doneBy", acts: [] });
  });
});

/* ── a note's line ── */

type Input = Parameters<typeof noteState>[0];
const line = (over: Partial<Input> = {}) =>
  noteState({
    row: { removed: false, refusal: null },
    create: null,
    takeBack: null,
    hold: null,
    offered: true,
    viewerIsSender: true,
    senderName: "Isaac Smith",
    sm8Name: "Isaac Smith",
    ...over,
  });

describe("what a note's line says", () => {
  it("1–4: a take-back row", () => {
    const tb = (o: Partial<QueueRowIn>) => create({ id: "d1", ...o });
    expect(line({ row: { removed: true, refusal: null }, takeBack: tb({ status: "queued" }), hold: "paused" })).toMatchObject({
      key: "line.stillIn",
      text: "Still in ServiceM8. Sending is paused.",
      acts: [],
    });
    expect(line({ row: { removed: true, refusal: null }, takeBack: tb({ status: "sending" }) }).key).toBe("line.takingOut");
    // (F) a take-back that ended as a trial: still in, with Try again
    expect(line({ row: { removed: true, refusal: null }, takeBack: tb({ status: "trial" }) })).toMatchObject({
      key: "line.stillIn",
      text: "Still in ServiceM8. Sending is a trial run.",
      tone: "bad",
      acts: ["take_out_again"],
    });
    expect(
      line({ row: { removed: true, refusal: null }, takeBack: tb({ status: "cancelled", last_error: WRITE_WORDS.otherAccount }) })
    ).toMatchObject({ text: `Still in ServiceM8. ${WRITE_WORDS.otherAccount}`, acts: ["take_out_again"] });
    expect(line({ row: { removed: true, refusal: null }, takeBack: tb({ status: "sent" }) }).key).toBeNull();
    expect(
      line({
        row: { removed: true, refusal: null },
        takeBack: tb({ status: "cancelled", last_error: NOTE_WORDS.row.nothingToTakeBack }),
      }).key
    ).toBeNull();
  });

  it("5: removed, no take-back row, and something of it may be there or could still go", () => {
    // (F) the create taken back while sending, its delete refused: still in, then nothing once it settles
    const closed = { taken_back_at: EARLIER };
    expect(line({ row: { removed: true, refusal: "capped" }, create: create({ status: "sending", maybe_landed: true, ...closed }) })).toMatchObject({
      key: "line.stillIn",
      text: `Still in ServiceM8. ${NOTE_WORDS.press.capped}`,
      acts: ["take_out_again"],
    });
    expect(line({ row: { removed: true, refusal: null }, create: create({ status: "cancelled", ...closed }) }).key).toBeNull();
    // (F) a removed row whose create isn't closed (a Send that raced the take-back)
    expect(line({ row: { removed: true, refusal: null }, create: create({ status: "queued" }) })).toMatchObject({
      key: "line.stillIn",
      acts: ["take_out_again"],
    });
    expect(line({ row: { removed: true, refusal: null }, create: create({ status: "cancelled" }) }).key).toBeNull();
    // (F) the reason with nothing stored: the hold, then not offered, then not taken out
    const sent = create({ status: "sent", ...closed });
    expect(line({ row: { removed: true, refusal: null }, create: sent, hold: "off" }).text).toBe(
      "Still in ServiceM8. Sending notes is switched off."
    );
    expect(line({ row: { removed: true, refusal: null }, create: sent, offered: false }).text).toBe(
      `Still in ServiceM8. ${NOTE_WORDS.why.notSending}`
    );
    expect(line({ row: { removed: true, refusal: null }, create: sent }).text).toBe(`Still in ServiceM8. ${NOTE_WORDS.why.notTakenOut}`);
  });

  it("6: taken back with nothing of it there reads nothing, removed or not", () => {
    expect(line({ create: create({ status: "cancelled", taken_back_at: EARLIER }) }).key).toBeNull();
    expect(line({ row: { removed: true, refusal: null } }).key).toBeNull();
  });

  it("7–18: the create's own state, and a stored refusal only below its live states", () => {
    expect(line({ create: create({ status: "cancelled", last_error: NOTE_WORDS.row.noteGone, maybe_landed: true }) })).toMatchObject({
      key: "line.removedThere",
      acts: ["undo"],
    });
    expect(line({ create: create(), hold: "paused" })).toMatchObject({ text: "Not in ServiceM8 yet. Sending is paused.", acts: ["undo"] });
    expect(line({ create: create({ last_error: WRITE_WORDS.slowDown }) })).toMatchObject({ tone: "warn", acts: ["undo"] });
    expect(line({ create: create({ attempts: 2 }) }).text).toBe("Not in ServiceM8 yet. Trying again shortly.");
    expect(line({ create: create() })).toMatchObject({ key: "line.sending", acts: ["undo"] });
    expect(line({ create: create({ status: "sent" }) })).toMatchObject({ key: "line.sent", tone: "ok", acts: ["undo"] });
    // (F) failed or cancelled but may have landed: unsure, whatever the reason
    for (const last_error of [NOTE_WORDS.row.notesSwitchedOff, WRITE_WORDS.switchedOff, WRITE_WORDS.disconnected, NOTE_WORDS.row.noteUnsure]) {
      for (const status of ["failed", "cancelled"]) {
        expect(line({ create: create({ status, last_error, maybe_landed: true }) })).toMatchObject({
          key: "line.unsure",
          acts: ["send_again", "undo"],
        });
      }
    }
    // (F) a trial create that may have landed is unsure, never "Trial run"
    expect(line({ create: create({ status: "trial", maybe_landed: true }) }).key).toBe("line.unsure");
    // (F) a stored refusal never reads over a create that is waiting, going or gone
    for (const status of ["queued", "sending", "sent"]) {
      expect(line({ row: { removed: false, refusal: "unlinked" }, create: create({ status }) }).key).not.toBe("line.notSent");
    }
    expect(line({ row: { removed: false, refusal: "unlinked" }, create: create({ status: "failed", maybe_landed: true }) }).key).toBe(
      "line.unsure"
    );
    expect(line({ row: { removed: false, refusal: "confirm" } })).toMatchObject({
      key: "line.notSent",
      text: "Not sent to ServiceM8. Is Isaac Smith you?",
      acts: ["confirm", "undo"],
    });
    expect(line({ create: create({ status: "failed", last_error: NOTE_WORDS.row.noteRefused }) })).toMatchObject({
      key: "line.notSent",
      acts: ["send_again", "undo"],
    });
    // (F) a trial create offers Send again and Undo
    expect(line({ create: create({ status: "trial" }) })).toMatchObject({ key: "line.trial", acts: ["send_again", "undo"] });
    expect(line({ create: create({ status: "cancelled", last_error: NOTE_WORDS.row.notesSwitchedOff }) })).toMatchObject({
      key: "line.notSent",
      tone: null,
      acts: ["send_again", "undo"],
    });
    expect(line({}).key).toBeNull();
  });

  it("(F) the sender always has Undo in cases 7–17, nobody else has a door, and cases 1–6 and 18 offer no Undo", () => {
    const cases: Partial<Input>[] = [
      { create: create({ status: "cancelled", last_error: NOTE_WORDS.row.noteGone }) },
      { create: create(), hold: "reconnect" },
      { create: create({ last_error: "x" }) },
      { create: create({ attempts: 1 }) },
      { create: create({ status: "sending" }) },
      { create: create({ status: "sent" }) },
      { create: create({ status: "failed", maybe_landed: true }) },
      { row: { removed: false, refusal: "unknown" } },
      { create: create({ status: "failed", last_error: "x" }) },
      { create: create({ status: "trial" }) },
      { create: create({ status: "cancelled", last_error: "x" }) },
    ];
    for (const c of cases) {
      expect(line(c).acts).toContain("undo");
      expect(line({ ...c, viewerIsSender: false }).acts).toEqual([]);
    }
    expect(line({ row: { removed: true, refusal: null }, takeBack: create({ status: "failed" }) }).acts).not.toContain("undo");
    expect(line({}).acts).toEqual([]);
  });

  it("gives every stored refusal a sentence for the sender and one for anyone else", () => {
    for (const code of STORED_REFUSALS) {
      const mine = line({ row: { removed: false, refusal: code } }).text;
      const theirs = line({ row: { removed: false, refusal: code }, viewerIsSender: false }).text;
      expect(mine).toMatch(/^Not sent to ServiceM8\. \S/);
      expect(theirs).toMatch(/^Not sent to ServiceM8\. \S/);
      expect(mine).not.toMatch(/\{/);
      expect(theirs).not.toMatch(/\{/);
    }
    expect(line({ row: { removed: false, refusal: "unlinked" }, viewerIsSender: false }).text).toBe(
      "Not sent to ServiceM8. Isaac Smith isn't linked to ServiceM8."
    );
  });

  it("stores exactly the migration's eleven codes", () => {
    const sql = readFileSync(join(process.cwd(), "docs", "migrations", "sm8_notes_queue.sql"), "utf8");
    const list = /workboard_notes_sm8_refusal_check[\s\S]*?in\s*\(([\s\S]*?)\)\);/.exec(sql)![1];
    const codes = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes).toEqual([...STORED_REFUSALS]);
  });
});
